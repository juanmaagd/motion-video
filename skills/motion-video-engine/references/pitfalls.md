# Pitfalls: engine (render, scenes, motion)

Pitfall numbers are shared across the motion-video skill family, so this file has gaps on purpose: the missing numbers live in the `pitfalls.md` of the sibling skills `motion-video-sound`, `motion-video-qa` and `motion-video-brand`. Cite a pitfall by its number alone. New pitfalls take the next free number of the family.

Every failure met while building this template — proven in two production showreels — with the evidence that exposed it and the fix. Check the relevant ones at every review pass.

## Render and encode

1. **8 motion-blur samples step visibly on fast moves.** Evidence: whip frames showed 8 discrete copies of the mark (about 190 px of travel inside one 1/120 s shutter). Fix: 32 samples for the final (`--sub=32`); cost 4x captures (15 s at 1080p60 took 189 s on 8 workers).
2. **Segment concat drifts.** Evidence: a chunked render produced 901 frames and 1–4-frame sync offsets; NUT/Matroska segments lose the last frame's duration at concat. Fix: never trust segment timestamps; re-time by index in the encode (`setpts=N/(fps*TB)`, `-r fps`) and assert the frame count in QA.
3. **Color tags missing.** Evidence: ffprobe showed `color_primaries=unknown`, `color_transfer=unknown`. Fix: `setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv` in the filter chain plus the `-color*` flags.
4. **Wrong RGB→YUV matrix.** ffmpeg defaults to BT.601 for RGB input. Fix: `scale=out_color_matrix=bt709:out_range=tv`; verify brand colors decode within ±3 (showreel: blue (32, 91, 254) vs #1f5bff).
5. **Unbalanced workers.** Evidence: one contiguous chunk per worker left the heavy last scenes on one worker (252 s). Fix: a queue of 20-frame chunks (185 s).
6. **Browser/library revision mismatch.** playwright-core expected a newer Chromium than the cached one. Fix: pass `executablePath` to the newest cached headless shell (`render.mjs` finds it) or `CHROME_PATH`.
7. **Fonts not ready at init.** Canvas text and text measurement use fallback metrics if fonts load late. Fix: `await document.fonts.load(...)`/`loadFonts` before any scene `init`.

## Picture

8. **Soft text inside 3D contexts.** Evidence: the refusal card rendered blurry at rest (full-size still); `perspective` + `preserve-3d` + `backface-visibility` rasterize a layer that is then resampled. Fix: enable 3D only while the flip runs; plain 2D transforms at rest.
9. **"Lemon" gate and AA seam.** Evidence: closing a slotted mark by sliding the chord-cut halves together made a pointed vesica; two touching halves left a hairline seam. Fix: close by setting the chord gap to 0 (two semicircles), overlap by 0.6 px when closed (large-arc flag flips when the chord offset goes negative).
10. **Data flood only covered the bottom.** Evidence: rows appeared in a band at the bottom only; the loop started from the wrong row index. Fix: visible rows from `floor((off − H) / lh) − 1` for `H / lh + 4` rows.
11. **Collapse overlapped the rotation.** Evidence: at t=1.72 the headline was still visible while the line was already rotating (the text mask does not rotate); `inExpo` back-loaded the collapse into its last frames. Fix: `inCubic` over 0.1 s with 14 ms stagger, finish before the rotation, then a 3–6-frame breath.
12. **The drop started slow.** Evidence: a spring from rest left the first two frames after the beat nearly unchanged. Fix: `punch()` (full speed at t=0) so the first frame after the beat already shows the change.
13. **Whip left the target off-centre.** Evidence: zooming about the slot at x=1310 left a black third of the frame for several frames. Fix: pan the target to frame centre during the zoom; incoming scene from 0.42 scale (0.22 read as an empty white frame).
14. **Frame overlay painted over the mark.** Evidence: HUD rails drew light lines across the black circle at the reveal. Fix: the HUD sits under every shot.
15. **List text landed late.** Evidence: rows started on the beat and were readable ~0.15 s after it. Fix: start reveals 60 ms early; hide the list box until its first row.
16. **Decoders never resolved.** Evidence: the tx hash still showed `…d92808#+` when the scene left; stage readouts mid-scramble at the pull-back. Fix: decode in ≤ 0.25 s, finish ≥ 0.3 s before the exit.
17. **Off-screen elements came back.** Evidence: during the final implode (zoom-out to a point) the gate that had exited left re-entered the frame. Fix: hide elements once they exit.
18. **Exit too late caused an overlap.** Evidence: the gate (exiting with `inExpo`) overlapped the approval chip that arrived at the same time. Fix: start exits ~0.12 s earlier with `inCubic`.
19. **Clip-only wordmark reveal.** Evidence: the right half of the wordmark was visible before the mark moved. Fix: counter-slide the wordmark out from behind the mark with the clip at the mark's edge.
20. **Final mark arrived after the hit — and landed too small.** Evidence: a spring from zero left 3–4 near-empty frames on the loudest beat; even fixed, the mark reached only half its lockup size on the hit frame, so the climax read as tentative, not a payoff. Fix: `punch` starting ~30 ms before the hit (the hit frame already shows the mark), sized to land LARGE on the hit (≈ 60–65% of frame height), hold ~0.25 s, then settle into the lockup — see the rewritten implode/climax recipe in `scene-recipes.md`.
21. **Glitch index went negative.** Evidence: after moving a reveal 60 ms earlier, the glitch frame index became negative and produced an invalid transform. Fix: derive frame offsets from the shifted start time.
22. **Rows slid over the frame labels.** Evidence: on the list clear, exiting rows scrolled into the header band. Fix: fade exiting rows fast (`outCubic`, 0.11 s).
23. **Descenders cropped by a mask line.** Fix: baseline 0.235 em above the mask edge (`baselineOf`).
25. **Scramble glyphs smeared by motion blur.** Fix: quantize randomness to the output frame (`frameOf`).
26. **Zooming into a stroke.** Evidence (template): the whip target sat on the check's tick, which would fill the hit frame with a thick band. Fix: zoom into empty paper and fade the old shot over its last 3 frames.
27. **Container without a size.** Evidence (template): right-aligned HUD labels vanished because their parent `div` had no width. Fix: give every full-frame layer `width: W; height: H`.
28. **Shake exposed the stage.** Evidence (template smoke test): at the drop, camera shake moved an ink scene and a 1 px paper line showed along the bottom edge. Fix: full-frame backgrounds bleed 40 px past every edge.
39. **Text measured but not composed.** Evidence: a 104 px headline would have run into the mark. Fix: measure text in `init` and derive positions (the headline became 92 px, the mark moved to x=1310).

## v1.1 additions (second production showreel, 2026-09-26/27)

**Motion** (see also `motion-craft.md`; enforced by `lagproof.py`/`qa.py`)

42. **Stepped motion reads as lag.** Evidence: a "mechanical" beat animated in 15 fps steps on a 60 fps film; frame diffs showed motion only every 4th frame at 6.0–6.6 s, and the user reported it looked laggy in exactly that window. Fix: never quantize motion in a 60 fps film — linear moves and hard stops read as "mechanical" at full frame rate; reserve quantization (`frameOf`) for glyph scrambles and flicker, never for position/scale.
43. **Frozen holds read as lag.** Evidence: two windows (0.5–1 s each) had zero frame-to-frame change because the camera was parked with nothing else moving; the lag proof flags any such run over 6 frames. Fix: a never-parked camera track (`cameraTrack`/`pchip`, `engine.js`) under the whole film, plus secondary motion (grain, a hairline detail) inside any hold; the only still allowed is a designed breath ≤ 0.3 s with something still moving (e.g. `anticipationRing`).
44. **A static hold before a drop looks dead.** Evidence: the beat right before the loudest hit had nothing happening, and read as a mistake rather than a build. Fix: `anticipationRing` (`engine.js`) closes a hairline ring onto the hit point on an ease-in, with a ≤ 1 px deterministic tremble and a brightness/size swell on the target itself (`tremble`) — anticipation is not the same thing as stillness.
45. **Hits vanish at 1× on small marks.** Evidence: a thin ring icon essentially disappeared on its own hit frame at normal viewing size (obvious only zoomed in). Fix: a line-wide band sweep + a ripple + a brief 1.00 → 1.015 camera punch (~6 frames) on any hit whose subject is small.
46. **Flying into a filled bright frame flashes.** Evidence: a fly-through planned through a solid bright doorway read as a flash and, on stills, a flat grey panel mid-transition. Fix: fly through a wireframe/outline doorway, never a filled one.

**Picture**

47. **Identical compositions in a montage read as slides.** Evidence: three consecutive items with the same centred layout and scale felt like a slideshow, not a film. Fix: vary scale, alignment and pick one device per item, each borrowed from a motif already established in the film; hold every item fully settled ≥ 0.3 s.
48. **Opacity crossfade of a big bright shape reads as a flat grey panel.** Evidence: fading a large white shape's opacity in and out looked like a dead grey rectangle mid-fade, not a shape resolving. Fix: `fillOutlineCrossfade` (`engine.js`) — crossfade the FILL against a matching hairline OUTLINE of the same paths; a stroke at partial opacity still reads as a clean line.
49. **Quadrant clip rectangles leave a notch at the hub.** Evidence: clipping a filled shape into quadrants for a wipe-reveal left visible straight notch edges where the clips met at the centre. Fix: `radialFeatherMask` (`engine.js`) — mask the clipped group with a soft-edged radial gradient instead of a hard rectangle.

**Render and encode**

51. **`page.screenshot()` is the slow path.** Evidence: ~100 ms/frame vs ~35 ms with CDP directly. Fix: `Page.captureScreenshot` with `optimizeForSpeed: true` (still lossless PNG) — see `render.mjs`'s `capture()`. At thousands of frames across parallel workers this is the difference between a coffee break and a lunch break.
52. **A CSS blend mode leaks state between frames.** Evidence: `mix-blend-mode: overlay` on a grain layer, in headless Chromium, composited against a stale backdrop — a frame rendered earlier in the same page leaked pixels into a later one. Invisible in a spot check (any single frame looks fine); it corrupts a chunked or parallel render, where frames are captured out of order. Fix: draw grain as signed-alpha canvas specks composited normally (`createGrain`, `engine.js`); prove it with `determinism.mjs` (forward vs reversed capture order must be pixel-identical).
53. **Per-frame grain inflates master file size well past a shareable limit.** Evidence: a CRF 14 grain-heavy master ran ~6–7 MB/s (125–142 MB for a 20–22 s film) — too large for GitHub's 10 MB PR/issue upload limit. Fix: ship a separate web encode under a size budget, stepping CRF up from a starting value until it fits (`build.mjs`'s web-encode pass, default budget 10 MB starting at CRF 20).
