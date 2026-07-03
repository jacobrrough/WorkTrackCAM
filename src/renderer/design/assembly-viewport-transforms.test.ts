/**
 * assembly-viewport-transforms — pure render-state math unit pins.
 *
 * These are node-env tests (no DOM / R3F Canvas). They pin the load-bearing
 * contracts the {@link AssemblyViewport3D} scene relies on:
 *   - pose→matrix composition (position + Euler-ZYX),
 *   - playback-override precedence over the part transform,
 *   - explode offset along the configured axis (view-only factor),
 *   - interference tint set from a report,
 *   - colour-role precedence (clash > selected > grounded > default),
 *   - the fallback-box path (blank-handle rows still render a nominal box).
 */

import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import type { MotionPoseTransform } from './assembly-motion-playback'
import {
  DEFAULT_TRIANGLE_BUDGET,
  FALLBACK_BOX_HALF_EXTENT_MM,
  computePartRenderStates,
  explodeTranslationMm,
  interferenceTintIds,
  poseToMatrix,
  resolveColorRole,
  resolvePartGeometry,
  resolvePartPose,
  summarizeRenderTiers,
  type AssemblyViewportPart,
  type ExplodeConfig,
  type PartGeometryDescriptor,
  type PartMeshGeometry
} from './assembly-viewport-transforms'

const part = (o: Partial<AssemblyViewportPart> = {}): AssemblyViewportPart => ({
  id: 'p1',
  name: 'Bracket',
  handle: 'script:abc',
  ...o
})

const pose = (o: Partial<MotionPoseTransform> = {}): MotionPoseTransform => ({
  x: 0,
  y: 0,
  z: 0,
  rxDeg: 0,
  ryDeg: 0,
  rzDeg: 0,
  ...o
})

describe('poseToMatrix', () => {
  it('places the origin at the given position (translation column)', () => {
    const m = poseToMatrix([10, 20, 30], [0, 0, 0])
    const p = new Vector3().setFromMatrixPosition(m)
    expect(p.x).toBeCloseTo(10, 6)
    expect(p.y).toBeCloseTo(20, 6)
    expect(p.z).toBeCloseTo(30, 6)
  })

  it('rotates a local +X point about world Z by 90° (ZYX convention)', () => {
    // A 90° Z rotation maps local +X → world +Y.
    const m = poseToMatrix([0, 0, 0], [0, 0, 90])
    const v = new Vector3(1, 0, 0).applyMatrix4(m)
    expect(v.x).toBeCloseTo(0, 5)
    expect(v.y).toBeCloseTo(1, 5)
    expect(v.z).toBeCloseTo(0, 5)
  })

  it('is defensive against non-finite inputs (treats them as 0)', () => {
    const m = poseToMatrix([Number.NaN, 5, Infinity], [Number.NaN, 0, 0])
    const p = new Vector3().setFromMatrixPosition(m)
    expect(p.x).toBe(0)
    expect(p.y).toBeCloseTo(5, 6)
    expect(p.z).toBe(0)
  })
})

describe('resolvePartPose — playback override precedence', () => {
  it('uses the part transform when no overlay is present', () => {
    const r = resolvePartPose(part({ transform: { position: [3, 4, 5] } }), null)
    expect(r.position).toEqual([3, 4, 5])
    expect(r.rotationDeg).toEqual([0, 0, 0])
    expect(r.fromPlayback).toBe(false)
  })

  it('OVERRIDES the part transform when the overlay carries a pose for the id', () => {
    const overlay = new Map<string, MotionPoseTransform>([
      ['p1', pose({ x: 100, rzDeg: 45 })]
    ])
    const r = resolvePartPose(part({ transform: { position: [3, 4, 5] } }), overlay)
    expect(r.position).toEqual([100, 0, 0])
    expect(r.rotationDeg).toEqual([0, 0, 45])
    expect(r.fromPlayback).toBe(true)
  })

  it('falls back to the part transform when the overlay lacks THIS id', () => {
    const overlay = new Map<string, MotionPoseTransform>([['other', pose({ x: 9 })]])
    const r = resolvePartPose(part({ transform: { position: [1, 2, 3] } }), overlay)
    expect(r.position).toEqual([1, 2, 3])
    expect(r.fromPlayback).toBe(false)
  })

  it('treats an absent transform as identity at the origin', () => {
    const r = resolvePartPose(part({ transform: undefined }), null)
    expect(r.position).toEqual([0, 0, 0])
    expect(r.rotationDeg).toEqual([0, 0, 0])
  })
})

