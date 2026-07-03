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

import math
import re
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


def project_to_drawing(
    handle: str, view: str = "front", include_hlr: bool = False
) -> Dict[str, Any]:
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

    # When the operator asks for TRUE hidden-line removal we build the SVG
    # from the dedicated OCP HLR pipeline (``cadquery_hlr.project_view_edges``)
    # so visible edges land in a solid group and hidden edges in a SEPARATE
    # dashed group carrying a distinct class the renderer can style / toggle.
    # The projection uses the SAME ``gp_Ax2(gp_Pnt(), gp_Dir(*direction))``
    # projector as ``extract_drawing_geometry`` (the snap-point source), so the
    # emitted linework stays in the exact SVG-mm coordinate space the snap
    # points live in -- dimensions never dangle. Falls back to the standard
    # ``getSVG`` path (which itself separates hidden/visible) when the OCP HLR
    # bindings are unavailable, preserving the graceful-degradation contract.
    if include_hlr:
        hlr_svg = _project_to_drawing_hlr(workplane, view, opts)
        if hlr_svg is not None:
            return {
                "svg": hlr_svg,
                "view": view,
                "bytes": len(hlr_svg.encode("utf-8")),
            }
        # OCP HLR unavailable -> fall through to the standard getSVG path.

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


# ── True-HLR inline projection (includeHlr) ──────────────────────────────
#
# ``project_to_drawing(..., include_hlr=True)`` builds the SVG from the
# dedicated OCP hidden-line-removal pipeline instead of CadQuery's built-in
# ``getSVG`` HLR. Two reasons this exists as a distinct path:
#
#   1. STYLING / TOGGLE: ``getSVG`` emits hidden lines with a fixed inline grey
#      colour and no stable class hook. This builder emits the visible edges in
#      a ``class="hlr-visible"`` group (solid) and the hidden edges in a
#      SEPARATE ``class="hlr-hidden"`` group (``stroke-dasharray``), so the
#      renderer can style / show / hide each layer.
#   2. SNAP CONSISTENCY: the projector is the SAME
#      ``gp_Ax2(gp_Pnt(), gp_Dir(*direction))`` that
#      ``cadquery_drawing_geometry.extract_drawing_geometry`` (the snap-point
#      source) uses, and this builder writes the RAW projected ``(x, y)`` into
#      the ``<path d>`` data under the SAME ``<g transform="scale(s,-s)
#      translate(..)">`` wrapper convention ``getSVG`` uses. So the path
#      coordinate NUMBERS match the snap coordinates -- a dimension anchored to
#      a snap point lands exactly on this linework.
#
# The transform math (``unitScale`` / ``xTranslate`` / ``yTranslate``) mirrors
# CadQuery's ``getSVG`` exactly (fit-to-canvas at ``bb_scale = 0.75``) so an
# HLR drawing frames identically to the non-HLR one for the same view.


# ``bb_scale`` from CadQuery's ``getSVG``: the projected bbox is fit to 75 % of
# the canvas so there is a margin around the linework. Kept in lock-step so the
# HLR and non-HLR projections frame identically.
_HLR_BB_SCALE = 0.75


def _hlr_path_data(polyline: list) -> str:
    """Render one projected 2D polyline as SVG ``<path d>`` data.

    Mirrors CadQuery's ``makeSVGedge``: ``M`` to the first point then ``L`` to
    each subsequent point, writing the RAW projected coordinate numbers (the
    ``<g transform>`` wrapper handles visual placement). A trailing space after
    each command matches the ``getSVG`` template so downstream string handling
    (e.g. detail-view re-hosting) sees the same shape.
    """
    if not polyline:
        return ""
    head = polyline[0]
    parts = [f"M{head[0]},{head[1]} "]
    for pt in polyline[1:]:
        parts.append(f"L{pt[0]},{pt[1]} ")
    return "".join(parts)


def _build_hlr_svg(
    visible: list,
    hidden: list,
    bbox2d: Dict[str, list],
    opts: Dict[str, Any],
) -> str:
    """Compose the inline HLR SVG from projected visible + hidden linework.

    ``visible`` / ``hidden`` are lists of 2D ``[[x, y], ...]`` polylines from
    ``cadquery_hlr.project_view_edges``; ``bbox2d`` is that call's 2D bbox.
    ``opts`` is the standard ``_build_svg_opts`` dict (canvas size, margins,
    colours, strokeWidth). Returns a self-contained SVG string.

    The transform math is byte-for-byte the same fit-to-canvas logic
    ``getSVG`` uses, so an HLR drawing sits in the same place a non-HLR one
    would for the same view -- and the raw path coordinates stay in the snap
    coordinate space (see the module note above).
    """
    width = float(opts["width"])
    height = float(opts["height"])
    margin_left = float(opts.get("marginLeft", 10))
    margin_top = float(opts.get("marginTop", 10))
    stroke_width = float(opts.get("strokeWidth", 0.25))
    stroke_color = ",".join(str(int(c)) for c in opts.get("strokeColor", (0, 0, 0)))
    hidden_color = ",".join(
        str(int(c)) for c in opts.get("hiddenColor", (160, 160, 160))
    )

    bmin = bbox2d.get("min", [0.0, 0.0])
    bmax = bbox2d.get("max", [0.0, 0.0])
    xlen = max(bmax[0] - bmin[0], 1e-9)
    ylen = max(bmax[1] - bmin[1], 1e-9)

    # Fit-to-canvas at 75 % (getSVG's ``bb_scale``). Guard a degenerate zero
    # extent so a single-edge / point projection still yields a finite scale.
    unit_scale = min(
        width / xlen * _HLR_BB_SCALE, height / ylen * _HLR_BB_SCALE
    )
    if not math.isfinite(unit_scale) or unit_scale <= 0:
        unit_scale = 1.0

    x_translate = (0.0 - bmin[0]) + margin_left / unit_scale
    y_translate = (0.0 - bmax[1]) - margin_top / unit_scale

    visible_content = "".join(
        f"\t\t\t<path d=\"{_hlr_path_data(poly)}\" />\n" for poly in visible if poly
    )
    hidden_content = "".join(
        f"\t\t\t<path d=\"{_hlr_path_data(poly)}\" />\n" for poly in hidden if poly
    )

    return (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n"
        "<svg\n"
        "   xmlns:svg=\"http://www.w3.org/2000/svg\"\n"
        "   xmlns=\"http://www.w3.org/2000/svg\"\n"
        f"   width=\"{width}\"\n"
        f"   height=\"{height}\"\n"
        "\n"
        ">\n"
        f"    <g transform=\"scale({unit_scale}, -{unit_scale})   "
        f"translate({x_translate},{y_translate})\" "
        f"stroke-width=\"{stroke_width}\"  fill=\"none\">\n"
        "       <!-- hidden lines (HLR) -->\n"
        f"       <g class=\"hlr-hidden\" stroke=\"rgb({hidden_color})\" fill=\"none\" "
        f"stroke-dasharray=\"{stroke_width},{stroke_width}\" >\n"
        f"{hidden_content}"
        "       </g>\n"
        "\n"
        "       <!-- solid lines (HLR) -->\n"
        f"       <g class=\"hlr-visible\" stroke=\"rgb({stroke_color})\" fill=\"none\">\n"
        f"{visible_content}"
        "       </g>\n"
        "    </g>\n"
        "\n"
        "</svg>\n"
    )


def _project_to_drawing_hlr(
    workplane: Any, view: str, opts: Dict[str, Any]
) -> Optional[str]:
    """Build the inline HLR SVG for ``view``, or ``None`` to signal fallback.

    Resolves the workplane's solid, runs ``cadquery_hlr.project_view_edges``
    with the view's projection direction, and composes the SVG via
    :func:`_build_hlr_svg`. Returns ``None`` (caller falls back to the standard
    ``getSVG`` path) when:

      * the OCP HLR bindings are unavailable (``ocp_hlr_not_available``), or
      * the handle has no resolvable solid (a bare sketch / wire).

    A genuine mid-pipeline OCCT failure re-raises as ``drawing_error`` so the
    operator sees the error rather than a silently-degraded drawing.
    """
    from .cadquery_hlr import project_view_edges  # noqa: PLC0415 - lazy / optional

    direction = _validate_view(view)
    try:
        shape = workplane.findSolid().wrapped
    except Exception:  # noqa: BLE001 - no solid (sketch/wire) -> fall back
        return None

    try:
        projected = project_view_edges(shape, direction, tolerance_mm=0.1)
    except _CadHandlerError as exc:
        if exc.code == "ocp_hlr_not_available":
            return None  # graceful degradation to getSVG (which also does HLR)
        raise _CadHandlerError(
            "drawing_error",
            f"HLR drawing projection failed: {exc}",
            detail=getattr(exc, "detail", None),
        ) from exc

    return _build_hlr_svg(
        projected.get("visible", []),
        projected.get("hidden", []),
        projected.get("bbox2d", {"min": [0.0, 0.0], "max": [0.0, 0.0]}),
        opts,
    )


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


# ─────────────────────────────────────────────────────────────────────────
# CAD V1.5 — Drawing dimensions / sections / title block
# ─────────────────────────────────────────────────────────────────────────
#
# Pure-Python helpers that extend ``project_to_drawing`` with the three
# affordances mechanical drafting demands beyond a bare orthographic view:
#
#   * :func:`dimension_drawing`  — overlay a dimension annotation layer
#     (point-to-point distance / radius / diameter / angle) on top of the
#     SVG returned by ``project_to_drawing``. Pure SVG composition; no
#     CadQuery call needed once the base projection is in hand.
#   * :func:`section_drawing`    — re-project the body after slicing it
#     with a half-space (``cq.Workplane.cut`` against an infinite box on
#     one side of a cutting plane) so the resulting drawing reveals the
#     interior cross-section. Honours the same view-name vocabulary as
#     :func:`project_to_drawing` so the renderer can keep the "Front /
#     Top / Right / Iso" toolbar consistent.
#   * :func:`attach_title_block` — stamp a small SVG ``<g>`` block carrying
#     drawing name / scale / author / date / sheet N of M into the
#     bottom-right of any SVG. Operates on the SVG text directly so the
#     same function works for plain projections, dimensioned drawings,
#     and section views.
#
# Why "compose SVG strings" instead of "re-run CadQuery with annotations"?
# ----------------------------------------------------------------------
# CadQuery's exporter has no first-class dimension primitive — the
# ``cq.Sketch`` API can host construction lines but the resulting SVG
# would not carry the leader-line + arrowhead + text-anchor structure a
# mechanical drawing needs. Composing SVG by hand keeps the dimension
# layer renderer-friendly (CSS-stylable, easy to test, no CadQuery
# version dependency) while letting the base projection stay authoritative
# for the linework.
#
# Safety Rule 1 reminder: this layer DOES NOT emit G-code or STL. The
# annotated SVG never feeds the CAM pipeline (which keys off the raw STL
# from ``cad.tessellate``).
#
# Error vocabulary (raised as ``_CadHandlerError`` for symmetry with the
# existing surface):
#   * ``bad_params``        — empty SVG, bad dimension spec, unknown
#                              dimension kind, non-finite numeric, …
#   * ``invalid_handle``    — caller's handle is not in the table.
#   * ``section_error``     — CadQuery raised during the cut/half-space.
#   * ``drawing_error``     — fallback when a CadQuery-backed step raised.


