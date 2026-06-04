"""pytest coverage for the planegcs-backed sketch solver.

Covers:

  * The pure-Python validation layer in
    ``engines/cad/sketch_solver.py::sketch_from_dict`` and
    ``constraints_from_list`` — these run regardless of whether planegcs is
    installed because they happen BEFORE the solver is touched.
  * The sidecar handler in ``engines/sidecar/cad_handlers.py::solve_sketch``
    — wire envelope validation, dispatch-table registration.
  * The full solve round trip when planegcs is installed — right triangle
    (horizontal + vertical + distance), coincident-pair collapse, and the
    over-constrained diagnostic path.

Mirrors the two-tier split used by ``test_cad_script_handlers.py``:

  Tier 1 — **No planegcs required.** Cover dispatch registration and
    payload validation. Run in any Python sandbox that has the engines/
    code on path.

  Tier 2 — **planegcs required.** Skipped automatically when ``import
    planegcs`` fails. When present, exercises the actual planegcs.Sketch /
    constraint / solve / diagnose pipeline against three canonical
    sketches.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List

import pytest

from engines.cad.cadquery_import import _CadHandlerError
from engines.cad.sketch_solver import (
    SOLVE_STATUS_FULLY,
    SOLVE_STATUS_OVER,
    SOLVE_STATUS_UNDER,
    CoincidentConstraint,
    Constraint,
    DistanceConstraint,
    HorizontalConstraint,
    LineEntity,
    ParallelConstraint,
    PerpendicularConstraint,
    PointEntity,
    RadiusConstraint,
    Sketch,
    VerticalConstraint,
    _diagnosis_to_payload,
    _map_tags_to_sources,
    constraint_from_dict,
    constraints_from_list,
    sketch_from_dict,
    solve_sketch_payload,
)
from engines.sidecar import cad_handlers


# ── Fixtures / probes ────────────────────────────────────────────────────


def _planegcs_available() -> bool:
    try:
        import planegcs  # noqa: F401 - probe only
        return True
    except ImportError:
        return False


requires_planegcs = pytest.mark.skipif(
    not _planegcs_available(),
    reason="planegcs not installed in this environment",
)


# ── Tier 1: dispatch-table registration ──────────────────────────────────


def test_dispatch_table_registers_solve_sketch() -> None:
    """The sidecar dispatch table MUST expose ``cad.solve_sketch`` so the
    TS bridge can call it by dotted name. Drift here breaks the wire
    contract before the user even hits a constraint.
    """
    from engines.sidecar.main import _build_dispatch_table

    table = _build_dispatch_table()
    assert "cad.solve_sketch" in table


def test_handlers_dict_exposes_solve_sketch_callable() -> None:
    """``HANDLERS['solve_sketch']`` must be the same callable wired into the
    dispatch table — a typo in the registration would let the dispatch loop
    pick up an old handler with a different signature.
    """
    assert "solve_sketch" in cad_handlers.HANDLERS
    assert callable(cad_handlers.HANDLERS["solve_sketch"])


# ── Tier 1: handler-level param validation ───────────────────────────────


def test_solve_sketch_handler_requires_sketch_state() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.solve_sketch({"constraintList": []})
    assert exc_info.value.code == "bad_params"


def test_solve_sketch_handler_requires_constraint_list() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.solve_sketch({"sketchState": {"points": []}})
    assert exc_info.value.code == "bad_params"


def test_solve_sketch_handler_rejects_non_dict_sketch_state() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.solve_sketch(
            {"sketchState": "not a dict", "constraintList": []}
        )
    assert exc_info.value.code == "bad_params"


def test_solve_sketch_handler_rejects_non_list_constraint_list() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        cad_handlers.solve_sketch(
            {"sketchState": {"points": []}, "constraintList": "not a list"}
        )
    assert exc_info.value.code == "bad_params"


# ── Tier 1: sketch_from_dict validation ──────────────────────────────────


def test_sketch_from_dict_accepts_minimal_empty_sketch() -> None:
    """An empty sketch object (all four collections empty / missing) must
    parse without error so the renderer can boot with a blank canvas."""
    s = sketch_from_dict({})
    assert s.points == []
    assert s.lines == []
    assert s.circles == []
    assert s.arcs == []


def test_sketch_from_dict_rejects_non_object_top_level() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        sketch_from_dict("not an object")
    assert exc_info.value.code == "invalid_sketch"


def test_sketch_from_dict_rejects_duplicate_entity_ids() -> None:
    """Two entities (even across collections) must not share an id —
    the constraint validator looks them up by id and a duplicate would
    silently bind to the wrong target.
    """
    with pytest.raises(_CadHandlerError) as exc_info:
        sketch_from_dict(
            {
                "points": [
                    {"id": "p1", "x": 0, "y": 0},
                    {"id": "p1", "x": 5, "y": 0},
                ]
            }
        )
    assert exc_info.value.code == "invalid_sketch"


def test_sketch_from_dict_rejects_non_finite_coordinate() -> None:
    """NaN / Inf in a point coordinate would propagate into planegcs and
    typically crash the solver — reject at the validator boundary."""
    with pytest.raises(_CadHandlerError) as exc_info:
        sketch_from_dict(
            {"points": [{"id": "p1", "x": float("nan"), "y": 0}]}
        )
    assert exc_info.value.code == "invalid_sketch"


def test_sketch_from_dict_rejects_non_positive_radius_on_circle() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        sketch_from_dict(
            {
                "points": [{"id": "c1", "x": 0, "y": 0}],
                "circles": [{"id": "C1", "center": "c1", "radius": 0}],
            }
        )
    assert exc_info.value.code == "invalid_sketch"


def test_sketch_from_dict_loads_full_shape() -> None:
    """A fully-populated sketch round-trips through the validator and the
    typed dataclasses carry the input values."""
    payload = {
        "points": [
            {"id": "p1", "x": 0.0, "y": 0.0, "fixed": True},
            {"id": "p2", "x": 5.0, "y": 0.0},
        ],
        "lines": [{"id": "ln1", "p1": "p1", "p2": "p2"}],
        "circles": [{"id": "C1", "center": "p1", "radius": 2.5}],
        "arcs": [
            {
                "id": "A1",
                "center": "p1",
                "start": "p2",
                "end": "p2",
                "radius": 3.0,
                "startAngle": 0.0,
                "endAngle": math.pi,
            }
        ],
    }
    s = sketch_from_dict(payload)
    assert len(s.points) == 2
    assert s.points[0].fixed is True
    assert s.points[1].fixed is False
    assert len(s.lines) == 1 and s.lines[0].p1 == "p1"
    assert s.circles[0].radius == pytest.approx(2.5)
    assert s.arcs[0].start_angle == pytest.approx(0.0)
    assert s.arcs[0].end_angle == pytest.approx(math.pi)


# ── Tier 1: constraint_from_dict / constraints_from_list ─────────────────


def test_constraints_from_list_rejects_non_list() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        constraints_from_list("not a list")
    assert exc_info.value.code == "invalid_constraint"


def test_constraint_from_dict_rejects_unknown_kind() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        constraint_from_dict({"id": "c1", "kind": "tangent"}, 0)
    assert exc_info.value.code == "invalid_constraint"


def test_constraint_from_dict_translates_all_seven_kinds() -> None:
    """Every wire-supported constraint kind must produce the right
    dataclass with the operand fields carried across."""
    raw = [
        {"id": "c1", "kind": "horizontal", "line": "L1"},
        {"id": "c2", "kind": "vertical", "line": "L2"},
        {"id": "c3", "kind": "coincident", "p1": "A", "p2": "B"},
        {"id": "c4", "kind": "distance", "p1": "A", "p2": "B", "distance": 10.0},
        {"id": "c5", "kind": "radius", "entity": "C1", "radius": 5.0},
        {"id": "c6", "kind": "parallel", "l1": "L1", "l2": "L2"},
        {"id": "c7", "kind": "perpendicular", "l1": "L1", "l2": "L2"},
    ]
    cs = constraints_from_list(raw)
    assert isinstance(cs[0], HorizontalConstraint) and cs[0].line == "L1"
    assert isinstance(cs[1], VerticalConstraint) and cs[1].line == "L2"
    assert isinstance(cs[2], CoincidentConstraint)
    assert (cs[2].p1, cs[2].p2) == ("A", "B")
    assert isinstance(cs[3], DistanceConstraint)
    assert cs[3].distance == pytest.approx(10.0)
    assert isinstance(cs[4], RadiusConstraint)
    assert cs[4].radius == pytest.approx(5.0)
    assert isinstance(cs[5], ParallelConstraint)
    assert isinstance(cs[6], PerpendicularConstraint)


def test_constraint_from_dict_rejects_negative_distance() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        constraint_from_dict(
            {"id": "c1", "kind": "distance", "p1": "A", "p2": "B", "distance": -3.0},
            0,
        )
    assert exc_info.value.code == "invalid_constraint"


def test_constraint_from_dict_rejects_non_positive_radius() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        constraint_from_dict(
            {"id": "c1", "kind": "radius", "entity": "C1", "radius": 0.0}, 0
        )
    assert exc_info.value.code == "invalid_constraint"


# ── Tier 1: validate_constraint_refs (via solve) ─────────────────────────


def test_solve_payload_rejects_constraint_with_unknown_line_id() -> None:
    """The validator must catch a constraint pointing at a missing entity
    BEFORE we touch planegcs, so the renderer gets a clean error even on
    machines without the solver installed."""
    with pytest.raises(_CadHandlerError) as exc_info:
        solve_sketch_payload(
            {
                "points": [
                    {"id": "p1", "x": 0, "y": 0},
                    {"id": "p2", "x": 5, "y": 0},
                ],
                "lines": [{"id": "ln1", "p1": "p1", "p2": "p2"}],
            },
            [{"id": "c1", "kind": "horizontal", "line": "ghost"}],
        )
    assert exc_info.value.code == "invalid_constraint"


def test_solve_payload_rejects_constraint_with_unknown_point_id() -> None:
    with pytest.raises(_CadHandlerError) as exc_info:
        solve_sketch_payload(
            {"points": [{"id": "p1", "x": 0, "y": 0}]},
            [{"id": "c1", "kind": "coincident", "p1": "p1", "p2": "ghost"}],
        )
    assert exc_info.value.code == "invalid_constraint"


def test_solve_payload_surfaces_planegcs_missing_when_absent() -> None:
    """When planegcs is not installed AND the validation passes, the solve
    must surface ``planegcs_not_installed``. This is the path the TS bridge
    maps to the operator-facing install hint.

    Skipped when planegcs IS installed (the path is unreachable then).
    """
    if _planegcs_available():
        pytest.skip("planegcs is installed; this test only covers the missing case")

    with pytest.raises(_CadHandlerError) as exc_info:
        solve_sketch_payload(
            {
                "points": [
                    {"id": "p1", "x": 0, "y": 0, "fixed": True},
                    {"id": "p2", "x": 5, "y": 0},
                ],
                "lines": [{"id": "ln1", "p1": "p1", "p2": "p2"}],
            },
            [{"id": "c1", "kind": "horizontal", "line": "ln1"}],
        )
    assert exc_info.value.code == "planegcs_not_installed"


# ── Tier 1: DOF diagnostics helpers (no planegcs) ────────────────────────
#
# ``_diagnosis_to_payload`` / ``_map_tags_to_sources`` are pure functions that
# translate a planegcs ``Diagnosis`` into the additive wire payload. They are
# version-drift-tolerant (every field read is ``getattr``-guarded), so we can
# exercise them with a lightweight fake Diagnosis WITHOUT planegcs installed —
# this is the path that proves the DOF/status reporting shape directly, dodging
# both the planegcs dependency and the CadQuery exec-sandbox entirely.


class _FakeDiagnosis:
    """Minimal stand-in for planegcs' Diagnosis used by the Tier-1 helpers."""

    def __init__(
        self,
        *,
        dof: int,
        is_over: bool = False,
        is_under: bool = False,
        conflicting=(),
        redundant=(),
    ) -> None:
        self.dof = dof
        self.is_over_constrained = is_over
        self.is_under_constrained = is_under
        self.conflicting = conflicting
        self.redundant = redundant


