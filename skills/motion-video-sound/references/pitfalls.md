# Pitfalls: sound

Pitfall numbers are shared across the motion-video skill family, so this file has gaps on purpose: the missing numbers live in the `pitfalls.md` of the sibling skills `motion-video-engine`, `motion-video-qa` and `motion-video-brand`. Cite a pitfall by its number alone. New pitfalls take the next free number of the family.

Every failure met while building this template — proven in two production showreels — with the evidence that exposed it and the fix. Check the relevant ones at every review pass.

## Sound

29. **Limiter bookkeeping bug.** Evidence: sample peak −14.5 dBFS and −32.7 LUFS from a mix that should hit −14. Fix: correct running mean over the look-ahead window; always measure with `ebur128`.
30. **Over-limited first mix.** Evidence: −10.7 LUFS, −0.3 dBTP. Fix: normalize loudness before the limiter and keep the sample ceiling ≈1 dB under the true-peak target (showreel: −1.9 dBFS → −1.1 dBTP); the kit now iterates gain and ceiling from its own LUFS/true-peak estimates.
31. **Kick ducked by its own sidechain.** Evidence: drums on the ducked bus lost their attack. Fix: drums on an unducked bus; duck only music.
32. **Tape stop must take every musical bus and cut clean.** Fix: `tapeStop(t0, t1, tEnd)` on drums + music; silence until the next section.
33. **Doubled pings.** Evidence: a ring pulse at `flip + 0.3` and one at the next cue were 66 ms apart. Fix: one sound per cue; derive every time from `timeline.json`.
34. **Tooling.** Python's `wave` cannot read float WAVs (decode with ffmpeg `-f f32le`); ffmpeg `ebur128` floods logs without `framelog=quiet`.
35. **Never auditioned.** The showreel soundtrack passed every meter but nobody listened. Report audio as measured-not-heard unless a person listened.
