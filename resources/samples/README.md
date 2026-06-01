# Sample bundles (per-machine starter assets)

The first-launch project wizard (`src/renderer/src/FirstLaunchWizard.tsx`,
Step 3) offers an optional "Sample STL for this machine" choice that
copies a small starter mesh (or DXF) into the new project's `assets/`
folder and pre-creates a matching starter operation.

## Files shipped today

| Machine ID                | File                              | Format        | Geometry                                                    |
|---------------------------|-----------------------------------|---------------|-------------------------------------------------------------|
| `creality-k2-plus`        | `calibration-cube-20mm.stl`       | Binary STL    | 20 mm solid calibration cube, centered on X/Y, Z=0 at bottom (12 tris) |
| `laguna-swift-5x10`       | `sign-board-sample.dxf`           | DXF R12 ASCII | 200 x 100 mm sign-board plaque with one 12 mm round mounting hole and one 60 x 30 mm rounded-rect cutout |
| `makera-carvera-3axis`    | `carvera-pocket-sample.stl`       | Binary STL    | 50 x 40 x 10 mm rectangular block with a 20 x 15 x 5 mm centered top-face pocket (closed 2-manifold, 68 tris) |
| `makera-carvera-4axis`    | `carvera-rotary-pen-sample.stl`   | Binary STL    | Cylindrical pen blank, 20 mm dia x 80 mm long, axis along +X (chuck at X=0), 16-facet tessellation (64 tris) |

All four files are **authored from scratch by procedural scripts under
`scripts/sample-stl-gen/`** -- no third-party geometry, no Thingiverse /
GrabCAD / MakerWorld assets. Anyone can re-run the generators with:

```bash
node scripts/sample-stl-gen/generate-all.js
```

Each generator script documents the geometry's origin in a header
comment and lays the file out as a closed 2-manifold (STLs) or a clean
LINE+ARC+CIRCLE+POLYLINE entity set (DXF) so slicers, OpenCAMLib, and
the Laguna router's DXF importer accept them without preprocessing.

## Convention

Each target machine has its own subdirectory keyed by **machine ID** as
declared in `src/shared/first-launch-wizard-contract.ts`. A separate
`cad/` subdirectory holds the parametric-design starters used by the
wizard's 4th starter option ("Start a parametric design"):

```
resources/samples/
├── creality-k2-plus/
│   └── calibration-cube-20mm.stl       <- K2 Plus FDM starter
├── laguna-swift-5x10/
│   └── sign-board-sample.dxf           <- Laguna 2D contour starter
├── makera-carvera-3axis/
│   └── carvera-pocket-sample.stl       <- Carvera 3-axis pocket starter
├── makera-carvera-4axis/
│   └── carvera-rotary-pen-sample.stl   <- Carvera 4-axis rotary starter
└── cad/                                <- parametric CadQuery starters
    ├── bracket.cq.py                   <- L-bracket (K2 / Carvera 3-axis)
    ├── sign.cq.py                      <- Engraved sign-board (Laguna)
    └── cylinder.cq.py                  <- Helical-groove cylinder (Carvera 4-axis)
```

The wizard reads the directory via the `samples:list` IPC handler
(`src/main/ipc-core.ts`). When a machine has **no** sample bundle, the
"Sample STL" option is disabled in the wizard with the tooltip
"Sample bundle coming soon for this machine" -- there is no hard failure.

## Adding a new sample

1. Add (or modify) a generator script under `scripts/sample-stl-gen/`.
2. Update `WIZARD_MACHINE_TO_SAMPLE_FILE` in
   `src/shared/first-launch-wizard-contract.ts` if you're changing the
   expected filename.
3. Re-run `node scripts/sample-stl-gen/generate-all.js`.
4. Restart the dev server. The wizard re-enables the option automatically.

The starter operation kind is chosen by `wizardStarterOpKind()` in
`FirstLaunchWizard.tsx` (mirrored from CLAUDE.md My-Shop-Only mode):

| Machine                       | Op kind seeded         |
|-------------------------------|------------------------|
| `creality-k2-plus`            | `fdm_slice`            |
| `laguna-swift-5x10`           | `cnc_contour`          |
| `makera-carvera-3axis`        | `cnc_pocket`           |
| `makera-carvera-4axis`        | `cnc_4axis_indexed`    |

## CadQuery starters (`cad/`)

The first-launch wizard's 4th starter option ("Start a parametric
design") loads one of three bundled CadQuery scripts based on the
machine the user picked. The mapping lives in
`WIZARD_MACHINE_TO_CAD_SAMPLE` (same contract module as the STL
samples) and the script text is read at wizard-finish time via the
`wizard:readCadSample` IPC. The script is then spliced into the new
project's `designModels[]` array so re-opening the project shows the
same parametric model in the Design workspace.

| Machine                       | CadQuery file        | Geometry                                              |
|-------------------------------|----------------------|-------------------------------------------------------|
| `creality-k2-plus`            | `bracket.cq.py`      | Parametric L-bracket (rect + extrude + holes + fillets) |
| `laguna-swift-5x10`           | `sign.cq.py`         | 200 x 100 mm engraved sign-board                       |
| `makera-carvera-3axis`        | `bracket.cq.py`      | Same L-bracket -- precision desktop milling starter    |
| `makera-carvera-4axis`        | `cylinder.cq.py`     | 30 mm OD x 80 mm cylinder + helical groove (rotary)    |

These scripts use only `cadquery as cq` + the safe-builtins exposed to
`engines/cad/cadquery_script.py`'s sandboxed exec (`math`, `range`,
`len`, etc.), so they execute inside the bundled sidecar without any
out-of-band imports.

## Why this exists

Bundled samples let a new user click **Sample STL -> Finish** and land in
a project that already has a model + an operation ready to slice or
generate G-code -- i.e., the "3-clicks-from-launch" guarantee in
`docs/COMPETITIVE-GAP-ANALYSIS.md` gap #3. The CadQuery starters give
the same guarantee for the new parametric Design workspace: click
**Start a parametric design -> Finish** and you land in the Design
workspace with a real editable body.
