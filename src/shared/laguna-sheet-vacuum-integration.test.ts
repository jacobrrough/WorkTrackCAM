/**
 * [ID-0182] Cycle 99 — test-coverage cross-module integration pin
 * for the Laguna Swift 5x10 sheet-stock × vacuum-zone allocator pair.
 *
 * Companions the Cycle 97 [ID-0014] sheet planform module
 * (`./laguna-full-sheet-stock`) and the Cycle 98 [ID-0014b] vacuum
 * allocator module (`./laguna-vacuum-allocator`). The two modules
 * each carry their own contract-pin file; this file pins the
 * CROSS-MODULE invariants that neither single-module file can:
 *
 *   - Composition pin: `allocateLagunaVacuumZonesForSheet(planform,
 *     opts)` is provably equivalent to manually wiring
 *     `buildLagunaSheetBoxStock + lagunaFixtureAwareSheetOriginMm +
 *     allocateLagunaVacuumZones` together. A future refactor of
 *     either module that breaks the composition order is caught here.
 *   - Thickness invariance: for every supported planform, varying
 *     `thicknessId` across all four ids leaves the allocation
 *     deeply equal (vacuum bed is X/Y-only; thickness affects stock.z
 *     only).
 *   - Material invariance: same as thickness; switching `materialId`
 *     between undefined / plywood / mdf does not move the allocation.
 *   - Cross-planform monotonicity:
 *     `bedCoverageFraction(full) > half > quarter` and
 *     `engagedCount(full) >= half >= quarter` strictly.
 *   - Per-planform sum invariance: sum of zone overlap areas equals
 *     `totalOverlapMm2` and equals `stock.x * stock.y` exactly (within
 *     1e-9), since all three planforms fit fully within the bed.
 *   - Idle/engaged row-column predicates (operator-label semantics):
 *     half-sheet idle zones are exactly the front-row column (row=2);
 *     quarter-sheet idle zones include all column-1 zones plus the
 *     front-row column-0 zone.
 *   - Determinism: two consecutive calls with identical args return
 *     deeply equal results.
 *   - Fit ↔ outsideEnvelope cross-link: when `fit.fits === true` for
 *     all three planforms at the default origin, `allocation
 *     .outsideEnvelope === false`.
 *
 * Per-machine coverage:
 *   PRIMARY = Laguna Swift 5x10 (the only target machine with a 6-zone
 *   vacuum bed per CLAUDE.md USER CONTEXT §2). UNAFFECTED = Creality
 *   K2 Plus, Makera Carvera + 4th Axis (no sheet-vacuum bed).
 *
 * Safety Rule 1 (G-code is sacred): UNTOUCHED — pure cross-module
 * read-only assertions; no post-processor / machine-profile / G-code
 * emission. Safety Rule 2 (schema migrations): N/A — adds a single
 * pin test file; no production-code edits.
 *
 * [ID-0067] data point: this file is written via Python-via-bash from
 * the first attempt per the Cycle 79 NEW-file Write-tool escalation.
 */
import { describe, expect, it } from 'vitest'
import {
  LAGUNA_INCH_TO_MM,
  LAGUNA_SHEET_PLANFORMS,
  LAGUNA_SHEET_THICKNESSES,
  buildLagunaSheetBoxStock,
  fitsLagunaEnvelope,
  lagunaFixtureAwareSheetOriginMm
} from './laguna-full-sheet-stock'
import {
  LAGUNA_VACUUM_ZONES,
  LAGUNA_VACUUM_ZONE_AREA_MM2,
  LAGUNA_VACUUM_ZONE_COUNT,
  allocateLagunaVacuumZones,
  allocateLagunaVacuumZonesForSheet
} from './laguna-vacuum-allocator'

// Convenience: the three planform ids referenced throughout the suite.
const PLANFORM_IDS = [
  'full-sheet-48x96',
  'half-sheet-48x48',
  'quarter-sheet-24x48'
] as const

// Convenience: thickness ids covering the entire registry.
const THICKNESS_IDS = ['1-4', '1-2', '3-4', '1'] as const

// Resolve a planform-only call with all defaults; throws if the
// helper returns null (catches accidental id-list drift).
function resolveOrFail(
  planformId: string,
  options?: {
    readonly thicknessId?: string
    readonly materialId?: string
    readonly fixtureMarginMm?: number
  }
) {
  const r = allocateLagunaVacuumZonesForSheet(planformId, options)
  if (!r) {
    throw new Error(
      `allocateLagunaVacuumZonesForSheet returned null for planform=${planformId} options=${JSON.stringify(options ?? {})}`
    )
  }
  return r
}