describe('explodeTranslationMm', () => {
  const cfg = (o: Partial<ExplodeConfig> = {}): ExplodeConfig => ({
    axis: 'z',
    stepMm: 10,
    factor: 1,
    ...o
  })

  it('returns zero offset for a null config', () => {
    expect(explodeTranslationMm(null, 3)).toEqual([0, 0, 0])
  })

  it('returns zero offset at factor 0 (assembled)', () => {
    expect(explodeTranslationMm(cfg({ factor: 0 }), 3)).toEqual([0, 0, 0])
  })

  it('spreads along the configured axis by index * step * factor', () => {
    expect(explodeTranslationMm(cfg({ axis: 'z', stepMm: 10, factor: 1 }), 2)).toEqual([0, 0, 20])
    expect(explodeTranslationMm(cfg({ axis: 'x', stepMm: 5, factor: 1 }), 3)).toEqual([15, 0, 0])
    expect(explodeTranslationMm(cfg({ axis: 'y', stepMm: 8, factor: 0.5 }), 2)).toEqual([0, 8, 0])
  })

  it('clamps the factor into [0,1] (via the shared explodeOffsetMm)', () => {
    // factor 2 clamps to 1 → same as factor 1.
    expect(explodeTranslationMm(cfg({ axis: 'z', stepMm: 10, factor: 2 }), 1)).toEqual([0, 0, 10])
  })

  it('index 0 never separates (the anchor stays put)', () => {
    expect(explodeTranslationMm(cfg({ factor: 1 }), 0)).toEqual([0, 0, 0])
  })

  it('returns zero offset when stepMm is non-positive', () => {
    expect(explodeTranslationMm(cfg({ stepMm: 0, factor: 1 }), 5)).toEqual([0, 0, 0])
  })
})

describe('interferenceTintIds', () => {
  it('returns an empty set for a null report', () => {
    expect(interferenceTintIds(null).size).toBe(0)
  })

  it('collects both ids from every clashing pair', () => {
    const ids = interferenceTintIds({
      clashingPairs: [
        { aId: 'a', bId: 'b' },
        { aId: 'b', bId: 'c' }
      ]
    })
    expect([...ids].sort()).toEqual(['a', 'b', 'c'])
  })

  it('is empty when there are no clashing pairs', () => {
    expect(interferenceTintIds({ clashingPairs: [] }).size).toBe(0)
  })
})

describe('resolveColorRole — precedence', () => {
  it('clash wins over selected and grounded', () => {
    expect(resolveColorRole({ clashing: true, selected: true, grounded: true })).toBe('clash')
  })
  it('selected wins over grounded', () => {
    expect(resolveColorRole({ clashing: false, selected: true, grounded: true })).toBe('selected')
  })
  it('grounded shows when neither clash nor selected', () => {
    expect(resolveColorRole({ clashing: false, selected: false, grounded: true })).toBe('grounded')
  })
  it('default otherwise', () => {
    expect(resolveColorRole({ clashing: false, selected: false, grounded: false })).toBe('default')
  })
})

