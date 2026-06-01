"""Pure-Python CadQuery 2D drawing/projection core.

Shared by the sidecar handlers in ``engines/sidecar/cad_handlers.py``. Mirrors
the structure of ``cadquery_script.py`` and ``cadquery_import.py``: a tiny set
of pure functions, no JSON-RPC envelope handling here (that lives in the
sidecar layer).

Wire surface
============
Two method bodies live here:

  * :func:`project_to_drawing` — given a body handle (from a prior
    ``cad.execute_script`` or ``cad.import_step`` call) and a view name
    (``front`` / ``top`` / ``right`` / ``iso``), return an inline SVG string
    of the 2D projection. Uses CadQuery's ``cq.exporters.export`` with
    ``format='SVG'`` which drives OCCT's BRepLib hidden-line-removal
    projector under the hood.
  * :func:`export_drawing` — same projection, but writes the SVG to disk and
    returns the byte count.

Why two methods (not one with an optional ``outPath``)?
======================================================
Symmetry with the existing ``cad.execute_script`` / ``cad.export`` split.
The renderer's drawings panel wants the SVG markup inline so it can drop it
straight into a ``<div dangerouslySetInnerHTML>`` for live updates; the
"Export Drawing" button wants the file on disk for the operator. Keeping
them separate avoids an awkward "return both" envelope and matches the
overall sidecar style (one method = one side-effect class).

View directions
===============
Standard third-angle projection vectors. CadQuery's SVG exporter accepts a
``projectionDir`` option as a 3-tuple ``(x, y, z)`` — the viewing direction
points FROM the viewer INTO the part, so e.g. "front" view (looking down
the -Y axis at the XZ plane) uses ``(0, -1, 0)``.

  * ``front``  — looking down -Y, sees XZ plane (width × height)
  * ``top``    — looking down -Z, sees XY plane (width × depth)
  * ``right``  — looking down -X, sees YZ plane (depth × height)
  * ``iso``    — isometric ``(1, 1, 1)`` normalized for the trimetric view

Safety Rule 1 — G-code is sacred
================================
This module DOES NOT emit G-code. It DOES NOT touch the STL pipeline that
feeds ``cam.run_toolpath`` (Safety Rule 1). The SVG output is renderer-only;
no downstream toolpath logic ever reads it.

Error vocabulary (raised as ``_CadHandlerError``)
=================================================
  * ``cadquery_not_installed``  — ``import cadquery`` failed.
  * ``invalid_handle``          — caller's handle is not in the table
    (sidecar restarted? Renderer should re-import / re-run the script).
  * ``bad_params``              — unknown view name, null-byte in path, …
  * ``drawing_error``           — CadQuery raised during SVG projection.
  * ``svg_write_error``         — disk write failed.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .cadquery_import import _CadHandlerError, _HANDLES


# ── View directions ─────────────────────────────────────────────────────
#
# CadQuery's ``cq.exporters.export`` SVG path uses an internal ``opts`` dict
# (``projectionDir`` is a 3-tuple). The vectors below match the standard
# third-angle projection convention used by mechanical drafting:
#
#   * X = right
#   * Y = back (away from viewer in default orientation)
#   * Z = up
#
# "Front" view means the viewer stands in front of the part and looks
# BACKWARD at it — so the viewing direction is +Y (into the part). The XZ
# plane is what gets projected.
#
# The iso direction is the canonical (1, 1, 1) corner that classical
# isometric drawings use; CadQuery handles the rotation internally.

VIEW_DIRECTIONS: Dict[str, Tuple[float, float, float]] = {
    "front": (0.0, 1.0, 0.0),
    "top":   (0.0, 0.0, 1.0),
    "right": (1.0, 0.0, 0.0),
    "iso":   (1.0, 1.0, 1.0),
}


ALLOWED_VIEWS: Tuple[str, ...] = tuple(VIEW_DIRECTIONS.keys())


def _validate_view(view: str) -> Tuple[float, float, float]:
    """Resolve ``view`` (e.g. ``'front'``) to its projection direction vector.

    Raises ``_CadHandlerError(bad_params)`` for any unknown view name so a
    typo (``'fornt'``) fails fast instead of silently producing an
    isometric-default drawing the operator didn't ask for.
    """
    direction = VIEW_DIRECTIONS.get(view)
    if direction is None:
        raise _CadHandlerError(
            "bad_params",
            f"view must be one of {sorted(ALLOWED_VIEWS)}, got {view!r}",
        )
    return direction


def _resolve_handle(handle: str) -> Any:
    """Return the workplane behind ``handle`` or raise ``invalid_handle``.

    Shared helper so both ``project_to_drawing`` and ``export_drawing`` use
    the exact same lookup + error message — the renderer can rely on a
    single failure mode across both methods.
    """
    if not handle:
        raise _CadHandlerError(
            "bad_params", "handle must be a non-empty string"
        )
    doc = _HANDLES.get(handle)
    if doc is None:
        raise _CadHandlerError(
            "invalid_handle",
            f"unknown CAD handle: {handle!r} "
            f"(table holds {len(_HANDLES)} entries)",
        )
    return doc.workplane


def _build_svg_opts(view: str) -> Dict[str, Any]:
    """Build the ``opts`` dict for CadQuery's SVG exporter for a given view.

    Tuned for mechanical-drafting output:
      * ``projectionDir`` — the view-direction vector resolved by
        :func:`_validate_view`.
      * ``width`` / ``height`` — generous canvas; the renderer wraps the
        SVG in a responsive container so absolute pixel size only affects
        the embedded viewBox aspect ratio.
      * ``strokeWidth`` — 0.25 mm visible / 0.15 mm hidden mirrors a typical
        ISO drafting standard.
      * ``showHidden`` / ``showAxes`` — hidden lines on, axis indicator
        off (a CAM operator doesn't need the gnomon in the drawing).
    """
    direction = _validate_view(view)
    return {
        "width": 800,
        "height": 600,
        "marginLeft": 10,
        "marginTop": 10,
        "showAxes": False,
        "projectionDir": direction,
        "strokeWidth": 0.25,
        "strokeColor": (0, 0, 0),
        "hiddenColor": (160, 160, 160),
        "showHidden": True,
    }


# ── Inline-SVG projection ───────────────────────────────────────────────


def project_to_drawing(handle: str, view: str = "front") -> Dict[str, Any]:
    """Project the body behind ``handle`` into a 2D SVG string.

    Wire result::

        {
          "svg":  str,    # inline SVG markup
          "view": str,    # echoed view name for round-trip diagnostics
          "bytes": int,   # len(svg) in bytes after UTF-8 encode
        }

    Raises ``_CadHandlerError`` with one of:
      * ``bad_params``           — empty handle or unknown view name.
      * ``invalid_handle``       — handle missing from the table.
      * ``cadquery_not_installed`` — pip dependency missing.
      * ``drawing_error``        — CadQuery raised during projection.
    """
    workplane = _resolve_handle(handle)
    opts = _build_svg_opts(view)

    try:
        import cadquery as cq  # noqa: PLC0415 - optional dependency
    except ImportError as exc:
        raise _CadHandlerError(
            "cadquery_not_installed",
            "CadQuery is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    try:
        svg_text = cq.exporters.getSVG(
            cq.exporters.toCompound(workplane), opts=opts
        )
    except AttributeError:
        # Older CadQuery versions exposed ``getSVG`` on the exporters submodule
        # but newer ones renamed it; fall back to the generic ``export`` API
        # which always exists.
        svg_text = _export_via_generic_path(workplane, opts)
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "drawing_error",
            f"CadQuery SVG projection failed: {exc}",
            detail=str(exc),
        ) from exc

    if not isinstance(svg_text, str) or not svg_text:
        raise _CadHandlerError(
            "drawing_error",
            "CadQuery SVG export returned empty output",
        )

    return {
        "svg": svg_text,
        "view": view,
        "bytes": len(svg_text.encode("utf-8")),
    }


def _export_via_generic_path(workplane: Any, opts: Dict[str, Any]) -> str:
    """Fall back to ``cq.exporters.export`` (writes to disk, then read back).

    Modern CadQuery exposes ``getSVG`` for inline string output, but some
    pinned-version envs only ship ``export`` (which writes to a path). We
    write to a temp file, read the bytes back, and clean up.
    """
    import tempfile

    import cadquery as cq  # noqa: PLC0415

    with tempfile.NamedTemporaryFile(
        suffix=".svg", delete=False, mode="w", encoding="utf-8"
    ) as tmp:
        tmp_path = tmp.name
    try:
        cq.exporters.export(
            workplane, tmp_path, exportType="SVG", opt=opts
        )
        return Path(tmp_path).read_text(encoding="utf-8")
    finally:
        try:
            Path(tmp_path).unlink()
        except OSError:
            pass  # best-effort cleanup; tmp dir will eventually be swept


# ── Export-to-disk projection ───────────────────────────────────────────


def export_drawing(
    handle: str, view: str, out_path: str
) -> Dict[str, Any]:
    """Write the projected SVG to ``out_path`` on disk.

    Wire result::

        {
          "outPath":      str,   # echo of out_path (now exists on disk)
          "view":         str,   # echoed view name
          "bytesWritten": int,
        }

    Raises ``_CadHandlerError`` with one of:
      * ``bad_params``           — empty handle / path / unknown view /
        null-byte in path.
      * ``invalid_handle``       — handle missing from the table.
      * ``cadquery_not_installed`` — pip dependency missing.
      * ``drawing_error``        — CadQuery raised during projection.
      * ``svg_write_error``      — disk write failed or directory un-creatable.
    """
    if not out_path or "\x00" in out_path:
        raise _CadHandlerError(
            "bad_params",
            "outPath must be a non-empty path without null bytes",
        )

    # Build the SVG via the inline path so we share validation + the
    # cadquery_not_installed envelope between the two methods. This costs
    # one extra in-memory string compared to going straight to disk, but a
    # mechanical drawing SVG is small (kilobytes) and the safety / error-
    # vocabulary parity is worth it.
    result = project_to_drawing(handle, view=view)
    svg_text: str = result["svg"]

    out = Path(out_path)
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise _CadHandlerError(
            "svg_write_error",
            f"failed to create output directory {out.parent}: {exc}",
            detail=str(exc),
        ) from exc

    try:
        out.write_text(svg_text, encoding="utf-8")
    except OSError as exc:
        raise _CadHandlerError(
            "svg_write_error",
            f"failed to write SVG to {out}: {exc}",
            detail=str(exc),
        ) from exc

    try:
        bytes_written = out.stat().st_size
    except OSError as exc:
        raise _CadHandlerError(
            "svg_write_error",
            f"failed to stat exported SVG: {exc}",
            detail=str(exc),
        ) from exc

    return {
        "outPath": str(out),
        "view": view,
        "bytesWritten": int(bytes_written),
    }


__all__ = [
    "ALLOWED_VIEWS",
    "VIEW_DIRECTIONS",
    "export_drawing",
    "project_to_drawing",
]
