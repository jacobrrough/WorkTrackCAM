/**
 * Sketch S5 -- END-TO-END data-level integration of the precision-polish wave:
 * the constraints toolbar, exact dimension landing, the angular driving
 * dimension, the honest DOF badge, and the persistence round-trip -- driven
 * through the REAL pipeline modules chained exactly the way the mounted
 * `SketchSurface` chains them (no mocks of any S5 module).
 *
 * Repo tests are node-SSR (no jsdom / no pointer events), so the "click a
 * toolbar button / place a dimension / retype a value" gestures are replayed at
 * the DATA level: the canvas hit-test (which SSR cannot flush) is bypassed and
 * the resolved selection / placement intent is fed straight into the SAME
 * surface handler bodies the live component runs.
 *
 *   apply a constraint  -> addConstraintFromSelection(cur, sel, kind)
 *                          + solveSketchToTolerance(...) routed through the REAL
 *                          sketch-history ring (ONE undoable step)  -- mirrors
 *                          SketchSurface.handleApplyConstraint
 *   place a dimension   -> createDrivingDimension(cur, intent) -> applyDesignEdit
 *                          -- mirrors SketchSurface.handlePlaceDimension
 *   edit a value        -> applyDimensionValue(cur, dimId, value) (re-solves to
 *                          tolerance) -> applyDesignEdit when it moved geometry
 *                          -- mirrors SketchSurface.handleCommitDimensionValue
 *   DOF badge           -> analyzeSketchDof(liveDesign) (the seam the badge reads)
 *   persistence         -> designFileSchemaV2.parse(JSON.parse(JSON.stringify(d)))
 *
 * The harness handler bodies are mirrored from SketchSurface.tsx line-for-line;
 * the constraints render/source suite (SketchSurface.constraints.test.tsx)
 * source-pins those bodies, and this file proves the DATA flows correctly when
 * they run against the real modules end to end.
 */

import { describe, expect, it } from 'vitest'
import {
  designFileSchemaV2,
  emptyDesign,
  type DesignFileV2
} from '../../../shared/design-schema'
import { createSketchHistory, type SketchHistory } from '../sketch-history'
import {
  addConstraintFromSelection,
  solveSketchToTolerance,
  type ConstraintKind
} from '../sketch-constraint-apply'
import {
  applyDimensionValue,
  createDrivingDimension,
  measureDimensionValue,
  type DimensionIntent
} from '../sketch-dimension-drive'
import { analyzeSketchDof } from '../sketch-dof-seam'

// ─────────────────────────────────────────────────────────────────────────────
// Surface harness -- the SketchSurface handler bodies over the REAL ring.
// (Bodies mirrored from SketchSurface.tsx; pinned there by the constraints suite.)
// ─────────────────────────────────────────────────────────────────────────────

interface SurfaceSim {
  readonly live: { current: DesignFileV2 }
  readonly history: SketchHistory
}

function makeSurface(design: DesignFileV2): SurfaceSim {
  return { live: { current: design }, history: createSketchHistory() }
}

/** Mirrors SketchSurface.applyDesignEdit -- ONE undoable step (push pre-state). */
function applyDesignEdit(sim: SurfaceSim, next: DesignFileV2): void {
  sim.history.push(sim.live.current)
  sim.live.current = next
}

/** Mirrors SketchSurface.handleApplyConstraint -- add + re-solve as ONE step, or no-op. */
function surfaceApplyConstraint(
  sim: SurfaceSim,
  selected: ReadonlySet<string>,
  kind: ConstraintKind
): boolean {
  const cur = sim.live.current
  const withConstraint = addConstraintFromSelection(cur, selected, kind)
  if (!withConstraint) return false
  applyDesignEdit(sim, solveSketchToTolerance(withConstraint))
  return true
}

/** Mirrors SketchSurface.handlePlaceDimension -- createDrivingDimension -> ONE step. */
function surfacePlaceDimension(sim: SurfaceSim, intent: DimensionIntent): string | null {
  const result = createDrivingDimension(sim.live.current, intent)
  if (!result) return null
  applyDesignEdit(sim, result.design)
  return result.dimensionId
}

/** Mirrors SketchSurface.handleCommitDimensionValue -- re-solve; ONE step only if it moved. */
function surfaceCommitDimensionValue(sim: SurfaceSim, dimId: string, value: number): boolean {
  const cur = sim.live.current
  const next = applyDimensionValue(cur, dimId, value)
  if (next === cur) return false
  applyDesignEdit(sim, next)
  return true
}

