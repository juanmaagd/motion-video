# motion-video

A family of five [Agent Skills](https://agentskills.io) that render short, beat-synced motion-graphics videos
deterministically from HTML/SVG/Canvas code — no timeline editor, no hand-keyframed footage.

## What it does

Given a brief (duration, idea, video type, style), the skills:

- extract a brand's colors, fonts, logo and real copy from its own repo or site;
- storyboard the video on a musical beat grid and get the script approved before building;
- render every frame as a pure `renderAt(t)` function in headless Chromium, with 32-sample motion
  blur on the final pass;
- synthesize a score on the same cues (or use a supplied track / ElevenLabs);
- run automated QA before delivery: loudness (LUFS/true-peak), flash-rate, hit-sync, a "lag proof"
  that catches stepped or frozen motion, and forward/reversed determinism.

Output types: launch videos, promos, teasers, explainers, announcements, showreels, kinetic
typography, social clips, product demos.

## The five skills

| Skill | Role |
|---|---|
| `motion-video` | The director and the entry point: intake, storyboard on the beat grid, project assembly, review loop, delivery. It loads the four skills below when a step needs them. |
| `motion-video-engine` | Scenes and render pipeline: the `renderAt(t)` contract, motion rules, scene recipes, parallel render and encode. |
| `motion-video-sound` | The synthesized score: synth-kit voices, cue-to-sound mapping, mix targets, supplied tracks. |
| `motion-video-qa` | Checks: loudness, true peak, flash rate, sync, lag proof, determinism, CTA verification. `qa.py` verifies a video built by this family; `lagproof.py` and `inspect.sh` also run on any MP4. |
| `motion-video-brand` | Brand inputs: colors, fonts, logo and real copy, third-party marks and licences, device frames, the policy for generated rasters. |

Ask for a video and the director activates. The four siblings are loaded by the director and can also be
invoked directly for questions specific to their area, but making a video always starts with the director.

## Install

```sh
npx skills add juanmaagd/motion-video
```

Install all five: the director builds each video project from files that every skill ships in its own
`assets/project/` folder. When the CLI asks which skills to install, select all of them (or pass
`--skill '*'`).

Manual alternative: copy every folder under `skills/` into your agent's skills directory (e.g.
`~/.claude/skills/` for Claude Code), so the siblings sit next to `motion-video/`.

## Requirements

- Node.js 22+
- Python 3 with `numpy` and `Pillow`
- `ffmpeg` / `ffprobe` on `PATH`
- A Chromium headless shell (`npx playwright install chromium-headless-shell`, or set `CHROME_PATH`)
- Optional: the [Codex CLI](https://developers.openai.com/codex/cli) for decorative raster plates,
  and an [ElevenLabs](https://elevenlabs.io) connection for a synthesized voice/music track — both
  are optional ecosystem integrations; the skills work fully without either.

## Example prompts

- "Make a 15 s launch video for \<product\>."
- "I need a 9:16 social clip announcing our v2 release."
- "Build a product-demo video showing the new dashboard."
- "Turn this changelog into a 10 s announcement teaser."

## What's inside

```
skills/
├── motion-video/          # SKILL.md, workflow/storyboard/intake references, brief templates, package.json + archive.sh
├── motion-video-engine/   # engine.js, render/build/determinism scripts, index.html demo, motion and scene references
├── motion-video-sound/    # synth-kit.mjs, score.mjs, sound-design reference
├── motion-video-qa/       # qa.py, lagproof.py, inspect.sh, cta-check.sh, sheet.py, QA checklist
└── motion-video-brand/    # brand.json, logos.mjs, device-frame tools and SVGs, brand extraction and raster policy
```

## Licence

Apache-2.0. See `LICENSE` (and each skill's own `LICENSE`, which travels with every install).
