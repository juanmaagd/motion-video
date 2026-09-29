// Synth kit: sample-accurate soundtrack synthesis locked to timeline.json cues.
//
//   import { createSynth } from "./synth-kit.mjs";
//   const S = createSynth(timeline);          // buses, voices, cue times
//   S.put(S.fx, S.C.drop, S.kick(), 0.9);     // place a voice at a cue
//   S.render({ out: "out/audio.wav" });       // reverb, loudness, limiter, WAV
//
// Buses: fx (sound design, dry), drums (never ducked), music (ducked by the kick sidechain),
// send (Freeverb input). Everything is deterministic (seeded noise). Sample rate: 48 kHz
// (the loudness estimate's K-weighting coefficients are the 48 kHz ones).
import fs from "node:fs";

export function createSynth(tl, { sr = 48000, seed = 0x51f15e } = {}) {
  const SR = sr, DUR = tl.duration, N = Math.round(SR * DUR);
  const BEAT = 60 / tl.bpm, BAR = 4 * BEAT, offset = tl.offset ?? 0;
  const B = (n) => offset + (n - 1) * BEAT;
  const C = Object.fromEntries(tl.cues.map((c) => [c.name, B(c.beat)]));

  // ------------------------------------------------------------- basics ----
  let st = seed;
  const rnd = () => { st |= 0; st = (st + 0x6d2b79f5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const noise = () => rnd() * 2 - 1;
  const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
  const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const stereo = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
  const fx = stereo(), drums = stereo(), music = stereo(), send = stereo();
  const buf = (sec) => new Float32Array(Math.max(1, Math.round(sec * SR)));
  const saw = (ph) => 2 * (ph - Math.floor(ph + 0.5));

  // Mix mono `b` at time t (s): equal-power pan -1..1, optional reverb send.
  function put(bus, t, b, gain = 1, pan = 0, rev = 0) {
    const i0 = Math.round(t * SR);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4) * gain, gr = Math.sin(((pan + 1) * Math.PI) / 4) * gain;
    for (let k = 0; k < b.length; k++) {
      const i = i0 + k;
      if (i < 0 || i >= N) continue;
      const v = b[k];
      bus.L[i] += v * gl; bus.R[i] += v * gr;
      if (rev) { send.L[i] += v * gl * rev; send.R[i] += v * gr * rev; }
    }
  }

  class Biquad {
    constructor() { this.x1 = this.x2 = this.y1 = this.y2 = 0; this.set("lp", 1000); }
    set(type, f, q = 0.707) {
      const w = (2 * Math.PI * clamp(f, 10, SR * 0.45)) / SR, c = Math.cos(w), a = Math.sin(w) / (2 * q);
      let b0, b1, b2;
      if (type === "lp") { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
      else if (type === "hp") { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
      else { b0 = a; b1 = 0; b2 = -a; } // band-pass, 0 dB peak
      const a0 = 1 + a;
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - a) / a0;
      return this;
    }
    run(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      return y;
    }
  }
  // Filter in place; cutoff may be a function of time (s) for sweeps.
  function filt(b, type, fn, q = 0.707) {
    const f = new Biquad();
    for (let i = 0; i < b.length; i++) {
      if ((i & 31) === 0) f.set(type, typeof fn === "function" ? fn(i / SR) : fn, q);
      b[i] = f.run(b[i]);
    }
    return b;
  }

  // ------------------------------------------------------------- voices ----
  function kick({ dur = 0.55, f0 = 170, f1 = 44, decay = 0.26, click: cl = 0.35, drive = 1.8 } = {}) {
    const b = buf(dur); let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR, f = f1 + (f0 - f1) * Math.exp(-t / 0.032);
      ph += (2 * Math.PI * f) / SR;
      b[i] = Math.sin(ph) * Math.exp(-t / decay) * Math.min(1, t * 2000);
    }
    const cn = Math.round(0.004 * SR);
    for (let i = 0; i < cn; i++) b[i] += cl * noise() * (1 - i / cn);
    for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) / Math.tanh(drive);
    return b;
  }
  function sub({ dur = 1.4, f0 = 70, f1 = 36, glide = 0.25, decay = 0.55 } = {}) {
    const b = buf(dur); let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR, f = f1 + (f0 - f1) * Math.exp(-t / glide);
      ph += (2 * Math.PI * f) / SR;
      b[i] = Math.sin(ph) * Math.exp(-t / decay) * Math.min(1, t * 400);
    }
    return b;
  }
  function noiseHit({ dur = 0.3, decay = 0.06, type = "lp", f = 4000, q = 0.7, attack = 0.0005 } = {}) {
    const b = buf(dur);
    for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = noise() * Math.exp(-t / decay) * Math.min(1, t / attack); }
    return filt(b, type, f, q);
  }
  function clap() {
    const b = buf(0.35);
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      let env = Math.exp(-t / 0.09) * 0.8;
      for (const o of [0, 0.011, 0.022]) if (t >= o) env = Math.max(env, Math.exp(-(t - o) / 0.006));
      b[i] = noise() * env;
    }
    return filt(filt(b, "bp", 1250, 0.9), "hp", 500);
  }
  const hat = (open = false) => filt(noiseHit({ dur: open ? 0.3 : 0.08, decay: open ? 0.09 : 0.018 }), "hp", 7500, 0.8);
  function click(freq = 3200, dur = 0.012, decay = 0.0025) {
    const b = buf(dur);
    for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t / decay); }
    return b;
  }
  function pluck(freq, { dur = 0.45, decay = 0.13, bright = 0.35 } = {}) {
    const b = buf(dur); let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR, f = freq * (1 + 0.02 * Math.exp(-t / 0.01));
      ph += f / SR;
      const tri = 1 - 4 * Math.abs(ph - Math.floor(ph + 0.5));
      b[i] = (Math.sin(2 * Math.PI * ph) + bright * tri) * Math.exp(-t / decay) * Math.min(1, t * 3000);
    }
    return b;
  }
  // FM bell; ratio 2 is harmonic and soft, 3.5 is glassy and inharmonic.
  function bell(freq, { dur = 2.4, decay = 0.9, index = 2.2, ratio = 3.5 } = {}) {
    const b = buf(dur);
    for (let i = 0; i < b.length; i++) {
      const t = i / SR, I = index * Math.exp(-t / 0.35);
      b[i] = Math.sin(2 * Math.PI * freq * t + I * Math.sin(2 * Math.PI * freq * ratio * t)) * Math.exp(-t / decay) * Math.min(1, t * 1500);
    }
    return b;
  }
  // Metallic impact: inharmonic partials (free-bar ratios).
  function clang(f0, dur = 1.6) {
    const parts = [[1, 1, 0.9], [2.76, 0.6, 0.55], [5.4, 0.4, 0.35], [8.93, 0.25, 0.22], [13.34, 0.15, 0.14]];
    const b = buf(dur);
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      let v = 0;
      for (const [r, a, d] of parts) v += a * Math.sin(2 * Math.PI * f0 * r * t + r) * Math.exp(-t / d);
      b[i] = v * Math.min(1, t * 2000);
    }
    return b;
  }
  // Band-passed noise sweep f0 -> f1; envelope peaks at `peak` (0..1 of dur).
  function whoosh(dur, f0, f1, { peak = 0.6, q = 1.4, curve = 2 } = {}) {
    const b = buf(dur);
    for (let i = 0; i < b.length; i++) {
      const x = i / b.length;
      b[i] = noise() * (x < peak ? (x / peak) ** curve : ((1 - x) / (1 - peak)) ** 1.5);
    }
    return filt(b, "bp", (t) => f0 * (f1 / f0) ** clamp(t / dur), q);
  }
  function riser(dur, f0 = 200, f1 = 1600) {
    const b = buf(dur); let p1 = 0, p2 = 0;
    for (let i = 0; i < b.length; i++) {
      const x = i / b.length, f = f0 * (f1 / f0) ** (x * x);
      p1 += f / SR; p2 += (f * 1.498) / SR;
      b[i] = (0.5 * saw(p1) + 0.35 * saw(p2) + 0.8 * noise()) * x ** 2.2;
    }
    return filt(b, "hp", (t) => lerp(300, 3500, (t / dur) ** 2), 0.8);
  }
  // Detuned-saw pad (3 voices per note) through a low-pass; cutoff may be a function of time.
  function pad(notes, dur, { attack = 0.02, release = 0.4, cutoff = 1900, detune = 0.006 } = {}) {
    const b = buf(dur + release);
    const phs = notes.flatMap(() => [rnd(), rnd(), rnd()]);
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      let v = 0;
      notes.forEach((m, j) => {
        const f = mtof(m);
        for (let k = 0; k < 3; k++) { const idx = j * 3 + k; phs[idx] += (f * (1 + (k - 1) * detune)) / SR; v += saw(phs[idx]); }
      });
      const env = Math.min(1, t / attack) * (t < dur ? 1 : Math.exp(-(t - dur) / (release / 3)));
      b[i] = (v / (notes.length * 3)) * env;
    }
    return filt(b, "lp", typeof cutoff === "function" ? cutoff : () => cutoff, 0.8);
  }
  function bassNote(m, dur = 0.2) {
    const b = buf(dur + 0.05); let ph = 0;
    const f = mtof(m);
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      ph += f / SR;
      const env = Math.min(1, t * 400) * (t < dur ? Math.exp(-t / 0.35) : Math.exp(-dur / 0.35) * Math.exp(-(t - dur) / 0.01));
      b[i] = (0.55 * saw(ph) + 0.9 * Math.sin(2 * Math.PI * ph)) * env;
    }
    return filt(b, "lp", (t) => 250 + 900 * Math.exp(-t / 0.05), 1.1);
  }
  // Bit-crushed stutter for errors and glitches.
  function glitch(dur = 0.2) {
    const b = buf(dur);
    let held = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR, slot = Math.floor(t / (BEAT / 16));
      if (i % (4 + (slot % 3) * 6) === 0) held = Math.sign(Math.sin(2 * Math.PI * (slot % 2 ? 220 : 146.8) * t)) * 0.6 + noise() * 0.4;
      b[i] = (slot * 7919) % 5 !== 3 ? Math.round(held * 6) / 6 : 0;
    }
    return filt(b, "lp", 5000);
  }
  // Data chatter: a burst of tiny random-pitch clicks (decoders, counters, hashes).
  function chatter(dur, rate = 34, pitch = [2200, 5200]) {
    const b = buf(dur);
    for (let hIdx = 0; hIdx < Math.floor(dur * rate); hIdx++) {
      const t0 = (hIdx + rnd() * 0.6) / rate, c = click(lerp(pitch[0], pitch[1], rnd()), 0.01, 0.0018), a = lerp(0.35, 1, rnd());
      const i0 = Math.round(t0 * SR);
      for (let k = 0; k < c.length && i0 + k < b.length; k++) b[i0 + k] += c[k] * a;
    }
    return b;
  }

  // --------------------------------------------------------- processors ----
  // Kick sidechain: duck the music bus under each time in `times`.
  function duck(times, { depth = 0.75, release = 0.09, bus = music } = {}) {
    const g = new Float32Array(N).fill(1);
    for (const t of times) {
      const i0 = Math.round(t * SR);
      for (let k = 0; k < SR * 0.45 && i0 + k < N; k++) g[i0 + k] = Math.min(g[i0 + k], 1 - depth * Math.exp(-k / SR / release));
    }
    for (let i = 0; i < N; i++) { bus.L[i] *= g[i]; bus.R[i] *= g[i]; }
  }
  // Tape stop: the given buses slow to a halt between t0 and t1 and stay silent until tEnd.
  function tapeStop(t0, t1, tEnd, buses = [drums, music]) {
    const i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR), iE = Math.min(N, Math.round(tEnd * SR));
    for (const bus of buses) for (const ch of [bus.L, bus.R]) {
      const src = ch.slice(i0, iE);
      let pos = 0;
      for (let i = i0; i < iE; i++) {
        const x = clamp((i - i0) / (i1 - i0)), k = Math.floor(pos), f = pos - k;
        ch[i] = i < i1 ? lerp(src[k] ?? 0, src[k + 1] ?? 0, f) * (1 - x * 0.35) : 0;
        pos += (1 - x) ** 1.6;
      }
    }
  }
  function freeverb(inL, inR, { room = 0.82, damp = 0.35 } = {}) {
    const sc = SR / 44100;
    const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((v) => Math.round(v * sc));
    const apT = [556, 441, 341, 225].map((v) => Math.round(v * sc));
    const outL = new Float32Array(N), outR = new Float32Array(N);
    for (const [inp, out, spread] of [[inL, outL, 0], [inR, outR, Math.round(23 * sc)]]) {
      const combs = combT.map((d) => ({ b: new Float32Array(d + spread), i: 0, s: 0 }));
      const aps = apT.map((d) => ({ b: new Float32Array(d + spread), i: 0 }));
      for (let n = 0; n < N; n++) {
        const x = inp[n] * 0.015;
        let y = 0;
        for (const c of combs) { const o = c.b[c.i]; c.s = o * (1 - damp) + c.s * damp; c.b[c.i] = x + c.s * room; c.i = (c.i + 1) % c.b.length; y += o; }
        for (const a of aps) { const o = a.b[a.i]; a.b[a.i] = y + o * 0.5; a.i = (a.i + 1) % a.b.length; y = o - y; }
        out[n] = y;
      }
    }
    return [outL, outR];
  }

  // ITU-R BS.1770 integrated loudness (K-weighting, 400 ms blocks, absolute + relative gates).
  function lufs(L, R) {
    const kw = (x) => {
      const y = new Float32Array(x.length);
      let a1 = 0, a2 = 0, b1 = 0, b2 = 0, c1 = 0, c2 = 0, d1 = 0, d2 = 0;
      // 48 kHz coefficients (shelving stage, then RLB high-pass)
      for (let i = 0; i < x.length; i++) {
        const s1 = 1.53512485958697 * x[i] - 2.69169618940638 * a1 + 1.19839281085285 * a2 + 1.69065929318241 * b1 - 0.73248077421585 * b2;
        a2 = a1; a1 = x[i]; b2 = b1; b1 = s1;
        const s2 = s1 - 2 * c1 + c2 + 1.99004745483398 * d1 - 0.99007225036621 * d2;
        c2 = c1; c1 = s1; d2 = d1; d1 = s2;
        y[i] = s2;
      }
      return y;
    };
    const kl = kw(L), kr = kw(R), blk = Math.round(0.4 * SR), hop = Math.round(0.1 * SR), z = [];
    for (let s = 0; s + blk <= N; s += hop) {
      let acc = 0;
      for (let i = s; i < s + blk; i++) acc += kl[i] * kl[i] + kr[i] * kr[i];
      z.push(acc / blk);
    }
    const ld = (v) => -0.691 + 10 * Math.log10(v + 1e-20);
    const abs = z.filter((v) => ld(v) > -70);
    if (!abs.length) return -Infinity;
    const rel = ld(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const kept = abs.filter((v) => ld(v) > rel);
    return ld(kept.reduce((a, b) => a + b, 0) / kept.length);
  }
  // Sample peak after 4x windowed-sinc oversampling (a true-peak estimate).
  function truePeak(L, R) {
    const taps = 8, ph = 4, kern = [];
    for (let p = 1; p < ph; p++) {
      const k = [];
      for (let j = -taps + 1; j <= taps; j++) { const x = j - p / ph; const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / taps); k.push(x === 0 ? 1 : (Math.sin(Math.PI * x) / (Math.PI * x)) * w); }
      kern.push(k);
    }
    let pk = 0;
    for (const ch of [L, R]) for (let i = taps; i < N - taps; i++) {
      pk = Math.max(pk, Math.abs(ch[i]));
      for (const k of kern) { let v = 0; for (let j = 0; j < k.length; j++) v += k[j] * ch[i - taps + 1 + j]; pk = Math.max(pk, Math.abs(v)); }
    }
    return 20 * Math.log10(pk + 1e-20);
  }
  function limit(L, R, ceilingDb) {
    const CEIL = 10 ** (ceilingDb / 20), look = Math.round(0.004 * SR), rel = Math.exp(-1 / (0.09 * SR));
    const need = new Float32Array(N);
    for (let i = 0; i < N; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])); need[i] = p > CEIL ? CEIL / p : 1; }
    const wmin = new Float32Array(N), dq = new Int32Array(N);
    let head = 0, tail = 0;
    for (let i = N - 1; i >= 0; i--) { // sliding minimum over [i, i + look]
      while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
      dq[tail++] = i;
      while (dq[head] > i + look) head++;
      wmin[i] = need[dq[head]];
    }
    const hist = new Float32Array(look + 1).fill(1);
    let acc = look + 1, hp = 0, g = 1;
    for (let i = 0; i < N; i++) { // box-smoothed attack lands on every peak; exponential release
      acc += wmin[i] - hist[hp]; hist[hp] = wmin[i]; hp = (hp + 1) % (look + 1);
      g = Math.min(acc / (look + 1), 1 - (1 - g) * rel);
      L[i] *= g; R[i] *= g;
    }
  }

  // Mix, reverb, high-pass, soft clip, loudness normalisation, limiter, fades, WAV.
  function render({ out, lufsTarget = tl.loudness ?? -14, truePeakMax = tl.truePeak ?? -1, reverbLevel = 3.2, room = 0.82, damp = 0.35, fadeOut = 0.55 } = {}) {
    const [rvL, rvR] = freeverb(send.L, send.R, { room, damp });
    const mixL = new Float32Array(N), mixR = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      mixL[i] = fx.L[i] + drums.L[i] + music.L[i] + rvL[i] * reverbLevel;
      mixR[i] = fx.R[i] + drums.R[i] + music.R[i] + rvR[i] * reverbLevel;
    }
    for (const ch of [mixL, mixR]) { const f = new Biquad().set("hp", 24, 0.707); for (let i = 0; i < N; i++) ch[i] = f.run(ch[i]); }
    const master = (gain, ceil) => {
      const L = new Float32Array(N), R = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        for (const [src, dst] of [[mixL, L], [mixR, R]]) {
          const v = src[i] * gain, a = Math.abs(v);
          dst[i] = a < 0.6 ? v : Math.sign(v) * (0.6 + 0.4 * Math.tanh((a - 0.6) / 0.4));
        }
      }
      limit(L, R, ceil);
      for (let i = 0; i < N; i++) {
        const t = i / SR, fin = Math.min(1, t / 0.002), fo = t > DUR - fadeOut ? Math.cos(((t - (DUR - fadeOut)) / fadeOut) * (Math.PI / 2)) : 1;
        L[i] *= fin * fo; R[i] *= fin * fo;
      }
      return [L, R];
    };
    let gain = 1, ceil = truePeakMax - 0.9, L, R, loud = 0, tp = 0;
    for (let it = 0; it < 6; it++) {
      [L, R] = master(gain, ceil);
      loud = lufs(L, R); tp = truePeak(L, R);
      const dl = lufsTarget - loud, over = tp - (truePeakMax - 0.15);
      if (Math.abs(dl) < 0.15 && over <= 0) break;
      if (over > 0) ceil -= over + 0.05;
      gain *= 10 ** (dl / 20);
    }
    let peak = 0;
    for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    if (out) writeWav(out, L, R);
    const stats = { lufs: +loud.toFixed(2), truePeak: +tp.toFixed(2), samplePeak: +(20 * Math.log10(peak)).toFixed(2), gain: +gain.toFixed(3), ceiling: +ceil.toFixed(2) };
    console.log(`audio: ${DUR}s ${SR} Hz stereo  ${stats.lufs} LUFS (est.)  true peak ${stats.truePeak} dBTP (est.)  -> ${out ?? "(memory)"}`);
    return { L, R, stats };
  }
  function writeWav(file, L, R) {
    const data = Buffer.alloc(N * 8);
    for (let i = 0; i < N; i++) { data.writeFloatLE(L[i], i * 8); data.writeFloatLE(R[i], i * 8 + 4); }
    const hdr = Buffer.alloc(44);
    hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write("WAVE", 8);
    hdr.write("fmt ", 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(3, 20); hdr.writeUInt16LE(2, 22);
    hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 8, 28); hdr.writeUInt16LE(8, 32); hdr.writeUInt16LE(32, 34);
    hdr.write("data", 36); hdr.writeUInt32LE(data.length, 40);
    fs.writeFileSync(file, Buffer.concat([hdr, data]));
  }

  return {
    SR, N, DUR, BEAT, BAR, B, C, fx, drums, music, send, put, rnd, noise, mtof, clamp, lerp, buf, filt, Biquad,
    kick, sub, noiseHit, clap, hat, click, pluck, bell, clang, whoosh, riser, pad, bassNote, glitch, chatter,
    duck, tapeStop, render,
  };
}
