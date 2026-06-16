"""Tier-2 pick-signature INVARIANCE validation against a REAL mesh (Safety Rule 5).

The renderer's tiered picked-id resolver (``src/shared/kernel-pick-file.ts``
``resolvePickedId``) recovers a pick that survived a parametric MOVE / UNIFORM
RESIZE by matching a geometry-INVARIANT signature when the Tier-1 absolute-hash
id no longer matches. This file proves, on a REAL CadQuery cube, the two halves
of that contract:

  1. MOTIVATION — the existing Tier-1 stable ids (``_safe_face_geom_id`` /
     ``_safe_edge_geom_id``, the absolute-geometry FNV hashes the kernel resolves
     today) CHANGE under a translate. That is exactly the failure Tier-2 fixes:
     same edge, new id, pick lost to the axis bucket.

  2. THE INVARIANT — a reference signature built from rank / class / bbox-octant
     fields (the SAME field semantics the TS ``CadFaceSignature`` /
     ``CadEdgeSignature`` carry, mirrored here) is IDENTICAL for a base cube and a
     translated + uniformly-scaled cube. So when the renderer's resolver compares
     the stored signature against the rebuilt body's signatures, the moved/resized
     entity matches and the pick is recovered.

This is the executable SPECIFICATION the Python signature emitter (build_part.py /
cadquery_script.py — owned by the kernel agent) must satisfy so its wire output
resolves against the TS resolver cross-path. It imports the existing Tier-1
helpers READ-ONLY (it never edits the kernel core) and computes the reference
signature locally.

Run with the cadquery venv (the repo's system python skips @requires_cadquery):
    C:/Users/jrrou/wtcam-sidecar-venv/Scripts/python.exe -m pytest \
        engines/sidecar/__tests__/test_tier2_pick_signature_invariance.py
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

import pytest

from engines.cad.cadquery_import import reset_handle_table
from engines.cad.cadquery_script import _safe_edge_geom_id, _safe_face_geom_id


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


# ── Reference signature (mirrors the TS CadFaceSignature / CadEdgeSignature) ──
#
# These compute the SAME invariant fields the renderer compares in
# faceSignaturesEqual / edgeSignaturesEqual. Everything is rank / class / octant
# based and normalized by the body principal frame (here the bbox, axis-aligned
# for a box), so a uniform translate + uniform scale leaves every field unchanged.


def _bbox(solid: Any) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
    bb = solid.BoundingBox()
    return (bb.xmin, bb.ymin, bb.zmin), (bb.xmax, bb.ymax, bb.zmax)


# Deadband (as a fraction of the half-extent) inside which a coordinate counts as
# "on the center plane". CRITICAL for invariance: a box FACE centroid sits exactly
# on the bbox center in two of its three axes (e.g. the +Z face centroid is at
# (~0, ~0, +half)), so a naive ``>= center`` test keys off the FP sign of ~0 and
# flips arbitrarily between a base body and a scaled one. The deadband folds those
# near-zero offsets to a stable 0 so the cell is genuinely move / uniform-scale
# invariant. 0.5 (half the half-extent) cleanly separates a centroid on a face
# (offset ~1.0 on its normal axis, ~0 on the others) from the center.
_OCTANT_DEADBAND = 0.5


def _octant(point: Tuple[float, float, float], lo, hi) -> int:
    """Bbox-relative position cell (0..26): a base-3 pack of the per-axis sign
    (−1 / 0 / +1, with a deadband) of the NORMALIZED offset from the bbox center.

    Normalizing each axis by its half-extent makes the cell invariant under a
    uniform translate + uniform scale; the deadband makes an on-center coordinate
    (a box face centroid) stable instead of FP-sign-dependent. Mirrors the TS
    ``CadFaceSignature.centroidOctant`` / ``CadEdgeSignature.midpointOctant``."""
    cells = []
    for axis in range(3):
        center = (lo[axis] + hi[axis]) / 2.0
        half = (hi[axis] - lo[axis]) / 2.0
        if half <= 1e-9:
            cells.append(1)  # degenerate axis → "on center"
            continue
        offset = (point[axis] - center) / half
        if offset > _OCTANT_DEADBAND:
            cells.append(2)
        elif offset < -_OCTANT_DEADBAND:
            cells.append(0)
        else:
            cells.append(1)
    return cells[0] * 9 + cells[1] * 3 + cells[2]


def _xyz(v: Any) -> Tuple[float, float, float]:
    if hasattr(v, "x"):
        return (float(v.x), float(v.y), float(v.z))
    return (float(v[0]), float(v[1]), float(v[2]))


def _face_kind(face: Any) -> str:
    try:
        gt = str(face.geomType()).upper()
    except Exception:  # noqa: BLE001
        return "other"
    return {
        "PLANE": "plane",
        "CYLINDER": "cylinder",
        "CONE": "cone",
        "SPHERE": "sphere",
    }.get(gt, "other")


def _edge_kind(edge: Any) -> str:
    try:
        gt = str(edge.geomType()).upper()
    except Exception:  # noqa: BLE001
        return "other"
    if gt == "LINE":
        return "line"
    if gt == "CIRCLE":
        return "circle"
    return "other"


def _normal_class(face: Any) -> str:
    """Outward normal quantized to a per-axis sign lattice. For an axis-aligned
    box the principal frame IS world, so this is the signed unit normal rounded —
    invariant under translate + uniform (positive) scale."""
    try:
        n = _xyz(face.normalAt())
    except Exception:  # noqa: BLE001
        return "0,0,0"
    mag = math.sqrt(sum(c * c for c in n))
    if mag <= 1e-9:
        return "0,0,0"
    u = [c / mag for c in n]

    def q(c: float) -> str:
        r = round(c)  # box normals are axis-aligned → -1 / 0 / +1
        return f"{r:+d}".replace("+0", "+0")

    return f"{q(u[0])},{q(u[1])},{q(u[2])}"


def _adjacent_face_count(solid: Any, face: Any) -> int:
    """Number of faces sharing an edge with ``face`` (topology degree). On a box
    every face touches 4 others — a count unchanged by a rigid move / scale."""
    target_edges = {_safe_edge_geom_id(e) for e in face.Edges()}
    count = 0
    for other in solid.Faces():
        if _safe_face_geom_id(other) == _safe_face_geom_id(face):
            continue
        if any(_safe_edge_geom_id(e) in target_edges for e in other.Edges()):
            count += 1
    return count


def _face_signature(solid: Any, face: Any, lo, hi) -> Dict[str, Any]:
    kind = _face_kind(face)
    # areaRank: 0-based rank of this face's area among faces of the SAME kind
    # (largest = 0). Uniform scale multiplies every area by the same factor, so
    # the ordering — hence the rank — is preserved.
    same_kind_areas = sorted(
        (float(f.Area()) for f in solid.Faces() if _face_kind(f) == kind),
        reverse=True,
    )
    area = float(face.Area())
    area_rank = _rank_of(area, same_kind_areas)
    return {
        "kind": kind,
        "adjacentFaceCount": _adjacent_face_count(solid, face),
        "normalClass": _normal_class(face),
        "areaRank": area_rank,
        "centroidOctant": _octant(_xyz(face.Center()), lo, hi),
    }


def _edge_signature(solid: Any, edge: Any, lo, hi) -> Dict[str, Any]:
    kind = _edge_kind(edge)
    same_kind_lengths = sorted(
        (float(e.Length()) for e in solid.Edges() if _edge_kind(e) == kind),
        reverse=True,
    )
    length = float(edge.Length())
    length_rank = _rank_of(length, same_kind_lengths)
    incident_kinds = sorted(
        _face_kind(f)
        for f in solid.Faces()
        if any(_safe_edge_geom_id(e) == _safe_edge_geom_id(edge) for e in f.Edges())
    )
    mid = _xyz(edge.positionAt(0.5))
    return {
        "kind": kind,
        "lengthRank": length_rank,
        "midpointOctant": _octant(mid, lo, hi),
        "incidentFaceKinds": "|".join(incident_kinds),
    }


def _rank_of(value: float, sorted_desc: List[float], tol: float = 1e-6) -> int:
    """Rank of ``value`` in a descending list, ties sharing the lowest rank."""
    for i, v in enumerate(sorted_desc):
        if abs(v - value) <= tol:
            return i
    return len(sorted_desc)


def _all_face_signatures(solid: Any) -> List[Dict[str, Any]]:
    lo, hi = _bbox(solid)
    return sorted(
        (_face_signature(solid, f, lo, hi) for f in solid.Faces()),
        key=lambda s: (s["kind"], s["areaRank"], s["normalClass"], s["centroidOctant"]),
    )


def _all_edge_signatures(solid: Any) -> List[Dict[str, Any]]:
    lo, hi = _bbox(solid)
    return sorted(
        (_edge_signature(solid, e, lo, hi) for e in solid.Edges()),
        key=lambda s: (s["kind"], s["lengthRank"], s["midpointOctant"], s["incidentFaceKinds"]),
    )


# ── The tests ────────────────────────────────────────────────────────────────


@requires_cadquery
def test_tier1_ids_change_under_translate_motivating_tier2() -> None:
    """MOTIVATION: the existing absolute-hash Tier-1 ids do NOT survive a move —
    so a pick stored against the original body misses after a translate. This is
    the exact gap the Tier-2 signature recovers."""
    import cadquery as cq

    base = cq.Workplane("XY").box(20, 15, 10).findSolid()
    moved = cq.Workplane("XY").box(20, 15, 10).translate((100, 5, -3)).findSolid()

    base_face_ids = {_safe_face_geom_id(f) for f in base.Faces()}
    moved_face_ids = {_safe_face_geom_id(f) for f in moved.Faces()}
    base_edge_ids = {_safe_edge_geom_id(e) for e in base.Edges()}
    moved_edge_ids = {_safe_edge_geom_id(e) for e in moved.Edges()}

    # Disjoint id sets across the move: Tier 1 cannot bridge the translate.
    assert base_face_ids.isdisjoint(moved_face_ids)
    assert base_edge_ids.isdisjoint(moved_edge_ids)


@requires_cadquery
def test_face_signatures_invariant_under_translate_and_uniform_scale() -> None:
    """THE INVARIANT (faces): a real cube and a translated + uniformly-scaled cube
    produce the IDENTICAL multiset of face signatures — so the renderer's
    resolvePickedId recovers the moved/resized face by signature."""
    import cadquery as cq

    base = cq.Workplane("XY").box(20, 15, 10).findSolid()
    # Uniform 1.7x scale about the origin THEN translate — the worst realistic
    # "moved and resized" case the bounded Tier-2 layer must survive.
    moved = (
        cq.Workplane("XY")
        .box(20 * 1.7, 15 * 1.7, 10 * 1.7)
        .translate((100.0, -40.0, 12.5))
        .findSolid()
    )

    assert _all_face_signatures(base) == _all_face_signatures(moved)


@requires_cadquery
def test_edge_signatures_invariant_under_translate_and_uniform_scale() -> None:
    """THE INVARIANT (edges): same as faces — the edge-signature multiset is
    identical across a uniform move/resize, so a picked fillet/chamfer edge is
    recoverable."""
    import cadquery as cq

    base = cq.Workplane("XY").box(20, 15, 10).findSolid()
    moved = (
        cq.Workplane("XY")
        .box(20 * 2.0, 15 * 2.0, 10 * 2.0)
        .translate((-30.0, 60.0, 5.0))
        .findSolid()
    )

    assert _all_edge_signatures(base) == _all_edge_signatures(moved)


@requires_cadquery
def test_signature_fields_have_the_expected_shape_for_a_box() -> None:
    """Sanity on the field VALUES the TS CadFaceSignature / CadEdgeSignature
    carry, so the wire contract the kernel agent emits lines up with the resolver:
      * a box has 6 plane faces, each adjacent to 4 others, areaRank in 0..2
        (three distinct face areas: 2 each), centroidOctant in 0..7;
      * a box has 12 straight (line) edges, lengthRank in 0..2, each incident to
        exactly two plane faces ("plane|plane")."""
    import cadquery as cq

    solid = cq.Workplane("XY").box(20, 15, 10).findSolid()

    face_sigs = _all_face_signatures(solid)
    assert len(face_sigs) == 6
    for s in face_sigs:
        assert s["kind"] == "plane"
        assert s["adjacentFaceCount"] == 4
        # Competition ranking (ties share a rank, the next rank skips): a box has
        # 3 distinct face areas in opposite pairs → ranks {0, 2, 4}.
        assert s["areaRank"] in (0, 2, 4)
        # Base-3 position cell (per-axis −1/0/+1 packed) → 0..26.
        assert 0 <= s["centroidOctant"] <= 26
        assert s["normalClass"].count(",") == 2

    # Within ONE body the (kind, areaRank, normalClass, centroidOctant) tuple is
    # UNIQUE per face — this is what makes the resolver's Tier-2 uniqueness test
    # pick exactly one face (no ambiguous-fallback on a plain box).
    keyed = {
        (s["kind"], s["areaRank"], s["normalClass"], s["centroidOctant"]) for s in face_sigs
    }
    assert len(keyed) == 6

    edge_sigs = _all_edge_signatures(solid)
    assert len(edge_sigs) == 12
    for s in edge_sigs:
        assert s["kind"] == "line"
        # 3 distinct edge lengths in groups of 4 → competition ranks {0, 4, 8}.
        assert s["lengthRank"] in (0, 4, 8)
        assert s["incidentFaceKinds"] == "plane|plane"


@requires_cadquery
def test_topology_changing_edit_breaks_the_signature_set_honest_scope() -> None:
    """HONEST SCOPE (the headline non-overclaim): Tier-2 covers a MOVE / UNIFORM
    RESIZE, NOT a topology-changing edit. Drilling a through hole adds a
    cylindrical face + circular edges and changes neighbour counts, so the
    signature multiset genuinely differs from the plain box. The resolver then
    correctly cannot blanket-recover every old pick (it falls to Tier-3 honesty
    for the entities the edit disturbed) - proving we do NOT claim a full
    topological-naming solve."""
    import cadquery as cq

    base = cq.Workplane("XY").box(20, 15, 10).findSolid()
    drilled = cq.Workplane("XY").box(20, 15, 10).faces(">Z").hole(4).findSolid()

    base_faces = _all_face_signatures(base)
    drilled_faces = _all_face_signatures(drilled)

    # The drilled body has MORE faces (the bore wall) and a different signature
    # multiset - a topology change, out of Tier-2 scope by design.
    assert len(drilled_faces) > len(base_faces)
    assert base_faces != drilled_faces
    # And it grew a cylindrical face that the plain box never had.
    assert any(s["kind"] == "cylinder" for s in drilled_faces)
    assert not any(s["kind"] == "cylinder" for s in base_faces)


@requires_cadquery
def test_non_uniform_resize_keeps_per_body_uniqueness_safe() -> None:
    """HONEST SCOPE (documented boundary): a NON-uniform resize is OUT OF the
    guaranteed envelope. We assert only the truthful, weak property - the
    per-body signature stays UNIQUE per face, so the resolver's uniqueness gate
    never makes an ambiguous WRONG guess. We deliberately do NOT assert that a
    pick is recovered or that it is lost across a non-uniform stretch (either is
    acceptable; only a wrong guess is not)."""
    import cadquery as cq

    stretched = cq.Workplane("XY").box(40, 15, 10).findSolid()
    sigs = _all_face_signatures(stretched)
    keyed = {
        (s["kind"], s["areaRank"], s["normalClass"], s["centroidOctant"]) for s in sigs
    }
    assert len(keyed) == len(sigs) == 6