# Dimension kinds supported in V1.5. Each kind has a different shape on
# the wire — kept narrow on purpose so a typo at the IPC boundary fails
# fast with ``bad_params``.
ALLOWED_DIMENSION_KINDS: Tuple[str, ...] = (
    "distance",  # point-to-point linear distance (two 2D points + offset)
    "radius",    # circular feature radius (centre + a point on the arc)
    "diameter",  # circular feature diameter (centre + a point on the arc)
    "angle",     # angle between two line segments (4 endpoints)
)


def _require_finite_number(value: Any, field: str) -> float:
    """Validate ``value`` is a finite real number. Raises ``bad_params``.

    Pulled out so every dimension validator shares one definition of "finite
    real number" — mirrors ``_require_positive_float`` in
    ``cad_handlers.py`` but here we allow zero / negative for coordinates.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _CadHandlerError(
            "bad_params", f"{field} must be a number, got {type(value).__name__}"
        )
    f = float(value)
    if not math.isfinite(f):
        raise _CadHandlerError(
            "bad_params", f"{field} must be finite, got {value!r}"
        )
    return f


def _require_point2d(value: Any, field: str) -> Tuple[float, float]:
    """Validate a 2D point spec ``{"x": float, "y": float}``."""
    if not isinstance(value, dict):
        raise _CadHandlerError(
            "bad_params", f"{field} must be an object with x/y keys"
        )
    return (
        _require_finite_number(value.get("x"), f"{field}.x"),
        _require_finite_number(value.get("y"), f"{field}.y"),
    )


def _format_number(n: float) -> str:
    """Format a float for the dimension label. Trim trailing zeros.

    Drafting convention: two decimal places, no trailing zeros, no decimal
    point if the value is integer-valued. Keeps the dimension layer
    readable on a small drawing without dragging in locale formatting.
    """
    if abs(n - round(n)) < 1e-6:
        return f"{int(round(n))}"
    out = f"{n:.2f}"
    if "." in out:
        out = out.rstrip("0").rstrip(".")
    return out


def _build_distance_dimension_svg(
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    offset: float,
    label: Optional[str],
) -> str:
    """Build the SVG markup for a point-to-point distance dimension.

    Renders a witness-line + dimension-line + arrowhead + text-label tuple
    in the standard drafting style. ``offset`` shifts the dimension line
    perpendicular to the measured vector so it sits outside the part
    outline. Sign of ``offset`` picks the side.
    """
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    length = math.hypot(dx, dy)
    if length < 1e-9:
        raise _CadHandlerError(
            "bad_params", "distance dimension endpoints coincide"
        )
    # Perpendicular unit vector (rotate 90° CCW).
    nx = -dy / length
    ny = dx / length
    a = (p1[0] + nx * offset, p1[1] + ny * offset)
    b = (p2[0] + nx * offset, p2[1] + ny * offset)
    mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
    text = label if label is not None else _format_number(length)
    return (
        "<g class=\"dim dim--distance\" stroke=\"#1a73e8\" "
        "fill=\"#1a73e8\" stroke-width=\"0.2\">"
        f"<line x1=\"{p1[0]:.3f}\" y1=\"{p1[1]:.3f}\" "
        f"x2=\"{a[0]:.3f}\" y2=\"{a[1]:.3f}\" />"
        f"<line x1=\"{p2[0]:.3f}\" y1=\"{p2[1]:.3f}\" "
        f"x2=\"{b[0]:.3f}\" y2=\"{b[1]:.3f}\" />"
        f"<line x1=\"{a[0]:.3f}\" y1=\"{a[1]:.3f}\" "
        f"x2=\"{b[0]:.3f}\" y2=\"{b[1]:.3f}\" />"
        f"<text x=\"{mid[0]:.3f}\" y=\"{mid[1]:.3f}\" "
        "text-anchor=\"middle\" font-size=\"3.5\" "
        "stroke=\"none\" font-family=\"sans-serif\">"
        f"{_xml_escape(text)}</text>"
        "</g>"
    )


def _build_radius_dimension_svg(
    center: Tuple[float, float],
    edge: Tuple[float, float],
    label: Optional[str],
    is_diameter: bool,
) -> str:
    """Build the SVG markup for a radius or diameter dimension.

    Drafting convention: the leader runs from the centre to a point on
    the arc, prefixed with "R" (radius) or "Ø" (diameter) in the label.
    """
    dx = edge[0] - center[0]
    dy = edge[1] - center[1]
    radius = math.hypot(dx, dy)
    if radius < 1e-9:
        raise _CadHandlerError(
            "bad_params",
            "radius/diameter dimension edge point coincides with centre",
        )
    measurement = radius * 2.0 if is_diameter else radius
    prefix = "Ø" if is_diameter else "R"
    text = label if label is not None else f"{prefix}{_format_number(measurement)}"
    css_class = "dim--diameter" if is_diameter else "dim--radius"
    return (
        f"<g class=\"dim {css_class}\" stroke=\"#1a73e8\" "
        "fill=\"#1a73e8\" stroke-width=\"0.2\">"
        f"<line x1=\"{center[0]:.3f}\" y1=\"{center[1]:.3f}\" "
        f"x2=\"{edge[0]:.3f}\" y2=\"{edge[1]:.3f}\" />"
        f"<text x=\"{edge[0]:.3f}\" y=\"{edge[1]:.3f}\" "
        "text-anchor=\"start\" font-size=\"3.5\" "
        "stroke=\"none\" font-family=\"sans-serif\">"
        f"{_xml_escape(text)}</text>"
        "</g>"
    )


def _build_angle_dimension_svg(
    vertex: Tuple[float, float],
    arm1: Tuple[float, float],
    arm2: Tuple[float, float],
    label: Optional[str],
) -> str:
    """Build the SVG markup for an angle dimension between two arms.

    Drafting convention: an arc segment near the vertex linking the two
    arms, plus a degree-formatted text label.
    """
    a1x = arm1[0] - vertex[0]
    a1y = arm1[1] - vertex[1]
    a2x = arm2[0] - vertex[0]
    a2y = arm2[1] - vertex[1]
    l1 = math.hypot(a1x, a1y)
    l2 = math.hypot(a2x, a2y)
    if l1 < 1e-9 or l2 < 1e-9:
        raise _CadHandlerError(
            "bad_params", "angle dimension arm has zero length"
        )
    dot = (a1x * a2x + a1y * a2y) / (l1 * l2)
    dot = max(-1.0, min(1.0, dot))
    angle_rad = math.acos(dot)
    angle_deg = math.degrees(angle_rad)
    text = label if label is not None else f"{_format_number(angle_deg)}°"
    # Arc radius scales with the shorter arm so it stays inside both arms.
    arc_r = min(l1, l2) * 0.3
    if arc_r < 1e-3:
        arc_r = 1.0
    a1_unit = (a1x / l1, a1y / l1)
    a2_unit = (a2x / l2, a2y / l2)
    p1 = (vertex[0] + a1_unit[0] * arc_r, vertex[1] + a1_unit[1] * arc_r)
    p2 = (vertex[0] + a2_unit[0] * arc_r, vertex[1] + a2_unit[1] * arc_r)
    # Mid-angle for label placement.
    cross = a1x * a2y - a1y * a2x
    large_arc = 0
    sweep = 1 if cross < 0 else 0
    mid_angle = math.atan2(
        (a1_unit[1] + a2_unit[1]) / 2.0,
        (a1_unit[0] + a2_unit[0]) / 2.0,
    )
    text_pos = (
        vertex[0] + math.cos(mid_angle) * arc_r * 1.6,
        vertex[1] + math.sin(mid_angle) * arc_r * 1.6,
    )
    return (
        "<g class=\"dim dim--angle\" stroke=\"#1a73e8\" "
        "fill=\"none\" stroke-width=\"0.2\">"
        f"<path d=\"M {p1[0]:.3f} {p1[1]:.3f} "
        f"A {arc_r:.3f} {arc_r:.3f} 0 {large_arc} {sweep} "
        f"{p2[0]:.3f} {p2[1]:.3f}\" />"
        f"<text x=\"{text_pos[0]:.3f}\" y=\"{text_pos[1]:.3f}\" "
        "text-anchor=\"middle\" font-size=\"3.5\" "
        "stroke=\"none\" fill=\"#1a73e8\" font-family=\"sans-serif\">"
        f"{_xml_escape(text)}</text>"
        "</g>"
    )


def _validate_dimension_spec(spec: Any, index: int) -> Dict[str, Any]:
    """Validate a single dimension spec; return a normalized dict.

    Wire shapes (one per kind)::

      {"kind": "distance", "p1": {"x", "y"}, "p2": {"x", "y"},
       "offset"?: number, "label"?: string}
      {"kind": "radius",   "center": {"x", "y"}, "edge": {"x", "y"},
       "label"?: string}
      {"kind": "diameter", "center": {"x", "y"}, "edge": {"x", "y"},
       "label"?: string}
      {"kind": "angle",    "vertex": {"x", "y"}, "arm1": {"x", "y"},
       "arm2": {"x", "y"}, "label"?: string}
    """
    if not isinstance(spec, dict):
        raise _CadHandlerError(
            "bad_params",
            f"dimensions[{index}] must be an object, got "
            f"{type(spec).__name__}",
        )
    kind = spec.get("kind")
    if kind not in ALLOWED_DIMENSION_KINDS:
        raise _CadHandlerError(
            "bad_params",
            f"dimensions[{index}].kind must be one of "
            f"{sorted(ALLOWED_DIMENSION_KINDS)}, got {kind!r}",
        )
    label = spec.get("label")
    if label is not None and not isinstance(label, str):
        raise _CadHandlerError(
            "bad_params",
            f"dimensions[{index}].label must be a string when provided",
        )
    if kind == "distance":
        p1 = _require_point2d(spec.get("p1"), f"dimensions[{index}].p1")
        p2 = _require_point2d(spec.get("p2"), f"dimensions[{index}].p2")
        offset_raw = spec.get("offset", 8.0)
        offset = _require_finite_number(offset_raw, f"dimensions[{index}].offset")
        return {"kind": kind, "p1": p1, "p2": p2, "offset": offset, "label": label}
    if kind in ("radius", "diameter"):
        center = _require_point2d(spec.get("center"), f"dimensions[{index}].center")
        edge = _require_point2d(spec.get("edge"), f"dimensions[{index}].edge")
        return {"kind": kind, "center": center, "edge": edge, "label": label}
    # angle
    vertex = _require_point2d(spec.get("vertex"), f"dimensions[{index}].vertex")
    arm1 = _require_point2d(spec.get("arm1"), f"dimensions[{index}].arm1")
    arm2 = _require_point2d(spec.get("arm2"), f"dimensions[{index}].arm2")
    return {"kind": kind, "vertex": vertex, "arm1": arm1, "arm2": arm2, "label": label}


def _inject_layer_into_svg(svg_text: str, layer_markup: str) -> str:
    """Splice a new ``<g>`` group into an existing SVG, just before ``</svg>``.

    Returns the original svg with ``layer_markup`` appended inside the root.
    Falls back to a wrapping ``<g>`` outside the SVG if no ``</svg>`` is
    found — defensive only; CadQuery's exporter always produces a well-formed
    closing tag.
    """
    close_idx = svg_text.rfind("</svg>")
    if close_idx == -1:
        # Wrap defensively; caller asked for an annotation but we cannot
        # nest it cleanly. Return the layer separated by a newline so the
        # renderer can still render both.
        return svg_text + "\n" + layer_markup
    return svg_text[:close_idx] + layer_markup + svg_text[close_idx:]


def dimension_drawing(
    handle: str,
    view: str,
    dimensions: Any,
) -> Dict[str, Any]:
    """Project ``handle`` to a 2D SVG and overlay a dimension annotation layer.

    Wire result::

        {
          "svg":            str,    # base SVG + dimension <g> layer
          "view":           str,    # echoed view name
          "bytes":          int,    # len(svg) after UTF-8 encode
          "dimensionCount": int,    # number of dimension annotations applied
        }

    ``dimensions`` is the list of per-dimension spec dicts (see
    :func:`_validate_dimension_spec`). An empty list is allowed and round-
    trips back to the bare projection — convenient for the renderer to
    toggle the layer on/off without two separate IPC paths.

    Raises ``_CadHandlerError`` with one of:
      * ``bad_params``    — unknown view name, malformed dimension spec,
        non-finite coordinate, label of wrong type.
      * ``invalid_handle`` — handle missing from the table.
      * ``drawing_error`` / ``cadquery_not_installed`` — propagated from
        :func:`project_to_drawing`.
    """
    if not isinstance(dimensions, list):
        raise _CadHandlerError(
            "bad_params",
            "dimensions must be an array (use [] for no annotations)",
        )
    specs: list[Dict[str, Any]] = []
    for index, spec in enumerate(dimensions):
        specs.append(_validate_dimension_spec(spec, index))

    # Re-project the base view so the SVG stays in lock-step with what
    # ``cad.project_drawing`` would return for the same handle/view.
    base = project_to_drawing(handle, view=view)
    svg_text: str = base["svg"]

    if not specs:
        return {
            "svg": svg_text,
            "view": view,
            "bytes": len(svg_text.encode("utf-8")),
            "dimensionCount": 0,
        }

    parts: list[str] = ["<g class=\"dim-layer\">"]
    for spec in specs:
        kind = spec["kind"]
        if kind == "distance":
            parts.append(
                _build_distance_dimension_svg(
                    spec["p1"], spec["p2"], spec["offset"], spec["label"]
                )
            )
        elif kind == "radius":
            parts.append(
                _build_radius_dimension_svg(
                    spec["center"], spec["edge"], spec["label"], is_diameter=False
                )
            )
        elif kind == "diameter":
            parts.append(
                _build_radius_dimension_svg(
                    spec["center"], spec["edge"], spec["label"], is_diameter=True
                )
            )
        else:  # angle
            parts.append(
                _build_angle_dimension_svg(
                    spec["vertex"], spec["arm1"], spec["arm2"], spec["label"]
                )
            )
    parts.append("</g>")
    layer = "".join(parts)
    out_svg = _inject_layer_into_svg(svg_text, layer)
    return {
        "svg": out_svg,
        "view": view,
        "bytes": len(out_svg.encode("utf-8")),
        "dimensionCount": len(specs),
    }


# ── Section drawings ─────────────────────────────────────────────────────


# Section-plane axis vocabulary. The renderer's "Sections" toggle picks
# from this set — anything else fails fast with ``bad_params``.
ALLOWED_SECTION_AXES: Tuple[str, ...] = ("x", "y", "z")


def _validate_section_plane(plane: Any) -> Dict[str, Any]:
    """Validate the section plane spec ``{"axis": str, "offset": float, ...}``.

    Wire shape::

        {"axis": "x" | "y" | "z",   # plane normal
         "offset": number,           # signed plane offset along the axis (mm)
         "keepSide"?: "positive" | "negative"}   # which half to keep
    """
    if not isinstance(plane, dict):
        raise _CadHandlerError(
            "bad_params", "plane must be an object with axis/offset keys"
        )
    axis = plane.get("axis")
    if axis not in ALLOWED_SECTION_AXES:
        raise _CadHandlerError(
            "bad_params",
            f"plane.axis must be one of {sorted(ALLOWED_SECTION_AXES)}, "
            f"got {axis!r}",
        )
    offset = _require_finite_number(plane.get("offset", 0.0), "plane.offset")
    side_raw = plane.get("keepSide", "positive")
    if side_raw not in ("positive", "negative"):
        raise _CadHandlerError(
            "bad_params",
            "plane.keepSide must be 'positive' or 'negative' when provided",
        )
    return {"axis": axis, "offset": offset, "keepSide": side_raw}


# Default cutting-plane label when the renderer doesn't supply one. Classical
# drafting convention names the first section "A-A".
DEFAULT_SECTION_LABEL = "A-A"

# Cutting-plane label cap. The label is operator free-text routed through
# ``_xml_escape`` before it ever reaches a ``<text>`` node (Safety Rule 4 —
# the section SVG is rendered via ``dangerouslySetInnerHTML`` in the
# renderer's DrawingView). Bound the length so a pathological paste can't
# bloat the markup.
_SECTION_LABEL_MAX = 24


def _validate_section_label(label: Any) -> str:
    """Validate + normalize the optional cutting-plane label.

    ``None`` falls back to :data:`DEFAULT_SECTION_LABEL` ("A-A"). A supplied
    value MUST be a string; control characters are stripped and the result is
    capped at :data:`_SECTION_LABEL_MAX`. The caller is responsible for
    routing the result through :func:`_xml_escape` before injecting it into
    ``<text>`` markup — this validator only normalizes, it does NOT escape, so
    the escape site stays explicit and greppable at each ``<text>`` build.
    """
    if label is None:
        return DEFAULT_SECTION_LABEL
    if not isinstance(label, str):
        raise _CadHandlerError(
            "bad_params", "label must be a string when provided"
        )
    cleaned = label.replace("\x00", "").replace("\r", "").replace("\n", " ")
    cleaned = cleaned.strip()
    if not cleaned:
        return DEFAULT_SECTION_LABEL
    return cleaned[:_SECTION_LABEL_MAX]


def _section_line_geometry(
    axis: str, offset: float, width: float, height: float
) -> Tuple[float, float, float, float, bool]:
    """Resolve the cutting-plane line endpoints in SVG-mm space.

    The cutting-plane line is drawn on the PARENT view as a long straight line
    spanning the drawing, perpendicular to the section-plane normal at the
    plane's position. Returns ``(x1, y1, x2, y2, is_horizontal)``.

    Mapping (third-angle convention, matching :data:`VIEW_DIRECTIONS`):
      * ``axis == "z"`` (top-down cut): the plane shows as a HORIZONTAL line.
      * ``axis == "x"`` / ``axis == "y"``: the plane shows as a VERTICAL line.

    The CadQuery SVG exporter centres the projection in the canvas, so we
    anchor the line at the canvas mid-line and let it span the full extent.
    The exact offset-to-pixel mapping is approximate (the exporter's internal
    scale isn't surfaced) — the line communicates *where and along which axis*
    the cut runs, which is the drafting intent, not a metrology guarantee.
    """
    if axis == "z":
        # Horizontal cutting-plane line across the full width.
        y = height * 0.5
        return (0.0, y, width, y, True)
    # x / y → vertical cutting-plane line down the full height.
    x = width * 0.5
    return (x, 0.0, x, height, False)


def _build_section_line_svg(
    axis: str,
    offset: float,
    label: str,
    width: float,
    height: float,
) -> str:
    """Cutting-plane line (ASME phantom dash-dot) + escaped end labels.

    Emits a ``<g class="section-line">`` containing:
      * a long dash-dot stroke spanning the drawing along the cut axis,
      * a bold viewing-direction arrow at each terminator,
      * the escaped section ``label`` ("A-A") stamped beside each terminator.

    ``label`` is operator free-text and is routed through :func:`_xml_escape`
    before injection into the two ``<text>`` nodes (Safety Rule 4). The
    geometry attributes are all numeric and locally derived — no operator
    string reaches an attribute, only the escaped label reaches ``<text>``.
    """
    x1, y1, x2, y2, is_horizontal = _section_line_geometry(
        axis, offset, width, height
    )
    safe_label = _xml_escape(label)
    # Arrow + label placement differs per orientation so the heads point
    # toward the retained half and the labels sit clear of the line.
    if is_horizontal:
        arrows = (
            f"<path d=\"M {x1:.3f} {y1:.3f} l 6 -3 l 0 6 z\" "
            "fill=\"#b00020\" stroke=\"none\" />"
            f"<path d=\"M {x2:.3f} {y2:.3f} l -6 -3 l 0 6 z\" "
            "fill=\"#b00020\" stroke=\"none\" />"
        )
        label_a = (
            f"<text x=\"{x1 + 2.0:.3f}\" y=\"{y1 - 4.0:.3f}\" "
            "font-size=\"5\" font-weight=\"bold\" font-family=\"sans-serif\" "
            "fill=\"#b00020\" stroke=\"none\">"
            f"{safe_label}</text>"
        )
        label_b = (
            f"<text x=\"{x2 - 12.0:.3f}\" y=\"{y2 - 4.0:.3f}\" "
            "font-size=\"5\" font-weight=\"bold\" font-family=\"sans-serif\" "
            "fill=\"#b00020\" stroke=\"none\">"
            f"{safe_label}</text>"
        )
    else:
        arrows = (
            f"<path d=\"M {x1:.3f} {y1:.3f} l -3 6 l 6 0 z\" "
            "fill=\"#b00020\" stroke=\"none\" />"
            f"<path d=\"M {x2:.3f} {y2:.3f} l -3 -6 l 6 0 z\" "
            "fill=\"#b00020\" stroke=\"none\" />"
        )
        label_a = (
            f"<text x=\"{x1 + 3.0:.3f}\" y=\"{y1 + 8.0:.3f}\" "
            "font-size=\"5\" font-weight=\"bold\" font-family=\"sans-serif\" "
            "fill=\"#b00020\" stroke=\"none\">"
            f"{safe_label}</text>"
        )
        label_b = (
            f"<text x=\"{x2 + 3.0:.3f}\" y=\"{y2 - 4.0:.3f}\" "
            "font-size=\"5\" font-weight=\"bold\" font-family=\"sans-serif\" "
            "fill=\"#b00020\" stroke=\"none\">"
            f"{safe_label}</text>"
        )
    return (
        "<g class=\"section-line\" stroke=\"#b00020\" stroke-width=\"0.6\" "
        "fill=\"none\">"
        f"<line x1=\"{x1:.3f}\" y1=\"{y1:.3f}\" "
        f"x2=\"{x2:.3f}\" y2=\"{y2:.3f}\" "
        "stroke-dasharray=\"12 3 2 3\" />"
        f"{arrows}{label_a}{label_b}"
        "</g>"
    )


def _project_ring_to_2d(
    ring: list, axis: str
) -> list:
    """Drop the section-plane normal axis from a 3D ring → 2D ``(u, v)`` ring.

    ``ring`` is a list of ``[x, y, z]`` points (the shape ``capFaceOutline``
    exposes). For a cut whose normal is ``axis``, the projected drawing plane
    is spanned by the OTHER two axes — drop ``axis``. The SVG canvas places
    +v downward, so the v component is negated to match screen space the same
    way the exporter does.
    """
    out: list = []
    for p in ring:
        if not isinstance(p, (list, tuple)) or len(p) < 3:
            continue
        x, y, z = float(p[0]), float(p[1]), float(p[2])
        if axis == "z":
            u, v = x, y
        elif axis == "x":
            u, v = y, z
        else:  # y
            u, v = x, z
        out.append((u, -v))
    return out


def _build_section_hatch_svg(
    rings_2d: list,
    spacing: float = 3.0,
    angle_deg: float = 45.0,
) -> str:
    """45° equally-spaced hatch fill clipped to the cut-face cap loop(s).

    ``rings_2d`` is a list of ``(u, v)`` polylines — the 2D projection of the
    HLR ``capFaceOutline`` rings (see :func:`_project_ring_to_2d`). Emits a
    ``<g class="section-hatch">`` carrying:
      * a ``<clipPath>`` built from the ring polygons,
      * a ``<pattern>`` of evenly-spaced 45° lines (ASME section lining),
      * a ``<path>`` of the ring polygons, clipped to itself and filled with
        the hatch pattern.

    Returns ``""`` when no usable ring is supplied (graceful no-op: the
    section line + label still stamp without the hatch). This markup carries
    NO operator free-text, so no escaping is required here — every value is
    numeric and locally derived. The unique ``clipPath`` / ``pattern`` ids are
    fixed constants scoped under the ``section-hatch`` group.
    """
    polygons: list = []
    for ring in rings_2d:
        pts = [p for p in ring if isinstance(p, (list, tuple)) and len(p) >= 2]
        if len(pts) >= 3:
            polygons.append(pts)
    if not polygons:
        return ""

    def _poly_d(poly: list) -> str:
        head = poly[0]
        body = "".join(f"L {p[0]:.3f} {p[1]:.3f} " for p in poly[1:])
        return f"M {head[0]:.3f} {head[1]:.3f} {body}Z"

    path_d = " ".join(_poly_d(poly) for poly in polygons)
    sp = spacing if spacing > 0 else 3.0
    # A 45° pattern tile: a diagonal line across a ``sp × sp`` cell. Two
    # segments give an unbroken diagonal field when the tile repeats.
    pattern = (
        f"<pattern id=\"section-hatch-pattern\" width=\"{sp:.3f}\" "
        f"height=\"{sp:.3f}\" patternUnits=\"userSpaceOnUse\" "
        f"patternTransform=\"rotate({angle_deg:.1f})\">"
        f"<line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"{sp:.3f}\" "
        "stroke=\"#444\" stroke-width=\"0.3\" />"
        "</pattern>"
    )
    clip = (
        "<clipPath id=\"section-hatch-clip\">"
        f"<path d=\"{path_d}\" />"
        "</clipPath>"
    )
    fill = (
        f"<path d=\"{path_d}\" fill=\"url(#section-hatch-pattern)\" "
        "stroke=\"none\" clip-path=\"url(#section-hatch-clip)\" />"
    )
    outline = (
        f"<path d=\"{path_d}\" fill=\"none\" stroke=\"#222\" "
        "stroke-width=\"0.4\" />"
    )
    return (
        "<g class=\"section-hatch\">"
        f"<defs>{pattern}{clip}</defs>"
        f"{fill}{outline}"
        "</g>"
    )


def _compute_section_cap_rings_2d(
    handle: str, axis: str, offset: float, view: str
) -> list:
    """Best-effort: derive the 2D cut-face ring(s) for the hatch via HLR.

    Lazily imports :mod:`cadquery_hlr` and calls its ``hlr_section`` to get
    ``capFaceOutline`` (3D rings), then projects each ring to 2D by dropping
    the section-plane normal axis. Returns ``[]`` on ANY failure (HLR bindings
    missing / cut misses the body / handle not HLR-resolvable) so the caller
    degrades to a line-only section rather than aborting — this preserves the
    existing ``ocp_hlr_not_available`` graceful-degradation contract.
    """
    try:
        from . import cadquery_hlr  # noqa: PLC0415 - optional, lazy
    except Exception:  # noqa: BLE001 - module import may fail in slim envs
        return []
    normal = {
        "x": (1.0, 0.0, 0.0),
        "y": (0.0, 1.0, 0.0),
        "z": (0.0, 0.0, 1.0),
    }[axis]
    view_dir = VIEW_DIRECTIONS.get(view, (0.0, 1.0, 0.0))
    try:
        result = cadquery_hlr.hlr_section(
            handle, normal, offset, view_dir
        )
    except Exception:  # noqa: BLE001 - any HLR failure → skip hatch only
        return []
    cap_outline = result.get("capFaceOutline") if isinstance(result, dict) else None
    if not isinstance(cap_outline, list):
        return []
    rings_2d: list = []
    for ring in cap_outline:
        if isinstance(ring, list):
            projected = _project_ring_to_2d(ring, axis)
            if len(projected) >= 3:
                rings_2d.append(projected)
    return rings_2d


def section_drawing(
    handle: str,
    view: str,
    plane: Any,
    label: Optional[str] = None,
    show_hatch: bool = True,
    show_section_line: bool = True,
) -> Dict[str, Any]:
    """Slice the body behind ``handle`` with a plane and project the result.

    Wire result::

        {
          "svg":   str,           # SVG of the sectioned body + annotations
          "view":  str,           # echoed view name
          "bytes": int,
          "plane": {"axis": str, "offset": float, "keepSide": str},
          "label": str,           # escaped cutting-plane label ("A-A")
        }

    Implementation: clones the workplane, subtracts an infinite half-space
    on the unwanted side of the plane, and re-runs the standard projection
    pipeline. The handle in the table is NOT mutated — the cloned body is
    tessellated/projected and then discarded.

    Annotations (additive, backward-compatible defaults):
      * ``label`` — cutting-plane label, defaults to ``"A-A"``. Operator
        free-text; routed through :func:`_xml_escape` before reaching any
        ``<text>`` node (Safety Rule 4).
      * ``show_section_line`` — stamp the ASME dash-dot cutting-plane line +
        escaped labels on the projected view (default on).
      * ``show_hatch`` — fill the cut-face cap loop(s) with a 45° hatch,
        clipped to the cap outline derived from the HLR ``capFaceOutline``
        (default on). Degrades to a no-op when HLR bindings are unavailable —
        the section line + label still stamp.

    Raises ``_CadHandlerError`` with one of:
      * ``bad_params``    — bad axis / non-finite offset / unknown view /
        non-string label.
      * ``invalid_handle`` — handle missing from the table.
      * ``section_error`` — CadQuery raised during the cut.
      * ``drawing_error`` / ``cadquery_not_installed`` — propagated.
    """
    spec = _validate_section_plane(plane)
    normalized_label = _validate_section_label(label)
    workplane = _resolve_handle(handle)
    _validate_view(view)  # raises if unknown — bail before touching CadQuery

    try:
        import cadquery as cq  # noqa: PLC0415 - optional dependency
    except ImportError as exc:
        raise _CadHandlerError(
            "cadquery_not_installed",
            "CadQuery is not installed in the sidecar's Python environment",
            detail=str(exc),
        ) from exc

    try:
        # Compute a generous half-space box. The body's bbox bounds the
        # extent we need to cover; pad heavily so a thin shell on either
        # side of the plane never extends past the box.
        # We pull bbox from CadQuery's val() — works for both Solid and
        # Workplane primary results.
        try:
            solid = workplane.val()  # CadQuery Solid / Compound
            bbox = solid.BoundingBox()
            min_pt = (bbox.xmin, bbox.ymin, bbox.zmin)
            max_pt = (bbox.xmax, bbox.ymax, bbox.zmax)
        except Exception:
            # Fall back to a fixed huge box; section will still work for
            # any body fitting inside ±5000 mm in every axis.
            min_pt = (-5000.0, -5000.0, -5000.0)
            max_pt = (5000.0, 5000.0, 5000.0)
        span = max(
            max_pt[0] - min_pt[0],
            max_pt[1] - min_pt[1],
            max_pt[2] - min_pt[2],
            1.0,
        )
        pad = span * 2.0 + 100.0
        axis = spec["axis"]
        offset = spec["offset"]
        keep_side = spec["keepSide"]
        # Build the half-space box geometry. "positive" keeps the part of
        # the body where coord > offset; "negative" keeps coord < offset.
        # We CUT the *opposite* half from the body (an infinite slab along
        # the other axes).
        if axis == "x":
            cx = (offset - pad) if keep_side == "positive" else (offset + pad)
            cut_box = (
                cq.Workplane("YZ")
                .center(0, 0)
                .box(pad * 2.0, pad * 2.0, pad * 2.0)
                .translate((cx, 0, 0))
            )
        elif axis == "y":
            cy = (offset - pad) if keep_side == "positive" else (offset + pad)
            cut_box = (
                cq.Workplane("XZ")
                .center(0, 0)
                .box(pad * 2.0, pad * 2.0, pad * 2.0)
                .translate((0, cy, 0))
            )
        else:  # z
            cz = (offset - pad) if keep_side == "positive" else (offset + pad)
            cut_box = (
                cq.Workplane("XY")
                .center(0, 0)
                .box(pad * 2.0, pad * 2.0, pad * 2.0)
                .translate((0, 0, cz))
            )
        sectioned = workplane.cut(cut_box)
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "section_error",
            f"CadQuery section operation failed: {exc}",
            detail=str(exc),
        ) from exc

    opts = _build_svg_opts(view)
    try:
        svg_text = cq.exporters.getSVG(
            cq.exporters.toCompound(sectioned), opts=opts
        )
    except AttributeError:
        svg_text = _export_via_generic_path(sectioned, opts)
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "drawing_error",
            f"CadQuery SVG projection failed after section: {exc}",
            detail=str(exc),
        ) from exc

    if not isinstance(svg_text, str) or not svg_text:
        raise _CadHandlerError(
            "drawing_error",
            "CadQuery SVG export returned empty output after section",
        )

    # ── Annotation layers (cutting-plane line + 45° cut-face hatch) ──────
    # Composed by hand and spliced before ``</svg>`` via the same
    # ``_inject_layer_into_svg`` the dimension layer uses. The hatch is
    # best-effort: it needs the HLR cap outline, which may be unavailable in
    # a slim env — in that case it silently drops and only the line stamps.
    width, height = _parse_svg_dimensions(svg_text)
    layer_parts: list[str] = []
    if show_hatch:
        rings_2d = _compute_section_cap_rings_2d(
            handle, spec["axis"], spec["offset"], view
        )
        hatch_markup = _build_section_hatch_svg(rings_2d)
        if hatch_markup:
            layer_parts.append(hatch_markup)
    if show_section_line:
        layer_parts.append(
            _build_section_line_svg(
                spec["axis"], spec["offset"], normalized_label, width, height
            )
        )
    if layer_parts:
        svg_text = _inject_layer_into_svg(svg_text, "".join(layer_parts))

    return {
        "svg": svg_text,
        "view": view,
        "bytes": len(svg_text.encode("utf-8")),
        "plane": spec,
        "label": _xml_escape(normalized_label),
    }


# ── Detail (crop) views ──────────────────────────────────────────────────
#
# A detail view crops a circular region of a parent projection and magnifies
# it (e.g. 2:1) so a small feature reads clearly on the sheet — the classic
# "DETAIL A" callout in mechanical drafting. Unlike :func:`section_drawing`
# (which re-runs the CadQuery cut), the crop is a pure SVG re-frame: project
# the parent view ONCE, then re-host its linework inside a fresh ``<svg>``
# whose ``viewBox`` selects the crop window and whose pixel ``width`` /
# ``height`` are ``scale ×`` that window — so the browser does the
# magnification and the output carries a genuinely scaled ``viewBox``.
#
# Coordinate space
# ----------------
# The renderer resolves the operator's click through
# ``clientToSvgCoord(... getScreenCTM().inverse())`` against the parent SVG
# root, which carries NO ``viewBox`` (CadQuery's ``getSVG`` template emits a
# bare ``<svg width=.. height=..>``). The SVG user-space therefore equals the
# root's pixel space, so the ``center`` / ``radiusMm`` this method receives
# are already in that same pixel/user space as the parent's linework. The
# crop window and the stamped detail circle live in that one space — no
# parsing of CadQuery's inner ``<g transform="scale(..)">`` is needed (and
# none is done, keeping this robust across exporter versions).
#
# Safety Rule 4 — the ``label`` ("DETAIL A") is operator free-text rendered
# via ``dangerouslySetInnerHTML`` downstream, so it is routed through
# :func:`_xml_escape` before it reaches the ``<text>`` node.


# Default detail-view label when the renderer doesn't supply one. Classical
# drafting convention names the first detail "DETAIL A".
DEFAULT_DETAIL_LABEL = "DETAIL A"

# Detail-label length cap (mirrors :data:`_SECTION_LABEL_MAX`). The label is
# operator free-text routed through :func:`_xml_escape` before it ever reaches
# a ``<text>`` node (Safety Rule 4). Bound the length so a pathological paste
# can't bloat the SVG.
_DETAIL_LABEL_MAX = 48


def _validate_detail_label(label: Any) -> str:
    """Validate + normalize the optional detail-view label.

    ``None`` falls back to :data:`DEFAULT_DETAIL_LABEL` ("DETAIL A"). A supplied
    value MUST be a string; control characters are stripped and the result is
    capped at :data:`_DETAIL_LABEL_MAX`. The caller is responsible for routing
    the result through :func:`_xml_escape` before injecting it into ``<text>``
    markup — this validator only normalizes, it does NOT escape, so the escape
    site stays explicit and greppable at the ``<text>`` build (Safety Rule 4).
    """
    if label is None:
        return DEFAULT_DETAIL_LABEL
    if not isinstance(label, str):
        raise _CadHandlerError(
            "bad_params", "label must be a string when provided"
        )
    cleaned = label.replace("\x00", "").replace("\r", "").replace("\n", " ")
    cleaned = cleaned.strip()
    if not cleaned:
        return DEFAULT_DETAIL_LABEL
    return cleaned[:_DETAIL_LABEL_MAX]


def _require_positive_finite(value: Any, field: str) -> float:
    """Validate ``value`` is a finite real number STRICTLY greater than zero.

    Mirrors :func:`_require_finite_number` but rejects zero / negative — a
    crop radius or magnification factor of zero is degenerate, so it fails
    fast with ``bad_params`` rather than emitting an empty / inverted view.
    """
    f = _require_finite_number(value, field)
    if f <= 0.0:
        raise _CadHandlerError(
            "bad_params", f"{field} must be greater than zero, got {value!r}"
        )
    return f


# Matches CadQuery's ``getSVG`` root open tag so we can split the parent SVG
# into "everything inside the root" (the linework ``<g>`` + axes) and re-host
# it inside the detail ``<svg>``. The template emits a multi-line, attribute-
# rich ``<svg ...>`` open tag, so the match is DOTALL + non-greedy up to the
# first ``>`` that closes the open tag.
_SVG_ROOT_OPEN_RE = re.compile(r"<svg\b[^>]*>", re.IGNORECASE | re.DOTALL)


def _extract_svg_inner(svg_text: str) -> Optional[str]:
    """Return the markup BETWEEN the root ``<svg ...>`` and ``</svg>``.

    This is the parent's projected linework (CadQuery's ``<g transform=..>``
    wrapper + any axes indicator) which the detail view re-hosts unchanged
    inside its own ``<svg>`` + ``<clipPath>``. Returns ``None`` when the SVG
    is not well-formed enough to split (no root open tag or no ``</svg>``),
    so the caller can fail with ``drawing_error`` instead of emitting a
    broken detail SVG.
    """
    open_match = _SVG_ROOT_OPEN_RE.search(svg_text)
    if open_match is None:
        return None
    close_idx = svg_text.rfind("</svg>")
    if close_idx == -1 or close_idx < open_match.end():
        return None
    return svg_text[open_match.end():close_idx]


def detail_drawing(
    handle: str,
    view: str,
    center: Any,
    radius_mm: float,
    scale: float = 2.0,
    label: Optional[str] = None,
) -> Dict[str, Any]:
    """Crop a circular region of a parent projection and magnify it.

    Wire result::

        {
          "svg":      str,           # fresh <svg> framing the magnified crop
          "view":     str,           # echoed view name
          "bytes":    int,           # len(svg) after UTF-8 encode
          "center":   {"x", "y"},    # echoed crop centre (SVG/user-space)
          "radiusMm": float,         # echoed crop radius
          "scale":    float,         # echoed magnification factor
          "label":    str,           # ESCAPED detail label ("DETAIL A")
        }

    The parent view is projected ONCE via :func:`project_to_drawing`; the crop
    is then a pure SVG re-frame (no second CadQuery call). The returned SVG's
    ``viewBox`` is the crop window ``(cx-r, cy-r, 2r, 2r)`` and its pixel
    ``width`` / ``height`` are ``2r·scale`` — the browser magnifies by
    ``scale`` and the ``viewBox`` is genuinely scaled relative to the canvas.
    The parent's linework is re-hosted inside a circular ``<clipPath>`` so only
    the cropped region shows; a detail circle + the escaped ``label`` are
    stamped on top.

    ``center`` / ``radiusMm`` are in the parent SVG's user-space (== its pixel
    space; the CadQuery root carries no ``viewBox``), which is exactly what the
    renderer's ``clientToSvgCoord`` resolves a click to.

    Raises ``_CadHandlerError`` with one of:
      * ``bad_params``    — unknown view, malformed centre, non-finite /
        non-positive radius or scale, non-string label.
      * ``invalid_handle`` — handle missing from the table.
      * ``drawing_error`` / ``cadquery_not_installed`` — propagated from
        :func:`project_to_drawing` (or a parent SVG too malformed to crop).
    """
    # Validate the crop params up front (cheap, no CadQuery import) so a
    # renderer typo fails fast with the shared vocabulary before we project.
    cx, cy = _require_point2d(center, "center")
    radius = _require_positive_finite(radius_mm, "radiusMm")
    magnification = _require_positive_finite(scale, "scale")
    normalized_label = _validate_detail_label(label)
    _validate_view(view)  # raises bad_params on a typo before touching CadQuery

    base = project_to_drawing(handle, view=view)
    base_svg = base["svg"]

    inner = _extract_svg_inner(base_svg)
    if inner is None:
        raise _CadHandlerError(
            "drawing_error",
            "parent projection SVG is not well-formed enough to crop "
            "(missing <svg> root or </svg> close tag)",
        )

    safe_label = _xml_escape(normalized_label)
    # A unique-enough clip id so two detail views composited into one document
    # never collide. Derived from the crop geometry — deterministic for a given
    # crop (handy for snapshot tests) yet distinct across different crops.
    clip_id = (
        "wt-detail-clip-"
        f"{abs(hash((round(cx, 3), round(cy, 3), round(radius, 3)))) & 0xFFFFFF:06x}"
    )

    vb_x = cx - radius
    vb_y = cy - radius
    vb_size = radius * 2.0
    px_size = vb_size * magnification

    # Pretty caption: "DETAIL A (2:1)" when scale is an integer ratio, else
    # "DETAIL A (2.5×)". The base label is already escaped; the magnification
    # suffix is locally derived from a validated finite number (safe).
    if abs(magnification - round(magnification)) < 1e-6:
        caption = f"{safe_label} ({int(round(magnification))}:1)"
    else:
        caption = f"{safe_label} ({_format_number(magnification)}×)"

    detail_svg = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\"?>\n"
        "<svg xmlns=\"http://www.w3.org/2000/svg\" "
        "xmlns:svg=\"http://www.w3.org/2000/svg\" class=\"detail-view\" "
        f"width=\"{px_size:.3f}\" height=\"{px_size:.3f}\" "
        f"viewBox=\"{vb_x:.3f} {vb_y:.3f} {vb_size:.3f} {vb_size:.3f}\">"
        "<defs>"
        f"<clipPath id=\"{clip_id}\">"
        f"<circle cx=\"{cx:.3f}\" cy=\"{cy:.3f}\" r=\"{radius:.3f}\" />"
        "</clipPath>"
        "</defs>"
        # Re-host the parent linework, clipped to the crop circle.
        f"<g clip-path=\"url(#{clip_id})\">{inner}</g>"
        # Detail circle outline (drawn on top, unclipped).
        "<g class=\"detail-circle\" stroke=\"#1a73e8\" stroke-width=\"0.4\" "
        "fill=\"none\">"
        f"<circle cx=\"{cx:.3f}\" cy=\"{cy:.3f}\" r=\"{radius:.3f}\" />"
        "</g>"
        # Escaped caption stamped just inside the top of the crop circle.
        "<text class=\"detail-label\" "
        f"x=\"{cx:.3f}\" y=\"{(cy - radius + radius * 0.18):.3f}\" "
        "text-anchor=\"middle\" font-size=\"5\" font-weight=\"bold\" "
        "font-family=\"sans-serif\" fill=\"#1a73e8\" stroke=\"none\">"
        f"{caption}</text>"
        "</svg>"
    )

    return {
        "svg": detail_svg,
        "view": view,
        "bytes": len(detail_svg.encode("utf-8")),
        "center": {"x": cx, "y": cy},
        "radiusMm": radius,
        "scale": magnification,
        "label": safe_label,
    }


# ── Title-block stamp ────────────────────────────────────────────────────


# Required title-block fields. Each one MUST be a string; the renderer
# prepares the values (date stamp, sheet "1 of 1", etc.) — the sidecar
# only formats the SVG.
TITLE_BLOCK_FIELDS: Tuple[str, ...] = (
    "name", "scale", "author", "date", "sheet",
)


def _validate_title_block_metadata(metadata: Any) -> Dict[str, str]:
    """Validate the title-block metadata dict. Returns a copy with required
    fields present (empty string when absent — the renderer can stamp a
    partial block and let the operator fill the rest in later)."""
    if not isinstance(metadata, dict):
        raise _CadHandlerError(
            "bad_params",
            "metadata must be an object with title-block fields "
            "(name / scale / author / date / sheet)",
        )
    out: Dict[str, str] = {}
    for field in TITLE_BLOCK_FIELDS:
        raw = metadata.get(field, "")
        if raw is None:
            raw = ""
        if not isinstance(raw, str):
            raise _CadHandlerError(
                "bad_params",
                f"metadata.{field} must be a string when provided",
            )
        # Strip control characters; the block lives inside an SVG <text>
        # and a stray "<" would break the markup. We do NOT HTML-encode
        # here — XML parsers in the renderer handle the entities.
        cleaned = raw.replace("\x00", "").replace("\r", "").replace("\n", " ")
        out[field] = cleaned[:80]  # 80-char cap matches typical drafting block
    return out


def _build_title_block_svg(metadata: Dict[str, str], width: float, height: float) -> str:
    """Build the SVG markup for a title block stamped at the bottom-right.

    The block dimensions are fixed (80 × 30 mm) so the renderer's CSS can
    rely on a stable hit-target. Field rows are laid out top-to-bottom in
    the canonical drafting order: Name → Scale → Author → Date → Sheet.
    """
    block_w = 80.0
    block_h = 30.0
    x = width - block_w - 5.0
    y = height - block_h - 5.0
    rows = [
        ("Name",   metadata.get("name", "")),
        ("Scale",  metadata.get("scale", "")),
        ("Author", metadata.get("author", "")),
        ("Date",   metadata.get("date", "")),
        ("Sheet",  metadata.get("sheet", "")),
    ]
    row_h = block_h / len(rows)
    parts: list[str] = [
        f"<g class=\"title-block\" transform=\"translate({x:.3f},{y:.3f})\" "
        "stroke=\"#1a1a1a\" stroke-width=\"0.3\" fill=\"none\" "
        "font-family=\"sans-serif\">",
        f"<rect width=\"{block_w}\" height=\"{block_h}\" />",
    ]
    for i, (label, value) in enumerate(rows):
        ry = (i + 1) * row_h
        if i < len(rows) - 1:
            parts.append(
                f"<line x1=\"0\" y1=\"{ry:.3f}\" "
                f"x2=\"{block_w:.3f}\" y2=\"{ry:.3f}\" />"
            )
        text_y = i * row_h + row_h * 0.65
        parts.append(
            f"<text x=\"2\" y=\"{text_y:.3f}\" font-size=\"2.8\" "
            "stroke=\"none\" fill=\"#666\">"
            f"{label}</text>"
        )
        # Field value sits in the right-hand portion of the cell.
        # Escape XML special chars so a "<" or "&" in the operator's
        # input cannot break the SVG.
        safe_value = (
            value.replace("&", "&amp;")
                 .replace("<", "&lt;")
                 .replace(">", "&gt;")
        )
        parts.append(
            f"<text x=\"22\" y=\"{text_y:.3f}\" font-size=\"3.2\" "
            "stroke=\"none\" fill=\"#1a1a1a\">"
            f"{safe_value}</text>"
        )
    parts.append("</g>")
    return "".join(parts)


_SVG_DIMENSION_RE = re.compile(
    r"<svg[^>]*?\bwidth\s*=\s*\"([0-9]+(?:\.[0-9]+)?)\"[^>]*?"
    r"\bheight\s*=\s*\"([0-9]+(?:\.[0-9]+)?)\"",
    re.IGNORECASE | re.DOTALL,
)


def _parse_svg_dimensions(svg_text: str) -> Tuple[float, float]:
    """Pull ``width`` / ``height`` from the SVG root, defaulting to opts size.

    CadQuery's exporter always emits width / height on the root; if we hit a
    drift we fall back to the (800, 600) default that ``_build_svg_opts``
    asks for.
    """
    match = _SVG_DIMENSION_RE.search(svg_text)
    if match is None:
        return (800.0, 600.0)
    try:
        return (float(match.group(1)), float(match.group(2)))
    except ValueError:
        return (800.0, 600.0)


def attach_title_block(svg_text: Any, metadata: Any) -> Dict[str, Any]:
    """Stamp a title-block ``<g>`` into the bottom-right corner of an SVG.

    Wire result::

        {
          "svg":   str,             # input SVG + title-block layer
          "bytes": int,             # len(svg) after UTF-8 encode
          "metadata": {              # echoed normalized metadata
            "name": str, "scale": str, "author": str,
            "date": str, "sheet": str,
          },
        }

    Idempotent against an already-stamped SVG: the function looks for the
    ``class="title-block"`` token and skips re-stamping when it is already
    present (the operator can re-export a drawing without doubling the
    block).

    Raises ``_CadHandlerError`` with ``bad_params`` for an empty SVG, a
    non-dict metadata input, or a non-string field value.
    """
    if not isinstance(svg_text, str) or not svg_text.strip():
        raise _CadHandlerError(
            "bad_params", "svg must be a non-empty SVG markup string"
        )
    normalized = _validate_title_block_metadata(metadata)
    if "class=\"title-block\"" in svg_text:
        # Already stamped — return the SVG unchanged but echo the
        # normalized metadata so callers can rely on the contract.
        return {
            "svg": svg_text,
            "bytes": len(svg_text.encode("utf-8")),
            "metadata": normalized,
        }
    width, height = _parse_svg_dimensions(svg_text)
    block_markup = _build_title_block_svg(normalized, width, height)
    out_svg = _inject_layer_into_svg(svg_text, block_markup)
    return {
        "svg": out_svg,
        "bytes": len(out_svg.encode("utf-8")),
        "metadata": normalized,
    }


# ─────────────────────────────────────────────────────────────────────────
# CAD V1.5 — BOM-table stamp (associative-dimension BOM surface).
# ─────────────────────────────────────────────────────────────────────────
#
# :func:`drawing_bom_table` stamps a bill-of-materials table ``<g>`` into an
# SVG. Pure SVG composition, exactly like :func:`attach_title_block`: the
# caller passes the BOM rows the assembly model already computed; this helper
# only formats them. It does NOT walk an assembly or recompute quantities.
#
# The projected-2D-geometry method (``cad.extract_drawing_geometry``) that used
# to live here moved to its own module ``engines/cad/cadquery_drawing_geometry``
# so it can run the real OCCT HLR projection (the same one ``getSVG`` uses) and
# emit quantized-hash stable ids — a naive axis-drop projection here disagreed
# with the SVG coordinate frame. ``ALLOWED_SNAP_KINDS`` stays as the shared
# snap-kind vocabulary constant.
#
# Safety Rule 1 reminder: this helper is renderer-only. It does not emit G-code
# or STL; no downstream CAM logic reads its output.


# Snap-point kinds the renderer's drawing-snap resolver understands. Kept in
# lock-step with ``CadDrawingSnapKind`` in ``src/shared/sidecar-protocol.ts``
# and ``SnapPointKind`` in ``src/renderer/design/drawing-snap.ts``.
ALLOWED_SNAP_KINDS: Tuple[str, ...] = (
    "vertex",
    "endpoint",
    "midpoint",
    "center",
)


# Columns the BOM table can render. ``item`` / ``partName`` / ``quantity`` are
# always available; the rest render only when supplied on a row. The default
# column set keeps the table compact for a typical drawing. Kept in lock-step
# with ``V15_BOM_COLUMNS`` in ``src/main/ipc-cad.ts``.
BOM_TABLE_COLUMNS: Tuple[str, ...] = (
    "item",
    "partName",
    "quantity",
    "partNumber",
    "material",
    "vendor",
    "notes",
)
DEFAULT_BOM_COLUMNS: Tuple[str, ...] = ("item", "partName", "quantity")

# Human-readable header per column key.
_BOM_COLUMN_HEADERS: Dict[str, str] = {
    "item": "#",
    "partName": "Part",
    "quantity": "Qty",
    "partNumber": "Part No.",
    "material": "Material",
    "vendor": "Vendor",
    "notes": "Notes",
}


def _xml_escape(value: str) -> str:
    """Escape XML special chars so a cell value can't break the SVG markup."""
    return (
        value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    )


