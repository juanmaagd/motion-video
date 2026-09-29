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
const { startStudio, updateJSON, isIgnored } = mod;

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
