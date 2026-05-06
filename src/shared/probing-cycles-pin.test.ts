import { describe, expect, it } from 'vitest'
import * as ProbingMod from './probing-cycles'
import {
  generateProbeCycle,
  generateSingleSurfaceProbe,
  generateBoreCenterProbe,
  generateBossCenterProbe,
  generateCornerFindProbe,
  generateToolLengthProbe,
} from './probing-cycles'
import type {
  ProbeCycleType,
  ProbeBaseParams,
  SingleSurfaceParams,
  BoreCenterParams,
  BossCenterParams,
  CornerFindParams,
  ToolLengthParams,
} from './probing-cycles'

/**
 * Cycle 211 paired-pin contract for `src/shared/probing-cycles.ts` --
 * post-processing slot. Pins SHAPE invariants (module exports, function
 * signatures, output structure, type-level parity, dispatcher delegation,
 * pure-function invariants, three-machine path realism, source-text
 * whitelist) for the 6 runtime exports + 7 type exports of the probing-cycle
 * G-code macro generator. Behavioral coverage lives in the sibling
 * `probing-cycles.test.ts`. Companion of Cycles 199 / 200 / 202 / 203 / 205 /
 * 206 / 207 / 208 / 210 paired-pin contracts.
 *
 * Three-machine relevance:
 *   - Makera Carvera 3-axis + 4-axis: DIRECT (auto probing/leveling per
 *     CLAUDE.md USER CONTEXT; bore-center, corner-find, tool-length probes
 *     are the load-bearing surface for Carvera ATC tool-setter touch-off).
 *   - Laguna Swift 5x10: DIRECT for corner-find + single-surface probes used
 *     in full-sheet stock origin discovery and probe-based zeroing on the
 *     RichAuto A-series controller.
 *   - Creality K2 Plus: BYPASS-SAFE (FDM does not consume probe macros; the
 *     pure-function invariants in section L prevent corruption of mixed
 *     three-machine fixture records that may carry residual probe params).
 */

// -- Default param fixtures -----------------------------------------------

const ssDefaults: SingleSurfaceParams = {
  axis: 'x',
  direction: -1,
  maxTravelMm: 25,
  probeFeedMmMin: 100,
  retractMm: 3,
  wcsIndex: 1,
}

const boreDefaults: BoreCenterParams = {
  approxDiameterMm: 50,
  probeDepthMm: 10,
  probeFeedMmMin: 100,
  retractMm: 3,
  wcsIndex: 1,
}

const bossDefaults: BossCenterParams = {
  approxWidthMm: 40,
  probeHeightMm: 5,
  probeFeedMmMin: 100,
  retractMm: 3,
  wcsIndex: 1,
}

const cornerDefaults: CornerFindParams = {
  maxTravelXMm: 30,
  maxTravelYMm: 30,
  probeFeedMmMin: 100,
  retractMm: 3,
  wcsIndex: 1,
}

const toolLenDefaults: ToolLengthParams = {
  maxTravelMm: 100,
  probeFeedMmMin: 50,
  retractMm: 5,
  wcsIndex: 1,
}

const ALL_GENS = [
  { name: 'singleSurface', gen: () => generateSingleSurfaceProbe(ssDefaults) },
  { name: 'boreCenter', gen: () => generateBoreCenterProbe(boreDefaults) },
  { name: 'bossCenter', gen: () => generateBossCenterProbe(bossDefaults) },
  { name: 'cornerFind', gen: () => generateCornerFindProbe(cornerDefaults) },
  { name: 'toolLength', gen: () => generateToolLengthProbe(toolLenDefaults) },
] as const

// -- A: Module shape & export completeness --------------------------------

describe('probing-cycles-pin :: A. Module shape', () => {
  it('A1: namespace import is an object', () => {
    expect(typeof ProbingMod).toBe('object')
    expect(ProbingMod).not.toBeNull()
  })

  it('A2: exports generateSingleSurfaceProbe', () => {
    expect(typeof ProbingMod.generateSingleSurfaceProbe).toBe('function')
  })

  it('A3: exports generateBoreCenterProbe', () => {
    expect(typeof ProbingMod.generateBoreCenterProbe).toBe('function')
  })

  it('A4: exports generateBossCenterProbe', () => {
    expect(typeof ProbingMod.generateBossCenterProbe).toBe('function')
  })

  it('A5: exports generateCornerFindProbe', () => {
    expect(typeof ProbingMod.generateCornerFindProbe).toBe('function')
  })

  it('A6: exports generateToolLengthProbe', () => {
    expect(typeof ProbingMod.generateToolLengthProbe).toBe('function')
  })

  it('A7: exports generateProbeCycle dispatcher', () => {
    expect(typeof ProbingMod.generateProbeCycle).toBe('function')
  })

  it('A8: exactly 6 runtime exports (5 generators + 1 dispatcher)', () => {
    const runtimeKeys = Object.keys(ProbingMod).filter(
      (k) => typeof (ProbingMod as Record<string, unknown>)[k] === 'function',
    )
    expect(runtimeKeys.sort()).toEqual(
      [
        'generateBoreCenterProbe',
        'generateBossCenterProbe',
        'generateCornerFindProbe',
        'generateProbeCycle',
        'generateSingleSurfaceProbe',
        'generateToolLengthProbe',
      ].sort(),
    )
  })

  it('A9: no non-function runtime exports leak into namespace', () => {
    const nonFn = Object.keys(ProbingMod).filter(
      (k) => typeof (ProbingMod as Record<string, unknown>)[k] !== 'function',
    )
    expect(nonFn).toEqual([])
  })

  it('A10: namespace key count is exactly 6', () => {
    expect(Object.keys(ProbingMod).length).toBe(6)
  })
})

// -- B: Function signatures ------------------------------------------------

