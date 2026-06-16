/**
 * Bbox-level interference detector tests (pure node-env).
 *
 * Covers the documented honesty contract:
 *   - overlapping world AABBs → a clash;
 *   - disjoint → none;
 *   - touching-but-not-overlapping boundary (shared face) → NOT a clash;
 *   - transforms (translation + rotation) move a box into/out of overlap;
 *   - suppressed / malformed-box parts are excluded;
 *   - deterministic, canonical-ordered output.
 *
 * No React, no DOM, no IPC: plain objects exercise every branch.
 */

import { describe, expect, it } from 'vitest'
import {
  detectInterferences,
  worldAabbOf,
  worldAabbsOverlap,
  type InterferencePart,
  type LocalAabb
} from './assembly-interference'

/** A unit cube [0,1]^3 centered shifted by id default — caller sets transform. */
const UNIT_CUBE: LocalAabb = { min: [0, 0, 0], max: [1, 1, 1] }

function part(id: string, transform?: InterferencePart['transform'], box: LocalAabb = UNIT_CUBE): InterferencePart {
  return { id, localBox: box, ...(transform ? { transform } : {}) }
}

describe('worldAabbOf', () => {
  it('translates a local box by the transform position', () => {
    const w = worldAabbOf(UNIT_CUBE, { x: 10, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 })
    expect(w.min).toEqual([10, 0, 0])
    expect(w.max).toEqual([11, 1, 1])
  })

  it('produces a conservative axis-aligned hull for a rotated box (90° about Z)', () => {
    // A [0,2]x[0,1]x[0,1] box rotated 90° about Z swaps its X/Y extents.
    const box: LocalAabb = { min: [0, 0, 0], max: [2, 1, 1] }
    const w = worldAabbOf(box, { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 90 })
    // After +90° about Z: x' = -y, y' = x. Corners (0..2, 0..1) → x'∈[-1,0], y'∈[0,2].
    expect(w.min[0]).toBeCloseTo(-1, 6)
    expect(w.max[0]).toBeCloseTo(0, 6)
    expect(w.min[1]).toBeCloseTo(0, 6)
    expect(w.max[1]).toBeCloseTo(2, 6)
  })

  it('treats a missing transform as identity', () => {
    const w = worldAabbOf(UNIT_CUBE)
    expect(w.min).toEqual([0, 0, 0])
    expect(w.max).toEqual([1, 1, 1])
  })
})

describe('worldAabbsOverlap', () => {
  it('true for boxes that overlap with positive volume', () => {
    const a = { min: [0, 0, 0], max: [2, 2, 2] } as const
    const b = { min: [1, 1, 1], max: [3, 3, 3] } as const
    expect(worldAabbsOverlap(a, b)).toBe(true)
  })

  it('FALSE for boxes that merely touch on a shared face (zero overlap)', () => {
    const a = { min: [0, 0, 0], max: [1, 1, 1] } as const
    const b = { min: [1, 0, 0], max: [2, 1, 1] } as const // shares the x=1 face
    expect(worldAabbsOverlap(a, b)).toBe(false)
  })

  it('false for fully disjoint boxes', () => {
    const a = { min: [0, 0, 0], max: [1, 1, 1] } as const
    const b = { min: [5, 5, 5], max: [6, 6, 6] } as const
    expect(worldAabbsOverlap(a, b)).toBe(false)
  })
})

