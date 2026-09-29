// The studio page (studio.html) driving the composition in a real Chromium, plus the engine's
// window.__state(t) hook. Needs playwright-core and a headless shell (see _helpers.mjs); without them
// every test here is skipped with a message and the run is only partial.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assembleProject, browserUnavailable, findChrome, loadPlaywright, sleep, tmpDir } from "./_helpers.mjs";

const skip = browserUnavailable() ?? false;
if (skip) console.log(`  (studio shell tests skipped: ${skip})`);
const it = (name, fn) => test(name, { skip }, fn);

const base = fs.realpathSync(tmpDir("mv-shell-"));
const root = path.join(base, "proj");
let studio, browser;
before(async () => {
  if (skip) return;
  assembleProject(root);
  const { startStudio } = await import(pathToFileURL(path.join(root, "studio.mjs")).href);
  studio = await startStudio({ root, port: 0, log: () => {} });
  browser = await loadPlaywright().chromium.launch({ executablePath: findChrome() });
});
after(async () => {
  await browser?.close();
  await studio?.close();
  fs.rmSync(base, { recursive: true, force: true });
});

// A page in its own context (so its localStorage is its own), waited until the composition is ready.
async function open(query = "", { context, route, waitReady = true } = {}) {
  context ??= await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  if (route) await route(page);
  await page.goto(studio.url + query);
  if (waitReady) await page.waitForFunction(() => window.__studio?.ready === true, null, { timeout: 15000 });
  return page;
}
const readout = (page) => page.evaluate(() => Object.fromEntries(["rt", "rf", "rb", "rc", "rn", "rs"].map((id) => [id, document.getElementById(id).textContent])));
const studioState = (page) => page.evaluate(() => ({ t: __studio.t, rendered: __studio.rendered, playing: __studio.playing, loads: __studio.loads, ready: __studio.ready, audioClock: __studio.audioClock, audioState: __studio.audioState }));
const audioReady = (page) => page.waitForFunction(() => window.__studio.audioSeconds !== null, null, { timeout: 15000 });
const overlay = (page) => page.evaluate(() => ({ hidden: document.getElementById("overlay").hidden, title: document.getElementById("errTitle").textContent, body: document.getElementById("errBody").textContent }));
const waitOverlay = (page, hidden, timeout = 8000) => page.waitForFunction((h) => document.getElementById("overlay").hidden === h, hidden, { timeout });

// Runs fn with a project file replaced, and always puts the original back (then waits for the reload).
async function withFile(name, transform, fn) {
  const file = path.join(root, name);
  const original = fs.readFileSync(file, "utf8");
  try {
    fs.writeFileSync(file, transform(original));
    await fn();
  } finally {
    fs.writeFileSync(file, original);
  }
}

// ---------------------------------------------------------------- the engine hook ----
it("window.__state(t) reports bar, beat, cue, next cue and the scenes on screen", async () => {
  const page = await open();
  const at = (t) => page.evaluate((tt) => { const w = document.getElementById("comp").contentWindow; w.renderAt(tt); return w.__state(tt); }, t);
  const s0 = await at(0);
  assert.deepEqual([s0.t, s0.frame, s0.bar, s0.beat], [0, 0, 1, 1]);
  assert.deepEqual(s0.cue, { name: "open", t: 0 });
  assert.equal(s0.next.name, "word1");
  assert.ok(Math.abs(s0.next.in - 0.46875) < 1e-9);
  assert.deepEqual(s0.scenes, [{ index: 3, name: "title" }]);

  const s2 = await at(2);
  assert.deepEqual([s2.frame, s2.bar, s2.beat], [120, 2, 1]);
  assert.deepEqual(s2.cue, { name: "drop", t: 1.875 });
  assert.equal(s2.next.name, "item1");
  assert.deepEqual(s2.scenes.map((s) => s.name), ["hud", "features", "title"]);

  const s7 = await at(7.4);
  assert.deepEqual([s7.bar, s7.beat, s7.cue.name, s7.next.name], [4, 4, "tagline", "end"]);
  assert.deepEqual(s7.scenes.map((s) => s.name), ["hud", "lockup"]);

  const past = await at(99), before0 = await at(-1);
  assert.ok(past.t < 7.5 && past.t > 7.49, "t is clamped the way renderAt clamps it");
  assert.equal(before0.t, 0);
  await page.context().close();
});

