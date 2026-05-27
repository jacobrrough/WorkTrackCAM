"""OpenCAMLib-backed CAM handlers for the WorkTrackCAM sidecar.

Wraps the existing ``engines/cam/ocl_toolpath.py`` strategy code so the
sidecar exposes a uniform JSON-RPC surface for waterline / adaptive
waterline / raster toolpaths.

The actual OCL computations live in ``ocl_toolpath.py`` and are reused as-is
to preserve the well-tested numeric behavior and exit-code semantics. When
the per-call ocl_toolpath subprocess path in ``src/main/cam-runner.ts`` is
migrated to the sidecar, these handlers will replace the per-call spawn.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable


HandlerFn = Callable[[dict[str, Any]], dict[str, Any]]

ALLOWED_STRATEGIES = frozenset({"waterline", "adaptive_waterline", "raster"})


def _require_str(params: dict[str, Any], key: str) -> str:
    val = params.get(key)
    if not isinstance(val, str) or not val:
        raise ValueError(f"missing or empty string param: {key!r}")
    return val


def _require_positive_float(params: dict[str, Any], key: str) -> float:
    val = params.get(key)
    if not isinstance(val, (int, float)) or val <= 0 or val != val:
        raise ValueError(f"param {key!r} must be a positive finite number")
    return float(val)


def _require_finite_float(params: dict[str, Any], key: str) -> float:
    val = params.get(key)
    if not isinstance(val, (int, float)) or val != val or val in (float("inf"), float("-inf")):
        raise ValueError(f"param {key!r} must be a finite number")
    return float(val)


def run_toolpath(params: dict[str, Any]) -> dict[str, Any]:
    """Run an OCL toolpath strategy.

    Params (mirrors ocl_toolpath.py config keys):
      - ``strategy``: 'waterline' | 'adaptive_waterline' | 'raster'
      - ``stlPath``: str — input STL on disk
      - ``toolDiameterMm``: positive float
      - ``stepoverMm``: positive float
      - ``feedMmMin``: positive float
      - ``plungeMmMin``: positive float
      - ``safeZMm``: finite float (may be negative)
      - ``zPassMm``: positive float (required for waterline strategies)

    Returns: ``{toolpathLines: number[][], strategy: str, lineCount: int}``

    Scaffold: validates params and returns an empty toolpath. Full impl
    invokes the same `ocl` calls already proven by ``ocl_toolpath.py``.
    """
    strategy = _require_str(params, "strategy")
    if strategy not in ALLOWED_STRATEGIES:
        raise ValueError(
            f"invalid strategy: {strategy!r} "
            f"(must be one of {sorted(ALLOWED_STRATEGIES)})"
        )

    stl_path = _require_str(params, "stlPath")
    if not Path(stl_path).is_file():
        raise FileNotFoundError(f"STL not found: {stl_path}")

    # Numeric param validation — same rules as ocl_toolpath.py ALLOWED_STRATEGIES
    _require_positive_float(params, "toolDiameterMm")
    _require_positive_float(params, "stepoverMm")
    _require_positive_float(params, "feedMmMin")
    _require_positive_float(params, "plungeMmMin")
    _require_finite_float(params, "safeZMm")
    if strategy in ("waterline", "adaptive_waterline"):
        _require_positive_float(params, "zPassMm")

    return {
        "toolpathLines": [],
        "strategy": strategy,
        "lineCount": 0,
        "_scaffold": True,
    }


HANDLERS: dict[str, HandlerFn] = {
    "run_toolpath": run_toolpath,
}
