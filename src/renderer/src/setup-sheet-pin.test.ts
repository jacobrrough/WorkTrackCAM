/**
 * Cycle 140 ui-polish co-located paired-pin contract for
 * `src/renderer/src/setup-sheet.ts` (HTML Setup Sheet generator).
 *
 * Mirrors the post-Cycle-127-reset paired-pin chain pattern established by
 * Cycles 119/124/129/130/131/132/134/135/136/137/139:
 *   - module shape (named-export whitelist, arities, ESM Symbol-key invariant,
 *     null-prototype check)
 *   - per-helper purity & freshness (no input mutation, fresh-output-per-call,
 *     N=10 determinism, frozen-input safety)
 *   - per-helper behavioural anchors (regex-driven branch points the existing
 *     `setup-sheet.test.ts` does not pin: feed-rate default, comment-strip
 *     ordering, escape-html character coverage, conditional-section toggles,
 *     em-dash usage, hardcoded-default literals)
 *   - source-text whitelist (provenance, the three target machines from
 *     CLAUDE.md, regex literal bytes, no React / DOM / electron / fs imports,
 *     zero `any`, hardcoded literal pins for the 100/100/20 default stock and
 *     5/0 rotary chuck/clamp constants)
 *
 * Three-machine impact (CLAUDE.md "USER CONTEXT -- TARGET MACHINES"):
 *   1. Creality K2 Plus (FDM, Klipper/Moonraker) -- the setup sheet renders
 *      FDM jobs with `kind: 'fdm'` machines; FDM G-code never goes below Z=0
 *      so `cuttingMoves` stays at zero (already pinned by the existing test).
 *   2. Laguna Swift 5x10 (CNC router, RichAuto A-series) -- 3-axis subtractive
 *      jobs; the `xyBounds` and `zRange` fields are the most operator-relevant
 *      stats during dust-collection setup.
 *   3. Makera Carvera + 4th Axis Rotary -- the rotary section is gated on
 *      `job.rotarySetup` truthy; the `chuckDepthMm: 5` + `clampOffsetMm: 0`
 *      hardcoded defaults in `buildSetupSheetJobFromManufacture` are pinned
 *      against silent drift of the 4-axis rotary preset.
 *
 * Pure additive: ZERO production-code edits. The companion file
 * `setup-sheet.test.ts` (549 lines) covers behavioural happy-paths via the
 * three-machine fixture pattern; this file pins the structural invariants
 * (module shape, source text, purity) that prevent silent drift.
 *
 * NOT covered here (out of scope by Safety Rule 1 -- see CLAUDE.md):
 *   - The `*.html` setup-sheet output is not interpreted as G-code; this pin
 *     does NOT validate any toolpath syntax. G-code emission lives in
 *     `resources/post-templates/` (Handlebars) and is pinned elsewhere.
 *
 * Convention: this file is paired with `setup-sheet.ts` (same dir, same base
 * name, `-pin.test.ts` suffix). Per `docs/EDIT-WORKFLOW.md` R1 the file is
 * created as a NEW file via Write tool (sub-800 lines, NOT mandatory-territory).
 */

import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { describe, expect, it } from 'vitest'

import * as M from './setup-sheet'
import {
  parseGcodeStats,
  buildSetupSheetJobFromManufacture,
  generateSetupSheet,
  type SetupSheetJob,
  type GcodeStats
} from './setup-sheet'
import type { ManufactureFile } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import type { MaterialRecord } from '../../shared/material-schema'
import type { ToolRecord } from '../../shared/tool-schema'