def test_map_tags_to_sources_filters_and_sorts() -> None:
    """Tags map back to source ids; unmapped (planegcs-internal) tags drop,
    duplicates collapse, and the output is sorted for stable rendering."""
    tag_to_source = {1: "cB", 2: "cA", 3: "cA"}
    # tag 99 has no source mapping -> dropped; tags 2 & 3 both map to cA.
    assert _map_tags_to_sources([1, 2, 3, 99], tag_to_source) == ["cA", "cB"]


def test_map_tags_to_sources_handles_empty_and_none() -> None:
    assert _map_tags_to_sources(None, {1: "c1"}) == []
    assert _map_tags_to_sources((), {1: "c1"}) == []


def test_diagnosis_payload_fully_constrained() -> None:
    """dof == 0, not over/under -> 'fully' with empty id arrays."""
    sketch = Sketch(points=[PointEntity(id="p1", x=0, y=0, fixed=True)])
    payload = _diagnosis_to_payload(_FakeDiagnosis(dof=0), {}, sketch)
    assert payload["dof"] == 0
    assert payload["status"] == SOLVE_STATUS_FULLY
    assert payload["conflictingConstraintIds"] == []
    assert payload["redundantConstraintIds"] == []
    assert payload["underConstrainedEntityIds"] == []