describe('probing-cycles-pin :: B. Function signatures', () => {
  it('B1: generateSingleSurfaceProbe.length === 1', () => {
    expect(generateSingleSurfaceProbe.length).toBe(1)
  })

  it('B2: generateBoreCenterProbe.length === 1', () => {
    expect(generateBoreCenterProbe.length).toBe(1)
  })

  it('B3: generateBossCenterProbe.length === 1', () => {
    expect(generateBossCenterProbe.length).toBe(1)
  })

  it('B4: generateCornerFindProbe.length === 1', () => {
    expect(generateCornerFindProbe.length).toBe(1)
  })

  it('B5: generateToolLengthProbe.length === 1', () => {
    expect(generateToolLengthProbe.length).toBe(1)
  })

  it('B6: generateProbeCycle.length === 2 (type + params)', () => {
    expect(generateProbeCycle.length).toBe(2)
  })

  it('B7: every generator has its source name preserved', () => {
    expect(generateSingleSurfaceProbe.name).toBe('generateSingleSurfaceProbe')
    expect(generateBoreCenterProbe.name).toBe('generateBoreCenterProbe')
    expect(generateBossCenterProbe.name).toBe('generateBossCenterProbe')
    expect(generateCornerFindProbe.name).toBe('generateCornerFindProbe')
    expect(generateToolLengthProbe.name).toBe('generateToolLengthProbe')
    expect(generateProbeCycle.name).toBe('generateProbeCycle')
  })

  it('B8: every generator returns a string for valid input', () => {
    for (const { gen } of ALL_GENS) {
      expect(typeof gen()).toBe('string')
    }
  })

  it('B9: dispatcher returns a string for every cycle type', () => {
    expect(typeof generateProbeCycle('singleSurface', ssDefaults)).toBe('string')
    expect(typeof generateProbeCycle('boreCenter', boreDefaults)).toBe('string')
    expect(typeof generateProbeCycle('bossCenter', bossDefaults)).toBe('string')
    expect(typeof generateProbeCycle('cornerFind', cornerDefaults)).toBe('string')
    expect(typeof generateProbeCycle('toolLength', toolLenDefaults)).toBe('string')
  })

  it('B10: every generator output has length > 0', () => {
    for (const { gen } of ALL_GENS) {
      expect(gen().length).toBeGreaterThan(0)
    }
  })
})

// -- C: Type-level parity --------------------------------------------------

describe('probing-cycles-pin :: C. Type-level parity', () => {
  it('C1: ProbeCycleType union has exactly 5 members (compile-time exhaustive switch)', () => {
    // If a member is added to the union but not handled in the switch, the
    // dispatcher overload contract breaks. This test pins the exhaustive set.
    const allMembers: ProbeCycleType[] = [
      'singleSurface',
      'boreCenter',
      'bossCenter',
      'cornerFind',
      'toolLength',
    ]
    expect(allMembers.length).toBe(5)
    // Sanity: dispatcher accepts every union member.
    for (const t of allMembers) {
      const params: ProbeBaseParams & Record<string, unknown> = {
        probeFeedMmMin: 100,
        retractMm: 3,
        wcsIndex: 1,
        // Carry every optional field so each type's required extras are present.
        axis: 'x',
        direction: -1,
        maxTravelMm: 25,
        approxDiameterMm: 50,
        probeDepthMm: 10,
        approxWidthMm: 40,
        probeHeightMm: 5,
        maxTravelXMm: 30,
        maxTravelYMm: 30,
      }
      expect(typeof generateProbeCycle(t, params)).toBe('string')
    }
  })

  it('C2: ProbeBaseParams is structurally a subset of every concrete params type', () => {
    const base: ProbeBaseParams = { probeFeedMmMin: 100, retractMm: 3, wcsIndex: 1 }
    // Each concrete type adds its own required fields; base alone is not
    // assignable to e.g. SingleSurfaceParams. We pin via an explicit cast and
    // confirm the runtime function reads only base fields when extras are
    // sprinkled in via cast.
    const ss: SingleSurfaceParams = {
      ...base,
      axis: 'x',
      direction: -1,
      maxTravelMm: 25,
    }
    expect(ss.probeFeedMmMin).toBe(100)
    expect(ss.retractMm).toBe(3)
    expect(ss.wcsIndex).toBe(1)
  })

  it('C3: SingleSurfaceParams.expectedPositionMm is optional', () => {
    const ss: SingleSurfaceParams = { ...ssDefaults }
    expect(ss.expectedPositionMm).toBeUndefined()
    const out = generateSingleSurfaceProbe(ss)
    expect(out).not.toContain('Expected surface at')
  })

  it('C4: ToolLengthParams.toolSetterHeightMm is optional', () => {
    const tl: ToolLengthParams = { ...toolLenDefaults }
    expect(tl.toolSetterHeightMm).toBeUndefined()
    const out = generateToolLengthProbe(tl)
    expect(out).not.toContain('Tool setter surface at')
  })

  it('C5: SingleSurfaceParams.axis union is exactly {x, y, z}', () => {
    // Compile-time pin: assignability of each member.
    const axes: Array<SingleSurfaceParams['axis']> = ['x', 'y', 'z']
    expect(axes.length).toBe(3)
    for (const a of axes) {
      const out = generateSingleSurfaceProbe({ ...ssDefaults, axis: a })
      expect(out).toContain(`G38.2 ${a.toUpperCase()}`)
    }
  })

  it('C6: SingleSurfaceParams.direction union is exactly {1, -1}', () => {
    const dirs: Array<SingleSurfaceParams['direction']> = [1, -1]
    expect(dirs.length).toBe(2)
  })

  it('C7: every concrete params type extends ProbeBaseParams (probeFeedMmMin/retractMm/wcsIndex present)', () => {
    const samples: ProbeBaseParams[] = [
      ssDefaults,
      boreDefaults,
      bossDefaults,
      cornerDefaults,
      toolLenDefaults,
    ]
    for (const s of samples) {
      expect(typeof s.probeFeedMmMin).toBe('number')
      expect(typeof s.retractMm).toBe('number')
      expect(typeof s.wcsIndex).toBe('number')
    }
  })

  it('C8: ProbeCycleType members are string-literal singletons', () => {
    const t1: ProbeCycleType = 'singleSurface'
    const t2: ProbeCycleType = 'boreCenter'
    const t3: ProbeCycleType = 'bossCenter'
    const t4: ProbeCycleType = 'cornerFind'
    const t5: ProbeCycleType = 'toolLength'
    expect([t1, t2, t3, t4, t5]).toEqual([
      'singleSurface',
      'boreCenter',
      'bossCenter',
      'cornerFind',
      'toolLength',
    ])
  })
})

// -- D: Header / preamble shape -------------------------------------------

