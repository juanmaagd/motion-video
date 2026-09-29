# Sound design

The soundtrack is part of the timing system: picture and sound read the same cues from `timeline.json`. `synth-kit.mjs` holds the voices and the master; `score.mjs` is the per-video arrangement.

## Voices (`createSynth(tl)` → `S.*`)

| Voice | Typical call | Use |
|---|---|---|
| `kick` | `kick()`; big hit `kick({ dur: 0.9, f0: 190, f1: 40, decay: 0.45, click: 0.5, drive: 2.2 })` | beat, drops, final hit |
| `sub` | `sub({ dur: 2, f0: 62, f1: 38, glide: 0.3, decay: 0.8 })`; drop `f0: 120, f1: 30` | weight under hits, impacts |
| `noiseHit` | `noiseHit({ dur: 0.9, decay: 0.22, type: "lp", f: 6000 })` | impact air, cracks (short decay, high `f`) |
| `clap`, `hat` | `clap()` on 2 and 4; `hat()` on off-beats | groove |
| `click` | `click(3200, 0.012, 0.0025)` | UI ticks, snaps, lock-on beeps (`click(mtof(91), 0.07, 0.03)`) |
| `pluck` | `pluck(mtof(76), { decay: 0.12 })` | stepped sequences (one per stage/row), pentatonic |
| `bell` | `bell(mtof(83), { ratio: 2 })` soft; `{ ratio: 3.5 }` glassy | reveals, final shimmer, pings |
| `clang` | `clang(196)` | metallic slam (inharmonic partials) |
| `whoosh` | `whoosh(0.5, 400, 5000, { peak: 0.62, curve: 3 })` | camera moves, zooms, card flips |
| `riser` | `riser(dur, 180, 1400)` | build into a drop or a final hit |
| `pad` | `pad([55, 59, 62, 66], BAR, { cutoff: (t) => 900 + 2400 * Math.exp(-t / 0.3) })` | harmony, stabs (fast attack), drones (`attack: 0.8`) |
| `bassNote` | `bassNote(40, 0.2)` on off-beats | rolling bass (ducked) |
| `glitch`, `chatter` | `glitch(0.18)`, `chatter(0.42, 40)` | errors; decoding text, hashes, counters |

Processors: `duck(kickTimes)` (music bus only), `tapeStop(t0, t1, tEnd)` (drums + music slow to a halt), `render({ out })` (Freeverb send, high-pass, soft clip, loudness normalization to `timeline.loudness`, true-peak-aware limiter, fades, 32-bit float WAV).

## Cue → sound

| Picture event | Sound |
|---|---|
| Point/line appears | sub thump + high click |
| Text decodes | chatter, panned toward the text |
| Word slams | short tom-like kick + click; stressed words louder |
| Build | riser + rising noise band; end it before the breath |
| Breath (still frames) | silence — nothing sustains through it |
| Drop / reveal | big kick + sub + noise air + chord stab + soft bell |
| Camera move, zoom, flip | whoosh shaped to the move (peak where the motion is fastest) |
| Stepped sequence (nodes, rows) | plucks ascending in the key's pentatonic, panned left → right |
| Lock-on | two beeps + a snap |
| Slow motion / speed ramp | tape stop on the music, then silence |
| Error / refusal | glitch + dissonant stab (minor second) |
| Impact / slam | riser into: kick (drive 3) + sub drop 120 → 30 Hz + crack + clang + big reverb; one beat of silence after |
| Approval / success | major-triad arpeggio (e.g. G B D in E minor) |
| Final lockup | kick + sub on the root + full chord + two glassy bells; tail fades over the last 0.55 s |

## Arrangement

- Pick a key and 2–4 chords (the showreel: E minor; Em9 → Cmaj9 → Am9, then Cmaj9 → D6/9 → Em9). Pads through a low-pass; bass on off-beats.
- Drums on the `drums` bus (never ducked); bass and pads on `music` (ducked by `duck(kicks)`), sound design on `fx`.
- Tension: drop the kick to half time or to a heartbeat (soft kick per beat); release with the groove on the next section.
- Silence is a sound: before the drop, after the impact.

