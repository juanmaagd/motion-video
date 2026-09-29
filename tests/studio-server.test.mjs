// The studio server (studio.mjs): serving, the write guard, server-sent events, the watcher and the
// audio regeneration. Everything runs against a project assembled in a temp folder.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { REPO, assembleProject, connectSSE, request, sleep, snapshot, tmpDir, waitFor } from "./_helpers.mjs";

const ENGINE = path.join(REPO, "skills/motion-video-engine/assets/project");
const quiet = () => {};

// ---- a full project, one studio, one long-lived event stream ----
const base = fs.realpathSync(tmpDir("mv-studio-"));
const root = path.join(base, "proj");
assembleProject(root);
fs.mkdirSync(path.join(base, "proj-secret"));
fs.writeFileSync(path.join(base, "proj-secret/x.txt"), "TOP-SECRET-OUTSIDE-THE-ROOT");
fs.symlinkSync(path.join(base, "proj-secret"), path.join(root, "escape"), "dir");
fs.writeFileSync(path.join(root, ".secret"), "dotfile");
const mod = await import(pathToFileURL(path.join(root, "studio.mjs")).href);
const { startStudio, updateJSON, isIgnored, formatJSON, applyTweak } = mod;

let studio, port, events;
before(async () => {
  studio = await startStudio({ root, port: 0, log: quiet });
  port = studio.port;
  events = connectSSE(port);
  await events.ready;
});
after(async () => {
  events.close();
  await studio.close();
  fs.rmSync(base, { recursive: true, force: true });
});

const at = (over = {}) => ({
  method: "POST", path: "/api/ping", body: "{}",
  headers: { "content-type": "application/json", "x-studio-token": studio.token, origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}`, ...over.headers },
  ...over.rest,
});
const ping = (over) => request(port, at(over));

// ---- audio (first, so that every later timing assertion starts from a quiet server) ----
test("the stream opens with hello, then the first audio-ready arrives and the WAV is real", async () => {
  const hello = await events.wait("hello", { timeout: 2000 });
  assert.equal(events.events[0], hello, "hello comes first");
  assert.equal(hello.data.run, studio.run);
  const ready = await events.wait("audio-ready", { timeout: 15000 });
  assert.match(ready.data.url, /^\/out\/studio-audio\.wav\?v=\d+$/);
  assert.ok(ready.data.mtime > 0);
  const wav = path.join(root, "out/studio-audio.wav");
  const bytes = fs.readFileSync(wav);
  assert.ok(bytes.length > 44, "the WAV is not empty");
  assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
  assert.equal(bytes.subarray(8, 12).toString(), "WAVE");
  assert.ok(!fs.existsSync(path.join(root, "out/.studio-audio.wav.tmp")), "no temp file left behind");
  const served = await request(port, { path: ready.data.url });
  assert.equal(served.status, 200);
  assert.equal(served.headers["content-type"], "audio/wav");
  assert.equal(served.headers["content-length"], String(bytes.length));
  assert.ok(served.body.equals(bytes));
  await sleep(600); // let filesystem events from the assembly and from out/ settle
  assert.equal(events.count("syntax-error"), 0, "the start-up check finds nothing wrong with the demo project");
});

test("a page that connects after the audio is ready is told so at once", async () => {
  const late = connectSSE(port);
  try {
    await late.ready;
    const ready = await late.wait("audio-ready", { timeout: 2000 });
    assert.match(ready.data.url, /studio-audio\.wav/);
  } finally {
    late.close();
  }
});

// ---- serving ----
test("GET / serves the page with this run's token and refuses to be framed", async () => {
  const r = await request(port, { path: "/" });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /^text\/html/);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.match(r.headers["content-security-policy"], /frame-ancestors 'none'/);
  const html = r.body.toString();
  assert.ok(!html.includes("__STUDIO_TOKEN__"), "the placeholder is replaced");
  const token = /name="studio-token" content="([0-9a-f]+)"/.exec(html)?.[1];
  assert.equal(token, studio.token);
  assert.equal(token.length, 32);
  assert.equal((await request(port, { path: "/studio.html" })).status, 200);
  assert.equal((await request(port, { method: "POST", path: "/", body: "{}", headers: { "content-type": "application/json" } })).status, 405);
});

test("/api/project returns the timeline, the brand and an empty feedback file when there is none", async () => {
  const r = await request(port, { path: "/api/project" });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /^application\/json/);
  const p = JSON.parse(r.body);
  assert.deepEqual(Object.keys(p).sort(), ["brand", "feedback", "timeline"]);
  assert.equal(p.timeline.fps, 60);
  assert.equal(p.timeline.width, 1920);
  assert.ok(Array.isArray(p.timeline.cues) && p.timeline.cues.length > 0);
  assert.equal(typeof p.brand, "object");
  assert.deepEqual(p.feedback, { version: 1, notes: [] });
  assert.ok(!fs.existsSync(path.join(root, "feedback.json")), "reading must not create feedback.json");
  assert.equal((await request(port, { method: "POST", path: "/api/project", body: "{}", headers: { "content-type": "application/json" } })).status, 405);
  assert.equal((await request(port, { path: "/api/nope" })).status, 404);
});

test("traversal, symlink escape and hidden files are refused through the studio too", async () => {
  const before = snapshot(root);
  for (const p of ["/..%2fproj-secret%2fx.txt", "/%2e%2e/proj-secret/x.txt", "/escape/x.txt", "/.secret", "/out/.build/master.nut", "/node_modules/x"]) {
    const r = await request(port, { path: p });
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.body.includes("TOP-SECRET") && !r.body.includes("dotfile"), p);
  }
  assert.equal((await request(port, { path: "/escape/x.txt" })).status, 403);
  assert.deepEqual(snapshot(root), before);
});

test("every request needs an allowed Host, reads included (DNS rebinding), and a present Origin must be ours", async () => {
  for (const host of [`attacker.example:${port}`, "127.0.0.1", `127.0.0.1:${port + 1}`, `localhost.attacker.example:${port}`]) {
    for (const p of ["/", "/api/project", "/index.html", "/__events"]) {
      const r = await request(port, { path: p, headers: { host } });
      assert.equal(r.status, 403, `${host} ${p}`);
      assert.ok(!/[0-9a-f]{32}/.test(r.body.toString()), "no token in a refusal");
    }
  }
  assert.equal((await request(port, { path: "/api/project", headers: { origin: "http://attacker.example" } })).status, 403);
  assert.equal((await request(port, { path: "/", headers: { host: `localhost:${port}` } })).status, 200, "localhost is allowed");
});

// ---- the write guard, on the trivial /api/ping ----
test("a well-formed ping is accepted, from 127.0.0.1 or localhost", async () => {
  const ok = await ping();
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { ok: true });
  const local = await ping({ headers: { host: `localhost:${port}`, origin: `http://localhost:${port}` } });
  assert.equal(local.status, 200);
  assert.equal((await ping({ headers: { "content-type": "application/json; charset=utf-8" } })).status, 200);
});

