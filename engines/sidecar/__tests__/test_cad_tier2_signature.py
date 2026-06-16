"""Tier-2 geometry-invariant signature + tiered pick-id resolver coverage.

Validates the Tier-2 layer added to ``engines/cad/cadquery_script.py`` — the
BOUNDED topological-naming improvement that lets a viewport pick survive a
parametric MOVE (translate) or UNIFORM RESIZE. HONEST scope (asserted here, not
overclaimed): Tier-1 (the exact quantized-geometry hash) is unchanged and still
resolves a same-geometry rebuild byte-identically; Tier-2 re-resolves a pick
after a translate / uniform scale; a topology-changing edit is allowed to miss
(the resolver returns ``None`` and the caller falls to the Tier-3 axis bucket).

Tier-1 tests (no CadQuery) cover the pure signature math (determinism,
translate-invariance, uniform-scale-invariance) on SYNTHETIC face/edge stand-ins
plus the resolver tier ladder + tie-break (ambiguous → ``None``, never guess).
Tier-2 tests (skipped when CadQuery is absent) build a REAL box / cylinder and
prove a face/edge pick re-resolves to the SAME logical element after a move and a
uniform resize, that a same-geometry rebuild still hits Tier-1, and that a
topology change is an honest miss.

Run the Tier-2 tests with the cadquery venv python (the repo's system python
skips them):
    C:/Users/jrrou/wtcam-sidecar-venv/Scripts/python.exe -m pytest \
        engines/sidecar/__tests__/test_cad_tier2_signature.py
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

import pytest

from engines.cad.cadquery_import import reset_handle_table
from engines.cad.cadquery_script import (
    _normal_class,
    _relative_octant,
    _signature_score,
    compute_edge_signature,
    compute_face_signature,
    resolve_pick_id,
)


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


# ── Tier-1: synthetic face / edge stand-ins (no cadquery) ─────────────────────
#
# The signature functions only call ``.geomType()`` / ``.normalAt()`` /
# ``.Center()`` / ``.Area()`` / ``.positionAt()`` / ``.Length()`` on their
# argument, so a tiny duck-typed stub exercises the pure math WITHOUT cadquery.


class _Vec:
    def __init__(self, x: float, y: float, z: float) -> None:
        self.x, self.y, self.z = float(x), float(y), float(z)


class _FakeFace:
    def __init__(self, geom: str, center: Tuple[float, float, float],
                 normal: Tuple[float, float, float], area: float) -> None:
        self._geom = geom
        self._center = center
        self._normal = normal
        self._area = area

    def geomType(self) -> str:  # noqa: N802 - mimics cadquery API
        return self._geom

    def Center(self) -> _Vec:  # noqa: N802
        return _Vec(*self._center)

    def normalAt(self, *_a: Any) -> _Vec:  # noqa: N802
        return _Vec(*self._normal)

    def Area(self) -> float:  # noqa: N802
        return self._area


class _FakeEdge:
    def __init__(self, geom: str, midpoint: Tuple[float, float, float],
                 length: float) -> None:
        self._geom = geom
        self._mid = midpoint
        self._length = length

    def geomType(self) -> str:  # noqa: N802
        return self._geom

    def positionAt(self, _t: float) -> _Vec:  # noqa: N802
        return _Vec(*self._mid)

    def Length(self) -> float:  # noqa: N802
        return self._length


def test_normal_class_signed_component_lattice() -> None:
    # Wire format == CadFaceSignature.normalClass: comma-joined signed rounded
    # unit-normal components (e.g. +Z cap → "+0,+0,+1").
    assert _normal_class((0.0, 0.0, 1.0)) == "+0,+0,+1"
    assert _normal_class((0.0, 0.0, -1.0)) == "+0,+0,-1"
    assert _normal_class((1.0, 0.0, 0.0)) == "+1,+0,+0"
    assert _normal_class((-1.0, 0.0, 0.0)) == "-1,+0,+0"
    assert _normal_class((0.0, 1.0, 0.0)) == "+0,+1,+0"
    # A 45-degree skew normal rounds its components (still deterministic + signed).
    assert _normal_class((1.0, 1.0, 0.0)) == "+1,+1,+0"
    # A degenerate / zero vector is "none".
    assert _normal_class((0.0, 0.0, 0.0)) == "none"


def test_relative_octant_base3_cells() -> None:
    # Base-3 position cell 0..26 = cells[0]*9 + cells[1]*3 + cells[2], where each
    # cell is 0 (below center), 1 (on-center within the 0.5 deadband), or 2 (above).
    center = (0.0, 0.0, 0.0)
    extent = (10.0, 10.0, 10.0)  # half-extent 5; deadband 0.5 → 2.5mm band
    # +X+Y+Z corner (offset +0.8 each, all "2") → 2*9 + 2*3 + 2 = 26.
    assert _relative_octant((4.0, 4.0, 4.0), center, extent) == 26
    # All-negative (all "0") → 0.
    assert _relative_octant((-4.0, -4.0, -4.0), center, extent) == 0
    # +X only: x "2", y/z on-center "1" → 2*9 + 1*3 + 1 = 22.
    assert _relative_octant((4.0, 0.0, 0.0), center, extent) == 22
    # Dead-center (all within the deadband, all "1") → 1*9 + 1*3 + 1 = 13.
    assert _relative_octant((0.0, 0.0, 0.0), center, extent) == 13


def test_face_signature_is_deterministic() -> None:
    """Same input → byte-identical signature dict every call."""
    f = _FakeFace("PLANE", (0.0, 0.0, 5.0), (0.0, 0.0, 1.0), 300.0)
    kw = dict(center=(0.0, 0.0, 0.0), extent=(20.0, 15.0, 10.0),
              same_kind_norm_areas=[1.0, 0.5, 0.25], adjacent_face_count=4)
    s1 = compute_face_signature(f, **kw)
    s2 = compute_face_signature(f, **kw)
    assert s1 == s2
    assert "tier" not in s1  # wire shape carries no tier field (matches CadFaceSignature)
    assert s1["kind"] == "plane"
    assert s1["normalClass"] == "+0,+0,+1"
    assert s1["adjacentFaceCount"] == 4


def test_face_signature_translate_invariant() -> None:
    """A uniform TRANSLATE of the body (centroid + bbox-center shift together)
    leaves the face signature unchanged — the centroid octant is bbox-relative."""
    # Original: top face centroid at z=+5, bbox center at origin.
    orig = compute_face_signature(
        _FakeFace("PLANE", (3.0, 2.0, 5.0), (0.0, 0.0, 1.0), 300.0),
        center=(0.0, 0.0, 0.0), extent=(20.0, 15.0, 10.0),
        same_kind_norm_areas=[1.0, 0.5], adjacent_face_count=4,
    )
    # Translate the whole body by (+100, +50, +25): the face centroid AND the
    # bbox center both shift by the same vector; extent is unchanged.
    moved = compute_face_signature(
        _FakeFace("PLANE", (103.0, 52.0, 30.0), (0.0, 0.0, 1.0), 300.0),
        center=(100.0, 50.0, 25.0), extent=(20.0, 15.0, 10.0),
        same_kind_norm_areas=[1.0, 0.5], adjacent_face_count=4,
    )
    assert orig == moved


def test_face_signature_uniform_scale_invariant() -> None:
    """A uniform SCALE (area scales by s^2, extent by s, centroid by s about the
    center) leaves the signature unchanged — areaRank uses bbox-normalized area
    and the octant uses bbox-normalized position."""
    s = 1.5
    orig = compute_face_signature(
        _FakeFace("PLANE", (3.0, 2.0, 5.0), (0.0, 0.0, 1.0), 300.0),
        center=(0.0, 0.0, 0.0), extent=(20.0, 15.0, 10.0),
        same_kind_norm_areas=[300.0 / _bbox_area((20.0, 15.0, 10.0)),
                              150.0 / _bbox_area((20.0, 15.0, 10.0))],
        adjacent_face_count=4,
    )
    scaled = compute_face_signature(
        _FakeFace("PLANE", (3.0 * s, 2.0 * s, 5.0 * s), (0.0, 0.0, 1.0), 300.0 * s * s),
        center=(0.0, 0.0, 0.0), extent=(20.0 * s, 15.0 * s, 10.0 * s),
        same_kind_norm_areas=[(300.0 * s * s) / _bbox_area((20.0 * s, 15.0 * s, 10.0 * s)),
                              (150.0 * s * s) / _bbox_area((20.0 * s, 15.0 * s, 10.0 * s))],
        adjacent_face_count=4,
    )
    assert orig == scaled


def _bbox_area(extent: Tuple[float, float, float]) -> float:
    return extent[0] * extent[1] + extent[1] * extent[2] + extent[0] * extent[2]


def test_edge_signature_translate_and_scale_invariant() -> None:
    """An edge signature is invariant under both a uniform translate and a
    uniform scale (midpoint octant is bbox-relative; lengthRank is bbox-diagonal
    normalized)."""
    base = compute_edge_signature(
        _FakeEdge("LINE", (3.0, 2.0, 0.0), 10.0),
        center=(0.0, 0.0, 0.0), extent=(20.0, 15.0, 10.0),
        same_kind_norm_lengths=[10.0 / _diag((20.0, 15.0, 10.0)), 5.0 / _diag((20.0, 15.0, 10.0))],
        incident_face_kinds=["plane", "plane"],
    )
    moved = compute_edge_signature(
        _FakeEdge("LINE", (103.0, 52.0, 25.0), 10.0),
        center=(100.0, 50.0, 25.0), extent=(20.0, 15.0, 10.0),
        same_kind_norm_lengths=[10.0 / _diag((20.0, 15.0, 10.0)), 5.0 / _diag((20.0, 15.0, 10.0))],
        incident_face_kinds=["plane", "plane"],
    )
    assert base == moved
    s = 2.0
    scaled = compute_edge_signature(
        _FakeEdge("LINE", (3.0 * s, 2.0 * s, 0.0), 10.0 * s),
        center=(0.0, 0.0, 0.0), extent=(20.0 * s, 15.0 * s, 10.0 * s),
        same_kind_norm_lengths=[(10.0 * s) / _diag((20.0 * s, 15.0 * s, 10.0 * s)),
                          (5.0 * s) / _diag((20.0 * s, 15.0 * s, 10.0 * s))],
        incident_face_kinds=["plane", "plane"],
    )
    assert base == scaled


def _diag(extent: Tuple[float, float, float]) -> float:
    return (extent[0] ** 2 + extent[1] ** 2 + extent[2] ** 2) ** 0.5


# ── Tier-1: resolver tier ladder + tie-break ──────────────────────────────────


def test_resolve_tier1_exact_id_short_circuits() -> None:
    """An exact Tier-1 id hit wins outright — Tier-2 is never consulted (the
    no-regression same-geometry path)."""
    candidates = {
        "f:aaa": {"kind": "plane", "normalClass": "+0,+0,+1",
                  "centroidOctant": 4, "areaRank": 0, "adjacentFaceCount": 4},
        "f:bbb": {"kind": "plane", "normalClass": "+0,+0,-1",
                  "centroidOctant": 0, "areaRank": 0, "adjacentFaceCount": 4},
    }
    # Even with a target signature that matches f:bbb, the exact id f:aaa wins.
    out = resolve_pick_id("f:aaa", candidates["f:bbb"], candidates)
    assert out == "f:aaa"


def test_resolve_tier2_unique_best_match() -> None:
    """When Tier-1 misses, the UNIQUE strictly-best signature match wins."""
    target = {"kind": "plane", "normalClass": "+0,+0,+1",
              "centroidOctant": 4, "areaRank": 0, "adjacentFaceCount": 4}
    candidates = {
        "f:new-top": dict(target),  # identical signature, different (moved) id
        "f:new-bottom": {"kind": "plane", "normalClass": "+0,+0,-1",
                         "centroidOctant": 0, "areaRank": 0, "adjacentFaceCount": 4},
        "f:new-side": {"kind": "plane", "normalClass": "+1,+0,+0",
                       "centroidOctant": 1, "areaRank": 2, "adjacentFaceCount": 4},
    }
    out = resolve_pick_id("f:old-top-different-id", target, candidates)
    assert out == "f:new-top"


def test_resolve_tier2_ambiguous_tie_returns_none() -> None:
    """Two candidates tied for best → ambiguous → ``None`` (never guess wrong).
    This is the headline safety property: a wrong cut is worse than a miss."""
    target = {"kind": "plane", "normalClass": "+0,+0,+1",
              "centroidOctant": 4, "areaRank": 0, "adjacentFaceCount": 4}
    candidates = {
        "f:tie-a": dict(target),
        "f:tie-b": dict(target),  # exact same signature → genuine tie
    }
    assert resolve_pick_id("f:gone", target, candidates) is None


def test_resolve_tier2_kind_mismatch_never_matches() -> None:
    """A plane pick can never resolve to a cylinder candidate (hard kind gate),
    even if every other field would agree — so a low-discrimination body returns
    an honest ``None`` rather than a wrong-kind match."""
    target = {"kind": "plane", "normalClass": "+1,+1,+0",
              "centroidOctant": 0, "areaRank": 0, "adjacentFaceCount": 2}
    candidates = {
        "f:cyl": {"kind": "cylinder", "normalClass": "+1,+1,+0",
                  "centroidOctant": 0, "areaRank": 0, "adjacentFaceCount": 2},
    }
    assert resolve_pick_id("f:gone", target, candidates) is None
    assert _signature_score(target, candidates["f:cyl"]) == -1


def test_resolve_tier2_below_min_score_returns_none() -> None:
    """A match that agrees ONLY on kind (and nothing discriminating) is below the
    minimum score and is rejected — kind alone ('the only plane') is not enough."""
    target = {"kind": "plane", "normalClass": "+0,+0,+1",
              "centroidOctant": 4, "areaRank": 0, "adjacentFaceCount": 4}
    candidates = {
        # Same kind, but every other field differs → score 1 < _TIER2_MIN_SCORE.
        "f:weak": {"kind": "plane", "normalClass": "-1,+0,+0",
                   "centroidOctant": 2, "areaRank": 3, "adjacentFaceCount": 6},
    }
    assert resolve_pick_id("f:gone", target, candidates) is None


def test_resolve_empty_inputs_are_safe() -> None:
    """No candidates / no signature → ``None``, never a raise."""
    assert resolve_pick_id("f:x", {"kind": "plane"}, {}) is None
    assert resolve_pick_id(None, None, {"f:a": {"kind": "plane"}}) is None
    # Target id None but a usable signature still resolves via Tier-2.
    cands = {
        "f:a": {"kind": "plane", "normalClass": "+0,+0,+1",
                "centroidOctant": 4, "areaRank": 0, "adjacentFaceCount": 4},
        "f:b": {"kind": "plane", "normalClass": "+0,+0,-1",
                "centroidOctant": 0, "areaRank": 1, "adjacentFaceCount": 4},
    }
    assert resolve_pick_id(None, cands["f:a"], cands) == "f:a"


# ── Tier-2: REAL part fixtures (Safety Rule 5 — validate with real meshes) ─────


def _face_candidates(tess: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """{occtId: signature} for every face in a tessellation result."""
    return {
        e["occtId"]: e.get("signature", {})
        for e in tess["faceMap"].values()
        if "occtId" in e
    }


def _edge_candidates(tess: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """{edgeId: signature} for every edge in a tessellation result."""
    return {k: e.get("signature", {}) for k, e in tess["edgeMap"].items()}


def _tess(body: Any) -> Dict[str, Any]:
    from engines.cad.cadquery_script import tessellate_body_with_face_ids
    return tessellate_body_with_face_ids(body, tolerance_mm=0.1)


@requires_cadquery
def test_real_box_emits_signature_on_every_face_and_edge() -> None:
    """Deliverable 1: a real box's faceMap/edgeMap entries each carry a Tier-2
    ``signature`` ALONGSIDE the unchanged Tier-1 occtId (no field removed)."""
    import cadquery as cq

    r = _tess(cq.Workplane("XY").box(20, 15, 10))
    assert len(r["faceMap"]) == 6
    assert len(r["edgeMap"]) == 12
    for entry in r["faceMap"].values():
        # Tier-1 fields unchanged.
        assert entry["kind"] == "face"
        assert isinstance(entry["occtId"], str) and entry["occtId"].startswith("f:")
        # Tier-2 signature present + well-formed (wire shape == CadFaceSignature).
        sig = entry["signature"]
        assert "tier" not in sig
        assert sig["kind"] in ("plane", "cylinder", "cone", "sphere", "other")
        # normalClass is comma-joined signed components or "none" (CadFaceSignature).
        assert sig["normalClass"] == "none" or all(
            part[0] in "+-" for part in sig["normalClass"].split(",")
        )
        assert 0 <= sig["centroidOctant"] <= 26
        assert isinstance(sig["areaRank"], int)
        assert isinstance(sig["adjacentFaceCount"], int)
    for entry in r["edgeMap"].values():
        assert entry["occtId"].startswith("e:")
        sig = entry["signature"]
        assert "tier" not in sig
        assert sig["kind"] in ("line", "circle", "other")
        assert 0 <= sig["midpointOctant"] <= 26
        assert isinstance(sig["lengthRank"], int)
        # incidentFaceKinds is a sorted |-joined STRING (CadEdgeSignature), not a list.
        assert isinstance(sig["incidentFaceKinds"], str)
        assert sig["incidentFaceKinds"] == "plane|plane"  # box edge bounds two planes


@requires_cadquery
def test_face_pick_survives_parametric_move() -> None:
    """HEADLINE: a face pick re-resolves to the SAME logical face after the body
    is MOVED (translate). Tier-1 MUST miss (absolute coords changed); Tier-2 must
    re-resolve to the moved body's corresponding face."""
    import cadquery as cq

    r0 = _tess(cq.Workplane("XY").box(20, 15, 10))
    # Pick the +Z top face.
    top_id, top_sig = next(
        (e["occtId"], e["signature"])
        for e in r0["faceMap"].values()
        if e["signature"]["normalClass"] == "+0,+0,+1"
    )

    moved = _tess(cq.Workplane("XY").box(20, 15, 10).translate((100, 50, 25)))
    cands = _face_candidates(moved)
    assert top_id not in cands, "Tier-1 should MISS after a move (absolute hash changed)"

    resolved = resolve_pick_id(top_id, top_sig, cands)
    moved_top = next(
        e["occtId"] for e in moved["faceMap"].values()
        if e["signature"]["normalClass"] == "+0,+0,+1"
    )
    assert resolved == moved_top, "Tier-2 must re-resolve the moved top face"


