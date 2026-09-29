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
// Audio comes from `node score.mjs --out=out/.studio-audio.wav.tmp`, renamed onto
// out/studio-audio.wav when it succeeds (build.mjs writes and deletes a WAV of its own, so the
// studio makes its own).
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
  async function readJSONBody(req, res) {
    if (req.method !== "POST") { send(res, 405, { error: "POST only" }, { allow: "POST" }); return null; }
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
  let debounce = null;
  const watcher = fs.watch(realRoot, { recursive: true }, (_event, filename) => {
    const rel = filename ? String(filename).split(path.sep).join("/") : "";
    if (rel && isIgnored(rel)) return;
    changed.push(rel);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const paths = changed.splice(0);
      log(`reload (${paths[0] || "unknown file"}${paths.length > 1 ? ` +${paths.length - 1}` : ""})`);
      broadcast("reload", { path: paths[0] });
      if (paths.some((p) => AUDIO_SOURCES.has(p))) requestAudio();
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

  async function close() {
    if (closed) return;
    closed = true;
    clearTimeout(debounce);
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
