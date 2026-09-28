# Pitfalls

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
24. **Missing glyphs.** fontsource latin subsets lack ← → ✓ ≤. Fix: SVG icons; check coverage before designing with symbols.
25. **Scramble glyphs smeared by motion blur.** Fix: quantize randomness to the output frame (`frameOf`).
26. **Zooming into a stroke.** Evidence (template): the whip target sat on the check's tick, which would fill the hit frame with a thick band. Fix: zoom into empty paper and fade the old shot over its last 3 frames.
27. **Container without a size.** Evidence (template): right-aligned HUD labels vanished because their parent `div` had no width. Fix: give every full-frame layer `width: W; height: H`.
28. **Shake exposed the stage.** Evidence (template smoke test): at the drop, camera shake moved an ink scene and a 1 px paper line showed along the bottom edge. Fix: full-frame backgrounds bleed 40 px past every edge.

## Sound

29. **Limiter bookkeeping bug.** Evidence: sample peak −14.5 dBFS and −32.7 LUFS from a mix that should hit −14. Fix: correct running mean over the look-ahead window; always measure with `ebur128`.
30. **Over-limited first mix.** Evidence: −10.7 LUFS, −0.3 dBTP. Fix: normalize loudness before the limiter and keep the sample ceiling ≈1 dB under the true-peak target (showreel: −1.9 dBFS → −1.1 dBTP); the kit now iterates gain and ceiling from its own LUFS/true-peak estimates.
31. **Kick ducked by its own sidechain.** Evidence: drums on the ducked bus lost their attack. Fix: drums on an unducked bus; duck only music.
32. **Tape stop must take every musical bus and cut clean.** Fix: `tapeStop(t0, t1, tEnd)` on drums + music; silence until the next section.
33. **Doubled pings.** Evidence: a ring pulse at `flip + 0.3` and one at the next cue were 66 ms apart. Fix: one sound per cue; derive every time from `timeline.json`.
34. **Tooling.** Python's `wave` cannot read float WAVs (decode with ffmpeg `-f f32le`); ffmpeg `ebur128` floods logs without `framelog=quiet`.
35. **Never auditioned.** The showreel soundtrack passed every meter but nobody listened. Report audio as measured-not-heard unless a person listened.

## Content and brand

36. **Fabricated metrics.** Evidence: the first storyboard had counters ("signed 1,284 · refused 37") the brand forbids. Fix: real evidence only (test scenario names, real tx hash).
37. **Decorative accent color.** Evidence: a blue laser intro in a brand where blue only means "verified". Fix: ink/paper intro; the accent appears only for its state.
38. **Cultural cliché.** Evidence: a shrine-bell idea for a brand that bans Japanese motifs. Fix: neutral FM bell; bans apply to sound too.
39. **Text measured but not composed.** Evidence: a 104 px headline would have run into the mark. Fix: measure text in `init` and derive positions (the headline became 92 px, the mark moved to x=1310).

## QA interpretation

40. **Picture sync peaks before the cue by design.** Rows landing early and implosions peak −4 frames: treat picture offsets as warnings; sound at hard hits must be 0 ±1 frame.
41. **Single transitions are not flashes.** A dark-to-light reveal is one transition; a flash is a pair. The showreel measured at most 1 flash per second.

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

50. **`drawtext` can be missing.** Evidence: Homebrew ffmpeg 8.1 ships without the `drawtext` filter. Fix: label frames with Pillow (`sheet.py`, `inspect.sh`) or plain HTML text, never `drawtext`; check `ffmpeg -filters | grep drawtext` before depending on it.
51. **`page.screenshot()` is the slow path.** Evidence: ~100 ms/frame vs ~35 ms with CDP directly. Fix: `Page.captureScreenshot` with `optimizeForSpeed: true` (still lossless PNG) — see `render.mjs`'s `capture()`. At thousands of frames across parallel workers this is the difference between a coffee break and a lunch break.
52. **A CSS blend mode leaks state between frames.** Evidence: `mix-blend-mode: overlay` on a grain layer, in headless Chromium, composited against a stale backdrop — a frame rendered earlier in the same page leaked pixels into a later one. Invisible in a spot check (any single frame looks fine); it corrupts a chunked or parallel render, where frames are captured out of order. Fix: draw grain as signed-alpha canvas specks composited normally (`createGrain`, `engine.js`); prove it with `determinism.mjs` (forward vs reversed capture order must be pixel-identical).
53. **Per-frame grain inflates master file size well past a shareable limit.** Evidence: a CRF 14 grain-heavy master ran ~6–7 MB/s (125–142 MB for a 20–22 s film) — too large for GitHub's 10 MB PR/issue upload limit. Fix: ship a separate web encode under a size budget, stepping CRF up from a starting value until it fits (`build.mjs`'s web-encode pass, default budget 10 MB starting at CRF 20).

**Content and brand**

54. **A registry can serve a stale "latest".** Evidence: an npm package's `dist-tags.latest` still pointed at a pre-renumbering build after the project moved to 0.x — `npm install -g` would have installed the wrong version on screen. Fix: `cta-check.sh` before any CTA goes on screen; prefer the repo URL over a registry when they disagree.
55. **A third-party mark's licence is not automatically open.** Evidence: brand-icon catalogs mix CC0/MIT marks with "brand-use"/"Custom"-licensed ones on the same site. Fix: `logos.mjs` fetches from thesvg.org and flags anything off its open-licence allowlist; read the flagged icon's page by hand before using it commercially, and never redraw a mark instead of sourcing it.
56. **A brand's own accent and its mark's fill can differ.** Evidence: a mark's fill hex and the brand's primary UI accent were one digit apart (visually indistinguishable, numerically not). Fix: keep both exact in `brand.json`'s `colors`; verify with `colorProbes` (`qa.py`) rather than eyeballing a render.

