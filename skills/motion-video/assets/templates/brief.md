# Brief: <video name>

Fill this in and get it approved (script table + claims + CTAs) before building any new copy into
scenes (proposing a table first saved a full rebuild when the story didn't land). Delete
sections that do not apply; keep the rest short.

## Preferences (from the intake; references/intake.md)

Every resolved choice, however it was resolved — answered, already given in the request, or decided
by the agent because the user declined/said "you decide" (state why).

| Question | Answer | Resolved by |
|---|---|---|
| Duration | | |
| Idea | | |
| Video type | | |
| Style | | |

## Story

One line: what is this video actually showing, in plain language -- problem, mechanism, check,
payoff. If the payoff is not the product's real output (a real screenshot, a real comment, a
real number), say what stands in for it and why.

- Format / duration / BPM: <e.g. 16:9 1920x1080, 15 s, 128 BPM, 8 bars -- see references/storyboard.md>
- Narrative template used: <references/storyboard.md name, or "custom">

## Script table (get approval on this before building)

| Bar | Time | Picture | Line |
|---|---|---|---|
| 1 | 0:00 | | |
| 2 | | | |

Budget: ~2 words/beat for display type; a full sentence needs a whole bar; every line must read at
1x speed (references/storyboard.md; `motion-craft.md` in the `motion-video-engine` skill).

## Copy / evidence table

Every on-screen number or claim needs a source. Separate TESTED (you verified it yourself) from
SUPPORTED (documented elsewhere, not independently verified) -- broader claims than what's tested
are the user's decision, not a default.

| On-screen line | Status (tested / supported) | Source | Notes |
|---|---|---|---|
| | | | |

Keep this table's values as data in `timeline.json`/`brand.json` where practical, so a correction is
one line and a re-render, not a scene edit.

## Claims + CTA verification

Run `cta-check.sh` on every CTA before it goes on screen -- a stale npm dist-tag, a dead link, or a
moved repo is exactly the kind of error that survives every visual review pass.

| CTA text on screen | Check | Command | Result |
|---|---|---|---|
| | npm dist-tag | `./cta-check.sh npm:<pkg>@<expected>` | |
| | URL | `./cta-check.sh url:<url>` | |
| | repo | `./cta-check.sh git:<owner>/<repo>` | |

If a registry is stale, prefer the repo URL on screen and say so here.

## Brand bans (from `brand-extraction.md` in the `motion-video-brand` skill)

List anything this brand forbids (motifs, colors used decoratively, tone, fabricated metrics) so a
storyboard idea can be checked against it before it is built.

## Third-party marks (if any)

Fetched with `logos.mjs`, recorded in `brand/providers/SOURCES.json`. List anything flagged
non-open here and how it was resolved (dropped, replaced, or manually cleared after reading the
licence page).

## Generated assets (if any)

Most videos need none. Only list a row when a scene genuinely needs a raster plate, texture,
illustrative cut-out, or styleframe (never a mark, type, UI, screenshot, or a claim -- see
`generated-assets.md` in the `motion-video-brand` skill) -- and get it approved here before generating, same as new copy.

| Scene | Purpose | Prompt | Size | Transparent |
|---|---|---|---|---|
| | | | | |

Generate with `node gen-image.mjs --prompt "..." --name <file>.png --size <...> [--transparent] --scene "<scene>"`;
it records the same row's data in `generated/manifest.json` automatically.

## Sign-off

- [ ] Script table approved
- [ ] Claims table has a source for every on-screen number
- [ ] CTAs verified (or explicitly deferred, with why)
- [ ] Generated assets (if any) approved before generating, and graded to brand tokens once wired in
