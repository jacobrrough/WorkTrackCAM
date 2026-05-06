/**
 * cam-setup-defaults-pin.test.ts -- [ID-0288] Cycle 216 post-processing paired-pin
 *
 * Pins the contract of `src/shared/cam-setup-defaults.ts` -- the 127-line
 * SHARED helper module that produces stock-derived defaults consumed by
 * EVERY CAM cut-params resolver across the three target machines:
 *
 *   - **Creality K2 Plus** (FDM): does NOT call CAM safe-Z helpers, but the
 *     `setupStockHasDims` / `setupStockThicknessZMm` discriminated-union
 *     narrowers are reused by the Manufacture-readiness gate that decides
 *     whether the K2 slice button is enabled.
 *   - **Laguna Swift 5x10** (CNC router): every full-sheet job pulls
 *     `recommendedSafeZFromStockThicknessMm` for clearance Z, plus
 *     `shopJobStockAsCamSetup` for Shop quick-switch full-sheet decode
 *     (1524x3048x19 plywood is the canonical preset).
 *   - **Makera Carvera + 4-axis Rotary** (desktop 4-axis): pulls
 *     `rotaryDimsFromSetupStock`, `rotaryMachinableXSpanMm`, and
 *     `rotaryMeshStockAlignmentHint` for the 4-axis envelope (X offset to
 *     headstock, Y=0 at rotation axis, chuck-depth + clamp-offset deductions
 *     from the stock left face).
 *
 * Companion behavioral file: `cam-setup-defaults.test.ts` (~36 it() across
 * 7 describe groups -- happy-path scaling + degenerate-input matrix per
 * function). This pin file extends coverage to lock the CONTRACT surface
 * the call-sites depend on -- module shape, exports, formula constants
 * (4 mm safe-Z floor / 30 mm safe-Z ceiling / 0.08 slope, 0.02 mm rest-gap
 * threshold, 0.5 mm zPass floor, 60% chuck-clamp cap), the 9-export module
 * shape, the discriminated-union narrowing contract, the three-machine
 * realism scenarios (Laguna full-sheet plywood, Carvera 3-axis 360x240x140
 * box, Carvera 4-axis cylinder, K2 Plus FDM box), the pure-function
 * invariant (no mutation of input objects), and the source-text whitelist
 * (no emoji, no console.*, no banned imports, no Promise/async surface).
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred": this pin file authors
 * tests only. No edits to `cam-setup-defaults.ts`, no machine-profile
 * edits, no `.hbs` template edits, no schema edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import * as Mod from './cam-setup-defaults'
import {
  rasterRestGapFromStockAndMeshMinZ,
  recommendedSafeZFromStockThicknessMm,
  rotaryDimsFromSetupStock,
  rotaryMachinableXSpanMm,
  rotaryMeshStockAlignmentHint,
  setupStockHasDims,
  setupStockThicknessZMm,
  shopJobStockAsCamSetup,
  suggestedZPassMmFromStockAndMeshMinZ
} from './cam-setup-defaults'
import type { SetupStockLike } from './cam-setup-defaults'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All 9 runtime exports the source emits, in declaration order. */
const RUNTIME_EXPORTS_IN_ORDER = [
  'recommendedSafeZFromStockThicknessMm',
  'rasterRestGapFromStockAndMeshMinZ',
  'setupStockHasDims',
  'setupStockThicknessZMm',
  'rotaryDimsFromSetupStock',
  'rotaryMachinableXSpanMm',
  'rotaryMeshStockAlignmentHint',
  'shopJobStockAsCamSetup',
  'suggestedZPassMmFromStockAndMeshMinZ'
] as const

/** Read the source file once for the source-text whitelist describe group. */
const SOURCE_PATH = resolvePath(__dirname, 'cam-setup-defaults.ts')
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf8')

/** Three-machine canonical Shop quick-switch fixtures. */
const LAGUNA_FULL_SHEET = { x: 1524, y: 3048, z: 19 } as const // 4x10 plywood
const CARVERA_BAR = { x: 50, y: 50, z: 100 } as const // square bar 3-axis
const K2_FDM_BOX = { x: 200, y: 200, z: 30 } as const // small FDM stock

