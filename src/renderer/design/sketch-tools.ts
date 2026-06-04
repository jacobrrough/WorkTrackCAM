/**
 * CAD V1 -- 2D sketch editor tool palette descriptors (MVP).
 *
 * Pure descriptor module. The actual click routing lives in
 * ``Sketch2DCanvas.tsx`` -- this module exports
 *   1. The ``SketchToolId`` discriminated union of every tool the
 *      palette can surface,
 *   2. ``SketchToolDescriptor`` records with the label / cursor / accent
 *      colour the renderer pins next to the palette button, and
 *   3. ``handleSketchToolClick``: the pure routing function that takes a
 *      tool id + the current draft state + the world-space click point,
 *      and returns either a ``SketchAction`` to feed the reducer or an
 *      ``updateDraft`` envelope when the click only advances a multi-step
 *      tool (rectangle's first corner, distance constraint's first pick).
 *
 * Keeping this routing pure means the unit tests can exercise every
 * branch without React, jsdom, or a DOM event simulator -- the same
 * pattern ``sketch2d-event-handlers.ts`` already uses.
 */

import type { Constraint, SketchAction, SketchEntity } from './sketch-state'

// ── Tool palette ─────────────────────────────────────────────────────────────

export type SketchToolId =
  /** Default: no draw, click selects an entity. */
  | 'select'
  | 'line'
  | 'circle'
  | 'arc'
  /** CAD V1.5: three-pick quadratic Bézier spline (start, via, end). */
  | 'spline'
  | 'rectangle'
  | 'horizontalConstraint'
  | 'verticalConstraint'
  | 'coincidentConstraint'
  | 'distanceConstraint'
  | 'radiusConstraint'
  /** CAD V1.5: parallel constraint between two lines (four point picks). */
  | 'parallelConstraint'
  /** CAD V1.5: perpendicular constraint between two lines (four point picks). */
  | 'perpendicularConstraint'
  /** Equal-length constraint between two line segments (four point picks). */
  | 'equalConstraint'
  /** Angle constraint between two lines (four point picks + a degree value). */
  | 'angleConstraint'
  /** Symmetric constraint: two points mirrored across a line (four point picks). */
  | 'symmetricConstraint'
  /** Midpoint constraint: a point at the midpoint of a segment (three point picks). */
  | 'midpointConstraint'
  /** Point-on-line constraint: a point lies on a segment's line (three point picks). */
  | 'pointOnLineConstraint'
  /** Concentric constraint: two circles/arcs share a center (two entity picks). */
  | 'concentricConstraint'
  /** Tangent constraint: a line tangent to an arc (one line + one arc entity pick). */
  | 'tangentConstraint'
  /** Fix / lock constraint: anchor a single point (one point pick). */
  | 'fixConstraint'

export type SketchToolKind = 'select' | 'draw' | 'constraint'

export type SketchToolDescriptor = {
  id: SketchToolId
  label: string
  kind: SketchToolKind
  /** ARIA label / button title shown on hover. */
  description: string
  /** Number of world-space picks the tool needs before it commits. */
  requiredPicks: number
}

