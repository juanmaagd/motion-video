// motion-video engine: deterministic, time-based animation for code-generated video.
//
// Every frame is renderAt(t). Nothing in here keeps state between frames, so the renderer
// can sample any time in any order (parallel workers, motion-blur sub-frames, stills).
// Rules: no CSS animations or transitions, no requestAnimationFrame state, no Math.random.

// ================================================================= setup ====
async function loadJSON(url, fallback) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`cannot load ${url}: ${e.message}`);
  }
}

// timeline.json: fps, width, height, duration, bpm, optional offset (s), cues [{ name, beat, hit? }].
// Beats are 1-based: beat 1 = offset, beat n = offset + (n - 1) * 60 / bpm.
export async function loadTimeline(url = "timeline.json") {
  const tl = await loadJSON(url);
  const BEAT = 60 / tl.bpm, BAR = 4 * BEAT, offset = tl.offset ?? 0;
  const B = (n) => offset + (n - 1) * BEAT;
  const C = Object.fromEntries(tl.cues.map((c) => [c.name, B(c.beat)]));
  return { ...tl, W: tl.width, H: tl.height, FPS: tl.fps, DUR: tl.duration, BEAT, BAR, B, C };
}

export const BRAND_DEFAULTS = {
  name: "Brand",
  wordmark: "brand",
  colors: { bg: "#ffffff", ink: "#0b0d12", muted: "#8a8f99", hairline: "#d5d8de", accent: "#1f5bff", alert: "#e5372a" },
  fonts: {
    display: { family: "Display", files: [], fallback: "ui-sans-serif, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif", weight: "100 900", stretch: "75% 125%" },
    mono: { family: "Mono", files: [], fallback: "ui-monospace, SFMono-Regular, Menlo, monospace", weight: "100 900", stretch: "75% 125%" },
  },
  logo: null,
  copy: {},
};

// brand.json: colors (by role), fonts (family + files in fonts/), logo (svg path), copy strings.
export async function loadBrand(url = "brand.json") {
  const b = await loadJSON(url, {});
  const fonts = { ...BRAND_DEFAULTS.fonts };
  for (const [role, f] of Object.entries(b.fonts ?? {})) fonts[role] = { ...BRAND_DEFAULTS.fonts[role], ...f };
  return { ...BRAND_DEFAULTS, ...b, colors: { ...BRAND_DEFAULTS.colors, ...b.colors }, fonts, copy: { ...BRAND_DEFAULTS.copy, ...b.copy } };
}

// Registers the project's font files (fonts/*.woff2 listed in brand.json). A missing or broken
// file is skipped and the role falls back to its system stack, so rendering never blocks.
// Returns { role: number of faces loaded } so the caller can report fallbacks.
export async function loadFonts(brand) {
  const loaded = {};
  for (const [role, f] of Object.entries(brand.fonts)) {
    loaded[role] = 0;
    for (const file of f.files ?? []) {
      const src = typeof file === "string" ? { url: file } : file;
      try {
        const face = new FontFace(f.family, `url(${src.url})`, {
          weight: f.weight, stretch: f.stretch, ...(src.range ? { unicodeRange: src.range } : {}),
        });
        await face.load();
        document.fonts.add(face);
        loaded[role]++;
      } catch {
        console.warn(`font ${src.url} not loaded; using the ${role} fallback stack`);
      }
    }
    document.documentElement.style.setProperty(`--font-${role}`, `"${f.family}", ${f.fallback}`);
  }
  await document.fonts.ready;
  return loaded;
}

// Inline SVG logo from brand.logo (keeps it vector and animatable). Returns null when absent.
export async function loadLogo(brand) {
  if (!brand.logo) return null;
  try {
    const r = await fetch(brand.logo);
    if (!r.ok) return null;
    const doc = new DOMParser().parseFromString(await r.text(), "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) return null;
    const vb = (svg.getAttribute("viewBox") || "0 0 100 100").split(/[\s,]+/).map(Number);
    return { svg: document.importNode(svg, true), vb, aspect: vb[2] / vb[3] };
  } catch {
    return null;
  }
}

// Stage of W x H with a camera wrapper (#cam) and a full-frame flash layer.
export function createStage(tl, brand) {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(brand.colors)) root.setProperty(`--${k}`, v);
  const stage = document.getElementById("stage");
  Object.assign(stage.style, { width: px(tl.W), height: px(tl.H) });
  const cam = h("div", { class: "shot" }, stage);
  const flash = h("div", { class: "shot", style: { pointerEvents: "none", opacity: 0 } }, stage);
  for (const el of [cam, flash]) Object.assign(el.style, { width: px(tl.W), height: px(tl.H) });
  return { tl, brand, stage, cam, flash, W: tl.W, H: tl.H, frame: safeFrame(tl.W, tl.H) };
}