test("every way of failing the guard is a 4xx and leaves the project untouched", async () => {
  const before = snapshot(root);
  const big = JSON.stringify({ pad: "x".repeat(64 * 1024) });
  const negatives = {
    "no token": [403, { headers: { "x-studio-token": undefined } }],
    "wrong token": [403, { headers: { "x-studio-token": "0".repeat(32) } }],
    "short token": [403, { headers: { "x-studio-token": "abc" } }],
    "no origin": [403, { headers: { origin: undefined } }],
    "foreign origin": [403, { headers: { origin: "http://attacker.example" } }],
    "our host, wrong port in origin": [403, { headers: { origin: `http://127.0.0.1:${port + 1}` } }],
    "origin that does not match the host": [403, { headers: { host: `localhost:${port}`, origin: `http://127.0.0.1:${port}` } }],
    "wrong host": [403, { headers: { host: `attacker.example:${port}`, origin: `http://attacker.example:${port}` } }],
    "text/plain": [415, { headers: { "content-type": "text/plain" } }],
    "form post": [415, { headers: { "content-type": "application/x-www-form-urlencoded" } }],
    "no content type": [415, { headers: { "content-type": undefined } }],
    "body over 64 KB (content-length)": [413, { rest: { body: big }, headers: { "content-length": String(Buffer.byteLength(big)) } }],
    "body over 64 KB (chunked)": [413, { rest: { body: big } }],
    "not JSON": [400, { rest: { body: "{nope" } }],
    "GET": [405, { rest: { method: "GET", body: undefined } }],
    "PUT": [405, { rest: { method: "PUT" } }],
  };
  for (const [name, [want, over]] of Object.entries(negatives)) {
    const headers = Object.fromEntries(Object.entries({ ...at(over).headers }).filter(([, v]) => v !== undefined));
    const r = await request(port, { ...at(over), headers });
    assert.equal(r.status, want, name);
  }
  assert.deepEqual(snapshot(root), before, "no file may change on a refused request");
  assert.equal((await ping()).status, 200, "the server is still fine after every refusal");
});

// ---- watcher ----
test("a source change reloads; changes to out/, feedback.json, archives, dotfiles and temp files do not", async () => {
  const quietFiles = ["out/x.txt", "feedback.json", "v1/old.js", ".hidden", "scratch.tmp", "node_modules/x.js", "notes.swp"];
  const mark = events.mark();
  for (const f of quietFiles) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), "x");
  }
  await sleep(1000);
  assert.equal(events.count("reload", mark), 0, `unexpected reload for an ignored file: ${JSON.stringify(events.events.slice(mark))}`);
  assert.equal(events.count("audio-stale", mark), 0);
  assert.equal(events.count("feedback-changed", mark), 1, "feedback.json never reloads, but an open notes panel is told once");
  fs.writeFileSync(path.join(root, "index.html"), fs.readFileSync(path.join(root, "index.html")));
  const reload = await events.wait("reload", { after: mark, timeout: 1000 });
  assert.equal(reload.data.path, "index.html");
  await sleep(300);
  assert.equal(events.count("reload", mark), 1, "one save is one reload (debounced)");
  for (const f of quietFiles) fs.rmSync(path.join(root, f), { force: true });
  fs.rmSync(path.join(root, "v1"), { recursive: true, force: true });
  fs.rmSync(path.join(root, "node_modules"), { recursive: true, force: true });
  await sleep(400);
});

test("isIgnored", () => {
  for (const p of ["out/a.wav", "out/.build/x", "feedback.json", "v1/index.html", "v12/x", ".git/HEAD", ".DS_Store", "a/.hidden", "node_modules/p/i.js", "__pycache__/x.pyc", "x.json.123.tmp", "a.swp", "index.html~"]) assert.equal(isIgnored(p), true, p);
  for (const p of ["index.html", "engine.js", "timeline.json", "brand.json", "score.mjs", "fonts/a.woff2", "brand/logo.svg", "generated/plate.png", "outline.svg", "v1x/a.js", "feedback.json.bak", "sub/feedback.json"]) assert.equal(isIgnored(p), false, p);
});

test("editing score.mjs or timeline.json reloads and regenerates the audio", async () => {
  for (const f of ["score.mjs", "timeline.json"]) {
    const mark = events.mark();
    fs.writeFileSync(path.join(root, f), fs.readFileSync(path.join(root, f)));
    await events.wait("reload", { after: mark, timeout: 1000 });
    const stale = await events.wait("audio-stale", { after: mark, timeout: 1000 });
    const ready = await events.wait("audio-ready", { after: mark, timeout: 15000 });
    assert.ok(stale.at <= ready.at);
    assert.equal(events.count("audio-ready", mark), 1, f);
    assert.ok(fs.statSync(path.join(root, "out/studio-audio.wav")).size > 44);
    await sleep(500);
    assert.equal(events.count("reload", mark), 1, `${f}: the regenerated WAV lands in out/, which must not trigger another reload`);
  }
});

// ---- syntax errors ----
const lineOf = (text, needle) => text.slice(0, text.indexOf(needle)).split("\n").length;
// Runs fn with a project file replaced, then puts the original back and waits for the reload that follows.
async function brokenFile(name, transform, fn) {
  const file = path.join(root, name), original = fs.readFileSync(file, "utf8");
  try {
    fs.writeFileSync(file, transform(original));
    await fn(original);
  } finally {
    const mark = events.mark();
    fs.writeFileSync(file, original);
    await events.wait("reload", { after: mark, timeout: 3000 });
  }
}