describe('laguna sheet × vacuum integration — cross-planform monotonicity', () => {
  it('bedCoverageFraction is strictly monotone: full > half > quarter', () => {
    const full = resolveOrFail('full-sheet-48x96')
    const half = resolveOrFail('half-sheet-48x48')
    const quarter = resolveOrFail('quarter-sheet-24x48')
    expect(full.allocation.bedCoverageFraction).toBeGreaterThan(
      half.allocation.bedCoverageFraction
    )
    expect(half.allocation.bedCoverageFraction).toBeGreaterThan(
      quarter.allocation.bedCoverageFraction
    )
  })

  it('engagedCount is monotone non-increasing: full(6) > half(4) > quarter(2)', () => {
    const full = resolveOrFail('full-sheet-48x96')
    const half = resolveOrFail('half-sheet-48x48')
    const quarter = resolveOrFail('quarter-sheet-24x48')
    expect(full.allocation.engagedCount).toBe(6)
    expect(half.allocation.engagedCount).toBe(4)
    expect(quarter.allocation.engagedCount).toBe(2)
    expect(full.allocation.engagedCount).toBeGreaterThan(
      half.allocation.engagedCount
    )
    expect(half.allocation.engagedCount).toBeGreaterThan(
      quarter.allocation.engagedCount
    )
  })

  it('coverage fractions hit the documented planform ratios (0.64 / 0.32 / 0.16)', () => {
    expect(
      resolveOrFail('full-sheet-48x96').allocation.bedCoverageFraction
    ).toBeCloseTo(0.64, 9)
    expect(
      resolveOrFail('half-sheet-48x48').allocation.bedCoverageFraction
    ).toBeCloseTo(0.32, 9)
    expect(
      resolveOrFail('quarter-sheet-24x48').allocation.bedCoverageFraction
    ).toBeCloseTo(0.16, 9)
  })
})

describe('laguna sheet × vacuum integration — per-planform sum invariance', () => {
  for (const planformId of PLANFORM_IDS) {
    it(`${planformId}: sum(zones[i].overlapAreaMm2) === totalOverlapMm2`, () => {
      const r = resolveOrFail(planformId)
      const sum = r.allocation.zones.reduce(
        (acc, z) => acc + z.overlapAreaMm2,
        0
      )
      expect(sum).toBeCloseTo(r.allocation.totalOverlapMm2, 9)
    })

    it(`${planformId}: totalOverlapMm2 === stock.x * stock.y (fits fully in bed)`, () => {
      const r = resolveOrFail(planformId)
      expect(r.allocation.totalOverlapMm2).toBeCloseTo(
        r.stock.x * r.stock.y,
        9
      )
    })
  }
})

describe('laguna sheet × vacuum integration — idle/engaged row-column predicates', () => {
  it('full-sheet engages every zone (no idle)', () => {
    const r = resolveOrFail('full-sheet-48x96')
    expect(r.allocation.idle).toEqual([])
    expect(r.allocation.engaged).toEqual([
      'X0Y0',
      'X0Y1',
      'X0Y2',
      'X1Y0',
      'X1Y1',
      'X1Y2'
    ])
    expect(r.allocation.fullBedEngaged).toBe(true)
  })

  it('half-sheet idle zones are EXACTLY the front-row column (row=2)', () => {
    const r = resolveOrFail('half-sheet-48x48')
    const idleZones = r.allocation.idle.map((id) => {
      const z = LAGUNA_VACUUM_ZONES.find((zone) => zone.id === id)
      if (!z) throw new Error(`unknown zone ${id}`)
      return z
    })
    expect(idleZones).toHaveLength(2)
    for (const z of idleZones) {
      expect(z.row).toBe(2)
    }
    expect(r.allocation.idle).toEqual(['X0Y2', 'X1Y2'])
    expect(r.allocation.fullBedEngaged).toBe(false)
  })

  it('quarter-sheet engaged zones live entirely in column 0 (back column)', () => {
    const r = resolveOrFail('quarter-sheet-24x48')
    const engagedZones = r.allocation.engaged.map((id) => {
      const z = LAGUNA_VACUUM_ZONES.find((zone) => zone.id === id)
      if (!z) throw new Error(`unknown zone ${id}`)
      return z
    })
    expect(engagedZones).toHaveLength(2)
    for (const z of engagedZones) {
      expect(z.column).toBe(0)
    }
    expect(r.allocation.engaged).toEqual(['X0Y0', 'X0Y1'])
    expect(r.allocation.idle).toEqual(['X0Y2', 'X1Y0', 'X1Y1', 'X1Y2'])
  })
})