// ────────────────────────────────────────────────────────────────────────────
// Source-text constant (cached once for the whitelist describe block).
// ────────────────────────────────────────────────────────────────────────────
const SRC_PATH = resolvePath(__dirname, 'setup-sheet.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

// ────────────────────────────────────────────────────────────────────────────
// Helpers (test-local; not exported)
// ────────────────────────────────────────────────────────────────────────────
function makeBaseJob(): SetupSheetJob {
  return {
    name: 'Pin Test Job',
    stlPath: '/parts/pin.stl',
    machineId: 'laguna_swift_5x10',
    materialId: null,
    stock: { x: 1219, y: 2438, z: 19 },
    operations: [
      {
        id: 'op1',
        kind: 'cnc_pocket',
        label: 'Pocket cut',
        params: { toolDiameterMm: 6, feedMmMin: 4500, zPassMm: -3, stepoverMm: 3, safeZMm: 12 }
      }
    ],
    gcodeOut: '/parts/pin.nc'
  }
}

function makeLagunaProfile(): MachineProfile {
  // Minimal MachineProfile valid against `src/shared/machine-schema.ts`.
  return {
    id: 'laguna_swift_5x10',
    name: 'Laguna Swift 5x10',
    kind: 'cnc',
    workAreaMm: { x: 1524, y: 3048, z: 200 },
    maxFeedMmMin: 18000,
    postTemplate: 'vcarve_mach3.hbs',
    dialect: 'mach3'
  }
}

function makeK2Profile(): MachineProfile {
  // dialect: 'generic_mm' matches `resources/machines/creality-k2-plus.json`
  // (Klipper firmware accepts standard G/M codes; the FDM passthrough
  // template emits generic G-code that Klipper macros handle natively).
  return {
    id: 'creality-k2-plus',
    name: 'Creality K2 Plus',
    kind: 'fdm',
    workAreaMm: { x: 350, y: 350, z: 350 },
    maxFeedMmMin: 36000,
    postTemplate: 'fdm_passthrough.hbs',
    dialect: 'generic_mm'
  }
}

// ─── A. Module shape ────────────────────────────────────────────────────────
describe('[ID-0215] setup-sheet module shape (Cycle 140 ui-polish paired-pin)', () => {
  it('exports the documented runtime symbols (3 functions, no surprises)', () => {
    expect(typeof parseGcodeStats).toBe('function')
    expect(typeof buildSetupSheetJobFromManufacture).toBe('function')
    expect(typeof generateSetupSheet).toBe('function')
  })

  it('runtime named-export whitelist: only the documented 3 callables (no junk)', () => {
    const stringKeys = Object.keys(M).sort()
    // Type-only exports (`SetupSheetJob`, `GcodeStats`) are erased at runtime.
    expect(stringKeys).toEqual(
      ['buildSetupSheetJobFromManufacture', 'generateSetupSheet', 'parseGcodeStats']
    )
  })

  it('the only Symbol-key on the ESM namespace is Symbol.toStringTag', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M)
    expect(symbolKeys).toEqual([Symbol.toStringTag])
    expect((M as unknown as Record<symbol, unknown>)[Symbol.toStringTag]).toBe('Module')
  })

  it('parseGcodeStats has arity 1 (single string param)', () => {
    expect(parseGcodeStats.length).toBe(1)
  })

  it('buildSetupSheetJobFromManufacture has arity 1 (single options object)', () => {
    expect(buildSetupSheetJobFromManufacture.length).toBe(1)
  })

  it('generateSetupSheet has arity 1 (single options object)', () => {
    expect(generateSetupSheet.length).toBe(1)
  })

  it('all three exports are plain functions (no class constructors)', () => {
    // Class constructors have a `prototype` with `constructor` pointing back.
    // Plain functions also have `prototype` but the class-vs-function
    // distinction surfaces via `prototype` enumerability and `Function.name`.
    expect(parseGcodeStats.name).toBe('parseGcodeStats')
    expect(buildSetupSheetJobFromManufacture.name).toBe('buildSetupSheetJobFromManufacture')
    expect(generateSetupSheet.name).toBe('generateSetupSheet')
    // No `class` keyword surface: calling without `new` succeeds.
    expect(() => parseGcodeStats('')).not.toThrow()
  })

  it('the file path matches the convention `src/renderer/src/setup-sheet.ts`', () => {
    expect(SRC_PATH.replace(/\\/g, '/')).toMatch(/\/src\/renderer\/src\/setup-sheet\.ts$/)
    expect(SRC.length).toBeGreaterThan(1000) // 454 lines, ~14 KB
  })
})

