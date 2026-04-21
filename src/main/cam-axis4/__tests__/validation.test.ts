/**
 * Tests for `validateAxis4Job` — pre-generation hard checks.
 *
 * Each error path has its own test with a specific assertion. The principle
 * being tested: validation should catch impossible / unsafe job configurations
 * BEFORE any G-code is generated, and produce actionable hints, not silent
 * miscentering or post-hoc warnings.
 */
import { describe, expect, it } from 'vitest'
import type { MeshFrameResult } from '../frame'
import { validateAxis4Job, type ValidationContext } from '../validation'

const BASE_FRAME: MeshFrameResult = {
  triangles: [],
  bbox: { min: [10, -5, -5], max: [90, 5, 5] },
  meshRadialMax: 5,
  meshRadialMin: 0,
  warnings: []
}

function ctx(over: Partial<ValidationContext> = {}): ValidationContext {
  return {
    operationKind: 'cnc_4axis_roughing',
    stock: { lengthMm: 100, diameterMm: 40 },
    axisCount: 4,
    aAxisOrientation: 'x',
    dialect: 'cnc_4axis_grbl',
    frame: BASE_FRAME,
    machXStartMm: 5,
    machXEndMm: 95,
    zPassMm: -2,
    ...over
  }
}

describe('validateAxis4Job — happy path', () => {
  it('passes a sane roughing job with no warnings', () => {
    const r = validateAxis4Job(ctx())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings).toEqual([])
  })
})

describe('validateAxis4Job — operation kind', () => {
  it('rejects a non-4-axis kind (internal dispatch error)', () => {
    const r = validateAxis4Job(ctx({ operationKind: 'cnc_contour' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/non-4-axis kind/)
  })
})

describe('validateAxis4Job — machine axis count', () => {
  it('rejects a 3-axis machine', () => {
    const r = validateAxis4Job(ctx({ axisCount: 3 }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/axisCount ≥ 4/)
      expect(r.hint).toMatch(/Carvera|axisCount: 4/)
    }
  })
})

describe('validateAxis4Job — A-axis orientation', () => {
  it('rejects Y-axis rotary in v1', () => {
    const r = validateAxis4Job(ctx({ aAxisOrientation: 'y' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/around X/)
  })
})

describe('validateAxis4Job — post-process dialect', () => {
  it('rejects a non-grbl dialect', () => {
    const r = validateAxis4Job(ctx({ dialect: 'cnc_4axis_fanuc' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/GRBL/)
  })

  it('accepts cnc_4axis_grbl', () => {
    const r = validateAxis4Job(ctx({ dialect: 'cnc_4axis_grbl' }))
    expect(r.ok).toBe(true)
  })
})

describe('validateAxis4Job — stock geometry', () => {
  it('rejects zero or negative length', () => {
    const r = validateAxis4Job(ctx({ stock: { lengthMm: 0, diameterMm: 40 } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/length must be > 0/)
  })

  it('rejects zero or negative diameter', () => {
    const r = validateAxis4Job(ctx({ stock: { lengthMm: 100, diameterMm: 0 } }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/diameter must be > 0/)
  })
})

describe('validateAxis4Job — zPassMm', () => {
  it('rejects NaN', () => {
    const r = validateAxis4Job(ctx({ zPassMm: NaN }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/finite/)
  })

  it('rejects depth that would cut past the rotation axis', () => {
    const r = validateAxis4Job(
      ctx({ stock: { lengthMm: 100, diameterMm: 20 }, zPassMm: -15 })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds stock radius/)
  })

  it('accepts a depth equal to stock radius (with epsilon)', () => {
    const r = validateAxis4Job(
      ctx({ stock: { lengthMm: 100, diameterMm: 20 }, zPassMm: -10 })
    )
    expect(r.ok).toBe(true)
  })
})

describe('validateAxis4Job — machinable X span (chuck-face safety)', () => {
  it('rejects negative machXStartMm (chuck collision)', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: -1, machXEndMm: 95 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/chuck face/)
  })

  it('rejects empty machinable span', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: 50, machXEndMm: 50 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/empty/)
  })

  it('rejects machXEndMm beyond stock length', () => {
    const r = validateAxis4Job(ctx({ machXStartMm: 5, machXEndMm: 200 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceeds stock length/)
  })
})

describe('validateAxis4Job — radial extent (the undercut bug)', () => {
  it('rejects mesh that extends past stock OD', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      meshRadialMax: 25 // stock diameter is 40 → radius 20
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toMatch(/past the stock OD/)
      expect(r.hint).toMatch(/Increase rotary stock Ø/)
      expect(r.hint).toMatch(/50/) // 2 × 25 mm
    }
  })

  it('accepts mesh that exactly fits within stock OD', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      meshRadialMax: 19.9
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(true)
  })
})

describe('validateAxis4Job — axial bbox (the toolpath-doesnt-map bug)', () => {
  it('rejects mesh whose X bbox is entirely off the stock', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [200, -5, -5], max: [220, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/entirely outside|does not fit/)
  })

  it('rejects mesh whose X bbox starts at negative (chuck collision)', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [-10, -5, -5], max: [50, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/does not fit inside stock/)
  })

  it('warns (does not error) when mesh barely overlaps machinable span', () => {
    const frame: MeshFrameResult = {
      ...BASE_FRAME,
      bbox: { min: [0, -5, -5], max: [4, 5, 5] }
    }
    const r = validateAxis4Job(ctx({ frame, machXStartMm: 5, machXEndMm: 95 }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some((w) => /barely overlap/.test(w))).toBe(true)
  })
})

describe('validateAxis4Job — contour mode', () => {
  const baseContour = {
    operationKind: 'cnc_4axis_contour' as const,
    contourPoints: [
      [10, 0],
      [50, 30],
      [90, 0]
    ] as ReadonlyArray<readonly [number, number]>
  }

  it('rejects fewer than 2 contour points', () => {
    const r = validateAxis4Job(
      ctx({ ...baseContour, contourPoints: [[10, 0]] })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/at least 2 contour points/)
  })

  it('rejects contour X out of machinable span', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseContour,
        contourPoints: [[10, 0], [200, 30]],
        machXStartMm: 5,
        machXEndMm: 95
      })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/do not fit inside machinable span/)
  })

  it('warns (does not error) when contour is not closed', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseContour,
        contourPoints: [
          [10, 0],
          [50, 30],
          [90, 60]
        ]
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some((w) => /not closed/.test(w))).toBe(true)
  })
})

describe('validateAxis4Job — indexed mode', () => {
  const baseIndexed = {
    operationKind: 'cnc_4axis_indexed' as const,
    indexAnglesDeg: [0, 90, 180, 270] as ReadonlyArray<number>
  }

  it('rejects empty indexAnglesDeg', () => {
    const r = validateAxis4Job(ctx({ ...baseIndexed, indexAnglesDeg: [] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/at least one indexAnglesDeg/)
  })

  it('rejects angles outside aAxisRangeDeg', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseIndexed,
        indexAnglesDeg: [0, 90, 200],
        aAxisRangeDeg: 180
      })
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/exceed machine A-axis range/)
  })

  it('accepts angles within aAxisRangeDeg', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseIndexed,
        indexAnglesDeg: [-90, 0, 90],
        aAxisRangeDeg: 180
      })
    )
    expect(r.ok).toBe(true)
  })

  it('warns on duplicate indexed angles', () => {
    const r = validateAxis4Job(
      ctx({
        ...baseIndexed,
        indexAnglesDeg: [0, 90, 90, 180]
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some((w) => /duplicates/.test(w))).toBe(true)
  })
})
