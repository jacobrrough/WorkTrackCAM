/**
 * True-shape nesting v1 — paired tests.
 *
 * Covers the four acceptance scenarios from the Gap #9 brief:
 *  1. 4 identical 40×40 squares fit on a 100×100 sheet (high utilization).
 *  2. 1 square + 2 rectangles fit with sensible bottom-left placements.
 *  3. A part larger than the sheet is reported as unplaced.
 *  4. Utilization % matches a hand-calculated baseline.
 *
 * Additional sanity tests cover rotation, sheet margin, and inter-part
 * margin behaviour so v2 work has a stable contract to diff against.
 */
import { describe, expect, it } from 'vitest'
import { nestPolygonsOnSheet, type Polygon, type SheetSpec } from './true-shape-v1'

/** Build a closed-rectangle polygon centred on (0,0) for the given size. */
function rect(id: string, widthMm: number, heightMm: number): Polygon {
  const hw = widthMm / 2
  const hh = heightMm / 2
  return {
    id,
    points: [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh]
    ]
  }
}

describe('nestPolygonsOnSheet — v1 bottom-left-fill', () => {
  it('packs 4 identical 40×40 squares into a 100×100 sheet (no inter-part margin)', () => {
    // Four 40-mm squares = 6400 mm². Sheet = 10 000 mm². Max theoretical
    // utilization with zero margin = 64%. We allow no inter-part margin
    // so all four must place; with the default 2 mm snap they land at
    // (0,0), (40,0), (0,40), (40,40).
    const sheet: SheetSpec = { widthMm: 100, heightMm: 100 }
    const parts: Polygon[] = [
      rect('sq-a', 40, 40),
      rect('sq-b', 40, 40),
      rect('sq-c', 40, 40),
      rect('sq-d', 40, 40)
    ]
    const result = nestPolygonsOnSheet(parts, sheet, { partMarginMm: 0, snapMm: 2 })

    expect(result.unplaced).toEqual([])
    expect(result.placements).toHaveLength(4)

    // Hand-calculated baseline: 4 * 40 * 40 / (100 * 100) * 100 = 64%
    expect(result.utilizationPct).toBeCloseTo(64, 5)
    expect(result.totalPartAreaMm2).toBeCloseTo(6400, 5)
    expect(result.sheetUsedAreaMm2).toBeCloseTo(10000, 5)

    // BLF placement — first square goes to bottom-left corner.
    const first = result.placements[0]!
    expect(first.xMm).toBeCloseTo(0, 5)
    expect(first.yMm).toBeCloseTo(0, 5)

    // No two placements may overlap. Squares are 40×40, so any two non-
    // overlapping placements must differ by ≥40 mm in X or Y.
    for (let i = 0; i < result.placements.length; i++) {
      for (let j = i + 1; j < result.placements.length; j++) {
        const a = result.placements[i]!
        const b = result.placements[j]!
        const dx = Math.abs(a.xMm - b.xMm)
        const dy = Math.abs(a.yMm - b.yMm)
        expect(dx >= 40 - 1e-6 || dy >= 40 - 1e-6).toBe(true)
      }
    }
  })

  it('places 1 square + 2 rectangles with sensible bottom-left positions', () => {
    // Sheet 200×100. Place a 60×60 square + two 40×20 rectangles.
    // Hand layout: square at (0,0)-(60,60); rect-a at (60,0)-(100,20);
    // rect-b at (60,20)-(100,40). All three should land.
    const sheet: SheetSpec = { widthMm: 200, heightMm: 100 }
    const parts: Polygon[] = [
      rect('sq', 60, 60),
      rect('rect-a', 40, 20),
      rect('rect-b', 40, 20)
    ]
    const result = nestPolygonsOnSheet(parts, sheet, { partMarginMm: 0, snapMm: 5 })

    expect(result.unplaced).toEqual([])
    expect(result.placements).toHaveLength(3)

    // Total area = 60*60 + 2*40*20 = 3600 + 1600 = 5200 mm². Sheet = 20000.
    expect(result.totalPartAreaMm2).toBeCloseTo(5200, 5)
    expect(result.utilizationPct).toBeCloseTo(26, 5)

    // Every placement must stay inside the sheet envelope.
    for (const p of result.placements) {
      expect(p.xMm).toBeGreaterThanOrEqual(0)
      expect(p.yMm).toBeGreaterThanOrEqual(0)
      const w = p.partId === 'sq' ? 60 : 40
      const h = p.partId === 'sq' ? 60 : 20
      // Rotation 90 swaps W/H. v1 picks 0° first for these, but allow either.
      const effW = p.rotationDeg === 90 || p.rotationDeg === 270 ? h : w
      const effH = p.rotationDeg === 90 || p.rotationDeg === 270 ? w : h
      expect(p.xMm + effW).toBeLessThanOrEqual(sheet.widthMm + 1e-6)
      expect(p.yMm + effH).toBeLessThanOrEqual(sheet.heightMm + 1e-6)
    }
  })

  it('returns a part bigger than the sheet as unplaced (no overlapping placement attempted)', () => {
    const sheet: SheetSpec = { widthMm: 100, heightMm: 100 }
    const oversized = rect('too-big', 150, 80)
    const ok = rect('ok', 40, 40)
    const result = nestPolygonsOnSheet([oversized, ok], sheet, { partMarginMm: 0 })

    expect(result.unplaced).toContain('too-big')
    expect(result.unplaced).toHaveLength(1)
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]!.partId).toBe('ok')

    // Hand baseline: only the 40x40 fits, so utilization = 1600 / 10000 = 16%.
    expect(result.utilizationPct).toBeCloseTo(16, 5)
  })

  it('utilization % matches the hand-calculated baseline for a known layout', () => {
    // Two 50×50 squares on a 100×200 sheet.
    // Hand baseline: 2 * 2500 / 20000 * 100 = 25.0%
    const sheet: SheetSpec = { widthMm: 100, heightMm: 200 }
    const parts: Polygon[] = [rect('s1', 50, 50), rect('s2', 50, 50)]
    const result = nestPolygonsOnSheet(parts, sheet, { partMarginMm: 0, snapMm: 5 })

    expect(result.unplaced).toEqual([])
    expect(result.totalPartAreaMm2).toBeCloseTo(5000, 5)
    expect(result.sheetUsedAreaMm2).toBeCloseTo(20000, 5)
    expect(result.utilizationPct).toBeCloseTo(25, 5)
  })

  it('honours allowedRotations: rotating an oversized-in-X part 90° lets it fit', () => {
    // 80×40 part on a 50×200 sheet — does not fit at 0° (X=80>50)
    // but fits at 90° (X=40, Y=80).
    const sheet: SheetSpec = { widthMm: 50, heightMm: 200 }
    const part = rect('rotates', 80, 40)
    const result = nestPolygonsOnSheet([part], sheet, {
      partMarginMm: 0,
      allowedRotations: [0, 90]
    })
    expect(result.unplaced).toEqual([])
    const p = result.placements[0]!
    expect(p.rotationDeg).toBe(90)
  })

  it('honours sheet margin (parts cannot land inside the margin band)', () => {
    const sheet: SheetSpec = { widthMm: 100, heightMm: 100, marginMm: 10 }
    const part = rect('p', 40, 40)
    const result = nestPolygonsOnSheet([part], sheet, { partMarginMm: 0 })
    const p = result.placements[0]!
    expect(p.xMm).toBeGreaterThanOrEqual(10 - 1e-6)
    expect(p.yMm).toBeGreaterThanOrEqual(10 - 1e-6)
    expect(p.xMm + 40).toBeLessThanOrEqual(90 + 1e-6)
    expect(p.yMm + 40).toBeLessThanOrEqual(90 + 1e-6)
  })

  it('honours partMarginMm (placed boxes keep the requested clearance)', () => {
    const sheet: SheetSpec = { widthMm: 200, heightMm: 200 }
    const parts: Polygon[] = [rect('a', 40, 40), rect('b', 40, 40)]
    const result = nestPolygonsOnSheet(parts, sheet, { partMarginMm: 10, snapMm: 2 })

    expect(result.unplaced).toEqual([])
    expect(result.placements).toHaveLength(2)

    const [a, b] = result.placements
    const dx = Math.abs(a!.xMm - b!.xMm)
    const dy = Math.abs(a!.yMm - b!.yMm)
    // With 40 mm parts and 10 mm clearance, neighbours must differ by
    // ≥50 mm in at least one axis.
    expect(dx >= 50 - 1e-6 || dy >= 50 - 1e-6).toBe(true)
  })

  it('rejects malformed sheet dimensions', () => {
    expect(() => nestPolygonsOnSheet([], { widthMm: 0, heightMm: 100 })).toThrow()
    expect(() => nestPolygonsOnSheet([], { widthMm: 100, heightMm: -1 })).toThrow()
  })

  it('rejects non-cardinal rotations', () => {
    // 45° is not in the cardinal {0,90,180,270} set — must throw.
    expect(() =>
      nestPolygonsOnSheet([rect('p', 10, 10)], { widthMm: 100, heightMm: 100 }, {
        allowedRotations: [45] as unknown as ReadonlyArray<0>
      })
    ).toThrow(/Invalid rotation/)
  })

  it('returns 0% utilization for an empty parts list', () => {
    const result = nestPolygonsOnSheet([], { widthMm: 100, heightMm: 100 })
    expect(result.placements).toEqual([])
    expect(result.unplaced).toEqual([])
    expect(result.utilizationPct).toBe(0)
    expect(result.totalPartAreaMm2).toBe(0)
  })
})
