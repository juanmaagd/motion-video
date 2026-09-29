// Fetch official brand marks by slug from thesvg.org (github.com/glincker/thesvg) via its jsDelivr
// CDN, record them in brand/providers/SOURCES.json, and flag any licence that is not on the open
// allowlist. Never redraws a mark -- files are used exactly as published; a flagged entry must
// be checked by hand on its `iconPage` before commercial use.
//
//   node logos.mjs claude openai deepseek [--variant=default] [--out=brand/providers] [--tint=#hex]
//
// --tint recolours a MONOCHROME mark only (a single distinct fill colour across the SVG) by
// rewriting every fill to the given hex; a multi-colour mark is left untouched (and the source SVG
// is still fetched and recorded) because recolouring it would misrepresent the published mark.
import fs from "node:fs";
import path from "node:path";

const OPEN_LICENSES = new Set(["CC0-1.0", "CC0", "MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Unlicense", "0BSD"]);

const argv = process.argv.slice(2);
const slugs = argv.filter((a) => !a.startsWith("--"));
const arg = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => a.replace(/^--/, "").split("=")));
const variant = arg.variant ?? "default";
const outDir = path.resolve(arg.out ?? "brand/providers");
const tint = arg.tint;

if (!slugs.length) {
  console.error("usage: node logos.mjs <slug> [<slug>...] [--variant=default] [--out=brand/providers] [--tint=#hex]");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const sourcesPath = path.join(outDir, "SOURCES.json");
const sources = fs.existsSync(sourcesPath)
  ? JSON.parse(fs.readFileSync(sourcesPath, "utf8"))
  : {
      note: "Marks fetched by logos.mjs from thesvg.org (github.com/glincker/thesvg) via jsDelivr. Every " +
        "file is the unmodified published SVG unless `tinted` recoloured a monochrome one. `license` is " +
        "best-effort scraped from `iconPage`; verify by hand before commercial use, especially anything " +
        "not on logos.mjs's open-licence allowlist. `catalogId` is left null for a project to fill in " +
        "when a claim on screen needs to match a specific external catalog.",
      providers: [],
    };

// thesvg.org's licence text ("License: CC0-1.0. Free for personal and commercial use.") is
// client-rendered from a JSON payload, not present in the server HTML this fetch() sees -- but that
// same payload's `copyrightNotice` field ("... Distributed under CC0-1.0.") IS in the raw response,
// so that is what this parses. Falls back to the raw "License:" text in case the page ever changes
// to server-render it directly.
function extractLicense(html) {
  const m = html.match(/Distributed under ([A-Za-z0-9.-]+)\./)
    || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/License:?\s+([A-Za-z0-9][A-Za-z0-9._-]*)/);
  return m ? m[1].replace(/\.$/, "") : null;
}
// The colour of a monochrome mark is its own SVG's top-level fill -- far more reliable than
// scraping the page (also client-rendered there). A multi-colour mark has no single top-level
// fill and correctly returns null (the caller's "file colours as published" fallback applies).
function extractColor(svg) {
  const m = svg.match(/^<svg[^>]*\bfill="(#[0-9a-fA-F]{3,8})"/);
  return m ? m[1] : null;
}
function titleCase(slug) {
  return slug.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const flagged = [];
const missing = []; // requested slugs that did not actually fetch -- "0 checked" must not exit 0
for (const slug of slugs) {
  const sourceUrl = `https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/${slug}/${variant}.svg`;
  const iconPage = `https://thesvg.org/icon/${slug}`;
  const svgRes = await fetch(sourceUrl);
  if (!svgRes.ok) {
    console.error(`skip ${slug}: SVG fetch failed (${svgRes.status}) ${sourceUrl}`);
    missing.push(slug);
    continue;
  }
  let svg = await svgRes.text();

  let license = null;
  const colour = extractColor(svg);
  try {
    const pageRes = await fetch(iconPage);
    if (pageRes.ok) license = extractLicense(await pageRes.text());
  } catch (e) {
    console.error(`warn ${slug}: could not read the icon page (${e.message}); licence unknown -- verify by hand`);
  }
  const isOpen = license !== null && OPEN_LICENSES.has(license);
  if (!isOpen) flagged.push({ slug, license: license ?? "unknown" });

  let tinted = false;
  if (tint) {
    const fills = [...svg.matchAll(/fill="([^"]*)"/g)].map((m) => m[1]).filter((f) => f && f !== "none");
    const distinct = new Set(fills);
    if (distinct.size <= 1) {
      svg = svg.replace(/fill="(?!none")[^"]*"/g, `fill="${tint}"`);
      if (!/fill=/.test(svg)) svg = svg.replace("<svg", `<svg fill="${tint}"`);
      tinted = true;
    } else {
      console.error(`warn ${slug}: ${distinct.size} distinct fill colours, not monochrome -- --tint skipped, published colours kept`);
    }
  }

  const file = tinted ? `${slug}-${tint.replace("#", "")}.svg` : `${slug}.svg`;
  fs.writeFileSync(path.join(outDir, file), svg);
  const entry = {
    file, slug, variant, displayName: titleCase(slug), sourceUrl, iconPage,
    license: license ?? "unknown", catalogId: null,
    colour: colour ?? "file colours as published", tinted: tinted ? tint : false,
  };
  const i = sources.providers.findIndex((p) => p.slug === slug && p.variant === variant && (p.tinted || false) === (entry.tinted || false));
  if (i >= 0) sources.providers[i] = entry; else sources.providers.push(entry);
  console.log(`${slug}: ${file}  licence=${entry.license}${isOpen ? "" : "  ** NOT on the open-licence allowlist -- verify iconPage before commercial use **"}`);
}

sources.fetched = new Date().toISOString().slice(0, 10);
fs.writeFileSync(sourcesPath, JSON.stringify(sources, null, 2) + "\n");
const fetchedCount = slugs.length - missing.length;
console.log(`logos: ${fetchedCount}/${slugs.length} slug(s) -> ${sourcesPath}`);
if (flagged.length) console.log(`FLAGGED (verify by hand, drop if not actually open): ${flagged.map((f) => `${f.slug} (${f.license})`).join(", ")}`);
// A requested slug that never fetched checked nothing for that mark -- and 0 fetched overall is 0
// evidence, not success. Neither may exit 0 (a verifier that checked less than it should have FAILs).
if (missing.length) {
  console.error(`logos: FAIL -- ${missing.length}/${slugs.length} requested slug(s) were not fetched: ${missing.join(", ")}`);
  process.exit(1);
}
if (fetchedCount === 0) {
  console.error("logos: FAIL -- 0 marks fetched");
  process.exit(1);
}
