// Studio server: a live preview of the composition for the person editing it.
//
//   npm run studio                 (node studio.mjs [--port=4321])
//
// Serves this folder to 127.0.0.1 only (default port 4321; when that is busy it takes a free one,
// unless --port was given). The page it opens, studio.html, holds the player: the composition runs
// in an iframe and is driven with window.renderAt(t) from the parent page, so nothing studio-related
// runs inside index.html and render.mjs / determinism.mjs still load index.html on its own.
//
// This process pushes server-sent events on GET /__events:
//   hello {run}                   once per connection; a changed `run` means the server restarted
//   reload {path}                 a source file changed (debounced 150 ms)
//   audio-stale                   the audio is being regenerated (sent at start, and again on each edit)
//   audio-ready {url, mtime}      out/studio-audio.wav is fresh (also sent to a page that connects later)
//   audio-error {message}         score.mjs failed or is missing; the last good WAV, if any, stays served
//   syntax-error {file, line, column, message}   a .html/.js/.mjs file does not parse (checked with `node --check` on
//                                 every change; the reload is held back until every such file parses)
//   feedback-changed              feedback.json changed (the studio's own write, the agent's, or a hand edit)
// A syntax error is reported by the server at once rather than found by the page after a 5 s timeout: the browser
// tells only the page's own window about a parse error, and it fires before the studio page can listen.
// Audio comes from `node score.mjs --out=out/.studio-audio.wav.tmp`, renamed onto
// out/studio-audio.wav when it succeeds (build.mjs writes and deletes a WAV of its own, so the
// studio makes its own).
//
// Notes (click the frame in the page): GET /api/feedback, POST /api/feedback, PATCH /api/feedback/:id, all
// against feedback.json, the review's working file. The server builds each note itself from what the page
// sends (id, createdAt, frame and the status are its own) and refuses anything malformed with a 400 and no write.
//
// Writes are guarded (see readJSONBody): a JSON POST with the per-run token, the studio's own Origin
// and an allowed Host. Every request, reads included, must carry an allowed Host, which is what stops
// DNS rebinding from reading the page (and its token) through a hostile name that points at 127.0.0.1.
// updateJSON is the one way this server writes a project file.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStaticHandler, listen } from "./serve.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4321;
const MAX_BODY = 64 * 1024;
const DEBOUNCE_MS = 150;
const HEARTBEAT_MS = 15000;
const AUDIO_TIMEOUT_MS = 60000;
const AUDIO_SOURCES = new Set(["score.mjs", "synth-kit.mjs", "timeline.json"]);
const AUDIO_URL = "/out/studio-audio.wav";
const AUDIO_TMP = "out/.studio-audio.wav.tmp";

// ---------------------------------------------------------------- project files ----

async function readJSON(file, fallback) {
  let text;
  try {
    text = await fs.promises.readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT" && fallback !== undefined) return typeof fallback === "function" ? fallback() : fallback;
    throw e;
  }
  try { return JSON.parse(text); } catch (e) { throw new Error(`${path.basename(file)} is not valid JSON: ${e.message}`); }
}

// One writer at a time. Every update re-reads the file from disk inside the lock, so an edit made by
// a person or the agent between two calls is never overwritten with a stale copy.
let writeChain = Promise.resolve();

// Read-modify-write `file` (JSON) atomically: mutate(current) returns the new document, or undefined to
// leave the file alone. The new content goes to a temp file in the same folder and is renamed over
// the original, so a reader never sees half a file. A missing file starts from `fallback`; an existing
// file that is not valid JSON is never overwritten (it may be mid-edit). A throw writes nothing.
export function updateJSON(file, mutate, fallback) {
  const run = async () => {
    const current = await readJSON(file, fallback);
    const next = await mutate(current);
    if (next === undefined) return current;
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
      await fs.promises.writeFile(tmp, JSON.stringify(next, null, 2) + "\n");
      await fs.promises.rename(tmp, file);
    } catch (e) {
      await fs.promises.rm(tmp, { force: true });
      throw e;
    }
    return next;
  };
  const result = writeChain.then(run, run);
  writeChain = result.catch(() => {}); // a failed update must not block the next one
  return result;
}

