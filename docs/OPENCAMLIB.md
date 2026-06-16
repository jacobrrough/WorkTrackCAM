# OpenCAMLib — TRUE 3D toolpaths for the CAM engine

WorkTrack3D's CAM backend can generate real **OpenCAMLib** (OCL) 3D toolpaths —
Waterline, AdaptiveWaterline, and PathDropCutter (drop-cutter raster / surface
scan) — via the Python sidecar (`engines/cam/ocl_toolpath.py` +
`engines/cam/ocl_strategies.py`). The strategy code is already in the repo; it
only needs the `opencamlib` package importable by the interpreter the app's
`settings.pythonPath` points at.

> **Status:** OpenCAMLib is an **optional** dependency. When it is absent, every
> 3D operation (`cnc_waterline` / `cnc_adaptive` / `cnc_raster` / `cnc_pencil` /
> `cnc_3d_finish`) silently falls back to the built-in mesh-height raster
> (`buildBuiltinFallbackLines` in `src/main/cam-runner.ts`). Installing OCL is
> what turns on the real drop-cutter / waterline numerics.

This doc records the exact wheel availability (verified empirically), the two
real incompatibilities between the repo code and the published wheel, and the
one-shot bundling script.

## TL;DR

```powershell
# From the repo root, against the SAME venv CadQuery uses (CPython 3.7-3.11):
powershell -ExecutionPolicy Bypass -File ./scripts/bundle-opencamlib.ps1
# then confirm it RUNS (not skips):
C:\Users\<you>\wtcam-sidecar-venv\Scripts\python.exe -m pytest engines/cam/ocl_smoke_test.py -v
```

## Wheel / version availability (verified against the PyPI JSON API)

`pip index versions opencamlib` and the PyPI JSON API
(`https://pypi.org/pypi/opencamlib/json`) agree:

| Aspect | Finding |
| --- | --- |
| Latest version on PyPI | **2023.1.11** (released 2023-01; project appears dormant) |
| All published versions | `2022.12.17`, `2022.12.18`, `2023.1.11` |
| Distribution type | **wheels only** — every release is 29 `bdist_wheel` files, **no sdist** |
| CPython tags with wheels | **cp37, cp38, cp39, cp310, cp311** (NO cp312 / cp313 / cp314) |
| Windows wheels | **both `win32` and `win_amd64`** for every cp37–cp311 |
| Other platforms | macOS (`macosx_10_9_x86_64`, `macosx_11_0_arm64`) + manylinux 2014 (x86_64, aarch64) |

Empirical confirmation on this Windows box (`pip download --only-binary=:all:`):

```text
Python 3.11 win_amd64 -> opencamlib-2023.1.11-cp311-cp311-win_amd64.whl  (272 KB)  OK
Python 3.12 win_amd64 -> ERROR: No matching distribution found            (no wheel, no sdist)
```

Pinned wheel used by the bundling script:

```text
opencamlib-2023.1.11-cp311-cp311-win_amd64.whl
sha256 40afdde34669101194419324424649efaec72570f232a8eecefd3ea8f76dd58a
```

### What this means for the three machines / the user's box

- **The sidecar venv must be CPython 3.7–3.11.** The project's CadQuery sidecar
  venv is already **Python 3.11** (`C:\Users\jrrou\wtcam-sidecar-venv`, 3.11.15)
  — so OCL installs there with **no version change**. Point the app's
  Utilities → Settings → Paths python at that same interpreter and OCL and
  CadQuery share one runtime.
- **Python 3.12+ cannot use OpenCAMLib via pip.** There is no 3.12+ wheel and
  no sdist. The machine's *system* Python here is 3.14, which is exactly why a
  bare `pip install opencamlib` against system Python fails. Always target the
  3.11 sidecar venv. (Building from source for 3.12+ would require Boost.Python
  + a C++ toolchain and is out of scope.)

## Two real incompatibilities (read before claiming "it works")

OpenCAMLib installs cleanly on 3.11, but the published wheel's API does **not**
fully match what the repo's strategy code assumes. Both are honest blockers,
not theory:

### 1. Import name: `import ocl` vs `import opencamlib`

`engines/cam/ocl_toolpath.py` does **`import ocl`**, but the only installable
PyPI distribution is named **`opencamlib`**. Its compiled extension lives at
`opencamlib/ocl.pyd` and `opencamlib/__init__.py` is just `from .ocl import *`.
So after a plain `pip install opencamlib`:

```python
import opencamlib            # OK -> full API (CylCutter, STLSurf, Waterline, ...)
from opencamlib import ocl   # OK -> the same extension
import ocl                   # ModuleNotFoundError: No module named 'ocl'
```

**Fix (packaging-only, no code change):** `scripts/bundle-opencamlib.ps1` writes
a one-line `ocl.py` shim into the venv's `site-packages`:

```python
from opencamlib.ocl import *
from opencamlib.ocl import version
```

After the shim, the existing engine code runs **unchanged** and produces real
toolpaths. This is the historical layout difference between the old
conda/source builds (which shipped a top-level `ocl`) and the PyPI
repackaging (which namespaced it under `opencamlib`).

