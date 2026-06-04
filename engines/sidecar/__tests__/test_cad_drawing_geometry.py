"""pytest coverage for ``cad.extract_drawing_geometry`` (CAD V2 — drawing snap).

Covers the projected-2D-geometry method served by the dedicated module
``engines/cad/cadquery_drawing_geometry.py`` and registered in
``engines/sidecar/cad_handlers.py`` as ``cad.extract_drawing_geometry``.

The method returns id-tagged projected geometry (vertices / edges / snap
points) PLUS the matching SVG from the SAME OCCT HLR projection, so the
renderer's DrawingView can resolve snap points and place associative
dimensions whose anchor (the snap point's owner id) survives a rebuild.

Tiered like ``test_cad_drawing_handlers.py``:

  Tier 1 — **No CadQuery required.** Dispatch registration + wire-envelope /
    param validation (``bad_params`` for empty handle / unknown view,
    ``invalid_handle`` for a handle missing from the table). Runs anywhere the
    sidecar code is importable.

  Tier 2 — **CadQuery required.** Skipped automatically when ``import
    cadquery`` fails. Exercises the full projection on a real body and asserts:
      * the return envelope shape (view / viewBox / edges / vertices /
        snapPoints / svg),
      * STABLE ids across two independent projections of the same geometry
        (the quantized-hash id scheme — the property that makes a persisted
        dimension associative),
      * snap-point coverage (endpoint + midpoint on lines; center + quadrant
        on a full circle),
      * coordinate-space agreement — the geometry viewBox matches the SVG
        ``<path>`` coordinate range (geometry + SVG share one projection, so
        they must never disagree on origin / scale).
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

import pytest

from engines.cad import cadquery_import as _imp
from engines.cad.cadquery_import import _CadHandlerError, reset_handle_table
from engines.sidecar import cad_handlers


# ── Fixtures / probes ────────────────────────────────────────────────────


def _cadquery_available() -> bool:
    try:
        import cadquery  # noqa: F401 - probe only
        return True
    except ImportError:
        return False


requires_cadquery = pytest.mark.skipif(
    not _cadquery_available(),
    reason="cadquery not installed in this environment",
)


@pytest.fixture(autouse=True)
def _clean_handle_table() -> None:
    """Reset the global handle table before every test for isolation."""
    reset_handle_table()
    yield
    reset_handle_table()


def _register_body(handle: str, build: str) -> None:
    """Register a CadQuery body directly in the handle table under ``handle``.

    Bypasses ``cad.execute_script`` (whose restricted exec namespace blocks
    ``import`` in some interpreters) so the Tier-2 tests can stand up a body
    deterministically. ``build`` is a tiny expression evaluated against a
    ``cq`` in scope that yields a Workplane.
    """
    import cadquery as cq  # noqa: PLC0415

    wp = eval(build, {"cq": cq})  # noqa: S307 - test-only, fixed literals
    solid = wp.findSolid()
    bb = solid.BoundingBox()
    doc = _imp.StepDocument(
        workplane=wp,
        bbox_min=(bb.xmin, bb.ymin, bb.zmin),
        bbox_max=(bb.xmax, bb.ymax, bb.zmax),
        source_path="<test>",
    )
    _imp._HANDLES[handle] = doc


# A box (lines) with a cylindrical boss (a projected circle in the top view).
_BUILD_BOX_WITH_BOSS = (
    "cq.Workplane('XY').box(40, 20, 10)"
    ".faces('>Z').workplane().circle(5).extrude(6)"
)


def _svg_path_coord_range(svg: str) -> Tuple[float, float, float, float]:
    """Return ``(xmin, xmax, ymin, ymax)`` over every SVG ``<path d=...>`` coord.

    Parses the moveto / lineto numbers CadQuery's exporter emits. These are
    raw HLR-projected model-mm (the ``<g transform>`` wrapper only scales the
    visual rendering — the path NUMBERS are the projected coordinates), so the
    range is directly comparable to the geometry viewBox.
    """
    coords: List[Tuple[float, float]] = []
    for d in re.findall(r'd="([^"]+)"', svg):
        for m in re.finditer(r"[ML]\s*([-\d.eE]+)[ ,]+([-\d.eE]+)", d):
            coords.append((float(m.group(1)), float(m.group(2))))
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return (min(xs), max(xs), min(ys), max(ys))


# ── Tier 1: dispatch registration ───────────────────────────────────────


def test_dispatch_table_registers_extract_drawing_geometry() -> None:
    """The dotted method name MUST appear in the sidecar dispatch table so the
    TS bridge can reach it. Drift here breaks the renderer's snap wiring."""
    from engines.sidecar.main import _build_dispatch_table

    table = _build_dispatch_table()
    assert "cad.extract_drawing_geometry" in table


def test_handlers_dict_registers_extract_drawing_geometry() -> None:
    """The handler is wired in the HANDLERS dict (the dispatch table is built
    from it). Pins the registration the task added."""
    assert "extract_drawing_geometry" in cad_handlers.HANDLERS


