# Worker brief: <video name>

For delegating the build to a worker (agent or otherwise) once the brief (`brief.md`) is approved
and the storyboard is written into `timeline.json`. Fill in every section -- an empty boundary or
report contract is how scope creeps.

## Boundaries

- Project directory: `<path>` (a copy of `assets/template/`; the worker edits scenes, `score.mjs`,
  `timeline.json`, `brand.json` -- never `engine.js`, `synth-kit.mjs`, `render.mjs`, `build.mjs`,
  `qa.py`, or any other tool file unless this brief explicitly says otherwise).
- Approved script table / claims / CTAs: link to the completed `brief.md`. The worker does not
  invent new copy, numbers, or claims -- anything missing comes back as a question, not a guess.
- Brand bans in force: <copy from brief.md or brand-extraction.md>.
- Budget / time box: <e.g. "two review passes, then hand back for final QA">.
- Generated assets: only the rows approved in `brief.md`'s "Generated assets" table, via
  `gen-image.mjs` (no other provider); if `codex` is unavailable the worker builds the element in
  code and reports it, it does not substitute another tool.

## Archive-first

Before starting a revision on existing work, run `./archive.sh` and confirm the printed re-render
command works from the archive alone. Report the archive path in the checkpoint below.

## Checkpoint the worker stops at

Do not proceed past this without director sign-off:

- [ ] `npm run preview` succeeds
- [ ] Beat contact sheet + 12-frame strips around every transition (paths)
- [ ] Lag proof passes on the preview (`python3 lagproof.py out/<slug>-preview.mp4`)
- [ ] Every item in `references/pitfalls.md` that applies has been checked

Use `assets/templates/review-notes.md`-shaped notes for the reply, not prose.

## Report contract

On stopping (checkpoint reached, blocked, or done), the worker reports:

1. What was built (scenes/cues touched, since the last archive).
2. Every check run and its actual result (PASS/FAIL/WARN with numbers -- never "should be fine").
3. Deviations from the brief and why.
4. What was NOT verified (always: whether the audio was listened to, per references/sound-design.md).
5. The exact next step it is blocked on, if any.

The director never treats a worker's summary as verification -- re-run at least the lag proof and
`qa.py` spot checks before accepting a checkpoint as real (this project has been burned before by a
report that did not match the artifact).
