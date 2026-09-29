// Determinism proof: capture the same set of frames forward and in reverse order, IN THE SAME
// PAGE, and require the PNG bytes to be pixel-identical at every time. This is the check that would
// have caught a CSS-blend-mode grain layer compositing against a stale backdrop and leaking pixels
// from a frame rendered earlier in the page into a later one -- invisible in a spot check (any one
// frame looks fine), but exactly the failure mode a chunked/parallel render depends on not existing
// (render.mjs's workers each render a different, arbitrary-order slice of the timeline).
//
//   node determinism.mjs [--times=0.5,2.1,4.8] [--scale=0.5]
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticHandler, listen } from "./serve.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, "timeline.json"), "utf8"));
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const scale = parseFloat(arg.scale ?? "0.5");
const times = (arg.times ?? Array.from({ length: 8 }, (_, i) => +(((i + 0.5) * TL.duration) / 8).toFixed(3)).join(","))
  .split(",").map(Number).filter((t) => Number.isFinite(t));
// 0 times compared is 0 evidence, not a pass: a mistyped/empty --times must never read as
// "determinism: PASS" (a verifier that checked nothing must FAIL).
if (times.length === 0) {
  console.error("determinism: FAIL -- no valid times to compare (--times parsed to 0 usable values)");
  process.exit(1);
}

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

const server = await listen(createStaticHandler(ROOT));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch({ executablePath: findChrome(), args: ["--font-render-hinting=none", "--hide-scrollbars", "--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: TL.width, height: TL.height }, deviceScaleFactor: scale });
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const cdp = await page.context().newCDPSession(page);

async function capture(t) {
  await page.evaluate((tt) => window.renderAt(tt), t);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, clip: { x: 0, y: 0, width: TL.width, height: TL.height, scale } });
  return Buffer.from(data, "base64");
}

const forward = [];
for (const t of times) forward.push(await capture(t));
const reverseOrder = [...times].reverse();
const reverseCaptured = [];
for (const t of reverseOrder) reverseCaptured.push(await capture(t));
const reverse = [...reverseCaptured].reverse(); // realign to `times`' order for comparison

let mismatches = 0;
times.forEach((t, i) => {
  const same = forward[i].equals(reverse[i]);
  console.log(`  ${same ? "PASS" : "FAIL"}  t=${t.toFixed(3)}  ${forward[i].length}B vs ${reverse[i].length}B${same ? "" : "  MISMATCH (state leaked between frames)"}`);
  if (!same) mismatches++;
});

await browser.close();
server.close();
console.log(`determinism: ${mismatches ? "FAIL" : "PASS"} (${times.length} times, forward vs reversed capture order, one page)`);
process.exitCode = mismatches ? 1 : 0;