// Mounts scenes ({ init(app), render(t) }) in order and defines window.renderAt(t).
// A scene may also carry a `name` (shown by the studio) and expose its root element as `el` (what
// window.__state(t) reads to say which scenes are on screen).
// shakes: [[t0, amplitudePx, decayPerSecond]]; flashes: [[t0, color, [opacity per frame...]]].
// camera (optional): a track (e.g. from cameraTrack()) whose .at(t) returns [x, y, zoom] to
// apply to `cam` every frame (transform-origin is 0 0, so zoom != 1 needs x/y already computed to
// zoom about the intended point -- see zoomAbout()/cameraTrack()); combined additively with shake.
// A never-parked camera is the most reliable way to guarantee the lag proof never sees a true
// zero-motion run: even a few px of continuous drift changes real content edges every frame.
// post (optional): called every frame after scenes, camera and flash are applied -- draw grain here
// (createGrain), last, over everything.
export async function run(app, scenes, { shakes = [], flashes = [], camera, post } = {}) {
  for (const sc of scenes) await sc.init(app);
  const { tl, cam, flash } = app;
  window.renderAt = (t) => {
    t = clamp(t, 0, tl.DUR - 1e-6);
    for (const sc of scenes) sc.render(t);
    const [x, y, r] = shake(t, shakes);
    if (camera) {
      const [cx, cy, cz] = camera.at(t);
      cam.style.transform = `translate(${x + cx}px,${y + cy}px) rotate(${r}deg) scale(${cz})`;
    } else {
      cam.style.transform = `translate(${x}px,${y}px) rotate(${r}deg)`;
    }
    let fo = 0, fc = "#000";
    for (const [t0, color, seq] of flashes) {
      const f = frameOf(t, tl.FPS) - frameOf(t0, tl.FPS);
      if (f >= 0 && f < seq.length && seq[f] > fo) { fo = seq[f]; fc = color; }
    }
    flash.style.background = fc;
    flash.style.opacity = fo;
    if (post) post(t);
  };
  // window.__state(t): what the composition is doing at t, as data -- for the studio's readout, and
  // for anything that needs to name what is on screen. It reads and paints nothing else, so renderAt is
  // unchanged. bar/beat/cue/next come from the timeline alone. `scenes` lists the scenes whose root
  // element (`el`) is displayed, i.e. the DOM as of the last renderAt: call renderAt(t) first when it
  // must describe t. Defined before __ready, which is the signal that every hook exists.
  const cueList = tl.cues.map((c) => ({ name: c.name, t: tl.B(c.beat) })).sort((a, b) => a.t - b.t);
  window.__state = (t) => {
    t = clamp(t, 0, tl.DUR - 1e-6);
    const x = t - tl.B(1), eps = 1e-9;
    const cue = cueList.filter((c) => c.t <= t + eps).pop() ?? null;
    const next = cueList.find((c) => c.t > t + eps) ?? null;
    return {
      t, frame: frameOf(t, tl.FPS),
      bar: x < 0 ? 0 : Math.floor(x / tl.BAR + eps) + 1,               // 1-based; 0 before the first beat
      beat: x < 0 ? 0 : Math.min(4, Math.floor((x % tl.BAR) / tl.BEAT + eps) + 1),
      cue: cue && { name: cue.name, t: cue.t },
      next: next && { name: next.name, in: next.t - t },
      scenes: scenes.flatMap((sc, index) => (sc.el instanceof Element && sc.el.isConnected && (sc.el.checkVisibility?.() ?? sc.el.style.display !== "none")
        ? [{ index, name: sc.name ?? `scene${index}` }] : [])),
    };
  };
  // window.__pick(x, y): what is at a point of the frame, for pointing at a problem (studio.html). x, y are
  // video pixels, i.e. where it shows AFTER the camera. Returns { stage, target, scene }: `stage` is the same
  // point with the camera undone (the coordinates scenes lay themselves out in), `target` the topmost element
  // there that is not just a full-frame wrapper (tag, class, text, rect, path) or null, `scene` the scene
  // containing the topmost thing there ({ index, name }) or null. A pure read of the last painted frame.
  const r1 = (v) => Math.round(v * 10) / 10;
  const isBackdrop = (el) => el === document.documentElement || el === document.body || el === app.stage || el === cam || el === flash
    || scenes.some((sc) => sc.el === el);
  window.__pick = (x, y) => {
    const inv = new DOMMatrixReadOnly(getComputedStyle(cam).transform).inverse();
    const sp = inv.transformPoint({ x, y });
    const stage = Number.isFinite(sp.x) && Number.isFinite(sp.y) ? { x: r1(sp.x), y: r1(sp.y) } : { x: r1(x), y: r1(y) };
    const hits = document.elementsFromPoint(x, y);
    let scene = null;
    for (const el of hits) {
      const index = scenes.findIndex((sc) => sc.el instanceof Element && sc.el.contains(el));
      if (index >= 0) { scene = { index, name: scenes[index].name ?? `scene${index}` }; break; }
    }
    const el = hits.find((e) => {
      if (isBackdrop(e)) return false;
      const b = e.getBoundingClientRect();
      return !(b.width >= 0.9 * tl.W && b.height >= 0.9 * tl.H); // a full-frame layer says nothing about where you pointed
    });
    let target = null;
    if (el) {
      const b = el.getBoundingClientRect(), path = [];
      for (let e = el; e && e !== app.stage && e !== document.body; e = e.parentElement) {
        const cls = (e.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 2).map((c) => `.${c}`).join("");
        path.unshift(`${e.tagName.toLowerCase()}${cls}:nth-child(${[...e.parentElement.children].indexOf(e) + 1})`);
      }
      target = {
        tag: el.tagName.toLowerCase(), class: (el.getAttribute("class") || "").slice(0, 200),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80),
        rect: { x: r1(b.x), y: r1(b.y), w: r1(b.width), h: r1(b.height) }, path: `#stage > ${path.join(" > ")}`.slice(0, 400),
      };
    }
    return { stage, target, scene };
  };
  window.__ready = true;
  const q = new URLSearchParams(location.search).get("t");
  if (q !== null) window.renderAt(parseFloat(q));
}

// Content-safe frame per aspect ratio; u = type/space unit (1.0 when the short side is 1080 px).
export function safeFrame(W, H) {
  const u = Math.min(W, H) / 1080;
  const landscape = W > H * 1.2, portrait = H > W * 1.2;
  const mx = landscape ? W * 0.1875 : portrait ? W * 0.08 : W * 0.1;
  const top = landscape ? H * 0.0889 : portrait ? H * 0.13 : H * 0.1;
  const bottom = landscape ? H * 0.0889 : portrait ? H * 0.2 : H * 0.1; // 9:16 apps cover the bottom
  return { u, x0: mx, x1: W - mx, y0: top, y1: H - bottom, cx: W / 2, cy: (top + H - bottom) / 2, cw: W - 2 * mx, landscape, portrait };
}

