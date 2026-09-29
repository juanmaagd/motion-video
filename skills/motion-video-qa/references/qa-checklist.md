# QA checklist

`qa.py` runs the automatic checks (exit 1 on any FAIL); the rest are review checks that need eyes. Run everything on the delivered MP4, not on intermediates. `inspect.sh` runs the automatic side independently of `build.mjs`'s own run — use it for the director's independent verification pass.

**A check must be proven to discriminate before it is trusted**: run it once on a genuinely good input and confirm PASS, then once on a genuinely bad one (a missing file, a corrupt/truncated one, zero decoded frames, an unrecognized argument) and confirm FAIL — never non-zero-but-silent, never a clean-looking PASS that actually checked nothing. A tool that has only ever been seen passing has not been verified, it has been run once. This is not optional for a new check or tool added to this template — see pitfall 61 ("a verifier that checked nothing must FAIL") for the exact bugs this caught here: `lagproof.py` reporting PASS on a nonexistent video, and `cta-check.sh` reporting PASS after silently skipping an unrecognized spec.

## Automatic (`python3 qa.py out/<slug>.mp4 [--scale S] [--no-sync] [--picture-window N]`, run by `build.mjs`)

| Check | Threshold | Notes |
|---|---|---|
| Size | exactly `width x height` (x `--scale` for previews) | H.264, yuv420p |
| Frame rate | `fps`/1 | |
| Frames / duration | `round(duration * fps)` ±1 frame | a 901-frame render meant segment drift (pitfall 2, in the `motion-video-engine` skill) |
| Audio | present, 48 kHz, stereo | AAC 256k in the MP4 |
| Loudness | `loudness` ±1 LU (default −14 LUFS integrated) | ffmpeg `ebur128` |
| True peak | ≤ `truePeak` (default −1 dBTP) | |
| Sync (sound) | audio onset peak within ±1 frame of every `hit: true` cue | FAIL. Onsets come from 150 Hz high-passed audio in 2.5 ms blocks — sub-bass swings under a one-frame RMS window read as false onsets otherwise |
| Sync (picture) | biggest picture change within ± `pictureSyncWindow` frames (default 4, `timeline.json` or `--picture-window`) | WARN: designed anticipation (text landing early, implosions) is expected |
| Flashes | ≤ 3 per second, reported separately for the whole frame and each quadrant | WCAG 2.3.1 general flash, simplified: a flash = a pair of opposing ≥ 0.10 relative-luminance changes with the darker state < 0.80 |
| Colour decode (optional) | brand.json `colorProbes` entries within `tolerance` (default 3) per channel of the target hex | Skipped entirely when `brand.json` has no `colorProbes`. Verify a mark's fill and the brand's UI accent separately — they can differ by a hair |
| Lag proof | no run > 6 frames below `lagThreshold` outside a declared `holds` window; no every-Nth-frame stepping cadence | See "Lag proof" below; same check as standalone `lagproof.py`, imported by `qa.py` |

## Lag proof

Proves motion is continuous: never stepped (quantized to a low frame rate inside a 60 fps film) and never parked (a camera or scene frozen with nothing moving). Measured as YAVG of `|frame(n) - frame(n-1)|` at 480×270 (`ffmpeg tblend=all_mode=difference,signalstats`).

- **Calibrate `lagThreshold` per encode, not once globally.** Render a deliberately still hold (or use `--blocks` on any render), read the floor with `lagproof.py --blocks`, and set the threshold to roughly 2.5× that floor. `lagThreshold` in `timeline.json` accepts either a single number (used at every `--scale`) or a per-scale object, `{"full": N, "preview": M}` — most projects end up needing both, because a preview's faster/higher-CRF encode is often far more destructive to subtle motion (grain, a slow drift) than the final's (pitfall 59). Two calibrated examples from real projects: full-resolution final, floor 0.46 → threshold 1.2; half-size preview (`--scale=0.5`), floor 0.11 → threshold 0.85 — but re-measure your own; these are starting points, not universal constants.
- **Declare real holds.** `timeline.json`'s `holds`: `[[start, end], ...]` (seconds) exempts a designed still run from FAILing — but it should still be ≤ 0.3 s with something secondary moving (an anticipation ring, grain); `qa.py` WARNs when a declared hold's measured run exceeds that.
- `lagProofEnd` (default the whole `duration`) can exclude a deliberately static final hold (e.g. a slow-push lockup) from the check, the way the showreel excluded everything after its final hit.
- Run it standalone any time: `python3 lagproof.py out/<slug>.mp4 [END] [--thr=N] [--fps=N] [--holds='[[a,b]]'] [--blocks]`.