**QA interpretation**

57. **Sub-bass swings read as false onsets.** Evidence: a one-frame RMS window over full-band audio flagged sub-bass energy swings as onsets that were not sync points. Fix: high-pass at 150 Hz before onset detection (`qa.py`; see `sound-design.md`).
58. **A lag-proof threshold from one encode does not transfer to another.** Evidence: a full-resolution master's still-hold floor (0.46) and a half-res preview's (0.11) differ by 4× purely from scale and encode settings, not from motion. Fix: calibrate `lagThreshold` per encode (render a deliberately still hold, `lagproof.py --blocks`, pick ~2.5× the floor) and record it in `timeline.json`, not as a hardcoded constant.
59. **A fast/high-CRF encode can crush "always-on" secondary motion to nothing.** Evidence, this v1.1 build: `createGrain` at alpha 0.045 produced a real, non-zero per-frame difference before encoding (confirmed on raw captured PNGs), but the *same* frames read as 0.00 YAVG after a `--preview` H.264 pass (`-preset veryfast -crf 20`) — a fast, higher-CRF encode's rate-distortion optimization treats subtle per-pixel noise as cheap-to-predict-away, especially against a flat background (a slower preset and/or lower CRF, as `build.mjs` uses for the final, is markedly less destructive — recalibrate per encode, per pitfalls #58). A multi-second "hold" whose only secondary motion was that grain measured a near-zero lag-proof floor across most of it in preview: technically non-parked in the DOM, but functionally frozen once encoded. A camera drift under ~20 px/s had the same problem (small enough per-frame deltas can round to bit-identical consecutive frames once captured and compressed). Fix: raise grain's `alpha` (0.16 default as of v1.1, retuned twice against real preview/final encodes while building this template) and size any continuous camera drift for real velocity (not just "some nonzero amount over the whole hold") — large-scale, edge-coherent motion (a drifting background) survives encoding far better than high-frequency per-pixel noise. Measure post-encode with `lagproof.py --blocks` on the SAME encode settings you will ship, not a pre-encode pixel diff or a different preset — the encode is exactly where this kind of motion goes missing, and preview vs final can disagree by a wide margin (this template's own demo needed two different calibrated `lagThreshold` values, `{"full": 1.2, "preview": 0.15}`, to pass both honestly).
60. **A hand-typed `holds` boundary can miss its own run by rounding.** Evidence: `lagproof.py`/`qa.py` print still-run times to 3 decimals (e.g. "9.733-9.983 s"), but the underlying frame time is `frame/fps` (e.g. 9.983333... s for frame 599 at 60 fps) — a `holds` entry copied from the printed text can end up a fraction of a frame too tight and fail to match the exact run it was meant to declare. Fix: both scripts compare with a half-frame tolerance (`0.5/fps`) on each bound, so a hold typed from the printed (rounded) times still matches; declaring `holds` from the unrounded frame index (`frame/fps`) works too and needs no tolerance.
61. **A verifier that checked nothing must FAIL.** Evidence, found by a parent review after this v1.1 build's own end-to-end testing pass: `python3 lagproof.py /nonexistent.mp4 5` printed "0 frame diffs over 0-5 s ... lag proof: PASS" and exited 0 -- `frame_diffs()` never checked ffmpeg's own exit code, so a missing/unreadable input silently produced zero data, and zero still-runs plus zero cadence hits reads as a clean pass. Separately, `./cta-check.sh --help` printed "SKIP unrecognized spec: --help" and then "cta-check: PASS" -- an unrecognized argument (a typo, a flag in the wrong place) checked zero CTAs and still exited 0. Neither tool lied about what it found; both lied by omission about how little they had actually looked at. Fix, applied across every tool in this template: `lagproof.py`/`qa.py` now raise/FAIL when ffmpeg errors or a read's frame count falls far short of what the requested window should produce (`LagProofError`, `check_coverage`); `cta-check.sh`'s unrecognized-spec case FAILs instead of SKIPs, and `-h`/`--help`/no-args print usage and exit 2 (never 0, never a PASS); `determinism.mjs` FAILs on 0 comparable times instead of trivially "passing" an empty loop; `logoqa.py`/`brandqa.mjs` FAIL on a missing file, an empty/degenerate crop box, or an image that reports `complete` without ever actually loading (`naturalWidth === 0`, the broken-`<img>` case); `logos.mjs` exits non-zero if any requested slug failed to fetch, not just if all of them did. The general rule: a check's absence of evidence is not evidence of a pass -- count what was actually verified, and treat zero (or far less than expected) as a failure state, not a vacuous green.

## v1.2 additions (2026-09-28)

62. **An official device bezel is not a free asset.** Evidence: Apple's App Store Marketing
    Guidelines require official bezels used "as is and without modification" (no transform, crop,
    shadow, or simulation of an Apple product), and the Design Resources licence (read from the
    DMG's own TEXT resource, never mounted or accepted) forbids embedding, redistributing or
    repackaging them -- so bundling the PNG inside this skill would violate the licence the moment
    a project used it. Fix: the official bezel and any Apple Design Resources UI component (status
    bar, keyboard, notification banner) never ship in the skill; only a licensed generic/community
    SVG frame with a confirmed, recorded licence does (`assets/devices/SOURCES.json`). The user
    keeps their own Apple exports in a library outside the skill and the tools find them there
    (`references/device-frames.md`). An animated device shot always uses the generic frame --
    `officialDeviceShot()` exposes no transform at all, by construction.