describe('computePartRenderStates', () => {
  it('renders one state per part with the nominal fallback box (no descriptors)', () => {
    const states = computePartRenderStates([part({ id: 'p1' }), part({ id: 'p2' })], {})
    expect(states.map((s) => s.id)).toEqual(['p1', 'p2'])
    for (const s of states) {
      expect(s.renderTier).toBe('nominal')
      expect(s.geometry.tier).toBe('nominal')
      expect(s.halfExtentsMm).toEqual([
        FALLBACK_BOX_HALF_EXTENT_MM,
        FALLBACK_BOX_HALF_EXTENT_MM,
        FALLBACK_BOX_HALF_EXTENT_MM
      ])
      expect(s.geometry.centerOffsetMm).toEqual([0, 0, 0])
    }
  })

  it('renders a blank-handle (hydrated-from-disk) row as the fallback box (no silent blank)', () => {
    const states = computePartRenderStates([part({ id: 'p1', handle: '' })], {})
    expect(states).toHaveLength(1)
    expect(states[0]!.halfExtentsMm[0]).toBe(FALLBACK_BOX_HALF_EXTENT_MM)
  })

  it('applies the explode offset ADDED to the part transform position', () => {
    const states = computePartRenderStates(
      [part({ id: 'p1', transform: { position: [5, 0, 0] } }), part({ id: 'p2' })],
      { explode: { axis: 'z', stepMm: 10, factor: 1 } }
    )
    // p1 index 0 → no separation; keeps its [5,0,0].
    const p1 = new Vector3().setFromMatrixPosition(states[0]!.matrix)
    expect([p1.x, p1.y, p1.z]).toEqual([5, 0, 0])
    // p2 index 1 → +10 on Z.
    const p2 = new Vector3().setFromMatrixPosition(states[1]!.matrix)
    expect(p2.z).toBeCloseTo(10, 6)
  })

  it('playback overlay overrides the transform in the composed matrix', () => {
    const overlay = new Map<string, MotionPoseTransform>([['p1', pose({ x: 42 })]])
    const states = computePartRenderStates(
      [part({ id: 'p1', transform: { position: [5, 0, 0] } })],
      { playbackOverlay: overlay }
    )
    const p = new Vector3().setFromMatrixPosition(states[0]!.matrix)
    expect(p.x).toBeCloseTo(42, 6)
    expect(states[0]!.fromPlayback).toBe(true)
  })

  it('marks clashing + selected + grounded flags and resolves the role', () => {
    const states = computePartRenderStates(
      [
        part({ id: 'p1', grounded: true }),
        part({ id: 'p2' }),
        part({ id: 'p3' })
      ],
      { clashIds: new Set(['p2']), selectedId: 'p3' }
    )
    // p1 grounded only.
    expect(states[0]!.grounded).toBe(true)
    expect(states[0]!.colorRole).toBe('grounded')
    // p2 clashing → clash role.
    expect(states[1]!.clashing).toBe(true)
    expect(states[1]!.colorRole).toBe('clash')
    // p3 selected → selected role.
    expect(states[2]!.selected).toBe(true)
    expect(states[2]!.colorRole).toBe('selected')
  })

  it('clash tint wins even when the clashing part is also selected', () => {
    const states = computePartRenderStates([part({ id: 'p1' })], {
      clashIds: new Set(['p1']),
      selectedId: 'p1'
    })
    expect(states[0]!.colorRole).toBe('clash')
  })
})

// ── Wave-7 geometry tiers: mesh (a) / bbox (b) / nominal (c) ──────────────────

const meshDescriptor = (o: Partial<PartMeshGeometry> = {}): PartMeshGeometry => ({
  kind: 'mesh',
  // A single unit triangle (3 verts) — 1 triangle.
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  triangleCount: 1,
  halfExtentsMm: [5, 6, 7],
  centerOffsetMm: [1, 2, 3],
  ...o
})

const bboxDescriptor = (
  half: readonly [number, number, number] = [4, 5, 6],
  center: readonly [number, number, number] = [0, 0, 0]
): PartGeometryDescriptor => ({ kind: 'bbox', halfExtentsMm: half, centerOffsetMm: center })

