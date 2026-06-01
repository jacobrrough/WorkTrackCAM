# WorkTrackCAM

**Professional CAM / FDM Slicer Desktop App**
CNC toolpath generation, 4-axis machining, heightfield strategies, FDM slicing, and full machine management. Built to rival Fusion 360 / Mastercam quality.

## Features
- Advanced CAM: 2D / 2.5D / 4-axis, waterline, adaptive raster, scallop, voxel removal (**CadQuery + OpenCAMLib** Python sidecar)
- FDM slicing via **bundled OrcaSlicer** 2.3.2+ with K2 Plus presets + Moonraker direct push
- Carvera 3-axis + 4-axis rotary toolpaths with chuck/tailstock collision sweep
- Real-time 3D viewport (Three.js / React Three Fiber)
- STL / DXF import, mesh placement, assembly kinematics
- Machine, tool, material, fixture, and post-processor library (My-Shop-Only: K2 Plus / Laguna Swift 5x10 / Makera Carvera)
- Safe G-code post-processing (dialect compliance, 4-axis, subroutines) — validated by the `gcode-safety` skill before every release
- Workshop dashboard with per-machine live status (Moonraker poll for K2, job-derived for Laguna/Carvera)
- First-launch project wizard ships starter samples for each of the three target machines
- Shared `EmptyState` component for consistent "nothing here yet" surfaces
- NavRail keyboard shortcuts (1–6 jump to sections, F1 opens Help)
- Project files (`.wtcam`), auto-updates, cross-platform (Win / Linux / Mac)

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

## Keyboard Shortcuts
- **1 – 6** → jump to NavRail sections (Jobs / Tools / Workshop / My Shop / Library / Settings)
- **F1** → open / close the Help panel
- **Ctrl+K** → open the command palette
- **Ctrl+Shift+?** → open the keyboard-shortcuts dialog (lists everything)
- **Escape** → close the active modal (FirstLaunchWizard, ConfirmDialogs, drawers)

## Development
- `npm test` + `npm run typecheck` before every change (mandatory per CLAUDE.md)
- IPC handlers MUST be registered before `createWindow()` runs — see the comment block in `src/main/index.ts`. Adding a new handler? Put its `register*Ipc` call inside the `app.whenReady()` callback before `createWindow()`.
- Use `EmptyState` (`src/renderer/src/EmptyState.tsx`) for any panel that can render with no data — consistent visual treatment across the app
- Large-file edits (>800 lines or any `.claude/` log file) follow [`docs/EDIT-WORKFLOW.md`](docs/EDIT-WORKFLOW.md) — bypass the Edit tool, use Python-via-bash
- Full docs in `CLAUDE.md` for autonomous improvement cycles

## Tech
Electron • React 19 • TypeScript • Three.js • Python sidecar (CadQuery + OpenCAMLib) • OrcaSlicer • Zod • Vite • Vitest

**License**: MIT (see LICENSE)

Made with ❤️ by Jacob Rough