/** Mirrors SketchSurface.performUndo / performRedo (apply through the live ref). */
function surfaceUndo(sim: SurfaceSim): boolean {
  const prev = sim.history.undo(sim.live.current)
  if (prev === null) return false
  sim.live.current = prev
  return true
}

function surfaceRedo(sim: SurfaceSim): boolean {
  const next = sim.history.redo(sim.live.current)
  if (next === null) return false
  sim.live.current = next
  return true
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry probes (the same quantities the solver minimises).
// ─────────────────────────────────────────────────────────────────────────────

/** 2D cross of the two segment directions (a1->b1) x (a2->b2); 0 when parallel. */
function segmentCross(
  d: DesignFileV2,
  a1: string,
  b1: string,
  a2: string,
  b2: string
): number {
  const pa1 = d.points[a1]!
  const pb1 = d.points[b1]!
  const pa2 = d.points[a2]!
  const pb2 = d.points[b2]!
  const v1x = pb1.x - pa1.x
  const v1y = pb1.y - pa1.y
  const v2x = pb2.x - pa2.x
  const v2y = pb2.y - pa2.y
  return v1x * v2y - v1y * v2x
}

/** Unit-normalised |sin θ| between the two segment directions (scale-free parallelism). */
function segmentSin(d: DesignFileV2, a1: string, b1: string, a2: string, b2: string): number {
  const pa1 = d.points[a1]!
  const pb1 = d.points[b1]!
  const pa2 = d.points[a2]!
  const pb2 = d.points[b2]!
  const v1x = pb1.x - pa1.x
  const v1y = pb1.y - pa1.y
  const v2x = pb2.x - pa2.x
  const v2y = pb2.y - pa2.y
  const l1 = Math.hypot(v1x, v1y)
  const l2 = Math.hypot(v2x, v2y)
  if (l1 < 1e-9 || l2 < 1e-9) return 0
  return Math.abs((v1x * v2y - v1y * v2x) / (l1 * l2))
}

function segLen(d: DesignFileV2, a: string, b: string): number {
  const pa = d.points[a]!
  const pb = d.points[b]!
  return Math.hypot(pb.x - pa.x, pb.y - pa.y)
}

// ─────────────────────────────────────────────────────────────────────────────
// (a) Two free segments -> apply 'parallel' -> they become parallel; ONE undo.
// ─────────────────────────────────────────────────────────────────────────────

/** Two open polylines, each a 2-vertex line, deliberately NOT parallel. */
function twoFreeSegments(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: {
      // line A: pointing roughly +X (slightly up).
      a0: { x: 0, y: 0 },
      a1: { x: 40, y: 6 },
      // line B: pointing up-right at a clearly different angle.
      b0: { x: 0, y: 20 },
      b1: { x: 30, y: 60 }
    },
    entities: [
      { id: 'LA', kind: 'polyline', pointIds: ['a0', 'a1'], closed: false },
      { id: 'LB', kind: 'polyline', pointIds: ['b0', 'b1'], closed: false }
    ]
  }
}

