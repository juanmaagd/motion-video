# Review notes: <video name>, pass <N>

The director loop: the worker builds and stops at a picture checkpoint (beat contact sheet,
12-frame transition strips, key stills, half-res preview, lag proof); the director reviews
independently and sends notes in THIS shape -- prioritized, frame-referenced, with an acceptance
condition -- back to the worker. Never "make it feel better"; every note names a time, what's wrong,
and what PASS looks like.

## Checkpoint reviewed

- Preview: `out/<slug>-preview.mp4` (or a `--slice=a:b` render of the moment in question)
- Contact sheet: `out/<slug>-preview-contact.png`
- Lag proof: `python3 lagproof.py out/<slug>-preview.mp4` -- <PASS/FAIL, paste the still-run/cadence lines>
- Frame strips reviewed: <t=..., t=... -- around every transition>

## Notes (priority order: blocking first)

| # | Priority | Time | Symptom | Fix | Acceptance |
|---|---|---|---|---|---|
| 1 | blocking | 0:05.2 | | | |
| 2 | advisory | | | | |

Priority levels: **blocking** (must fix before the next checkpoint), **advisory** (fix if cheap,
otherwise note as a known tradeoff and move on).

Cross-check every note against the `references/pitfalls.md` of the sibling skills
(`motion-video-engine`, `motion-video-sound`, `motion-video-qa`, `motion-video-brand`; numbers are
shared across them) before writing it -- if it is a known failure mode, cite the pitfall number
instead of re-describing it.

## Not reviewed / deferred

Anything explicitly out of scope for this pass (e.g. audio not yet mixed, a placeholder logo) --
say so, so it is not mistaken for an oversight.

## Next checkpoint

What the worker should stop at next (another preview? the final build? a specific slice?).
