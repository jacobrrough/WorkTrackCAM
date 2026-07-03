/**
 * PROJECT MODEL EDGES INTO SKETCH (Fusion's Project / P) — pure-module contract.
 *
 * Pins the load-bearing behavior of `projectEdgesOntoSketch` (the last Phase-3
 * parity item, docs/PARITY-ROADMAP.md):
 *   1. PROJECTION MATH — orthogonal projection onto datum XY / YZ planes AND a
 *      rotated face plane, using the SAME world→sketch mapping the face-sketch
 *      placement uses (`worldPointToSketchMm`). Expected 2D values verified
 *      against that mapping directly (see the header of each block).
 *   2. FILTERS — perpendicular-edge skip, degenerate (< tolerance) filter,
 *      consecutive-point dedupe, coincident-segment dedupe.
 *   3. EMISSION — construction flag set, `closed: false`, deterministic
 *      `proj_<edgeId>` ids (entities + points), straight-edge → 2-point line,
 *      curved-edge → N-point polyline.
 *   4. IDEMPOTENT RE-PROJECTION — projecting twice replaces prior copies in
 *      place (no duplication); authored geometry is never disturbed.
 *   5. PROFILE-EXCLUSION REGRESSION — a projected rectangle (4 construction
 *      lines) does NOT create a kernel profile (construction + open ⇒ excluded).
 *
 * Env: `node` (no DOM). Pure module; `three` is the only heavy import (via the
 * placement helper the projection reuses).
 */

import { describe, expect, it } from 'vitest'
import { emptyDesign, type DesignFileV2, type SketchPlane } from '../../../shared/design-schema'
import { extractKernelProfiles } from '../../../shared/sketch-profile'
import {
  projectEdgesOntoSketch,
  projectedEdgeIdSet,
  PROJECTED_ID_PREFIX,
  type ProjectableEdge
} from '../sketch-project-edges'

const XY: SketchPlane = { kind: 'datum', datum: 'XY' }
const YZ: SketchPlane = { kind: 'datum', datum: 'YZ' }
/** Rotated face plane: normal +X, xAxis +Y ⇒ world (x,y,z) → sketch (y, z), world-X dropped. */
const FACE_X: SketchPlane = {
  kind: 'face',
  origin: [2, 0, 0],
  normal: [1, 0, 0],
  xAxis: [0, 1, 0]
}

function designOn(plane: SketchPlane, base: Partial<DesignFileV2> = {}): DesignFileV2 {
  return { ...emptyDesign(), sketchPlane: plane, ...base }
}

/** Shorthand: a straight edge from a→b (3D world mm). */
function edge(id: string, a: [number, number, number], b: [number, number, number]): ProjectableEdge {
  return { id, points: [a, b] }
}

/** Pull the projected polyline entity for a source edge id. */
function proj(design: DesignFileV2, edgeId: string) {
  return design.entities.find((e) => e.id === `${PROJECTED_ID_PREFIX}${edgeId}`)
}

/** Resolve a projected entity's point positions in order. */
function projPts(design: DesignFileV2, edgeId: string): Array<[number, number]> {
  const e = proj(design, edgeId)
  if (!e || e.kind !== 'polyline' || !('pointIds' in e)) return []
  return e.pointIds.map((pid) => {
    const p = design.points[pid]!
    return [p.x, p.y]
  })
}

// ── 1. Projection math — datum planes ────────────────────────────────────────