it("__state is a pure read: it changes nothing in the DOM or on the canvas, and renderAt paints the same after it", async () => {
  const page = await open();
  const result = await page.evaluate(() => {
    const w = document.getElementById("comp").contentWindow, d = w.document;
    const snap = () => d.documentElement.outerHTML + "|" + [...d.querySelectorAll("canvas")].map((c) => c.toDataURL()).join("|");
    w.renderAt(2);
    const painted = snap();
    for (const t of [0, 0.3, 1.9, 2.5, 3.7, 7.4, 99, -1, 2]) w.__state(t);
    const afterState = snap();
    w.renderAt(2);
    return { untouched: painted === afterState, repaintsIdentically: painted === snap(), length: painted.length };
  });
  assert.ok(result.length > 1000, "something was actually compared");
  assert.equal(result.untouched, true);
  assert.equal(result.repaintsIdentically, true);
  await page.context().close();
});

it("a plain load of index.html knows nothing of the studio: no rAF, no interval, no studio requests", async () => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const paths = [];
  page.on("request", (r) => paths.push(new URL(r.url()).pathname));
  await page.addInitScript(() => {
    window.__raf = 0; window.__intervals = 0;
    const raf = window.requestAnimationFrame, iv = window.setInterval;
    window.requestAnimationFrame = (f) => { window.__raf++; return raf(f); };
    window.setInterval = (...a) => { window.__intervals++; return iv(...a); };
  });
  await page.goto(`${studio.url}index.html?t=1`);
  // polling by interval, not the default rAF polling: Playwright's own requestAnimationFrame calls would be counted below
  await page.waitForFunction(() => window.__ready === true, null, { polling: 50 });
  await sleep(600);
  assert.deepEqual(await page.evaluate(() => [window.__raf, window.__intervals, typeof window.__studio, typeof EventSource]), [0, 0, "undefined", "function"]);
  assert.ok(paths.includes("/engine.js") && paths.includes("/timeline.json"), `saw ${paths}`);
  assert.deepEqual(paths.filter((p) => p.startsWith("/__events") || p.startsWith("/api/") || p === "/studio.html"), []);
  await context.close();
});

// -------------------------------------------------------------------- the player ----
it("the composition runs in an iframe at the video's own size, scaled to fit, and rescales on resize", async () => {
  const page = await open();
  const geom = () => page.evaluate(() => {
    const f = document.getElementById("comp"), r = f.getBoundingClientRect(), v = document.getElementById("viewport").getBoundingClientRect();
    return { w: f.style.width, h: f.style.height, rw: r.width, rh: r.height, inside: r.left >= v.left - 1 && r.right <= v.right + 1 && r.top >= v.top - 1 && r.bottom <= v.bottom + 1,
      stageW: f.contentDocument.getElementById("stage").getBoundingClientRect().width, max: document.getElementById("scrub").max, name: document.getElementById("name").textContent };
  });
  const g = await geom();
  assert.deepEqual([g.w, g.h, g.stageW, g.max], ["1920px", "1080px", 1920, "449"]);
  assert.ok(g.rw < 1920 && Math.abs(g.rw / g.rh - 16 / 9) < 0.01 && g.inside, `iframe box ${g.rw}x${g.rh}`);
  assert.match(g.name, /1920x1080 @ 60/);
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForFunction((w) => document.getElementById("comp").getBoundingClientRect().width < w, g.rw);
  const small = await geom();
  assert.equal(small.stageW, 1920, "the composition is still laid out at 1920 px: only the iframe is scaled");
  assert.ok(small.inside);
  await page.context().close();
});

