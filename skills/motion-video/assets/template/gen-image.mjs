// Generate exactly one raster plate with the Codex CLI's own built-in image tool. This
// project has no runtime dependency on any other skill: the mechanism below (the exact `codex exec`
// invocation and its guarded instruction) is self-contained. No API key, SDK, script, curl, or web
// service of any kind; if `codex` or its built-in image tool is unavailable, this fails closed
// (exit 1) -- there is no fallback, build the element in code instead.
//
//   node gen-image.mjs (--prompt TEXT | --prompt-file FILE) --name FILE.png
//     [--size 1024x1024|1536x1024|1024x1536] [--transparent] [--scene LABEL]
//
// Writes generated/<FILE.png> and appends { file, prompt, size, transparent, scene, date, tool } to
// generated/manifest.json. Every prompt gets a short suffix banning text/logos/watermarks in the
// image. See references/generated-assets.md for WHAT to generate at all -- most videos need none of
// this; a mark, wordmark, type, UI, or anything carrying a claim never comes from here.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(ROOT, "generated");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const SHAPES = { "1024x1024": "square 1024x1024", "1536x1024": "landscape 1536x1024", "1024x1536": "portrait 1024x1536" };
const USAGE = "usage: gen-image.mjs (--prompt TEXT | --prompt-file FILE) --name FILE.png\n" +
  "                      [--size 1024x1024|1536x1024|1024x1536] [--transparent] [--scene LABEL]";

function fail(msg, code = 1) { console.error(msg); process.exit(code); }

function parseArgs(argv) {
  const a = { size: "1024x1024", transparent: false, scene: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--prompt") a.prompt = argv[++i];
    else if (k === "--prompt-file") a.promptFile = argv[++i];
    else if (k === "--name") a.name = argv[++i];
    else if (k === "--size") a.size = argv[++i];
    else if (k === "--transparent") a.transparent = true;
    else if (k === "--scene") a.scene = argv[++i];
    else if (k === "--help" || k === "-h") { console.log(USAGE); process.exit(0); }
    else fail(`unknown argument: ${k}\n${USAGE}`, 2);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.prompt && args.promptFile) fail(`error: pass --prompt or --prompt-file, not both\n${USAGE}`, 2);
if (!args.prompt && !args.promptFile) fail(`error: --prompt or --prompt-file is required\n${USAGE}`, 2);
if (args.promptFile) {
  if (!fs.existsSync(args.promptFile)) fail(`error: prompt file not found: ${args.promptFile}`, 2);
  args.prompt = fs.readFileSync(args.promptFile, "utf8");
}
if (!args.name) fail(`error: --name FILE.png is required\n${USAGE}`, 2);
if (!args.name.endsWith(".png")) fail("error: --name must end in .png", 2);
const shape = SHAPES[args.size];
if (!shape) fail("error: --size must be 1024x1024, 1536x1024, or 1024x1536", 2);

// Fail closed if the Codex CLI is not on PATH -- no fallback of any kind.
const codexCheck = spawnSync("codex", ["--version"], { encoding: "utf8" });
if (codexCheck.error || codexCheck.status !== 0) {
  fail("error: codex CLI not found on PATH -- no fallback; build the element in code instead");
}
const codexVersion = (codexCheck.stdout || "codex-cli unknown").trim();

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, args.name);
const bg = args.transparent ? "fully transparent" : "opaque";
const suffix = " No text, letters, numbers, logos, wordmarks, or watermarks anywhere in the image.";
const fullPrompt = `${args.prompt.trim()}${suffix}`;
// The guarded instruction: forbids any path but Codex's own built-in image tool, and tells it to
// stop and say so rather than substitute anything else, so a missing tool fails loudly instead of
// silently falling back to another provider.
const instruction = "Generate exactly one image using ONLY your built-in image generation tool. Do " +
  "not use any API key, SDK, script, curl, Python, or external web service of any kind; if your " +
  "built-in image tool is unavailable, stop and say so instead of substituting anything else. Make " +
  `the image ${shape}, ${bg} background, of: ${fullPrompt} Copy the final PNG into the current ` +
  `working directory as "${args.name}" and reply with only its absolute path.`;

const txt = `${outPath}.codex.txt`;
const log = `${outPath}.codex.log`;
// Codex renders into ~/.codex/generated_images/<session>/exec-<id>.png first, then (because this is
// workspace-write with -C set to generated/) copies it here as instructed.
const run = spawnSync("codex", [
  "exec", "--skip-git-repo-check", "--ephemeral", "-s", "workspace-write",
  "-C", OUT_DIR, "-o", txt, instruction,
], { encoding: "utf8" });
fs.writeFileSync(log, (run.stdout ?? "") + (run.stderr ?? ""));
if (run.status !== 0) fail(`error: codex exec failed (exit ${run.status}) -- no fallback; see ${log}; build the element in code instead`);

if (!fs.existsSync(outPath)) fail(`error: ${outPath} was not produced -- no fallback; see ${txt} and ${log}; build the element in code instead`);
const mimeCheck = spawnSync("file", ["--mime-type", "-b", outPath], { encoding: "utf8" });
const mime = (mimeCheck.stdout || "unknown").trim();
if (mime !== "image/png") fail(`error: ${outPath} is not a PNG (${mime}) -- no fallback; see ${log}; build the element in code instead`);

const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : { assets: [] };
manifest.assets ??= [];
manifest.assets.push({
  file: `generated/${args.name}`, prompt: fullPrompt, size: args.size, transparent: args.transparent,
  scene: args.scene, date: new Date().toISOString().slice(0, 10), tool: codexVersion,
});
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

fs.rmSync(txt, { force: true });
fs.rmSync(log, { force: true });
console.log(`gen-image: ${outPath}`);
