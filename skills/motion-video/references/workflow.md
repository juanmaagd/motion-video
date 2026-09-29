# Workflow

End to end for one video. Paths are relative to the assembled video project (section 1), except `references/` and `assets/templates/` files, which live in the skill named next to them (this one unless stated).

## Intake (before the gate)

One grouped, optional interaction — up to 4 questions (duration, idea, video type, style), each
with a "decide for me" default; skip whatever the request already answered. Record every resolved
choice in `assets/templates/brief.md`'s Preferences section. Full mechanism and fallback:
`references/intake.md`.

## 0. Gate (before any file)

Resolve format, duration/BPM, soundtrack source and brand source (SKILL.md decision gates). Ask only what has no default; one question at a time.

## 1. Project (assemble the family's files)

Each skill of the family ships the project files it owns in its own `assets/project/`; the video project is those folders copied into one new folder. Do this before writing any project file (brand data, cues, scenes).

1. Load the siblings in this fixed order: `motion-video-engine`, `motion-video-sound`, `motion-video-qa`, `motion-video-brand`. In Claude Code the skill loader reveals each skill's base directory (`<base>` below; this skill's own is `<director>`). Without a skill loader, the sibling folders are installed next to this skill's folder, in the same parent directory.
2. Collision check (every file has exactly one owner, so it prints nothing; stop and report any path it prints):

```sh
for b in <director> <engine> <sound> <qa> <brand>; do (cd "$b/assets/project" && find . -type f); done | sort | uniq -d
```

3. Copy in the same order, director first (`<engine>` ... `<brand>` are the four bases from step 1):

```sh
mkdir <video-folder>
for b in <director> <engine> <sound> <qa> <brand>; do cp -R "$b/assets/project/." "<video-folder>/"; done
```

4. `cd <video-folder> && npm install && python3 -m pip install -r requirements.txt`.

Then set fps, size, duration and bpm in `timeline.json` as the storyboard fixes them, and fill `brand.json` from the extraction (section 2). Device frames stay on demand: `assets/devices/` in `motion-video-brand` is not copied; copy one into `brand/devices/` only when a scene needs it (`device-frames.md` in that skill).

## 2. Brand

Extract tokens, fonts, logo and copy into `brand.json`, `fonts/`, `brand/logo.svg` (`brand-extraction.md` in the `motion-video-brand` skill). Read the brand's bans before writing any copy: they override the storyboard.

## 3. Storyboard on the grid

1. Pick BPM and bars so `duration = bars * 240 / bpm` (`storyboard.md`).
2. Pick a narrative template for the video type; write one idea per beat, a hit on each bar's downbeat.
3. Write every cue into `timeline.json` (`name`, `beat`, `hit: true` for the loud sync points). Picture and sound read the same cues; never hard-code times in scenes or score.
4. Budget copy: at most ~2 words per beat for headlines; every sentence must read at 1x speed.
5. **Get the script approved before building it.** Fill `assets/templates/brief.md`'s script table (bar | time | picture | line) plus its claims/evidence and CTA tables, and get a yes before writing any of that copy into scenes — a full rebuild from a rejected story costs far more than a round of feedback on a table.

## 4. Build scenes with a tight loop

- Replace the demo scenes in `index.html` bar by bar; keep `engine.js` untouched (`scene-recipes.md`, `motion-craft.md` in the `motion-video-engine` skill).
- `node render.mjs stills --times=1.2,1.9 --scale=0.5` for the moment you are working on (about 30 ms per still at half size).
- `node render.mjs stills --beats` + `python3 sheet.py out/stills out/beats.png` for the whole piece.
- `node render.mjs stills --strip=1.80:12 --out=out/strip` for consecutive frames around a transition.
- `npm run studio` (Chrome or Chromium, `http://127.0.0.1:4321`): the composition live, scrubbable and playable with the score; every save reloads it, a syntax error (file, line and column, found by `node --check` within a fraction of a second) or a failed load shows as a message over the last good frame, and `score.mjs` / `timeline.json` edits regenerate the sound. The person can click the frame there to leave a note (section 6).
- Read the PNGs (the Read tool shows images). Half-size sheets at 480 px per thumb are enough to judge composition; open full-size stills to judge type.

## 5. Score

Write `score.mjs` from the cues (`sound-design.md` in the `motion-video-sound` skill). `node score.mjs` prints the estimated LUFS and true peak. For a user track or ElevenLabs, see that file — the track then defines the BPM and cues.

## 6. Preview and review (two passes minimum)

**Before revising existing work**, run `./archive.sh` and confirm the printed re-render command works from the archive alone (`v1/`, `v2/`, ... next to the project). A revision without an archive is not recoverable if it goes wrong.

```sh
npm run preview      # 1 sample, half size: seconds, not minutes
```

**Pointed feedback.** When the person reviews in the studio, every click on the frame becomes a note in `feedback.json` (schema v1: `t`, `frame`, `context.bar`/`beat`/`cue`/`scene`, the clicked `target` element with its `path`, `point` in video pixels and the camera-free `stage` point, `text`, `status`, `resolution`). Work it as a loop: read the file fresh each time (notes arrive while you work), take the open notes in `t` order, render stills at each `t` (`node render.mjs stills --times=<t>`, plus `--strip=<t-0.2>:12` for a motion note), fix `index.html`, re-render the same `t`, then mark the note `resolved` (or `wontfix`) with a one-line `resolution` by editing its `status` and `resolution` in the file, or with `PATCH /api/feedback/<id>` (JSON `{status, resolution}`; it needs the run's token, which is in the page served at `/`, sent as `X-Studio-Token` with an `Origin` of the studio's own address). The studio shows the change at once. `feedback.json` is a working file: keep it out of git (a project that is a repo ignores it); `archive.sh` copies it into `vN/src/` as the review record of that version.

Per pass: the beat contact sheet, a 12-frame strip around every transition, full-size stills of every bar, and `python3 lagproof.py out/<slug>-preview.mp4` (must PASS — no run of stepped/frozen frames outside a declared hold). Fix composition, collisions, timing and legibility; then repeat. Check every item of the `pitfalls.md` files (`motion-video-engine`, `-sound`, `-qa`, `-brand`) that applies.

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
3. **Director reviews independently**, in `assets/templates/review-notes.md`'s shape: prioritized, frame-referenced (time, symptom, fix, acceptance), blocking before advisory. Cross-check every note against those `pitfalls.md` files before writing it.
4. **Worker applies the notes**, rebuilds soundtrack + final + QA.
5. **Director verifies independently** — re-run the checks, do not accept the worker's report as the verification. Spec, frames at every fix, loudness, lag proof, waveform/spectrogram.
6. **Deliver**, stating the audio was measured, not heard, unless someone actually listened.

Never treat a worker's summary as proof — this project has already been burned by a report that did not match the artifact it described.

## Worked example

A showreel (15 s, 128 BPM, 8 bars, 1080p60): brand extraction from a site repo, 44 cues, 8 scenes, two review passes with 16-frame sheets and transition strips, synth score at −14.0 LUFS / −1.1 dBTP, final in 189 s. The failures found on the way are in those `pitfalls.md` files.