describe('resolvePartGeometry — tier resolution + budget', () => {
  it('resolves a mesh descriptor to the mesh tier when it fits the budget', () => {
    const r = resolvePartGeometry(meshDescriptor({ triangleCount: 100 }), 1000)
    expect(r.geometry.tier).toBe('mesh')
    expect(r.consumed).toBe(100)
    if (r.geometry.tier === 'mesh') {
      expect(r.geometry.halfExtentsMm).toEqual([5, 6, 7])
      expect(r.geometry.centerOffsetMm).toEqual([1, 2, 3])
    }
  })

  it('DEGRADES a mesh to its own bbox proportions when it overflows the budget', () => {
    const r = resolvePartGeometry(meshDescriptor({ triangleCount: 5000 }), 100)
    expect(r.geometry.tier).toBe('bbox')
    // Degrade consumes ZERO budget (it is drawn as a box).
    expect(r.consumed).toBe(0)
    // Keeps the mesh's REAL proportions + center, not the nominal cube.
    expect(r.geometry.halfExtentsMm).toEqual([5, 6, 7])
    expect(r.geometry.centerOffsetMm).toEqual([1, 2, 3])
  })

  it('resolves a bbox descriptor to the bbox tier (never consumes budget)', () => {
    const r = resolvePartGeometry(bboxDescriptor([4, 5, 6], [1, 0, -1]), 1000)
    expect(r.geometry.tier).toBe('bbox')
    expect(r.consumed).toBe(0)
    expect(r.geometry.halfExtentsMm).toEqual([4, 5, 6])
    expect(r.geometry.centerOffsetMm).toEqual([1, 0, -1])
  })

  it('resolves no descriptor to the nominal cube', () => {
    const r = resolvePartGeometry(null, 1000)
    expect(r.geometry.tier).toBe('nominal')
    expect(r.consumed).toBe(0)
    expect(r.geometry.halfExtentsMm).toEqual([
      FALLBACK_BOX_HALF_EXTENT_MM,
      FALLBACK_BOX_HALF_EXTENT_MM,
      FALLBACK_BOX_HALF_EXTENT_MM
    ])
  })

  it('sanitizes a non-finite / non-positive half-extent to the nominal on that axis', () => {
    const r = resolvePartGeometry(
      bboxDescriptor([Number.NaN, -3, 8] as [number, number, number]),
      1000
    )
    expect(r.geometry.halfExtentsMm[0]).toBe(FALLBACK_BOX_HALF_EXTENT_MM)
    expect(r.geometry.halfExtentsMm[1]).toBe(FALLBACK_BOX_HALF_EXTENT_MM)
    expect(r.geometry.halfExtentsMm[2]).toBe(8)
  })

  it('degrades a zero-triangle mesh (defensive) to its bbox tier', () => {
    const r = resolvePartGeometry(meshDescriptor({ triangleCount: 0, positions: [] }), 1000)
    expect(r.geometry.tier).toBe('bbox')
    expect(r.consumed).toBe(0)
  })
})