# ── Tier 1: handler-level param validation ──────────────────────────────


def test_extract_geometry_requires_handle() -> None:
    """Empty params short-circuit with ``bad_params`` BEFORE any OCP / CadQuery
    import — mirrors the BUILD-3 / BUILD-7 drawing posture."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.extract_drawing_geometry({})
    assert exc_info.value.code == "bad_params"


def test_extract_geometry_requires_view() -> None:
    """A handle without a view fails with ``bad_params``."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.extract_drawing_geometry({"handle": "script:abc"})
    assert exc_info.value.code == "bad_params"


def test_extract_geometry_rejects_unknown_view() -> None:
    """A view typo (``'fornt'``) fails fast with ``bad_params`` and the error
    lists the allowed views so the renderer can surface them."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.extract_drawing_geometry(
            {"handle": "script:abc", "view": "fornt"}
        )
    assert exc_info.value.code == "bad_params"
    assert "front" in str(exc_info.value)


def test_extract_geometry_rejects_unknown_handle() -> None:
    """Handle lookup happens before the OCP import, so a stale handle fails
    deterministically with ``invalid_handle`` regardless of environment."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.extract_drawing_geometry(
            {"handle": "script:never-existed", "view": "front"}
        )
    assert exc_info.value.code == "invalid_handle"


# ── Tier 2: full projection round trip ──────────────────────────────────


@requires_cadquery
def test_extract_geometry_returns_expected_envelope() -> None:
    """The result carries the full task-contract shape: view / viewBox /
    edges / vertices / snapPoints / svg, with the per-edge geometry fields
    (edgeId / kind / p1 / p2 / center / radius / v1 / v2)."""
    _register_body("body:1", _BUILD_BOX_WITH_BOSS)
    r = cad_handlers.extract_drawing_geometry(
        {"handle": "body:1", "view": "top"}
    )

    assert set(r.keys()) >= {
        "view",
        "viewBox",
        "edges",
        "vertices",
        "snapPoints",
        "svg",
    }
    assert r["view"] == "top"
    vb = r["viewBox"]
    assert set(vb.keys()) == {"x", "y", "w", "h"}
    assert vb["w"] > 0 and vb["h"] > 0

    assert isinstance(r["svg"], str) and r["svg"].lstrip().startswith("<")
    assert len(r["edges"]) >= 4
    assert len(r["vertices"]) >= 1
    assert len(r["snapPoints"]) >= 4

    # Per-edge geometry fields are present and well-formed.
    for e in r["edges"]:
        assert isinstance(e["edgeId"], str) and e["edgeId"].startswith("e:")
        assert e["kind"] in ("line", "circle", "arc")
        assert len(e["p1"]) == 2 and len(e["p2"]) == 2
        assert isinstance(e["v1"], str) and isinstance(e["v2"], str)
        if e["kind"] == "circle":
            assert e["center"] is not None and e["radius"] is not None


@requires_cadquery
def test_extract_geometry_vertex_and_edge_ids_are_prefixed() -> None:
    """Stable ids use the documented ``v:`` / ``e:`` prefixes so a consumer can
    tell a vertex id from an edge id without a side table."""
    _register_body("body:1", _BUILD_BOX_WITH_BOSS)
    r = cad_handlers.extract_drawing_geometry(
        {"handle": "body:1", "view": "front"}
    )
    assert all(v["vertexId"].startswith("v:") for v in r["vertices"])
    assert all(e["edgeId"].startswith("e:") for e in r["edges"])
    # Snap points back-reference their owner edge / vertex id.
    for s in r["snapPoints"]:
        assert s["ownerId"].startswith(("v:", "e:"))


@requires_cadquery
def test_extract_geometry_ids_stable_across_two_projections() -> None:
    """THE associative-dimension guarantee: projecting the SAME geometry twice
    (two independent handles, geometry rebuilt from scratch) yields IDENTICAL
    edge / vertex / snap-owner ids.

    This is what lets a persisted dimension re-resolve to a feature after the
    part regenerates. The quantized-hash scheme keys on the projected
    coordinates, so a feature landing at the same projected spot keeps its id —
    unlike a fragile OCCT-shape-identity or explorer-ordinal id.
    """
    _register_body("body:a", _BUILD_BOX_WITH_BOSS)
    _register_body("body:b", _BUILD_BOX_WITH_BOSS)  # rebuilt, fresh OCCT shapes

    ra = cad_handlers.extract_drawing_geometry(
        {"handle": "body:a", "view": "top"}
    )
    rb = cad_handlers.extract_drawing_geometry(
        {"handle": "body:b", "view": "top"}
    )

    assert sorted(e["edgeId"] for e in ra["edges"]) == sorted(
        e["edgeId"] for e in rb["edges"]
    )
    assert sorted(v["vertexId"] for v in ra["vertices"]) == sorted(
        v["vertexId"] for v in rb["vertices"]
    )
    assert sorted(s["ownerId"] for s in ra["snapPoints"]) == sorted(
        s["ownerId"] for s in rb["snapPoints"]
    )
    # A specific stable-id check: the boss circle's id is byte-identical across
    # the two projections (centre + radius hash is reproducible).
    circ_a = [e["edgeId"] for e in ra["edges"] if e["kind"] == "circle"]
    circ_b = [e["edgeId"] for e in rb["edges"] if e["kind"] == "circle"]
    assert circ_a and circ_a == circ_b


