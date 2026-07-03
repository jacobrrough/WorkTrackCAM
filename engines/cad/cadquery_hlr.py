"""True hidden-line-removal section cut for the 3D viewport (CAD V1.5).

Companion to ``engines/cad/cadquery_drawing.py`` (2D drawing HLR). Where the
drawing pipeline re-runs ``cq.exporters.getSVG`` (which internally drives OCCT
HLR and emits SVG), this module computes a **3D viewport** section view:

  1. Cut the solid at an axis-aligned plane and build a filled **cap face**
     (the section profile, optionally multi-loop for hollow parts).
  2. Run real **hidden-line removal** (``HLRBRep_Algo``) from a view direction
     so the remaining geometry can be drawn with B-rep-correct visible/hidden
     edge styling -- not a screen-space silhouette heuristic.

The output is a flat, JSON-friendly dict the renderer turns into Three.js
``BufferGeometry`` objects (visible solid ``lineSegments``, hidden dashed
``lineSegments``, cap-face ``mesh``).

Why the sidecar and not the renderer?
=====================================
An edge is "hidden" because the solid's B-rep occludes it from a view
direction; only B-rep topology gives correct results (this is the kernel that
sits behind CATIA / STEP drawing export). A screen-space pass cannot produce a
cap face and gets curved-surface silhouettes wrong. See
``docs/plans/cad-v15-true-hlr-section-cuts.md`` section 3.

Coordinate space
================
``HLRBRep_HLRToShape`` returns edges already **projected onto the view plane**
(e.g. a top-down view flattens Z to 0). That is the standard, documented HLR
behaviour and exactly what the renderer wants: it draws the projected linework
in the viewport's section overlay. The cap-face triangles are returned in the
same projected space so the overlay is internally consistent.

Safety Rule 1 -- G-code is sacred
=================================
This module does NOT emit G-code or STL. Its output is renderer-only
(viewport overlay); no downstream CAM logic ever consumes it. It therefore
carries none of the degenerate-triangle / binary-STL guarantees the
``cadquery_import`` path does -- those matter only on the OCL-feeding chain.

Error vocabulary (raised as ``_CadHandlerError``)
=================================================
  * ``ocp_hlr_not_available`` -- an OCP HLR / section binding is missing; the
    renderer falls back to the legacy GPU half-space clip + a toast.
  * ``invalid_handle``        -- caller passed a handle not in ``_HANDLES``.
  * ``hlr_section_error``     -- OCCT raised mid-pipeline (degenerate plane,
    empty intersection past a guard, ...).
"""
from __future__ import annotations

import math
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

from .cadquery_import import _CadHandlerError, _HANDLES


# -- Tunables --------------------------------------------------------------

# Module-level LRU cache (cap 8). HLR is O(edges * faces); the operator
# toggles the same (plane, view) repeatedly while orbiting, so a tiny cache
# turns the second-and-later toggles into a dict lookup. Keyed by the rounded
# (handle, plane_normal, plane_offset, view_dir) tuple.
_CACHE_CAP = 8
_CACHE: "OrderedDict[Tuple[Any, ...], Dict[str, Any]]" = OrderedDict()

# Rounding applied to float cache-key components (3 significant decimals is
# finer than any UI slider step and keeps near-identical re-toggles colliding).
_KEY_ROUND = 3

# Hard cap on the number of discretized edge polylines returned (visible +
# hidden combined). A pathological solid can yield tens of thousands of edges
# (~MBs of JSON). Past this we stop appending and flag ``truncated`` so the
# renderer can surface a "section simplified" notice rather than choke.
_MAX_EDGE_COUNT = 10_000

# Default deflection (mm) for cap-face meshing. Coarse on purpose -- the cap is
# a flat fill, not a machining surface.
_CAP_MESH_DEFLECTION = 0.5

# Tolerance (mm) for stitching section edges into closed wire loops.
_WIRE_STITCH_TOL = 1e-6


