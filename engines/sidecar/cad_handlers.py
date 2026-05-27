"""CadQuery-backed CAD handlers for the WorkTrackCAM sidecar.

End-to-end CadQuery dispatcher. Reuses the shared core in
``engines/cad/cadquery_import.py`` so the import/tessellate numerics live in
one place and the sidecar handler stays thin (param validation + envelope
mapping).

Wire contract (kept in lock-step with ``src/shared/sidecar-protocol.ts``)
-------------------------------------------------------------------------
Method: ``cad.import_step``

Params::

    {"path": str}  # absolute path to a .step / .stp file

Success result::

    {
      "handle": str,                # opaque handle for cad.tessellate
      "bbox": {                     # axis-aligned bbox of the imported solid
        "min": [float, float, float],
        "max": [float, float, float]
      }
    }

Method: ``cad.tessellate``

Params::

    {
      "handle":      str,          # from cad.import_step
      "outPath":     str,          # absolute path for the output STL
      "toleranceMm": float (> 0)   # surface deviation tolerance
    }

Success result::

    {
      "stlPath":       str,        # echo of outPath (now exists on disk)
      "triangleCount": int         # number of triangles in the STL
    }

Safety Rule 1 — G-code is sacred
================================
This handler does NOT emit G-code. It DOES emit STL that flows into
``cam.run_toolpath`` (OpenCAMLib drop / waterline). A malformed STL would
crash or silently corrupt downstream toolpaths, so the shared core in
``engines/cad/cadquery_import.py`` guarantees:

  * Binary STL format (80-byte header + uint32 count + 50-byte triangles).
  * Zero-area degenerate triangles filtered before write.
  * Right-hand-rule normals (outward-facing for a manifold solid imported
    from STEP).
  * Post-write size check vs. expected ``80 + 4 + 50*N`` bytes — catches
    truncated writes on disk-full.

Error vocabulary (TS bridge maps these to operator-facing hints)
================================================================
  * ``cadquery_not_installed``  — pip dependency missing; renderer can fall
    back to the legacy ``engines/occt/step_to_stl.py`` subprocess path.
  * ``step_file_missing``       — caller's path does not exist.
  * ``step_read_error``         — CadQuery raised during import (malformed
    STEP, unsupported entity, …).
  * ``invalid_handle``          — caller's handle is not in the table
    (sidecar restarted? Renderer should re-import).
  * ``tessellation_error``      — CadQuery raised during tessellate.
  * ``stl_write_error``         — disk write failed or short write.
  * ``bad_params`` / ``invalid_numeric_params`` — param validation failures.
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Callable

# Shared CadQuery core lives under engines/cad/ — make it importable
# regardless of how the sidecar is launched (``python -m engines.sidecar.main``
# vs. a frozen build).
try:
    from engines.cad.cadquery_import import (
        _CadHandlerError,
        import_step_file,
        tessellate_body,
    )
except ImportError:  # pragma: no cover - frozen-app import path
    import sys

    _here = Path(__file__).resolve().parent
    _engines_root = _here.parent
    sys.path.insert(0, str(_engines_root))
    from cad.cadquery_import import (  # type: ignore[no-redef]
        _CadHandlerError,
        import_step_file,
        tessellate_body,
    )


HandlerFn = Callable[[dict[str, Any]], dict[str, Any]]

# Accept either capitalization of the STEP extension. We deliberately reject
# unrelated extensions so a renderer bug ("import this STL via cad.import_step")
# fails fast with bad_params instead of triggering a CadQuery read error.
ALLOWED_STEP_SUFFIXES = (".step", ".stp")


def _require_str(params: dict[str, Any], key: str) -> str:
    val = params.get(key)
    if not isinstance(val, str) or not val:
        raise _CadHandlerError(
            "bad_params", f"missing or empty string param: {key!r}"
        )
    return val


def _require_positive_float(params: dict[str, Any], key: str) -> float:
    val = params.get(key)
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        raise _CadHandlerError(
            "invalid_numeric_params", f"param {key!r} must be a number"
        )
    f = float(val)
    if not math.isfinite(f) or f <= 0:
        raise _CadHandlerError(
            "invalid_numeric_params",
            f"param {key!r} must be a positive finite number",
        )
    return f


def import_step(params: dict[str, Any]) -> dict[str, Any]:
    """Import a STEP file via CadQuery and return a handle + bbox.

    See module docstring for the wire contract.
    """
    path = _require_str(params, "path")
    suffix = Path(path).suffix.lower()
    if suffix not in ALLOWED_STEP_SUFFIXES:
        raise _CadHandlerError(
            "bad_params",
            f"path must end in .step or .stp (got {suffix!r}): {path}",
        )

    handle, doc = import_step_file(path)
    return {
        "handle": handle,
        "bbox": {
            "min": list(doc.bbox_min),
            "max": list(doc.bbox_max),
        },
    }


def tessellate(params: dict[str, Any]) -> dict[str, Any]:
    """Tessellate a CadQuery shape handle to a binary STL file on disk.

    See module docstring for the wire contract.
    """
    handle = _require_str(params, "handle")
    out_path = _require_str(params, "outPath")
    tolerance = _require_positive_float(params, "toleranceMm")
    return tessellate_body(handle, out_path, tolerance)


HANDLERS: dict[str, HandlerFn] = {
    "import_step": import_step,
    "tessellate": tessellate,
}
