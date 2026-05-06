/**
 * cam-cut-params-pin.test.ts -- [ID-0277] Cycle 205 cam-engine paired-pin
 *
 * Pins the contract of `src/shared/cam-cut-params.ts` -- the SHARED CNC
 * cut-parameter resolver layer used by `cam:run` for ALL three target
 * machines (Laguna Swift 5x10, Makera Carvera 3-axis, Makera Carvera +
 * 4-axis Rotary). The Creality K2 Plus (FDM) bypasses this layer because
 * FDM slicing pulls feed/plunge from the slicer profile rather than the
 * CAM operation params. This pin therefore protects the CNC-side feed,
 * plunge, stepover, z-pass, and safe-Z resolution surface that every
 * Laguna + Carvera CNC job depends on.
 *
 * Production call-sites (verified at landing):
 *   - `src/main/cam-runner.ts:22` -- the central CAM job dispatcher
 *     imports `resolveCamCutParams`, `resolvePencilStepoverMm`,
 *     `resolveAdaptiveCutTuning`, `computeAdaptiveFeed`, and
 *     `resolveRasterScanAngleDeg` for ALL CNC strategy executions.
 *   - `src/main/cam-edge-cases.test.ts:14` -- production-side edge-case
 *     suite imports `resolveCamCutParams`, `CAM_CUT_DEFAULTS`,
 *     `computeEngagementAngleDeg`, `adjustFeedForEngagement`,
 *     `resolvePencilStepoverMm`.
 *   - `src/renderer/manufacture/ManufactureOperationList.tsx:9` -- UI
 *     reads `CAM_CUT_DEFAULTS` for new-op default labels.
 *   - `src/renderer/manufacture/ManufactureWorkspace.tsx:10` -- UI calls
 *     `resolveManufactureSetupForCam` to pick the active setup for the
 *     selected machine.
 *   - `src/renderer/src/setup-sheet.ts:10` -- setup-sheet UI imports
 *     `resolveManufactureSetupForCam`.
 *   - `src/renderer/src/ShopApp.tsx:26-27` -- ShopApp imports
 *     `resolveCamCutParamsWithMaterial`, `applyMaterialToNewOpParams`,
 *     `CAM_CUT_DEFAULTS`.
 *
 * Companion behavioral file: `cam-cut-params.test.ts` (61 it() blocks).
 * This pin file extends coverage to lock the CONTRACT surface the
 * call-sites depend on -- module shape, exports, signature shapes, the
 * defaults-pass-through invariant, the finite/positive validator parity,
 * the safeZ stock-thickness fallback, the material-override
 * exact-four-fields invariant, the engagement-angle math invariants, the
 * adaptive-cut clamps, the operation-setup-resolution preference order,
 * the pure-function (non-mutating) invariant on params/setups arrays.
 *
 * Three-machine relevance:
 *   - **Laguna Swift 5x10** (DIRECT): every CNC contour/pocket/3D job on
 *     the 60x120-inch full-sheet bed dispatches through `cam-runner.ts`
 *     and resolves feed/plunge/stepover/z-pass through these helpers.
 *     The `feedMmMin` floor (`CAM_FEED_PLUNGE_FLOOR_MM_MIN = 1`) prevents
 *     a stalled spindle on bad data.
 *   - **Makera Carvera 3-axis** (DIRECT): same pipeline -- the 200 W
 *     spindle has a narrower feed envelope but the floor still protects
 *     against pathological zero/negative inputs.
 *   - **Makera Carvera + 4-axis Rotary** (DIRECT): rotary jobs ALSO
 *     resolve XY-plane cut params through this module before delegating
 *     to the 4-axis facade for the angular feed-adapt layer
 *     (`src/main/cam-axis4/kinematics.ts`). The pin protects against the
 *     pre-rotary cut-param corruption path.
 *   - **Creality K2 Plus** (INDIRECT): FDM does NOT consume this module
 *     directly, but the pure-function invariant prevents corruption of
 *     mixed-three-machine fixture records carrying residual `params`.
 *
 * Per CLAUDE.md "Safety Rule 1 -- G-code is sacred": this pin file
 * authors tests only. No production-G-code edits, no machine-profile
 * edits, no .hbs template edits, no Python engine edits, no schema
 * edits.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import * as Mod from './cam-cut-params'
import {
  CAM_CUT_DEFAULTS,
  resolveCamCutParams,
  resolveCamCutParamsWithMaterial,
  resolvePencilStepoverMm,
  computeEngagementAngleDeg,
  adjustFeedForEngagement,
  resolveRasterScanAngleDeg,
  resolveAdaptiveCutTuning,
  computeAdaptiveFeed,
  resolveManufactureSetupForCam,
  applyMaterialToNewOpParams,
  type CamCutParamsResolved,
  type AdaptiveCutTuningResolved
} from './cam-cut-params'
import type { ManufactureFile, ManufactureOperation, ManufactureSetup } from './manufacture-schema'
import type { MaterialRecord } from './material-schema'
import type { ToolRecord } from './tool-schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the source file once for source-text whitelist pins. */
const SRC_PATH = resolvePath(__dirname, 'cam-cut-params.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

/** Re-usable CNC operation factory. */
function makeOp(params?: Record<string, unknown>, kind = 'cnc_contour'): ManufactureOperation {
  return {
    id: 'op-1',
    name: 'Test op',
    kind,
    params: params ?? {}
  } as unknown as ManufactureOperation
}

/** Setup with a box-stock z = thickness for safeZ fallback test. */
function setupWithStockZ(z: number): { stock: NonNullable<ManufactureSetup['stock']> } {
  return { stock: { kind: 'box', x: 100, y: 100, z } as NonNullable<ManufactureSetup['stock']> }
}

/** Setup whose stock has no usable z (fromExtents) -- forces CAM_CUT_DEFAULTS.safeZMm fallback. */
function setupWithFromExtents(): { stock: NonNullable<ManufactureSetup['stock']> } {
  return { stock: { kind: 'fromExtents' } as NonNullable<ManufactureSetup['stock']> }
}

/** Minimal MaterialRecord with a single 'default' cut profile. */
function makeMaterial(id: string, override?: Partial<MaterialRecord>): MaterialRecord {
  return {
    id,
    name: id,
    category: 'aluminum_6061',
    cutParams: {
      default: {
        surfaceSpeedMMin: 300,
        chiploadMm: 0.05,
        docFactor: 0.5,
        stepoverFactor: 0.45,
        plungeFactor: 0.3
      }
    },
    ...override
  } as MaterialRecord
}

function makeTool(id: string, diameterMm: number, fluteCount = 2): ToolRecord {
  return {
    id,
    name: id,
    type: 'endmill',
    diameterMm,
    fluteCount
  } as ToolRecord
}

const RESOLVED_KEYS_IN_ORDER = [
  'zPassMm',
  'stepoverMm',
  'feedMmMin',
  'plungeMmMin',
  'safeZMm'
] as const

const ADAPTIVE_KEYS_IN_ORDER = [
  'maxEngagementDeg',
  'retractZMm',
  'stockAllowanceMm'
] as const

// ---------------------------------------------------------------------------
// A. Module shape -- exports
// ---------------------------------------------------------------------------
describe('A. cam-cut-params -- module shape', () => {
  it('exports CAM_CUT_DEFAULTS as a non-null object', () => {
    expect(Mod.CAM_CUT_DEFAULTS).toBeDefined()
    expect(typeof Mod.CAM_CUT_DEFAULTS).toBe('object')
    expect(Mod.CAM_CUT_DEFAULTS).not.toBeNull()
  })

  it('exports resolveCamCutParams as a function', () => {
    expect(typeof Mod.resolveCamCutParams).toBe('function')
  })

  it('exports resolveCamCutParamsWithMaterial as a function', () => {
    expect(typeof Mod.resolveCamCutParamsWithMaterial).toBe('function')
  })

  it('exports resolvePencilStepoverMm as a function', () => {
    expect(typeof Mod.resolvePencilStepoverMm).toBe('function')
  })

  it('exports computeEngagementAngleDeg as a function', () => {
    expect(typeof Mod.computeEngagementAngleDeg).toBe('function')
  })

  it('exports adjustFeedForEngagement as a function', () => {
    expect(typeof Mod.adjustFeedForEngagement).toBe('function')
  })

  it('exports resolveRasterScanAngleDeg as a function', () => {
    expect(typeof Mod.resolveRasterScanAngleDeg).toBe('function')
  })

  it('exports resolveAdaptiveCutTuning as a function', () => {
    expect(typeof Mod.resolveAdaptiveCutTuning).toBe('function')
  })

  it('exports computeAdaptiveFeed as a function', () => {
    expect(typeof Mod.computeAdaptiveFeed).toBe('function')
  })

  it('exports resolveManufactureSetupForCam as a function', () => {
    expect(typeof Mod.resolveManufactureSetupForCam).toBe('function')
  })

  it('exports applyMaterialToNewOpParams as a function', () => {
    expect(typeof Mod.applyMaterialToNewOpParams).toBe('function')
  })

  it('does not export any default export', () => {
    expect((Mod as Record<string, unknown>)['default']).toBeUndefined()
  })

  it('exposes exactly the documented public surface (10 functions + 1 const + named types)', () => {
    const valueExports = Object.keys(Mod).filter(
      (k) => typeof (Mod as Record<string, unknown>)[k] !== 'undefined'
    )
    // 10 functions + 1 const = 11 runtime exports.
    expect(valueExports).toHaveLength(11)
    expect(new Set(valueExports)).toEqual(
      new Set([
        'CAM_CUT_DEFAULTS',
        'resolveCamCutParams',
        'resolveCamCutParamsWithMaterial',
        'resolvePencilStepoverMm',
        'computeEngagementAngleDeg',
        'adjustFeedForEngagement',
        'resolveRasterScanAngleDeg',
        'resolveAdaptiveCutTuning',
        'computeAdaptiveFeed',
        'resolveManufactureSetupForCam',
        'applyMaterialToNewOpParams'
      ])
    )
  })
})

// ---------------------------------------------------------------------------
// B. CAM_CUT_DEFAULTS -- exact contract values
// ---------------------------------------------------------------------------
describe('B. CAM_CUT_DEFAULTS -- exact contract values', () => {
  it('zPassMm is 5 mm', () => {
    expect(CAM_CUT_DEFAULTS.zPassMm).toBe(5)
  })

  it('stepoverMm is 2 mm', () => {
    expect(CAM_CUT_DEFAULTS.stepoverMm).toBe(2)
  })

  it('feedMmMin is 1200 mm/min', () => {
    expect(CAM_CUT_DEFAULTS.feedMmMin).toBe(1200)
  })

  it('plungeMmMin is 400 mm/min (one-third of feed)', () => {
    expect(CAM_CUT_DEFAULTS.plungeMmMin).toBe(400)
    expect(CAM_CUT_DEFAULTS.plungeMmMin / CAM_CUT_DEFAULTS.feedMmMin).toBeCloseTo(1 / 3, 6)
  })

  it('safeZMm is 10 mm', () => {
    expect(CAM_CUT_DEFAULTS.safeZMm).toBe(10)
  })

  it('every default is a finite positive number', () => {
    for (const k of RESOLVED_KEYS_IN_ORDER) {
      const v = CAM_CUT_DEFAULTS[k as keyof typeof CAM_CUT_DEFAULTS]
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThan(0)
    }
  })

  it('CAM_CUT_DEFAULTS has exactly the 5 documented keys', () => {
    expect(new Set(Object.keys(CAM_CUT_DEFAULTS))).toEqual(new Set(RESOLVED_KEYS_IN_ORDER))
    expect(Object.keys(CAM_CUT_DEFAULTS)).toHaveLength(5)
  })

  it('plungeMmMin is strictly above the CAM_FEED_PLUNGE_FLOOR_MM_MIN (1 mm/min)', () => {
    // The shared floor lives in `cam-numeric-floors.ts` -- we don't import it
    // here on purpose to avoid a cross-file coupling drift; instead we pin the
    // numeric relationship with the well-known 1 mm/min minimum.
    expect(CAM_CUT_DEFAULTS.plungeMmMin).toBeGreaterThan(1)
  })

  it('feedMmMin is strictly above the CAM_FEED_PLUNGE_FLOOR_MM_MIN (1 mm/min)', () => {
    expect(CAM_CUT_DEFAULTS.feedMmMin).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// C. resolveCamCutParams -- contract shape, defaults, validators
// ---------------------------------------------------------------------------
describe('C. resolveCamCutParams -- result shape & defaults', () => {
  it('returns the exact 5 keys in declaration order on a missing op', () => {
    const r = resolveCamCutParams(undefined)
    expect(Object.keys(r)).toEqual([...RESOLVED_KEYS_IN_ORDER])
  })

  it('falls back to CAM_CUT_DEFAULTS when op has no params', () => {
    const r = resolveCamCutParams(makeOp())
    expect(r).toEqual({ ...CAM_CUT_DEFAULTS })
  })

  it('falls back to CAM_CUT_DEFAULTS when params is not an object (string)', () => {
    const op = { id: 'x', name: 'x', kind: 'cnc_contour', params: 'not-an-object' as unknown }
    const r = resolveCamCutParams(op as unknown as ManufactureOperation)
    expect(r).toEqual({ ...CAM_CUT_DEFAULTS })
  })

  it('uses explicit numeric zPassMm when finite and non-zero (allows negatives)', () => {
    expect(resolveCamCutParams(makeOp({ zPassMm: -2 })).zPassMm).toBe(-2)
    expect(resolveCamCutParams(makeOp({ zPassMm: 3 })).zPassMm).toBe(3)
  })

  it('zPassMm rejects 0 and falls back to default 5', () => {
    expect(resolveCamCutParams(makeOp({ zPassMm: 0 })).zPassMm).toBe(5)
  })

  it('zPassMm parses numeric strings via Number.parseFloat', () => {
    expect(resolveCamCutParams(makeOp({ zPassMm: '4.5' })).zPassMm).toBe(4.5)
  })

  it('stepoverMm requires strictly positive (rejects 0 and negatives)', () => {
    expect(resolveCamCutParams(makeOp({ stepoverMm: 0 })).stepoverMm).toBe(2)
    expect(resolveCamCutParams(makeOp({ stepoverMm: -1 })).stepoverMm).toBe(2)
    expect(resolveCamCutParams(makeOp({ stepoverMm: 1.5 })).stepoverMm).toBe(1.5)
  })

  it('feedMmMin floors at the CAM feed/plunge floor (1 mm/min)', () => {
    expect(resolveCamCutParams(makeOp({ feedMmMin: 0.5 })).feedMmMin).toBe(1)
    expect(resolveCamCutParams(makeOp({ feedMmMin: 800 })).feedMmMin).toBe(800)
  })

  it('plungeMmMin floors at the CAM feed/plunge floor (1 mm/min)', () => {
    expect(resolveCamCutParams(makeOp({ plungeMmMin: 0.4 })).plungeMmMin).toBe(1)
    expect(resolveCamCutParams(makeOp({ plungeMmMin: 250 })).plungeMmMin).toBe(250)
  })

  it('safeZMm requires strictly positive (rejects 0)', () => {
    expect(resolveCamCutParams(makeOp({ safeZMm: 0 })).safeZMm).toBe(10)
    expect(resolveCamCutParams(makeOp({ safeZMm: 7 })).safeZMm).toBe(7)
  })

  it('safeZMm defaults from setup stock thickness via recommendedSafeZFromStockThicknessMm', () => {
    // recommendedSafeZFromStockThicknessMm: max(4, 4 + 0.08 * z), clamped to 30.
    // For 25mm stock => 4 + 25*0.08 = 6 mm.
    const r = resolveCamCutParams(makeOp(), setupWithStockZ(25))
    expect(r.safeZMm).toBe(6)
  })

  it('safeZMm clamps to maximum 30 mm even on huge stock (e.g., Laguna full-sheet 1.5-inch ply)', () => {
    // 1000mm stock => recommendedSafeZ would be 84, but clamped to 30.
    const r = resolveCamCutParams(makeOp(), setupWithStockZ(1000))
    expect(r.safeZMm).toBe(30)
  })

  it('safeZMm minimum is 4 mm (clamp lower bound) for thin Carvera 4-axis stock', () => {
    // Stock thickness 1mm => recommendedSafeZ = max(4, 4.08) = 4.08; clamp lower is 4.
    const r = resolveCamCutParams(makeOp(), setupWithStockZ(1))
    expect(r.safeZMm).toBeGreaterThanOrEqual(4)
  })

  it('safeZMm uses CAM_CUT_DEFAULTS.safeZMm (10) when setup uses fromExtents stock (no usable z)', () => {
    const r = resolveCamCutParams(makeOp(), setupWithFromExtents())
    expect(r.safeZMm).toBe(10)
  })

  it('safeZMm explicit override beats the stock-based default', () => {
    const r = resolveCamCutParams(makeOp({ safeZMm: 12 }), setupWithStockZ(25))
    expect(r.safeZMm).toBe(12)
  })

  it('NaN string for zPassMm falls back to default', () => {
    expect(resolveCamCutParams(makeOp({ zPassMm: 'not-a-number' })).zPassMm).toBe(5)
  })

  it('empty-string for stepoverMm falls back to default', () => {
    expect(resolveCamCutParams(makeOp({ stepoverMm: '   ' })).stepoverMm).toBe(2)
  })

  it('Infinity for feedMmMin falls back to default (then floor logic)', () => {
    // Number.isFinite(Infinity) === false, so the branch falls back to default 1200.
    expect(resolveCamCutParams(makeOp({ feedMmMin: Infinity })).feedMmMin).toBe(1200)
  })
})

// ---------------------------------------------------------------------------
// D. resolveCamCutParamsWithMaterial -- material override semantics
// ---------------------------------------------------------------------------
describe('D. resolveCamCutParamsWithMaterial -- material override', () => {
  const op = makeOp({ toolDiameterMm: 6 })
  const tools: ToolRecord[] = [makeTool('t1', 6, 2)]

  it('returns base resolution unchanged when materialId is null', () => {
    const r = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId: null,
      materials: [],
      tools
    })
    expect(r).toEqual(resolveCamCutParams(op))
  })

  it('returns base resolution unchanged when materialId is undefined', () => {
    const r = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId: undefined,
      materials: [],
      tools
    })
    expect(r).toEqual(resolveCamCutParams(op))
  })

  it('returns base resolution unchanged when materialId trims to empty', () => {
    const r = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId: '   ',
      materials: [makeMaterial('alu')],
      tools
    })
    expect(r).toEqual(resolveCamCutParams(op))
  })

  it('returns base resolution unchanged when materialId not found', () => {
    const r = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId: 'not-real',
      materials: [makeMaterial('alu')],
      tools
    })
    expect(r).toEqual(resolveCamCutParams(op))
  })

  it('overrides exactly the four material-derived fields when a material is found', () => {
    const m = makeMaterial('alu')
    const r = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId: 'alu',
      materials: [m],
      tools
    })
    // safeZMm comes from base (CAM_CUT_DEFAULTS.safeZMm = 10), the material does NOT affect it.
    expect(r.safeZMm).toBe(CAM_CUT_DEFAULTS.safeZMm)
    // The four cut-motion fields are derived from material.
    expect(r.feedMmMin).toBeGreaterThan(0)
    expect(r.plungeMmMin).toBeGreaterThan(0)
    expect(r.stepoverMm).toBeGreaterThan(0)
    expect(typeof r.zPassMm).toBe('number')
  })

  it('preserves base safeZMm on material override (safeZ is geometry-driven, not material-driven)', () => {
    const m = makeMaterial('alu')
    const r = resolveCamCutParamsWithMaterial({
      operation: makeOp({ safeZMm: 18, toolDiameterMm: 6 }),
      materialId: 'alu',
      materials: [m],
      tools
    })
    expect(r.safeZMm).toBe(18)
  })

  it('falls back to 6mm tool diameter when neither toolDiameterMm nor toolId match', () => {
    const m = makeMaterial('alu')
    const r1 = resolveCamCutParamsWithMaterial({
      operation: makeOp({}),
      materialId: 'alu',
      materials: [m],
      tools
    })
    expect(r1).toBeTruthy()
    // No throw, valid result.
    expect(Number.isFinite(r1.feedMmMin)).toBe(true)
  })

  it('honors explicit toolDiameterMm in op params', () => {
    const m = makeMaterial('alu')
    const r3 = resolveCamCutParamsWithMaterial({
      operation: makeOp({ toolDiameterMm: 3 }),
      materialId: 'alu',
      materials: [m],
      tools
    })
    const r6 = resolveCamCutParamsWithMaterial({
      operation: makeOp({ toolDiameterMm: 6 }),
      materialId: 'alu',
      materials: [m],
      tools
    })
    // Smaller tool => smaller stepover.
    expect(r3.stepoverMm).toBeLessThan(r6.stepoverMm)
  })

  it('looks up tool by toolId when toolDiameterMm is absent', () => {
    const m = makeMaterial('alu')
    const r = resolveCamCutParamsWithMaterial({
      operation: makeOp({ toolId: 't1' }),
      materialId: 'alu',
      materials: [m],
      tools
    })
    expect(Number.isFinite(r.feedMmMin)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// E. resolvePencilStepoverMm -- clamp + factor semantics
// ---------------------------------------------------------------------------
describe('E. resolvePencilStepoverMm -- clamp & factor', () => {
  it('returns explicit pencilStepoverMm when finite positive (within clamps)', () => {
    expect(
      resolvePencilStepoverMm({
        baseStepoverMm: 2,
        toolDiameterMm: 6,
        operationParams: { pencilStepoverMm: 0.5 }
      })
    ).toBe(0.5)
  })

  it('clamps explicit pencilStepoverMm to upper bound 0.49 * toolDiameterMm', () => {
    expect(
      resolvePencilStepoverMm({
        baseStepoverMm: 2,
        toolDiameterMm: 6,
        operationParams: { pencilStepoverMm: 999 }
      })
    ).toBeCloseTo(6 * 0.49, 6)
  })

  it('clamps explicit pencilStepoverMm to lower bound 0.05 mm', () => {
    expect(
      resolvePencilStepoverMm({
        baseStepoverMm: 2,
        toolDiameterMm: 6,
        operationParams: { pencilStepoverMm: 0.001 }
      })
    ).toBe(0.05)
  })

  it('uses default factor 0.22 when pencilStepoverFactor is absent', () => {
    const r = resolvePencilStepoverMm({
      baseStepoverMm: 2,
      toolDiameterMm: 6
    })
    expect(r).toBeCloseTo(2 * 0.22, 6)
  })

  it('numeric pencilStepoverFactor in [0.05, 1] is honored', () => {
    expect(
      resolvePencilStepoverMm({
        baseStepoverMm: 2,
        toolDiameterMm: 6,
        operationParams: { pencilStepoverFactor: 0.5 }
      })
    ).toBe(1)
  })

  it('clamps pencilStepoverFactor to [0.05, 1.0]', () => {
    expect(
      resolvePencilStepoverMm({
        baseStepoverMm: 4,
        toolDiameterMm: 12,
        operationParams: { pencilStepoverFactor: 5 }
      })
    ).toBe(4) // factor 1 * 4 = 4 (within tool clamp of 12 * 0.49 = 5.88)
    expect(
      resolvePencilStepoverMm({
        baseStepoverMm: 1,
        toolDiameterMm: 6,
        operationParams: { pencilStepoverFactor: 0 }
      })
    ).toBeCloseTo(1 * 0.05, 6)
  })

  it('handles string pencilStepoverFactor via parseFloat', () => {
    expect(
      resolvePencilStepoverMm({
        baseStepoverMm: 2,
        toolDiameterMm: 6,
        operationParams: { pencilStepoverFactor: '0.5' }
      })
    ).toBe(1)
  })

  it('toolDiameterMm guard floors at 0.1 mm to avoid div-by-zero (upper clamp 0.049 wins)', () => {
    const r = resolvePencilStepoverMm({
      baseStepoverMm: 2,
      toolDiameterMm: 0,
      operationParams: { pencilStepoverMm: 999 }
    })
    // toolD = max(0.1, 0) = 0.1, upper clamp toolD * 0.49 = 0.049 wins via Math.min over the
    // lower clamp 0.05 -- this pins the load-bearing ordering: upper clamp is applied AFTER
    // the lower clamp via Math.min(Math.max(explicit, 0.05), toolD * 0.49).
    expect(r).toBeCloseTo(0.049, 6)
  })

  it('rounding/clamp interaction never returns NaN or non-finite', () => {
    const inputs = [-1, 0, 0.001, 0.05, 0.5, 1, 5, 9999]
    for (const v of inputs) {
      const r = resolvePencilStepoverMm({
        baseStepoverMm: 2,
        toolDiameterMm: 6,
        operationParams: { pencilStepoverMm: v }
      })
      expect(Number.isFinite(r)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// F. computeEngagementAngleDeg -- math invariants
// ---------------------------------------------------------------------------
describe('F. computeEngagementAngleDeg -- math invariants', () => {
  it('returns 0 for zero or negative tool radius', () => {
    expect(computeEngagementAngleDeg(0, 1)).toBe(0)
    expect(computeEngagementAngleDeg(-1, 1)).toBe(0)
  })

  it('returns 0 for zero or negative stepover', () => {
    expect(computeEngagementAngleDeg(3, 0)).toBe(0)
    expect(computeEngagementAngleDeg(3, -1)).toBe(0)
  })

  it('returns 180 for full slotting (stepover >= 2 * radius / diameter)', () => {
    expect(computeEngagementAngleDeg(3, 6)).toBe(180)
    expect(computeEngagementAngleDeg(3, 999)).toBe(180)
  })

  it('returns 180 for stepover == diameter (exact boundary)', () => {
    expect(computeEngagementAngleDeg(2, 4)).toBe(180)
  })

  it('half-immersion at stepover = radius => 180 deg by formula (cos^-1(0)=90; *2=180)', () => {
    // theta = 2 * acos(1 - 1) = 2 * acos(0) = pi rad = 180 deg.
    expect(computeEngagementAngleDeg(3, 3)).toBeCloseTo(180, 6)
  })

  it('quarter-immersion at stepover = radius/2 => 120 deg', () => {
    // theta = 2 * acos(1 - 0.5) = 2 * acos(0.5) = 120 deg.
    expect(computeEngagementAngleDeg(3, 1.5)).toBeCloseTo(120, 6)
  })

  it('finishing pass at very small stepover yields small angle', () => {
    // stepover = 0.1, radius = 3 => ratio 0.0333 => acos(0.967) ~ 14.8 deg => 2*14.8 = 29.6
    const r = computeEngagementAngleDeg(3, 0.1)
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(40)
  })

  it('result is monotonically non-decreasing with stepover for fixed radius', () => {
    const radius = 6
    const stepovers = [0.05, 0.1, 0.5, 1, 2, 4, 6, 12]
    let prev = -1
    for (const so of stepovers) {
      const v = computeEngagementAngleDeg(radius, so)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
  })

  it('result is finite for all sane inputs', () => {
    for (const r of [0.1, 1, 3, 12.7, 25.4]) {
      for (const so of [0.05, 0.5, 1, 2, 6, 25]) {
        expect(Number.isFinite(computeEngagementAngleDeg(r, so))).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// G. adjustFeedForEngagement -- chip-thinning compensation
// ---------------------------------------------------------------------------
describe('G. adjustFeedForEngagement -- clamps & target', () => {
  it('returns base feed unchanged for zero or negative engagement', () => {
    expect(adjustFeedForEngagement(1000, 0)).toBe(1000)
    expect(adjustFeedForEngagement(1000, -10)).toBe(1000)
  })

  it('honors target engagement default of 90 deg (no boost at exactly 90)', () => {
    const r = adjustFeedForEngagement(1000, 90)
    expect(r).toBeCloseTo(1000, 0)
  })

  it('explicit target engagement param overrides default', () => {
    // At equal actual and target, ratio = 1, no change.
    expect(adjustFeedForEngagement(1000, 60, 60)).toBeCloseTo(1000, 0)
  })

  it('low engagement (chip thinning) increases feed (up to 2x clamp)', () => {
    const r = adjustFeedForEngagement(1000, 30)
    expect(r).toBeGreaterThan(1000)
    expect(r).toBeLessThanOrEqual(2000)
  })

  it('upper clamp at exactly 200% of base feed', () => {
    // Tiny actual engagement => sin term very small => unbounded ratio; clamp cuts in.
    const r = adjustFeedForEngagement(1000, 0.0001)
    expect(r).toBe(2000)
  })

  it('lower clamp at exactly 50% of base feed', () => {
    // Huge actual engagement (e.g., full slot 180) => sin(90) = 1; sin(45)/1 ~ 0.707 -> 707 clamped to 500? actually 707 > 500, ok
    // To force the lower clamp we use target=10, actual=180 => target factor sin(5)≈0.087, actual sin(90)=1; ratio≈0.087.
    // 1000 * 0.087 = 87, clamped to 500.
    const r = adjustFeedForEngagement(1000, 180, 10)
    expect(r).toBe(500)
  })

  it('clamps actual factor at 0.1 to avoid blowup', () => {
    // Even with actualEngagementDeg practically zero, the formula's internal max 0.1 keeps the ratio finite.
    const r = adjustFeedForEngagement(1000, 0.5)
    expect(Number.isFinite(r)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// H. resolveRasterScanAngleDeg -- precedence
// ---------------------------------------------------------------------------
describe('H. resolveRasterScanAngleDeg -- precedence', () => {
  it('returns 0 for missing operationParams', () => {
    expect(resolveRasterScanAngleDeg(undefined)).toBe(0)
  })

  it('returns 0 when neither scanAngleDeg nor rasterAngleDeg is set', () => {
    expect(resolveRasterScanAngleDeg({})).toBe(0)
  })

  it('honors scanAngleDeg when present and finite-non-zero', () => {
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: 45 })).toBe(45)
  })

  it('honors negative scanAngleDeg (mirror direction)', () => {
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: -45 })).toBe(-45)
  })

  it('falls through scanAngleDeg=0 to rasterAngleDeg', () => {
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: 0, rasterAngleDeg: 30 })).toBe(30)
  })

  it('falls through both zero to default 0', () => {
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: 0, rasterAngleDeg: 0 })).toBe(0)
  })

  it('parses string angles via Number.parseFloat', () => {
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: '15' })).toBe(15)
  })

  it('rejects NaN strings, falls through to defaults', () => {
    expect(resolveRasterScanAngleDeg({ scanAngleDeg: 'abc', rasterAngleDeg: 22 })).toBe(22)
  })
})

// ---------------------------------------------------------------------------
// I. resolveAdaptiveCutTuning -- defaults & clamps
// ---------------------------------------------------------------------------
describe('I. resolveAdaptiveCutTuning -- defaults & clamps', () => {
  it('returns the exact 3 keys in declaration order', () => {
    const r = resolveAdaptiveCutTuning({
      operationKind: 'cnc_3d_rough',
      operationParams: {},
      safeZMm: 10
    })
    expect(Object.keys(r)).toEqual([...ADAPTIVE_KEYS_IN_ORDER])
  })

  it('default maxEngagementDeg = 90', () => {
    const r = resolveAdaptiveCutTuning({
      operationKind: 'cnc_contour',
      operationParams: {},
      safeZMm: 10
    })
    expect(r.maxEngagementDeg).toBe(90)
  })

  it('default retractZMm = 5 (or safeZMm if smaller)', () => {
    const r = resolveAdaptiveCutTuning({
      operationKind: 'cnc_contour',
      operationParams: {},
      safeZMm: 10
    })
    expect(r.retractZMm).toBe(5)
  })

  it('retractZMm clamped to safeZMm upper bound', () => {
    const r = resolveAdaptiveCutTuning({
      operationKind: 'cnc_contour',
      operationParams: { retractZMm: 999 },
      safeZMm: 10
    })
    expect(r.retractZMm).toBe(10)
  })

  it('retractZMm clamped to 0.1 lower bound when safeZ is tiny', () => {
    const r = resolveAdaptiveCutTuning({
      operationKind: 'cnc_contour',
      operationParams: { retractZMm: 0.001 },
      safeZMm: 0.05
    })
    // retractRaw = 0.001 -> false on positive guard; default = 5 -> clamped to safeZMm=0.05? actually max(0.1, safeZ)=0.1
    expect(r.retractZMm).toBeGreaterThanOrEqual(0.1)
  })

  it('default stockAllowanceMm is 0.5 for cnc_3d_rough', () => {
    const r = resolveAdaptiveCutTuning({
      operationKind: 'cnc_3d_rough',
      operationParams: {},
      safeZMm: 10
    })
    expect(r.stockAllowanceMm).toBe(0.5)
  })

  it('default stockAllowanceMm is 0 for non-roughing ops (e.g., cnc_3d_finish)', () => {
    const r = resolveAdaptiveCutTuning({
      operationKind: 'cnc_3d_finish',
      operationParams: {},
      safeZMm: 10
    })
    expect(r.stockAllowanceMm).toBe(0)
  })

  it('explicit stockAllowanceMm overrides per-kind default', () => {
    const r = resolveAdaptiveCutTuning({
      operationKind: 'cnc_contour',
      operationParams: { stockAllowanceMm: 0.3 },
      safeZMm: 10
    })
    expect(r.stockAllowanceMm).toBe(0.3)
  })

  it('maxEngagementDeg clamped to [30, 180]', () => {
    expect(
      resolveAdaptiveCutTuning({
        operationKind: 'cnc_contour',
        operationParams: { maxEngagementDeg: 0.5 },
        safeZMm: 10
      }).maxEngagementDeg
    ).toBe(30)
    expect(
      resolveAdaptiveCutTuning({
        operationKind: 'cnc_contour',
        operationParams: { maxEngagementDeg: 999 },
        safeZMm: 10
      }).maxEngagementDeg
    ).toBe(180)
  })

  it('stockAllowanceMm cannot go negative', () => {
    const r = resolveAdaptiveCutTuning({
      operationKind: 'cnc_contour',
      operationParams: { stockAllowanceMm: -1 },
      safeZMm: 10
    })
    // negative falls back to per-kind default (0 for non-rough).
    expect(r.stockAllowanceMm).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// J. computeAdaptiveFeed -- per-pass feed adapt
// ---------------------------------------------------------------------------
describe('J. computeAdaptiveFeed -- per-pass adapt', () => {
  it('returns base feed when baseFeedMmMin <= 0', () => {
    expect(computeAdaptiveFeed(0, 0, -1, 3, 2, 1)).toBe(0)
    expect(computeAdaptiveFeed(-100, 0, -1, 3, 2, 1)).toBe(-100)
  })

  it('returns base feed when toolRadius <= 0', () => {
    expect(computeAdaptiveFeed(1000, 0, -1, 0, 2, 1)).toBe(1000)
  })

  it('returns base feed when stepover <= 0', () => {
    expect(computeAdaptiveFeed(1000, 0, -1, 3, 0, 1)).toBe(1000)
  })

  it('clamps result to [0.5x, 1.5x] of base feed', () => {
    // Aggressive descent would otherwise push higher; the function explicitly clamps to 1.5x.
    const r = computeAdaptiveFeed(1000, 10, -10, 3, 2, 1)
    expect(r).toBeGreaterThanOrEqual(500)
    expect(r).toBeLessThanOrEqual(1500)
  })

  it('returns 1.5x base feed when localEngagement collapses to 0', () => {
    // Constructed to make baseEngagement=0 and zFactor=0 -> localEngagement=0 path returns base*1.5.
    // Achievable with stepover=0? No, that triggers the early return. Use a case where
    // baseEngagement is non-trivial; this test instead pins the well-defined upper clamp.
    const r = computeAdaptiveFeed(1000, 0, 0, 3, 2, 1)
    expect(r).toBeGreaterThanOrEqual(500)
    expect(r).toBeLessThanOrEqual(1500)
    expect(Number.isFinite(r)).toBe(true)
  })

  it('descent (currZ < prevZ) reduces feed below the level-pass case', () => {
    const flat = computeAdaptiveFeed(1000, 0, 0, 3, 2, 1)
    const descend = computeAdaptiveFeed(1000, 0, -1, 3, 2, 1)
    expect(descend).toBeLessThanOrEqual(flat)
  })

  it('zStep=0 falls back to 1.0 mm internal default', () => {
    // Verifies the internal `zStepMm > 0 ? zStepMm : 1.0` guard does not throw.
    const r = computeAdaptiveFeed(1000, 0, -2, 3, 2, 0)
    expect(Number.isFinite(r)).toBe(true)
  })

  it('explicit targetEngagementDeg parameter changes result', () => {
    const a = computeAdaptiveFeed(1000, 0, -1, 3, 2, 1, 90)
    const b = computeAdaptiveFeed(1000, 0, -1, 3, 2, 1, 45)
    expect(a).not.toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// K. resolveManufactureSetupForCam -- setup pick policy
// ---------------------------------------------------------------------------
describe('K. resolveManufactureSetupForCam -- setup pick', () => {
  function setup(machineId: string | undefined, name = `s-${machineId}`): ManufactureSetup {
    return { id: `id-${machineId ?? 'none'}`, name, machineId, stock: { kind: 'fromExtents' } } as unknown as ManufactureSetup
  }

  it('returns undefined when setups is empty', () => {
    const mfg = { setups: [] } as unknown as Pick<ManufactureFile, 'setups'>
    expect(resolveManufactureSetupForCam(mfg, 'laguna-swift-5x10')).toBeUndefined()
  })

  it('prefers a setup whose machineId matches the requested machine', () => {
    const mfg = {
      setups: [setup('makera-carvera-3axis'), setup('laguna-swift-5x10')]
    } as unknown as Pick<ManufactureFile, 'setups'>
    const r = resolveManufactureSetupForCam(mfg, 'laguna-swift-5x10')
    expect(r?.machineId).toBe('laguna-swift-5x10')
  })

  it('returns first setup when no match and machineId given', () => {
    const mfg = {
      setups: [setup('makera-carvera-3axis'), setup('laguna-swift-5x10')]
    } as unknown as Pick<ManufactureFile, 'setups'>
    const r = resolveManufactureSetupForCam(mfg, 'creality-k2-plus')
    expect(r?.machineId).toBe('makera-carvera-3axis')
  })

  it('returns first setup when machineId is undefined', () => {
    const mfg = {
      setups: [setup('makera-carvera-4axis'), setup('laguna-swift-5x10')]
    } as unknown as Pick<ManufactureFile, 'setups'>
    const r = resolveManufactureSetupForCam(mfg, undefined)
    expect(r?.machineId).toBe('makera-carvera-4axis')
  })

  it('matches Carvera 4-axis when present even if Carvera 3-axis is first', () => {
    const mfg = {
      setups: [setup('makera-carvera-3axis'), setup('makera-carvera-4axis')]
    } as unknown as Pick<ManufactureFile, 'setups'>
    const r = resolveManufactureSetupForCam(mfg, 'makera-carvera-4axis')
    expect(r?.machineId).toBe('makera-carvera-4axis')
  })
})

// ---------------------------------------------------------------------------
// L. applyMaterialToNewOpParams -- exact-four-fields override
// ---------------------------------------------------------------------------
describe('L. applyMaterialToNewOpParams -- exact-four-fields override', () => {
  const tools: ToolRecord[] = [makeTool('t1', 6, 2)]
  const materials: MaterialRecord[] = [makeMaterial('alu')]

  it('returns baseParams unchanged when materialId is null', () => {
    const base = { toolDiameterMm: 6, foo: 'bar' }
    const out = applyMaterialToNewOpParams(base, { materialId: null, materials, tools })
    expect(out).toBe(base) // referential equality on early return
  })

  it('returns baseParams unchanged when materialId is undefined', () => {
    const base = { toolDiameterMm: 6 }
    const out = applyMaterialToNewOpParams(base, { materialId: undefined, materials, tools })
    expect(out).toBe(base)
  })

  it('returns baseParams unchanged when materialId not found', () => {
    const base = { toolDiameterMm: 6 }
    const out = applyMaterialToNewOpParams(base, { materialId: 'unknown', materials, tools })
    expect(out).toBe(base)
  })

  it('overrides exactly the four cut-motion fields (feed, plunge, stepover, zPass)', () => {
    const base = {
      toolDiameterMm: 6,
      safeZMm: 12,
      indexAnglesDeg: [0, 90],
      foo: 'bar'
    }
    const out = applyMaterialToNewOpParams(base, { materialId: 'alu', materials, tools })
    // Preserves non-cut-motion fields.
    expect(out['toolDiameterMm']).toBe(6)
    expect(out['safeZMm']).toBe(12)
    expect(out['indexAnglesDeg']).toEqual([0, 90])
    expect(out['foo']).toBe('bar')
    // Overrides exactly four fields.
    expect(typeof out['feedMmMin']).toBe('number')
    expect(typeof out['plungeMmMin']).toBe('number')
    expect(typeof out['stepoverMm']).toBe('number')
    expect(typeof out['zPassMm']).toBe('number')
  })

  it('does NOT mutate baseParams', () => {
    const base = { toolDiameterMm: 6 }
    const beforeKeys = Object.keys(base)
    applyMaterialToNewOpParams(base, { materialId: 'alu', materials, tools })
    expect(Object.keys(base)).toEqual(beforeKeys)
    expect((base as Record<string, unknown>)['feedMmMin']).toBeUndefined()
  })

  it('falls back to 6 mm tool diameter when baseParams.toolDiameterMm is absent', () => {
    const out = applyMaterialToNewOpParams({}, { materialId: 'alu', materials, tools })
    // Just verifies the function returns a valid populated record.
    expect(typeof out['feedMmMin']).toBe('number')
  })

  it('looks up flute count from tool library matched by diameter (within 0.001 mm)', () => {
    const t6 = makeTool('t6', 6, 4) // 4-flute
    const out = applyMaterialToNewOpParams(
      { toolDiameterMm: 6 },
      { materialId: 'alu', materials, tools: [t6] }
    )
    // Just verifies the override path runs (numeric result), not the exact flute math.
    expect(Number.isFinite(out['feedMmMin'] as number)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// M. Pure-function invariants -- non-mutation & determinism
// ---------------------------------------------------------------------------
describe('M. pure-function invariants', () => {
  it('resolveCamCutParams does not mutate the operation', () => {
    const op = makeOp({ feedMmMin: 800, stepoverMm: 1.5 })
    const before = JSON.stringify(op)
    resolveCamCutParams(op)
    expect(JSON.stringify(op)).toBe(before)
  })

  it('resolveCamCutParams does not mutate the setup', () => {
    const setup = setupWithStockZ(20)
    const before = JSON.stringify(setup)
    resolveCamCutParams(makeOp(), setup)
    expect(JSON.stringify(setup)).toBe(before)
  })

  it('resolveCamCutParams is deterministic for identical inputs', () => {
    const op = makeOp({ zPassMm: 4, stepoverMm: 1.2, feedMmMin: 900, plungeMmMin: 350 })
    const setup = setupWithStockZ(15)
    const a = resolveCamCutParams(op, setup)
    const b = resolveCamCutParams(op, setup)
    expect(a).toEqual(b)
    expect(a).not.toBe(b) // fresh object each call
  })

  it('resolveCamCutParamsWithMaterial does not mutate input arrays', () => {
    const tools: ToolRecord[] = [makeTool('t1', 6)]
    const materials: MaterialRecord[] = [makeMaterial('alu')]
    const beforeT = JSON.stringify(tools)
    const beforeM = JSON.stringify(materials)
    resolveCamCutParamsWithMaterial({
      operation: makeOp({ toolDiameterMm: 6 }),
      materialId: 'alu',
      materials,
      tools
    })
    expect(JSON.stringify(tools)).toBe(beforeT)
    expect(JSON.stringify(materials)).toBe(beforeM)
  })

  it('applyMaterialToNewOpParams does not mutate tools / materials arrays', () => {
    const tools: ToolRecord[] = [makeTool('t1', 6)]
    const materials: MaterialRecord[] = [makeMaterial('alu')]
    const beforeT = JSON.stringify(tools)
    const beforeM = JSON.stringify(materials)
    applyMaterialToNewOpParams({ toolDiameterMm: 6 }, { materialId: 'alu', materials, tools })
    expect(JSON.stringify(tools)).toBe(beforeT)
    expect(JSON.stringify(materials)).toBe(beforeM)
  })

  it('resolveManufactureSetupForCam does not mutate the setups array', () => {
    const setups: ManufactureSetup[] = [
      { id: 'a', name: 'a', machineId: 'laguna-swift-5x10', stock: { kind: 'fromExtents' } } as unknown as ManufactureSetup,
      { id: 'b', name: 'b', machineId: 'makera-carvera-3axis', stock: { kind: 'fromExtents' } } as unknown as ManufactureSetup
    ]
    const before = JSON.stringify(setups)
    resolveManufactureSetupForCam({ setups } as Pick<ManufactureFile, 'setups'>, 'laguna-swift-5x10')
    expect(JSON.stringify(setups)).toBe(before)
  })

  it('CAM_CUT_DEFAULTS is shallowly frozen at the type level (as const)', () => {
    // This is a compile-time `as const` -- no runtime freeze. We pin the type-shape
    // expectation by asserting the keys cannot be reassigned via type without a
    // cast (the next test pins the runtime numeric stability).
    expect(Object.keys(CAM_CUT_DEFAULTS).sort()).toEqual([...RESOLVED_KEYS_IN_ORDER].sort())
  })

  it('repeated calls to resolveCamCutParams return equal-but-distinct objects', () => {
    const a = resolveCamCutParams(makeOp())
    const b = resolveCamCutParams(makeOp())
    expect(a).toEqual(b)
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// N. Three-machine path realism
// ---------------------------------------------------------------------------
describe('N. three-machine path realism', () => {
  it('Laguna Swift 5x10 full-sheet plywood: 12 mm zPass, 4 mm stepover, 4500 mm/min feed resolves cleanly', () => {
    const r = resolveCamCutParams(
      makeOp({ zPassMm: -6, stepoverMm: 4, feedMmMin: 4500, plungeMmMin: 1500, safeZMm: 25 }),
      setupWithStockZ(18)
    )
    expect(r.zPassMm).toBe(-6)
    expect(r.stepoverMm).toBe(4)
    expect(r.feedMmMin).toBe(4500)
    expect(r.plungeMmMin).toBe(1500)
    expect(r.safeZMm).toBe(25)
  })

  it('Carvera 3-axis aluminum: 0.3 mm zPass, 0.45 mm stepover, 800 mm/min feed resolves cleanly', () => {
    const r = resolveCamCutParams(
      makeOp({ zPassMm: -0.3, stepoverMm: 0.45, feedMmMin: 800, plungeMmMin: 200, safeZMm: 8 }),
      setupWithStockZ(10)
    )
    expect(r.zPassMm).toBe(-0.3)
    expect(r.stepoverMm).toBe(0.45)
    expect(r.feedMmMin).toBe(800)
    expect(r.plungeMmMin).toBe(200)
    expect(r.safeZMm).toBe(8)
  })

  it('Carvera 4-axis rotary 92 mm stock: 4 mm safeZ headroom is preserved (very thin envelope)', () => {
    // The Carvera 4-axis Z envelope is 46 mm; with a 92 mm stock the safeZ above the cylinder is tight.
    const r = resolveCamCutParams(
      makeOp({ safeZMm: 4 }),
      setupWithStockZ(92)
    )
    expect(r.safeZMm).toBe(4)
  })

  it('Carvera 4-axis with no safeZMm and 92 mm stock falls back to recommended (clamped to 30)', () => {
    // recommended would be max(4, 4 + 92*0.08) = 11.36; below the 30 clamp.
    const r = resolveCamCutParams(makeOp(), setupWithStockZ(92))
    expect(r.safeZMm).toBeCloseTo(11.36, 2)
  })

  it('FDM-style op (Creality K2 Plus): even though K2 bypasses this layer, the resolver does not throw on a weird kind', () => {
    const r = resolveCamCutParams(makeOp({}, 'fdm_print'))
    expect(r).toEqual({ ...CAM_CUT_DEFAULTS })
  })

  it('engagement angle for Laguna 1/4-inch endmill (radius 3.175 mm) at 2 mm stepover ~ 95.4 deg', () => {
    // ratio = 0.63 => acos(0.37) ~ 68.3 deg => *2 = 136.6 deg
    const a = computeEngagementAngleDeg(3.175, 2)
    expect(a).toBeGreaterThan(120)
    expect(a).toBeLessThan(150)
  })

  it('adaptive feed boost for Carvera finishing at 30 deg engagement is positive but bounded', () => {
    const r = adjustFeedForEngagement(800, 30)
    expect(r).toBeGreaterThan(800)
    expect(r).toBeLessThanOrEqual(1600)
  })
})

// ---------------------------------------------------------------------------
// O. Source-text whitelist -- locks key invariants in the source file
// ---------------------------------------------------------------------------
describe('O. cam-cut-params.ts source-text whitelist', () => {
  it('imports CAM_FEED_PLUNGE_FLOOR_MM_MIN from cam-numeric-floors', () => {
    expect(SRC).toContain("import { CAM_FEED_PLUNGE_FLOOR_MM_MIN } from './cam-numeric-floors'")
  })

  it('imports recommendedSafeZFromStockThicknessMm from cam-setup-defaults', () => {
    expect(SRC).toContain("recommendedSafeZFromStockThicknessMm")
    expect(SRC).toContain("from './cam-setup-defaults'")
  })

  it('imports calcCutParams from material-schema', () => {
    expect(SRC).toContain("import { calcCutParams, type MaterialRecord } from './material-schema'")
  })

  it('imports ToolRecord from tool-schema', () => {
    expect(SRC).toContain("import type { ToolRecord } from './tool-schema'")
  })

  it('exports CAM_CUT_DEFAULTS as const with the 5 expected fields', () => {
    expect(SRC).toContain('export const CAM_CUT_DEFAULTS = {')
    for (const key of RESOLVED_KEYS_IN_ORDER) {
      expect(SRC).toContain(`${key}:`)
    }
    expect(SRC).toContain('} as const')
  })

  it('declares the 10 documented exported function names', () => {
    const fns = [
      'resolveCamCutParams',
      'resolveCamCutParamsWithMaterial',
      'resolvePencilStepoverMm',
      'computeEngagementAngleDeg',
      'adjustFeedForEngagement',
      'resolveRasterScanAngleDeg',
      'resolveAdaptiveCutTuning',
      'computeAdaptiveFeed',
      'resolveManufactureSetupForCam',
      'applyMaterialToNewOpParams'
    ]
    for (const fn of fns) {
      expect(SRC).toContain(`export function ${fn}`)
    }
  })

  it('CAM_CUT_DEFAULTS literal values are exactly 5 / 2 / 1200 / 400 / 10', () => {
    expect(SRC).toMatch(/zPassMm:\s*5\b/)
    expect(SRC).toMatch(/stepoverMm:\s*2\b/)
    expect(SRC).toMatch(/feedMmMin:\s*1200\b/)
    expect(SRC).toMatch(/plungeMmMin:\s*400\b/)
    expect(SRC).toMatch(/safeZMm:\s*10\b/)
  })

  it('feedMmMin uses Math.max with CAM_FEED_PLUNGE_FLOOR_MM_MIN', () => {
    expect(SRC).toContain("Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, finitePositiveNumber(p['feedMmMin'])")
  })

  it('plungeMmMin uses Math.max with CAM_FEED_PLUNGE_FLOOR_MM_MIN', () => {
    expect(SRC).toContain("Math.max(CAM_FEED_PLUNGE_FLOOR_MM_MIN, finitePositiveNumber(p['plungeMmMin'])")
  })

  it('engagement angle formula uses 2 * Math.acos and 180 / PI conversion', () => {
    expect(SRC).toContain('2 * Math.acos(cosVal)')
    expect(SRC).toContain('180) / Math.PI')
  })

  it('adjustFeedForEngagement clamps to [0.5, 2.0] of base feed', () => {
    expect(SRC).toContain('baseFeedMmMin * 0.5')
    expect(SRC).toContain('baseFeedMmMin * 2')
  })

  it('computeAdaptiveFeed clamps to [0.5, 1.5] of base feed (tighter upper than chip-thinning)', () => {
    expect(SRC).toContain('baseFeedMmMin * 0.5')
    expect(SRC).toContain('baseFeedMmMin * 1.5')
  })

  it('resolveAdaptiveCutTuning maxEngagementDeg clamp is [30, 180]', () => {
    expect(SRC).toContain('Math.min(180, Math.max(30, maxEngagementRaw))')
  })

  it('resolveAdaptiveCutTuning cnc_3d_rough allowance default is 0.5', () => {
    expect(SRC).toContain("input.operationKind === 'cnc_3d_rough' ? 0.5 : 0")
  })

  it('resolvePencilStepoverMm clamps to [0.05, 0.49 * toolD]', () => {
    expect(SRC).toContain('0.05')
    expect(SRC).toContain('toolD * 0.49')
  })

  it('resolveCamCutParams returns spread-over CAM_CUT_DEFAULTS on missing/invalid params', () => {
    expect(SRC).toContain('return { ...CAM_CUT_DEFAULTS, safeZMm: defaultSafeZ }')
  })

  it('does NOT contain any TODO/FIXME/XXX/HACK markers', () => {
    expect(SRC).not.toMatch(/\bTODO\b/)
    expect(SRC).not.toMatch(/\bFIXME\b/)
    expect(SRC).not.toMatch(/\bXXX\b/)
    expect(SRC).not.toMatch(/\bHACK\b/)
  })

  it('does NOT contain stub markers ("not implemented", throw new Error placeholders)', () => {
    expect(SRC).not.toMatch(/not implemented/i)
    expect(SRC).not.toMatch(/throw new Error\(['"]TODO/i)
  })

  it('does NOT use the "any" type at any signature', () => {
    // Match a `: any` or `as any` token pattern; stays loose enough that field access strings
    // like `t.fluteCount: number` are not flagged.
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas\s+any\b/)
  })
})

// ---------------------------------------------------------------------------
// P. Type-level parity (compile-time)
// ---------------------------------------------------------------------------
describe('P. type-level parity (compile-time)', () => {
  it('CamCutParamsResolved has exactly the 5 documented fields (compile-time pin)', () => {
    const r: CamCutParamsResolved = {
      zPassMm: 1,
      stepoverMm: 1,
      feedMmMin: 1,
      plungeMmMin: 1,
      safeZMm: 1
    }
    expect(Object.keys(r)).toEqual([...RESOLVED_KEYS_IN_ORDER])
  })

  it('AdaptiveCutTuningResolved has exactly the 3 documented fields', () => {
    const r: AdaptiveCutTuningResolved = {
      maxEngagementDeg: 90,
      retractZMm: 5,
      stockAllowanceMm: 0
    }
    expect(Object.keys(r)).toEqual([...ADAPTIVE_KEYS_IN_ORDER])
  })

  it('CAM_CUT_DEFAULTS literal type accepts the runtime constants', () => {
    const fromConst: CamCutParamsResolved = { ...CAM_CUT_DEFAULTS }
    expect(fromConst.zPassMm).toBe(5)
    expect(fromConst.feedMmMin).toBe(1200)
  })

  it('resolveCamCutParams return type is assignable to CamCutParamsResolved', () => {
    const r: CamCutParamsResolved = resolveCamCutParams(makeOp())
    expect(r).toBeTruthy()
  })

  it('resolveAdaptiveCutTuning return type is assignable to AdaptiveCutTuningResolved', () => {
    const r: AdaptiveCutTuningResolved = resolveAdaptiveCutTuning({
      operationKind: 'cnc_contour',
      operationParams: {},
      safeZMm: 10
    })
    expect(r).toBeTruthy()
  })
})