describe('projectEdgesOntoSketch — datum-plane projection math', () => {
  it('XY datum: world (x,y,z) → sketch (x, -z); world-Y (the normal) is dropped', () => {
    const d = designOn(XY)
    // Two points differing in Y AND z; on XY the Y is dropped so both keep x and map z→-z.
    const r = projectEdgesOntoSketch(d, [edge('e1', [5, 9, 3], [20, -4, 8])])
    expect(r.projected).toBe(1)
    expect(projPts(r.design, 'e1')).toEqual([
      [5, -3],
      [20, -8]
    ])
  })

  it('YZ datum: world (x,y,z) → sketch (y, z); world-X is dropped', () => {
    const d = designOn(YZ)
    const r = projectEdgesOntoSketch(d, [edge('e1', [5, 9, 3], [50, 11, 7])])
    expect(r.projected).toBe(1)
    expect(projPts(r.design, 'e1')).toEqual([
      [9, 3],
      [11, 7]
    ])
  })
})

// ── 2. Projection math — rotated face plane ──────────────────────────────────

describe('projectEdgesOntoSketch — rotated face-plane projection', () => {
  it('face (normal +X, xAxis +Y): world (x,y,z) → sketch (y, z), world-X dropped', () => {
    const d = designOn(FACE_X)
    const r = projectEdgesOntoSketch(d, [edge('e1', [12, 7, 4], [30, 15, 9])])
    expect(r.projected).toBe(1)
    expect(projPts(r.design, 'e1')).toEqual([
      [7, 4],
      [15, 9]
    ])
  })

  it('an edge along the face normal (differs only in world-X) collapses → SKIPPED', () => {
    const d = designOn(FACE_X)
    // Both endpoints share (y,z) = (7,4); only world-X differs → projects to one point.
    const r = projectEdgesOntoSketch(d, [edge('perp', [12, 7, 4], [99, 7, 4])])
    expect(r.projected).toBe(0)
    expect(r.skipped).toBe(1)
    expect(proj(r.design, 'perp')).toBeUndefined()
  })
})

// ── 3. Perpendicular / degenerate skip ───────────────────────────────────────

describe('projectEdgesOntoSketch — perpendicular / degenerate filter', () => {
  it('XY datum: an edge parallel to the +Y normal projects to a point → SKIPPED', () => {
    const d = designOn(XY)
    // Differs only in world-Y (the XY normal) → same (x, -z) → degenerate.
    const r = projectEdgesOntoSketch(d, [edge('perp', [5, 0, 3], [5, 40, 3])])
    expect(r.projected).toBe(0)
    expect(r.skipped).toBe(1)
  })

  it('a sub-tolerance-length projected segment is skipped, not emitted degenerate', () => {
    const d = designOn(XY)
    // Projected length on XY = |Δx, -Δz| = |0.01, 0| = 0.01 < default tol 0.05.
    const r = projectEdgesOntoSketch(d, [edge('tiny', [5, 0, 3], [5.01, 0, 3])])
    expect(r.projected).toBe(0)
    expect(r.skipped).toBe(1)
  })

  it('an edge with fewer than 2 samples is skipped', () => {
    const d = designOn(XY)
    const r = projectEdgesOntoSketch(d, [{ id: 'oneish', points: [[0, 0, 0]] }])
    expect(r.skipped).toBe(1)
    expect(r.projected).toBe(0)
  })
})

// ── 4. Consecutive-point dedupe + straightness collapse ──────────────────────

