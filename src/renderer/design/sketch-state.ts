/**
 * CAD V1 -- 2D sketch editor state (MVP).
 *
 * Pure state module. No React, no DOM, no IPC. Holds the in-progress
 * sketch the user is building inside ``Sketch2DCanvas``:
 *   - ``points``: id -> { x, y, fixed? } map (mm in sketch space).
 *   - ``entities``: points / lines (two endpoint IDs) / circles
 *     (center ID + radius mm) / arcs (start / via / end IDs). Each entity
 *     has a stable ``id`` so the renderer + constraint records can refer
 *     to it.
 *   - ``constraints``: lightweight constraint records (horizontal /
 *     vertical / coincident / distance / radius) the local solver and
 *     the sidecar ``cad.solve_sketch`` round-trip understand.
 *
 * The reducer owns its own undo / redo stack (bounded to 64 past states
 * to keep memory bounded). The reducer is intentionally pure so the
 * tests can exercise every action without a React tree.
 *
 * This module is deliberately decoupled from the heavier ``DesignFileV2``
 * schema in ``src/shared/design-schema.ts`` -- that schema carries the
 * full parametric-modeling state (kernel ops, plane, dimensions). The
 * sketcher MVP only needs the 2D primitives + constraints, and a thin
 * ``sketchToDesign`` adapter (below) converts to / from DesignFileV2 on
 * the IPC boundary or whenever the local ``solveSketch`` solver in
 * ``./solver2d.ts`` is invoked.
 */

import type {
  DesignFileV2,
  SketchConstraint,
  SketchEntity as DesignSketchEntity,
  SketchPoint as DesignSketchPoint
} from '../../shared/design-schema'

// ── Sketch data model ────────────────────────────────────────────────────────

export type SketchPoint = {
  /** Sketch-space coordinates in millimetres (origin = sketch origin). */
  x: number
  y: number
  /** When true, the constraint solver does NOT move this point. */
  fixed?: boolean
}

export type SketchPointEntity = {
  id: string
  kind: 'point'
  pointId: string
}

export type SketchLineEntity = {
  id: string
  kind: 'line'
  /** First endpoint id (must exist in ``points``). */
  startId: string
  /** Second endpoint id (must exist in ``points``). */
  endId: string
}

export type SketchCircleEntity = {
  id: string
  kind: 'circle'
  /** Centre point id (must exist in ``points``). */
  centerId: string
  /** Radius in millimetres (> 0). */
  radius: number
}

export type SketchArcEntity = {
  id: string
  kind: 'arc'
  /** Arc start point id. */
  startId: string
  /** Point on the arc between start and end (defines curvature). */
  viaId: string
  /** Arc end point id. */
  endId: string
}

/**
 * Three-point spline entity (CAD V1.5). Stored as a sequence of point ids;
 * the renderer draws a quadratic Bézier through the first three control
 * points (start, via, end) for the MVP. The point ids participate in the
 * normal constraint solver (coincident / horizontal / etc.) but the curve
 * itself contributes no constraint residual yet -- the displayed curve is
 * a pure derivation of the moved points.
 */
export type SketchSplineEntity = {
  id: string
  kind: 'spline'
  /**
   * Ordered list of control point ids. MVP requires exactly 3 (start /
   * via / end) so the canvas can render a quadratic Bézier; later phases
   * can extend this to N-knot splines once the renderer learns the
   * Catmull-Rom / cubic-bezier paths.
   */
  pointIds: string[]
}

export type SketchEntity =
  | SketchPointEntity
  | SketchLineEntity
  | SketchCircleEntity
  | SketchArcEntity
  | SketchSplineEntity

// ── Constraint data model ────────────────────────────────────────────────────

/** Horizontal: y(a) == y(b). */
export type HorizontalConstraint = {
  id: string
  kind: 'horizontal'
  aId: string
  bId: string
}

/** Vertical: x(a) == x(b). */
export type VerticalConstraint = {
  id: string
  kind: 'vertical'
  aId: string
  bId: string
}

/** Coincident: point a and point b occupy the same coordinates. */
export type CoincidentConstraint = {
  id: string
  kind: 'coincident'
  aId: string
  bId: string
}

