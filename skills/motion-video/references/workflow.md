# Workflow

End to end for one video. Paths are relative to the video project (a copy of `assets/template/`).

## Intake (before the gate)

One grouped, optional interaction — up to 4 questions (duration, idea, video type, style), each
with a "decide for me" default; skip whatever the request already answered. Record every resolved
choice in `assets/templates/brief.md`'s Preferences section. Full mechanism and fallback:
`references/intake.md`.

## 0. Gate (before any file)

Resolve format, duration/BPM, soundtrack source and brand source (SKILL.md decision gates). Ask only what has no default; one question at a time.

## 1. Brand

Extract tokens, fonts, logo and copy into `brand.json`, `fonts/`, `brand/logo.svg` (`brand-extraction.md`). Read the brand's bans before writing any copy: they override the storyboard.

## 2. Storyboard on the grid

1. Pick BPM and bars so `duration = bars * 240 / bpm` (`storyboard.md`).
2. Pick a narrative template for the video type; write one idea per beat, a hit on each bar's downbeat.
3. Write every cue into `timeline.json` (`name`, `beat`, `hit: true` for the loud sync points). Picture and sound read the same cues; never hard-code times in scenes or score.
4. Budget copy: at most ~2 words per beat for headlines; every sentence must read at 1x speed.
5. **Get the script approved before building it.** Fill `assets/templates/brief.md`'s script table (bar | time | picture | line) plus its claims/evidence and CTA tables, and get a yes before writing any of that copy into scenes — a full rebuild from a rejected story costs far more than a round of feedback on a table.

## 3. Project

```sh
cp -R <skill>/assets/template <video-folder> && cd <video-folder> && npm install
```

Edit `timeline.json` (fps, size, duration, bpm, cues) and `brand.json`. Replace the demo scenes in `index.html` bar by bar; keep `engine.js` untouched (`scene-recipes.md`, `motion-craft.md`).

## 4. Build scenes with a tight loop

- `node render.mjs stills --times=1.2,1.9 --scale=0.5` for the moment you are working on (about 30 ms per still at half size).
- `node render.mjs stills --beats` + `python3 sheet.py out/stills out/beats.png` for the whole piece.
- `node render.mjs stills --strip=1.80:12 --out=out/strip` for consecutive frames around a transition.
- Read the PNGs (the Read tool shows images). Half-size sheets at 480 px per thumb are enough to judge composition; open full-size stills to judge type.

## 5. Score

Write `score.mjs` from the cues (`sound-design.md`). `node score.mjs` prints the estimated LUFS and true peak. For a user track or ElevenLabs, see `sound-design.md` — the track then defines the BPM and cues.

## 6. Preview and review (two passes minimum)

**Before revising existing work**, run `./archive.sh` and confirm the printed re-render command works from the archive alone (`v1/`, `v2/`, ... next to the project). A revision without an archive is not recoverable if it goes wrong.

```sh
npm run preview      # 1 sample, half size: seconds, not minutes
```

Per pass: the beat contact sheet, a 12-frame strip around every transition, full-size stills of every bar, and `python3 lagproof.py out/<slug>-preview.mp4` (must PASS — no run of stepped/frozen frames outside a declared hold). Fix composition, collisions, timing and legibility; then repeat. Check every item of `pitfalls.md` that applies.

## 7. Final

```sh
npm run build        # 32 motion-blur samples, full size; exit code = QA
```

Budget: about 13 s of wall time per rendered second of 1080p60 with 8 workers (the 15 s showreel took 189 s), linear in samples and pixels. `node build.mjs --slice=a:b` renders one moment at final settings.

## 8. Deliver

`out/<slug>.mp4`, `-web.mp4` (CRF-stepped under a size budget, default 10 MB), `-poster.png`, `-contact.png`, `-qa.txt`. Before reporting, run `./inspect.sh out/<slug>.mp4` independently of the build's own QA output — spec, loudness, the lag proof, a labelled frame tile, and a waveform/spectrogram PNG (this is how audio gets reported as measured, not auditioned, unless a person actually listened). Verify every on-screen CTA with `cta-check.sh` one last time. Report per `SKILL.md` Output Contract. Keep `out/` out of any git repo unless asked.

## Delegating to a worker (optional)

When the build is handed to a worker (an agent, a teammate) rather than done solo, run it as a loop, not a handoff-and-wait:

1. **Brief.** `assets/templates/worker-brief.md`: boundaries (which files the worker may touch), the approved `brief.md`, archive-first, the checkpoint it must stop at, and the report contract.
2. **Worker builds to a checkpoint** — preview, beat contact sheet, 12-frame strips, key stills, lag proof — and stops. It does not push to final on its own judgment.
3. **Director reviews independently**, in `assets/templates/review-notes.md`'s shape: prioritized, frame-referenced (time, symptom, fix, acceptance), blocking before advisory. Cross-check every note against `pitfalls.md` before writing it.
4. **Worker applies the notes**, rebuilds soundtrack + final + QA.
5. **Director verifies independently** — re-run the checks, do not accept the worker's report as the verification. Spec, frames at every fix, loudness, lag proof, waveform/spectrogram.
6. **Deliver**, stating the audio was measured, not heard, unless someone actually listened.

Never treat a worker's summary as proof — this project has already been burned by a report that did not match the artifact it described.

## Worked example

A showreel (15 s, 128 BPM, 8 bars, 1080p60): brand extraction from a site repo, 44 cues, 8 scenes, two review passes with 16-frame sheets and transition strips, synth score at −14.0 LUFS / −1.1 dBTP, final in 189 s. The failures found on the way are in `pitfalls.md`.