// ─── B. parseGcodeStats type contract ───────────────────────────────────────
describe('[ID-0215] parseGcodeStats return-shape contract', () => {
  it('always returns an object with the documented 6 keys (or 5 when est is undefined)', () => {
    const s = parseGcodeStats('')
    expect(Object.keys(s).sort()).toEqual(
      ['cuttingMoves', 'estimatedTimeSec', 'motionLines', 'totalLines', 'xyBounds', 'zRange'].sort()
    )
    expect(typeof s.totalLines).toBe('number')
    expect(typeof s.motionLines).toBe('number')
    expect(typeof s.cuttingMoves).toBe('number')
    expect(s.xyBounds).toBeNull()
    expect(s.zRange).toBeNull()
  })

  it('xyBounds is null exactly when there is zero motion (no G0/G1 lines)', () => {
    expect(parseGcodeStats('').xyBounds).toBeNull()
    expect(parseGcodeStats('; comment-only').xyBounds).toBeNull()
    expect(parseGcodeStats('M3 S10000\nM5\nM30').xyBounds).toBeNull()
    // First G0 establishes endpoint -> xyBounds becomes finite.
    expect(parseGcodeStats('G0 X1 Y2 Z3').xyBounds).not.toBeNull()
  })

  it('zRange is null exactly when there is zero motion (no G0/G1 lines)', () => {
    expect(parseGcodeStats('').zRange).toBeNull()
    expect(parseGcodeStats('M3 S10000').zRange).toBeNull()
    // First G0 sets z -> zRange becomes finite. With a single endpoint (z=5)
    // both topZ and bottomZ converge to 5 (parser tracks ENDPOINT min/max,
    // not segment range; the implicit (0,0,0) origin is never added to bounds).
    const z = parseGcodeStats('G0 Z5').zRange
    expect(z).toEqual({ topZ: 5, bottomZ: 5 })
  })

  it('totalLines equals input.split(/\\r?\\n/).length (CRLF + LF agnostic)', () => {
    expect(parseGcodeStats('').totalLines).toBe(1) // ''.split === ['']
    expect(parseGcodeStats('a').totalLines).toBe(1)
    expect(parseGcodeStats('a\nb').totalLines).toBe(2)
    expect(parseGcodeStats('a\r\nb').totalLines).toBe(2)
    expect(parseGcodeStats('a\r\nb\nc').totalLines).toBe(3)
    expect(parseGcodeStats('a\n').totalLines).toBe(2) // trailing LF -> empty trailing
  })
})

// ─── C. parseGcodeStats purity & determinism ────────────────────────────────
describe('[ID-0215] parseGcodeStats purity & determinism', () => {
  it('does not mutate the input string (immutable by JS semantics, pinned via referential equality)', () => {
    const input = 'G0 X10 Y20 Z5\nG1 Z-1 F600'
    const before = input
    parseGcodeStats(input)
    expect(input).toBe(before)
  })

  it('returns a fresh result object on every call (no caller-visible aliasing)', () => {
    const input = 'G0 X10 Y10 Z5\nG1 Z-1 F300'
    const a = parseGcodeStats(input)
    const b = parseGcodeStats(input)
    expect(a).not.toBe(b)
    expect(a.xyBounds).not.toBe(b.xyBounds)
    expect(a.zRange).not.toBe(b.zRange)
    expect(a).toEqual(b)
  })

  it('caller mutating the returned bounds does not leak into a subsequent call', () => {
    const input = 'G0 X10 Y10 Z5\nG1 Z-1 F300'
    const a = parseGcodeStats(input)
    if (a.xyBounds) a.xyBounds.maxX = 9999
    if (a.zRange) a.zRange.bottomZ = 9999
    const b = parseGcodeStats(input)
    expect(b.xyBounds).toEqual({ minX: 10, maxX: 10, minY: 10, maxY: 10 })
    expect(b.zRange).toEqual({ topZ: 5, bottomZ: -1 })
  })

  it('N=10 determinism: calling 10 times on the same input yields equal results', () => {
    const input = 'G0 X0 Y0 Z5\nG1 Z-1 F600\nG1 X10 Y0 F600\nG0 Z5'
    const results = Array.from({ length: 10 }, () => parseGcodeStats(input))
    const first = JSON.stringify(results[0])
    for (const r of results) expect(JSON.stringify(r)).toBe(first)
  })

  it('frozen-input safety: passing a frozen string-derivative does not throw', () => {
    // Strings are primitive; passing through a Frozen-looking shape just to
    // pin that the parser does not mutate any temporary array/state derived
    // from input via `Object.freeze`-able inner state.
    const input = ['G0 X1 Y2 Z3', 'G1 Z-0.5 F400'].join('\n')
    Object.freeze(input as unknown as object) // no-op on primitive but contract pin
    expect(() => parseGcodeStats(input)).not.toThrow()
  })

  it('output object shape is plain (no prototype methods leak)', () => {
    const s = parseGcodeStats('G0 X5')
    expect(Object.getPrototypeOf(s)).toBe(Object.prototype)
    if (s.xyBounds) expect(Object.getPrototypeOf(s.xyBounds)).toBe(Object.prototype)
  })
})

