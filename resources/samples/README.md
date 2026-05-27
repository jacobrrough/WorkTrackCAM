# Sample bundles (per-machine starter assets)

The first-launch project wizard (`src/renderer/src/FirstLaunchWizard.tsx`,
Step 3) offers an optional "Sample STL for this machine" choice that
copies a small starter mesh into the new project's `assets/` folder and
pre-creates a matching starter operation.

## Convention

Each target machine has its own subdirectory keyed by **machine ID**:

```
resources/samples/
├── creality-k2-plus/
│   └── calibration-cube.stl     ← (planned) 20mm cube for K2 FDM
├── laguna-swift-5x10/
│   └── sign-board.stl           ← (planned) sample sign panel
├── makera-carvera-3axis/
│   └── small-part.stl           ← (planned) small 3-axis demo part
└── makera-carvera-4axis/
    └── rotary-part.stl          ← (planned) cylindrical 4-axis demo
```

The wizard reads the directory via the `samples:list` IPC handler
(`src/main/ipc-samples.ts`). When a machine has **no** sample bundle, the
"Sample STL" option is disabled in the wizard with the tooltip
"Sample bundle coming soon for this machine" — there is no hard failure.

## Adding a new sample

1. Drop a small (<1 MB) STL under the relevant `resources/samples/<machineId>/` directory.
2. Restart the dev server. The wizard re-enables the option automatically.
3. The starter operation kind is chosen by machine kind:
   - `fdm` → `fdm_slice` with K2 standard preset
   - `cnc` 2-axis (Laguna) → `cnc_contour`
   - `cnc` 3-axis (Carvera 3-axis) → `cnc_pocket`
   - `cnc` 4-axis (Carvera 4th-axis HD) → `cnc_4axis_indexed`

## Why this exists

Bundled samples let a new user click **Sample STL → Finish** and land in
a project that already has a model + an operation ready to slice or
generate G-code — i.e., the "3-clicks-from-launch" guarantee in
`docs/COMPETITIVE-GAP-ANALYSIS.md` gap #3.