def _validate_bom_columns(columns: Any) -> Tuple[str, ...]:
    """Validate the optional ``columns`` list; default when absent."""
    if columns is None:
        return DEFAULT_BOM_COLUMNS
    if not isinstance(columns, list):
        raise _CadHandlerError(
            "bad_params", "columns must be an array of column keys"
        )
    out: list[str] = []
    for col in columns:
        if col not in BOM_TABLE_COLUMNS:
            raise _CadHandlerError(
                "bad_params",
                f"columns entries must be one of {sorted(BOM_TABLE_COLUMNS)}, "
                f"got {col!r}",
            )
        if col not in out:
            out.append(col)
    if not out:
        return DEFAULT_BOM_COLUMNS
    return tuple(out)


def _validate_bom_row(row: Any, index: int) -> Dict[str, Any]:
    """Validate one BOM row dict; return a normalized copy.

    Mirrors :func:`_validate_dimension_spec`'s posture — narrow, fail-fast on a
    malformed cell so a typo at the IPC boundary surfaces as ``bad_params``.
    The handler does NOT recompute quantities; it trusts the caller's values.
    """
    if not isinstance(row, dict):
        raise _CadHandlerError(
            "bad_params",
            f"rows[{index}] must be an object, got {type(row).__name__}",
        )
    out: Dict[str, Any] = {}
    # item — caller-assigned display index (string).
    item = row.get("item", "")
    if item is None:
        item = ""
    if not isinstance(item, (str, int)):
        raise _CadHandlerError(
            "bad_params", f"rows[{index}].item must be a string"
        )
    out["item"] = str(item)
    # partName — required-ish (defaults to empty so a partial row still renders).
    part_name = row.get("partName", "")
    if part_name is None:
        part_name = ""
    if not isinstance(part_name, str):
        raise _CadHandlerError(
            "bad_params", f"rows[{index}].partName must be a string"
        )
    out["partName"] = part_name
    # quantity — numeric; format as an integer when integer-valued.
    qty_raw = row.get("quantity", 1)
    if isinstance(qty_raw, bool) or not isinstance(qty_raw, (int, float)):
        raise _CadHandlerError(
            "bad_params", f"rows[{index}].quantity must be a number"
        )
    qty = float(qty_raw)
    if not math.isfinite(qty):
        raise _CadHandlerError(
            "bad_params", f"rows[{index}].quantity must be finite"
        )
    out["quantity"] = qty
    # Optional string columns.
    for field in ("partNumber", "material", "vendor", "notes"):
        raw = row.get(field)
        if raw is None:
            continue
        if not isinstance(raw, str):
            raise _CadHandlerError(
                "bad_params",
                f"rows[{index}].{field} must be a string when provided",
            )
        out[field] = raw
    return out