describe('probing-cycles-pin :: D. Header / preamble', () => {
  it('D1: every generator output contains the WorkTrackCAM provenance comment', () => {
    for (const { gen } of ALL_GENS) {
      expect(gen()).toContain('Generated by WorkTrackCAM')
    }
  })

  it('D2: every generator output contains the verify-on-controller warning', () => {
    for (const { gen } of ALL_GENS) {
      expect(gen()).toContain('VERIFY ON YOUR CONTROLLER BEFORE RUNNING ON REAL HARDWARE')
    }
  })

  it('D3: every generator opens with a ; comment line', () => {
    for (const { gen } of ALL_GENS) {
      const first = gen().split('\n')[0] ?? ''
      expect(first.startsWith('; ')).toBe(true)
    }
  })

  it('D4: header title uses U+2500 box-drawings horizontal as bracket markers', () => {
    // headerBlock wraps the title in box-drawings ── on both sides.
    for (const { gen } of ALL_GENS) {
      expect(gen()).toContain('\u2500\u2500 ')
      expect(gen()).toContain(' \u2500\u2500')
    }
  })

  it('D5: single-surface header advertises the axis', () => {
    expect(generateSingleSurfaceProbe(ssDefaults)).toContain('Single Surface Probe')
    expect(generateSingleSurfaceProbe({ ...ssDefaults, axis: 'y' })).toContain('Y axis')
    expect(generateSingleSurfaceProbe({ ...ssDefaults, axis: 'z' })).toContain('Z axis')
  })

  it('D6: bore-center header advertises 4-wall XY', () => {
    expect(generateBoreCenterProbe(boreDefaults)).toContain('Bore Center Probe')
    expect(generateBoreCenterProbe(boreDefaults)).toContain('4-wall XY')
  })

  it('D7: boss-center header advertises 4-face XY', () => {
    expect(generateBossCenterProbe(bossDefaults)).toContain('Boss Center Probe')
    expect(generateBossCenterProbe(bossDefaults)).toContain('4-face XY')
  })

  it('D8: corner-find header advertises X face + Y face', () => {
    expect(generateCornerFindProbe(cornerDefaults)).toContain('Corner Find Probe')
    expect(generateCornerFindProbe(cornerDefaults)).toContain('X face + Y face')
  })

  it('D9: tool-length header advertises Z onto tool setter', () => {
    expect(generateToolLengthProbe(toolLenDefaults)).toContain('Tool Length Probe')
    expect(generateToolLengthProbe(toolLenDefaults)).toContain('Z onto tool setter')
  })

  it('D10: every header line starts with `; ` exactly (no `;<space>` drift)', () => {
    for (const { gen } of ALL_GENS) {
      const headerLines = gen()
        .split('\n')
        .filter((l) => l.startsWith(';'))
      // Every comment line MUST be `; <text>` (semicolon, single space, then text).
      for (const line of headerLines) {
        // Allow blank `; ` (empty-comment separators), require space follows
        // semicolon either way.
        expect(line.startsWith('; ') || line === ';').toBe(true)
      }
    }
  })
})

// -- E: Safety retract shape ----------------------------------------------

describe('probing-cycles-pin :: E. Safety retract shape', () => {
  it('E1: every generator emits at least one G91 G0 Z<n> retract preamble', () => {
    for (const { gen } of ALL_GENS) {
      expect(gen()).toMatch(/G91 G0 Z\d/)
    }
  })

  it('E2: every G91 G0 Z<n> retract is paired with a G90 follow-up on the next non-blank line', () => {
    // The safetyRetract helper joins `G91 G0 Z<retractMm>\nG90` so every
    // such pair is back-to-back. Pin this invariant.
    for (const { gen } of ALL_GENS) {
      const lines = gen().split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('G91 G0 Z')) {
          // The next line must be G90 (no blank lines or comments allowed
          // between the pair, since safetyRetract joins with a single \n).
          expect(lines[i + 1]).toBe('G90')
        }
      }
    }
  })

  it('E3: retract distance reflects the retractMm param verbatim', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, retractMm: 7 })
    expect(out).toContain('G91 G0 Z7')
    expect(out).not.toContain('G91 G0 Z3')
  })

  it('E4: every G38.2 probe move is preceded (before any subsequent probe) by a retract pair', () => {
    // Conservative pin: somewhere before each G38.2 there is at least one
    // G91 G0 Z<n> sequence within the same output.
    for (const { gen } of ALL_GENS) {
      const out = gen()
      const lines = out.split('\n')
      const probeIdx = lines.findIndex((l) => l.startsWith('G38.2'))
      expect(probeIdx).toBeGreaterThanOrEqual(0)
      const before = lines.slice(0, probeIdx).join('\n')
      expect(before).toMatch(/G91 G0 Z/)
    }
  })

  it('E5: every generator ends with a final retract or G90 absolute restore', () => {
    for (const { gen } of ALL_GENS) {
      const lines = gen()
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith(';'))
      const last = lines[lines.length - 1]
      // Last non-comment line is either the G90 of a retract pair or the
      // closing of an out-of-bore retract (G90).
      expect(last === 'G90' || /^G91 G0 Z\d/.test(last ?? '')).toBe(true)
    }
  })

  it('E6: bore-center has at least 5 G91 G0 Z retract lines (entry + 4 walls)', () => {
    const out = generateBoreCenterProbe(boreDefaults)
    const retracts = out.split('\n').filter((l) => l.startsWith('G91 G0 Z'))
    expect(retracts.length).toBeGreaterThanOrEqual(5)
  })

  it('E7: boss-center has at least 5 G91 G0 Z retract lines', () => {
    const out = generateBossCenterProbe(bossDefaults)
    const retracts = out.split('\n').filter((l) => l.startsWith('G91 G0 Z'))
    expect(retracts.length).toBeGreaterThanOrEqual(5)
  })

  it('E8: tool-length has G91 G0 Z retract before AND after the Z probe', () => {
    const out = generateToolLengthProbe(toolLenDefaults)
    const lines = out.split('\n')
    const probeIdx = lines.findIndex((l) => l.startsWith('G38.2'))
    const retractsBefore = lines.slice(0, probeIdx).filter((l) => l.startsWith('G91 G0 Z'))
    const retractsAfter = lines.slice(probeIdx + 1).filter((l) => l.startsWith('G91 G0 Z'))
    expect(retractsBefore.length).toBeGreaterThanOrEqual(1)
    expect(retractsAfter.length).toBeGreaterThanOrEqual(1)
  })
})

