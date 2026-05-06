/**
 * Paired-pin contract for `src/main/cam-axis4/runner-shims.ts`
 * -- the 99-line MAIN-process bridge module that exposes two pure
 * helpers used by `cam-axis4/index.ts` to avoid a circular import with
 * `cam-runner.ts`:
 *
 * - `manufactureKindUses4AxisEngine(kind)` -- exact 5-string allowlist
 *   that gates whether a manufacture op routes to the 4-axis TS engine.
 *   Mirror of `isManufactureKind4AxisForPreview` in
 *   `src/shared/cam-gcode-toolpath.ts` -- the two MUST stay in lockstep
 *   (same 5 strings) or jobs that preview as 4-axis but route to the
 *   3-axis runner (or vice versa) will silently produce wrong output.
 *
 * - `extractPostProcessingOpts(params)` -- defensive extractor that pulls
 *   the subset of `renderPost` opts (arc fitting, cutter compensation,
 *   subroutines, line numbering, inverse-time feed, dust collection)
 *   from the user-controlled params record. Strict-true gates so falsey
 *   / undefined / non-bool params return a clean empty/partial shape.
 *
 * Three-machine impact: DIRECT cross-cut.
 * - Carvera 4-axis Rotary: `manufactureKindUses4AxisEngine` is the gate
 *   that routes all 5 4-axis kinds (roughing/finishing/contour/indexed/
 *   continuous) to the cam-axis4 TS engine. CLAUDE.md mandates this is
 *   one of the three target machines.
 * - Laguna Swift 5x10: `extractPostProcessingOpts` carries the
 *   `dustCollection` flag added in [ID-0064] specifically so the
 *   `vcarve_mach3.hbs` RichAuto post can emit `M7` / `M9` for the
 *   6-zone vacuum / dust-collection setup.
 * - Creality K2 Plus: extractPostProcessingOpts is the cutter-
 *   compensation / inverse-time / line-numbering passthrough surface
 *   that the FDM pipeline does NOT use (FDM has no compensation), so a
 *   regression that defaulted any of these to true would corrupt the
 *   K2 Plus slicer-engine path.
 *
 * This pin co-locates with `__tests__/runner-shims-contract.test.ts`
 * (older pre-co-location-convention contract test). The pin focuses on
 * the export surface, the 5-string allowlist, the strict-true gate
 * invariants, and the source-text whitelist.
 *
 * Roadmap ID: [ID-0301] / Cycle 228 (cam-engine rotation slot).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './runner-shims'
import {
  extractPostProcessingOpts,
  manufactureKindUses4AxisEngine
} from './runner-shims'

const SOURCE_PATH = resolve(__dirname, 'runner-shims.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// A. Module shape -- exact runtime surface
// ---------------------------------------------------------------------------
describe('A. Module shape -- src/main/cam-axis4/runner-shims.ts', () => {
  it('exports exactly the 2-symbol runtime public surface (sorted)', () => {
    expect(Object.keys(M).sort()).toEqual([
      'extractPostProcessingOpts',
      'manufactureKindUses4AxisEngine'
    ])
  })

  it('both exports classify as `function`', () => {
    expect(typeof manufactureKindUses4AxisEngine).toBe('function')
    expect(typeof extractPostProcessingOpts).toBe('function')
  })

  it('both are synchronous (no AsyncFunction)', () => {
    expect(manufactureKindUses4AxisEngine.constructor.name).toBe('Function')
    expect(extractPostProcessingOpts.constructor.name).toBe('Function')
  })

  it('arities match documented signatures', () => {
    expect(manufactureKindUses4AxisEngine.length).toBe(1)
    expect(extractPostProcessingOpts.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// B. manufactureKindUses4AxisEngine -- exact 5-string allowlist
// ---------------------------------------------------------------------------
describe('B. manufactureKindUses4AxisEngine 5-string allowlist', () => {
  const ACCEPTED = [
    'cnc_4axis_roughing',
    'cnc_4axis_finishing',
    'cnc_4axis_contour',
    'cnc_4axis_indexed',
    'cnc_4axis_continuous'
  ] as const

  it('accepts exactly the 5 Carvera 4-axis Rotary kinds (CLAUDE.md spec)', () => {
    for (const k of ACCEPTED) {
      expect(manufactureKindUses4AxisEngine(k)).toBe(true)
    }
  })

  it('rejects undefined / empty / unknown / non-4-axis CNC kinds', () => {
    const REJECTED = [
      undefined, '', 'cnc_parallel', 'cnc_adaptive', 'cnc_raster',
      'cnc_5axis_contour', 'cnc_5axis_swarf', 'cnc_5axis_flowline',
      'fdm_slice', 'export_stl'
    ]
    for (const k of REJECTED) {
      expect(manufactureKindUses4AxisEngine(k)).toBe(false)
    }
  })

  it('is case-sensitive (uppercase rejected even though kind is otherwise valid)', () => {
    expect(manufactureKindUses4AxisEngine('CNC_4AXIS_ROUGHING')).toBe(false)
    expect(manufactureKindUses4AxisEngine('Cnc_4Axis_Roughing')).toBe(false)
  })

  it('always returns boolean (never null/undefined)', () => {
    const probes: Array<string | undefined> = [undefined, '', 'cnc_4axis_roughing', 'unknown']
    for (const k of probes) {
      expect(typeof manufactureKindUses4AxisEngine(k)).toBe('boolean')
    }
  })
})

// ---------------------------------------------------------------------------
// C. extractPostProcessingOpts -- empty / undefined inputs
// ---------------------------------------------------------------------------
describe('C. extractPostProcessingOpts empty inputs', () => {
  it('undefined params -> empty object', () => {
    expect(extractPostProcessingOpts(undefined)).toEqual({})
  })

  it('empty params -> empty object', () => {
    expect(extractPostProcessingOpts({})).toEqual({})
  })

  it('returns a fresh object on every call (not aliased)', () => {
    const a = extractPostProcessingOpts(undefined)
    const b = extractPostProcessingOpts(undefined)
    expect(a).not.toBe(b)
  })

  it('does NOT mutate the input params record', () => {
    const params = { enableArcFitting: true, arcTolerance: 0.01 }
    const before = JSON.stringify(params)
    extractPostProcessingOpts(params)
    expect(JSON.stringify(params)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// D. Arc-fitting gate (strict-true; arcTolerance > 0)
// ---------------------------------------------------------------------------
describe('D. arc-fitting gate', () => {
  it('enableArcFitting === true -> sets enableArcFitting to true', () => {
    expect(extractPostProcessingOpts({ enableArcFitting: true }).enableArcFitting).toBe(true)
  })

  it('enableArcFitting === false / 1 / "true" / undefined -> not set', () => {
    expect(extractPostProcessingOpts({ enableArcFitting: false }).enableArcFitting).toBeUndefined()
    expect(extractPostProcessingOpts({ enableArcFitting: 1 }).enableArcFitting).toBeUndefined()
    expect(extractPostProcessingOpts({ enableArcFitting: 'true' }).enableArcFitting).toBeUndefined()
  })

  it('arcTolerance only carries when enableArcFitting is true AND tolerance > 0', () => {
    expect(extractPostProcessingOpts({ enableArcFitting: true, arcTolerance: 0.01 }).arcTolerance).toBe(0.01)
    expect(extractPostProcessingOpts({ enableArcFitting: true, arcTolerance: 0 }).arcTolerance).toBeUndefined()
    expect(extractPostProcessingOpts({ enableArcFitting: true, arcTolerance: -1 }).arcTolerance).toBeUndefined()
  })

  it('arcTolerance is dropped when enableArcFitting is NOT strict-true', () => {
    expect(extractPostProcessingOpts({ enableArcFitting: false, arcTolerance: 0.01 }).arcTolerance).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// E. Cutter compensation gate ('left' | 'right' literal allowlist)
// ---------------------------------------------------------------------------
describe('E. cutter compensation gate', () => {
  it("cutterCompensation 'left' / 'right' -> set", () => {
    expect(extractPostProcessingOpts({ cutterCompensation: 'left' }).cutterCompensation).toBe('left')
    expect(extractPostProcessingOpts({ cutterCompensation: 'right' }).cutterCompensation).toBe('right')
  })

  it("cutterCompensation 'none' / 'LEFT' / unknown -> not set", () => {
    expect(extractPostProcessingOpts({ cutterCompensation: 'none' }).cutterCompensation).toBeUndefined()
    expect(extractPostProcessingOpts({ cutterCompensation: 'LEFT' }).cutterCompensation).toBeUndefined()
    expect(extractPostProcessingOpts({ cutterCompensation: 'mid' }).cutterCompensation).toBeUndefined()
  })

  it('cutterCompDRegister carries only when cutterCompensation is left/right AND register >= 1', () => {
    expect(extractPostProcessingOpts({ cutterCompensation: 'left', cutterCompDRegister: 7 }).cutterCompDRegister).toBe(7)
    expect(extractPostProcessingOpts({ cutterCompensation: 'left', cutterCompDRegister: 0 }).cutterCompDRegister).toBeUndefined()
    expect(extractPostProcessingOpts({ cutterCompensation: 'right', cutterCompDRegister: 1 }).cutterCompDRegister).toBe(1)
  })

  it('cutterCompDRegister is dropped when cutterCompensation is NOT left/right', () => {
    expect(extractPostProcessingOpts({ cutterCompensation: 'none', cutterCompDRegister: 7 }).cutterCompDRegister).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// F. Subroutines gate (dialect default = 'fanuc'; allowlist fanuc/siemens/mach3)
// ---------------------------------------------------------------------------
describe('F. subroutines gate', () => {
  it('enableSubroutines === true with fanuc/siemens/mach3 dialect -> set', () => {
    expect(extractPostProcessingOpts({ enableSubroutines: true, subroutineDialect: 'fanuc' }).subroutineDialect).toBe('fanuc')
    expect(extractPostProcessingOpts({ enableSubroutines: true, subroutineDialect: 'siemens' }).subroutineDialect).toBe('siemens')
    expect(extractPostProcessingOpts({ enableSubroutines: true, subroutineDialect: 'mach3' }).subroutineDialect).toBe('mach3')
  })

  it('enableSubroutines === true with no dialect / unknown dialect -> defaults to fanuc', () => {
    expect(extractPostProcessingOpts({ enableSubroutines: true }).subroutineDialect).toBe('fanuc')
    expect(extractPostProcessingOpts({ enableSubroutines: true, subroutineDialect: 'klipper' }).subroutineDialect).toBe('fanuc')
  })

  it('enableSubroutines !== true -> NEITHER enableSubroutines NOR dialect set', () => {
    const out = extractPostProcessingOpts({ subroutineDialect: 'fanuc' })
    expect(out.enableSubroutines).toBeUndefined()
    expect(out.subroutineDialect).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// G. Line numbering gate (default start=10, increment=10)
// ---------------------------------------------------------------------------
describe('G. line numbering gate', () => {
  it('lineNumberingEnabled === true with custom start/increment -> set', () => {
    const out = extractPostProcessingOpts({
      lineNumberingEnabled: true,
      lineNumberingStart: 100,
      lineNumberingIncrement: 5
    })
    expect(out.lineNumbering).toEqual({ enabled: true, start: 100, increment: 5 })
  })

  it('lineNumberingEnabled === true with no start/increment -> defaults to 10/10', () => {
    expect(extractPostProcessingOpts({ lineNumberingEnabled: true }).lineNumbering).toEqual({
      enabled: true, start: 10, increment: 10
    })
  })

  it('lineNumberingEnabled !== true -> lineNumbering NOT set', () => {
    expect(extractPostProcessingOpts({}).lineNumbering).toBeUndefined()
    expect(extractPostProcessingOpts({ lineNumberingEnabled: false }).lineNumbering).toBeUndefined()
    expect(extractPostProcessingOpts({ lineNumberingStart: 50 }).lineNumbering).toBeUndefined()
  })

  it('non-numeric lineNumberingStart / Increment falls back to 10', () => {
    const out = extractPostProcessingOpts({
      lineNumberingEnabled: true,
      lineNumberingStart: 'fifty',
      lineNumberingIncrement: null
    })
    expect(out.lineNumbering).toEqual({ enabled: true, start: 10, increment: 10 })
  })
})

// ---------------------------------------------------------------------------
// H. Inverse-time feed + dust collection (strict-true)
// ---------------------------------------------------------------------------
describe('H. inverseTimeFeed + dustCollection strict-true', () => {
  it('inverseTimeFeed === true -> set', () => {
    expect(extractPostProcessingOpts({ inverseTimeFeed: true }).inverseTimeFeed).toBe(true)
  })

  it('inverseTimeFeed !== true -> NOT set', () => {
    expect(extractPostProcessingOpts({ inverseTimeFeed: false }).inverseTimeFeed).toBeUndefined()
    expect(extractPostProcessingOpts({ inverseTimeFeed: 1 }).inverseTimeFeed).toBeUndefined()
    expect(extractPostProcessingOpts({}).inverseTimeFeed).toBeUndefined()
  })

  it('[ID-0064] dustCollection === true -> set (Laguna 5x10 M7/M9 path)', () => {
    expect(extractPostProcessingOpts({ dustCollection: true }).dustCollection).toBe(true)
  })

  it('dustCollection !== true -> NOT set (post-template default reminder stays)', () => {
    expect(extractPostProcessingOpts({ dustCollection: false }).dustCollection).toBeUndefined()
    expect(extractPostProcessingOpts({ dustCollection: 1 }).dustCollection).toBeUndefined()
    expect(extractPostProcessingOpts({ dustCollection: 'on' }).dustCollection).toBeUndefined()
    expect(extractPostProcessingOpts({}).dustCollection).toBeUndefined()
  })

  it('[ID-0015] enableSimultaneous4Axis === true -> set (Carvera 4-axis simultaneous opt-in)', () => {
    expect(
      extractPostProcessingOpts({ enableSimultaneous4Axis: true }).enableSimultaneous4Axis
    ).toBe(true)
  })

  it('[ID-0015] enableSimultaneous4Axis !== true -> NOT set (default-off byte-identity)', () => {
    expect(
      extractPostProcessingOpts({ enableSimultaneous4Axis: false }).enableSimultaneous4Axis
    ).toBeUndefined()
    expect(
      extractPostProcessingOpts({ enableSimultaneous4Axis: 1 }).enableSimultaneous4Axis
    ).toBeUndefined()
    expect(
      extractPostProcessingOpts({ enableSimultaneous4Axis: 'true' }).enableSimultaneous4Axis
    ).toBeUndefined()
    expect(extractPostProcessingOpts({}).enableSimultaneous4Axis).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// I. Source-text whitelist
// ---------------------------------------------------------------------------
describe('I. Source-text whitelist for runner-shims.ts', () => {
  it('imports types only from ../post-process (no runtime import to avoid cycle)', () => {
    expect(SOURCE).toMatch(/import\s+type\s+\{\s*SubroutineDialect,\s*LineNumberingConfig\s*\}\s+from\s+['"]\.\.\/post-process['"]/)
    // No direct runtime import that would create the circular dependency mentioned in the doc
    expect(SOURCE).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+['"]\.\.\/cam-runner['"]/m)
  })

  it('manufactureKindUses4AxisEngine lists exactly the 5 Carvera 4-axis kinds in source text', () => {
    expect(SOURCE).toContain("kind === 'cnc_4axis_roughing'")
    expect(SOURCE).toContain("kind === 'cnc_4axis_finishing'")
    expect(SOURCE).toContain("kind === 'cnc_4axis_contour'")
    expect(SOURCE).toContain("kind === 'cnc_4axis_indexed'")
    expect(SOURCE).toContain("kind === 'cnc_4axis_continuous'")
  })

  it('the dustCollection [ID-0064] gate is present and strict-true (=== true)', () => {
    expect(SOURCE).toContain('// [ID-0064] dust collection:')
    expect(SOURCE).toContain("params['dustCollection'] === true")
  })

  it('inverseTimeFeed strict-true gate', () => {
    expect(SOURCE).toContain("params['inverseTimeFeed'] === true")
  })

  it('[ID-0015] enableSimultaneous4Axis strict-true gate', () => {
    expect(SOURCE).toContain("params['enableSimultaneous4Axis'] === true")
  })

  it('subroutine dialect allowlist contains exactly fanuc/siemens/mach3', () => {
    expect(SOURCE).toContain("dialect === 'fanuc' || dialect === 'siemens' || dialect === 'mach3'")
  })

  it('line numbering defaults to start=10, increment=10', () => {
    expect(SOURCE).toContain(': 10')
    // The default is applied via ternary, so the literal 10 is the fallback in two places.
    const tenMatches = SOURCE.match(/\b10\b/g) ?? []
    expect(tenMatches.length).toBeGreaterThanOrEqual(2)
  })

  it('cutter comp register lower bound is 1 (D registers are 1-indexed)', () => {
    expect(SOURCE).toContain(">= 1")
  })

  it('zero `any` types', () => {
    expect(SOURCE).not.toMatch(/:\s*any\b/)
    expect(SOURCE).not.toMatch(/\bas\s+any\b/)
  })

  it('no eval / new Function escape hatches', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/new\s+Function\s*\(/)
  })

  it('declares both runtime exports with `export function`', () => {
    const funcExports = SOURCE.match(/^export\s+function\s+\w+/gm) ?? []
    expect(funcExports.length).toBe(2)
  })

  it('no node:fs / node:path / node:child_process imports (pure helper)', () => {
    expect(SOURCE).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:path['"]/)
    expect(SOURCE).not.toMatch(/from\s+['"]node:child_process['"]/)
  })

  it('docstring documents the [ID-0064] dust-collection cross-cut to Laguna Swift 5x10', () => {
    expect(SOURCE).toContain('Laguna Swift 5x10')
    expect(SOURCE).toContain('vcarve_mach3.hbs')
    expect(SOURCE).toContain('M7')
    expect(SOURCE).toContain('M9')
  })
})

// ---------------------------------------------------------------------------
// J. Three-machine cross-cut realism
// ---------------------------------------------------------------------------
describe('J. Three-machine cross-cut realism', () => {
  it('Carvera 4-axis Rotary: all 5 kinds route to the 4-axis engine', () => {
    // CLAUDE.md: Makera Carvera + 4th Axis Rotary runs roughing/finishing/contour/indexed/continuous.
    expect(manufactureKindUses4AxisEngine('cnc_4axis_roughing')).toBe(true)
    expect(manufactureKindUses4AxisEngine('cnc_4axis_finishing')).toBe(true)
    expect(manufactureKindUses4AxisEngine('cnc_4axis_contour')).toBe(true)
    expect(manufactureKindUses4AxisEngine('cnc_4axis_indexed')).toBe(true)
    expect(manufactureKindUses4AxisEngine('cnc_4axis_continuous')).toBe(true)
  })

  it('Laguna Swift 5x10: dustCollection === true is the M7/M9 emit gate', () => {
    // CLAUDE.md: Laguna Swift has T-slot or vacuum-ready (6-zone typical) + dust-collection M-codes.
    // The post template emits M7 (dust ON) after spindle warm-up only when dustCollection === true.
    const out = extractPostProcessingOpts({ dustCollection: true })
    expect(out.dustCollection).toBe(true)
    // Defaulted behavior: no dust-collection -> post template's commented reminder stays in play.
    expect(extractPostProcessingOpts({}).dustCollection).toBeUndefined()
  })

  it('Creality K2 Plus: FDM kinds do NOT route to the 4-axis engine', () => {
    // K2 Plus runs FDM jobs; never 4-axis CNC.
    expect(manufactureKindUses4AxisEngine('fdm_slice')).toBe(false)
  })

  it('5-axis kinds (reserved) do NOT route to the 4-axis engine', () => {
    // 5-axis is reserved for future hardware -- no current shop machine.
    expect(manufactureKindUses4AxisEngine('cnc_5axis_contour')).toBe(false)
    expect(manufactureKindUses4AxisEngine('cnc_5axis_swarf')).toBe(false)
    expect(manufactureKindUses4AxisEngine('cnc_5axis_flowline')).toBe(false)
  })

  it('lockstep parity with cam-gcode-toolpath isManufactureKind4AxisForPreview (same 5 strings)', async () => {
    // Both predicates must accept the same 5 strings or jobs preview vs run mismatch.
    const preview = await import('../../shared/cam-gcode-toolpath')
    const ACCEPTED = [
      'cnc_4axis_roughing',
      'cnc_4axis_finishing',
      'cnc_4axis_contour',
      'cnc_4axis_indexed',
      'cnc_4axis_continuous'
    ]
    for (const k of ACCEPTED) {
      expect(manufactureKindUses4AxisEngine(k)).toBe(true)
      expect(preview.isManufactureKind4AxisForPreview(k)).toBe(true)
    }
    // And both reject these
    for (const k of ['fdm_slice', 'cnc_5axis_contour', '']) {
      expect(manufactureKindUses4AxisEngine(k)).toBe(false)
      expect(preview.isManufactureKind4AxisForPreview(k)).toBe(false)
    }
  })
})
