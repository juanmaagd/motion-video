// Static serving: the engine's serve.mjs, and the tools that load the composition through a server.
//
// Regression for a path-traversal bug: the old servers checked `p.startsWith(ROOT)`, which also
// admits a SIBLING folder whose name starts with the root's ("/proj-secret" starts with "/proj").
// A request for "/..%2fproj-secret%2fx.txt" then returned the sibling's file.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { REPO, assembleProject, browserUnavailable, linkDeps, request, tmpDir } from "./_helpers.mjs";

const { createStaticHandler, isInside, listen, resolveStatic } = await import(
  pathToFileURL(path.join(REPO, "skills/motion-video-engine/assets/project/serve.mjs")).href);

// ---- fixture: <base>/proj (served), <base>/proj-secret/x.txt (must never be readable) ----
const SECRET = "TOP-SECRET-OUTSIDE-THE-ROOT";
const base = fs.realpathSync(tmpDir("mv-serve-"));
const root = path.join(base, "proj");
fs.mkdirSync(path.join(root, "sub"), { recursive: true });
fs.mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
fs.mkdirSync(path.join(root, ".git"), { recursive: true });
fs.mkdirSync(path.join(base, "proj-secret"));
fs.writeFileSync(path.join(base, "proj-secret/x.txt"), SECRET);
fs.writeFileSync(path.join(root, "index.html"), "<h1>ok</h1>");
fs.writeFileSync(path.join(root, "sub/file.txt"), "inside");
fs.writeFileSync(path.join(root, ".secret"), "dotfile");
fs.writeFileSync(path.join(root, ".git/config"), "git");
fs.writeFileSync(path.join(root, "node_modules/pkg/index.js"), "pkg");
fs.symlinkSync(path.join(base, "proj-secret"), path.join(root, "escape-dir"), "dir");
fs.symlinkSync(path.join(base, "proj-secret/x.txt"), path.join(root, "escape-file"));
fs.symlinkSync(path.join(root, "sub"), path.join(root, "inner-link"), "dir");
fs.symlinkSync(path.join(root, ".secret"), path.join(root, "to-dotfile"));

const server = await listen(createStaticHandler(root));
const port = server.address().port;
after(() => { server.close(); fs.rmSync(base, { recursive: true, force: true }); });

const get = (p, extra = {}) => request(port, { path: p, ...extra });
const noSecret = (r) => assert.ok(!r.body.includes(SECRET), "the secret bytes must never appear in a response");

// ---- the bug, and proof that the check discriminates ----
// A verbatim copy of the pre-fix handler body (render.mjs, determinism.mjs and brandqa.mjs).
function oldHandler(ROOT) {
  return (req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200);
    fs.createReadStream(p).pipe(res);
  };
}
const SIBLING = "/..%2fproj-secret%2fx.txt";
// The assertion under test: a sibling-prefix request must be refused and leak nothing.
async function siblingPrefixIsRefused(p) {
  const r = await request(p, { path: SIBLING });
  assert.ok([403, 404].includes(r.status), `sibling-prefix request returned ${r.status}`);
  noSecret(r);
}

