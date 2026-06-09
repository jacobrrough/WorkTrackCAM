"""FG-5b coverage: picked-edge / picked-face targeting in the CAD kernel.

Validates the four FG-5b deliverables in ``engines/cad/cadquery_script.py``:

  1. ``tessellate_with_face_ids`` emits a stable ``edgeMap`` (parallel to
     ``faceMap``) AND an ``occtId`` on every ``faceMap`` entry.
  2. The stable ids (``_safe_edge_geom_id`` / ``_safe_face_geom_id``) survive an
     independent rebuild of the same script.
  3. ``apply_fillet_select_op`` / ``apply_chamfer_select_op`` /
     ``apply_shell_inward_op`` apply the op to the PICKED topology when an id
     resolves, and FALL BACK to the axis bucket (with a non-fatal warning) when
     it does not — NEVER crashing, NEVER cutting the wrong topology.

Tier-1 tests (no CadQuery) cover the pure id-normalization + resolver-fallback
contract. Tier-2 tests (skipped when CadQuery is absent) build a REAL cube and
prove the picked-edge fillet rounds ONLY the picked edge vs the axis bucket
rounding all four parallel edges (Safety Rule 5 — validate with a real fixture).

Run the Tier-2 tests with the cadquery venv python:
    C:/Users/jrrou/wtcam-sidecar-venv/Scripts/python.exe -m pytest \
        engines/sidecar/__tests__/test_cad_picked_targeting.py
"""
from __future__ import annotations

import pytest

from engines.cad.cadquery_import import reset_handle_table
from engines.cad.cadquery_script import (
    _normalize_id_list,
    _opposite_direction,
    _safe_edge_polyline,
    apply_chamfer_select_op,
    apply_fillet_select_op,
    apply_shell_inward_op,
    resolve_picked_edges,
    resolve_picked_faces,
)
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


# ── Tier 1: pure helpers (no cadquery) ───────────────────────────────────────


def test_normalize_id_list_drops_non_strings_and_empties() -> None:
    assert _normalize_id_list(["a", "b", "a"]) == {"a", "b"}
    # Non-string / empty entries are dropped, not raised on.
    assert _normalize_id_list(["x", "", 5, None, "y"]) == {"x", "y"}
    # Non-list inputs degrade to the empty set (never raise mid-build).
    assert _normalize_id_list(None) == set()
    assert _normalize_id_list("not-a-list") == set()
    assert _normalize_id_list(42) == set()


def test_opposite_direction_flips_sign() -> None:
    assert _opposite_direction("+Z") == "-Z"
    assert _opposite_direction("-X") == "+X"
    assert _opposite_direction("+Y") == "-Y"
    # Bad inputs return None (caller skips the opposite-cap retry).
    assert _opposite_direction("Z") is None
    assert _opposite_direction("") is None
    assert _opposite_direction(None) is None  # type: ignore[arg-type]


def test_resolvers_handle_none_solid_without_raising() -> None:
    """A resolver must never raise even on a junk solid — it returns
    (matched=[], unresolved=<all wanted>) so the caller falls back cleanly."""

    class _Boom:
        def Edges(self):  # noqa: N802 - mimics cadquery API
            raise RuntimeError("no topology")

        def Faces(self):  # noqa: N802
            raise RuntimeError("no topology")

    matched, unresolved = resolve_picked_edges(_Boom(), ["e:1", "e:2"])
    assert matched == []
    assert unresolved == ["e:1", "e:2"]

    fmatched, funresolved = resolve_picked_faces(_Boom(), ["f:1"])
    assert fmatched == []
    assert funresolved == ["f:1"]


def test_resolvers_empty_picked_is_noop() -> None:
    """An empty / None picked list resolves to nothing wanted, nothing
    unresolved — the schema rejects empty arrays, but the resolver is defensive
    anyway."""

    class _Stub:
        def Edges(self):  # noqa: N802
            return []

        def Faces(self):  # noqa: N802
            return []

    assert resolve_picked_edges(_Stub(), []) == ([], [])
    assert resolve_picked_faces(_Stub(), None) == ([], [])


# ── Tier 2: REAL cube fixture (Safety Rule 5) ────────────────────────────────


def _cube(length: float = 20.0, width: float = 15.0, height: float = 10.0):
    import cadquery as cq

    return cq.Workplane("XY").box(length, width, height)


def _vol(workplane) -> float:
    return float(workplane.findSolid().Volume())


