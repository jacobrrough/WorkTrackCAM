"""SIDECAR EDGE-ID EMISSION wire coverage (Phase-2 parity: viewport edge picking).

Covers the wire-completion deliverables layered on the FG-5 edge polylines in
``engines/cad/cadquery_script.py`` (the base polyline emission itself is pinned
by ``test_cad_picked_targeting.py``):

  1. ``cad.execute_script`` meshes embed the sampled ``edges`` polylines (the
     same shape ``cad.tessellate_with_ids`` returns) alongside the existing
     ``edgeMap``, so the renderer can draw + raycast edges with NO second
     round trip.
  2. Edge polyline ids AND their sampled points are stable across repeat
     tessellations of the same handle and across independent rebuilds of the
     same script (the pick-survives-rebuild contract).
  3. The defensive TOTAL edge-point cap truncates HONESTLY: polylines are
     dropped WHOLE (never half-sampled), ``edgesTruncated`` flips True, and
     the ``edgeMap`` metadata stays complete.
  4. Curved-edge samples genuinely lie ON the source curve (cylinder: every
     rim sample sits at the cylinder radius), so the wireframe visually hugs
     the tessellated surface at the shared tolerance.

Run with the cadquery venv python:
    C:/Users/jrrou/wtcam-sidecar-venv/Scripts/python.exe -m pytest \
        engines/sidecar/__tests__/test_cad_edge_wire_emission.py
"""
from __future__ import annotations

import math

import pytest

from engines.cad import cadquery_script
from engines.cad.cadquery_import import reset_handle_table
from engines.sidecar import cad_handlers


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
    reset_handle_table()
    yield
    reset_handle_table()


BOX_SCRIPT = "import cadquery as cq\nresult = cq.Workplane('XY').box(20, 15, 10)\n"
CYL_SCRIPT = "import cadquery as cq\nresult = cq.Workplane('XY').circle(8).extrude(10)\n"


# -- Tier 1: no cadquery required ---------------------------------------------


def test_edge_total_point_cap_is_sane() -> None:
    """The defensive total budget must comfortably hold every realistic part:
    at least 10 maximally-dense curved edges, so the cap only ever fires on
    pathological inputs (never a normal bracket / sign / rotary part)."""
    assert cadquery_script._EDGE_TOTAL_POINT_CAP >= (
        cadquery_script._EDGE_POLYLINE_MAX_POINTS * 10
    )


# -- Tier 2: REAL geometry through the sidecar handlers (Safety Rule 5) -------


@requires_cadquery
def test_execute_script_embeds_edge_polylines() -> None:
    """Wire completion: the execute_script mesh entry carries ``edges`` (parallel
    to ``edgeMap``) + ``edgesTruncated`` so the renderer needs no second
    tessellate_with_ids round trip. A box embeds all 12 polylines untruncated."""
    r = cad_handlers.execute_script({"script": BOX_SCRIPT})
    mesh = r["meshes"][0]

    assert "edges" in mesh, "execute_script mesh must embed the edges polylines"
    edges = mesh["edges"]
    assert isinstance(edges, list) and len(edges) == 12
    assert {poly["id"] for poly in edges} == set(mesh["edgeMap"].keys())
    for poly in edges:
        assert poly["id"].startswith("e:")
        pts = poly["points"]
        assert len(pts) >= 2
        for p in pts:
            assert len(p) == 3 and all(isinstance(c, float) for c in p)
    assert mesh["edgesTruncated"] is False


@requires_cadquery
def test_tessellate_with_ids_reports_untruncated_by_default() -> None:
    """The honest flag is PRESENT and False on a normal part (absence is only a
    back-compat affordance for older sidecar builds on the TS side)."""
    handle = cad_handlers.execute_script({"script": BOX_SCRIPT})["meshes"][0]["handle"]
    r = cad_handlers.tessellate_with_ids({"handle": handle})
    assert r["edgesTruncated"] is False
    assert len(r["edges"]) == 12
    # Straight box edges sample to exactly their two endpoints.
    assert {len(poly["points"]) for poly in r["edges"]} == {2}


