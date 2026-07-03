"""pytest coverage for ``cad.hole_table`` (Phase-5 — drawings hole table).

Covers the hole-scan method served by ``engines/cad/cadquery_hole_table.py`` and
registered in ``engines/sidecar/cad_handlers.py`` as ``cad.hole_table``. The
method enumerates the part's holes (coaxial cylindrical faces whose axis is
parallel to the view direction) and returns a table of ``{tag, x, y,
diameterMm, depthMm|null, through}`` rows in the SAME 2D SVG-mm frame as
``cad.project_drawing`` / ``cad.extract_drawing_geometry`` for that view — so a
tag lands on each projected hole.

Tiered like ``test_cad_drawing_geometry.py``:

  Tier 1 — **No CadQuery required.** Dispatch registration + wire-envelope /
    param validation (``bad_params`` for empty handle / unknown view,
    ``invalid_handle`` for a handle missing from the table).

  Tier 2 — **CadQuery required.** Skipped automatically when ``import cadquery``
    fails. Exercises the full scan on real bodies and asserts:
      * a plate with 3 through-holes of 2 distinct diameters → 3 rows, correct
        diameters, stable tags (descending diameter), coords near the known
        hole centres, all through;
      * a counterbored hole reports its through/blind depth honestly (the
        primary bore diameter, through);
      * a blind hole reports ``through: false`` + an honest ``depthMm``;
      * a no-hole part → an empty table (honest empty state);
      * holes whose axis is NOT parallel to the view are dropped from that
        view's table (v1 scope);
      * re-running the scan is byte-stable (deterministic tag ordering).
"""
from __future__ import annotations

from typing import Any, Dict, List

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


# Bodies -------------------------------------------------------------------

# Plate 40x30x5 with THREE through-holes of TWO distinct diameters: two Ø6 and
# one Ø3, drilled along -Z (parallel to the TOP view direction).
_BUILD_PLATE_3_HOLES = (
    "cq.Workplane('XY').box(40, 30, 5)"
    ".faces('>Z').workplane().pushPoints([(-12, 0), (12, 0)]).hole(6)"
    ".faces('>Z').workplane().pushPoints([(0, 8)]).hole(3)"
)

# Plate 40x30x10 with a counterbored hole: Ø3 primary bore, Ø6 counterbore
# 3 mm deep — the primary bore runs THROUGH the 10 mm plate.
_BUILD_PLATE_CBORE = (
    "cq.Workplane('XY').box(40, 30, 10)"
    ".faces('>Z').workplane().pushPoints([(0, 0)]).cboreHole(3, 6, 3)"
)

# Plate 40x30x10 with a BLIND Ø6 hole 4 mm deep.
_BUILD_PLATE_BLIND = (
    "cq.Workplane('XY').box(40, 30, 10)"
    ".faces('>Z').workplane().pushPoints([(0, 0)]).hole(6, 4)"
)

# A solid box with no holes at all.
_BUILD_NO_HOLE = "cq.Workplane('XY').box(20, 20, 20)"


