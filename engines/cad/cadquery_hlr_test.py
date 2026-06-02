"""pytest coverage for the true-HLR section cut core (``cadquery_hlr``).

CAD V1.5 -- the 3D viewport's engineering section view. These tests exercise
the real OCP hidden-line-removal + ``BRepAlgoAPI_Section`` pipeline, so they
require both ``cadquery`` and its OCP bindings. They are guarded by
``requires_cadquery`` and SKIP cleanly on an environment without it -- but on
the project's CadQuery sidecar venv they MUST RUN (not skip).

Why register bodies directly into ``_HANDLES`` instead of ``execute_script``?
============================================================================
``execute_script`` runs user code through a sandbox that strips ``__import__``;
on some CadQuery builds the body construction needs it at exec time, which is
an orthogonal concern to HLR. The test owns the process-local handle table, so
it builds the test solids with the ``cadquery`` API directly and stashes them
behind a handle -- exactly the same ``StepDocument`` shape ``import_step`` and
``execute_script`` populate. This keeps the test focused on the HLR numerics.

Tier 1 (no CadQuery) -- ``invalid_handle`` raises before any OCP import, so
that one case runs in any environment.
"""
from __future__ import annotations

from typing import Any

import pytest

from engines.cad.cadquery_import import (
    StepDocument,
    _CadHandlerError,
    _HANDLES,
    _safe_bbox,
    reset_handle_table,
)
from engines.cad import cadquery_hlr


# -- Fixtures / probes ------------------------------------------------------


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
def _clean_state() -> Any:
    """Reset both the handle table and the HLR LRU cache around every test."""
    reset_handle_table()
    cadquery_hlr.reset_cache()
    yield
    reset_handle_table()
    cadquery_hlr.reset_cache()


def _register(workplane: Any, handle: str) -> str:
    """Stash a CadQuery Workplane behind ``handle`` in the process-local table.

    Mirrors what ``import_step_file`` / ``_tessellate_and_register`` do so the
    HLR core resolves the body exactly the way it would in production.
    """
    bbox_min, bbox_max = _safe_bbox(workplane)
    _HANDLES[handle] = StepDocument(
        workplane=workplane,
        bbox_min=bbox_min,
        bbox_max=bbox_max,
        source_path="<cadquery_hlr_test>",
    )
    return handle


def _cube(size: float = 20.0) -> Any:
    import cadquery as cq

    return cq.Workplane("XY").box(size, size, size)


def _hollow_tube() -> Any:
    """A tube centred on the origin so a Z=0 section cuts a clean annulus."""
    import cadquery as cq

    return (
        cq.Workplane("XY")
        .circle(10.0)
        .circle(5.0)
        .extrude(30.0)
        .translate((0.0, 0.0, -15.0))
    )


# -- Tier 1: no CadQuery required -------------------------------------------


def test_invalid_handle_raises_before_ocp_import() -> None:
    """An unknown handle fails fast with ``invalid_handle`` (no OCP needed)."""
    with pytest.raises(_CadHandlerError) as excinfo:
        cadquery_hlr.hlr_section(
            "does-not-exist",
            plane_normal=[0.0, 0.0, 1.0],
            plane_offset=0.0,
            view_dir=[0.0, 0.0, 1.0],
            tolerance_mm=0.1,
        )
    assert excinfo.value.code == "invalid_handle"


def test_bad_plane_normal_raises_bad_params() -> None:
    """A zero-length plane normal is rejected with ``bad_params``."""
    with pytest.raises(_CadHandlerError) as excinfo:
        cadquery_hlr.hlr_section(
            "irrelevant",
            plane_normal=[0.0, 0.0, 0.0],
            plane_offset=0.0,
            view_dir=[0.0, 0.0, 1.0],
        )
    assert excinfo.value.code == "bad_params"


def test_bad_view_dir_shape_raises_bad_params() -> None:
    """A view direction that is not a 3-vector is rejected with ``bad_params``."""
    with pytest.raises(_CadHandlerError) as excinfo:
        cadquery_hlr.hlr_section(
            "irrelevant",
            plane_normal=[0.0, 0.0, 1.0],
            plane_offset=0.0,
            view_dir=[1.0, 0.0],  # too short
        )
    assert excinfo.value.code == "bad_params"


# -- Tier 2: CadQuery + OCP HLR required ------------------------------------


