# Scene recipes

Code-level recipes proven in two production showreels, written against
`engine.js` (`import * as K from "./engine.js"; const { E, prog, lerp, clamp, h, s, show, px, tf, zoomAbout } = K;`).
Each scene is `{ init(app), render(t) }`; `C` is the cue map, `W`/`H` the frame, `F = app.frame`.

## Never-parked camera track

Foundational, not a single beat: one continuous drift under the whole film so the lag proof never
sees a truly parked frame, and so camera moves read as one push instead of a series of static shots.

```js
const camera = K.cameraTrack([        // [t, x, y, zoom] keys; zoom interpolated in log space
  [0, 0, 0, 1], [C.reveal, 40, -20, 1.3], [C.mechanism, -80, 30, 2.1], [tl.DUR, 0, 0, 1],
]);
await K.run(app, scenes, { shakes, camera, post: (t) => grain.render(t) });
```
`cameraTrack`'s `pchip` extrapolates at the end slopes instead of flattening: there is no key value
you can pick that leaves the camera dead-stopped before the first or after the last keyframe. For a
subtle "never truly still" drift (as opposed to a real establishing move), keep `zoom` at `1` in
every key — the track then reduces to a small continuous x/y wander with no re-centring maths needed.

## Canvas grain, over everything

```js
const grainCanvas = h("canvas", { width: W, height: H, class: "abs shot", style: { pointerEvents: "none" } }, app.stage);
const grain = K.createGrain(grainCanvas, W, H, FPS);
// pass post: (t) => grain.render(t) to K.run (see above) -- drawn last, composited normally
```
Never `mix-blend-mode` this layer (pitfall 52): draw it with plain canvas compositing. Verify
with `node determinism.mjs` after adding any new canvas/filter layer, not just this one.

## Title slam on a hairline

The line is the mask edge: words rise out of it on the beats; stressed words punch through variable-font axes.

```js
// init: clip box ending exactly on the line; head fitted to the column
this.clip = h("div", { class: "abs", style: { overflow: "hidden", left: px(F.x0), width: px(F.cw + 40) } }, el);
this.head = h("div", { class: "abs nowrap", style: { lineHeight: 1 } }, this.clip);
this.fs = K.fitFont(this.head, F.cw);
const base = K.baselineOf(this.head), boxH = Math.ceil(this.fs * 1.25);
this.clip.style.top = px(F.cy - boxH); this.clip.style.height = px(boxH);
this.head.style.top = px(boxH - this.fs * 0.235 - base);          // descenders clear the line
// render: per word i with cue c
const up = E.outExpo(prog(t, c, 0.5)), down = E.inCubic(prog(t, C.collapse + (n - 1 - i) * 0.014, 0.1));
word.style.transform = `translateY(${((1 - up) + down) * boxH * 1.05}px)`;
word.style.fontVariationSettings = `"wght" ${lerp(900, 600, E.outCubic(prog(t, c, 0.6)))}, "wdth" ${lerp(125, 100, E.outCubic(prog(t, c, 0.6)))}`;
```
Then the line: point → full width (`outExpo`, 0.55 s) → a small "gulp" as words fold in → `rotate(90 * E.outBack(prog(t, C.turn, 0.17), 1.3))`. Finish the collapse before the rotation starts, then hold 3–6 frames.

## Headline sequencer with the readable-time guard

For any headline-shaped text that is not the bespoke title-slam-on-a-line above: single uniform
weight, or mixed weight via `[[word, weight], ...]` (the same shape `brand.json`'s `copy.headline`
already uses).