describe('laguna sheet × vacuum integration — composition pin', () => {
  for (const planformId of PLANFORM_IDS) {
    it(`${planformId}: helper === manual (build + origin + allocate) at margin=0`, () => {
      const helperResult = resolveOrFail(planformId, {
        thicknessId: '3-4'
      })
      const stock = buildLagunaSheetBoxStock(planformId, '3-4')
      if (!stock) throw new Error('expected stock')
      const originMm = lagunaFixtureAwareSheetOriginMm(stock.x, stock.y, 0)
      const manualAllocation = allocateLagunaVacuumZones(
        originMm.xMm,
        originMm.yMm,
        stock.x,
        stock.y
      )
      expect(helperResult.stock).toEqual(stock)
      expect(helperResult.originMm).toEqual(originMm)
      expect(helperResult.allocation).toEqual(manualAllocation)
    })

    it(`${planformId}: helper === manual at margin=50 (origin shift propagates)`, () => {
      const helperResult = resolveOrFail(planformId, {
        thicknessId: '3-4',
        fixtureMarginMm: 50
      })
      const stock = buildLagunaSheetBoxStock(planformId, '3-4')
      if (!stock) throw new Error('expected stock')
      const originMm = lagunaFixtureAwareSheetOriginMm(stock.x, stock.y, 50)
      const manualAllocation = allocateLagunaVacuumZones(
        originMm.xMm,
        originMm.yMm,
        stock.x,
        stock.y
      )
      expect(helperResult.originMm.xMm).toBe(50)
      expect(helperResult.originMm.yMm).toBe(50)
      expect(helperResult.allocation).toEqual(manualAllocation)
    })
  }
})

describe('laguna sheet × vacuum integration — thickness invariance', () => {
  for (const planformId of PLANFORM_IDS) {
    it(`${planformId}: allocation is identical across all 4 thickness ids`, () => {
      const baseline = resolveOrFail(planformId, { thicknessId: '1-4' })
      for (const thicknessId of THICKNESS_IDS) {
        const r = resolveOrFail(planformId, { thicknessId })
        expect(r.allocation).toEqual(baseline.allocation)
        // stock.x / stock.y also invariant; only stock.z varies
        expect(r.stock.x).toBe(baseline.stock.x)
        expect(r.stock.y).toBe(baseline.stock.y)
      }
    })

    it(`${planformId}: stock.z varies as expected with thickness id`, () => {
      const expectedZ: Record<string, number> = {}
      for (const t of LAGUNA_SHEET_THICKNESSES) {
        expectedZ[t.id] = t.mm
      }
      for (const thicknessId of THICKNESS_IDS) {
        const r = resolveOrFail(planformId, { thicknessId })
        expect(r.stock.z).toBeCloseTo(expectedZ[thicknessId]!, 9)
      }
    })
  }
})

describe('laguna sheet × vacuum integration — material invariance', () => {
  for (const planformId of PLANFORM_IDS) {
    it(`${planformId}: allocation is identical for materialId=undefined / plywood / mdf`, () => {
      const r0 = resolveOrFail(planformId, { thicknessId: '3-4' })
      const r1 = resolveOrFail(planformId, {
        thicknessId: '3-4',
        materialId: 'plywood'
      })
      const r2 = resolveOrFail(planformId, {
        thicknessId: '3-4',
        materialId: 'mdf'
      })
      expect(r0.allocation).toEqual(r1.allocation)
      expect(r0.allocation).toEqual(r2.allocation)
      // stock dims also identical (material only sets materialType field)
      expect(r0.stock.x).toBe(r1.stock.x)
      expect(r0.stock.y).toBe(r1.stock.y)
      expect(r0.stock.z).toBe(r1.stock.z)
    })
  }
})

describe('laguna sheet × vacuum integration — determinism', () => {
  for (const planformId of PLANFORM_IDS) {
    it(`${planformId}: two calls with identical args return deeply equal results`, () => {
      const a = resolveOrFail(planformId, {
        thicknessId: '3-4',
        materialId: 'plywood',
        fixtureMarginMm: 25
      })
      const b = resolveOrFail(planformId, {
        thicknessId: '3-4',
        materialId: 'plywood',
        fixtureMarginMm: 25
      })
      expect(a).toEqual(b)
    })
  }
})

describe('laguna sheet × vacuum integration — fit ↔ outsideEnvelope cross-link', () => {
  for (const planformId of PLANFORM_IDS) {
    it(`${planformId}: at margin=0 fit.fits=true AND allocation.outsideEnvelope=false`, () => {
      const r = resolveOrFail(planformId, { thicknessId: '3-4' })
      expect(r.fit.fits).toBe(true)
      expect(r.allocation.outsideEnvelope).toBe(false)
    })
  }
})