// ================================================================== math ====
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const prog = (t, t0, d) => clamp((t - t0) / d);
// Interpolate a scale or zoom in log space: it reads as constant speed to the eye.
export const lerpLog = (a, b, t) => Math.exp(lerp(Math.log(a), Math.log(b), t));

export const E = {
  lin: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t) => 1 - (1 - t) ** 4,
  inOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  outQuint: (t) => 1 - (1 - t) ** 5,
  inExpo: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
  outExpo: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  outBack: (t, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  inBack: (t, s = 1.70158) => (s + 1) * t ** 3 - s * t * t,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

// CSS cubic-bezier(x1, y1, x2, y2) as an easing function.
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (u) => ((ax * u + bx) * u + cx) * u, Y = (u) => ((ay * u + by) * u + cy) * u;
  const dX = (u) => (3 * ax * u + 2 * bx) * u + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let u = x;
    for (let i = 0; i < 8; i++) {
      const e = X(u) - x, d = dX(u);
      if (Math.abs(e) < 1e-7 || Math.abs(d) < 1e-7) break;
      u = clamp(u - e / d);
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 30 && Math.abs(X(u) - x) > 1e-7; i++) { if (X(u) < x) lo = u; else hi = u; u = (lo + hi) / 2; }
    return Y(u);
  };
}
E.soft = bezier(0.2, 0.7, 0.2, 1); // calm UI ease-out

// Damped spring step response 0 -> 1 (starts at rest). f in Hz, z damping ratio.
export function spring(dt, f = 2, z = 0.6) {
  if (dt <= 0) return 0;
  const w = 2 * Math.PI * f;
  if (z >= 1) return 1 - Math.exp(-w * dt) * (1 + w * dt);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * dt) * (Math.cos(wd * dt) + ((z * w) / wd) * Math.sin(wd * dt));
}
// Like spring() but starting at full speed: use for hits that must show on the first frame.
export function punch(dt, f = 1.6, z = 0.45) {
  if (dt <= 0) return 0;
  const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * dt) * Math.cos(wd * dt);
}

// Integer hash -> [0, 1). Deterministic replacement for Math.random.
export function hash(a, b = 0, c = 0) {
  let x = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}
// Smooth 1D value noise in [-1, 1].
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed) * 2 - 1, hash(i + 1, seed) * 2 - 1, u);
}
// The output frame a time belongs to. Motion-blur sub-samples of one frame share it,
// so frame-quantized randomness (glyph scrambles, flicker) does not smear.
export const frameOf = (t, fps) => Math.round(t * fps);

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%+/<>=";
// Decoder text: resolved chars behind a front, scrambled glyphs at the front, blanks ahead.
// Use on monospace text only (the blank is a no-break space of the same width).
export function decode(str, p, seed, t, fps = 60, spread = 5) {
  const n = str.length, front = p * (n + spread), f = frameOf(t, fps) >> 1;
  let out = "";
  for (let i = 0; i < n; i++) {
    const ch = str[i];
    if (ch === " ") out += " ";
    else if (i < front - spread) out += ch;
    else if (i < front) out += GLYPHS[Math.floor(hash(i, f, seed) * GLYPHS.length)];
    else out += " ";
  }
  return out;
}

// Camera shake from impacts [[t0, amplitudePx, decayPerSecond]] -> [x, y, rotationDeg].
export function shake(t, impacts) {
  let x = 0, y = 0, r = 0;
  for (const [t0, A, k] of impacts) {
    const d = t - t0;
    if (d < 0 || d > 1.5) continue;
    const env = A * Math.exp(-k * d);
    x += env * noise1(d * 32, 11 + t0 * 7);
    y += env * noise1(d * 32, 23 + t0 * 7);
    r += env * 0.03 * noise1(d * 24, 37 + t0 * 7);
  }
  return [x, y, r];
}

