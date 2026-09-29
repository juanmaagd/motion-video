// Static file server for the video project folder. Used by render.mjs, determinism.mjs and
// studio.mjs. Zero dependencies; read-only; localhost only.
//
//   import { createStaticHandler, listen } from "./serve.mjs";
//   const server = await listen(createStaticHandler(ROOT));   // 127.0.0.1, random free port
//
// Containment is checked on real paths, twice:
//   1. the requested path must stay inside the root, compared with path.relative and never with a
//      string prefix (a sibling folder "<root>-secret" starts with "<root>", so startsWith admits it);
//   2. the file must still be inside the root after symlinks are resolved.
// Dotfiles, dot-directories and node_modules are never served (that also covers out/.build/), there
// is no directory listing, and only GET and HEAD are answered.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
  ".wav": "audio/wav", ".mp4": "video/mp4",
};

// True when `target` is `root` itself or below it. A file called "..foo" is inside; "../foo" is not.
export function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

const denied = (seg) => seg.startsWith(".") || seg === "node_modules";

// Maps a URL path (no query string, still percent-encoded) to a file below `realRoot` (the realpath
// of the served folder). Returns { file } or { status, reason }; the reason is for tests and logs and
// is never sent to the client.
export function resolveStatic(realRoot, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return { status: 400, reason: "bad-encoding" }; }
  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\")) return { status: 400, reason: "bad-path" };
  const target = path.resolve(realRoot, "." + decoded);
  if (!isInside(realRoot, target)) return { status: 403, reason: "outside-root" };
  const rel = path.relative(realRoot, target);
  if (rel === "") return { status: 404, reason: "directory" };
  if (rel.split(path.sep).some(denied)) return { status: 403, reason: "denied-name" };
  let real;
  try { real = fs.realpathSync(target); } catch { return { status: 404, reason: "not-found" }; }
  if (!isInside(realRoot, real)) return { status: 403, reason: "symlink-escape" };
  if (path.relative(realRoot, real).split(path.sep).some(denied)) return { status: 403, reason: "denied-name" };
  return { file: real };
}

// (req, res) handler that serves files below `root`. It answers the request completely; a caller
// that has routes of its own (studio.mjs) handles those first and falls through to this.
export function createStaticHandler(root) {
  const realRoot = fs.realpathSync(root);
  const fail = (res, status, headers = {}) => { res.writeHead(status, { "cache-control": "no-store", ...headers }); res.end(); };
  return function staticHandler(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, { allow: "GET, HEAD" });
    const raw = req.url ?? "/", cut = raw.search(/[?#]/);
    const r = resolveStatic(realRoot, cut < 0 ? raw : raw.slice(0, cut));
    if (!r.file) return fail(res, r.status);
    // Open first and size from the descriptor, so Content-Length matches the bytes actually streamed
    // even if the file is replaced (atomic rename) between the checks above and the read.
    let fd;
    try {
      fd = fs.openSync(r.file, "r");
      const st = fs.fstatSync(fd);
      if (!st.isFile()) { fs.closeSync(fd); return fail(res, 404); }
      res.writeHead(200, {
        "content-type": TYPES[path.extname(r.file).toLowerCase()] ?? "application/octet-stream",
        "content-length": st.size, "cache-control": "no-store", "x-content-type-options": "nosniff",
      });
      if (req.method === "HEAD") { fs.closeSync(fd); return res.end(); }
      const stream = fs.createReadStream(null, { fd, autoClose: true });
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    } catch {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
      if (!res.headersSent) fail(res, 404); else res.destroy();
    }
  };
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

// Starts an http server for `handler`. Loopback hosts only: these are a person's project files.
export async function listen(handler, { host = "127.0.0.1", port = 0 } = {}) {
  if (!LOOPBACK.has(host)) throw new Error(`serve: refusing to listen on ${host}; project files are served to localhost only`);
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
  return server;
}