def _bom_cell_text(row: Dict[str, Any], column: str) -> str:
    """Render one cell's text from a normalized BOM row."""
    if column == "quantity":
        return _format_number(row.get("quantity", 0.0))
    value = row.get(column, "")
    if not isinstance(value, str):
        value = str(value)
    # Cap long free-text so the cell stays inside the table column.
    return value[:48]


def _build_bom_table_svg(
    rows: list[Dict[str, Any]],
    columns: Tuple[str, ...],
    title: str,
    width: float,
    height: float,
) -> str:
    """Build the SVG markup for a BOM table stamped at the bottom-left.

    Pure composition (no CadQuery) — same approach as
    :func:`_build_title_block_svg`. The table is anchored bottom-left so it
    does not collide with the bottom-right title block; column widths are
    fixed per-column so the renderer's CSS gets a stable layout.
    """
    # Fixed per-column widths (mm). Unknown columns fall back to 24 mm.
    col_w = {
        "item": 8.0,
        "partName": 40.0,
        "quantity": 10.0,
        "partNumber": 24.0,
        "material": 24.0,
        "vendor": 24.0,
        "notes": 40.0,
    }
    widths = [col_w.get(c, 24.0) for c in columns]
    table_w = sum(widths)
    row_h = 5.0
    header_h = 5.0
    title_h = 5.0 if title else 0.0
    table_h = title_h + header_h + row_h * len(rows)
    x = 5.0
    y = height - table_h - 5.0

    parts: list[str] = [
        f"<g class=\"bom-table\" transform=\"translate({x:.3f},{y:.3f})\" "
        "stroke=\"#1a1a1a\" stroke-width=\"0.3\" fill=\"none\" "
        "font-family=\"sans-serif\">",
        f"<rect width=\"{table_w:.3f}\" height=\"{table_h:.3f}\" />",
    ]
    cursor_y = 0.0
    # Title row.
    if title:
        parts.append(
            f"<text x=\"2\" y=\"{title_h * 0.7:.3f}\" font-size=\"3.2\" "
            "stroke=\"none\" fill=\"#1a1a1a\" font-weight=\"bold\">"
            f"{_xml_escape(title[:48])}</text>"
        )
        cursor_y += title_h
        parts.append(
            f"<line x1=\"0\" y1=\"{cursor_y:.3f}\" "
            f"x2=\"{table_w:.3f}\" y2=\"{cursor_y:.3f}\" />"
        )
    # Header row.
    cx = 0.0
    for col, w in zip(columns, widths):
        header = _BOM_COLUMN_HEADERS.get(col, col)
        parts.append(
            f"<text x=\"{cx + 1.5:.3f}\" y=\"{cursor_y + header_h * 0.7:.3f}\" "
            "font-size=\"2.8\" stroke=\"none\" fill=\"#666\">"
            f"{_xml_escape(header)}</text>"
        )
        cx += w
        if cx < table_w - 1e-6:
            parts.append(
                f"<line x1=\"{cx:.3f}\" y1=\"{cursor_y:.3f}\" "
                f"x2=\"{cx:.3f}\" y2=\"{table_h:.3f}\" />"
            )
    cursor_y += header_h
    parts.append(
        f"<line x1=\"0\" y1=\"{cursor_y:.3f}\" "
        f"x2=\"{table_w:.3f}\" y2=\"{cursor_y:.3f}\" />"
    )
    # Data rows.
    for row in rows:
        cx = 0.0
        for col, w in zip(columns, widths):
            text = _bom_cell_text(row, col)
            parts.append(
                f"<text x=\"{cx + 1.5:.3f}\" "
                f"y=\"{cursor_y + row_h * 0.7:.3f}\" font-size=\"3.0\" "
                "stroke=\"none\" fill=\"#1a1a1a\">"
                f"{_xml_escape(text)}</text>"
            )
            cx += w
        cursor_y += row_h
        if cursor_y < table_h - 1e-6:
            parts.append(
                f"<line x1=\"0\" y1=\"{cursor_y:.3f}\" "
                f"x2=\"{table_w:.3f}\" y2=\"{cursor_y:.3f}\" />"
            )
    parts.append("</g>")
    return "".join(parts)


