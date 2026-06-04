"""Projected 2D drawing geometry extraction with STABLE IDs (CAD V2 — snap).

Companion to ``engines/cad/cadquery_drawing.py``. Where ``project_to_drawing``
returns an opaque CadQuery ``getSVG`` blob (drawn linework only, no element
ids), this module returns the **same projection's geometry tagged with stable
ids** so the renderer's dimension layer can snap to model features (endpoints,
midpoints, arc centres, quadrants) and persist *which* feature a dimension
anchored to.

Why a separate method (not an extension of ``project_to_drawing``)?
==================================================================
``project_to_drawing`` is the live-preview path: it streams the bare SVG into
``<div dangerouslySetInnerHTML>``. The snap layer needs structured geometry
(ids + coordinates) that the SVG blob cannot carry. Keeping the two methods
separate mirrors the existing ``project_drawing`` / ``dimension_drawing`` split
and lets the renderer fetch snap points lazily (only when a dimension tool is
active) without re-fetching the preview SVG.

The single hardest correctness constraint: coordinate-space agreement
=====================================================================
CadQuery's ``getSVG`` runs OCCT HLR with
``gp_Ax2(gp_Pnt(), gp_Dir(*projectionDir))`` and writes each projected edge's
raw 2D ``(p.X(), p.Y())`` straight into the SVG ``<path d="...">`` data — the
``<g transform="scale(s,-s) translate(...)">`` wrapper only handles *visual*
placement; the path coordinate **numbers** are raw HLR-projected model-mm.

This module runs the **identical HLR projection** (same ``gp_Ax2`` /
``gp_Dir``) and walks the same ``VCompound`` / ``HCompound`` edges, so every
vertex / edge / snap coordinate it emits is in the *same* SVG coordinate space
as the ``svg`` field it returns alongside (which is produced by the very same
``getSVG`` call). Geometry and SVG therefore can never disagree on origin or
scale: both come from one projection. (Empirically verified: a 30 mm cube front
view yields path coords spanning -15..+15 and the HLR edge walk yields the same
-15..+15 endpoints; an offset circle projects to the same centre in both.)

Stable IDs (quantized-hash, NOT OCCT back-mapping)
==================================================
Re-projecting a part after a rebuild produces fresh OCCT shapes whose internal
hashes / edge ordinals are NOT stable, so an id keyed on the source
``TopoDS_Edge`` identity would churn on every edit. Instead each id is a hash
of the **projected, quantized 2D coordinates** (rounded to ``_QUANT`` decimals):

  * vertex id  → ``v:<hash(round(x), round(y))>``
  * edge id    → ``e:<hash(round(p1), round(p2)[, round(center), round(radius)])>``

A geometric feature that lands at the same projected location after a rebuild
keeps the same id — which is exactly what an associative dimension needs. The
quantization grid (1e-3 mm) is finer than any drafting tolerance and coarse
enough to absorb floating-point reprojection jitter.

Snap-point kinds
================
Match ``SnapPointKind`` plus the geometry-derived extras the renderer wants:
``'endpoint'`` (line / arc ends), ``'midpoint'`` (line / arc midpoints),
``'center'`` (circle / arc centres), ``'quadrant'`` (the 0/90/180/270° points
on a full circle). The renderer's ``drawing-snap.ts`` priority table maps the
first three directly; ``'quadrant'`` is treated like a vertex-class target.

Safety Rule 1 — G-code is sacred
================================
This module does NOT emit G-code or STL. Its output is renderer-only (the
drawing snap layer); no downstream CAM logic consumes it.

Error vocabulary (raised as ``_CadHandlerError``)
=================================================
  * ``cadquery_not_installed`` — ``import cadquery`` failed.
  * ``ocp_hlr_not_available``  — an OCP HLR / projection binding is missing.
  * ``invalid_handle``         — handle not in the table.
  * ``bad_params``             — empty handle or unknown view name.
  * ``drawing_error``          — CadQuery / OCCT raised mid-projection.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple

from .cadquery_drawing import (
    ALLOWED_VIEWS,
    VIEW_DIRECTIONS,
    _build_svg_opts,
    _resolve_handle,
    _validate_view,
)
from .cadquery_import import _CadHandlerError
from .cadquery_hlr import _load_ocp


# ── Tunables ──────────────────────────────────────────────────────────────

# Decimal places the projected 2D coordinates are quantized to before hashing
# (and before they appear in vertex / edge / snap ids). 1e-3 mm is finer than
# any drafting tolerance and absorbs reprojection float jitter so a feature
# that lands at the same projected spot after a rebuild keeps its id.
_QUANT = 3

# Edge discretization deflection (mm) for the returned ``points`` polylines.
# Matches the other tessellation paths (cad.hlr_section default) so curve
# density is consistent app-wide.
_DISC_TOL = 0.1

# Hard cap on emitted edges (visible + hidden). A pathological body can yield
# tens of thousands; past this we stop and flag nothing extra (snap coverage on
# a part that large is already past the point of usefulness). Mirrors the
# ``cadquery_hlr`` budget posture.
_MAX_EDGE_COUNT = 10_000

# Below this projected length (mm) a "line" is too short to host a meaningful
# midpoint snap distinct from its endpoints; we skip the midpoint to avoid
# stacking three snap points on top of each other.
_MIN_MIDPOINT_LEN = 1e-3


# ── Stable-id hashing (FNV-1a over quantized coords) ──────────────────────


# FNV-1a 64-bit constants. Same family as the renderer's plate-thumbnail cache
# key (``plate-thumbnail.ts``) so the hashing style is consistent across the
# codebase; we only need determinism, not cryptographic strength.
_FNV_OFFSET = 0xCBF29CE484222325
_FNV_PRIME = 0x100000001B3
_FNV_MASK = 0xFFFFFFFFFFFFFFFF


def _q(value: float) -> float:
    """Quantize a coordinate to the id grid. Folds -0.0 to 0.0 so the sign of
    a zero never splits an id."""
    r = round(float(value), _QUANT)
    return 0.0 if r == 0.0 else r


def _fnv1a(text: str) -> str:
    """FNV-1a 64-bit hash of ``text`` rendered as a fixed-width hex string.

    Deterministic and dependency-free (Python's builtin ``hash`` is salted per
    process and therefore unusable for a stable, cross-run id).
    """
    h = _FNV_OFFSET
    for byte in text.encode("utf-8"):
        h ^= byte
        h = (h * _FNV_PRIME) & _FNV_MASK
    return f"{h:016x}"


def _vertex_id(x: float, y: float) -> str:
    """Stable id for a projected 2D vertex, keyed on its quantized position."""
    return "v:" + _fnv1a(f"{_q(x):.3f},{_q(y):.3f}")


def _line_edge_id(p1: Tuple[float, float], p2: Tuple[float, float]) -> str:
    """Stable id for a projected line edge.

    Endpoints are sorted so the id is orientation-independent (an edge walked
    p1→p2 in one projection and p2→p1 in the next still collides).
    """
    a = (_q(p1[0]), _q(p1[1]))
    b = (_q(p2[0]), _q(p2[1]))
    lo, hi = sorted((a, b))
    return "e:" + _fnv1a(
        f"L|{lo[0]:.3f},{lo[1]:.3f}|{hi[0]:.3f},{hi[1]:.3f}"
    )


def _arc_edge_id(
    kind: str,
    center: Tuple[float, float],
    radius: float,
    p1: Tuple[float, float],
    p2: Tuple[float, float],
) -> str:
    """Stable id for a projected circle / arc edge.

    Keyed on the quantized centre + radius (and, for an arc, the sorted
    endpoints so two arcs sharing a circle but spanning different sweeps get
    distinct ids). A full circle has coincident endpoints, so the endpoint
    term collapses and the id is centre+radius only.
    """
    c = (_q(center[0]), _q(center[1]))
    a = (_q(p1[0]), _q(p1[1]))
    b = (_q(p2[0]), _q(p2[1]))
    lo, hi = sorted((a, b))
    return "e:" + _fnv1a(
        f"{kind[0].upper()}|{c[0]:.3f},{c[1]:.3f}|r{_q(radius):.3f}|"
        f"{lo[0]:.3f},{lo[1]:.3f}|{hi[0]:.3f},{hi[1]:.3f}"
    )


# ── Edge classification + discretization ──────────────────────────────────


def _curve_kind(curve: Any, ocp: Dict[str, Any]) -> str:
    """Classify a ``BRepAdaptor_Curve`` as ``'circle'`` / ``'arc'`` / ``'line'``.

    A closed circular curve is ``'circle'``; an open circular curve is
    ``'arc'``; everything else (lines, and any spline/ellipse we don't special-
    case) reports ``'line'`` and is treated as a polyline by coordinate. The
    renderer only needs the three kinds for snap-point derivation.
    """
    geomabs = ocp["GeomAbs_CurveType"]
    try:
        ctype = curve.GetType()
    except Exception:  # noqa: BLE001 - binding drift -> treat as polyline
        return "line"
    if ctype == geomabs.GeomAbs_Circle:
        try:
            return "circle" if curve.IsClosed() else "arc"
        except Exception:  # noqa: BLE001 - assume arc if closedness unknown
            return "arc"
    if ctype == geomabs.GeomAbs_Line:
        return "line"
    # Ellipse / spline / other: render as a discretized polyline. We still emit
    # endpoint + midpoint snaps from the sampled points below.
    return "line"


def _discretize(curve_edge: Any, ocp: Dict[str, Any]) -> List[Tuple[float, float]]:
    """Sample a projected edge into an ordered list of 2D ``(x, y)`` points.

    Drops the projected Z (HLR has already flattened it to ~0 in the view
    plane). Returns ``[]`` for a degenerate sample (caller skips the edge).
    """
    curve = ocp["BRepAdaptor_Curve"](curve_edge)
    disc = ocp["GCPnts_QuasiUniformDeflection"](curve, _DISC_TOL)
    pts: List[Tuple[float, float]] = []
    if not disc.IsDone():
        return pts
    for i in range(1, disc.NbPoints() + 1):
        p = disc.Value(i)
        pts.append((float(p.X()), float(p.Y())))
    return pts


def _circle_params(
    curve_edge: Any, ocp: Dict[str, Any]
) -> Optional[Tuple[Tuple[float, float], float]]:
    """Return ``((cx, cy), radius)`` for a circular projected edge, else None.

    The projected circle's ``Location()`` is already in the view-plane 2D frame
    (verified: an offset circle projects to the same centre the SVG path data
    uses), so we take X / Y directly.
    """
    curve = ocp["BRepAdaptor_Curve"](curve_edge)
    geomabs = ocp["GeomAbs_CurveType"]
    try:
        if curve.GetType() != geomabs.GeomAbs_Circle:
            return None
        circ = curve.Circle()
        loc = circ.Location()
        return ((float(loc.X()), float(loc.Y())), float(circ.Radius()))
    except Exception:  # noqa: BLE001 - not a clean circle -> caller falls back
        return None


# ── Snap-point derivation ─────────────────────────────────────────────────


def _midpoint(
    p1: Tuple[float, float], p2: Tuple[float, float]
) -> Tuple[float, float]:
    return ((p1[0] + p2[0]) / 2.0, (p1[1] + p2[1]) / 2.0)


def _snap(
    kind: str,
    x: float,
    y: float,
    owner_id: str,
    ordinal: int,
) -> Dict[str, Any]:
    """Build one snap-point dict in the SUPERSET wire shape.

    Carries this module's canonical fields (``kind`` / ``x`` / ``y`` /
    ``ownerId``) AND the back-compat fields the existing IPC coercer reads
    (``id`` / ``sourceId``). ``sourceId`` echoes ``ownerId`` (the source
    vertex / edge id); ``id`` is a per-owner-stable handle ``<ownerId>#<kind>N``
    so two snaps of the same kind on the same owner (e.g. two endpoints) stay
    distinct and reproducible across reprojection.
    """
    snap_id = f"{owner_id}#{kind}{ordinal}"
    return {
        "kind": kind,
        "x": x,
        "y": y,
        "ownerId": owner_id,
        # ── back-compat (consumed by ipc-cad.ts coerceDrawingSnapPoint) ──
        "id": snap_id,
        "sourceId": owner_id,
    }


def _emit_line_snaps(
    points: List[Tuple[float, float]],
    edge_id: str,
    snaps: List[Dict[str, Any]],
) -> None:
    """Append endpoint + midpoint snaps for a polyline (line / spline) edge."""
    if len(points) < 2:
        return
    p1, p2 = points[0], points[-1]
    snaps.append(_snap("endpoint", p1[0], p1[1], edge_id, 0))
    snaps.append(_snap("endpoint", p2[0], p2[1], edge_id, 1))
    mid = _midpoint(p1, p2)
    if math.hypot(p2[0] - p1[0], p2[1] - p1[1]) >= _MIN_MIDPOINT_LEN:
        snaps.append(_snap("midpoint", mid[0], mid[1], edge_id, 0))


def _emit_circle_snaps(
    center: Tuple[float, float],
    radius: float,
    edge_id: str,
    snaps: List[Dict[str, Any]],
) -> None:
    """Append centre + 4 quadrant snaps for a full-circle edge."""
    cx, cy = center
    snaps.append(_snap("center", cx, cy, edge_id, 0))
    for i, (dx, dy) in enumerate(
        ((1.0, 0.0), (0.0, 1.0), (-1.0, 0.0), (0.0, -1.0))
    ):
        snaps.append(
            _snap("quadrant", cx + dx * radius, cy + dy * radius, edge_id, i)
        )


def _emit_arc_snaps(
    center: Tuple[float, float],
    points: List[Tuple[float, float]],
    edge_id: str,
    snaps: List[Dict[str, Any]],
) -> None:
    """Append centre + endpoint + midpoint snaps for an arc edge.

    The arc's geometric midpoint is the middle sample of its discretization
    (the points came back ordered along the sweep), which lands on the arc
    rather than on the chord.
    """
    snaps.append(_snap("center", center[0], center[1], edge_id, 0))
    if len(points) >= 2:
        p1, p2 = points[0], points[-1]
        snaps.append(_snap("endpoint", p1[0], p1[1], edge_id, 0))
        snaps.append(_snap("endpoint", p2[0], p2[1], edge_id, 1))
        mid = points[len(points) // 2]
        snaps.append(_snap("midpoint", mid[0], mid[1], edge_id, 0))


# ── Edge walk ──────────────────────────────────────────────────────────────


def _walk_projected_edges(
    compound: Any,
    ocp: Dict[str, Any],
    budget: int,
    edges_out: List[Dict[str, Any]],
    snaps_out: List[Dict[str, Any]],
    vertex_acc: "Dict[str, Dict[str, Any]]",
) -> bool:
    """Walk every edge in a projected HLR compound, emitting edges + snaps.

    Mutates ``edges_out`` / ``snaps_out`` / ``vertex_acc`` in place. Returns
    True if the per-call ``budget`` was hit (caller stops appending). Vertices
    are accumulated into ``vertex_acc`` keyed by stable id so coincident
    endpoints across edges collapse to one vertex entry.
    """
    if compound is None or compound.IsNull():
        return False

    exp = ocp["TopExp_Explorer"](
        compound, ocp["TopAbs_ShapeEnum"].TopAbs_EDGE
    )
    while exp.More():
        if len(edges_out) >= budget:
            return True
        edge = ocp["TopoDS"].Edge_s(exp.Current())
        kind = _curve_kind(ocp["BRepAdaptor_Curve"](edge), ocp)
        points = _discretize(edge, ocp)
        if len(points) < 2:
            exp.Next()
            continue

        p1, p2 = points[0], points[-1]
        v1_id = _vertex_id(*p1)
        v2_id = _vertex_id(*p2)

        if kind == "circle":
            cp = _circle_params(edge, ocp)
            if cp is None:
                kind = "line"  # fall back to polyline treatment
        if kind == "circle":
            (center, radius) = cp  # type: ignore[misc] - guarded above
            edge_id = _arc_edge_id("circle", center, radius, p1, p2)
            edges_out.append(
                _edge_dict(
                    edge_id, "circle", p1, p2, points, v1_id, v2_id,
                    center=center, radius=radius,
                )
            )
            _emit_circle_snaps(center, radius, edge_id, snaps_out)
        elif kind == "arc":
            cp = _circle_params(edge, ocp)
            center = cp[0] if cp is not None else _midpoint(p1, p2)
            radius = cp[1] if cp is not None else math.hypot(
                p2[0] - p1[0], p2[1] - p1[1]
            ) / 2.0
            edge_id = _arc_edge_id("arc", center, radius, p1, p2)
            edges_out.append(
                _edge_dict(
                    edge_id, "arc", p1, p2, points, v1_id, v2_id,
                    center=center, radius=radius,
                )
            )
            _emit_arc_snaps(center, points, edge_id, snaps_out)
        else:  # line / polyline
            edge_id = _line_edge_id(p1, p2)
            edges_out.append(
                _edge_dict(
                    edge_id, "line", p1, p2, points, v1_id, v2_id,
                    center=None, radius=None,
                )
            )
            _emit_line_snaps(points, edge_id, snaps_out)

        # Accumulate endpoint vertices (collapse coincident ones by id). A full
        # circle has coincident endpoints — recording the single shared vertex
        # is harmless and keeps the vertex list non-empty for closed loops. The
        # ``id`` field mirrors ``vertexId`` for the back-compat IPC coercer.
        vertex_acc.setdefault(
            v1_id, {"vertexId": v1_id, "id": v1_id, "x": p1[0], "y": p1[1]}
        )
        vertex_acc.setdefault(
            v2_id, {"vertexId": v2_id, "id": v2_id, "x": p2[0], "y": p2[1]}
        )

        exp.Next()
    return False


def _edge_dict(
    edge_id: str,
    kind: str,
    p1: Tuple[float, float],
    p2: Tuple[float, float],
    points: List[Tuple[float, float]],
    v1_id: str,
    v2_id: str,
    *,
    center: Optional[Tuple[float, float]],
    radius: Optional[float],
) -> Dict[str, Any]:
    """Build one projected-edge dict in the SUPERSET wire shape.

    Canonical fields: ``edgeId`` / ``kind`` / ``p1`` / ``p2`` / ``center`` /
    ``radius`` / ``v1`` / ``v2``. Back-compat fields consumed by
    ``ipc-cad.ts coerceDrawingEdge``: ``id`` (mirrors ``edgeId``) and
    ``points`` (the ordered ``[[x, y], ...]`` discretization, length >= 2).
    """
    return {
        "edgeId": edge_id,
        "kind": kind,
        "p1": list(p1),
        "p2": list(p2),
        "center": None if center is None else list(center),
        "radius": radius,
        "v1": v1_id,
        "v2": v2_id,
        # ── back-compat (consumed by ipc-cad.ts coerceDrawingEdge) ──
        "id": edge_id,
        "points": [list(pt) for pt in points],
    }


# ── viewBox derivation ─────────────────────────────────────────────────────


def _accumulate_viewbox(
    edges: List[Dict[str, Any]],
    snaps: List[Dict[str, Any]],
) -> Dict[str, float]:
    """Compute the tight 2D bbox over every emitted edge point + snap point.

    Returned as ``{"x", "y", "w", "h"}`` in the same projected SVG-mm space as
    the geometry (NOT the SVG pixel canvas — that is what ``svg``'s root
    width/height describe). Renderers that want the geometry's own extent (e.g.
    to fit the snap overlay) use this; the SVG keeps its own 800x600 frame.
    """
    xs_min = ys_min = math.inf
    xs_max = ys_max = -math.inf

    def _bump(x: float, y: float) -> None:
        nonlocal xs_min, ys_min, xs_max, ys_max
        xs_min = min(xs_min, x)
        ys_min = min(ys_min, y)
        xs_max = max(xs_max, x)
        ys_max = max(ys_max, y)

    for e in edges:
        _bump(e["p1"][0], e["p1"][1])
        _bump(e["p2"][0], e["p2"][1])
        if e["kind"] == "circle" and e["center"] is not None and e["radius"]:
            cx, cy = e["center"]
            r = e["radius"]
            _bump(cx - r, cy - r)
            _bump(cx + r, cy + r)
    for s in snaps:
        _bump(s["x"], s["y"])

    if xs_min is math.inf:
        return {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}
    return {
        "x": xs_min,
        "y": ys_min,
        "w": xs_max - xs_min,
        "h": ys_max - ys_min,
    }


# ── SVG (same projection as the geometry) ─────────────────────────────────


def _project_svg(view: str, workplane: Any) -> str:
    """Internal: produce the SVG string for ``view`` from ``workplane``.

    Mirrors ``project_to_drawing``'s body but takes the already-resolved
    workplane (the caller resolved the handle once) so we don't double the
    handle lookup. Kept tiny and in lock-step with the drawing core's opts.
    """
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
        from .cadquery_drawing import _export_via_generic_path  # noqa: PLC0415

        svg_text = _export_via_generic_path(workplane, opts)
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "drawing_error",
            f"CadQuery SVG projection failed: {exc}",
            detail=str(exc),
        ) from exc

    if not isinstance(svg_text, str) or not svg_text:
        raise _CadHandlerError(
            "drawing_error", "CadQuery SVG export returned empty output"
        )
    return svg_text


# ── Public entry point ─────────────────────────────────────────────────────


def extract_drawing_geometry(handle: str, view: str = "front") -> Dict[str, Any]:
    """Extract projected 2D drawing geometry + the matching SVG for a view.

    Runs the identical OCCT HLR projection ``cq.exporters.getSVG`` uses, so the
    returned ``edges`` / ``vertices`` / ``snapPoints`` are in the SAME
    coordinate space as the returned ``svg`` (both derive from one projection).

    Parameters
    ----------
    handle:
        Opaque handle from a prior ``cad.execute_script`` / ``cad.import_step``.
    view:
        One of ``front`` / ``top`` / ``right`` / ``iso`` (same vocabulary as
        ``cad.project_drawing``).

    Returns
    -------
    dict with::

        {
          "view":    str,
          "viewBox": {"x": float, "y": float, "w": float, "h": float},
          "edges": [
            {"edgeId": str, "kind": "line"|"circle"|"arc",
             "p1": [x, y], "p2": [x, y],
             "center": [x, y] | None, "radius": float | None,
             "v1": str, "v2": str},
            ...
          ],
          "vertices": [{"vertexId": str, "x": float, "y": float}, ...],
          "snapPoints": [
            {"kind": "endpoint"|"midpoint"|"center"|"quadrant",
             "x": float, "y": float, "ownerId": str},
            ...
          ],
          "svg": str,   # SAME projection as the geometry above
        }

    Raises ``_CadHandlerError`` with one of ``bad_params`` / ``invalid_handle``
    / ``cadquery_not_installed`` / ``ocp_hlr_not_available`` / ``drawing_error``.
    """
    # Validate view + resolve handle up front (cheap, no OCP/CadQuery import) so
    # a typo or stale handle fails fast with the shared vocabulary.
    direction = _validate_view(view)
    workplane = _resolve_handle(handle)

    # Resolve the solid for HLR. project_to_drawing tolerates non-solid results
    # but the snap walk needs a B-rep shape to project; surface a clear error.
    try:
        shape = workplane.findSolid().wrapped
    except Exception as exc:  # noqa: BLE001 - CadQuery raises arbitrary types
        raise _CadHandlerError(
            "drawing_error",
            f"could not resolve a solid from handle {handle!r} for "
            f"projection: {exc}",
            detail=str(exc),
        ) from exc

    ocp = _load_ocp()

    try:
        edges, vertices, snaps = _project_geometry(shape, direction, ocp)
    except _CadHandlerError:
        raise
    except Exception as exc:  # noqa: BLE001 - OCCT raises arbitrary types
        raise _CadHandlerError(
            "drawing_error",
            f"projected-geometry extraction failed: {exc}",
            detail=str(exc),
        ) from exc

    # SVG from the SAME projection (same getSVG opts / projectionDir).
    svg_text = _project_svg(view, workplane)
    viewbox = _accumulate_viewbox(edges, snaps)

    return {
        "view": view,
        "viewBox": viewbox,
        "edges": edges,
        "vertices": vertices,
        "snapPoints": snaps,
        "svg": svg_text,
    }


def _project_geometry(
    shape: Any,
    direction: Tuple[float, float, float],
    ocp: Dict[str, Any],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Run HLR for ``direction`` and walk visible + hidden edges.

    Uses ``gp_Ax2(gp_Pnt(), gp_Dir(*direction))`` — byte-identical to the
    coordinate system CadQuery's ``getSVG`` builds — so the projected
    coordinates land in the SVG path-data space. Returns
    ``(edges, vertices, snapPoints)``.
    """
    algo = ocp["HLRBRep_Algo"]()
    algo.Add(shape)
    ax2 = ocp["gp_Ax2"](
        ocp["gp_Pnt"](0.0, 0.0, 0.0),
        ocp["gp_Dir"](direction[0], direction[1], direction[2]),
    )
    algo.Projector(ocp["HLRAlgo_Projector"](ax2))
    algo.Update()
    algo.Hide()
    hlr = ocp["HLRBRep_HLRToShape"](algo)

    edges: List[Dict[str, Any]] = []
    snaps: List[Dict[str, Any]] = []
    vertex_acc: Dict[str, Dict[str, Any]] = {}

    # Visible sharp edges + smooth-surface silhouettes, then hidden. Snap points
    # come from BOTH classes so the operator can dimension to an occluded edge's
    # endpoint as well (mechanical drawings dimension hidden features routinely).
    for accessor in (
        "VCompound",
        "OutLineVCompound",
        "HCompound",
        "OutLineHCompound",
    ):
        compound = _safe_compound(hlr, accessor)
        if _walk_projected_edges(
            compound, ocp, _MAX_EDGE_COUNT, edges, snaps, vertex_acc
        ):
            break  # budget hit

    vertices = list(vertex_acc.values())
    return edges, vertices, snaps


def _safe_compound(hlr: Any, accessor: str) -> Optional[Any]:
    """Call an HLRToShape compound accessor, returning None on any failure.

    Older OCP builds may not expose every accessor; a missing one should drop
    that edge class, not abort the whole extraction. Mirrors the same helper in
    ``cadquery_hlr``.
    """
    fn = getattr(hlr, accessor, None)
    if fn is None:
        return None
    try:
        return fn()
    except Exception:  # noqa: BLE001 - accessor unsupported on this build
        return None


__all__ = [
    "ALLOWED_VIEWS",
    "VIEW_DIRECTIONS",
    "extract_drawing_geometry",
]
