# WorkTrackCAM

**Professional CAD + CAM + FDM Slicer Desktop App**
Parametric CAD modeling, CNC toolpath generation, 4-axis machining, heightfield strategies, FDM slicing, and full machine management — all in one Electron app for a one-shop workflow. Built to rival Fusion 360 / Mastercam quality.

## Features
- **Parametric CAD Design workspace** (`Ctrl+Shift+D` or brand-bar Design pill) with three views (**Part / Assembly / Drawing** tabs):
  - **Part view** — script-first paradigm powered by **CadQuery**: `cad.execute_script` / `cad.export` / `cad.list_operations` sidecar methods + **3D face selection** via `cad.tessellate_with_ids` (raycast in Viewport3D maps mesh hits back to CadQuery face entity IDs). Read-only feature tree with **editable parameters** (CQGI `buildParameters` re-runs the script on Apply). **Monaco code editor** for the CadQuery script (offline-bundled workers, SSR-safe fallback).
  - **2D Sketcher** (`MvpSketchCanvas`) with **planegcs constraint solver**: 5 entity types (point/line/circle/arc/rectangle) + 5 constraint types (horizontal/vertical/coincident/distance/radius). Auto-solve on edit; structured solver-error banner for over/under-constrained sketches.
  - **Assembly view** — multi-part assemblies via `cq.Assembly` with per-child 4×4 transforms; STEP-hierarchy-preserving + STL-flattened exports.
  - **Drawing view** — 2D projection views (Front / Top / Right / Iso) via OCCT hidden-line-removal; SVG inline render + Export PDF/SVG.
  - One-click "Send to CAM" handoff that exports STL and loads it into the active machine's CAM workspace.