def drawing_bom_table(
    svg_text: Any,
    rows: Any,
    columns: Any = None,
    title: Any = None,
) -> Dict[str, Any]:
    """Stamp a BOM-table ``<g>`` into the bottom-left corner of an SVG.

    Wire result (kept in lock-step with ``src/shared/sidecar-protocol.ts``
    ``CadDrawingBomTableResult``)::

        {
          "svg":      str,   # input SVG + BOM-table layer
          "bytes":    int,   # len(svg) after UTF-8 encode
          "rowCount": int,   # number of rows rendered (== len(rows))
        }

    Pure SVG composition (like :func:`attach_title_block`): the ``rows`` are the
    BOM lines the assembly model already provides — this helper formats them
    verbatim and does NOT recompute quantities or roll up the tree. Idempotent
    against an already-stamped SVG: when a ``class="bom-table"`` marker is
    already present the function returns the SVG unchanged (the operator can
    re-export without doubling the table).

    Raises ``_CadHandlerError`` with ``bad_params`` for an empty SVG, a
    non-array ``rows``, a malformed row, an unknown column key, or a
    non-string title.
    """
    if not isinstance(svg_text, str) or not svg_text.strip():
        raise _CadHandlerError(
            "bad_params", "svg must be a non-empty SVG markup string"
        )
    if not isinstance(rows, list):
        raise _CadHandlerError(
            "bad_params", "rows must be an array (use [] for an empty table)"
        )
    cols = _validate_bom_columns(columns)
    if title is None:
        table_title = "BOM"
    elif isinstance(title, str):
        table_title = title.replace("\x00", "").replace("\r", "").replace("\n", " ")[:48]
    else:
        raise _CadHandlerError(
            "bad_params", "title must be a string when provided"
        )
    normalized_rows: list[Dict[str, Any]] = [
        _validate_bom_row(row, i) for i, row in enumerate(rows)
    ]

    if "class=\"bom-table\"" in svg_text:
        # Already stamped — return unchanged so a re-export doesn't double it.
        return {
            "svg": svg_text,
            "bytes": len(svg_text.encode("utf-8")),
            "rowCount": len(normalized_rows),
        }

    width, height = _parse_svg_dimensions(svg_text)
    table_markup = _build_bom_table_svg(
        normalized_rows, cols, table_title, width, height
    )
    out_svg = _inject_layer_into_svg(svg_text, table_markup)
    return {
        "svg": out_svg,
        "bytes": len(out_svg.encode("utf-8")),
        "rowCount": len(normalized_rows),
    }


