# Studio: what its Tweak tab may change, and how it writes

`npm run studio` serves the project on 127.0.0.1. Besides the live preview and the review notes (`feedback.json`), its Tweak tab lets the person change a few data fields without the agent. `POST /api/tweak {file: "timeline" | "brand", ops: [{path, value}]}` accepts only these paths:

| File | Path | Value |
|---|---|---|
| `timeline.json` | `cues[i].beat` | a finite number that puts the cue inside the video (`offset + (beat - 1) * 60 / bpm` within 0..duration) |
| `timeline.json` | `cues[i].hit` | `true` or `false` |
| `brand.json` | `colors.<role>` | `#rgb` or `#rrggbb`, for a role that already exists in `brand.json` |
| `brand.json` | `copy.<key>` | the same shape as the current value (a string, a list of strings, or `[string, weight]` pairs of the same length), for a field that already exists |
| `brand.json` | `wordmark`, `name` | a string of 1 to 100 characters |

Everything else is refused: a cue's `name`, `bpm`, `offset`, `duration`, fps and size, the QA thresholds, `fonts`, `logo`, `colorProbes`, and any new colour role or copy field. One refused op refuses the whole request (400, nothing written); an accepted request is applied whole. A request that changes nothing writes nothing, so nothing reloads. A write reloads the page, and a `timeline.json` write also regenerates the audio.

## Rules for the agent

- The person may edit these fields at any time. Read `timeline.json` and `brand.json` fresh before you edit them, and never write one back from a stale copy.
- To add a colour role, a copy field or a cue, edit the file yourself; the studio never creates them.

## How the studio writes

Every studio write (a tweak, or a note in `feedback.json`) goes through one atomic writer: it re-reads the file from disk, applies the change, writes a temporary file in the same folder and renames it over the original, one write at a time. It lays JSON out the way the project files already are: an object or array goes on one line when it fits in 100 columns (`{ "name": "open", "beat": 1 }`) and is broken over lines when it does not. So the first studio write re-lays out `timeline.json` and `brand.json`; content is unchanged. The demo `timeline.json` round-trips byte for byte, and in the demo `brand.json` only the two font entries expand. A file in another layout is reformatted once, then stays as written.
