# CAM engines (Python, optional)

## `ocl_toolpath.py`

Uses **OpenCAMLib** (`import ocl`) for:

| `strategy` (config)   | Behavior |
|-----------------------|----------|
| `waterline`           | Z-level waterline loops |
| `adaptive_waterline`  | Adaptive waterline when the installed OCL build exposes it; otherwise plain waterline |
| `raster`              | XY zigzag via **PathDropCutter** |

The Electron main process writes a JSON config (STL path, strategy, Z step, stepover/sampling, feeds, tool diameter, output JSON path). See the module docstring in `ocl_toolpath.py` for the full key list.

- **Install:** `pip install opencamlib` (wheels are commonly available for **CPython 3.7–3.11**; newer Python may need a local build).
- **Windows:** use a venv aligned with that range, e.g. `py -3.10 -m venv .venv` then `.venv\Scripts\pip install opencamlib`.
- **STL checks:** Zero-byte files are rejected with **`stl_read_error`** before OpenCAMLib loads (same exit code as unreadable meshes).
- **Fallback:** If `opencamlib` is missing, import fails, STL read fails, or no toolpath is produced, **`cam:run`** uses TypeScript fallbacks (parallel finish and/or mesh raster — see `src/main/cam-runner.ts`).
- **`cnc_pencil`:** Uses the same **`raster`** strategy in this script; the main process passes a **tighter `stepoverMm`** (`resolvePencilStepoverMm` in `src/shared/cam-cut-params.ts`) than a standard `cnc_raster` job.
- **Fallback diagnostics:** successful `cam:run` responses include engine outcome metadata (`requestedEngine`, `usedEngine`, `fallbackApplied`, normalized `fallbackReason`) so renderer copy can clearly explain OCL vs built-in behavior.
- **Safety:** Lines are still run through the machine **Handlebars** post (`resources/posts/`). Output remains **unverified** until the operator checks post, units, and clearances (`docs/MACHINES.md`).
- **Renderer:** After a successful **`cam:run`**, **Utilities → CAM** can show optional **Last run** copy plus **Preview G-code analysis** (text-only motion/bounds stats — not stock removal or machine kinematics). See `src/shared/cam-simulation-preview.ts`.

### Exit codes and stdout (last line = JSON)

| `error` (or success) | Exit | Meaning |
|----------------------|------|---------|
| *(success)* | 0 | `{"ok": true, "lines": N, "strategy": "..."}` |
| `opencamlib_not_installed` | 1 | `import ocl` failed |
| `usage`, `config_*`, `invalid_strategy`, `invalid_numeric_params`, `stl_missing` | 2 | Bad argv, config, strategy, numbers, or missing STL path |
| `stl_read_error` | 3 | STL on disk but OpenCAMLib `STLReader` failed (corrupt or unsupported) |
| `ocl_runtime_error` | 3 | OCL failed after the mesh loaded (toolpath computation) |
| `ocl_empty_toolpath` | 4 | OCL ran but produced no segments |

Numeric rules: `toolDiameterMm`, `feedMmMin`, `plungeMmMin`, and `stepoverMm` must be **finite and strictly positive**. For waterline strategies, `zPassMm` must also be **strictly positive**. `safeZMm` must be **finite** (can be negative in unusual job coordinates).

## Local smoke (no STL binary in repo)

From app root:

```bash
python engines/cam/smoke_ocl_toolpath.py
```

Exercises config/JSON error paths, `config_not_utf8`, and `invalid_numeric_params` (including zero/negative tool diameter, stepover, plunge, feed; non-finite values including NaN/Infinity; bad waterline `zPassMm`) using a generated minimal ASCII STL — **does not** require OpenCAMLib.

## Advanced engine (`engines/cam/advanced/`)

Invoked via `python -m engines.cam.advanced <config.json>`. Supports strategies beyond the basic OCL set:

| Strategy | Description |
|---|---|
| `adaptive_clear` | Adaptive roughing with engagement-angle control |
| `waterline` | Z-level waterline (extended stock/machine params) |
| `raster` | XY raster with stock bounds awareness |
| `pencil` | Rest-machining pencil finishing |
| `spiral_finish` | Spiral-path surface finish |
| `morphing_finish` | Morphing-offset surface finish |
| `trochoidal_hsm` | Trochoidal high-speed milling |
| `steep_shallow` | Combined steep/shallow finishing |
| `scallop` | Scallop-height-controlled finish |

Config extends the OCL fields with stock bounds (`stockXMin/Max`, `stockYMin/Max`, `stockZMin/Max`), machine limits (`xTravelMm`, `yTravelMm`, `zTravelMm`, `maxFeedMmMin`, `maxSpindleRpm`), and adaptive tuning (`maxEngagementDeg`, `retractZMm`, `stockAllowanceMm`). Output JSON uses the same `{ok, toolpathLines, strategy}` shape.

## Toolpath engine (`engines/cam/toolpath_engine/`)

Invoked via `python -m engines.cam.toolpath_engine <config.json>`. The newest engine with full tool geometry (`toolShape`, `cornerRadiusMm`, `fluteLengthMm`, `fluteCount`, `holderDiameterMm`), adaptive feed, material awareness, and 4/5-axis capability flags. Timeout is 120 s (vs 60 s for OCL/advanced). Output adds optional `warnings` and `stats` fields alongside `{ok, toolpathLines, strategy}`.

## Legacy

`parallel_finish.py` was removed; all OCL entry is through `ocl_toolpath.py`.
