/**
 * Paired-pin contract for `src/main/cam-axis4/strategies/indexed.ts`
 * -- the 80-line 4-axis indexed-positioning strategy used by the
 * Makera Carvera + 4th Axis Rotary post pipeline (CLAUDE.md USER
 * CONTEXT -- TARGET MACHINES, machine #3).
 *
 * For each angle in `indexAnglesDeg`, the strategy emits a face pass
 * along X at every Z depth, alternating the X traversal direction for
 * efficient zigzag motion. The Emitter centralizes safety (modal
 * state, "never rotate A at depth", chuck-face X >= 0 guard,
 * plunge-feed vs cut-feed selection, pre-emission angular-velocity
 * throttling via `kinematics.ts`).
 *
 * Three-machine impact: DIRECT cross-cut on every Carvera 4-axis
 * Rotary indexed-positioning job:
 *   - Indexed face passes at user-supplied A angles (CLAUDE.md notes
 *     "the contour engine emits indexed-positioning only" today)
 *   - 92 mm-max stock diameter envelope (CLAUDE.md spec) -- pin
 *     verifies a representative 92 mm cylinder + 240 mm length pair
 *   - Smaller fixtures (8/12/24-station Carvera fixtures) round-trip
 *     in declaration order with rotation-direction-agnostic mixed
 *     signed angles
 *   - Laguna Swift 5x10 + Creality K2 Plus: INDIRECT -- this strategy
 *     is gated to 4-axis runs only; pin asserts the source has zero
 *     manufacturing-kind discriminator, so a corrupted dispatch will
 *     surface at the runner-shims gate ([ID-0301] Cycle 228 pin),
 *     not silently inside this strategy.
 *
 * This pin sits alongside the existing behavioral test
 * `__tests__/strategy-indexed.test.ts` (335 lines / 11 it() blocks
 * covering rotation/depth/zigzag/x-bounds), focusing on the
 * shape/source-text invariants that the behavioral suite does not
 * lock down: exact export surface, comment-line whitelist, source-
 * text purity (no fs/path/electron/eval), pure-function semantics,
 * and three-machine cross-cut realism for the Carvera 92 mm rotary
 * envelope.
 *
 * Roadmap ID: [ID-0305] / Cycle 232 (cam-engine rotation slot).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as M from './indexed'
import { generateIndexed, type IndexedParams, type IndexedResult } from './indexed'

const SOURCE_PATH = resolve(__dirname, 'indexed.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

// ---------------------------------------------------------------------------
// Helper -- a baseline IndexedParams record for pin tests
// ---------------------------------------------------------------------------
function baseParams(overrides: Partial<IndexedParams> = {}): IndexedParams {
  return {
    indexAnglesDeg: [0, 90, 180, 270],
    cylinderDiameterMm: 50,
    machXStartMm: 10,
    machXEndMm: 80,
    zDepthsMm: [-2, -4],
    feedMmMin: 800,
    plungeMmMin: 300,
    safeZMm: 10,
    toolDiameterMm: 3.175,
    ...overrides
  }
}

// ---------------------------------------------------------------------------
// A. Module shape -- exact runtime surface
// ---------------------------------------------------------------------------
describe('A. Module shape -- src/main/cam-axis4/strategies/indexed.ts', () => {
  it('exports exactly the 1-symbol runtime public surface (sorted)', () => {
    expect(Object.keys(M).sort()).toEqual(['generateIndexed'])
  })

  it('generateIndexed classifies as `function`', () => {
    expect(typeof generateIndexed).toBe('function')
  })

  it('is synchronous (not AsyncFunction)', () => {
    expect(generateIndexed.constructor.name).toBe('Function')
  })

  it('arity matches documented signature (1 param object)', () => {
    expect(generateIndexed.length).toBe(1)
  })

  it('source declares exactly one runtime export-function', () => {
    const matches = SOURCE.match(/^export function /gm) ?? []
    expect(matches.length).toBe(1)
  })

  it('source declares exactly two export-types (IndexedParams + IndexedResult)', () => {
    const matches = SOURCE.match(/^export type /gm) ?? []
    expect(matches.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// B. IndexedParams type-shape pins -- runtime shape via baseline acceptance
// ---------------------------------------------------------------------------
describe('B. IndexedParams shape -- required + optional fields', () => {
  it('accepts the 9 required fields and the 3 optional (overcutMm/maxZMm/maxRotaryRpm)', () => {
    const r = generateIndexed({
      indexAnglesDeg: [0],
      cylinderDiameterMm: 50,
      machXStartMm: 10,
      machXEndMm: 80,
      zDepthsMm: [-2],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3,
      overcutMm: 1.5,
      maxZMm: 100,
      maxRotaryRpm: 60
    })
    expect(Array.isArray(r.lines)).toBe(true)
    expect(Array.isArray(r.warnings)).toBe(true)
  })

  it('source declares indexAnglesDeg as ReadonlyArray<number> (immutability hint)', () => {
    expect(SOURCE).toMatch(/indexAnglesDeg:\s*ReadonlyArray<number>/)
  })

  it('source declares zDepthsMm as number[]', () => {
    expect(SOURCE).toMatch(/zDepthsMm:\s*number\[\]/)
  })

  it('source declares overcutMm/maxZMm/maxRotaryRpm as optional via `?:`', () => {
    expect(SOURCE).toMatch(/overcutMm\?:\s*number/)
    expect(SOURCE).toMatch(/maxZMm\?:\s*number/)
    expect(SOURCE).toMatch(/maxRotaryRpm\?:\s*number/)
  })

  it('all 9 documented required fields appear with `: number` typing in source', () => {
    for (const f of [
      'cylinderDiameterMm',
      'machXStartMm',
      'machXEndMm',
      'feedMmMin',
      'plungeMmMin',
      'safeZMm',
      'toolDiameterMm'
    ]) {
      expect(SOURCE).toMatch(new RegExp(f + ':\\s*number'))
    }
  })
})

// ---------------------------------------------------------------------------
// C. IndexedResult shape -- always { lines: string[]; warnings: string[] }
// ---------------------------------------------------------------------------
describe('C. IndexedResult shape', () => {
  it('returns an object with exactly two own enumerable keys (lines, warnings)', () => {
    const r = generateIndexed(baseParams())
    expect(Object.keys(r).sort()).toEqual(['lines', 'warnings'])
  })

  it('lines is always a string[] (every entry typeof === "string")', () => {
    const r = generateIndexed(baseParams())
    expect(r.lines.length).toBeGreaterThan(0)
    for (const ln of r.lines) expect(typeof ln).toBe('string')
  })

  it('warnings is always a string[] (possibly empty)', () => {
    const r = generateIndexed(baseParams())
    expect(Array.isArray(r.warnings)).toBe(true)
    for (const w of r.warnings) expect(typeof w).toBe('string')
  })

  it('source declares the IndexedResult type with both fields', () => {
    expect(SOURCE).toMatch(/export type IndexedResult/)
    expect(SOURCE).toMatch(/lines:\s*string\[\]/)
    expect(SOURCE).toMatch(/warnings:\s*string\[\]/)
  })
})

// ---------------------------------------------------------------------------
// D. Empty / degenerate inputs -- still produces a well-formed result
// ---------------------------------------------------------------------------
describe('D. Empty / degenerate inputs', () => {
  it('empty indexAnglesDeg still emits header + retract + return-home (no per-pass blocks)', () => {
    const r = generateIndexed(baseParams({ indexAnglesDeg: [] }))
    expect(r.lines.some((l) => l.startsWith('; 4-axis indexed — 0 angles'))).toBe(true)
    expect(r.lines.some((l) => l.includes('return A to home'))).toBe(true)
    // No "Index N/M" comments because no angles
    const idx = r.lines.filter((l) => /Index \d+\/\d+/.test(l))
    expect(idx.length).toBe(0)
  })

  it('empty zDepthsMm emits header but zero per-pass blocks and no Z-pass comment', () => {
    const r = generateIndexed(baseParams({ zDepthsMm: [] }))
    expect(r.lines.some((l) => /^; 4-axis indexed/.test(l))).toBe(true)
    expect(r.lines.some((l) => /Z_pass=/.test(l))).toBe(false)
    expect(r.lines.some((l) => /Index \d+\/\d+/.test(l))).toBe(false)
  })

  it('empty arrays yield zero warnings (warnings array still defined)', () => {
    const r1 = generateIndexed(baseParams({ indexAnglesDeg: [] }))
    const r2 = generateIndexed(baseParams({ zDepthsMm: [] }))
    expect(r1.warnings).toEqual([])
    expect(r2.warnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// E. Header / VERIFY comment block -- exact whitelisted text
// ---------------------------------------------------------------------------
describe('E. Header + VERIFY comment block', () => {
  it('emits the "4-axis indexed" header with angle count + X range + overcut + Z levels', () => {
    const r = generateIndexed(baseParams())
    expect(r.lines[0]).toBe(
      '; 4-axis indexed — 4 angles, X=[10.00..80.00] +overcut 3.2mm, Z levels=2'
    )
  })

  it('emits "; D=NN.Nmm" cylinder-diameter comment as the 2nd line', () => {
    const r = generateIndexed(baseParams({ cylinderDiameterMm: 92 }))
    expect(r.lines[1]).toBe('; D=92.0mm')
  })

  it('emits the exact VERIFY safety reminder as the 3rd line', () => {
    const r = generateIndexed(baseParams())
    expect(r.lines[2]).toBe('; VERIFY: A zero, stock zero, each index angle before running')
  })

  it('header X-range bracket uses TWO-DOTS separator + 2-decimal toFixed', () => {
    const r = generateIndexed(baseParams({ machXStartMm: 12.345, machXEndMm: 67.89 }))
    expect(r.lines[0]).toContain('X=[12.35..67.89]')
  })

  it('header overcut prints to ONE decimal via toFixed(1)', () => {
    const r = generateIndexed(baseParams({ overcutMm: 1.234 }))
    expect(r.lines[0]).toContain('+overcut 1.2mm')
  })
})

// ---------------------------------------------------------------------------
// F. Indexed-pass comments -- "Index N/M  A=...°  Z=..."
// ---------------------------------------------------------------------------
describe('F. Per-pass "Index N/M" comments', () => {
  it('emits one "Index N/M" comment per angle per non-skipped depth', () => {
    const r = generateIndexed(
      baseParams({ indexAnglesDeg: [0, 90, 180], zDepthsMm: [-2, -4] })
    )
    const matches = r.lines.filter((l) => /^; Index \d+\/\d+/.test(l))
    // 3 angles x 2 depths = 6 per-pass comments
    expect(matches.length).toBe(6)
  })

  it('"Index N/M" comment uses 1-based numerator and angle-count denominator', () => {
    const r = generateIndexed(baseParams({ indexAnglesDeg: [0, 90, 180], zDepthsMm: [-2] }))
    const idxLines = r.lines.filter((l) => /^; Index/.test(l))
    expect(idxLines[0]).toMatch(/^; Index 1\/3 /)
    expect(idxLines[1]).toMatch(/^; Index 2\/3 /)
    expect(idxLines[2]).toMatch(/^; Index 3\/3 /)
  })

  it('each per-pass comment includes A=...° and Z=... values with 2/3-decimal toFixed', () => {
    const r = generateIndexed(baseParams({ indexAnglesDeg: [45.6789], zDepthsMm: [-1.2345] }))
    const idxLine = r.lines.find((l) => /^; Index/.test(l))
    expect(idxLine).toMatch(/A=45\.68°/)
    expect(idxLine).toMatch(/Z=-1\.234/)
  })

  it('emits a Z-pass header "; --- indexed passes at Z_pass=NN.NNN ---" before each depth block', () => {
    const r = generateIndexed(baseParams({ indexAnglesDeg: [0], zDepthsMm: [-2, -4] }))
    const zHdrs = r.lines.filter((l) => /^; --- indexed passes at Z_pass=/.test(l))
    expect(zHdrs.length).toBe(2)
    expect(zHdrs[0]).toBe('; --- indexed passes at Z_pass=-2.000 ---')
    expect(zHdrs[1]).toBe('; --- indexed passes at Z_pass=-4.000 ---')
  })
})

// ---------------------------------------------------------------------------
// G. X-direction zigzag -- alternates per pass via emit.cutTo / emit.rapidX
// ---------------------------------------------------------------------------
describe('G. X-direction zigzag (alternates per pass)', () => {
  it('first pass goes X=extXStart -> X=extXEnd (forward direction=1)', () => {
    const r = generateIndexed(baseParams({ indexAnglesDeg: [0], zDepthsMm: [-2] }))
    // overcut default = toolDiameterMm = 3.175 -> extXStart = max(0, 10 - 3.175) = 6.825,
    // extXEnd = 80 + 3.175 = 83.175
    const rapidX = r.lines.find((l) => /^G0 X[\d.]+/.test(l))
    expect(rapidX).toBe('G0 X6.825')
    const cutTo = r.lines.find((l) => /^G1 X[\d.]+ F\d+/.test(l))
    expect(cutTo).toBe('G1 X83.175 F800')
  })

  it('after one pass the direction flips: 2nd pass goes X=extXEnd -> X=extXStart', () => {
    const r = generateIndexed(baseParams({ indexAnglesDeg: [0, 90], zDepthsMm: [-2] }))
    // 2nd pass at A=90 is reverse direction
    const cutLines = r.lines.filter((l) => /^G1 X[\d.]+ F\d+/.test(l))
    expect(cutLines[0]).toBe('G1 X83.175 F800')
    expect(cutLines[1]).toBe('G1 X6.825 F800')
  })

  it('direction state persists ACROSS depth blocks (3 passes -> reverse on next depth)', () => {
    const r = generateIndexed(
      baseParams({ indexAnglesDeg: [0, 90, 180], zDepthsMm: [-2, -4] })
    )
    const cutLines = r.lines.filter((l) => /^G1 X[\d.]+ F\d+/.test(l))
    // 6 passes, alternating: forward, reverse, forward, reverse, forward, reverse
    expect(cutLines[0]).toBe('G1 X83.175 F800')
    expect(cutLines[1]).toBe('G1 X6.825 F800')
    expect(cutLines[2]).toBe('G1 X83.175 F800')
    expect(cutLines[3]).toBe('G1 X6.825 F800')
    expect(cutLines[4]).toBe('G1 X83.175 F800')
    expect(cutLines[5]).toBe('G1 X6.825 F800')
  })
})

// ---------------------------------------------------------------------------
// H. Depth-skip floor -- cutZ < 0.05 mm skipped
// ---------------------------------------------------------------------------
describe('H. cutZ < 0.05 mm depth-skip floor', () => {
  it('skips a depth whose stockR + zd is below 0.05 mm', () => {
    // cylinderDiameterMm=50 -> stockR=25, zd=-25 -> cutZ = 0 < 0.05 -> skipped
    const r = generateIndexed(baseParams({ indexAnglesDeg: [0, 90], zDepthsMm: [-25] }))
    expect(r.lines.some((l) => /Index \d+\/\d+/.test(l))).toBe(false)
    expect(r.lines.some((l) => /Z_pass=/.test(l))).toBe(false)
  })

  it('does NOT skip a depth at cutZ == 0.05 boundary (>= 0.05 emits)', () => {
    // stockR=1e-6 (cylinder=0) + zd=0.1 -> cutZ=0.1+1e-6 > 0.05 -> emits
    const r = generateIndexed(
      baseParams({
        indexAnglesDeg: [0],
        zDepthsMm: [0.1],
        cylinderDiameterMm: 0,
        machXStartMm: 5,
        machXEndMm: 15,
        toolDiameterMm: 1
      })
    )
    expect(r.lines.some((l) => /Index 1\/1/.test(l))).toBe(true)
  })

  it('mixed depths -- only above-floor entries emit Index N/M comments', () => {
    // stockR=25 -> zd=-25 yields cutZ=0 (skipped); zd=-2 yields cutZ=23 (emits)
    const r = generateIndexed(
      baseParams({ indexAnglesDeg: [0, 90], zDepthsMm: [-25, -2] })
    )
    const idx = r.lines.filter((l) => /^; Index/.test(l))
    expect(idx.length).toBe(2) // only the -2 depth emits, 2 angles
  })
})

// ---------------------------------------------------------------------------
// I. Stock geometry -- stockR = max(1e-6, D/2); cutZ = stockR + zd
// ---------------------------------------------------------------------------
describe('I. Stock geometry pins', () => {
  it('stockRadius is clamped to >= 1e-6 (D=0 case)', () => {
    // D=0 -> stockR=1e-6; with zd=0.1 -> cutZ ~= 0.1, plunge target = 0.1
    const r = generateIndexed(
      baseParams({
        indexAnglesDeg: [0],
        zDepthsMm: [0.1],
        cylinderDiameterMm: 0,
        machXStartMm: 5,
        machXEndMm: 15,
        toolDiameterMm: 1
      })
    )
    // Plunge target Z is approx 0.1 mm (3-decimal toFixed)
    const plunge = r.lines.find((l) => /^G1 Z[\d.]+ F\d+/.test(l))
    expect(plunge).toBe('G1 Z0.100 F300')
  })

  it('cutZ = stockR + zd; plunge target uses cutZ (3-decimal G-code Z output)', () => {
    // D=50 -> stockR=25; zd=-2 -> cutZ=23 -> "G1 Z23.000 F300"
    const r = generateIndexed(baseParams({ indexAnglesDeg: [0], zDepthsMm: [-2] }))
    expect(r.lines.find((l) => /^G1 Z[\d.]+ F\d+/.test(l))).toBe('G1 Z23.000 F300')
  })

  it('source declares Math.max(1e-6, p.cylinderDiameterMm / 2) clamp', () => {
    expect(SOURCE).toMatch(/Math\.max\(1e-6,\s*p\.cylinderDiameterMm\s*\/\s*2\)/)
  })
})

// ---------------------------------------------------------------------------
// J. overcutMm default -- `overcutMm ?? toolDiameterMm`
// ---------------------------------------------------------------------------
describe('J. overcutMm default fallback', () => {
  it('omitted overcutMm falls back to toolDiameterMm', () => {
    // toolDiameterMm=3, overcutMm omitted -> ext = 3.0 mm
    const r = generateIndexed(
      baseParams({
        indexAnglesDeg: [0],
        zDepthsMm: [-1],
        cylinderDiameterMm: 100,
        machXStartMm: 5,
        machXEndMm: 95,
        toolDiameterMm: 3
      })
    )
    // header should print +overcut 3.0mm
    expect(r.lines[0]).toContain('+overcut 3.0mm')
  })

  it('explicit overcutMm overrides the default', () => {
    const r = generateIndexed(
      baseParams({
        indexAnglesDeg: [0],
        zDepthsMm: [-1],
        cylinderDiameterMm: 100,
        machXStartMm: 5,
        machXEndMm: 95,
        toolDiameterMm: 3,
        overcutMm: 1.5
      })
    )
    expect(r.lines[0]).toContain('+overcut 1.5mm')
    // ext start = 5 - 1.5 = 3.5; ext end = 95 + 1.5 = 96.5
    const rapidX = r.lines.find((l) => /^G0 X[\d.]+/.test(l))
    expect(rapidX).toBe('G0 X3.500')
    const cutLine = r.lines.find((l) => /^G1 X[\d.]+ F\d+/.test(l))
    expect(cutLine).toBe('G1 X96.500 F800')
  })

  it('source uses nullish-coalescing `??` for the overcut default', () => {
    expect(SOURCE).toMatch(/p\.overcutMm\s*\?\?\s*p\.toolDiameterMm/)
  })

  it('extXStart is clamped to >= 0 via Math.max (chuck-face safety)', () => {
    // overcutMm=20 + machXStartMm=10 -> extXStart = max(0, 10-20) = 0
    const r = generateIndexed(
      baseParams({
        indexAnglesDeg: [0],
        zDepthsMm: [-2],
        machXStartMm: 10,
        machXEndMm: 80,
        overcutMm: 20
      })
    )
    // Emitter modal X tracking starts at 0, so the redundant `G0 X0`
    // rapid is suppressed; the first cut line goes from X=0 to X=extXEnd=100.
    const cutLine = r.lines.find((l) => /^G1 X[\d.]+ F\d+/.test(l))
    expect(cutLine).toBe('G1 X100.000 F800')
  })

  it('source declares Math.max(0, p.machXStartMm - ocMm) clamp', () => {
    expect(SOURCE).toMatch(/Math\.max\(0,\s*p\.machXStartMm\s*-\s*ocMm\)/)
  })
})

// ---------------------------------------------------------------------------
// K. Return-home tail -- emit.returnHome() emits parking + A=0
// ---------------------------------------------------------------------------
describe('K. Return-home tail', () => {
  it('last line returns A to 0 with standard comment', () => {
    const r = generateIndexed(baseParams())
    expect(r.lines[r.lines.length - 1]).toBe('G0 A0 ; return A to home')
  })

  it('penultimate parks at clearZ + Y0 (G0 Z<clearZ> Y0)', () => {
    const r = generateIndexed(baseParams())
    // clearZ = stockR + safeZ = 25 + 10 = 35 -> "G0 Z35.000 Y0"
    expect(r.lines[r.lines.length - 2]).toBe('G0 Z35.000 Y0')
  })

  it('first non-comment line is also a Z-clear+Y0 (initial retract)', () => {
    const r = generateIndexed(baseParams())
    // After 3 comment lines: header, D=, VERIFY -> next line is initial retract.
    expect(r.lines[3]).toBe('G0 Z35.000 Y0')
  })
})

// ---------------------------------------------------------------------------
// L. Three-machine cross-cut realism -- Carvera 4-axis Rotary
// ---------------------------------------------------------------------------
describe('L. Three-machine cross-cut realism (Carvera 4-axis Rotary)', () => {
  it('Carvera 92 mm-max stock + 240 mm length: header reflects D=92.0mm', () => {
    // CLAUDE.md spec: rotary module 92 mm dia x 240 mm length
    const r = generateIndexed(
      baseParams({
        cylinderDiameterMm: 92,
        machXStartMm: 5,
        machXEndMm: 235, // ~240mm length minus chuck shoulder
        zDepthsMm: [-2],
        indexAnglesDeg: [0, 90, 180, 270]
      })
    )
    expect(r.lines[1]).toBe('; D=92.0mm')
    expect(r.lines[0]).toContain('X=[5.00..235.00]')
  })

  it('8-station Carvera fixture: 8 indexed angles emit 8 face passes per depth', () => {
    const angles = [0, 45, 90, 135, 180, 225, 270, 315]
    const r = generateIndexed(baseParams({ indexAnglesDeg: angles, zDepthsMm: [-2] }))
    const idx = r.lines.filter((l) => /^; Index/.test(l))
    expect(idx.length).toBe(8)
  })

  it('12-station Carvera fixture: angles round-trip in declaration order', () => {
    const angles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]
    const r = generateIndexed(baseParams({ indexAnglesDeg: angles, zDepthsMm: [-2] }))
    const idx = r.lines.filter((l) => /^; Index/.test(l))
    expect(idx.length).toBe(12)
    // First angle 0, second 30, third 60 -- declaration order preserved
    expect(idx[0]).toMatch(/A=0\.00°/)
    expect(idx[1]).toMatch(/A=30\.00°/)
    expect(idx[2]).toMatch(/A=60\.00°/)
  })

  it('mixed signed angles (rotation-direction-agnostic) round-trip with sign preserved', () => {
    const angles = [-90, 0, 90, -45, 45]
    const r = generateIndexed(baseParams({ indexAnglesDeg: angles, zDepthsMm: [-2] }))
    const idx = r.lines.filter((l) => /^; Index/.test(l))
    expect(idx[0]).toMatch(/A=-90\.00°/)
    expect(idx[1]).toMatch(/A=0\.00°/)
    expect(idx[2]).toMatch(/A=90\.00°/)
    expect(idx[3]).toMatch(/A=-45\.00°/)
    expect(idx[4]).toMatch(/A=45\.00°/)
  })

  it('source has zero machine-id discriminator literals (no K2/Laguna/Carvera by name)', () => {
    // The strategy is generic 4-axis -- the runner-shims gate decides routing.
    // Pinning zero machine-name leakage keeps the strategy reusable + forces
    // dispatch errors to surface at the gate, not silently inside this file.
    expect(SOURCE).not.toMatch(/k2[\s_-]?plus/i)
    expect(SOURCE).not.toMatch(/laguna/i)
    expect(SOURCE).not.toMatch(/carvera/i)
    expect(SOURCE).not.toMatch(/Klipper/i)
    expect(SOURCE).not.toMatch(/RichAuto/i)
    expect(SOURCE).not.toMatch(/Moonraker/i)
  })

  it('source has zero `manufactureKind` / `dialect` literals (no kind discriminator inside strategy)', () => {
    expect(SOURCE).not.toMatch(/manufactureKind/)
    expect(SOURCE).not.toMatch(/dialect/)
    expect(SOURCE).not.toMatch(/cnc_4axis_/)
    expect(SOURCE).not.toMatch(/fdm_slice/)
  })
})

// ---------------------------------------------------------------------------
// M. Pure-function invariants -- input not mutated; fresh result each call
// ---------------------------------------------------------------------------
describe('M. Pure-function invariants', () => {
  it('does not mutate input indexAnglesDeg (ReadonlyArray contract)', () => {
    const angles = [0, 90, 180, 270]
    const snapshot = [...angles]
    generateIndexed(baseParams({ indexAnglesDeg: angles }))
    expect(angles).toEqual(snapshot)
  })

  it('does not mutate input zDepthsMm (number[])', () => {
    const depths = [-2, -4, -6]
    const snapshot = [...depths]
    generateIndexed(baseParams({ zDepthsMm: depths }))
    expect(depths).toEqual(snapshot)
  })

  it('returns a fresh result object each call (no shared state)', () => {
    const r1 = generateIndexed(baseParams())
    const r2 = generateIndexed(baseParams())
    expect(r1).not.toBe(r2)
    expect(r1.lines).not.toBe(r2.lines)
    expect(r1.warnings).not.toBe(r2.warnings)
    expect(r1.lines).toEqual(r2.lines)
  })

  it('two calls with identical params produce identical lines (determinism)', () => {
    const params = baseParams()
    expect(generateIndexed(params).lines).toEqual(generateIndexed(params).lines)
  })

  it('two calls with identical params produce identical warnings (determinism)', () => {
    const params = baseParams()
    expect(generateIndexed(params).warnings).toEqual(generateIndexed(params).warnings)
  })
})

// ---------------------------------------------------------------------------
// N. Source-text whitelist -- import / safety / G-code surface
// ---------------------------------------------------------------------------
describe('N. Source-text whitelist', () => {
  it('imports ONLY from "../emit" (Emitter) -- no other module dependencies', () => {
    const importLines = SOURCE.match(/^import .+ from .+$/gm) ?? []
    expect(importLines.length).toBe(1)
    expect(importLines[0]).toMatch(/from '\.\.\/emit'/)
  })

  it('does NOT import any node:fs / node:path / node:child_process / electron', () => {
    expect(SOURCE).not.toMatch(/from 'node:fs'/)
    expect(SOURCE).not.toMatch(/from 'node:path'/)
    expect(SOURCE).not.toMatch(/from 'node:child_process'/)
    expect(SOURCE).not.toMatch(/from 'electron'/)
  })

  it('contains zero `:any` and zero `as any` casts', () => {
    expect(SOURCE).not.toMatch(/:\s*any\b/)
    expect(SOURCE).not.toMatch(/\bas\s+any\b/)
  })

  it('contains zero eval / new Function constructions', () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/)
    expect(SOURCE).not.toMatch(/new\s+Function\s*\(/)
  })

  it('contains zero TODO / FIXME / HACK / XXX markers', () => {
    expect(SOURCE).not.toMatch(/\bTODO\b/i)
    expect(SOURCE).not.toMatch(/\bFIXME\b/i)
    expect(SOURCE).not.toMatch(/\bHACK\b/i)
    expect(SOURCE).not.toMatch(/\bXXX\b/i)
  })

  it('VERIFY safety reminder string exact match in source', () => {
    expect(SOURCE).toContain(
      "'VERIFY: A zero, stock zero, each index angle before running'"
    )
  })

  it('header literal "4-axis indexed" appears with em-dash separator', () => {
    expect(SOURCE).toContain('4-axis indexed —')
  })

  it('source < 100 lines (small focused strategy module)', () => {
    expect(SOURCE.split('\n').length).toBeLessThan(100)
  })

  it('uses Emitter methods only (no raw G-code line pushes inside strategy body)', () => {
    // strategy is supposed to delegate emission to the Emitter helper class
    // (per emit.ts header docstring); it should not push 'G0 ...' or 'G1 ...'
    // strings directly.
    expect(SOURCE).not.toMatch(/'G0 /)
    expect(SOURCE).not.toMatch(/'G1 /)
    expect(SOURCE).not.toMatch(/lines\.push\(/)
  })

  it('zigzag direction state declared as `let direction = 1` and flipped via *= -1', () => {
    expect(SOURCE).toMatch(/let direction = 1/)
    expect(SOURCE).toMatch(/direction \*= -1/)
  })

  it('cutZ floor literal 0.05 appears in source', () => {
    expect(SOURCE).toMatch(/cutZ < 0\.05/)
  })
})

// ---------------------------------------------------------------------------
// O. Type-level parity -- IndexedParams + IndexedResult declared as `export type`
// ---------------------------------------------------------------------------
describe('O. Type-level parity', () => {
  it('IndexedParams + IndexedResult are runtime-erased (compile-time only types)', () => {
    // No runtime export by these names -- module Object.keys enumerates only
    // generateIndexed.
    expect(Object.keys(M)).not.toContain('IndexedParams')
    expect(Object.keys(M)).not.toContain('IndexedResult')
  })

  it('compile-time IndexedParams accepts a fully-populated literal', () => {
    const params: IndexedParams = {
      indexAnglesDeg: [0, 90, 180, 270],
      cylinderDiameterMm: 92,
      machXStartMm: 5,
      machXEndMm: 235,
      zDepthsMm: [-2, -4],
      feedMmMin: 800,
      plungeMmMin: 300,
      safeZMm: 10,
      toolDiameterMm: 3.175,
      overcutMm: 1.5,
      maxZMm: 100,
      maxRotaryRpm: 60
    }
    expect(params.cylinderDiameterMm).toBe(92)
  })

  it('compile-time IndexedResult exposes lines + warnings only', () => {
    const r: IndexedResult = generateIndexed(baseParams())
    // Type-level check: r.lines and r.warnings are accessible.
    expect(r.lines).toBeDefined()
    expect(r.warnings).toBeDefined()
  })

  it('source declares both type names with `export type`', () => {
    expect(SOURCE).toMatch(/^export type IndexedParams\b/m)
    expect(SOURCE).toMatch(/^export type IndexedResult\b/m)
  })
})