def _by_tag(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {r["tag"]: r for r in rows}


# ── Tier 1: dispatch registration ───────────────────────────────────────


def test_dispatch_table_registers_hole_table() -> None:
    """The dotted method name MUST appear in the sidecar dispatch table so the
    TS bridge can reach it."""
    from engines.sidecar.main import _build_dispatch_table

    table = _build_dispatch_table()
    assert "cad.hole_table" in table


def test_handlers_dict_registers_hole_table() -> None:
    """The handler is wired in the HANDLERS dict (the dispatch table is built
    from it)."""
    assert "hole_table" in cad_handlers.HANDLERS


# ── Tier 1: handler-level param validation ──────────────────────────────


def test_hole_table_requires_handle() -> None:
    """Empty params short-circuit with ``bad_params`` BEFORE any OCP / CadQuery
    import."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.hole_table({})
    assert exc_info.value.code == "bad_params"


def test_hole_table_requires_view() -> None:
    """A handle without a view fails with ``bad_params``."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.hole_table({"handle": "script:abc"})
    assert exc_info.value.code == "bad_params"


def test_hole_table_rejects_unknown_view() -> None:
    """A view typo fails fast with ``bad_params`` and lists the allowed views."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.hole_table({"handle": "script:abc", "view": "fornt"})
    assert exc_info.value.code == "bad_params"
    assert "front" in str(exc_info.value)


def test_hole_table_rejects_unknown_handle() -> None:
    """Handle lookup happens before the OCP import, so a stale handle fails
    deterministically with ``invalid_handle`` regardless of environment."""
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.hole_table({"handle": "script:never-existed", "view": "top"})
    assert exc_info.value.code == "invalid_handle"


# ── Tier 2: real scans ──────────────────────────────────────────────────


@requires_cadquery
def test_three_through_holes_two_diameters() -> None:
    """A plate with 3 through-holes of 2 distinct diameters → 3 rows, correct
    diameters, stable tags (descending diameter), coords near the hole centres,
    all through."""
    _register_body("plate3", _BUILD_PLATE_3_HOLES)
    result = cad_handlers.hole_table({"handle": "plate3", "view": "top"})
    assert result["view"] == "top"
    rows = result["holes"]
    assert len(rows) == 3

    # Two distinct diameters: two Ø6 and one Ø3.
    diameters = sorted(r["diameterMm"] for r in rows)
    assert diameters == pytest.approx([3.0, 6.0, 6.0])

    # Tags are A1..A3 and ordered by DESCENDING diameter, so the Ø6 holes get
    # A1 / A2 and the Ø3 hole gets A3.
    tags = [r["tag"] for r in rows]
    assert tags == ["A1", "A2", "A3"]
    by_tag = _by_tag(rows)
    assert by_tag["A1"]["diameterMm"] == pytest.approx(6.0)
    assert by_tag["A2"]["diameterMm"] == pytest.approx(6.0)
    assert by_tag["A3"]["diameterMm"] == pytest.approx(3.0)

    # Every hole is through → depthMm None.
    for r in rows:
        assert r["through"] is True
        assert r["depthMm"] is None

    # Coords land near the known hole centres in the top-view 2D frame.
    centres = sorted((round(r["x"]), round(r["y"])) for r in rows)
    assert centres == [(-12, 0), (0, 8), (12, 0)]


@requires_cadquery
def test_scan_is_deterministic() -> None:
    """Re-running the scan on the same part + view is byte-stable (tags never
    churn) — the property a persisted hole table relies on."""
    _register_body("plate3", _BUILD_PLATE_3_HOLES)
    r1 = cad_handlers.hole_table({"handle": "plate3", "view": "top"})["holes"]
    r2 = cad_handlers.hole_table({"handle": "plate3", "view": "top"})["holes"]
    assert r1 == r2


@requires_cadquery
def test_counterbored_hole_reports_through_primary_bore() -> None:
    """A counterbored hole is tabled ONCE (the counterbore + primary bore are
    coaxial): the reported diameter is the primary (through) bore Ø3, and the
    hole is through (depth None) since the primary bore runs the full plate."""
    _register_body("cbore", _BUILD_PLATE_CBORE)
    rows = cad_handlers.hole_table({"handle": "cbore", "view": "top"})["holes"]
    assert len(rows) == 1
    row = rows[0]
    assert row["tag"] == "A1"
    assert row["diameterMm"] == pytest.approx(3.0)
    assert row["through"] is True
    assert row["depthMm"] is None


@requires_cadquery
def test_blind_hole_reports_honest_depth() -> None:
    """A blind Ø6 hole 4 mm deep reports ``through: false`` and an honest
    ``depthMm`` near 4 (NOT the full plate thickness)."""
    _register_body("blind", _BUILD_PLATE_BLIND)
    rows = cad_handlers.hole_table({"handle": "blind", "view": "top"})["holes"]
    assert len(rows) == 1
    row = rows[0]
    assert row["diameterMm"] == pytest.approx(6.0)
    assert row["through"] is False
    assert row["depthMm"] == pytest.approx(4.0, abs=0.05)


@requires_cadquery
def test_no_hole_part_returns_empty_table() -> None:
    """A solid box with no holes → an empty table (honest empty state, NOT an
    error)."""
    _register_body("solid", _BUILD_NO_HOLE)
    result = cad_handlers.hole_table({"handle": "solid", "view": "top"})
    assert result["view"] == "top"
    assert result["holes"] == []


@requires_cadquery
def test_holes_not_view_parallel_are_dropped() -> None:
    """The 3 holes are drilled along Z; scanning the FRONT view (looking along
    Y) sees them as slots, not circles, so they are dropped from that view's
    table (v1 scope — honest, not faked)."""
    _register_body("plate3", _BUILD_PLATE_3_HOLES)
    rows = cad_handlers.hole_table({"handle": "plate3", "view": "front"})["holes"]
    assert rows == []


@requires_cadquery
def test_scanned_coords_lie_inside_the_projected_bbox() -> None:
    """A tag's (x, y) must land inside the view's projected linework bbox so the
    marker sits on the drawing (coordinate-space agreement with the HLR
    projection ``cad.project_drawing`` uses)."""
    from engines.cad.cadquery_hlr import project_view_edges
    from engines.cad.cadquery_drawing import VIEW_DIRECTIONS

    _register_body("plate3", _BUILD_PLATE_3_HOLES)
    rows = cad_handlers.hole_table({"handle": "plate3", "view": "top"})["holes"]
    shape = _imp._HANDLES["plate3"].workplane.findSolid().wrapped
    proj = project_view_edges(shape, VIEW_DIRECTIONS["top"])
    bmin = proj["bbox2d"]["min"]
    bmax = proj["bbox2d"]["max"]
    for r in rows:
        assert bmin[0] - 1e-6 <= r["x"] <= bmax[0] + 1e-6
        assert bmin[1] - 1e-6 <= r["y"] <= bmax[1] + 1e-6