# -- Defensive OCP import ---------------------------------------------------


def _load_ocp() -> Dict[str, Any]:
    """Import every OCP symbol the pipeline needs, or raise a structured error.

    Bundled as one import site so a binding-drift failure surfaces as a single
    ``ocp_hlr_not_available`` the renderer can branch on, instead of an opaque
    ``ImportError`` traceback. Returns a dict of the imported callables.
    """
    try:
        from OCP.HLRBRep import HLRBRep_Algo, HLRBRep_HLRToShape  # noqa: PLC0415
        from OCP.HLRAlgo import HLRAlgo_Projector  # noqa: PLC0415
        from OCP.gp import gp_Ax2, gp_Dir, gp_Pln, gp_Pnt  # noqa: PLC0415
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Section  # noqa: PLC0415
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace  # noqa: PLC0415
        from OCP.BRepMesh import BRepMesh_IncrementalMesh  # noqa: PLC0415
        from OCP.BRepAdaptor import BRepAdaptor_Curve  # noqa: PLC0415
        from OCP.GCPnts import GCPnts_QuasiUniformDeflection  # noqa: PLC0415
        from OCP.GeomAbs import GeomAbs_CurveType  # noqa: PLC0415
        from OCP.BRep import BRep_Tool  # noqa: PLC0415
        from OCP.TopLoc import TopLoc_Location  # noqa: PLC0415
        from OCP.TopExp import TopExp_Explorer  # noqa: PLC0415
        from OCP.TopAbs import TopAbs_ShapeEnum  # noqa: PLC0415
        from OCP.TopoDS import TopoDS  # noqa: PLC0415
        from OCP.ShapeAnalysis import ShapeAnalysis_FreeBounds  # noqa: PLC0415
        from OCP.TopTools import TopTools_HSequenceOfShape  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - exercised only on bad envs
        raise _CadHandlerError(
            "ocp_hlr_not_available",
            "OCP hidden-line-removal bindings are not available in the "
            "sidecar's Python environment",
            detail=str(exc),
        ) from exc

    return {
        "HLRBRep_Algo": HLRBRep_Algo,
        "HLRBRep_HLRToShape": HLRBRep_HLRToShape,
        "HLRAlgo_Projector": HLRAlgo_Projector,
        "gp_Ax2": gp_Ax2,
        "gp_Dir": gp_Dir,
        "gp_Pln": gp_Pln,
        "gp_Pnt": gp_Pnt,
        "BRepAlgoAPI_Section": BRepAlgoAPI_Section,
        "BRepBuilderAPI_MakeFace": BRepBuilderAPI_MakeFace,
        "BRepMesh_IncrementalMesh": BRepMesh_IncrementalMesh,
        "BRepAdaptor_Curve": BRepAdaptor_Curve,
        "GCPnts_QuasiUniformDeflection": GCPnts_QuasiUniformDeflection,
        "GeomAbs_CurveType": GeomAbs_CurveType,
        "BRep_Tool": BRep_Tool,
        "TopLoc_Location": TopLoc_Location,
        "TopExp_Explorer": TopExp_Explorer,
        "TopAbs_ShapeEnum": TopAbs_ShapeEnum,
        "TopoDS": TopoDS,
        "ShapeAnalysis_FreeBounds": ShapeAnalysis_FreeBounds,
        "TopTools_HSequenceOfShape": TopTools_HSequenceOfShape,
    }


# -- Param normalization ----------------------------------------------------


def _normalize_vec3(value: Any, field: str) -> Tuple[float, float, float]:
    """Coerce ``value`` to a finite 3-tuple of floats or raise ``bad_params``.

    Accepts list / tuple of length 3. Used for both ``plane_normal`` and
    ``view_dir``; the sidecar wrapper has already shape-checked, but this keeps
    the core callable directly from tests with the same guarantees.
    """
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise _CadHandlerError(
            "bad_params", f"{field} must be a 3-element [x, y, z] vector"
        )
    out: List[float] = []
    for i, c in enumerate(value):
        if isinstance(c, bool) or not isinstance(c, (int, float)):
            raise _CadHandlerError(
                "bad_params", f"{field}[{i}] must be a number"
            )
        f = float(c)
        if not math.isfinite(f):
            raise _CadHandlerError(
                "bad_params", f"{field}[{i}] must be finite"
            )
        out.append(f)
    return (out[0], out[1], out[2])


