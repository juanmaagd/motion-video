// Logo fidelity, step 1: render the SHIPPED brand.logo SVG, untouched, at exactly the box the
// composition reports for time t -- over the brand's own background. Pairs with logoqa.py, which
// diffs this reference against a poster frame pixel for pixel (L: the final lockup must match the
// brand's own SVG, not a redrawn or resampled copy).
//
// Contract: the composition (index.html) may expose `window.__logoBox = (t) => ({x, y, w, h}) | null`
// -- the on-screen box (full-resolution video px) the logo occupies at time t, or null when it is not
// shown. This script skips (exit 2) when brand.json has no logo, or the composition has no hook, or
// the hook returns null at the requested time -- no logo lockup is not an error.
//
//   node brandqa.mjs --t=7.45 [--out=out/logo-ref.png]
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, "timeline.json"), "utf8"));
const BRAND = JSON.parse(fs.readFileSync(path.join(ROOT, "brand.json"), "utf8"));
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const t = parseFloat(arg.t ?? String(TL.duration - 1 / TL.fps));
const out = path.resolve(ROOT, arg.out ?? "out/logo-ref.png");

if (!BRAND.logo) {
  console.log("logo fidelity: skipped (brand.json has no logo)");
  process.exit(2);
}
// Match loadLogo()'s own check (engine.js): a declared but missing file is the same as "no logo"
// for this report -- otherwise it would diff a broken <img> against the composition's own
// disc-mark fallback and report a misleading near-total mismatch.
if (!fs.existsSync(path.join(ROOT, BRAND.logo))) {
  console.log(`logo fidelity: skipped (brand.logo "${BRAND.logo}" does not exist)`);
  process.exit(2);
}

// Same cached-Chromium lookup as render.mjs, kept standalone so this file works on its own.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [path.join(os.homedir(), "Library/Caches/ms-playwright"), path.join(os.homedir(), ".cache/ms-playwright"), process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const bins = [
    "chrome-headless-shell-mac-arm64/chrome-headless-shell", "chrome-headless-shell-mac-x64/chrome-headless-shell",
    "chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/headless_shell",
  ];
  const found = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter((n) => n.startsWith("chromium_headless_shell-"))) {
      for (const b of bins) { const p = path.join(r, d, b); if (fs.existsSync(p)) found.push([parseInt(d.split("-").pop(), 10), p]); }
    }
  }
  if (found.length) return found.sort((a, b) => b[0] - a[0])[0][1];
  throw new Error("No Chromium headless shell found. Run `npx playwright install chromium-headless-shell` or set CHROME_PATH.");
}

// Requests are contained to the project folder by REAL path: path.relative, never a string prefix
// (a sibling folder "<root>-secret" starts with "<root>"), and a symlink cannot lead out of it.
// Kept inline so this skill's file does not depend on another skill's (engine serve.mjs does the same).
const REAL_ROOT = fs.realpathSync(ROOT);
const inside = (p) => { const rel = path.relative(REAL_ROOT, p); return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel)); };
function fileFor(urlPath) {
  try {
    const p = fs.realpathSync(path.join(ROOT, decodeURIComponent(urlPath)));
    return inside(p) && fs.statSync(p).isFile() ? p : null;
  } catch { return null; }
}
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  const p = fileFor(new URL(req.url, "http://x").pathname);
  if (!p) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: findChrome(), args: ["--font-render-hinting=none", "--hide-scrollbars", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: TL.width, height: TL.height } });
await page.goto(base + "index.html");
await page.waitForFunction(() => window.__ready === true);
const hasHook = await page.evaluate(() => typeof window.__logoBox === "function");
const box = hasHook ? await page.evaluate((tt) => window.__logoBox(tt), t) : null;
if (!box) {
  console.log(`logo fidelity: skipped (${hasHook ? `no logo shown at t=${t}` : "composition has no window.__logoBox hook"})`);
  await browser.close();
  server.close();
  process.exit(2);
}
if (!(box.w > 0) || !(box.h > 0)) {
  console.error(`logo fidelity: FAIL -- window.__logoBox(${t}) returned a degenerate box (${JSON.stringify(box)}); nothing to render`);
  await browser.close();
  server.close();
  process.exit(1);
}

const ref = await browser.newPage({ viewport: { width: TL.width, height: TL.height } });
const bg = BRAND.colors?.bg ?? "#ffffff";
await ref.setContent(`<!doctype html><base href="${base}"><body style="margin:0;background:${bg}"><img src="${BRAND.logo}" style="position:absolute;left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px"></body>`);
await ref.waitForFunction(() => document.images[0].complete);
// `complete` becomes true even for a BROKEN image load (a malformed/corrupt SVG) -- it is not
// proof anything actually rendered. naturalWidth stays 0 for a failed load; only that means the
// screenshot below is a real logo, not a silently blank/broken one passed off as a reference.
const loaded = await ref.evaluate(() => document.images[0].naturalWidth > 0);
if (!loaded) {
  console.error(`logo fidelity: FAIL -- ${BRAND.logo} did not actually render (broken or malformed SVG); no reference produced`);
  await browser.close();
  server.close();
  process.exit(1);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, await ref.screenshot({ type: "png" }));
fs.writeFileSync(out.replace(/\.png$/, ".json"), JSON.stringify(box));
console.log(`logo ref: box ${box.x.toFixed(1)},${box.y.toFixed(1)} ${box.w.toFixed(1)}x${box.h.toFixed(1)} -> ${out}`);
await browser.close();
server.close();
