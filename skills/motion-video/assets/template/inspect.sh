#!/bin/sh
# One-shot inspection of a rendered video: spec (ffprobe), loudness (ebur128), the lag proof, a
# labelled frame tile at given times (Pillow via sheet.py -- never ffmpeg drawtext), and a
# waveform + spectrogram PNG (confirms structure without listening; it does not replace
# listening). Works on ANY video, not just this project's own -- fps/duration auto-detect from
# ffprobe unless overridden, so it can inspect another render for comparison.
#
#   ./inspect.sh VIDEO [TIME...] [--out=DIR] [--fps=N] [--end=T] [--thr=N]
#
# TIME (seconds, space-separated) defaults to one still every 2 s. --thr is the lag proof's still
# threshold (default 1.2; see lagproof.py for calibration).
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"

VIDEO=""
TIMES=""
OUT="out/inspect"
FPS=""
END=""
THR="1.2"
for arg in "$@"; do
  case "$arg" in
    --out=*) OUT="${arg#--out=}" ;;
    --fps=*) FPS="${arg#--fps=}" ;;
    --end=*) END="${arg#--end=}" ;;
    --thr=*) THR="${arg#--thr=}" ;;
    *)
      if [ -z "$VIDEO" ]; then VIDEO="$arg"; else TIMES="$TIMES $arg"; fi
      ;;
  esac
done
[ -n "$VIDEO" ] || { echo "usage: inspect.sh VIDEO [TIME...] [--out=DIR] [--fps=N] [--end=T] [--thr=N]" >&2; exit 2; }
mkdir -p "$OUT"

echo "== spec (ffprobe) =="
ffprobe -v error -count_frames -select_streams v:0 -show_entries \
  stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_read_frames,color_space,color_primaries,color_transfer:format=duration \
  -of default=nw=1 "$VIDEO"
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels -of default=nw=1 "$VIDEO" \
  || echo "(no audio stream)"

if [ -z "$FPS" ]; then
  FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$VIDEO" \
    | awk -F/ '{ if ($2 + 0 > 0) printf "%.6f", $1 / $2; else print $1 }')
fi
if [ -z "$END" ]; then
  END=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")
fi
echo "(using fps=$FPS end=${END}s for loudness/lag below)"

echo "== loudness (ebur128) =="
LOG=$(ffmpeg -hide_banner -nostats -i "$VIDEO" -af ebur128=peak=true:framelog=quiet -f null - 2>&1) || true
printf '%s\n' "$LOG" | grep -Eo "I:[[:space:]]+-?[0-9.]+ LUFS" | tail -1 | sed 's/^/  /'
printf '%s\n' "$LOG" | grep -Eo "Peak:[[:space:]]+-?[0-9.]+ dBFS" | tail -1 | sed 's/^/  /'

echo "== lag proof =="
LAG_STATUS=0
python3 "$ROOT/lagproof.py" "$VIDEO" "$END" --fps="$FPS" --thr="$THR" || LAG_STATUS=$?

echo "== labelled frame tile =="
[ -n "$TIMES" ] || TIMES=$(awk -v e="$END" 'BEGIN { for (t = 1; t < e; t += 2) printf "%.3f ", t }')
STILLS="$OUT/stills"
mkdir -p "$STILLS"
rm -f "$STILLS"/t*.png
for t in $TIMES; do
  tp=$(printf "%07.3f" "$t")
  ffmpeg -y -v error -ss "$t" -i "$VIDEO" -frames:v 1 "$STILLS/t${tp}.png"
done
python3 "$ROOT/sheet.py" "$STILLS" "$OUT/frames.png" --cols 6 --width 320
echo "frame tile -> $OUT/frames.png"

echo "== waveform + spectrogram =="
ffmpeg -y -v error -i "$VIDEO" -lavfi "showwavespic=s=1600x300:colors=white" "$OUT/waveform.png"
ffmpeg -y -v error -i "$VIDEO" -lavfi "showspectrumpic=s=1600x512:legend=1" "$OUT/spectrogram.png"
echo "waveform -> $OUT/waveform.png"
echo "spectrogram -> $OUT/spectrogram.png"

echo "inspect: done -> $OUT"
# This is a diagnostic report, not a build gate: every section above runs regardless of the lag
# proof's own result (a FAIL there must not skip the frame tile / waveform / spectrogram). The
# script's own exit code still reflects whether the lag proof passed, so it composes with a gate.
exit "$LAG_STATUS"
