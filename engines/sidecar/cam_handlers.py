"""OpenCAMLib-backed CAM handlers for the WorkTrackCAM sidecar.

End-to-end OCL dispatcher. Reuses the shared strategy core in
``engines/cam/ocl_strategies.py`` so the sidecar and the legacy
``ocl_toolpath.py`` subprocess produce byte-identical G-code line output.

Wire contract (kept in lock-step with ``src/shared/sidecar-protocol.ts``)
-------------------------------------------------------------------------
Method: ``cam.run_toolpath``

Params::

    {
      "strategy":        "waterline" | "adaptive_waterline" | "raster" | "surface_scan",
      "stlPath":         str (absolute path to input STL on disk),
      "toolDiameterMm":  positive float,
      "stepoverMm":      positive float,
      "feedMmMin":       positive float,
      "plungeMmMin":     positive float,
      "safeZMm":         finite float (may be negative),
      "zPassMm":         positive float (required for waterline / adaptive_waterline)
    }

Success result::

    {
      "toolpathLines": list[str]  // G-code lines, no trailing newline
      "strategy":      str        // echo of requested strategy
      "lineCount":     int        // == len(toolpathLines)
    }

Safety Rule 1 — G-code is sacred
================================
Output lines flow straight into the Handlebars post-processors that drive
the Laguna Swift, Makera Carvera, and (occasionally) the K2 Plus. Bad
G-code crashes machines. This handler:
  * validates every numeric param BEFORE invoking OCL (positivity / finiteness
    same as ``ocl_toolpath.py``);
  * verifies the STL exists on disk before importing the optional OCL
    dependency (so missing-file errors do not require a pip install);
  * surfaces ``opencamlib_not_installed`` as a structured sidecar error so
    the TS side can fall back to the built-in mesh raster path;
  * never emits NaN/Inf coordinates — the strategy core uses ``:.3f``
    formatting which would raise on non-finite values, but the strategy
    core itself rejects degenerate inputs before that point.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Callable

# Shared OCL strategy core lives under engines/cam/ — make it importable
# regardless of how the sidecar is launched (``python -m engines.sidecar.main``
# vs. a frozen build).
try:
    from engines.cam.ocl_strategies import (
        STRATEGY_NAMES,
        dispatch_strategy,
        load_stl,
    )
except ImportError:  # pragma: no cover - frozen-app import path
    import sys

    _here = Path(__file__).resolve().parent
    _engines_root = _here.parent
    sys.path.insert(0, str(_engines_root))
    from cam.ocl_strategies import (  # type: ignore[no-redef]
        STRATEGY_NAMES,
        dispatch_strategy,
        load_stl,
    )


HandlerFn = Callable[[dict[str, Any]], dict[str, Any]]

# Allowed strategies — MUST match ``CamStrategy`` in sidecar-protocol.ts.
# Source of truth is ``ocl_strategies.STRATEGY_NAMES``; we alias for clarity.
ALLOWED_STRATEGIES = STRATEGY_NAMES


class _SidecarHandlerError(Exception):
    """Marker exception carrying a structured error code for the dispatch loop.

    The main loop in ``engines/sidecar/main.py`` catches the generic
    ``Exception`` and emits a ``handler_error`` envelope. For CAM-specific
    failures we want a more granular code so the TS bridge can map to
    user-actionable hints (same vocabulary as ``ocl_toolpath.py``).
    """

    def __init__(self, code: str, message: str, detail: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.detail = detail


def _require_str(params: dict[str, Any], key: str) -> str:
    val = params.get(key)
    if not isinstance(val, str) or not val:
        raise _SidecarHandlerError(
            "bad_params", f"missing or empty string param: {key!r}"
        )
    return val


def _require_positive_float(params: dict[str, Any], key: str) -> float:
    val = params.get(key)
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        raise _SidecarHandlerError(
            "invalid_numeric_params", f"param {key!r} must be a number"
        )
    f = float(val)
    if not math.isfinite(f) or f <= 0:
        raise _SidecarHandlerError(
            "invalid_numeric_params", f"param {key!r} must be a positive finite number"
        )
    return f


def _require_finite_float(params: dict[str, Any], key: str) -> float:
    val = params.get(key)
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        raise _SidecarHandlerError(
            "invalid_numeric_params", f"param {key!r} must be a number"
        )
    f = float(val)
    if not math.isfinite(f):
        raise _SidecarHandlerError(
            "invalid_numeric_params", f"param {key!r} must be a finite number"
        )
    return f


def _clamp_stepover(stepover_mm: float, tool_diameter_mm: float) -> float:
    """Mirror the stepover clamp in ``ocl_toolpath.py`` so both call paths
    agree on the effective stepover passed to OCL.

    Stepover > tool Ø skips stock; tiny values explode path length.
    """
    min_s = max(0.01, tool_diameter_mm * 0.02)
    max_s = tool_diameter_mm * 0.98
    if stepover_mm < min_s:
        return min_s
    if stepover_mm > max_s:
        return max_s
    return stepover_mm


def run_toolpath(params: dict[str, Any]) -> dict[str, Any]:
    """Run an OCL toolpath strategy end-to-end and return G-code lines.

    See the module docstring for the wire contract. This is a SYNCHRONOUS
    call inside the per-request dispatch; large STLs may take seconds (the
    TS bridge defaults to a 60 s call timeout).
    """
    strategy = _require_str(params, "strategy")
    if strategy not in ALLOWED_STRATEGIES:
        raise _SidecarHandlerError(
            "invalid_strategy",
            f"invalid strategy: {strategy!r} "
            f"(must be one of {sorted(ALLOWED_STRATEGIES)})",
        )

    stl_path_str = _require_str(params, "stlPath")
    stl_path = Path(stl_path_str)
    if not stl_path.is_file():
        raise _SidecarHandlerError(
            "stl_missing", f"STL not found: {stl_path_str}"
        )
    try:
        if stl_path.stat().st_size == 0:
            raise _SidecarHandlerError(
                "stl_read_error", "STL file is empty (0 bytes)"
            )
    except OSError as exc:
        raise _SidecarHandlerError("stl_read_error", str(exc)) from exc

    tool_d = _require_positive_float(params, "toolDiameterMm")
    stepover_raw = _require_positive_float(params, "stepoverMm")
    feed = _require_positive_float(params, "feedMmMin")
    plunge = _require_positive_float(params, "plungeMmMin")
    safe_z = _require_finite_float(params, "safeZMm")

    if strategy in ("waterline", "adaptive_waterline"):
        z_pass = _require_positive_float(params, "zPassMm")
    else:
        # raster / surface_scan: z_pass is unused by the strategy but the
        # shared dispatcher still accepts it. Default to 1 mm for symmetry.
        z_pass_raw = params.get("zPassMm", 1.0)
        z_pass = (
            float(z_pass_raw)
            if isinstance(z_pass_raw, (int, float))
            and not isinstance(z_pass_raw, bool)
            and math.isfinite(float(z_pass_raw))
            and float(z_pass_raw) > 0
            else 1.0
        )

    stepover = _clamp_stepover(stepover_raw, tool_d)

    try:
        import ocl  # noqa: PLC0415 - optional dependency
    except ImportError as exc:
        raise _SidecarHandlerError(
            "opencamlib_not_installed",
            "OpenCAMLib is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    try:
        stl = load_stl(ocl, stl_path)
    except Exception as exc:  # noqa: BLE001 - OCL raises bare Exception on read failures
        raise _SidecarHandlerError(
            "stl_read_error", f"OpenCAMLib could not read STL: {exc}"
        ) from exc

    try:
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
    except Exception as exc:  # noqa: BLE001 - OCL raises arbitrary types on failure
        raise _SidecarHandlerError(
            "ocl_runtime_error", f"OpenCAMLib strategy {strategy!r} failed: {exc}"
        ) from exc

    if not lines:
        raise _SidecarHandlerError(
            "ocl_empty_toolpath",
            f"strategy {strategy!r} produced zero toolpath lines "
            "(model may be flat, too small for the tool, or outside the cut envelope)",
        )

    return {
        "toolpathLines": lines,
        "strategy": strategy,
        "lineCount": len(lines),
    }


HANDLERS: dict[str, HandlerFn] = {
    "run_toolpath": run_toolpath,
}