@requires_cadquery
def test_tessellate_emits_edge_map_and_face_occt_ids() -> None:
    """Deliverable 1+2: cad.tessellate_with_ids emits an edgeMap (12 entries for
    a box) parallel to the faceMap, and every faceMap entry carries a stable
    occtId string. The edgeMap is keyed by the stable edge id."""
    script = "import cadquery as cq\nresult = cq.Workplane('XY').box(20, 15, 10)\n"
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    r = cad_handlers.tessellate_with_ids({"handle": handle})

    # faceMap unchanged shape + new occtId.
    face_map = r["faceMap"]
    assert len(face_map) == 6
    for entry in face_map.values():
        assert entry["kind"] == "face"
        assert isinstance(entry["occtHash"], int)  # back-compat field retained
        assert isinstance(entry["occtId"], str) and entry["occtId"].startswith("f:")

    # NEW edgeMap: a box has 12 edges, each with a stable "e:" id key.
    edge_map = r["edgeMap"]
    assert isinstance(edge_map, dict)
    assert len(edge_map) == 12, f"expected 12 edges, got {len(edge_map)}"
    for key, entry in edge_map.items():
        assert key.startswith("e:")
        assert entry["kind"] == "edge"
        assert entry["occtId"] == key
        assert isinstance(entry["occtHash"], int)
        assert entry["length"] > 0.0

    # The execute_script mesh also embeds the edgeMap best-effort.
    assert "edgeMap" in exec_result["meshes"][0]
    assert len(exec_result["meshes"][0]["edgeMap"]) == 12


@requires_cadquery
def test_edge_and_face_ids_stable_across_rebuild() -> None:
    """Deliverable 2: the same script produces the same edge/face id SET across
    two independent execute_script round trips. This is what lets a picked id
    survive a parametric re-run."""
    script = "import cadquery as cq\nresult = cq.Workplane('XY').box(20, 15, 10)\n"

    r1 = cad_handlers.tessellate_with_ids(
        {"handle": cad_handlers.execute_script({"script": script})["meshes"][0]["handle"]}
    )
    r2 = cad_handlers.tessellate_with_ids(
        {"handle": cad_handlers.execute_script({"script": script})["meshes"][0]["handle"]}
    )

    assert set(r1["edgeMap"].keys()) == set(r2["edgeMap"].keys())
    assert {e["occtId"] for e in r1["faceMap"].values()} == {
        e["occtId"] for e in r2["faceMap"].values()
    }


@requires_cadquery
def test_picked_edge_fillet_rounds_only_that_edge_vs_axis_bucket() -> None:
    """Deliverable 3+4 (headline): a picked-edge fillet on ONE cube edge removes
    strictly LESS material than the axis bucket filleting all four parallel
    edges — proving the op targets the picked edge, not the bucket."""
    from engines.cad.cadquery_script import _edges_in_axis_bucket, _safe_edge_geom_id

    base = _cube()
    base_vol = _vol(base)

    # The +Z bucket = the 4 vertical edges. Pick exactly one.
    z_edges = _edges_in_axis_bucket(base.findSolid(), "+Z")
    assert len(z_edges) == 4
    one_id = _safe_edge_geom_id(z_edges[0])

    picked_wp, picked_warn = apply_fillet_select_op(
        base, {"radiusMm": 2.0, "edgeDirection": "+Z", "pickedEdgeIds": [one_id]}
    )
    bucket_wp, bucket_warn = apply_fillet_select_op(
        base, {"radiusMm": 2.0, "edgeDirection": "+Z"}
    )

    assert picked_warn == []  # clean resolve, no fallback warning
    assert bucket_warn == []
    picked_removed = base_vol - _vol(picked_wp)
    bucket_removed = base_vol - _vol(bucket_wp)
    assert picked_removed > 0.0  # something WAS filleted
    assert bucket_removed > picked_removed  # bucket touched more edges
    # Sanity: bucket removed ~4x the picked single-edge removal (4 identical edges).
    assert abs(bucket_removed - 4.0 * picked_removed) < 1e-3


@requires_cadquery
def test_unresolved_picked_edge_falls_back_to_axis_bucket_with_warning() -> None:
    """Deliverable 3+4: an unresolved picked id NEVER crashes — it falls back to
    the axis bucket and surfaces a non-fatal warning. The result must equal the
    pure axis-bucket build."""
    base = _cube()

    bucket_wp, _ = apply_fillet_select_op(base, {"radiusMm": 2.0, "edgeDirection": "+Z"})
    fallback_wp, warn = apply_fillet_select_op(
        base, {"radiusMm": 2.0, "edgeDirection": "+Z", "pickedEdgeIds": ["e:does-not-exist"]}
    )

    assert abs(_vol(fallback_wp) - _vol(bucket_wp)) < 1e-6
    assert any("did not resolve" in w for w in warn)