test("the pre-fix startsWith check serves a sibling folder (the bug), so the assertion below can fail", async () => {
  const old = http.createServer(oldHandler(root));
  await new Promise((r) => old.listen(0, "127.0.0.1", r));
  try {
    const r = await request(old.address().port, { path: SIBLING });
    console.log(`  pre-fix handler:   GET ${SIBLING} -> ${r.status} ${JSON.stringify(r.body.toString())}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.toString(), SECRET);
    // The same assertion that guards the fix FAILS against the old logic: the check discriminates.
    await assert.rejects(siblingPrefixIsRefused(old.address().port), assert.AssertionError);
  } finally {
    old.close();
  }
});

test("serve.mjs refuses the sibling-prefix request that the old check served", async () => {
  const r = await get(SIBLING);
  console.log(`  serve.mjs handler: GET ${SIBLING} -> ${r.status}`);
  await siblingPrefixIsRefused(port);
  assert.equal(r.status, 403);
});

// ---- containment ----
test("traversal in every spelling is refused and leaks nothing", async () => {
  const paths = [
    "/..%2fproj-secret%2fx.txt", "/%2e%2e%2fproj-secret%2fx.txt", "/%2E%2E/proj-secret/x.txt", "/../proj-secret/x.txt",
    "/sub/..%2f..%2fproj-secret%2fx.txt", "/..%2f..%2f..%2f..%2f..%2f..%2fetc%2fpasswd", "//..%2fproj-secret%2fx.txt",
  ];
  for (const p of paths) {
    const r = await get(p);
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
    noSecret(r);
  }
});

test("a symlink that leaves the root is refused; one that stays inside is served", async () => {
  for (const p of ["/escape-dir/x.txt", "/escape-file"]) {
    const r = await get(p);
    assert.equal(r.status, 403, p);
    noSecret(r);
  }
  const ok = await get("/inner-link/file.txt");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), "inside");
});

test("the root may itself be reached through a symlink (macOS /tmp and /var are)", async () => {
  const alias = path.join(base, "alias");
  fs.symlinkSync(root, alias, "dir");
  const s = await listen(createStaticHandler(alias));
  try {
    const r = await request(s.address().port, { path: "/index.html" });
    assert.equal(r.status, 200);
    await siblingPrefixIsRefused(s.address().port);
  } finally {
    s.close();
  }
});

test("dotfiles, dot-directories and node_modules are never served, whatever the spelling", async () => {
  for (const p of ["/.secret", "/.git/config", "/node_modules/pkg/index.js", "/sub/..%2f.secret", "/to-dotfile", "/out/.build/master.nut", "/%2esecret"]) {
    const r = await get(p);
    assert.equal(r.status, 403, p);
    assert.ok(!r.body.includes("dotfile"), p);
  }
});

test("malformed paths are 400, and there is no directory listing", async () => {
  for (const p of ["/index.html%00.png", "/%E0%A4%A", "/..%5cproj-secret%5cx.txt"]) assert.equal((await get(p)).status, 400, p);
  for (const p of ["/", "/sub", "/sub/"]) assert.equal((await get(p)).status, 404, p);
  assert.equal((await get("/missing.txt")).status, 404);
});

test("GET and HEAD are served; every other method is 405", async () => {
  const g = await get("/index.html?x=1#frag");
  assert.equal(g.status, 200);
  assert.equal(g.body.toString(), "<h1>ok</h1>");
  assert.equal(g.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(g.headers["content-length"], String(g.body.length));
  assert.equal(g.headers["cache-control"], "no-store");
  const h = await request(port, { method: "HEAD", path: "/index.html" });
  assert.equal(h.status, 200);
  assert.equal(h.headers["content-length"], "11");
  assert.equal(h.body.length, 0);
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const r = await request(port, { method, path: "/index.html", body: "x" });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.allow, "GET, HEAD");
  }
  assert.equal(fs.readFileSync(path.join(root, "index.html"), "utf8"), "<h1>ok</h1>", "a refused write leaves the file alone");
});

test("resolveStatic names the reason for each refusal; isInside is not a prefix test", () => {
  assert.equal(resolveStatic(root, "/..%2fproj-secret%2fx.txt").reason, "outside-root");
  assert.equal(resolveStatic(root, "/escape-file").reason, "symlink-escape");
  assert.equal(resolveStatic(root, "/.secret").reason, "denied-name");
  assert.equal(resolveStatic(root, "/to-dotfile").reason, "denied-name", "a symlink INTO a denied name is refused too");
  assert.equal(resolveStatic(root, "/nope").reason, "not-found");
  assert.equal(resolveStatic(root, "/index.html").file, path.join(root, "index.html"));
  assert.equal(isInside("/a/proj", "/a/proj-secret/x"), false);
  assert.equal(isInside("/a/proj", "/a/proj/sub/x"), true);
  assert.equal(isInside("/a/proj", "/a/proj/..foo"), true, "a file NAMED ..foo is inside the root");
  assert.equal(isInside("/a/proj", "/a/proj/../x"), false);
});

test("listen refuses a non-loopback host", async () => {
  await assert.rejects(listen(() => {}, { host: "0.0.0.0" }), /localhost only/);
});

test("no tool in the family re-implements a string-prefix containment check", () => {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(m?js|html)$/.test(e.name) && /startsWith\((ROOT|root)\)/.test(fs.readFileSync(full, "utf8"))) hits.push(path.relative(REPO, full));
    }
  };
  walk(path.join(REPO, "skills"));
  assert.deepEqual(hits, [], "startsWith(ROOT) is not a containment check: /proj-secret starts with /proj");
});

// ---- the tools themselves, through a real browser ----
const skipBrowser = browserUnavailable();
if (skipBrowser) console.log(`  (browser wiring tests skipped: ${skipBrowser})`);

function probeProject(name) {
  const dir = path.join(tmpDir("mv-wire-"), name);
  assembleProject(dir);
  linkDeps(dir);
  fs.mkdirSync(path.join(path.dirname(dir), `${name}-secret`));
  fs.writeFileSync(path.join(path.dirname(dir), `${name}-secret/x.txt`), SECRET);
  return dir;
}

test("render.mjs no longer serves a sibling folder to the page", { skip: skipBrowser ?? false }, () => {
  const dir = probeProject("proj");
  try {
    fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><body><script>
      window.renderAt = () => {};
      fetch("/..%2fproj-secret%2fx.txt").then(async (r) => { console.error("leak-status=" + r.status + " body=" + (r.status === 200 ? await r.text() : "")); window.__ready = true; });
    </script>`);
    const r = spawnSync(process.execPath, ["render.mjs", "stills", "--times=0.5", "--scale=0.25", "--out=out/probe"], { cwd: dir, encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const m = /leak-status=(\d+) body=(.*)/.exec(r.stderr);
    assert.ok(m, `the page did not report a status:\n${r.stderr}`);
    console.log(`  render.mjs: sibling fetch from the page -> ${m[1]}`);
    assert.equal(m[1], "403");
    assert.ok(!r.stderr.includes(SECRET));
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test("brandqa.mjs no longer serves a sibling folder to the page", { skip: skipBrowser ?? false }, () => {
  const dir = probeProject("proj");
  try {
    fs.writeFileSync(path.join(dir, "brand/logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
    fs.writeFileSync(path.join(dir, "brand.json"), JSON.stringify({ logo: "brand/logo.svg" }));
    // brandqa writes the box the composition reports next to its reference PNG: report the HTTP status as x.
    fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html><body><script>
      let status = -1;
      window.__logoBox = () => ({ x: status, y: 0, w: 10, h: 10 });
      fetch("/..%2fproj-secret%2fx.txt").then((r) => { status = r.status; window.__ready = true; });
    </script>`);
    const r = spawnSync(process.execPath, ["brandqa.mjs", "--t=1", "--out=out/probe.png"], { cwd: dir, encoding: "utf8", timeout: 60000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const box = JSON.parse(fs.readFileSync(path.join(dir, "out/probe.json"), "utf8"));
    console.log(`  brandqa.mjs: sibling fetch from the page -> ${box.x}`);
    assert.equal(box.x, 404);
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});