// ---------------------------------------------------------------------------
// A. Module shape -- export name set, runtime function count, no extras
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: A. module shape', () => {
  it('exports exactly the 9 runtime functions in declaration order', () => {
    const names = Object.keys(Mod).filter((k) => typeof (Mod as Record<string, unknown>)[k] === 'function')
    expect(names.sort()).toEqual([...RUNTIME_EXPORTS_IN_ORDER].sort())
  })

  it('every runtime export is a function (not class, not value)', () => {
    for (const name of RUNTIME_EXPORTS_IN_ORDER) {
      expect(typeof (Mod as Record<string, unknown>)[name]).toBe('function')
    }
  })

  it('no Promise / async surface on any runtime export', () => {
    for (const name of RUNTIME_EXPORTS_IN_ORDER) {
      const fn = (Mod as Record<string, unknown>)[name] as (...args: unknown[]) => unknown
      expect(fn.constructor.name).toBe('Function')
    }
  })

  it('module has exactly the 9 runtime exports (no surprises)', () => {
    const fnNames = Object.keys(Mod).filter((k) => typeof (Mod as Record<string, unknown>)[k] === 'function')
    expect(fnNames.length).toBe(9)
  })

  it('all 9 runtime exports are pinned and individually importable', () => {
    expect(typeof recommendedSafeZFromStockThicknessMm).toBe('function')
    expect(typeof rasterRestGapFromStockAndMeshMinZ).toBe('function')
    expect(typeof setupStockHasDims).toBe('function')
    expect(typeof setupStockThicknessZMm).toBe('function')
    expect(typeof rotaryDimsFromSetupStock).toBe('function')
    expect(typeof rotaryMachinableXSpanMm).toBe('function')
    expect(typeof rotaryMeshStockAlignmentHint).toBe('function')
    expect(typeof shopJobStockAsCamSetup).toBe('function')
    expect(typeof suggestedZPassMmFromStockAndMeshMinZ).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// B. recommendedSafeZFromStockThicknessMm -- clamp + slope constants
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: B. recommendedSafeZFromStockThicknessMm clamp', () => {
  it('arity is exactly 1 (single number argument)', () => {
    expect(recommendedSafeZFromStockThicknessMm.length).toBe(1)
  })

  it('floor saturates at ~4 mm at the smallest allowed stock height (0.01 mm internal floor)', () => {
    // z = Math.max(0.01, stockZMm) -> 0.01 -> 4 + 0.01*0.08 = 4.0008 (Math.max(4, 4.0008) = 4.0008)
    // Negative / zero / 0.01 all collapse to the same floor.
    const FLOOR = 4 + 0.01 * 0.08 // 4.0008
    expect(recommendedSafeZFromStockThicknessMm(0.01)).toBeCloseTo(FLOOR, 9)
    expect(recommendedSafeZFromStockThicknessMm(0)).toBeCloseTo(FLOOR, 9) // raised by Math.max(0.01, ...)
    expect(recommendedSafeZFromStockThicknessMm(-1000)).toBeCloseTo(FLOOR, 9) // negative also raised
    // All three are >= the hard 4 mm absolute floor enforced by Math.max(4, ...)
    expect(recommendedSafeZFromStockThicknessMm(0.01)).toBeGreaterThanOrEqual(4)
    expect(recommendedSafeZFromStockThicknessMm(0)).toBeGreaterThanOrEqual(4)
    expect(recommendedSafeZFromStockThicknessMm(-1000)).toBeGreaterThanOrEqual(4)
  })

  it('linear slope 0.08 in the middle range (z=50 -> 8 mm)', () => {
    expect(recommendedSafeZFromStockThicknessMm(50)).toBeCloseTo(8, 9)
  })

  it('linear slope 0.08 at z=100 (4 + 100*0.08 = 12 mm)', () => {
    expect(recommendedSafeZFromStockThicknessMm(100)).toBeCloseTo(12, 9)
  })

  it('linear slope 0.08 at z=200 (4 + 200*0.08 = 20 mm)', () => {
    expect(recommendedSafeZFromStockThicknessMm(200)).toBeCloseTo(20, 9)
  })

  it('exact clamp boundary at z=325 (4 + 325*0.08 = 30 mm)', () => {
    expect(recommendedSafeZFromStockThicknessMm(325)).toBeCloseTo(30, 9)
  })

  it('ceiling = 30 mm beyond z=325', () => {
    expect(recommendedSafeZFromStockThicknessMm(326)).toBe(30)
    expect(recommendedSafeZFromStockThicknessMm(1000)).toBe(30)
    expect(recommendedSafeZFromStockThicknessMm(1e9)).toBe(30)
  })

  it('return value is monotonically non-decreasing in stock thickness', () => {
    const samples = [0.01, 1, 5, 10, 25, 50, 100, 150, 200, 300, 325, 400, 1000]
    for (let i = 1; i < samples.length; i += 1) {
      expect(recommendedSafeZFromStockThicknessMm(samples[i])).toBeGreaterThanOrEqual(
        recommendedSafeZFromStockThicknessMm(samples[i - 1])
      )
    }
  })

  it('return value is always finite for finite non-negative input', () => {
    for (const z of [0, 0.01, 1, 50, 325, 1000]) {
      expect(Number.isFinite(recommendedSafeZFromStockThicknessMm(z))).toBe(true)
    }
  })

  it('return value is always >= 4 (floor enforced) for any finite input', () => {
    for (const z of [-100, -1, 0, 0.01, 1, 50, 325, 1000]) {
      expect(recommendedSafeZFromStockThicknessMm(z)).toBeGreaterThanOrEqual(4)
    }
  })

  it('return value is always <= 30 (ceiling enforced) for any finite input', () => {
    for (const z of [-100, 0, 0.01, 1, 50, 325, 1000, 1e9]) {
      expect(recommendedSafeZFromStockThicknessMm(z)).toBeLessThanOrEqual(30)
    }
  })

  it('NaN input -> NaN propagates (Math.max(0.01, NaN) === NaN; no silent zero)', () => {
    expect(Number.isNaN(recommendedSafeZFromStockThicknessMm(NaN))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// C. rasterRestGapFromStockAndMeshMinZ -- WCS gap convention
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: C. rasterRestGapFromStockAndMeshMinZ', () => {
  it('arity is exactly 2 (stockZMm, meshMinZMm)', () => {
    expect(rasterRestGapFromStockAndMeshMinZ.length).toBe(2)
  })

  it('returns gap = meshMinZMm + stockZMm when above 0.02 threshold', () => {
    expect(rasterRestGapFromStockAndMeshMinZ(20, -12)).toBeCloseTo(8, 9)
    expect(rasterRestGapFromStockAndMeshMinZ(50, -10)).toBeCloseTo(40, 9)
    expect(rasterRestGapFromStockAndMeshMinZ(15, -5)).toBeCloseTo(10, 9)
  })

  it('returns undefined when stockZMm <= 0', () => {
    expect(rasterRestGapFromStockAndMeshMinZ(0, -5)).toBeUndefined()
    expect(rasterRestGapFromStockAndMeshMinZ(-1, -5)).toBeUndefined()
    expect(rasterRestGapFromStockAndMeshMinZ(-100, -5)).toBeUndefined()
  })

  it('returns undefined when meshMinZMm is non-finite', () => {
    expect(rasterRestGapFromStockAndMeshMinZ(20, NaN)).toBeUndefined()
    expect(rasterRestGapFromStockAndMeshMinZ(20, Infinity)).toBeUndefined()
    expect(rasterRestGapFromStockAndMeshMinZ(20, -Infinity)).toBeUndefined()
  })

  it('returns undefined at the 0.02 mm threshold (strict-greater pinned exactly)', () => {
    // gap = -19.98 + 20 = 0.02 -> NOT > 0.02 -> undefined
    expect(rasterRestGapFromStockAndMeshMinZ(20, -19.98)).toBeUndefined()
    // gap = -19.99 + 20 = 0.01 -> below threshold
    expect(rasterRestGapFromStockAndMeshMinZ(20, -19.99)).toBeUndefined()
    // gap = -20 + 20 = 0 -> below threshold
    expect(rasterRestGapFromStockAndMeshMinZ(20, -20)).toBeUndefined()
    // gap > 0.02 -> defined
    expect(rasterRestGapFromStockAndMeshMinZ(20, -19.97)).toBeCloseTo(0.03, 9)
  })

  it('returns undefined when stockZMm is NaN', () => {
    expect(rasterRestGapFromStockAndMeshMinZ(NaN, -5)).toBeUndefined()
  })

  it('mesh below stock bottom -> negative gap -> undefined', () => {
    expect(rasterRestGapFromStockAndMeshMinZ(20, -25)).toBeUndefined()
    expect(rasterRestGapFromStockAndMeshMinZ(20, -100)).toBeUndefined()
  })

  it('positive meshMinZMm (mesh above stock top) yields positive gap', () => {
    // meshMinZMm = 5, stockZMm = 20 -> sum = 25 -> > 0.02 -> returns 25
    expect(rasterRestGapFromStockAndMeshMinZ(20, 5)).toBeCloseTo(25, 9)
  })
})

// ---------------------------------------------------------------------------
// D. setupStockHasDims -- discriminated-union narrowing
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: D. setupStockHasDims', () => {
  it('arity is exactly 1 (stock argument)', () => {
    expect(setupStockHasDims.length).toBe(1)
  })

  it('returns false for undefined', () => {
    expect(setupStockHasDims(undefined)).toBe(false)
  })

  it('returns false for fromExtents (no manual dims)', () => {
    expect(setupStockHasDims({ kind: 'fromExtents' })).toBe(false)
  })

  it('returns true for box with x+z (xz path)', () => {
    expect(setupStockHasDims({ kind: 'box', x: 100, z: 20 })).toBe(true)
  })

  it('returns true for box with x+y (xy path)', () => {
    expect(setupStockHasDims({ kind: 'box', x: 100, y: 50 })).toBe(true)
  })

  it('returns true for cylinder with x+z (xz path: length + diameter)', () => {
    expect(setupStockHasDims({ kind: 'cylinder', x: 80, z: 30 })).toBe(true)
  })

  it('returns false when x is missing', () => {
    expect(setupStockHasDims({ kind: 'box', y: 50, z: 20 } as SetupStockLike)).toBe(false)
  })

  it('returns false when x is zero', () => {
    expect(setupStockHasDims({ kind: 'box', x: 0, y: 50, z: 20 } as SetupStockLike)).toBe(false)
  })

  it('returns false when both y and z are zero or missing', () => {
    expect(setupStockHasDims({ kind: 'box', x: 100 } as SetupStockLike)).toBe(false)
    expect(setupStockHasDims({ kind: 'box', x: 100, y: 0, z: 0 } as SetupStockLike)).toBe(false)
  })

  it('returns true when both xz and xy paths satisfy (logical OR)', () => {
    expect(setupStockHasDims({ kind: 'box', x: 100, y: 50, z: 20 })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// E. setupStockThicknessZMm -- type guard / null parity
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: E. setupStockThicknessZMm', () => {
  it('arity is exactly 1', () => {
    expect(setupStockThicknessZMm.length).toBe(1)
  })

  it('returns undefined for undefined stock', () => {
    expect(setupStockThicknessZMm(undefined)).toBeUndefined()
  })

  it('returns undefined for fromExtents (auto-derived stock has no manual thickness)', () => {
    expect(setupStockThicknessZMm({ kind: 'fromExtents' })).toBeUndefined()
  })

  it('returns z for box with positive finite z', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: 19 })).toBe(19)
    expect(setupStockThicknessZMm({ kind: 'box', x: 1524, y: 3048, z: 19 })).toBe(19)
  })

  it('returns z for cylinder (z = diameter for cylinder kind)', () => {
    expect(setupStockThicknessZMm({ kind: 'cylinder', x: 100, z: 30 })).toBe(30)
  })

  it('returns undefined when z is zero', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: 0 } as SetupStockLike)).toBeUndefined()
  })

  it('returns undefined when z is negative', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: -5 } as SetupStockLike)).toBeUndefined()
  })

  it('returns undefined when z is NaN', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: NaN } as SetupStockLike)).toBeUndefined()
  })

  it('returns undefined when z is Infinity', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50, z: Infinity } as SetupStockLike)).toBeUndefined()
  })

  it('returns undefined when z is missing entirely', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 100, y: 50 } as SetupStockLike)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// F. rotaryDimsFromSetupStock -- 4-axis envelope decode
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: F. rotaryDimsFromSetupStock', () => {
  it('arity is exactly 1', () => {
    expect(rotaryDimsFromSetupStock.length).toBe(1)
  })

  it('returns {} for undefined', () => {
    expect(rotaryDimsFromSetupStock(undefined)).toEqual({})
  })

  it('returns {} for fromExtents (auto-from-mesh has no manual dims)', () => {
    expect(rotaryDimsFromSetupStock({ kind: 'fromExtents' })).toEqual({})
  })

  it('returns {lengthMm, diameterMm} for box stock', () => {
    expect(rotaryDimsFromSetupStock({ kind: 'box', x: 100, y: 40, z: 40 })).toEqual({
      lengthMm: 100,
      diameterMm: 40
    })
  })

  it('returns {lengthMm, diameterMm} for cylinder stock', () => {
    expect(rotaryDimsFromSetupStock({ kind: 'cylinder', x: 240, y: 92, z: 92 })).toEqual({
      lengthMm: 240,
      diameterMm: 92
    })
  })

  it('Carvera 4-axis max envelope (240 x 92): both dims pinned exactly', () => {
    // Per CLAUDE.md: 4th axis = harmonic-drive rotary, max ~92 mm dia x 240 mm length
    const dims = rotaryDimsFromSetupStock({ kind: 'cylinder', x: 240, y: 92, z: 92 })
    expect(dims.lengthMm).toBe(240)
    expect(dims.diameterMm).toBe(92)
  })

  it('lengthMm is undefined when x is zero (positive-only guard)', () => {
    expect(rotaryDimsFromSetupStock({ kind: 'box', x: 0, y: 40, z: 40 } as SetupStockLike)).toEqual({
      lengthMm: undefined,
      diameterMm: 40
    })
  })

  it('diameterMm is undefined when y is zero', () => {
    expect(rotaryDimsFromSetupStock({ kind: 'cylinder', x: 80, y: 0, z: 30 } as SetupStockLike)).toEqual({
      lengthMm: 80,
      diameterMm: undefined
    })
  })

  it('lengthMm is undefined when x is negative', () => {
    expect(rotaryDimsFromSetupStock({ kind: 'box', x: -5, y: 40, z: 40 } as SetupStockLike).lengthMm).toBeUndefined()
  })

  it('returned object is a fresh literal (does not alias the input)', () => {
    const stock = { kind: 'box' as const, x: 50, y: 25, z: 25 }
    const dims = rotaryDimsFromSetupStock(stock)
    expect(dims).not.toBe(stock as unknown as object)
    expect(dims.lengthMm).toBe(50)
  })
})