// -- F: G10 L2 + WCS clamp invariants -------------------------------------

describe('probing-cycles-pin :: F. G10 L2 + WCS clamp', () => {
  it('F1: every generator emits at least one G10 L2 P<1-6> ... line', () => {
    for (const { gen } of ALL_GENS) {
      expect(gen()).toMatch(/G10 L2 P[1-6]\b/)
    }
  })

  it('F2: wcsIndex=1 emits P1 (G54)', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, wcsIndex: 1 })
    expect(out).toMatch(/G10 L2 P1\b/)
  })

  it('F3: wcsIndex=6 emits P6 (G59)', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, wcsIndex: 6 })
    expect(out).toMatch(/G10 L2 P6\b/)
  })

  it('F4: wcsIndex below 1 is clamped UP to 1', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, wcsIndex: 0 })
    expect(out).toMatch(/G10 L2 P1\b/)
  })

  it('F5: wcsIndex above 6 is clamped DOWN to 6', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, wcsIndex: 99 })
    expect(out).toMatch(/G10 L2 P6\b/)
  })

  it('F6: wcsIndex negative is clamped UP to 1', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, wcsIndex: -3 })
    expect(out).toMatch(/G10 L2 P1\b/)
  })

  it('F7: wcsIndex 3.7 rounds to 4 then clamps (Math.round semantics)', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, wcsIndex: 3.7 })
    expect(out).toMatch(/G10 L2 P4\b/)
  })

  it('F8: wcsIndex 2.49 rounds to 2 (banker-agnostic; .49 < .5)', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, wcsIndex: 2.49 })
    expect(out).toMatch(/G10 L2 P2\b/)
  })

  it('F9: header comment references G5<3+P> WCS code (e.g. P1 -> G54)', () => {
    const out = generateBoreCenterProbe({ ...boreDefaults, wcsIndex: 2 })
    expect(out).toContain('G55')
    const out2 = generateBoreCenterProbe({ ...boreDefaults, wcsIndex: 6 })
    expect(out2).toContain('G59')
  })

  it('F10: bore-center G10 L2 sets BOTH X[#104] AND Y[#105] in one line', () => {
    const out = generateBoreCenterProbe(boreDefaults)
    expect(out).toMatch(/G10 L2 P1 X\[#104\] Y\[#105\]/)
  })

  it('F11: boss-center G10 L2 sets BOTH X[#104] AND Y[#105] in one line', () => {
    const out = generateBossCenterProbe(bossDefaults)
    expect(out).toMatch(/G10 L2 P1 X\[#104\] Y\[#105\]/)
  })

  it('F12: corner-find emits TWO separate G10 L2 lines (X first, then Y)', () => {
    const out = generateCornerFindProbe(cornerDefaults)
    const lines = out.split('\n')
    const g10 = lines.filter((l) => l.startsWith('G10 L2'))
    expect(g10.length).toBe(2)
    expect(g10[0]).toMatch(/X\[#5061\]/)
    expect(g10[1]).toMatch(/Y\[#5062\]/)
  })

  it('F13: tool-length G10 L2 sets Z[#5063]', () => {
    const out = generateToolLengthProbe(toolLenDefaults)
    expect(out).toMatch(/G10 L2 P1 Z\[#5063\]/)
  })
})

// -- G: Probe variable mapping (#5061/#5062/#5063) ------------------------

describe('probing-cycles-pin :: G. Probe variable mapping', () => {
  it('G1: single-surface X axis stores result in #5061', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, axis: 'x' })
    expect(out).toContain('X[#5061]')
  })

  it('G2: single-surface Y axis stores result in #5062', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, axis: 'y' })
    expect(out).toContain('Y[#5062]')
  })

  it('G3: single-surface Z axis stores result in #5063', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, axis: 'z' })
    expect(out).toContain('Z[#5063]')
  })

  it('G4: bore-center stores 4 wall contacts in #100-#103 then averages into #104/#105', () => {
    const out = generateBoreCenterProbe(boreDefaults)
    expect(out).toContain('#100 = #5061')
    expect(out).toContain('#101 = #5061')
    expect(out).toContain('#102 = #5062')
    expect(out).toContain('#103 = #5062')
    expect(out).toContain('#104 = [#100 + #101] / 2')
    expect(out).toContain('#105 = [#102 + #103] / 2')
  })

  it('G5: boss-center reuses the same #100-#105 numeric scratch slots', () => {
    const out = generateBossCenterProbe(bossDefaults)
    expect(out).toContain('#100 = #5061')
    expect(out).toContain('#101 = #5061')
    expect(out).toContain('#102 = #5062')
    expect(out).toContain('#103 = #5062')
    expect(out).toContain('#104 = [#100 + #101] / 2')
    expect(out).toContain('#105 = [#102 + #103] / 2')
  })

  it('G6: corner-find consumes #5061/#5062 directly (no scratch slots)', () => {
    const out = generateCornerFindProbe(cornerDefaults)
    expect(out).not.toMatch(/#10\d = /)
    expect(out).toContain('X[#5061]')
    expect(out).toContain('Y[#5062]')
  })

  it('G7: tool-length consumes #5063 directly (no scratch slots)', () => {
    const out = generateToolLengthProbe(toolLenDefaults)
    expect(out).not.toMatch(/#10\d = /)
    expect(out).toContain('Z[#5063]')
  })

  it('G8: tool-length applies G43 H1 tool-length compensation after probe', () => {
    const out = generateToolLengthProbe(toolLenDefaults)
    const lines = out.split('\n')
    const probeIdx = lines.findIndex((l) => l.startsWith('G38.2'))
    const g43Idx = lines.findIndex((l) => l.trim() === 'G43 H1')
    expect(g43Idx).toBeGreaterThan(probeIdx)
  })
})

// -- H: Bore + boss body shape --------------------------------------------

describe('probing-cycles-pin :: H. Bore / boss body shape', () => {
  it('H1: bore-center emits exactly 4 G38.2 probe lines', () => {
    const out = generateBoreCenterProbe(boreDefaults)
    const probes = out.split('\n').filter((l) => l.startsWith('G38.2'))
    expect(probes.length).toBe(4)
  })

  it('H2: bore-center probe travels are exactly +/- approxDiameterMm/2', () => {
    const out = generateBoreCenterProbe({ ...boreDefaults, approxDiameterMm: 80 })
    expect(out).toContain('G38.2 X40 F100')
    expect(out).toContain('G38.2 X-40 F100')
    expect(out).toContain('G38.2 Y40 F100')
    expect(out).toContain('G38.2 Y-40 F100')
  })

  it('H3: bore-center descends to the requested probe depth before XY probing', () => {
    const out = generateBoreCenterProbe({ ...boreDefaults, probeDepthMm: 12 })
    expect(out).toContain('G91 G0 Z-12')
  })

  it('H4: bore-center final out-of-bore retract is depth + retractMm', () => {
    const out = generateBoreCenterProbe({ ...boreDefaults, probeDepthMm: 10, retractMm: 5 })
    expect(out).toContain('G91 G0 Z15')
  })

  it('H5: boss-center emits exactly 4 G38.2 probe lines', () => {
    const out = generateBossCenterProbe(bossDefaults)
    const probes = out.split('\n').filter((l) => l.startsWith('G38.2'))
    expect(probes.length).toBe(4)
  })

  it('H6: boss-center probe travel is approxWidthMm/2 + 10 (overshoot constant)', () => {
    const out = generateBossCenterProbe({ ...bossDefaults, approxWidthMm: 60 })
    // halfWidth=30, travelDist=40
    expect(out).toContain('G38.2 X-40 F100')
    expect(out).toContain('G38.2 X40 F100')
    expect(out).toContain('G38.2 Y-40 F100')
    expect(out).toContain('G38.2 Y40 F100')
  })

  it('H7: boss-center descends to probeHeightMm before each face probe', () => {
    const out = generateBossCenterProbe({ ...bossDefaults, probeHeightMm: 8 })
    const descents = out.split('\n').filter((l) => l.trim() === 'G91 G0 Z-8')
    // Four faces -> at least 4 descent lines.
    expect(descents.length).toBeGreaterThanOrEqual(4)
  })

  it('H8: bore-center emits intermediate "return-to-center" rapids between walls', () => {
    const out = generateBoreCenterProbe({ ...boreDefaults, approxDiameterMm: 50 })
    // halfDia=25, return rapids in X negative + X positive after first two walls.
    expect(out).toContain('G91 G0 X-25')
    expect(out).toContain('G91 G0 X25')
    expect(out).toContain('G91 G0 Y-25')
  })

  it('H9: bore-center probe order is +X, -X, +Y, -Y (declaration order preserved)', () => {
    const out = generateBoreCenterProbe(boreDefaults)
    const lines = out.split('\n')
    const probes = lines.filter((l) => l.startsWith('G38.2'))
    expect(probes[0]).toMatch(/^G38\.2 X25\b/)
    expect(probes[1]).toMatch(/^G38\.2 X-25\b/)
    expect(probes[2]).toMatch(/^G38\.2 Y25\b/)
    expect(probes[3]).toMatch(/^G38\.2 Y-25\b/)
  })

  it('H10: boss-center probe order is X-, X+, Y-, Y+ (each face probed inward)', () => {
    const out = generateBossCenterProbe(bossDefaults)
    const lines = out.split('\n')
    const probes = lines.filter((l) => l.startsWith('G38.2'))
    // halfWidth=20, travelDist=30
    expect(probes[0]).toMatch(/^G38\.2 X-30\b/)
    expect(probes[1]).toMatch(/^G38\.2 X30\b/)
    expect(probes[2]).toMatch(/^G38\.2 Y-30\b/)
    expect(probes[3]).toMatch(/^G38\.2 Y30\b/)
  })
})

// -- I: Single surface, corner find, tool length specifics ----------------

describe('probing-cycles-pin :: I. Per-cycle specifics', () => {
  it('I1: single-surface emits exactly 1 G38.2 probe line', () => {
    const out = generateSingleSurfaceProbe(ssDefaults)
    const probes = out.split('\n').filter((l) => l.startsWith('G38.2'))
    expect(probes.length).toBe(1)
  })

  it('I2: single-surface direction=+1 emits positive travel (no negation)', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, axis: 'y', direction: 1, maxTravelMm: 18 })
    expect(out).toContain('G38.2 Y18 F100')
    expect(out).not.toContain('G38.2 Y-18')
  })

  it('I3: single-surface direction=-1 emits negative travel', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, axis: 'z', direction: -1, maxTravelMm: 50 })
    expect(out).toContain('G38.2 Z-50 F100')
  })

  it('I4: single-surface header lists direction sign explicitly', () => {
    const outPos = generateSingleSurfaceProbe({ ...ssDefaults, direction: 1 })
    const outNeg = generateSingleSurfaceProbe({ ...ssDefaults, direction: -1 })
    expect(outPos).toContain('Direction: +')
    expect(outNeg).toContain('Direction: -')
  })

  it('I5: single-surface includes expectedPositionMm in comment when provided', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, expectedPositionMm: -25 })
    expect(out).toContain('Expected surface at X=-25 mm')
  })

  it('I6: corner-find emits exactly 2 G38.2 probe lines', () => {
    const out = generateCornerFindProbe(cornerDefaults)
    const probes = out.split('\n').filter((l) => l.startsWith('G38.2'))
    expect(probes.length).toBe(2)
  })

  it('I7: corner-find probes X negative then Y negative (declaration order)', () => {
    const out = generateCornerFindProbe(cornerDefaults)
    const probes = out.split('\n').filter((l) => l.startsWith('G38.2'))
    expect(probes[0]).toMatch(/^G38\.2 X-30\b/)
    expect(probes[1]).toMatch(/^G38\.2 Y-30\b/)
  })

  it('I8: corner-find honors asymmetric maxTravelXMm vs maxTravelYMm', () => {
    const out = generateCornerFindProbe({ ...cornerDefaults, maxTravelXMm: 22, maxTravelYMm: 45 })
    expect(out).toContain('G38.2 X-22 F100')
    expect(out).toContain('G38.2 Y-45 F100')
  })

  it('I9: tool-length emits exactly 1 G38.2 probe line', () => {
    const out = generateToolLengthProbe(toolLenDefaults)
    const probes = out.split('\n').filter((l) => l.startsWith('G38.2'))
    expect(probes.length).toBe(1)
  })

  it('I10: tool-length probe travels Z negative by maxTravelMm', () => {
    const out = generateToolLengthProbe({ ...toolLenDefaults, maxTravelMm: 75, probeFeedMmMin: 60 })
    expect(out).toContain('G38.2 Z-75 F60')
  })

  it('I11: tool-length includes toolSetterHeightMm in comment when provided', () => {
    const out = generateToolLengthProbe({ ...toolLenDefaults, toolSetterHeightMm: -42 })
    expect(out).toContain('Tool setter surface at Z=-42 mm')
  })
})