## Mix targets

Integrated −14 LUFS ±1 (streaming/social norm), true peak ≤ −1 dBTP, LRA 3–8 LU. The kit normalizes loudness and lowers the limiter ceiling until its true-peak estimate clears the target; `qa.py` re-measures the MP4 with ffmpeg `ebur128`. Without ears, also look at `ffmpeg -i out/.build/audio.wav -lavfi showspectrumpic=s=1600x512:legend=1 spec.png` and `showwavespic` — silence where planned, hits where the cues are. `inspect.sh` runs both of these (plus loudness and the lag proof) in one pass for the independent verification step of the director loop (`workflow.md` in the `motion-video` skill).

## Onset detection (how qa.py measures sync)

`qa.py`'s sync check high-passes the mix at 150 Hz before looking for onsets, in 2.5 ms blocks, each block's rise over the loudest of the previous 10 ms. This matters when designing a hit: a one-frame RMS window over full-band audio reads a sub-bass swing (e.g. `sub({ f0: 190, f1: 40 })` sweeping through low frequencies) as a false onset a frame or two away from the real hit, because low-frequency energy rises and falls slower than the transient sitting on top of it. Consequences for arrangement:

- Give every `hit: true` cue an actual high-frequency transient at the exact sample (a `click`, `noiseHit` with a high-pass character, or a kick's `click` parameter) — the sub/bass layer alone is not enough for the sync check to lock onto, even though it is what a listener feels.
- A pure sub-bass swell with no click component will not reliably sync-check even if it sounds right; add a companion transient at the cue instead of fighting the detector.

## When the synth is not the right source

| Situation | Source |
|---|---|
| Default, any brand, sync-critical cuts | synth kit (`score.mjs`) |
| Needs vocals, a voice-over, a genre the kit cannot fake, or "radio" production, and an ElevenLabs connector is authenticated | ElevenLabs music/SFX at the chosen BPM and duration; then derive cues from it |
| The user supplies a licensed track | the track; derive BPM, offset and cues from it |

Never use a track without a license the user confirms.

### Using a supplied or generated track

1. Get the BPM from the user or the file's metadata; otherwise estimate it (below). Set `bpm` and `offset` (time of the first downbeat) in `timeline.json`; place picture cues on its accents.
2. Replace `score.mjs` with a loader that trims and normalizes the file (single-pass `loudnorm` lands within about 1 LU; `qa.py` confirms):

```js
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const tl = JSON.parse(fs.readFileSync("timeline.json", "utf8"));   // build.mjs runs this from the project root
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "out/audio.wav";
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "track.wav", "-t", String(tl.duration),
  "-af", `loudnorm=I=${tl.loudness ?? -14}:TP=${tl.truePeak ?? -1}:LRA=8,afade=t=out:st=${tl.duration - 0.5}:d=0.5`,
  "-ar", "48000", "-ac", "2", "-c:a", "pcm_f32le", out]);
```

3. Estimate tempo and onsets (Python, numpy):

```python
import subprocess, numpy as np
sr, hop = 48000, 480                                          # 10 ms frames
x = np.frombuffer(subprocess.run(["ffmpeg", "-v", "error", "-i", "track.wav", "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"],
                  capture_output=True).stdout, np.float32)
env = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2) + 1e-12) for i in range(0, len(x) - hop, hop)])
flux = np.maximum(np.diff(20 * np.log10(env)), 0)             # onset strength
ac = np.correlate(flux - flux.mean(), flux - flux.mean(), "full")[len(flux) - 1:]
lags = np.arange(len(ac)) * hop / sr
ok = (lags > 60 / 180) & (lags < 60 / 70)                      # 70-180 BPM
bpm = 60 / lags[ok][np.argmax(ac[ok])]
onsets = (np.argsort(flux)[-40:] + 1) * hop / sr               # strongest accents: candidate hit cues
```
Check the estimate against the file by ear or with the user; half/double tempo errors are common.
4. Run `qa.py`: the sync check then verifies the picture hits against the track's real onsets.

## Honesty

Synthesized audio can pass every meter and still sound wrong. Unless someone listened, report the soundtrack as measured, not auditioned.
