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

1. **Pre-flight**: Run `npm test` and `npm run typecheck` BEFORE making any changes. Record baseline counts in the log.
2. **Post-flight**: Run `npm test` and `npm run typecheck` AFTER all changes. Both must pass.
3. **No regressions**: Test pass count must not decrease. If it does, fix immediately before proceeding.
4. **Abort on red baseline**: If tests or typecheck fail at the start, fix those failures FIRST — that IS your cycle's work.

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