/** Distance: |a - b| == value (mm). */
export type DistanceConstraint = {
  id: string
  kind: 'distance'
  aId: string
  bId: string
  value: number
}

/** Radius: circle/arc radius == value (mm). */
export type RadiusConstraint = {
  id: string
  kind: 'radius'
  entityId: string
  value: number
}

/** Parallel: line (a1→b1) parallel to line (a2→b2); 2D cross product → 0. */
export type ParallelConstraint = {
  id: string
  kind: 'parallel'
  a1Id: string
  b1Id: string
  a2Id: string
  b2Id: string
}

/** Perpendicular: line (a1→b1) ⟂ line (a2→b2); dot product → 0. */
export type PerpendicularConstraint = {
  id: string
  kind: 'perpendicular'
  a1Id: string
  b1Id: string
  a2Id: string
  b2Id: string
}

export type Constraint =
  | HorizontalConstraint
  | VerticalConstraint
  | CoincidentConstraint
  | DistanceConstraint
  | RadiusConstraint
  | ParallelConstraint
  | PerpendicularConstraint

// ── State + reducer ──────────────────────────────────────────────────────────

export type Sketch = {
  points: Record<string, SketchPoint>
  entities: SketchEntity[]
  constraints: Constraint[]
}

export type SketchState = {
  sketch: Sketch
  past: Sketch[]
  future: Sketch[]
}

export type SketchAction =
  /** Add a free point (returns id via the produced state's last entity). */
  | { type: 'addPoint'; id?: string; pointId?: string; x: number; y: number; fixed?: boolean }
  /** Add a line; auto-creates start/end points if ids omitted. */
  | {
      type: 'addLine'
      id?: string
      start: { id?: string; x: number; y: number }
      end: { id?: string; x: number; y: number }
    }
  /** Add a circle; auto-creates centre point if id omitted. */
  | {
      type: 'addCircle'
      id?: string
      center: { id?: string; x: number; y: number }
      radius: number
    }
  /** Add an arc (start / via / end); auto-creates points if ids omitted. */
  | {
      type: 'addArc'
      id?: string
      start: { id?: string; x: number; y: number }
      via: { id?: string; x: number; y: number }
      end: { id?: string; x: number; y: number }
    }
  /**
   * Add a three-point spline (control: start / via / end). MVP renders a
   * quadratic Bézier through the moved points.
   */
  | {
      type: 'addSpline'
      id?: string
      start: { id?: string; x: number; y: number }
      via: { id?: string; x: number; y: number }
      end: { id?: string; x: number; y: number }
    }
  | { type: 'addConstraint'; constraint: Constraint }
  /** Remove an entity by id; cascade-removes constraints that reference it. */
  | { type: 'removeEntity'; id: string }
  /** Remove a constraint by id. */
  | { type: 'removeConstraint'; id: string }
  /** Replace the entire point map (used after solver round-trip). */
  | { type: 'mergeSolvedPoints'; points: Record<string, { x: number; y: number; fixed?: boolean }> }
  /** Drop all sketch data; clears undo/redo too. */
  | { type: 'clear' }
  /** Step back one mutation. */
  | { type: 'undo' }
  /** Re-apply the most recently undone mutation. */
  | { type: 'redo' }

const UNDO_LIMIT = 64

/** Build an empty sketch + empty undo stacks. */
export function emptySketch(): Sketch {
  return { points: {}, entities: [], constraints: [] }
}

export function initialSketchState(): SketchState {
  return { sketch: emptySketch(), past: [], future: [] }
}