# ─────────────────────────────────────────────────────────────────────────
# GD&T — feature control frames (ASME Y14.5 / ISO 1101)
# ─────────────────────────────────────────────────────────────────────────
#
# A feature control frame states a geometric tolerance as a row of boxed cells:
#
#     ┌───┬────────┬───┬───┬───┐
#     │ ⌖ │ ⌀0.1   │ A │ B │ C │
#     └───┴────────┴───┴───┴───┘
#       │     │       └───┴───┴── up to 3 datum references (operator free-text)
#       │     └── tolerance zone: ⌀ + value (numeric, via _format_number)
#       └── characteristic glyph (a known-safe constant from _GDT_GLYPHS)
#
# Like the BOM table and the title block, the frame is composed as pure SVG
# (no CadQuery) and stamped onto an existing drawing SVG by `annotate_gdt`.
# It mirrors `drawing_bom_table`'s posture: operate on the SVG string directly
# (no handle-table lookup) and render the caller's values verbatim.
#
# Safety Rule 4 (stored-XSS guard): the drawing SVG is dropped into the
# renderer via `dangerouslySetInnerHTML`, and datums/labels are operator
# free-text persisted in drawing.json. The characteristic glyph and the
# ⌀+value cell are constants / numeric and therefore safe, but EVERY
# operator-controlled string — each datum reference AND any override label —
# is run through `_xml_escape` before it reaches a <text> node. A datum like
# `</text><script>…` must survive only as escaped entities. The pin test is
# `test_gdt_datum_is_xml_escaped` in
# `engines/sidecar/__tests__/test_cad_drawing_handlers.py`.