- **Pro-app chrome**: locked-top global status strip with **live machine state + ID + E-stop button** (Mainsail/Fluidd pattern; K2 routes to Moonraker's `/printer/emergency_stop` for firmware M112, Carvera advises physical e-stop, Laguna advises pendant); workflow-stage tabs above the viewport with **per-stage content swap** (Prepare/Preview/Device for FDM, Setup/Toolpaths/Simulate/Send for CNC, Bambu/Orca/Fusion pattern); **right-side ProfileStack** with Recommended/Pro modes + machine-specific Send button (FDM slicer pattern); setup-rooted operation tree with per-op status icons (Fusion/Mastercam pattern); multi-plate thumbnail strip with **real 3D-preview thumbnails** + status pills + split Slice button (Bambu Studio pattern).
- Advanced CAM: 2D / 2.5D / 4-axis, waterline, adaptive raster, scallop, voxel removal (**CadQuery + OpenCAMLib** Python sidecar)
- FDM slicing via **bundled OrcaSlicer** 2.3.2+ with K2 Plus presets + Moonraker direct push
- Carvera 3-axis + 4-axis rotary toolpaths with chuck/tailstock collision sweep
- Real-time 3D viewport (Three.js / React Three Fiber)
- STL / DXF import, mesh placement, assembly kinematics
- Machine, tool, material, fixture, and post-processor library (My-Shop-Only: K2 Plus / Laguna Swift 5x10 / Makera Carvera)
- Safe G-code post-processing (dialect compliance, 4-axis, subroutines) — validated by the `gcode-safety` skill before every release
- Workshop dashboard with per-machine live status (Moonraker poll for K2, job-derived for Laguna/Carvera)
- First-launch project wizard ships **4 starter options**: 3 machine envs + "Start a parametric design" (with one CadQuery sample per machine: bracket / sign / cylinder)
- Shared `EmptyState` component for consistent "nothing here yet" surfaces
- NavRail keyboard shortcuts (1–6 jump to sections, F1 opens Help, Ctrl+Shift+D opens Design)
- Project files (`.wtcam`) now hold both CAD design models AND CAM jobs in one file — single source of truth for the whole design→manufacture flow
- Auto-updates, cross-platform (Win / Linux / Mac)

## Quick Start
0. Install OrcaSlicer 2.3.2+ and bundle: `pwsh ./scripts/bundle-orca-slicer.ps1`
1. `git clone https://github.com/jacobrrough/WorkTrackCAM.git`
2. `cd WorkTrackCAM`
3. Install Node: `npm install`
4. Install Python engine: `pip install -r engines/requirements.txt` (Python ≥ 3.9)
5. `npm run dev` (development)
6. `npm run build` (production installer)

## Next Steps
- **Real-world testing checklist** → [`docs/PRE-LAUNCH-READINESS.md`](docs/PRE-LAUNCH-READINESS.md) — per-machine first-run procedures, known limitations, confidence summary
- K2 Plus Moonraker push smoke test → [`docs/SMOKE-K2-MOONRAKER.md`](docs/SMOKE-K2-MOONRAKER.md)
- Laguna Swift RichAuto upload smoke test → [`docs/SMOKE-LAGUNA-RICHAUTO.md`](docs/SMOKE-LAGUNA-RICHAUTO.md)
- Carvera CLI upload smoke test → [`docs/SMOKE-CARVERA-CLI.md`](docs/SMOKE-CARVERA-CLI.md)
- Machine profiles & safety reference → [`docs/MACHINES.md`](docs/MACHINES.md)
- 4th-axis CAM reference (incl. physical setup) → [`docs/CAM_4TH_AXIS_REFERENCE.md`](docs/CAM_4TH_AXIS_REFERENCE.md)

## User Progression (one-shop workflow)

```
First launch → wizard offers 4 options:
   ┌─ Pick a machine (VCarve Pro / Creality Print / Makera CAM)
   │     └─ Project opens in that machine's CAM env, ready to import STL
   │
   └─ Start a parametric design + pick a target machine
         └─ Project opens in the Design workspace with a starter CadQuery
            script (bracket / sign / cylinder, picked per machine)
            ├─ Edit script → Run → 3D result + feature tree
            └─ Send to CAM → STL exported + machine env activated +
               STL auto-loaded into the first plate → generate G-code →
               send to machine
```

The .wtcam project file holds both the CAD designs and the CAM jobs, so you can revisit the design later, tweak it, re-export, and re-machine in one app.

## Keyboard Shortcuts
- **1 – 6** → jump to NavRail sections (Jobs / Tools / Workshop / My Shop / Library / Settings)
- **F1** → open / close the Help panel
- **Ctrl+K** → open the command palette
- **Ctrl+Shift+D** → open / close the CAD Design workspace (overlay)
- **Ctrl+Enter** / **Cmd+Enter** (in Design workspace) → Run the active CadQuery script
- **Click face in 3D viewport** (in Design workspace) → select that CadQuery face; Esc clears
- **Ctrl+Shift+?** → open the keyboard-shortcuts dialog (lists everything)
- **Escape** → close the active modal (Design workspace, FirstLaunchWizard, ConfirmDialogs, drawers) or clear CAD selection

## Development
- `npm test` + `npm run typecheck` before every change (mandatory per CLAUDE.md)
- `npm run test:python` runs the Python sidecar pytest suite (30 sidecar cases at last count). Re-wired 2026-06-01 after being lost in the pivot.
- IPC handlers MUST be registered before `createWindow()` runs — see the comment block in `src/main/index.ts`. Adding a new handler? Put its `register*Ipc` call inside the `app.whenReady()` callback before `createWindow()`.
- Use `EmptyState` (`src/renderer/src/EmptyState.tsx`) for any panel that can render with no data — consistent visual treatment across the app
- Use `AppHeader` (`src/renderer/src/AppHeader.tsx`) for the locked-top global status strip — it derives machine state from the Moonraker poll (K2) or latest job (Laguna/Carvera) and surfaces an E-stop slot
- The Design workspace lives at `src/renderer/design/DesignWorkspace.tsx`; CAD sidecar methods are in `engines/sidecar/cad_handlers.py`; CadQuery script execution core is in `engines/cad/cadquery_script.py`
- Workflow-stage tabs (`WorkflowStageTabs`) live inline in `src/renderer/manufacture/ManufactureWorkspace.tsx` — adopts the Bambu/Orca/Fusion segmented-control pattern
- Setup-rooted operation tree lives in `src/renderer/manufacture/ManufactureOperationList.tsx` — operations nest under their parent Setup with per-op status icons
- Multi-plate thumbnail strip lives in `src/renderer/manufacture/PlateTabs.tsx` — replaces the old text-tab row with 120×80 thumbnail tiles + split Slice button
- Large-file edits (>800 lines or any `.claude/` log file) follow [`docs/EDIT-WORKFLOW.md`](docs/EDIT-WORKFLOW.md) — bypass the Edit tool, use Python-via-bash
- Full docs in `CLAUDE.md` for autonomous improvement cycles

## Tech
Electron • React 19 • TypeScript • Three.js • Python sidecar (CadQuery for CAD + OpenCAMLib for CAM) • OrcaSlicer • Zod • Vite • **Vitest 4** • pytest

**License**: MIT (see LICENSE)

Made with ❤️ by Jacob Rough