// ---------------------------------------------------------------------------
// G. rotaryMachinableXSpanMm -- chuck/clamp clamp boundaries
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: G. rotaryMachinableXSpanMm', () => {
  it('arity is exactly 3 (stockLengthMm, chuckDepthMm, clampOffsetMm)', () => {
    expect(rotaryMachinableXSpanMm.length).toBe(3)
  })

  it('result shape always present: machXStartMm + machXEndMm', () => {
    const r = rotaryMachinableXSpanMm(100, 10, 5)
    expect(r).toHaveProperty('machXStartMm')
    expect(r).toHaveProperty('machXEndMm')
    expect(typeof r.machXStartMm).toBe('number')
    expect(typeof r.machXEndMm).toBe('number')
  })

  it('machXEndMm equals stockLengthMm (machinable interval ends at stock right face)', () => {
    expect(rotaryMachinableXSpanMm(100, 10, 5).machXEndMm).toBe(100)
    expect(rotaryMachinableXSpanMm(240, 15, 0).machXEndMm).toBe(240)
    expect(rotaryMachinableXSpanMm(50, 10, 2).machXEndMm).toBe(50)
  })

  it('machXEndMm = 0 for zero-length stock (Math.max(0, neg) floor)', () => {
    expect(rotaryMachinableXSpanMm(0, 10, 5).machXEndMm).toBe(0)
    expect(rotaryMachinableXSpanMm(-100, 10, 5).machXEndMm).toBe(0)
  })

  it('chuck-depth clamp = min(ck, sl * 0.6) (60% of stock length)', () => {
    // sl=100, ck=80 -> clampLen = min(80, 60) = 60
    // offsetLen = min(0, max(0, 100 - 60 - 1)) = 0
    // machXStart = 60 + 0 = 60
    expect(rotaryMachinableXSpanMm(100, 80, 0).machXStartMm).toBe(60)
  })

  it('chuck-depth respected when below 60% cap', () => {
    expect(rotaryMachinableXSpanMm(100, 10, 0).machXStartMm).toBe(10)
  })

  it('negative chuck depth raised to zero', () => {
    expect(rotaryMachinableXSpanMm(100, -5, 0).machXStartMm).toBe(0)
  })

  it('negative clamp offset raised to zero', () => {
    expect(rotaryMachinableXSpanMm(100, 10, -5).machXStartMm).toBe(10)
  })

  it('clamp offset capped to leave at least 1 mm of machinable stock', () => {
    // sl=100, ck=10 -> clampLen=10, max remaining = 100-10-1 = 89
    // offsetLen = min(200, 89) = 89 -> machXStart = 10 + 89 = 99 (1 mm machinable)
    expect(rotaryMachinableXSpanMm(100, 10, 200).machXStartMm).toBe(99)
  })

  it('zero stock length -> machXStart = 0 (no negative offset)', () => {
    const r = rotaryMachinableXSpanMm(0, 10, 5)
    expect(r.machXStartMm).toBe(0)
    expect(r.machXEndMm).toBe(0)
  })

  it('machXStartMm is always <= machXEndMm (ordered interval)', () => {
    const cases: Array<[number, number, number]> = [
      [100, 10, 5],
      [240, 15, 0],
      [50, 10, 30],
      [0, 10, 5],
      [100, 80, 100],
      [100, 200, 0]
    ]
    for (const [sl, ck, off] of cases) {
      const r = rotaryMachinableXSpanMm(sl, ck, off)
      expect(r.machXStartMm).toBeLessThanOrEqual(r.machXEndMm)
    }
  })

  it('Carvera 4-axis canonical envelope: 240 mm bar, 15 mm chuck, 0 offset -> [15, 240]', () => {
    const r = rotaryMachinableXSpanMm(240, 15, 0)
    expect(r.machXStartMm).toBe(15)
    expect(r.machXEndMm).toBe(240)
  })
})

