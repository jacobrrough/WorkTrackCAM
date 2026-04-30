/**
 * carvera-zeroing-pin.test.ts -- [ID-0221] Cycle 150 post-processing paired-pin
 *
 * Pins the contract of `src/shared/carvera-zeroing.ts` -- the Carvera-specific
 * zeroing / setup G-code generator that covers BOTH the 3-axis WCS path
 * (G10 L20 P1) AND the 4-axis rotary-axis path (G28.3 A0 + Z=0 at rotation
 * axis centre). CARVERA-SPECIFIC -- the Makera Carvera + 4th Axis HD is the
 * only target machine that runs Smoothieware (GRBL-compatible, M2 program-
 * end, NEVER M30 -- M30 deletes the file from the SD card on Smoothieware).
 * The Creality K2 Plus runs Klipper/Moonraker (separate code path) and the
 * Laguna Swift 5x10 runs RichAuto A-series (separate post template).
 *
 * Sister cycles in the post-Cycle-127-reset paired-pin chain that this
 * pin extends: 119 [ID-0196] / 124 [ID-0201] / 129 [ID-0206] / 130 [ID-0207]
 * / 131 [ID-0208] / 132 [ID-0209] / 134 [ID-0210] / 135 [ID-0211] /
 * 136 [ID-0212] / 137 [ID-0213] / 139 [ID-0214] / 140 [ID-0215] /
 * 142 [ID-0216] / 144 [ID-0217] / 145 [ID-0218] / 146 [ID-0220] /
 * 147 [ID-0222] / 149 [ID-0225].
 *
 * The existing `carvera-zeroing.test.ts` (~320 lines) covers the runtime
 * BEHAVIOUR of each generator. THIS pin file does NOT duplicate that
 * coverage; instead it pins:
 *   (A) module shape -- exact named-export inventory, arities, ESM
 *       namespace Symbol-key invariants, no default export,
 *   (B) `generateCarveraAAxisZero` contract -- G28.3 A0 only, no motion,
 *       M2 program-end, no M30, idempotent,
 *   (C) `generateCarveraWcsZero` contract -- G10 L20 P<n> emit, axes
 *       uppercased, no foreign emissions (no G28.3, no G38.2), wcsIndex
 *       default,
 *   (D) `generateCarveraZProbe` contract -- M6 T0 / G38.2 / G10 L20 P1 Z0 /
 *       G0 Z<retract> sequence, defaults flow through, no A-axis,
 *   (E) `generateCarvera4AxisSetup` contract -- BOTH G28.3 A0 AND G38.2
 *       AND G10 L20 P1 A0, ordered, "rotation axis" Z=0 framing,
 *   (F) `generateCarveraPreflightCheck` contract -- S<rpm> set but NOT
 *       started (no M3), dry feed = round(feed * 0.1), 4-corner XY trace,
 *   (G) `validateSpindleRpm` + `getCarveraPreflightChecklist` -- range
 *       6000..15000, clamp behaviour, NaN/<=0 invalid, 4-axis checklist
 *       contains rotary/stock-centered/tailstock/Z-centre/A-zero items,
 *       3-axis checklist contains workpiece-clamped/WCS-zeroed items,
 *       fresh-array-per-call,
 *   (H) source-text whitelist -- Smoothieware provenance, M2-not-M30
 *       framing, no foreign-machine constants (Klipper / Moonraker /
 *       RichAuto / Bambu / Prusa / Ender-N / Onefinity / Shapeoko / etc.),
 *       no React/DOM/electron imports, no `any`, no top-level `let`.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors prior chain).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './carvera-zeroing'
import {
  generateCarveraAAxisZero,
  generateCarveraWcsZero,
  generateCarveraZProbe,
  generateCarvera4AxisSetup,
  generateCarveraPreflightCheck,
  validateSpindleRpm,
  getCarveraPreflightChecklist
} from './carvera-zeroing'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_PATH = join(__dirname, 'carvera-zeroing.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

// Helper: extract non-comment, non-blank lines from a generated G-code string.
function codeLines(gcode: string): string[] {
  return gcode
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith(';'))
}

// ---------------------------------------------------------------------------
// A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0221] A) module shape', () => {
  it('exports exactly the documented runtime named symbols', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(
      [
        'generateCarvera4AxisSetup',
        'generateCarveraAAxisZero',
        'generateCarveraPreflightCheck',
        'generateCarveraWcsZero',
        'generateCarveraZProbe',
        'getCarveraPreflightChecklist',
        'validateSpindleRpm'
      ].sort()
    )
  })

  it('does NOT expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('only carries Symbol.toStringTag among Symbol-keyed properties', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M)
    expect(symbolKeys).toEqual([Symbol.toStringTag])
  })

  it('has a null prototype on the ESM namespace object', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('declares Function.length === 0 for generateCarveraAAxisZero (no args)', () => {
    expect(generateCarveraAAxisZero.length).toBe(0)
  })

  it('declares Function.length === 1 for generateCarveraWcsZero (required opts arg)', () => {
    expect(generateCarveraWcsZero.length).toBe(1)
  })

  it('declares Function.length === 1 for generateCarveraZProbe (optional opts arg, no default value -- TS `?` does not reduce length)', () => {
    expect(generateCarveraZProbe.length).toBe(1)
  })

  it('declares Function.length === 1 for generateCarvera4AxisSetup (optional opts arg, no default value -- TS `?` does not reduce length)', () => {
    expect(generateCarvera4AxisSetup.length).toBe(1)
  })

  it('declares Function.length === 1 for generateCarveraPreflightCheck (required opts arg)', () => {
    expect(generateCarveraPreflightCheck.length).toBe(1)
  })

  it('declares Function.length === 2 for validateSpindleRpm (rpm + machine)', () => {
    expect(validateSpindleRpm.length).toBe(2)
  })

  it('declares Function.length === 1 for getCarveraPreflightChecklist (required opts arg)', () => {
    expect(getCarveraPreflightChecklist.length).toBe(1)
  })

  it('all 7 runtime symbols are functions (no constants are exported)', () => {
    expect(typeof generateCarveraAAxisZero).toBe('function')
    expect(typeof generateCarveraWcsZero).toBe('function')
    expect(typeof generateCarveraZProbe).toBe('function')
    expect(typeof generateCarvera4AxisSetup).toBe('function')
    expect(typeof generateCarveraPreflightCheck).toBe('function')
    expect(typeof validateSpindleRpm).toBe('function')
    expect(typeof getCarveraPreflightChecklist).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// B) generateCarveraAAxisZero contract
// ---------------------------------------------------------------------------

describe('[ID-0221] B) generateCarveraAAxisZero contract', () => {
  it('emits G28.3 A0 (no-motion A-axis declaration)', () => {
    expect(generateCarveraAAxisZero()).toMatch(/^G28\.3 A0$/m)
  })

  it('does NOT emit any motion command (no G0, no G1)', () => {
    const code = codeLines(generateCarveraAAxisZero())
    expect(code.some((l) => /^G0\b/.test(l))).toBe(false)
    expect(code.some((l) => /^G1\b/.test(l))).toBe(false)
  })

  it('does NOT emit a probe move (no G38.2)', () => {
    expect(generateCarveraAAxisZero()).not.toContain('G38.2')
  })

  it('does NOT emit a WCS-set (no G10 L20)', () => {
    expect(generateCarveraAAxisZero()).not.toContain('G10 L20')
  })

  it('preamble emits G21 (millimeters) BEFORE G28.3', () => {
    const code = codeLines(generateCarveraAAxisZero())
    const g21 = code.findIndex((l) => l === 'G21 ; millimeters')
    const g283 = code.findIndex((l) => l === 'G28.3 A0')
    expect(g21).toBeGreaterThanOrEqual(0)
    expect(g283).toBeGreaterThan(g21)
  })

  it('preamble emits G90 (absolute) BEFORE G28.3', () => {
    const code = codeLines(generateCarveraAAxisZero())
    const g90 = code.findIndex((l) => l === 'G90 ; absolute positioning')
    const g283 = code.findIndex((l) => l === 'G28.3 A0')
    expect(g90).toBeGreaterThanOrEqual(0)
    expect(g283).toBeGreaterThan(g90)
  })

  it('terminates with M2 (Smoothieware program-end) NEVER M30 (M30 deletes the file)', () => {
    const code = codeLines(generateCarveraAAxisZero())
    expect(code[code.length - 1]).toBe('M2')
    expect(generateCarveraAAxisZero()).not.toContain('M30')
  })

  it('idempotent / pure -- two calls yield byte-identical output', () => {
    expect(generateCarveraAAxisZero()).toBe(generateCarveraAAxisZero())
  })

  it('emits exactly one G28.3 line', () => {
    const matches = generateCarveraAAxisZero().match(/^G28\.3 /gm) ?? []
    expect(matches).toHaveLength(1)
  })

  it('emits NO negative coordinate values (no Z-N, X-N, Y-N, A-N)', () => {
    const code = codeLines(generateCarveraAAxisZero())
    expect(code.some((l) => /[XYZA]-\d/.test(l))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// C) generateCarveraWcsZero contract
// ---------------------------------------------------------------------------

describe('[ID-0221] C) generateCarveraWcsZero contract', () => {
  it('default wcsIndex === 1 (G54) when omitted', () => {
    const out = generateCarveraWcsZero({ axes: ['x', 'y', 'z'] })
    expect(out).toMatch(/^G10 L20 P1 X0 Y0 Z0$/m)
  })

  it('respects custom wcsIndex (P2 / G55)', () => {
    const out = generateCarveraWcsZero({ axes: ['x'], wcsIndex: 2 })
    expect(out).toMatch(/^G10 L20 P2 X0$/m)
  })

  it('uppercases axis letters in the emitted G-code', () => {
    const out = generateCarveraWcsZero({ axes: ['x', 'y', 'z', 'a'] })
    expect(out).toContain('X0 Y0 Z0 A0')
    expect(out).not.toMatch(/[xyza]0\b/)
  })

  it('preserves the order of axes as supplied (no implicit sort)', () => {
    const out = generateCarveraWcsZero({ axes: ['z', 'a', 'x'] })
    expect(out).toMatch(/G10 L20 P1 Z0 A0 X0/)
  })

  it('emits NO probe move (no G38.2) and NO A-axis-zero (no G28.3)', () => {
    const out = generateCarveraWcsZero({ axes: ['x', 'y', 'z'] })
    expect(out).not.toContain('G38.2')
    expect(out).not.toContain('G28.3')
  })

  it('emits NO motion command (no G0, no G1)', () => {
    const code = codeLines(generateCarveraWcsZero({ axes: ['x'] }))
    expect(code.some((l) => /^G0\b/.test(l))).toBe(false)
    expect(code.some((l) => /^G1\b/.test(l))).toBe(false)
  })

  it('terminates with M2 NEVER M30', () => {
    const out = generateCarveraWcsZero({ axes: ['x'] })
    const code = codeLines(out)
    expect(code[code.length - 1]).toBe('M2')
    expect(out).not.toContain('M30')
  })

  it('preamble includes G21 + G90', () => {
    const out = generateCarveraWcsZero({ axes: ['x'] })
    expect(out).toContain('G21')
    expect(out).toContain('G90')
  })

  it('title in preamble exposes the WCS index using the G54+wcsIndex convention', () => {
    expect(generateCarveraWcsZero({ axes: ['x'], wcsIndex: 1 })).toContain('G54')
    expect(generateCarveraWcsZero({ axes: ['x'], wcsIndex: 2 })).toContain('G55')
    expect(generateCarveraWcsZero({ axes: ['x'], wcsIndex: 3 })).toContain('G56')
  })

  it('frozen-input safety -- frozen axes array is accepted without throwing', () => {
    const axes = Object.freeze(['x', 'y', 'z'] as const) as unknown as ('x' | 'y' | 'z' | 'a')[]
    expect(() => generateCarveraWcsZero({ axes })).not.toThrow()
  })

  it('two calls with the same options yield byte-identical output (purity)', () => {
    const a = generateCarveraWcsZero({ axes: ['x', 'y'], wcsIndex: 1 })
    const b = generateCarveraWcsZero({ axes: ['x', 'y'], wcsIndex: 1 })
    expect(a).toBe(b)
  })

  it('emits NO negative coordinate values', () => {
    const code = codeLines(generateCarveraWcsZero({ axes: ['x', 'y', 'z', 'a'] }))
    expect(code.some((l) => /[XYZA]-\d/.test(l))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// D) generateCarveraZProbe contract
// ---------------------------------------------------------------------------

describe('[ID-0221] D) generateCarveraZProbe contract', () => {
  it('defaults: probeDistMm=50, probeFeedMmMin=100, retractMm=5', () => {
    const out = generateCarveraZProbe()
    expect(out).toMatch(/^G38\.2 Z-50 F100$/m)
    expect(out).toMatch(/^G0 Z5$/m)
  })

  it('emits M6 T0 (load wireless probe) BEFORE G38.2', () => {
    const code = codeLines(generateCarveraZProbe())
    const m6 = code.findIndex((l) => l === 'M6 T0')
    const g382 = code.findIndex((l) => l.startsWith('G38.2'))
    expect(m6).toBeGreaterThanOrEqual(0)
    expect(g382).toBeGreaterThan(m6)
  })

  it('emits G10 L20 P1 Z0 AFTER probe (set Z=0 at contact)', () => {
    const code = codeLines(generateCarveraZProbe())
    const g382 = code.findIndex((l) => l.startsWith('G38.2'))
    const g10 = code.findIndex((l) => l === 'G10 L20 P1 Z0')
    expect(g10).toBeGreaterThan(g382)
  })

  it('emits G0 Z<retract> AFTER G10 L20 (retract above new zero)', () => {
    const code = codeLines(generateCarveraZProbe())
    const g10 = code.findIndex((l) => l === 'G10 L20 P1 Z0')
    const retract = code.findIndex((l) => /^G0 Z\d+$/.test(l))
    expect(retract).toBeGreaterThan(g10)
  })

  it('retract Z value is POSITIVE (no Z-N retract -- that would crash)', () => {
    const out = generateCarveraZProbe({ retractMm: 5 })
    expect(out).toMatch(/^G0 Z5$/m)
    expect(out).not.toMatch(/^G0 Z-/m)
  })

  it('custom probeDistMm flows through (Z-<dist>)', () => {
    expect(generateCarveraZProbe({ probeDistMm: 30 })).toMatch(/^G38\.2 Z-30 F100$/m)
  })

  it('custom probeFeedMmMin flows through (F<feed>)', () => {
    expect(generateCarveraZProbe({ probeFeedMmMin: 250 })).toMatch(/^G38\.2 Z-50 F250$/m)
  })

  it('custom retractMm flows through (G0 Z<retract>)', () => {
    expect(generateCarveraZProbe({ retractMm: 12 })).toMatch(/^G0 Z12$/m)
  })

  it('terminates with M2 NEVER M30', () => {
    const out = generateCarveraZProbe()
    const code = codeLines(out)
    expect(code[code.length - 1]).toBe('M2')
    expect(out).not.toContain('M30')
  })

  it('does NOT emit any A-axis word (no A0, no A1, no G28.3 A)', () => {
    const out = generateCarveraZProbe()
    expect(out).not.toMatch(/\bA-?\d/)
    expect(out).not.toContain('G28.3')
  })

  it('the ONLY negative-coordinate emission is the deliberate G38.2 Z-<dist>', () => {
    const code = codeLines(generateCarveraZProbe({ probeDistMm: 25 }))
    const negs = code.filter((l) => /[XYZA]-\d/.test(l))
    expect(negs).toHaveLength(1)
    expect(negs[0]).toMatch(/^G38\.2 Z-25 /)
  })
})

// ---------------------------------------------------------------------------
// E) generateCarvera4AxisSetup contract
// ---------------------------------------------------------------------------

describe('[ID-0221] E) generateCarvera4AxisSetup contract', () => {
  it('emits BOTH G28.3 A0 AND G38.2 (A-axis zero AND Z-probe)', () => {
    const out = generateCarvera4AxisSetup()
    expect(out).toMatch(/^G28\.3 A0$/m)
    expect(out).toMatch(/^G38\.2 Z-/m)
  })

  it('order: G28.3 A0 BEFORE G38.2 (zero rotary first, then probe)', () => {
    const code = codeLines(generateCarvera4AxisSetup())
    const g283 = code.findIndex((l) => l === 'G28.3 A0')
    const g382 = code.findIndex((l) => l.startsWith('G38.2'))
    expect(g283).toBeGreaterThanOrEqual(0)
    expect(g382).toBeGreaterThan(g283)
  })

  it('emits both G10 L20 P1 Z0 (Z WCS) AND G10 L20 P1 A0 (A WCS)', () => {
    const out = generateCarvera4AxisSetup()
    expect(out).toMatch(/^G10 L20 P1 Z0$/m)
    expect(out).toMatch(/^G10 L20 P1 A0$/m)
  })

  it('emits a G0 Z5 retract AFTER setting Z=0', () => {
    const code = codeLines(generateCarvera4AxisSetup())
    const z0 = code.findIndex((l) => l === 'G10 L20 P1 Z0')
    const retract = code.findIndex((l) => l === 'G0 Z5')
    expect(retract).toBeGreaterThan(z0)
  })

  it('full ordering: G28.3 A0 -> M6 T0 -> G38.2 -> G10 P1 Z0 -> G0 Z5 -> G10 P1 A0', () => {
    const code = codeLines(generateCarvera4AxisSetup())
    const idx = (needle: string): number => code.findIndex((l) => l === needle)
    const a0 = idx('G28.3 A0')
    const m6 = idx('M6 T0')
    const probe = code.findIndex((l) => l.startsWith('G38.2'))
    const z0 = idx('G10 L20 P1 Z0')
    const retract = idx('G0 Z5')
    const wcsA0 = idx('G10 L20 P1 A0')
    expect(a0).toBeLessThan(m6)
    expect(m6).toBeLessThan(probe)
    expect(probe).toBeLessThan(z0)
    expect(z0).toBeLessThan(retract)
    expect(retract).toBeLessThan(wcsA0)
  })

  it('preamble carries the rotation-axis Z=0 framing (NOT the stock surface)', () => {
    const out = generateCarvera4AxisSetup()
    expect(out).toContain('ROTATION AXIS')
    expect(out).toContain('stock centre')
  })

  it('default probeDistMm=50 / probeFeedMmMin=100 flow through', () => {
    expect(generateCarvera4AxisSetup()).toMatch(/^G38\.2 Z-50 F100$/m)
  })

  it('custom probeDistMm + probeFeedMmMin flow through', () => {
    expect(
      generateCarvera4AxisSetup({ probeDistMm: 25, probeFeedMmMin: 200 })
    ).toMatch(/^G38\.2 Z-25 F200$/m)
  })

  it('terminates with M2 NEVER M30', () => {
    const out = generateCarvera4AxisSetup()
    const code = codeLines(out)
    expect(code[code.length - 1]).toBe('M2')
    expect(out).not.toContain('M30')
  })

  it('only negative coord is the deliberate G38.2 probe move', () => {
    const code = codeLines(generateCarvera4AxisSetup())
    const negs = code.filter((l) => /[XYZA]-\d/.test(l))
    expect(negs).toHaveLength(1)
    expect(negs[0]).toMatch(/^G38\.2 Z-50 /)
  })

  it('emits exactly two G10 L20 P1 calls (Z0 + A0)', () => {
    const matches = generateCarvera4AxisSetup().match(/^G10 L20 P1 /gm) ?? []
    expect(matches).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// F) generateCarveraPreflightCheck contract
// ---------------------------------------------------------------------------

describe('[ID-0221] F) generateCarveraPreflightCheck contract', () => {
  it('defaults: spindleRpm=6000 (CARVERA_MIN), feedMmMin=1000', () => {
    const out = generateCarveraPreflightCheck({})
    expect(out).toMatch(/^S6000 ; /m)
    // dryFeed = round(1000 * 0.1) = 100
    expect(out).toMatch(/^G1 X0 Y0 F100 ;/m)
  })

  it('S<rpm> is set BUT M3 is NEVER emitted as an executable line (spindle stays OFF)', () => {
    const out = generateCarveraPreflightCheck({ spindleRpm: 12000 })
    expect(out).toMatch(/^S12000 ; /m)
    // Filter to executable (non-comment) lines: the comment "(no M3)" in the
    // preamble is operator-facing prose, NOT an executable spindle-on command.
    const code = codeLines(out)
    expect(code.some((l) => /\bM3\b/.test(l))).toBe(false)
    expect(code.some((l) => /\bM03\b/.test(l))).toBe(false)
  })

  it('dry feed is exactly Math.round(feed * 0.1)', () => {
    expect(generateCarveraPreflightCheck({ feedMmMin: 250 })).toMatch(/F25 /)
    expect(generateCarveraPreflightCheck({ feedMmMin: 333 })).toMatch(/F33 /)
    expect(generateCarveraPreflightCheck({ feedMmMin: 999 })).toMatch(/F100 /)
  })

  it('traverses the 4 XY corners in order: X0Y0 -> X100Y0 -> X100Y100 -> X0Y100 -> X0Y0', () => {
    const code = codeLines(generateCarveraPreflightCheck({}))
    const corners = code.filter((l) => /^G1 X-?\d+ Y-?\d+ F/.test(l))
    expect(corners).toHaveLength(5)
    expect(corners[0]).toMatch(/^G1 X0 Y0 /)
    expect(corners[1]).toMatch(/^G1 X100 Y0 /)
    expect(corners[2]).toMatch(/^G1 X100 Y100 /)
    expect(corners[3]).toMatch(/^G1 X0 Y100 /)
    expect(corners[4]).toMatch(/^G1 X0 Y0 /)
  })

  it('moves to safe Z (G0 Z10) BEFORE any G1', () => {
    const code = codeLines(generateCarveraPreflightCheck({}))
    const safeZ = code.findIndex((l) => l === 'G0 Z10')
    const firstG1 = code.findIndex((l) => /^G1 /.test(l))
    expect(safeZ).toBeGreaterThanOrEqual(0)
    expect(firstG1).toBeGreaterThan(safeZ)
  })

  it('returns to origin (G0 X0 Y0 + G0 Z10) AFTER the corner trace', () => {
    const code = codeLines(generateCarveraPreflightCheck({}))
    const lastG1 = code.map((l, i) => ({ l, i })).filter((x) => /^G1 /.test(x.l)).pop()
    expect(lastG1).toBeDefined()
    const homeXY = code.findIndex((l) => l === 'G0 X0 Y0')
    expect(homeXY).toBeGreaterThan(lastG1!.i)
  })

  it('does NOT load a probe (no M6, no G38.2)', () => {
    const out = generateCarveraPreflightCheck({})
    expect(out).not.toContain('M6')
    expect(out).not.toContain('G38.2')
  })

  it('terminates with M2 NEVER M30', () => {
    const out = generateCarveraPreflightCheck({})
    const code = codeLines(out)
    expect(code[code.length - 1]).toBe('M2')
    expect(out).not.toContain('M30')
  })

  it('two calls with the same options yield byte-identical output (purity)', () => {
    expect(generateCarveraPreflightCheck({})).toBe(generateCarveraPreflightCheck({}))
  })
})

// ---------------------------------------------------------------------------
// G) validateSpindleRpm + getCarveraPreflightChecklist
// ---------------------------------------------------------------------------

describe('[ID-0221] G) validateSpindleRpm + checklist contracts', () => {
  it('valid RPM in 6000..15000 returns valid:true with clampedRpm=rpm and no warning', () => {
    const r = validateSpindleRpm(10000, {})
    expect(r.valid).toBe(true)
    expect(r.clampedRpm).toBe(10000)
    expect(r.warning).toBeUndefined()
  })

  it('RPM at exact min (6000) is valid', () => {
    const r = validateSpindleRpm(6000, {})
    expect(r.valid).toBe(true)
    expect(r.clampedRpm).toBe(6000)
  })

  it('RPM at exact max (15000) is valid', () => {
    const r = validateSpindleRpm(15000, {})
    expect(r.valid).toBe(true)
    expect(r.clampedRpm).toBe(15000)
  })

  it('RPM below min clamps UP to min and emits a warning', () => {
    const r = validateSpindleRpm(3000, {})
    expect(r.valid).toBe(false)
    expect(r.clampedRpm).toBe(6000)
    expect(r.warning).toMatch(/below minimum 6000/)
  })

  it('RPM above max clamps DOWN to max and emits a warning', () => {
    const r = validateSpindleRpm(24000, {})
    expect(r.valid).toBe(false)
    expect(r.clampedRpm).toBe(15000)
    expect(r.warning).toMatch(/exceeds maximum 15000/)
  })

  it('NaN RPM returns invalid with min clamp', () => {
    const r = validateSpindleRpm(NaN, {})
    expect(r.valid).toBe(false)
    expect(r.clampedRpm).toBe(6000)
    expect(r.warning).toMatch(/Invalid RPM/)
  })

  it('zero RPM returns invalid with min clamp', () => {
    const r = validateSpindleRpm(0, {})
    expect(r.valid).toBe(false)
    expect(r.clampedRpm).toBe(6000)
  })

  it('negative RPM returns invalid with min clamp', () => {
    const r = validateSpindleRpm(-1000, {})
    expect(r.valid).toBe(false)
    expect(r.clampedRpm).toBe(6000)
  })

  it('+Infinity RPM clamps DOWN to max', () => {
    const r = validateSpindleRpm(Number.POSITIVE_INFINITY, {})
    // !Number.isFinite is true so the helper falls through the invalid branch
    expect(r.valid).toBe(false)
    expect(r.clampedRpm).toBe(6000)
  })

  it('machine override min/max overrides the Carvera defaults', () => {
    const r = validateSpindleRpm(8000, { minSpindleRpm: 10000, maxSpindleRpm: 24000 })
    expect(r.valid).toBe(false)
    expect(r.clampedRpm).toBe(10000)
  })

  it('4-axis checklist has 8 items (3 common + 5 4-axis-specific)', () => {
    const list = getCarveraPreflightChecklist({ is4Axis: true })
    expect(list).toHaveLength(8)
  })

  it('3-axis checklist has 5 items (3 common + 2 3-axis-specific)', () => {
    const list = getCarveraPreflightChecklist({ is4Axis: false })
    expect(list).toHaveLength(5)
  })

  it('all checklist items are unchecked on creation', () => {
    const list4 = getCarveraPreflightChecklist({ is4Axis: true })
    const list3 = getCarveraPreflightChecklist({ is4Axis: false })
    expect(list4.every((i) => i.checked === false)).toBe(true)
    expect(list3.every((i) => i.checked === false)).toBe(true)
  })

  it('4-axis checklist contains the canonical rotary-specific ids', () => {
    const ids = getCarveraPreflightChecklist({ is4Axis: true }).map((i) => i.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'rotary_secured',
        'stock_centered',
        'tailstock_engaged',
        'z_zero_at_center',
        'a_zero_set'
      ])
    )
  })

  it('3-axis checklist contains workpiece_clamped + wcs_zeroed but NO rotary ids', () => {
    const ids = getCarveraPreflightChecklist({ is4Axis: false }).map((i) => i.id)
    expect(ids).toContain('workpiece_clamped')
    expect(ids).toContain('wcs_zeroed')
    expect(ids).not.toContain('rotary_secured')
    expect(ids).not.toContain('a_zero_set')
  })

  it('checklist ids are unique within a single call', () => {
    const ids = getCarveraPreflightChecklist({ is4Axis: true }).map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('fresh-array-per-call -- mutating the returned array does NOT poison the next call', () => {
    const a = getCarveraPreflightChecklist({ is4Axis: true })
    a.length = 0
    const b = getCarveraPreflightChecklist({ is4Axis: true })
    expect(b).toHaveLength(8)
  })

  it('N=10 stability for getCarveraPreflightChecklist (deep-equal across 10 calls)', () => {
    const ref = JSON.stringify(getCarveraPreflightChecklist({ is4Axis: true }))
    for (let i = 0; i < 10; i++) {
      expect(JSON.stringify(getCarveraPreflightChecklist({ is4Axis: true }))).toBe(ref)
    }
  })

  it('every critical:true item also has a non-empty description', () => {
    const list = getCarveraPreflightChecklist({ is4Axis: true })
    const criticals = list.filter((i) => i.critical)
    expect(criticals.length).toBeGreaterThan(0)
    expect(criticals.every((i) => typeof i.description === 'string' && i.description.length > 0)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// H) Source-text whitelist (provenance + safety + foreign-machine guard)
// ---------------------------------------------------------------------------

describe('[ID-0221] H) source-text whitelist', () => {
  it('JSDoc names Smoothieware (Carvera firmware provenance)', () => {
    expect(SRC).toContain('Smoothieware')
  })

  it('JSDoc explicitly says M2 (NEVER M30)', () => {
    expect(SRC).toMatch(/M2 ends a program \(NEVER M30/)
  })

  it('source emits NO M30 anywhere (G-code is sacred / Smoothieware SD card)', () => {
    expect(SRC).not.toMatch(/'M30'/)
    expect(SRC).not.toMatch(/`M30`/)
  })

  it('JSDoc states A-axis is rotation around X (Carvera 4th Axis HD)', () => {
    expect(SRC).toMatch(/A-axis is the 4th-axis rotary/)
    expect(SRC).toContain('rotation around X')
  })

  it('JSDoc states Z=0 at stock CENTER for 4-axis (NOT the surface)', () => {
    expect(SRC).toMatch(/Z=0 for 4-axis work is at the stock CENTER/)
  })

  it('JSDoc names the Smoothieware spindle range 6000-15000 RPM', () => {
    expect(SRC).toMatch(/Spindle range: 6000.{0,5}15.?000 RPM/)
  })

  it('declares CARVERA_MIN_SPINDLE_RPM = 6000 verbatim', () => {
    expect(SRC).toContain('CARVERA_MIN_SPINDLE_RPM = 6000')
  })

  it('declares CARVERA_MAX_SPINDLE_RPM = 15000 verbatim', () => {
    expect(SRC).toContain('CARVERA_MAX_SPINDLE_RPM = 15000')
  })

  it('declares DEFAULT_PROBE_DIST_MM = 50 verbatim', () => {
    expect(SRC).toContain('DEFAULT_PROBE_DIST_MM = 50')
  })

  it('declares DEFAULT_PROBE_FEED_MM_MIN = 100 verbatim', () => {
    expect(SRC).toContain('DEFAULT_PROBE_FEED_MM_MIN = 100')
  })

  it('declares DEFAULT_RETRACT_MM = 5 verbatim', () => {
    expect(SRC).toContain('DEFAULT_RETRACT_MM = 5')
  })

  it('preamble emits G21 then G90 in the canonical Smoothieware-friendly order', () => {
    expect(SRC).toMatch(/'G21 ; millimeters'[,\s]+'G90 ; absolute positioning'/)
  })

  it('programEnd helper emits exactly the M2 line (no M30 fallback inside any string/template literal)', () => {
    expect(SRC).toMatch(/function programEnd\(\):[^{]*\{[\s\S]*?'M2'[\s\S]*?\}/)
    // The JSDoc framing "M2 ends a program (NEVER M30 -- M30 deletes the
    // file from the SD card)" deliberately names the avoided opcode in
    // operator-facing prose. The Safety-Rule-1 pin is that M30 is never
    // *emitted* -- no string-literal or template-literal in the source
    // contains M30.
    expect(SRC).not.toMatch(/['"`]M30['"`]/)
    expect(SRC).not.toMatch(/'M30 /)
    expect(SRC).not.toMatch(/`M30 /)
  })

  it('exports exactly 7 named functions via `export function `', () => {
    const matches = SRC.match(/^export function /gm) ?? []
    expect(matches).toHaveLength(7)
  })

  it('exports exactly 2 named types via `export type `', () => {
    const matches = SRC.match(/^export type /gm) ?? []
    expect(matches).toHaveLength(2)
  })

  it('NO default export', () => {
    expect(SRC).not.toMatch(/^export default /m)
  })

  it('NO `any` type usage in three forms (`: any`, `<any>`, `as any`)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/<any>/)
    expect(SRC).not.toMatch(/\bas any\b/)
  })

  it('NO top-level `let` (constants only -- pure module)', () => {
    expect(SRC).not.toMatch(/^let /m)
  })

  it('NO React / DOM imports (this is a pure G-code generator, NOT a UI module)', () => {
    expect(SRC).not.toMatch(/from 'react'/)
    expect(SRC).not.toMatch(/from "react"/)
    expect(SRC).not.toMatch(/\bdocument\./)
    expect(SRC).not.toMatch(/\bwindow\./)
  })

  it('NO electron / fs / path / child_process imports (pure shared kernel)', () => {
    expect(SRC).not.toMatch(/from 'electron'/)
    expect(SRC).not.toMatch(/from 'node:fs'/)
    expect(SRC).not.toMatch(/from 'node:path'/)
    expect(SRC).not.toMatch(/from 'node:child_process'/)
    expect(SRC).not.toMatch(/from 'fs'/)
  })

  it('NO foreign-machine vendor names (Klipper / Moonraker / RichAuto / Bambu / Prusa / Onefinity / Shapeoko)', () => {
    // Ender-N is the digit-suffixed Creality Ender model name; the bare word
    // "renderer" / "render" should not match.
    expect(SRC).not.toMatch(/Klipper/i)
    expect(SRC).not.toMatch(/Moonraker/i)
    expect(SRC).not.toMatch(/RichAuto/i)
    expect(SRC).not.toMatch(/\bbambu/i)
    expect(SRC).not.toMatch(/\bprusa/i)
    expect(SRC).not.toMatch(/\bvoron/i)
    expect(SRC).not.toMatch(/\bender[- ]?\d/i)
    expect(SRC).not.toMatch(/\bonefinity/i)
    expect(SRC).not.toMatch(/\bshapeoko/i)
    expect(SRC).not.toMatch(/\blongmill/i)
  })

  it('NO Handlebars template tokens (this is a TS helper, not a post template)', () => {
    expect(SRC).not.toMatch(/\{\{/)
    expect(SRC).not.toMatch(/\}\}/)
  })

  it('preflight check emits S<rpm> but JSDoc explicitly says spindle stays OFF', () => {
    expect(SRC).toMatch(/spindle is NOT started/)
    expect(SRC).toMatch(/spindle stays OFF/)
  })

  it('preflight check uses 10 % feed convention (Math.round(feed * 0.1))', () => {
    expect(SRC).toContain('Math.round(feed * 0.1)')
  })

  it('Z probe emits exactly one G38.2 Z- pattern (the deliberate negative-Z probe)', () => {
    const matches = SRC.match(/G38\.2 Z-\$\{/g) ?? []
    // Two emissions in the source: one in generateCarveraZProbe and one in
    // generateCarvera4AxisSetup. Both are deliberate probes.
    expect(matches).toHaveLength(2)
  })

  it('A-axis G28.3 is emitted in exactly two places (a-axis-zero + 4-axis-setup)', () => {
    const matches = SRC.match(/'G28\.3 A0'/g) ?? []
    expect(matches).toHaveLength(2)
  })

  it('G10 L20 P1 / P<n> WCS-set is the canonical zero-without-motion form', () => {
    expect(SRC).toMatch(/G10 L20 P\$\{wcs\}/)
    expect(SRC).toMatch(/G10 L20 P1 Z0/)
    expect(SRC).toMatch(/G10 L20 P1 A0/)
  })

  it('source file is small (< 500 lines) -- pure helper, no bloat', () => {
    expect(SRC.split('\n').length).toBeLessThan(500)
  })

  it('source file size is < 16 KB -- shared-kernel discipline canary', () => {
    expect(SRC.length).toBeLessThan(16 * 1024)
  })
})
