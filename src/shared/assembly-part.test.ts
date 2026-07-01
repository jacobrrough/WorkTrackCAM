/**
 * Per-part geometry-dimensions schema + projection helper tests (pure node-env).
 *
 * Covers:
 *   - the optional + additive `geometryDimensions` parses (and is omittable —
 *     backward-compat for legacy rows);
 *   - a malformed inline box (min > max) is rejected at parse time;
 *   - `assemblyPartLocalAabb` projects dims into the `{ min, max }` LocalAabb shape,
 *     returns `undefined` for a part with no dims, and fail-safes a bad box to
 *     `undefined` (never a false negative downstream).
 */

import { describe, expect, it } from 'vitest'
import {
  assemblyPartDimensionsFragmentSchema,
  assemblyPartGeometryDimensionsSchema,
  assemblyPartLocalAabb
} from './assembly-part'

describe('assemblyPartGeometryDimensionsSchema', () => {
  it('parses a well-formed local AABB', () => {
    const d = assemblyPartGeometryDimensionsSchema.parse({
      aabbMin: [0, 0, 0],
      aabbMax: [10, 20, 5]
    })
    expect(d.aabbMin).toEqual([0, 0, 0])
    expect(d.aabbMax).toEqual([10, 20, 5])
  })

  it('rejects a box with min > max on an axis', () => {
    const r = assemblyPartGeometryDimensionsSchema.safeParse({
      aabbMin: [0, 5, 0],
      aabbMax: [10, 1, 5] // y: 5 > 1
    })
    expect(r.success).toBe(false)
  })

  it('rejects non-finite coordinates', () => {
    const r = assemblyPartGeometryDimensionsSchema.safeParse({
      aabbMin: [0, 0, 0],
      aabbMax: [Number.NaN, 1, 1]
    })
    expect(r.success).toBe(false)
  })
})

describe('assemblyPartDimensionsFragmentSchema (backward compat)', () => {
  it('parses a row with NO geometryDimensions (legacy project)', () => {
    const f = assemblyPartDimensionsFragmentSchema.parse({})
    expect(f.geometryDimensions).toBeUndefined()
  })

  it('parses a row WITH geometryDimensions', () => {
    const f = assemblyPartDimensionsFragmentSchema.parse({
      geometryDimensions: { aabbMin: [0, 0, 0], aabbMax: [1, 1, 1] }
    })
    expect(f.geometryDimensions?.aabbMax).toEqual([1, 1, 1])
  })
})

describe('assemblyPartLocalAabb', () => {
  it('projects dims into the LocalAabb { min, max } shape', () => {
    const box = assemblyPartLocalAabb({ geometryDimensions: { aabbMin: [1, 2, 3], aabbMax: [4, 5, 6] } })
    expect(box).toEqual({ min: [1, 2, 3], max: [4, 5, 6] })
  })

  it('returns undefined for a part with no dims', () => {
    expect(assemblyPartLocalAabb({})).toBeUndefined()
  })

  it('fail-safes a malformed inline box (min > max) to undefined', () => {
    // Constructed without the schema (e.g. a bad hydration) — helper must not trust it.
    const box = assemblyPartLocalAabb({ geometryDimensions: { aabbMin: [9, 0, 0], aabbMax: [1, 1, 1] } })
    expect(box).toBeUndefined()
  })

  it('fail-safes non-finite coordinates to undefined', () => {
    const box = assemblyPartLocalAabb({
      geometryDimensions: { aabbMin: [0, 0, 0], aabbMax: [Number.POSITIVE_INFINITY, 1, 1] }
    })
    expect(box).toBeUndefined()
  })
})
