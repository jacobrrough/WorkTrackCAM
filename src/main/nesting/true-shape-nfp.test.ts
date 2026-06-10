/**
 * True-shape NFP nesting (v2) — safety-proof tests.
 *
 * These are the load-bearing tests of the NFP wave. A bad nest scraps a full
 * 1524 × 3048 mm sheet on the Laguna Swift, so the properties proved here ARE
 * the safety contract:
 *
 *  (a) NO pair of placed parts overlaps — pairwise Clipper intersection area
 *      is EXACTLY 0 on the spacing-inflated polygons at their placed
 *      transforms (verified with an INDEPENDENT intersection + shoelace, not
 *      the engine's own gate).
 *  (b) Every part lies fully inside the sheet (and its margin band).
 *  (c) Utilization beats the v1 bounding-box BLF on real shapes — the
 *      L-bracket's bbox waste is the canonical win.
 *  (d) Determinism — same input ⇒ identical result (no RNG, no clock).
 *
 * Plus the multi-sheet overflow contract (sheetIndex / sheetsUsed / maxSheets
 * cap) and the additive result-shape compatibility with v1's NestResult.
 */
import { describe, expect, it } from 'vitest'
import ClipperLib, { type IntPoint, type Paths } from 'clipper-lib'
import { nestPolygonsOnSheet, type Polygon, type SheetSpec } from './true-shape-v1'
import {
  nestPolygonsNfp,
  placedInflatedPathsInt,
  placedRawPointsMm,
  type NfpNestResult
} from './true-shape-nfp'

// ─── Fixtures (real Laguna-ish shapes, mm) ───────────────────────────────────

/** L-bracket: 100×100 outer, 40 mm legs. Area 6400 mm², bbox waste 3600 mm². */
function lBracket(id: string): Polygon {
  return {
    id,
    points: [
      [0, 0],
      [100, 0],
      [100, 40],
      [40, 40],
      [40, 100],
      [0, 100]
    ]
  }
}

/** Axis-aligned rectangle with min corner at the origin. */
function rectangle(id: string, w: number, h: number): Polygon {
  return {
    id,
    points: [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h]
    ]
  }
}

/** Circle-ish 24-gon centred on (0,0). */
function circle24(id: string, r: number): Polygon {
  const points: Array<readonly [number, number]> = []
  for (let k = 0; k < 24; k++) {
    const t = (k / 24) * Math.PI * 2
    points.push([r * Math.cos(t), r * Math.sin(t)])
  }
  return { id, points }
}

/** Concave C-shape: 80×80 outer, 30-tall × 55-deep notch opening toward +X. */
function cShape(id: string): Polygon {
  return {
    id,
    points: [
      [0, 0],
      [80, 0],
      [80, 25],
      [25, 25],
      [25, 55],
      [80, 55],
      [80, 80],
      [0, 80]
    ]
  }
}

// ─── Independent verification helpers (NOT the engine's own gate) ────────────

/** Absolute shoelace area of one integer ring (exact: test coords ≪ 2^53). */
function shoelaceAbsInt(ring: IntPoint[]): number {
  const n = ring.length
  if (n < 3) return 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    s += a.X * b.Y - b.X * a.Y
  }
  return Math.abs(s) / 2
}

/** Independent Clipper intersection area (int units²) — re-implemented here. */
function independentIntersectionArea(a: Paths, b: Paths): number {
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(a, ClipperLib.PolyType.ptSubject, true)
  clipper.AddPaths(b, ClipperLib.PolyType.ptClip, true)
  const solution: Paths = []
  clipper.Execute(
    ClipperLib.ClipType.ctIntersection,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  )
  let area = 0
  for (const ring of solution) area += shoelaceAbsInt(ring)
  return area
}

/**
 * Property (a): max pairwise intersection area across all SAME-SHEET pairs of
 * placed parts, on the spacing-inflated polygons at their placed transforms.
 * Must be exactly 0.
 */
function maxPairwiseInflatedOverlap(
  parts: ReadonlyArray<Polygon>,
  result: NfpNestResult,
  spacingMm: number
): number {
  const byId = new Map(parts.map((p) => [p.id, p]))
  const bodies = result.placements.map((pl) => {
    const part = byId.get(pl.partId)
    expect(part, `placement references unknown part ${pl.partId}`).toBeDefined()
    const paths = placedInflatedPathsInt(part!, pl, spacingMm)
    expect(paths, `degenerate placed geometry for ${pl.partId}`).not.toBeNull()
    return { sheetIndex: pl.sheetIndex, paths: paths! }
  })
  let worst = 0
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (bodies[i]!.sheetIndex !== bodies[j]!.sheetIndex) continue
      const area = independentIntersectionArea(bodies[i]!.paths, bodies[j]!.paths)
      if (area > worst) worst = area
    }
  }
  return worst
}