def _require_finite(value: Any, field: str) -> float:
    """Coerce ``value`` to a finite float or raise ``bad_params``."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise _CadHandlerError("bad_params", f"{field} must be a number")
    f = float(value)
    if not math.isfinite(f):
        raise _CadHandlerError("bad_params", f"{field} must be finite")
    return f


def _unit(vec: Tuple[float, float, float], field: str) -> Tuple[float, float, float]:
    """Return the unit vector of ``vec``; raise ``bad_params`` if zero-length."""
    mag = math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2])
    if mag <= 1e-12:
        raise _CadHandlerError(
            "bad_params", f"{field} must be a non-zero vector"
        )
    return (vec[0] / mag, vec[1] / mag, vec[2] / mag)


def _round_key(vec: Tuple[float, float, float]) -> Tuple[float, float, float]:
    return (
        round(vec[0], _KEY_ROUND),
        round(vec[1], _KEY_ROUND),
        round(vec[2], _KEY_ROUND),
    )


# -- Edge discretization ----------------------------------------------------


def _discretize_edge(
    edge: Any, ocp: Dict[str, Any], tolerance_mm: float
) -> List[List[float]]:
    """Sample one TopoDS_Edge into an ordered polyline ``[[x,y,z], ...]``.

    Uses ``GCPnts_QuasiUniformDeflection`` with the supplied deflection so a
    straight edge yields its two endpoints and a curve yields enough points to
    stay within ``tolerance_mm`` of the true arc.
    """
    curve = ocp["BRepAdaptor_Curve"](edge)
    disc = ocp["GCPnts_QuasiUniformDeflection"](curve, float(tolerance_mm))
    pts: List[List[float]] = []
    if not disc.IsDone():
        return pts
    for i in range(1, disc.NbPoints() + 1):
        p = disc.Value(i)
        pts.append([float(p.X()), float(p.Y()), float(p.Z())])
    return pts


def _walk_edges_to_polylines(
    compound: Any,
    ocp: Dict[str, Any],
    tolerance_mm: float,
    budget: int,
) -> Tuple[List[List[List[float]]], bool]:
    """Explore every edge in ``compound`` and discretize it.

    Returns ``(polylines, truncated)``. ``truncated`` is True if the per-call
    edge ``budget`` was hit (caller flags the whole result truncated). A
    polyline with fewer than 2 points is dropped (a degenerate sample).
    """
    polylines: List[List[List[float]]] = []
    truncated = False
    if compound is None:
        return polylines, truncated

    exp = ocp["TopExp_Explorer"](
        compound, ocp["TopAbs_ShapeEnum"].TopAbs_EDGE
    )
    while exp.More():
        if len(polylines) >= budget:
            truncated = True
            break
        edge = ocp["TopoDS"].Edge_s(exp.Current())
        pts = _discretize_edge(edge, ocp, tolerance_mm)
        if len(pts) >= 2:
            polylines.append(pts)
        exp.Next()
    return polylines, truncated


# -- Cap face (section profile) ---------------------------------------------


def _section_wires(
    shape: Any,
    plane: Any,
    ocp: Dict[str, Any],
) -> List[Any]:
    """Intersect ``shape`` with ``plane`` and stitch the cut edges into wires.

    Returns a list of TopoDS_Wire loops (one per closed contour -- an annulus
    section yields two). Empty list when the plane misses the body.
    """
    sec = ocp["BRepAlgoAPI_Section"](shape, plane, False)
    sec.ComputePCurveOn1(True)
    sec.Approximation(True)
    sec.Build()
    cut = sec.Shape()

    seq = ocp["TopTools_HSequenceOfShape"]()
    exp = ocp["TopExp_Explorer"](cut, ocp["TopAbs_ShapeEnum"].TopAbs_EDGE)
    edge_count = 0
    while exp.More():
        seq.Append(ocp["TopoDS"].Edge_s(exp.Current()))
        edge_count += 1
        exp.Next()
    if edge_count == 0:
        return []

    wires_seq = ocp["TopTools_HSequenceOfShape"]()
    ocp["ShapeAnalysis_FreeBounds"].ConnectEdgesToWires_s(
        seq, _WIRE_STITCH_TOL, False, wires_seq
    )
    wires: List[Any] = []
    for i in range(1, wires_seq.Length() + 1):
        wires.append(ocp["TopoDS"].Wire_s(wires_seq.Value(i)))
    return wires


def _cap_outline_polylines(
    wires: List[Any],
    ocp: Dict[str, Any],
    tolerance_mm: float,
) -> List[List[List[float]]]:
    """Discretize each section wire into an ordered outline polyline."""
    outlines: List[List[List[float]]] = []
    for wire in wires:
        pts, _ = _walk_edges_to_polylines(
            wire, ocp, tolerance_mm, _MAX_EDGE_COUNT
        )
        # Concatenate the wire's edge polylines into a single ring. The edges
        # come back connected (ConnectEdgesToWires ordered them); we just
        # flatten, dropping the duplicated shared endpoint between segments.
        ring: List[List[float]] = []
        for seg in pts:
            if ring and seg and _close(ring[-1], seg[0]):
                ring.extend(seg[1:])
            else:
                ring.extend(seg)
        if len(ring) >= 2:
            outlines.append(ring)
    return outlines


def _close(a: List[float], b: List[float]) -> bool:
    return (
        abs(a[0] - b[0]) <= 1e-6
        and abs(a[1] - b[1]) <= 1e-6
        and abs(a[2] - b[2]) <= 1e-6
    )


def _cap_triangles(
    wires: List[Any],
    plane: Any,
    ocp: Dict[str, Any],
) -> List[float]:
    """Build a filled face from the section wires and mesh it to triangles.

    The first (largest-perimeter) wire is the outer boundary; remaining wires
    are added as holes (annulus support). Returns a flat
    ``[x,y,z, x,y,z, x,y,z, ...]`` array (9 floats per triangle), or an empty
    list when the wire set is degenerate (caller keeps the edges).
    """
    if not wires:
        return []

    # Largest perimeter first so the outer contour is the face boundary and the
    # inner contours become holes.
    ordered = sorted(wires, key=lambda w: -_wire_perimeter(w, ocp))
    try:
        mf = ocp["BRepBuilderAPI_MakeFace"](plane, ordered[0], True)
        for hole in ordered[1:]:
            mf.Add(hole)
        if not mf.IsDone():
            return []
        face = mf.Face()
    except Exception:  # noqa: BLE001 - degenerate wire -> no cap, keep edges
        return []

    ocp["BRepMesh_IncrementalMesh"](face, _CAP_MESH_DEFLECTION)
    loc = ocp["TopLoc_Location"]()
    tri = ocp["BRep_Tool"].Triangulation_s(face, loc)
    if tri is None:
        return []

    trsf = loc.Transformation()
    apply_loc = not loc.IsIdentity()

    out: List[float] = []
    for i in range(1, tri.NbTriangles() + 1):
        t = tri.Triangle(i)
        for node_idx in (t.Value(1), t.Value(2), t.Value(3)):
            p = tri.Node(node_idx)
            if apply_loc:
                p = p.Transformed(trsf)
            out.append(float(p.X()))
            out.append(float(p.Y()))
            out.append(float(p.Z()))
    return out


def _wire_perimeter(wire: Any, ocp: Dict[str, Any]) -> float:
    """Approximate perimeter of a wire (sum of its edge chord lengths)."""
    pts, _ = _walk_edges_to_polylines(
        wire, ocp, _CAP_MESH_DEFLECTION, _MAX_EDGE_COUNT
    )
    total = 0.0
    for seg in pts:
        for j in range(1, len(seg)):
            a, b = seg[j - 1], seg[j]
            total += math.sqrt(
                (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
            )
    return total


# -- bbox over emitted geometry ---------------------------------------------


def _accumulate_bbox(
    polyline_groups: List[List[List[List[float]]]],
    flat_triangles: List[float],
) -> Dict[str, List[float]]:
    """Compute the axis-aligned bbox over all emitted edges + cap triangles.

    Operates on the **projected** output so the renderer can frame the section
    overlay directly. Returns a zero bbox if nothing was emitted.
    """
    xs_min = ys_min = zs_min = math.inf
    xs_max = ys_max = zs_max = -math.inf

    def _bump(x: float, y: float, z: float) -> None:
        nonlocal xs_min, ys_min, zs_min, xs_max, ys_max, zs_max
        xs_min = min(xs_min, x)
        ys_min = min(ys_min, y)
        zs_min = min(zs_min, z)
        xs_max = max(xs_max, x)
        ys_max = max(ys_max, y)
        zs_max = max(zs_max, z)

    for group in polyline_groups:
        for poly in group:
            for p in poly:
                _bump(p[0], p[1], p[2])
    for i in range(0, len(flat_triangles) - 2, 3):
        _bump(flat_triangles[i], flat_triangles[i + 1], flat_triangles[i + 2])

    if xs_min is math.inf:
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0]}
    return {
        "min": [xs_min, ys_min, zs_min],
        "max": [xs_max, ys_max, zs_max],
    }


# -- Public entry point -----------------------------------------------------


def hlr_section(
    handle: str,
    plane_normal: Any,
    plane_offset: float,
    view_dir: Any,
    tolerance_mm: float = 0.1,
) -> Dict[str, Any]:
    """Compute a true-HLR section view for the body behind ``handle``.

    Parameters
    ----------
    handle:
        Opaque handle from a prior ``cad.import_step`` / ``cad.execute_script``.
    plane_normal:
        3-vector normal of the section plane (need not be unit length).
    plane_offset:
        Signed offset of the plane along its normal, in mm. A point ``p`` is on
        the plane when ``dot(p, unit(plane_normal)) == plane_offset``.
    view_dir:
        3-vector view direction for the hidden-line projection (the operator
        looks **along** this vector).
    tolerance_mm:
        Edge discretization deflection in mm (default 0.1). The cap face meshes
        at a fixed coarse deflection regardless -- it is a flat fill.

    Returns
    -------
    dict with::

        {
          "visibleEdges":     [[[x,y,z], ...], ...],  # solid linework
          "hiddenEdges":      [[[x,y,z], ...], ...],  # dashed linework
          "capFaceTriangles": [x,y,z, x,y,z, x,y,z, ...],  # 9 floats / tri
          "capFaceOutline":   [[[x,y,z], ...], ...],  # 1 ring per section loop
          "bbox":             {"min": [..3], "max": [..3]},
          "truncated":        bool,  # edge budget hit -> renderer shows notice
        }

    Raises ``_CadHandlerError`` with one of ``ocp_hlr_not_available`` /
    ``invalid_handle`` / ``bad_params`` / ``hlr_section_error``.
    """
    # Validate params up front (before the OCP import) so a malformed call
    # fails fast with the same vocabulary regardless of environment.
    normal = _unit(_normalize_vec3(plane_normal, "plane_normal"), "plane_normal")
    offset = _require_finite(plane_offset, "plane_offset")
    look = _unit(_normalize_vec3(view_dir, "view_dir"), "view_dir")
    tol = _require_finite(tolerance_mm, "tolerance_mm")
    if tol <= 0:
        raise _CadHandlerError("bad_params", "tolerance_mm must be positive")

    doc = _HANDLES.get(handle)
    if doc is None:
        raise _CadHandlerError(
            "invalid_handle",
            f"unknown CAD handle: {handle!r} "
            f"(table holds {len(_HANDLES)} entries)",
        )

    cache_key = (
        handle,
        _round_key(normal),
        round(offset, _KEY_ROUND),
        _round_key(look),
        round(tol, _KEY_ROUND),
    )
    cached = _CACHE.get(cache_key)
    if cached is not None:
        _CACHE.move_to_end(cache_key)
        return cached

    ocp = _load_ocp()

    try:
        shape = doc.workplane.findSolid().wrapped
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "hlr_section_error",
            f"could not resolve a solid from handle {handle!r}: {exc}",
            detail=str(exc),
        ) from exc

    try:
        result = _compute(shape, normal, offset, look, tol, ocp)
    except _CadHandlerError:
        raise
    except Exception as exc:  # noqa: BLE001 - OCCT raises arbitrary types
        raise _CadHandlerError(
            "hlr_section_error",
            f"hidden-line section computation failed: {exc}",
            detail=str(exc),
        ) from exc

    _CACHE[cache_key] = result
    _CACHE.move_to_end(cache_key)
    while len(_CACHE) > _CACHE_CAP:
        _CACHE.popitem(last=False)
    return result


def _compute(
    shape: Any,
    normal: Tuple[float, float, float],
    offset: float,
    look: Tuple[float, float, float],
    tol: float,
    ocp: Dict[str, Any],
) -> Dict[str, Any]:
    """Core pipeline (assumes validated inputs + loaded OCP). Pure of caching."""
    # -- Cap profile + triangles --
    plane_origin = (normal[0] * offset, normal[1] * offset, normal[2] * offset)
    pln = ocp["gp_Pln"](
        ocp["gp_Pnt"](plane_origin[0], plane_origin[1], plane_origin[2]),
        ocp["gp_Dir"](normal[0], normal[1], normal[2]),
    )
    wires = _section_wires(shape, pln, ocp)
    cap_outline = _cap_outline_polylines(wires, ocp, tol)
    cap_triangles = _cap_triangles(wires, pln, ocp)

    # -- Hidden-line removal from the view direction --
    algo = ocp["HLRBRep_Algo"]()
    algo.Add(shape)
    # The projector's eye coordinate system looks along its Z axis; pass the
    # view direction as that Z. ``gp_Ax2`` derives an orthonormal frame.
    ax2 = ocp["gp_Ax2"](
        ocp["gp_Pnt"](0.0, 0.0, 0.0),
        ocp["gp_Dir"](look[0], look[1], look[2]),
    )
    algo.Projector(ocp["HLRAlgo_Projector"](ax2))
    algo.Update()
    algo.Hide()
    hlr = ocp["HLRBRep_HLRToShape"](algo)

    budget = _MAX_EDGE_COUNT
    truncated = False

    visible_edges: List[List[List[float]]] = []
    hidden_edges: List[List[List[float]]] = []

    # Visible: sharp edges (VCompound) + smooth-surface silhouettes
    # (OutLineVCompound). Both render solid.
    for accessor in ("VCompound", "OutLineVCompound"):
        compound = _safe_compound(hlr, accessor)
        remaining = budget - len(visible_edges)
        if remaining <= 0:
            truncated = True
            break
        polys, tr = _walk_edges_to_polylines(compound, ocp, tol, remaining)
        visible_edges.extend(polys)
        truncated = truncated or tr

    # Hidden: occluded sharp edges (HCompound) + occluded silhouettes
    # (OutLineHCompound). Both render dashed/dimmed.
    for accessor in ("HCompound", "OutLineHCompound"):
        compound = _safe_compound(hlr, accessor)
        remaining = budget - len(hidden_edges)
        if remaining <= 0:
            truncated = True
            break
        polys, tr = _walk_edges_to_polylines(compound, ocp, tol, remaining)
        hidden_edges.extend(polys)
        truncated = truncated or tr

    bbox = _accumulate_bbox(
        [visible_edges, hidden_edges, cap_outline], cap_triangles
    )

    return {
        "visibleEdges": visible_edges,
        "hiddenEdges": hidden_edges,
        "capFaceTriangles": cap_triangles,
        "capFaceOutline": cap_outline,
        "bbox": bbox,
        "truncated": truncated,
    }


def _safe_compound(hlr: Any, accessor: str) -> Optional[Any]:
    """Call an HLRToShape compound accessor, returning None on any failure.

    Older OCP builds may not expose every accessor (e.g. an unusual
    ``OutLine*`` name); a missing one should drop that edge class, not abort
    the whole section.
    """
    fn = getattr(hlr, accessor, None)
    if fn is None:
        return None
    try:
        return fn()
    except Exception:  # noqa: BLE001 - accessor not supported on this build
        return None


# -- Shared view-only HLR projection (2D drawing linework) ------------------
#
# ``hlr_section`` above pairs a section cut WITH the hidden-line pass. The 2D
# drawing pipeline (``cadquery_drawing.project_to_drawing`` with ``includeHlr``)
# wants ONLY the hidden-line pass for a view direction -- no plane, no cap. This
# helper factors that projection out so the drawing SVG builder reuses the exact
# same HLR machinery (``HLRBRep_Algo`` + ``HLRBRep_HLRToShape`` + the edge walk)
# rather than duplicating it.
#
# Coordinate-space contract (the single hardest correctness constraint):
# =====================================================================
# The projector is built with ``gp_Ax2(gp_Pnt(), gp_Dir(*look))`` -- BYTE-
# IDENTICAL to the coordinate system CadQuery's ``getSVG`` builds AND to the one
# ``cadquery_drawing_geometry.extract_drawing_geometry`` (the snap-point source)
# builds. It also walks the SAME accessor set the snap extractor walks
# (``VCompound`` / ``OutLineVCompound`` visible, ``HCompound`` /
# ``OutLineHCompound`` hidden). Therefore the 2D ``(x, y)`` coordinates this
# helper returns are in the SAME projected SVG-mm space as the snap points --
# a dimension anchored to a snap point lands exactly on this linework.


def project_view_edges(
    shape: Any,
    view_dir: Any,
    tolerance_mm: float = 0.1,
) -> Dict[str, Any]:
    """Run view-direction HLR on ``shape`` and return 2D projected linework.

    Parameters
    ----------
    shape:
        A wrapped OCCT ``TopoDS_Shape`` (e.g. ``workplane.findSolid().wrapped``).
    view_dir:
        3-vector view direction for the hidden-line projection (the operator
        looks **along** this vector). Need not be unit length.
    tolerance_mm:
        Edge discretization deflection in mm (default 0.1).

    Returns
    -------
    dict with::

        {
          "visible":   [[[x, y], ...], ...],  # solid linework, 2D projected
          "hidden":    [[[x, y], ...], ...],  # dashed linework, 2D projected
          "bbox2d":    {"min": [x, y], "max": [x, y]},
          "truncated": bool,  # edge budget hit
        }

    The returned polylines drop the projected Z (HLR flattens it into the view
    plane) so each point is a 2-tuple in SVG-mm space -- matching the snap
    extractor's coordinate convention.

    Raises ``_CadHandlerError`` with ``bad_params`` (bad view_dir / tolerance)
    or ``ocp_hlr_not_available`` (missing bindings). OCCT mid-pipeline raises
    surface as ``hlr_section_error`` for parity with ``hlr_section``.
    """
    look = _unit(_normalize_vec3(view_dir, "view_dir"), "view_dir")
    tol = _require_finite(tolerance_mm, "tolerance_mm")
    if tol <= 0:
        raise _CadHandlerError("bad_params", "tolerance_mm must be positive")

    ocp = _load_ocp()
    try:
        return _project_view(shape, look, tol, ocp)
    except _CadHandlerError:
        raise
    except Exception as exc:  # noqa: BLE001 - OCCT raises arbitrary types
        raise _CadHandlerError(
            "hlr_section_error",
            f"hidden-line drawing projection failed: {exc}",
            detail=str(exc),
        ) from exc


def _project_view(
    shape: Any,
    look: Tuple[float, float, float],
    tol: float,
    ocp: Dict[str, Any],
) -> Dict[str, Any]:
    """Core view-only HLR pass (assumes validated inputs + loaded OCP).

    Mirrors the HLR half of :func:`_compute` (no section cut / cap) and drops
    the projected Z from every sampled point so the output is 2D SVG-mm.
    """
    algo = ocp["HLRBRep_Algo"]()
    algo.Add(shape)
    ax2 = ocp["gp_Ax2"](
        ocp["gp_Pnt"](0.0, 0.0, 0.0),
        ocp["gp_Dir"](look[0], look[1], look[2]),
    )
    algo.Projector(ocp["HLRAlgo_Projector"](ax2))
    algo.Update()
    algo.Hide()
    hlr = ocp["HLRBRep_HLRToShape"](algo)

    budget = _MAX_EDGE_COUNT
    truncated = False

    visible3d: List[List[List[float]]] = []
    hidden3d: List[List[List[float]]] = []

    # Same accessor set the snap extractor (cadquery_drawing_geometry) walks so
    # the projected coordinates agree: sharp visible + smooth-surface silhouette
    # for solid; occluded sharp + occluded silhouette for dashed.
    for accessor in ("VCompound", "OutLineVCompound"):
        compound = _safe_compound(hlr, accessor)
        remaining = budget - len(visible3d)
        if remaining <= 0:
            truncated = True
            break
        polys, tr = _walk_edges_to_polylines(compound, ocp, tol, remaining)
        visible3d.extend(polys)
        truncated = truncated or tr

    for accessor in ("HCompound", "OutLineHCompound"):
        compound = _safe_compound(hlr, accessor)
        remaining = budget - len(hidden3d)
        if remaining <= 0:
            truncated = True
            break
        polys, tr = _walk_edges_to_polylines(compound, ocp, tol, remaining)
        hidden3d.extend(polys)
        truncated = truncated or tr

    # Drop the projected Z -> 2D SVG-mm polylines.
    visible = [[[p[0], p[1]] for p in poly] for poly in visible3d]
    hidden = [[[p[0], p[1]] for p in poly] for poly in hidden3d]

    return {
        "visible": visible,
        "hidden": hidden,
        "bbox2d": _bbox2d(visible, hidden),
        "truncated": truncated,
    }


def _bbox2d(
    visible: List[List[List[float]]],
    hidden: List[List[List[float]]],
) -> Dict[str, List[float]]:
    """Tight 2D bbox over every visible + hidden point. Zero bbox when empty."""
    xs_min = ys_min = math.inf
    xs_max = ys_max = -math.inf
    for group in (visible, hidden):
        for poly in group:
            for p in poly:
                xs_min = min(xs_min, p[0])
                ys_min = min(ys_min, p[1])
                xs_max = max(xs_max, p[0])
                ys_max = max(ys_max, p[1])
    if xs_min is math.inf:
        return {"min": [0.0, 0.0], "max": [0.0, 0.0]}
    return {"min": [xs_min, ys_min], "max": [xs_max, ys_max]}


# -- Test / diagnostics helpers ---------------------------------------------


def reset_cache() -> None:
    """Clear the LRU cache. Used by tests to assert cache behaviour."""
    _CACHE.clear()


def cache_size() -> int:
    """Return the number of cached section results. For tests / diagnostics."""
    return len(_CACHE)


__all__ = [
    "hlr_section",
    "project_view_edges",
    "reset_cache",
    "cache_size",
]
