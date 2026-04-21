# Mesh and CAM engine evaluation (Phase C)

This document is the roadmap for **measuring** and **optionally replacing** WorkTrackCAM’s mesh and toolpath stack. It does not commit the product to any vendor or license.

## Goals

- **Correctness**: valid watertight meshes where possible, consistent units, predictable orientation, stable behavior on large files.
- **CAM quality**: stock awareness, reasonable engagement, performance on large triangle counts, clear failure modes (no silent garbage G-code).
- **Operations**: offline-capable, reproducible Python environments, acceptable CI time, packaging that keeps `engines/` on disk where subprocesses can read it (`extraResources` in production).
- **Safety**: all candidates still feed **Handlebars posts** and machine profiles; output remains **unverified** until the operator validates post, units, and clearances (see `docs/MACHINES.md` when present).

## Current stack (baseline)

| Layer | Role | Location |
|--------|------|----------|
| Mesh → STL (formats) | trimesh | `engines/mesh/mesh_to_stl.py` |
| STEP/IGES → STL | CadQuery / OCP | `engines/occt/step_to_stl.py` |
| Toolpath v4 | Pure Python + numpy | `engines/cam/toolpath_engine` |
| Toolpath advanced | Python strategies | `engines/cam/advanced` |
| OpenCAMLib | Optional acceleration | `engines/cam/ocl_toolpath.py` |
| Fallbacks | TS height-field / parallel finish | `src/main/cam-runner.ts` |

## Evaluation dimensions (score 1–5 per candidate)

1. **Geometry**: import success rate on a fixed corpus (STEP, OBJ, GLB, corrupt files).
2. **CAM**: path quality vs baseline on the same STL + machine (visual + metric: bounds, length, point count).
3. **Performance**: wall time and memory on 100k / 1M triangle meshes.
4. **Packaging**: can the engine run from an installed Electron app without extra user steps?
5. **Licensing**: compatible with product distribution model.
6. **Maintainability**: team can debug and patch in-house.

## Candidate buckets (not mutually exclusive)

| Area | Augment | Possible upgrade |
|------|---------|------------------|
| Tessellation / B-rep | CadQuery/OCP | Tighter tolerances; optional remesh (e.g. mmg, gmsh) behind flags |
| Mesh I/O | trimesh | Assimp-backed path for problematic FBX/DAE; explicit unit tests per format |
| 3-axis rough/finish | Internal + OCL | Prefer OCL where stable; keep TS fallbacks with loud hints |
| “Fusion-grade” full kernel | N/A short term | Export to external CAM or integrate a licensed API — separate product decision |

## Pilot process (kill criteria)

1. Pick **one** mesh format and **one** CAM strategy.
2. Implement a **feature flag** or side-by-side script, not a wholesale swap.
3. Run golden tests (fixtures in repo) + manual air-cut checklist.
4. **Rollback** if scores are below baseline on geometry or safety metrics.

## References in repo

- Python deps surface: `engines/cam/toolpath_engine/check_deps.py`, `src/main/python-dep-check.ts`
- Engine layout checks: `src/main/paths.ts` (`getEnginesBundleDiagnostics`)
- CAM orchestration: `src/main/cam-runner.ts`
