# WorkTrackCAM — Project Rules

## Identity
Professional CAM/FDM slicing desktop app (Electron, React 19, TypeScript, Three.js, Python CAM engines). Target quality: Fusion 360 / Mastercam / SolidCAM.

## USER CONTEXT — TARGET MACHINES (MUST BE FOLLOWED 100%)
The owner (Jacob, Palmdale, CA) operates ONLY the three machines below. All development — slicer profiles, CAM strategies, post-processors, machine profiles, UI defaults, validation rules, test fixtures — MUST be perfected for these three machines FIRST. Ignore every other machine, controller, or firmware target until these three are flawless. Do NOT add speculative support for machines not on this list.

### 1. Creality K2 Plus — FDM 3D Printer (FDM slicer focus)
- **Build volume**: 350 × 350 × 350 mm
- **Motion**: CoreXY with closed-loop servo-step motors on X/Y/Z/E
- **Extruder**: Dual-gear direct drive, 1.75 mm filament, 0.4 mm nozzle standard
- **Max speed / accel**: 600 mm/s, 30,000 mm/s²
- **Temps**: Nozzle ≤350 °C, Bed ≤120 °C, heated chamber
- **Firmware**: Creality Klipper-based OS with built-in Moonraker + Fluidd
  - Direct G-code upload via **Moonraker API** is native and **preferred** (implement first-class)
- **Required capabilities**: high-speed profiles, chamber heater control, input shaping, power-loss recovery, RFID filament support, auto-leveling, CFS multi-color ready

### 2. Laguna Swift 5x10 — CNC Router (large-format 3-axis milling)
- **Work envelope**: 60" × 120" (1524 × 3048 mm) X/Y, ~7.5–8" Z clearance under gantry
- **Axes**: 3-axis — X/Y helical rack & pinion, Z ball screw
- **Spindle**: 3 HP or 6 HP liquid-cooled, 6,000–24,000 RPM, ER-20 collet
- **Controller**: RichAuto A-series handheld — standard G/M codes, supports G17/G18/G19
- **Table**: T-slot or vacuum-ready (6-zone typical)
- **Post-processor requirements**: clean standard G-code (or .mmg/.prg if needed); explicit units; safe retracts; spindle warm-up and cool-down; dust-collection M-codes when present
- **Typical use**: full-sheet plywood, MDF, aluminum plates, signage, furniture parts

### 3. Makera Carvera + 4th Axis Rotary — Desktop 4-axis CNC
- **3-axis work area**: 360 × 240 × 140 mm (X/Y/Z)
- **4th axis**: Harmonic-drive rotary module, max ~92 mm diameter × 240 mm length
- **Spindle**: 200 W, 13,000–15,000 RPM, automatic tool changer (full Carvera)
- **Features**: auto probing/leveling, built-in dust collection (bypass capable)
- **4th-axis post specifics**: work origin requires X offset to rotary headstock; Y=0; scan-margin option; rotation direction MUST be correct in posts
- **Firmware / controller**: standard G-code + Makera Controller; community firmware enables full 4-axis simultaneous
- **Typical use**: small precision parts, cylindrical engraving, 4-axis 3D reliefs, double-sided machining

### Enforcement
- Default machine profiles (`resources/`), post templates, test fixtures, and UI presets MUST cover these three first and be production-quality before any other machine is added.
- Any new feature must be validated against the relevant machine(s) from this list. G-code output for Laguna Swift must be verified against RichAuto A-series expectations; Carvera posts must correctly handle the 4th-axis case; K2 Plus integration must exercise the Moonraker upload path.
- Do not add machines, controllers, or firmware targets outside this list unless the user explicitly requests it.

## MANDATORY INSTRUCTIONS FOR EVERY IMPROVEMENT CYCLE

**You are now in "My-Shop-Only Mode". These rules apply to every improvement cycle, without exception, until the user explicitly disables this mode.**

### Machine Scope — Hard Constraints
- The three machines in "USER CONTEXT — TARGET MACHINES" (Creality K2 Plus, Laguna Swift 5x10, Makera Carvera + 4th Axis) are the default and ONLY visible options in the machine selector until the user says otherwise.
- Every machine profile (YAML/TOML in `resources/machines/`), post-processor (Handlebars), slicer profile (for K2), simulation kinematics, safe retracts, guardrails, and UI presets MUST be 100% perfect for these exact specs.
- Hard-code safe defaults, homing sequences, spindle warm-up, tool-change logic, and G-code dialect compliance for each.
- Stay strictly inside these three machines for every cycle. Do NOT add support for any other machine. Do NOT bloat the UI with "generic" options. Output must be production-ready for the user's daily workflow.

### Machine-Specific Priorities
- **Creality K2 Plus**: Prioritize Moonraker direct-push upload, Cura-style slicing with K2-optimized profiles (high-speed, chamber heater control, input shaping, power-loss recovery, RFID filament, auto-leveling, CFS multi-color).
- **Laguna Swift 5x10**: Large-bed workflows, vacuum zone (6-zone) support, full-sheet stock presets, RichAuto A-series G-code dialect compliance, spindle warm-up/cool-down, dust-collection M-codes.
- **Makera Carvera + 4th Axis**: Dedicated 4-axis toolpaths, correct rotary origin handling (X offset to rotary headstock, Y=0), simultaneous 4-axis simulation, correct rotation direction in posts, auto probing/leveling, ATC logic.

### UI Requirements
- Update the machine management UI so switching between these three is one-click with saved presets for common jobs (full-sheet routing, high-speed FDM, 4-axis rotary parts).
- Add a "My Shop" tab or quick-select that ONLY shows these three machines plus their real-world presets.

### Every Feature/Change MUST Include
1. Updated machine profiles + tests.
2. Updated post templates + G-code safety guardrails.
3. Updated 3D simulation models/kinematics (where applicable).
4. New Vitest + snapshot tests that prove correct output for each affected machine.
5. Zero regressions on existing CLAUDE.md quality gates (see "Quality Gates" below).

### Per-Cycle Deliverables
Every improvement cycle MUST produce (or advance measurably toward) all of the following, tailored to the focus area of the cycle:
1. Updated machine YAML/TOML profiles for all three machines with full specs.
2. Perfect Handlebars post-processors tailored to each controller/firmware (Klipper/Moonraker, RichAuto A-series, Makera Controller).
3. K2 Plus slicer presets (high-speed + standard).
4. UI changes so these three machines are the obvious first-class citizens.
5. New tests proving everything works for the exact hardware specs.
6. Updated `.claude/improvement-log.md` entry per the "Logging" rule below.

Standard CLAUDE.md scope-control rules (one focus area per cycle, 2–4 tasks max, no speculative features, no unnecessary refactoring) still apply on top of these mandatory instructions.

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
6. **Large-file edits follow `docs/EDIT-WORKFLOW.md`** — for files >800 lines or any `.claude/` log file, bypass the `Edit` tool (silent-truncation rate 11/12 cycles per [ID-0067]) and use Python-via-bash `p.write_text(...)`. Splice-recovery must pass the marker-uniqueness checklist ([ID-0095]) before stitching HEAD tails. Post-edit verification (`wc -l`, landmark `grep`, focused `vitest`) is required.

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
- `docs/EDIT-WORKFLOW.md` — Python-via-bash edit workflow + splice-recovery marker-uniqueness checklist ([ID-0089], [ID-0095])