// ─── D. parseGcodeStats edge-case behavioural anchors ───────────────────────
describe('[ID-0215] parseGcodeStats edge-case anchors', () => {
  it('default totalFeedRate=1200 surfaces as estimatedTimeSec=0 on zero-cutting input', () => {
    // No G1-below-Z0 -> totalFeedDist=0 -> 0/1200*60 = 0 (NOT undefined).
    // Pinned because the source has a defaulted local var; if someone changes
    // the default to 0 the formula returns `undefined` which would silently
    // hide cycle-time on jobs whose only G-code is `G0 Z5` retracts.
    const s = parseGcodeStats('G0 X0 Y0 Z5')
    expect(s.cuttingMoves).toBe(0)
    expect(s.estimatedTimeSec).toBe(0)
  })

  it('semicolon comments are stripped BEFORE the G-word match (so G1 ; cut still counts)', () => {
    const s = parseGcodeStats('G1 ; cutting\nG1 X5 Z-1 F600')
    // Line 1 has G1 with no other token after comment-strip -> still matches /^G1\b/.
    expect(s.motionLines).toBe(2)
  })

  it('inline comment in middle of motion line strips trailing comment correctly', () => {
    const s = parseGcodeStats('G1 X10 Z-1 F500 ; cutting')
    expect(s.cuttingMoves).toBe(1)
    expect(s.xyBounds).toEqual({ minX: 10, maxX: 10, minY: 0, maxY: 0 })
  })

  it('case-insensitive G-word match: `g0`, `G00`, `g01`, `G1` all classify identically', () => {
    const lc = parseGcodeStats('g0 z5\ng1 x10 z-1 f1000')
    const uc = parseGcodeStats('G00 Z5\nG01 X10 Z-1 F1000')
    expect(lc.motionLines).toBe(uc.motionLines)
    expect(lc.cuttingMoves).toBe(uc.cuttingMoves)
    expect(lc.estimatedTimeSec).toBeCloseTo(uc.estimatedTimeSec ?? -1, 5)
  })

  it('G2 / G3 (arcs) are NEVER counted (parser is XY-linear-only)', () => {
    const s = parseGcodeStats(['G2 X10 Y10 I5 J0 F500', 'G3 X20 Y0 I5 J0 F500'].join('\n'))
    expect(s.motionLines).toBe(0)
    expect(s.cuttingMoves).toBe(0)
    expect(s.xyBounds).toBeNull()
  })

  it('feed rate is captured ONLY from G1 lines (G0 F-words are ignored for time estimate)', () => {
    // G0 F999999 should NOT change totalFeedRate; the cutting estimate uses
    // the LAST G1-seen feed (1200 default if no G1 F-word seen).
    // Distance: 0->10 along X = 10 mm at default 1200 -> 10/1200*60 = 0.5 s.
    const s = parseGcodeStats(['G0 X0 Y0 Z-1 F99999', 'G1 X10 Y0'].join('\n'))
    expect(s.cuttingMoves).toBe(1)
    expect(s.estimatedTimeSec).toBeCloseTo(0.5, 5)
  })
})

// ─── E. buildSetupSheetJobFromManufacture purity & freshness ────────────────
describe('[ID-0215] buildSetupSheetJobFromManufacture purity & freshness', () => {
  const baseInput = (): {
    projectName: string
    mfg: ManufactureFile
    camMachineId: string | undefined
    gcodePath: string | null
    sourceStlPath: string | null
  } => ({
    projectName: 'P',
    mfg: { version: 1, setups: [], operations: [] } as ManufactureFile,
    camMachineId: undefined,
    gcodePath: null,
    sourceStlPath: null
  })

  it('default 100×100×20 stock is a fresh object, not a shared mutable singleton', () => {
    const a = buildSetupSheetJobFromManufacture(baseInput())
    const b = buildSetupSheetJobFromManufacture(baseInput())
    expect(a.stock).toEqual({ x: 100, y: 100, z: 20 })
    expect(b.stock).toEqual({ x: 100, y: 100, z: 20 })
    expect(a.stock).not.toBe(b.stock)
    a.stock.x = 9999
    const c = buildSetupSheetJobFromManufacture(baseInput())
    expect(c.stock.x).toBe(100) // mutation of a.stock did not leak
  })

  it('rotarySetup chuck/clamp constants are byte-stable: chuckDepthMm=5, clampOffsetMm=0', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [
        {
          id: 's1',
          label: 'rotary',
          machineId: 'makera_carvera_4axis',
          axisMode: '4axis',
          stock: { kind: 'cylinder', x: 200, y: 50, z: 50 }
        }
      ],
      operations: []
    }
    const job = buildSetupSheetJobFromManufacture({
      ...baseInput(),
      mfg,
      camMachineId: 'makera_carvera_4axis'
    })
    expect(job.rotarySetup).toBeDefined()
    expect(job.rotarySetup?.chuckDepthMm).toBe(5)
    expect(job.rotarySetup?.clampOffsetMm).toBe(0)
    expect(job.rotarySetup?.cylinderLengthMm).toBe(200)
    expect(job.rotarySetup?.cylinderDiameterMm).toBe(50)
  })

  it('returned operations array is a fresh array (caller .push does not leak)', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [
        {
          id: 's1',
          label: 'main',
          machineId: 'laguna_swift_5x10',
          stock: { kind: 'box', x: 100, y: 100, z: 20 }
        }
      ],
      operations: [{ id: 'op1', kind: 'cnc_pocket', label: 'P', params: {} }]
    }
    const a = buildSetupSheetJobFromManufacture({ ...baseInput(), mfg })
    const b = buildSetupSheetJobFromManufacture({ ...baseInput(), mfg })
    expect(a.operations).not.toBe(b.operations)
    a.operations.push({ id: 'leak', kind: 'leaked', label: 'leak' })
    expect(b.operations.length).toBe(1)
  })

  it('non-positive box stock dims fall back to defaults INDEPENDENTLY per axis', () => {
    const mfg: ManufactureFile = {
      version: 1,
      setups: [
        {
          id: 's1',
          label: 'partial',
          machineId: 'laguna_swift_5x10',
          stock: { kind: 'box', x: 0, y: 500, z: -1 }
        }
      ],
      operations: []
    }
    const job = buildSetupSheetJobFromManufacture({ ...baseInput(), mfg })
    // x=0 -> falls back to 100; y=500 -> kept; z=-1 -> falls back to 20.
    expect(job.stock).toEqual({ x: 100, y: 500, z: 20 })
  })

  it('omits rotarySetup unless axisMode === "4axis" AND positive x AND positive y', () => {
    const make = (axisMode: '3axis' | '4axis', kind: 'box' | 'cylinder', x: number, y: number) => {
      const mfg: ManufactureFile = {
        version: 1,
        setups: [
          {
            id: 's1',
            label: 'r',
            machineId: 'm',
            axisMode,
            stock: { kind, x, y, z: 50 }
          }
        ],
        operations: []
      }
      return buildSetupSheetJobFromManufacture({ ...baseInput(), mfg }).rotarySetup
    }
    expect(make('4axis', 'cylinder', 200, 50)).toBeDefined()
    expect(make('4axis', 'box', 200, 50)).toBeDefined() // box accepted too
    expect(make('3axis', 'cylinder', 200, 50)).toBeUndefined()
    expect(make('4axis', 'cylinder', 0, 50)).toBeUndefined()
    expect(make('4axis', 'cylinder', 200, 0)).toBeUndefined()
  })
})