## Logo fidelity (automated capture, manual judgment)

`build.mjs` runs this on every non-preview build when the composition supports it: `brandqa.mjs` renders the shipped `brand.logo` at the exact box `window.__logoBox(t)` reports (skips with a note if `brand.json` has no logo, or the composition has no hook), then `logoqa.py` diffs it against the poster frame — pixels differing by more than 50%, mean/max absolute difference. This is a **report, not a gate**: no threshold is asserted in code, because the acceptable diff depends on how much grain the final encode has. Treat 0 pixels > 50% different and a mean abs diff under ~0.02 as passing (the showreel measured 0 px / 0.0146 mean / 0.384 max).

## Determinism

`node determinism.mjs [--times=...] [--scale=0.5]`: captures a set of frames forward and in reverse order, in the same page, and requires the PNG bytes to be identical at every time. Run this whenever a scene adds a canvas layer, an SVG filter, or anything else that touches shared page state — it is the check that catches a CSS-blend-mode compositing bug before it silently corrupts a chunked/parallel final render.

## Encode checks (ffprobe once per delivery)

```sh
ffprobe -v error -show_entries stream=codec_name,profile,width,height,pix_fmt,r_frame_rate,nb_frames,sample_rate,channels,color_space,color_primaries,color_transfer:format=duration -of default=nw=1 out/<slug>.mp4
```
Expect `h264 High`, `yuv420p`, `bt709` for space, primaries and transfer, the right frame count, AAC 48000 Hz 2 ch.

## Review checks (eyes; two passes minimum)

| Check | Pass when |
|---|---|
| Beat contact sheet | every beat shows one readable idea; no empty or broken frame unless designed |
| Transition strips | 12 consecutive frames around every transition: no pops, stray elements, off-centre targets, half-drawn states on a hit |
| Full-size stills | text crisp (no soft 3D layers), nothing clipped or colliding, descenders intact, labels ≥ 14 px at 1080p |
| Timing | readable content lands on its beat; decoders resolve and hold ≥ 0.3 s; the lockup holds ≥ 1 s; every headline respected its readable-time guard (`makeHeadline`) |
| Logo | logo-fidelity report reviewed (above); brand-provided marks used exactly as fetched by `logos.mjs`, no non-open licence shipped unverified |
| Brand bans | no invented numbers or claims; colors only in their roles; no banned motifs in picture or sound; every claim traced to a tested/supported source (`assets/templates/brief.md` in the `motion-video` skill) |
| CTAs | every on-screen npm command, URL and repo verified with `cta-check.sh`, re-run once right before delivery |
| Motion blur | final at 32 samples: no visible sample steps on the fastest move (check the whip/slam frames) |
| Loop (stings) | `renderAt(0)` and the last frame match; the audio tail wraps |
| Audio | listened to by a person — or reported as unauditioned (a waveform + spectrogram PNG, `inspect.sh`, confirms structure but is not the same as listening) |

## Deliverables

`out/<slug>.mp4`, `out/<slug>-web.mp4` (CRF-stepped under a size budget, default 10 MB), `out/<slug>-poster.png` (last frame, lossless), `out/<slug>-contact.png` (one encoded frame per beat), `out/<slug>-qa.txt` (now includes the lag proof, logo fidelity, and the web-encode summary), and the project source that rebuilds them with `npm run build`.
