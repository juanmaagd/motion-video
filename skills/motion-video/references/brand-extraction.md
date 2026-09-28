# Brand extraction

Goal: `brand.json` (colors by role, fonts, logo, copy) plus `fonts/` and `brand/logo.svg` in the video project, and the list of the brand's bans. Read-only on the brand's repo.

## Where to look (in this order)

1. Brand/design docs: `DESIGN.md`, `BRAND.md`, `PRODUCT.md`, `brand/`, `docs/brand*`, style guides. They carry the bans.
2. Tokens: CSS variables and `@theme` blocks (`globals.css`, `global.css`, `tailwind.config.*`, `theme.ts`), design-token JSON.
3. Fonts: `@fontsource*/` packages in `node_modules` (`files/*.woff2` + the `*.css` that declares axes and `unicode-range`), `public/fonts/`, `@font-face` rules.
4. Logo: `public/brand/`, `public/logo*.svg`, favicons, OG images. Prefer SVG; the mark alone plus the wordmark (outlined paths or the font).
5. Copy: the site's hero line, section headlines, product nouns, real evidence (tests, transactions, metrics that the site itself states).

## What to extract

| Item | Record |
|---|---|
| Colors | hex by **role** (bg, ink, muted, hairline, accent, state colors) and the rule for each ("blue only means verified"). A mark's own fill can differ from the brand's UI accent by a hair (e.g. `#fd891d` mark vs `#fa6e1d` primary) — keep both exact in `brand.json`, never assume one stands in for the other; verify with `colorProbes` (`qa.py`) rather than eyeballing a render. |
| Type | families, weight/width axes, the headline pattern (e.g. 400 with a 600 key phrase), label style (mono, uppercase, tracking) |
| Shape | radii, border weights, shadow rules ("one shadow in the whole system") |
| Logo | exact SVG geometry, clear space, colors allowed, minimum size, lockup proportions (mark height vs cap height, gap) |
| Copy | tagline, product nouns, verified evidence you may show |
| Bans | anything the brand forbids (motifs, colors, claims, tone) |

Worked example (Acme, fictional): ink `#12141a`, canvas `#fdfdfc`, hairlines `#e2e4e9/#cfd2d9`, state-only colors verified `#2f6fed`, refuse `#d94343`, ask `#c98a1f`; Inter Variable (wght 100–900) and JetBrains Mono from `@fontsource-variable`; mark = a rounded square with a centered diagonal notch cut at 12% of the side, ink only; wordmark outlined in `logo.svg`; bans: no stock-photo people, color only for state, no fabricated metrics/customers.

## Fonts

- Copy the `woff2` files into `fonts/` and list them in `brand.json` with the family name, `weight`/`stretch` ranges and, for subset files, `range` (the `unicode-range`). Load latin + latin-ext.
- Check glyph coverage before designing with symbols: subset files often lack arrows, check marks and math signs (fontsource latin lacks U+2190/2192 ← →, U+2713 ✓, U+2264 ≤). Draw those as SVG (`ICON` in `engine.js`).
- Licensing: brand fonts stay in the video project, never in the skill.

## Logo geometry

Use the shipped SVG paths as-is (inline them; animate with transforms). Verify the final lockup against the original: render the lockup frame with any push/zoom disabled, render the brand SVG at the same box, compare pixels — expect 0 pixels differing by more than 50% (the showreel measured mean abs diff 0.0009). Automated: expose `window.__logoBox(t)` (returns `{x, y, w, h}` in full-resolution px, or `null` when the logo is not shown) from the composition and `build.mjs` runs this check for you every final build via `brandqa.mjs`/`logoqa.py` — see `qa-checklist.md`.

## Third-party marks

Official marks (a provider logo, a partner's icon) come from `logos.mjs`, never redrawn by hand and never a screenshot of someone else's render:

```sh
node logos.mjs claude openai deepseek --out=brand/providers   # fetches, records, flags licences
node logos.mjs claude --tint=#0b0d12                           # recolours a MONOCHROME mark only
```

- Source: thesvg.org (github.com/glincker/thesvg) via jsDelivr — `https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons/<slug>/<variant>.svg`. Files are used exactly as published; a multi-colour mark is never force-tinted (`logos.mjs` skips `--tint` on anything with more than one distinct fill and says so).
- Every fetch is recorded in `brand/providers/SOURCES.json`: `file`, `slug`, `variant`, `displayName`, `sourceUrl`, `iconPage`, `license`, `catalogId` (fill in when an on-screen claim needs to match a specific external catalog — e.g. a provider count), `colour`.
- **Read the licence before using anything commercially.** `logos.mjs` flags any licence outside its open allowlist (CC0-1.0, MIT, Apache-2.0, ISC, BSD, Unlicense) — including the exact catalog values `"brand-use"` and `"Custom"`, which are not open. A flagged entry is checked by hand on its `iconPage`, not assumed safe.
- Use the white/light variant when the official mark is a solid dark shape and it sits on a dark background (or vice versa) — never recolor by force-changing an unrelated fill; pick the variant thesvg.org actually publishes for that purpose.
- Match every entry to whatever catalog backs an on-screen claim (e.g. "supports N providers" should count against the same list the video cites, not just however many marks happen to be fetched).

## Device bezels

A phone/laptop frame around a UI mock is a brand-rule question too: an official Apple bezel is
licensed for "as is" use only (no transform, no redistribution) and never ships in this skill; a
generic or licensed community frame is freely animatable. Full rules, licence citations and the
mechanism: `references/device-frames.md`; pitfall 62.

## Claims and evidence

- Separate **tested** (you personally verified it, this session) from **supported** (documented elsewhere, not independently verified) for every on-screen number or claim. Track both in `assets/templates/brief.md`'s claims table.
- Broader claims than what is tested are the user's decision, not a default — ask rather than round up.
- An on-screen number must match the specific public source a viewer would actually go check, even when a broader source exists (e.g. the docs say "50+ integrations" while a separate catalog lists 140 — show "50+", the number the viewer's own source confirms).
- Keep claim values as data in `timeline.json`/`brand.json` (`copy`, a dedicated `claims` block) rather than hard-coded inside a scene, so correcting one is a one-line edit and a re-render, not a scene rewrite.

## Calls to action

Verify every CTA before it goes on screen with `cta-check.sh` — a stale npm dist-tag, a dead link, or a moved repo survives every visual review pass because nothing about it looks wrong on screen:

```sh
./cta-check.sh npm:your-pkg@1.2.0 url:https://example.com git:you/repo
```

If a package registry's `dist-tags.latest` disagrees with the version on screen (a renumbering can leave `latest` pointing at an old build), prefer showing the repo URL instead of the stale registry command, and say so in the brief.

## Adapting the storyboard to the brand

- **Real evidence only.** Replace invented counters, customers, benchmarks and prices with what the brand can show: test names, transaction hashes, dates, quotes it already publishes. The showreel dropped "signed 1,284 · refused 37" for a wall of real test scenarios and used a real transaction hash.
- **Colors keep their meaning.** If a color means a state, it appears only for that state; decoration is ink, greys and hairlines. The showreel's intro became white type on ink instead of a blue laser.
- **Bans beat ideas.** Cultural motifs, mascots, tones the brand rejects are replaced even in sound (a shrine-bell idea became a neutral FM bell).
- **Speak with the brand's own lines.** Reuse the site's hero and section headlines and its signature components (the showreel reused the site's promise-diff card).

## No brand source

Ask once for logo (SVG), colors and font files. Without answers use the template defaults (system fonts, neutral ink/paper, a disc mark), state it in the report, and keep the brand data in `brand.json` so it can be swapped without touching scenes.
