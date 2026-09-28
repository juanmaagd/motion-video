# Storyboard on the beat grid

## Grid math

- `BEAT = 60 / bpm` s, `BAR = 4 * BEAT` (4/4). Beats are 1-based: beat `n` is at `offset + (n - 1) * BEAT`.
- Choose whole bars: `bars = duration * bpm / 240`, so `bpm = 240 * bars / duration`.
- Frames per beat = `60 * fps / bpm`. Integer values keep hard cuts frame-exact (at 60 fps: 80 → 45, 90 → 40, 100 → 36, 120 → 30, 144 → 25, 150 → 24). Non-integer values (128 → 28.125) are fine: a cue lands within 8 ms.
- Half beats (`n.5`) are eighth notes; quarter beats sixteenths. Use eighths for stepped sequences (a node every 0.23 s at 128 BPM), sixteenths only for texture.

## Duration → BPM and bars

| Duration | Pick | Alternatives |
|---|---|---|
| 4 s (sting) | 120 BPM, 2 bars | 90 → 1.5 (avoid), 180 → 3 |
| 6 s | 120 BPM, 3 bars | 160 → 4 |
| 7.5 s | 128 BPM, 4 bars | 96 → 3 |
| 8 s | 120 BPM, 4 bars | 150 → 5, 90 → 3 |
| 10 s | 144 BPM, 6 bars | 96 → 4, 120 → 5 |
| 12 s | 120 BPM, 6 bars | 100 → 5, 140 → 7 |
| 15 s | 128 BPM, 8 bars | 96 → 6, 112 → 7 |
| 20 s | 120 BPM, 10 bars | 96 → 8 |
| 30 s | 128 BPM, 16 bars | 96 → 12, 120 → 15 |
| 45 s | 128 BPM, 24 bars | 96 → 18 |
| 60 s | 128 BPM, 32 bars | 120 → 30 |

Energy: 90–110 calm/explainer, 120–130 product/launch, 140–150 hype/teaser. With a supplied track, the track's BPM wins; set `offset` so beat 1 is its first downbeat.

## Rules

- Tell a plain-language story: problem → mechanism → check → payoff. An abstract, jargon-only line ("code governs", "a pass runs") reads as unclear even when it is technically accurate — say what is actually happening, in a sentence a non-technical viewer would understand, and make the payoff the product's own real output (a real screenshot, a real result), not an abstraction of it.
- One idea per beat; a hit on every bar downbeat that changes scene. Sentences must read at 1x: about 2 words per beat for display type, a full line needs a whole bar.
- A breath before the biggest hit: 3–6 frames right before the drop, near-silent, but not truly frozen — something small still moves (an anticipation ring closing, a ≤ 1 px tremble). A genuinely stillness-only "breath" is exactly what the lag proof (`motion-craft.md`, `qa-checklist.md`) is built to catch.
- Transitions are motivated: match cut, zoom through, pull back, flip, slam. Plain cuts only on hard downbeats. Look for a geometric rhyme between the two shots before picking a transition (a shared curve, angle, or negative space) — it is what makes a match cut feel inevitable instead of arbitrary.
- The first 0.5 s must already move; the last bar holds the lockup at least 1 s with a slow push.
- Brand bans rewrite ideas, never the other way round (no invented numbers, customers or claims; color in its role).
- Write the storyboard as a table: bar, time, picture, sound and get it approved (`assets/templates/brief.md`) before building new copy into scenes — a full rebuild is a lot more expensive than a round of feedback on a table.
- Keep the approved storyboard in the project; update it when the build deviates and say why.

## Formats

| Format | Size | Layout |
|---|---|---|
| 16:9 | 1920x1080 | Centered 1200 px column (x 360–1560), rules at y 96/984; asymmetric compositions (headline left, object right). |
| 9:16 | 1080x1920 | Stack vertically in the middle band: app UI covers the top ~13% and bottom ~20%; margins 8%; display type ≥ 7% of the width; captions for sound-off viewing. |
| 1:1 | 1080x1080 | Centered, 10% margins, one element per beat; lockup scaled to the column. |

`engine.safeFrame(W, H)` returns these frames; size type with `u = min(W, H) / 1080`.

## Narrative templates

Beats in brackets assume 4/4; scale bars to the chosen duration.

