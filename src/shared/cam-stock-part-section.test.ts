import { describe, expect, it } from 'vitest'
import { buildPartHeightField, type Triangle3 } from './cam-stock-part-section'
import { sampleHeightFieldZ } from './cam-heightfield-2d5'

/** Two triangles forming a flat square at constant Z over [0,size] × [0,size]. */
function flatTopBox(size: number, z: number): Triangle3[] {
  return [
    [[0, 0, z], [size, 0, z], [size, size, z]],
    [[0, 0, z], [size, size, z], [0, size, z]]
  ]
}

describe('buildPartHeightField', () => {
  it('yields partTopZ ≈ box top within the footprint', () => {
    const top = -2
    const tris = flatTopBox(20, top)
    const f = buildPartHeightField(tris, { minX: 0, minY: 0, maxX: 20, maxY: 20, maxCols: 16, maxRows: 16 })
    // Sample at the centre — squarely inside the footprint.
    expect(sampleHeightFieldZ(f, 10, 10)).toBeCloseTo(top, 5)
    // And at an off-centre interior point.
    expect(sampleHeightFieldZ(f, 5, 15)).toBeCloseTo(top, 5)
  })

  it('uses emptyZ for cells with no triangle coverage', () => {
    const top = 1
    // Small 10×10 part placed inside a larger 30×30 sampling region.
    const tris = flatTopBox(10, top)
    const emptyZ = -999
    const f = buildPartHeightField(tris, {
      minX: 0, minY: 0, maxX: 30, maxY: 30, maxCols: 30, maxRows: 30, emptyZ
    })
    // Inside the part footprint → top.
    expect(sampleHeightFieldZ(f, 5, 5)).toBeCloseTo(top, 5)
    // Far outside the part footprint → emptyZ sentinel (no phantom material).
    expect(sampleHeightFieldZ(f, 27, 27)).toBeCloseTo(emptyZ, 5)
  })

  it('defaults to a large-negative emptyZ sentinel when none is given', () => {
    const tris = flatTopBox(10, 0)
    const f = buildPartHeightField(tris, { minX: 0, minY: 0, maxX: 40, maxY: 40, maxCols: 20, maxRows: 20 })
    // A clearly-outside corner cell should be deeply negative.
    const corner = sampleHeightFieldZ(f, 38, 38)
    expect(corner).toBeLessThan(-1000)
  })

  it('takes the maximum Z over stacked (overlapping) triangles (upper envelope)', () => {
    // A low flat layer at z=0 and a high flat layer at z=5 over the same square.
    const low = flatTopBox(10, 0)
    const high = flatTopBox(10, 5)
    const f = buildPartHeightField([...low, ...high], { minX: 0, minY: 0, maxX: 10, maxY: 10, maxCols: 16, maxRows: 16 })
    // The upper surface wins.
    expect(sampleHeightFieldZ(f, 5, 5)).toBeCloseTo(5, 5)
  })

  it('captures a sloped top (Z varies with position)', () => {
    // A single ramp triangle rising in +X from z=0 at x=0 to z=10 at x=10.
    const tris: Triangle3[] = [
      [[0, 0, 0], [10, 0, 10], [10, 10, 10]],
      [[0, 0, 0], [10, 10, 10], [0, 10, 0]]
    ]
    const f = buildPartHeightField(tris, { minX: 0, minY: 0, maxX: 10, maxY: 10, maxCols: 32, maxRows: 32 })
    const zLow = sampleHeightFieldZ(f, 1, 5)
    const zHigh = sampleHeightFieldZ(f, 9, 5)
    expect(zHigh).toBeGreaterThan(zLow)
    // Roughly linear: midpoint sits between the ends.
    const zMid = sampleHeightFieldZ(f, 5, 5)
    expect(zMid).toBeGreaterThan(zLow)
    expect(zMid).toBeLessThan(zHigh)
  })

  it('produces an in-bounds grid that respects the caps', () => {
    const f = buildPartHeightField(flatTopBox(100, 0), {
      minX: 0, minY: 0, maxX: 100, maxY: 100, maxCols: 24, maxRows: 24
    })
    expect(f.cols).toBeGreaterThanOrEqual(2)
    expect(f.rows).toBeGreaterThanOrEqual(2)
    expect(f.cols).toBeLessThanOrEqual(24)
    expect(f.rows).toBeLessThanOrEqual(24)
    expect(f.topZ.length).toBe(f.cols * f.rows)
    expect(f.stockTopZ).toBe(f.topZ.length > 0 ? f.stockTopZ : 0)
  })

  it('honors an explicit cellMm', () => {
    const f = buildPartHeightField(flatTopBox(20, 0), {
      minX: 0, minY: 0, maxX: 20, maxY: 20, cellMm: 2, maxCols: 64, maxRows: 64
    })
    expect(f.cellMm).toBeCloseTo(2, 5)
    expect(f.cols).toBe(10)
    expect(f.rows).toBe(10)
  })

  it('is deterministic — identical inputs give byte-identical topZ', () => {
    const tris = flatTopBox(20, -1.5)
    const opts = { minX: 0, minY: 0, maxX: 20, maxY: 20, maxCols: 24, maxRows: 24 } as const
    const a = buildPartHeightField(tris, opts)
    const b = buildPartHeightField(tris, opts)
    expect(Array.from(a.topZ)).toEqual(Array.from(b.topZ))
  })

  it('handles an empty triangle list by filling everything with emptyZ', () => {
    const emptyZ = -123
    const f = buildPartHeightField([], { minX: 0, minY: 0, maxX: 10, maxY: 10, maxCols: 8, maxRows: 8, emptyZ })
    expect(Array.from(f.topZ).every((z) => z === emptyZ)).toBe(true)
    expect(sampleHeightFieldZ(f, 5, 5)).toBeCloseTo(emptyZ, 5)
  })

  it('keeps every cell finite', () => {
    const f = buildPartHeightField(flatTopBox(10, 2), { minX: 0, minY: 0, maxX: 10, maxY: 10, maxCols: 12, maxRows: 12 })
    expect(Array.from(f.topZ).every((z) => Number.isFinite(z))).toBe(true)
  })
})
