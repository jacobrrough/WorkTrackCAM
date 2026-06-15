/**
 * Pure driving-dimension engine + solver coupling (Sketch S4).
 *
 * Dimensions in the v2 sketch schema are ANNOTATION by default. This module is
 * the bridge that turns an annotation placement into a *driving* dimension: it
 * binds a `SketchDimension` to a numeric `parameters[key]` AND to the matching
 * solver constraint that reads that same key, so retyping the value re-solves
 * the geometry.
 *
 * Everything here is framework-agnostic and DOM-free. The UI layer
 * (Sketch2DCanvas / SketchSurface) CALLS these three functions:
 *
 *   measureDimensionValue(design, intent)            -> the current measured value (mm or deg)
 *   createDrivingDimension(design, intent, opts?)    -> add dim + param + constraint (no geometry move)
 *   applyDimensionValue(design, dimensionId, value)  -> set param + re-solve
 *
 * Design invariants
 * -----------------
 *  - PURE: inputs are never mutated. `createDrivingDimension` / `applyDimensionValue`
 *    deep-clone via `cloneDesign` before touching anything.
 *  - NON-MOVING CREATE: a freshly created driving dimension stores the CURRENTLY
 *    MEASURED value, so the new constraint is already satisfied — creating it does
 *    not move geometry. Only EDITING the value moves geometry.
 *  - MEASUREMENT PARITY: the measured value matches both what `sketch2d-draw.ts`
 *    renders and what `solver2d.ts` minimises:
 *      linear|aligned -> Euclidean |a-b|
 *      radial         -> circle radius (arc: fit radius through start/via/end)
 *      diameter       -> 2 * radius
 *      angular        -> unsigned angle in degrees, acos(clamp(cos θ)) ∈ [0,180]
 *        (the solver's `angle` term minimises (cos meas − cos target)², so the
 *         unsigned cosine angle is the value that round-trips cleanly).
 *  - DETERMINISTIC IDS: new parameter/dimension/constraint ids are derived by
 *    scanning existing ids and picking the first free slot — no randomness, so
 *    the functions stay pure and the tests are stable.
 */

import type {
  DesignFileV2,
  SketchConstraint,
  SketchDimension,
  SketchEntity
} from '../../shared/design-schema'
import { circleThroughThreePoints } from '../../shared/sketch-profile'
import { cloneDesign, solveSketch } from './solver2d'

// ---------------------------------------------------------------------------
// Placement intent — the interface the UI agent constructs and hands us.
// ---------------------------------------------------------------------------

/**
 * What the operator is trying to dimension. Mirrors the placement kinds the UI
 * supports; `createDrivingDimension` turns it into the matching `SketchDimension`
 * + driving `SketchConstraint` pair.
 *
 *  - linear | aligned -> two shared points (Euclidean distance).
 *  - radial | diameter -> one circle/arc entity.
 *  - angular -> two lines, each given as a point pair (a→b).
 */
export type DimensionIntent =
  | { kind: 'linear'; aId: string; bId: string }
  | { kind: 'aligned'; aId: string; bId: string }
  | { kind: 'radial'; entityId: string }
  | { kind: 'diameter'; entityId: string }
  | { kind: 'angular'; a1Id: string; b1Id: string; a2Id: string; b2Id: string }

/** Result of a successful `createDrivingDimension`. */
export type CreateDrivingDimensionResult = {
  /** New design (input is never mutated). */
  readonly design: DesignFileV2
  /** Id of the newly added `SketchDimension`. */
  readonly dimensionId: string
  /** Parameter key the new dimension + constraint both read. */
  readonly parameterKey: string
}

const LEN_EPS = 1e-9

// ---------------------------------------------------------------------------
// Geometry helpers (read-only).
// ---------------------------------------------------------------------------

function pointXY(design: DesignFileV2, id: string): { x: number; y: number } | null {
  const p = design.points[id]
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
  return { x: p.x, y: p.y }
}

function findEntity(design: DesignFileV2, entityId: string): SketchEntity | undefined {
  return design.entities.find((e) => e.id === entityId)
}

/**
 * Radius of a circle or arc entity, or `null` when the entity is missing or is
 * not a circle/arc (e.g. a polyline, slot, ellipse — those have no single
 * radius the radial/diameter solver constraints can drive).
 *
 * Matches `solver2d.arcCircleFromEntity`: circle reads `r` directly; arc fits a
 * circle through its start/via/end points, which is exactly the geometry the
 * `radius`/`diameter` constraint residual is computed against.
 */
function entityRadius(design: DesignFileV2, entityId: string): number | null {
  const ent = findEntity(design, entityId)
  if (!ent) return null
  if (ent.kind === 'circle') {
    return Number.isFinite(ent.r) && ent.r > 0 ? ent.r : null
  }
  if (ent.kind !== 'arc') return null
  const s = pointXY(design, ent.startId)
  const v = pointXY(design, ent.viaId)
  const e = pointXY(design, ent.endId)
  if (!s || !v || !e) return null
  const circ = circleThroughThreePoints(s.x, s.y, v.x, v.y, e.x, e.y)
  if (!circ || !(circ.r > 0)) return null
  return circ.r
}

