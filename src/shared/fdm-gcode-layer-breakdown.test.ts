/**
 * fdm-gcode-layer-breakdown.test.ts — behavior tests for the session-only
 * per-layer slicer-breakdown Zod schemas (CAD V1.5).
 *
 * Covers: schema parse of a well-formed layer + result, rejection of
 * malformed inputs (negative index, negative Z, non-integer count),
 * optional/null `lineTypeCounts`, the FdmLineType enum vocabulary, and the
 * empty-result constant.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_FDM_LAYER_BREAKDOWN_RESULT,
  FDM_LINE_TYPES,
  fdmLayerBreakdownResultSchema,
  fdmLayerBreakdownSchema,
  fdmLineTypeCountsSchema,
  fdmLineTypeSchema,
  type FdmLayerBreakdown,
  type FdmLayerBreakdownResult
} from './fdm-gcode-layer-breakdown'

describe('fdmLineTypeSchema', () => {
  it('accepts every canonical FdmLineType member', () => {
    for (const t of FDM_LINE_TYPES) {
      expect(fdmLineTypeSchema.parse(t)).toBe(t)
    }
  })

  it('exposes exactly 13 line-type members', () => {
    expect(FDM_LINE_TYPES.length).toBe(13)
  })

  it('rejects an unknown line type', () => {
    expect(fdmLineTypeSchema.safeParse('Quux wall').success).toBe(false)
  })
})

describe('fdmLineTypeCountsSchema', () => {
  it('accepts a partial record with a subset of line types', () => {
    const counts = { 'Outer wall': 12, 'Sparse infill': 3 }
    expect(fdmLineTypeCountsSchema.parse(counts)).toEqual(counts)
  })

  it('accepts an empty record', () => {
    expect(fdmLineTypeCountsSchema.parse({})).toEqual({})
  })

  it('rejects a non-integer count', () => {
    expect(fdmLineTypeCountsSchema.safeParse({ 'Outer wall': 1.5 }).success).toBe(false)
  })

  it('rejects a negative count', () => {
    expect(fdmLineTypeCountsSchema.safeParse({ 'Outer wall': -1 }).success).toBe(false)
  })
})

describe('fdmLayerBreakdownSchema', () => {
  it('parses a fully-populated layer', () => {
    const layer: FdmLayerBreakdown = {
      index: 1,
      zMm: 0.2,
      estTimeSec: 30,
      estFilamentMm: 1000,
      lineTypeCounts: { 'Outer wall': 4, 'Inner wall': 8 },
      maxSpeedMmMin: 9000
    }
    expect(fdmLayerBreakdownSchema.parse(layer)).toEqual(layer)
  })

  it('parses a layer with all-null optional fields (uniform/empty fallback)', () => {
    const layer: FdmLayerBreakdown = {
      index: 7,
      zMm: 1.4,
      estTimeSec: null,
      estFilamentMm: null,
      lineTypeCounts: null,
      maxSpeedMmMin: null
    }
    expect(fdmLayerBreakdownSchema.parse(layer)).toEqual(layer)
  })

  it('accepts zMm = 0 (non-negative, first layer edge case)', () => {
    expect(
      fdmLayerBreakdownSchema.safeParse({
        index: 1,
        zMm: 0,
        estTimeSec: null,
        estFilamentMm: null,
        lineTypeCounts: null,
        maxSpeedMmMin: null
      }).success
    ).toBe(true)
  })

  it('rejects index = 0 (must be positive 1-based)', () => {
    expect(
      fdmLayerBreakdownSchema.safeParse({
        index: 0,
        zMm: 0.2,
        estTimeSec: null,
        estFilamentMm: null,
        lineTypeCounts: null,
        maxSpeedMmMin: null
      }).success
    ).toBe(false)
  })

  it('rejects a negative zMm', () => {
    expect(
      fdmLayerBreakdownSchema.safeParse({
        index: 1,
        zMm: -0.2,
        estTimeSec: null,
        estFilamentMm: null,
        lineTypeCounts: null,
        maxSpeedMmMin: null
      }).success
    ).toBe(false)
  })

  it('rejects a negative estTimeSec', () => {
    expect(
      fdmLayerBreakdownSchema.safeParse({
        index: 1,
        zMm: 0.2,
        estTimeSec: -1,
        estFilamentMm: null,
        lineTypeCounts: null,
        maxSpeedMmMin: null
      }).success
    ).toBe(false)
  })

  it('rejects a missing field', () => {
    expect(
      fdmLayerBreakdownSchema.safeParse({
        index: 1,
        zMm: 0.2,
        estTimeSec: null,
        estFilamentMm: null,
        lineTypeCounts: null
        // maxSpeedMmMin omitted
      }).success
    ).toBe(false)
  })
})

describe('fdmLayerBreakdownResultSchema', () => {
  it('parses a multi-layer result with header totals', () => {
    const result: FdmLayerBreakdownResult = {
      layers: [
        {
          index: 1,
          zMm: 0.2,
          estTimeSec: 30,
          estFilamentMm: 1000,
          lineTypeCounts: null,
          maxSpeedMmMin: 9000
        },
        {
          index: 2,
          zMm: 0.4,
          estTimeSec: 30,
          estFilamentMm: 1000,
          lineTypeCounts: null,
          maxSpeedMmMin: 9000
        }
      ],
      totalTimeSec: 60,
      totalFilamentMm: 2000,
      layerCount: 2
    }
    expect(fdmLayerBreakdownResultSchema.parse(result)).toEqual(result)
  })

  it('parses a zero-layer result with null totals', () => {
    expect(fdmLayerBreakdownResultSchema.parse(EMPTY_FDM_LAYER_BREAKDOWN_RESULT)).toEqual(
      EMPTY_FDM_LAYER_BREAKDOWN_RESULT
    )
  })

  it('rejects a negative layerCount', () => {
    expect(
      fdmLayerBreakdownResultSchema.safeParse({
        layers: [],
        totalTimeSec: null,
        totalFilamentMm: null,
        layerCount: -1
      }).success
    ).toBe(false)
  })

  it('rejects a result whose layers entry is malformed', () => {
    expect(
      fdmLayerBreakdownResultSchema.safeParse({
        layers: [{ index: -1, zMm: 0.2, estTimeSec: null, estFilamentMm: null, lineTypeCounts: null, maxSpeedMmMin: null }],
        totalTimeSec: null,
        totalFilamentMm: null,
        layerCount: 1
      }).success
    ).toBe(false)
  })
})

describe('EMPTY_FDM_LAYER_BREAKDOWN_RESULT', () => {
  it('is a zero/null shell', () => {
    expect(EMPTY_FDM_LAYER_BREAKDOWN_RESULT).toEqual({
      layers: [],
      totalTimeSec: null,
      totalFilamentMm: null,
      layerCount: 0
    })
  })
})