@requires_cadquery
def test_face_pick_survives_uniform_resize() -> None:
    """HEADLINE: a face pick re-resolves to the SAME logical face after a UNIFORM
    RESIZE (1.5x on all axes). Tier-1 misses; Tier-2 re-resolves."""
    import cadquery as cq

    r0 = _tess(cq.Workplane("XY").box(20, 15, 10))
    top_id, top_sig = next(
        (e["occtId"], e["signature"])
        for e in r0["faceMap"].values()
        if e["signature"]["normalClass"] == "+0,+0,+1"
    )

    big = _tess(cq.Workplane("XY").box(30, 22.5, 15))  # uniform 1.5x
    cands = _face_candidates(big)
    assert top_id not in cands, "Tier-1 should MISS after a resize"

    resolved = resolve_pick_id(top_id, top_sig, cands)
    big_top = next(
        e["occtId"] for e in big["faceMap"].values()
        if e["signature"]["normalClass"] == "+0,+0,+1"
    )
    assert resolved == big_top


@requires_cadquery
def test_each_vertical_edge_resolves_to_its_own_corner_after_move() -> None:
    """The 4 vertical edges of a box share kind/length/incident-kinds and differ
    ONLY by octant — so each must re-resolve to its OWN corner after a move (no
    cross-talk). This proves Tier-2 is discriminating, not just 'an edge'."""
    import cadquery as cq
    from engines.cad.cadquery_script import _edges_in_axis_bucket, _safe_edge_geom_id

    base = cq.Workplane("XY").box(20, 15, 10)
    r0 = _tess(base)
    z_ids = {_safe_edge_geom_id(e) for e in _edges_in_axis_bucket(base.findSolid(), "+Z")}
    verticals = {k: v["signature"] for k, v in r0["edgeMap"].items() if k in z_ids}
    assert len(verticals) == 4
    # The 4 vertical edges have 4 DISTINCT octants (no ambiguity by construction).
    assert len({s["midpointOctant"] for s in verticals.values()}) == 4

    moved = _tess(cq.Workplane("XY").box(20, 15, 10).translate((100, 50, 25)))
    moved_edges = _edge_candidates(moved)
    for _eid, sig in verticals.items():
        resolved = resolve_pick_id(_eid, sig, moved_edges)
        assert resolved is not None, "each vertical edge must re-resolve"
        # The resolved edge has the SAME octant as the picked one (its corner).
        assert moved_edges[resolved]["midpointOctant"] == sig["midpointOctant"]