test("a syntax error in engine.js is reported with its file, line and message at once, and holds the reload back until it is fixed", async () => {
  const mark = events.mark();
  const t0 = Date.now();
  await brokenFile("engine.js", (s) => s.replace("export const lerp = (a, b, t) => a + (b - a) * t;", "export const lerp = (a, b, t) => a + (b - a) * ;"), async (original) => {
    const err = await events.wait("syntax-error", { after: mark, timeout: 2000 });
    console.log(`  engine.js syntax error reported after ${err.at - t0} ms: ${JSON.stringify(err.data)}`);
    assert.ok(err.at - t0 < 2000);
    assert.equal(err.data.file, "engine.js");
    assert.equal(err.data.line, lineOf(original, "export const lerp = "), "the line in engine.js itself");
    assert.equal(err.data.column, "export const lerp = (a, b, t) => a + (b - a) * ;".indexOf(";") + 1);
    assert.match(err.data.message, /^SyntaxError: Unexpected token ';'/);
    assert.equal(events.count("reload", mark), 0, "no reload while a file does not parse");
    // while it is broken, saving something else says the same and still does not reload
    const again = events.mark();
    fs.writeFileSync(path.join(root, "brand.json"), fs.readFileSync(path.join(root, "brand.json")));
    await events.wait("syntax-error", { after: again, timeout: 2000 });
    assert.equal(events.count("reload", again), 0);
    // a page that connects now is told at once
    const late = connectSSE(port);
    try { await late.ready; assert.equal((await late.wait("syntax-error", { timeout: 2000 })).data.file, "engine.js"); } finally { late.close(); }
  });
  const fixed = events.mark();
  await sleep(500);
  assert.equal(events.count("syntax-error", fixed), 0, "fixing it clears the error");
});

test("a syntax error in the inline module of index.html is found the same way", async () => {
  const mark = events.mark();
  await brokenFile("index.html", (s) => s.replace("await K.run(app, [Hud, Features, Lockup, Title], {", "await K.run(app, ;[Hud, Features, Lockup, Title], {"), async (original) => {
    const err = await events.wait("syntax-error", { after: mark, timeout: 2000 });
    assert.equal(err.data.file, "index.html");
    assert.equal(err.data.line, lineOf(original, "await K.run(app, ["), "the line in index.html, not in the extracted script");
    assert.equal(err.data.column, "await K.run(app, ;".indexOf(";") + 1);
    assert.match(err.data.message, /^SyntaxError: Unexpected token ';'/);
    assert.equal(events.count("reload", mark), 0);
  });
});

test("a syntax error in a .mjs file (the score) is reported too", async () => {
  const mark = events.mark();
  await brokenFile("score.mjs", (s) => s.replace("const S = createSynth(tl);", "const S = createSynth(tl;"), async (original) => {
    const err = await events.wait("syntax-error", { after: mark, timeout: 2000 });
    assert.deepEqual([err.data.file, err.data.line], ["score.mjs", lineOf(original, "const S = createSynth(tl")]);
  });
  await events.wait("audio-ready", { after: events.mark() - 1, timeout: 15000 }).catch(() => {}); // the regenerated score settles before the next test
  await sleep(600);
});

test("a project that is already broken when the studio starts tells the first page that connects", async () => {
  const html = "<!doctype html>\n<p>x</p>\n<script type=\"application/json\">{ not: js }</script>\n<script src=\"gone.js\"></script>\n<script>\n  var fine = 1;\n  var b = ;\n</script>\n";
  await withStudio(miniRoot({ "index.html": html }), async (s, sse) => {
    const err = await sse.wait("syntax-error", { timeout: 5000 });
    assert.deepEqual([err.data.file, err.data.line, err.data.column], ["index.html", 7, 11], "JSON and src scripts are skipped; a classic script is checked; the line is the HTML's");
  });
  const onOneLine = "<!doctype html>\n<script type=\"module\">let x = ;</script>\n";
  await withStudio(miniRoot({ "index.html": onOneLine }), async (s, sse) => {
    const err = await sse.wait("syntax-error", { timeout: 5000 });
    assert.deepEqual([err.data.line, err.data.column], [2, "<script type=\"module\">let x = ;".indexOf(";") + 1], "the column counts the tag that precedes the code on its line");
  });
  await withStudio(miniRoot({ "index.html": "<!doctype html>\n<script type=\"module\">import a from \"./nope.js\"; await 1; export {};</script>\n" }), async (s, sse) => {
    await sleep(1200);
    assert.equal(sse.count("syntax-error"), 0, "a missing import and top-level await are not syntax errors");
  });
});

test("updateJSON on a project file: one reload, no temp file, and the mutex sees the latest bytes", async () => {
  const mark = events.mark();
  const file = path.join(root, "brand.json");
  const original = fs.readFileSync(file, "utf8");
  await updateJSON(file, (b) => ({ ...b, name: "Changed" }));
  await events.wait("reload", { after: mark, timeout: 1500 });
  await sleep(400);
  assert.equal(events.count("reload", mark), 1);
  assert.equal(events.events.slice(mark).find((e) => e.event === "reload").data.path, "brand.json");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).name, "Changed");
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.endsWith(".tmp")), []);
  fs.writeFileSync(file, original);
  await sleep(400);
});