**Launch (15 s, 8 bars).** 1 hook in the dark: the problem, one line [b1–4] · 2 reveal: the mark or product on the drop [5–8] · 3 how it works: a stepped sequence on eighths [9–12] · 4 scale or proof: real evidence, never invented numbers [13–16] · 5 tension: the hard case, slowed down [17–20] · 6 impact: the product solves it [21–24] · 7 benefit or the human moment [25–28] · 8 lockup + tagline/CTA, held [29–32].

**Feature explainer / how it works (20–30 s).** Title (1 bar) · problem in one visual (1 bar) · steps 1–3, each "action → result" over 2 bars with a persistent diagram that grows · before/after split (1 bar) · recap as a kinetic list (1 bar) · lockup (1 bar).

**Product demo (18–30 s, a UI mock built inside `renderAt(t)` — see `scene-recipes.md`).** Problem in one line (1 bar) · open the app: the window/chrome resolves, cursor enters frame (1 bar) · interaction 1: cursor moves to a control and clicks (ripple), state changes (1–2 bars) · interaction 2: typing into a field, a result populates (1–2 bars) · interaction 3: scroll or a second control, the payoff appears (1–2 bars) · result: the real output held on screen (1 bar) · lockup (1 bar). Every cursor stop and click/type/scroll cue is a named `timeline.json` cue like any other — the cursor path is one continuous keyframe track (`cameraTrack`/`pchip`, ignoring its zoom channel) between them, never a teleport. The UI mock is placeholder chrome the video draws, not a screen recording — never claim it is the real product unless it is built from the real product's own markup/screenshots as brand evidence.

**Announcement (8–10 s).** Word slam of the news on beats (1 bar) · the specific: version, date, price, as big type (1 bar) · one proof visual (1 bar) · lockup + date/CTA (1 bar).

**Event teaser (10–15 s).** Glitch/decode of the date and place (1 bar) · montage of tracks, speakers or venue on eighths (2 bars) · silence and a riser (half bar) · date + place + mark on the hit, held (rest).

**Brand sting (3–6 s, loopable).** The mark builds from primitives on the beats, holds, then returns to frame 0. For a seamless loop: duration is whole bars, `renderAt(DUR)` equals `renderAt(0)` (design every animation periodic or ending where it started), no fade-out, and the score's tail must wrap: render the score over two loops and keep the second, or crossfade the tail into the head.

**Data story (15–30 s).** The question (1 bar) · the number: odometer or decode to the real value, with its source on screen (1 bar) · a chart that builds on the beats (bars in stagger, lines drawn by `stroke-dashoffset`) (2 bars) · comparison or context (1–2 bars) · takeaway sentence (1 bar) · source + lockup (1 bar). Every figure real and sourced.

**Social clip (9:16, 6–15 s).** Hook in the first 0.5 s, big type in the upper-middle safe band · one idea per 2 beats · burned-in captions matching the score's accents · end card with handle/CTA inside the safe band.

**Showreel (15–30 s).** A technique montage bound by an arc: ignition (dark, inside the mark) · reveal (match cut) · mechanism (3D tracking shot) · scale (pull back into a grid) · tension (speed ramp) · impact (slam, shatter) · resolution (flip, human moment) · lockup. This is the worked example below.

## Worked example: showreel (15 s, 128 BPM, 8 bars, fictional brand)

| Bar | Picture | Sound |
|---|---|---|
| 1 | Inside the ink mark: hairline, mono decode, a request-log flood, "Requests, **verified now.**" rises from the line, folds back, line turns vertical, 4-frame breath | drone, word hits, riser, silence |
| 2 | Match cut: the line is the logo's notch, zoom out into the white gallery; headline; request card at the gate | drop, four-on-the-floor |
| 3 | Whip through the notch into a tilted pipeline; six stages fire on eighths | pentatonic plucks |
| 4 | Pull back: the pipeline is one cell of a wall of real test scenarios; lock-on; speed ramp; dive | ticks, beeps, tape stop |
| 5 | Kinetic list: three passes, "Never verified" glitches in red | heartbeat, glitch |
| 6 | Gate slams on it; shards; the brand's status card: Declined | slam, reverb, minor second |
| 7 | Card flips into a phone: a human approves; a reference id | music returns, pings |
| 8 | Implode; mark pops on the hit; wordmark slides out; tagline; hold | final hit, bells, tail |