// Paths (relative to the project, "/"-separated) whose changes must not reload the page.
export function isIgnored(rel) {
  const parts = rel.split("/");
  if (parts[0] === "out" || /^v\d+$/.test(parts[0])) return true;                  // renders; archive folders
  if (parts.some((p) => p.startsWith(".") || p === "node_modules" || p === "__pycache__")) return true;
  if (rel === "feedback.json") return true;                                        // written by the studio itself
  const name = parts[parts.length - 1];
  return /\.(tmp|swp)$/.test(name) || name.endsWith("~");                          // atomic-write and editor temp files
}

// ---------------------------------------------------------------- syntax checks ----

// `node --check` reads the source on stdin, so nothing is written anywhere. Resolves to
// { line, column, message } for a syntax error, or null when it parses (or cannot be checked).
function nodeCheck(source, type) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", `--input-type=${type}`, "-"], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { if (err.length < 8000) err += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.on("error", () => { clearTimeout(timer); resolve(null); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? null : parseNodeError(err)); });
    child.stdin.on("error", () => {});
    child.stdin.end(source);
  });
}
// node prints "[stdin]:LINE", the source line, a caret line, then "SyntaxError: message".
function parseNodeError(err) {
  const lines = err.split("\n");
  const at = lines.findIndex((l) => /^\[stdin\]:\d+$/.test(l));
  const message = lines.find((l) => /^\w*Error: /.test(l));
  if (at < 0 || !message) return null;
  return { line: Number(lines[at].slice(8)), column: Math.max(0, (lines[at + 2] ?? "").indexOf("^")) + 1, message };
}

// The inline <script> blocks of an HTML file that hold code (not JSON, import maps or templates), each with
// the position its code starts at, so a report can name the line and column in the HTML file itself.
export function inlineScripts(html) {
  const found = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(m[1])?.[1]?.toLowerCase();
    if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
    const start = m.index + "<script".length + m[1].length + 1, before = html.slice(0, start);
    found.push({ code: m[2], module: type === "module", line: before.split("\n").length, column: start - (before.lastIndexOf("\n") + 1) });
  }
  return found;
}

// First syntax error in a project file, as { file, line, column, message }, or null. Only .html (its inline
// scripts), .js and .mjs are looked at. Lines and columns are those of the file itself.
async function checkFile(root, rel) {
  const isHtml = /\.html?$/i.test(rel);
  if (!isHtml && !/\.m?js$/.test(rel)) return null;
  if (rel === "studio.html") return null; // the player itself, not the composition
  let text;
  try { text = await fs.promises.readFile(path.join(root, rel), "utf8"); } catch { return null; } // deleted meanwhile
  const parts = isHtml ? inlineScripts(text) : [{ code: text, module: true, line: 1, column: 0 }];
  for (const part of parts) {
    const found = await nodeCheck("\n".repeat(part.line - 1) + " ".repeat(part.column) + part.code, part.module ? "module" : "commonjs");
    if (found) return { file: rel, ...found };
  }
  return null;
}

// Every .html and .js file under the project (not the ignored places), for the check made at start-up.
function browserFiles(root, dir = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (isIgnored(rel)) continue;
    if (e.isDirectory()) out.push(...browserFiles(root, rel));
    else if (/\.(html?|js)$/i.test(e.name)) out.push(rel);
  }
  return out;
}

// ------------------------------------------------------------------- feedback notes ----

export class BadRequest extends Error {}
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const need = (cond, msg) => { if (!cond) throw new BadRequest(msg); };
const finite = (v, what) => { need(typeof v === "number" && Number.isFinite(v), `${what} must be a finite number`); return v; };
const int = (v, what) => { need(Number.isInteger(v) && v >= 0, `${what} must be a non-negative integer`); return v; };
const text = (v, what, max, min = 0) => { need(typeof v === "string" && v.length >= min && v.length <= max, `${what} must be a string of ${min}..${max} characters`); return v; };
const STATUSES = ["open", "resolved", "wontfix"];

