# Improvement Cycle Playbook

This is the expanded playbook for the autonomous improvement workflow. `CLAUDE.md` is the short charter; this file is the full reference. Every cycle **must** follow these rules — they exist to prevent drift, regressions, and unsafe changes to G-code generation.

## Rotation order

Pick ONE focus area per cycle. Rotate in this order; never repeat the same area back-to-back unless fixing a regression that area caused.

1. **`ui-polish`** — React renderer layer. Design tokens, motion, accessibility, empty/loading/error states, keyboard affordances. No new features; polish only.
2. **`cam-engine`** — Python engine under `engines/cam/` and its TS callers. Strategy correctness, voxel/heightfield math, performance hotspots. Requires real-STL validation (see Safety Rule 5).
3. **`post-processing`** — Handlebars post templates under `resources/posts/` and post-process pipeline in `src/main/`. G-code dialect compliance, 4-axis rotary handling, subroutine emission. **G-code is sacred** — see Safety Rule 1.
4. **`test-coverage`** — Add tests in under-covered areas. Prioritize: IPC handlers with only registration checks (no behavior tests), Python strategies without integration coverage, renderer components without interaction tests.
5. **`perf`** — Measure before changing. Renderer frame time, CAM engine runtime, main-process I/O. One hotspot per cycle; benchmark before and after.
6. **`docs-and-dx`** — Project docs (`README.md`, CLAUDE.md, inline comments where the WHY is non-obvious), developer experience (scripts, error messages, dev-server boot time).

The rotation proposal above is the current working order. Adjust deliberately — record any reordering in `.claude/improvement-log.md` with the reason.

---

## Quality Gates (MANDATORY — no exceptions)

0. **Sandbox bootstrap** (idempotent — run once per fresh sandbox session): `npm run bootstrap:python`. Installs pytest into the sandbox user-site if it isn't already importable. Cleared [ID-0147] on 2026-04-30 (`engineering` plugin sandbox previously failed `python3 -m pytest` cold). The `test:python` npm script auto-invokes this bootstrap via its `pretest:python` hook, so step 1 covers it implicitly — but running it once at cycle start makes the install cost visible up front rather than embedded in the first Python-validation check.
1. **Pre-flight**: Run `npm test` and `npm run typecheck` BEFORE making any changes. Record baseline counts in the log. For `cam-engine` focus, additionally run `npm run test:python` and record its pass/fail count — Safety Rule 5 requires real-STL validation of Python engine changes (introduced Cycle 4, 2026-04-22; sandbox bootstrap unblocked 2026-04-30 [ID-0147-cleared]).
2. **Post-flight**: Run `npm test` and `npm run typecheck` AFTER all changes. Both must pass. For `cam-engine` focus, additionally run `npm run test:python` and confirm its pass count has not decreased vs. baseline — Safety Rule 5 requires real-STL validation of Python engine changes (introduced Cycle 4, 2026-04-22; sandbox bootstrap unblocked 2026-04-30 [ID-0147-cleared]).
3. **No regressions**: Test pass count must not decrease. If it does, fix immediately before proceeding.
4. **Abort on red baseline**: If tests or typecheck fail at the start, fix those failures FIRST — that IS your cycle's work.
5. **Cycle close-out tempdir purge** ([ID-0294], 2026-04-30): the autonomous-improvement sandbox accumulates session-owned `/tmp` dirs across hourly cycles -- each pin-test that uses `mkdtempSync` leaves a directory behind that the sandbox doesn't auto-reap. The shared 9.6 GB filesystem fills to 100 % within ~24 h of continuous hourly running, causing intermittent ENOSPC flakes in tests that mkdtemp during pre-flight. At cycle close (after the post-flight gate but before the improvement-log append), run: `find /tmp -maxdepth 1 -user "$(whoami)" -type d \( -name 'pin-*' -o -name 'dfs-pin-*' -o -name 'ufn-pin-*' -o -name 'carvera-pipe-*' -o -name 'axis4-int-*' -o -name 'cam-pipe-*' -o -name 'moonraker-*' -o -name 'k2-moonraker-*' -o -name 'drawing-store-*' -o -name 'wtcam-*' -o -name 'pytest-*' \) -exec rm -rf {} + 2>/dev/null; true`. The `2>/dev/null; true` swallows any "Operation not permitted" on dirs the cycle's vitest workers haven't released yet; the next cycle's purge picks them up. Do NOT touch `/tmp` dirs not owned by the cycle's user (the `-user "$(whoami)"` filter is mandatory) -- other sandbox tenants' files must remain untouched.

