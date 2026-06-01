/**
 * Pure raycast → faceId mapping test pin (CAD V1 Workflow H).
 *
 * Runs in the `node` vitest environment — no Three.js raycast required.
 * The helpers operate on the parallel `faceIds` array directly, so the
 * unit tests can validate every edge case (out-of-range index, missing
 * array, non-finite values) without instantiating a BufferGeometry.
 *
 * Pinned contracts:
 *   - `triangleToFaceId(idx, faceIds)` returns `null` for invalid input
 *     instead of throwing. The renderer's click handler relies on this
 *     to silently no-op when the geometry pre-dates the sidecar's
 *     `tessellate_with_ids` rollout (graceful degradation).
 *   - `trianglesForFace(faceId, faceIds)` returns a stable order — the
 *     wire-outline overlay deserves a deterministic vertex order so
 *     orbit doesn't shuffle the line list visually.
 */

import { describe, expect, it } from 'vitest'
import { triangleToFaceId, trianglesForFace } from './selection-raycast'

describe('triangleToFaceId — happy path', () => {
  it('returns the face id at the given triangle index', () => {
    const faceIds = [0, 0, 1, 1, 2, 2]
    expect(triangleToFaceId(0, faceIds)).toBe(0)
    expect(triangleToFaceId(2, faceIds)).toBe(1)
    expect(triangleToFaceId(5, faceIds)).toBe(2)
  })
})

describe('triangleToFaceId — defensive paths', () => {
  it('returns null for an out-of-range index', () => {
    const faceIds = [0, 0, 1, 1]
    expect(triangleToFaceId(100, faceIds)).toBeNull()
    expect(triangleToFaceId(4, faceIds)).toBeNull() // off-by-one
  })

  it('returns null for a negative index', () => {
    expect(triangleToFaceId(-1, [0, 0, 1])).toBeNull()
  })

  it('returns null for a non-integer index', () => {
    expect(triangleToFaceId(0.5, [0, 0])).toBeNull()
  })

  it('returns null when faceIds is missing or non-array', () => {
    expect(triangleToFaceId(0, null)).toBeNull()
    expect(triangleToFaceId(0, undefined)).toBeNull()
  })

  it('returns null when the stored value is not a finite integer', () => {
    const broken = [0, NaN as unknown as number, 1]
    expect(triangleToFaceId(1, broken)).toBeNull()
    // Non-integer values are also rejected (the sidecar emits ints).
    const fractional = [0, 1.5 as unknown as number]
    expect(triangleToFaceId(1, fractional)).toBeNull()
  })

  it('returns null when triangleIndex is undefined (Three.js absent faceIndex)', () => {
    expect(triangleToFaceId(undefined, [0, 1, 2])).toBeNull()
    expect(triangleToFaceId(null, [0, 1, 2])).toBeNull()
  })
})

describe('trianglesForFace — face → triangle indices', () => {
  it('returns every triangle index that belongs to the given face, in source order', () => {
    const faceIds = [0, 0, 1, 0, 2, 1, 2]
    expect(trianglesForFace(0, faceIds)).toEqual([0, 1, 3])
    expect(trianglesForFace(1, faceIds)).toEqual([2, 5])
    expect(trianglesForFace(2, faceIds)).toEqual([4, 6])
  })

  it('returns an empty array when the face id is absent', () => {
    expect(trianglesForFace(99, [0, 1, 2])).toEqual([])
  })

  it('returns an empty array when faceIds is missing', () => {
    expect(trianglesForFace(0, null)).toEqual([])
    expect(trianglesForFace(0, undefined)).toEqual([])
  })

  it('returns an empty array when faceId is non-finite', () => {
    expect(trianglesForFace(NaN, [0, 1])).toEqual([])
    expect(trianglesForFace(Infinity, [0, 1])).toEqual([])
  })
})