def test_diagnosis_payload_under_constrained_lists_free_points() -> None:
    """dof > 0 -> 'under', and every NON-fixed point id is reported as still
    free to move (fixed points are excluded)."""
    sketch = Sketch(
        points=[
            PointEntity(id="anchor", x=0, y=0, fixed=True),
            PointEntity(id="free1", x=1, y=1),
            PointEntity(id="free2", x=2, y=2),
        ]
    )
    payload = _diagnosis_to_payload(
        _FakeDiagnosis(dof=2, is_under=True), {}, sketch
    )
    assert payload["dof"] == 2
    assert payload["status"] == SOLVE_STATUS_UNDER
    assert payload["underConstrainedEntityIds"] == ["free1", "free2"]
    assert payload["conflictingConstraintIds"] == []


def test_diagnosis_payload_over_constrained_maps_conflicting_ids() -> None:
    """An over-constrained diagnosis surfaces the conflicting SOURCE ids
    (mapped from planegcs tags) and reports 'over'."""
    sketch = Sketch(points=[PointEntity(id="p1", x=0, y=0)])
    payload = _diagnosis_to_payload(
        _FakeDiagnosis(
            dof=0, is_over=True, conflicting=[10, 11], redundant=[12]
        ),
        {10: "cH", 11: "cV", 12: "cR"},
        sketch,
    )
    assert payload["status"] == SOLVE_STATUS_OVER
    assert payload["conflictingConstraintIds"] == ["cH", "cV"]
    assert payload["redundantConstraintIds"] == ["cR"]
    # Over-constrained never lists under-constrained entities.
    assert payload["underConstrainedEntityIds"] == []