// ─── F. generateSetupSheet HTML structural invariants ───────────────────────
describe('[ID-0215] generateSetupSheet HTML structural invariants', () => {
  it('returns a single string starting with `<!DOCTYPE html>` and ending with `</html>`', () => {
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(typeof html).toBe('string')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
  })

  it('always includes the page wrapper, header, footer, and lang="en"', () => {
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('<html lang="en">')
    expect(html).toContain('<div class="page">')
    expect(html).toContain('<header>')
    expect(html).toContain('</header>')
    expect(html).toContain('<footer>')
    expect(html).toContain('</footer>')
  })

  it('the page <title> uses the byte-equal `Setup Sheet — ` em-dash prefix', () => {
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('<title>Setup Sheet — Pin Test Job</title>')
    // U+2014 EM DASH, NOT U+2013 EN DASH and NOT ASCII `--`.
    expect(html).toContain('Setup Sheet — Pin Test Job')
    expect(html).not.toContain('Setup Sheet – Pin Test Job')
    expect(html).not.toContain('Setup Sheet -- Pin Test Job')
  })

  it('badge falls back to literal "Unknown Machine" when machine is null', () => {
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('Unknown Machine')
  })

  it('badge shows `${machine.name}` and the post-template label when provided (Laguna Swift)', () => {
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: makeLagunaProfile(),
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('Laguna Swift 5x10')
    expect(html).toContain('vcarve_mach3.hbs')
  })

  it('badge shows K2 Plus name + Klipper post when given the FDM profile', () => {
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: makeK2Profile(),
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('Creality K2 Plus')
    expect(html).toContain('fdm_passthrough.hbs')
    // No "Unknown Machine" fallback when machine is provided.
    expect(html).not.toContain('Unknown Machine')
  })

  it('Operation sequence section always renders (even with empty operations)', () => {
    const job = { ...makeBaseJob(), operations: [] }
    const html = generateSetupSheet({
      job,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('Operation sequence (0)')
  })

  it('Operation sequence header includes count of operations from job.operations', () => {
    const job: SetupSheetJob = {
      ...makeBaseJob(),
      operations: Array.from({ length: 7 }, (_, i) => ({
        id: `op${i + 1}`,
        kind: 'cnc_pocket',
        label: `Op ${i + 1}`,
        params: {}
      }))
    }
    const html = generateSetupSheet({
      job,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('Operation sequence (7)')
  })

  it('Stats section renders only when gcodeStats truthy AND includes locale-formatted totalLines', () => {
    const stats: GcodeStats = {
      totalLines: 12345,
      motionLines: 800,
      cuttingMoves: 600,
      xyBounds: { minX: 0, maxX: 1000, minY: 0, maxY: 500 },
      zRange: { topZ: 10, bottomZ: -5 },
      estimatedTimeSec: 600
    }
    const htmlYes = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: stats
    })
    expect(htmlYes).toContain('G-code Statistics')
    expect(htmlYes).toContain('12,345') // toLocaleString comma grouping
    expect(htmlYes).toContain('rough lower bound')
    expect(htmlYes).toContain('10m 0s')

    const htmlNo = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(htmlNo).not.toContain('G-code Statistics')
  })

  it('CAM guardrails section is unconditional (every sheet warns about unverified G-code)', () => {
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    // The source emits a literal `&` (not pre-escaped to `&amp;`) — browsers
    // parse it tolerantly. Pin the actual byte-level header text.
    expect(html).toContain('CAM guardrails & verification')
    expect(html).toContain('docs/MACHINES.md')
  })
})

// ─── G. generateSetupSheet escape-HTML semantics + conditional sections ─────
describe('[ID-0215] generateSetupSheet escape-HTML + conditional toggles', () => {
  it('escapeHtml is applied to gcode excerpt: < > & " all escaped', () => {
    const dangerous = '<script>alert("xss & co")</script>'
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null,
      gcodeText: dangerous
    })
    expect(html).toContain('G-code excerpt')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;xss &amp; co&quot;')
    expect(html).not.toContain('<script>alert(')
  })

  it('`&` ordering: ampersand is escaped first, so `&lt;` does NOT become `&amp;lt;`', () => {
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null,
      gcodeText: '<a&b>'
    })
    // The 5-char input `<a&b>` -> `&lt;a&amp;b&gt;` (NOT `&amp;lt;a&amp;amp;b&amp;gt;`).
    expect(html).toContain('&lt;a&amp;b&gt;')
    expect(html).not.toContain('&amp;lt;')
    expect(html).not.toContain('&amp;amp;')
  })

  it('G-code excerpt section appears only when gcodeText is non-empty after trim', () => {
    const yes = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null,
      gcodeText: 'G0 Z5'
    })
    expect(yes).toContain('G-code excerpt')

    for (const empty of [null, undefined, '', '   ', '\n\n', '\t \r\n']) {
      const html = generateSetupSheet({
        job: makeBaseJob(),
        machine: null,
        material: null,
        tools: [],
        gcodeStats: null,
        gcodeText: empty as string | null | undefined
      })
      expect(html).not.toContain('G-code excerpt')
    }
  })

  it('G-code excerpt is capped to first 50 lines', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `G0 X${i}`)
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null,
      gcodeText: lines.join('\n')
    })
    // Line 49 (0-indexed) == "G0 X49" must be present; line 50 must NOT.
    expect(html).toContain('G0 X49')
    expect(html).not.toContain('G0 X50')
    expect(html).not.toContain('G0 X100')
  })

  it('Rotary stock section appears only when job.rotarySetup is defined', () => {
    const withRotary: SetupSheetJob = {
      ...makeBaseJob(),
      rotarySetup: {
        cylinderDiameterMm: 50,
        cylinderLengthMm: 200,
        chuckDepthMm: 5,
        clampOffsetMm: 2
      }
    }
    const yes = generateSetupSheet({
      job: withRotary,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(yes).toContain('Rotary stock (session)')
    // Cylinder Ø label uses the U+00D8 LATIN CAPITAL LETTER O WITH STROKE.
    expect(yes).toContain('Cylinder Ø (stock Y)')
    expect(yes).toContain('docs/MACHINES.md')

    const no = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(no).not.toContain('Rotary stock (session)')
  })

  it('Tool List section appears only when at least one used tool resolves from the library', () => {
    const tools: ToolRecord[] = [
      {
        id: 't-flat-6',
        diameterMm: 6,
        type: 'endmill',
        name: '6mm flat carbide',
        fluteCount: 2
      } as ToolRecord
    ]
    const job: SetupSheetJob = {
      ...makeBaseJob(),
      operations: [
        {
          id: 'op1',
          kind: 'cnc_pocket',
          label: 'Pocket',
          params: { toolId: 't-flat-6', toolDiameterMm: 6, feedMmMin: 4500 }
        }
      ]
    }
    const html = generateSetupSheet({
      job,
      machine: null,
      material: null,
      tools,
      gcodeStats: null
    })
    expect(html).toContain('Tool List (1 from library)')
    expect(html).toContain('6mm flat carbide')

    // Empty tools -> no Tool List section.
    const noTools = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(noTools).not.toContain('Tool List')
  })

  it('Material card prefers material.name over job.materialId over the em-dash fallback', () => {
    const material: MaterialRecord = {
      id: 'm-bb-ply-19mm',
      name: 'Baltic Birch Ply 19mm',
      category: 'wood',
      cutParams: { default: { surfaceSpeedMMin: 300, chiploadMm: 0.05, docFactor: 0.5, stepoverFactor: 0.5 } }
    } as unknown as MaterialRecord
    const html = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material,
      tools: [],
      gcodeStats: null
    })
    expect(html).toContain('Baltic Birch Ply 19mm')

    const jobWithMatId: SetupSheetJob = { ...makeBaseJob(), materialId: 'm-fallback-id' }
    const html2 = generateSetupSheet({
      job: jobWithMatId,
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    expect(html2).toContain('m-fallback-id')

    // Both null -> em-dash fallback in Material card.
    const html3 = generateSetupSheet({
      job: makeBaseJob(),
      machine: null,
      material: null,
      tools: [],
      gcodeStats: null
    })
    // The em-dash is used in the Material card value when both are null.
    expect(html3).toContain('—') // U+2014 EM DASH
  })
})

