# WorkTrackCAM — Project Rules

## Identity
Professional CAM/FDM slicing desktop app (Electron, React 19, TypeScript, Three.js). Target quality: Fusion 360 / Mastercam / SolidCAM. **Standalone app — NOT a FreeCAD addon.**

## Open-Source Backend Stack (post-2026-05-27 pivot)
The user explicitly switched the foundation to mature open-source libraries bundled inside the standalone Electron app. Do NOT reintroduce a FreeCAD addon path or revive deleted custom CAM/CuraEngine code.
- **CadQuery** (Apache 2) — parametric B-rep CAD on OpenCascade. Python sidecar.
- **OpenCAMLib** (LGPL) — drop-cutter / push-cutter / waterline toolpath generation. Python.
- **OrcaSlicer** (AGPL) — bundled CLI for K2 Plus FDM slicing. Replaces the deleted CuraEngine bundle.
- The user **never sees** these libraries — they're internal bundled dependencies. The product is WorkTrackCAM.

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
- **Creality K2 Plus**: Prioritize Moonraker direct-push upload, OrcaSlicer-driven slicing with K2-optimized profiles (high-speed, chamber heater control, input shaping, power-loss recovery, RFID filament, auto-leveling, CFS multi-color).
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
- `src/main/index.ts` — **IPC ordering invariant**: all `register*Ipc` calls MUST run inside `app.whenReady()` BEFORE `createWindow()`. Otherwise the preload can dispatch initial `fab()` calls before handlers are installed, producing opaque "No handler registered" errors on cold start. Adding a new IPC namespace? Put it next to the existing `registerCoreIpc / registerFabricationIpc / registerModelingIpc` calls.
- `src/main/sidecar/python-bridge.ts` — typed JSON-RPC client that spawns and talks to the Python sidecar
- `src/main/slicer/orca-wrapper.ts` — OrcaSlicer CLI wrapper (`buildOrcaArgs` + `runOrcaSlice`)
- `src/renderer/src/` — React UI components, CSS, Three.js viewport
- `src/renderer/src/EmptyState.tsx` — **shared "nothing here yet" component**. Use this for ANY panel that can render with no data (operations list, dashboard, nesting result, etc.). BEM CSS classes (`.empty-state`, `__icon`, `__title`, `__body`, `__cta`) live in `src/renderer/styles/components.css`. Do NOT roll your own empty-state markup — extend `EmptyState` instead.
- `src/renderer/src/AppHeader.tsx` — **locked-top global status strip** (Mainsail/Fluidd pattern). Renders at the very top of the ShopApp layout above the brand-bar. Derives machine state via the shared moonrakerStatus 5-second poll (K2) or latest job (Laguna/Carvera). Surfaces StatusDot + state label (reuses DASHBOARD_STATUS_COLORS/LABELS from workshop-dashboard-helpers), machine ID in mono font, **E-stop button wired**: confirms via native dialog, then calls `window.fab.machine.estop({machineId})` — K2 POSTs to Moonraker `/printer/emergency_stop` (canonical Klipper M112 endpoint), Carvera + Laguna toast operator advisories pointing at physical e-stop (carvera-cli upstream lacks an abort verb; Laguna has no remote abort by design). The same file also exports `ShopBrandBar` (legacy Control Center header — kept in this file to honor the existing `shop-app-toolbar-button-types.test.ts` pin). The brand-bar Design pill (`.shop-brand-bar__design-pill`) lives in `ShopBrandBar` as a sibling to the env-switcher triad.
- `src/main/ipc-machine.ts` — `machine:estop` IPC dispatch with per-machine paths. KNOWN_MACHINE_IDS whitelist; `postMoonrakerEmergencyStop` with 3s AbortSignal.timeout for K2; structured no_cli_abort response for Carvera; no_remote_abort for Laguna. Every failure path includes an operator hint. Registered in `app.whenReady()` before `createWindow()`.
- `src/renderer/manufacture/ProfileStack.tsx` — **right-side ProfileStack** (FDM slicer pattern). Recommended/Pro display-mode toggle, 6 sub-rows (FilamentRow, QualityRow, TempsRow, ToolChipRow, StockRow, SetupSheetRow), sticky bottom Send button with machine-specific label ("Send to K2 Plus" / "Send to Carvera" / "Export for Laguna"). Wrapped by `ProfileStackPanel` in ManufactureAuxPanels; rendered in the workflow-stage Device/Send tabs of ManufactureWorkspace.
- `src/renderer/manufacture/ManufactureWorkspace.tsx` — workflow-stage tabs **swap per-stage body**: FDM Prepare/Preview/Device, CNC Setup/Toolpaths/Simulate/Send. Per-stage bodies extracted into named locals (`previewStageBody`, `deviceStageBody`, etc.); switch on `workflowStage` picks which renders. `LayerPreviewBody` + `ToolpathSimulationBody` use shared EmptyState.
- `src/renderer/manufacture/plate-thumbnail.ts` — pure helper renders Three.js Mesh/BufferGeometry to a 120x80 PNG dataURL via OffscreenCanvas + WebGLRenderer. FNV-1a-keyed cache. Null-return on node/vitest env (parent falls back to colored-rect placeholder).
- `src/renderer/design/selection-state.ts` + `selection-raycast.ts` — **CAD face selection** primitives. Pure framework-agnostic Selection union + helpers; raycast mapper triangleToFaceId/trianglesForFace operating on the parallel faceIds array. Consumed by Viewport3D (raycast → onSelect) and DesignWorkspace (selection state + ESC clear + status badge).
- `engines/cad/cadquery_script.py` `tessellate_with_face_ids` — per-face tessellation walks `solid.Faces()`, returns vertices/indices/faceIds parallel array + faceMap dict. Exposed via `cad.tessellate_with_ids` sidecar method. Best-effort fallback `_safe_face_hash` with multiple OCP-binding upper bounds.
- `src/renderer/design/DesignWorkspace.tsx` — **CAD Design workspace** (fullscreen overlay opened via `Ctrl+Shift+D`, brand-bar Design pill, command palette, or first-launch wizard). Composes `CadQueryEditor` (left), 3D viewport (center, reuses ShopApp's viewport), `FeatureTree` (right). The "Send to CAM" button exports STL, switches to the active machine env, and auto-imports the STL into the first plate. Toggled via `designOpen` state in `ShopApp.tsx`. Do NOT register Design as a 4th env in `environments/registry.ts` — the overlay model is intentional so CAM env state is preserved across CAD work.
- `src/renderer/manufacture/ManufactureWorkspace.tsx` — hosts the **workflow-stage tabs** (`WorkflowStageTabs`) above the existing sub-tab strip. Env-specific tab set: FDM (K2 Plus) shows Prepare / Preview / Device; CNC (Laguna / Carvera) shows Setup / Toolpaths / Simulate / Send. Active stage tracked in `workflowStage` state with a snap-back effect when machine type changes. Roving tabindex + arrow-key/Home/End navigation matching `ManufactureSubTabStrip`. CSS hooks: `.workflow-stage-tabs`, `.workflow-stage-tab`, `.workflow-stage-tab--active`. Panel-content swap per stage is a follow-up cycle — for now the existing panels render unchanged regardless of stage.
- `src/renderer/manufacture/ManufactureOperationList.tsx` — **setup-rooted operation tree** (Fusion / Mastercam pattern). Operations nest under their parent Setup as collapsible parent nodes with op-count badges. Each op row has a left-edge status icon (.op-tree-op-status with --stale/--error/--done/--running/--idle modifiers). Ops with no assigned setup go under a synthetic "(Unassigned)" group at the top. Setup-collapse state persists per-project. The existing filter bar + empty-state branches are preserved and operate on the tree.
- `src/renderer/manufacture/PlateTabs.tsx` — **multi-plate thumbnail strip** (Bambu Studio pattern). 120×80 thumbnail tiles per plate showing preview placeholder + name + status pill (idle/slicing/done/error). Top-right × close button. Dashed-border "+ Add plate" tile at the end. Horizontal scroll if needed. Adjacent split Slice button: primary "Slice this plate" + dropdown caret "Slice all plates".
- `src/preload/` — Electron preload (IPC bridge)
- `src/shared/` — Zod schemas, type definitions
- `src/shared/app-keyboard-shortcuts.ts` — single source of truth for keyboard shortcuts (1–6 for NavRail, F1 for Help, Ctrl+K palette, Ctrl+Shift+D for the Design workspace overlay, Ctrl+Shift+? for the shortcuts dialog). When wiring a new shortcut, add it here so the shortcuts dialog documents it.
- `src/shared/project-schema.ts` — Zod project schema. Includes `designModels: DesignModel[]` (optional with `.default([])` for backward compat). A project file can hold both CAD design models AND CAM jobs in one file.
- `src/shared/sidecar-protocol.ts` — wire types + `isSidecarResponse` guard (kept in sync with engines/sidecar/main.py)
- `engines/sidecar/` — Python sidecar (JSON-RPC over stdin/stdout): `main.py` request loop, `cad_handlers.py` (CadQuery — `import_step`, `tessellate`, `execute_script`, `export`, `list_operations`), `cam_handlers.py` (OpenCAMLib). The `execute_script` handler runs user CadQuery code via `cqgi.parse(script).build(...)` with a BANNED_TOKENS pre-scan (rejects `import os/sys/subprocess/socket/shutil`, `__import__`, `open(`, `eval(`, `exec(`, etc.) — security via static rejection, not sandboxing.
- `engines/cad/cadquery_script.py` — CadQuery script execution core (tessellation, handle registry, exporters). Imported by `cad_handlers.py`.
- `engines/cam/ocl_toolpath.py` — standalone OpenCAMLib runner (still used by `src/main/cam-runner.ts`; migrates into the sidecar later)
- `engines/mesh/`, `engines/occt/` — mesh + STEP I/O helpers (consolidating into CadQuery)
- `engines/requirements.txt` — CadQuery + OpenCAMLib + numpy + trimesh
- `resources/machines/` — Machine profiles (JSON) — Creality K2 Plus, Laguna Swift 5x10, Makera Carvera (3-axis + 4-axis). CLAUDE.md spec values are encoded here AND pinned by `src/main/machine-profile-spindle-pin.test.ts`.
- `resources/posts/` — Handlebars post-processor templates per controller/dialect
- `resources/materials/` — Material/feed-rate data
- `resources/orca-slicer/` — bundled OrcaSlicer CLI + .json profiles for K2 Plus FDM (machines/process/filament). Bundled via `pwsh ./scripts/bundle-orca-slicer.ps1`.
- `resources/samples/cad/` — starter CadQuery scripts shipped by the first-launch wizard: `bracket.cq.py` (Laguna/Carvera 3-axis), `sign.cq.py` (Laguna v-carve), `cylinder.cq.py` (Carvera 4-axis). Each is a valid `cqgi.parse(...)`-compatible script.
- `.claude/improvement-log.md` — Improvement cycle history (source of truth)
- `.claude/commands/improve.md` — Full improvement cycle playbook
- `.claude/skills/gcode-safety/` — G-code safety skill + per-machine reference files. Invoke whenever `engines/cam/`, `src/main/cam-*`, `resources/posts/**`, or `resources/machines/**` changes.
- `docs/EDIT-WORKFLOW.md` — Python-via-bash edit workflow + splice-recovery marker-uniqueness checklist ([ID-0089], [ID-0095])
- `docs/PRE-LAUNCH-READINESS.md` — operator's readiness checklist for real-world testing