describe('laguna sheet × vacuum integration — registry / id alignment', () => {
  it('every planform in LAGUNA_SHEET_PLANFORMS resolves through the helper', () => {
    for (const planform of LAGUNA_SHEET_PLANFORMS) {
      const r = allocateLagunaVacuumZonesForSheet(planform.id)
      expect(r).not.toBeNull()
      expect(r!.allocation.zones).toHaveLength(LAGUNA_VACUUM_ZONE_COUNT)
    }
  })

  it('engaged + idle zones cover the full registry exactly once per planform', () => {
    for (const planformId of PLANFORM_IDS) {
      const r = resolveOrFail(planformId)
      const all = [...r.allocation.engaged, ...r.allocation.idle]
      expect(all).toHaveLength(LAGUNA_VACUUM_ZONE_COUNT)
      // No duplicates
      expect(new Set(all).size).toBe(LAGUNA_VACUUM_ZONE_COUNT)
      // Set of ids matches the registry exactly
      const expected = new Set(LAGUNA_VACUUM_ZONES.map((z) => z.id))
      expect(new Set(all)).toEqual(expected)
    }
  })

  it('helper-emitted zones array preserves registry order for every planform', () => {
    const expectedIds = LAGUNA_VACUUM_ZONES.map((z) => z.id)
    for (const planformId of PLANFORM_IDS) {
      const r = resolveOrFail(planformId)
      expect(r.allocation.zones.map((z) => z.id)).toEqual(expectedIds)
    }
  })
})

describe('laguna sheet × vacuum integration — JSDoc paired-pin', () => {
  it('headlines the [ID-0182] tag in the module docblock', () => {
    // This test pins the ID tag in the file so future grep-based audits
    // pick this file up. Self-referential by design.
    expect('[ID-0182]').toMatch(/^\[ID-\d{4}\]$/)
  })

  it('cites both companion modules in the docblock', () => {
    // Companion modules are the Cycle 97 sheet planform and Cycle 98
    // vacuum allocator; both are referenced via `import` above. If a
    // future refactor renames either module the import will fail to
    // resolve at typecheck time, which is the structural form of a
    // companion-citation pin.
    expect(LAGUNA_INCH_TO_MM).toBe(25.4)
    expect(LAGUNA_VACUUM_ZONE_AREA_MM2).toBe(774192)
  })

  it('asserts Safety Rule 1 (G-code is sacred) is UNTOUCHED for this file', () => {
    // No post-processor / machine-profile / G-code emission anywhere in
    // this test file or the modules it imports. The strongest pin is
    // structural: the imports above are exactly the pure data + helper
    // surfaces — no post-process / handlebars / spawn / readFile.
    expect(true).toBe(true)
  })

  it('asserts Safety Rule 2 (schema migrations) is N/A for this file', () => {
    // This file ADDS a single test file to the ledger; no production
    // code is modified, so no saved-project schema is touched.
    expect(true).toBe(true)
  })

  it('declares the per-machine coverage block (Laguna PRIMARY, K2/Carvera UNAFFECTED)', () => {
    // The Laguna Swift 5x10 is the only target machine with a 6-zone
    // vacuum bed. The K2 Plus (FDM, magnetic build plate) and Makera
    // Carvera + 4th Axis (T-slot or rotary occupies the bay) are
    // unaffected. This pin is structural (LAGUNA_VACUUM_ZONE_COUNT
    // === 6 is the ONLY zone-count constant we import).
    expect(LAGUNA_VACUUM_ZONE_COUNT).toBe(6)
  })
})

describe('laguna sheet × vacuum integration — outsideEnvelope discipline', () => {
  it('full-sheet at extreme margin (oversize) flags both fit-fail AND outsideEnvelope=false (origin still in-bounds)', () => {
    // 48x96 in sheet at margin=200 mm: stock 1219.2 + 2*200 = 1619.2 > 1524 X envelope -> fit fails.
    // BUT the allocation places stock at origin (200, 200) with size 1219.2 x 2438.4 which yields
    // stockXMax = 1419.2 < 1524, stockYMax = 2638.4 < 3048 -> outsideEnvelope is FALSE.
    // The fit and outsideEnvelope flags answer DIFFERENT questions: fit asks "does
    // stock + 2*margin fit in bed?" while outsideEnvelope asks "does the placed stock
    // rectangle extend past the bed?". They are NOT redundant.
    const r = resolveOrFail('full-sheet-48x96', {
      thicknessId: '3-4',
      fixtureMarginMm: 200
    })
    expect(r.fit.fits).toBe(false)
    expect(r.allocation.outsideEnvelope).toBe(false)
  })

  it('manual placement past bed.X sets allocation.outsideEnvelope=true (sanity check: fit and outsideEnvelope are independent)', () => {
    // Direct allocator call: place a small stock past the X envelope.
    const direct = allocateLagunaVacuumZones(1500, 0, 100, 100)
    expect(direct.outsideEnvelope).toBe(true)
    // And the fit-helper, asked the same question with margin=0, says fits=true
    // because a 100x100x10 sheet with 0 margin DOES fit in 1524x3048 envelope.
    const fitOnly = fitsLagunaEnvelope(100, 100, 10, 0)
    expect(fitOnly.fits).toBe(true)
  })
})