export const SKETCH_TOOLS: readonly SketchToolDescriptor[] = [
  {
    id: 'select',
    label: 'Select',
    kind: 'select',
    description: 'Pick existing entities / constraints (no draw).',
    requiredPicks: 0
  },
  {
    id: 'line',
    label: 'Line',
    kind: 'draw',
    description: 'Two-pick straight line segment.',
    requiredPicks: 2
  },
  {
    id: 'circle',
    label: 'Circle',
    kind: 'draw',
    description: 'Centre + radius (two picks).',
    requiredPicks: 2
  },
  {
    id: 'arc',
    label: 'Arc',
    kind: 'draw',
    description: 'Three picks: start, point on arc, end.',
    requiredPicks: 3
  },
  {
    id: 'spline',
    label: 'Spline',
    kind: 'draw',
    description: 'Three picks: start, via, end -- renders a quadratic Bézier.',
    requiredPicks: 3
  },
  {
    id: 'rectangle',
    label: 'Rectangle',
    kind: 'draw',
    description: 'Two opposite corners -- emits 4 lines.',
    requiredPicks: 2
  },
  {
    id: 'horizontalConstraint',
    label: 'Horizontal',
    kind: 'constraint',
    description: 'Force two points to share the same Y.',
    requiredPicks: 2
  },
  {
    id: 'verticalConstraint',
    label: 'Vertical',
    kind: 'constraint',
    description: 'Force two points to share the same X.',
    requiredPicks: 2
  },
  {
    id: 'coincidentConstraint',
    label: 'Coincident',
    kind: 'constraint',
    description: 'Pin two points to the same location.',
    requiredPicks: 2
  },
  {
    id: 'distanceConstraint',
    label: 'Distance',
    kind: 'constraint',
    description: 'Pin distance between two points (mm).',
    requiredPicks: 2
  },
  {
    id: 'radiusConstraint',
    label: 'Radius',
    kind: 'constraint',
    description: 'Pin a circle / arc radius (mm).',
    requiredPicks: 1
  },
  {
    id: 'parallelConstraint',
    label: 'Parallel',
    kind: 'constraint',
    description: 'Force two lines parallel — pick endpoints (a1, b1, a2, b2).',
    requiredPicks: 4
  },
  {
    id: 'perpendicularConstraint',
    label: 'Perpendicular',
    kind: 'constraint',
    description: 'Force two lines perpendicular — pick endpoints (a1, b1, a2, b2).',
    requiredPicks: 4
  },
  {
    id: 'equalConstraint',
    label: 'Equal',
    kind: 'constraint',
    description: 'Force two segments to equal length — pick endpoints (a1, b1, a2, b2).',
    requiredPicks: 4
  },
  {
    id: 'angleConstraint',
    label: 'Angle',
    kind: 'constraint',
    description: 'Pin the angle (deg) between two lines — pick endpoints (a1, b1, a2, b2).',
    requiredPicks: 4
  },
  {
    id: 'symmetricConstraint',
    label: 'Symmetric',
    kind: 'constraint',
    description: 'Mirror two points across a line — pick the pair then the mirror line (a, b, la, lb).',
    requiredPicks: 4
  },
  {
    id: 'midpointConstraint',
    label: 'Midpoint',
    kind: 'constraint',
    description: 'Pin a point to a segment midpoint — pick the point then both segment ends (m, a, b).',
    requiredPicks: 3
  },
  {
    id: 'pointOnLineConstraint',
    label: 'Point on line',
    kind: 'constraint',
    description: 'Force a point onto a line — pick the point then both line ends (p, a, b).',
    requiredPicks: 3
  },
  {
    id: 'concentricConstraint',
    label: 'Concentric',
    kind: 'constraint',
    description: 'Force two circles / arcs to share a center — pick both entities.',
    requiredPicks: 2
  },
  {
    id: 'tangentConstraint',
    label: 'Tangent',
    kind: 'constraint',
    description: 'Force a line tangent to an arc — pick the line then the arc.',
    requiredPicks: 2
  },
  {
    id: 'fixConstraint',
    label: 'Fix',
    kind: 'constraint',
    description: 'Anchor a point so the solver never moves it — pick one point.',
    requiredPicks: 1
  }
] as const

export function getSketchTool(id: SketchToolId): SketchToolDescriptor {
  const t = SKETCH_TOOLS.find((tool) => tool.id === id)
  if (!t) throw new Error(`Unknown sketch tool: ${id}`)
  return t
}

// ── Click routing ────────────────────────────────────────────────────────────

/** World-space picked point (millimetres in sketch frame). */
export type SketchPick = {
  x: number
  y: number
  /** Existing point id if the click snapped to one; otherwise undefined. */
  pointId?: string
  /** Existing entity id if the click hit one (used by radius constraint). */
  entityId?: string
}