// Builds a note from the page's request body: only known fields survive, and the server fills in the
// rest. `tl` is the current timeline.json (the duration and size the request is checked against).
export function buildNote(body, tl) {
  need(isObj(body), "the body must be a JSON object");
  const t = finite(body.t, "t");
  need(t >= 0 && t <= tl.duration, `t must be within 0..${tl.duration}`);
  const note = { t, frame: Math.round(t * tl.fps) };

  need(isObj(body.point) && isObj(body.point.stage), "point and point.stage are required");
  const x = finite(body.point.x, "point.x"), y = finite(body.point.y, "point.y");
  need(x >= 0 && x <= tl.width && y >= 0 && y <= tl.height, "point must lie inside the frame");
  const sx = finite(body.point.stage.x, "point.stage.x"), sy = finite(body.point.stage.y, "point.stage.y");
  need(Math.abs(sx) < 1e6 && Math.abs(sy) < 1e6, "point.stage is out of range");
  note.point = { x, y, stage: { x: sx, y: sy } };

  const c = body.context;
  need(isObj(c), "context is required");
  const named = (v, what, extra) => (v == null ? null : (need(isObj(v), `${what} must be an object or null`), { name: text(v.name, `${what}.name`, 200), ...extra(v) }));
  note.context = {
    bar: int(c.bar, "context.bar"), beat: int(c.beat, "context.beat"),
    cue: named(c.cue, "context.cue", (v) => ({ t: finite(v.t, "context.cue.t") })),
    next: named(c.next, "context.next", (v) => ({ in: finite(v.in, "context.next.in") })),
    scene: named(c.scene, "context.scene", (v) => ({ index: int(v.index, "context.scene.index") })),
  };
  // key order matches the documented schema: scene = { index, name }
  if (note.context.scene) note.context.scene = { index: note.context.scene.index, name: note.context.scene.name };

  const g = body.target;
  if (g == null) note.target = null;
  else {
    need(isObj(g) && isObj(g.rect), "target must be an object with a rect, or null");
    note.target = {
      tag: text(g.tag, "target.tag", 32, 1), class: text(g.class ?? "", "target.class", 200), text: text(g.text ?? "", "target.text", 80),
      rect: { x: finite(g.rect.x, "target.rect.x"), y: finite(g.rect.y, "target.rect.y"), w: finite(g.rect.w, "target.rect.w"), h: finite(g.rect.h, "target.rect.h") },
      path: text(g.path ?? "", "target.path", 400),
    };
  }
  note.text = text(typeof body.text === "string" ? body.text.trim() : body.text, "text", 2000, 1);
  return note;
}

// The body of PATCH /api/feedback/:id: a status, and the one-line resolution that goes with it.
export function buildPatch(body) {
  need(isObj(body), "the body must be a JSON object");
  need(Object.keys(body).every((k) => k === "status" || k === "resolution"), "only status and resolution can be set");
  need(STATUSES.includes(body.status), `status must be one of ${STATUSES.join(", ")}`);
  const resolution = body.resolution == null ? null : text(body.resolution, "resolution", 500);
  return { status: body.status, resolution: resolution === "" ? null : resolution };
}

// feedback.json must be the v1 shape before the server appends to it; anything else is left untouched.
function checkFeedback(doc) {
  if (!isObj(doc) || doc.version !== 1 || !Array.isArray(doc.notes)) throw new Error("feedback.json is not a version 1 feedback file, so it was left alone");
  return doc;
}
const emptyFeedback = () => ({ version: 1, notes: [] });
// n1, n2, ...: short enough to say aloud ("fix n3"), unique because it is computed inside the write lock.
function nextId(notes) {
  const used = notes.map((n) => /^n(\d+)$/.exec(n?.id)?.[1]).filter(Boolean).map(Number);
  return `n${Math.max(0, ...used) + 1}`;
}

// ------------------------------------------------------------------- the server ----

const send = (res, status, body, headers = {}) => {
  const isJSON = typeof body !== "string" && !Buffer.isBuffer(body);
  const payload = isJSON ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "content-type": isJSON ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers,
  });
  res.end(payload);
};

