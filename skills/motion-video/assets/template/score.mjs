// The soundtrack for this video: an arrangement of synth-kit voices placed on timeline cues.
// Rewrite this file per video (see references/sound-design.md); keep the kit untouched.
//
//   node score.mjs [--out=out/audio.wav]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSynth } from "./synth-kit.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const tl = JSON.parse(fs.readFileSync(path.join(ROOT, "timeline.json"), "utf8"));
const S = createSynth(tl);
const { B, C, BAR, fx, drums, music, put, mtof } = S;

// E minor. MIDI notes: bass root + pad voicing.
const Em9 = { bass: 40, pad: [55, 59, 62, 66] };

// ---- bar 1: title slam (no drums, tension)
put(fx, C.open, S.sub({ dur: 0.6, f0: 90, f1: 42, glide: 0.08, decay: 0.2 }), 0.55);
put(fx, C.open, S.click(4200, 0.03, 0.004), 0.35, 0, 0.3);
put(fx, C.open + 0.117, S.whoosh(0.42, 700, 7000, { peak: 0.25, q: 2 }), 0.22, 0, 0.2);
put(fx, C.word1 - 0.35, S.chatter(0.4, 40), 0.2, -0.25);
put(fx, 0.2, S.pad([28, 40, 47], C.collapse - 0.15, { attack: 0.8, cutoff: (t) => 160 + 700 * (t / (C.collapse - 0.15)) ** 2, release: 0.12, detune: 0.004 }), 0.3);
["word1", "word2", "word3", "word4"].forEach((n, i) => {
  const g = i >= 2 ? 0.9 : 0.55; // the strong words hit harder
  put(fx, C[n], S.kick({ dur: 0.3, f0: 240, f1: 70, decay: 0.08, click: 0.25, drive: 1.3 }), 0.55 * g, (i - 1.5) * 0.15);
  put(fx, C[n], S.click(2600 + i * 400, 0.02, 0.003), 0.3 * g, 0, 0.2);
});
put(fx, C.word1 - 0.05, S.riser(C.collapse - C.word1 + 0.05, 180, 1400), 0.3, 0, 0.1);
put(fx, C.collapse, S.whoosh(0.16, 5000, 400, { peak: 0.8, q: 1 }), 0.3);
put(fx, C.collapse + 0.02, S.sub({ dur: 0.25, f0: 300, f1: 60, glide: 0.04, decay: 0.08 }), 0.25);
put(fx, C.turn + 0.03, S.click(1900, 0.2, 0.05), 0.12, 0, 0.35);
put(fx, C.turn + 0.03, S.noiseHit({ dur: 0.05, decay: 0.008, type: "hp", f: 3000 }), 0.25);
// (silence from the turn to the drop: the breath before the hit)

// ---- bar 2: the drop, doors open, kinetic list on the beats
put(fx, C.drop, S.kick({ dur: 0.9, f0: 190, f1: 40, decay: 0.45, click: 0.5, drive: 2.2 }), 0.95);
put(fx, C.drop, S.sub({ dur: 2, f0: 62, f1: 38, glide: 0.3, decay: 0.8 }), 0.55);
put(fx, C.drop, S.noiseHit({ dur: 0.9, decay: 0.22, type: "lp", f: 6000 }), 0.3, 0, 0.5);
put(fx, C.drop, S.bell(mtof(83), { dur: 2, decay: 0.7, index: 1.2, ratio: 2 }), 0.05, 0.3, 0.6);
put(fx, C.drop + 0.02, S.whoosh(0.5, 900, 3500, { peak: 0.2, q: 1 }), 0.18);
const kicks = [];
for (let bt = 6; bt <= 8; bt++) kicks.push(B(bt));
for (const t of kicks) put(drums, t, S.kick(), 0.9);
for (const bt of [6, 8]) put(drums, B(bt), S.clap(), 0.42, 0.05, 0.12);
for (let bt = 5.5; bt < 9; bt += 1) put(drums, B(bt), S.hat(), 0.2, 0.25);
for (let bt = 5.5; bt < 9; bt += 1) { put(music, B(bt), S.bassNote(Em9.bass, 0.2), 0.34); put(music, B(bt + 0.25), S.bassNote(Em9.bass + 12, 0.1), 0.16); }
put(music, C.drop, S.pad(Em9.pad, BAR, { attack: 0.005, cutoff: (t) => 900 + 2400 * Math.exp(-t / 0.3), release: 0.3 }), 0.34, 0, 0.35);
S.duck([C.drop, ...kicks]);
[76, 79, 83].forEach((m, i) => {
  const t = C[`item${i + 1}`];
  put(fx, t, S.pluck(mtof(m), { decay: 0.14, bright: 0.25 }), 0.26, lerpPan(i), 0.25);
  put(fx, t, S.click(5200, 0.01, 0.0015), 0.18, lerpPan(i));
});
function lerpPan(i) { return -0.4 + 0.4 * i; }

// ---- bars 3-4: whip into the lockup, final hit, tail
put(fx, C.lock - 0.3, S.whoosh(0.34, 400, 5000, { peak: 0.85, q: 0.9, curve: 3 }), 0.4, 0, 0.15);
put(fx, C.lock, S.kick({ dur: 1.1, f0: 190, f1: 41, decay: 0.5, click: 0.6, drive: 2.4 }), 0.95);
put(fx, C.lock, S.sub({ dur: 1.9, f0: 60, f1: 41.2, glide: 0.2, decay: 0.8 }), 0.5);
put(fx, C.lock, S.noiseHit({ dur: 1.2, decay: 0.3, type: "lp", f: 5000 }), 0.22, 0, 0.6);
put(music, C.lock, S.pad([...Em9.pad, 71], tl.duration - C.lock - 0.4, { attack: 0.004, cutoff: (t) => 1200 + 2600 * Math.exp(-t / 0.5), release: 0.4 }), 0.34, 0, 0.45);
put(fx, C.lock, S.bell(mtof(83), { dur: 1.9, decay: 0.8, index: 1.4, ratio: 3.5 }), 0.1, -0.25, 0.5);
put(fx, C.lock + 0.06, S.bell(mtof(88), { dur: 1.8, decay: 0.75, index: 1.2, ratio: 3.5 }), 0.08, 0.25, 0.5);
put(fx, C.wordmark, S.whoosh(0.5, 2500, 900, { peak: 0.25, q: 1.2 }), 0.12, 0.2);
put(fx, C.tagline, S.click(2600, 0.02, 0.004), 0.08, -0.2, 0.3);

const out = path.resolve(ROOT, arg.out ?? "out/audio.wav");
fs.mkdirSync(path.dirname(out), { recursive: true });
S.render({ out });