def test_diagnosis_payload_none_is_neutral_fully() -> None:
    """When diagnose() itself failed (None), report a neutral fully-determined
    payload rather than raising."""
    sketch = Sketch(points=[PointEntity(id="p1", x=0, y=0)])
    payload = _diagnosis_to_payload(None, {}, sketch)
    assert payload["dof"] == 0
    assert payload["status"] == SOLVE_STATUS_FULLY
    assert payload["underConstrainedEntityIds"] == []


# ── Tier 2: full planegcs solve round trip ───────────────────────────────


@requires_planegcs
def test_solve_right_triangle_with_hypotenuse_distance() -> None:
    """A right triangle anchored at the origin with a 30 mm hypotenuse:
    P1 = (0, 0) fixed, P2 free on +x, P3 free on +y. With:
      * bottom edge P1→P2 horizontal,
      * left edge P1→P3 vertical,
      * distance P2→P3 = 30 mm,
    the solver should produce a 30/√2 ≈ 21.213 mm leg length.
    """
    # Initial seed is loose — the solver finds the right configuration.
    payload_sketch = {
        "points": [
            {"id": "p1", "x": 0.0, "y": 0.0, "fixed": True},
            {"id": "p2", "x": 4.0, "y": 1.0},  # roughly on +x
            {"id": "p3", "x": 1.0, "y": 4.0},  # roughly on +y
        ],
        "lines": [
            {"id": "ln_bot", "p1": "p1", "p2": "p2"},
            {"id": "ln_left", "p1": "p1", "p2": "p3"},
        ],
    }
    constraint_payload = [
        {"id": "h", "kind": "horizontal", "line": "ln_bot"},
        {"id": "v", "kind": "vertical", "line": "ln_left"},
        {"id": "d", "kind": "distance", "p1": "p2", "p2": "p3", "distance": 30.0},
    ]

    result = solve_sketch_payload(payload_sketch, constraint_payload)
    assert result["dof"] == 0
    out = result["sketch"]

    # Find the moved points by id (order is preserved but be defensive).
    by_id = {p["id"]: p for p in out["points"]}

    # P1 stays at the anchor.
    assert by_id["p1"]["x"] == pytest.approx(0.0, abs=1e-6)
    assert by_id["p1"]["y"] == pytest.approx(0.0, abs=1e-6)

    # P2 must be on +x (y ≈ 0).
    assert by_id["p2"]["y"] == pytest.approx(0.0, abs=1e-6)
    leg_p2 = by_id["p2"]["x"]
    # P3 must be on +y (x ≈ 0).
    assert by_id["p3"]["x"] == pytest.approx(0.0, abs=1e-6)
    leg_p3 = by_id["p3"]["y"]

    # Each leg should be 30/sqrt(2). The solver is free to mirror the
    # triangle (p2.x could be negative if seeded differently) — check
    # absolute values for robustness.
    expected_leg = 30.0 / math.sqrt(2.0)
    assert abs(leg_p2) == pytest.approx(expected_leg, abs=1e-3)
    assert abs(leg_p3) == pytest.approx(expected_leg, abs=1e-3)

    # The hypotenuse distance ratifies the result.
    hyp = math.hypot(
        by_id["p3"]["x"] - by_id["p2"]["x"],
        by_id["p3"]["y"] - by_id["p2"]["y"],
    )
    assert hyp == pytest.approx(30.0, abs=1e-3)