// ---- updateJSON, without the server ----
test("updateJSON serializes concurrent writers and re-reads the file inside the lock", async () => {
  const dir = tmpDir("mv-json-");
  const f = path.join(dir, "n.json");
  try {
    await Promise.all(Array.from({ length: 25 }, (_, i) => updateJSON(f, (d) => ({ ...d, list: [...d.list, i] }), () => ({ list: [] }))));
    const list = JSON.parse(fs.readFileSync(f, "utf8")).list;
    assert.equal(list.length, 25, "no update was lost");
    assert.deepEqual([...list].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i));
    fs.writeFileSync(f, JSON.stringify({ list: ["edited elsewhere"] })); // somebody else edits between two updates
    await updateJSON(f, (d) => ({ ...d, extra: true }));
    assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), { list: ["edited elsewhere"], extra: true }, "the outside edit survives");
    assert.ok(fs.readFileSync(f, "utf8").endsWith("}\n"));
    assert.deepEqual(fs.readdirSync(dir), ["n.json"], "no temp file left");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failing update writes nothing, leaves no temp file, and does not block the next one", async () => {
  const dir = tmpDir("mv-json-");
  const f = path.join(dir, "n.json");
  fs.writeFileSync(f, '{"a":1}');
  try {
    await assert.rejects(updateJSON(f, () => { throw new Error("refused"); }), /refused/);
    assert.equal(fs.readFileSync(f, "utf8"), '{"a":1}');
    assert.equal(await updateJSON(f, () => undefined).then((d) => d.a), 1, "undefined leaves the file alone");
    assert.equal(fs.readFileSync(f, "utf8"), '{"a":1}');
    fs.writeFileSync(f, "{ half an edit");
    await assert.rejects(updateJSON(f, (d) => d), /not valid JSON/);
    assert.equal(fs.readFileSync(f, "utf8"), "{ half an edit", "a file that does not parse is never overwritten");
    fs.writeFileSync(f, '{"a":1}');
    assert.equal((await updateJSON(f, (d) => ({ ...d, a: 2 }))).a, 2, "the chain recovered");
    assert.deepEqual(fs.readdirSync(dir), ["n.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- feedback notes ----
const NOTE = {
  t: 2, point: { x: 960, y: 540, stage: { x: 951.5, y: 533.2 } },
  context: { bar: 2, beat: 1, cue: { name: "drop", t: 1.875 }, next: { name: "item1", in: 0.34 }, scene: { index: 3, name: "title" } },
  target: { tag: "div", class: "abs nowrap", text: "Deterministic frames", rect: { x: 10, y: 20, w: 300, h: 60 }, path: "#stage > div:nth-child(2)" },
  text: "Move this left of the mark",
};
const postNote = (body, over = {}) => request(port, { ...at({ rest: { path: "/api/feedback", body: typeof body === "string" ? body : JSON.stringify(body) } }), ...over });
const patchNote = (id, body, over = {}) => request(port, { ...at({ rest: { method: "PATCH", path: `/api/feedback/${id}`, body: typeof body === "string" ? body : JSON.stringify(body) } }), ...over });
const feedbackFile = () => path.join(root, "feedback.json");
const readFeedback = () => JSON.parse(fs.readFileSync(feedbackFile(), "utf8"));

test("POST /api/feedback stores a note the server completes, tells the panel, and does not reload", async () => {
  const mark = events.mark();
  const r = await postNote(NOTE);
  assert.equal(r.status, 201);
  const { note } = JSON.parse(r.body);
  assert.equal(note.id, "n1");
  assert.equal(note.status, "open");
  assert.equal(note.resolution, null);
  assert.equal(note.frame, 120, "frame is the server's own: round(t * fps)");
  assert.match(note.createdAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  assert.deepEqual({ ...note, id: undefined, createdAt: undefined, status: undefined, frame: undefined, resolution: undefined }, { ...NOTE, id: undefined, createdAt: undefined, status: undefined, frame: undefined, resolution: undefined });
  assert.deepEqual(readFeedback(), { version: 1, notes: [note] });
  assert.deepEqual(Object.keys(note), ["id", "createdAt", "status", "t", "frame", "point", "context", "target", "text", "resolution"], "the documented key order");
  await events.wait("feedback-changed", { after: mark, timeout: 2000 });
  await sleep(400);
  assert.equal(events.count("feedback-changed", mark), 1, "one write is one event");
  assert.equal(events.count("reload", mark), 0);
  assert.deepEqual(JSON.parse((await request(port, { path: "/api/feedback" })).body), readFeedback());
  assert.deepEqual(JSON.parse((await request(port, { path: "/api/project" })).body).feedback, readFeedback());
});

test("the server ignores what a client has no business setting", async () => {
  const r = await postNote({ ...NOTE, id: "evil", status: "resolved", createdAt: "1999", frame: 999, resolution: "done", extra: { x: 1 }, text: "  padded  " });
  assert.equal(r.status, 201);
  const { note } = JSON.parse(r.body);
  assert.deepEqual([note.id, note.status, note.resolution, note.frame, note.text], ["n2", "open", null, 120, "padded"]);
  assert.ok(note.createdAt.startsWith("20") && !("extra" in note));
});

test("a malformed note is a 400 and the file stays byte-identical", async () => {
  const before = fs.readFileSync(feedbackFile());
  const bad = {
    "empty text": { ...NOTE, text: "" }, "blank text": { ...NOTE, text: "   \n " }, "no text": { ...NOTE, text: undefined },
    "text over 2000": { ...NOTE, text: "x".repeat(2001) }, "huge text under the body cap": { ...NOTE, text: "x".repeat(50000) },
    "text is not a string": { ...NOTE, text: 5 }, "t below 0": { ...NOTE, t: -0.01 }, "t past the end": { ...NOTE, t: 7.501 },
    "t is a string": { ...NOTE, t: "NaN" }, "t is null": { ...NOTE, t: null }, "no t": { ...NOTE, t: undefined },
    "no point": { ...NOTE, point: undefined }, "point off the frame": { ...NOTE, point: { ...NOTE.point, x: 5000 } },
    "point.x not a number": { ...NOTE, point: { ...NOTE.point, x: "12" } }, "no stage": { ...NOTE, point: { x: 1, y: 1 } },
    "no context": { ...NOTE, context: undefined }, "bar is fractional": { ...NOTE, context: { ...NOTE.context, bar: 1.5 } },
    "cue without a name": { ...NOTE, context: { ...NOTE.context, cue: { t: 1 } } },
    "target text over 80": { ...NOTE, target: { ...NOTE.target, text: "y".repeat(81) } }, "target without a rect": { ...NOTE, target: { tag: "div" } },
    "target rect not finite": { ...NOTE, target: { ...NOTE.target, rect: { x: 0, y: 0, w: "1", h: 1 } } },
    "not an object": [NOTE], "a string": "hello",
  };
  for (const [name, body] of Object.entries(bad)) {
    const r = await postNote(body);
    assert.equal(r.status, 400, `${name}: ${r.body}`);
    assert.ok(fs.readFileSync(feedbackFile()).equals(before), `${name} changed the file`);
  }
  // an infinite number is legal JSON text (1e999) but not a legal time
  const inf = await postNote(JSON.stringify(NOTE).replace('"t":2', '"t":1e999'));
  assert.equal(inf.status, 400);
  assert.equal((await postNote("{nope")).status, 400);
  const huge = await postNote({ ...NOTE, text: "x".repeat(70000) });
  assert.equal(huge.status, 413, "past the 64 KB body cap it never gets as far as validation");
  assert.ok(fs.readFileSync(feedbackFile()).equals(before));
});

test("the guard covers the feedback endpoints too", async () => {
  const before = fs.readFileSync(feedbackFile());
  for (const bad of [{ headers: { "x-studio-token": undefined } }, { headers: { origin: "http://attacker.example" } }, { headers: { "content-type": "text/plain" } }]) {
    const headers = Object.fromEntries(Object.entries(at({ ...bad, rest: {} }).headers).filter(([, v]) => v !== undefined));
    for (const [method, p] of [["POST", "/api/feedback"], ["PATCH", "/api/feedback/n1"]]) {
      const r = await request(port, { method, path: p, body: JSON.stringify(method === "POST" ? NOTE : { status: "resolved" }), headers });
      assert.ok([403, 415].includes(r.status), `${method} ${p} -> ${r.status}`);
    }
  }
  assert.equal((await request(port, { ...at({ rest: { method: "PATCH", path: "/api/feedback", body: "{}" } }) })).status, 405);
  assert.equal((await request(port, { ...at({ rest: { method: "POST", path: "/api/feedback/n1", body: "{}" } }) })).status, 405);
  assert.equal((await request(port, { ...at({ rest: { method: "DELETE", path: "/api/feedback/n1" } }) })).status, 405);
  assert.equal((await patchNote("..%2f..%2fetc", { status: "resolved" })).status, 404);
  assert.ok(fs.readFileSync(feedbackFile()).equals(before));
});

test("PATCH sets status and resolution on that note only; an unknown id is a 404 and changes nothing", async () => {
  const before = readFeedback();
  const r = await patchNote("n2", { status: "resolved", resolution: "moved the title left of the mark" });
  assert.equal(r.status, 200);
  assert.deepEqual([JSON.parse(r.body).note.status, JSON.parse(r.body).note.resolution], ["resolved", "moved the title left of the mark"]);
  const after = readFeedback();
  assert.deepEqual(after.notes[0], before.notes[0], "the other note is untouched");
  assert.deepEqual({ ...after.notes[1], status: "open", resolution: null }, before.notes[1], "nothing else on the note changed");
  const reopened = await patchNote("n2", { status: "open" });
  assert.deepEqual([JSON.parse(reopened.body).note.status, JSON.parse(reopened.body).note.resolution], ["open", null]);
  assert.equal((await patchNote("n2", { status: "wontfix", resolution: "" })).status, 200);
  assert.equal(readFeedback().notes[1].resolution, null, "an empty resolution is stored as null");

  const bytes = fs.readFileSync(feedbackFile());
  assert.equal((await patchNote("n999", { status: "resolved", resolution: "x" })).status, 404);
  for (const [name, body] of Object.entries({
    "status outside the set": { status: "done" }, "no status": { resolution: "x" }, "an extra key": { status: "open", text: "rewritten" },
    "resolution over 500": { status: "resolved", resolution: "r".repeat(501) }, "resolution not a string": { status: "resolved", resolution: 5 }, "an array": ["resolved"],
  })) {
    const bad = await patchNote("n1", body);
    assert.equal(bad.status, 400, name);
  }
  assert.ok(fs.readFileSync(feedbackFile()).equals(bytes), "refused and unknown PATCHes wrote nothing");
});

test("20 notes posted at once are all stored, with distinct ids", async () => {
  const dir = miniRoot();
  await withStudio(dir, async (s) => {
    const send = (i) => request(s.port, { method: "POST", path: "/api/feedback", body: JSON.stringify({ ...NOTE, t: (i % 7) + 0.5, text: `note ${i}` }),
      headers: { "content-type": "application/json", "x-studio-token": s.token, origin: `http://127.0.0.1:${s.port}` } });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => send(i)));
    assert.deepEqual(results.map((r) => r.status), Array(20).fill(201));
    const doc = JSON.parse(fs.readFileSync(path.join(dir, "feedback.json"), "utf8"));
    assert.equal(doc.notes.length, 20, "no write was lost to another");
    assert.deepEqual(doc.notes.map((n) => n.id).sort((a, b) => a.slice(1) - b.slice(1)), Array.from({ length: 20 }, (_, i) => `n${i + 1}`));
    assert.deepEqual(doc.notes.map((n) => n.text).sort(), Array.from({ length: 20 }, (_, i) => `note ${i}`).sort());
    // and 20 concurrent PATCHes on different notes all land too
    const patches = await Promise.all(doc.notes.map((n) => request(s.port, { method: "PATCH", path: `/api/feedback/${n.id}`, body: JSON.stringify({ status: "resolved", resolution: `done ${n.id}` }),
      headers: { "content-type": "application/json", "x-studio-token": s.token, origin: `http://127.0.0.1:${s.port}` } })));
    assert.deepEqual(patches.map((r) => r.status), Array(20).fill(200));
    assert.ok(JSON.parse(fs.readFileSync(path.join(dir, "feedback.json"), "utf8")).notes.every((n) => n.status === "resolved" && n.resolution === `done ${n.id}`));
  });
});

test("an edit of feedback.json made outside the studio between two POSTs is kept, and its panel is told", async () => {
  const dir = miniRoot();
  await withStudio(dir, async (s, sse) => {
    const headers = { "content-type": "application/json", "x-studio-token": s.token, origin: `http://127.0.0.1:${s.port}` };
    const post = (text) => request(s.port, { method: "POST", path: "/api/feedback", body: JSON.stringify({ ...NOTE, text }), headers });
    assert.equal((await post("first")).status, 201);
    const doc = JSON.parse(fs.readFileSync(path.join(dir, "feedback.json"), "utf8"));
    await sleep(700); // let the filesystem events from copying this folder in (macOS replays them late) settle
    const mark = sse.mark();
    doc.notes.push({ ...doc.notes[0], id: "n7", text: "added by hand", status: "resolved", resolution: "done by hand" }); // the agent (or a person) edits the file
    fs.writeFileSync(path.join(dir, "feedback.json"), JSON.stringify(doc));
    await sse.wait("feedback-changed", { after: mark, timeout: 2000 });
    assert.equal(sse.count("reload", mark), 0);
    assert.equal((await post("second")).status, 201);
    const notes = JSON.parse(fs.readFileSync(path.join(dir, "feedback.json"), "utf8")).notes;
    assert.deepEqual(notes.map((n) => [n.id, n.text]), [["n1", "first"], ["n7", "added by hand"], ["n8", "second"]], "the outside edit survived and the next id follows the highest");
  });
});

test("a feedback.json that is not a version 1 file is never overwritten", async () => {
  const dir = miniRoot();
  await withStudio(dir, async (s) => {
    const headers = { "content-type": "application/json", "x-studio-token": s.token, origin: `http://127.0.0.1:${s.port}` };
    for (const content of ['{"version":2,"notes":[]}', '{"notes":[]}', "[1,2]", "{ half an edit"]) {
      fs.writeFileSync(path.join(dir, "feedback.json"), content);
      const r = await request(s.port, { method: "POST", path: "/api/feedback", body: JSON.stringify(NOTE), headers });
      assert.equal(r.status, 500, content);
      assert.equal(fs.readFileSync(path.join(dir, "feedback.json"), "utf8"), content, "left alone");
      assert.equal((await request(s.port, { path: "/api/feedback" })).status, 500);
    }
  });
});

test("PATCH on an id when there is no feedback.json is a 404 and does not create the file", async () => {
  const dir = miniRoot();
  await withStudio(dir, async (s) => {
    const r = await request(s.port, { method: "PATCH", path: "/api/feedback/n1", body: JSON.stringify({ status: "resolved" }),
      headers: { "content-type": "application/json", "x-studio-token": s.token, origin: `http://127.0.0.1:${s.port}` } });
    assert.equal(r.status, 404);
    assert.ok(!fs.existsSync(path.join(dir, "feedback.json")));
  });
});

// ---- tweaks ----
const tweak = (file, ops, over = {}) => request(port, at({ rest: { path: "/api/tweak", body: typeof file === "string" && ops === undefined ? file : JSON.stringify({ file, ops }), ...over } }));
const timelineFile = () => path.join(root, "timeline.json");
const brandFile = () => path.join(root, "brand.json");

test("formatJSON keeps the layout of the project files: timeline.json round-trips byte for byte", () => {
  const original = fs.readFileSync(path.join(ENGINE, "timeline.json"), "utf8");
  assert.equal(formatJSON(JSON.parse(original)) + "\n", original, "cue lines and the inline lagThreshold are kept");
  assert.equal(formatJSON({ a: [1, 2], b: {}, c: [], d: { e: "x" } }), '{ "a": [1, 2], "b": {}, "c": [], "d": { "e": "x" } }');
  assert.equal(formatJSON({ list: Array.from({ length: 30 }, (_, i) => `item number ${i}`) }).split("\n").length, 34, "what does not fit is broken over lines");
});

test("an allowed timeline op changes only that number, reloads, and regenerates the audio", async () => {
  const original = fs.readFileSync(timelineFile(), "utf8");
  const mark = events.mark();
  const r = await tweak("timeline", [{ path: "cues[1].beat", value: 2.25 }]);
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.deepEqual([body.ok, body.file, body.changed, body.doc.cues[1].beat], [true, "timeline", true, 2.25]);
  assert.equal(fs.readFileSync(timelineFile(), "utf8"), original.replace('"name": "word1", "beat": 2 }', '"name": "word1", "beat": 2.25 }'), "one number differs; every other byte is as it was");
  await events.wait("reload", { after: mark, timeout: 2000 });
  await events.wait("audio-stale", { after: mark, timeout: 2000 });
  await events.wait("audio-ready", { after: mark, timeout: 15000 });
  // setting it back restores the file exactly; a later op on the same path wins within one request
  assert.equal((await tweak("timeline", [{ path: "cues[1].beat", value: 2.75 }, { path: "cues[1].beat", value: 2 }])).status, 200);
  assert.equal(fs.readFileSync(timelineFile(), "utf8"), original);
  const hit = await tweak("timeline", [{ path: "cues[0].hit", value: true }]);
  assert.equal(hit.status, 200);
  assert.match(fs.readFileSync(timelineFile(), "utf8"), /\{ "name": "open", "beat": 1, "hit": true \}/);
  fs.writeFileSync(timelineFile(), original);
  await events.wait("audio-ready", { after: events.mark() - 1, timeout: 15000 }).catch(() => {});
  await sleep(800);
});

test("allowed brand ops: colour, copy (same shape), wordmark and name", async () => {
  const original = fs.readFileSync(brandFile(), "utf8");
  const mark = events.mark();
  const r = await tweak("brand", [
    { path: "colors.accent", value: "#ff0055" }, { path: "colors.bg", value: "#f05" },
    { path: "copy.caption", value: "A new caption" }, { path: "copy.features", value: ["One", "Two", "Three"] },
    { path: "copy.headline", value: [["Fast", 300], ["from", 400], ["pure", 700], ["code.", 600]] },
    { path: "wordmark", value: "acme" }, { path: "name", value: "Acme (fictional)" },
  ]);
  assert.equal(r.status, 200, r.body.toString());
  const doc = JSON.parse(fs.readFileSync(brandFile(), "utf8"));
  assert.deepEqual([doc.colors.accent, doc.colors.bg, doc.colors.ink], ["#ff0055", "#f05", "#0b0d12"]);
  assert.deepEqual([doc.copy.caption, doc.copy.features, doc.copy.headline[0], doc.wordmark, doc.name], ["A new caption", ["One", "Two", "Three"], ["Fast", 300], "acme", "Acme (fictional)"]);
  assert.deepEqual(doc.fonts, JSON.parse(original).fonts, "fonts are untouched");
  assert.equal(doc.logo, JSON.parse(original).logo);
  await events.wait("reload", { after: mark, timeout: 2000 });
  await sleep(300);
  assert.equal(events.count("audio-stale", mark), 0, "brand edits do not regenerate the audio");
  fs.writeFileSync(brandFile(), original);
  await sleep(500);
});

test("a tweak that changes nothing writes nothing", async () => {
  const before = fs.readFileSync(timelineFile());
  const mark = events.mark();
  const r = await tweak("timeline", [{ path: "cues[0].beat", value: 1 }]);
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.body).changed, false);
  await sleep(600);
  assert.ok(fs.readFileSync(timelineFile()).equals(before));
  assert.equal(events.count("reload", mark), 0, "and so nothing reloads");
});

