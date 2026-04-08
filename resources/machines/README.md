# Bundled machine profiles (`resources/machines/`)

JSON files loaded at runtime by [`src/main/machines.ts`](../../src/main/machines.ts) and validated with [`src/shared/machine-schema.ts`](../../src/shared/machine-schema.ts). **Every numeric field in the schema is millimeters or mm/min** (`workAreaMm`, `maxFeedMmMin`) — there is no separate inch field; duplicate a profile and edit values if you think in inches (multiply by 25.4).

WorkTrackCAM ships **four** production machine profiles, one per supported environment:

| `id` | Display name | Environment | `kind` | `postTemplate` | `dialect` |
|------|----------------|---------------|--------|----------------|-----------|
| `laguna-swift-5x10` | Laguna Swift 5×10 | **VCarve Pro** | `cnc` | `vcarve_mach3.hbs` | `mach3` |
| `creality-k2-plus` | Creality K2 Plus | **Creality Print** | `fdm` | `fdm_passthrough.hbs` | `generic_mm` |
| `makera-carvera-3axis` | Makera Carvera (3-Axis) | **Makera CAM** (3-axis mode) | `cnc` | `carvera_3axis.hbs` | `grbl` |
| `makera-carvera-4axis` | Makera Carvera (4th Axis HD) | **Makera CAM** (4-axis mode) | `cnc` | `carvera_4axis.hbs` | `grbl_4axis` |

Each environment is the user-facing concept; the underlying machine profile encodes the work envelope, spindle range, axis count, and post template. See [`src/renderer/src/environments/`](../../src/renderer/src/environments/) for environment definitions.

## Why these four?

These are the machines the project owner runs daily. Generic placeholder profiles (`generic-3axis`, `generic-4axis-*`, `generic-5axis-*`, `benchtop-*`) were removed in favor of focused, real-machine support. The post-processor library under [`../posts/`](../posts/) still includes the generic 4-axis and 5-axis Handlebars templates for users who import their own machines via the Library drawer or via CPS files.

## Adding a custom profile

Custom machines are stored in `{userData}/machines/` and override bundled profiles by `id`. Use the **Library** drawer in-app, or copy this skeleton into a new `.json`:

1. Set a unique **`id`** (used by `project.json` → `activeMachineId`).
2. Point **`postTemplate`** at a filename under [`../posts/`](../posts/); add a new `.hbs` in the same change if needed.
3. Choose **`dialect`** from `grbl` | `grbl_4axis` | `mach3` | `mach3_4axis` | `fanuc` | `fanuc_4axis` | `siemens` | `siemens_4axis` | `heidenhain` | `heidenhain_4axis` | `linuxcnc_4axis` | `generic_mm` — affects default spindle snippets and units line in the post (see [`src/main/post-process.ts`](../../src/main/post-process.ts)).
4. Keep **`meta.model`** honest: stubs are not collision-checked or feed-verified.

## Safety

Output G-code is **unverified** until you validate it against your control. See **[`docs/MACHINES.md`](../../docs/MACHINES.md)**.
