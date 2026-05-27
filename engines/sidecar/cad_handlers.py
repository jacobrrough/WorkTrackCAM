"""CadQuery-backed CAD handlers for the WorkTrackCAM sidecar.

These handlers are scaffolds — they validate their params and return well-
typed placeholder responses so the Electron-side IPC contract can be wired
and tested ahead of the full CadQuery integration.

When CadQuery is wired up, each handler keeps the same input/output shape
documented below; only the body is replaced with real `cadquery` calls.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable


HandlerFn = Callable[[dict[str, Any]], dict[str, Any]]


def _require_str(params: dict[str, Any], key: str) -> str:
    val = params.get(key)
    if not isinstance(val, str) or not val:
        raise ValueError(f"missing or empty string param: {key!r}")
    return val


def _require_positive_float(params: dict[str, Any], key: str) -> float:
    val = params.get(key)
    if not isinstance(val, (int, float)) or val <= 0 or val != val:  # NaN check
        raise ValueError(f"param {key!r} must be a positive finite number")
    return float(val)


def import_step(params: dict[str, Any]) -> dict[str, Any]:
    """Import a STEP file and return a handle.

    Params: ``{path: str}``
    Returns: ``{handle: str, bbox: {min: [x,y,z], max: [x,y,z]}}``

    Scaffold: validates path exists, returns a deterministic handle string.
    Full impl will call ``cadquery.importers.importStep`` and cache the Shape
    in a process-local handle table.
    """
    path = _require_str(params, "path")
    if not Path(path).is_file():
        raise FileNotFoundError(f"STEP file not found: {path}")
    return {
        "handle": f"step:{Path(path).name}",
        "bbox": {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]},
        "_scaffold": True,
    }


def tessellate(params: dict[str, Any]) -> dict[str, Any]:
    """Tessellate a CadQuery shape handle to a binary STL file.

    Params: ``{handle: str, outPath: str, toleranceMm: number}``
    Returns: ``{stlPath: str, triangleCount: int}``

    Scaffold: validates params, returns placeholder triangle count.
    """
    handle = _require_str(params, "handle")
    out_path = _require_str(params, "outPath")
    tolerance = _require_positive_float(params, "toleranceMm")
    return {
        "stlPath": out_path,
        "triangleCount": 0,
        "_scaffold": True,
        "_echo": {"handle": handle, "toleranceMm": tolerance},
    }


HANDLERS: dict[str, HandlerFn] = {
    "import_step": import_step,
    "tessellate": tessellate,
}
