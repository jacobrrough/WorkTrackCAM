# CAM engines (Python)

WorkTrack3D's CAM backend runs as a Python sidecar bundled with the
standalone Electron app. The stack is:

- **CadQuery** (Apache 2) — parametric B-rep modeling on OpenCascade.
- **OpenCAMLib** (LGPL) — drop-cutter / push-cutter / waterline toolpath
  generation.
- **trimesh / numpy** — mesh I/O and array math.

See `engines/requirements.txt` for the installable dependency set.

## `ocl_toolpath.py`

Uses **OpenCAMLib** (`import ocl`) for:

| `strategy` (config)   | Behavior |
|-----------------------|----------|
| `waterline`           | Z-level waterline loops |
| `adaptive_waterline`  | Adaptive waterline when the installed OCL build exposes it; otherwise plain waterline |
| `raster`              | XY zigzag via **PathDropCutter** |

The Electron main process writes a JSON config (STL path, strategy, Z step,
stepover/sampling, feeds, tool diameter, output JSON path). See the module
docstring in `ocl_toolpath.py` for the full key list.

- **Install:** `pip install -r engines/requirements.txt`
- **Windows:** use a venv aligned with the OCL wheel range
  (CPython 3.9–3.11), e.g. `py -3.11 -m venv .venv` then
  `.venv\Scripts\pip install -r engines/requirements.txt`.
- **STL checks:** Zero-byte files are rejected with **`stl_read_error`**
  before OpenCAMLib loads (same exit code as unreadable meshes).
- **Safety:** Lines are still run through the machine **Handlebars** post
  (`resources/posts/`). Output remains **unverified** until the operator
  checks post, units, and clearances (`docs/MACHINES.md`).

### Exit codes and stdout (last line = JSON)

| `error` (or success) | Exit | Meaning |
|----------------------|------|---------|
| *(success)* | 0 | `{"ok": true, "lines": N, "strategy": "..."}` |
| `opencamlib_not_installed` | 1 | `import ocl` failed |
| `usage`, `config_*`, `invalid_strategy`, `invalid_numeric_params`, `stl_missing` | 2 | Bad argv, config, strategy, numbers, or missing STL path |
| `stl_read_error` | 3 | STL on disk but OpenCAMLib `STLReader` failed (corrupt or unsupported) |
| `ocl_runtime_error` | 3 | OCL failed after the mesh loaded (toolpath computation) |
| `ocl_empty_toolpath` | 4 | OCL ran but produced no segments |

Numeric rules: `toolDiameterMm`, `feedMmMin`, `plungeMmMin`, and
`stepoverMm` must be **finite and strictly positive**. For waterline
strategies, `zPassMm` must also be **strictly positive**. `safeZMm` must
be **finite** (can be negative in unusual job coordinates).

## Local smoke (no STL binary in repo)

From app root:

```bash
python engines/cam/smoke_ocl_toolpath.py
```

Exercises config/JSON error paths and `invalid_numeric_params` using a
generated minimal ASCII STL — **does not** require OpenCAMLib.