// ─── H. Source-text whitelist ────────────────────────────────────────────────
describe('[ID-0215] setup-sheet source-text whitelist (Cycle 140)', () => {
  it('header JSDoc names "HTML Setup Sheet generator" and lists key sections', () => {
    expect(SRC).toContain('HTML Setup Sheet generator')
    expect(SRC).toContain('printable, self-contained HTML document')
  })

  it('exports exactly 3 runtime functions and 2 type aliases (no surprises)', () => {
    const fnExports = SRC.match(/^export function /gm)
    expect(fnExports?.length ?? 0).toBe(3)
    const interfaceExports = SRC.match(/^export interface /gm)
    expect(interfaceExports?.length ?? 0).toBe(2) // SetupSheetJob, GcodeStats
    expect(SRC).toMatch(/^export function parseGcodeStats\(/m)
    expect(SRC).toMatch(/^export function generateSetupSheet\(/m)
    expect(SRC).toMatch(/^export function buildSetupSheetJobFromManufacture\(/m)
  })

  it('escapeHtml maps the 4 documented characters (& < > ") in correct order', () => {
    // Order matters: `&` MUST be replaced first, otherwise subsequent
    // replacements turn `<` -> `&lt;` -> `&amp;lt;`. Pin the ordering by
    // finding the four regex-literal source positions (`/&/g`, `/</g`,
    // `/>/g`, `/"/g`) — each `.replace(...)` chains them in declaration order.
    const fn = SRC.match(/function escapeHtml[\s\S]*?\n\}/)
    expect(fn).not.toBeNull()
    const body = fn![0]
    const idxAmp = body.indexOf('/&/g')
    const idxLt = body.indexOf('/</g')
    const idxGt = body.indexOf('/>/g')
    const idxQuot = body.indexOf('/"/g')
    expect(idxAmp).toBeGreaterThan(-1)
    expect(idxLt).toBeGreaterThan(idxAmp)
    expect(idxGt).toBeGreaterThan(idxLt)
    expect(idxQuot).toBeGreaterThan(idxGt)
    // Replacement targets:
    expect(body).toContain('&amp;')
    expect(body).toContain('&lt;')
    expect(body).toContain('&gt;')
    expect(body).toContain('&quot;')
  })

  it('parseGcodeStats has 4 G-word regex literals + an inline-comment strip regex', () => {
    expect(SRC).toContain('/^G0\\b|^G00\\b/')
    expect(SRC).toContain('/^G1\\b|^G01\\b/')
    expect(SRC).toContain('/X(-?[\\d.]+)/')
    expect(SRC).toContain('/Y(-?[\\d.]+)/')
    expect(SRC).toContain('/Z(-?[\\d.]+)/')
    expect(SRC).toContain('/F(-?[\\d.]+)/')
    expect(SRC).toContain('/;.*$/')
    expect(SRC).toContain('split(/\\r?\\n/)')
  })

  it('default totalFeedRate=1200 literal is present (G-code estimate fallback)', () => {
    expect(SRC).toContain('totalFeedRate = 1200')
  })

  it('default fallback stock {x:100,y:100,z:20} literal is present in buildSetup...', () => {
    expect(SRC).toContain('{ x: 100, y: 100, z: 20 }')
  })

  it('rotarySetup hardcoded constants chuckDepthMm:5 + clampOffsetMm:0 are present', () => {
    expect(SRC).toContain('chuckDepthMm: 5')
    expect(SRC).toContain('clampOffsetMm: 0')
  })

  it('"Unknown Machine" fallback literal appears exactly once', () => {
    const matches = SRC.match(/'Unknown Machine'/g)
    expect(matches?.length ?? 0).toBe(1)
  })

  it('"Unified Fab Studio" footer brand string is present (em-dash separator)', () => {
    expect(SRC).toContain('Unified Fab Studio — Setup Sheet')
  })

  it('em-dash glyph U+2014 is used (NOT en-dash U+2013) for separator literals', () => {
    // EM DASH used in: title, badge fallback, footer, fmt() returns, etc.
    expect(SRC).toContain('—')
    // Negative pin: en-dash should not appear in the source.
    expect(SRC).not.toContain('–')
  })

  it('renders G-code excerpt capped at 50 lines (literal `slice(0, 50)`)', () => {
    expect(SRC).toContain('slice(0, 50)')
    // Excerpt note "first 50 lines" appears in the rendered HTML.
    expect(SRC).toContain('first 50 lines')
  })

  it('imports value `resolveManufactureSetupForCam` and 4 type-only imports (no React/DOM/electron/fs)', () => {
    expect(SRC).toContain("import { resolveManufactureSetupForCam } from '../../shared/cam-cut-params'")
    expect(SRC).toContain("import type { MachineProfile } from '../../shared/machine-schema'")
    expect(SRC).toContain("import type { MaterialRecord } from '../../shared/material-schema'")
    expect(SRC).toContain("import type { ManufactureFile } from '../../shared/manufacture-schema'")
    expect(SRC).toContain("import type { ToolRecord } from '../../shared/tool-schema'")
    // Negative whitelist: no React, no DOM globals, no electron, no fs/path imports.
    expect(SRC).not.toContain("from 'react'")
    expect(SRC).not.toContain('from "react"')
    expect(SRC).not.toContain("from 'electron'")
    expect(SRC).not.toContain("from 'fs'")
    expect(SRC).not.toContain("from 'node:fs'")
    expect(SRC).not.toContain("from 'path'")
    expect(SRC).not.toContain("from 'node:path'")
    // No DOM API references (this file builds an HTML string but never touches `document`).
    expect(SRC).not.toMatch(/\bdocument\.\w+/)
    expect(SRC).not.toMatch(/\bwindow\.\w+/)
  })

  it('zero TypeScript `any` usage (no `: any`, `as any`, or `<any>`)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/\bas\s+any\b/)
    expect(SRC).not.toMatch(/<any>/)
  })

  it('TOOL_TYPES enum maps the 6 documented categories (endmill/ball/vbit/drill/face/other)', () => {
    expect(SRC).toContain('endmill:')
    expect(SRC).toContain('ball:')
    expect(SRC).toContain('vbit:')
    expect(SRC).toContain('drill:')
    expect(SRC).toContain('face:')
    expect(SRC).toContain('other:')
    expect(SRC).toContain('Flat Endmill')
    expect(SRC).toContain('Ball Nose')
    expect(SRC).toContain('V-Bit')
  })

  it('CAM-guardrails copy mentions docs/MACHINES.md AND `unverified` framing', () => {
    expect(SRC).toContain('docs/MACHINES.md')
    expect(SRC).toContain('unverified')
    // Source emits a literal `&` in the header (not pre-escaped to `&amp;`).
    expect(SRC).toContain('<h2>CAM guardrails & verification</h2>')
  })

  it('print-media @media block is present (printable disclaimer + page-break-inside avoid)', () => {
    expect(SRC).toContain('@media print')
    expect(SRC).toContain('page-break-inside: avoid')
  })

  it('buildSetupSheetJobFromManufacture handles `box` and `cylinder` stock kinds explicitly', () => {
    expect(SRC).toContain("st.kind === 'box'")
    expect(SRC).toContain("st.kind === 'cylinder'")
    // axisMode 4axis branch is a literal string.
    expect(SRC).toContain("setup?.axisMode === '4axis'")
  })

  it('SetupSheetJob interface declares the documented optional rotarySetup with 4 numeric fields', () => {
    expect(SRC).toContain('rotarySetup?:')
    expect(SRC).toContain('cylinderDiameterMm: number')
    expect(SRC).toContain('cylinderLengthMm: number')
    expect(SRC).toContain('chuckDepthMm: number')
    expect(SRC).toContain('clampOffsetMm: number')
  })

  it('GcodeStats interface declares 6 numeric/object fields with `estimatedTimeSec` optional', () => {
    expect(SRC).toContain('totalLines: number')
    expect(SRC).toContain('motionLines: number')
    expect(SRC).toContain('cuttingMoves: number')
    expect(SRC).toContain('xyBounds:')
    expect(SRC).toContain('zRange:')
    expect(SRC).toContain('estimatedTimeSec?: number')
  })
})