// Analytic particle burst (linear drag + gravity): positions are a closed form of time.
export function makeBurst(n, rect, { seed = 1, speed = [300, 1500], up = [-1500, 700], size = [2, 7], life = [0.55, 1.25] } = {}) {
  const [x0, y0, w, hh] = rect, cx = x0 + w / 2;
  return Array.from({ length: n }, (_, i) => {
    const x = x0 + w * hash(i, seed, 1), y = y0 + hh * hash(i, seed, 2);
    return {
      x, y, vx: Math.sign(x - cx || 1) * lerp(speed[0], speed[1], hash(i, seed, 3) ** 1.6) + lerp(-160, 160, hash(i, seed, 4)),
      vy: lerp(up[0], up[1], hash(i, seed, 5)), size: lerp(size[0], size[1], hash(i, seed, 6)),
      life: lerp(life[0], life[1], hash(i, seed, 7)), alt: hash(i, seed, 8) < 0.22,
    };
  });
}
export function drawBurst(ctx, parts, d, { colors = ["#e5372a", "#0b0d12"], g = 2400, drag = 3.2 } = {}) {
  if (d < 0) return;
  for (const p of parts) {
    if (d > p.life) continue;
    const e = (1 - Math.exp(-drag * d)) / drag;
    const x = p.x + p.vx * e, y = p.y + (p.vy + g / drag) * e - (g * d) / drag;
    ctx.globalAlpha = 1 - E.inCubic(d / p.life);
    ctx.fillStyle = p.alt ? colors[1] : colors[0];
    ctx.fillRect(Math.round(x), Math.round(y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

// =================================================================== dom ====
const NS = "http://www.w3.org/2000/svg";
export const px = (v) => `${v}px`;
export function h(tag, props = {}, parent) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "style") Object.assign(e.style, v);
    else if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  if (parent) parent.appendChild(e);
  return e;
}
export function s(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
export const show = (el, on) => { el.style.display = on ? "" : "none"; return on; };
// Place an element: translate, rotate, uniform scale, opacity.
export function tf(el, x = 0, y = 0, sc = 1, r = 0, o = 1) {
  el.style.transform = `translate(${x}px,${y}px) rotate(${r}deg) scale(${sc})`;
  el.style.opacity = o;
}
// Zoom a full-frame container (transform-origin 0 0) by k about the screen point (fx, fy).
export function zoomAbout(el, k, fx, fy, extra = "") {
  el.style.transform = `translate(${fx * (1 - k)}px,${fy * (1 - k)}px) scale(${k})${extra}`;
}
// Font size that makes el exactly `width` wide (el must be nowrap and in the DOM).
export function fitFont(el, width, probe = 100) {
  el.style.fontSize = px(probe);
  const fs = (probe * width) / el.getBoundingClientRect().width;
  el.style.fontSize = px(fs);
  return fs;
}
// Baseline y inside el's box (px from its top), measured with a zero-size inline probe.
export function baselineOf(el) {
  const p = h("span", { style: { display: "inline-block", width: 0, height: 0, verticalAlign: "baseline" } }, el);
  const y = p.offsetTop;
  p.remove();
  return y;
}

// Stroke icons (18 px grid, currentColor). Paths carry pathLength="1" so they can be drawn
// with stroke-dashoffset 1 -> 0.
export const ICON = {
  pass: `<svg viewBox="0 0 18 18" fill="none" width="100%" height="100%"><circle cx="9" cy="9" r="7.25" stroke="currentColor" stroke-opacity=".35" stroke-width="1.5" pathLength="1" stroke-dasharray="1 1" class="ring"/><path d="M5.3 9.3L7.7 11.6L12.7 6.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1" class="tick"/></svg>`,
  fail: `<svg viewBox="0 0 18 18" fill="none" width="100%" height="100%"><circle cx="9" cy="9" r="7.25" fill="currentColor" class="disc"/><path d="M6.2 6.2L11.8 11.8M11.8 6.2L6.2 11.8" stroke="#fff" stroke-width="1.7" stroke-linecap="round" pathLength="1" stroke-dasharray="1 1" class="tick"/></svg>`,
  arrow: `<svg viewBox="0 0 16 16" fill="none" width="100%" height="100%"><path d="M2.5 8h10.5M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};
export function icon(kind, size, parent, style = {}) {
  return h("div", { html: ICON[kind], style: { position: "absolute", width: px(size), height: px(size), ...style } }, parent);
}

// ============================================ v1.1: ported from a real production (see
// references/pitfalls.md for the evidence behind each helper below). ========================

// Batch-update SVG/DOM attributes on an element already created with s()/h() (no style/class/text
// handling -- use those helpers' props for that). Cheap and explicit, for per-frame updates.
export function set(el, attrs) { for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); }

// ---------------------------------------------------------------- keyframe tracks ----
// Monotone cubic (Fritsch-Carlson) through keyframes: continuous velocity, no overshoot between
// keys, and the ends extrapolate at their last slope -- a track built on this never comes to a
// dead stop at its first or last key. xs must be strictly increasing.
export function pchip(xs, ys) {
  const n = xs.length, hh = [], d = [], m = [];
  for (let i = 0; i < n - 1; i++) { hh[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / hh[i]; }
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const w1 = 2 * hh[i] + hh[i - 1], w2 = hh[i] + 2 * hh[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return (x) => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]);
    if (x >= xs[n - 1]) return ys[n - 1] + m[n - 1] * (x - xs[n - 1]);
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h0 = hh[i], u = (x - xs[i]) / h0, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h0 * m[i] + (3 * u2 - 2 * u3) * ys[i + 1] + (u3 - u2) * h0 * m[i + 1];
  };
}
// A camera track that is never parked ("the camera is never parked... keyframed spline with
// continuous drift"): x, y and zoom each follow their own monotone spline through
// keys = [[t, x, y, zoom], ...] (zoom interpolated in log space, so a zoom move reads as constant
// speed). Because pchip extrapolates at the end slopes instead of flattening, the camera keeps
// drifting before the first key and after the last one -- there is no way to accidentally leave it
// parked. Use one continuous track under a whole scene (or the whole film) instead of per-shot
// static framing; toScreen() projects a world point through it.
export function cameraTrack(keys) {
  const ts = keys.map((k) => k[0]);
  const fx = pchip(ts, keys.map((k) => k[1])), fy = pchip(ts, keys.map((k) => k[2])), fz = pchip(ts, keys.map((k) => Math.log(k[3])));
  return {
    at: (t) => [fx(t), fy(t), Math.exp(fz(t))],
    toScreen(t, wx, wy, W, H) { const [cx, cy, z] = this.at(t); return [(wx - cx) * z + W / 2, (wy - cy) * z + H / 2, z]; },
  };
}

// ---------------------------------------------------------------------- headlines ----
// Headline with the readable-time guard: never two headlines on screen together (the exit always
// finishes before the guarded minimum readable hold elapses), and every line gets its minimum
// readable time (>= 1.3 s for >= 5 words, >= 0.8 s otherwise) unless `minReadable` overrides it.
// Words rise out of a clip box on entry (outExpo by default) and drop out fast on exit (inCubic),
// staggered. HTML/CSS based (a clip div per instance), matching this template's DOM scenes.
//
//   const h1 = makeHeadline(parent, "Motion from pure code.", { size: 84 });
//   const xa = h1.exitAt(C.open, C.next);        // earliest the NEXT headline may enter
//   h1.render(t, C.open, C.next);
//   h2.render(t, xa + h1.exitDur, C.after);       // guaranteed not to overlap h1's exit
export function makeHeadline(parent, text, { size, weight = 600, ease = E.outExpo, inDur = 0.5, outDur = 0.12, stagger = 0.05, minReadable } = {}) {
  const words = text.split(" ");
  const guard = minReadable ?? (words.length >= 5 ? 1.3 : 0.8);
  const exitDur = outDur + stagger * 0.3 * (words.length - 1);
  const boxH = Math.ceil(size * 1.3);
  const clip = h("div", { class: "abs", style: { overflow: "hidden", height: px(boxH) } }, parent);
  const row = h("div", { class: "abs nowrap", style: { fontSize: px(size), fontWeight: weight, lineHeight: 1 } }, clip);
  const spans = words.map((w, i) => h("span", { text: w + (i < words.length - 1 ? " " : ""), style: { display: "inline-block" } }, row));
  return {
    el: clip, row, guard, exitDur,
    exitAt(tIn, tOut = Infinity) { return Math.max(tOut, tIn + guard); },
    render(t, tIn, tOut = Infinity) {
      const xa = this.exitAt(tIn, tOut);
      if (!show(clip, t >= tIn && t < xa + exitDur + 1 / 60)) return;
      spans.forEach((sp, i) => {
        const pin = ease(prog(t, tIn + i * stagger, inDur));
        const pout = E.inCubic(prog(t, xa + (spans.length - 1 - i) * stagger * 0.3, outDur));
        sp.style.transform = `translateY(${((1 - pin) + pout) * boxH}px)`;
      });
    },
  };
}

// -------------------------------------------------------------- anticipation ring ----
// A static hold before a drop looks dead. Close a hairline ring onto the hit point on an
// ease-in, arriving just before the beat: render() returns the anticipation progress (0->1) so the
// caller can drive a matching <= 1 px deterministic tremble and brightness/size swell on the target
// itself with tremble() -- the anticipation beat still has secondary motion, so it never reads as a
// frozen hold in the lag proof.
//
//   const ring = anticipationRing(svg);
//   const a = ring.render(t, C.anticipate, C.drop, [px, py]);       // 0 outside the window
//   const [dx, dy] = tremble(t, 5, a);
//   dot.setAttribute("cx", px + dx); dot.setAttribute("cy", py + dy);
export function anticipationRing(parent, { color = "currentColor", width = 1.5, startRadius = 320 } = {}) {
  const ring = s("circle", { fill: "none", stroke: color, "stroke-width": width }, parent);
  return {
    el: ring,
    render(t, tStart, tHit, [x, y], radius = 3) {
      const on = t >= tStart && t < tHit;
      if (!show(ring, on)) return 0;
      const a = E.inCubic(prog(t, tStart, Math.max(tHit - 0.02 - tStart, 1e-3)));
      set(ring, { cx: x, cy: y, r: lerp(startRadius, radius, a), opacity: 0.75 * clamp((t - tStart) / 0.06) });
      return a;
    },
  };
}
// <= 1 px deterministic tremble (amp scales 0..1, e.g. from anticipationRing's progress): a designed
// still beat keeps *something* moving instead of freezing outright.
export function tremble(t, seed, amp = 1) {
  const a = 0.9 * amp;
  return [a * noise1(t * 47, seed), a * noise1(t * 47, seed + 4)];
}

// ------------------------------------------------------ feathered radial-mask reveal ----
// A rectangular quadrant clip on a filled shape leaves a straight notch edge at the hub. Masking
// the clipped group with a soft-edged radial gradient (opaque near the hub, feathered outward)
// hides the notch. `stops` is an alpha ramp as [offset, colour] pairs on a black/white gradient
// (black = hidden, white = shown): the default keeps the hub itself unmasked (opaque black -> not
// wiped) with a soft feather from 0.16 to 0.34 of `radius`.
//
//   const mask = radialFeatherMask(defs, "armMask", hubX, hubY, 80, { x: bx, y: by, w: bw, h: bh, pad: 20 });
//   clippedGroup.setAttribute("mask", `url(#${mask.id})`);
export function radialFeatherMask(defs, id, cx, cy, radius, bbox, stops = [[0, "#000"], [0.16, "#000"], [0.34, "#fff"], [1, "#fff"]]) {
  const gradId = `${id}Grad`;
  const grad = s("radialGradient", { id: gradId, gradientUnits: "userSpaceOnUse", cx, cy, r: radius }, defs);
  stops.forEach(([offset, color]) => s("stop", { offset, "stop-color": color }, grad));
  const mask = s("mask", { id, maskUnits: "userSpaceOnUse", x: bbox.x - bbox.pad, y: bbox.y - bbox.pad, width: bbox.w + 2 * bbox.pad, height: bbox.h + 2 * bbox.pad }, defs);
  s("rect", { x: bbox.x - bbox.pad, y: bbox.y - bbox.pad, width: bbox.w + 2 * bbox.pad, height: bbox.h + 2 * bbox.pad, fill: `url(#${gradId})` }, mask);
  // `grad` is returned so a caller can animate the reveal per frame with set(mask.grad, { r: ... }),
  // e.g. a flood that grows outward from cx,cy (see scene-recipes.md's fill/outline crossfade recipe).
  return { id, gradId, mask, grad };
}

// -------------------------------------------------------------- fill/outline crossfade ----
// A plain opacity crossfade of a large filled shape reads as a flat grey panel partway through.
// Crossfading a FILL group against a matching OUTLINE (stroke-only) group of the same paths never
// does, because a stroke at partial opacity still reads as a clean line. render(p): p=0 is pure
// outline, p=1 is pure fill. Pair with a growing radialFeatherMask on the fill group for a reveal
// that floods outward from one point instead of fading in everywhere at once (see
// references/scene-recipes.md).
export function fillOutlineCrossfade(parent, paths, { fill = "currentColor", stroke = "currentColor", strokeWidth = 1.6 } = {}) {
  const fillG = s("g", {}, parent), outlineG = s("g", {}, parent);
  const fillPaths = paths.map((d) => s("path", { d, fill }, fillG));
  const outlinePaths = paths.map((d) => s("path", { d, fill: "none", stroke, "stroke-width": strokeWidth, "stroke-linejoin": "round" }, outlineG));
  return { fillG, outlineG, fillPaths, outlinePaths, render(p) { fillG.setAttribute("opacity", p); outlineG.setAttribute("opacity", 1 - p); } };
}

// ------------------------------------------------------------------------- grain ----
// Grain as signed-alpha specks (white where the noise is positive, black where negative),
// composited NORMALLY. Never use a CSS blend mode (mix-blend-mode) for this: headless Chromium
// composited an overlay-blended grain layer against a stale backdrop and leaked pixels from a
// frame rendered earlier in the same page into a later one -- invisible in a spot check, and it
// corrupts any chunked or parallel render. Verify determinism with determinism.mjs (forward vs
// reversed frame order must render pixel-identical). Draw last, over everything.
//
// Default alpha is 0.09, not lower: a fast/high-CRF H.264 pass (this template's own `--preview`,
// `-preset veryfast -crf 20`) actively predicts static-looking regions from the previous frame and
// can crush a much subtler grain (measured: 0.045 alpha grain, a genuine per-frame difference
// before encoding, dropped to a near-zero lag-proof floor after that preview encode -- an
// encoder-survivability problem, not a lag-proof calibration problem; the final's slower/lower-CRF
// pass is markedly less destructive). If you still see a low floor with `lagproof.py --blocks` on
// the encode you actually ship, raise `alpha` before reaching for a lower `lagThreshold` -- a
// threshold tuned to a floor this close to zero would also let a genuinely frozen frame through.
//
//   const canvas = h("canvas", { width: W, height: H, class: "abs shot" }, cam);
//   const grain = createGrain(canvas, W, H, FPS);
//   // in render(t): grain.render(t);
export function createGrain(canvas, W, H, fps, { tiles = 6, size = 256, alpha = 0.16, seed = 77 } = {}) {
  const ctx = canvas.getContext("2d");
  const tileCanvases = Array.from({ length: tiles }, (_, k) => {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const tctx = c.getContext("2d"), img = tctx.createImageData(size, size);
    for (let p = 0; p < size * size; p++) {
      const nz = hash(p, k, seed) + hash(p, k, seed + 1) - 1; // triangular noise in [-1, 1]
      const v = nz > 0 ? 255 : 0;
      img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = v;
      img.data[p * 4 + 3] = Math.round(255 * alpha * Math.abs(nz));
    }
    tctx.putImageData(img, 0, 0);
    return c;
  });
  return {
    render(t) {
      const f = frameOf(t, fps), tile = tileCanvases[f % tiles];
      const ox = Math.floor(hash(f, 1, 3) * size), oy = Math.floor(hash(f, 2, 3) * size);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(-ox, -oy);
      ctx.fillStyle = ctx.createPattern(tile, "repeat");
      ctx.fillRect(0, 0, W + size, H + size);
      ctx.restore();
    },
  };
}

// ------------------------------------------------------ generated raster plates ----
// A generated raster plate (gen-image.mjs, references/generated-assets.md) is never trusted for
// exact colour -- grade it to the brand's own tokens with a deterministic SVG duotone filter (the
// standard recipe: desaturate to luminance with a colour matrix, then remap black->white to
// darkHex->lightHex per channel with a 2-stop feComponentTransfer table). Built once per plate at
// init; it is a filter graph, not a per-frame canvas pass, so it costs nothing in render(t).
//
//   const duo = duotoneFilter(defs, "plateDuo", brand.colors.ink, brand.colors.bg);
//   const img = h("img", { src: "generated/plate.png", style: { filter: `url(#${duo})` } }, parent);
function hexToUnit(hex) {
  const s0 = hex.replace("#", "");
  const [r, g, b] = s0.length === 3 ? [...s0].map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(s0.slice(i, i + 2), 16));
  return [r, g, b].map((v) => (v / 255).toFixed(4));
}
export function duotoneFilter(defs, id, darkHex, lightHex) {
  const [dr, dg, db] = hexToUnit(darkHex), [lr, lg, lb] = hexToUnit(lightHex);
  const f = s("filter", { id, "color-interpolation-filters": "sRGB" }, defs);
  s("feColorMatrix", { type: "matrix", values: "0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0" }, f);
  const xfer = s("feComponentTransfer", {}, f);
  s("feFuncR", { type: "table", tableValues: `${dr} ${lr}` }, xfer);
  s("feFuncG", { type: "table", tableValues: `${dg} ${lg}` }, xfer);
  s("feFuncB", { type: "table", tableValues: `${db} ${lb}` }, xfer);
  return id;
}
// Single-colour tint (a plate that should read as "brand-coloured", not two-tone): mathematically
// the same duotone recipe from black to `hex`, which reduces to output = luminance * hex per channel.
export function tintFilter(defs, id, hex) {
  return duotoneFilter(defs, id, "#000000", hex);
}

// ============================================ v1.2: product-demo + generative helpers ========

// -------------------------------------------------------------------- click ripple ----
// Product demos: an expanding, fading ring from a point -- the "you just clicked here" cue.
// Opposite of anticipationRing (which closes INWARD before a hit); this opens OUTWARD after one.
//
//   const ripple = clickRipple(svg);
//   ripple.render(t, C.click1, [cursorX, cursorY]);   // 0 before tClick, expands+fades over `duration`
export function clickRipple(parent, { color = "currentColor", maxRadius = 28, duration = 0.4 } = {}) {
  const ring = s("circle", { fill: "none", stroke: color, "stroke-width": 2 }, parent);
  return {
    el: ring,
    render(t, tClick, [x, y]) {
      const p = prog(t, tClick, duration);
      if (!show(ring, t >= tClick && p < 1)) return;
      set(ring, { cx: x, cy: y, r: lerp(2, maxRadius, E.outCubic(p)), opacity: 0.8 * (1 - p) });
    },
  };
}

// ---------------------------------------------------------------------- typewriter ----
// Characters appear in ORDER with a blinking caret -- a form field, search bar, chat input in a
// product demo. Distinct from decode() (glyphs scramble into place; monospace data only):
// typewriter is plain sequential reveal, any font.
//
//   const tw = typewriter(row, "invoice-2024.pdf");
//   tw.render(t, C.type1);   // reveals at charsPerSec from tStart; caret blinks once done
export function typewriter(parent, str, { charsPerSec = 18, blinkHz = 2, style = {} } = {}) {
  const el = h("span", { style }, parent);
  const caret = h("span", { text: "|", style: { marginLeft: "1px" } }, parent);
  return {
    el, caret,
    render(t, tStart) {
      const on = t >= tStart;
      show(el, on);
      show(caret, on);
      if (!on) return;
      const d = t - tStart;
      const n = Math.min(str.length, Math.floor(d * charsPerSec));
      el.textContent = str.slice(0, n);
      const done = n >= str.length;
      caret.style.opacity = done ? (Math.floor(t * blinkHz * 2) % 2 ? 0 : 1) : 1;
    },
  };
}

// ------------------------------------------------------- deterministic WebGL/GLSL background ----
// Time comes ONLY from the `uTime` uniform driven by render(t) -- no requestAnimationFrame loop, no
// internal clock, nothing but the argument. `preserveDrawingBuffer: true` is required: without it a
// screenshot taken right after render() can read a buffer the browser has already swapped or
// cleared, not the frame just drawn. Seed the shader instead of any source of real randomness (a
// `uSeed` uniform, or hardcoded constants in a GLSL hash function) so the same t always produces
// bit-identical pixels -- REQUIRED to verify with determinism.mjs before using this in a project. If
// headless Chromium's GPU/software rasterizer path on your machine is not bit-identical run to run,
// do not ship WebGL for that project: fall back to the canvas-2D noise pattern in this recipe's
// companion note (references/scene-recipes.md) instead of claiming determinism you have not proven.
//
//   const canvas = h("canvas", { width: W, height: H, class: "abs shot" }, cam);
//   const bg = createGLBackground(canvas, fragmentShaderSource, { seed: 7 });
//   // in render(t): bg.render(t);
export function createGLBackground(canvas, fragmentSrc, { seed = 1 } = {}) {
  const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, antialias: false, alpha: false });
  if (!gl) throw new Error("WebGL unavailable in this browser/context");
  const vs = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
    return sh;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragmentSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "program link failed");
  gl.useProgram(prog);
  // One oversized triangle covers the viewport with no seam (cheaper than two triangles / a quad).
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uTime = gl.getUniformLocation(prog, "uTime");
  const uSeed = gl.getUniformLocation(prog, "uSeed");
  const uRes = gl.getUniformLocation(prog, "uRes");
  gl.viewport(0, 0, canvas.width, canvas.height);
  return {
    gl,
    render(t) {
      gl.uniform1f(uTime, t);
      if (uSeed) gl.uniform1f(uSeed, seed);
      if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

// ================================================================ v1.2: device frames ====
// references/device-frames.md has the full rules (Apple App Store Marketing Guidelines + Design
// Resources licence). Summary: an OFFICIAL bezel PNG ships "as is" -- no transform, no crop, no
// shadow, cut in/out only -- and never lives inside this skill (redistribution is not permitted).
// A device shot that needs to move (tilt, spin, zoom-through) uses the GENERIC frame instead.

function roundedRectPath(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;
}

// --------------------------------------------- device SVG frame contract (bundled/user/generic) ----
// A frame SVG -- generic, or a licensed community/user-library export -- declares three layers by
// id, in this exact structure:
//   <g id="body">...</g>                     drawn first -- the device chrome (opaque)
//   <rect id="screen" fill="none" .../>       (or a <path>) the screen's geometry -- never itself
//                                              rendered; used only to clip screen content and to
//                                              measure the content rect
//   <g id="overlay">...</g>                  drawn last -- Dynamic Island / camera / notch, ON TOP
//                                              of screen content, exactly as on a real device
// A bundled or user-library frame is loaded with loadDeviceSVG(); the generic frame is built
// in-memory by genericDeviceFrame() to the SAME contract, so both compose through the same
// deviceFrameShot(). This is layered compositing (the bezel under the screen is opaque) -- NOT the
// same thing as an official Apple bezel PNG, which is one opaque image with a transparent hole and
// composes through loadDeviceFrame()/officialDeviceShot() below instead (the alpha-hole path).

// Fetches and validates a frame SVG against the contract above. Throws if #body or #screen is
// missing -- a frame that doesn't declare a screen has nothing for deviceFrameShot() to clip to.
export async function loadDeviceSVG(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`cannot load device frame ${url}: ${r.status}`);
  const doc = new DOMParser().parseFromString(await r.text(), "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error(`${url} is not a valid SVG`);
  const body = svg.querySelector("#body");
  const screen = svg.querySelector("#screen");
  const overlay = svg.querySelector("#overlay");
  if (!body || !screen) throw new Error(`${url} does not follow the device frame contract (#body and #screen are required)`);
  const vb = (svg.getAttribute("viewBox") || `0 0 ${svg.getAttribute("width")} ${svg.getAttribute("height")}`).split(/[\s,]+/).map(Number);
  return { body, screen, overlay, vb };
}

// A parametric, brand-neutral device frame built to the same contract as loadDeviceSVG() -- so it
// composes through deviceFrameShot() exactly like a bundled or user-library frame. Punch-hole
// camera only: no Home button, sensor housing, Ring/Silent switch or other side control -- nothing
// that reads as a specific real product (the App Store guidelines' bar for a "generic" device).
export function genericDeviceFrame({ w = 375, h = 812, radius = 44, bezel = 14, color = "#111318", cameraR = 6 } = {}) {
  const sx = bezel, sy = bezel, sw = w - 2 * bezel, sh = h - 2 * bezel, sr = Math.max(0, radius - bezel * 0.6);
  const body = s("g", { id: "body" });
  body.appendChild(s("path", { d: `${roundedRectPath(0, 0, w, h, radius)} ${roundedRectPath(sx, sy, sw, sh, sr)}`, "fill-rule": "evenodd", fill: color }));
  const screen = s("rect", { id: "screen", x: sx, y: sy, width: sw, height: sh, rx: sr, fill: "none" });
  const overlay = s("g", { id: "overlay" });
  overlay.appendChild(s("circle", { cx: w / 2, cy: bezel / 2 + 2, r: cameraR, fill: "#000" }));
  return { body, screen, overlay, vb: [0, 0, w, h] };
}

// Composites body -> screen content (clipped to #screen's exact shape, rect OR path) -> overlay,
// inside one SVG at the frame's viewBox. Returns a plain DOM element -- freely animatable
// (tf()/zoomAbout() work on `.el` like any other layer) for both the generic frame and a licensed
// bundled/user-library SVG frame alike.
//
//   const frame = genericDeviceFrame({ w: 375, h: 812, color: brand.colors.ink });
//   const shot = deviceFrameShot(cam, frame, screenContentEl, { recolor: "silver" });
//   // in render(t): tf(shot.el, x, y, scale, rotation);
export function deviceFrameShot(parent, frameDoc, screenContent, { recolor } = {}) {
  const [, , vw, vh] = frameDoc.vb;
  const el = h("div", { class: "abs", style: { width: px(vw), height: px(vh) } }, parent);
  const svg = s("svg", { width: vw, height: vh, viewBox: frameDoc.vb.join(" "), class: "abs" }, el);

  const body = document.importNode(frameDoc.body, true);
  if (recolor) for (const node of body.querySelectorAll("[fill]")) if (node.getAttribute("fill") !== "none") node.setAttribute("fill", recolor);
  svg.appendChild(body);

  const defs = s("defs", {}, svg);
  const clipId = `dev-clip-${Math.random().toString(36).slice(2, 9)}`;
  const clip = s("clipPath", { id: clipId }, defs);
  clip.appendChild(document.importNode(frameDoc.screen, true));

  // getBBox() needs the node attached and laid out; measure from a temporary copy, then discard it
  // (the real clip shape above stays inside <clipPath>, never rendered on its own -- fill:none).
  const probe = document.importNode(frameDoc.screen, true);
  svg.appendChild(probe);
  const box = probe.getBBox();
  svg.removeChild(probe);

  const clipped = s("g", { "clip-path": `url(#${clipId})` }, svg);
  const fo = s("foreignObject", { x: box.x, y: box.y, width: box.width, height: box.height }, clipped);
  fo.appendChild(screenContent);

  if (frameDoc.overlay) svg.appendChild(document.importNode(frameDoc.overlay, true));

  return { el, screen: { x: box.x, y: box.y, w: box.width, h: box.height } };
}

// --------------------------------------------------------- official Apple bezel PNG (alpha-hole) ----
// Reads the JSON sidecar `detect-frame.py` writes next to an official bezel PNG: { file,
// imageWidth, imageHeight, screen: { x, y, w, h, radius } } detected from the PNG's own alpha
// channel (the transparent screen cut-out). NOT the layered SVG contract above -- an official
// export is one opaque image with a hole, never a body/screen/overlay group.
export async function loadDeviceFrame(url) {
  return loadJSON(url);
}

// Composites screen content under an OFFICIAL bezel PNG at the rect its sidecar detected. This
// helper is deliberately transform-free: the only motion it exposes is a hard show/hide (render's
// `on` flag), matching Apple's "as is, cut in/out only" rule -- never wrap the returned `el` in a
// transform, crop, filter or animated ancestor. A shot that needs to move uses genericDeviceFrame()
// + deviceFrameShot() instead.
//
//   const frame = await loadDeviceFrame("brand/devices/iphone.png.json");
//   const shot = officialDeviceShot(cam, frame, screenContentEl);
//   // in render(t): shot.render(t >= C.reveal && t < C.cutaway);
export function officialDeviceShot(parent, frame, screenContent) {
  const { file, imageWidth: w, imageHeight: hh, screen } = frame;
  const el = h("div", { class: "abs", style: { width: px(w), height: px(hh) } }, parent);
  const slot = h("div", { class: "abs", style: {
    left: px(screen.x), top: px(screen.y), width: px(screen.w), height: px(screen.h),
    borderRadius: px(screen.radius), overflow: "hidden",
  } }, el);
  slot.appendChild(screenContent);
  h("img", { src: file, class: "abs", style: { width: px(w), height: px(hh), pointerEvents: "none" } }, el);
  return { el, render(on = true) { show(el, on); } };
}

// Deterministic screen-recording playback: an index picked from t, never a <video> element (not
// synchronously seekable frame-by-frame under parallel/out-of-order capture -- the same non-
// determinism createGrain's WHY-comment warns about for CSS blend modes). Pre-extract at
// prep time: `ffmpeg -i recording.mp4 -vf fps=<fps> frames/%05d.png`.
//
//   const frame = screenFrame("frames", 240, 30);
//   img.src = frame(t);   // same t -> same path, every time
export function screenFrame(framesDir, count, fps, pad = 5) {
  return (t) => `${framesDir}/${String(Math.min(count - 1, Math.max(0, Math.round(t * fps))) + 1).padStart(pad, "0")}.png`;
}