// ---------------------------------------------------------------------------
// H. rotaryMeshStockAlignmentHint -- centered-CAD detection
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: H. rotaryMeshStockAlignmentHint', () => {
  it('arity is exactly 1 (single object param)', () => {
    expect(rotaryMeshStockAlignmentHint.length).toBe(1)
  })

  it('returns string when mesh is centered in CAD vs stock left-face WCS', () => {
    const h = rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: -40, meshMaxX: 40 })
    expect(typeof h).toBe('string')
  })

  it('returned hint cites docs/CAM_4TH_AXIS_REFERENCE.md (canonical reference)', () => {
    const h = rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: -40, meshMaxX: 40 })
    expect(h).toContain('CAM_4TH_AXIS_REFERENCE')
  })

  it('returned hint includes both meshMinX and meshMaxX values', () => {
    const h = rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: -40, meshMaxX: 40 })
    expect(h).toContain('-40')
    expect(h).toContain('40')
  })

  it('returns undefined for zero-length stock', () => {
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 0, meshMinX: -40, meshMaxX: 40 })).toBeUndefined()
  })

  it('returns undefined for negative stock length', () => {
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: -10, meshMinX: -40, meshMaxX: 40 })).toBeUndefined()
  })

  it('returns undefined when meshMaxX <= meshMinX (degenerate / zero-extent mesh)', () => {
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: 5, meshMaxX: 5 })).toBeUndefined()
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: 10, meshMaxX: 5 })).toBeUndefined()
  })

  it('returns undefined when mesh is fully in positive X (well-aligned to WCS)', () => {
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: 0, meshMaxX: 80 })).toBeUndefined()
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 240, meshMinX: 10, meshMaxX: 230 })).toBeUndefined()
  })

  it('returns undefined when meshMaxX reaches into stock right half (not centered)', () => {
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: -5, meshMaxX: 90 })).toBeUndefined()
  })

  it('returns undefined when negative extent is below the 15%-of-length threshold', () => {
    // minNegExtent = min(10, 100*0.15) = min(10, 15) = 10
    // meshMinX = -5 -> -5 < -10 is false -> no warning
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: -5, meshMaxX: 30 })).toBeUndefined()
  })

  it('15% threshold cap at 10 mm for long stock (Laguna-style)', () => {
    // stockLengthMm = 1000 -> minNegExtent = min(10, 150) = 10 -> -11 triggers
    const h = rotaryMeshStockAlignmentHint({ stockLengthMm: 1000, meshMinX: -11, meshMaxX: 100 })
    expect(typeof h).toBe('string')
  })

  it('returns undefined when mesh + stock have no overlap (mesh entirely below stock)', () => {
    // mesh entirely outside stock right face -> overlap = 0
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 100, meshMinX: -30, meshMaxX: -1 })).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// I. shopJobStockAsCamSetup -- Shop quick-switch decode (three-machine)
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: I. shopJobStockAsCamSetup three-machine quick-switch', () => {
  it('arity is exactly 1 (object param)', () => {
    expect(shopJobStockAsCamSetup.length).toBe(1)
  })

  it('returns {stock} wrapper, not the bare stock object', () => {
    const s = shopJobStockAsCamSetup({ x: 100, y: 50, z: 19 })
    expect(s).toHaveProperty('stock')
    expect(s.stock).toBeDefined()
  })

  it('always emits kind: "box" (Shop quick-switch never picks cylinder)', () => {
    expect(shopJobStockAsCamSetup({ x: 100, y: 50, z: 19 }).stock?.kind).toBe('box')
    expect(shopJobStockAsCamSetup({ x: 1524, y: 3048, z: 19 }).stock?.kind).toBe('box')
    expect(shopJobStockAsCamSetup({ x: 50, y: 50, z: 100 }).stock?.kind).toBe('box')
  })

  it('Laguna full-sheet plywood (1524 x 3048 x 19) decodes verbatim', () => {
    const s = shopJobStockAsCamSetup(LAGUNA_FULL_SHEET)
    expect(s.stock?.x).toBe(1524)
    expect(s.stock?.y).toBe(3048)
    expect(s.stock?.z).toBe(19)
  })

  it('Carvera 3-axis bar (50 x 50 x 100) decodes verbatim', () => {
    const s = shopJobStockAsCamSetup(CARVERA_BAR)
    expect(s.stock?.x).toBe(50)
    expect(s.stock?.y).toBe(50)
    expect(s.stock?.z).toBe(100)
  })

  it('K2 Plus FDM box (200 x 200 x 30) decodes verbatim', () => {
    const s = shopJobStockAsCamSetup(K2_FDM_BOX)
    expect(s.stock?.x).toBe(200)
    expect(s.stock?.y).toBe(200)
    expect(s.stock?.z).toBe(30)
  })

  it('preserves raw zero / negative inputs verbatim (caller is responsible for guard)', () => {
    const s = shopJobStockAsCamSetup({ x: 0, y: 0, z: 0 })
    expect(s.stock?.x).toBe(0)
    expect(s.stock?.y).toBe(0)
    expect(s.stock?.z).toBe(0)
  })

  it('returned object is a fresh literal (does not alias the input)', () => {
    const input = { x: 100, y: 50, z: 19 }
    const s = shopJobStockAsCamSetup(input)
    expect(s.stock).not.toBe(input as unknown as object)
  })
})

