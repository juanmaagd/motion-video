# motion-video project

A short motion-graphics video rendered from code: every frame is `renderAt(t)` in headless Chromium, the soundtrack is synthesized on the same beat grid, and one command builds, encodes and checks it.

## Use

```sh
npm install                      # playwright-core only; browsers come from the Playwright cache or CHROME_PATH
python3 -m pip install -r requirements.txt   # numpy, Pillow (used by qa.py, sheet.py, detect-frame.py, logoqa.py)
npm run stills                   # one still per beat -> out/stills (half size)
npm run studio                   # live preview at http://127.0.0.1:4321: the composition reloads on every save, audio is regenerated from score.mjs
npm run preview                  # fast pass: 1 sample, half size -> out/<slug>-preview.mp4 + contact sheet + QA
npm run build                    # final: 32 motion-blur samples, full size -> <slug>.mp4 + web.mp4 + poster + contact sheet + QA
node build.mjs --slice=3.5:4.5   # final settings on one moment
npm run determinism               # forward vs reversed frame order must render pixel-identical
npm run inspect -- out/<slug>.mp4 8.1 16.2   # spec + loudness + lag proof + labelled tile + waveform/spectrogram
npm run logos -- claude openai deepseek       # fetch official marks + licences into brand/providers/
npm run cta-check -- npm:your-pkg@1.2.0 url:https://example.com git:you/repo   # verify before it's on screen
npm run archive                   # snapshot outputs + source (sans node_modules) into vN/ before a revision
npm run gen-image -- --prompt "..." --name plate1.png --size 1536x1024   # optional: a raster plate/texture via Codex CLI
```

Needs Node 22+, `ffmpeg`/`ffprobe`, `python3` with `numpy` and `Pillow`, and a Chromium headless shell
(`npx playwright install chromium-headless-shell`, or set `CHROME_PATH` to any Chrome/Chromium binary).
`cta-check.sh` also uses `curl` and, optionally, `npm view`/`gh`. `gen-image.mjs` needs the Codex CLI
on `PATH` (`codex --version`) and is entirely optional -- most videos need no generated assets.

## Files

| File | Edit per video? | Role |
|---|---|---|
| `timeline.json` | yes (the studio's Tweak tab edits cue `beat`/`hit`) | fps, width, height, duration, bpm, loudness targets, `holds`/`lagThreshold`/`lagProofEnd` (lag proof), `pictureSyncWindow`, `webSizeBudget`/`webCrf`, and named cues on the beat grid (`hit: true` = sync-checked). |
| `brand.json` | yes (the Tweak tab edits colors, copy, name, wordmark) | colors by role, font files in `fonts/`, logo in `brand/`, copy strings, optional `colorProbes` (qa.py colour decode). Missing files fall back to system fonts and a disc mark. |
| `index.html` | yes | the scenes. Each scene is `{ init(app), render(t) }`; `render` depends on `t` only. The demo shows a title slam (with an anticipation ring before the drop), a door match-cut into a kinetic list (headline via `engine.js`'s sequencer), and a logo lockup; a never-parked camera track and canvas grain run underneath. |
| `score.mjs` | yes | the soundtrack arrangement: synth-kit voices placed on cues. |
| `engine.js` | no | easing kit, spring/punch/pchip, a never-parked camera track, a headline sequencer, an anticipation ring, a feathered radial-mask reveal, a fill/outline crossfade, canvas grain, hashed RNG, decode text, camera shake, particle burst, DOM and layout helpers. |
| `synth-kit.mjs` | no | voices, buses, sidechain, tape stop, reverb, loudness-normalized master, WAV writer. |
| `render.mjs` | no | stills (`--times`, `--beats`, `--strip=t:n`) and motion-blurred video in parallel workers (CDP `optimizeForSpeed` capture). |
| `build.mjs` | no | score -> render -> encode (BT.709, frames re-timed by index) -> poster -> contact sheet -> web encode (size-budgeted) -> QA (incl. logo fidelity when the composition supports it). |
| `qa.py`, `sheet.py` | no | spec, loudness, sync, flash, colour-decode and lag-proof checks (exit 1 on failure); contact sheets. |
| `lagproof.py` | no | the lag proof standalone (also imported by `qa.py`): no run of stepped/frozen frames outside a declared hold. |
| `brandqa.mjs`, `logoqa.py` | no | logo fidelity: render the shipped `brand.logo` at the box `window.__logoBox(t)` reports, diff it against a poster frame. |
| `inspect.sh` | no | one-shot spec + loudness + lag proof + labelled frame tile + waveform/spectrogram for any video. |
| `logos.mjs` | no | fetch official provider marks by slug (thesvg.org), record licences in `brand/providers/SOURCES.json`, flag non-open ones. |
| `cta-check.sh` | no | verify an npm dist-tag, a URL, or a GitHub repo before it appears on screen. |
| `archive.sh` | no | snapshot outputs + source (sans `node_modules`) into `vN/` before a revision. |
| `determinism.mjs` | no | forward vs reversed frame-order capture must be pixel-identical. |
| `serve.mjs` | no | the static file server behind `render.mjs` and `determinism.mjs`: GET/HEAD only, contained to this folder by real path (no `..`, no symlink out), no dotfiles or `node_modules`. |
| `feedback.json` | working file | the review notes made by clicking the frame in the studio (`npm run studio`): time, scene, element, point and text per note, each `open`, `resolved` or `wontfix` with a one-line `resolution`. Created on the first note. Keep it out of git; `archive.sh` copies it into `vN/src/`. |
| `studio.mjs`, `studio.html` | no | the live preview: a 127.0.0.1-only server (per-run token, Host and Origin checks on every write) that watches this folder, pushes reloads over server-sent events (holding one back and naming the file and line when a `.html`, `.js` or `.mjs` file has a syntax error), regenerates the audio from `score.mjs`, keeps the review notes, and applies the Tweak tab's edits (`POST /api/tweak`: cue beat and hit, brand colours, copy, name and wordmark, nothing else); plus the page it serves. |
| `gen-image.mjs` | no | optional: one raster plate/texture via the Codex CLI's own built-in image tool, no fallback; records `generated/manifest.json`. |
| `generated/` | maybe | `manifest.json` (empty by default) + any files `gen-image.mjs` writes. |

Open a single frame in a browser: `npm run studio` and load `http://127.0.0.1:4321/?t=2.3` (Chrome or Chromium; `?loop=2:4` loops a range).
