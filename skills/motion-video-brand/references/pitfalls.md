# Pitfalls: brand, content and licences

Pitfall numbers are shared across the motion-video skill family, so this file has gaps on purpose: the missing numbers live in the `pitfalls.md` of the sibling skills `motion-video-engine`, `motion-video-sound` and `motion-video-qa`. Cite a pitfall by its number alone. New pitfalls take the next free number of the family.

Every failure met while building this template — proven in two production showreels — with the evidence that exposed it and the fix. Check the relevant ones at every review pass.

## Fonts and glyphs

24. **Missing glyphs.** fontsource latin subsets lack ← → ✓ ≤. Fix: SVG icons; check coverage before designing with symbols.

## Content and brand

36. **Fabricated metrics.** Evidence: the first storyboard had counters ("signed 1,284 · refused 37") the brand forbids. Fix: real evidence only (test scenario names, real tx hash).
37. **Decorative accent color.** Evidence: a blue laser intro in a brand where blue only means "verified". Fix: ink/paper intro; the accent appears only for its state.
38. **Cultural cliché.** Evidence: a shrine-bell idea for a brand that bans Japanese motifs. Fix: neutral FM bell; bans apply to sound too.
55. **A third-party mark's licence is not automatically open.** Evidence: brand-icon catalogs mix CC0/MIT marks with "brand-use"/"Custom"-licensed ones on the same site. Fix: `logos.mjs` fetches from thesvg.org and flags anything off its open-licence allowlist; read the flagged icon's page by hand before using it commercially, and never redraw a mark instead of sourcing it.

## Device frames

62. **An official device bezel is not a free asset.** Evidence: Apple's App Store Marketing
    Guidelines require official bezels used "as is and without modification" (no transform, crop,
    shadow, or simulation of an Apple product), and the Design Resources licence (read from the
    DMG's own TEXT resource, never mounted or accepted) forbids embedding, redistributing or
    repackaging them -- so bundling the PNG inside this skill would violate the licence the moment
    a project used it. Fix: the official bezel and any Apple Design Resources UI component (status
    bar, keyboard, notification banner) never ship in the skill; only a licensed generic/community
    SVG frame with a confirmed, recorded licence does (`assets/devices/SOURCES.json`). The user
    keeps their own Apple exports in a library outside the skill and the tools find them there
    (`references/device-frames.md`). An animated device shot always uses the generic frame --
    `officialDeviceShot()` exposes no transform at all, by construction.
