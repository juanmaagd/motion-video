---
name: motion-video
description: "Trigger: motion video, motion graphics, animated video, launch video, promo, teaser, explainer, announcement, showreel, kinetic typography, social clip. Directs a beat-synced motion-graphics video (6-60s) end to end, rendered deterministically from HTML/SVG/Canvas code with a synthesized score, motion blur and automated QA (loudness, flash-rate, lag-proofing, determinism), using its four sibling skills motion-video-engine, motion-video-sound, motion-video-qa and motion-video-brand -- use whenever the ask is a short code-driven video rather than hand-edited footage or a template tool."
compatibility: "Node.js 22+; Python 3 with numpy and Pillow; ffmpeg and ffprobe on PATH; a Playwright Chromium headless shell (npx playwright install chromium-headless-shell, or set CHROME_PATH). Requires the sibling skills motion-video-engine, motion-video-sound, motion-video-qa and motion-video-brand from the same repo. Optional, only if used: Codex CLI for decorative raster plates (gen-image.mjs), ElevenLabs for a synthesized voice/music track."
license: Apache-2.0
metadata:
  author: "juanmaagd"
  version: "2.0"
---

# Motion Video

## Activation Contract

Load for any short motion-graphics video (6–60 s) rendered from code: launch, explainer, announcement, teaser, brand sting, data story, social clip, showreel. You direct it end to end and load the four sibling skills of this repo (`motion-video-<name>`) when a step names them: engine (scenes, render), sound (score), qa (checks), brand (brand inputs, marks, frames, raster plates).

## Hard Rules

1. Build in an assembled project (step 3), never inside a skill folder.
2. Every frame is `renderAt(t)`, a pure function of time (engine).
3. Duration is whole bars (`bpm = 240 × bars / duration`); all cues live in `timeline.json`, shared by picture and sound.
4. Brand rules beat the storyboard: real evidence only, colors in their roles, exact logo geometry, brand fonts in the project, never in a skill (brand).
5. Get the script table approved (`assets/templates/brief.md`) before building any new copy into scenes.
6. Continuous motion is proven, not assumed: the lag proof must PASS (qa).
7. Verify and source every CTA and third-party mark before it appears on screen; never assume a licence is open (brand, qa).
8. Never generate a logo, wordmark, type, UI, product screenshot, or anything carrying a claim; raster plates are decorative only (brand).
9. Review twice before the final: beat contact sheet, 12-frame transition strips, full-size stills.
10. Final uses 32 motion-blur samples, delivered only when `qa.py` passes (thresholds in qa).
11. Report audio as measured, not auditioned, unless a person listened (sound).

## Decision Gates

| Question | Default | Otherwise |
|---|---|---|
| Format | 16:9 1920×1080 | 9:16 1080×1920 or 1:1 1080×1080 |
| Duration | 15 s = 8 bars at 128 BPM | table in `references/storyboard.md` |
| Video type | matching template in `references/storyboard.md` | ask only if the goal is unclear |
| Soundtrack | synth kit (`score.mjs`) | ElevenLabs (optional) if connected; licensed user track: derive BPM, cues |
| Brand | extract from the repo or site | none: ask once for logo, colors, fonts; else defaults, stated |
| Revising existing work | `./archive.sh` first; confirm its re-render command | — |

Gates for raster plates, third-party marks and device frames live in brand.

## Execution Steps

1. Gather optional preferences in ONE grouped interaction (`references/intake.md`); exempt from step 2's one-at-a-time rule.
2. Resolve the remaining gates; ask one question at a time, only without a default.
3. Assemble the project: load engine, sound, qa, brand in that order and copy each one's `assets/project/` into one new folder (`references/workflow.md`, section 1).
4. With brand loaded, extract the brand into `brand.json`, `fonts/`, `brand/logo.svg`.
5. Storyboard on the grid; get the script table approved; write cues to `timeline.json` (`references/storyboard.md`).
6. Replace the demo scenes in `index.html` bar by bar (engine); check with `npm run stills`.
7. Write `score.mjs` on the same cues (sound).
8. `npm run preview`; two review passes against each sibling's `pitfalls.md`; `lagproof.py` PASSes (qa).
9. `npm run build` until QA passes (qa); this also produces the web deliverable.
10. `./inspect.sh` independently of the build's own QA, and `./cta-check.sh` on every CTA, before reporting.

## Output Contract

Return the web MP4, master, poster, contact-sheet and `-qa.txt` paths; ffprobe summary; loudness, true peak, flashes, lag-proof result; one line per bar; deviations and why; what was not verified (always whether audio was heard).

## References

- Here: `references/workflow.md` (process, assembly, review loop, delegation), `references/storyboard.md`, `references/intake.md`, `assets/templates/` (brief, review-notes, worker-brief).
- Siblings, each with `references/pitfalls.md`: engine (`motion-craft.md`, `scene-recipes.md`), sound (`sound-design.md`), qa (`qa-checklist.md`), brand (`brand-extraction.md`, `generated-assets.md`, `device-frames.md`).