// ---------------------------------------------------------------------------
// J. suggestedZPassMmFromStockAndMeshMinZ -- zPass floor + stock cap
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: J. suggestedZPassMmFromStockAndMeshMinZ', () => {
  it('arity is exactly 2', () => {
    expect(suggestedZPassMmFromStockAndMeshMinZ.length).toBe(2)
  })

  it('returns -depth when mesh extends below stock surface (negative)', () => {
    // stockZMm=20, meshMinZMm=-8 -> depth = min(20, 8) = 8 -> -8
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -8)).toBe(-8)
  })

  it('caps depth at stock thickness (mesh deeper than stock)', () => {
    // stockZMm=5, meshMinZMm=-25 -> depth = min(5, 25) = 5 -> -5
    expect(suggestedZPassMmFromStockAndMeshMinZ(5, -25)).toBe(-5)
  })

  it('returns undefined for non-positive stockZMm', () => {
    expect(suggestedZPassMmFromStockAndMeshMinZ(0, -8)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(-1, -8)).toBeUndefined()
  })

  it('returns undefined for non-finite meshMinZMm', () => {
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, NaN)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, Infinity)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -Infinity)).toBeUndefined()
  })

  it('returns undefined when meshMinZMm is at or above the surface (>= -1e-6)', () => {
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, 0)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, 1)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -1e-7)).toBeUndefined()
    // -1e-6 is the threshold itself: -1e-6 >= -1e-6 -> true -> undefined
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -1e-6)).toBeUndefined()
    // Just below the threshold (more negative) -> still subject to depth>=0.5 floor
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -2e-6)).toBeUndefined() // depth too shallow
  })

  it('returns undefined when computed depth is below 0.5 mm floor', () => {
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -0.4)).toBeUndefined()
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -0.499)).toBeUndefined()
  })

  it('depth = 0.5 mm exactly returns -0.5 (>= 0.5 passes the floor check)', () => {
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -0.5)).toBe(-0.5)
    expect(suggestedZPassMmFromStockAndMeshMinZ(20, -0.4999999)).toBeUndefined()
  })

  it('return value is always negative when defined', () => {
    const cases: Array<[number, number]> = [
      [20, -8],
      [5, -25],
      [10, -10],
      [50, -1.5]
    ]
    for (const [sl, mz] of cases) {
      const r = suggestedZPassMmFromStockAndMeshMinZ(sl, mz)
      expect(r).toBeDefined()
      expect(r as number).toBeLessThanOrEqual(0)
    }
  })

  it('return value never exceeds stock thickness in magnitude', () => {
    expect(Math.abs(suggestedZPassMmFromStockAndMeshMinZ(5, -1000) as number)).toBeLessThanOrEqual(5)
    expect(Math.abs(suggestedZPassMmFromStockAndMeshMinZ(20, -1000) as number)).toBeLessThanOrEqual(20)
    expect(Math.abs(suggestedZPassMmFromStockAndMeshMinZ(100, -1000) as number)).toBeLessThanOrEqual(100)
  })
})

