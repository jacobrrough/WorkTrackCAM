/**
 * Sketch S2 -- END-TO-END data-level integration of the precision wave:
 * object snaps + node/vertex editing + the S1-fix undo model, driven through
 * the REAL pipeline modules chained exactly the way the mounted surfaces
 * chain them (no mocks of any S2 module).
 *
 * Repo tests are node-SSR (no jsdom / no pointer events), so the "drag" here
 * is the canvas's own gesture sequence replayed at the data level:
 *
 *   press   -> listEditableNodes + nearestEditableNode(nodeHandlePickToleranceMm)
 *              + collectOsnapCandidates({ excludeEntityIds: [editedEntity] })
 *              (what `beginNodeDragAtPoint` captures, gesture-scoped)
 *   release -> resolveSnappedPoint({ raw, candidates, gridMm, gridEnabled: true,
 *              osnapEnabled, toleranceMm: osnapToleranceMm(scale) })
 *              (what `resolveNodeDragPoint` runs on mouse-up)
 *   commit  -> the SketchSurface handler bodies (moveNode / insertPolylineNode /
 *              deletePolylineNode routed through the REAL sketch-history ring,
 *              one gesture = one undoable step)
 *
 * The harness bodies mirror SketchSurface.tsx line-for-line; the dxf-race
 * suite source-pins those handler bodies, and the "single pipeline" describe
 * at the bottom of THIS file pins the canvas half (gesture-scoped candidates +
 * no stray lattice `snap(` calls in any pointer path).
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyDesign, type DesignFileV2, type SketchEntity } from '../../../shared/design-schema'
import { worldCornersFromRectParams } from '../../../shared/sketch-profile'
import { createSketchHistory, type SketchHistory } from '../sketch-history'
import {
  collectOsnapCandidates,
  osnapToleranceMm,
  resolveSnappedPoint,
  type OsnapCandidate
} from '../sketch2d-osnap'
import {
  deletePolylineNode,
  insertPolylineNode,
  listEditableNodes,
  moveNode,
  nearestEditableNode,
  nearestPolylineSegment,
  nodeHandlePickToleranceMm
} from '../sketch2d-node-edit'
import { selectPickToleranceMm } from '../sketch2d-hit-test'
import { snap } from '../sketch2d-canvas-coords'
import { resolveDxfImportCommit } from '../SketchSurface'

/** Canvas defaults the mounted surface runs with (Sketch2DCanvas initial scale; SNAP_GRID_MM). */
const SCALE = 2.5
const GRID_MM = 5

// ─────────────────────────────────────────────────────────────────────────────
// Surface harness — the SketchSurface handler bodies over the REAL ring.
// (Bodies mirrored from SketchSurface.tsx; pinned there by the dxf-race suite.)
// ─────────────────────────────────────────────────────────────────────────────

interface SurfaceSim {
  readonly live: { current: DesignFileV2 }
  readonly history: SketchHistory
}

function makeSurface(design: DesignFileV2): SurfaceSim {
  return { live: { current: design }, history: createSketchHistory() }
}

/** Mirrors SketchSurface.handleNodeMove — coalesced per node, one gesture = one step. */
function surfaceNodeMove(
  sim: SurfaceSim,
  entityId: string,
  nodeId: string,
  point: readonly [number, number]
): void {
  const cur = sim.live.current
  const next = moveNode(cur, entityId, nodeId, point)
  if (next === cur) return
  sim.history.pushCoalesced(cur, `node:${entityId}:${nodeId}`)
  sim.live.current = next
}

/** Mirrors SketchSurface.handleNodeInsert — ONE plain push per insert. */
function surfaceNodeInsert(
  sim: SurfaceSim,
  entityId: string,
  segmentIndex: number,
  point: readonly [number, number],
  newPointId?: string
): void {
  const cur = sim.live.current
  const next = insertPolylineNode(cur, entityId, segmentIndex, point, newPointId)
  if (next === cur) return
  sim.history.push(cur)
  sim.live.current = next
}