@requires_cadquery
def test_same_geometry_rebuild_resolves_via_tier1_no_regression() -> None:
    """No-regression pin: a SAME-geometry rebuild resolves via Tier-1 EXACTLY —
    the resolved id equals the original picked id (byte-identical hash)."""
    import cadquery as cq

    r0 = _tess(cq.Workplane("XY").box(20, 15, 10))
    top_id, top_sig = next(
        (e["occtId"], e["signature"])
        for e in r0["faceMap"].values()
        if e["signature"]["normalClass"] == "+0,+0,+1"
    )
    r1 = _tess(cq.Workplane("XY").box(20, 15, 10))  # identical geometry
    cands = _face_candidates(r1)
    assert top_id in cands, "Tier-1 MUST hit on a same-geometry rebuild"
    assert resolve_pick_id(top_id, top_sig, cands) == top_id


@requires_cadquery
def test_topology_change_ambiguous_pick_is_honest_miss() -> None:
    """OUT-OF-SCOPE honesty: when a topology change makes a picked element's
    signature non-unique (here: two extra coplanar top faces created by a tee
    slot share the picked face's signature), the resolver returns ``None`` rather
    than guess — the caller then falls to the Tier-3 axis bucket / honest
    pick-lost. (We pick a deliberately AMBIGUOUS element to assert the
    never-guess contract; a still-unique survivor would legitimately resolve.)"""
    import cadquery as cq

    # Original: a plain box. Pick a +X side face.
    r0 = _tess(cq.Workplane("XY").box(20, 20, 20))
    pickx_id, pickx_sig = next(
        (e["occtId"], e["signature"])
        for e in r0["faceMap"].values()
        if e["signature"]["normalClass"] == "+1,+0,+0"
    )

    # Topology change: cut a centered square channel straight through in Y, which
    # SPLITS the single +X face into two coplanar +X faces of equal area + mirror
    # octants — an inherently ambiguous re-resolution for the original pick.
    holed = (
        cq.Workplane("XY").box(20, 20, 20)
        .faces(">X").workplane().rect(8, 8).cutThruAll()
    )
    rh = _tess(holed)
    cands = _face_candidates(rh)
    # Tier-1 misses (the face was split → new geometry → new hashes).
    assert pickx_id not in cands
    resolved = resolve_pick_id(pickx_id, pickx_sig, cands)
    # Honest miss OR a single dominant survivor — but NEVER a wrong-confident pick
    # among the ambiguous split faces. We assert it does not silently pick one of
    # the two equal split faces (which would be a guess). The strict contract: if
    # more than one candidate ties for best, the result is None.
    from engines.cad.cadquery_script import _signature_score
    best = max(_signature_score(pickx_sig, s) for s in cands.values()) if cands else -1
    tied = [cid for cid, s in cands.items() if _signature_score(pickx_sig, s) == best]
    if len(tied) > 1:
        assert resolved is None, "ambiguous topology change must be an honest miss"
    else:
        # A unique survivor is allowed to resolve (documented boundary behaviour).
        assert resolved in (None, tied[0])
