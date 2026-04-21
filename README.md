# WorkTrackCAM

**Professional CAM / FDM Slicer Desktop App**
CNC toolpath generation, 4-axis machining, heightfield strategies, FDM slicing, and full machine management. Built to rival Fusion 360 / Mastercam quality.

## Features
- Advanced CAM: 2D/2.5D/4-axis, waterline, adaptive raster, scallop, voxel removal (OCCT + OpenCAMLib)
- FDM slicing with Cura defaults + Moonraker push
- Real-time 3D viewport (Three.js / React Three Fiber)
- STL/DXF import, mesh placement, assembly kinematics
- Machine, tool, material, fixture, and post-processor library
- Safe G-code post-processing (dialect compliance, 4-axis, subroutines)
- Project files (`.wtcam`), auto-updates, cross-platform (Win/Linux/Mac)

## Quick Start
1. `git clone https://github.com/jacobrrough/WorkTrackCAM.git`
2. `cd WorkTrackCAM`
3. Install Node: `npm install`
4. Install Python engine: `pip install -r engines/requirements.txt` (Python ≥ 3.9)
5. `npm run dev` (development)
6. `npm run build` (production installer)

## Development
- `npm test` + `npm run typecheck` before every change (mandatory per CLAUDE.md)
- Full docs in `CLAUDE.md` for autonomous improvement cycles

## Tech
Electron • React 19 • TypeScript • Three.js • Python CAM engine • Zod • Vite • Vitest

**License**: MIT (see LICENSE)

Made with ❤️ by Jacob Rough