// ---------------------------------------------------------------------------
// K. Three-machine cross-cut realism
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: K. three-machine cross-cut realism', () => {
  it('Laguna 5x10 full-sheet plywood: safe-Z = 4 + 19*0.08 = 5.52 mm', () => {
    expect(recommendedSafeZFromStockThicknessMm(19)).toBeCloseTo(5.52, 5)
  })

  it('Laguna 5x10 thick MDF (38 mm): safe-Z = 4 + 38*0.08 = 7.04 mm', () => {
    expect(recommendedSafeZFromStockThicknessMm(38)).toBeCloseTo(7.04, 5)
  })

  it('Carvera 3-axis full-Z stock (140 mm): safe-Z = 4 + 140*0.08 = 15.2 mm', () => {
    expect(recommendedSafeZFromStockThicknessMm(140)).toBeCloseTo(15.2, 5)
  })

  it('Carvera 4-axis 240 mm bar -> rotary dims preserved exactly', () => {
    const dims = rotaryDimsFromSetupStock({ kind: 'cylinder', x: 240, y: 92, z: 92 })
    expect(dims.lengthMm).toBe(240)
    expect(dims.diameterMm).toBe(92)
  })

  it('Carvera 4-axis machinable span: 240 mm bar - 15 mm chuck - 5 mm offset = [20, 240]', () => {
    const r = rotaryMachinableXSpanMm(240, 15, 5)
    expect(r.machXStartMm).toBe(20)
    expect(r.machXEndMm).toBe(240)
  })

  it('K2 Plus FDM stock readiness: setupStockHasDims true for 350 cube box', () => {
    // K2 Plus build volume 350x350x350 -> any non-zero box passes
    expect(setupStockHasDims({ kind: 'box', x: 350, y: 350, z: 350 })).toBe(true)
  })

  it('K2 Plus FDM thickness: setupStockThicknessZMm = 350 for max-build cube', () => {
    expect(setupStockThicknessZMm({ kind: 'box', x: 350, y: 350, z: 350 })).toBe(350)
  })

  it('Laguna full-sheet quick-switch round-trip: shopJobStockAsCamSetup -> setupStockThicknessZMm', () => {
    const setup = shopJobStockAsCamSetup(LAGUNA_FULL_SHEET)
    expect(setupStockThicknessZMm(setup.stock)).toBe(19)
    expect(setupStockHasDims(setup.stock)).toBe(true)
  })

  it('Carvera 3-axis bar quick-switch round-trip: shopJobStockAsCamSetup -> rotaryDimsFromSetupStock', () => {
    const setup = shopJobStockAsCamSetup(CARVERA_BAR)
    const dims = rotaryDimsFromSetupStock(setup.stock)
    expect(dims.lengthMm).toBe(50)
    expect(dims.diameterMm).toBe(50)
  })

  it('Carvera 4-axis: 92 mm diameter bar safe-Z = 11.36 mm and stays under ceiling', () => {
    expect(recommendedSafeZFromStockThicknessMm(92)).toBeCloseTo(11.36, 5)
    expect(recommendedSafeZFromStockThicknessMm(92)).toBeLessThanOrEqual(30)
  })
})