test("every op outside the allowlist, or with the wrong type or shape, is a 400 that leaves both files byte-identical", async () => {
  const beforeT = fs.readFileSync(timelineFile()), beforeB = fs.readFileSync(brandFile());
  const t = (path_, value) => ["timeline", [{ path: path_, value }]], b = (path_, value) => ["brand", [{ path: path_, value }]];
  const bad = {
    "a cue name": t("cues[0].name", "renamed"), "bpm": t("bpm", 90), "duration": t("duration", 60), "offset": t("offset", 1), "fps": t("fps", 30), "width": t("width", 100),
    "title": t("title", "x"), "a QA threshold": t("lagThreshold.full", 9), "loudness": t("loudness", -20), "the cues array": t("cues", []),
    "a cue that does not exist": t("cues[99].beat", 2), "a cue index with a leading zero": t("cues[01].beat", 2), "a negative cue index": t("cues[-1].beat", 2),
    "beat as a string": t("cues[1].beat", "2"), "beat null": t("cues[1].beat", null), "beat infinite": ["timeline", "PLACEHOLDER"],
    "beat before the video": t("cues[1].beat", -5), "beat after the video": t("cues[1].beat", 100), "hit as a string": t("cues[0].hit", "yes"), "hit as a number": t("cues[0].hit", 1),
    "a path below a leaf": t("cues[1].beat.x", 2), "a colour in the timeline": t("colors.accent", "#fff"), "a beat in the brand": b("cues[0].beat", 2),
    "a bad colour word": b("colors.accent", "red"), "a colour too short": b("colors.accent", "#12"), "a colour that is not hex": b("colors.accent", "#GGGGGG"),
    "a 7-digit colour": b("colors.accent", "#1234567"), "an 8-digit colour": b("colors.accent", "#ff005500"), "a colour with a space": b("colors.accent", "#ff0055 "), "a colour as a number": b("colors.accent", 255),
    "a whole colours object": b("colors", { bg: "#fff" }), "a role name with a dot": b("colors.a.b", "#fff"),
    "copy of the wrong type": b("copy.caption", 5), "copy array of the wrong length": b("copy.features", ["a", "b"]), "copy array with a number in it": b("copy.features", ["a", "b", 3]),
    "copy string where an array is": b("copy.features", "a, b, c"), "a headline pair of the wrong shape": b("copy.headline", [["Fast"], ["from", 400], ["pure", 600], ["code.", 600]]),
    "a weight of 0": b("copy.headline", [["Fast", 0], ["from", 400], ["pure", 600], ["code.", 600]]), "a weight as a string": b("copy.headline", [["Fast", "400"], ["from", 400], ["pure", 600], ["code.", 600]]),
    "a copy field that does not exist": b("copy.nope", "x"), "copy with a newline": b("copy.caption", "two\nlines"), "copy over 500 characters": b("copy.caption", "x".repeat(501)),
    "copy inherited from Object": b("copy.constructor", "x"), "the fonts": b("fonts.display.family", "Comic"), "the logo": b("logo", "brand/other.svg"), "colorProbes": b("colorProbes", []),
    "the note": b("note", "x"), "an empty wordmark": b("wordmark", ""), "a wordmark that is a number": b("wordmark", 5), "a name over 100": b("name", "n".repeat(101)),
    "a proto path": b("__proto__.x", 1), "a proto colour": b("colors.__proto__", "#fff"),
    "a mixed batch, legal first": ["brand", [{ path: "colors.accent", value: "#ff0055" }, { path: "logo", value: "x" }]],
    "a mixed batch, illegal first": ["brand", [{ path: "fonts", value: {} }, { path: "colors.accent", value: "#ff0055" }]],
    "a mixed timeline batch": ["timeline", [{ path: "cues[1].beat", value: 2.5 }, { path: "cues[1].name", value: "x" }, { path: "cues[2].beat", value: 2.75 }]],
    "no ops": ["timeline", []], "ops not an array": ["timeline", { path: "cues[1].beat", value: 2 }], "an op without a value": ["timeline", [{ path: "cues[1].beat" }]],
    "an op with an extra key": ["timeline", [{ path: "cues[1].beat", value: 2, force: true }]], "201 ops": ["timeline", Array.from({ length: 201 }, () => ({ path: "cues[1].beat", value: 2 }))],
    "another file": ["package", [{ path: "name", value: "x" }]], "the score": ["score", [{ path: "x", value: 1 }]], "no file": [undefined, [{ path: "name", value: "x" }]],
  };
  for (const [name, [file, ops]] of Object.entries(bad)) {
    const raw = ops === "PLACEHOLDER" ? '{"file":"timeline","ops":[{"path":"cues[1].beat","value":1e999}]}' : undefined;
    const r = raw ? await tweak(raw) : await tweak(file, ops);
    assert.equal(r.status, 400, `${name}: ${r.status} ${r.body}`);
    assert.ok(fs.readFileSync(timelineFile()).equals(beforeT) && fs.readFileSync(brandFile()).equals(beforeB), `${name} changed a file`);
  }
  assert.equal((await tweak('{"file":"timeline","ops":[],"extra":1}')).status, 400);
  assert.equal((await tweak("[1]")).status, 400);
  assert.equal((await tweak("{nope")).status, 400);
});