# Geometric characteristics addressable in a feature control frame. Kept in
# lock-step with `gdtCharacteristicSchema` in
# `src/shared/drawing-annotation-schema.ts` and `CadGdtCharacteristic` in
# `src/shared/sidecar-protocol.ts`. Narrow on purpose so a renderer typo fails
# fast with `bad_params` rather than rendering an unknown glyph.
ALLOWED_GDT_CHARACTERISTICS: Tuple[str, ...] = (
    "straightness",
    "flatness",
    "circularity",
    "cylindricity",
    "profile_of_a_line",
    "profile_of_a_surface",
    "perpendicularity",
    "angularity",
    "parallelism",
    "position",
    "concentricity",
    "symmetry",
    "circular_runout",
    "total_runout",
)

# Characteristic id -> Unicode drafting glyph. These are fixed constants (never
# operator text) so they are safe to inject without escaping. Where a true
# Y14.5 symbol has no stable, widely-rendered Unicode code point we fall back
# to the closest glyph so the cell is never empty.
_GDT_GLYPHS: Dict[str, str] = {
    "straightness": "—",          # em dash
    "flatness": "⏥",              # flatness
    "circularity": "○",           # circle
    "cylindricity": "⌭",          # cylindricity
    "profile_of_a_line": "⌒",     # arc
    "profile_of_a_surface": "⌓",  # segment
    "perpendicularity": "⟂",      # perpendicular
    "angularity": "∠",            # angle
    "parallelism": "∥",           # parallel
    "position": "⌖",              # position
    "concentricity": "◎",         # bullseye
    "symmetry": "⌯",              # symmetry
    "circular_runout": "↗",       # single arrow (circular runout)
    "total_runout": "⇉",          # double arrow (total runout)
}