## Scope Control (prevents drift)

1. **One focus area per cycle** — pick from the rotation, stick to it. No "while I'm here" side quests.
2. **2-4 tasks max per cycle** — enough to make real progress, not so many that quality drops.
3. **Read before write** — always read the full file before editing. Understand existing patterns.
4. **Follow existing conventions** — match naming, architecture, and style of surrounding code.
5. **No speculative features** — only build what the focus area calls for. No "nice to haves."
6. **No unnecessary refactoring** — if it works and isn't in your focus area, leave it alone.

## Safety Rules

1. **G-code is sacred** — any change to toolpath generation or post-processing must be verified against known-good output. Bad G-code crashes machines and ruins parts.
2. **Schema changes need migrations** — never break existing saved projects.
3. **No `any` types** — use proper generics, discriminated unions, type guards.
4. **No security vulnerabilities** — validate file paths, sanitize subprocess args, no command injection.
5. **Python engine changes need validation** — test with real STL meshes, verify outputs.
6. **Test files must use `mkdtempSync` for tmp paths** — never write to a fixed `join(tmpdir(), '<name>')` path. Use `mkdtempSync(join(tmpdir(), '<prefix>-'))` at module scope (or in a per-`describe` `beforeAll`) and derive all per-test filenames from that unique directory. Fixed tmp filenames collide across re-runs and across CI workers, producing `EACCES` on overwrite when a previous run left files owned by a different uid (see Cycle 2, 2026-04-21).
7. **Large-file edits follow [`docs/EDIT-WORKFLOW.md`](../../docs/EDIT-WORKFLOW.md)** — for files >800 lines or any `.claude/` log file, bypass the `Edit` tool (silent-truncation rate 11/12 cycles per [ID-0067]) and use Python-via-bash `p.write_text(...)`. Splice-recovery must pass the marker-uniqueness checklist ([ID-0095]) before stitching HEAD tails. Post-edit verification (`wc -l`, landmark `grep`, focused `vitest`) is required. Landed Cycle 20 (docs-and-dx, 2026-04-24) closing [ID-0089] + [ID-0095].

---

## Cycle template

Copy this block into `.claude/improvement-log.md` at the start of each cycle and fill it in as you go.

```markdown
## Cycle N — <short title> (YYYY-MM-DD)
- **Focus**: <area from rotation>
- **Baseline**: `npm test` → <N passed, M skipped>. `npm run typecheck` → clean.
- **Changes**:
  - <bullet per meaningful change, with file paths>
- **Tests added**: <count and brief description, or "none — reason why">
- **Results**: `npm test` → <N' passed, M' skipped> (Δ +X). `npm run typecheck` → <clean | errors fixed>.
- **Next cycle**: <next focus area from rotation, with any specific sub-area hints>
```

## When to break the rules

- **Rotation can be skipped** only when the log flags a critical issue elsewhere (regression, security vuln, G-code correctness bug). Record the reason in the cycle entry.
- **Scope can widen** only to fix a test or typecheck failure that blocks the cycle's main work. Do not use this as a loophole for unrelated cleanup.
- **Safety Rules have no exceptions.** If a change touches G-code, it needs known-good comparison. If it touches schemas, it needs a migration. Full stop.
