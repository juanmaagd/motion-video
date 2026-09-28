# motion-video

An [Agent Skill](https://agentskills.io) that renders short, beat-synced motion-graphics videos
deterministically from HTML/SVG/Canvas code — no timeline editor, no hand-keyframed footage.

## What it does

Given a brief (duration, idea, video type, style), the skill:

- extracts a brand's colors, fonts, logo and real copy from its own repo or site;
- storyboards the video on a musical beat grid and gets the script approved before building;
- renders every frame as a pure `renderAt(t)` function in headless Chromium, with 32-sample motion
  blur on the final pass;
- synthesizes a score on the same cues (or uses a supplied track / ElevenLabs);
- runs automated QA before delivery: loudness (LUFS/true-peak), flash-rate, hit-sync, a "lag proof"
  that catches stepped or frozen motion, and forward/reversed determinism.

Output types: launch videos, promos, teasers, explainers, announcements, showreels, kinetic
typography, social clips, product demos.

## Install

```sh
npx skills add juanmaagd/motion-video
```

Manual alternative: copy `skills/motion-video/` into your agent's skills directory (e.g.
`~/.claude/skills/motion-video/` for Claude Code).

## Requirements

- Node.js 22+
- Python 3 with `numpy` and `Pillow`
- `ffmpeg` / `ffprobe` on `PATH`
- A Chromium headless shell (`npx playwright install chromium-headless-shell`, or set `CHROME_PATH`)
- Optional: the [Codex CLI](https://developers.openai.com/codex/cli) for decorative raster plates,
  and an [ElevenLabs](https://elevenlabs.io) connection for a synthesized voice/music track — both
  are optional ecosystem integrations; the skill works fully without either.

## Example prompts

- "Make a 15 s launch video for \<product\>."
- "I need a 9:16 social clip announcing our v2 release."
- "Build a product-demo video showing the new dashboard."
- "Turn this changelog into a 10 s announcement teaser."

## What's inside

```
skills/motion-video/
├── SKILL.md                 # activation contract, decision gates, execution steps
├── assets/
│   ├── template/             # the runnable project: engine, renderer, encoder, QA scripts
│   └── templates/            # brief, worker-brief and review-notes templates
└── references/                # brand extraction, storyboard grid, scene recipes, sound design,
                                # QA checklist, pitfalls, device frames, and more
```

## Licence

Apache-2.0. See `LICENSE` (and `skills/motion-video/LICENSE`, which travels with every install).