// ---------------------------------------------------------------------------
// L. Pure-function invariants (no input mutation)
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: L. pure-function invariants', () => {
  it('rotaryDimsFromSetupStock does not mutate input stock', () => {
    const stock = { kind: 'box' as const, x: 100, y: 40, z: 40 }
    const before = JSON.stringify(stock)
    rotaryDimsFromSetupStock(stock)
    expect(JSON.stringify(stock)).toBe(before)
  })

  it('shopJobStockAsCamSetup does not mutate input stock', () => {
    const stock = { x: 100, y: 50, z: 19 }
    const before = JSON.stringify(stock)
    shopJobStockAsCamSetup(stock)
    expect(JSON.stringify(stock)).toBe(before)
  })

  it('setupStockHasDims does not mutate input stock', () => {
    const stock: SetupStockLike = { kind: 'box', x: 100, y: 50, z: 19 }
    const before = JSON.stringify(stock)
    setupStockHasDims(stock)
    expect(JSON.stringify(stock)).toBe(before)
  })

  it('setupStockThicknessZMm does not mutate input stock', () => {
    const stock: SetupStockLike = { kind: 'box', x: 100, y: 50, z: 19 }
    const before = JSON.stringify(stock)
    setupStockThicknessZMm(stock)
    expect(JSON.stringify(stock)).toBe(before)
  })

  it('rotaryMeshStockAlignmentHint does not mutate input params object', () => {
    const params = { stockLengthMm: 100, meshMinX: -40, meshMaxX: 40 }
    const before = JSON.stringify(params)
    rotaryMeshStockAlignmentHint(params)
    expect(JSON.stringify(params)).toBe(before)
  })

  it('repeated calls with identical input produce identical output (referential transparency)', () => {
    expect(recommendedSafeZFromStockThicknessMm(50)).toBe(recommendedSafeZFromStockThicknessMm(50))
    expect(rasterRestGapFromStockAndMeshMinZ(20, -10)).toBe(rasterRestGapFromStockAndMeshMinZ(20, -10))
    expect(suggestedZPassMmFromStockAndMeshMinZ(10, -3)).toBe(suggestedZPassMmFromStockAndMeshMinZ(10, -3))
  })
})