@requires_planegcs
def test_solve_coincident_pair_collapses_to_one_location() -> None:
    """Two points connected by a coincident constraint must land on the
    same coordinates after the solve. The anchor stays put; the free point
    follows."""
    payload_sketch = {
        "points": [
            {"id": "anchor", "x": 7.0, "y": 4.0, "fixed": True},
            {"id": "free", "x": -2.0, "y": 11.0},
        ],
    }
    constraint_payload = [
        {"id": "co", "kind": "coincident", "p1": "anchor", "p2": "free"}
    ]
    result = solve_sketch_payload(payload_sketch, constraint_payload)
    by_id = {p["id"]: p for p in result["sketch"]["points"]}
    assert by_id["anchor"]["x"] == pytest.approx(7.0, abs=1e-6)
    assert by_id["anchor"]["y"] == pytest.approx(4.0, abs=1e-6)
    assert by_id["free"]["x"] == pytest.approx(7.0, abs=1e-6)
    assert by_id["free"]["y"] == pytest.approx(4.0, abs=1e-6)


@requires_planegcs
def test_solve_over_constrained_returns_structured_error() -> None:
    """A line constrained to be BOTH horizontal AND vertical at the same
    time is over-constrained — planegcs's diagnose() flags the conflicting
    tags and the handler surfaces ``solver_over_constrained``."""
    payload_sketch = {
        "points": [
            {"id": "p1", "x": 0.0, "y": 0.0, "fixed": True},
            {"id": "p2", "x": 5.0, "y": 0.0},
        ],
        "lines": [{"id": "ln", "p1": "p1", "p2": "p2"}],
    }
    constraint_payload = [
        {"id": "h", "kind": "horizontal", "line": "ln"},
        {"id": "v", "kind": "vertical", "line": "ln"},
        {
            "id": "d",
            "kind": "distance",
            "p1": "p1",
            "p2": "p2",
            "distance": 5.0,
        },
    ]
    with pytest.raises(_CadHandlerError) as exc_info:
        solve_sketch_payload(payload_sketch, constraint_payload)
    # Either over-constrained OR a generic solver_failed is acceptable here —
    # planegcs may flag the conflict via diagnose() (over_constrained) OR
    # the solve may diverge first and report failure. Both are valid signals
    # that the sketch is inconsistent; the renderer surfaces both with the
    # same "remove a constraint" hint.
    assert exc_info.value.code in (
        "solver_over_constrained",
        "solver_failed",
    )