@requires_cadquery
def test_picked_edge_chamfer_targets_only_that_edge() -> None:
    """Deliverable 3+4: chamfer mirrors fillet — picked one edge removes less
    than the bucket chamfering all four."""
    from engines.cad.cadquery_script import _edges_in_axis_bucket, _safe_edge_geom_id

    base = _cube()
    base_vol = _vol(base)
    z_edges = _edges_in_axis_bucket(base.findSolid(), "+Z")
    one_id = _safe_edge_geom_id(z_edges[0])

    picked_wp, pw = apply_chamfer_select_op(
        base, {"lengthMm": 1.5, "edgeDirection": "+Z", "pickedEdgeIds": [one_id]}
    )
    bucket_wp, bw = apply_chamfer_select_op(base, {"lengthMm": 1.5, "edgeDirection": "+Z"})

    assert pw == [] and bw == []
    assert (base_vol - _vol(picked_wp)) > 0.0
    assert (base_vol - _vol(bucket_wp)) > (base_vol - _vol(picked_wp))


@requires_cadquery
def test_picked_face_shell_opens_resolved_cap() -> None:
    """Deliverable 3+4: shell_inward with a picked face id hollows the body
    (opening the resolved cap). On a box +Z resolves to the single top face, so
    the picked result matches the axis-bucket result — and both genuinely
    hollow the solid (volume drops well below the base)."""
    from engines.cad.cadquery_script import _faces_in_open_bucket, _safe_face_geom_id

    base = _cube()
    base_vol = _vol(base)
    top_faces = _faces_in_open_bucket(base.findSolid(), "+Z")
    assert len(top_faces) == 1
    top_id = _safe_face_geom_id(top_faces[0])

    picked_wp, pw = apply_shell_inward_op(
        base, {"thicknessMm": 1.5, "openDirection": "+Z", "pickedFaceIds": [top_id]}
    )
    bucket_wp, bw = apply_shell_inward_op(base, {"thicknessMm": 1.5, "openDirection": "+Z"})

    assert pw == [] and bw == []
    assert _vol(picked_wp) < base_vol  # genuinely hollowed
    assert abs(_vol(picked_wp) - _vol(bucket_wp)) < 1e-6  # same single top cap


@requires_cadquery
def test_unresolved_picked_face_falls_back_to_axis_bucket() -> None:
    """Deliverable 3+4: an unresolved picked FACE id falls back to the
    openDirection axis bucket with a warning, never crashing."""
    base = _cube()
    bucket_wp, _ = apply_shell_inward_op(base, {"thicknessMm": 1.5, "openDirection": "+Z"})
    fallback_wp, warn = apply_shell_inward_op(
        base,
        {"thicknessMm": 1.5, "openDirection": "+Z", "pickedFaceIds": ["f:nope"]},
    )

    assert abs(_vol(fallback_wp) - _vol(bucket_wp)) < 1e-6
    assert any("did not" in w for w in warn)


@requires_cadquery
def test_fillet_no_edges_leaves_solid_unchanged() -> None:
    """Defensive: a fillet op whose bucket is empty (bad direction) returns the
    solid UNCHANGED with a warning — a no-op is always safer than a wrong cut."""
    base = _cube()
    base_vol = _vol(base)
    # An axis bucket no straight edge can satisfy after an unresolved pick:
    out_wp, warn = apply_fillet_select_op(
        base, {"radiusMm": 2.0, "edgeDirection": "nonsense", "pickedEdgeIds": ["e:nope"]}
    )
    assert abs(_vol(out_wp) - base_vol) < 1e-9  # unchanged
    assert any("no edges" in w for w in warn)


@requires_cadquery
def test_zero_radius_fillet_is_skipped() -> None:
    """A non-positive radius is skipped with a warning (defensive — the schema
    already enforces > 0, but the kernel must not trust the wire)."""
    base = _cube()
    base_vol = _vol(base)
    out_wp, warn = apply_fillet_select_op(base, {"radiusMm": 0.0, "edgeDirection": "+Z"})
    assert abs(_vol(out_wp) - base_vol) < 1e-9
    assert any("must be > 0" in w for w in warn)


# ── FG-5: per-edge POLYLINE emission (viewport edge picking) ──────────────────
#
# These cover the NEW ``edges`` field on cad.tessellate_with_ids: a sampled
# polyline per topology edge keyed by the SAME stable id as edgeMap, so the
# renderer can render + raycast edges and ORIGINATE a picked-edge fillet from
# the viewport. Headline (Safety Rule 5): a real cube emits 12 edge polylines,
# and picking ONE polyline's id fillets ONLY that edge.


