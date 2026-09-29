---
name: motion-video-qa
description: "Loaded by the `motion-video` director to verify a video built with the motion-video family: `qa.py` checks spec, loudness, true peak, sync, flash rate, colour decode and the lag proof against that project's `timeline.json` and `brand.json`, while `lagproof.py` and `inspect.sh` also run on any MP4. Use directly only when the user asks specifically about those checks; not for making a video end to end."
compatibility: "Python 3 with numpy and Pillow; ffmpeg and ffprobe on PATH; curl for cta-check.sh, optionally npm and gh. qa.py needs the project's timeline.json (brand.json is optional); lagproof.py and inspect.sh need only an MP4. Runs inside the project assembled by the motion-video director."
license: Apache-2.0
metadata:
  author: "juanmaagd"
  version: "2.0"
---

# Motion Video QA

## Activation Contract

Loaded by `motion-video` for the preview and final checks and for the independent verification pass. It owns `qa.py`, `lagproof.py`, `sheet.py`, `inspect.sh`, `cta-check.sh` and `requirements.txt`. `qa.py` verifies a video of this family (it reads the project's `timeline.json` and `brand.json`); `lagproof.py` and `inspect.sh` accept any MP4 (copy them with `sheet.py` into a scratch folder, never run them inside a skill folder).

## Hard Rules

1. The lag proof must PASS: no run of more than 6 frames below `lagThreshold` outside a declared hold, and no every-Nth-frame cadence. Calibrate `lagThreshold` per encode.
2. A check must be shown to discriminate: PASS on good input, FAIL on bad input. A check that analysed nothing (missing file, zero frames, unknown argument) FAILs.
3. A final is delivered only when `qa.py` passes on the delivered MP4: spec, −14 ±1 LUFS, ≤ −1 dBTP, ≤ 3 flashes/s, sound hits within ±1 frame, lag proof.
4. Run `./inspect.sh` independently of the build's own QA before reporting, and never accept a worker's summary as verification.
5. Verify every on-screen CTA with `./cta-check.sh` right before delivery; a registry `latest` can be stale.
6. Report audio as measured, not auditioned, unless a person listened.

## Execution Steps

1. `npm run preview` and `npm run build` run `qa.py` on their MP4; `qa.py` exits 1 on any FAIL. Set `lagThreshold` per scale (`{"full": N, "preview": M}`) from `lagproof.py --blocks`.
2. Read every FAIL and WARN line. Picture-sync WARNs are expected for designed anticipation; sound sync at hard hits must be 0 ±1 frame.
3. `./inspect.sh out/<slug>.mp4`: spec, loudness, lag proof, a labelled frame tile, and a waveform and spectrogram PNG.
4. `./cta-check.sh npm:<pkg>@<version> url:<url> git:<owner>/<repo>` for every CTA.
5. Review by eye in two passes (beat contact sheet, 12-frame strips, full-size stills) with the table in `references/qa-checklist.md`.

## Output Contract

Return the `qa.py` lines (PASS, WARN, FAIL with numbers), the lag-proof result, the `-qa.txt` and `inspect.sh` output paths, the CTA results, and what was not verified (always whether audio was heard).

## References

- `references/qa-checklist.md`: thresholds and why, lag-proof calibration, determinism, encode checks, review checks.
- `references/pitfalls.md`: QA interpretation and verifier failures with their fixes (numbers are shared across the family).