/** Mirrors SketchSurface.handleNodeDelete — ONE plain push per delete. */
function surfaceNodeDelete(sim: SurfaceSim, entityId: string, nodeId: string): void {
  const cur = sim.live.current
  const next = deletePolylineNode(cur, entityId, nodeId)
  if (next === cur) return
  sim.history.push(cur)
  sim.live.current = next
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
// Canvas harness — the node-drag gesture sequence at the data level.
// ─────────────────────────────────────────────────────────────────────────────

interface NodeDragResult {
  readonly nodeId: string
  /** The resolved release point (what the ONE onNodeMove emit carries). */
  readonly placed: readonly [number, number]
  /** The winning osnap candidate, or null when the grid lattice resolved it. */
  readonly snapped: OsnapCandidate | null
}

/**
 * Replay `beginNodeDragAtPoint` (press) + `resolveNodeDragPoint` (release) for
 * the single-selected `entityId`. Returns null when the press misses every
 * handle — exactly the canvas's "not consumed" branch.
 */
function canvasNodeDrag(
  design: DesignFileV2,
  entityId: string,
  pressWorld: readonly [number, number],
  releaseRawWorld: readonly [number, number],
  osnapEnabled = true
): NodeDragResult | null {
  const entity = design.entities.find((e) => e.id === entityId)
  if (!entity) return null
  const nodes = listEditableNodes(entity, design.points)
  const hit = nearestEditableNode(nodes, pressWorld, nodeHandlePickToleranceMm(SCALE))
  if (!hit) return null
  // Gesture-scoped candidates: the edited entity is EXCLUDED so a handle can
  // never snap to the geometry it is reshaping (but CAN snap to anything else).
  const candidates = collectOsnapCandidates({ design, excludeEntityIds: [entityId] })
  const res = resolveSnappedPoint({
    raw: releaseRawWorld,
    candidates,
    gridMm: GRID_MM,
    gridEnabled: true,
    osnapEnabled,
    toleranceMm: osnapToleranceMm(SCALE)
  })
  return { nodeId: hit.nodeId, placed: res.point, snapped: res.snapped }
}

/** Replay `onCanvasDoubleClick`: segment resolves at RAW; placement through the engine. */
function canvasNodeInsertPick(
  design: DesignFileV2,
  entityId: string,
  rawWorld: readonly [number, number],
  osnapEnabled = true
): { segmentIndex: number; placed: readonly [number, number] } | null {
  const entity = design.entities.find((e) => e.id === entityId)
  if (!entity) return null
  const seg = nearestPolylineSegment(entity, design.points, rawWorld, selectPickToleranceMm(SCALE))
  if (!seg) return null
  const placed = resolveSnappedPoint({
    raw: rawWorld,
    candidates: collectOsnapCandidates({ design, excludeEntityIds: [entityId] }),
    gridMm: GRID_MM,
    gridEnabled: true,
    osnapEnabled,
    toleranceMm: osnapToleranceMm(SCALE)
  })
  return { segmentIndex: seg.segmentIndex, placed: placed.point }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario A — the classic precision-join: drag one polyline's endpoint to
// snap EXACTLY onto another polyline's endpoint, then undo, then redo.
// ─────────────────────────────────────────────────────────────────────────────

function twoPolylinesDesign(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: {
      a1: { x: 0, y: 0 },
      b1: { x: 20, y: 10 },
      // P2's endpoints sit OFF the 5 mm lattice on purpose: a grid resolution
      // could never produce these coordinates, so an exact join PROVES osnap won.
      c2: { x: 32.3, y: 17.7 },
      d2: { x: 60, y: 40 }
    },
    entities: [
      { id: 'P1', kind: 'polyline', pointIds: ['a1', 'b1'], closed: false },
      { id: 'P2', kind: 'polyline', pointIds: ['c2', 'd2'], closed: false }
    ]
  }
}

describe('S2 e2e — endpoint-to-endpoint precision join (two polylines)', () => {
  it('drag P1.b1 near P2.c2: osnap endpoint wins over the grid and the join is EXACT', () => {
    const sim = makeSurface(twoPolylinesDesign())
    const original = sim.live.current

    // Press exactly on the handle; release 1.7 mm away from the target endpoint
    // (inside the 4 mm aperture at scale 2.5), on a spot whose LATTICE point
    // (30, 20) is NOT the target — only osnap can land on (32.3, 17.7).
    const gesture = canvasNodeDrag(sim.live.current, 'P1', [20, 10], [31.1, 18.9])
    expect(gesture).not.toBeNull()
    expect(gesture!.nodeId).toBe('b1')
    expect(gesture!.snapped).not.toBeNull()
    expect(gesture!.snapped!.kind).toBe('endpoint')
    expect(gesture!.snapped!.sourceEntityIds).toEqual(['P2'])
    // The grid would have said (30, 20):
    expect([snap(31.1, GRID_MM), snap(18.9, GRID_MM)]).toEqual([30, 20])
    expect(gesture!.placed).toEqual([32.3, 17.7])

    // The ONE release emit -> the surface handler -> the real ring.
    surfaceNodeMove(sim, 'P1', gesture!.nodeId, gesture!.placed)

    const joined = sim.live.current
    expect(joined).not.toBe(original)
    // EXACT shared coordinates — the candidate value flows through unchanged,
    // so this is bit-identical (strictly stronger than the 1e-9 requirement).
    expect(joined.points.b1!.x).toBe(joined.points.c2!.x)
    expect(joined.points.b1!.y).toBe(joined.points.c2!.y)
    expect(Math.abs(joined.points.b1!.x - 32.3)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(joined.points.b1!.y - 17.7)).toBeLessThanOrEqual(1e-9)
    // P2 itself never moved — only P1's endpoint travelled.
    expect(joined.points.c2).toEqual({ x: 32.3, y: 17.7 })
    expect(joined.points.a1).toEqual({ x: 0, y: 0 })

    // ONE undoable step for the whole gesture.
    expect(sim.history.undoDepth()).toBe(1)
    expect(surfaceUndo(sim)).toBe(true)
    expect(sim.live.current).toEqual(original)
    expect(sim.live.current.points.b1).toEqual({ x: 20, y: 10 })

    // Redo restores the join exactly.
    expect(surfaceRedo(sim)).toBe(true)
    expect(sim.live.current).toEqual(joined)
    expect(sim.live.current.points.b1!.x).toBe(sim.live.current.points.c2!.x)
    expect(sim.live.current.points.b1!.y).toBe(sim.live.current.points.c2!.y)
  })

  it('the dragged entity is EXCLUDED from candidates: P1 cannot snap to itself', () => {
    const design = twoPolylinesDesign()
    const candidates = collectOsnapCandidates({ design, excludeEntityIds: ['P1'] })
    expect(candidates.some((c) => c.sourceEntityIds.includes('P1'))).toBe(false)
    // Releasing right next to P1's OWN other endpoint (a1 at 0,0) must fall to
    // the grid, not snap to the excluded entity.
    const res = resolveSnappedPoint({
      raw: [0.4, 0.6],
      candidates,
      gridMm: GRID_MM,
      gridEnabled: true,
      osnapEnabled: true,
      toleranceMm: osnapToleranceMm(SCALE)
    })
    expect(res.snapped).toBeNull()
    expect(res.point).toEqual([0, 0]) // lattice point, NOT an osnap hit
  })

  it('OSNAP off: the same gesture falls back to the grid lattice (toggle independence)', () => {
    const sim = makeSurface(twoPolylinesDesign())
    const gesture = canvasNodeDrag(sim.live.current, 'P1', [20, 10], [31.1, 18.9], false)
    expect(gesture).not.toBeNull()
    expect(gesture!.snapped).toBeNull()
    expect(gesture!.placed).toEqual([30, 20])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario B — rect corner drag: w/h recompute around the fixed opposite
// corner, with the dragged corner snapping onto a circle's CENTER.
// ─────────────────────────────────────────────────────────────────────────────

function rectAndCircleDesign(): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [
      { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 },
      // Center off the 5 mm lattice: only the osnap 'center' can place there.
      { id: 'c1', kind: 'circle', cx: 14.7, cy: 8.3, r: 3 }
    ]
  }
}

describe('S2 e2e — rect corner drag snaps to a circle center and recomputes w/h', () => {
  it('corner:2 lands on (14.7, 8.3); opposite corner pinned; w/h/cx/cy recompute; undo/redo', () => {
    const sim = makeSurface(rectAndCircleDesign())
    const original = sim.live.current

    // Press 0.45 mm from the (+w/2, +h/2) corner handle at (10, 5) — inside
    // the 2.8 mm handle aperture at scale 2.5.
    const gesture = canvasNodeDrag(sim.live.current, 'r1', [10.4, 5.2], [14.6, 8.4])
    expect(gesture).not.toBeNull()
    expect(gesture!.nodeId).toBe('param:corner:2')
    expect(gesture!.snapped).not.toBeNull()
    expect(gesture!.snapped!.kind).toBe('center')
    expect(gesture!.snapped!.sourceEntityIds).toEqual(['c1'])
    expect(gesture!.placed).toEqual([14.7, 8.3])

    surfaceNodeMove(sim, 'r1', gesture!.nodeId, gesture!.placed)

    const next = sim.live.current.entities.find((e) => e.id === 'r1')
    expect(next).toBeDefined()
    if (next?.kind !== 'rect') throw new Error('r1 must stay a rect')
    // Opposite corner (corners[0] = (-10, -5)) is the fixed anchor:
    //   w = 14.7 - (-10) = 24.7   h = 8.3 - (-5) = 13.3
    //   cx = (-10 + 14.7) / 2 = 2.35   cy = (-5 + 8.3) / 2 = 1.65
    expect(next.w).toBeCloseTo(24.7, 9)
    expect(next.h).toBeCloseTo(13.3, 9)
    expect(next.cx).toBeCloseTo(2.35, 9)
    expect(next.cy).toBeCloseTo(1.65, 9)
    expect(next.rotation).toBe(0)
    const corners = worldCornersFromRectParams(next)
    // The dragged corner sits on the circle center to 1e-9 …
    expect(Math.abs(corners[2]![0] - 14.7)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(corners[2]![1] - 8.3)).toBeLessThanOrEqual(1e-9)
    // … and the opposite corner never moved.
    expect(Math.abs(corners[0]![0] - -10)).toBeLessThanOrEqual(1e-9)
    expect(Math.abs(corners[0]![1] - -5)).toBeLessThanOrEqual(1e-9)
    // The circle is untouched.
    expect(sim.live.current.entities.find((e) => e.id === 'c1')).toEqual(
      original.entities.find((e) => e.id === 'c1')
    )

    // One gesture = one step; undo restores the 20x10 rect; redo reshapes again.
    expect(sim.history.undoDepth()).toBe(1)
    expect(surfaceUndo(sim)).toBe(true)
    expect(sim.live.current).toEqual(original)
    expect(surfaceRedo(sim)).toBe(true)
    const redone = sim.live.current.entities.find((e) => e.id === 'r1')
    if (redone?.kind !== 'rect') throw new Error('r1 must stay a rect')
    expect(redone.w).toBeCloseTo(24.7, 9)
    expect(redone.h).toBeCloseTo(13.3, 9)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario C — insert a node on a CLOSED polyline (wrap segment), delete it,
// and prove loop integrity end-to-end through the history.
// ─────────────────────────────────────────────────────────────────────────────

function closedTriangleDesign(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: {
      t1: { x: 0, y: 0 },
      t2: { x: 30, y: 0 },
      t3: { x: 15, y: 20 }
    },
    entities: [{ id: 'T', kind: 'polyline', pointIds: ['t1', 't2', 't3'], closed: true }]
  }
}

describe('S2 e2e — closed-loop node insert then delete (loop integrity)', () => {
  it('double-click the wrap segment inserts; delete prunes; the loop survives intact', () => {
    const sim = makeSurface(closedTriangleDesign())
    const original = sim.live.current

    // Double-click 0.42 mm from the wrap segment t3->t1 (inside the 3.2 mm
    // segment aperture). No other entity exists, so the placement falls to the
    // grid lattice: (7.2, 10.3) -> (5, 10).
    const pick = canvasNodeInsertPick(sim.live.current, 'T', [7.2, 10.3])
    expect(pick).not.toBeNull()
    expect(pick!.segmentIndex).toBe(2) // the closing (wrap) segment
    expect(pick!.placed).toEqual([5, 10])

    surfaceNodeInsert(sim, 'T', pick!.segmentIndex, pick!.placed, 'ins-1')

    const inserted = sim.live.current
    const tAfterInsert = inserted.entities.find((e) => e.id === 'T')
    if (tAfterInsert?.kind !== 'polyline' || !('pointIds' in tAfterInsert)) {
      throw new Error('T must stay a point-id polyline')
    }
    // Wrap-segment insert appends after the LAST vertex; the loop stays closed.
    expect(tAfterInsert.pointIds).toEqual(['t1', 't2', 't3', 'ins-1'])
    expect(tAfterInsert.closed).toBe(true)
    expect(inserted.points['ins-1']).toEqual({ x: 5, y: 10 })

    // Delete the armed node — the second one-step mutation.
    surfaceNodeDelete(sim, 'T', 'ins-1')
    const afterDelete = sim.live.current
    const tAfterDelete = afterDelete.entities.find((e) => e.id === 'T')
    if (tAfterDelete?.kind !== 'polyline' || !('pointIds' in tAfterDelete)) {
      throw new Error('T must stay a point-id polyline')
    }
    expect(tAfterDelete.pointIds).toEqual(['t1', 't2', 't3'])
    expect(tAfterDelete.closed).toBe(true)
    // The minted record was pruned (nothing else referenced it) — no orphan leak.
    expect(afterDelete.points['ins-1']).toBeUndefined()
    expect(afterDelete).toEqual(original)

    // Integrity floor: a 3-vertex closed loop refuses another delete (same ref).
    expect(deletePolylineNode(afterDelete, 'T', 't1')).toBe(afterDelete)

    // Insert and delete were SEPARATE one-step entries.
    expect(sim.history.undoDepth()).toBe(2)
    expect(surfaceUndo(sim)).toBe(true) // back to the inserted state
    expect(sim.live.current).toEqual(inserted)
    expect(surfaceUndo(sim)).toBe(true) // back to the original triangle
    expect(sim.live.current).toEqual(original)
    expect(surfaceRedo(sim)).toBe(true)
    expect(sim.live.current).toEqual(inserted)
    expect(surfaceRedo(sim)).toBe(true)
    expect(sim.live.current).toEqual(afterDelete)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Scenario D — the S1 DXF race fix exercised THROUGH the history, three times
// over, under the exact stale-flush ordering that used to skip the undo step.
// ─────────────────────────────────────────────────────────────────────────────

/** One settled import under the RACE ordering (live ref NOT yet flushed). */
function settleImport(sim: SurfaceSim, merged: DesignFileV2): boolean {
  const before = sim.live.current
  // The host resolved `merged`; React has NOT re-rendered, so liveAfter is the
  // stale `before` — the exact ordering that broke the S1 live-ref comparison.
  const commit = resolveDxfImportCommit(before, merged, before)
  sim.live.current = commit.live
  if (commit.record) sim.history.push(before)
  return commit.record
}

function withImportedRect(base: DesignFileV2, id: string): DesignFileV2 {
  const imported: SketchEntity = {
    id,
    kind: 'rect',
    cx: 100,
    cy: 100,
    w: 10,
    h: 10,
    rotation: 0
  }
  return { ...base, entities: [...base.entities, imported] }
}

describe('S2 e2e — DXF import undo determinism (the S1 race fix), repeated 3x', () => {
  it('import -> undo removes the imported entities, identically on all 3 rounds', () => {
    const sim = makeSurface(twoPolylinesDesign())
    for (let round = 1; round <= 3; round++) {
      const before = sim.live.current
      const id = `dxf-${round}`
      const recorded = settleImport(sim, withImportedRect(before, id))

      // DETERMINISTIC: every round records exactly one step (the old live-ref
      // comparison recorded zero under this ordering — flaky by construction).
      expect(recorded).toBe(true)
      expect(sim.live.current.entities.some((e) => e.id === id)).toBe(true)

      expect(surfaceUndo(sim)).toBe(true)
      expect(sim.live.current.entities.some((e) => e.id === id)).toBe(false)
      expect(sim.live.current).toEqual(before)
    }
    expect(sim.history.undoDepth()).toBe(0)
  })

  it('three stacked imports unwind in order and redo in order', () => {
    const sim = makeSurface(closedTriangleDesign())
    const original = sim.live.current
    for (let round = 1; round <= 3; round++) {
      expect(settleImport(sim, withImportedRect(sim.live.current, `dxf-${round}`))).toBe(true)
    }
    const allThree = sim.live.current
    expect(allThree.entities.map((e) => e.id)).toEqual(['T', 'dxf-1', 'dxf-2', 'dxf-3'])
    expect(sim.history.undoDepth()).toBe(3)

    expect(surfaceUndo(sim)).toBe(true)
    expect(sim.live.current.entities.map((e) => e.id)).toEqual(['T', 'dxf-1', 'dxf-2'])
    expect(surfaceUndo(sim)).toBe(true)
    expect(sim.live.current.entities.map((e) => e.id)).toEqual(['T', 'dxf-1'])
    expect(surfaceUndo(sim)).toBe(true)
    expect(sim.live.current).toEqual(original)

    expect(surfaceRedo(sim)).toBe(true)
    expect(surfaceRedo(sim)).toBe(true)
    expect(surfaceRedo(sim)).toBe(true)
    expect(sim.live.current).toEqual(allThree)

    // A cancelled picker between rounds records nothing (no phantom steps).
    const depth = sim.history.undoDepth()
    expect(settleImport(sim, sim.live.current)).toBe(false)
    expect(sim.history.undoDepth()).toBe(depth)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The SINGLE pointer pipeline — source guard. Drawing tools, S1 drag-move,
// node drags, and node inserts all resolve through the shared osnap engine;
// the ONLY raw lattice `snap(` calls left in the live canvas are the TYPED
// numeric dimension fields (which are not pointer placements).
// ─────────────────────────────────────────────────────────────────────────────

const CANVAS_SRC = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')
const MVP_BANNER = '// MvpSketchCanvas (CAD V1 MVP sketcher)'

describe('S2 e2e — ONE pointer pipeline (no duplicate snap logic in the live canvas)', () => {
  const live = CANVAS_SRC.slice(0, CANVAS_SRC.indexOf(MVP_BANNER))

  it('the live region exists and the MVP banner still fences it', () => {
    expect(CANVAS_SRC.indexOf(MVP_BANNER)).toBeGreaterThan(0)
    expect(live.length).toBeGreaterThan(1000)
  })

  it('exactly 6 raw snap( calls remain, ALL in typed numeric-entry paths', () => {
    // applyLineNumeric (dX + dY), syncRectDragFromInputs (W + H),
    // finalizeCircleDrag (typed R), and the circle R input onChange. Adding a
    // 7th raw call means a pointer path bypassed resolveSnappedPoint — route
    // it through the shared engine instead.
    const calls = live.match(/\bsnap\(/g) ?? []
    expect(calls).toHaveLength(6)
    const numericEntrySlices = [
      live.slice(live.indexOf('const applyLineNumeric'), live.indexOf('const syncRectDragFromInputs')),
      live.slice(live.indexOf('const syncRectDragFromInputs'), live.indexOf('const finalizeRectDrag')),
      live.slice(live.indexOf('const finalizeCircleDrag'), live.indexOf('function onWheel')),
      live.slice(live.indexOf("value={circleRIn}"), live.indexOf('Place\n          </button>\n        </div>\n      )}\n      {activeTool === \'select\''))
    ]
    const accounted = numericEntrySlices.reduce(
      (n, s) => n + (s.match(/\bsnap\(/g) ?? []).length,
      0
    )
    expect(accounted).toBe(6)
  })

  it('every gesture path resolves through the shared engine (placement, S1 drag, node drag, insert)', () => {
    // Drawing-tool placement (mousedown) + crosshair/hover (mousemove):
    expect(live).toContain('const w: [number, number] = resolvePointerPlacement(raw).point')
    expect(live).toContain('const res = resolvePointerPlacement(raw)')
    // S1 entity drag-move: ghost AND release run the same selection-excluded call:
    expect(live.match(/resolveSelectDragDelta\(sd, raw\)/g) ?? []).toHaveLength(2)
    // Node-handle drag: ghost AND release run the same gesture-scoped call:
    expect(live).toContain('const nodeRes = resolveNodeDragPoint(nd, raw)')
    expect(live).toContain('const placed = resolveNodeDragPoint(nd, nraw).point')
    // Double-click insert placement routes through resolveSnappedPoint too:
    expect(live).toContain('const placed = resolveSnappedPoint({')
    // The S1 lattice fallback lives ONLY inside the engine — never inlined here:
    expect(live).not.toContain('snappedDragDelta')
  })

  it('node-drag candidates are captured at PRESS with the edited entity excluded', () => {
    const begin = live.slice(
      live.indexOf('const beginNodeDragAtPoint'),
      live.indexOf('const cancelNodeGestureOnEscape')
    )
    expect(begin).toContain(
      'osnapCandidates: collectOsnapCandidates({ design, excludeEntityIds: [nodeEditEntity.id] })'
    )
  })

  it('all three gesture markers share ONE render slot (setOsnapHover -> osnapMarker)', () => {
    expect(live).toContain('setOsnapHover(nodeRes.snapped)')
    expect(live).toContain('setOsnapHover(dragRes.snapped)')
    expect(live).toContain('setOsnapHover(markerEligible ? res.snapped : null)')
    expect(live).toContain('osnapMarker: osnapHover,')
  })
})
