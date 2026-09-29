# Generated raster assets

Optional and self-contained: this template does not depend on any other skill at runtime. Most
videos need zero generated images -- everything else is `renderAt(t)` code, brand SVGs, and real
evidence. Reach for `gen-image.mjs` only when a scene genuinely needs a raster background plate, a
texture, an illustrative cut-out, or a styleframe to approve a look before building it in code.

## When to generate, when not to

| Need | Generate? |
|---|---|
| Background plate, texture, abstract illustration, styleframe to approve a direction | Yes |
| Illustrative cut-out for a parallax layer (a character, an object, a decorative shape) | Yes, with `--transparent` |
| A logo, wordmark, or any brand mark | No -- brand SVGs only (`references/brand-extraction.md`); a generator will not reproduce exact geometry |
| Type, captions, labels, UI chrome, a product screenshot | No -- these are HTML/SVG in the composition (`engine.js`), never baked into a raster |
| Anything that carries a claim (a number, a quote, a screenshot standing in for real evidence) | No -- see `references/brand-extraction.md`'s "real evidence only" rule; a generated image cannot be a source |

## The mechanism (`gen-image.mjs`)

```sh
node gen-image.mjs (--prompt TEXT | --prompt-file FILE) --name plate1.png \
  [--size 1024x1024|1536x1024|1024x1536] [--transparent] [--scene "act2 background"]
```

Under the hood it shells out to the Codex CLI's own built-in image tool -- no API key, SDK, script,
curl, Python, or web service of any kind:

```sh
codex exec --skip-git-repo-check --ephemeral -s workspace-write -C generated/ \
  -o "<name>.codex.txt" "<guarded instruction>"
```

The instruction tells Codex to use ONLY its built-in image tool, to stop and say so if that tool is
unavailable, to render `<square 1024x1024 | landscape 1536x1024 | portrait 1024x1536>` at
`<opaque | fully transparent>` background, and to copy the final PNG into the working directory
(`-C generated/`, since Codex renders into `~/.codex/generated_images/<session>/...` first). Every
prompt gets a fixed suffix banning text, letters, numbers, logos, wordmarks and watermarks in the
image -- type is set in HTML/SVG, never baked into a raster.

**No fallback.** If `codex` is not on `PATH`, if `codex exec` fails, if the PNG never lands, or if
`file --mime-type` does not say `image/png`, `gen-image.mjs` exits 1 and names the `.codex.log` to
read -- it never substitutes another provider, script, or API. Build the element in code instead
(a gradient, a canvas pattern, an SVG shape).

## Resolution: 1536 px is a plate, not a frame

The largest size (`1536x1024` / `1024x1536`) is well under 1080p, nowhere near 4K. Never show a
generated image full-frame at 1:1 zoom -- upscaling artifacts and soft detail read immediately at
full size. Instead:

- Blur it (a background plate behind sharp foreground type reads as intentional, not low-res).
- Add grain over it (`createGrain`, `engine.js`) -- grain masks resampling artifacts and unifies it
  with the rest of the frame's texture.
- Duotone or tint it to the brand's palette (`duotoneFilter`/`tintFilter`, `engine.js`) -- flattens
  detail into two tones, which also solves the colour-matching problem below.
- Frame it partially (crop into it, pan across it, or let it fill a fraction of the frame) rather
  than presenting the whole plate edge-to-edge.

## Transparent cut-outs for parallax

Pass `--transparent` for anything meant to sit as its own layer over other content (a decorative
shape, an illustrated object) instead of a full background. A transparent PNG composites into a
parallax stack (`zoomAbout`, per-layer scale) the same way a hand-drawn SVG layer would.

## Generate at prep time, never at render time

Generation happens once, by hand, before scenes are wired up -- into `generated/<name>.png`,
recorded in `generated/manifest.json`. `render.mjs`/`build.mjs` never call `gen-image.mjs`: every
frame must stay `renderAt(t)`, a pure function of time with no network calls, no subprocess, and no
non-determinism (the same rule that keeps `Math.random` out of scenes, `engine.js`'s opening
comment). A generated PNG is just another static asset by the time a render runs -- and one Codex
run takes roughly a minute, far too slow to sit inside a per-frame render loop regardless.

## Grade to brand tokens; never trust the generator's colours

A generator will not hit your brand's exact hex values. Grade every generated plate to
`brand.json`'s own colors in the composition -- `duotoneFilter(defs, id, brand.colors.ink,
brand.colors.bg)` (two-tone) or `tintFilter(defs, id, brand.colors.accent)` (single-colour tint),
both in `engine.js`. Treat the raw generated PNG as a luminance/shape source only, exactly the way a
photograph would be treated in a print duotone.

## The manifest

`generated/manifest.json` starts as an empty `assets` list. `gen-image.mjs` appends one entry per
file automatically:

```json
{ "file": "generated/plate1.png", "prompt": "... (with the no-text/no-logo suffix)", "size": "1536x1024", "transparent": false, "scene": "act2 background", "date": "2026-09-27", "tool": "codex-cli 0.157.0" }
```

View every generated image before wiring it in; regenerate at most once with a targeted prompt
change rather than looping indefinitely on a prompt that will not converge.

## Recording the brief

Log what was generated, and why, in the "Generated assets" section of `assets/templates/brief.md`
(in the `motion-video` skill) (scene, purpose, prompt, size, transparent) before wiring an asset into a scene -- the same
approval-before-building discipline as the script table.
