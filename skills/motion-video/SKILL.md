---
name: motion-video
description: "Trigger: motion video, motion graphics, animated video, launch video, promo, teaser, explainer, announcement, showreel, kinetic typography, social clip. Renders a beat-synced motion-graphics video (6-60s) deterministically from HTML/SVG/Canvas code, with a synthesized score, motion blur and automated QA (loudness, flash-rate, lag-proofing, determinism) -- use whenever the ask is a short code-driven video rather than hand-edited footage or a template tool."
compatibility: "Node.js 22+; Python 3 with numpy and Pillow; ffmpeg and ffprobe on PATH; a Playwright Chromium headless shell (npx playwright install chromium-headless-shell, or set CHROME_PATH). Optional, only if used: Codex CLI for decorative raster plates (gen-image.mjs), ElevenLabs for a synthesized voice/music track."
license: Apache-2.0
metadata:
  author: "juanmaagd"
  version: "1.3"
---

# Motion Video

## Activation Contract

Load for any short motion-graphics video (6–60 s) rendered from code: launch, explainer, announcement, teaser, brand sting, data story, social clip, showreel.

## Hard Rules

1. Start from a copy of `assets/template/`; never edit the skill's copy.
2. Every frame is `renderAt(t)`, a pure function of time: no CSS animation, rAF state, `Math.random`, or network/generation calls inside a scene.
3. Duration is whole bars (`bpm = 240 × bars / duration`); all cues live in `timeline.json`, shared by picture and sound.
4. Brand rules beat the storyboard: real evidence only (no invented metrics or claims), colors in their roles, exact logo geometry, brand fonts in the project, never in the skill.
5. Get the script table approved (`assets/templates/brief.md`) before building any new copy into scenes.
6. Continuous motion is proven, not assumed: the lag proof (`qa.py`/`lagproof.py`) must PASS — no stepped motion, no frozen run outside a declared hold.
7. Every CTA and third-party mark is verified and sourced before it appears on screen (`cta-check.sh`, `logos.mjs`); never assume a licence is open.
8. Never generate a logo, wordmark, type, UI, product screenshot, or anything carrying a claim; `gen-image.mjs` (Codex CLI) is for decorative/illustrative rasters only.
9. Review twice before the final: beat contact sheet, 12-frame transition strips, full-size stills.
10. Final uses 32 motion-blur samples, delivered only when `qa.py` passes (spec, −14 ±1 LUFS, ≤ −1 dBTP, ≤ 3 flashes/s, hits ±1 frame, lag proof).
11. Report audio as measured, not auditioned, unless a person listened.

## Decision Gates

| Question | Default | Otherwise |
|---|---|---|
| Format | 16:9 1920×1080 | 9:16 1080×1920 or 1:1 1080×1080 |
| Duration | 15 s = 8 bars at 128 BPM | table in `references/storyboard.md` |
| Video type | matching template in `references/storyboard.md` | ask only if the goal is unclear |
| Soundtrack | synth kit (`score.mjs`) | ElevenLabs (optional) if connected; licensed user track → derive BPM, cues |
| Brand | extract from the repo or site | none → ask once for logo, colors, fonts; else defaults, stated |
| Raster plate/texture/illustration needed | `npm run gen-image` (Codex CLI, optional) | composed in code (default) |
| Third-party mark's licence not open | drop it, ask | user explicitly accepts the risk |
| Device frame needed | generic (`genericDeviceFrame`, animatable) | licensed bundled/user/official bezel, static only (`references/device-frames.md`) |
| Revising existing work | `./archive.sh` first, then revise | — |

ElevenLabs and the Codex CLI are optional ecosystem integrations: the skill works fully without
either (synth score, code-composed rasters).

## Execution Steps

1. Gather optional preferences in ONE grouped interaction (duration, idea, video type, style; `references/intake.md`) — exempt from "one at a time" below, since every question defaults to "decide for me".
2. Resolve the remaining gates; ask one question at a time, only without a default.
3. Extract the brand into `brand.json`, `fonts/`, `brand/logo.svg` (`references/brand-extraction.md`).
4. Storyboard on the grid; get the script table approved; write cues to `timeline.json` (`references/storyboard.md`).
5. `cp -R <skill>/assets/template <out> && cd <out> && npm install`.
6. Replace the demo scenes in `index.html` bar by bar (`references/scene-recipes.md`); check with `npm run stills` (one still per beat).
7. Write `score.mjs` on the same cues (`references/sound-design.md`).
8. Revising existing work: `./archive.sh` first, confirm the printed re-render command.
9. `npm run preview`; review two passes against `references/pitfalls.md`; `lagproof.py` PASSes.
10. `npm run build` until QA passes (`references/qa-checklist.md`); this also produces the web deliverable.
11. `./inspect.sh` independently of the build's own QA, and `./cta-check.sh` on every CTA, before reporting.

## Output Contract

Return the web MP4, master, poster, contact-sheet and `-qa.txt` paths; ffprobe summary; loudness, true peak, flashes, lag-proof result; one line per bar; deviations and why; what was not verified (always whether audio was heard).

## References

- `references/workflow.md` — process, review loop, delegation.
- `references/storyboard.md` — BPM table, templates.
- `references/motion-craft.md` — motion rules.
- `references/scene-recipes.md` — effect code.
- `references/sound-design.md` — score, mix, tracks.
- `references/brand-extraction.md` — brand inputs, marks, claims, CTAs.
- `references/qa-checklist.md` — thresholds, lag proof, determinism.
- `references/pitfalls.md` — failures, fixes.
- `references/generated-assets.md` — raster-asset policy.
- `references/intake.md` — preference intake at invocation.
- `references/device-frames.md` — device bezels: generic/licensed frames vs. official Apple PNGs.
- `assets/template/` — runnable project; `assets/templates/` — brief, review-notes, worker-brief.