export async function startStudio({ root = ROOT, port, log = (m) => console.log(`studio: ${m}`) } = {}) {
  const realRoot = fs.realpathSync(root);
  const file = (name) => path.join(realRoot, name);
  const token = crypto.randomBytes(16).toString("hex");
  const run = crypto.randomBytes(6).toString("hex");
  const staticHandler = createStaticHandler(realRoot);
  const clients = new Set();
  let listening = 0;
  let closed = false;

  // ---- request checks ----
  const allowedHost = (h) => h === `127.0.0.1:${listening}` || h === `localhost:${listening}`;

  // Host allowlist on every request (DNS rebinding); a present Origin must be this very origin.
  const badRequestSource = (req) => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHost(host)) return "host not allowed";
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) return "origin not allowed";
    return null;
  };

  // The guard for every mutating endpoint. Answers the request itself and returns null when it
  // refuses; otherwise the parsed JSON body. Nothing is written before all of it has passed.
  async function readJSONBody(req, res, method = "POST") {
    if (req.method !== method) { send(res, 405, { error: `${method} only` }, { allow: method }); return null; }
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") { send(res, 415, { error: "content-type must be application/json" }); return null; }
    // Origin is mandatory here (a browser sends it on every cross-origin POST, and on same-origin ones).
    if (req.headers.origin !== `http://${(req.headers.host ?? "").toLowerCase()}`) { send(res, 403, { error: "origin not allowed" }); return null; }
    const sent = Buffer.from(String(req.headers["x-studio-token"] ?? ""));
    const want = Buffer.from(token);
    if (sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) { send(res, 403, { error: "bad token" }); return null; }
    const declared = req.headers["content-length"];
    if (declared !== undefined && Number(declared) > MAX_BODY) { send(res, 413, { error: "body too large" }); return null; }
    // Count as it streams (a chunked body has no Content-Length). Past the limit nothing more is kept
    // and 413 goes out at once; the rest of the upload is read and dropped, never destroyed
    // mid-flight, so the client still receives the answer.
    const body = await new Promise((resolve) => {
      const chunks = [];
      let size = 0, over = false;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { over = true; chunks.length = 0; resolve({ over }); } else if (!over) chunks.push(chunk);
      });
      req.on("end", () => resolve({ raw: Buffer.concat(chunks) }));
      req.on("close", () => resolve({ gone: true }));
    });
    if (body.gone) return null;
    if (body.over) { send(res, 413, { error: "body too large" }); return null; }
    try {
      return JSON.parse(body.raw.toString("utf8"));
    } catch {
      send(res, 400, { error: "body is not valid JSON" });
      return null;
    }
  }

  // ---- server-sent events ----
  const audio = { status: "stale", url: null, mtime: 0, message: "" };
  const sse = (res, event, data = {}) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  function broadcast(event, data) {
    for (const c of clients) { try { sse(c, event, data); } catch { clients.delete(c); } }
  }
  const snapshot = () => (audio.status === "ready" ? ["audio-ready", { url: audio.url, mtime: audio.mtime }]
    : audio.status === "error" ? ["audio-error", { message: audio.message }] : ["audio-stale", {}]);
  const heartbeat = setInterval(() => { for (const c of clients) c.write(": heartbeat\n\n"); }, HEARTBEAT_MS);
  heartbeat.unref();

  // ---- audio: one regeneration at a time, requests that arrive meanwhile coalesce into one more ----
  let running = false, pending = false, child = null;
  function requestAudio() {
    if (closed) return;
    if (running) { pending = true; return; }
    regenerateAudio();
  }
  async function regenerateAudio() {
    running = true;
    pending = false;
    audio.status = "stale";
    broadcast("audio-stale");
    const t0 = Date.now();
    let ok = false, message = "";
    if (!fs.existsSync(file("score.mjs"))) {
      message = "there is no score.mjs in this project, so the studio plays without sound";
    } else {
      child = spawn(process.execPath, ["score.mjs", `--out=${AUDIO_TMP}`], { cwd: realRoot, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-4000); });
      const timer = setTimeout(() => child?.kill("SIGKILL"), AUDIO_TIMEOUT_MS);
      const code = await new Promise((resolve) => {
        child.on("error", (e) => { stderr += e.message; resolve(-1); });
        child.on("close", (c) => resolve(c ?? -1));
      });
      clearTimeout(timer);
      child = null;
      if (closed) return;
      try {
        if (code !== 0) throw new Error("");
        if (fs.statSync(file(AUDIO_TMP)).size === 0) throw new Error("score.mjs wrote an empty file");
        fs.renameSync(file(AUDIO_TMP), file(AUDIO_URL.slice(1)));
        ok = true;
      } catch (e) {
        const last = stderr.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
        message = (last || e.message || `score.mjs exited with code ${code}`).slice(0, 400);
        fs.rmSync(file(AUDIO_TMP), { force: true });
      }
    }
    running = false;
    if (pending) return regenerateAudio(); // already announced as stale; report only the newest result
    if (ok) {
      const mtime = Math.round(fs.statSync(file(AUDIO_URL.slice(1))).mtimeMs);
      Object.assign(audio, { status: "ready", url: `${AUDIO_URL}?v=${mtime}`, mtime });
      log(`audio ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      broadcast("audio-ready", { url: audio.url, mtime });
    } else {
      Object.assign(audio, { status: "error", message });
      log(`audio: ${message}`);
      broadcast("audio-error", { message });
    }
  }

  // ---- watcher: any source change reloads; score and timeline changes also regenerate the audio ----
  const changed = [];
  const syntaxErrors = new Map(); // file -> its syntax error, for every checked file that currently has one
  let debounce = null, feedbackTimer = null, flushChain = Promise.resolve();

  // A change batch: recheck the code files in it, then either report the (first) syntax error and hold the
  // reload back, or reload. Batches run one after another, so a later one never overtakes an earlier check.
  async function flush(paths) {
    if (closed) return;
    for (const rel of paths) {
      if (!/\.(html?|m?js)$/i.test(rel)) continue;
      const found = await checkFile(realRoot, rel);
      if (found) syntaxErrors.set(rel, found); else syntaxErrors.delete(rel);
    }
    if (closed) return;
    if (syntaxErrors.size) {
      const first = syntaxErrors.values().next().value;
      log(`syntax error in ${first.file}:${first.line}:${first.column}: ${first.message}`);
      broadcast("syntax-error", first);
    } else {
      log(`reload (${paths[0] || "unknown file"}${paths.length > 1 ? ` +${paths.length - 1}` : ""})`);
      broadcast("reload", { path: paths[0] });
    }
    if (paths.some((p) => AUDIO_SOURCES.has(p))) requestAudio();
  }
  const watcher = fs.watch(realRoot, { recursive: true }, (_event, filename) => {
    const rel = filename ? String(filename).split(path.sep).join("/") : "";
    if (rel === "feedback.json") { // never a reload (the studio writes it itself), but an open notes panel must hear of it
      clearTimeout(feedbackTimer);
      feedbackTimer = setTimeout(() => broadcast("feedback-changed"), DEBOUNCE_MS);
      return;
    }
    if (rel && isIgnored(rel)) return;
    changed.push(rel);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const paths = [...new Set(changed.splice(0))];
      flushChain = flushChain.then(() => flush(paths)).catch((e) => log(`could not handle a change: ${e.message}`));
    }, DEBOUNCE_MS);
  });
  watcher.on("error", (e) => log(`watcher error: ${e.message}`));

  // ---- routes ----
  async function route(req, res) {
    const refused = badRequestSource(req);
    if (refused) return send(res, 403, { error: refused });
    const pathname = (req.url ?? "/").split(/[?#]/)[0];

    if (pathname === "/" || pathname === "/studio.html") {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "GET only" }, { allow: "GET, HEAD" });
      let html;
      try { html = await fs.promises.readFile(file("studio.html"), "utf8"); } catch { return send(res, 500, "studio.html is missing next to studio.mjs"); }
      return send(res, 200, req.method === "HEAD" ? "" : html.replaceAll("__STUDIO_TOKEN__", token), {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": "frame-ancestors 'none'", // the page has buttons that write: never framed by another site
        "referrer-policy": "no-referrer",
      });
    }

    if (pathname === "/__events") {
      if (req.method !== "GET") return send(res, 405, { error: "GET only" }, { allow: "GET" });
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store, no-transform", connection: "keep-alive" });
      res.write("retry: 1000\n\n");
      sse(res, "hello", { run });
      sse(res, ...snapshot());
      if (syntaxErrors.size) sse(res, "syntax-error", syntaxErrors.values().next().value);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (pathname === "/api/project") {
      if (req.method !== "GET") return send(res, 405, { error: "GET only" }, { allow: "GET" });
      try {
        return send(res, 200, {
          timeline: await readJSON(file("timeline.json")),
          brand: await readJSON(file("brand.json"), {}),
          feedback: await readJSON(file("feedback.json"), () => ({ version: 1, notes: [] })),
        });
      } catch (e) {
        return send(res, 500, { error: e.message });
      }
    }

    // Token handshake: a page whose token no longer matches (the server restarted) learns it here.
    if (pathname === "/api/ping") {
      if ((await readJSONBody(req, res)) === null) return;
      return send(res, 200, { ok: true });
    }

    if (pathname === "/api/feedback") {
      if (req.method === "GET") {
        try { return send(res, 200, checkFeedback(await readJSON(file("feedback.json"), emptyFeedback))); } catch (e) { return send(res, 500, { error: e.message }); }
      }
      const body = await readJSONBody(req, res);
      if (body === null) return;
      try {
        const note = buildNote(body, await readJSON(file("timeline.json")));
        const doc = await updateJSON(file("feedback.json"), (d) => {
          checkFeedback(d);
          return { ...d, notes: [...d.notes, { id: nextId(d.notes), createdAt: new Date().toISOString(), status: "open", ...note, resolution: null }] };
        }, emptyFeedback);
        return send(res, 201, { note: doc.notes[doc.notes.length - 1] });
      } catch (e) {
        return send(res, e instanceof BadRequest ? 400 : 500, { error: e.message });
      }
    }

    const patchId = /^\/api\/feedback\/([A-Za-z0-9_-]{1,64})$/.exec(pathname)?.[1];
    if (patchId) {
      const body = await readJSONBody(req, res, "PATCH");
      if (body === null) return;
      try {
        const patch = buildPatch(body);
        let found = false;
        const doc = await updateJSON(file("feedback.json"), (d) => {
          checkFeedback(d);
          if (!d.notes.some((n) => n?.id === patchId)) return undefined; // nothing to change: leave the file alone
          found = true;
          return { ...d, notes: d.notes.map((n) => (n?.id === patchId ? { ...n, ...patch } : n)) };
        }, emptyFeedback);
        return found ? send(res, 200, { note: doc.notes.find((n) => n.id === patchId) }) : send(res, 404, { error: `no note ${patchId}` });
      } catch (e) {
        return send(res, e instanceof BadRequest ? 400 : 500, { error: e.message });
      }
    }

    if (pathname.startsWith("/api/")) return send(res, 404, { error: "no such endpoint" });
    return staticHandler(req, res);
  }

  const server = await listenPreferred(async (req, res) => {
    try {
      await route(req, res);
    } catch (e) {
      log(`request failed: ${e.message}`);
      if (!res.headersSent) send(res, 500, { error: "internal error" }); else res.destroy();
    }
  }, port);
  listening = server.address().port;
  const url = `http://127.0.0.1:${listening}/`;
  requestAudio(); // the first WAV, so the page has sound as soon as it opens
  // A project that is already broken when the studio starts: find out now, so a page that opens onto it is told at once.
  (async () => {
    for (const rel of browserFiles(realRoot)) {
      const found = await checkFile(realRoot, rel);
      if (found && !closed) syntaxErrors.set(rel, found);
    }
    if (syntaxErrors.size && !closed) broadcast("syntax-error", syntaxErrors.values().next().value);
  })().catch((e) => log(`start-up syntax check failed: ${e.message}`));

  async function close() {
    if (closed) return;
    closed = true;
    clearTimeout(debounce);
    clearTimeout(feedbackTimer);
    clearInterval(heartbeat);
    watcher.close();
    child?.kill("SIGKILL");
    for (const c of clients) c.end();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  return { server, port: listening, url, token, run, close };
}

// Default port when none was asked for, then any free one; an explicit port must be that port.
async function listenPreferred(handler, port) {
  if (port !== undefined) return listen(handler, { port });
  try {
    return await listen(handler, { port: DEFAULT_PORT });
  } catch (e) {
    if (e.code !== "EADDRINUSE") throw e;
    console.log(`studio: port ${DEFAULT_PORT} is busy, using a free one`);
    return listen(handler, { port: 0 });
  }
}

// ------------------------------------------------------------------------- CLI ----
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const arg = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : "true"]; }));
  const port = arg.port === undefined ? undefined : Number(arg.port);
  if (port !== undefined && !(Number.isInteger(port) && port >= 0 && port < 65536)) {
    console.error("studio: --port must be an integer from 0 to 65535");
    process.exit(2);
  }
  let studio;
  try {
    studio = await startStudio({ port });
  } catch (e) {
    console.error(`studio: cannot start: ${e.code === "EADDRINUSE" ? `port ${port} is in use` : e.message}`);
    process.exit(1);
  }
  console.log(`studio: ${studio.url}  (Ctrl+C to stop)`);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => studio.close().then(() => process.exit(0)));
}
