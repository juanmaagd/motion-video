# Motion craft

Rules with numbers. Function names refer to `engine.js`.

## Determinism

- A frame is `renderAt(t)` and nothing else: no CSS transitions/animations, no rAF state, no `Math.random`. Use `hash(i, j, seed)` for randomness and `frameOf(t, fps)` to quantize flicker/scrambles to the output frame (sub-samples of one frame then agree, so blur never smears them).
- Keep each scene a pure `render(t)`: compute progress with `prog(t, t0, dur)`, ease it, set styles. Hide scenes outside their window with `show(el, cond)`.
- Never composite an effect layer with a CSS blend mode (`mix-blend-mode`): headless Chromium can composite it against a stale backdrop and leak pixels from one frame into another, invisible in a spot check but fatal to a chunked/parallel render. Draw texture (`createGrain`) as signed-alpha specks composited normally. Prove any new canvas/filter layer with `determinism.mjs` (forward vs reversed frame-order capture must be pixel-identical) before trusting it in a parallel render.
- "Deterministic" is necessary but not sufficient — it must also never look frozen. The lag proof (`lagproof.py`, `qa.py`) is the objective check: no run of stepped or frozen frames outside a declared hold. See Camera below and `qa-checklist.md`.

## Easing

| Motion | Ease | Typical duration |
|---|---|---|
| Entrances, reveals, text rising from a mask | `E.outExpo` | 0.45–0.6 s |
| Exits, collapses, things leaving | `E.inCubic` (`E.inExpo` only for zooms that must hit a beat) | 0.1–0.35 s |
| Hits that must show on the first frame (drops, pops) | `punch(dt, f, z)` — full speed at t=0 | f 1.2–4.5 Hz, z 0.45–0.7 |
| Settles, cards landing, list heights | `spring(dt, f, z)` — starts at rest | f 1.5–3 Hz, z 0.55–0.78 |
| Snaps with overshoot (rotations, brackets, chips) | `E.outBack(p, 1.3–2.2)` | 0.17–0.3 s |
| Calm UI moves | `E.soft` (cubic-bezier 0.2, 0.7, 0.2, 1) | 0.3–0.4 s |
| Zoom, scale, dolly | interpolate in log space: `lerpLog` or `exp(lerp(log a, log b, e))` | — |

## Timing

- Land on the beat: start reveals 40–80 ms early so the element is readable on the beat, not 150 ms after it.
- Stagger siblings 15–80 ms; reverse order on exit.
- Hold every readable element ≥ 0.3 s after it resolves; decoders finish in ≤ 0.25 s and ≥ 0.3 s before the scene leaves.
- A breath of 3–6 still frames before the biggest hit; one beat of near-silence after an impact. That is the ONLY still allowed, and even it keeps something moving — an `anticipationRing` closing, a ≤ 1 px `tremble`, a brightness swell — and must resolve within ≤ 0.3 s. A held-but-inert frame is not a breath, it is the lag proof's next FAIL.
- A static hold right before a drop looks dead. `anticipationRing(parent, opts).render(t, tStart, tHit, [x, y])` closes a hairline ring onto the hit point on an ease-in; pair with `tremble(t, seed, amp)` on the target for the deterministic wobble + swell.
- Headlines: never two on screen — an exit (0.1–0.15 s, `inCubic`) always finishes before the next entry starts. Every headline gets a minimum readable hold: ≥ 1.3 s for ≥ 5 words, ≥ 0.8 s otherwise. `makeHeadline` (`engine.js`) enforces both automatically; if the guard clamps your timing, the fix is to add air (a whole bar), not to shorten the guard.
- Climax scale: the hero hit lands LARGE (≈ 60–65% of frame height), holds ~0.25 s, then settles into the lockup — never half-size on the hit frame (that reads as tentative). `punch` still starts ~30 ms before the hit so the hit frame already shows it; see the implode/climax recipe in `scene-recipes.md`.
- Final lockup: arrive on a hit, hold ≥ 1 s, slow push (scale 1 → 1.02–1.03, `inOutSine`).

