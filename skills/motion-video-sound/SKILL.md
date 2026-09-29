---
name: motion-video-sound
description: "Loaded by the `motion-video` director for the soundtrack of a code-driven video: synth-kit voices, cue-to-sound mapping, arrangement, mix targets, onset detection, and supplied or generated tracks. Use directly only when the user asks specifically about that score or mix; not for making a video end to end."
compatibility: "Node.js 22+; ffmpeg and ffprobe on PATH; Python 3 with numpy only for tempo estimation from a supplied track. Optional, only if used: ElevenLabs for a synthesized voice/music track. Runs inside the project assembled by the motion-video director."
license: Apache-2.0
metadata:
  author: "juanmaagd"
  version: "2.0"
---

# Motion Video Sound

## Activation Contract

Loaded by `motion-video` when the score is written. It owns the project files `synth-kit.mjs` (voices, buses, sidechain, master) and `score.mjs` (the per-video arrangement); their `assets/project/` folder is copied into the video project.

## Hard Rules

1. Picture and sound read the same cues from `timeline.json`; never hard-code times in the score, and give each cue one sound.
2. `synth-kit.mjs` stays untouched; `score.mjs` is rewritten per video.
3. Drums sit on an unducked bus; only the music is ducked.
4. Give every `hit: true` cue a high-frequency transient at the exact sample (`click`, a high-passed `noiseHit`, or a kick's `click`); a sub swell alone does not sync-check.
5. Mix to −14 LUFS ±1 with true peak ≤ −1 dBTP, and measure it with ffmpeg `ebur128`, not by ear.
6. Never use a track without a licence the user confirms. Brand bans apply to sound too.
7. Report audio as measured, not auditioned, unless a person listened.

## Decision Gates

| Question | Default | Otherwise |
|---|---|---|
| Soundtrack | synth kit (`score.mjs`) | ElevenLabs (optional), only if authenticated, for vocals, voice-over or a genre the kit cannot fake; a licensed user track: derive BPM, offset, cues |

ElevenLabs is an optional integration: the synth kit works fully without it.

## Execution Steps

1. Pick a key and 2–4 chords; write `score.mjs` on the cues (`references/sound-design.md`: voices, cue-to-sound table, arrangement).
2. Run `node score.mjs`: it prints the estimated LUFS and true peak.
3. With a supplied or generated track: replace `score.mjs` with the trim-and-normalize loader, set `bpm` and `offset` in `timeline.json`, and place cues on the track's accents.
4. After the build, the QA of `motion-video-qa` re-measures the MP4 and checks sync against the real onsets.

## Output Contract

Return the sound source (synth kit, ElevenLabs or a supplied track), the estimated and measured loudness and true peak, the sync result at every `hit: true` cue, and the statement that the audio was measured, not heard (unless a person listened).

## References

- `references/sound-design.md`: voices, cue-to-sound table, arrangement, mix targets, onset detection, supplied tracks.
- `references/pitfalls.md`: mix, limiter and tooling failures with their fixes (numbers are shared across the family).