describe('projectEdgesOntoSketch — dedupe + straightness collapse', () => {
  it('collapses consecutive near-coincident projected points', () => {
    const d = designOn(XY)
    // Three samples; the middle projects within tol of the first (Δ = 0.001).
    const e: ProjectableEdge = {
      id: 'curve',
      points: [
        [0, 0, 0],
        [0.001, 5, 0], // world-Y differs but is dropped → ~(0.001, 0), within tol of (0,0)
        [10, 0, 0]
      ]
    }
    const r = projectEdgesOntoSketch(d, [e])
    expect(r.projected).toBe(1)
    // After dedupe the run is [(0,0),(10,0)] → a straight 2-point line.
    expect(projPts(r.design, 'curve')).toEqual([
      [0, 0],
      [10, 0]
    ])
  })

  it('a straight 3-point edge collapses to a 2-point line (endpoints only)', () => {
    const d = designOn(YZ)
    const e: ProjectableEdge = {
      id: 'straight3',
      points: [
        [0, 0, 0],
        [0, 5, 5], // on YZ → (5,5): lies exactly on the chord (0,0)-(10,10)
        [0, 10, 10]
      ]
    }
    const r = projectEdgesOntoSketch(d, [e])
    const e2 = proj(r.design, 'straight3')
    expect(e2?.kind).toBe('polyline')
    expect(projPts(r.design, 'straight3')).toEqual([
      [0, 0],
      [10, 10]
    ])
  })

  it('a genuinely curved edge keeps its interior samples (N-point polyline)', () => {
    const d = designOn(YZ)
    const e: ProjectableEdge = {
      id: 'arc',
      points: [
        [0, 0, 0],
        [0, 5, 8], // (5,8) is far off the chord (0,0)-(10,0) → not straight
        [0, 10, 0]
      ]
    }
    const r = projectEdgesOntoSketch(d, [e])
    expect(projPts(r.design, 'arc')).toEqual([
      [0, 0],
      [5, 8],
      [10, 0]
    ])
  })
})

// ── 5. Coincident-segment dedupe ─────────────────────────────────────────────

describe('projectEdgesOntoSketch — coincident-segment dedupe', () => {
  it('two edges projecting to the SAME segment emit once; the second is deduped', () => {
    const d = designOn(XY)
    // Both project to the segment (0,0)-(10,0) on XY (only world-Y differs, dropped).
    const r = projectEdgesOntoSketch(d, [
      edge('a', [0, 1, 0], [10, 1, 0]),
      edge('b', [0, 99, 0], [10, 99, 0])
    ])
    expect(r.projected).toBe(1)
    expect(r.deduped).toBe(1)
    // The FIRST edge (source order) wins the id.
    expect(proj(r.design, 'a')).toBeDefined()
    expect(proj(r.design, 'b')).toBeUndefined()
  })

  it('reversed-orientation duplicates still dedupe (order-independent key)', () => {
    const d = designOn(XY)
    const r = projectEdgesOntoSketch(d, [
      edge('fwd', [0, 0, 0], [10, 0, 0]),
      edge('rev', [10, 5, 0], [0, 5, 0]) // same segment, reversed + different world-Y
    ])
    expect(r.projected).toBe(1)
    expect(r.deduped).toBe(1)
  })
})

// ── 6. Emission — construction flag, closed:false, deterministic ids ─────────

describe('projectEdgesOntoSketch — entity emission', () => {
  it('emits a construction, open polyline with deterministic proj_<edgeId> ids', () => {
    const d = designOn(XY)
    const r = projectEdgesOntoSketch(d, [edge('e:abc', [0, 0, 0], [10, 0, 5])])
    const e = proj(r.design, 'e:abc')
    expect(e).toBeDefined()
    expect(e!.kind).toBe('polyline')
    expect(e!.construction).toBe(true)
    if (e!.kind === 'polyline' && 'pointIds' in e!) {
      expect(e!.closed).toBe(false)
      expect(e!.id).toBe('proj_e:abc')
      expect(e!.pointIds).toEqual(['proj_e:abc_p0', 'proj_e:abc_p1'])
    }
  })

  it('does NOT mutate the input design', () => {
    const d = designOn(XY)
    const before = JSON.stringify(d)
    projectEdgesOntoSketch(d, [edge('e1', [0, 0, 0], [10, 0, 5])])
    expect(JSON.stringify(d)).toBe(before)
  })

  it('projectedEdgeIdSet returns the source-edge id set (idempotency key basis)', () => {
    const set = projectedEdgeIdSet([edge('e1', [0, 0, 0], [1, 0, 0]), edge('e2', [0, 0, 0], [0, 1, 0])])
    expect(set).toEqual(new Set(['e1', 'e2']))
  })
})

// ── 7. Idempotent re-projection ──────────────────────────────────────────────

