// Shared helpers for the repo's tests. Nothing here ships: tests live outside skills/.
//
// Tests never run inside the repo's skill folders. They assemble a video project in a temp folder
// the way the director's workflow.md section 1 does, and exercise that copy.
//
// Playwright tests need `playwright-core` and a Chromium headless shell. Point
// MOTION_VIDEO_TEST_DEPS at a folder whose node_modules holds playwright-core (or run
// `npm i playwright-core` at the repo root; node_modules is git-ignored). Without either, those
// tests are skipped with a message, never silently passed.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Assembly order matters only for collisions, and every file has one owner: director, engine, sound, qa, brand.
export const FAMILY = ["motion-video", "motion-video-engine", "motion-video-sound", "motion-video-qa", "motion-video-brand"];

export function tmpDir(prefix = "mv-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function assembleProject(dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const s of FAMILY) fs.cpSync(path.join(REPO, "skills", s, "assets", "project"), dest, { recursive: true });
  return dest;
}

// Minimal HTTP client that sends the path exactly as given (fetch normalizes "/.." and cannot set Host).
export function request(port, { method = "GET", path: p = "/", headers = {}, body, host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, method, path: p, headers, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// path -> sha1 of every file under dir (skipping the given top-level names), to prove nothing changed.
export function snapshot(dir, skip = ["out", "node_modules"]) {
  const out = new Map();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name), rel = path.relative(dir, full);
      if (skip.includes(rel.split(path.sep)[0])) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.set(rel, crypto.createHash("sha1").update(fs.readFileSync(full)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Resolves when `predicate()` is truthy, or rejects after `timeout` ms with `what` in the message.
export async function waitFor(predicate, { timeout = 5000, interval = 20, what = "condition" } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await predicate();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    await sleep(interval);
  }
}

// { chromium } from playwright-core, or null when it cannot be found.
export function loadPlaywright() {
  for (const dir of [process.env.MOTION_VIDEO_TEST_DEPS, REPO].filter(Boolean)) {
    try { return createRequire(path.join(path.resolve(dir), "noop.js"))("playwright-core"); } catch { /* try the next */ }
  }
  return null;
}

// Newest cached Playwright headless shell, or CHROME_PATH. null when there is none.
export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const roots = [path.join(os.homedir(), "Library/Caches/ms-playwright"), path.join(os.homedir(), ".cache/ms-playwright"), process.env.PLAYWRIGHT_BROWSERS_PATH].filter(Boolean);
  const bins = ["chrome-headless-shell-mac-arm64/chrome-headless-shell", "chrome-headless-shell-mac-x64/chrome-headless-shell",
    "chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/headless_shell"];
  const found = [];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    for (const d of fs.readdirSync(r).filter((n) => n.startsWith("chromium_headless_shell-"))) {
      for (const b of bins) { const p = path.join(r, d, b); if (fs.existsSync(p)) found.push([parseInt(d.split("-").pop(), 10), p]); }
    }
  }
  return found.length ? found.sort((a, b) => b[0] - a[0])[0][1] : null;
}

// Why browser tests cannot run here, or null when they can.
export function browserUnavailable() {
  if (!loadPlaywright()) return "playwright-core not found (set MOTION_VIDEO_TEST_DEPS or run `npm i playwright-core` at the repo root)";
  if (!findChrome()) return "no Chromium headless shell found (npx playwright install chromium-headless-shell, or set CHROME_PATH)";
  return null;
}

// Makes the assembled project runnable by the node tools that need playwright-core.
export function linkDeps(projectDir) {
  const dir = [process.env.MOTION_VIDEO_TEST_DEPS, REPO].filter(Boolean).find((d) => fs.existsSync(path.join(path.resolve(d), "node_modules", "playwright-core")));
  if (!dir) throw new Error("playwright-core not found for the assembled project");
  fs.symlinkSync(path.join(path.resolve(dir), "node_modules"), path.join(projectDir, "node_modules"), "dir");
}