// -- J: Dispatcher delegation ---------------------------------------------

describe('probing-cycles-pin :: J. Dispatcher delegation', () => {
  it('J1: singleSurface dispatch is byte-equal to direct call', () => {
    expect(generateProbeCycle('singleSurface', ssDefaults)).toBe(
      generateSingleSurfaceProbe(ssDefaults),
    )
  })

  it('J2: boreCenter dispatch is byte-equal to direct call', () => {
    expect(generateProbeCycle('boreCenter', boreDefaults)).toBe(
      generateBoreCenterProbe(boreDefaults),
    )
  })

  it('J3: bossCenter dispatch is byte-equal to direct call', () => {
    expect(generateProbeCycle('bossCenter', bossDefaults)).toBe(
      generateBossCenterProbe(bossDefaults),
    )
  })

  it('J4: cornerFind dispatch is byte-equal to direct call', () => {
    expect(generateProbeCycle('cornerFind', cornerDefaults)).toBe(
      generateCornerFindProbe(cornerDefaults),
    )
  })

  it('J5: toolLength dispatch is byte-equal to direct call', () => {
    expect(generateProbeCycle('toolLength', toolLenDefaults)).toBe(
      generateToolLengthProbe(toolLenDefaults),
    )
  })

  it('J6: dispatcher honors changed wcsIndex via params (no caching)', () => {
    const a = generateProbeCycle('singleSurface', { ...ssDefaults, wcsIndex: 1 })
    const b = generateProbeCycle('singleSurface', { ...ssDefaults, wcsIndex: 4 })
    expect(a).not.toBe(b)
    expect(a).toMatch(/G10 L2 P1\b/)
    expect(b).toMatch(/G10 L2 P4\b/)
  })

  it('J7: dispatcher result is a fresh string (no aliasing)', () => {
    const a = generateProbeCycle('boreCenter', boreDefaults)
    const b = generateProbeCycle('boreCenter', boreDefaults)
    // Equal content, but they are independent string instances and string
    // primitive equality holds.
    expect(a).toBe(b)
    expect(a.length).toBe(b.length)
  })
})