/**
 * Per-tool draft state. The renderer pushes the picks accumulated so far
 * here and routes the next click via ``handleSketchToolClick``. When the
 * tool commits, the renderer clears its draft and dispatches the
 * returned ``SketchAction`` into the reducer.
 */
export type SketchToolDraft = {
  picks: SketchPick[]
  /** Optional numeric value entered before clicking (distance / radius). */
  numericValue?: number
}

export const emptyDraft: SketchToolDraft = { picks: [] }

/** Routing result returned by ``handleSketchToolClick``. */
export type SketchToolClickResult =
  | { kind: 'updateDraft'; draft: SketchToolDraft }
  | { kind: 'commit'; action: SketchAction; resetDraft: true; hint?: string }
  | { kind: 'commitMany'; actions: SketchAction[]; resetDraft: true; hint?: string }
  | { kind: 'noop'; reason: string }
  | { kind: 'error'; message: string }

/**
 * Pure tool router. Given the active tool + current draft + the new
 * world-space pick, returns the next step the canvas should take.
 *
 * Callers are responsible for:
 *   - Snapping the pick to the grid before calling (see ``snap`` in
 *     ``sketch2d-canvas-coords.ts``).
 *   - Threading any returned action(s) into ``sketchReducer``.
 *   - Resetting the local draft when ``resetDraft`` is true.
 */