```js
const h1 = K.makeHeadline(el, "Built for the beat.", { size: fsT, weight: 600 });   // plain string
const h2 = K.makeHeadline(el, [["Same", 400], ["hunt.", 700]], { size: fsT });      // mixed weight
Object.assign(h1.el.style, { left: px(F.x0), top: px(top), width: px(F.cw) });
// render(t, tIn, tOut): tOut defaults to Infinity (stays until the scene itself hides it)
h1.render(t, C.drop + 0.12, C.lock - 0.3);
// chaining two headlines so the second NEVER starts entering before the first finishes exiting:
const xa = h1.exitAt(C.drop + 0.12, C.lock - 0.3);
h2.render(t, xa + h1.exitDur, C.next);
```
The guard (≥ 1.3 s readable for ≥ 5 words, ≥ 0.8 s otherwise) is automatic; if it clamps your
intended timing, that is the signal to add a whole bar of air, not to fight the guard.

## Match cut through the mark (inside the mark → the world)

The dark opening is the inside of a giant mark; its slot is the hairline. On the drop the mark zooms out to logo size and the world appears around it. The mark below is a split disc (circle + centered slot); adapt the path builder to any mark with a gap.

```js
function setMark(m, cx, cy, D, gap, open = 0) {            // m = { g, L, R } paths, ink fill
  const R = D / 2, g = gap / 2 - 0.6 * (1 - clamp(gap / 1.2)); // overlap when closed: no AA seam
  const hh = Math.sqrt(Math.max(R * R - g * g, 0)), big = g < 0 ? 1 : 0;
  m.L.setAttribute("d", `M${-g} ${-hh}A${R} ${R} 0 ${big} 0 ${-g} ${hh}Z`);
  m.R.setAttribute("d", `M${g} ${-hh}A${R} ${R} 0 ${big} 1 ${g} ${hh}Z`);
  m.L.setAttribute("transform", `translate(${-open} 0)`); m.R.setAttribute("transform", `translate(${open} 0)`);
  m.g.setAttribute("transform", `translate(${cx} ${cy})`);
}
// render: D from just covering the frame to rest size, starting at full speed
const pz = K.punch(t - C.drop, 1.35, 0.5);
const D = K.lerpLog(Math.hypot(W, H) * 1.05, restD, pz);
const gap = lerp(2, 0.1 * D, E.outCubic(prog(t, C.drop, 0.3)));   // the 2 px hairline becomes the slot
setMark(mark, W / 2, H / 2, D, gap);
```
The previous shot must end with the same picture: ink field with a vertical 2 px line at the slot's x. Without a slotted mark use doors: two ink panels whose gap grows from 2 px to `W` with `punch` (template demo).

## Feathered radial-mask reveal

A rectangular quadrant clip on a filled shape leaves a hard notch at the hub; mask the clipped group
instead so the wipe fades out smoothly toward the centre.

