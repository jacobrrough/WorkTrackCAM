# WorkTrackCAM — Project Rules

## Identity
Professional CAM/FDM slicing desktop app (Electron, React 19, TypeScript, Three.js, Python CAM engines). Target quality: Fusion 360 / Mastercam / SolidCAM.

## Autonomous Improvement Rules

### Quality Gates (MANDATORY — no exceptions)
1. **Pre-flight**: Run `npm test` and `npm run typecheck` BEFORE making any changes. Record baseline counts.
2. **Post-flight**: Run `npm test` and `npm run typecheck` AFTER all changes. Both must pass.
3. **No regressions**: Test pass count must not decrease. If it does, fix immediately before proceeding.
4. **Abort on red baseline**: If tests or typecheck fail at the start, fix those failures FIRST — that IS your cycle's work.

### Scope Control (prevents drift)
1. **One focus area per cycle** — pick from the rotation, stick to it. No "while I'm here" side quests.
2. **2-4 tasks max per cycle** — enough to make real progress, not so many that quality drops.
3. **Read before write** — always read the full file before editing. Understand existing patterns.
4. **Follow existing conventions** — match naming, architecture, and style of surrounding code.
5. **No speculative features** — only build what the focus area calls for. No "nice to haves."
6. **No unnecessary refactoring** — if it works and isn't in your focus area, leave it alone.

### Safety Rules
1. **G-code is sacred** — any change to toolpath generation or post-processing must be verified against known-good output. Bad G-code crashes machines and ruins parts.
2. **Schema changes need migrations** — never break existing saved projects.
3. **No `any` types** — use proper generics, discriminated unions, type guards.
4. **No security vulnerabilities** — validate file paths, sanitize subprocess args, no command injection.
5. **Python engine changes need validation** — test with real STL meshes, verify outputs.

### Rotation Enforcement
1. Check `.claude/improvement-log.md` before every cycle to see what was last done.
2. Follow the rotation order in `.claude/commands/improve.md`. Never repeat the same area back-to-back unless fixing a regression.
3. If the log flags a critical issue in another area, handle that first.

### Logging (non-negotiable)
Every cycle MUST update `.claude/improvement-log.md` with: cycle number, date, focus area, baseline metrics, changes made, tests added, results, and next cycle recommendations.

## Development Commands
```bash
npm test              # Run all tests (Vitest)
npm run typecheck     # TypeScript strict validation
npm run dev           # Start dev server (electron-vite)
npm run build         # Full production build
```

## Architecture Quick Reference
- `src/main/` — Electron main process, IPC handlers, file I/O
- `src/renderer/src/` — React UI components, CSS
- `src/preload/` — Electron preload (IPC bridge)
- `src/shared/` — Zod schemas, CAM math, type definitions
- `engines/cam/` — Python CAM engine (13 strategies)
- `resources/` — Machine profiles (YAML), post templates (Handlebars), materials
- `.claude/improvement-log.md` — Improvement cycle history (source of truth)
- `.claude/commands/improve.md` — Full improvement cycle playbook