it("moving the scrubber calls renderAt with that time and updates the readout", async () => {
  const page = await open();
  await page.evaluate(() => {
    const w = document.getElementById("comp").contentWindow, real = w.renderAt;
    window.__calls = [];
    w.renderAt = (t) => { window.__calls.push(t); return real(t); };
  });
  assert.deepEqual(await page.evaluate(() => window.__calls), [], "nothing is painted until something moves");
  await page.locator("#scrub").fill("120");
  assert.equal(await page.evaluate(() => window.__calls.at(-1)), 2);
  const st = await studioState(page);
  assert.deepEqual([st.t, st.rendered], [2, 2]);
  assert.deepEqual(await readout(page), { rt: "2.000", rf: "120", rb: "2.1", rc: "drop @ 1.875", rn: "item1 in 0.34 s", rs: "hud, features, title" });
  await page.locator("#scrub").fill("300");
  assert.equal(await page.evaluate(() => window.__calls.at(-1)), 5, "and again at another time");
  assert.equal((await readout(page)).rs, "hud, lockup");
  await page.context().close();
});

it("?t= starts at that time and ?loop=a:b turns the loop on for that range", async () => {
  const page = await open("?t=3.5&loop=1:2");
  assert.equal((await studioState(page)).rendered, 3.5);
  assert.deepEqual(await readout(page), { rt: "3.500", rf: "210", rb: "2.4", rc: "item3 @ 3.281", rn: "lock in 0.25 s", rs: "hud, features" });
  assert.equal(await page.getAttribute("#loop", "aria-pressed"), "true");
  assert.match(await page.textContent("#loop"), /1\.00–2\.00/);
  const plain = await open("");
  assert.equal(await plain.getAttribute("#loop", "aria-pressed"), "false");
  await page.context().close();
  await plain.context().close();
});

it("arrows step one frame, Shift+arrows one beat, Space plays and pauses, L toggles the loop", async () => {
  const page = await open();
  const frame = async () => (await readout(page)).rf;
  await page.keyboard.press("ArrowRight");
  assert.equal(await frame(), "1");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await frame(), "1");
  await page.keyboard.press("Shift+ArrowRight");
  assert.equal(await frame(), String(Math.round(0.46875 * 60)), "the next beat boundary, snapped to a frame");
  await page.keyboard.press("Shift+ArrowLeft");
  assert.equal(await frame(), "0");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await frame(), "0", "no stepping before the first frame");
  await page.keyboard.press("End");
  assert.equal(await frame(), "449");
  await page.keyboard.press("ArrowRight");
  assert.equal(await frame(), "449", "nor past the last");
  await page.keyboard.press("l");
  assert.equal(await page.getAttribute("#loop", "aria-pressed"), "true");
  await page.keyboard.press("L");
  assert.equal(await page.getAttribute("#loop", "aria-pressed"), "false");
  assert.equal((await studioState(page)).playing, false);
  await page.context().close();
});

it("Space plays from where it is; the Web Audio clock drives time exactly when the AudioContext runs, the wall clock otherwise", async () => {
  const page = await open("?t=2");
  await audioReady(page);
  assert.equal(await page.evaluate(() => Math.round(__studio.audioSeconds * 10) / 10), 7.5, "the regenerated WAV decodes to the video's length");
  await page.keyboard.press("Space");
  await sleep(1000);
  const running = await studioState(page);
  assert.equal(running.playing, true);
  assert.ok(running.t > 2.5 && running.t < 3.6, `t=${running.t} after about a second from 2.0`);
  // A machine with no audio output may never get a running AudioContext. That is not a failure of the
  // studio: it must then fall back to the wall clock. Where the context does run, the audio clock must be in charge.
  console.log(`  AudioContext state: ${running.audioState}; clock: ${running.audioClock ? "Web Audio" : "wall"}`);
  assert.equal(running.audioClock, running.audioState === "running", `AudioContext is ${running.audioState} but audioClock is ${running.audioClock}`);
  await page.keyboard.press("Space");
  const paused = await studioState(page);
  assert.equal(paused.playing, false);
  assert.ok(Math.abs(paused.t * 60 - Math.round(paused.t * 60)) < 1e-6, "paused on a whole frame");
  assert.equal(paused.rendered, paused.t, "and that frame is what is painted");
  await sleep(300);
  assert.equal((await studioState(page)).t, paused.t, "paused stays put");
  await page.context().close();
});

