// One command: score -> frames -> H.264/AAC -> poster -> contact sheet -> web encode -> QA (incl.
// the lag proof and, when the composition supports it, logo fidelity).
//
//   node build.mjs                 final: 32 motion-blur samples, full size, CRF 14
//   node build.mjs --preview       fast review: 1 sample, half size, quick encode
//   node build.mjs --slice=2:4     final settings on a time window (s), for checking a moment
//   options: --sub=N --workers=N --scale=S --out=DIR
//
// Outputs in out/: <slug>.mp4, <slug>-web.mp4 (CRF-stepped under a size budget), <slug>-poster.png,
// <slug>-contact.png, <slug>-qa.txt (preview: <slug>-preview.*, no web encode or poster). Exit code is
// qa.py's (the web encode and logo fidelity are reported but do not gate the exit code).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const arg = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, "").split("="); return [k, v.length ? v.join("=") : "true"]; }));
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, "timeline.json"), "utf8"));
const preview = arg.preview === "true";
const sub = arg.sub ?? (preview ? "1" : "32");
const scale = parseFloat(arg.scale ?? (preview ? "0.5" : "1"));
const workers = arg.workers ?? "8";
const outDir = path.resolve(ROOT, arg.out ?? "out");
const slug = (TL.slug ?? TL.title ?? "video").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const [s0, s1] = arg.slice ? arg.slice.split(":").map(Number) : [0, TL.duration];
const name = arg.slice ? `${slug}-slice-${s0}-${s1}` : preview ? `${slug}-preview` : slug;
const tmp = path.join(outDir, ".build");
const beat = 60 / TL.bpm, fps = TL.fps;
const started = Date.now();

function run(cmd, args, opts = {}) {
  console.log(`> ${[cmd, ...args].join(" ").slice(0, 220)}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`${cmd} failed (${r.status})`);
  return r.status;
}
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });

const wav = path.join(tmp, "audio.wav"), master = path.join(tmp, "master.nut"), mp4 = path.join(outDir, `${name}.mp4`);
run(process.execPath, ["score.mjs", `--out=${wav}`]);
const f0 = Math.round(s0 * fps), f1 = Math.round(s1 * fps);
run(process.execPath, ["render.mjs", "video", `--sub=${sub}`, `--workers=${workers}`, `--scale=${scale}`, `--from=${f0}`, `--to=${f1}`,
  `--out=${master}`, `--segdir=${path.join(tmp, "seg")}`]);
// Frames are re-timed by index (segment timestamps drift at concat); BT.709 conversion and tags.
const vf = `setpts=N/(${fps}*TB),scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,` +
  "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv";
const enc = preview ? ["-preset", "veryfast", "-crf", "20"] : ["-preset", "slow", "-crf", "14", "-tune", "animation"];
run("ffmpeg", ["-y", "-loglevel", "error", "-i", master, "-ss", String(s0), "-t", String(s1 - s0), "-i", wav,
  "-map", "0:v", "-map", "1:a", "-vf", vf, "-r", String(fps), "-c:v", "libx264", ...enc, "-profile:v", "high",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
  "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", "-t", String(s1 - s0), mp4]);

let qa = 0;
if (!arg.slice) {
  const qaOut = [];
  if (!preview) {
    run(process.execPath, ["render.mjs", "stills", "--scale=1", `--times=${(TL.duration - 1 / fps).toFixed(4)}`, `--out=${path.join(tmp, "poster")}`]);
    const p = fs.readdirSync(path.join(tmp, "poster")).find((f) => f.endsWith(".png"));
    fs.copyFileSync(path.join(tmp, "poster", p), path.join(outDir, `${name}-poster.png`));
  }
  // contact sheet: one encoded frame per beat (mid-beat), straight from the MP4
  const sheet = path.join(tmp, "sheet");
  fs.mkdirSync(sheet, { recursive: true });
  const times = [];
  for (let t = (TL.offset ?? 0) + beat / 2; t < TL.duration; t += beat) times.push(t);
  const frames = times.map((t) => Math.round(t * fps));
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", `select='${frames.map((f) => `eq(n\\,${f})`).join("+")}'`, "-fps_mode", "passthrough",
    path.join(sheet, "f%04d.png")]);
  fs.readdirSync(sheet).sort().forEach((f, i) => fs.renameSync(path.join(sheet, f), path.join(sheet, `t${times[i].toFixed(3).padStart(7, "0")}.png`)));
  run("python3", ["sheet.py", sheet, path.join(outDir, `${name}-contact.png`), "--cols", "8", "--width", "360"]);

  const r = spawnSync("python3", ["qa.py", mp4, "--scale", String(scale)], { cwd: ROOT, encoding: "utf8" });
  qaOut.push(r.stdout, r.stderr || "");
  qa = r.status ?? 1;

  if (!preview) {
    // Logo fidelity: advisory (never changes the exit code), skipped with a note when brand.json has
    // no logo or the composition has no window.__logoBox(t) hook. See brandqa.mjs / logoqa.py.
    const ref = path.join(tmp, "logo-ref.png");
    const bq = spawnSync(process.execPath, ["brandqa.mjs", `--t=${(TL.duration - 1 / fps).toFixed(4)}`, `--out=${ref}`], { cwd: ROOT, encoding: "utf8" });
    if (bq.status === 0) {
      const lq = spawnSync("python3", ["logoqa.py", path.join(outDir, `${name}-poster.png`), ref, ref.replace(/\.png$/, ".json")], { cwd: ROOT, encoding: "utf8" });
      // logoqa.py FAILs (stderr, exit 1) on a missing/empty comparison -- surface that plainly
      // rather than only the (now empty) stdout, which would otherwise read as a blank, vacuous line.
      const lqOut = (lq.stdout + lq.stderr).trim() || "(no output)";
      qaOut.push("logo fidelity (poster vs the shipped logo at the same box):\n  " + (lq.status === 0 ? lqOut : `FAILED (exit ${lq.status}): ${lqOut}`) + "\n");
    } else {
      qaOut.push(`${(bq.stdout + bq.stderr).trim() || "logo fidelity: skipped"}\n`);
    }

    // Web encode: re-encode the delivered MP4 under a size budget (default 10 MB, GitHub's
    // PR/issue upload limit), audio copied, CRF stepped up from webCrf (default 20) until it fits or
    // hits the cap (28). Override via timeline.json `webSizeBudget` (MB) / `webCrf`.
    const webLimit = (TL.webSizeBudget ?? 10) * 1_000_000;
    const web = path.join(outDir, `${name}-web.mp4`);
    let webCrf = TL.webCrf ?? 20;
    for (;; webCrf++) {
      run("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-c:v", "libx264", "-preset", "slow", "-crf", String(webCrf), "-profile:v", "high", "-tune", "animation",
        "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
        "-c:a", "copy", "-movflags", "+faststart", web]);
      if (fs.statSync(web).size < webLimit || webCrf >= 28) break;
    }
    qaOut.push(`web encode: ${path.basename(web)} CRF ${webCrf}, ${(fs.statSync(web).size / 1e6).toFixed(2)} MB (limit ${webLimit / 1e6} MB)\n`);
  }

  process.stdout.write(qaOut.join(""));
  fs.writeFileSync(path.join(outDir, `${name}-qa.txt`), qaOut.join(""));
} else {
  run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate:format=duration", "-of", "compact", mp4]);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`build: ${name} in ${((Date.now() - started) / 1000).toFixed(0)} s -> ${mp4}`);
process.exitCode = qa;