@requires_cadquery
def test_cube_front_view_has_at_least_four_visible_edges_and_empty_cap() -> None:
    """A cube viewed front-on (plane far from the body) -> >=4 visible edges.

    The section plane is parked well outside the part (offset 100 mm) so it
    misses the body entirely: no cap face, no outline, but the HLR projection
    still yields the cube's visible silhouette (>= 4 edges for the square).
    """
    _register(_cube(20.0), "h-cube")
    result = cadquery_hlr.hlr_section(
        "h-cube",
        plane_normal=[0.0, 0.0, 1.0],
        plane_offset=100.0,
        view_dir=[0.0, 1.0, 0.0],  # look along +Y == front view
        tolerance_mm=0.1,
    )
    assert len(result["visibleEdges"]) >= 4
    # Plane misses the body -> empty cap.
    assert result["capFaceTriangles"] == []
    assert result["capFaceOutline"] == []
    # Every visible edge is a polyline of >= 2 points of 3 floats each.
    for poly in result["visibleEdges"]:
        assert len(poly) >= 2
        for pt in poly:
            assert len(pt) == 3


@requires_cadquery
def test_cube_section_at_z0_has_one_cap_loop_triangles_and_bbox_min_z_zero() -> None:
    """A 20 mm cube sectioned at Z=0 -> 1 cap loop + cap triangles, z-min 0."""
    _register(_cube(20.0), "h-cube")
    result = cadquery_hlr.hlr_section(
        "h-cube",
        plane_normal=[0.0, 0.0, 1.0],
        plane_offset=0.0,
        view_dir=[0.0, 0.0, 1.0],  # look straight down the cut normal
        tolerance_mm=0.1,
    )
    # Exactly one closed section contour for a solid cube.
    assert len(result["capFaceOutline"]) == 1
    # Cap face triangulated: a flat (length divisible by 9) non-empty buffer.
    assert len(result["capFaceTriangles"]) > 0
    assert len(result["capFaceTriangles"]) % 9 == 0
    # The cap lies on the Z=0 plane.
    assert result["bbox"]["min"][2] == pytest.approx(0.0, abs=1e-6)
    assert result["bbox"]["max"][2] == pytest.approx(0.0, abs=1e-6)


@requires_cadquery
def test_identical_calls_hit_cache_so_table_holds_one_entry() -> None:
    """Two identical section calls produce a single cached entry."""
    _register(_cube(20.0), "h-cube")
    args = ([0.0, 0.0, 1.0], 0.0, [0.0, 0.0, 1.0], 0.1)
    first = cadquery_hlr.hlr_section("h-cube", *args)
    second = cadquery_hlr.hlr_section("h-cube", *args)
    assert cadquery_hlr.cache_size() == 1
    # The cache returns the same object instance on the hit.
    assert first is second


@requires_cadquery
def test_distinct_keys_grow_the_cache() -> None:
    """Two distinct section keys produce two cache entries (sanity on keying)."""
    _register(_cube(20.0), "h-cube")
    cadquery_hlr.hlr_section("h-cube", [0.0, 0.0, 1.0], 0.0, [0.0, 0.0, 1.0], 0.1)
    cadquery_hlr.hlr_section("h-cube", [0.0, 0.0, 1.0], 5.0, [0.0, 0.0, 1.0], 0.1)
    assert cadquery_hlr.cache_size() == 2


@requires_cadquery
def test_hollow_tube_section_yields_two_cap_loops() -> None:
    """A hollow tube sectioned through its wall -> 2 concentric cap loops."""
    _register(_hollow_tube(), "h-tube")
    result = cadquery_hlr.hlr_section(
        "h-tube",
        plane_normal=[0.0, 0.0, 1.0],
        plane_offset=0.0,
        view_dir=[0.0, 0.0, 1.0],
        tolerance_mm=0.1,
    )
    # Outer + inner contour == 2 loops (annulus).
    assert len(result["capFaceOutline"]) == 2
    # The annulus still meshes to a non-empty, well-formed triangle buffer.
    assert len(result["capFaceTriangles"]) > 0
    assert len(result["capFaceTriangles"]) % 9 == 0


@requires_cadquery
def test_result_shape_is_json_friendly_and_complete() -> None:
    """The result dict carries every documented key with the right types."""
    _register(_cube(20.0), "h-cube")
    result = cadquery_hlr.hlr_section(
        "h-cube",
        plane_normal=[0.0, 0.0, 1.0],
        plane_offset=0.0,
        view_dir=[0.0, 0.0, 1.0],
    )
    assert set(result.keys()) == {
        "visibleEdges",
        "hiddenEdges",
        "capFaceTriangles",
        "capFaceOutline",
        "bbox",
        "truncated",
    }
    assert isinstance(result["visibleEdges"], list)
    assert isinstance(result["hiddenEdges"], list)
    assert isinstance(result["capFaceTriangles"], list)
    assert isinstance(result["capFaceOutline"], list)
    assert isinstance(result["truncated"], bool)
    assert set(result["bbox"].keys()) == {"min", "max"}
    assert len(result["bbox"]["min"]) == 3
    assert len(result["bbox"]["max"]) == 3