@requires_cadquery
def test_edge_polylines_stable_across_calls_and_rebuilds() -> None:
    """Pick-survives-rebuild contract: (a) two tessellations of the SAME handle
    return identical polylines; (b) an independent rebuild of the same script
    reproduces the same stable id set with the same per-id sampling."""
    h1 = cad_handlers.execute_script({"script": BOX_SCRIPT})["meshes"][0]["handle"]
    r1 = cad_handlers.tessellate_with_ids({"handle": h1})
    r2 = cad_handlers.tessellate_with_ids({"handle": h1})

    by_id_1 = {poly["id"]: poly["points"] for poly in r1["edges"]}
    by_id_2 = {poly["id"]: poly["points"] for poly in r2["edges"]}
    assert by_id_1 == by_id_2  # same handle -> identical ids AND points

    # Independent rebuild of the same script -> same id set, same sampling.
    h3 = cad_handlers.execute_script({"script": BOX_SCRIPT})["meshes"][0]["handle"]
    r3 = cad_handlers.tessellate_with_ids({"handle": h3})
    by_id_3 = {poly["id"]: poly["points"] for poly in r3["edges"]}
    assert set(by_id_3.keys()) == set(by_id_1.keys())
    for eid, pts in by_id_3.items():
        ref = by_id_1[eid]
        assert len(pts) == len(ref)
        for p, q in zip(pts, ref):
            assert math.dist(p, q) < 1e-9


@requires_cadquery
def test_cylinder_rim_samples_lie_on_the_curve() -> None:
    """Every sample of a curved polyline sits ON the source curve (not a chord
    approximation drifting off-surface): for circle(8).extrude(10) every dense
    rim point is at radius 8 from the Z axis, and a closed rim's first/last
    samples coincide (t=0 and t=1 of a closed circle)."""
    handle = cad_handlers.execute_script({"script": CYL_SCRIPT})["meshes"][0]["handle"]
    r = cad_handlers.tessellate_with_ids({"handle": handle})

    dense = [poly for poly in r["edges"] if len(poly["points"]) > 2]
    assert dense, "cylinder must emit densely-sampled circular rims"
    for poly in dense:
        pts = poly["points"]
        assert len(pts) >= cadquery_script._EDGE_POLYLINE_MIN_CURVED
        for x, y, _z in pts:
            assert abs(math.hypot(x, y) - 8.0) < 1e-6
        assert math.dist(pts[0], pts[-1]) < 1e-6  # closed rim
    assert r["edgesTruncated"] is False


@requires_cadquery
def test_total_point_cap_truncates_honestly(monkeypatch: pytest.MonkeyPatch) -> None:
    """When the defensive budget is exceeded: polylines are dropped WHOLE, the
    flag flips True on BOTH wire paths (tessellate_with_ids + the execute_script
    embed), and the edgeMap metadata is NOT truncated."""
    monkeypatch.setattr(cadquery_script, "_EDGE_TOTAL_POINT_CAP", 6)

    exec_result = cad_handlers.execute_script({"script": BOX_SCRIPT})
    mesh = exec_result["meshes"][0]
    assert mesh["edgesTruncated"] is True  # embed path carries the flag too

    r = cad_handlers.tessellate_with_ids({"handle": mesh["handle"]})
    assert r["edgesTruncated"] is True
    # Budget respected; every surviving polyline is complete (2-point straight
    # box edges) -- never a half-sampled polyline.
    total = sum(len(poly["points"]) for poly in r["edges"])
    assert 0 < total <= 6
    assert all(len(poly["points"]) == 2 for poly in r["edges"])
    assert len(r["edges"]) == 3  # 6-point budget / 2 points per box edge
    # Metadata stays complete: all 12 edges remain resolvable at build time.
    assert len(r["edgeMap"]) == 12
