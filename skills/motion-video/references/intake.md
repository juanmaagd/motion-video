# Preference intake

One grouped interaction, at invocation, before brand extraction (`workflow.md` step 0's Gate).
Optional end to end: every question has a "Decide for me" answer, so skipping the whole thing is
one click (or one line of "you decide").

## Why one grouped interaction, not four separate asks

SKILL.md's Execution Steps say "ask one question at a time, only without a default" — that rule is
about UNBOUNDED questions during the build (format, brand source, a CTA's licence risk), each of
which blocks real work until answered. The intake is the deliberate exception: exactly four
questions, asked together, every one of them already has a default ("decide for me"), so batching
them respects the user's time (one interruption, not four) instead of violating the one-at-a-time
rule's actual purpose (never stack unresolved blockers).

## Mechanism

1. **AskUserQuestion available:** one call, up to 4 questions, each option list ending in "Decide
   for me". AskUserQuestion adds its own free-text "Other" option to every question automatically —
   never list "Other" yourself, and never duplicate it with an option that just means "something
   else" (a custom duration, or a video type not on the list, goes through that automatic field).
   Skip any question the user's own request already answered (e.g. "make me a 15s launch video"
   already answers duration and video type — ask only idea and style).
2. **Not available (no tool, or a non-interactive runtime):** one plain-text message listing the
   same up-to-4 questions and options, explicitly noting the default for each ("reply with a number,
   or say nothing/`decide` for <default>"); free text is always a valid reply in this fallback, the
   same role AskUserQuestion's "Other" field plays.
3. **A decline, "you decide", or no answer to a question:** the agent decides that item itself and
   states the choice (and why) in `assets/templates/brief.md`'s Preferences section — a choice made
   for the user is never silent, it is just not asked as a question.

## The four questions

Each question stays at 4 options including "Decide for me" (AskUserQuestion's per-question cap);
anything not listed is reachable through its automatic "Other" field.

| # | Question | Options |
|---|---|---|
| 1 | Duration | ~15 s / ~30 s / ~60 s / Decide for me |
| 2 | Idea | I have one (I'll describe it) / A rough direction / Decide for me |
| 3 | Video type | Launch/showreel / Explainer / Product demo / Decide for me |
| 4 | Style | Minimal/editorial / Bold kinetic type / Playful/illustrative / Decide for me |

- Q1: a custom duration goes through "Other".
- Q2: "Decide for me" means delegate everything — the agent originates the concept end to end.
- Q3: a social clip or brand sting goes through "Other".
- Q4: "Decide for me" means match the brand's own tone when one was extracted (`brand-extraction.md`
  in the `motion-video-brand` skill); otherwise the agent picks and states why.

Format, soundtrack and brand source are NOT folded in here — they keep their own existing Decision
Gates rows (SKILL.md) and are asked separately only when they still have no default after this
intake.

## How each answer drives the existing gates

- **Duration** -> picks a row of `storyboard.md`'s duration/BPM table (the existing "Duration" gate);
  "decide for me" defaults to 15 s / 128 BPM / 8 bars.
- **Idea** -> how much the agent originates versus follows:
  - *I have one* -> build the storyboard around the user's own concept; ask fewer clarifying
    questions, since the direction is already set.
  - *A rough direction* -> propose 2-3 concrete storyboard directions off that steer, for the user
    to pick one at the script-table approval step (Hard Rule 5) — do not build all of them.
  - *Decide for me* -> delegate everything: the agent originates the concept end to end (real
    evidence only, per the "real evidence only" rule in `brand-extraction.md` of the
    `motion-video-brand` skill — delegation never licenses an invented number or claim), and still gets the script table approved before building
    copy into scenes; delegating the IDEA never skips the APPROVAL gate.
- **Video type** -> picks the matching narrative template in `storyboard.md` (the existing "Video
  type" gate): launch/showreel -> "Launch" or "Showreel" template; explainer -> "Feature explainer";
  product demo -> the "Product demo" template (`storyboard.md`, and `scene-recipes.md` in the
  `motion-video-engine` skill); anything else
  (a social clip, a brand sting) is named through "Other" and maps to its own matching template.
- **Style** -> informs motion and type choices WITHIN the chosen template, never overrides brand
  bans or evidence rules:
  - *Minimal/editorial* -> more negative space, fewer simultaneous elements per beat, restrained
    hits.
  - *Bold kinetic type* -> larger display type, more per-bar hits, `makeHeadline` (`engine.js`) used
    aggressively.
  - *Playful/illustrative* -> favors the SVG draw-on recipe (`scene-recipes.md` in the
    `motion-video-engine` skill) and softer,
    bouncier easing (`E.outBack`-family curves) over hard cuts.
  - *Decide for me* -> match the brand: no added style layer at all; defer entirely to whatever
    tone the extraction of the `motion-video-brand` skill (`brand-extraction.md`) already found when one was run (a brand's existing
    type/motion signals win over any generic "style" default). With no brand source at all, the
    agent picks a style and states why in the brief.

## Recording the answers

Every resolved choice — asked-and-answered, skipped-because-already-in-the-request, or
agent-decided — goes into `assets/templates/brief.md`'s "Preferences" section before the storyboard
step, so a reader can see what was decided and by whom without re-reading the whole conversation.