it("on a machine whose AudioContext never runs (no audio output) it plays on the wall clock", async () => {
  const page = await open("?t=1", {
    route: (p) => p.addInitScript(() => {
      const Real = window.AudioContext;
      window.AudioContext = class extends Real { get state() { return "suspended"; } resume() { return Promise.resolve(); } };
    }),
  });
  await audioReady(page);
  await page.keyboard.press("Space");
  await sleep(900);
  const st = await studioState(page);
  assert.equal(st.audioState, "suspended");
  assert.equal(st.audioClock, false);
  assert.equal(st.playing, true);
  assert.ok(st.t > 1.5 && st.t < 2.3, `t=${st.t}: time still advances`);
  await page.keyboard.press("Space");
  await page.context().close();
});

it("without a soundtrack it plays on the wall clock, and the pill says why", async () => {
  const page = await open("?t=1", { route: (p) => p.route("**/out/studio-audio.wav*", (r) => r.abort()) });
  await page.waitForFunction(() => document.getElementById("audio").textContent.includes("could not load"), null, { timeout: 8000 });
  await page.keyboard.press("Space");
  await sleep(800);
  const st = await studioState(page);
  assert.equal(st.audioClock, false);
  assert.ok(st.t > 1.4 && st.t < 2.2, `t=${st.t}`);
  await page.keyboard.press("Space");
  await page.context().close();
});

it("with loop on, playback stays inside the loop range; without it the same start runs past it", async () => {
  const looped = await open("?t=1.5&loop=1:2");
  await looped.keyboard.press("Space");
  const seen = [];
  for (let i = 0; i < 12; i++) { await sleep(150); seen.push((await studioState(looped)).t); }
  await looped.keyboard.press("Space");
  assert.ok(seen.every((t) => t >= 1 - 0.02 && t <= 2 + 0.02), `t left the loop: ${seen}`);
  assert.ok(seen.some((t, i) => i && t < seen[i - 1]), `it never wrapped: ${seen}`);
  const free = await open("?t=1.5");
  await free.keyboard.press("Space");
  await sleep(1200);
  assert.ok((await studioState(free)).t > 2.05, "control: without the loop it runs past 2.0");
  await free.keyboard.press("Space");
  await looped.context().close();
  await free.context().close();
});

it("the latency offset is remembered between visits", async () => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const first = await open("", { context });
  await first.locator("#latency").fill("120");
  assert.equal(await first.textContent("#latencyOut"), "120 ms");
  const second = await open("", { context });
  assert.equal(await second.inputValue("#latency"), "120");
  assert.equal(await second.textContent("#latencyOut"), "120 ms");
  await context.close();
});

// ------------------------------------------------------------------------- notes ----
const feedbackFile = path.join(root, "feedback.json");
const readNotes = () => JSON.parse(fs.readFileSync(feedbackFile, "utf8")).notes;
const seed = (notes) => fs.writeFileSync(feedbackFile, JSON.stringify({ version: 1, notes }));
const fakeNote = (id, t, over = {}) => ({
  id, createdAt: "2026-01-01T00:00:00.000Z", status: "open", t, frame: Math.round(t * 60), point: { x: 400, y: 300, stage: { x: 400, y: 300 } },
  context: { bar: 1, beat: 1, cue: null, next: null, scene: { index: 1, name: "features" } }, target: { tag: "div", class: "", text: `target ${id}`, rect: { x: 0, y: 0, w: 1, h: 1 }, path: "#stage" },
  text: `note ${id}`, resolution: null, ...over,
});
// The frame-space geometry of the settled "Deterministic frames" row at the current t, plus the camera's matrix.
const rowGeometry = (page) => page.evaluate(() => {
  const doc = document.getElementById("comp").contentDocument;
  const el = [...doc.querySelectorAll("div")].find((d) => d.children.length === 0 && d.textContent === "Deterministic frames");
  const b = el.getBoundingClientRect(), m = new DOMMatrixReadOnly(doc.defaultView.getComputedStyle(doc.getElementById("stage").firstElementChild).transform);
  const s = document.getElementById("stack").getBoundingClientRect();
  return { rect: { x: b.x, y: b.y, w: b.width, h: b.height }, stack: { left: s.left, top: s.top, scale: s.width / 1920 }, m: { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f } };
});
const clickFrame = (page, g, vx, vy) => page.mouse.click(g.stack.left + vx * g.stack.scale, g.stack.top + vy * g.stack.scale);

