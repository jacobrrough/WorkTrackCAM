/**
 * Laguna Swift 5×10 — 6-zone vacuum allocator contract pin
 * ([ID-0014b]).
 *
 * Pins the `src/shared/laguna-vacuum-allocator.ts` module\'s public
 * surface against silent drift. The 6-zone layout is the published
 * Laguna IQ / Swift sheet-bed configuration; any future change to the
 * grid (different column / row count, asymmetric zone sizes, etc.)
 * MUST update both this test file and the bundled
 * `resources/machines/laguna-swift-5x10.json` profile.
 *
 * Per-machine coverage:
 *   PRIMARY = Laguna Swift 5×10 (the only target machine with a
 *   6-zone vacuum bed). UNAFFECTED = Creality K2 Plus, Makera Carvera
 *   + 4th Axis (neither has a sheet-vacuum bed).
 *
 * Safety Rule 1 (G-code is sacred): UNTOUCHED — pure data + helpers,
 * no post-processor / machine-profile / `renderPost` / G-code
 * emission. Safety Rule 2 (schema migrations): the helpers return new
 * plain objects and never mutate the existing schema; pre-existing
 * saved projects parse unchanged.
 *
 * Test design: mirrors the Cycle 97 [ID-0014] paired-pin shape — one
 * describe block per public symbol family, one it() per invariant,
 * with both happy-path and defensive coverage.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LAGUNA_INCH_TO_MM,
  LAGUNA_SWIFT_WORK_AREA_MM
} from './laguna-full-sheet-stock'
import {
  LAGUNA_VACUUM_ZONES,
  LAGUNA_VACUUM_ZONE_AREA_MM2,
  LAGUNA_VACUUM_ZONE_COLUMNS,
  LAGUNA_VACUUM_ZONE_COUNT,
  LAGUNA_VACUUM_ZONE_LENGTH_MM,
  LAGUNA_VACUUM_ZONE_ROWS,
  LAGUNA_VACUUM_ZONE_WIDTH_MM,
  allocateLagunaVacuumZones,
  allocateLagunaVacuumZonesForSheet
} from './laguna-vacuum-allocator'

describe('laguna-vacuum-allocator — constants', () => {
  it('declares 6 zones in a 2 × 3 grid', () => {
    expect(LAGUNA_VACUUM_ZONE_COUNT).toBe(6)
    expect(LAGUNA_VACUUM_ZONE_COLUMNS).toBe(2)
    expect(LAGUNA_VACUUM_ZONE_ROWS).toBe(3)
    expect(
      LAGUNA_VACUUM_ZONE_COLUMNS * LAGUNA_VACUUM_ZONE_ROWS
    ).toBe(LAGUNA_VACUUM_ZONE_COUNT)
  })

  it('derives zone width from the bed envelope (1524 / 2 = 762 mm)', () => {
    expect(LAGUNA_VACUUM_ZONE_WIDTH_MM).toBe(762)
    expect(LAGUNA_VACUUM_ZONE_WIDTH_MM).toBe(
      LAGUNA_SWIFT_WORK_AREA_MM.x / LAGUNA_VACUUM_ZONE_COLUMNS
    )
  })

  it('derives zone length from the bed envelope (3048 / 3 = 1016 mm)', () => {
    expect(LAGUNA_VACUUM_ZONE_LENGTH_MM).toBe(1016)
    expect(LAGUNA_VACUUM_ZONE_LENGTH_MM).toBe(
      LAGUNA_SWIFT_WORK_AREA_MM.y / LAGUNA_VACUUM_ZONE_ROWS
    )
  })

  it('derives zone area from width × length (762 × 1016 = 774192 mm²)', () => {
    expect(LAGUNA_VACUUM_ZONE_AREA_MM2).toBe(774192)
    expect(LAGUNA_VACUUM_ZONE_AREA_MM2).toBe(
      LAGUNA_VACUUM_ZONE_WIDTH_MM * LAGUNA_VACUUM_ZONE_LENGTH_MM
    )
  })

  it('zone areas sum to the full bed footprint', () => {
    const sum = LAGUNA_VACUUM_ZONE_AREA_MM2 * LAGUNA_VACUUM_ZONE_COUNT
    const bed = LAGUNA_SWIFT_WORK_AREA_MM.x * LAGUNA_SWIFT_WORK_AREA_MM.y
    expect(sum).toBe(bed)
  })
})

describe('laguna-vacuum-allocator — zone registry', () => {
  it('contains exactly 6 zones in column-major order', () => {
    expect(LAGUNA_VACUUM_ZONES).toHaveLength(6)
    expect(LAGUNA_VACUUM_ZONES.map((z) => z.id)).toEqual([
      'X0Y0',
      'X0Y1',
      'X0Y2',
      'X1Y0',
      'X1Y1',
      'X1Y2'
    ])
  })

  it('each zone is exactly 762 × 1016 mm', () => {
    for (const zone of LAGUNA_VACUUM_ZONES) {
      expect(zone.xMaxMm - zone.xMinMm).toBe(LAGUNA_VACUUM_ZONE_WIDTH_MM)
      expect(zone.yMaxMm - zone.yMinMm).toBe(LAGUNA_VACUUM_ZONE_LENGTH_MM)
    }
  })

  it('column 0 zones span X 0..762, column 1 zones span X 762..1524', () => {
    const col0 = LAGUNA_VACUUM_ZONES.filter((z) => z.column === 0)
    const col1 = LAGUNA_VACUUM_ZONES.filter((z) => z.column === 1)
    expect(col0).toHaveLength(3)
    expect(col1).toHaveLength(3)
    for (const z of col0) {
      expect(z.xMinMm).toBe(0)
      expect(z.xMaxMm).toBe(762)
    }
    for (const z of col1) {
      expect(z.xMinMm).toBe(762)
      expect(z.xMaxMm).toBe(1524)
    }
  })

  it('row 0/1/2 zones span Y 0..1016, 1016..2032, 2032..3048', () => {
    const r0 = LAGUNA_VACUUM_ZONES.filter((z) => z.row === 0)
    const r1 = LAGUNA_VACUUM_ZONES.filter((z) => z.row === 1)
    const r2 = LAGUNA_VACUUM_ZONES.filter((z) => z.row === 2)
    expect(r0).toHaveLength(2)
    expect(r1).toHaveLength(2)
    expect(r2).toHaveLength(2)
    for (const z of r0) {
      expect(z.yMinMm).toBe(0)
      expect(z.yMaxMm).toBe(1016)
    }
    for (const z of r1) {
      expect(z.yMinMm).toBe(1016)
      expect(z.yMaxMm).toBe(2032)
    }
    for (const z of r2) {
      expect(z.yMinMm).toBe(2032)
      expect(z.yMaxMm).toBe(3048)
    }
  })

  it('every zone has a back/front × left/mid/right operator label', () => {
    const labels = LAGUNA_VACUUM_ZONES.map((z) => z.label)
    expect(labels).toEqual([
      'Zone X0/Y0 (back-left)',
      'Zone X0/Y1 (back-mid)',
      'Zone X0/Y2 (back-right)',
      'Zone X1/Y0 (front-left)',
      'Zone X1/Y1 (front-mid)',
      'Zone X1/Y2 (front-right)'
    ])
  })
})

describe('laguna-vacuum-allocator — allocateLagunaVacuumZones (full coverage)', () => {
  it('full-bed stock (1524 × 3048) at (0, 0) engages all 6 zones', () => {
    const result = allocateLagunaVacuumZones(0, 0, 1524, 3048)
    expect(result.engagedCount).toBe(6)
    expect(result.idle).toEqual([])
    expect(result.fullBedEngaged).toBe(true)
    expect(result.outsideEnvelope).toBe(false)
    expect(result.totalOverlapMm2).toBe(1524 * 3048)
    expect(result.bedCoverageFraction).toBeCloseTo(1, 10)
  })

  it('48 × 96 in full sheet at (0, 0) engages all 6 zones (~64 % bed coverage)', () => {
    const xMm = 48 * LAGUNA_INCH_TO_MM
    const yMm = 96 * LAGUNA_INCH_TO_MM
    const result = allocateLagunaVacuumZones(0, 0, xMm, yMm)
    expect(result.engagedCount).toBe(6)
    expect(result.fullBedEngaged).toBe(true)
    expect(result.outsideEnvelope).toBe(false)
    expect(result.totalOverlapMm2).toBeCloseTo(xMm * yMm, 6)
    expect(result.bedCoverageFraction).toBeCloseTo(
      (xMm * yMm) / (LAGUNA_SWIFT_WORK_AREA_MM.x * LAGUNA_SWIFT_WORK_AREA_MM.y),
      6
    )
  })
})

describe('laguna-vacuum-allocator — allocateLagunaVacuumZones (partial coverage)', () => {
  it('48 × 48 in half sheet at (0, 0) engages 4 zones (drops X0Y2 + X1Y2)', () => {
    const xMm = 48 * LAGUNA_INCH_TO_MM
    const yMm = 48 * LAGUNA_INCH_TO_MM
    const result = allocateLagunaVacuumZones(0, 0, xMm, yMm)
    expect(result.engagedCount).toBe(4)
    expect(result.engaged).toEqual(['X0Y0', 'X0Y1', 'X1Y0', 'X1Y1'])
    expect(result.idle).toEqual(['X0Y2', 'X1Y2'])
    expect(result.fullBedEngaged).toBe(false)
    expect(result.outsideEnvelope).toBe(false)
    expect(result.totalOverlapMm2).toBeCloseTo(xMm * yMm, 6)
  })

  it('24 × 48 in quarter sheet at (0, 0) engages 2 zones (X0Y0 + X0Y1 only)', () => {
    const xMm = 24 * LAGUNA_INCH_TO_MM
    const yMm = 48 * LAGUNA_INCH_TO_MM
    const result = allocateLagunaVacuumZones(0, 0, xMm, yMm)
    expect(result.engagedCount).toBe(2)
    expect(result.engaged).toEqual(['X0Y0', 'X0Y1'])
    expect(result.idle).toEqual(['X0Y2', 'X1Y0', 'X1Y1', 'X1Y2'])
    expect(result.fullBedEngaged).toBe(false)
    expect(result.outsideEnvelope).toBe(false)
  })

  it('100 × 100 mm stock at (662, 916) engages only X0Y0 (back-left corner)', () => {
    const result = allocateLagunaVacuumZones(662, 916, 100, 100)
    expect(result.engaged).toEqual(['X0Y0'])
    expect(result.idle).toHaveLength(5)
    expect(result.fullBedEngaged).toBe(false)
    expect(result.outsideEnvelope).toBe(false)
    expect(result.totalOverlapMm2).toBe(10000)
    expect(result.bedCoverageFraction).toBeCloseTo(
      10000 / (LAGUNA_VACUUM_ZONE_AREA_MM2 * 6),
      10
    )
  })

  it('preserves registry order in both `engaged` and `idle` arrays', () => {
    const result = allocateLagunaVacuumZones(0, 0, 1500, 2500)
    const registryOrder = LAGUNA_VACUUM_ZONES.map((z) => z.id)
    const sortByRegistry = (ids: readonly string[]): string[] =>
      [...ids].sort(
        (a, b) => registryOrder.indexOf(a) - registryOrder.indexOf(b)
      )
    expect(result.engaged).toEqual(sortByRegistry(result.engaged))
    expect(result.idle).toEqual(sortByRegistry(result.idle))
  })
})

describe('laguna-vacuum-allocator — edge alignment (zero-area touch does not engage)', () => {
  it('100 × 100 stock at exactly (762, 1016) engages X1Y1 only (not X0Y0)', () => {
    // Stock corner sits exactly on the X-column / Y-row split. The
    // adjacent zones (X0Y0, X0Y1, X1Y0) touch the stock at a point /
    // edge with zero area; the engagement rule demands strictly
    // positive overlap, so they remain IDLE.
    const result = allocateLagunaVacuumZones(762, 1016, 100, 100)
    expect(result.engaged).toEqual(['X1Y1'])
    expect(result.idle).toContain('X0Y0')
    expect(result.idle).toContain('X0Y1')
    expect(result.idle).toContain('X1Y0')
    expect(result.engagedCount).toBe(1)
  })

  it('zero-size stock engages no zones', () => {
    const result = allocateLagunaVacuumZones(500, 500, 0, 0)
    expect(result.engagedCount).toBe(0)
    expect(result.engaged).toEqual([])
    expect(result.idle).toHaveLength(6)
    expect(result.totalOverlapMm2).toBe(0)
    expect(result.bedCoverageFraction).toBe(0)
    expect(result.fullBedEngaged).toBe(false)
  })
})

describe('laguna-vacuum-allocator — defensive (NaN / negative inputs)', () => {
  it('NaN origin collapses to 0 (engages back-left zone for tiny stock)', () => {
    const result = allocateLagunaVacuumZones(Number.NaN, Number.NaN, 50, 50)
    expect(result.engaged).toEqual(['X0Y0'])
  })

  it('Infinity origin collapses to 0 (engages back-left for tiny stock)', () => {
    const result = allocateLagunaVacuumZones(
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      50,
      50
    )
    expect(result.engaged).toEqual(['X0Y0'])
  })

  it('negative size collapses to 0 (no zones engaged)', () => {
    const result = allocateLagunaVacuumZones(0, 0, -100, -100)
    expect(result.engagedCount).toBe(0)
    expect(result.totalOverlapMm2).toBe(0)
  })

  it('NaN size collapses to 0 (no zones engaged)', () => {
    const result = allocateLagunaVacuumZones(0, 0, Number.NaN, Number.NaN)
    expect(result.engagedCount).toBe(0)
    expect(result.totalOverlapMm2).toBe(0)
  })
})

describe('laguna-vacuum-allocator — outsideEnvelope flag', () => {
  it('stock that fits exactly within envelope sets outsideEnvelope=false', () => {
    const result = allocateLagunaVacuumZones(0, 0, 1524, 3048)
    expect(result.outsideEnvelope).toBe(false)
  })

  it('stock extending past X envelope sets outsideEnvelope=true', () => {
    const result = allocateLagunaVacuumZones(0, 0, 2000, 100)
    expect(result.outsideEnvelope).toBe(true)
    // Both columns engaged because the stock straddles X = 762 and
    // overlap is clipped to the bed envelope.
    expect(result.engaged).toContain('X0Y0')
    expect(result.engaged).toContain('X1Y0')
    expect(result.totalOverlapMm2).toBe(1524 * 100)
  })

  it('stock extending past Y envelope sets outsideEnvelope=true', () => {
    const result = allocateLagunaVacuumZones(0, 0, 100, 4000)
    expect(result.outsideEnvelope).toBe(true)
    expect(result.engaged).toEqual(['X0Y0', 'X0Y1', 'X0Y2'])
    expect(result.totalOverlapMm2).toBe(100 * 3048)
  })
})

describe('laguna-vacuum-allocator — per-zone overlap descriptors', () => {
  it('every result.zones[i] mirrors LAGUNA_VACUUM_ZONES[i].id', () => {
    const result = allocateLagunaVacuumZones(0, 0, 100, 100)
    expect(result.zones).toHaveLength(6)
    for (let i = 0; i < 6; i += 1) {
      expect(result.zones[i].id).toBe(LAGUNA_VACUUM_ZONES[i].id)
    }
  })

  it('zoneCoverageFraction equals overlapAreaMm2 / zoneArea exactly', () => {
    const result = allocateLagunaVacuumZones(0, 0, 1219.2, 1219.2)
    for (const z of result.zones) {
      const expected = z.overlapAreaMm2 / LAGUNA_VACUUM_ZONE_AREA_MM2
      expect(z.zoneCoverageFraction).toBeCloseTo(expected, 12)
    }
  })

  it('engaged flag matches strictly-positive overlapAreaMm2 (no edge-touch)', () => {
    // 100×100 stock at (762, 1016) — corner exactly on the split.
    const result = allocateLagunaVacuumZones(762, 1016, 100, 100)
    for (const z of result.zones) {
      expect(z.engaged).toBe(z.overlapAreaMm2 > 0)
    }
    const engagedZones = result.zones.filter((z) => z.engaged)
    expect(engagedZones).toHaveLength(1)
    expect(engagedZones[0].id).toBe('X1Y1')
  })
})

describe('laguna-vacuum-allocator — allocateLagunaVacuumZonesForSheet', () => {
  it('returns null for unknown planform id', () => {
    expect(
      allocateLagunaVacuumZonesForSheet('not-a-real-planform')
    ).toBeNull()
  })

  it('returns null for unknown thickness id', () => {
    expect(
      allocateLagunaVacuumZonesForSheet('full-sheet-48x96', {
        thicknessId: '5-8'
      })
    ).toBeNull()
  })

  it('returns null for unknown material id', () => {
    expect(
      allocateLagunaVacuumZonesForSheet('full-sheet-48x96', {
        materialId: 'aluminum'
      })
    ).toBeNull()
  })

  it('full-sheet-48x96 default → all 6 zones, 3/4 in stock thickness', () => {
    const result = allocateLagunaVacuumZonesForSheet('full-sheet-48x96')
    expect(result).not.toBeNull()
    if (!result) throw new Error('unreachable: null guard above')
    expect(result.stock.kind).toBe('box')
    expect(result.stock.x).toBeCloseTo(48 * LAGUNA_INCH_TO_MM, 9)
    expect(result.stock.y).toBeCloseTo(96 * LAGUNA_INCH_TO_MM, 9)
    expect(result.stock.z).toBeCloseTo(0.75 * LAGUNA_INCH_TO_MM, 9)
    expect(result.fit.fits).toBe(true)
    expect(result.originMm).toEqual({ xMm: 0, yMm: 0, zMm: 0 })
    expect(result.allocation.engagedCount).toBe(6)
    expect(result.allocation.fullBedEngaged).toBe(true)
  })

  it('half-sheet-48x48 default → 4 zones (drops back-right and front-right)', () => {
    const result = allocateLagunaVacuumZonesForSheet('half-sheet-48x48')
    expect(result).not.toBeNull()
    if (!result) throw new Error('unreachable: null guard above')
    expect(result.allocation.engagedCount).toBe(4)
    expect(result.allocation.engaged).toEqual([
      'X0Y0',
      'X0Y1',
      'X1Y0',
      'X1Y1'
    ])
    expect(result.allocation.idle).toEqual(['X0Y2', 'X1Y2'])
    expect(result.allocation.fullBedEngaged).toBe(false)
  })

  it('quarter-sheet-24x48 default → 2 zones (back-left column only)', () => {
    const result = allocateLagunaVacuumZonesForSheet('quarter-sheet-24x48')
    expect(result).not.toBeNull()
    if (!result) throw new Error('unreachable: null guard above')
    expect(result.allocation.engagedCount).toBe(2)
    expect(result.allocation.engaged).toEqual(['X0Y0', 'X0Y1'])
  })

  it('respects fixtureMarginMm by shifting the stock origin (and zone allocation)', () => {
    // 25 mm margin pushes a quarter-sheet origin to (25, 25), which
    // does NOT cross the X = 762 split (24 in = 609.6 mm + 25 < 762)
    // so the engaged set is unchanged from the 0-margin case.
    const result = allocateLagunaVacuumZonesForSheet('quarter-sheet-24x48', {
      fixtureMarginMm: 25
    })
    expect(result).not.toBeNull()
    if (!result) throw new Error('unreachable: null guard above')
    expect(result.originMm).toEqual({ xMm: 25, yMm: 25, zMm: 0 })
    expect(result.allocation.engaged).toEqual(['X0Y0', 'X0Y1'])
  })

  it('honours explicit thickness + material ids when provided', () => {
    const result = allocateLagunaVacuumZonesForSheet('full-sheet-48x96', {
      thicknessId: '1-2',
      materialId: 'mdf'
    })
    expect(result).not.toBeNull()
    if (!result) throw new Error('unreachable: null guard above')
    expect(result.stock.z).toBeCloseTo(0.5 * LAGUNA_INCH_TO_MM, 9)
    expect(result.stock.materialType).toBe('mdf')
  })
})

describe('laguna-vacuum-allocator — JSDoc paired-pin', () => {
  // The source-text checks are paired-pin: any future rename of the
  // tagged constants / functions OR a quiet deletion of the safety
  // comments goes red here, even if the runtime tests still pass.
  const source = readFileSync(
    join(__dirname, 'laguna-vacuum-allocator.ts'),
    'utf8'
  )

  it('headlines the [ID-0014b] tag in the module docblock', () => {
    expect(source).toContain('[ID-0014b]')
  })

  it('declares the engagement rule (strictly positive area overlap)', () => {
    expect(source).toMatch(/STRICTLY POSITIVE area overlap/)
  })

  it('asserts Safety Rule 1 is UNTOUCHED for this module', () => {
    expect(source).toMatch(/Safety Rule 1 \(G-code is sacred\): UNTOUCHED/)
  })

  it('asserts Safety Rule 2 (schema migrations) is ADDITIVE', () => {
    expect(source).toMatch(/Safety Rule 2 \(schema migrations\): ADDITIVE/)
  })

  it('declares the per-machine coverage block', () => {
    expect(source).toMatch(/PRIMARY = Laguna Swift 5×10/)
    expect(source).toMatch(
      /UNAFFECTED = Creality K2 Plus, Makera Carvera \+ 4th Axis/
    )
  })
})
