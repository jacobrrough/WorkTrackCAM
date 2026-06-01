# WorkTrackCAM

**Professional CAD + CAM + FDM Slicer Desktop App**
Parametric CAD modeling, CNC toolpath generation, 4-axis machining, heightfield strategies, FDM slicing, and full machine management — all in one Electron app for a one-shop workflow. Built to rival Fusion 360 / Mastercam quality.

## Features
- **Parametric CAD Design workspace** (`Ctrl+Shift+D`) — script-first paradigm powered by **CadQuery** (`cad.execute_script` / `cad.export` / `cad.list_operations` sidecar methods). Read-only feature tree, 3D viewport, one-click "Send to CAM" handoff that exports STL and loads it into the active machine's CAM workspace.
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
- **Ctrl+Shift+?** → open the keyboard-shortcuts dialog (lists everything)
- **Escape** → close the active modal (Design workspace, FirstLaunchWizard, ConfirmDialogs, drawers)

## Development
- `npm test` + `npm run typecheck` before every change (mandatory per CLAUDE.md)
- IPC handlers MUST be registered before `createWindow()` runs — see the comment block in `src/main/index.ts`. Adding a new handler? Put its `register*Ipc` call inside the `app.whenReady()` callback before `createWindow()`.
- Use `EmptyState` (`src/renderer/src/EmptyState.tsx`) for any panel that can render with no data — consistent visual treatment across the app
- The Design workspace lives at `src/renderer/design/DesignWorkspace.tsx`; CAD sidecar methods are in `engines/sidecar/cad_handlers.py`; CadQuery script execution core is in `engines/cad/cadquery_script.py`
- Large-file edits (>800 lines or any `.claude/` log file) follow [`docs/EDIT-WORKFLOW.md`](docs/EDIT-WORKFLOW.md) — bypass the Edit tool, use Python-via-bash
- Full docs in `CLAUDE.md` for autonomous improvement cycles

## Tech
Electron • React 19 • TypeScript • Three.js • Python sidecar (CadQuery for CAD + OpenCAMLib for CAM) • OrcaSlicer • Zod • Vite • Vitest

**License**: MIT (see LICENSE)

Made with ❤️ by Jacob Rough