test("the guard covers /api/tweak, and only POST is answered", async () => {
  const before = fs.readFileSync(timelineFile());
  const body = JSON.stringify({ file: "timeline", ops: [{ path: "cues[1].beat", value: 2.5 }] });
  for (const bad of [{ "x-studio-token": undefined }, { "x-studio-token": "0".repeat(32) }, { origin: "http://attacker.example" }, { "content-type": "text/plain" }]) {
    const headers = Object.fromEntries(Object.entries({ ...at().headers, ...bad }).filter(([, v]) => v !== undefined));
    assert.ok([403, 415].includes((await request(port, { method: "POST", path: "/api/tweak", body, headers })).status));
  }
  for (const method of ["GET", "PUT", "PATCH", "DELETE"]) assert.equal((await request(port, { ...at({ rest: { method, path: "/api/tweak", body } }) })).status, 405, method);
  assert.ok(fs.readFileSync(timelineFile()).equals(before));
});

test("applyTweak is all or nothing and never mutates its input", () => {
  const doc = { bpm: 128, offset: 0, duration: 7.5, cues: [{ name: "a", beat: 1 }, { name: "b", beat: 2 }] };
  const copy = structuredClone(doc);
  assert.deepEqual(applyTweak("timeline", doc, [{ path: "cues[1].beat", value: 3 }]).cues[1].beat, 3);
  assert.throws(() => applyTweak("timeline", doc, [{ path: "cues[0].beat", value: 4 }, { path: "bpm", value: 1 }]), /not a field the studio may change/);
  assert.deepEqual(doc, copy);
});

