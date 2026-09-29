# motion-video

This repo holds five [Agent Skills](https://agentskills.io/specification) under `skills/`: the director `motion-video` and four siblings (`motion-video-engine`, `motion-video-sound`, `motion-video-qa`, `motion-video-brand`). Together they render short beat-synced motion-graphics videos from code. They are distributed with the [skills CLI](https://github.com/vercel-labs/skills) (`npx skills add juanmaagd/motion-video`) and are meant to be listed on [skills.sh](https://skills.sh).

This file is for agents working ON the skills (maintaining them), not for agents USING them. The family's entry contract is `skills/motion-video/SKILL.md`; each sibling has its own `SKILL.md`.

## Layout

```
CLAUDE.md, README.md, LICENSE, .gitignore   # repo-only: never shipped to installers
.claude-plugin/marketplace.json              # repo-only: groups the five skills as one plugin; its `skills` list must match the folders below
skills/                                      # THE install surface: each folder is copied verbatim by `npx skills add`
├── motion-video/                            # director: intake, storyboard, assembly, review loop, delivery
│   ├── SKILL.md, LICENSE                    # every skill folder has these two; LICENSE is an identical copy of the root one
│   ├── references/                          # workflow, storyboard, intake
│   └── assets/
│       ├── project/                         # package.json, README.md, archive.sh
│       └── templates/                       # brief, review-notes, worker-brief
├── motion-video-engine/                     # scenes and render pipeline
│   ├── SKILL.md, LICENSE
│   ├── references/                          # motion-craft, scene-recipes, pitfalls
│   └── assets/project/                      # index.html, engine.js, render.mjs, build.mjs, determinism.mjs, timeline.json
├── motion-video-sound/                      # the synthesized score
│   ├── SKILL.md, LICENSE
│   ├── references/                          # sound-design, pitfalls
│   └── assets/project/                      # synth-kit.mjs, score.mjs
├── motion-video-qa/                         # automated and manual checks
│   ├── SKILL.md, LICENSE
│   ├── references/                          # qa-checklist, pitfalls
│   └── assets/project/                      # qa.py, lagproof.py, sheet.py, inspect.sh, cta-check.sh, requirements.txt
└── motion-video-brand/                      # brand inputs, marks, device frames, generated rasters
    ├── SKILL.md, LICENSE
    ├── references/                          # brand-extraction, device-frames, generated-assets, pitfalls
    └── assets/
        ├── project/                         # brand.json, logos.mjs, detect-frame.py, brandqa.mjs, logoqa.py, gen-image.mjs, brand/, fonts/, generated/
        └── devices/                         # bundled device-frame SVGs + SOURCES.json (not auto-copied)
```

The video project is not a folder in the repo. The director assembles it by copying each skill's `assets/project/` (director first, then engine, sound, qa, brand) into one new folder; `references/workflow.md` in the director has the exact steps. A project file lives in exactly one skill, so the assembly never overwrites a file.

## Rules that outrank convenience

1. **Everything inside a `skills/<name>/` folder ships to every install of that skill.** The CLI copies the whole folder and excludes only `.git`, `__pycache__`, `__pypackages__` and `metadata.json` (`src/installer.ts` in vercel-labs/skills). So `node_modules`, renders, caches, scratch notes and maintainer docs never go inside any skill folder. Repo-level material (this file, CI, demo media) lives at the root. Exclusive ownership: every file has exactly one owner skill, except `LICENSE` (five identical copies).
2. **Spec compliance, per skill:**
   - `name` must equal the folder name.
   - `description` is a quoted one-liner of 1024 chars or fewer that says what the skill does and when to use it. The director keeps the broad trigger words. Each sibling's description stays narrow ("Loaded by the `motion-video` director to ... Use directly only when the user asks specifically about ...; not for making a video end to end") and avoids the director's trigger words, so the siblings never compete with it.
   - `compatibility` is 500 chars or fewer and lists the real requirements. The director's keeps the full runtime union and names the four siblings it requires.
   - `metadata.version` is bumped on every user-visible change to that skill.
3. **`main` is the release channel.** `npx skills update` re-installs a skill when its folder's git tree SHA changes on the default branch, so every commit to `main` that touches `skills/<name>/` reaches installers. The director requires its siblings, so a change to the family contract (ownership, assembly, a renamed reference) lands in one PR across all the skills it touches. Work on a branch, open a PR into `main`, and merge only once the checks below pass.
4. **Self-contained.**
   - A skill may name and load its `motion-video-*` siblings from this repo. It never loads, names or links an unrelated external skill.
   - A reference to another skill's file says which skill owns it ("`qa-checklist.md` in the `motion-video-qa` skill"), never a relative filesystem path. The one exception is the director's assembly fallback for runtimes without a skill loader: the siblings are installed next to the director's folder.
   - A skill reaches the outside world only through public URLs, CLIs on `PATH`, or user-level paths such as `$MOTION_VIDEO_ASSETS` (default `~/.motion-video-assets/`).
   - Optional integrations (the Codex CLI in `gen-image.mjs`, ElevenLabs) must degrade to the built-in default and never become required.
5. **Public repo, so no private data.**
   - No personal or client names, machine paths, emails, internal project names or real brand tokens.
   - Worked examples use fictional brands ("Acme (fictional)").
   - Lessons keep the technique and drop the identifying specifics.
6. **Third-party assets carry their licence.**
   - Every bundled asset has a `SOURCES.json` entry: `{ file, sourceUrl, license, author }` (the device frames' is `skills/motion-video-brand/assets/devices/SOURCES.json`).
   - Official Apple bezels and kits are NEVER bundled: Apple's Design Resources licence forbids redistribution. They stay in the user's library and are used static only.
   - Third-party marks come from `logos.mjs`, which records each licence.
7. **Verifiers must discriminate.** A check that analysed nothing FAILS (a missing file or an empty input never passes), and every new check is shown to pass on good input AND fail on bad input before it is trusted.
8. **Each `SKILL.md` stays lean.**
   - The body is about 1000 tokens or fewer, which means 4,000 chars or fewer: `awk 'BEGIN{c=0} /^---$/{c++; next} c>=2' SKILL.md | wc -c`. The director is near that limit, the siblings well under it.
   - Section order: Activation Contract, Hard Rules, Decision Gates, Execution Steps, Output Contract, References. A sibling may omit Decision Gates when it has none.
   - Detail belongs in that skill's `references/` and is linked from its `SKILL.md`.
9. **Rendering stays deterministic.** Every frame is `renderAt(t)`, a pure function of time: no CSS animation, rAF state, `Math.random`, or network calls inside a scene. `npm run determinism` enforces it.
10. **Pitfall numbers are global across the family.** Frozen project files cite pitfalls by number (`pitfall 59`, `#61`), so each skill's `references/pitfalls.md` is a gapped subset that keeps the original numbers. The next free number is 63. Never renumber, and never reuse a number.

## Checks before every merge into `main`

Run from the repo root and capture each exit code (`out=$(cmd 2>&1); rc=$?`); piping into `tail` hides the real one.

```sh
# 1. Spec validator on all five skills (the executable is `agentskills`, shipped by the skills-ref package)
for d in skills/*/; do uvx --from skills-ref agentskills validate "$d" || echo "FAIL $d"; done

# 2. Syntax. For Python, use ast.parse: py_compile would drop __pycache__ into the install surface
for f in $(fd -e js -e mjs . skills); do node --check "$f" || echo "FAIL $f"; done
for f in $(fd -e py . skills); do python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$f" || echo "FAIL $f"; done
for f in $(fd -e sh . skills); do bash -n "$f" || echo "FAIL $f"; done
for f in $(fd -e json . skills) .claude-plugin/marketplace.json; do node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f" || echo "FAIL $f"; done
claude plugin validate .    # the marketplace manifest, when the Claude Code CLI is available

# 3. Collision check, then the five-skill assembly runs from a fresh copy (never inside the repo: node_modules would land in the install surface)
fd -H -t f . skills/*/assets/project | sd '.*/assets/project/' '' | sort | uniq -d    # expect nothing
TMP=$(mktemp -d); mkdir "$TMP/t"
for s in motion-video motion-video-engine motion-video-sound motion-video-qa motion-video-brand; do cp -R "skills/$s/assets/project/." "$TMP/t/"; done
(cd "$TMP/t" && npm install && npm run stills)

# 4. Install parity: in a throwaway directory, project scope, telemetry off
DISABLE_TELEMETRY=1 npx -y skills add <path-to-this-repo> --agent claude-code --copy -y
#    It must detect exactly FIVE skills (with the marketplace manifest present), and for each installed skill the file list must equal `git ls-files skills/<name>`.

# 5. Nothing private or stray
rg -n -i "/Users/|/home/|@gmail|confirmed by the user" skills README.md   # expect 0 hits
fd -H -u "node_modules|__pycache__|\.DS_Store" skills                  # expect nothing

# 6. A behaviour-preserving change must leave the assembled project byte-identical to the last release's.
#    For the 2.0 split the reference is the single-skill layout at 25aa089, where the project was formerly the `assets/template` folder:
#    `git archive 25aa089 -- skills/motion-video/assets/template`
#    extracted to $OLD, then `diff -rq "$OLD/skills/motion-video/assets/template" "$TMP/t"` must print nothing,
#    and the executable-bit lists (`fd -t x`, paths made relative, sorted) must be equal.
```

When a change touches rendering, audio or QA, also build the demo in the assembled project (from step 3): run `npm run build` (QA must pass) and `npm run determinism`.

## Never

- `npx skills add ... -g` (or any global install) while testing. It overwrites the maintainer's live copy of the skills. Test installs go into a throwaway directory only.
- A telemetry-on `npx skills add juanmaagd/motion-video`. The first install with telemetry on is what lists the skills on skills.sh, and listing is the owner's decision. **Status: not listed yet.** Update this line once it is.
- AI attribution trailers (`Co-Authored-By`, "Generated with") in commits or PRs. Use Conventional Commits scoped by skill (`feat(motion-video-engine): ...`, `fix(motion-video-qa): ...`, `docs: ...`).
- Generated logos, wordmarks, type, UI or claims. `gen-image.mjs` is for decorative rasters only (Hard Rule 8 of the director's `SKILL.md`, Hard Rule 5 of `motion-video-brand`).

## Known unverified areas

- The director loading its siblings through the skill loader has never been exercised in a fresh session, and the fallback (siblings installed next to the director's folder) is untested.
- Official-bezel detection (`detect-frame.py`) on a real Apple export. It has only been tested on synthetic PNGs.
- The user-library lookup (`$MOTION_VIDEO_ASSETS/devices/`, `.../apple/`) on a real library.
- A live `gen-image.mjs` run, which spends Codex quota.
- Agents other than Claude Code. The intake has a plain-text fallback for runtimes without a question UI, but nobody has exercised it.
- `motion-video-qa` on an arbitrary MP4: only `lagproof.py` and `inspect.sh` are standalone today; `qa.py` reads the project's `timeline.json` and `brand.json`.

## Where the knowledge lives

- `skills/motion-video-*/references/pitfalls.md`: every failure met in production, with the evidence and the fix, split by owning skill. Add new lessons there with the next free number (63), not here.
- `skills/motion-video-qa/references/qa-checklist.md`: thresholds and why they are set there. For example, the lag-proof threshold is calibrated from the still-hold floor.
- `skills/motion-video/assets/project/README.md`: the project's commands and one line per file.
