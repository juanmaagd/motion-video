---
name: motion-video-brand
description: "Loaded by the `motion-video` director for the brand inputs of a code-driven video: extracting colors, fonts, logo and real copy, third-party marks and their licences, claims and CTA evidence, device frames, and the policy for generated raster plates. Use directly only when the user asks specifically about those brand inputs; not for making a video end to end."
compatibility: "Node.js 22+ (logos.mjs, brandqa.mjs, gen-image.mjs); Python 3 with numpy and Pillow (detect-frame.py, logoqa.py); network access for logos.mjs. Optional, only if used: Codex CLI for decorative raster plates (gen-image.mjs). Runs inside the project assembled by the motion-video director."
license: Apache-2.0
metadata:
  author: "juanmaagd"
  version: "2.0.1"
---

# Motion Video Brand

## Activation Contract

Loaded by `motion-video` for brand extraction, and whenever a scene needs a third-party mark, a device frame or a raster plate. It owns `brand.json`, `logos.mjs`, `detect-frame.py`, `brandqa.mjs`, `logoqa.py`, `gen-image.mjs`, the starter `brand/`, `fonts/` and `generated/` files, and the bundled device frames in `assets/devices/` (never auto-copied).

## Hard Rules

1. Brand rules beat the storyboard: read the brand's bans first. Real evidence only: no invented metrics, customers or claims; keep tested and supported claims apart.
2. Colors keep their role. Keep a mark's fill and the brand's UI accent both exact in `brand.json`.
3. Use the exact logo geometry as shipped; brand fonts stay in the project, never in a skill.
4. Third-party marks come from `logos.mjs`, never redrawn. Read every flagged licence by hand; never assume a licence is open.
5. Never generate a logo, wordmark, type, UI, product screenshot, or anything carrying a claim; `gen-image.mjs` (Codex CLI) makes decorative rasters only, at prep time, graded to brand tokens.
6. Official Apple bezels and Design Resources components never ship in a skill: they stay in the user's library and are used static only.
7. Verify every CTA with `cta-check.sh` before it appears on screen.

## Decision Gates

| Question | Default | Otherwise |
|---|---|---|
| Brand | extract from the repo or site | none: ask once for logo, colors, fonts; else defaults, stated |
| Raster plate/texture/illustration needed | `npm run gen-image` (Codex CLI, optional) | composed in code (default) |
| Third-party mark's licence not open | drop it, ask | user explicitly accepts the risk |
| Device frame needed | generic (`genericDeviceFrame`, animatable) | licensed bundled/user/official bezel, static only (`references/device-frames.md`) |

The Codex CLI is an optional integration: the family works fully without it (code-composed rasters).

## Execution Steps

1. Extract the brand into `brand.json`, `fonts/` and `brand/logo.svg` (`references/brand-extraction.md`); record the brand's bans.
2. Fetch third-party marks with `node logos.mjs <slug>...` and review every licence it flags.
3. Resolve a device frame on demand: copy the file into `brand/devices/` before loading it (`references/device-frames.md`).
4. Generate a raster plate only at prep time, and only if the gate allows it (`references/generated-assets.md`).
5. Expose `window.__logoBox(t)` so `build.mjs` runs the logo-fidelity check (`brandqa.mjs`, `logoqa.py`) on each final.

## Output Contract

Return the `brand.json` summary (colors by role, fonts, logo), the brand's bans, each third-party mark with its licence status, the source of every on-screen claim, any generated asset, and what was not verified.

## References

- `references/brand-extraction.md`: brand inputs, marks, claims, CTAs, adapting the storyboard.
- `references/device-frames.md`: generic and licensed frames versus official Apple PNGs.
- `references/generated-assets.md`: the raster-asset policy.
- `references/pitfalls.md`: font, brand, licence and device-frame failures with their fixes (numbers are shared across the family).
- `assets/devices/`: bundled licensed frames, with provenance in `SOURCES.json`.
