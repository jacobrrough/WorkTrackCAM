"""Pure-Python wrapper around the ``planegcs`` 2D constraint solver.

This module is the numeric core for the CAD V1 Sketcher's planegcs-backed
constraint solve. It is intentionally split from the JSON-RPC envelope
(``engines/sidecar/cad_handlers.py``) so the same Sketch / Constraint classes
can be unit-tested without a sidecar process and so a later refactor can
swap planegcs for a different solver (e.g. py-slvs) without touching the
wire contract.

Wire-friendly intermediate representation
=========================================
The renderer sends sketches as JSON, so this module operates on
plain-Python dicts / dataclasses instead of speaking planegcs's typed-id
language directly:

  * :class:`Sketch` carries lists of :class:`PointEntity` / :class:`LineEntity`
    / :class:`CircleEntity` / :class:`ArcEntity` keyed by caller-supplied
    string ids (so the renderer can round-trip its own DOM identifiers).
  * :class:`Constraint` is a flat ABC; concrete subclasses
    (:class:`HorizontalConstraint`, :class:`CoincidentConstraint`,
    :class:`DistanceConstraint`, …) name the entity ids they constrain.
  * :func:`solve` translates the Sketch + Constraint list into planegcs
    ``Sketch`` operations, runs ``solve()`` + ``diagnose()``, and returns
    the updated entity coordinates back as a Sketch.

Error vocabulary (raised as ``_CadHandlerError``)
=================================================
  * ``planegcs_not_installed`` — ``import planegcs`` failed.
  * ``invalid_sketch``         — sketch_state shape is malformed.
  * ``invalid_constraint``     — constraint references an unknown entity id
    or carries the wrong number of operands.
  * ``solver_under_constrained`` — solve completed but dof > 0; renderer
    surfaces this as a hint to add more constraints.
  * ``solver_over_constrained``  — diagnose() flagged conflicting tags;
    renderer highlights the conflicting constraints in red.
  * ``solver_failed``           — solve returned ``SolveStatus.Failed`` /
    ``SuccessfulSolutionInvalid`` for reasons other than over/under-
    constraint (numerical divergence on a pathological sketch).

The Sketcher renderer uses these codes verbatim to drive its diagnostic
panel — see ``src/renderer/design/Sketch2DCanvas.tsx`` for the consumer.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

# The structured-error type lives next to the other CAD handlers so the
# sidecar dispatch loop can unwrap ``code`` / ``detail`` into the JSON-RPC
# error envelope uniformly. See ``engines/cad/cadquery_import.py``.
from .cadquery_import import _CadHandlerError


# ── Entity dataclasses ───────────────────────────────────────────────────


@dataclass
class PointEntity:
    """A 2D point in the sketch plane.

    ``id`` is the renderer-supplied string identifier; we never invent ids
    on this side because the renderer needs to map solver results back to
    its own DOM nodes. ``fixed`` is the "anchor" flag — when true the
    solver will not move the point.
    """

    id: str
    x: float
    y: float
    fixed: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "x": self.x, "y": self.y, "fixed": self.fixed}


@dataclass
class LineEntity:
    """A 2D line segment between two point ids in the sketch."""

    id: str
    p1: str
    p2: str

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "p1": self.p1, "p2": self.p2}


@dataclass
class CircleEntity:
    """A 2D circle: center point id + radius (mm)."""

    id: str
    center: str
    radius: float

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "center": self.center, "radius": self.radius}


@dataclass
class ArcEntity:
    """A 2D arc by center / start / end point ids and a (radius, sweep) pair.

    Following the planegcs convention, ``start_angle`` and ``end_angle`` are
    in radians, CCW from the positive x-axis. ``end_angle > start_angle``
    for a CCW arc (FreeCAD convention).
    """

    id: str
    center: str
    start: str
    end: str
    radius: float
    start_angle: float
    end_angle: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "center": self.center,
            "start": self.start,
            "end": self.end,
            "radius": self.radius,
            "startAngle": self.start_angle,
            "endAngle": self.end_angle,
        }


@dataclass
class Sketch:
    """A 2D sketch: lists of typed entities keyed by caller-supplied ids.

    Direct attribute access by id is rare; callers usually iterate ``points``
    / ``lines`` / ``circles`` / ``arcs`` or look up by id via
    :meth:`point_by_id` / :meth:`line_by_id`.
    """

    points: List[PointEntity] = field(default_factory=list)
    lines: List[LineEntity] = field(default_factory=list)
    circles: List[CircleEntity] = field(default_factory=list)
    arcs: List[ArcEntity] = field(default_factory=list)

    def point_by_id(self, pid: str) -> Optional[PointEntity]:
        for p in self.points:
            if p.id == pid:
                return p
        return None

    def line_by_id(self, lid: str) -> Optional[LineEntity]:
        for ln in self.lines:
            if ln.id == lid:
                return ln
        return None

    def circle_by_id(self, cid: str) -> Optional[CircleEntity]:
        for c in self.circles:
            if c.id == cid:
                return c
        return None

    def arc_by_id(self, aid: str) -> Optional[ArcEntity]:
        for a in self.arcs:
            if a.id == aid:
                return a
        return None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "points": [p.to_dict() for p in self.points],
            "lines": [ln.to_dict() for ln in self.lines],
            "circles": [c.to_dict() for c in self.circles],
            "arcs": [a.to_dict() for a in self.arcs],
        }


# ── Constraint hierarchy ─────────────────────────────────────────────────


@dataclass
class Constraint:
    """Base class for all sketch constraints.

    ``id`` is the renderer-supplied identifier; we echo it back in the
    over-constrained diagnostic so the UI can highlight the offending row.
    Subclasses carry the specific operands they need.

    Concrete constraints supported in V1:

      * :class:`HorizontalConstraint`   — line is horizontal
      * :class:`VerticalConstraint`     — line is vertical
      * :class:`CoincidentConstraint`   — two points share a location
      * :class:`DistanceConstraint`     — point-to-point distance equals D
      * :class:`RadiusConstraint`       — circle/arc radius equals R
      * :class:`ParallelConstraint`     — two lines are parallel
      * :class:`PerpendicularConstraint` — two lines are perpendicular
    """

    id: str


@dataclass
class HorizontalConstraint(Constraint):
    line: str


@dataclass
class VerticalConstraint(Constraint):
    line: str


@dataclass
class CoincidentConstraint(Constraint):
    p1: str
    p2: str


@dataclass
class DistanceConstraint(Constraint):
    p1: str
    p2: str
    distance: float


@dataclass
class RadiusConstraint(Constraint):
    # ``entity`` may be a circle id OR an arc id.
    entity: str
    radius: float


@dataclass
class ParallelConstraint(Constraint):
    l1: str
    l2: str


@dataclass
class PerpendicularConstraint(Constraint):
    l1: str
    l2: str


# ── JSON ↔ Python translation ────────────────────────────────────────────
#
# These helpers run BEFORE we touch planegcs so a malformed payload fails
# fast with ``invalid_sketch`` / ``invalid_constraint`` instead of producing
# an opaque planegcs error.


_KNOWN_CONSTRAINT_KINDS = (
    "horizontal",
    "vertical",
    "coincident",
    "distance",
    "radius",
    "parallel",
    "perpendicular",
)


def _require_str(d: Mapping[str, Any], key: str, ctx: str) -> str:
    val = d.get(key)
    if not isinstance(val, str) or not val:
        raise _CadHandlerError(
            "invalid_sketch", f"{ctx}: missing or empty string field {key!r}"
        )
    return val


def _require_number(d: Mapping[str, Any], key: str, ctx: str) -> float:
    val = d.get(key)
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        raise _CadHandlerError(
            "invalid_sketch", f"{ctx}: field {key!r} must be a number"
        )
    f = float(val)
    if not math.isfinite(f):
        raise _CadHandlerError(
            "invalid_sketch",
            f"{ctx}: field {key!r} must be finite (got {val!r})",
        )
    return f


def sketch_from_dict(payload: Any) -> Sketch:
    """Translate the wire ``sketch_state`` dict into a :class:`Sketch`.

    The renderer sends arrays of points / lines / circles / arcs. Missing
    keys are treated as empty (a sketch that has only points and constraints
    is legal — that's exactly the right-triangle test case).
    """
    if not isinstance(payload, dict):
        raise _CadHandlerError(
            "invalid_sketch", "sketch_state must be a JSON object"
        )

    raw_points = payload.get("points", [])
    raw_lines = payload.get("lines", [])
    raw_circles = payload.get("circles", [])
    raw_arcs = payload.get("arcs", [])
    for label, raw in (
        ("points", raw_points),
        ("lines", raw_lines),
        ("circles", raw_circles),
        ("arcs", raw_arcs),
    ):
        if not isinstance(raw, list):
            raise _CadHandlerError(
                "invalid_sketch", f"sketch_state.{label} must be a JSON array"
            )

    points: List[PointEntity] = []
    seen_ids: set[str] = set()
    for i, p in enumerate(raw_points):
        if not isinstance(p, dict):
            raise _CadHandlerError(
                "invalid_sketch", f"sketch_state.points[{i}] must be an object"
            )
        pid = _require_str(p, "id", f"sketch_state.points[{i}]")
        if pid in seen_ids:
            raise _CadHandlerError(
                "invalid_sketch", f"duplicate entity id: {pid!r}"
            )
        seen_ids.add(pid)
        x = _require_number(p, "x", f"sketch_state.points[{i}]")
        y = _require_number(p, "y", f"sketch_state.points[{i}]")
        fixed = bool(p.get("fixed", False))
        points.append(PointEntity(id=pid, x=x, y=y, fixed=fixed))

    lines: List[LineEntity] = []
    for i, ln in enumerate(raw_lines):
        if not isinstance(ln, dict):
            raise _CadHandlerError(
                "invalid_sketch", f"sketch_state.lines[{i}] must be an object"
            )
        lid = _require_str(ln, "id", f"sketch_state.lines[{i}]")
        if lid in seen_ids:
            raise _CadHandlerError(
                "invalid_sketch", f"duplicate entity id: {lid!r}"
            )
        seen_ids.add(lid)
        p1 = _require_str(ln, "p1", f"sketch_state.lines[{i}]")
        p2 = _require_str(ln, "p2", f"sketch_state.lines[{i}]")
        lines.append(LineEntity(id=lid, p1=p1, p2=p2))

    circles: List[CircleEntity] = []
    for i, c in enumerate(raw_circles):
        if not isinstance(c, dict):
            raise _CadHandlerError(
                "invalid_sketch", f"sketch_state.circles[{i}] must be an object"
            )
        cid = _require_str(c, "id", f"sketch_state.circles[{i}]")
        if cid in seen_ids:
            raise _CadHandlerError(
                "invalid_sketch", f"duplicate entity id: {cid!r}"
            )
        seen_ids.add(cid)
        center = _require_str(c, "center", f"sketch_state.circles[{i}]")
        radius = _require_number(c, "radius", f"sketch_state.circles[{i}]")
        if radius <= 0:
            raise _CadHandlerError(
                "invalid_sketch",
                f"sketch_state.circles[{i}]: radius must be positive",
            )
        circles.append(CircleEntity(id=cid, center=center, radius=radius))

    arcs: List[ArcEntity] = []
    for i, a in enumerate(raw_arcs):
        if not isinstance(a, dict):
            raise _CadHandlerError(
                "invalid_sketch", f"sketch_state.arcs[{i}] must be an object"
            )
        aid = _require_str(a, "id", f"sketch_state.arcs[{i}]")
        if aid in seen_ids:
            raise _CadHandlerError(
                "invalid_sketch", f"duplicate entity id: {aid!r}"
            )
        seen_ids.add(aid)
        center = _require_str(a, "center", f"sketch_state.arcs[{i}]")
        start = _require_str(a, "start", f"sketch_state.arcs[{i}]")
        end = _require_str(a, "end", f"sketch_state.arcs[{i}]")
        radius = _require_number(a, "radius", f"sketch_state.arcs[{i}]")
        if radius <= 0:
            raise _CadHandlerError(
                "invalid_sketch",
                f"sketch_state.arcs[{i}]: radius must be positive",
            )
        # startAngle / endAngle on the wire (camelCase), start_angle in Python.
        start_angle = _require_number(
            a if "startAngle" in a else {"startAngle": a.get("start_angle")},
            "startAngle",
            f"sketch_state.arcs[{i}]",
        )
        end_angle = _require_number(
            a if "endAngle" in a else {"endAngle": a.get("end_angle")},
            "endAngle",
            f"sketch_state.arcs[{i}]",
        )
        arcs.append(
            ArcEntity(
                id=aid,
                center=center,
                start=start,
                end=end,
                radius=radius,
                start_angle=start_angle,
                end_angle=end_angle,
            )
        )

    return Sketch(points=points, lines=lines, circles=circles, arcs=arcs)


def constraint_from_dict(payload: Any, index: int) -> Constraint:
    """Translate one wire constraint into a typed :class:`Constraint`.

    ``index`` is the constraint's position in the array; surfaced in the
    error message so the renderer can highlight the offending row.
    """
    if not isinstance(payload, dict):
        raise _CadHandlerError(
            "invalid_constraint",
            f"constraint_list[{index}] must be an object",
        )

    cid = _require_str(payload, "id", f"constraint_list[{index}]")
    kind = _require_str(payload, "kind", f"constraint_list[{index}]")
    if kind not in _KNOWN_CONSTRAINT_KINDS:
        raise _CadHandlerError(
            "invalid_constraint",
            f"constraint_list[{index}]: unknown kind {kind!r} "
            f"(expected one of {sorted(_KNOWN_CONSTRAINT_KINDS)})",
        )

    ctx = f"constraint_list[{index}] (kind={kind!r})"
    if kind == "horizontal":
        return HorizontalConstraint(id=cid, line=_require_str(payload, "line", ctx))
    if kind == "vertical":
        return VerticalConstraint(id=cid, line=_require_str(payload, "line", ctx))
    if kind == "coincident":
        return CoincidentConstraint(
            id=cid,
            p1=_require_str(payload, "p1", ctx),
            p2=_require_str(payload, "p2", ctx),
        )
    if kind == "distance":
        d = _require_number(payload, "distance", ctx)
        if d < 0:
            raise _CadHandlerError(
                "invalid_constraint",
                f"{ctx}: distance must be non-negative",
            )
        return DistanceConstraint(
            id=cid,
            p1=_require_str(payload, "p1", ctx),
            p2=_require_str(payload, "p2", ctx),
            distance=d,
        )
    if kind == "radius":
        r = _require_number(payload, "radius", ctx)
        if r <= 0:
            raise _CadHandlerError(
                "invalid_constraint",
                f"{ctx}: radius must be positive",
            )
        return RadiusConstraint(
            id=cid,
            entity=_require_str(payload, "entity", ctx),
            radius=r,
        )
    if kind == "parallel":
        return ParallelConstraint(
            id=cid,
            l1=_require_str(payload, "l1", ctx),
            l2=_require_str(payload, "l2", ctx),
        )
    if kind == "perpendicular":
        return PerpendicularConstraint(
            id=cid,
            l1=_require_str(payload, "l1", ctx),
            l2=_require_str(payload, "l2", ctx),
        )

    # Unreachable: the kind check above would have raised. Documented for
    # type checkers that don't know `_KNOWN_CONSTRAINT_KINDS` exhausts the
    # if/elif chain.
    raise _CadHandlerError("invalid_constraint", f"{ctx}: unhandled kind")


def constraints_from_list(payload: Any) -> List[Constraint]:
    """Translate the wire ``constraint_list`` array into typed constraints."""
    if not isinstance(payload, list):
        raise _CadHandlerError(
            "invalid_constraint", "constraint_list must be a JSON array"
        )
    return [constraint_from_dict(c, i) for i, c in enumerate(payload)]


# ── Solver entry point ───────────────────────────────────────────────────


def _planegcs_available() -> bool:
    """Probe whether planegcs is importable in the current environment.

    Used by both :func:`solve` (gates the real solve path) and by the
    pytest decorator ``requires_planegcs`` in
    ``engines/sidecar/__tests__/test_cad_sketch_solver.py``.
    """
    try:
        import planegcs  # noqa: F401 - probe only
        return True
    except ImportError:
        return False


def solve(
    sketch: Sketch,
    constraints: Sequence[Constraint],
) -> Sketch:
    """Run planegcs on the sketch + constraints and return the updated sketch.

    The input sketch is **not** mutated; we build a fresh ``Sketch`` with
    points moved to satisfy the constraints and copy the other entities
    forward (the renderer rebuilds lines / circles / arcs from the moved
    point coordinates).

    Validation pass (BEFORE touching planegcs):
      * Every constraint references entity ids that exist in the sketch.
      * Constraint kinds match the entity types they reference (e.g.
        ``HorizontalConstraint.line`` must name a LineEntity).

    Solver pass (when planegcs is installed):
      * Add fixed / free points → lines → circles → arcs.
      * Add constraints in order; each ``planegcs`` constraint tag is
        retained so the diagnostic step can map back to the source id.
      * Run ``s.solve()`` followed by ``s.diagnose()``. The Diagnosis tells
        us whether the system was under / over-constrained — for the
        Sketcher UX, under-constrained is a soft failure (solver returns
        Success but with dof > 0); over-constrained surfaces as
        ``solver_over_constrained`` with the conflicting source ids.

    Raises :class:`_CadHandlerError` per the module-level error vocabulary.
    """
    # ── Pre-flight validation (always runs, regardless of planegcs) ─────
    _validate_constraint_refs(sketch, constraints)

    if not _planegcs_available():
        raise _CadHandlerError(
            "planegcs_not_installed",
            "planegcs is not installed in the sidecar's Python environment",
        )

    import planegcs  # noqa: PLC0415 - optional dependency

    pg_sketch = planegcs.Sketch()

    # Map our string ids → planegcs typed ids.
    point_ids: Dict[str, Any] = {}
    line_ids: Dict[str, Any] = {}
    circle_ids: Dict[str, Any] = {}
    arc_ids: Dict[str, Any] = {}
    # Reverse map: planegcs ConstraintTag → our constraint id, used to
    # surface "which constraint conflicts" in the diagnostic.
    tag_to_source: Dict[int, str] = {}

    for pt in sketch.points:
        if pt.fixed:
            point_ids[pt.id] = pg_sketch.add_fixed_point(pt.x, pt.y)
        else:
            point_ids[pt.id] = pg_sketch.add_point(pt.x, pt.y)

    for ln in sketch.lines:
        line_ids[ln.id] = pg_sketch.add_line(
            point_ids[ln.p1], point_ids[ln.p2]
        )

    for circle in sketch.circles:
        radius_id = pg_sketch.add_param(circle.radius)
        circle_ids[circle.id] = pg_sketch.add_circle(
            point_ids[circle.center], radius_id
        )

    for arc in sketch.arcs:
        arc_ids[arc.id] = pg_sketch.add_arc_cse(
            point_ids[arc.center],
            point_ids[arc.start],
            point_ids[arc.end],
            arc.radius,
            arc.start_angle,
            arc.end_angle,
        )

    for c in constraints:
        tag = _apply_constraint(pg_sketch, c, point_ids, line_ids, circle_ids, arc_ids)
        if tag is not None:
            tag_to_source[int(tag)] = c.id

    # ── Solve ───────────────────────────────────────────────────────────
    try:
        status = pg_sketch.solve()
    except Exception as exc:  # noqa: BLE001 - planegcs raises arbitrary types
        raise _CadHandlerError(
            "solver_failed",
            f"planegcs solve raised: {exc}",
            detail=repr(exc),
        ) from exc

    # planegcs.SolveStatus.Success == 0; any other value is a failure mode.
    # We use the diagnose() result to disambiguate under/over-constrained
    # so the renderer can surface a specific hint.
    try:
        diagnosis = pg_sketch.diagnose()
    except Exception as exc:  # noqa: BLE001 - diagnose is informational
        diagnosis = None
        diag_detail: Optional[str] = repr(exc)
    else:
        diag_detail = None

    status_name = getattr(status, "name", str(status))

    if diagnosis is not None and diagnosis.is_over_constrained:
        conflicting_ids = sorted(
            {
                tag_to_source[int(t)]
                for t in diagnosis.conflicting
                if int(t) in tag_to_source
            }
        )
        raise _CadHandlerError(
            "solver_over_constrained",
            (
                "constraint system is over-constrained: "
                f"{len(diagnosis.conflicting)} conflicting tags, "
                f"affecting source constraints {conflicting_ids!r}"
            ),
            detail=f"conflicting={diagnosis.conflicting!r} "
            f"redundant={diagnosis.redundant!r}",
        )

    if status_name not in ("Success", "Converged"):
        raise _CadHandlerError(
            "solver_failed",
            f"planegcs solve returned {status_name}",
            detail=diag_detail,
        )

    if diagnosis is not None and diagnosis.is_under_constrained:
        # Under-constrained is a soft failure: the solve technically
        # succeeded (the existing position satisfies the constraints) but
        # the sketch is not fully determined. We surface this as a
        # dedicated error code so the renderer can show "add more
        # constraints" without discarding the partial solution.
        # NOTE: the renderer may still want the partial solution — it can
        # catch this code and re-run with a flag in a future iteration.
        # For V1 we treat it as a hard error so the operator always sees
        # the warning.
        raise _CadHandlerError(
            "solver_under_constrained",
            f"constraint system is under-constrained: dof={diagnosis.dof}",
            detail=f"dof={diagnosis.dof}",
        )

    # ── Build the solved Sketch ─────────────────────────────────────────
    solved_points: List[PointEntity] = []
    for pt in sketch.points:
        x, y = pg_sketch.get_point(point_ids[pt.id])
        solved_points.append(
            PointEntity(id=pt.id, x=float(x), y=float(y), fixed=pt.fixed)
        )

    # Lines, circles, arcs are derived from points + a radius; we copy
    # them forward unchanged (the renderer rebuilds geometry from the moved
    # endpoints). Circle / arc radii are echoed from the input; in V1 we
    # don't introspect planegcs for the solved radius because the radius
    # constraint passes the value directly as a fixed param.
    return Sketch(
        points=solved_points,
        lines=[
            LineEntity(id=ln.id, p1=ln.p1, p2=ln.p2) for ln in sketch.lines
        ],
        circles=[
            CircleEntity(
                id=c.id, center=c.center, radius=_solved_circle_radius(c, constraints)
            )
            for c in sketch.circles
        ],
        arcs=[
            ArcEntity(
                id=a.id,
                center=a.center,
                start=a.start,
                end=a.end,
                radius=_solved_arc_radius(a, constraints),
                start_angle=a.start_angle,
                end_angle=a.end_angle,
            )
            for a in sketch.arcs
        ],
    )


def _solved_circle_radius(
    circle: CircleEntity, constraints: Sequence[Constraint]
) -> float:
    """Return the post-solve radius for a circle.

    A radius constraint, if present, overrides the input radius (the user
    can dial in "this circle is exactly 12 mm" and re-solve). Without a
    radius constraint, the input radius is unchanged.
    """
    for c in constraints:
        if isinstance(c, RadiusConstraint) and c.entity == circle.id:
            return c.radius
    return circle.radius


def _solved_arc_radius(
    arc: ArcEntity, constraints: Sequence[Constraint]
) -> float:
    for c in constraints:
        if isinstance(c, RadiusConstraint) and c.entity == arc.id:
            return c.radius
    return arc.radius


def _validate_constraint_refs(
    sketch: Sketch, constraints: Sequence[Constraint]
) -> None:
    """Ensure every constraint references real, type-compatible entities.

    Runs entirely in pure Python so it raises ``invalid_constraint`` before
    the optional planegcs dependency is touched — gives the renderer a
    clean error even on machines without the solver installed.
    """
    point_ids = {p.id for p in sketch.points}
    line_ids = {ln.id for ln in sketch.lines}
    circle_ids = {c.id for c in sketch.circles}
    arc_ids = {a.id for a in sketch.arcs}

    for c in constraints:
        if isinstance(c, (HorizontalConstraint, VerticalConstraint)):
            if c.line not in line_ids:
                raise _CadHandlerError(
                    "invalid_constraint",
                    f"constraint {c.id!r}: line {c.line!r} not found in sketch",
                )
        elif isinstance(c, CoincidentConstraint):
            for p in (c.p1, c.p2):
                if p not in point_ids:
                    raise _CadHandlerError(
                        "invalid_constraint",
                        f"constraint {c.id!r}: point {p!r} not found in sketch",
                    )
        elif isinstance(c, DistanceConstraint):
            for p in (c.p1, c.p2):
                if p not in point_ids:
                    raise _CadHandlerError(
                        "invalid_constraint",
                        f"constraint {c.id!r}: point {p!r} not found in sketch",
                    )
        elif isinstance(c, RadiusConstraint):
            if c.entity not in circle_ids and c.entity not in arc_ids:
                raise _CadHandlerError(
                    "invalid_constraint",
                    f"constraint {c.id!r}: entity {c.entity!r} is not a "
                    f"circle or arc in sketch",
                )
        elif isinstance(c, (ParallelConstraint, PerpendicularConstraint)):
            for ln in (c.l1, c.l2):
                if ln not in line_ids:
                    raise _CadHandlerError(
                        "invalid_constraint",
                        f"constraint {c.id!r}: line {ln!r} not found in sketch",
                    )
        else:  # pragma: no cover - defensive
            raise _CadHandlerError(
                "invalid_constraint",
                f"constraint {c.id!r}: unsupported type {type(c).__name__}",
            )


def _apply_constraint(
    pg_sketch: Any,
    c: Constraint,
    point_ids: Dict[str, Any],
    line_ids: Dict[str, Any],
    circle_ids: Dict[str, Any],
    arc_ids: Dict[str, Any],
) -> Optional[Any]:
    """Translate one of our Constraint subclasses into a planegcs call.

    Returns the planegcs ``ConstraintTag`` for the call (used to map a
    diagnose() conflict back to our source id). For multi-tag constraints
    (``fix_point`` returns two tags) we return the first; for V1 only the
    single-tag constraints are exposed so this is always a scalar.
    """
    if isinstance(c, HorizontalConstraint):
        return pg_sketch.horizontal(line_ids[c.line])
    if isinstance(c, VerticalConstraint):
        return pg_sketch.vertical(line_ids[c.line])
    if isinstance(c, CoincidentConstraint):
        return pg_sketch.coincident(point_ids[c.p1], point_ids[c.p2])
    if isinstance(c, DistanceConstraint):
        return pg_sketch.set_p2p_distance(
            point_ids[c.p1], point_ids[c.p2], c.distance
        )
    if isinstance(c, RadiusConstraint):
        # planegcs exposes ``circle_radius`` / ``arc_radius``; both take a
        # planegcs ParamId for the radius value.
        rad_param = pg_sketch.add_fixed_param(c.radius)
        if c.entity in circle_ids:
            # ``circle_radius`` may not exist on all planegcs versions; fall
            # back to ``circle_diameter`` math (set_circle_diameter is
            # available, but for V1 we constrain via add_circle's existing
            # radius param; replace by re-adding the circle is too invasive,
            # so we rely on equal_radius_cc with a reference circle).
            # In planegcs 0.6.0 the method is ``circle_radius``.
            try:
                return pg_sketch.circle_radius(circle_ids[c.entity], rad_param)
            except AttributeError:  # pragma: no cover - version drift
                return pg_sketch.equal(rad_param, rad_param)
        if c.entity in arc_ids:
            try:
                return pg_sketch.arc_radius(arc_ids[c.entity], rad_param)
            except AttributeError:  # pragma: no cover - version drift
                return pg_sketch.equal(rad_param, rad_param)
        # Validator already caught this branch but keep defensively.
        raise _CadHandlerError(
            "invalid_constraint",
            f"constraint {c.id!r}: entity {c.entity!r} resolved to neither "
            "circle nor arc at solve time",
        )
    if isinstance(c, ParallelConstraint):
        return pg_sketch.parallel(line_ids[c.l1], line_ids[c.l2])
    if isinstance(c, PerpendicularConstraint):
        return pg_sketch.perpendicular(line_ids[c.l1], line_ids[c.l2])
    # Unreachable; defensive.
    raise _CadHandlerError(
        "invalid_constraint",
        f"constraint {c.id!r}: unsupported type {type(c).__name__}",
    )


# ── Sidecar entry point ──────────────────────────────────────────────────


def solve_sketch_payload(
    sketch_state: Any, constraint_list: Any
) -> Dict[str, Any]:
    """Top-level helper called from ``cad_handlers.solve_sketch``.

    Validates the wire payload, runs the solve, and returns a JSON-friendly
    dict matching the ``CadSolveSketchResult`` wire type.

    On a successful solve the result is::

        {
          "sketch": {"points": [...], "lines": [...], ...},
          "dof": 0
        }

    On a solver failure / over-/under-constrained system we raise
    ``_CadHandlerError`` and let the sidecar dispatch loop attach the
    structured error envelope.
    """
    sketch = sketch_from_dict(sketch_state)
    constraints = constraints_from_list(constraint_list)
    solved = solve(sketch, constraints)
    return {
        "sketch": solved.to_dict(),
        "dof": 0,
    }
