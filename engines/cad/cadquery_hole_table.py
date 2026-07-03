"""Hole-table scan for the 2D drawing pipeline (Phase-5 — hole table).

Companion to ``engines/cad/cadquery_drawing_geometry.py`` (projected-2D snap
geometry) and ``engines/cad/cadquery_hlr.py`` (hidden-line removal). Where those
modules project *linework*, this module enumerates the part's **holes** and
projects each hole's centre into the active view's 2D SVG-mm frame so the
renderer's DrawingView can drop a matching tag (``A1``, ``A2`` …) on top of each
projected hole.

What a hole is (HONEST SCOPE — v1)
==================================
A "hole" here is a set of coaxial **cylindrical faces** (OCCT
``GeomAbs_Cylinder``) whose common axis is **parallel to the view direction**.
Such a hole appears as a *circle* in the projected view, so a tag placed at its
projected centre lands exactly on the circle. This is the cheapest correct hole
recognition that still produces a faithful Fusion-style hole table for the
overwhelmingly common case (drilled / bored holes normal to a face you are
drawing).

Explicitly OUT of scope for v1 (documented, not faked):
  * Holes whose axis is NOT parallel to the view direction (they project to an
    ellipse / slot, not a circle — a tag at the centre would be misleading, so
    they are dropped from THIS view's table; switch to a view down their axis to
    table them).
  * Countersink cone faces (``GeomAbs_Cone``): the cone is not counted as its own
    hole, but a countersink/counterbore sitting on top of a cylindrical bore is
    grouped into that bore's coaxial stack, so the bore is still tabled once (its
    reported diameter is the through/primary bore, its depth the full coaxial
    axial extent — see ``_summarize_hole``).
  * Non-cylindrical pockets / slots (not a hole).

Through vs. blind
=================
A hole's axial extent is the span of its coaxial cylinder faces measured ALONG
the hole axis. The hole is **through** when that extent reaches BOTH the near and
far bound of the solid's bounding box along the axis (within a tolerance); it is
**blind** otherwise, and ``depthMm`` is the measured axial extent. A through hole
reports ``through: true`` with ``depthMm: null`` (the drawing convention — a
through hole is dimensioned "THRU", not by a depth number).

Coordinate space (the single hardest correctness constraint)
============================================================
The projected centre ``(x, y)`` is computed with the SAME projector frame
``gp_Ax2(gp_Pnt(), gp_Dir(*direction))`` that ``cadquery_hlr.project_view_edges``
and ``cadquery_drawing_geometry`` build (and that CadQuery's ``getSVG`` builds).
A world point is transformed into that frame via
``gp_Trsf().SetTransformation(gp_Ax3(ax2))`` and its local ``(X, Y)`` taken —
empirically byte-identical to where HLR projects the same point (verified: a hole
at world ``(-10, -5, z)`` projects to ``(-10, -5)`` in the top view, inside the
HLR ``bbox2d``). So a tag at this centre lands on the projected circle; the table
never drifts from the linework.

Deterministic tag ordering
==========================
Holes are sorted by **descending diameter**, then by projected position
(ascending ``y`` — top rows first in SVG space — then ascending ``x``). The tag
is then ``A<n>`` (``A1``, ``A2`` …) in that stable order. Re-running the scan on
the same part + view yields byte-identical tags, so a persisted hole table stays
put across re-runs (the renderer keys its markers on the tag).

Safety Rule 1 — G-code is sacred
================================
This module does NOT emit G-code or STL. Its output is renderer-only (the
drawing hole-table overlay); no downstream CAM logic consumes it.

Error vocabulary (raised as ``_CadHandlerError``)
=================================================
  * ``bad_params``            — empty handle or unknown view name.
  * ``invalid_handle``        — handle not in the table.
  * ``ocp_hlr_not_available`` — an OCP binding needed for the scan is missing
    (the renderer degrades to "hole table unavailable").
  * ``drawing_error``         — OCCT raised mid-scan.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from .cadquery_drawing import VIEW_DIRECTIONS, _resolve_handle, _validate_view
from .cadquery_import import _CadHandlerError


# ── Tunables ──────────────────────────────────────────────────────────────

# Two axes count as "the same hole axis" when their direction dot-product is
# within this of ±1 AND the perpendicular distance between their axis lines is
# below _COAXIAL_DIST_TOL. Loose enough to absorb OCCT float jitter between the
# two faces of one drilled hole; tight enough that two distinct nearby holes
# never merge.
_AXIS_PARALLEL_TOL = 1e-4
_COAXIAL_DIST_TOL = 1e-4

# A hole axis counts as "parallel to the view direction" (so the hole projects
# to a circle) when |dot(axis, view)| is within this of 1.
_VIEW_ALIGN_TOL = 1e-3

# A hole's axial extent counts as reaching a solid-bbox bound (→ through) when it
# is within this many mm of that bound. 1e-3 mm is finer than any drafting
# tolerance and absorbs the tiny gap OCCT can leave at a face boundary.
_THROUGH_TOL = 1e-3

# Diameters within this many mm are treated as equal when ordering the table, so
# two nominally-identical holes never swap tags on a float wobble.
_DIAM_EQ_TOL = 1e-4


# ── OCP import (bundled as one site) ──────────────────────────────────────


def _load_ocp() -> Dict[str, Any]:
    """Import every OCP symbol the scan needs, or raise ``ocp_hlr_not_available``.

    One import site so a binding-drift failure surfaces as a single structured
    error the renderer can branch on (identical posture to
    ``cadquery_hlr._load_ocp``), instead of an opaque ``ImportError``.
    """
    try:
        from OCP.gp import gp_Ax2, gp_Ax3, gp_Dir, gp_Pnt, gp_Trsf  # noqa: PLC0415
        from OCP.BRepAdaptor import BRepAdaptor_Surface  # noqa: PLC0415
        from OCP.GeomAbs import GeomAbs_SurfaceType  # noqa: PLC0415
        from OCP.BRepTools import BRepTools  # noqa: PLC0415
        from OCP.TopExp import TopExp_Explorer  # noqa: PLC0415
        from OCP.TopAbs import TopAbs_ShapeEnum  # noqa: PLC0415
        from OCP.TopoDS import TopoDS  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - bad-env only
        raise _CadHandlerError(
            "ocp_hlr_not_available",
            "OCP surface/topology bindings needed for the hole scan are not "
            "available in the sidecar's Python environment",
            detail=str(exc),
        ) from exc
    return {
        "gp_Ax2": gp_Ax2,
        "gp_Ax3": gp_Ax3,
        "gp_Dir": gp_Dir,
        "gp_Pnt": gp_Pnt,
        "gp_Trsf": gp_Trsf,
        "BRepAdaptor_Surface": BRepAdaptor_Surface,
        "GeomAbs_SurfaceType": GeomAbs_SurfaceType,
        "BRepTools": BRepTools,
        "TopExp_Explorer": TopExp_Explorer,
        "TopAbs_ShapeEnum": TopAbs_ShapeEnum,
        "TopoDS": TopoDS,
    }


# ── Raw cylinder faces ────────────────────────────────────────────────────


class _CylFace:
    """A single cylindrical face's scan-relevant geometry.

    ``origin`` / ``direction`` are the axis point + unit direction; ``radius`` the
    cylinder radius; ``t_lo`` / ``t_hi`` the face's extent as signed distances
    ALONG ``direction`` from ``origin`` (so the world span of the face is
    ``origin + t*direction`` for ``t`` in ``[t_lo, t_hi]``). Derived from OCCT's
    ``UVBounds`` V-range (the axial parameter of a cylinder).
    """

    __slots__ = ("origin", "direction", "radius", "t_lo", "t_hi")

    def __init__(
        self,
        origin: Tuple[float, float, float],
        direction: Tuple[float, float, float],
        radius: float,
        t_lo: float,
        t_hi: float,
    ) -> None:
        self.origin = origin
        self.direction = direction
        self.radius = radius
        self.t_lo = t_lo
        self.t_hi = t_hi


def _collect_cylinder_faces(shape: Any, ocp: Dict[str, Any]) -> List[_CylFace]:
    """Walk every face of ``shape`` and collect the cylindrical ones.

    For each cylinder we read its axis (origin + unit direction), radius, and the
    face's axial extent from ``BRepTools.UVBounds`` (the V-parameter of a cylinder
    is the signed distance along the axis, so ``vmin`` / ``vmax`` bound the face's
    span along ``direction``). Non-cylindrical faces are skipped.
    """
    faces: List[_CylFace] = []
    exp = ocp["TopExp_Explorer"](shape, ocp["TopAbs_ShapeEnum"].TopAbs_FACE)
    cyl_type = ocp["GeomAbs_SurfaceType"].GeomAbs_Cylinder
    while exp.More():
        face = ocp["TopoDS"].Face_s(exp.Current())
        try:
            surf = ocp["BRepAdaptor_Surface"](face)
            if surf.GetType() == cyl_type:
                cyl = surf.Cylinder()
                axis = cyl.Axis()
                loc = axis.Location()
                d = axis.Direction()
                origin = (float(loc.X()), float(loc.Y()), float(loc.Z()))
                direction = (float(d.X()), float(d.Y()), float(d.Z()))
                radius = float(cyl.Radius())
                _umin, _umax, vmin, vmax = ocp["BRepTools"].UVBounds_s(face)
                faces.append(
                    _CylFace(origin, direction, radius, float(vmin), float(vmax))
                )
        except Exception:  # noqa: BLE001 - a bad face is skipped, never fatal
            pass
        exp.Next()
    return faces


# ── Axis geometry helpers ─────────────────────────────────────────────────


def _dot(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _sub(
    a: Tuple[float, float, float], b: Tuple[float, float, float]
) -> Tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(
    a: Tuple[float, float, float], b: Tuple[float, float, float]
) -> Tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _norm(a: Tuple[float, float, float]) -> float:
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _axes_coaxial(f1: _CylFace, f2: _CylFace) -> bool:
    """True when two cylinder faces share the same infinite axis LINE.

    Same axis = (a) directions parallel (|dot| ≈ 1) AND (b) the perpendicular
    distance between the two axis lines ≈ 0. Direction SIGN is ignored — the two
    faces of a counterbore can have opposite axis directions yet be the same hole.
    """
    d1, d2 = f1.direction, f2.direction
    if abs(abs(_dot(d1, d2)) - 1.0) > _AXIS_PARALLEL_TOL:
        return False
    # Perpendicular distance between the two axis lines through f1.origin /
    # f2.origin along the (shared) direction d1: |(o2 - o1) x d1| / |d1|.
    delta = _sub(f2.origin, f1.origin)
    perp = _cross(delta, d1)
    mag = _norm(d1)
    if mag <= 1e-12:
        return False
    return (_norm(perp) / mag) <= _COAXIAL_DIST_TOL


def _group_coaxial(faces: List[_CylFace]) -> List[List[_CylFace]]:
    """Partition cylinder faces into coaxial groups (one group per hole).

    A simple union-by-scan: each face joins the first existing group it is
    coaxial with, else it starts a new group. O(faces·groups) — fine for the
    dozens-of-holes scale a drawing sheet ever sees.
    """
    groups: List[List[_CylFace]] = []
    for f in faces:
        placed = False
        for g in groups:
            if _axes_coaxial(f, g[0]):
                g.append(f)
                placed = True
                break
        if not placed:
            groups.append([f])
    return groups


# ── Hole summary (diameter / depth / through) ─────────────────────────────


class _Hole:
    """A summarized hole: projected centre + diameter + depth/through."""

    __slots__ = ("x", "y", "diameter_mm", "depth_mm", "through")

    def __init__(
        self,
        x: float,
        y: float,
        diameter_mm: float,
        depth_mm: Optional[float],
        through: bool,
    ) -> None:
        self.x = x
        self.y = y
        self.diameter_mm = diameter_mm
        self.depth_mm = depth_mm
        self.through = through


def _axis_extent_world(
    group: List[_CylFace],
) -> Tuple[Tuple[float, float, float], Tuple[float, float, float], float, float]:
    """Reduce a coaxial group to one axis (origin, unit direction) + t-range.

    Every face's axial extent is re-expressed as signed distances along the
    group's canonical direction (the first face's direction) from its origin, and
    the min / max taken across the group. Returns ``(origin, direction, t_lo,
    t_hi)`` — the world span of the whole coaxial hole is ``origin + t*direction``
    for ``t`` in ``[t_lo, t_hi]``.
    """
    ref = group[0]
    direction = ref.direction
    mag = _norm(direction)
    if mag > 1e-12:
        direction = (direction[0] / mag, direction[1] / mag, direction[2] / mag)
    origin = ref.origin

    t_lo = math.inf
    t_hi = -math.inf
    for f in group:
        # This face spans f.origin + s*f.direction for s in [f.t_lo, f.t_hi].
        # Map both endpoints onto the ref axis parameter t = dot(P - origin, dir).
        for s in (f.t_lo, f.t_hi):
            p = (
                f.origin[0] + s * f.direction[0],
                f.origin[1] + s * f.direction[1],
                f.origin[2] + s * f.direction[2],
            )
            t = _dot(_sub(p, origin), direction)
            t_lo = min(t_lo, t)
            t_hi = max(t_hi, t)
    return origin, direction, t_lo, t_hi


def _summarize_hole(
    group: List[_CylFace],
    bbox_min: Tuple[float, float, float],
    bbox_max: Tuple[float, float, float],
    ocp: Dict[str, Any],
    trsf: Any,
) -> Optional[_Hole]:
    """Summarize one coaxial hole → projected centre + diameter + depth/through.

    * Diameter: the SMALLEST face radius in the group ×2 — a counterbore /
      countersink sits ON a narrower through/primary bore, and drafting tables the
      primary bore diameter (the drilled size), not the wider recess.
    * Depth / through: the group's axial extent (``t_hi - t_lo``). The hole is
      THROUGH when that extent reaches both the near and far solid-bbox bounds
      along the axis (within ``_THROUGH_TOL``); a through hole reports
      ``depth_mm=None`` (drawing convention: "THRU", not a number). Otherwise it
      is blind and ``depth_mm`` is the measured axial extent.
    * Centre: the axis origin projected into the view's 2D frame via ``trsf``
      (same frame HLR uses), so the tag lands on the projected circle.
    """
    if not group:
        return None
    origin, direction, t_lo, t_hi = _axis_extent_world(group)
    radius = min(f.radius for f in group)
    diameter = radius * 2.0
    axial_extent = t_hi - t_lo

    # World endpoints of the hole span along the axis.
    p_lo = (
        origin[0] + t_lo * direction[0],
        origin[1] + t_lo * direction[1],
        origin[2] + t_lo * direction[2],
    )
    p_hi = (
        origin[0] + t_hi * direction[0],
        origin[1] + t_hi * direction[1],
        origin[2] + t_hi * direction[2],
    )
    through = _spans_solid(p_lo, p_hi, direction, bbox_min, bbox_max)
    depth_mm: Optional[float] = None if through else axial_extent

    # Project the axis origin into the view 2D frame (X, Y of the transformed
    # point; the frame's Z is the view depth, dropped). Any point on the axis
    # projects to the same (x, y) since the axis is view-parallel, so origin is
    # a fine representative.
    gp_pnt = ocp["gp_Pnt"](origin[0], origin[1], origin[2])
    p2 = gp_pnt.Transformed(trsf)
    return _Hole(float(p2.X()), float(p2.Y()), diameter, depth_mm, through)


def _spans_solid(
    p_lo: Tuple[float, float, float],
    p_hi: Tuple[float, float, float],
    direction: Tuple[float, float, float],
    bbox_min: Tuple[float, float, float],
    bbox_max: Tuple[float, float, float],
) -> bool:
    """True when a hole's axial span reaches both solid-bbox bounds along its axis.

    Projects the solid bbox and the hole span endpoints onto the hole axis and
    checks the hole span covers the full projected bbox range (within
    ``_THROUGH_TOL``). This is the "through vs. blind" test: a drilled-through
    hole's cylinder runs the full material thickness along the axis, so its span
    matches the bbox extent along that axis.
    """
    # The eight bbox corners projected onto the axis give the material's extent
    # along the axis. min/max over the corners bound it.
    corners = [
        (bbox_min[0], bbox_min[1], bbox_min[2]),
        (bbox_max[0], bbox_min[1], bbox_min[2]),
        (bbox_min[0], bbox_max[1], bbox_min[2]),
        (bbox_max[0], bbox_max[1], bbox_min[2]),
        (bbox_min[0], bbox_min[1], bbox_max[2]),
        (bbox_max[0], bbox_min[1], bbox_max[2]),
        (bbox_min[0], bbox_max[1], bbox_max[2]),
        (bbox_max[0], bbox_max[1], bbox_max[2]),
    ]
    ts = [_dot(c, direction) for c in corners]
    mat_lo, mat_hi = min(ts), max(ts)

    hole_lo = _dot(p_lo, direction)
    hole_hi = _dot(p_hi, direction)
    lo = min(hole_lo, hole_hi)
    hi = max(hole_lo, hole_hi)

    return (lo - mat_lo) <= _THROUGH_TOL and (mat_hi - hi) <= _THROUGH_TOL


# ── Tag ordering ──────────────────────────────────────────────────────────


def _order_holes(holes: List[_Hole]) -> List[_Hole]:
    """Sort holes deterministically for stable tag assignment.

    Descending diameter first (grouped so a float wobble within ``_DIAM_EQ_TOL``
    doesn't reorder), then ascending projected ``y`` (top rows first in SVG
    space), then ascending ``x``. Re-running the scan on the same part + view is
    byte-stable, so persisted tags never churn.
    """

    def key(h: _Hole) -> Tuple[float, float, float]:
        # Quantize diameter so near-equal diameters compare equal; negate for
        # descending. y / x ascending as the tie-breakers.
        d_q = round(h.diameter_mm / _DIAM_EQ_TOL)
        return (-d_q, round(h.y, 3), round(h.x, 3))

    return sorted(holes, key=key)


def _tag(index: int) -> str:
    """0-based index → tag ``A1``, ``A2`` … (drawing hole-table convention)."""
    return f"A{index + 1}"


def _round_out(value: float) -> float:
    """Round an emitted coordinate / dimension to 3 decimals (fold -0.0 → 0.0)."""
    r = round(float(value), 3)
    return 0.0 if r == 0.0 else r


# ── Public entry point ────────────────────────────────────────────────────


def scan_hole_table(handle: str, view: str = "front") -> Dict[str, Any]:
    """Scan the body behind ``handle`` for holes visible in ``view``.

    Parameters
    ----------
    handle:
        Opaque handle from a prior ``cad.execute_script`` / ``cad.import_step``.
    view:
        One of ``front`` / ``top`` / ``right`` / ``iso`` (same vocabulary as
        ``cad.project_drawing``). Only holes whose axis is parallel to this view
        direction are tabled (v1 scope — see the module docstring).

    Returns
    -------
    dict with::

        {
          "view":  str,
          "holes": [
            {"tag": "A1", "x": float, "y": float,
             "diameterMm": float, "depthMm": float | None, "through": bool},
            ...
          ],
        }

    ``holes`` is EMPTY when the part has no view-parallel cylindrical holes
    (honest empty state — the renderer shows "no holes found"). Coordinates are in
    the same SVG-mm space as ``cad.project_drawing`` / ``cad.extract_drawing_geometry``
    for the same view, so a tag lands on the projected hole.

    Raises ``_CadHandlerError`` with one of ``bad_params`` / ``invalid_handle`` /
    ``ocp_hlr_not_available`` / ``drawing_error``.
    """
    # Validate view + resolve handle up front (cheap, no OCP import) so a typo or
    # stale handle fails fast with the shared vocabulary.
    direction = _validate_view(view)
    workplane = _resolve_handle(handle)

    try:
        solid = workplane.findSolid()
        shape = solid.wrapped
        bb = solid.BoundingBox()
        bbox_min = (float(bb.xmin), float(bb.ymin), float(bb.zmin))
        bbox_max = (float(bb.xmax), float(bb.ymax), float(bb.zmax))
    except Exception as exc:  # noqa: BLE001 - no solid (sketch/wire)
        raise _CadHandlerError(
            "drawing_error",
            f"could not resolve a solid from handle {handle!r} for the hole "
            f"scan: {exc}",
            detail=str(exc),
        ) from exc

    ocp = _load_ocp()

    try:
        holes = _scan(shape, direction, bbox_min, bbox_max, ocp)
    except _CadHandlerError:
        raise
    except Exception as exc:  # noqa: BLE001 - OCCT raises arbitrary types
        raise _CadHandlerError(
            "drawing_error",
            f"hole-table scan failed: {exc}",
            detail=str(exc),
        ) from exc

    return {"view": view, "holes": holes}


def _scan(
    shape: Any,
    direction: Tuple[float, float, float],
    bbox_min: Tuple[float, float, float],
    bbox_max: Tuple[float, float, float],
    ocp: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Core scan (assumes validated inputs + loaded OCP). Pure of the envelope.

    Builds the projector frame ONCE, collects + groups cylinder faces, keeps only
    view-parallel groups, summarizes each into a projected hole, orders them, and
    emits the tagged wire rows.
    """
    # Unit view direction + the world→view-frame transform (same frame HLR uses).
    mag = _norm(direction)
    unit_dir = (
        (direction[0] / mag, direction[1] / mag, direction[2] / mag)
        if mag > 1e-12
        else direction
    )
    ax2 = ocp["gp_Ax2"](
        ocp["gp_Pnt"](0.0, 0.0, 0.0),
        ocp["gp_Dir"](unit_dir[0], unit_dir[1], unit_dir[2]),
    )
    trsf = ocp["gp_Trsf"]()
    trsf.SetTransformation(ocp["gp_Ax3"](ax2))

    faces = _collect_cylinder_faces(shape, ocp)
    groups = _group_coaxial(faces)

    holes: List[_Hole] = []
    for group in groups:
        # v1 scope: only holes whose axis is PARALLEL to the view direction
        # (project to a circle). |dot(axis, view)| ≈ 1.
        gdir = group[0].direction
        gmag = _norm(gdir)
        if gmag <= 1e-12:
            continue
        gunit = (gdir[0] / gmag, gdir[1] / gmag, gdir[2] / gmag)
        if abs(abs(_dot(gunit, unit_dir)) - 1.0) > _VIEW_ALIGN_TOL:
            continue
        hole = _summarize_hole(group, bbox_min, bbox_max, ocp, trsf)
        if hole is not None:
            holes.append(hole)

    ordered = _order_holes(holes)
    rows: List[Dict[str, Any]] = []
    for i, h in enumerate(ordered):
        rows.append(
            {
                "tag": _tag(i),
                "x": _round_out(h.x),
                "y": _round_out(h.y),
                "diameterMm": _round_out(h.diameter_mm),
                "depthMm": None if h.through else _round_out(h.depth_mm),
                "through": bool(h.through),
            }
        )
    return rows


__all__ = ["scan_hole_table"]