// ---- audio regeneration, with a stub score so the timing is under the test's control ----
function miniRoot(extra = {}) {
  const dir = fs.realpathSync(tmpDir("mv-mini-"));
  for (const f of ["serve.mjs", "studio.mjs", "studio.html", "timeline.json"]) fs.copyFileSync(path.join(ENGINE, f), path.join(dir, f));
  for (const [name, content] of Object.entries(extra)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}
const stubScore = (ms, extra = "") => `import fs from "node:fs";
import path from "node:path";
const out = process.argv.find((a) => a.startsWith("--out=")).slice(6);
fs.mkdirSync("out", { recursive: true });
fs.appendFileSync("out/runs.log", "run\\n");
${extra}
await new Promise((r) => setTimeout(r, ${ms}));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, "RIFFxxxxWAVE-fake");
`;
async function withStudio(dir, fn) {
  const s = await startStudio({ root: dir, port: 0, log: quiet });
  const sse = connectSSE(s.port);
  try {
    await sse.ready;
    await fn(s, sse);
  } finally {
    sse.close();
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("edits that arrive while the audio is regenerating coalesce into one more run and one audio-ready", async () => {
  const dir = miniRoot({ "score.mjs": stubScore(800) });
  await withStudio(dir, async (s, sse) => {
    await sleep(100);
    fs.writeFileSync(path.join(dir, "score.mjs"), stubScore(800, "// edit 1"));
    await sleep(300);
    fs.writeFileSync(path.join(dir, "score.mjs"), stubScore(800, "// edit 2"));
    await sse.wait("audio-ready", { timeout: 8000 });
    await sleep(1500); // room for a wrong second audio-ready to show up
    assert.equal(sse.count("audio-ready"), 1, "one audio-ready for the whole burst");
    assert.equal(fs.readFileSync(path.join(dir, "out/runs.log"), "utf8").trim().split("\n").length, 2, "the first run plus ONE coalesced run, not one per edit");
  });
});

test("a failing score reports audio-error, keeps the last good WAV, and recovers on the next edit", async () => {
  const dir = miniRoot({ "score.mjs": stubScore(0) });
  await withStudio(dir, async (s, sse) => {
    await sse.wait("audio-ready", { timeout: 5000 });
    const wav = path.join(dir, "out/studio-audio.wav");
    assert.ok(fs.statSync(wav).size > 0);
    let mark = sse.mark();
    fs.writeFileSync(path.join(dir, "score.mjs"), 'console.error("boom: unknown cue"); process.exit(1);\n');
    const err = await sse.wait("audio-error", { after: mark, timeout: 5000 });
    assert.match(err.data.message, /boom: unknown cue/);
    assert.ok(fs.statSync(wav).size > 0, "the last good WAV is still there");
    assert.equal((await request(s.port, { path: "/out/studio-audio.wav" })).status, 200);
    const late = connectSSE(s.port);
    try { await late.ready; await late.wait("audio-error", { timeout: 2000 }); } finally { late.close(); }
    mark = sse.mark();
    fs.writeFileSync(path.join(dir, "score.mjs"), stubScore(0, "// fixed"));
    await sse.wait("audio-ready", { after: mark, timeout: 5000 });
  });
});

test("without a score.mjs the studio says so and carries on", async () => {
  await withStudio(miniRoot(), async (s, sse) => {
    const err = await sse.wait("audio-error", { timeout: 3000 });
    assert.match(err.data.message, /no score\.mjs/);
    assert.equal((await request(s.port, { path: "/" })).status, 200);
  });
});

test("an unparseable timeline.json is a 500 that names the file, not a crash", async () => {
  await withStudio(miniRoot({ "timeline.json": "{ half an edit" }), async (s) => {
    const r = await request(s.port, { path: "/api/project" });
    assert.equal(r.status, 500);
    assert.match(JSON.parse(r.body).error, /timeline\.json is not valid JSON/);
    assert.equal((await request(s.port, { path: "/" })).status, 200);
  });
});

test("each run has its own token, and close() returns with a client still connected", async () => {
  const a = miniRoot(), b = miniRoot();
  const sa = await startStudio({ root: a, port: 0, log: quiet });
  const sb = await startStudio({ root: b, port: 0, log: quiet });
  const sse = connectSSE(sa.port);
  try {
    await sse.ready;
    assert.notEqual(sa.token, sb.token);
    assert.notEqual(sa.run, sb.run);
    const closed = await Promise.race([sa.close().then(() => "closed"), sleep(3000).then(() => "hung")]);
    assert.equal(closed, "closed", "an open event stream must not keep the server alive");
  } finally {
    sse.close();
    await sb.close();
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

// ---- the command line ----
function runCli(dir, args = []) {
  const child = spawn(process.execPath, ["studio.mjs", ...args], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  const out = { stdout: "", stderr: "", child, exit: new Promise((r) => child.on("close", (code) => r(code))) };
  child.stdout.on("data", (d) => { out.stdout += d; });
  child.stderr.on("data", (d) => { out.stderr += d; });
  return out;
}
const listenOn = (port) => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(port, "127.0.0.1", () => resolve(s));
});

test("the CLI prints its URL, serves, and stops on SIGTERM", async () => {
  const dir = miniRoot();
  const cli = runCli(dir, ["--port=0"]);
  try {
    const m = await waitFor(() => /studio: (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(cli.stdout), { timeout: 8000, what: "the URL line" });
    const r = await request(Number(m[2]), { path: "/" });
    assert.equal(r.status, 200);
    cli.child.kill("SIGTERM");
    assert.equal(await Promise.race([cli.exit, sleep(4000).then(() => "hung")]), 0);
  } finally {
    cli.child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("when the default port is busy the CLI takes a free one; an explicit busy port is an error", async () => {
  const dir = miniRoot();
  let holder;
  try { holder = await listenOn(4321); } catch { /* something else holds 4321: the port is busy all the same */ }
  const cli = runCli(dir);
  try {
    const m = await waitFor(() => /studio: (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(cli.stdout), { timeout: 8000, what: "the URL line" });
    assert.notEqual(m[2], "4321");
    assert.match(cli.stdout, /port 4321 is busy/);
    assert.equal((await request(Number(m[2]), { path: "/" })).status, 200);
  } finally {
    cli.child.kill("SIGKILL");
    holder?.close();
  }
  const busy = await listenOn(0);
  try {
    const explicit = runCli(dir, [`--port=${busy.address().port}`]);
    assert.equal(await explicit.exit, 1);
    assert.match(explicit.stderr, /in use/);
    const bad = runCli(dir, ["--port=abc"]);
    assert.equal(await bad.exit, 2);
  } finally {
    busy.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