describe('projectEdgesOntoSketch — idempotent re-projection', () => {
  it('projecting the same edge twice REPLACES (no duplicate entities/points)', () => {
    const d = designOn(XY)
    const edges = [edge('e1', [0, 0, 0], [10, 0, 5])]
    const once = projectEdgesOntoSketch(d, edges).design
    const twice = projectEdgesOntoSketch(once, edges).design
    // Exactly one projected entity + two points, both times.
    const projEntities = twice.entities.filter((e) => e.id.startsWith('proj_'))
    const projPoints = Object.keys(twice.points).filter((k) => k.startsWith('proj_'))
    expect(projEntities).toHaveLength(1)
    expect(projPoints).toHaveLength(2)
  })

  it('re-projecting a MOVED edge refreshes the geometry in place (same id, new coords)', () => {
    const d = designOn(XY)
    const first = projectEdgesOntoSketch(d, [edge('e1', [0, 0, 0], [10, 0, 5])]).design
    expect(projPts(first, 'e1')).toEqual([
      [0, 0],
      [10, -5]
    ])
    // Model changed: same edge id, new world coords.
    const second = projectEdgesOntoSketch(first, [edge('e1', [0, 0, 0], [20, 0, 9])]).design
    expect(projPts(second, 'e1')).toEqual([
      [0, 0],
      [20, -9]
    ])
    expect(second.entities.filter((e) => e.id === 'proj_e1')).toHaveLength(1)
  })

  it('never disturbs authored (non-projected) geometry', () => {
    const authored: DesignFileV2 = designOn(XY, {
      points: { a: { x: 1, y: 2 } },
      entities: [{ id: 'user-rect', kind: 'rect', cx: 0, cy: 0, w: 5, h: 5, rotation: 0 }]
    })
    const r = projectEdgesOntoSketch(authored, [edge('e1', [0, 0, 0], [10, 0, 5])])
    expect(r.design.entities.find((e) => e.id === 'user-rect')).toEqual(authored.entities[0])
    expect(r.design.points['a']).toEqual({ x: 1, y: 2 })
  })
})

// ── 8. Profile-exclusion regression (the daily-use safety invariant) ─────────

describe('projectEdgesOntoSketch — projected geometry is EXCLUDED from profiles', () => {
  it('a projected rectangle (4 construction lines) creates NO kernel profile', () => {
    const d = designOn(XY)
    // Four edges that project to a closed square on XY (world-Y dropped): but each
    // is emitted as a SEPARATE open construction polyline, so nothing derives.
    const square: ProjectableEdge[] = [
      edge('s0', [0, 0, 0], [10, 0, 0]),
      edge('s1', [10, 0, 0], [10, 0, 10]),
      edge('s2', [10, 0, 10], [0, 0, 10]),
      edge('s3', [0, 0, 10], [0, 0, 0])
    ]
    const r = projectEdgesOntoSketch(d, square)
    expect(r.projected).toBe(4)
    // Every projected entity is construction + open → extractKernelProfiles skips them.
    for (const e of r.design.entities.filter((x) => x.id.startsWith('proj_'))) {
      expect(e.construction).toBe(true)
      if (e.kind === 'polyline' && 'closed' in e) expect(e.closed).toBe(false)
    }
    // No profiles derived from the projected-only sketch.
    expect(extractKernelProfiles(r.design)).toBeNull()
  })

  it('a real authored profile still derives alongside projected edges (no false exclusion)', () => {
    const authored: DesignFileV2 = designOn(XY, {
      entities: [{ id: 'real-rect', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 }]
    })
    const r = projectEdgesOntoSketch(authored, [edge('e1', [0, 0, 0], [10, 0, 5])])
    const profiles = extractKernelProfiles(r.design)
    // Exactly the authored rect derives; the projected construction line does not.
    expect(profiles).not.toBeNull()
    expect(profiles!).toHaveLength(1)
  })
})