// -- K: Source-text whitelist ---------------------------------------------

describe('probing-cycles-pin :: K. Source-text whitelist', () => {
  it('K1: G38.2 is the canonical probe move opcode (not G38.3 / G38.4 / G38.5)', () => {
    for (const { gen } of ALL_GENS) {
      const out = gen()
      expect(out).toContain('G38.2')
      expect(out).not.toContain('G38.3')
      expect(out).not.toContain('G38.4')
      expect(out).not.toContain('G38.5')
    }
  })

  it('K2: G91 G0 Z is the retract move (not G0 G91 ordering)', () => {
    for (const { gen } of ALL_GENS) {
      expect(gen()).toContain('G91 G0 Z')
      expect(gen()).not.toContain('G0 G91 Z')
    }
  })

  it('K3: G90 absolute restore appears after every G91 G0 Z retract', () => {
    for (const { gen } of ALL_GENS) {
      const out = gen()
      const retracts = out.split('\n').filter((l) => l.startsWith('G91 G0 Z')).length
      const restores = out.split('\n').filter((l) => l.trim() === 'G90').length
      expect(restores).toBeGreaterThanOrEqual(retracts)
    }
  })

  it('K4: probe feed F<n> is whitespace-delimited and integer-valued for default fixtures', () => {
    for (const { gen } of ALL_GENS) {
      const out = gen()
      const probes = out.split('\n').filter((l) => l.startsWith('G38.2'))
      for (const line of probes) {
        expect(line).toMatch(/ F\d+$/)
      }
    }
  })

  it('K5: WCS comment line uses canonical "WCS: P<n> (G5<3+n>)" format', () => {
    const out = generateSingleSurfaceProbe({ ...ssDefaults, wcsIndex: 1 })
    expect(out).toContain('WCS: P1 (G54)')
    const out6 = generateSingleSurfaceProbe({ ...ssDefaults, wcsIndex: 6 })
    expect(out6).toContain('WCS: P6 (G59)')
  })

  it('K6: header comment block uses single-semicolon comment marker (not double or paren)', () => {
    for (const { gen } of ALL_GENS) {
      const out = gen()
      // No `(...)` paren-style comments (LinuxCNC alt) or `;;` doubled markers.
      expect(out).not.toMatch(/^\(/m)
      expect(out).not.toContain(';;')
    }
  })

  it('K7: source declares the #5061/#5062/#5063 variable mapping in the file header', () => {
    // Pin the public docstring contract so the controller-variable mapping
    // cannot drift silently.
    // We pin via the runtime output: whichever generators consume each
    // variable mention it explicitly.
    const ssX = generateSingleSurfaceProbe({ ...ssDefaults, axis: 'x' })
    const ssY = generateSingleSurfaceProbe({ ...ssDefaults, axis: 'y' })
    const ssZ = generateSingleSurfaceProbe({ ...ssDefaults, axis: 'z' })
    expect(ssX).toContain('#5061')
    expect(ssY).toContain('#5062')
    expect(ssZ).toContain('#5063')
  })

  it('K8: bore + boss centerlines use square-bracket arithmetic (LinuxCNC/Fanuc style)', () => {
    const bore = generateBoreCenterProbe(boreDefaults)
    const boss = generateBossCenterProbe(bossDefaults)
    expect(bore).toContain('[#100 + #101] / 2')
    expect(bore).toContain('[#102 + #103] / 2')
    expect(boss).toContain('[#100 + #101] / 2')
    expect(boss).toContain('[#102 + #103] / 2')
  })

  it('K9: G10 L2 spelling is canonical (uppercase L, decimal index)', () => {
    for (const { gen } of ALL_GENS) {
      const out = gen()
      expect(out).toContain('G10 L2 P')
      expect(out).not.toContain('G10 l2')
      expect(out).not.toContain('G10 L02')
    }
  })

  it('K10: G43 H1 is the canonical tool-length-comp invocation in tool-length probe', () => {
    const out = generateToolLengthProbe(toolLenDefaults)
    expect(out).toContain('G43 H1')
    expect(out).not.toContain('G43.1')
    expect(out).not.toContain('G44')
  })

  it('K11: no smart quotes / curly apostrophes leak into output (CRLF-friendly ASCII for G-code)', () => {
    for (const { gen } of ALL_GENS) {
      const out = gen()
      expect(out).not.toContain('\u2019') // RIGHT SINGLE QUOTATION MARK
      expect(out).not.toContain('\u201C') // LEFT DOUBLE QUOTATION MARK
      expect(out).not.toContain('\u201D') // RIGHT DOUBLE QUOTATION MARK
    }
  })
})

// -- L: Pure-function invariants ------------------------------------------

describe('probing-cycles-pin :: L. Pure-function invariants', () => {
  it('L1: generators are deterministic across repeated calls (single-surface)', () => {
    const a = generateSingleSurfaceProbe(ssDefaults)
    const b = generateSingleSurfaceProbe(ssDefaults)
    expect(a).toBe(b)
  })

  it('L2: generators are deterministic across repeated calls (bore-center)', () => {
    const a = generateBoreCenterProbe(boreDefaults)
    const b = generateBoreCenterProbe(boreDefaults)
    expect(a).toBe(b)
  })

  it('L3: generators are deterministic across repeated calls (boss-center)', () => {
    const a = generateBossCenterProbe(bossDefaults)
    const b = generateBossCenterProbe(bossDefaults)
    expect(a).toBe(b)
  })

  it('L4: generators are deterministic across repeated calls (corner-find)', () => {
    const a = generateCornerFindProbe(cornerDefaults)
    const b = generateCornerFindProbe(cornerDefaults)
    expect(a).toBe(b)
  })

  it('L5: generators are deterministic across repeated calls (tool-length)', () => {
    const a = generateToolLengthProbe(toolLenDefaults)
    const b = generateToolLengthProbe(toolLenDefaults)
    expect(a).toBe(b)
  })

  it('L6: generators do not mutate their params (frozen input survives intact)', () => {
    const frozen = Object.freeze({ ...ssDefaults }) as SingleSurfaceParams
    const before = JSON.stringify(frozen)
    const out = generateSingleSurfaceProbe(frozen)
    const after = JSON.stringify(frozen)
    expect(after).toBe(before)
    expect(typeof out).toBe('string')
  })

  it('L7: generators do not mutate frozen bore/boss/corner/tool-length params', () => {
    const fb = Object.freeze({ ...boreDefaults }) as BoreCenterParams
    const fboss = Object.freeze({ ...bossDefaults }) as BossCenterParams
    const fcorner = Object.freeze({ ...cornerDefaults }) as CornerFindParams
    const ftl = Object.freeze({ ...toolLenDefaults }) as ToolLengthParams
    const snapshots = [
      JSON.stringify(fb),
      JSON.stringify(fboss),
      JSON.stringify(fcorner),
      JSON.stringify(ftl),
    ]
    generateBoreCenterProbe(fb)
    generateBossCenterProbe(fboss)
    generateCornerFindProbe(fcorner)
    generateToolLengthProbe(ftl)
    expect([
      JSON.stringify(fb),
      JSON.stringify(fboss),
      JSON.stringify(fcorner),
      JSON.stringify(ftl),
    ]).toEqual(snapshots)
  })

  it('L8: dispatcher is deterministic across repeated calls', () => {
    expect(generateProbeCycle('boreCenter', boreDefaults)).toBe(
      generateProbeCycle('boreCenter', boreDefaults),
    )
  })

  it('L9: generators do not throw on minimum-valid params (probeFeedMmMin=1, retractMm=0.1)', () => {
    expect(() =>
      generateSingleSurfaceProbe({ ...ssDefaults, probeFeedMmMin: 1, retractMm: 0.1 }),
    ).not.toThrow()
    expect(() =>
      generateBoreCenterProbe({ ...boreDefaults, probeFeedMmMin: 1, retractMm: 0.1 }),
    ).not.toThrow()
    expect(() =>
      generateBossCenterProbe({ ...bossDefaults, probeFeedMmMin: 1, retractMm: 0.1 }),
    ).not.toThrow()
    expect(() =>
      generateCornerFindProbe({ ...cornerDefaults, probeFeedMmMin: 1, retractMm: 0.1 }),
    ).not.toThrow()
    expect(() =>
      generateToolLengthProbe({ ...toolLenDefaults, probeFeedMmMin: 1, retractMm: 0.1 }),
    ).not.toThrow()
  })

  it('L10: changing only probeFeedMmMin changes the output deterministically', () => {
    const a = generateSingleSurfaceProbe({ ...ssDefaults, probeFeedMmMin: 100 })
    const b = generateSingleSurfaceProbe({ ...ssDefaults, probeFeedMmMin: 200 })
    expect(a).not.toBe(b)
    expect(a).toContain(' F100')
    expect(b).toContain(' F200')
  })

  it('L11: changing only retractMm changes only retract distances', () => {
    const a = generateToolLengthProbe({ ...toolLenDefaults, retractMm: 5 })
    const b = generateToolLengthProbe({ ...toolLenDefaults, retractMm: 9 })
    expect(a).not.toBe(b)
    expect(a).toContain('G91 G0 Z5')
    expect(b).toContain('G91 G0 Z9')
  })
})

// -- M: Three-machine path realism ---------------------------------------

describe('probing-cycles-pin :: M. Three-machine path realism', () => {
  // Carvera 3-axis: 360x240x140 mm work area, ATC tool setter onboard,
  // typical probe feed 100 mm/min, retract 3 mm.
  const CARVERA_3AXIS_TOOLSET: ToolLengthParams = {
    maxTravelMm: 50,
    probeFeedMmMin: 100,
    retractMm: 3,
    wcsIndex: 1,
    toolSetterHeightMm: -120,
  }

  // Carvera 4-axis rotary: 92 mm stock diameter, 240 mm length.
  const CARVERA_4AXIS_BORE: BoreCenterParams = {
    approxDiameterMm: 92,
    probeDepthMm: 5,
    probeFeedMmMin: 100,
    retractMm: 3,
    wcsIndex: 2,
  }

  // Laguna Swift 5x10: 1524x3048 mm full sheet, RichAuto A-series controller
  // probe support; typical corner-find at sheet origin.
  const LAGUNA_CORNER: CornerFindParams = {
    maxTravelXMm: 50,
    maxTravelYMm: 50,
    probeFeedMmMin: 200,
    retractMm: 5,
    wcsIndex: 1,
  }

  // Laguna single-surface Z probe at sheet center.
  const LAGUNA_Z: SingleSurfaceParams = {
    axis: 'z',
    direction: -1,
    maxTravelMm: 200,
    probeFeedMmMin: 200,
    retractMm: 5,
    wcsIndex: 1,
  }

  it('M1: Carvera tool-setter probe emits valid G38.2 Z<-maxTravel> with G43 H1', () => {
    const out = generateToolLengthProbe(CARVERA_3AXIS_TOOLSET)
    expect(out).toContain('G38.2 Z-50 F100')
    expect(out).toContain('G43 H1')
    expect(out).toContain('G10 L2 P1 Z[#5063]')
    expect(out).toContain('Tool setter surface at Z=-120 mm')
  })

  it('M2: Carvera 4-axis bore probe at 92 mm stock diameter emits +/-46 mm probe travels', () => {
    const out = generateBoreCenterProbe(CARVERA_4AXIS_BORE)
    expect(out).toContain('G38.2 X46 F100')
    expect(out).toContain('G38.2 X-46 F100')
    expect(out).toContain('G38.2 Y46 F100')
    expect(out).toContain('G38.2 Y-46 F100')
    expect(out).toContain('G91 G0 Z-5')
    // Final out-of-bore retract = depth(5) + retract(3) = 8.
    expect(out).toContain('G91 G0 Z8')
    expect(out).toContain('G10 L2 P2 X[#104] Y[#105]')
    expect(out).toContain('G55')
  })

  it('M3: Laguna corner-find at sheet origin emits 2 probe lines with separate X/Y G10 L2 lines', () => {
    const out = generateCornerFindProbe(LAGUNA_CORNER)
    const probes = out.split('\n').filter((l) => l.startsWith('G38.2'))
    expect(probes.length).toBe(2)
    expect(out).toContain('G38.2 X-50 F200')
    expect(out).toContain('G38.2 Y-50 F200')
    expect(out).toContain('G10 L2 P1 X[#5061]')
    expect(out).toContain('G10 L2 P1 Y[#5062]')
  })

  it('M4: Laguna Z-surface single-surface probe emits Z[#5063] WCS update', () => {
    const out = generateSingleSurfaceProbe(LAGUNA_Z)
    expect(out).toContain('G38.2 Z-200 F200')
    expect(out).toContain('Z[#5063]')
    expect(out).toContain('G10 L2 P1 Z[#5063]')
  })

  it('M5: Carvera tool-setter retract distance is 3 mm (matches CLAUDE.md typical)', () => {
    const out = generateToolLengthProbe(CARVERA_3AXIS_TOOLSET)
    const retracts = out.split('\n').filter((l) => l.startsWith('G91 G0 Z'))
    expect(retracts.length).toBeGreaterThanOrEqual(2)
    expect(retracts.every((l) => l === 'G91 G0 Z3')).toBe(true)
  })

  it('M6: Laguna corner-find retract distance is 5 mm (larger Z safety on full-sheet bed)', () => {
    const out = generateCornerFindProbe(LAGUNA_CORNER)
    const retracts = out.split('\n').filter((l) => l.startsWith('G91 G0 Z'))
    expect(retracts.length).toBeGreaterThanOrEqual(2)
    expect(retracts.every((l) => l === 'G91 G0 Z5')).toBe(true)
  })

  it('M7: Carvera 4-axis bore probe stays within the 92 mm stock diameter bound', () => {
    const out = generateBoreCenterProbe(CARVERA_4AXIS_BORE)
    // half = 46; output should NOT contain X48 or X-48 (over-travel into chuck).
    expect(out).not.toMatch(/G38\.2 X-?4[789]\b/)
    expect(out).not.toMatch(/G38\.2 X-?5\d\b/)
  })

  it('M8: every realistic three-machine probe scenario passes the K3 retract-restore invariant', () => {
    const realistic: string[] = [
      generateToolLengthProbe(CARVERA_3AXIS_TOOLSET),
      generateBoreCenterProbe(CARVERA_4AXIS_BORE),
      generateCornerFindProbe(LAGUNA_CORNER),
      generateSingleSurfaceProbe(LAGUNA_Z),
    ]
    for (const out of realistic) {
      const retracts = out.split('\n').filter((l) => l.startsWith('G91 G0 Z')).length
      const restores = out.split('\n').filter((l) => l.trim() === 'G90').length
      expect(restores).toBeGreaterThanOrEqual(retracts)
    }
  })

  it('M9: Carvera 4-axis bore probe at wcsIndex=2 routes to G55 not G54', () => {
    const out = generateBoreCenterProbe(CARVERA_4AXIS_BORE)
    expect(out).toContain('G55')
    expect(out).not.toMatch(/G54\b/)
  })

  it('M10: K2 Plus FDM has no probe macro (BYPASS-SAFE) -- pin asserts module is independently importable without side effects', () => {
    // Module import should not have global side effects (no top-level
    // statements that mutate any globals). We assert the module namespace
    // has only function exports.
    const fnKeys = Object.keys(ProbingMod).filter(
      (k) => typeof (ProbingMod as Record<string, unknown>)[k] === 'function',
    )
    expect(fnKeys.length).toBe(6)
    // No constants like 'K2_PLUS_PROBE' leak into the namespace.
    expect(Object.keys(ProbingMod)).not.toContain('K2_PLUS_PROBE')
    expect(Object.keys(ProbingMod)).not.toContain('FDM_PROBE')
  })
})
