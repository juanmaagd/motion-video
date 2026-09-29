// Frame grabber for index.html: every frame is window.renderAt(t) in headless Chromium.
//
//   node render.mjs stills --times=0.5,1.9 [--scale=0.5] [--out=out/stills]
//   node render.mjs stills --beats [--scale=0.5]            one still per beat (mid-beat)
//   node render.mjs stills --strip=1.80:12 [--step=1]        12 consecutive frames from t=1.80
//   node render.mjs video --out=out/master.nut [--sub=32] [--workers=8] [--scale=1] [--chunk=20] [--from=0 --to=450]
//
// Video mode takes `sub` samples per output frame across a 180-degree shutter and averages
// them with ffmpeg tmix (real motion blur). Workers pull short chunks from a queue and stream
// PNGs into lossless FFV1 segments in NUT; segments are concatenated at the end. Segment
// timestamps are not trusted: the encoder re-times frames by index (see build.mjs). Capture uses
// the CDP Page.captureScreenshot(optimizeForSpeed) path (see openPage/capture below), not
// page.screenshot() — same lossless PNG, about 3x faster.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStaticHandler, listen } from "./serve.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, "timeline.json"), "utf8"));
const [mode, ...rest] = process.argv.slice(2);
const arg = Object.fromEntries(rest.map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : "true"]; }));
const FPS = TL.fps, DUR = TL.duration, FRAMES = Math.round(FPS * DUR);
const SHUTTER = 0.5; // 180 degrees

// Newest cached Playwright headless shell (macOS or Linux), unless CHROME_PATH is set.
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
  throw new Error("No Chromium headless shell found. Run `npx playwright install chromium-headless-shell` or set CHROME_PATH to a Chrome/Chromium binary.");
}

const launch = () => chromium.launch({ executablePath: findChrome(), args: ["--font-render-hinting=none", "--hide-scrollbars", "--force-color-profile=srgb"] });
async function openPage(browser, url, scale) {
  const page = await browser.newPage({ viewport: { width: TL.width, height: TL.height }, deviceScaleFactor: scale });
  page.on("pageerror", (e) => console.error("pageerror:", e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error(`console.${m.type()}:`, m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  // CDP session for capture(): Page.captureScreenshot with optimizeForSpeed is ~35 ms/frame vs
  // ~100 ms for page.screenshot() (still lossless PNG, just faster zlib settings). At 8 workers x
  // thousands of frames this is the difference between a coffee break and a lunch break.
  page.__cdp = await page.context().newCDPSession(page);
  page.__scale = scale;
  return page;
}
async function capture(page, t) {
  await page.evaluate((tt) => window.renderAt(tt), t);
  const { data } = await page.__cdp.send("Page.captureScreenshot", {
    format: "png", optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: TL.width, height: TL.height, scale: page.__scale },
  });
  return Buffer.from(data, "base64");
}
const beat = 60 / TL.bpm;

const server = await listen(createStaticHandler(ROOT));
const url = `http://127.0.0.1:${server.address().port}/index.html`;
const started = Date.now();
try {
  if (mode === "stills") {
    const scale = parseFloat(arg.scale ?? "0.5");
    const out = path.resolve(ROOT, arg.out ?? "out/stills");
    fs.mkdirSync(out, { recursive: true });
    let times;
    if (arg.beats) times = Array.from({ length: Math.round(DUR / beat) }, (_, i) => (TL.offset ?? 0) + i * beat + beat / 2).filter((t) => t < DUR);
    else if (arg.strip) { const [t0, n] = arg.strip.split(":").map(Number); const step = parseInt(arg.step ?? "1", 10); const f0 = Math.round(t0 * FPS); times = Array.from({ length: n }, (_, i) => (f0 + i * step) / FPS); }
    else if (arg.times) times = arg.times.split(",").map(Number);
    else { console.error("usage: node render.mjs stills (--beats | --times=T1,T2 | --strip=T0:N) [--scale=0.5] [--out=DIR]"); process.exit(2); }
    const browser = await launch();
    const page = await openPage(browser, url, scale);
    for (const t of times) fs.writeFileSync(path.join(out, `t${t.toFixed(3).padStart(7, "0")}.png`), await capture(page, t));
    await browser.close();
    console.log(`stills: ${times.length} in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${out}`);
  } else if (mode === "video") {
    const sub = parseInt(arg.sub ?? "32", 10), scale = parseFloat(arg.scale ?? "1");
    const workers = parseInt(arg.workers ?? String(Math.max(2, Math.min(8, os.cpus().length - 2))), 10);
    const from = parseInt(arg.from ?? "0", 10), to = parseInt(arg.to ?? String(FRAMES), 10);
    const out = path.resolve(ROOT, arg.out ?? "out/master.nut");
    const segDir = path.resolve(ROOT, arg.segdir ?? `${out}.seg`);
    fs.mkdirSync(segDir, { recursive: true });
    const n = to - from, size = parseInt(arg.chunk ?? "20", 10);
    const chunks = [];
    for (let a = from, k = 0; a < to; a += size, k++) chunks.push([a, Math.min(to, a + size), path.join(segDir, `seg${String(k).padStart(4, "0")}.nut`)]);
    let next = 0, done = 0;
    const tick = setInterval(() => {
      const el = (Date.now() - started) / 1000;
      process.stdout.write(`\r${done}/${n} frames  ${el.toFixed(0)}s  ${(done / el).toFixed(1)} fps   `);
    }, 2000);
    const vf = sub > 1 ? `tmix=frames=${sub},select='eq(mod(n\\,${sub})\\,${sub - 1})',setpts=N/(${FPS}*TB)` : `setpts=N/(${FPS}*TB)`;
    await Promise.all(Array.from({ length: Math.min(workers, chunks.length) }, async () => {
      const browser = await launch();
      const page = await openPage(browser, url, scale);
      while (next < chunks.length) {
        const [a, b, seg] = chunks[next++];
        const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS * sub), "-c:v", "png", "-i", "-",
          "-vf", vf, "-r", String(FPS), "-c:v", "ffv1", "-level", "3", "-pix_fmt", "bgr0", seg], { stdio: ["pipe", "inherit", "inherit"] });
        const closed = new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg exit ${c} for ${seg}`)))));
        for (let i = a; i < b; i++) {
          for (let k = 0; k < sub; k++) {
            const off = sub > 1 ? ((k + 0.5) / sub - 0.5) * (SHUTTER / FPS) : 0;
            const t = Math.min(Math.max(i / FPS + off, 0), DUR - 1e-6);
            const buf = await capture(page, t);
            if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
          }
          done++;
        }
        ff.stdin.end();
        await closed;
      }
      await browser.close();
    }));
    clearInterval(tick);
    const list = path.join(segDir, "list.txt");
    fs.writeFileSync(list, chunks.map(([, , seg]) => `file '${seg}'`).join("\n"));
    await new Promise((r, j) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", out], { stdio: "inherit" })
      .on("close", (c) => (c === 0 ? r() : j(new Error("concat failed")))));
    fs.rmSync(segDir, { recursive: true, force: true });
    console.log(`\nvideo: ${n} frames x ${sub} samples in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${out}`);
  } else {
    console.error("usage: node render.mjs stills|video [--options] (see the header of render.mjs)");
    process.exitCode = 1;
  }
} finally {
  server.close();
}
