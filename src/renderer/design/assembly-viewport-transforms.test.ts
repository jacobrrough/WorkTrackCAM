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
  FALLBACK_BOX_HALF_EXTENT_MM,
  computePartRenderStates,
  explodeTranslationMm,
  interferenceTintIds,
  poseToMatrix,
  resolveColorRole,
  resolvePartPose,
  type AssemblyViewportPart,
  type ExplodeConfig
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
  it('renders one state per part with the nominal fallback box', () => {
    const states = computePartRenderStates([part({ id: 'p1' }), part({ id: 'p2' })], {})
    expect(states.map((s) => s.id)).toEqual(['p1', 'p2'])
    for (const s of states) {
      expect(s.halfExtentsMm).toEqual([
        FALLBACK_BOX_HALF_EXTENT_MM,
        FALLBACK_BOX_HALF_EXTENT_MM,
        FALLBACK_BOX_HALF_EXTENT_MM
      ])
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