def _validate_fcf_spec(spec: Any, index: int) -> Dict[str, Any]:
    """Validate one feature-control-frame spec; return a normalized dict.

    Wire shape (mirrors ``CadGdtFrameSpec`` / ``gdtFeatureControlFrameSchema``)::

        {"characteristic": <one of ALLOWED_GDT_CHARACTERISTICS>,
         "toleranceMm": number >= 0,
         "datums"?: [str, ...],          # at most 3 datum references
         "placement": {"x": float, "y": float},
         "label"?: str}                  # optional override caption

    Mirrors :func:`_validate_dimension_spec`'s narrow fail-fast posture so a
    typo at the IPC boundary surfaces as ``bad_params`` instead of silently
    dropping the frame.
    """
    if not isinstance(spec, dict):
        raise _CadHandlerError(
            "bad_params",
            f"frames[{index}] must be an object, got {type(spec).__name__}",
        )
    characteristic = spec.get("characteristic")
    if characteristic not in ALLOWED_GDT_CHARACTERISTICS:
        raise _CadHandlerError(
            "bad_params",
            f"frames[{index}].characteristic must be one of "
            f"{sorted(ALLOWED_GDT_CHARACTERISTICS)}, got {characteristic!r}",
        )
    tolerance = _require_finite_number(
        spec.get("toleranceMm"), f"frames[{index}].toleranceMm"
    )
    if tolerance < 0:
        raise _CadHandlerError(
            "bad_params",
            f"frames[{index}].toleranceMm must be non-negative, "
            f"got {tolerance!r}",
        )
    datums_raw = spec.get("datums", [])
    if datums_raw is None:
        datums_raw = []
    if not isinstance(datums_raw, list):
        raise _CadHandlerError(
            "bad_params",
            f"frames[{index}].datums must be an array of strings",
        )
    if len(datums_raw) > 3:
        raise _CadHandlerError(
            "bad_params",
            f"frames[{index}].datums references at most 3 datums "
            f"(primary/secondary/tertiary), got {len(datums_raw)}",
        )
    datums: list[str] = []
    for d_index, datum in enumerate(datums_raw):
        if not isinstance(datum, str) or not datum:
            raise _CadHandlerError(
                "bad_params",
                f"frames[{index}].datums[{d_index}] must be a non-empty string",
            )
        datums.append(datum)
    placement = _require_point2d(
        spec.get("placement"), f"frames[{index}].placement"
    )
    label = spec.get("label")
    if label is not None and not isinstance(label, str):
        raise _CadHandlerError(
            "bad_params",
            f"frames[{index}].label must be a string when provided",
        )
    return {
        "characteristic": characteristic,
        "toleranceMm": tolerance,
        "datums": datums,
        "placement": placement,
        "label": label,
    }


def _build_fcf_svg(
    characteristic: str,
    tolerance_mm: float,
    datums: list[str],
    placement: Tuple[float, float],
    label: Optional[str] = None,
) -> str:
    """Build the SVG markup for one GD&T feature control frame.

    Renders a bordered, multi-cell ``<g>`` at ``placement`` (sheet-space mm)::

        [ glyph | <tol> | datum1 | datum2 | datum3 ]   ( optional label above )

    Pure composition (no CadQuery) — same hand-built style as
    :func:`_build_bom_table_svg`. Cell widths are fixed so the renderer's CSS
    gets a stable layout.

    Safety Rule 4: the ``characteristic`` glyph (a constant from
    :data:`_GDT_GLYPHS`) and the diameter-symbol + ``_format_number(tolerance_mm)``
    cell (numeric) are known-safe. EVERY operator-controlled string — each
    ``datum`` cell AND the optional ``label`` caption — is passed through
    :func:`_xml_escape` before it is injected into a ``<text>`` node. Do NOT
    interpolate any of these raw.
    """
    glyph = _GDT_GLYPHS.get(characteristic, "?")
    tol_text = "⌀" + _format_number(tolerance_mm)  # diameter symbol + value
    # Cell text in display order. Glyph + tolerance are constants/numeric; the
    # datum cells are operator free-text (escaped at injection below).
    cells = [glyph, tol_text, *datums[:3]]
    cell_w = [7.0, 12.0]  # glyph, tolerance
    cell_w += [6.0] * (len(cells) - len(cell_w))
    frame_h = 6.0
    frame_w = sum(cell_w)
    px, py = placement

    parts: list[str] = [
        f"<g class=\"gdt-fcf\" transform=\"translate({px:.3f},{py:.3f})\" "
        "stroke=\"#1a1a1a\" stroke-width=\"0.3\" fill=\"none\" "
        "font-family=\"sans-serif\">",
        f"<rect width=\"{frame_w:.3f}\" height=\"{frame_h:.3f}\" />",
    ]
    cx = 0.0
    for i, (cell, width) in enumerate(zip(cells, cell_w)):
        # MANDATORY escape: datum cells are operator-controlled. The glyph and
        # tolerance are safe constants but escaping them is a harmless no-op,
        # so route every cell through _xml_escape for a single safe path.
        safe = _xml_escape(cell)
        parts.append(
            f"<text x=\"{cx + width / 2.0:.3f}\" "
            f"y=\"{frame_h * 0.72:.3f}\" text-anchor=\"middle\" "
            "font-size=\"3.2\" stroke=\"none\" fill=\"#1a1a1a\">"
            f"{safe}</text>"
        )
        cx += width
        # Vertical divider between cells (skip the trailing edge — the <rect>
        # border already closes the frame). Mirrors _build_bom_table_svg.
        if i < len(cells) - 1:
            parts.append(
                f"<line x1=\"{cx:.3f}\" y1=\"0\" "
                f"x2=\"{cx:.3f}\" y2=\"{frame_h:.3f}\" />"
            )
    if label:
        # Optional caption above the frame (e.g. a tag the operator typed).
        # Operator-controlled -> MANDATORY escape before injection.
        parts.append(
            f"<text x=\"0\" y=\"-1.5\" font-size=\"2.8\" "
            "stroke=\"none\" fill=\"#666\">"
            f"{_xml_escape(label)}</text>"
        )
    parts.append("</g>")
    return "".join(parts)


def annotate_gdt(svg_text: Any, frames: Any) -> Dict[str, Any]:
    """Stamp one or more GD&T feature-control-frame ``<g>`` groups into an SVG.

    Composes onto an existing drawing SVG (typically the output of
    ``cad.project_drawing`` / ``cad.dimension_drawing`` / ``cad.section_drawing``),
    exactly like :func:`drawing_bom_table` and :func:`attach_title_block` —
    operates on the SVG string directly (no handle-table lookup) and renders
    the caller-supplied frames verbatim.

    Wire result (kept in lock-step with ``src/shared/sidecar-protocol.ts``
    ``CadAnnotateGdtResult``)::

        {
          "svg":        str,   # input SVG + feature-control-frame layer
          "bytes":      int,   # len(svg) after UTF-8 encode
          "frameCount": int,   # number of frames rendered (== len(frames))
        }

    ``frames`` is the list of per-frame spec dicts (see
    :func:`_validate_fcf_spec`). An empty list round-trips back to the input
    SVG unchanged — convenient for the renderer to toggle the layer on/off
    without two separate IPC paths.

    Raises ``_CadHandlerError`` with ``bad_params`` for an empty SVG, a
    non-array ``frames``, or a malformed frame (unknown characteristic,
    negative tolerance, > 3 datums, non-string datum, bad placement).
    """
    if not isinstance(svg_text, str) or not svg_text.strip():
        raise _CadHandlerError(
            "bad_params", "svg must be a non-empty SVG markup string"
        )
    if not isinstance(frames, list):
        raise _CadHandlerError(
            "bad_params", "frames must be an array (use [] for no frames)"
        )
    specs: list[Dict[str, Any]] = [
        _validate_fcf_spec(frame, i) for i, frame in enumerate(frames)
    ]
    if not specs:
        return {
            "svg": svg_text,
            "bytes": len(svg_text.encode("utf-8")),
            "frameCount": 0,
        }

    parts: list[str] = ["<g class=\"gdt-layer\">"]
    for spec in specs:
        parts.append(
            _build_fcf_svg(
                spec["characteristic"],
                spec["toleranceMm"],
                spec["datums"],
                spec["placement"],
                spec["label"],
            )
        )
    parts.append("</g>")
    layer = "".join(parts)
    out_svg = _inject_layer_into_svg(svg_text, layer)
    return {
        "svg": out_svg,
        "bytes": len(out_svg.encode("utf-8")),
        "frameCount": len(specs),
    }


__all__ = [
    "ALLOWED_DIMENSION_KINDS",
    "ALLOWED_GDT_CHARACTERISTICS",
    "ALLOWED_SECTION_AXES",
    "ALLOWED_SNAP_KINDS",
    "ALLOWED_VIEWS",
    "BOM_TABLE_COLUMNS",
    "DEFAULT_BOM_COLUMNS",
    "DEFAULT_SECTION_LABEL",
    "DEFAULT_DETAIL_LABEL",
    "TITLE_BLOCK_FIELDS",
    "VIEW_DIRECTIONS",
    "attach_title_block",
    "annotate_gdt",
    "dimension_drawing",
    "detail_drawing",
    "drawing_bom_table",
    "export_drawing",
    "project_to_drawing",
    "section_drawing",
    "_build_section_hatch_svg",
    "_build_section_line_svg",
    "_validate_section_label",
]