/** Property (b): every placed RAW outline stays inside the sheet margin band. */
function assertAllInsideSheet(
  parts: ReadonlyArray<Polygon>,
  result: NfpNestResult,
  sheet: SheetSpec
): void {
  const byId = new Map(parts.map((p) => [p.id, p]))
  const margin = Math.max(0, sheet.marginMm ?? 0)
  const eps = 1e-3
  for (const pl of result.placements) {
    const pts = placedRawPointsMm(byId.get(pl.partId)!, pl)
    expect(pts).not.toBeNull()
    for (const [x, y] of pts!) {
      expect(x).toBeGreaterThanOrEqual(margin - eps)
      expect(y).toBeGreaterThanOrEqual(margin - eps)
      expect(x).toBeLessThanOrEqual(sheet.widthMm - margin + eps)
      expect(y).toBeLessThanOrEqual(sheet.heightMm - margin + eps)
    }
  }
}

/** Max placed raw-outline Y in mm — the "sheet extent" the strip comparison uses. */
function maxPlacedYMm(parts: ReadonlyArray<Polygon>, result: NfpNestResult): number {
  const byId = new Map(parts.map((p) => [p.id, p]))
  let maxY = -Infinity
  for (const pl of result.placements) {
    const pts = placedRawPointsMm(byId.get(pl.partId)!, pl)!
    for (const [, y] of pts) if (y > maxY) maxY = y
  }
  return maxY
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('nestPolygonsNfp — safety properties (a) no overlap + (b) inside sheet', () => {
  it('nests a mixed real-shape set (L, circle, strips, concave C) with zero pairwise inflated overlap', () => {
    const sheet: SheetSpec = { widthMm: 600, heightMm: 400, marginMm: 10 }
    const spacing = 6
    const parts: Polygon[] = [
      lBracket('L-1'),
      lBracket('L-2'),
      circle24('disc', 40),
      rectangle('strip-1', 300, 20),
      rectangle('strip-2', 300, 20),
      cShape('cee')
    ]
    const result = nestPolygonsNfp(parts, sheet, { partMarginMm: spacing })

    expect(result.unplaced).toEqual([])
    expect(result.placements).toHaveLength(parts.length)
    expect(result.sheetsUsed).toBe(1)
    expect(result.placements.every((p) => p.sheetIndex === 0)).toBe(true)

    // Bookkeeping sanity: each part exactly once.
    const ids = result.placements.map((p) => p.partId).sort()
    expect(ids).toEqual(parts.map((p) => p.id).sort())

    // (a) EXACT zero pairwise overlap on the spacing-inflated geometry.
    expect(maxPairwiseInflatedOverlap(parts, result, spacing)).toBe(0)

    // (b) raw outlines inside the margin band.
    assertAllInsideSheet(parts, result, sheet)
  })

  it('keeps the concave C-shape and a touching disc overlap-free (vertex-edge contact)', () => {
    const sheet: SheetSpec = { widthMm: 150, heightMm: 100 }
    const parts: Polygon[] = [cShape('cee'), circle24('disc', 15)]
    const result = nestPolygonsNfp(parts, sheet, { partMarginMm: 0 })

    expect(result.unplaced).toEqual([])
    expect(maxPairwiseInflatedOverlap(parts, result, 0)).toBe(0)
    assertAllInsideSheet(parts, result, sheet)

    // C (larger) goes first to the corner; the disc slides against its right
    // wall at y=0 — bottom-left-fill on the true outline, not the bbox.
    const cee = result.placements.find((p) => p.partId === 'cee')!
    const disc = result.placements.find((p) => p.partId === 'disc')!
    expect(cee.xMm).toBeCloseTo(0, 6)
    expect(cee.yMm).toBeCloseTo(0, 6)
    expect(disc.yMm).toBeCloseTo(0, 6)
    expect(disc.xMm).toBeCloseTo(80, 3)
  })

  it('honours partMarginMm geometrically AND keeps spacing/2 off the sheet edge (documented divergence)', () => {
    const sheet: SheetSpec = { widthMm: 200, heightMm: 200 }
    const spacing = 10
    const parts: Polygon[] = [rectangle('a', 40, 40), rectangle('b', 40, 40)]
    const result = nestPolygonsNfp(parts, sheet, { partMarginMm: spacing })

    expect(result.unplaced).toEqual([])
    expect(maxPairwiseInflatedOverlap(parts, result, spacing)).toBe(0)

    // First square sits spacing/2 = 5 mm off both sheet edges (the inflated
    // body touches the sheet boundary), second exactly 40 + 10 mm further.
    const a = result.placements[0]!
    const b = result.placements[1]!
    expect(a.xMm).toBeCloseTo(5, 6)
    expect(a.yMm).toBeCloseTo(5, 6)
    expect(b.yMm).toBeCloseTo(5, 6)
    expect(b.xMm).toBeCloseTo(55, 6)
    expect(Math.abs(b.xMm - a.xMm)).toBeGreaterThanOrEqual(50 - 1e-6)
  })
})

describe('nestPolygonsNfp — (c) utilization beats the v1 bounding-box BLF', () => {
  const rotations: ReadonlyArray<0 | 90 | 180 | 270> = [0, 90, 180, 270]

  it('interlocks two L-brackets on a 100×180 sheet where bbox BLF can only place one', () => {
    const sheet: SheetSpec = { widthMm: 100, heightMm: 180 }
    const parts: Polygon[] = [lBracket('l1'), lBracket('l2')]

    const v1 = nestPolygonsOnSheet(parts, sheet, {
      partMarginMm: 0,
      snapMm: 2,
      allowedRotations: rotations
    })
    const nfp = nestPolygonsNfp(parts, sheet, {
      partMarginMm: 0,
      allowedRotations: [...rotations]
    })

    // v1 reserves the full 100×100 bbox per L → the second L cannot fit.
    expect(v1.placements).toHaveLength(1)
    expect(v1.unplaced).toHaveLength(1)

    // NFP interlocks the pair (second L rotated 180°, dropped into the notch).
    expect(nfp.unplaced).toEqual([])
    expect(nfp.placements).toHaveLength(2)
    const l2 = nfp.placements.find((p) => p.partId === 'l2')!
    expect(l2.rotationDeg).toBe(180)
    expect(l2.xMm).toBeCloseTo(0, 6)
    expect(l2.yMm).toBeCloseTo(40, 6)

    // STRICT utilization win on the identical sheet.
    expect(nfp.utilizationPct).toBeGreaterThan(v1.utilizationPct)
    expect(nfp.utilizationPct).toBeCloseTo(71.111, 3)
    expect(v1.utilizationPct).toBeCloseTo(35.556, 3)

    // Safety still holds at the tighter pack.
    expect(maxPairwiseInflatedOverlap(parts, nfp, 0)).toBe(0)
    assertAllInsideSheet(parts, nfp, sheet)
  })

  it('uses strictly less sheet extent than v1 when both engines place every L (100×200)', () => {
    const sheet: SheetSpec = { widthMm: 100, heightMm: 200 }
    const parts: Polygon[] = [lBracket('l1'), lBracket('l2')]

    const v1 = nestPolygonsOnSheet(parts, sheet, {
      partMarginMm: 0,
      snapMm: 2,
      allowedRotations: rotations
    })
    const nfp = nestPolygonsNfp(parts, sheet, {
      partMarginMm: 0,
      allowedRotations: [...rotations]
    })

    expect(v1.placements).toHaveLength(2)
    expect(nfp.placements).toHaveLength(2)

    // v1 stacks bboxes: extent 200 mm. NFP interlocks: extent 140 mm.
    const v1Extent = Math.max(...v1.placements.map((p) => p.yMm + 100))
    const nfpExtent = maxPlacedYMm(parts, nfp)
    expect(nfpExtent).toBeLessThan(v1Extent - 1e-6)
    expect(nfpExtent).toBeCloseTo(140, 6)
    expect(v1Extent).toBeCloseTo(200, 6)

    expect(maxPairwiseInflatedOverlap(parts, nfp, 0)).toBe(0)
  })
})

describe('nestPolygonsNfp — multi-sheet overflow', () => {
  it('opens one sheet per 60×60 square on a 100×100 sheet and reports sheetIndex/sheetsUsed', () => {
    const sheet: SheetSpec = { widthMm: 100, heightMm: 100 }
    const parts: Polygon[] = [
      rectangle('sq1', 60, 60),
      rectangle('sq2', 60, 60),
      rectangle('sq3', 60, 60)
    ]
    const result = nestPolygonsNfp(parts, sheet, { partMarginMm: 0 })

    expect(result.unplaced).toEqual([])
    expect(result.sheetsUsed).toBe(3)
    expect(result.placements.map((p) => p.sheetIndex)).toEqual([0, 1, 2])
    expect(result.sheetUsedAreaMm2).toBeCloseTo(30000, 5)
    expect(result.utilizationPct).toBeCloseTo(36, 5)
    expect(maxPairwiseInflatedOverlap(parts, result, 0)).toBe(0)
    assertAllInsideSheet(parts, result, sheet)
  })

  it('caps at maxSheets and reports the spilled part as unplaced', () => {
    const sheet: SheetSpec = { widthMm: 100, heightMm: 100 }
    const parts: Polygon[] = [
      rectangle('sq1', 60, 60),
      rectangle('sq2', 60, 60),
      rectangle('sq3', 60, 60)
    ]
    const result = nestPolygonsNfp(parts, sheet, { partMarginMm: 0, maxSheets: 2 })

    expect(result.sheetsUsed).toBe(2)
    expect(result.placements).toHaveLength(2)
    expect(result.unplaced).toEqual(['sq3'])
  })

  it('first-fit backfills an earlier sheet when a smaller part still fits there', () => {
    const sheet: SheetSpec = { widthMm: 100, heightMm: 100 }
    const parts: Polygon[] = [
      rectangle('sq1', 60, 60),
      rectangle('sq2', 60, 60),
      rectangle('small', 30, 30)
    ]
    const result = nestPolygonsNfp(parts, sheet, { partMarginMm: 0 })

    expect(result.unplaced).toEqual([])
    expect(result.sheetsUsed).toBe(2)
    const small = result.placements.find((p) => p.partId === 'small')!
    expect(small.sheetIndex).toBe(0) // tucked beside sq1, not onto a third sheet
    expect(small.xMm).toBeCloseTo(60, 6)
    expect(small.yMm).toBeCloseTo(0, 6)
    expect(maxPairwiseInflatedOverlap(parts, result, 0)).toBe(0)
  })

  it('reports a part too big for ANY sheet as unplaced without opening sheets for it', () => {
    const sheet: SheetSpec = { widthMm: 100, heightMm: 100 }
    const oversized = rectangle('too-big', 200, 50)
    const ok = rectangle('ok', 40, 40)

    const result = nestPolygonsNfp([oversized, ok], sheet, { partMarginMm: 0 })
    expect(result.unplaced).toEqual(['too-big'])
    expect(result.placements).toHaveLength(1)
    expect(result.placements[0]!.partId).toBe('ok')
    expect(result.sheetsUsed).toBe(1)

    const onlyOversized = nestPolygonsNfp([oversized], sheet, { partMarginMm: 0 })
    expect(onlyOversized.unplaced).toEqual(['too-big'])
    expect(onlyOversized.sheetsUsed).toBe(0)
    expect(onlyOversized.sheetUsedAreaMm2).toBe(0)
    expect(onlyOversized.utilizationPct).toBe(0)
  })
})

describe('nestPolygonsNfp — rotations beyond the cardinal set', () => {
  it('rotationStepDeg 45 places a strip that ONLY fits diagonally', () => {
    // 130×10 strip on a 100×100 sheet: impossible at 0/90/180/270
    // (130 > 100) but fits at 45° (bbox ≈ 98.99 mm).
    const sheet: SheetSpec = { widthMm: 100, heightMm: 100 }
    const strip = rectangle('diag', 130, 10)

    const cardinal = nestPolygonsNfp([strip], sheet, { partMarginMm: 0 })
    expect(cardinal.unplaced).toEqual(['diag'])
    expect(cardinal.sheetsUsed).toBe(0)

    const fine = nestPolygonsNfp([strip], sheet, { partMarginMm: 0, rotationStepDeg: 45 })
    expect(fine.unplaced).toEqual([])
    expect(fine.placements).toHaveLength(1)
    const pl = fine.placements[0]!
    expect(pl.rotationDeg % 90).not.toBe(0)
    expect(pl.rotationDeg % 45).toBe(0)
    assertAllInsideSheet([strip], fine, sheet)
  })
})

describe('nestPolygonsNfp — (d) determinism + contract shape', () => {
  it('same input ⇒ identical result (no RNG, no clock)', () => {
    const sheet: SheetSpec = { widthMm: 200, heightMm: 150, marginMm: 5 }
    const parts: Polygon[] = [
      lBracket('L-1'),
      lBracket('L-2'),
      lBracket('L-3'),
      rectangle('strip-1', 160, 20),
      rectangle('strip-2', 160, 20),
      circle24('disc', 30),
      cShape('cee')
    ]
    const opts = { partMarginMm: 4, rotationStepDeg: 45, maxSheets: 4 }

    const first = nestPolygonsNfp(parts, sheet, opts)
    const second = nestPolygonsNfp(parts, sheet, opts)

    expect(second).toEqual(first)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))

    // The run is also internally consistent: every part accounted for once,
    // overlap-free on every sheet it used.
    expect(first.placements.length + first.unplaced.length).toBe(parts.length)
    expect(maxPairwiseInflatedOverlap(parts, first, opts.partMarginMm)).toBe(0)
    assertAllInsideSheet(parts, first, sheet)
  })

  it('result shape is an additive superset of the v1 NestResult wire contract', () => {
    const result = nestPolygonsNfp([rectangle('p', 40, 40)], { widthMm: 100, heightMm: 100 })

    // v1 fields keep their exact names (the wire shape may only GAIN fields).
    expect(Array.isArray(result.placements)).toBe(true)
    expect(Array.isArray(result.unplaced)).toBe(true)
    expect(typeof result.utilizationPct).toBe('number')
    expect(typeof result.sheetUsedAreaMm2).toBe('number')
    expect(typeof result.totalPartAreaMm2).toBe('number')

    // Additive extensions.
    expect(result.sheetsUsed).toBe(1)
    expect(result.nestVersion).toBe('nfp-v2')
    const pl = result.placements[0]!
    expect(typeof pl.partId).toBe('string')
    expect(typeof pl.xMm).toBe('number')
    expect(typeof pl.yMm).toBe('number')
    expect(typeof pl.rotationDeg).toBe('number')
    expect(typeof pl.sheetIndex).toBe('number')
  })

  it('validates inputs: bad sheet, non-finite rotation, bad step, bad maxSheets, non-finite coords', () => {
    const p = rectangle('p', 10, 10)
    expect(() => nestPolygonsNfp([], { widthMm: 0, heightMm: 100 })).toThrow()
    expect(() => nestPolygonsNfp([], { widthMm: 100, heightMm: -1 })).toThrow()
    expect(() =>
      nestPolygonsNfp([p], { widthMm: 100, heightMm: 100 }, { allowedRotations: [Number.NaN] })
    ).toThrow(/Invalid rotation/)
    expect(() =>
      nestPolygonsNfp([p], { widthMm: 100, heightMm: 100 }, { rotationStepDeg: 0.5 })
    ).toThrow(/rotationStepDeg/)
    expect(() =>
      nestPolygonsNfp([p], { widthMm: 100, heightMm: 100 }, { maxSheets: 0 })
    ).toThrow(/maxSheets/)
    expect(() =>
      nestPolygonsNfp(
        [{ id: 'bad', points: [[0, 0], [Number.POSITIVE_INFINITY, 0], [10, 10]] }],
        { widthMm: 100, heightMm: 100 }
      )
    ).toThrow(/non-finite/)
  })

  it('returns an all-zero result for an empty parts list', () => {
    const result = nestPolygonsNfp([], { widthMm: 100, heightMm: 100 })
    expect(result.placements).toEqual([])
    expect(result.unplaced).toEqual([])
    expect(result.utilizationPct).toBe(0)
    expect(result.totalPartAreaMm2).toBe(0)
    expect(result.sheetUsedAreaMm2).toBe(0)
    expect(result.sheetsUsed).toBe(0)
  })

  it('reports degenerate (zero-area) parts as unplaced instead of fake-placing them', () => {
    const degenerate: Polygon = { id: 'line', points: [[0, 0], [50, 0]] }
    const ok = rectangle('ok', 20, 20)
    const result = nestPolygonsNfp([degenerate, ok], { widthMm: 100, heightMm: 100 })
    expect(result.unplaced).toEqual(['line'])
    expect(result.placements.map((p) => p.partId)).toEqual(['ok'])
  })
})