/** Unsigned angle between line (a1→b1) and (a2→b2) in degrees, or `null` if degenerate. */
function lineAngleDeg(
  design: DesignFileV2,
  a1Id: string,
  b1Id: string,
  a2Id: string,
  b2Id: string
): number | null {
  const a1 = pointXY(design, a1Id)
  const b1 = pointXY(design, b1Id)
  const a2 = pointXY(design, a2Id)
  const b2 = pointXY(design, b2Id)
  if (!a1 || !b1 || !a2 || !b2) return null
  const v1x = b1.x - a1.x
  const v1y = b1.y - a1.y
  const v2x = b2.x - a2.x
  const v2y = b2.y - a2.y
  const l1 = Math.hypot(v1x, v1y)
  const l2 = Math.hypot(v2x, v2y)
  if (l1 < LEN_EPS || l2 < LEN_EPS) return null
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)))
  return (Math.acos(cos) * 180) / Math.PI
}

// ---------------------------------------------------------------------------
// 1. measureDimensionValue
// ---------------------------------------------------------------------------

/**
 * Current measured value for a placement intent:
 *   linear | aligned -> Euclidean |a-b| (mm)
 *   radial           -> circle/arc radius (mm); `null` if the entity isn't a circle/arc
 *   diameter         -> 2 * radius (mm);       `null` if the entity isn't a circle/arc
 *   angular          -> unsigned angle between the two lines (degrees)
 *
 * Returns `null` when any referenced point/entity is missing or the geometry is
 * degenerate (zero-length line, collinear arc, coincident angle legs).
 */
export function measureDimensionValue(design: DesignFileV2, intent: DimensionIntent): number | null {
  switch (intent.kind) {
    case 'linear':
    case 'aligned': {
      const a = pointXY(design, intent.aId)
      const b = pointXY(design, intent.bId)
      if (!a || !b) return null
      return Math.hypot(b.x - a.x, b.y - a.y)
    }
    case 'radial': {
      return entityRadius(design, intent.entityId)
    }
    case 'diameter': {
      const r = entityRadius(design, intent.entityId)
      return r == null ? null : r * 2
    }
    case 'angular': {
      return lineAngleDeg(design, intent.a1Id, intent.b1Id, intent.a2Id, intent.b2Id)
    }
    default: {
      const _exhaustive: never = intent
      void _exhaustive
      return null
    }
  }
}

// ---------------------------------------------------------------------------
// Unique-id derivation (deterministic; scans existing namespaces).
// ---------------------------------------------------------------------------

