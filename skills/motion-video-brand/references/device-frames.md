# Device frames

Two different mechanisms — pick by what the frame actually IS, never mix them up:

| Frame is... | Mechanism | Movement |
|---|---|---|
| A parametric shape, or a licensed SVG export (generic, or a bundled/user-library frame) | `genericDeviceFrame()` / `loadDeviceSVG()` + `deviceFrameShot()` (`engine.js`) | Freely animatable |
| An official Apple bezel — one opaque PNG with a transparent screen hole | `detect-frame.py` + `loadDeviceFrame()` + `officialDeviceShot()` (`engine.js`) | Static only (Apple's rule, below) |

## Apple's rules (cited)

**App Store Marketing Guidelines** (developer.apple.com/app-store/marketing/guidelines, "Apple Product
Images", fetched 2026-09-28): official bezels used "as is and without modification" — no animating,
flipping, spinning, tilting, cropping, obstructing, shadows/reflections/highlights, or elements
entering/leaving the screen; no 3D rendering or "any simulation of an Apple product"; a **generic**
device must not carry Apple-unique details (Home button, sensor housing, Ring/Silent switch, volume
controls); screen content = the app as it runs, fictional account data, full status bar icons.

**Apple Design Resources licence** (read from the TEXT resource embedded in Bezel-iPhone-18.dmg via
`hdiutil udifderez`, without mounting or accepting it): 2A "solely for creating mock-ups of user
interfaces designed for use in software products that run only on Apple's ... operating system
software"; 2B "You may not embed the Apple Design Resources in any software programs or other
products" and may not "sublicense or otherwise redistribute"; 2C Template Content may not be
"extracted, copied, modified, distributed, or repackaged as content, clip art"; 3 components "may
not be separated from the bundle and distributed on a standalone basis".

**Consequence:** an official Apple bezel PNG and any Apple Design Resources UI component (status
bar, keyboard, notification banner, ...) never enter this skill and are never redistributed by it.
The user downloads them once from developer.apple.com/design/resources, accepts Apple's licence
themselves, and keeps them in a library the tools find automatically (below). Never download, mount
or auto-accept Apple's DMG in any script.

**Cross-platform scope.** 2A limits use to mock-ups for software that runs ONLY on an Apple OS. A
cross-platform product (iOS + Android, or a web app) is out of scope for the official bezel — use
`genericDeviceFrame()` for that shot instead.

## Where device assets live (search this order)

1. **Bundled in the skill:** `assets/devices/` — SVG frames whose licence was explicitly checked and
   confirmed before bundling (currently `iphone-frame.svg`, `macbook-frame.svg`; provenance in
   `assets/devices/SOURCES.json`: `file`, `sourceUrl`, `license`, `author`). These are the ONLY
   device assets that ship inside the skill — an official Apple bezel PNG is never listed here.
2. **User library, outside the skill:** `$MOTION_VIDEO_ASSETS/devices/` (default `~/.motion-video-assets/devices/`) —
   the user's own official Apple bezel PNGs, plus any additional community SVG frames they keep across projects.
3. **Project-local:** `brand/devices/` in the video project — drop a PNG or SVG there for one
   project only (`brand/devices/README.txt`).
4. **Generic frame:** `genericDeviceFrame()` (engine.js) — always available, no lookup needed, and
   the only option that is both freely animatable and never depends on an external file.

`render.mjs`'s local server only serves files under the project root, so `loadDeviceSVG()`/
`loadDeviceFrame()` can only `fetch()` a project-local path — the same constraint as brand fonts and
logos. Resolve the frame by checking 1-3 in order, then COPY the file you find into the project
(`brand/devices/<name>.{svg,png}`) before calling either loader; nothing here reads outside the
project at render time.

## Apple Design Resources UI components (status bar, keyboard, notification banner, ...)

Beyond full device bezels, developer.apple.com/design/resources also publishes individual UI
components (status bar, keyboard, notification banner, home indicator, ...) as separate exports.
Same rule, same library: the user keeps their own exports in `$MOTION_VIDEO_ASSETS/apple/` (default `~/.motion-video-assets/apple/`)
and drops the ones a project needs into `brand/devices/` (or directly into the project) before the
build; this skill never bundles or fetches them. Use them as ordinary static `<img>` layers stacked
into a product-demo UI mock (the "Product demo" recipe in `scene-recipes.md`, in the `motion-video-engine` skill) — e.g. an
official status-bar PNG pinned to the top of the mock's screen area, above the app content and
below any device-frame overlay. Scope is the same as the bezel licence: 2A, mock-ups for software
that runs only on an Apple OS; never bundle or redistribute the exported PNGs themselves.

## The layered SVG contract

A frame SVG — generic or a licensed bundled/user-library export — declares three layers by id:

```html
<g id="body">...</g>                    <!-- drawn first: the device chrome (opaque) -->
<rect id="screen" fill="none" .../>      <!-- or a <path>: screen geometry only, never rendered -->
<g id="overlay">...</g>                 <!-- drawn last: Dynamic Island / camera / notch, ON TOP -->
```

`loadDeviceSVG(url)` fetches and validates this (throws if `#body`/`#screen` is missing).
`genericDeviceFrame(opts)` builds the same shape in-memory (no fetch) — both feed the same
`deviceFrameShot(parent, frameDoc, screenContentEl, { recolor })`, which composites body → content
(clipped to `#screen`'s exact shape via a real `<clipPath>`, so a `<path>` screen like the bundled
MacBook frame's clips as precisely as a rounded `<rect>`) → overlay, and returns a plain animatable
`{ el, screen }`. Recolour the body's fills (e.g. `"silver"`, `"#2b2b2b"`) with `recolor`; never
recolour a bundled/user frame's `#overlay` (the notch/Dynamic Island reads wrong in a color that
doesn't match a real device).

```js
const frame = K.genericDeviceFrame({ w: 375, h: 812, color: brand.colors.ink });
// or: const frame = await K.loadDeviceSVG("brand/devices/iphone-frame.svg");
const shot = K.deviceFrameShot(cam, frame, screenContentEl, { recolor: "silver" });
// in render(t): tf(shot.el, x, y, scale, rotation);  -- freely animatable, both cases
```

## Official Apple bezel PNG (`detect-frame.py`)

An official export is one opaque PNG with a transparent screen hole — not the layered contract
above. `detect-frame.py` finds that hole from the alpha channel (specifically the transparent
region ENCLOSED by opaque pixels, never the transparency touching the image border, which is just
the bezel's own rounded outer corners) and writes a JSON sidecar:

```sh
python3 detect-frame.py brand/devices/iphone-official.png \
  [--source-url URL --license "..." --author NAME]   # optional: records brand/devices/SOURCES.json
```

FAILs loudly (exit 1) on a PNG with no enclosed transparent region — a flattened marketing shot or
a solid product photo has nothing to detect, and a sidecar with a zero/missing rect would silently
break every screen-content placement downstream (pitfall 61, in the `pitfalls.md` of the
`motion-video-qa` skill: a verifier that checked nothing must FAIL).

```js
const frame = await K.loadDeviceFrame("brand/devices/iphone-official.png.json");
const shot = K.officialDeviceShot(cam, frame, screenContentEl);
// in render(t): shot.render(t >= C.reveal && t < C.cutaway);  -- hard show/hide ONLY, never a transform
```

## Screen content

- **Real screenshots:** a static image per beat, swapped by cue (no motion inside the screen beyond
  what the real screenshots show).
- **A screen recording, pre-extracted:** `ffmpeg -i recording.mp4 -vf fps=<fps> frames/%05d.png` at
  prep time, then `K.screenFrame(framesDir, count, fps)` picks a frame index from `t` deterministically
  (never a live `<video>` element — not synchronously seekable frame-by-frame under parallel/
  out-of-order capture, the same class of problem `createGrain`'s WHY-comment warns about for CSS
  blend modes).
- **Status bar and data:** show the full status bar (all icons, real-looking time), and only
  fictional/placeholder account data — never a real person's data, per Apple's screen-content rule
  above; the same "real evidence only" bar applies to anything that reads as a claim on screen
  (`references/brand-extraction.md`).

## Self-contained

Every reference in this file resolves to either a public URL (developer.apple.com) or a path on the
user's own machine (`$MOTION_VIDEO_ASSETS/...`, default `~/.motion-video-assets/`, or the project's `brand/devices/`) — never
a skill outside the motion-video family (the `motion-video-*` siblings named in this file).