def test_safe_edge_polyline_never_raises_on_junk_edge() -> None:
    """Tier-1 (no cadquery): an unreadable edge yields [] rather than raising —
    the caller then simply omits that edge from the wire."""

    class _Boom:
        def geomType(self):  # noqa: N802 - mimics cadquery API
            raise RuntimeError("no geom")

        def positionAt(self, _t):  # noqa: N802
            raise RuntimeError("no curve")

    assert _safe_edge_polyline(_Boom()) == []


@requires_cadquery
def test_tessellate_emits_edge_polylines_parallel_to_edge_map() -> None:
    """A box emits 12 edge polylines; every polyline id is a stable ``e:`` id that
    also keys edgeMap, and every polyline has >= 2 three-component points. Box
    edges are straight, so each polyline is exactly its two endpoints."""
    script = "import cadquery as cq\nresult = cq.Workplane('XY').box(20, 15, 10)\n"
    exec_result = cad_handlers.execute_script({"script": script})
    handle = exec_result["meshes"][0]["handle"]

    r = cad_handlers.tessellate_with_ids({"handle": handle})

    edges = r["edges"]
    assert isinstance(edges, list)
    assert len(edges) == 12, f"expected 12 edge polylines, got {len(edges)}"
    edge_map = r["edgeMap"]
    for poly in edges:
        assert poly["id"].startswith("e:")
        assert poly["id"] in edge_map, f"polyline id not in edgeMap: {poly['id']}"
        pts = poly["points"]
        assert len(pts) >= 2
        for p in pts:
            assert len(p) == 3 and all(isinstance(c, float) for c in p)
    # Straight box edges → exactly two sampled points each.
    assert {len(poly["points"]) for poly in edges} == {2}
    # The polyline ids cover exactly the edgeMap key set (no orphans either way).
    assert {poly["id"] for poly in edges} == set(edge_map.keys())


@requires_cadquery
def test_curved_edges_are_densely_sampled() -> None:
    """A cylinder's two circular edges sample to many points (tolerance-driven),
    while its straight seam edge stays at two points — so the renderer draws a
    smooth circle, not a chord."""
    script = "import cadquery as cq\nresult = cq.Workplane('XY').circle(8).extrude(10)\n"
    exec_result = cad_handlers.execute_script({"script": script})
    r = cad_handlers.tessellate_with_ids({"handle": exec_result["meshes"][0]["handle"]})

    counts = sorted(len(poly["points"]) for poly in r["edges"])
    # 3 edges: one straight seam (2 pts) + two circles (many pts each).
    assert counts[0] == 2
    assert counts[-1] > 8, f"curved edge under-sampled: {counts}"


@requires_cadquery
def test_picked_edge_polyline_id_fillets_only_that_edge() -> None:
    """HEADLINE end-to-end: take an edge id straight from the tessellation's
    ``edges`` polyline list (exactly what the viewport raycast hands back) and
    fillet via apply_fillet_select_op — it must round ONLY that edge (strictly
    less material than the axis bucket rounding all four parallel edges), with no
    fallback warning (clean resolve)."""
    reset_handle_table()
    script = "import cadquery as cq\nresult = cq.Workplane('XY').box(20, 15, 10)\n"
    exec_result = cad_handlers.execute_script({"script": script})
    r = cad_handlers.tessellate_with_ids(
        {"handle": exec_result["meshes"][0]["handle"]}
    )
    # Pick a VERTICAL (+Z bucket) edge's id from the polyline list the way the
    # renderer would: match a polyline whose two endpoints share x+y (vertical).
    from engines.cad.cadquery_script import _edges_in_axis_bucket, _safe_edge_geom_id

    base = _cube()
    base_vol = _vol(base)
    z_ids = {_safe_edge_geom_id(e) for e in _edges_in_axis_bucket(base.findSolid(), "+Z")}
    picked_id = next(poly["id"] for poly in r["edges"] if poly["id"] in z_ids)

    picked_wp, picked_warn = apply_fillet_select_op(
        base, {"radiusMm": 2.0, "pickedEdgeIds": [picked_id]}
    )
    bucket_wp, bucket_warn = apply_fillet_select_op(
        base, {"radiusMm": 2.0, "edgeDirection": "+Z"}
    )

    assert picked_warn == []  # a viewport-picked id resolves cleanly, no fallback
    assert bucket_warn == []
    picked_removed = base_vol - _vol(picked_wp)
    bucket_removed = base_vol - _vol(bucket_wp)
    assert picked_removed > 0.0  # the picked edge WAS filleted
    assert bucket_removed > picked_removed  # the bucket touched more edges
    assert abs(bucket_removed - 4.0 * picked_removed) < 1e-3  # ~4 identical edges