/** First `${prefix}${n}` (n ≥ 1) not present in `taken`. */
function freeSequencedId(prefix: string, taken: ReadonlySet<string>): string {
  let n = 1
  while (taken.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

function existingParameterKeys(design: DesignFileV2): Set<string> {
  return new Set(Object.keys(design.parameters))
}

function existingDimensionIds(design: DesignFileV2): Set<string> {
  return new Set((design.dimensions ?? []).map((d) => d.id))
}

function existingConstraintIds(design: DesignFileV2): Set<string> {
  return new Set(design.constraints.map((c) => c.id))
}

// ---------------------------------------------------------------------------
// 2. createDrivingDimension
// ---------------------------------------------------------------------------

/**
 * Atomically add a DRIVING dimension for `intent`:
 *   - a unique `parameterKey` (default `d<seq>`, e.g. `d1`),
 *   - `parameters[key] = measureDimensionValue(...)` (so geometry does NOT move),
 *   - the matching `SketchDimension` with `parameterKey` set,
 *   - the matching driving `SketchConstraint`:
 *       linear|aligned -> distance{a,b,parameterKey}
 *       radial         -> radius{entityId,parameterKey}
 *       diameter       -> diameter{entityId,parameterKey}
 *       angular        -> angle{a1,b1,a2,b2,parameterKey}
 *
 * Returns `null` when the intent can't be measured (e.g. radial on a non-circle,
 * a degenerate line, or a missing point/entity). Never mutates `design`.
 *
 * `opts.parameterKey` overrides the derived key. If that key already exists in
 * `design.parameters` the request is rejected (`null`) rather than silently
 * clobbering an existing driver.
 */
export function createDrivingDimension(
  design: DesignFileV2,
  intent: DimensionIntent,
  opts?: { parameterKey?: string }
): CreateDrivingDimensionResult | null {
  const measured = measureDimensionValue(design, intent)
  if (measured == null || !Number.isFinite(measured)) return null

  const paramKeys = existingParameterKeys(design)
  let parameterKey: string
  if (opts?.parameterKey != null) {
    if (opts.parameterKey.length === 0 || paramKeys.has(opts.parameterKey)) return null
    parameterKey = opts.parameterKey
  } else {
    parameterKey = freeSequencedId('d', paramKeys)
  }

  const dimensionId = freeSequencedId('dim_', existingDimensionIds(design))
  // Keep the constraint id distinct from the dimension id namespace.
  const constraintId = freeSequencedId('con_', existingConstraintIds(design))

  const dimension = buildDimension(intent, dimensionId, parameterKey)
  const constraint = buildConstraint(intent, constraintId, parameterKey)

  const next = cloneDesign(design)
  next.parameters = { ...next.parameters, [parameterKey]: measured }
  next.dimensions = [...(next.dimensions ?? []), dimension]
  next.constraints = [...next.constraints, constraint]

  return { design: next, dimensionId, parameterKey }
}

function buildDimension(
  intent: DimensionIntent,
  id: string,
  parameterKey: string
): SketchDimension {
  switch (intent.kind) {
    case 'linear':
      return { id, kind: 'linear', aId: intent.aId, bId: intent.bId, parameterKey }
    case 'aligned':
      return { id, kind: 'aligned', aId: intent.aId, bId: intent.bId, parameterKey }
    case 'radial':
      return { id, kind: 'radial', entityId: intent.entityId, parameterKey }
    case 'diameter':
      return { id, kind: 'diameter', entityId: intent.entityId, parameterKey }
    case 'angular':
      return {
        id,
        kind: 'angular',
        a1Id: intent.a1Id,
        b1Id: intent.b1Id,
        a2Id: intent.a2Id,
        b2Id: intent.b2Id,
        parameterKey
      }
    default: {
      const _exhaustive: never = intent
      void _exhaustive
      throw new Error('unreachable dimension intent')
    }
  }
}

function buildConstraint(
  intent: DimensionIntent,
  id: string,
  parameterKey: string
): SketchConstraint {
  switch (intent.kind) {
    case 'linear':
    case 'aligned':
      return {
        id,
        type: 'distance',
        a: { pointId: intent.aId },
        b: { pointId: intent.bId },
        parameterKey
      }
    case 'radial':
      return { id, type: 'radius', entityId: intent.entityId, parameterKey }
    case 'diameter':
      return { id, type: 'diameter', entityId: intent.entityId, parameterKey }
    case 'angular':
      return {
        id,
        type: 'angle',
        a1: { pointId: intent.a1Id },
        b1: { pointId: intent.b1Id },
        a2: { pointId: intent.a2Id },
        b2: { pointId: intent.b2Id },
        parameterKey
      }
    default: {
      const _exhaustive: never = intent
      void _exhaustive
      throw new Error('unreachable constraint intent')
    }
  }
}

// ---------------------------------------------------------------------------
// 3. applyDimensionValue
// ---------------------------------------------------------------------------

/** Driving dimensions whose value is a positive length (mm). */
function isLengthKind(dim: SketchDimension): boolean {
  return dim.kind === 'linear' || dim.kind === 'aligned' || dim.kind === 'radial' || dim.kind === 'diameter'
}

/**
 * Wrap an angle into a sane driving range. The solver compares cosines, so any
 * value works numerically, but we keep the stored parameter human-sane and
 * matching the unsigned 0–180° the readout shows. We fold into [0,360) first,
 * then mirror the reflex half back into (0,180].
 */
function sanitizeAngleDeg(value: number): number | null {
  if (!Number.isFinite(value)) return null
  let a = value % 360
  if (a < 0) a += 360
  if (a > 180) a = 360 - a
  // A 0° / 180° driver is degenerate (parallel lines, no unique solve target).
  if (a <= LEN_EPS || a >= 180 - LEN_EPS) return null
  return a
}

/**
 * Sanitise `newValue` for `dim`'s kind, or `null` if it can't drive:
 *   length kinds -> finite and > 0
 *   angular      -> wrapped to (0,180)
 */
function sanitizeValueForDimension(dim: SketchDimension, newValue: number): number | null {
  if (!Number.isFinite(newValue)) return null
  if (dim.kind === 'angular') return sanitizeAngleDeg(newValue)
  if (isLengthKind(dim)) return newValue > 0 ? newValue : null
  return null
}

/**
 * Edit a driving dimension's value and re-solve.
 *
 * Finds the dimension by id; if it carries a `parameterKey` and `newValue` is
 * valid for its kind, sets `parameters[key] = sanitized` then returns
 * `solveSketch(updated)` (geometry moves toward the new value).
 *
 * Returns the SAME `design` reference (no clone, no solve) when:
 *   - the dimension id is unknown,
 *   - the dimension is annotation-only (no `parameterKey`),
 *   - `newValue` is invalid for the dimension kind (NaN/∞, ≤0 length, degenerate angle).
 * The caller uses reference-equality to decide whether to push an undo step.
 *
 * Pure: never mutates `design`.
 */
export function applyDimensionValue(
  design: DesignFileV2,
  dimensionId: string,
  newValue: number
): DesignFileV2 {
  const dim = (design.dimensions ?? []).find((d) => d.id === dimensionId)
  if (!dim) return design
  const parameterKey = dim.parameterKey
  if (parameterKey == null || parameterKey.length === 0) return design

  const sanitized = sanitizeValueForDimension(dim, newValue)
  if (sanitized == null) return design

  const next = cloneDesign(design)
  next.parameters = { ...next.parameters, [parameterKey]: sanitized }
  return solveSketch(next)
}