it("clicking an element leaves a note with the right time, target, scene and camera-free point", async () => {
  fs.rmSync(feedbackFile, { force: true });
  const page = await open("?t=3");
  const g = await rowGeometry(page);
  const cx = g.rect.x + g.rect.w / 2, cy = g.rect.y + g.rect.h / 2;
  await clickFrame(page, g, cx, cy);
  await page.waitForFunction(() => !document.getElementById("noteBox").hidden);
  assert.equal((await studioState(page)).playing, false);
  assert.match(await page.textContent("#noteCtx"), /Deterministic frames/, "the box says what was pointed at");
  await page.fill("#noteText", "make this bigger");
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => __studio.notes.length === 1);
  assert.equal(await page.isHidden("#noteBox"), true);

  const [n] = readNotes();
  assert.ok(Math.abs(n.t - 3) <= 1 / 60 && Math.abs(n.frame - 180) <= 1, `t=${n.t} frame=${n.frame}`);
  assert.equal(n.text, "make this bigger");
  assert.equal(n.status, "open");
  assert.equal(n.target.text, "Deterministic frames");
  assert.equal(n.target.tag, "div");
  assert.match(n.target.path, /^#stage > div\.shot:nth-child\(\d+\) > div\.shot:nth-child\(\d+\) > /, "a path from the stage down through the scene");
  for (const k of ["x", "y", "w", "h"]) assert.ok(Math.abs(n.target.rect[k] - g.rect[k]) <= 1, `rect.${k}: ${n.target.rect[k]} vs ${g.rect[k]}`);
  assert.ok(Math.abs(n.point.x - cx) <= 2 && Math.abs(n.point.y - cy) <= 2, `point ${n.point.x},${n.point.y} vs click ${cx},${cy}`);
  // camera-free: pushing the stage point through the camera's own matrix lands back on the clicked point
  const { a, b, c, d, e, f } = g.m;
  const back = { x: a * n.point.stage.x + c * n.point.stage.y + e, y: b * n.point.stage.x + d * n.point.stage.y + f };
  assert.ok(Math.abs(back.x - n.point.x) <= 0.5 && Math.abs(back.y - n.point.y) <= 0.5, `stage ${JSON.stringify(n.point.stage)} maps to ${JSON.stringify(back)}, not the point`);
  assert.ok(Math.abs(n.point.stage.x - n.point.x) + Math.abs(n.point.stage.y - n.point.y) > 3, "the camera has moved by t=3, so stage and point differ (the test can tell them apart)");
  const st = await page.evaluate(() => document.getElementById("comp").contentWindow.__state(3));
  assert.deepEqual([n.context.bar, n.context.beat, n.context.scene.name], [st.bar, st.beat, "features"]);
  assert.deepEqual(n.context.cue, st.cue);
  assert.deepEqual(n.context.next, { name: st.next.name, in: st.next.in });

  // it shows up in the panel and as a pin on the frame
  assert.equal(await page.locator("#openNotes li").count(), 1);
  assert.match(await page.textContent("#openNotes li"), /make this bigger/);
  assert.equal(await page.locator("#pins .pin").count(), 1);
  await page.context().close();
});