@requires_cadquery
def test_extract_geometry_snap_coverage() -> None:
    """Snap points cover the kinds the renderer needs: line edges contribute
    ``endpoint`` + ``midpoint``; the full-circle boss contributes ``center`` +
    ``quadrant``. All four kinds must appear for the box-with-boss body."""
    _register_body("body:1", _BUILD_BOX_WITH_BOSS)
    r = cad_handlers.extract_drawing_geometry(
        {"handle": "body:1", "view": "top"}
    )
    kinds = {s["kind"] for s in r["snapPoints"]}
    assert {"endpoint", "midpoint", "center", "quadrant"} <= kinds

    # The four quadrant points sit on the circle: each is exactly ``radius``
    # from the circle centre (within float tolerance).
    circle = next(e for e in r["edges"] if e["kind"] == "circle")
    cx, cy = circle["center"]
    radius = circle["radius"]
    quad = [s for s in r["snapPoints"] if s["kind"] == "quadrant"]
    assert len(quad) >= 4
    for s in quad:
        dist = ((s["x"] - cx) ** 2 + (s["y"] - cy) ** 2) ** 0.5
        assert abs(dist - radius) < 1e-6


@requires_cadquery
def test_extract_geometry_coords_agree_with_svg() -> None:
    """Coordinate-space agreement (the single hardest correctness constraint):
    the geometry viewBox matches the SVG ``<path>`` coordinate range.

    Both the geometry and the ``svg`` field come from the SAME OCCT HLR
    projection (``gp_Ax2(gp_Pnt(), gp_Dir(projectionDir))``), so the projected
    coordinates the renderer snaps against land in the exact SVG-mm frame the
    drawing is rendered in. A regression where the two projections drift apart
    would surface here as a viewBox / path-range mismatch.
    """
    _register_body("body:1", _BUILD_BOX_WITH_BOSS)
    r = cad_handlers.extract_drawing_geometry(
        {"handle": "body:1", "view": "top"}
    )
    vb = r["viewBox"]
    xmin, xmax, ymin, ymax = _svg_path_coord_range(r["svg"])

    # The geometry viewBox is the tight bbox over edge + snap points; the SVG
    # path range is the tight bbox over the drawn linework. They derive from
    # the same projection so they agree to a sub-mm tolerance (the snap points
    # extend the box by at most the circle radius, which is part of the linework
    # too, so the bounds coincide for this body).
    assert abs(vb["x"] - xmin) < 1e-3
    assert abs((vb["x"] + vb["w"]) - xmax) < 1e-3
    assert abs(vb["y"] - ymin) < 1e-3
    assert abs((vb["y"] + vb["h"]) - ymax) < 1e-3


@requires_cadquery
def test_extract_geometry_svg_matches_project_drawing() -> None:
    """The ``svg`` field is byte-identical to what ``cad.project_drawing``
    returns for the same handle+view — they share ``project_to_drawing``'s opts,
    so the snap overlay renders over the exact same drawing the preview shows."""
    _register_body("body:1", _BUILD_BOX_WITH_BOSS)
    geo = cad_handlers.extract_drawing_geometry(
        {"handle": "body:1", "view": "right"}
    )
    proj = cad_handlers.project_drawing({"handle": "body:1", "view": "right"})
    assert geo["svg"] == proj["svg"]


@requires_cadquery
def test_extract_geometry_view_changes_geometry() -> None:
    """Switching the view changes the projected geometry (different bbox /
    edges), proving the projectionDir actually flows through to HLR and isn't
    silently ignored."""
    _register_body("body:1", _BUILD_BOX_WITH_BOSS)
    top = cad_handlers.extract_drawing_geometry(
        {"handle": "body:1", "view": "top"}
    )
    front = cad_handlers.extract_drawing_geometry(
        {"handle": "body:1", "view": "front"}
    )
    # Top sees the 40x20 footprint + the boss circle; front sees the 40x16
    # silhouette. The viewBoxes differ.
    assert (top["viewBox"]["w"], top["viewBox"]["h"]) != (
        front["viewBox"]["w"],
        front["viewBox"]["h"],
    )
    # The boss projects as a circle in the top view but not the front view.
    top_circles = [e for e in top["edges"] if e["kind"] == "circle"]
    assert top_circles, "expected a projected circle in the top view"
