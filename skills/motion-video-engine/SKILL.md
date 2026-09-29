---
name: motion-video-engine
description: "Loaded by the `motion-video` director for the render engine of a code-driven video: the renderAt(t) scene contract, easing, timing and camera rules, scene recipes, and the deterministic render and encode pipeline with its pitfalls. Use directly only when the user asks specifically about that engine, its scenes or its render pipeline; not for making a video end to end."
compatibility: "Node.js 22+; ffmpeg and ffprobe on PATH; a Playwright Chromium headless shell (npx playwright install chromium-headless-shell, or set CHROME_PATH). Runs inside the project assembled by the motion-video director: build.mjs also calls the score (motion-video-sound) and QA (motion-video-qa) files."
license: Apache-2.0
metadata:
  author: "juanmaagd"
  version: "2.0"
---

# Motion Video Engine

## Activation Contract

Loaded by `motion-video` when the project is assembled and while scenes are written, previewed and rendered. It owns the project files `index.html`, `engine.js`, `render.mjs`, `build.mjs`, `determinism.mjs`, `serve.mjs`, `studio.mjs`, `studio.html` and `timeline.json` (their `assets/project/` folder is copied into the video project).

## Hard Rules

1. Every frame is `renderAt(t)`, a pure function of time: no CSS animation, rAF state, `Math.random`, or network/generation calls inside a scene.
2. Never composite a layer with a CSS blend mode. Prove any new canvas, filter or shared-state layer with `npm run determinism` (forward and reversed capture must be pixel-identical).
3. Duration is whole bars (`bpm = 240 × bars / duration`); every cue lives in `timeline.json`, and no time is hard-coded in a scene.
4. Motion is never stepped or parked: no quantized position or scale, a camera track under the whole film, and no still run except a declared hold of at most 0.3 s with something still moving.
5. Tool files (`engine.js`, `render.mjs`, `build.mjs`, `determinism.mjs`, `serve.mjs`, `studio.mjs`, `studio.html`) stay untouched per video; a video edits `index.html` and `timeline.json`.
6. Final renders use 32 motion-blur samples (`--sub=32`); previews use 1.
7. Fonts are loaded before any scene `init`; text is measured there and positions are derived from it.

## Execution Steps

1. Work only in the assembled project, never in a skill folder.
2. Set fps, size, duration, bpm and the cues in `timeline.json` from the approved storyboard.
3. Replace the demo scenes in `index.html` bar by bar, each scene `{ init(app), render(t) }` (`references/scene-recipes.md`, `references/motion-craft.md`).
4. Check the moment being worked on: `node render.mjs stills --times=1.2,1.9 --scale=0.5`; the whole piece with `npm run stills`; a transition with `--strip=1.80:12 --out=out/strip`.
5. `npm run preview` (1 sample, half size), then `npm run build` (32 samples, full size; QA runs inside it). Budget: about 13 s of wall time per rendered second of 1080p60 on 8 workers.
6. Run `npm run determinism` after any canvas, SVG-filter or shared-state change.
7. Check `references/pitfalls.md` at every review pass.

## Output Contract

Return, per bar, what was built; the render commands run and their wall time; the frame count; deviations from the storyboard and why; which pitfalls were checked.

## References

- `references/motion-craft.md`: easing, timing, camera, type, motion blur, color and composition rules.
- `references/scene-recipes.md`: effect code against `engine.js`.
- `references/pitfalls.md`: render, picture and motion failures with their fixes (numbers are shared across the family).