it("clicking while playing pauses on that frame; Escape drops the note and nothing is written", async () => {
  fs.rmSync(feedbackFile, { force: true });
  const page = await open("?t=1");
  await page.keyboard.press("Space");
  await sleep(300);
  assert.equal((await studioState(page)).playing, true);
  const g = await rowGeometry(page).catch(() => null);
  const s = await page.evaluate(() => { const r = document.getElementById("stack").getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; });
  await page.mouse.click(s.left + s.w / 2, s.top + s.h / 2);
  await page.waitForFunction(() => !document.getElementById("noteBox").hidden);
  const st = await studioState(page);
  assert.equal(st.playing, false, "the click paused");
  assert.equal(await page.evaluate(() => __studio.draft.t === __studio.t), true, "and the note is for the frame that is showing");
  await page.keyboard.press("Escape");
  assert.equal(await page.isHidden("#noteBox"), true);
  assert.equal(await page.evaluate(() => __studio.draft), null);
  await sleep(300);
  assert.equal(fs.existsSync(feedbackFile), false);
  void g;
  await page.context().close();
});

it("typing a note does not play, pause or seek", async () => {
  fs.rmSync(feedbackFile, { force: true });
  const page = await open("?t=2");
  const s = await page.evaluate(() => { const r = document.getElementById("stack").getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; });
  await page.mouse.click(s.left + s.w / 3, s.top + s.h / 3);
  await page.waitForFunction(() => !document.getElementById("noteBox").hidden);
  await page.keyboard.type("a b l ");
  for (const k of ["ArrowRight", "ArrowLeft", "Shift+ArrowRight", "Home", "End"]) await page.keyboard.press(k);
  await sleep(200);
  const st = await studioState(page);
  assert.deepEqual([st.playing, st.t], [false, 2], "Space and the arrows went into the text box");
  assert.equal(await page.getAttribute("#loop", "aria-pressed"), "false", "and so did the L");
  assert.match(await page.inputValue("#noteText"), /^a b l /);
  await page.keyboard.press("Escape");
  assert.equal(await page.isHidden("#noteBox"), true);
  await page.context().close();
});