# ── Tier 2: DOF / status reporting on the live solve path ─────────────────


@requires_planegcs
def test_solve_payload_success_carries_dof_diagnostics() -> None:
    """A fully-constrained right triangle returns the ADDITIVE diagnostics
    block: dof 0, status 'fully', and empty conflicting/redundant/under id
    arrays — the data the renderer's DOF badge consumes."""
    payload_sketch = {
        "points": [
            {"id": "p1", "x": 0.0, "y": 0.0, "fixed": True},
            {"id": "p2", "x": 4.0, "y": 1.0},
            {"id": "p3", "x": 1.0, "y": 4.0},
        ],
        "lines": [
            {"id": "ln_bot", "p1": "p1", "p2": "p2"},
            {"id": "ln_left", "p1": "p1", "p2": "p3"},
        ],
    }
    constraint_payload = [
        {"id": "h", "kind": "horizontal", "line": "ln_bot"},
        {"id": "v", "kind": "vertical", "line": "ln_left"},
        {"id": "d", "kind": "distance", "p1": "p2", "p2": "p3", "distance": 30.0},
    ]
    result = solve_sketch_payload(payload_sketch, constraint_payload)
    # Backward-compat fields unchanged.
    assert result["dof"] == 0
    assert "sketch" in result
    # ADDITIVE diagnostics present and consistent with a fully-defined sketch.
    assert result["status"] == SOLVE_STATUS_FULLY
    assert result["conflictingConstraintIds"] == []
    assert result["redundantConstraintIds"] == []
    assert result["underConstrainedEntityIds"] == []


@requires_planegcs
def test_solve_under_constrained_attaches_structured_diagnostics() -> None:
    """An under-constrained sketch (a free point with no constraints pinning
    it) still RAISES solver_under_constrained (V1 contract), but the raised
    error now carries the structured ``diagnostics`` payload so a caller can
    drive a DOF badge without re-parsing the message. dof must be > 0 and the
    free point id must appear in underConstrainedEntityIds."""
    payload_sketch = {
        "points": [
            {"id": "anchor", "x": 0.0, "y": 0.0, "fixed": True},
            {"id": "loose", "x": 5.0, "y": 5.0},
        ],
    }
    # No constraint touches ``loose`` -> the system is under-constrained.
    with pytest.raises(_CadHandlerError) as exc_info:
        solve_sketch_payload(payload_sketch, [])
    err = exc_info.value
    assert err.code == "solver_under_constrained"
    diagnostics = getattr(err, "diagnostics", None)
    assert diagnostics is not None, "expected structured diagnostics on the error"
    assert diagnostics["status"] == SOLVE_STATUS_UNDER
    assert diagnostics["dof"] > 0
    assert "loose" in diagnostics["underConstrainedEntityIds"]
    # The anchor is fixed and must NOT be listed as under-constrained.
    assert "anchor" not in diagnostics["underConstrainedEntityIds"]