function generateId(prefix: 'p' | 'e' | 'c'): string {
  // Crypto is available in the renderer; fall back to a monotonic counter
  // when running under a stripped node test runner that lacks ``crypto``.
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}_${globalThis.crypto.randomUUID()}`
  }
  __idCounter += 1
  return `${prefix}_${Date.now().toString(36)}_${__idCounter}`
}

let __idCounter = 0

function cloneSketch(s: Sketch): Sketch {
  const points: Record<string, SketchPoint> = {}
  for (const [k, v] of Object.entries(s.points)) {
    points[k] = { x: v.x, y: v.y, fixed: v.fixed }
  }
  return {
    points,
    entities: s.entities.map((e) => ({ ...e })),
    constraints: s.constraints.map((c) => ({ ...c })) as Constraint[]
  }
}

function pushPast(state: SketchState): SketchState {
  // Snapshot the CURRENT sketch onto ``past`` and clear the redo stack.
  return {
    sketch: state.sketch,
    past: [...state.past, cloneSketch(state.sketch)].slice(-UNDO_LIMIT),
    future: []
  }
}

function ensurePoint(
  points: Record<string, SketchPoint>,
  req: { id?: string; x: number; y: number; fixed?: boolean }
): { id: string; points: Record<string, SketchPoint> } {
  if (req.id && points[req.id]) {
    // Reference an existing point -- leave it untouched.
    return { id: req.id, points }
  }
  const id = req.id ?? generateId('p')
  return {
    id,
    points: { ...points, [id]: { x: req.x, y: req.y, fixed: req.fixed } }
  }
}

/** Predicate: does this constraint reference any of the supplied entity ids? */
function constraintTouchesEntity(c: Constraint, entityIds: ReadonlySet<string>): boolean {
  if (c.kind === 'radius') return entityIds.has(c.entityId)
  return false
}

/** Predicate: does this constraint reference any of the supplied point ids? */
function constraintTouchesPoint(c: Constraint, pointIds: ReadonlySet<string>): boolean {
  if (c.kind === 'horizontal' || c.kind === 'vertical' || c.kind === 'coincident' || c.kind === 'distance') {
    return pointIds.has(c.aId) || pointIds.has(c.bId)
  }
  if (c.kind === 'parallel' || c.kind === 'perpendicular') {
    return (
      pointIds.has(c.a1Id) ||
      pointIds.has(c.b1Id) ||
      pointIds.has(c.a2Id) ||
      pointIds.has(c.b2Id)
    )
  }
  return false
}

function collectEntityPointIds(e: SketchEntity): string[] {
  if (e.kind === 'point') return [e.pointId]
  if (e.kind === 'line') return [e.startId, e.endId]
  if (e.kind === 'circle') return [e.centerId]
  if (e.kind === 'spline') return [...e.pointIds]
  return [e.startId, e.viaId, e.endId]
}

function isPointOrphan(
  pointId: string,
  remainingEntities: SketchEntity[],
  remainingConstraints: Constraint[]
): boolean {
  for (const e of remainingEntities) {
    if (collectEntityPointIds(e).includes(pointId)) return false
  }
  for (const c of remainingConstraints) {
    if (
      (c.kind === 'horizontal' || c.kind === 'vertical' || c.kind === 'coincident' || c.kind === 'distance') &&
      (c.aId === pointId || c.bId === pointId)
    ) {
      return false
    }
    if (
      (c.kind === 'parallel' || c.kind === 'perpendicular') &&
      (c.a1Id === pointId || c.b1Id === pointId || c.a2Id === pointId || c.b2Id === pointId)
    ) {
      return false
    }
  }
  return true
}

/** Pure reducer; never mutates ``state`` in place. */
export function sketchReducer(state: SketchState, action: SketchAction): SketchState {
  switch (action.type) {
    case 'addPoint': {
      const next = pushPast(state)
      const ensured = ensurePoint(next.sketch.points, {
        id: action.pointId,
        x: action.x,
        y: action.y,
        fixed: action.fixed
      })
      const id = action.id ?? generateId('e')
      const entity: SketchPointEntity = { id, kind: 'point', pointId: ensured.id }
      return {
        ...next,
        sketch: {
          ...next.sketch,
          points: ensured.points,
          entities: [...next.sketch.entities, entity]
        }
      }
    }
    case 'addLine': {
      const next = pushPast(state)
      const a = ensurePoint(next.sketch.points, action.start)
      const b = ensurePoint(a.points, action.end)
      const id = action.id ?? generateId('e')
      const entity: SketchLineEntity = { id, kind: 'line', startId: a.id, endId: b.id }
      return {
        ...next,
        sketch: { ...next.sketch, points: b.points, entities: [...next.sketch.entities, entity] }
      }
    }
    case 'addCircle': {
      const next = pushPast(state)
      const c = ensurePoint(next.sketch.points, action.center)
      const id = action.id ?? generateId('e')
      const entity: SketchCircleEntity = { id, kind: 'circle', centerId: c.id, radius: action.radius }
      return {
        ...next,
        sketch: { ...next.sketch, points: c.points, entities: [...next.sketch.entities, entity] }
      }
    }
    case 'addArc': {
      const next = pushPast(state)
      const s = ensurePoint(next.sketch.points, action.start)
      const v = ensurePoint(s.points, action.via)
      const e = ensurePoint(v.points, action.end)
      const id = action.id ?? generateId('e')
      const entity: SketchArcEntity = { id, kind: 'arc', startId: s.id, viaId: v.id, endId: e.id }
      return {
        ...next,
        sketch: { ...next.sketch, points: e.points, entities: [...next.sketch.entities, entity] }
      }
    }
    case 'addSpline': {
      const next = pushPast(state)
      const s = ensurePoint(next.sketch.points, action.start)
      const v = ensurePoint(s.points, action.via)
      const e = ensurePoint(v.points, action.end)
      const id = action.id ?? generateId('e')
      const entity: SketchSplineEntity = {
        id,
        kind: 'spline',
        pointIds: [s.id, v.id, e.id]
      }
      return {
        ...next,
        sketch: { ...next.sketch, points: e.points, entities: [...next.sketch.entities, entity] }
      }
    }
    case 'addConstraint': {
      const next = pushPast(state)
      return {
        ...next,
        sketch: { ...next.sketch, constraints: [...next.sketch.constraints, action.constraint] }
      }
    }
    case 'removeEntity': {
      const target = state.sketch.entities.find((e) => e.id === action.id)
      if (!target) return state
      const next = pushPast(state)
      const remainingEntities = next.sketch.entities.filter((e) => e.id !== action.id)
      const ownedPointIds = new Set(collectEntityPointIds(target))
      // Drop constraints that reference the entity or any of its points
      // when those points are about to disappear.
      const remainingConstraints = next.sketch.constraints.filter((c) => {
        if (constraintTouchesEntity(c, new Set([action.id]))) return false
        // Cascade-drop point-level constraints only when the point becomes orphaned.
        if (
          (c.kind === 'horizontal' || c.kind === 'vertical' || c.kind === 'coincident' || c.kind === 'distance') &&
          (ownedPointIds.has(c.aId) || ownedPointIds.has(c.bId))
        ) {
          const touchedIds = new Set<string>()
          if (ownedPointIds.has(c.aId)) touchedIds.add(c.aId)
          if (ownedPointIds.has(c.bId)) touchedIds.add(c.bId)
          for (const pid of touchedIds) {
            if (
              isPointOrphan(
                pid,
                remainingEntities,
                next.sketch.constraints.filter((other) => other.id !== c.id)
              )
            ) {
              return false
            }
          }
        }
        return true
      })
      // Drop orphaned points (no remaining entity OR constraint reference).
      const remainingPoints: Record<string, SketchPoint> = {}
      for (const [pid, pt] of Object.entries(next.sketch.points)) {
        if (
          !ownedPointIds.has(pid) ||
          !isPointOrphan(pid, remainingEntities, remainingConstraints)
        ) {
          remainingPoints[pid] = pt
        }
      }
      return {
        ...next,
        sketch: {
          points: remainingPoints,
          entities: remainingEntities,
          constraints: remainingConstraints
        }
      }
    }
    case 'removeConstraint': {
      const exists = state.sketch.constraints.some((c) => c.id === action.id)
      if (!exists) return state
      const next = pushPast(state)
      return {
        ...next,
        sketch: {
          ...next.sketch,
          constraints: next.sketch.constraints.filter((c) => c.id !== action.id)
        }
      }
    }
    case 'mergeSolvedPoints': {
      // Only touch already-present points; ignore any extra ids in the
      // solved payload (the sidecar may key by a different scheme).
      const points: Record<string, SketchPoint> = {}
      let changed = false
      for (const [pid, pt] of Object.entries(state.sketch.points)) {
        const solved = action.points[pid]
        if (solved && Number.isFinite(solved.x) && Number.isFinite(solved.y)) {
          if (solved.x !== pt.x || solved.y !== pt.y) changed = true
          points[pid] = { x: solved.x, y: solved.y, fixed: pt.fixed }
        } else {
          points[pid] = pt
        }
      }
      if (!changed) return state
      // Solver merges count as undoable so the user can revert a bad solve.
      const next = pushPast(state)
      return { ...next, sketch: { ...next.sketch, points } }
    }
    case 'clear':
      if (
        state.sketch.entities.length === 0 &&
        state.sketch.constraints.length === 0 &&
        Object.keys(state.sketch.points).length === 0
      ) {
        return state
      }
      return { sketch: emptySketch(), past: [], future: [] }
    case 'undo': {
      if (state.past.length === 0) return state
      const prev = state.past[state.past.length - 1]!
      return {
        sketch: cloneSketch(prev),
        past: state.past.slice(0, -1),
        future: [...state.future, cloneSketch(state.sketch)].slice(-UNDO_LIMIT)
      }
    }
    case 'redo': {
      if (state.future.length === 0) return state
      const next = state.future[state.future.length - 1]!
      return {
        sketch: cloneSketch(next),
        past: [...state.past, cloneSketch(state.sketch)].slice(-UNDO_LIMIT),
        future: state.future.slice(0, -1)
      }
    }
    default: {
      const _exhaustive: never = action
      void _exhaustive
      return state
    }
  }
}

// ── DesignFileV2 adapter (for solver2d / IPC round-trips) ────────────────────

/**
 * Build a minimal ``DesignFileV2`` snapshot from the MVP sketch state so
 * the existing ``solveSketch`` solver in ``./solver2d.ts`` (or the
 * sidecar) can consume it.
 *
 * Mapping rules
 * -------------
 *   - Points map straight through (same shape).
 *   - ``line`` entities become 2-vertex ``polyline`` (open) entities so the
 *     solver's coincident / horizontal / vertical / distance constraints
 *     resolve against the same point ids.
 *   - ``circle`` entities convert with the renderer-side centre point's
 *     coordinates as the circle ``cx`` / ``cy`` (the solver does not move
 *     circle entities directly; constraints act on the centre point).
 *   - ``arc`` entities map to the design-schema ``arc`` (start/via/end ids).
 *   - ``point`` entities are dropped (the solver only needs the point map).
 *   - ``radius`` and ``distance`` constraints inline their numeric value
 *     under an auto-generated parameter key so the solver's
 *     ``parameters[key]`` lookup succeeds.
 */
export function sketchToDesign(sketch: Sketch): DesignFileV2 {
  const points: Record<string, DesignSketchPoint> = {}
  for (const [pid, pt] of Object.entries(sketch.points)) {
    points[pid] = { x: pt.x, y: pt.y, fixed: pt.fixed }
  }
  const entities: DesignSketchEntity[] = []
  for (const e of sketch.entities) {
    if (e.kind === 'line') {
      entities.push({
        id: e.id,
        kind: 'polyline',
        pointIds: [e.startId, e.endId],
        closed: false
      })
    } else if (e.kind === 'circle') {
      const c = sketch.points[e.centerId]
      if (!c) continue
      entities.push({
        id: e.id,
        kind: 'circle',
        cx: c.x,
        cy: c.y,
        r: Math.max(e.radius, 1e-6)
      })
    } else if (e.kind === 'arc') {
      entities.push({ id: e.id, kind: 'arc', startId: e.startId, viaId: e.viaId, endId: e.endId })
    } else if (e.kind === 'spline' && e.pointIds.length >= 3) {
      entities.push({ id: e.id, kind: 'spline_fit', pointIds: [...e.pointIds], closed: false })
    }
    // point entities have no kernel/solver representation -- drop.
  }
  const parameters: Record<string, number> = {}
  const constraints: SketchConstraint[] = []
  for (const c of sketch.constraints) {
    if (c.kind === 'horizontal') {
      constraints.push({ id: c.id, type: 'horizontal', a: { pointId: c.aId }, b: { pointId: c.bId } })
    } else if (c.kind === 'vertical') {
      constraints.push({ id: c.id, type: 'vertical', a: { pointId: c.aId }, b: { pointId: c.bId } })
    } else if (c.kind === 'coincident') {
      constraints.push({ id: c.id, type: 'coincident', a: { pointId: c.aId }, b: { pointId: c.bId } })
    } else if (c.kind === 'distance') {
      const key = `dist_${c.id}`
      parameters[key] = c.value
      constraints.push({
        id: c.id,
        type: 'distance',
        a: { pointId: c.aId },
        b: { pointId: c.bId },
        parameterKey: key
      })
    } else if (c.kind === 'radius') {
      const key = `r_${c.id}`
      parameters[key] = c.value
      constraints.push({ id: c.id, type: 'radius', entityId: c.entityId, parameterKey: key })
    } else if (c.kind === 'parallel') {
      constraints.push({
        id: c.id,
        type: 'parallel',
        a1: { pointId: c.a1Id },
        b1: { pointId: c.b1Id },
        a2: { pointId: c.a2Id },
        b2: { pointId: c.b2Id }
      })
    } else if (c.kind === 'perpendicular') {
      constraints.push({
        id: c.id,
        type: 'perpendicular',
        a1: { pointId: c.a1Id },
        b1: { pointId: c.b1Id },
        a2: { pointId: c.a2Id },
        b2: { pointId: c.b2Id }
      })
    }
  }
  return {
    version: 2,
    extrudeDepthMm: 10,
    solidKind: 'extrude',
    loftSeparationMm: 20,
    revolve: { angleDeg: 360, axisX: 0 },
    parameters,
    points,
    entities,
    constraints,
    dimensions: [],
    sketchPlane: { kind: 'datum', datum: 'XY' }
  }
}

/**
 * Structured solver-failure record. ``over-constrained`` covers the case
 * where the residual report says the energy cannot be driven down (e.g.
 * a closed two-vertex polyline + horizontal + vertical + distance at
 * non-matching values). ``under-constrained`` is a heuristic warning when
 * the sketch has no constraints at all yet a solve was requested.
 */
export type SketchSolveError = {
  kind: 'over-constrained' | 'under-constrained' | 'numerical'
  message: string
  /** Residual magnitude (sum of squared constraint errors) if known. */
  residual?: number
}

export type SketchSolveOutcome =
  | { ok: true; points: Record<string, SketchPoint>; residual?: number }
  | { ok: false; error: SketchSolveError }

/** Threshold under which the solver result is considered converged. */
export const SOLVER_OK_RESIDUAL = 1e-3

/**
 * Categorise a solver result into a typed outcome so the Sketch2DCanvas
 * banner can speak in human terms (over/under-constrained, numerical
 * blow-up) without re-implementing the energy math.
 */
export function categoriseSolveResult(
  before: Sketch,
  solvedPoints: Record<string, { x: number; y: number; fixed?: boolean }>,
  residual: number | undefined
): SketchSolveOutcome {
  if (!Number.isFinite(residual ?? 0)) {
    return {
      ok: false,
      error: {
        kind: 'numerical',
        message: 'Solver returned NaN/Infinity. Reset positions or remove an offending constraint.',
        residual
      }
    }
  }
  if (before.constraints.length === 0) {
    return {
      ok: false,
      error: {
        kind: 'under-constrained',
        message: 'No constraints to solve. Add a horizontal/vertical/coincident/distance/radius constraint.'
      }
    }
  }
  if ((residual ?? 0) > SOLVER_OK_RESIDUAL) {
    return {
      ok: false,
      error: {
        kind: 'over-constrained',
        message: `Solver could not satisfy all constraints (residual ${(residual ?? 0).toExponential(2)}). Remove or relax one.`,
        residual
      }
    }
  }
  const out: Record<string, SketchPoint> = {}
  for (const [pid, pt] of Object.entries(solvedPoints)) {
    out[pid] = { x: pt.x, y: pt.y, fixed: pt.fixed }
  }
  return { ok: true, points: out, residual }
}