export function handleSketchToolClick(
  tool: SketchToolId,
  draft: SketchToolDraft,
  pick: SketchPick,
  context: {
    /** Existing entities -- needed for the radius constraint to resolve a circle hit. */
    entities: ReadonlyArray<SketchEntity>
    /** ID factory used by the reducer (override in tests for determinism). */
    nextId?: (prefix: 'p' | 'e' | 'c') => string
  }
): SketchToolClickResult {
  const nextId = context.nextId ?? defaultIdFactory()
  const nextPicks = [...draft.picks, pick]

  if (tool === 'select') {
    return { kind: 'noop', reason: 'Select tool is canvas-pick only.' }
  }

  if (tool === 'line') {
    if (nextPicks.length < 2) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [a, b] = nextPicks
    if (!a || !b) return { kind: 'noop', reason: 'missing pick' }
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.001) {
      return {
        kind: 'error',
        message: 'Line endpoints coincide -- pick a second point away from the first.'
      }
    }
    return {
      kind: 'commit',
      resetDraft: true,
      action: {
        type: 'addLine',
        id: nextId('e'),
        start: { id: a.pointId, x: a.x, y: a.y },
        end: { id: b.pointId, x: b.x, y: b.y }
      },
      hint: 'Line placed.'
    }
  }

  if (tool === 'circle') {
    if (nextPicks.length < 2) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [c, r] = nextPicks
    if (!c || !r) return { kind: 'noop', reason: 'missing pick' }
    const radius = Math.hypot(r.x - c.x, r.y - c.y)
    if (radius < 0.5) {
      return {
        kind: 'error',
        message: 'Circle radius must be greater than 0.5 mm.'
      }
    }
    return {
      kind: 'commit',
      resetDraft: true,
      action: {
        type: 'addCircle',
        id: nextId('e'),
        center: { id: c.pointId, x: c.x, y: c.y },
        radius
      },
      hint: `Circle placed (r=${radius.toFixed(2)} mm).`
    }
  }

  if (tool === 'arc') {
    if (nextPicks.length < 3) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [s, v, e] = nextPicks
    if (!s || !v || !e) return { kind: 'noop', reason: 'missing pick' }
    // Reject collinear triples -- the arc maths in solver2d / circleThroughThreePoints
    // returns null for collinear inputs and the resulting sketch is broken.
    const cross = (v.x - s.x) * (e.y - s.y) - (v.y - s.y) * (e.x - s.x)
    if (Math.abs(cross) < 1e-6) {
      return {
        kind: 'error',
        message: 'Arc points are collinear -- pick a via point off the chord.'
      }
    }
    return {
      kind: 'commit',
      resetDraft: true,
      action: {
        type: 'addArc',
        id: nextId('e'),
        start: { id: s.pointId, x: s.x, y: s.y },
        via: { id: v.pointId, x: v.x, y: v.y },
        end: { id: e.pointId, x: e.x, y: e.y }
      },
      hint: 'Arc placed.'
    }
  }

  if (tool === 'spline') {
    if (nextPicks.length < 3) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [s, v, e] = nextPicks
    if (!s || !v || !e) return { kind: 'noop', reason: 'missing pick' }
    // Reject coincident endpoints -- a spline that collapses to a single
    // point has no curve to render and adds zero value.
    if (Math.hypot(e.x - s.x, e.y - s.y) < 0.001) {
      return {
        kind: 'error',
        message: 'Spline endpoints coincide -- pick distinct start and end picks.'
      }
    }
    return {
      kind: 'commit',
      resetDraft: true,
      action: {
        type: 'addSpline',
        id: nextId('e'),
        start: { id: s.pointId, x: s.x, y: s.y },
        via: { id: v.pointId, x: v.x, y: v.y },
        end: { id: e.pointId, x: e.x, y: e.y }
      },
      hint: 'Spline placed.'
    }
  }

  if (tool === 'rectangle') {
    if (nextPicks.length < 2) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [a, b] = nextPicks
    if (!a || !b) return { kind: 'noop', reason: 'missing pick' }
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    if (w < 0.5 || h < 0.5) {
      return {
        kind: 'error',
        message: 'Rectangle width and height must each be greater than 0.5 mm.'
      }
    }
    // Emit four lines as a closed loop. Each ``addLine`` action will
    // create its own start/end points -- but to keep the rectangle
    // exactly closed we share the corner point ids by pre-allocating
    // them and referencing across all four addLine actions.
    const cornerIds = [nextId('p'), nextId('p'), nextId('p'), nextId('p')] as const
    const corners = [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y }
    ] as const
    const lineIds = [nextId('e'), nextId('e'), nextId('e'), nextId('e')] as const
    const actions: SketchAction[] = []
    for (let i = 0; i < 4; i++) {
      const startId = cornerIds[i]!
      const endId = cornerIds[(i + 1) % 4]!
      const startPt = corners[i]!
      const endPt = corners[(i + 1) % 4]!
      actions.push({
        type: 'addLine',
        id: lineIds[i],
        start: { id: startId, x: startPt.x, y: startPt.y },
        end: { id: endId, x: endPt.x, y: endPt.y }
      })
    }
    return {
      kind: 'commitMany',
      resetDraft: true,
      actions,
      hint: `Rectangle placed (${w.toFixed(2)} × ${h.toFixed(2)} mm).`
    }
  }

  // ── Constraint tools ──────────────────────────────────────────────────────
  if (
    tool === 'horizontalConstraint' ||
    tool === 'verticalConstraint' ||
    tool === 'coincidentConstraint' ||
    tool === 'distanceConstraint'
  ) {
    if (!pick.pointId) {
      return {
        kind: 'error',
        message: 'Constraint requires picking an existing point -- click closer to a vertex.'
      }
    }
    if (nextPicks.length < 2) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [a, b] = nextPicks
    if (!a?.pointId || !b?.pointId) {
      return {
        kind: 'error',
        message: 'Both picks must snap to an existing point.'
      }
    }
    if (a.pointId === b.pointId) {
      return {
        kind: 'error',
        message: 'Constraint endpoints must differ -- pick two distinct points.'
      }
    }
    const id = nextId('c')
    if (tool === 'horizontalConstraint') {
      const constraint: Constraint = { id, kind: 'horizontal', aId: a.pointId, bId: b.pointId }
      return {
        kind: 'commit',
        resetDraft: true,
        action: { type: 'addConstraint', constraint },
        hint: 'Horizontal constraint added.'
      }
    }
    if (tool === 'verticalConstraint') {
      const constraint: Constraint = { id, kind: 'vertical', aId: a.pointId, bId: b.pointId }
      return {
        kind: 'commit',
        resetDraft: true,
        action: { type: 'addConstraint', constraint },
        hint: 'Vertical constraint added.'
      }
    }
    if (tool === 'coincidentConstraint') {
      const constraint: Constraint = { id, kind: 'coincident', aId: a.pointId, bId: b.pointId }
      return {
        kind: 'commit',
        resetDraft: true,
        action: { type: 'addConstraint', constraint },
        hint: 'Coincident constraint added.'
      }
    }
    // distance
    const value = draft.numericValue
    if (!Number.isFinite(value) || (value ?? 0) <= 0) {
      return {
        kind: 'error',
        message: 'Distance constraint needs a positive value. Type a number into the ribbon and re-pick.'
      }
    }
    const constraint: Constraint = {
      id,
      kind: 'distance',
      aId: a.pointId,
      bId: b.pointId,
      value: value as number
    }
    return {
      kind: 'commit',
      resetDraft: true,
      action: { type: 'addConstraint', constraint },
      hint: `Distance constraint added (${(value as number).toFixed(2)} mm).`
    }
  }

  if (tool === 'radiusConstraint') {
    if (!pick.entityId) {
      return {
        kind: 'error',
        message: 'Radius constraint requires clicking a circle or arc.'
      }
    }
    const target = context.entities.find((e) => e.id === pick.entityId)
    if (!target || (target.kind !== 'circle' && target.kind !== 'arc')) {
      return {
        kind: 'error',
        message: 'Radius constraint only applies to circles and arcs.'
      }
    }
    const value = draft.numericValue
    if (!Number.isFinite(value) || (value ?? 0) <= 0) {
      return {
        kind: 'error',
        message: 'Radius constraint needs a positive value. Type a number into the ribbon and re-pick.'
      }
    }
    const constraint: Constraint = {
      id: nextId('c'),
      kind: 'radius',
      entityId: target.id,
      value: value as number
    }
    return {
      kind: 'commit',
      resetDraft: true,
      action: { type: 'addConstraint', constraint },
      hint: `Radius constraint added (${(value as number).toFixed(2)} mm).`
    }
  }

  if (tool === 'parallelConstraint' || tool === 'perpendicularConstraint') {
    if (!pick.pointId) {
      return {
        kind: 'error',
        message: `${tool === 'parallelConstraint' ? 'Parallel' : 'Perpendicular'} constraint requires picking existing points — click closer to a vertex.`
      }
    }
    if (nextPicks.length < 4) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [a1, b1, a2, b2] = nextPicks
    if (!a1?.pointId || !b1?.pointId || !a2?.pointId || !b2?.pointId) {
      return {
        kind: 'error',
        message: 'All four picks must snap to existing points.'
      }
    }
    if (a1.pointId === b1.pointId || a2.pointId === b2.pointId) {
      return {
        kind: 'error',
        message: 'Each line needs two distinct endpoints.'
      }
    }
    const id = nextId('c')
    const constraint: Constraint =
      tool === 'parallelConstraint'
        ? {
            id,
            kind: 'parallel',
            a1Id: a1.pointId,
            b1Id: b1.pointId,
            a2Id: a2.pointId,
            b2Id: b2.pointId
          }
        : {
            id,
            kind: 'perpendicular',
            a1Id: a1.pointId,
            b1Id: b1.pointId,
            a2Id: a2.pointId,
            b2Id: b2.pointId
          }
    return {
      kind: 'commit',
      resetDraft: true,
      action: { type: 'addConstraint', constraint },
      hint: `${tool === 'parallelConstraint' ? 'Parallel' : 'Perpendicular'} constraint added.`
    }
  }

  // ── Four-point line-pair / mirror constraints (equal / angle / symmetric) ───
  if (
    tool === 'equalConstraint' ||
    tool === 'angleConstraint' ||
    tool === 'symmetricConstraint'
  ) {
    if (!pick.pointId) {
      return {
        kind: 'error',
        message: 'Constraint requires picking existing points — click closer to a vertex.'
      }
    }
    if (nextPicks.length < 4) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [p1, p2, p3, p4] = nextPicks
    if (!p1?.pointId || !p2?.pointId || !p3?.pointId || !p4?.pointId) {
      return { kind: 'error', message: 'All four picks must snap to existing points.' }
    }
    if (p1.pointId === p2.pointId || p3.pointId === p4.pointId) {
      return { kind: 'error', message: 'Each pair needs two distinct points.' }
    }
    const id = nextId('c')
    if (tool === 'equalConstraint') {
      const constraint: Constraint = {
        id,
        kind: 'equal',
        a1Id: p1.pointId,
        b1Id: p2.pointId,
        a2Id: p3.pointId,
        b2Id: p4.pointId
      }
      return {
        kind: 'commit',
        resetDraft: true,
        action: { type: 'addConstraint', constraint },
        hint: 'Equal-length constraint added.'
      }
    }
    if (tool === 'symmetricConstraint') {
      const constraint: Constraint = {
        id,
        kind: 'symmetric',
        aId: p1.pointId,
        bId: p2.pointId,
        laId: p3.pointId,
        lbId: p4.pointId
      }
      return {
        kind: 'commit',
        resetDraft: true,
        action: { type: 'addConstraint', constraint },
        hint: 'Symmetric constraint added.'
      }
    }
    // angle
    const value = draft.numericValue
    if (!Number.isFinite(value)) {
      return {
        kind: 'error',
        message: 'Angle constraint needs a degree value. Type a number into the ribbon and re-pick.'
      }
    }
    const constraint: Constraint = {
      id,
      kind: 'angle',
      a1Id: p1.pointId,
      b1Id: p2.pointId,
      a2Id: p3.pointId,
      b2Id: p4.pointId,
      value: value as number
    }
    return {
      kind: 'commit',
      resetDraft: true,
      action: { type: 'addConstraint', constraint },
      hint: `Angle constraint added (${(value as number).toFixed(1)}°).`
    }
  }

  // ── Three-point constraints (midpoint / point-on-line) ──────────────────────
  if (tool === 'midpointConstraint' || tool === 'pointOnLineConstraint') {
    if (!pick.pointId) {
      return {
        kind: 'error',
        message: 'Constraint requires picking existing points — click closer to a vertex.'
      }
    }
    if (nextPicks.length < 3) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [first, a, b] = nextPicks
    if (!first?.pointId || !a?.pointId || !b?.pointId) {
      return { kind: 'error', message: 'All three picks must snap to existing points.' }
    }
    if (a.pointId === b.pointId) {
      return { kind: 'error', message: 'The segment needs two distinct endpoints.' }
    }
    if (first.pointId === a.pointId || first.pointId === b.pointId) {
      return { kind: 'error', message: 'Pick a point distinct from the segment endpoints first.' }
    }
    const id = nextId('c')
    const constraint: Constraint =
      tool === 'midpointConstraint'
        ? { id, kind: 'midpoint', mId: first.pointId, aId: a.pointId, bId: b.pointId }
        : { id, kind: 'pointOnLine', pId: first.pointId, aId: a.pointId, bId: b.pointId }
    return {
      kind: 'commit',
      resetDraft: true,
      action: { type: 'addConstraint', constraint },
      hint: tool === 'midpointConstraint' ? 'Midpoint constraint added.' : 'Point-on-line constraint added.'
    }
  }

  // ── Fix / lock a single point ───────────────────────────────────────────────
  if (tool === 'fixConstraint') {
    if (!pick.pointId) {
      return { kind: 'error', message: 'Fix constraint requires picking an existing point.' }
    }
    const constraint: Constraint = { id: nextId('c'), kind: 'fix', pointId: pick.pointId }
    return {
      kind: 'commit',
      resetDraft: true,
      action: { type: 'addConstraint', constraint },
      hint: 'Point fixed (anchored).'
    }
  }

  // ── Concentric: two circle / arc entity picks ───────────────────────────────
  if (tool === 'concentricConstraint') {
    if (!pick.entityId) {
      return { kind: 'error', message: 'Concentric constraint requires clicking a circle or arc.' }
    }
    const target = context.entities.find((e) => e.id === pick.entityId)
    if (!target || (target.kind !== 'circle' && target.kind !== 'arc')) {
      return { kind: 'error', message: 'Concentric constraint only applies to circles and arcs.' }
    }
    if (nextPicks.length < 2) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [first, second] = nextPicks
    if (!first?.entityId || !second?.entityId) {
      return { kind: 'error', message: 'Both picks must hit a circle or arc.' }
    }
    if (first.entityId === second.entityId) {
      return { kind: 'error', message: 'Pick two distinct circles / arcs.' }
    }
    const constraint: Constraint = {
      id: nextId('c'),
      kind: 'concentric',
      entityAId: first.entityId,
      entityBId: second.entityId
    }
    return {
      kind: 'commit',
      resetDraft: true,
      action: { type: 'addConstraint', constraint },
      hint: 'Concentric constraint added.'
    }
  }

  // ── Tangent: one line entity + one arc entity ───────────────────────────────
  if (tool === 'tangentConstraint') {
    if (!pick.entityId) {
      return { kind: 'error', message: 'Tangent constraint requires clicking a line then an arc.' }
    }
    if (nextPicks.length < 2) return { kind: 'updateDraft', draft: { ...draft, picks: nextPicks } }
    const [linePick, arcPick] = nextPicks
    if (!linePick?.entityId || !arcPick?.entityId) {
      return { kind: 'error', message: 'Pick a line entity then an arc entity.' }
    }
    const lineEntity = context.entities.find((e) => e.id === linePick.entityId)
    const arcEntity = context.entities.find((e) => e.id === arcPick.entityId)
    if (!lineEntity || lineEntity.kind !== 'line') {
      return { kind: 'error', message: 'First tangent pick must be a line.' }
    }
    if (!arcEntity || arcEntity.kind !== 'arc') {
      return { kind: 'error', message: 'Second tangent pick must be an arc.' }
    }
    const constraint: Constraint = {
      id: nextId('c'),
      kind: 'tangent',
      lineAId: lineEntity.startId,
      lineBId: lineEntity.endId,
      arcStartId: arcEntity.startId,
      arcViaId: arcEntity.viaId,
      arcEndId: arcEntity.endId,
      arcTangentAt: 'start',
      lineTangentAt: 'a'
    }
    return {
      kind: 'commit',
      resetDraft: true,
      action: { type: 'addConstraint', constraint },
      hint: 'Tangent constraint added.'
    }
  }

  const _exhaustive: never = tool
  void _exhaustive
  return { kind: 'noop', reason: 'unknown tool' }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let __testIdCounter = 0
function defaultIdFactory(): (prefix: 'p' | 'e' | 'c') => string {
  return (prefix) => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return `${prefix}_${globalThis.crypto.randomUUID()}`
    }
    __testIdCounter += 1
    return `${prefix}_${Date.now().toString(36)}_${__testIdCounter}`
  }
}

/** Deterministic id factory for tests (call ``resetTestIds()`` between runs). */
export function makeDeterministicIdFactory(seed = 0): (prefix: 'p' | 'e' | 'c') => string {
  let n = seed
  return (prefix) => {
    n += 1
    return `${prefix}${n}`
  }
}