### 2. `AdaptiveWaterline.setCosLimit` is missing from the wheel

`engines/cam/ocl_strategies.py` (`run_waterline_levels`) calls
`wl.setCosLimit(0.65)` for the `adaptive_waterline` strategy. The PyPI wheel's
`AdaptiveWaterline` exposes `setMinSampling` but **not** `setCosLimit`, so the
call raises `AttributeError: 'AdaptiveWaterline' object has no attribute
'setCosLimit'`.

Confirmed `AdaptiveWaterline` methods in `opencamlib 2023.1.11`:

```text
getLoops, getThreads, getXFibers, getYFibers, reset, run, run2,
setCutter, setMinSampling, setSTL, setSampling, setThreads, setZ
```

**Consequence:** `waterline`, `raster`, and `surface_scan` strategies work with
real OCL today; **`adaptive_waterline` does NOT** with the published wheel until
the `setCosLimit` call is removed/guarded in the engine. That is an engine-code
change (touches a G-code-generating module) and is intentionally **out of scope**
for the packaging work — flagged here so it is not forgotten. The OCL fallback
chain in `cam-runner.ts` already degrades `cnc_adaptive` gracefully to the
built-in finish, so nothing crashes; it just isn't true OCL yet.

## Bundling: `scripts/bundle-opencamlib.ps1`

Unlike OrcaSlicer (a ~150 MB binary zip — see `docs/SLICING.md`), OpenCAMLib is
a tiny normal wheel, so there is **no download/extract/SHA-zip dance**. The
script:

1. Pins `$OclVersion = '2023.1.11'`.
2. Resolves the target interpreter: `-PythonExe` wins, else
   `Scripts\python.exe` under `-VenvPath` (default
   `C:\Users\<you>\wtcam-sidecar-venv`).
3. **Refuses to run on Python 3.12+** (no wheel, no sdist) with an actionable
   message — fail fast rather than attempt a source build.
4. `pip install --only-binary=:all: opencamlib==<pinned>` (never builds from
   source).
5. Verifies `import opencamlib`, then writes the `ocl.py` shim.
6. Verifies the bare `import ocl` now resolves and prints `ocl.version()`.

It is idempotent (re-running is a no-op if `import ocl` already works) and takes
`-Force` to reinstall.

```powershell
# Default sidecar venv:
powershell -ExecutionPolicy Bypass -File ./scripts/bundle-opencamlib.ps1
# Explicit venv / interpreter:
powershell -ExecutionPolicy Bypass -File ./scripts/bundle-opencamlib.ps1 -VenvPath C:\Users\jrrou\wtcam-sidecar-venv -Force
powershell -ExecutionPolicy Bypass -File ./scripts/bundle-opencamlib.ps1 -PythonExe C:\Python311\python.exe
```

> **Note:** OpenCAMLib is installed **into the sidecar venv at setup time**, not
> packed into the Electron installer via `extraResources`. It is a Python
> dependency of the interpreter `settings.pythonPath` points at — the same place
> CadQuery lives — so it travels with the venv, exactly like the other entries
> in `engines/requirements.txt`. (`opencamlib>=2023.1` is already listed there;
> this script just guarantees the install + the `import ocl` bridge on Windows.)

## Verifying it works

`engines/cam/ocl_smoke_test.py` is an **OCL-gated** pytest smoke:

- **SKIPS cleanly** when neither `ocl` nor `opencamlib` is importable (so CI and
  any machine without OCL stays green).
- **RUNS** when OCL is present (bare `ocl` via the shim, or `opencamlib`
  directly) and asserts real CL points + finite, feed-bearing G1 moves from the
  shared strategy core for `raster`, `waterline`, and `surface_scan`.

```powershell
# Skips on the system Python (3.14, no OCL); runs on the 3.11 sidecar venv after bundling.
C:\Users\jrrou\wtcam-sidecar-venv\Scripts\python.exe -m pytest engines/cam/ocl_smoke_test.py -v
```

The pre-existing `engines/cam/smoke_ocl_toolpath.py` covers the
config/validation/error paths and needs **no** OCL — keep using it for the
subprocess contract; use `ocl_smoke_test.py` for the real-OCL numerics.

## Honest verdict (as of this writing)

- **Feasible on the user's box?** Yes — but only by installing into the
  **3.11 sidecar venv**, not system Python (3.14, unsupported). A cp311
  `win_amd64` wheel exists and installs in seconds.
- **Does `import ocl` work out of the box?** No — the PyPI package is
  `opencamlib`; the `ocl.py` shim (written by the bundling script) is required.
- **Do all four strategies work?** `waterline`, `raster`, `surface_scan` —
  yes, proven against real OCL. `adaptive_waterline` — **no**, blocked by the
  missing `setCosLimit` (engine-code fix, out of scope here).
- **Proven how?** A throwaway 3.11 venv (NOT the shared CadQuery venv) had
  `opencamlib` + the shim installed; the gated smoke ran the real drop-cutter
  and waterline engine and produced safe G-code. The shared sidecar venv was
  left untouched and the smoke skips there.