```js
const mask = K.radialFeatherMask(defs, "armMask", hubX, hubY, 80, { x: bb.x, y: bb.y, w: bb.w, h: bb.h, pad: 20 });
const armsG = s("g", { mask: `url(#${mask.id})` }, parent);   // every quadrant-clipped arm goes inside armsG
```
Tune the feather by passing custom `stops` (default keeps the hub itself opaque, feathers from 0.16
to 0.34 of `radius`) if the notch still shows at the very centre.

## Whip through a point

```js
const pw = prog(t, C.whip - 0.15, 0.32);                 // fastest around the beat
const k = Math.exp(Math.log(90) * E.inOutExpo(pw));
const sx = lerp(target.x, W / 2, E.inOutCubic(pw));      // pan the target to frame centre
shotA.style.transform = `translate(${sx - k * target.x}px,${target.y - k * target.y}px) scale(${k})`;
// incoming shot, visible from C.whip + 0.03, grows out of the centre
const kin = K.lerpLog(0.42, 1, E.outExpo(prog(t, C.whip + 0.03, 0.6)));
```
Zoom into empty paper (a slot, the inside of a ring), never into a stroke, and fade the old shot over its last 3 frames so the hit frame is clean.

## Pull back into a grid cell, then a cascade

```js
// the old full frame (centre 960,540) must land inside cell centre (cx, cy) at scale 0.1
const Fx = (cx - 0.1 * W / 2) / 0.9, Fy = (cy - 0.1 * H / 2) / 0.9;
const k = Math.exp(Math.log(0.1) * E.inOutExpo(prog(t, C.wall - 0.06, 0.4)));
zoomAbout(oldShot, k, Fx, Fy);            // shrinks into the cell
zoomAbout(grid, k * 10, Fx, Fy);          // same camera: grid starts 10x, lands at 1x
// each cell resolves on a wave from the origin cell
const resolveAt = C.wall + 0.3 + Math.hypot(col - col0, row - row0) * 0.075 + K.hash(i, 3) * 0.05;
```
Flatten any 3D tilt of the old shot during the pull-back; draw grid lines outward from the origin cell.

## Kinetic list

```js
// height follows the rows on a spring; the list stays centred
let hgt = 0; cues.forEach((c) => { hgt += rh * clamp(K.spring(t - c + 0.08, 2.6, 0.78), 0, 1.04); });
box.style.top = px(F.cy - hgt / 2);
// per row (overflow hidden): starts 60 ms early so the text is readable on the beat
const d = t - cue + 0.06;
row.style.opacity = E.outCubic(prog(d, 0, 0.12));
text.style.transform = `translateY(${(1 - E.outExpo(prog(d, 0.03, 0.55))) * rh}px)`;
ring.setAttribute("stroke-dashoffset", 1 - E.outCubic(prog(d, 0.02, 0.28)));   // ICON.pass
tick.setAttribute("stroke-dashoffset", 1 - E.outCubic(prog(d, 0.14, 0.2)));
```
A refusal row: wash width `W * E.soft(prog(d, 0, 0.36))`, icon `spring` pop, 8 frames of glitch (`frameOf` indexed scramble + x offsets `[18, -12, 7, -4, 2, 0, 0, 0]`). On exit fade the passing rows fast (`outCubic`, 0.11 s) so nothing slides over the frame's labels.

## Anticipation before a hit

A static hold right before a drop looks dead. Close a hairline ring onto the hit point instead, with
a small deterministic tremble and swell on the target itself so even this "still" beat has motion.

```js
const ring = K.anticipationRing(svg, { color: col.bg, startRadius: Math.hypot(W, H) * 0.5 });
// render(t, tStart, tHit, [x, y], radius?) -- returns the anticipation progress 0..1
const a = ring.render(t, C.anticipate, C.drop, [px, py]);
const [dx, dy] = K.tremble(t, 5, a);              // feed the same progress into the target's wobble
dot.setAttribute("cx", px + dx); dot.setAttribute("cy", py + dy);
dot.setAttribute("r", baseR + 3 * a);              // brightness/size swell as anticipation builds
```

## Gate slam and shatter

```js
// halves come in from off-frame and meet as a perfect disc (gap 0), one rebound, then recoil
let open, gap = 0;
if (d < 0) open = lerp(1060, 0, E.inCubic(prog(t, C.slam - 0.11, 0.11)));
else open = d < 0.13 ? 11 * Math.sin(Math.PI * d / 0.13) * Math.exp(-6 * d) : 0;
if (t > C.reopen) gap = 0.1 * D * K.spring(t - C.reopen, 2.4, 0.55);   // slot comes back
const rec = K.spring(d - 0.03, 1.35, 0.72);                             // recoil to rest size/place
// burst from the crushed element's rect, drawn on a top canvas
const parts = K.makeBurst(560, [x, y, w, h]);          // init
K.drawBurst(ctx, parts, t - C.slam, { colors: [alert, ink] });   // render (clear first)
```
Close a gate by bringing semicircles together, never by sliding chord-cut halves (that makes a pointed "lemon").

## Lock-on, rack focus, speed ramp

```js
const bp = E.outBack(prog(t, C.lock, 0.3), 1.6), m = lerp(70, 12, bp), arm = 24;   // bracket margin
// four L paths around the target rect; others dim and blur
other.style.opacity = lerp(1, 0.18, E.outCubic(prog(t, C.lock, 0.3)));
other.style.filter = `blur(${2.4 * E.outCubic(prog(t, C.lock, 0.3))}px)`;
// time remap: local clock slows to 25% after the ramp cue (pair with a tape stop in the score)
const tLocal = t < C.ramp ? t : C.ramp + (t - C.ramp) * 0.25;
```
Then a slow push (`1 + 0.07 * inOutSine`) and an `inExpo` dive into the target that lands on the next downbeat.

## 3D flip with a size change

Card (front) → phone (back) over 0.44 s: `rotateY(-180 * inOutCubic)`, lift `translateZ(sin(π p) * 90)`, and the box size morphs mostly around 90° where it is edge-on (`inOutQuart` of `(p - 0.25) / 0.5`). Each face is laid out at its own size and scaled to the box (front `scale(w/cardW, h/cardH)`, back `rotateY(180deg)` + `scale(w/phoneW, h/phoneH)`). Enable `perspective`, `preserve-3d` and `backface-visibility` only while `0 < p < 1`; outside the flip use plain 2D transforms or text renders soft.

## Decode text

```js
label.textContent = K.decode("SETTLED · BASE SEPOLIA", prog(t, C.pay + 0.1, 0.24), 45, t, FPS);
```
Monospace only; ≤ 0.25 s; done ≥ 0.3 s before the element leaves.

## Wordmark out of the mark

```js
const slide = E.outExpo(prog(t, C.wordmark, 0.85));
const cx = lerp(W / 2, restX, slide);                    // mark moves aside
const edge = cx + markW / 2 + 0.5;                        // clip starts at the mark's right edge
clipRect.setAttribute("x", edge);
wordmark.setAttribute("transform", `translate(${lerp(W / 2 - wordmarkRight, 0, slide)} 0)`);  // counter-slide
```
The letters appear to be pulled out of the mark. Clip-only reveals expose the far end of the word before the mark moves.

## Fill/outline crossfade reveal

An opacity crossfade of a large bright shape passes through a flat grey panel. Crossfade a FILL
group against a matching OUTLINE group of the same paths instead, optionally combined with a
growing radial mask so the fill floods outward from one point rather than fading in everywhere.

```js
const cf = K.fillOutlineCrossfade(parent, markPaths, { fill: col.ink, stroke: col.ink, strokeWidth: 1.6 });
const flood = K.radialFeatherMask(defs, "flood", hubX, hubY, 4, bbox, [[0, "#fff"], [0.8, "#fff"], [1, "#000"]]);
// render(t): the fill floods outward from the hub over ~5 frames while the outline fades out over
// the same window -- once the flood finishes, drop the mask (it has done its job).
const fp = prog(t, C.final, 5 / FPS);
cf.render(1);                                 // fill fully opaque; the mask is what reveals it
K.set(flood.grad, { r: 4 + 86 * E.outCubic(fp) });
if (fp < 1) cf.fillG.setAttribute("mask", `url(#${flood.id})`);
else cf.fillG.removeAttribute("mask");
cf.outlineG.setAttribute("opacity", 1 - fp);
```

## Implode into the final mark (land large, then settle)

The hero hit lands LARGE (≈ 60–65% of frame height), holds ~0.25 s, then settles down into the
lockup slot — never half-size on the hit frame (that reads as tentative, not a payoff; pitfall #20).

```js
const gp = E.inExpo(prog(t, C.gather + 0.03, C.final - C.gather - 0.03));
zoomAbout(shot, Math.max(1 - gp, 1e-4), W / 2, H / 2, ` rotate(${-9 * gp}deg)`);
const heroH = H * 0.62;                                    // 60-65% of frame height
const pop = K.punch(t - C.final + 0.03, 4.5, 0.55);        // punch starts ~30 ms before the hit
const holdEnd = C.final + 0.25;                            // hold the hero size before settling
const size = t < holdEnd
  ? heroH * pop
  : K.lerpLog(heroH, lockupH, E.outBack(prog(t, holdEnd, 0.5), 1.0));   // settle into the lockup
```

## Impact frame and shake

`K.run(app, scenes, { shakes: [[C.slam, 30, 6.5]], flashes: [[C.slam, ink, [0.9, 0.35]]] })`: a two-frame veil quantized with `frameOf`, and a decaying shake. Count it in the flash budget.

## Data texture (log flood)

Canvas rows of monospace records in 3 parallax layers (12/15/19 px, alpha 0.10/0.15/0.23, speeds 40/85/150 px/s), accelerating with `off = speed * (τ + 2.4 τ³)`. Visible rows: `r` from `floor((off − H) / lh) − 1` for `H / lh + 4` rows. Quiet band around the headline: alpha × `lerp(0.16, 1, clamp(|y − lineY| / 260))`. Collapse into the line with `scale(1, 1 − inCubic)` about the line.

## Generated plate grading

A raster plate from `gen-image.mjs` is never trusted for exact colour. Grade it to the brand's
tokens with a deterministic SVG filter, built once at init (see `generated-assets.md` in the
`motion-video-brand` skill for when to generate one at all -- most videos need none):

```js
const duo = K.duotoneFilter(defs, "plateDuo", col.ink, col.bg);      // two-tone
// or: const tint = K.tintFilter(defs, "plateTint", col.accent);     // single-colour, luminance-scaled
const img = h("img", { src: "generated/plate1.png", style: { filter: `url(#${duo})` } }, parent);
```
Pair with a blur, `createGrain`, or partial framing -- never show a generated plate full-frame at
1:1 zoom (its native resolution is well under 1080p).

## Product demo: a UI mock with timed interactions

A believable app window is placeholder chrome the video draws (`renderAt(t)`), not a screen
recording. One continuous cursor keeps the mock feeling like a real hand at the controls: the
cursor's path IS a `cameraTrack` (reused for x/y, zoom channel just held at 1 -- it earns its place
as a generic 2D keyframe track, not only a camera).

```js
this.chrome = h("div", { class: "abs", style: { left: px(F.x0), top: px(F.y0), width: px(F.cw), borderRadius: px(12 * u),
  background: col.bg, boxShadow: "0 30px 80px rgba(0,0,0,.18)", overflow: "hidden" } }, el);
// traffic-light dots + a fake address bar read as "app window" instantly; no real screenshot needed
this.titlebar = h("div", { class: "abs", style: { width: "100%", height: px(40 * u), background: col.hairline } }, this.chrome);

const cursorTrack = K.cameraTrack([          // x, y, 1 (zoom unused) -- one key per stop, never a teleport
  [C.open, F.cx, F.cy, 1], [C.click1, btnX, btnY, 1], [C.type1, fieldX, fieldY, 1], [C.scroll1, listX, listY, 1],
]);
this.cursor = h("div", { class: "abs", style: { width: px(16 * u), height: px(16 * u), borderRadius: "50%",
  background: col.ink, boxShadow: "0 2px 6px rgba(0,0,0,.35)" } }, this.chrome);
this.ripple = K.clickRipple(svgOverlay, { color: col.accent });
this.field = K.typewriter(fieldEl, "invoice-2024.pdf");
```
```js
// render(t)
const [cx, cy] = cursorTrack.at(t);
tf(this.cursor, cx - 8 * u, cy - 8 * u);
this.ripple.render(t, C.click1, [btnX, btnY]);           // expands+fades right on the click cue
this.field.render(t, C.type1);                            // characters appear in order, caret blinks
const scrollY = lerp(0, -maxScroll, E.inOutCubic(prog(t, C.scroll1, 0.6)));
this.list.style.transform = `translateY(${scrollY}px)`;   // clipped container: this IS the scroll
```
Land every click/type/scroll exactly on a beat (the Product demo template in `storyboard.md`, in the
`motion-video` director skill); hold the
result state >= 0.3 s before the lockup so the payoff actually reads.

## Deterministic WebGL/GLSL generative background

`createGLBackground` (`engine.js`): time comes only from `uTime`, seeded, `preserveDrawingBuffer:
true`. Same determinism discipline as `createGrain`'s canvas-2D noise, on the GPU instead -- for a
shader-driven pattern (plasma, flow noise, a particle field) a per-pixel 2D canvas loop would be too
slow to compute every frame.

```js
const FRAG = `
precision mediump float;
uniform float uTime; uniform float uSeed; uniform vec2 uRes;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1)) + uSeed * 7.0) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = hash(floor(uv * 40.0) + floor(uTime * 6.0));   // deterministic per-cell flicker, quantized to ~6 steps/s
  vec3 col = mix(vec3(0.043, 0.051, 0.071), vec3(0.122, 0.357, 1.0), n * 0.25 + 0.05 * sin(uTime * 0.6));
  gl_FragColor = vec4(col, 1.0);
}`;
const canvas = h("canvas", { width: W, height: H, class: "abs shot" }, cam);
const bg = K.createGLBackground(canvas, FRAG, { seed: 7 });
// render(t): bg.render(t);
```
**Determinism is not optional here -- prove it, don't assume it.** Run `node determinism.mjs` after
wiring any GLSL background in; forward and reversed capture order must be pixel-identical. If your
machine's headless-Chromium GPU (or software/SwiftShader) path is not bit-identical run to run,
do not ship WebGL for that project -- fall back to a canvas-2D version of the same pattern (draw the
noise with `hash()`/`noise1()` from `engine.js`, exactly as `createGrain` already does) instead of
claiming a determinism guarantee you have not actually observed.

## SVG path draw-on illustration

`stroke-dashoffset` from `t`, staggered across paths -- the same primitive `ICON.pass`'s ring/tick
already use, just applied to a whole illustration instead of one small icon. No new helper: this is
the existing pattern at a different scale.

```js
this.paths = illustrationPaths.map((d, i) => {
  const p = s("path", { d, fill: "none", stroke: col.ink, "stroke-width": 2, "stroke-linecap": "round",
    pathLength: 1, "stroke-dasharray": "1 1" }, svg);
  return { p, cue: C.draw + i * 0.08 };                    // stagger: later paths start slightly later
});
```
```js
// render(t)
for (const { p, cue } of this.paths) {
  p.setAttribute("stroke-dashoffset", String(1 - E.outCubic(prog(t, cue, 0.5))));
}
```
Order paths so the stagger reads as a natural drawing sequence (outline before detail, left to
right or outside-in) -- an arbitrary DOM order looks like scribbling, not drawing.

## Device frame (product demo)

Full rules and the layered SVG contract: `device-frames.md` in the `motion-video-brand` skill. Short version -- an
animated shot uses the generic frame, a static official-looking shot uses a licensed one:

```js
const frame = K.genericDeviceFrame({ w: 375, h: 812, color: brand.colors.ink });
const shot = K.deviceFrameShot(cam, frame, screenContentEl);
// render(t): tf(shot.el, x, y, scale, rotation);          -- freely animatable
```
```js
const frame = await K.loadDeviceFrame("brand/devices/iphone-official.png.json"); // detect-frame.py
const shot = K.officialDeviceShot(cam, frame, screenContentEl);
// render(t): shot.render(onScreen);                        -- hard show/hide ONLY, never a transform
```
A bundled/user-library SVG frame (`K.loadDeviceSVG`) composites through the same `deviceFrameShot`
as the generic one -- content clips to `#screen`'s exact shape and the `#overlay` (notch/Dynamic
Island) always draws above it.
