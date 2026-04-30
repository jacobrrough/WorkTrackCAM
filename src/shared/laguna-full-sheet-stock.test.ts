/**
 * Laguna Swift 5×10 — full-sheet stock preset registry contract pin
 * ([ID-0014]).
 *
 * Pins the `src/shared/laguna-full-sheet-stock.ts` module's public
 * surface against silent drift. The registry is intentionally narrow
 * (3 planforms × 4 thicknesses × 2 materials) so any future change to
 * the headline 48 × 96 in dimensions, the inch→mm constant, or the
 * Laguna envelope mirror MUST update both this test file and the
 * shipping `resources/machines/laguna-swift-5x10.json` profile.
 *
 * Per-machine coverage:
 *   PRIMARY = Laguna Swift 5×10 (the only target machine that runs
 *   sheet-stock workflows; K2 Plus FDM and Carvera 4-axis use box and
 *   cylinder stock respectively, both unaffected by this module).
 *   UNAFFECTED = Creality K2 Plus, Makera Carvera + 4th Axis.
 *
 * Safety Rule 1 (G-code is sacred): UNTOUCHED — pure data + helpers,
 * no post-processor / machine-profile / `renderPost` / G-code
 * emission. Safety Rule 2 (schema migrations): the helpers return new
 * plain objects and never mutate the existing schema; pre-existing
 * saved projects parse unchanged.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LAGUNA_INCH_TO_MM,
  LAGUNA_SHEET_MATERIALS,
  LAGUNA_SHEET_PLANFORMS,
  LAGUNA_SHEET_THICKNESSES,
  LAGUNA_SWIFT_WORK_AREA_MM,
  buildLagunaSheetBoxStock,
  fitsLagunaEnvelope,
  getLagunaSheetMaterial,
  getLagunaSheetPlanform,
  getLagunaSheetThickness,
  lagunaFixtureAwareSheetOriginMm,
  resolveLagunaFullSheet
} from './laguna-full-sheet-stock'

const RESOURCES_ROOT = join(process.cwd(), 'resources')

interface LagunaJson {
  readonly id: string
  readonly workAreaMm: { x: number; y: number; z: number }
  readonly vacuumZoneCount?: number
}

function loadLagunaJson(): LagunaJson {
  const path = join(RESOURCES_ROOT, 'machines', 'laguna-swift-5x10.json')
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as LagunaJson
  return parsed
}

describe('laguna-full-sheet-stock — constants', () => {
  it('LAGUNA_INCH_TO_MM is exact 25.4 (international yard, 1959)', () => {
    expect(LAGUNA_INCH_TO_MM).toBe(25.4)
  })

  it('LAGUNA_SWIFT_WORK_AREA_MM mirrors the bundled machine profile', () => {
    const json = loadLagunaJson()
    expect(LAGUNA_SWIFT_WORK_AREA_MM.x).toBe(json.workAreaMm.x)
    expect(LAGUNA_SWIFT_WORK_AREA_MM.y).toBe(json.workAreaMm.y)
    expect(LAGUNA_SWIFT_WORK_AREA_MM.z).toBe(json.workAreaMm.z)
  })

  it('LAGUNA_SWIFT_WORK_AREA_MM has the CLAUDE.md USER CONTEXT §2 values', () => {
    expect(LAGUNA_SWIFT_WORK_AREA_MM).toEqual({ x: 1524, y: 3048, z: 203 })
  })
})

describe('laguna-full-sheet-stock — planform registry', () => {
  it('exposes exactly 3 planforms in stable order', () => {
    expect(LAGUNA_SHEET_PLANFORMS.map((p) => p.id)).toEqual([
      'full-sheet-48x96',
      'half-sheet-48x48',
      'quarter-sheet-24x48'
    ])
  })

  it('full-sheet planform is exactly 48 × 96 in in mm', () => {
    const full = LAGUNA_SHEET_PLANFORMS.find(
      (p) => p.id === 'full-sheet-48x96'
    )
    expect(full).toBeDefined()
    expect(full?.xMm).toBeCloseTo(48 * 25.4, 6)
    expect(full?.yMm).toBeCloseTo(96 * 25.4, 6)
  })

  it('full-sheet fits the Laguna envelope with the documented slack', () => {
    const full = LAGUNA_SHEET_PLANFORMS[0]!
    expect(LAGUNA_SWIFT_WORK_AREA_MM.x - full.xMm).toBeCloseTo(304.8, 6)
    expect(LAGUNA_SWIFT_WORK_AREA_MM.y - full.yMm).toBeCloseTo(609.6, 6)
  })

  it('every planform fits the Laguna envelope at 0 margin', () => {
    for (const p of LAGUNA_SHEET_PLANFORMS) {
      const fit = fitsLagunaEnvelope(p.xMm, p.yMm, 1, 0)
      expect(fit.fits, `${p.id} should fit at 0 margin`).toBe(true)
    }
  })

  it('every planform exposes a non-empty label', () => {
    for (const p of LAGUNA_SHEET_PLANFORMS) {
      expect(p.label.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('laguna-full-sheet-stock — thickness registry', () => {
  it('exposes exactly 4 thicknesses in ascending order', () => {
    expect(LAGUNA_SHEET_THICKNESSES.map((t) => t.id)).toEqual([
      '1-4',
      '1-2',
      '3-4',
      '1'
    ])
    const mms = LAGUNA_SHEET_THICKNESSES.map((t) => t.mm)
    for (let i = 1; i < mms.length; i++) {
      expect(mms[i]!).toBeGreaterThan(mms[i - 1]!)
    }
  })

  it('1/4 in thickness is 6.35 mm exactly', () => {
    const t = LAGUNA_SHEET_THICKNESSES.find((x) => x.id === '1-4')
    expect(t?.mm).toBeCloseTo(6.35, 6)
  })

  it('3/4 in thickness is 19.05 mm (standard plywood)', () => {
    const t = LAGUNA_SHEET_THICKNESSES.find((x) => x.id === '3-4')
    expect(t?.mm).toBeCloseTo(19.05, 6)
  })

  it('1 in thickness is exactly 25.4 mm', () => {
    const t = LAGUNA_SHEET_THICKNESSES.find((x) => x.id === '1')
    expect(t?.mm).toBe(25.4)
  })
})

describe('laguna-full-sheet-stock — material registry', () => {
  it('exposes exactly plywood + MDF (the two sheet stock materials)', () => {
    expect(LAGUNA_SHEET_MATERIALS.map((m) => m.id)).toEqual([
      'plywood',
      'mdf'
    ])
  })

  it('material entries map to StockMaterialType values', () => {
    const types = LAGUNA_SHEET_MATERIALS.map((m) => m.materialType).sort()
    expect(types).toEqual(['mdf', 'plywood'])
  })
})

describe('laguna-full-sheet-stock — lookup helpers', () => {
  it('getLagunaSheetPlanform returns the entry on known id', () => {
    expect(getLagunaSheetPlanform('full-sheet-48x96')?.id).toBe(
      'full-sheet-48x96'
    )
  })

  it('getLagunaSheetPlanform returns undefined on unknown id', () => {
    expect(getLagunaSheetPlanform('not-a-real-id')).toBeUndefined()
    expect(getLagunaSheetPlanform('')).toBeUndefined()
  })

  it('getLagunaSheetThickness returns the entry on known id', () => {
    expect(getLagunaSheetThickness('3-4')?.mm).toBeCloseTo(19.05, 6)
  })

  it('getLagunaSheetThickness returns undefined on unknown id', () => {
    expect(getLagunaSheetThickness('17')).toBeUndefined()
  })

  it('getLagunaSheetMaterial returns the entry on known id', () => {
    expect(getLagunaSheetMaterial('plywood')?.materialType).toBe('plywood')
    expect(getLagunaSheetMaterial('mdf')?.materialType).toBe('mdf')
  })

  it('getLagunaSheetMaterial returns undefined on unknown id', () => {
    expect(getLagunaSheetMaterial('aluminum')).toBeUndefined()
  })
})

describe('laguna-full-sheet-stock — fitsLagunaEnvelope', () => {
  it('full-sheet fits at 0 margin with positive slack on every axis', () => {
    const fit = fitsLagunaEnvelope(48 * 25.4, 96 * 25.4, 19.05, 0)
    expect(fit.fits).toBe(true)
    expect(fit.xSlackMm).toBeCloseTo(304.8, 6)
    expect(fit.ySlackMm).toBeCloseTo(609.6, 6)
    expect(fit.zSlackMm).toBeCloseTo(203 - 19.05, 6)
    expect(fit.reason).toBe('')
  })

  it('full-sheet still fits at 25 mm clamp margin on each lateral axis', () => {
    // 304.8 mm slack X minus 2*25 = 254.8 mm; 609.6 mm slack Y minus
    // 2*25 = 559.6 mm — both still positive.
    const fit = fitsLagunaEnvelope(48 * 25.4, 96 * 25.4, 19.05, 25)
    expect(fit.fits).toBe(true)
    expect(fit.xSlackMm).toBeCloseTo(254.8, 6)
    expect(fit.ySlackMm).toBeCloseTo(559.6, 6)
  })

  it('rejects 96 × 48 in (rotated full sheet) — X envelope is 1524 mm', () => {
    const fit = fitsLagunaEnvelope(96 * 25.4, 48 * 25.4, 19.05, 0)
    expect(fit.fits).toBe(false)
    expect(fit.xSlackMm).toBeLessThan(0)
    expect(fit.reason).toMatch(/X oversize/)
  })

  it('rejects an oversize Z (e.g. 250 mm slab > 203 mm envelope)', () => {
    const fit = fitsLagunaEnvelope(100, 100, 250, 0)
    expect(fit.fits).toBe(false)
    expect(fit.zSlackMm).toBeLessThan(0)
    expect(fit.reason).toMatch(/Z oversize/)
  })

  it('reports multiple oversize axes in a single reason string', () => {
    const fit = fitsLagunaEnvelope(2000, 4000, 250, 0)
    expect(fit.fits).toBe(false)
    expect(fit.reason).toMatch(/X oversize/)
    expect(fit.reason).toMatch(/Y oversize/)
    expect(fit.reason).toMatch(/Z oversize/)
    expect(fit.reason).toMatch(/;/)
  })

  it('exact-fit yields fits=true and zero slack', () => {
    const fit = fitsLagunaEnvelope(1524, 3048, 203, 0)
    expect(fit.fits).toBe(true)
    expect(fit.xSlackMm).toBe(0)
    expect(fit.ySlackMm).toBe(0)
    expect(fit.zSlackMm).toBe(0)
  })

  it('NaN / negative inputs collapse to 0 (oversize-prefer)', () => {
    const fit = fitsLagunaEnvelope(Number.NaN, -100, Number.NaN, -5)
    expect(fit.fits).toBe(true)
    expect(fit.xSlackMm).toBe(LAGUNA_SWIFT_WORK_AREA_MM.x)
    expect(fit.ySlackMm).toBe(LAGUNA_SWIFT_WORK_AREA_MM.y)
    expect(fit.zSlackMm).toBe(LAGUNA_SWIFT_WORK_AREA_MM.z)
  })
})

describe('laguna-full-sheet-stock — buildLagunaSheetBoxStock', () => {
  it('builds a box stock for full-sheet 3/4 plywood', () => {
    const stock = buildLagunaSheetBoxStock(
      'full-sheet-48x96',
      '3-4',
      'plywood'
    )
    expect(stock).toEqual({
      kind: 'box',
      x: 48 * 25.4,
      y: 96 * 25.4,
      z: 0.75 * 25.4,
      materialType: 'plywood'
    })
  })

  it('omits materialType when no materialId is supplied', () => {
    const stock = buildLagunaSheetBoxStock('full-sheet-48x96', '1-2')
    expect(stock).toEqual({
      kind: 'box',
      x: 48 * 25.4,
      y: 96 * 25.4,
      z: 0.5 * 25.4
    })
    expect(stock?.materialType).toBeUndefined()
  })

  it('returns null on unknown planform', () => {
    expect(buildLagunaSheetBoxStock('not-real', '3-4', 'plywood')).toBeNull()
  })

  it('returns null on unknown thickness', () => {
    expect(
      buildLagunaSheetBoxStock('full-sheet-48x96', '13-32', 'plywood')
    ).toBeNull()
  })

  it('returns null when materialId is provided but unknown', () => {
    expect(
      buildLagunaSheetBoxStock('full-sheet-48x96', '3-4', 'aluminum')
    ).toBeNull()
  })
})

describe('laguna-full-sheet-stock — fixture-aware origin', () => {
  it('returns 0,0,0 origin when fixture margin is 0', () => {
    const origin = lagunaFixtureAwareSheetOriginMm(48 * 25.4, 96 * 25.4, 0)
    expect(origin).toEqual({ xMm: 0, yMm: 0, zMm: 0 })
  })

  it('returns the standoff on X and Y when margin is positive', () => {
    const origin = lagunaFixtureAwareSheetOriginMm(48 * 25.4, 96 * 25.4, 25)
    expect(origin).toEqual({ xMm: 25, yMm: 25, zMm: 0 })
  })

  it('Z is always 0 (Laguna bed is the Z = 0 datum)', () => {
    for (const margin of [0, 5, 25, 100]) {
      const origin = lagunaFixtureAwareSheetOriginMm(
        48 * 25.4,
        96 * 25.4,
        margin
      )
      expect(origin.zMm).toBe(0)
    }
  })

  it('negative / NaN margin collapses to 0 (margin can never offset negatively)', () => {
    expect(
      lagunaFixtureAwareSheetOriginMm(48 * 25.4, 96 * 25.4, -25)
    ).toEqual({ xMm: 0, yMm: 0, zMm: 0 })
    expect(
      lagunaFixtureAwareSheetOriginMm(48 * 25.4, 96 * 25.4, Number.NaN)
    ).toEqual({ xMm: 0, yMm: 0, zMm: 0 })
  })
})

describe('laguna-full-sheet-stock — resolveLagunaFullSheet', () => {
  it('returns stock + fit + origin for a valid full-sheet 3/4 plywood preset', () => {
    const resolved = resolveLagunaFullSheet('full-sheet-48x96', '3-4', {
      materialId: 'plywood',
      fixtureMarginMm: 25
    })
    expect(resolved).not.toBeNull()
    if (!resolved) return // type-narrow for TS strict
    expect(resolved.stock.x).toBeCloseTo(48 * 25.4, 6)
    expect(resolved.stock.y).toBeCloseTo(96 * 25.4, 6)
    expect(resolved.stock.z).toBeCloseTo(19.05, 6)
    expect(resolved.stock.materialType).toBe('plywood')
    expect(resolved.fit.fits).toBe(true)
    expect(resolved.fit.xSlackMm).toBeCloseTo(254.8, 6)
    expect(resolved.fit.ySlackMm).toBeCloseTo(559.6, 6)
    expect(resolved.originMm).toEqual({ xMm: 25, yMm: 25, zMm: 0 })
  })

  it('returns null when planform is unknown', () => {
    expect(
      resolveLagunaFullSheet('bad-id', '3-4', { materialId: 'plywood' })
    ).toBeNull()
  })

  it('returns null when thickness is unknown', () => {
    expect(
      resolveLagunaFullSheet('full-sheet-48x96', 'bad-id')
    ).toBeNull()
  })

  it('omits materialType + uses 0 default margin when options omitted', () => {
    const resolved = resolveLagunaFullSheet('full-sheet-48x96', '1-2')
    expect(resolved).not.toBeNull()
    if (!resolved) return
    expect(resolved.stock.materialType).toBeUndefined()
    expect(resolved.originMm).toEqual({ xMm: 0, yMm: 0, zMm: 0 })
  })

  it('quarter-sheet fits trivially at the Laguna envelope (24 × 48 in)', () => {
    const resolved = resolveLagunaFullSheet('quarter-sheet-24x48', '1-4', {
      materialId: 'mdf'
    })
    expect(resolved).not.toBeNull()
    if (!resolved) return
    expect(resolved.fit.fits).toBe(true)
    expect(resolved.stock.materialType).toBe('mdf')
  })
})

describe('laguna-full-sheet-stock — JSDoc paired-pin', () => {
  /**
   * The module documents three named invariants: (a) the inch→mm
   * constant is exact, (b) the work-area mirror matches the bundled
   * JSON, (c) the rotated full-sheet does NOT fit. The first two are
   * pinned above; this block pins (c) explicitly so a future refactor
   * that, e.g., renames the X/Y axes can't silently let the rotated
   * sheet through.
   */
  it('rotated full sheet (96×48) is documented as not fitting', () => {
    const fit = fitsLagunaEnvelope(96 * 25.4, 48 * 25.4, 19.05, 0)
    expect(fit.fits).toBe(false)
  })

  it('standard full sheet (48×96) is documented as fitting', () => {
    const fit = fitsLagunaEnvelope(48 * 25.4, 96 * 25.4, 19.05, 0)
    expect(fit.fits).toBe(true)
  })
})