## Camera

- The camera is never parked. Build one continuous track with `cameraTrack(keys)` (monotone `pchip` per channel, zoom in log space) and pass it to `run(app, scenes, { camera })`: it extrapolates at the end slopes instead of flattening, so there is no way to leave it accidentally still. A subtle few-px drift is enough — this is "never truly still", not an establishing move.
- `zoomAbout(el, k, fx, fy)` zooms a full-frame container about a screen point. A zoom through an object: log-space `k` to 60–90x over ~0.3 s (`inOutExpo`), and pan the target to frame centre while zooming; the incoming scene starts at scale ~0.4 and eases out.
- Pull back into a smaller view: zoom both shots about one fixed point `F = (target − k·centre) / (1 − k)` so the old frame lands exactly inside its new cell.
- 3D (perspective/rotations) only while something is moving in depth; flatten before holds (3D layers are rasterized and resampled: soft text).
- Shake only on impacts: `shake(t, [[t0, px, decay]])`, 5–30 px, decay 6–11/s, noise ~32 Hz.
- A hit whose subject is small (a thin ring icon, a hairline mark) vanishes at 1× viewing size even when the animation is technically correct. Pair it with a line-wide band sweep, a ripple, and a brief 1.00 → 1.015 camera punch (~6 frames) so the hit reads at normal size, not just zoomed into a still.
- Fly through a wireframe/outline doorway, never a filled bright one — a solid bright frame at the vanishing point is both a flash risk and, on a still, a flat grey panel.
- A static hairline frame (HUD) under all shots anchors the eye across cuts; draw it once, from the centre out.

## Type

- Headline sequencing (never two on screen, minimum readable time) is a Timing rule above — `makeHeadline` (`engine.js`) is the one place both are enforced together; use it for any headline-shaped text instead of hand-rolling entry/exit.
- Fit display lines to the column (`fitFont`). Mixed weights: the sentence at 400, the key phrase at 600.
- Masked rises: a clip box with the text translated from 100–130% of the line box to 0. When the mask edge is a visible line, set the baseline 0.235 em above it (`baselineOf`) so descenders clear it.
- Variable-font punch: `"wght" 900 → 600, "wdth" 125 → 100` over 0.6 s on the stressed words (only when the font has those axes).
- Decode (`decode`) is for monospace data (hashes, labels, paths); never scramble proportional prose.
- Minimum sizes at 1080p: 14–15 px mono labels, 30 px body, 58–68 px list rows, 84+ px headlines.

## Motion blur

- Final: 32 samples per frame, 180° shutter (`render.mjs video --sub=32`). 8 samples leave visible steps on whips and slams. Previews: 1 sample.
- Blur is free polish on fast moves but reveals every layout jump: fix pops before the final.

## Color and composition

- Use brand colors in their roles only (state colors for state). Ink/paper inversions are the loudest move: at most one or two per video, ≤ 3 flashes per second.
- One focal element per beat; align headlines to one left edge across scenes; keep content inside `safeFrame`.
- A montage of identical centred compositions reads as slides, not a film. Vary scale, alignment, and give each item one device borrowed from a motif already established elsewhere in the film; let every item settle fully (≥ 0.3 s) before cutting.
- An opacity crossfade of a large bright shape passes through a flat grey-panel look. Crossfade the FILL against a matching hairline OUTLINE of the same paths instead (`fillOutlineCrossfade`, `engine.js`) — a stroke at partial opacity still reads as a clean line.
- A rectangular clip on a filled shape (a quadrant wipe, a reveal) leaves a hard notch where the clip edge crosses the shape. Mask the clipped group with a soft-edged radial gradient instead (`radialFeatherMask`, `engine.js`).
- Look for geometric rhymes between brand elements before designing a transition — a shared curve, a repeated angle, a matching negative space — and build the cut as a match cut on that shape instead of a plain hard cut. Cheap to spot, and it is what makes a transition feel inevitable rather than arbitrary.