describe('detectInterferences — core cases', () => {
  it('reports a clash for two overlapping parts', () => {
    const parts = [
      part('a', { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }),
      part('b', { x: 0.5, y: 0.5, z: 0.5, rxDeg: 0, ryDeg: 0, rzDeg: 0 })
    ]
    const r = detectInterferences(parts)
    expect(r.fidelity).toBe('bbox')
    expect(r.evaluatedCount).toBe(2)
    expect(r.clashingPairs).toEqual([{ aId: 'a', bId: 'b' }])
  })

  it('reports NO clash for disjoint parts', () => {
    const parts = [
      part('a', { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }),
      part('b', { x: 10, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 })
    ]
    const r = detectInterferences(parts)
    expect(r.clashingPairs).toEqual([])
  })

  it('reports NO clash for parts that only TOUCH at a shared face', () => {
    // a occupies x∈[0,1]; b shifted to x∈[1,2] — they share the x=1 plane exactly.
    const parts = [
      part('a', { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }),
      part('b', { x: 1, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 })
    ]
    const r = detectInterferences(parts)
    expect(r.clashingPairs).toEqual([])
  })

  it('a rotation can pull a part INTO overlap with a neighbor', () => {
    // a = long bar x∈[0,4], y∈[0,1]. b = bar centered near x=2 but offset in y so the
    // un-rotated boxes are disjoint; rotating a 90° about Z swings its long axis into b.
    const bar: LocalAabb = { min: [0, 0, 0], max: [4, 1, 1] }
    const aFlat = part('a', { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }, bar)
    const b = part('b', { x: -0.5, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }, { min: [0, 2, 0], max: [1, 5, 1] })
    // Un-rotated: a is y∈[0,1], b is y∈[2,5] → disjoint.
    expect(detectInterferences([aFlat, b]).clashingPairs).toEqual([])
    // Rotate a +90° about Z: its x∈[0,4] extent maps to y'∈[0,4], reaching into b's y∈[2,5].
    const aRot = part('a', { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 90 }, bar)
    expect(detectInterferences([aRot, b]).clashingPairs).toEqual([{ aId: 'a', bId: 'b' }])
  })

  it('finds all overlapping pairs among three mutually-overlapping parts', () => {
    const parts = [
      part('a', { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }, { min: [0, 0, 0], max: [3, 3, 3] }),
      part('b', { x: 1, y: 1, z: 1, rxDeg: 0, ryDeg: 0, rzDeg: 0 }, { min: [0, 0, 0], max: [3, 3, 3] }),
      part('c', { x: 2, y: 2, z: 2, rxDeg: 0, ryDeg: 0, rzDeg: 0 }, { min: [0, 0, 0], max: [3, 3, 3] })
    ]
    const r = detectInterferences(parts)
    expect(r.clashingPairs).toEqual([
      { aId: 'a', bId: 'b' },
      { aId: 'a', bId: 'c' },
      { aId: 'b', bId: 'c' }
    ])
  })
})

describe('detectInterferences — exclusions + determinism', () => {
  it('excludes suppressed parts (and lists them in skippedIds)', () => {
    const parts: InterferencePart[] = [
      part('a', { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }),
      { ...part('b', { x: 0.5, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }), suppressed: true }
    ]
    const r = detectInterferences(parts)
    expect(r.clashingPairs).toEqual([])
    expect(r.evaluatedCount).toBe(1)
    expect(r.skippedIds).toEqual(['b'])
  })

  it('skips a part with a malformed box (min > max)', () => {
    const parts: InterferencePart[] = [
      part('a', { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }),
      { id: 'bad', localBox: { min: [2, 0, 0], max: [1, 1, 1] }, transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }
    ]
    const r = detectInterferences(parts)
    expect(r.skippedIds).toEqual(['bad'])
    expect(r.evaluatedCount).toBe(1)
    expect(r.clashingPairs).toEqual([])
  })

  it('skips a part with non-finite box coordinates', () => {
    const parts: InterferencePart[] = [
      part('a'),
      { id: 'nan', localBox: { min: [0, 0, 0], max: [Number.NaN, 1, 1] } }
    ]
    const r = detectInterferences(parts)
    expect(r.skippedIds).toEqual(['nan'])
  })

  it('returns pairs in canonical (aId<bId) order regardless of input order', () => {
    const overlap = (id: string): InterferencePart =>
      part(id, { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }, { min: [0, 0, 0], max: [5, 5, 5] })
    const r1 = detectInterferences([overlap('z'), overlap('a'), overlap('m')])
    const r2 = detectInterferences([overlap('a'), overlap('m'), overlap('z')])
    expect(r1.clashingPairs).toEqual(r2.clashingPairs)
    expect(r1.clashingPairs).toEqual([
      { aId: 'a', bId: 'm' },
      { aId: 'a', bId: 'z' },
      { aId: 'm', bId: 'z' }
    ])
  })

  it('an empty / single-part assembly has no clashes', () => {
    expect(detectInterferences([]).clashingPairs).toEqual([])
    expect(detectInterferences([part('solo')]).clashingPairs).toEqual([])
  })
})
