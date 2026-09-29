"""QA for a rendered motion video. Exit code 1 on any FAIL.

    python3 qa.py VIDEO [--scale 0.5] [--no-sync] [--picture-window N]

Checks (thresholds from timeline.json/brand.json, see references/qa-checklist.md):
  spec       video size (width/height x scale), fps, frame count, duration; audio 48 kHz stereo
  loudness   integrated within +-1 LU of `loudness` (default -14 LUFS); true peak <= `truePeak` (default -1 dBTP)
  sync       for every cue with "hit": true, the audio onset peaks within +-1 frame of the cue (FAIL).
             Onsets come from 150 Hz high-passed audio (sub-bass swings read as false onsets in a
             one-frame RMS window) in 2.5 ms blocks, each block's rise over the loudest of the previous
             10 ms. Picture: the biggest picture change within +-`pictureSyncWindow` frames (default 4,
             set `pictureSyncWindow` in timeline.json or pass --picture-window; WARN only -- designed
             anticipation, e.g. text landing early or an implosion peaking before the hit, is expected).
  flashes    at most 3 per second, reported separately for the whole frame and each quadrant (WCAG 2.3.1,
             simplified: a flash is a pair of opposing >= 0.10 relative-luminance changes with the darker
             state < 0.80)
  colour     optional: brand.json `colorProbes` decoded from the encode and compared to the role's hex
             (a mark's fill can differ from the brand's other accents -- verify each exactly)
  lag proof  no run of more than 6 frames with near-zero frame-to-frame change outside a declared
             `holds` window, and no every-Nth-frame stepping cadence (see lagproof.py; this is the same
             check, run over the delivered MP4 and folded into this report and its exit code).
             `lagThreshold` in timeline.json is a single number or a per-scale {"full": N, "preview": M}
             object -- calibrate both if you see the preview fail while the final passes (pitfall 59).
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

import lagproof

args = sys.argv[1:]
video = args[0]
scale = float(args[args.index("--scale") + 1]) if "--scale" in args else 1.0
tl = json.loads((Path(__file__).parent / "timeline.json").read_text())
brand_path = Path(__file__).parent / "brand.json"
brand = json.loads(brand_path.read_text()) if brand_path.exists() else {}
fps, beat, off = tl["fps"], 60 / tl["bpm"], tl.get("offset", 0)
cue = {c["name"]: off + (c["beat"] - 1) * beat for c in tl["cues"]}
hits = [c["name"] for c in tl["cues"] if c.get("hit")]
pict_window = int(next((args[i + 1] for i, a in enumerate(args) if a == "--picture-window"), tl.get("pictureSyncWindow", 4)))
fails, warns = [], []


def check(ok, label, detail, warn=False):
    tag = "PASS" if ok else ("WARN" if warn else "FAIL")
    print(f"  {tag:4s} {label:10s} {detail}")
    if not ok:
        (warns if warn else fails).append(label)


def probe(sel, entries):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", sel, "-count_frames" if sel == "v:0" else "-hide_banner",
                          "-show_entries", entries, "-of", "json", video], capture_output=True, text=True, check=True).stdout
    s = json.loads(out).get("streams", [])
    return s[0] if s else None


print(f"QA {video}")
v = probe("v:0", "stream=codec_name,width,height,r_frame_rate,nb_read_frames,pix_fmt")
a = probe("a:0", "stream=codec_name,sample_rate,channels")
if v is None:
    # A verifier that checked nothing must FAIL, never silently report PASS: no video stream means
    # every check below is unrunnable, not "all green".
    check(False, "spec", f"no video stream found in {video} (ffprobe returned no v:0 stream)")
    print("QA: FAIL (spec)")
    sys.exit(1)
W, H = round(tl["width"] * scale), round(tl["height"] * scale)
num, den = map(int, v["r_frame_rate"].split("/"))
frames, want = int(v["nb_read_frames"]), round(tl["duration"] * fps)
check((v["width"], v["height"]) == (W, H), "size", f'{v["width"]}x{v["height"]} (want {W}x{H}), {v["codec_name"]} {v["pix_fmt"]}')
check(abs(num / den - fps) < 1e-6, "fps", f"{num}/{den} (want {fps})")
check(abs(frames - want) <= 1, "frames", f"{frames} = {frames / fps:.3f} s (want {want} = {tl['duration']:.3f} s)")
check(a is not None and int(a["sample_rate"]) == 48000 and int(a["channels"]) == 2, "audio",
      f'{a["codec_name"]} {a["sample_rate"]} Hz {a["channels"]} ch' if a else "no audio stream")

if a is not None:
    log = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", video, "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    I = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", log)[-1])
    tp = float(re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", log)[-1])
    target, tpmax = tl.get("loudness", -14), tl.get("truePeak", -1)
    check(abs(I - target) <= 1.0, "loudness", f"{I:.1f} LUFS (target {target} +-1)")
    check(tp <= tpmax + 1e-9, "truepeak", f"{tp:.1f} dBTP (max {tpmax})")

# picture: linear-light luminance on a small raster
w, h = 160, max(2, round(160 * tl["height"] / tl["width"] / 2) * 2)
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-vf", f"scale={w}:{h}:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                     capture_output=True, check=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.float32) / 255
Y = np.where(fr <= 0.04045, fr / 12.92, ((fr + 0.055) / 1.055) ** 2.4) @ np.array([0.2126, 0.7152, 0.0722], np.float32)
n = len(Y)
# A raw-frame extraction that decoded 0 frames means flashes/picture-sync/lag below would all be
# computed over empty data -- silently skipping them (or letting them run and vacuously report
# "0 flashes" etc.) is exactly the false-PASS class this project has been burned by. FAIL loudly and
# skip the frame-dependent sections instead of letting them crash or rubber-stamp empty input.
check(n > 0, "picture", f"{n} frames decoded for flash/sync-picture/lag analysis (want > 0)")
diff = np.r_[0, np.abs(np.diff(Y, axis=0)).mean(axis=(1, 2))] if n > 0 else np.array([])

if n > 0 and "--no-sync" not in args and a is not None and hits:
    sr = 48000
    # high-pass at 150 Hz before onset detection -- sub-bass swings read as false onsets otherwise.
    pcm = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", video, "-af", "highpass=f=150:poles=2", "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"],
                                       capture_output=True, check=True).stdout, np.float32).astype(np.float64)
    # `hits` is non-empty, so sync WAS supposed to run: 0 decoded samples means no onset was ever
    # actually analysed, not that every cue happened to land perfectly. FAIL each cue explicitly
    # instead of letting a degenerate all-zero onset array coincidentally read as a miss (or worse,
    # a match).
    if len(pcm) == 0:
        for name in hits:
            check(False, f"sync:{name}"[:10], "no audio samples decoded -- onsets not analysed")
    else:
        blk = 120  # 2.5 ms at 48 kHz: fine enough to place an onset within a 1/60 s frame
        nb = len(pcm) // blk
        edb = 10 * np.log10(np.mean(pcm[: nb * blk].reshape(nb, blk) ** 2, axis=1) + 1e-12)
        prev = np.full(nb, -120.0)
        for k in range(1, 5):  # loudest of the previous 10 ms (4 blocks)
            prev[k:] = np.maximum(prev[k:], edb[:-k])
        rise = np.maximum(edb - prev, 0)
        onset = np.array([rise[-(-f * sr // fps // blk):-(-(f + 1) * sr // fps // blk)].max(initial=0) for f in range(n)])
        for name in hits:
            f0 = round(cue[name] * fps)
            lo, hi = max(f0 - 4, 1), min(f0 + 5, n)
            pa = lo + int(np.argmax(onset[lo:hi])) - f0
            lo8, hi8 = max(f0 - pict_window, 1), min(f0 + pict_window + 1, n)
            pv = lo8 + int(np.argmax(diff[lo8:hi8])) - f0
            check(abs(pa) <= 1, f"sync:{name}"[:10], f"sound {pa:+d} frames at t={cue[name]:.3f}")
            check(abs(pv) <= pict_window, f"pict:{name}"[:10], f"picture peak {pv:+d} frames (window +-{pict_window})", warn=True)


def flashes(series):
    pts, direction = [(0, series[0])], 0
    for i in range(1, len(series)):
        d = series[i] - pts[-1][1]
        if abs(d) < 0.01:
            continue
        sgn = 1 if d > 0 else -1
        if sgn == direction:
            pts[-1] = (i, series[i])
        else:
            pts.append((i, series[i]))
            direction = sgn
    trans = [b[0] for a_, b in zip(pts, pts[1:]) if abs(b[1] - a_[1]) >= 0.10 and min(a_[1], b[1]) < 0.80]
    best = max((sum(1 for f in trans if s <= f < s + fps) // 2 for s in range(n)), default=0)
    return trans, best


if n > 0:
    regions = {"frame": Y.mean(axis=(1, 2))}
    for qy in (0, 1):
        for qx in (0, 1):
            regions[f"quad{qy}{qx}"] = Y[:, qy * h // 2:(qy + 1) * h // 2, qx * w // 2:(qx + 1) * w // 2].mean(axis=(1, 2))
    for label, series in regions.items():
        trans, best = flashes(series)
        check(best <= 3, f"flash:{label}", f"{best}/s (limit 3); transitions at t={[round(f / fps, 2) for f in trans]}")
else:
    check(False, "flash:frame", "skipped -- 0 frames decoded (see the 'picture' check above)")

# ------------------------------------------------------------ colour decode (optional, brand.json)
probes = brand.get("colorProbes", [])
if probes:
    print("colour decode (brand.json colorProbes, median RGB after H.264):")

    def frame_rgb(t):
        raw1 = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.4f}", "-i", video, "-frames:v", "1",
                               "-vf", "scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24", "-f", "rawvideo", "-"],
                              capture_output=True, check=True).stdout
        return np.frombuffer(raw1, np.uint8)[: tl["height"] * tl["width"] * 3].reshape(tl["height"], tl["width"], 3).astype(int)

    for p in probes:
        x0, y0, x1, y1 = p["rect"]
        want_hex = brand.get("colors", {}).get(p["role"]) if "role" in p else p["hex"]
        want = tuple(int(want_hex[i:i + 2], 16) for i in (1, 3, 5))
        crop = frame_rgb(p["at"])[y0:y1, x0:x1]
        if crop.size == 0:
            # An empty rect (y0 == y1 or x0 == x1, or out of frame) checked NOTHING for this probe;
            # a declared colorProbes entry must fail, not silently produce a NaN that happens not to
            # raise until int(nan) further down.
            check(False, f"colour:{p['label']}", f"rect {p['rect']} is empty at t={p['at']} -- nothing was decoded")
            continue
        got = np.median(crop.reshape(-1, 3), axis=0)
        delta = int(np.max(np.abs(got - np.asarray(want))))
        check(delta <= p.get("tolerance", 3), f"colour:{p['label']}", f"decoded {tuple(int(x) for x in got)} target {want} ({want_hex}) delta {delta}")

# ------------------------------------------------------------ lag proof (see lagproof.py)
print("lag proof (frame differences; see references/motion-craft.md):")
lag_end = tl.get("lagProofEnd", tl["duration"])
# lagThreshold is a single number (used at every scale) or a per-scale {"full": N, "preview": M}
# object -- a preview encode is typically far more destructive to subtle motion than the final
# (pitfall 59), so most projects end up calibrating two different numbers, not one.
_lag_thr_cfg = tl.get("lagThreshold")
if isinstance(_lag_thr_cfg, dict):
    lag_thr = _lag_thr_cfg.get("full" if scale >= 1 else "preview", 1.2 if scale >= 1 else 0.85)
elif _lag_thr_cfg is not None:
    lag_thr = _lag_thr_cfg
else:
    lag_thr = 1.2 if scale >= 1 else 0.85
holds = tl.get("holds", [])
try:
    lag_vals = lagproof.frame_diffs(video, lag_end)
    lagproof.check_coverage(lag_vals, lag_end, fps)
except lagproof.LagProofError as e:
    check(False, "lag:read", str(e))
    lag_vals = []
lag_bad = lagproof.still_runs(lag_vals, lag_thr) if lag_vals else []
lag_eps = 0.5 / fps  # half a frame: absorbs rounding when a hold is hand-typed from printed (3 dp) times
for f0, f1 in lag_bad:
    t0, t1 = f0 / fps, f1 / fps
    inside = any(h0 <= t0 + lag_eps and t1 <= h1 + lag_eps for h0, h1 in holds)
    check(inside, "lag:still", f"{t0:.3f}-{t1:.3f} s ({f1 - f0 + 1} frames)" + ("" if inside else " -- not inside any declared hold"))
    if inside:
        check(t1 - t0 <= 0.3, "lag:hold-len", f"declared hold {t0:.3f}-{t1:.3f} s ({t1 - t0:.3f} s); only stills allowed are <= 0.3 s", warn=True)
lag_cad = lagproof.cadence(lag_vals, lag_thr)
check(not lag_cad, "lag:cadence", "no every-Nth-frame pattern" if not lag_cad else f"stepped motion at {[f'{w0 / fps:.2f}s x{n}' for w0, n in lag_cad]}")
print(f"  {len(lag_vals)} frame diffs over 0-{lag_end:g} s (threshold {lag_thr}), {sum(v < lag_thr for v in lag_vals)} below it")

print(f"QA: {'PASS' if not fails else 'FAIL'}" + (f" ({', '.join(fails)})" if fails else "") + (f"  warnings: {', '.join(warns)}" if warns else ""))
sys.exit(1 if fails else 0)
