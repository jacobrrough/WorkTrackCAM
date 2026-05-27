"""
OpenCAMLib strategies for WorkTrackCAM (optional dependency).

Install: ``pip install opencamlib`` (wheels typically Python 3.7–3.11; other
versions may need a local build).

IPC contract (invoked by ``src/main/cam-runner.ts``)
----------------------------------------------------
- **argv**: ``python ocl_toolpath.py <config.json>``
- **cwd**: app root (Electron ``job.appRoot``); paths in JSON are absolute or
  cwd-relative as written by main.
- **config.json** (required keys): ``stlPath``, ``toolpathJsonPath``; optional:
  ``strategy`` (``waterline`` | ``adaptive_waterline`` | ``raster``), ``zPassMm``,
  ``stepoverMm``, ``toolDiameterMm``, ``safeZMm``, ``feedMmMin``,
  ``plungeMmMin``.
- **Success**: exit 0; write ``toolpathJsonPath`` with
  ``{"ok": true, "toolpathLines": [...], "strategy": ...}``; print a one-line
  JSON summary to stdout.
- **Failure**: non-zero exit; print a one-line JSON object with ``error`` and
  optional ``detail`` (main greps stdout for known ``error`` codes when
  falling back to the built-in parallel finish). Includes ``invalid_numeric_params``
  when feeds, tool diameter, stepover, or (for waterline) ``zPassMm`` are non-finite
  or out of range. ``stl_read_error`` when the STL path exists but OpenCAMLib cannot
  load it (corrupt file, unsupported variant, etc.).

Shared core
-----------
The OCL invocations live in ``ocl_strategies.py`` so the sidecar
(``engines/sidecar/cam_handlers.py``) and this legacy subprocess produce
byte-identical G-code lines. Touching strategy numerics or formatting MUST
go through that module to keep both call paths in lock-step.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any

# Use a path-tolerant import: this file is invoked two ways —
#   1. ``python engines/cam/ocl_toolpath.py <cfg>`` (legacy subprocess)
#   2. ``python -m engines.cam.ocl_toolpath`` (sibling tools, tests)
# Method 1 has no package context, so a relative ``from .ocl_strategies``
# raises ImportError. Try the relative form first (sidecar-style modules),
# then fall back to adding our own directory to sys.path for script mode.
try:  # pragma: no cover - import shim, exercised by both call paths
    from .ocl_strategies import dispatch_strategy, load_stl
except ImportError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from ocl_strategies import dispatch_strategy, load_stl  # type: ignore[no-redef]

REQUIRED_CFG_KEYS = ("stlPath", "toolpathJsonPath")
ALLOWED_STRATEGIES = frozenset({"waterline", "adaptive_waterline", "raster"})


def _die(error: str, detail: str | None = None, code: int = 2) -> None:
    """Print a single JSON line and exit (stderr is unused for machine-parseable errors)."""
    payload: dict[str, Any] = {"ok": False, "error": error}
    if detail is not None:
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=False))
    sys.exit(code)


def _load_cfg() -> dict[str, Any]:
    """Load and parse ``argv[1]`` as UTF-8 JSON. Never raises for I/O or JSON."""
    if len(sys.argv) < 2:
        _die("usage", "ocl_toolpath.py <config.json>", code=2)
    p = Path(sys.argv[1])
    try:
        raw = p.read_text(encoding="utf-8")
    except FileNotFoundError:
        _die("config_not_found", str(p), code=2)
    except OSError as e:
        _die("config_read_error", str(e), code=2)
    except UnicodeDecodeError as e:
        _die("config_not_utf8", str(e), code=2)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        _die("invalid_config_json", f"{e.msg} at line {e.lineno} col {e.colno}", code=2)
    if not isinstance(data, dict):
        _die("invalid_config_shape", "root must be a JSON object", code=2)
    return data


def _coerce_strategy(cfg: dict[str, Any]) -> str:
    """Default missing or JSON-null ``strategy`` to ``waterline``."""
    s = cfg.get("strategy", "waterline")
    return "waterline" if s is None else str(s)


def _validate_cfg(cfg: dict[str, Any]) -> None:
    missing = [k for k in REQUIRED_CFG_KEYS if k not in cfg or cfg[k] in (None, "")]
    if missing:
        _die("config_missing_keys", ",".join(missing), code=2)
    strategy = _coerce_strategy(cfg)
    if strategy not in ALLOWED_STRATEGIES:
        _die(
            "invalid_strategy",
            f"must be one of {sorted(ALLOWED_STRATEGIES)}, got {strategy!r}",
            code=2,
        )


def _float_param(cfg: dict[str, Any], key: str, default: float) -> float:
    """Parse optional float from config; missing or JSON-null uses ``default``."""
    if key not in cfg or cfg[key] is None:
        v = default
    else:
        try:
            v = float(cfg[key])
        except (TypeError, ValueError):
            _die("invalid_numeric_params", f"{key} must be a finite number", code=2)
    if not math.isfinite(v):
        _die("invalid_numeric_params", f"{key} must be finite", code=2)
    return v


def _parse_cam_numeric_params(cfg: dict[str, Any], strategy: str) -> dict[str, float]:
    """
    Validate feeds, tool size, and step distances before loading STL / OCL.

    ``safeZMm`` may be any finite value (job coordinates); cutting params must be positive.
    """
    z_pass = _float_param(cfg, "zPassMm", 1.0)
    stepover = _float_param(cfg, "stepoverMm", 1.0)
    tool_d = _float_param(cfg, "toolDiameterMm", 6.0)
    safe_z = _float_param(cfg, "safeZMm", 10.0)
    feed = _float_param(cfg, "feedMmMin", 1000.0)
    plunge = _float_param(cfg, "plungeMmMin", 400.0)

    if tool_d <= 0:
        _die("invalid_numeric_params", "toolDiameterMm must be > 0", code=2)
    if feed <= 0:
        _die("invalid_numeric_params", "feedMmMin must be > 0", code=2)
    if plunge <= 0:
        _die("invalid_numeric_params", "plungeMmMin must be > 0", code=2)
    if stepover <= 0:
        _die("invalid_numeric_params", "stepoverMm must be > 0", code=2)
    if strategy in ("waterline", "adaptive_waterline") and z_pass <= 0:
        _die("invalid_numeric_params", "zPassMm must be > 0 for waterline strategies", code=2)

    # Clamp stepover vs tool Ø: > Ø skips stock; tiny values explode path length (HSM uses bounded radial engagement).
    _min_s = max(0.01, tool_d * 0.02)
    _max_s = tool_d * 0.98
    if stepover < _min_s:
        stepover = _min_s
    elif stepover > _max_s:
        stepover = _max_s

    return {
        "zPassMm": z_pass,
        "stepoverMm": stepover,
        "toolDiameterMm": tool_d,
        "safeZMm": safe_z,
        "feedMmMin": feed,
        "plungeMmMin": plunge,
    }


def main() -> None:
    cfg = _load_cfg()
    _validate_cfg(cfg)

    stl_path = Path(str(cfg["stlPath"]))
    out_json = Path(str(cfg["toolpathJsonPath"]))
    strategy = _coerce_strategy(cfg)

    # Check STL before importing OpenCAMLib so config/path errors do not depend on pip installs.
    if not stl_path.is_file():
        _die("stl_missing", str(stl_path), code=2)
    try:
        if stl_path.stat().st_size == 0:
            _die("stl_read_error", "STL file is empty (0 bytes)", code=3)
    except OSError as e:
        _die("stl_read_error", str(e), code=3)

    nums = _parse_cam_numeric_params(cfg, strategy)
    z_pass = nums["zPassMm"]
    stepover = nums["stepoverMm"]
    tool_d = nums["toolDiameterMm"]
    safe_z = nums["safeZMm"]
    feed = nums["feedMmMin"]
    plunge = nums["plungeMmMin"]

    try:
        import ocl  # noqa: PLC0415
    except Exception as e:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "opencamlib_not_installed",
                    "detail": str(e),
                },
                ensure_ascii=False,
            )
        )
        sys.exit(1)

    try:
        try:
            stl = load_stl(ocl, stl_path)
        except Exception as e:  # noqa: BLE001
            print(
                json.dumps({"ok": False, "error": "stl_read_error", "detail": str(e)}, ensure_ascii=False)
            )
            sys.exit(3)

        lines = dispatch_strategy(
            ocl,
            stl,
            strategy=strategy,
            z_pass_mm=z_pass,
            stepover_mm=stepover,
            tool_diameter_mm=tool_d,
            safe_z_mm=safe_z,
            feed_mm_min=feed,
            plunge_mm_min=plunge,
        )
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": "ocl_runtime_error", "detail": str(e)}, ensure_ascii=False))
        sys.exit(3)

    if not lines:
        detail = "no raster segments" if strategy == "raster" else "no loops"
        print(json.dumps({"ok": False, "error": "ocl_empty_toolpath", "detail": detail}, ensure_ascii=False))
        sys.exit(4)

    payload = {"ok": True, "toolpathLines": lines, "strategy": strategy}
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"ok": True, "lines": len(lines), "strategy": strategy}, ensure_ascii=False))


if __name__ == "__main__":
    main()
