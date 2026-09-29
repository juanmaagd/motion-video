# motion-video

This repo holds one [Agent Skill](https://agentskills.io/specification), `skills/motion-video/`, which renders short beat-synced motion-graphics videos from code. The skill is distributed with the [skills CLI](https://github.com/vercel-labs/skills) (`npx skills add juanmaagd/motion-video`) and is meant to be listed on [skills.sh](https://skills.sh).

This file is for agents working ON the skill (maintaining it), not for agents USING it. The skill's own contract is `skills/motion-video/SKILL.md`.

## Layout

```
CLAUDE.md, README.md, LICENSE, .gitignore   # repo-only: never shipped to installers
skills/motion-video/                         # THE install surface: copied verbatim by `npx skills add`
├── SKILL.md                                 # entry point: frontmatter + contract
├── LICENSE                                  # travels with every install (keep identical to the root one)
├── references/*.md                          # loaded on demand from SKILL.md
└── assets/
    ├── template/                            # the runnable project a user copies per video
    ├── templates/                           # brief, review-notes, worker-brief
    └── devices/                             # bundled device-frame SVGs + SOURCES.json
```

## Rules that outrank convenience

1. **Everything inside `skills/motion-video/` ships to every install.** The CLI copies the whole folder and excludes only `.git`, `__pycache__`, `__pypackages__` and `metadata.json` (`src/installer.ts` in vercel-labs/skills). So `node_modules`, renders, caches, scratch notes and maintainer docs never go inside it. Repo-level material (this file, CI, demo media) lives at the root.
2. **Spec compliance:**
   - `name` must equal the folder name (`motion-video`).
   - `description` is a quoted one-liner of 1024 chars or fewer that says what the skill does and when to use it, keeping the trigger words.
   - `compatibility` is 500 chars or fewer and lists the real requirements.
   - `metadata.version` is bumped on every user-visible change.
3. **`main` is the release channel.** `npx skills update` re-installs when the skill folder's git tree SHA changes on the default branch, so every commit to `main` that touches `skills/motion-video/` reaches installers. Work on a branch, open a PR into `main`, and merge only once the checks below pass.
4. **Self-contained.** The skill never loads, names or links another skill. It reaches the outside world only through public URLs, CLIs on `PATH`, or user-level paths such as `$MOTION_VIDEO_ASSETS` (default `~/.motion-video-assets/`). Optional integrations (the Codex CLI in `gen-image.mjs`, ElevenLabs) must degrade to the built-in default and never become required.
5. **Public repo, so no private data.**
   - No personal or client names, machine paths, emails, internal project names or real brand tokens.
   - Worked examples use fictional brands ("Acme (fictional)").
   - Lessons keep the technique and drop the identifying specifics.
6. **Third-party assets carry their licence.**
   - Every bundled asset has a `SOURCES.json` entry: `{ file, sourceUrl, license, author }`.
   - Official Apple bezels and kits are NEVER bundled: Apple's Design Resources licence forbids redistribution. They stay in the user's library and are used static only.
   - Third-party marks come from `logos.mjs`, which records each licence.
7. **Verifiers must discriminate.** A check that analysed nothing FAILS (a missing file or an empty input never passes), and every new check is shown to pass on good input AND fail on bad input before it is trusted.
8. **SKILL.md stays lean.**
   - The body is about 1000 tokens or fewer (aim for 800 or fewer).
   - Section order: Activation Contract, Hard Rules, Decision Gates, Execution Steps, Output Contract, References.
   - Detail belongs in `references/` and is linked from SKILL.md.
9. **Rendering stays deterministic.** Every frame is `renderAt(t)`, a pure function of time: no CSS animation, rAF state, `Math.random`, or network calls inside a scene. `npm run determinism` enforces it.

## Checks before every merge into `main`

Run from the repo root and capture each exit code (`out=$(cmd 2>&1); rc=$?`); piping into `tail` hides the real one.

```sh
# 1. Spec validator (the executable is `agentskills`, shipped by the skills-ref package)
uvx --from skills-ref agentskills validate skills/motion-video

# 2. Syntax. For Python, use ast.parse: py_compile would drop __pycache__ into the install surface
for f in $(fd -e js -e mjs . skills); do node --check "$f" || echo "FAIL $f"; done
for f in $(fd -e py . skills); do python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$f" || echo "FAIL $f"; done
for f in $(fd -e sh . skills); do bash -n "$f" || echo "FAIL $f"; done
for f in $(fd -e json . skills); do node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$f" || echo "FAIL $f"; done

# 3. The template still runs from a fresh copy (never inside the repo: node_modules would land in the install surface)
cp -R skills/motion-video/assets/template "$TMP/t" && (cd "$TMP/t" && npm install && npm run stills)

# 4. Install parity: in a throwaway directory, project scope, telemetry off
DISABLE_TELEMETRY=1 npx -y skills add <path-to-this-repo> --agent claude-code --copy -y
#    It must detect exactly one skill, and the installed file list must equal `git ls-files skills/motion-video`.

# 5. Nothing private or stray
rg -n -i "/Users/|/home/|@gmail|confirmed by the user" skills README.md   # expect 0 hits
fd -H -u "node_modules|__pycache__|\.DS_Store" skills                  # expect nothing
```

When a change touches rendering, audio or QA, also build the demo in a template copy: run `npm run build` (QA must pass) and `npm run determinism`.

## Never

- `npx skills add ... -g` (or any global install) while testing. It overwrites the maintainer's live copy of the skill. Test installs go into a throwaway directory only.
- A telemetry-on `npx skills add juanmaagd/motion-video`. The first install with telemetry on is what lists the skill on skills.sh, and listing is the owner's decision. **Status: not listed yet.** Update this line once it is.
- AI attribution trailers (`Co-Authored-By`, "Generated with") in commits or PRs. Use Conventional Commits (`feat(motion-video): ...`, `fix(template): ...`, `docs: ...`).
- Generated logos, wordmarks, type, UI or claims. `gen-image.mjs` is for decorative rasters only (Hard Rule 8 of SKILL.md).

## Known unverified areas

- Official-bezel detection (`detect-frame.py`) on a real Apple export. It has only been tested on synthetic PNGs.
- The user-library lookup (`$MOTION_VIDEO_ASSETS/devices/`, `.../apple/`) on a real library.
- A live `gen-image.mjs` run, which spends Codex quota.
- Agents other than Claude Code. The intake has a plain-text fallback for runtimes without a question UI, but nobody has exercised it.

## Where the knowledge lives

- `references/pitfalls.md`: every failure met in production, with the evidence and the fix. Add new lessons there, not here.
- `references/qa-checklist.md`: thresholds and why they are set there. For example, the lag-proof threshold is calibrated from the still-hold floor.
- `assets/template/README.md`: the template's commands and one line per file.