describe('S5 e2e (a) -- apply parallel to two free segments', () => {
  it('the two segments become parallel after solve (2D cross ~= 0); one undo restores', () => {
    const sim = makeSurface(twoFreeSegments())
    const original = sim.live.current

    // Sanity: they start clearly NOT parallel.
    expect(segmentSin(original, 'a0', 'a1', 'b0', 'b1')).toBeGreaterThan(0.1)

    // The toolbar offers 'parallel' for two line-likes; clicking it applies +
    // re-solves in ONE step (selection resolves to each line's first segment).
    const applied = surfaceApplyConstraint(sim, new Set(['LA', 'LB']), 'parallel')
    expect(applied).toBe(true)

    const solved = sim.live.current
    expect(solved).not.toBe(original)
    // A `parallel` constraint was appended ...
    expect(solved.constraints.some((c) => c.type === 'parallel')).toBe(true)
    // ... and the solver drove the directions parallel: the normalised |sin θ|
    // (the scale-free version of the solver's parallelCross residual) is ~0.
    expect(segmentSin(solved, 'a0', 'a1', 'b0', 'b1')).toBeLessThan(1e-3)
    // The raw 2D cross the solver minimises is also driven toward 0.
    expect(Math.abs(segmentCross(solved, 'a0', 'a1', 'b0', 'b1'))).toBeLessThan(0.05)

    // EXACTLY one undoable step for "apply constraint + re-solve".
    expect(sim.history.undoDepth()).toBe(1)
    expect(surfaceUndo(sim)).toBe(true)
    // Undo restores the ORIGINAL geometry AND drops the constraint.
    expect(sim.live.current).toEqual(original)
    expect(sim.live.current.constraints).toHaveLength(0)
    expect(segmentSin(sim.live.current, 'a0', 'a1', 'b0', 'b1')).toBeGreaterThan(0.1)

    // Redo re-applies the solved-parallel state.
    expect(surfaceRedo(sim)).toBe(true)
    expect(segmentSin(sim.live.current, 'a0', 'a1', 'b0', 'b1')).toBeLessThan(1e-3)
  })

  it('the constraint-apply leaves the undo pre-state pristine (deep-clone isolation)', () => {
    // applyDesignEdit pushes the ORIGINAL as the undo snapshot; the in-place
    // re-solve must not reach back into it. Prove the snapshot still restores
    // the exact original coordinates after the solve mutated the live design.
    const sim = makeSurface(twoFreeSegments())
    const originalJson = JSON.stringify(sim.live.current)
    surfaceApplyConstraint(sim, new Set(['LA', 'LB']), 'parallel')
    surfaceUndo(sim)
    expect(JSON.stringify(sim.live.current)).toBe(originalJson)
  })

  it('a perpendicular constraint drives the directions to a right angle (|dot| ~= 0)', () => {
    const sim = makeSurface(twoFreeSegments())
    expect(surfaceApplyConstraint(sim, new Set(['LA', 'LB']), 'perpendicular')).toBe(true)
    const d = sim.live.current
    const va = { x: d.points.a1!.x - d.points.a0!.x, y: d.points.a1!.y - d.points.a0!.y }
    const vb = { x: d.points.b1!.x - d.points.b0!.x, y: d.points.b1!.y - d.points.b0!.y }
    const cosAbs =
      Math.abs(va.x * vb.x + va.y * vb.y) / (Math.hypot(va.x, va.y) * Math.hypot(vb.x, vb.y))
    expect(cosAbs).toBeLessThan(1e-3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (b) Place a distance driver, edit 50 -> 80, assert post-solve length is
//     within 1e-3 (exact landing -- the whole point of S5's solver upgrade).
// ─────────────────────────────────────────────────────────────────────────────

/** One open segment exactly 50 mm long on the X axis. */
function fiftyMmSegment(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { p0: { x: 0, y: 0 }, p1: { x: 50, y: 0 } },
    entities: [{ id: 'L', kind: 'polyline', pointIds: ['p0', 'p1'], closed: false }]
  }
}

describe('S5 e2e (b) -- distance driver placed then edited lands EXACTLY', () => {
  it('place aligned 50 mm, retype 80 -> length within 1e-3 after one edit', () => {
    const sim = makeSurface(fiftyMmSegment())

    // Place an aligned distance dimension on the segment's two endpoints. The
    // canvas snaps each pick to the live vertex id (nearestPointIdWithin); we
    // feed those ids straight in.
    const intent: DimensionIntent = { kind: 'aligned', aId: 'p0', bId: 'p1' }
    // Creating it stores the CURRENT measured value (50) -> no geometry move.
    expect(measureDimensionValue(sim.live.current, intent)).toBeCloseTo(50, 9)
    const dimId = surfacePlaceDimension(sim, intent)
    expect(dimId).not.toBeNull()
    // Create did not move geometry (still 50 mm), and added the dim+param+constraint.
    expect(segLen(sim.live.current, 'p0', 'p1')).toBeCloseTo(50, 6)
    expect(sim.live.current.dimensions).toHaveLength(1)
    expect(sim.live.current.constraints.some((c) => c.type === 'distance')).toBe(true)
    expect(sim.history.undoDepth()).toBe(1) // the placement step

    // Retype 80 -> exact landing in ONE edit (the S4 single-pass solver left
    // this at ~79.8; solveSketchToTolerance lands it on the value).
    const moved = surfaceCommitDimensionValue(sim, dimId!, 80)
    expect(moved).toBe(true)
    expect(Math.abs(segLen(sim.live.current, 'p0', 'p1') - 80)).toBeLessThan(1e-3)
    expect(sim.history.undoDepth()).toBe(2) // placement + edit

    // The driving parameter actually holds 80 (the dim drives the geometry).
    const distC = sim.live.current.constraints.find((c) => c.type === 'distance')!
    if (distC.type !== 'distance') throw new Error('expected a distance constraint')
    expect(sim.live.current.parameters[distC.parameterKey]).toBe(80)

    // Undo the edit -> back to 50; undo the placement -> back to bare segment.
    expect(surfaceUndo(sim)).toBe(true)
    expect(Math.abs(segLen(sim.live.current, 'p0', 'p1') - 50)).toBeLessThan(1e-3)
    expect(surfaceUndo(sim)).toBe(true)
    expect(sim.live.current.dimensions).toHaveLength(0)
    expect(sim.live.current.constraints).toHaveLength(0)
  })

  it('re-typing the SAME valid value re-solves idempotently (geometry stays at 50)', () => {
    // applyDimensionValue re-solves for ANY valid value (its same-ref skip is
    // reserved for unknown id / annotation-only / invalid value -- see its
    // contract), so re-committing 50 is a real, idempotent re-solve: a new
    // design ref whose geometry is unchanged. One undo step is recorded.
    const sim = makeSurface(fiftyMmSegment())
    const dimId = surfacePlaceDimension(sim, { kind: 'aligned', aId: 'p0', bId: 'p1' })!
    const depth = sim.history.undoDepth()
    expect(surfaceCommitDimensionValue(sim, dimId, 50)).toBe(true)
    expect(sim.history.undoDepth()).toBe(depth + 1)
    // Idempotent: the segment is still 50 mm after the redundant edit.
    expect(Math.abs(segLen(sim.live.current, 'p0', 'p1') - 50)).toBeLessThan(1e-3)
  })

  it('an invalid edit (<=0 length) is rejected as a SAME-ref no-op (no undo step)', () => {
    // The genuine same-ref skip contract: an invalid value never clones/solves.
    const sim = makeSurface(fiftyMmSegment())
    const dimId = surfacePlaceDimension(sim, { kind: 'aligned', aId: 'p0', bId: 'p1' })!
    const depth = sim.history.undoDepth()
    expect(surfaceCommitDimensionValue(sim, dimId, 0)).toBe(false)
    expect(surfaceCommitDimensionValue(sim, dimId, -10)).toBe(false)
    expect(surfaceCommitDimensionValue(sim, dimId, Number.NaN)).toBe(false)
    expect(sim.history.undoDepth()).toBe(depth)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (c) An angular driving dimension placed + edited moves the angle toward the
//     target (the S5 angular sub-mode flows through the SAME handlers).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two segments sharing the origin: line 1 along +X, line 2 up-right at ~45°.
 * The angular tool dimensions the angle BETWEEN them (a1->b1 vs a2->b2).
 */
function twoLinesFromOrigin(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: {
      o: { x: 0, y: 0 },
      e1: { x: 40, y: 0 }, // line 1: +X (0°)
      e2: { x: 40, y: 40 } // line 2: 45°
    },
    entities: [
      { id: 'L1', kind: 'polyline', pointIds: ['o', 'e1'], closed: false },
      { id: 'L2', kind: 'polyline', pointIds: ['o', 'e2'], closed: false }
    ]
  }
}

describe('S5 e2e (c) -- angular driving dimension placed then edited', () => {
  it('place ~45deg angular, retype 90 -> the measured angle moves toward 90deg', () => {
    const sim = makeSurface(twoLinesFromOrigin())

    const intent: DimensionIntent = { kind: 'angular', a1Id: 'o', b1Id: 'e1', a2Id: 'o', b2Id: 'e2' }
    // Starts at 45deg (line2 is at 45deg to +X).
    expect(measureDimensionValue(sim.live.current, intent)).toBeCloseTo(45, 6)

    // The canvas angular sub-mode resolves each edge to its (a,b) point pair
    // (angularLinePointIds) and emits this intent into handlePlaceDimension.
    const dimId = surfacePlaceDimension(sim, intent)
    expect(dimId).not.toBeNull()
    // Create stores the measured value -> still 45deg, one undo step, angle constraint.
    expect(measureDimensionValue(sim.live.current, intent)).toBeCloseTo(45, 4)
    expect(sim.live.current.constraints.some((c) => c.type === 'angle')).toBe(true)
    expect(sim.history.undoDepth()).toBe(1)

    // Retype 90deg -> the geometry opens to a right angle. S5.1 replaced the old
    // (cos meas - cos target)^2 term -- whose gradient flattened near the target,
    // leaving 45->90 stuck around ~84.5deg -- with the TRUE arm-scaled signed-angle
    // residual, whose gradient does not vanish. So one edit (which re-solves to
    // tolerance) now LANDS the angle exactly, not merely near it.
    const before = measureDimensionValue(sim.live.current, intent)!
    const moved = surfaceCommitDimensionValue(sim, dimId!, 90)
    expect(moved).toBe(true)
    const after = measureDimensionValue(sim.live.current, intent)!
    expect(after).toBeGreaterThan(before) // opened up from 45deg
    // Exact landing within 1e-2deg in ONE edit (the whole point of the S5.1 fix).
    expect(Math.abs(after - 90)).toBeLessThan(1e-2)
    expect(sim.history.undoDepth()).toBe(2)

    // The angle parameter holds the sanitized 90.
    const angC = sim.live.current.constraints.find((c) => c.type === 'angle')!
    if (angC.type !== 'angle') throw new Error('expected an angle constraint')
    expect(sim.live.current.parameters[angC.parameterKey]).toBeCloseTo(90, 9)

    // Undo the edit returns toward 45deg.
    expect(surfaceUndo(sim)).toBe(true)
    expect(measureDimensionValue(sim.live.current, intent)!).toBeCloseTo(45, 3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (d) The DOF badge status transitions under -> full as constraints are added,
//     reading the LIVE design through the seam the surface badge consumes.
// ─────────────────────────────────────────────────────────────────────────────

describe('S5 e2e (d) -- DOF badge transitions under -> fully as constraints accrue', () => {
  it('a free segment reads under; pinning it to 0 DOF reads fully (approx)', () => {
    // The surface computes `dofReport = analyzeSketchDof(design)` and renders the
    // badge off `dofReport.status`. Drive the live design and read the SAME seam.
    const sim = makeSurface(fiftyMmSegment())

    // Free 2-point segment = 4 DOF -> under.
    expect(analyzeSketchDof(sim.live.current).status).toBe('under')
    expect(analyzeSketchDof(sim.live.current).dof).toBe(4)

    // Place an aligned distance driver (1 equation) -> 3 DOF, still under.
    const dimId = surfacePlaceDimension(sim, { kind: 'aligned', aId: 'p0', bId: 'p1' })!
    expect(analyzeSketchDof(sim.live.current).status).toBe('under')
    expect(analyzeSketchDof(sim.live.current).dof).toBe(3)
    void dimId

    // Add a horizontal constraint via the toolbar (1 equation) -> 2 DOF, under.
    expect(surfaceApplyConstraint(sim, new Set(['L']), 'horizontal')).toBe(true)
    expect(analyzeSketchDof(sim.live.current).status).toBe('under')
    expect(analyzeSketchDof(sim.live.current).dof).toBe(2)

    // Pin the two coordinates of p0 with a fix constraint (2 equations) -> 0 DOF.
    applyDesignEdit(sim, {
      ...sim.live.current,
      constraints: [
        ...sim.live.current.constraints,
        { id: 'fixp0', type: 'fix', pointId: 'p0' }
      ]
    })
    const finalReport = analyzeSketchDof(sim.live.current)
    expect(finalReport.dof).toBe(0)
    expect(finalReport.status).toBe('fully')
    // Honest label -- never a bare "Fully constrained".
    expect(finalReport.label).toBe('Fully constrained (approx)')

    // Undo the fix -> the badge drops back to under (the badge reads the live design).
    expect(surfaceUndo(sim)).toBe(true)
    expect(analyzeSketchDof(sim.live.current).status).toBe('under')
    expect(analyzeSketchDof(sim.live.current).dof).toBe(2)
  })

  it('an empty sketch reads empty (the badge hides itself)', () => {
    expect(analyzeSketchDof(emptyDesign()).status).toBe('empty')
    expect(analyzeSketchDof(emptyDesign()).label).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// (e) Persistence round-trips constraints + dimensions + parameters through the
//     Zod schema -- a saved S5 sketch reloads byte-for-byte equal.
// ─────────────────────────────────────────────────────────────────────────────

/** Save -> JSON -> parse, exactly the `design/sketch.json` round-trip. */
function roundTrip(d: DesignFileV2): DesignFileV2 {
  return designFileSchemaV2.parse(JSON.parse(JSON.stringify(d)))
}

describe('S5 e2e (e) -- persistence round-trips constraints + dimensions + parameters', () => {
  it('a sketch authored with all S5 artifacts reloads deep-equal through the schema', () => {
    // Author a sketch the way the surface would: a constraint (parallel), an
    // aligned distance driver edited to 80, and an angular driver edited to 90.
    const sim = makeSurface({
      ...emptyDesign(),
      points: {
        a0: { x: 0, y: 0 },
        a1: { x: 40, y: 6 },
        b0: { x: 0, y: 20 },
        b1: { x: 30, y: 60 },
        o: { x: 120, y: 0 },
        e1: { x: 160, y: 0 },
        e2: { x: 160, y: 40 }
      },
      entities: [
        { id: 'LA', kind: 'polyline', pointIds: ['a0', 'a1'], closed: false },
        { id: 'LB', kind: 'polyline', pointIds: ['b0', 'b1'], closed: false },
        { id: 'L1', kind: 'polyline', pointIds: ['o', 'e1'], closed: false },
        { id: 'L2', kind: 'polyline', pointIds: ['o', 'e2'], closed: false }
      ]
    })
    expect(surfaceApplyConstraint(sim, new Set(['LA', 'LB']), 'parallel')).toBe(true)
    const distDim = surfacePlaceDimension(sim, { kind: 'aligned', aId: 'a0', bId: 'a1' })!
    expect(surfaceCommitDimensionValue(sim, distDim, 80)).toBe(true)
    const angDim = surfacePlaceDimension(sim, {
      kind: 'angular',
      a1Id: 'o',
      b1Id: 'e1',
      a2Id: 'o',
      b2Id: 'e2'
    })!
    expect(surfaceCommitDimensionValue(sim, angDim, 90)).toBe(true)

    const authored = sim.live.current
    // Confirm the artifacts are all present before the round-trip.
    expect(authored.constraints.some((c) => c.type === 'parallel')).toBe(true)
    expect(authored.constraints.some((c) => c.type === 'distance')).toBe(true)
    expect(authored.constraints.some((c) => c.type === 'angle')).toBe(true)
    expect(authored.dimensions).toHaveLength(2)
    expect(Object.keys(authored.parameters).length).toBeGreaterThanOrEqual(2)

    // The round-trip preserves EVERYTHING: points, entities, constraints,
    // dimensions, and parameters -- deep-equal, no loss, no schema rejection.
    const reloaded = roundTrip(authored)
    expect(reloaded).toEqual(authored)
    expect(reloaded.constraints).toEqual(authored.constraints)
    expect(reloaded.dimensions).toEqual(authored.dimensions)
    expect(reloaded.parameters).toEqual(authored.parameters)
    expect(reloaded.points).toEqual(authored.points)

    // And the reloaded design still drives: editing a reloaded dimension re-solves.
    const sim2 = makeSurface(reloaded)
    const distC = sim2.live.current.constraints.find((c) => c.type === 'distance')!
    const distDim2 = sim2.live.current.dimensions.find(
      (dm) => dm.kind === 'aligned' && distC.type === 'distance' && dm.parameterKey === distC.parameterKey
    )!
    expect(surfaceCommitDimensionValue(sim2, distDim2.id, 120)).toBe(true)
    expect(Math.abs(segLen(sim2.live.current, 'a0', 'a1') - 120)).toBeLessThan(1e-3)
  })

  it('an annotation-only dimension (no parameterKey) also round-trips intact', () => {
    // Not every dimension drives; the schema must keep an annotation dim too.
    const d: DesignFileV2 = {
      ...emptyDesign(),
      points: { p0: { x: 0, y: 0 }, p1: { x: 25, y: 0 } },
      entities: [{ id: 'L', kind: 'polyline', pointIds: ['p0', 'p1'], closed: false }],
      dimensions: [{ id: 'dim_ann', kind: 'aligned', aId: 'p0', bId: 'p1' }]
    }
    const reloaded = roundTrip(d)
    expect(reloaded).toEqual(d)
    // applyDimensionValue refuses to drive it (no parameterKey) -> same ref.
    expect(applyDimensionValue(reloaded, 'dim_ann', 99)).toBe(reloaded)
  })
})