describe('computePartRenderStates — geometry tiers + budget degradation', () => {
  it('threads per-part descriptors into the right tier', () => {
    const states = computePartRenderStates(
      [part({ id: 'a' }), part({ id: 'b' }), part({ id: 'c' })],
      {
        descriptors: new Map<string, PartGeometryDescriptor>([
          ['a', meshDescriptor({ triangleCount: 10 })],
          ['b', bboxDescriptor([2, 2, 2])]
          // 'c' has no descriptor → nominal.
        ])
      }
    )
    expect(states.map((s) => s.renderTier)).toEqual(['mesh', 'bbox', 'nominal'])
  })

  it('degrades parts past the triangle budget to bbox — no silent cap, counted honestly', () => {
    const states = computePartRenderStates(
      [part({ id: 'a' }), part({ id: 'b' }), part({ id: 'c' })],
      {
        // Budget 150: a(100) fits → mesh; b(100) would push to 200 → degrade; c(40) still fits after? No — budget already exhausted by intent: b degraded consumes 0, so c(40) DOES fit the remaining 50.
        triangleBudget: 150,
        descriptors: new Map<string, PartGeometryDescriptor>([
          ['a', meshDescriptor({ triangleCount: 100, halfExtentsMm: [1, 1, 1] })],
          ['b', meshDescriptor({ triangleCount: 100, halfExtentsMm: [2, 2, 2] })],
          ['c', meshDescriptor({ triangleCount: 40, halfExtentsMm: [3, 3, 3] })]
        ])
      }
    )
    expect(states[0]!.renderTier).toBe('mesh') // 100 ≤ 150
    expect(states[1]!.renderTier).toBe('bbox') // 100 > remaining 50 → degrade
    expect(states[2]!.renderTier).toBe('mesh') // 40 ≤ remaining 50 → still a mesh
    // The degraded part keeps its real proportions.
    expect(states[1]!.halfExtentsMm).toEqual([2, 2, 2])
    const summary = summarizeRenderTiers(states)
    expect(summary).toEqual({ total: 3, mesh: 2, bbox: 1, nominal: 0, schematic: 1 })
  })

  it('a single mesh that alone exceeds the whole budget still degrades (never blows the guard)', () => {
    const states = computePartRenderStates([part({ id: 'a' })], {
      triangleBudget: 50,
      descriptors: new Map<string, PartGeometryDescriptor>([
        ['a', meshDescriptor({ triangleCount: 999_999, halfExtentsMm: [9, 9, 9] })]
      ])
    })
    expect(states[0]!.renderTier).toBe('bbox')
    expect(states[0]!.halfExtentsMm).toEqual([9, 9, 9])
  })

  it('defaults the budget to DEFAULT_TRIANGLE_BUDGET when omitted', () => {
    // A mesh just under the default fits; the same +1 over does not.
    const under = computePartRenderStates([part({ id: 'a' })], {
      descriptors: new Map([['a', meshDescriptor({ triangleCount: DEFAULT_TRIANGLE_BUDGET })]])
    })
    expect(under[0]!.renderTier).toBe('mesh')
    const over = computePartRenderStates([part({ id: 'a' })], {
      descriptors: new Map([['a', meshDescriptor({ triangleCount: DEFAULT_TRIANGLE_BUDGET + 1 })]])
    })
    expect(over[0]!.renderTier).toBe('bbox')
  })
})

