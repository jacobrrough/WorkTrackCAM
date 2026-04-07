import { describe, expect, it } from 'vitest'
import { parse4AxisParams } from './cam-4axis-params'

describe('parse4AxisParams', () => {
  describe('valid params', () => {
    it('extracts all valid numeric fields', () => {
      const result = parse4AxisParams({
        cylinderDiameterMm: 50,
        cylinderLengthMm: 100,
        stepoverDeg: 15,
        surfaceStepoverMm: 2.5,
        zStepMm: 0.5,
        chuckDepthMm: 5,
        clampOffsetMm: 3,
        axialBandCount: 4,
        cylindricalRasterMaxCells: 10_000,
        rotaryFinishAllowanceMm: 0.2,
        overcutMm: 1,
        finishStepoverDeg: 7.5,
      })
      expect(result.cylinderDiameterMm).toBe(50)
      expect(result.cylinderLengthMm).toBe(100)
      expect(result.stepoverDeg).toBe(15)
      expect(result.surfaceStepoverMm).toBe(2.5)
      expect(result.zStepMm).toBe(0.5)
      expect(result.chuckDepthMm).toBe(5)
      expect(result.clampOffsetMm).toBe(3)
      expect(result.axialBandCount).toBe(4)
      expect(result.cylindricalRasterMaxCells).toBe(10_000)
      expect(result.rotaryFinishAllowanceMm).toBe(0.2)
      expect(result.overcutMm).toBe(1)
      expect(result.finishStepoverDeg).toBe(7.5)
    })

    it('extracts string fields', () => {
      const result = parse4AxisParams({ wrapAxis: 'y' })
      expect(result.wrapAxis).toBe('y')
    })

    it('extracts boolean fields', () => {
      const result = parse4AxisParams({
        useMeshMachinableXClamp: false,
        useMeshRadialZBands: true,
      })
      expect(result.useMeshMachinableXClamp).toBe(false)
      expect(result.useMeshRadialZBands).toBe(true)
    })
  })

  describe('missing optional fields return undefined', () => {
    it('returns undefined for all fields when given empty object', () => {
      const result = parse4AxisParams({})
      expect(result.cylinderDiameterMm).toBeUndefined()
      expect(result.cylinderLengthMm).toBeUndefined()
      expect(result.stepoverDeg).toBeUndefined()
      expect(result.surfaceStepoverMm).toBeUndefined()
      expect(result.zStepMm).toBeUndefined()
      expect(result.chuckDepthMm).toBeUndefined()
      expect(result.clampOffsetMm).toBeUndefined()
      expect(result.wrapAxis).toBeUndefined()
      expect(result.axialBandCount).toBeUndefined()
      expect(result.cylindricalRasterMaxCells).toBeUndefined()
      expect(result.rotaryFinishAllowanceMm).toBeUndefined()
      expect(result.overcutMm).toBeUndefined()
      expect(result.finishStepoverDeg).toBeUndefined()
      expect(result.useMeshMachinableXClamp).toBeUndefined()
      expect(result.useMeshRadialZBands).toBeUndefined()
      expect(result.contourPoints).toBeUndefined()
      expect(result.indexAnglesDeg).toBeUndefined()
    })
  })

  describe('invalid values return undefined (not throw)', () => {
    it('rejects NaN for positive-finite fields', () => {
      const result = parse4AxisParams({
        cylinderDiameterMm: NaN,
        cylinderLengthMm: NaN,
        stepoverDeg: NaN,
        surfaceStepoverMm: NaN,
        zStepMm: NaN,
      })
      expect(result.cylinderDiameterMm).toBeUndefined()
      expect(result.cylinderLengthMm).toBeUndefined()
      expect(result.stepoverDeg).toBeUndefined()
      expect(result.surfaceStepoverMm).toBeUndefined()
      expect(result.zStepMm).toBeUndefined()
    })

    it('rejects negative values for positive-only fields', () => {
      const result = parse4AxisParams({
        cylinderDiameterMm: -10,
        cylinderLengthMm: -5,
        stepoverDeg: -1,
        surfaceStepoverMm: -0.1,
        zStepMm: -0.5,
        finishStepoverDeg: -2,
        axialBandCount: -1,
      })
      expect(result.cylinderDiameterMm).toBeUndefined()
      expect(result.cylinderLengthMm).toBeUndefined()
      expect(result.stepoverDeg).toBeUndefined()
      expect(result.surfaceStepoverMm).toBeUndefined()
      expect(result.zStepMm).toBeUndefined()
      expect(result.finishStepoverDeg).toBeUndefined()
      expect(result.axialBandCount).toBeUndefined()
    })

    it('rejects zero for positive-only fields', () => {
      const result = parse4AxisParams({
        cylinderDiameterMm: 0,
        stepoverDeg: 0,
        zStepMm: 0,
      })
      expect(result.cylinderDiameterMm).toBeUndefined()
      expect(result.stepoverDeg).toBeUndefined()
      expect(result.zStepMm).toBeUndefined()
    })

    it('allows zero for non-negative fields (chuckDepthMm, clampOffsetMm, overcutMm)', () => {
      const result = parse4AxisParams({
        chuckDepthMm: 0,
        clampOffsetMm: 0,
        overcutMm: 0,
      })
      expect(result.chuckDepthMm).toBe(0)
      expect(result.clampOffsetMm).toBe(0)
      expect(result.overcutMm).toBe(0)
    })

    it('rejects negative for non-negative fields', () => {
      const result = parse4AxisParams({
        chuckDepthMm: -1,
        clampOffsetMm: -0.5,
        overcutMm: -2,
      })
      expect(result.chuckDepthMm).toBeUndefined()
      expect(result.clampOffsetMm).toBeUndefined()
      expect(result.overcutMm).toBeUndefined()
    })

    it('rejects Infinity for finite-required fields', () => {
      const result = parse4AxisParams({
        cylinderDiameterMm: Infinity,
        chuckDepthMm: Infinity,
        rotaryFinishAllowanceMm: Infinity,
      })
      expect(result.cylinderDiameterMm).toBeUndefined()
      expect(result.chuckDepthMm).toBeUndefined()
      expect(result.rotaryFinishAllowanceMm).toBeUndefined()
    })

    it('rejects wrong types (string instead of number)', () => {
      const result = parse4AxisParams({
        cylinderDiameterMm: '50',
        stepoverDeg: 'ten',
        overcutMm: true,
      })
      expect(result.cylinderDiameterMm).toBeUndefined()
      expect(result.stepoverDeg).toBeUndefined()
      expect(result.overcutMm).toBeUndefined()
    })

    it('rejects wrong type for boolean fields', () => {
      const result = parse4AxisParams({
        useMeshMachinableXClamp: 'true',
        useMeshRadialZBands: 1,
      })
      expect(result.useMeshMachinableXClamp).toBeUndefined()
      expect(result.useMeshRadialZBands).toBeUndefined()
    })

    it('rejects cylindricalRasterMaxCells below 100', () => {
      const result = parse4AxisParams({ cylindricalRasterMaxCells: 50 })
      expect(result.cylindricalRasterMaxCells).toBeUndefined()
    })

    it('allows cylindricalRasterMaxCells at exactly 100', () => {
      const result = parse4AxisParams({ cylindricalRasterMaxCells: 100 })
      expect(result.cylindricalRasterMaxCells).toBe(100)
    })

    it('allows negative rotaryFinishAllowanceMm (finite, clamped by caller)', () => {
      const result = parse4AxisParams({ rotaryFinishAllowanceMm: -0.1 })
      expect(result.rotaryFinishAllowanceMm).toBe(-0.1)
    })
  })

  describe('contourPoints', () => {
    it('extracts valid contour points', () => {
      const result = parse4AxisParams({
        contourPoints: [[0, 0], [10, 5], [20, 10]],
      })
      expect(result.contourPoints).toEqual([[0, 0], [10, 5], [20, 10]])
    })

    it('returns undefined for missing contourPoints', () => {
      const result = parse4AxisParams({})
      expect(result.contourPoints).toBeUndefined()
    })

    it('returns undefined for non-array contourPoints', () => {
      const result = parse4AxisParams({ contourPoints: 'not an array' })
      expect(result.contourPoints).toBeUndefined()
    })

    it('returns undefined when contourPoints is an empty array', () => {
      const result = parse4AxisParams({ contourPoints: [] })
      expect(result.contourPoints).toBeUndefined()
    })

    it('skips invalid entries and keeps valid ones', () => {
      const result = parse4AxisParams({
        contourPoints: [[0, 0], 'bad', [10, NaN], [20, 10], null, [30]],
      })
      // Only [0,0] and [20,10] are valid 2-element finite tuples
      expect(result.contourPoints).toEqual([[0, 0], [20, 10]])
    })

    it('returns undefined when all entries are invalid', () => {
      const result = parse4AxisParams({
        contourPoints: ['bad', [NaN, 0], [Infinity, 1]],
      })
      expect(result.contourPoints).toBeUndefined()
    })
  })

  describe('indexAnglesDeg', () => {
    it('extracts valid index angles', () => {
      const result = parse4AxisParams({
        indexAnglesDeg: [0, 90, 180, 270],
      })
      expect(result.indexAnglesDeg).toEqual([0, 90, 180, 270])
    })

    it('returns undefined for missing indexAnglesDeg', () => {
      const result = parse4AxisParams({})
      expect(result.indexAnglesDeg).toBeUndefined()
    })

    it('returns undefined for non-array indexAnglesDeg', () => {
      const result = parse4AxisParams({ indexAnglesDeg: 90 })
      expect(result.indexAnglesDeg).toBeUndefined()
    })

    it('returns undefined for empty array', () => {
      const result = parse4AxisParams({ indexAnglesDeg: [] })
      expect(result.indexAnglesDeg).toBeUndefined()
    })

    it('skips non-finite entries and keeps valid ones', () => {
      const result = parse4AxisParams({
        indexAnglesDeg: [0, NaN, 90, Infinity, 'bad', 180],
      })
      expect(result.indexAnglesDeg).toEqual([0, 90, 180])
    })

    it('returns undefined when all entries are non-finite', () => {
      const result = parse4AxisParams({
        indexAnglesDeg: [NaN, Infinity, -Infinity],
      })
      expect(result.indexAnglesDeg).toBeUndefined()
    })

    it('allows negative angles', () => {
      const result = parse4AxisParams({ indexAnglesDeg: [-45, 0, 45] })
      expect(result.indexAnglesDeg).toEqual([-45, 0, 45])
    })
  })

  describe('one invalid field does not affect others', () => {
    it('returns valid fields alongside invalid ones', () => {
      const result = parse4AxisParams({
        cylinderDiameterMm: 50,       // valid
        cylinderLengthMm: 'bad',      // invalid (string)
        stepoverDeg: -1,              // invalid (negative)
        overcutMm: 0.5,              // valid
        contourPoints: [[1, 2]],      // valid
      })
      expect(result.cylinderDiameterMm).toBe(50)
      expect(result.cylinderLengthMm).toBeUndefined()
      expect(result.stepoverDeg).toBeUndefined()
      expect(result.overcutMm).toBe(0.5)
      expect(result.contourPoints).toEqual([[1, 2]])
    })
  })

  describe('null values return undefined', () => {
    it('treats null as missing for all field types', () => {
      const result = parse4AxisParams({
        cylinderDiameterMm: null,
        wrapAxis: null,
        useMeshMachinableXClamp: null,
        contourPoints: null,
        indexAnglesDeg: null,
      })
      expect(result.cylinderDiameterMm).toBeUndefined()
      expect(result.wrapAxis).toBeUndefined()
      expect(result.useMeshMachinableXClamp).toBeUndefined()
      expect(result.contourPoints).toBeUndefined()
      expect(result.indexAnglesDeg).toBeUndefined()
    })
  })
})
