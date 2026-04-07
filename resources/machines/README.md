# Bundled machine profiles (`resources/machines/`)

JSON files loaded at runtime by [`src/main/machines.ts`](../../src/main/machines.ts) and validated with [`src/shared/machine-schema.ts`](../../src/shared/machine-schema.ts). **Every numeric field in the schema is millimeters or mm/min** (`workAreaMm`, `maxFeedMmMin`) — there is no separate inch field; duplicate a profile and edit values if you think in inches (multiply by 25.4).

| `id` | Display name | `kind` | `postTemplate` | `dialect` | Notes |
|------|----------------|--------|----------------|-----------|--------|
| `benchtop-grbl-300` | Benchtop router (Grbl ~300 mm) | `cnc` | `cnc_generic_mm.hbs` | `grbl` | Small router envelope; verify real travel and Grbl M-codes. |
| `benchtop-mach3-350` | Benchtop router (Mach3 ~350 mm) | `cnc` | `cnc_generic_mm.hbs` | `mach3` | Stub for Mach-class benchtop; verify travel, feeds, and spindle/coolant M-codes in your manual. |
| `creality-k2-plus` | Creality K2 Plus | `fdm` | `cnc_generic_mm.hbs` | `generic_mm` | FDM; pair with [`../slicer/`](../slicer/) defs + Cura path in Settings. |
| `generic-3axis` | Generic 3-axis (mm) | `cnc` | `cnc_generic_mm.hbs` | `generic_mm` | Placeholder envelope — replace before relying on limits. |
| `laguna-swift-5x10` | Laguna Swift 5×10 | `cnc` | `cnc_generic_mm.hbs` | `mach3` | Large-format; controller family varies — match dialect to your manual. |
| `makera-desktop` | Makera Desktop CNC | `cnc` | `cnc_generic_mm.hbs` | `grbl` | Align feeds with OEM / Makera CAM specs. |

## Adding a profile

1. Copy an existing `*.json`, set a new unique **`id`** (used by `project.json` → `activeMachineId`).
2. Point **`postTemplate`** at a filename under **`resources/posts/`** (see [`../posts/README.md`](../posts/README.md)); add a new `.hbs` in the same change if needed.
3. Choose **`dialect`**: `grbl` | `mach3` | `generic_mm` — affects default spindle snippets and units line in the post (see [`src/main/post-process.ts`](../../src/main/post-process.ts)).
4. Keep **`meta.model`** honest: stubs are not collision-checked or feed-verified.

## Safety

Output G-code is **unverified** until you validate it against your control. See **[`docs/MACHINES.md`](../../docs/MACHINES.md)**.