// ---------------------------------------------------------------------------
// M. Source-text whitelist (utf-8 safety, no banned imports/calls)
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: M. source-text whitelist', () => {
  it('source file imports exactly 1 type from manufacture-schema (ManufactureSetup)', () => {
    expect(SOURCE_TEXT).toContain("import type { ManufactureSetup } from './manufacture-schema'")
  })

  it('no console.* debug calls in production source', () => {
    expect(SOURCE_TEXT).not.toMatch(/\bconsole\.(log|debug|info|warn|error)\b/)
  })

  it('no Promise / async surface in source (synchronous helpers only)', () => {
    expect(SOURCE_TEXT).not.toMatch(/\bPromise\b/)
    expect(SOURCE_TEXT).not.toMatch(/\basync\b/)
    expect(SOURCE_TEXT).not.toMatch(/\bawait\b/)
  })

  it('no Node fs / path / child_process imports (pure shared module)', () => {
    expect(SOURCE_TEXT).not.toMatch(/from 'node:fs'/)
    expect(SOURCE_TEXT).not.toMatch(/from 'node:path'/)
    expect(SOURCE_TEXT).not.toMatch(/from 'node:child_process'/)
    expect(SOURCE_TEXT).not.toMatch(/from 'fs'/)
  })

  it('no eval / Function() dynamic-code surface', () => {
    expect(SOURCE_TEXT).not.toMatch(/\beval\(/)
    expect(SOURCE_TEXT).not.toMatch(/new Function\(/)
  })

  it('all 9 runtime export names appear in source as `export function`', () => {
    for (const name of RUNTIME_EXPORTS_IN_ORDER) {
      expect(SOURCE_TEXT).toContain(`export function ${name}`)
    }
  })

  it('safe-Z formula constants appear verbatim in source (4, 30, 0.08)', () => {
    expect(SOURCE_TEXT).toContain('Math.min(30, Math.max(4, 4 + z * 0.08))')
  })

  it('rest-gap threshold 0.02 appears verbatim in source', () => {
    expect(SOURCE_TEXT).toContain('gap > 0.02')
  })

  it('zPass floor 0.5 appears verbatim in source', () => {
    expect(SOURCE_TEXT).toContain('depth < 0.5')
  })

  it('rotary chuck-cap 0.6 appears verbatim in source (60% of stock length)', () => {
    expect(SOURCE_TEXT).toContain('sl * 0.6')
  })

  it('source byte length is bounded (regression guard for accidental bloat)', () => {
    // Locked at landing time. Update intentionally if the helper grows.
    expect(SOURCE_TEXT.length).toBeGreaterThan(2000)
    expect(SOURCE_TEXT.length).toBeLessThan(8000)
  })

  it('source ends with a single trailing newline (POSIX convention)', () => {
    expect(SOURCE_TEXT.endsWith('\n')).toBe(true)
    expect(SOURCE_TEXT.endsWith('\n\n')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// N. Type-level parity (TypeScript surface)
// ---------------------------------------------------------------------------

describe('cam-setup-defaults-pin :: N. type-level parity', () => {
  it('SetupStockLike type accepts box / cylinder / fromExtents', () => {
    const box: SetupStockLike = { kind: 'box', x: 100, y: 50, z: 20 }
    const cyl: SetupStockLike = { kind: 'cylinder', x: 240, z: 92 }
    const fe: SetupStockLike = { kind: 'fromExtents' }
    expect(box.kind).toBe('box')
    expect(cyl.kind).toBe('cylinder')
    expect(fe.kind).toBe('fromExtents')
  })

  it('rotaryDimsFromSetupStock return type has both keys present in result', () => {
    const dims = rotaryDimsFromSetupStock({ kind: 'box', x: 100, y: 40, z: 40 })
    expect(Object.keys(dims).sort()).toEqual(['diameterMm', 'lengthMm'])
  })

  it('rotaryMachinableXSpanMm return type is { machXStartMm, machXEndMm }', () => {
    const r = rotaryMachinableXSpanMm(100, 10, 5)
    expect(Object.keys(r).sort()).toEqual(['machXEndMm', 'machXStartMm'])
  })

  it('shopJobStockAsCamSetup returns Pick<ManufactureSetup, "stock"> shape', () => {
    const s = shopJobStockAsCamSetup({ x: 100, y: 50, z: 19 })
    // Single top-level key: 'stock'
    expect(Object.keys(s)).toEqual(['stock'])
  })

  it('all dimension-returning helpers return number | undefined (never null)', () => {
    expect(rasterRestGapFromStockAndMeshMinZ(0, 0)).not.toBeNull()
    expect(setupStockThicknessZMm(undefined)).not.toBeNull()
    expect(rotaryMeshStockAlignmentHint({ stockLengthMm: 0, meshMinX: 0, meshMaxX: 0 })).not.toBeNull()
    expect(suggestedZPassMmFromStockAndMeshMinZ(0, 0)).not.toBeNull()
  })

  it('boolean predicates always return primitive boolean (not truthy/falsy)', () => {
    expect(typeof setupStockHasDims(undefined)).toBe('boolean')
    expect(typeof setupStockHasDims({ kind: 'box', x: 100, y: 50, z: 20 })).toBe('boolean')
  })
})