describe('computePartRenderStates — transform pipeline is TIER-INDEPENDENT', () => {
  // The composed placement matrix must be IDENTICAL across tiers for the SAME
  // pose/explode/playback — the tier only changes WHAT is drawn, never WHERE.
  const posMatrixOf = (
    id: string,
    descriptors: Map<string, PartGeometryDescriptor> | undefined,
    extra: Parameters<typeof computePartRenderStates>[1] = {}
  ): Vector3 => {
    const states = computePartRenderStates([part({ id, transform: { position: [7, 8, 9], rotation: [0, 0, 30] } })], {
      ...extra,
      descriptors: descriptors ?? null
    })
    return new Vector3().setFromMatrixPosition(states[0]!.matrix)
  }

  it('mesh / bbox / nominal all compose the SAME placement matrix for one pose', () => {
    const nominal = posMatrixOf('p', undefined)
    const mesh = posMatrixOf('p', new Map([['p', meshDescriptor({ centerOffsetMm: [50, 50, 50] })]]))
    const bbox = posMatrixOf('p', new Map([['p', bboxDescriptor([3, 3, 3], [50, 50, 50])]]))
    // The center offset lives in LOCAL geometry space, NOT the placement matrix,
    // so the matrix translation stays at the pose regardless of tier/offset.
    expect([mesh.x, mesh.y, mesh.z]).toEqual([nominal.x, nominal.y, nominal.z])
    expect([bbox.x, bbox.y, bbox.z]).toEqual([nominal.x, nominal.y, nominal.z])
    expect(nominal.x).toBeCloseTo(7, 6)
    expect(nominal.y).toBeCloseTo(8, 6)
    expect(nominal.z).toBeCloseTo(9, 6)
  })

  it('explode offset applies identically regardless of tier', () => {
    const explode: ExplodeConfig = { axis: 'z', stepMm: 10, factor: 1 }
    const twoParts = (descriptors: Map<string, PartGeometryDescriptor> | null): number[] => {
      const states = computePartRenderStates(
        [part({ id: 'a' }), part({ id: 'b' })],
        { explode, descriptors }
      )
      return states.map((s) => new Vector3().setFromMatrixPosition(s.matrix).z)
    }
    const nominalZ = twoParts(null)
    const mixedZ = twoParts(
      new Map<string, PartGeometryDescriptor>([
        ['a', meshDescriptor()],
        ['b', bboxDescriptor()]
      ])
    )
    expect(mixedZ).toEqual(nominalZ)
    // index 1 separated by 10 on Z regardless of tier.
    expect(nominalZ[1]).toBeCloseTo(10, 6)
  })

  it('playback overlay overrides the pose identically across tiers', () => {
    const overlay = new Map<string, MotionPoseTransform>([['p', pose({ x: 42 })]])
    const withMesh = computePartRenderStates(
      [part({ id: 'p', transform: { position: [5, 0, 0] } })],
      { playbackOverlay: overlay, descriptors: new Map([['p', meshDescriptor()]]) }
    )
    const withNominal = computePartRenderStates(
      [part({ id: 'p', transform: { position: [5, 0, 0] } })],
      { playbackOverlay: overlay }
    )
    const mx = new Vector3().setFromMatrixPosition(withMesh[0]!.matrix)
    const nx = new Vector3().setFromMatrixPosition(withNominal[0]!.matrix)
    expect(mx.x).toBeCloseTo(42, 6)
    expect(nx.x).toBeCloseTo(42, 6)
    expect(withMesh[0]!.fromPlayback).toBe(true)
  })

  it('clash / selected / grounded flags + roles are tier-independent', () => {
    const build = (descriptors: Map<string, PartGeometryDescriptor> | null) =>
      computePartRenderStates([part({ id: 'p', grounded: true })], {
        clashIds: new Set(['p']),
        descriptors
      })[0]!
    const withMesh = build(new Map([['p', meshDescriptor()]]))
    const withNominal = build(null)
    expect(withMesh.colorRole).toBe('clash')
    expect(withNominal.colorRole).toBe('clash')
    expect(withMesh.grounded).toBe(true)
    expect(withMesh.clashing).toBe(true)
  })
})

describe('summarizeRenderTiers', () => {
  it('tallies tiers and reports schematic = bbox + nominal', () => {
    const states = computePartRenderStates(
      [part({ id: 'a' }), part({ id: 'b' }), part({ id: 'c' }), part({ id: 'd' })],
      {
        descriptors: new Map<string, PartGeometryDescriptor>([
          ['a', meshDescriptor()],
          ['b', meshDescriptor()],
          ['c', bboxDescriptor()]
          // 'd' → nominal
        ])
      }
    )
    expect(summarizeRenderTiers(states)).toEqual({
      total: 4,
      mesh: 2,
      bbox: 1,
      nominal: 1,
      schematic: 2
    })
  })

  it('is all-schematic when there are no descriptors', () => {
    const states = computePartRenderStates([part({ id: 'a' }), part({ id: 'b' })], {})
    expect(summarizeRenderTiers(states)).toEqual({
      total: 2,
      mesh: 0,
      bbox: 0,
      nominal: 2,
      schematic: 2
    })
  })
})