it("the notes panel lists open notes by time, jumps to one with its pin, and collapses the resolved", async () => {
  seed([fakeNote("n1", 5), fakeNote("n2", 1, { point: { x: 960, y: 540, stage: { x: 960, y: 540 } } }), fakeNote("n3", 3), fakeNote("n4", 2, { status: "resolved", resolution: "moved it" })]);
  const page = await open();
  await page.waitForFunction(() => __studio.notes.length === 4);
  const texts = await page.locator("#openNotes li .body").allTextContents();
  assert.deepEqual(texts, ["note n2", "note n3", "note n1"], "open notes are ordered by t");
  assert.equal(await page.locator("#doneNotes li").count(), 1);
  assert.equal(await page.evaluate(() => document.getElementById("doneBox").open), false, "resolved notes start collapsed");
  assert.match(await page.textContent("#doneBox summary"), /Resolved \(1\)/);

  await page.locator("#openNotes li").first().click();
  const st = await studioState(page);
  assert.deepEqual([st.t, st.playing], [1, false]);
  await page.waitForFunction(() => document.querySelectorAll("#pins .pin.sel").length === 1);
  const pin = await page.evaluate(() => { const p = document.querySelector("#pins .pin.sel").getBoundingClientRect(), s = document.getElementById("stack").getBoundingClientRect(); return { x: (p.left + p.width / 2 - s.left) / (s.width / 1920), y: (p.top + p.height / 2 - s.top) / (s.width / 1920) }; });
  assert.ok(Math.abs(pin.x - 960) <= 1 && Math.abs(pin.y - 540) <= 1, `pin at ${pin.x},${pin.y}`);
  await page.keyboard.press("End");
  assert.equal(await page.locator("#pins .pin").count(), 0, "the pin is only shown near the note's own frame");

  // the person resolves one from the panel: PATCH, the file changes, the note moves to the resolved list
  await page.locator("#openNotes li").nth(1).locator("button", { hasText: "Resolve" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#openNotes li").length === 2);
  assert.equal(readNotes().find((n) => n.id === "n3").status, "resolved");
  // the agent resolves one by editing the file: the panel follows without a reload
  const notes = readNotes();
  notes.find((n) => n.id === "n1").status = "resolved";
  notes.find((n) => n.id === "n1").resolution = "done by the agent";
  seed(notes);
  await page.waitForFunction(() => document.querySelectorAll("#openNotes li").length === 1);
  assert.equal(await page.locator("#doneNotes li").count(), 3);
  assert.match(await page.textContent("#doneNotes"), /done by the agent/);
  assert.equal((await studioState(page)).loads, 1, "no reload happened");
  await page.locator("#doneBox summary").click(); // the resolved list is collapsed until asked for
  await page.locator("#doneNotes li", { hasText: "n1" }).locator("button", { hasText: "Reopen" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#openNotes li").length === 2);
  assert.equal(readNotes().find((n) => n.id === "n1").resolution, null);
  await page.context().close();
  fs.rmSync(feedbackFile, { force: true });
});

// ---------------------------------------------------------------------- reloading ----
it("saving index.html swaps in the new composition, keeps t, and keeps playing", async () => {
  const page = await open("?t=1.2");
  await page.locator("#scrub").fill("150");
  await page.evaluate(() => { window.__old = document.getElementById("comp"); });
  await withFile("index.html", (s) => s.replace("K.decode(copy.caption.toUpperCase(),", 'K.decode("HOT RELOAD WORKS",'), async () => {
    await page.waitForFunction(() => __studio.loads === 2, null, { timeout: 8000 });
    const st = await studioState(page);
    assert.deepEqual([st.t, st.rendered], [2.5, 2.5], "t survives the reload and is painted again");
    assert.equal(await page.evaluate(() => document.getElementById("comp") !== window.__old && !window.__old.isConnected), true, "the old iframe is gone");
    assert.equal(await page.locator("#stack iframe").count(), 1);
    await page.locator("#scrub").fill("72"); // t = 1.2: the caption has finished decoding
    assert.match(await page.evaluate(() => document.getElementById("comp").contentDocument.body.innerText), /HOT RELOAD WORKS/, "the new source is what runs");
  });
  await page.waitForFunction(() => __studio.loads === 3, null, { timeout: 8000 });

  await page.keyboard.press("Space");
  await sleep(300);
  const t1 = (await studioState(page)).t;
  await withFile("index.html", (s) => s + "\n<!-- touched -->\n", async () => {
    await page.waitForFunction(() => __studio.loads === 4, null, { timeout: 8000 });
  });
  const after = await studioState(page);
  assert.equal(after.playing, true, "playback carries on through a reload");
  assert.ok(after.t > t1, `t=${after.t} did not advance past ${t1}`);
  await page.keyboard.press("Space");
  await page.context().close();
});

it("a composition that never becomes ready shows the timeout overlay instead of a blank frame, keeps the last good frame, and recovers on the next save", async () => {
  const page = await open("?readyTimeout=1500&t=2");
  // no syntax error and no exception: nothing for the server or the error listener to report, only the 5 s (here 1.5 s) fallback
  const hang = (s) => s.replace("await K.run(", "await new Promise(() => {}); await K.run(");
  await withFile("index.html", hang, async () => {
    await waitOverlay(page, false);
    const o = await overlay(page);
    assert.match(o.title, /did not become ready/);
    assert.ok(o.body.length > 0);
    assert.equal(await page.evaluate(() => document.getElementById("comp") !== null && __studio.ready), true, "the last good frame is still there under the overlay");
  });
  await waitOverlay(page, true);
  assert.equal((await studioState(page)).ready, true);
  assert.equal((await studioState(page)).rendered, 2);

  // and a page opened onto such a project has no frame at all, only the message, until the file is fixed
  let cold;
  await withFile("index.html", hang, async () => {
    cold = await open("?readyTimeout=1500", { waitReady: false });
    await waitOverlay(cold, false);
    assert.equal(await cold.evaluate(() => __studio.ready), false);
  });
  await waitOverlay(cold, true);
  await cold.waitForFunction(() => __studio.ready === true, null, { timeout: 8000 });
  await cold.context().close();
  await page.context().close();
});

it("a syntax error shows its real message and line within two seconds, over the last good frame, and fixing it clears the overlay", async () => {
  const cases = [
    ["engine.js", (s) => s.replace("export const lerp = (a, b, t) => a + (b - a) * t;", "export const lerp = (a, b, t) => a + (b - a) * ;"), "export const lerp = "],
    ["index.html", (s) => s.replace("await K.run(app, [Hud, Features, Lockup, Title], {", "await K.run(app, ;[Hud, Features, Lockup, Title], {"), "await K.run(app, ["],
  ];
  const page = await open("?t=2"); // the default 5 s timeout: anything faster than that came from the server's check
  for (const [name, transform, needle] of cases) {
    const original = fs.readFileSync(path.join(root, name), "utf8");
    const line = original.slice(0, original.indexOf(needle)).split("\n").length;
    await withFile(name, transform, async () => {
      const t0 = Date.now();
      await waitOverlay(page, false, 2000);
      const o = await overlay(page);
      console.log(`  ${name}: overlay after ${Date.now() - t0} ms: "${o.title}" / "${o.body}"`);
      assert.match(o.title, new RegExp(`^Syntax error in ${name.replace(".", "\\.")}:${line}:\\d+$`));
      assert.match(o.body, /^SyntaxError: Unexpected token ';'/);
      assert.equal(await page.evaluate(() => __studio.ready), true, "the last good frame is still on screen");
    });
    await waitOverlay(page, true, 3000);
    await page.waitForFunction(() => __studio.ready && __studio.error === null);
    assert.equal((await studioState(page)).rendered, 2);
  }
  await page.context().close();
});

it("an exception thrown while the composition initialises is shown with its message, well before the timeout", async () => {
  const page = await open("?t=1");
  await withFile("index.html", (s) => s.replace("await K.run(", 'await new Promise((r) => setTimeout(r, 300)); throw new Error("scene init exploded"); await K.run('), async () => {
    const t0 = Date.now();
    await waitOverlay(page, false, 3000); // the default timeout is 5 s, so this must come from the error listener
    const o = await overlay(page);
    console.log(`  init exception -> overlay after ${Date.now() - t0} ms: "${o.title}"`);
    assert.match(o.body, /scene init exploded/);
    assert.match(o.title, /index\.html (threw|failed) while loading/);
    assert.equal(await page.evaluate(() => __studio.ready), true, "the last good frame stays under the message");
  });
  await waitOverlay(page, true);
  await page.context().close();
});

it("an unreadable timeline.json is reported by name, and the studio recovers when it is fixed", async () => {
  const page = await open();
  await withFile("timeline.json", () => "{ half an edit", async () => {
    await waitOverlay(page, false);
    const o = await overlay(page);
    assert.match(o.title, /Cannot read the project/);
    assert.match(o.body, /timeline\.json is not valid JSON/);
  });
  await waitOverlay(page, true);
  await page.waitForFunction(() => __studio.ready && __studio.error === null);
  await page.context().close();
});

it("a page opened onto an unreadable timeline.json starts by itself once it is fixed, and still honours ?t=", async () => {
  let cold;
  await withFile("timeline.json", () => "{ half an edit", async () => {
    cold = await open("?t=3", { waitReady: false });
    await waitOverlay(cold, false);
    assert.match((await overlay(cold)).body, /timeline\.json is not valid JSON/);
    assert.equal(await cold.evaluate(() => __studio.ready), false);
  });
  await cold.waitForFunction(() => __studio.ready === true, null, { timeout: 10000 });
  assert.equal((await studioState(cold)).rendered, 3);
  assert.equal((await overlay(cold)).hidden, true);
  await cold.context().close();
});

it("a renderAt that throws pauses playback and shows what threw", async () => {
  const page = await open();
  await page.evaluate(() => { document.getElementById("comp").contentWindow.renderAt = () => { throw new Error("scene exploded"); }; });
  await page.locator("#scrub").fill("60");
  await waitOverlay(page, false);
  const o = await overlay(page);
  assert.match(o.title, /renderAt\(1\.000\) threw/);
  assert.match(o.body, /scene exploded/);
  assert.equal((await studioState(page)).playing, false);
  await page.context().close();
});
