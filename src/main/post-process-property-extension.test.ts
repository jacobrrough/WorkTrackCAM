/**
 * Cycle 116 [ID-0192] -- post-processor property fuzz EXTENSION.
 *
 * Companion to Cycle 110 [ID-0017] (`post-process-property.test.ts`,
 * 362 lines, 12 it() blocks) which seeded the fuzz framework with
 * Laguna vacuum-wiring + per-machine pass-through invariants. That
 * SEED file's Section 22.9 (Cycle 110 close-out) carries an explicit
 * "Future fuzz extensions" parking lot. This file pulls four of the
 * five queued items in a single cycle so the parking lot graduates
 * from notes to executable contracts:
 *
 *   (i)  Variable-length safe toolpath fuzz (was: constant fixture)
 *   (iv) Property-form vacuum-marker preservation (concrete pin only
 *        in Cycle 109)
 *   (v)  Cross-allocation (idempotency / hashable) determinism
 *   PLUS new M64/M65 multiset + ordering invariants beyond the
 *        existing engagedCount-only equality pin.
 *
 * Why a NEW file instead of extending the SEED file?
 *   - The SEED file is 362 lines and unmodified since Cycle 110
 *     close. Any in-place edit risks the [ID-0067] silent-truncation
 *     class per Rule 1.5 / Cycle 113 escalation (see
 *     `docs/EDIT-WORKFLOW.md`). A NEW file with `assert not
 *     target.exists()` pre-gate is the cleanest path.
 *   - Tests grouped by intent: SEED = "the wrap is wrap-shaped";
 *     EXTENSION = "the wrap is also deterministic, ordered, and
 *     length-agnostic". A future cycle can keep adding properties
 *     here without touching the SEED.
 *
 * Per-machine coverage (per CLAUDE.md three-machine scope):
 *   PRIMARY = Laguna Swift 5x10 (vacuum opts + Mach3 digital outputs).
 *   PASS-THROUGH = Creality K2 Plus + Makera Carvera 3-axis +
 *     Makera Carvera 4-axis (determinism + line-order properties hold
 *     on every target machine, regression-guarded here).
 *
 * Safety Rule 1 (G-code is sacred):
 *   - Determinism property: any nondeterminism (timestamp injection,
 *     random ID, Map iteration order) becomes a hard test failure.
 *   - Order-preservation property: the wrap may ADD lines but MUST
 *     NOT reorder the input toolpath -- a reorder would change cut
 *     sequencing and could crash a machine.
 *   - M64/M65 multiset property: every engage MUST have a paired
 *     release. Missing M65 leaves vacuum zones latched ON after the
 *     job ends -- a real-world safety hazard on the Laguna.
 *
 * Determinism / runtime budget:
 *   Each property uses a fixed seed and a small numRuns so the file
 *   finishes well under the implicit 1 s vitest budget per file.
 *   The SEED file used `0x4017017a` -- this file uses `0x4017192e`
 *   (suffix 192 = the [ID-0192] number) so a regression here is
 *   reproducible independent of the SEED file's seed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LAGUNA_SWIFT_WORK_AREA_MM } from '../shared/laguna-full-sheet-stock'
import {
  allocateLagunaVacuumZones,
  LAGUNA_VACUUM_ZONES,
} from '../shared/laguna-vacuum-allocator'
import {
  LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP,
  LAGUNA_VACUUM_PREAMBLE_OPEN,
  LAGUNA_VACUUM_PREAMBLE_CLOSE,
  LAGUNA_VACUUM_POSTAMBLE_OPEN,
  LAGUNA_VACUUM_POSTAMBLE_CLOSE,
} from '../shared/laguna-vacuum-postlude'
import {
  machineProfileSchema,
  type MachineProfile,
} from '../shared/machine-schema'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

function loadProfile(filename: string): MachineProfile {
  return machineProfileSchema.parse(
    JSON.parse(
      readFileSync(join(resourcesRoot, 'machines', filename), 'utf-8')
    )
  )
}

const lagunaProfile = loadProfile('laguna-swift-5x10.json')
const carvera3Profile = loadProfile('makera-carvera-3axis.json')
const carvera4Profile = loadProfile('makera-carvera-4axis.json')
const k2Profile = loadProfile('creality-k2-plus.json')

/**
 * The same SAFE_TOOLPATH_LINES from the SEED file -- redefined locally
 * so this file does not couple to test-only constants exported from
 * the SEED. The leading G0 rapid pair (lines 0-1) and the trailing
 * retract (line 7) are MANDATORY in every generated subarray; only
 * the interior cut lines (indices 2-6) are subject to fuzz selection.
 */
const SAFE_TOOLPATH_LINES = [
  'G0 X0 Y0 Z25', // 0 -- header rapid (always present)
  'G0 X10 Y10 Z5', // 1 -- approach rapid (always present)
  'G1 Z-3.000 F300', // 2 -- plunge (interior, fuzzed)
  'G1 X100 Y10 F3000', // 3 -- cut (interior, fuzzed)
  'G1 X100 Y100 F3000', // 4 -- cut (interior, fuzzed)
  'G1 X10 Y100 F3000', // 5 -- cut (interior, fuzzed)
  'G1 X10 Y10 F3000', // 6 -- cut (interior, fuzzed)
  'G0 Z25', // 7 -- final retract (always present)
] as const

const TOOLPATH_HEAD = SAFE_TOOLPATH_LINES.slice(0, 2)
const TOOLPATH_INTERIOR = [...SAFE_TOOLPATH_LINES.slice(2, 7)]
const TOOLPATH_TAIL = SAFE_TOOLPATH_LINES[7]
const safeToolpath: readonly string[] = SAFE_TOOLPATH_LINES

/**
 * Allocation arbitrary -- mirrors the SEED file (overshoot range
 * intentional so the `outsideEnvelope` branch is exercised).
 */
const allocationArb = fc
  .record({
    originX: fc.double({
      min: 0,
      max: LAGUNA_SWIFT_WORK_AREA_MM.x,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    originY: fc.double({
      min: 0,
      max: LAGUNA_SWIFT_WORK_AREA_MM.y,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    sizeX: fc.double({
      min: 1,
      max: LAGUNA_SWIFT_WORK_AREA_MM.x + 200,
      noNaN: true,
      noDefaultInfinity: true,
    }),
    sizeY: fc.double({
      min: 1,
      max: LAGUNA_SWIFT_WORK_AREA_MM.y + 200,
      noNaN: true,
      noDefaultInfinity: true,
    }),
  })
  .map(({ originX, originY, sizeX, sizeY }) =>
    allocateLagunaVacuumZones(originX, originY, sizeX, sizeY)
  )

/**
 * Variable-length toolpath arbitrary. fc.subarray preserves the
 * original relative order, so the assembled toolpath is always
 * "head rapids -> some prefix-preserving subset of interior cuts ->
 * trailing retract". MinLength=0 is allowed so the no-cut "rapids
 * only" toolpath is also exercised (a real edge case for a probing
 * job that never plunges).
 */
const safeToolpathArb = fc
  .subarray(TOOLPATH_INTERIOR, { minLength: 0, maxLength: 5 })
  .map((interior) => [...TOOLPATH_HEAD, ...interior, TOOLPATH_TAIL])

const SEED = 0x4017192e
const FAST_RUNS = { numRuns: 16, seed: SEED } as const
const FAST_RUNS_LIGHT = { numRuns: 8, seed: SEED } as const
const SYNC_RUNS = { numRuns: 64, seed: SEED } as const

// --------------------------------------------------------------------
// Property group A -- determinism (idempotency / hashability)
// --------------------------------------------------------------------
// Two consecutive renderPost calls with byte-identical inputs MUST
// produce byte-identical outputs. Catches: timestamp injection, Date
// captures, Math.random, Map iteration drift, any nondeterministic
// codegen path. A regression here would render the gcode unhashable
// for a future content-addressable build cache.
describe('post-process property extension [ID-0192] -- determinism', () => {
  it('Laguna with allocation: two consecutive renderPost calls are byte-identical', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const a = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          {
            vacuumZoneAllocation: allocation,
            vacuumOptions: { enableMach3DigitalOutputs: true },
          }
        )
        const b = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          {
            vacuumZoneAllocation: allocation,
            vacuumOptions: { enableMach3DigitalOutputs: true },
          }
        )
        return a.gcode === b.gcode
      }),
      FAST_RUNS
    )
  })

  it('Laguna no-opts: two consecutive renderPost calls are byte-identical', async () => {
    // Use the variable-length toolpath here so determinism holds for
    // arbitrary toolpath lengths (not just the SEED's constant fixture).
    await fc.assert(
      fc.asyncProperty(safeToolpathArb, async (toolpath) => {
        const a = await renderPost(resourcesRoot, lagunaProfile, toolpath)
        const b = await renderPost(resourcesRoot, lagunaProfile, toolpath)
        return a.gcode === b.gcode
      }),
      FAST_RUNS
    )
  })

  for (const { label, profile } of [
    { label: 'Carvera 3-axis', profile: carvera3Profile },
    { label: 'Carvera 4-axis', profile: carvera4Profile },
    { label: 'K2 Plus', profile: k2Profile },
  ]) {
    it(`${label}: two consecutive renderPost calls are byte-identical`, async () => {
      await fc.assert(
        fc.asyncProperty(safeToolpathArb, async (toolpath) => {
          const a = await renderPost(resourcesRoot, profile, toolpath)
          const b = await renderPost(resourcesRoot, profile, toolpath)
          return a.gcode === b.gcode
        }),
        FAST_RUNS_LIGHT
      )
    })
  }
})

// --------------------------------------------------------------------
// Property group B -- input toolpath order preservation
// --------------------------------------------------------------------
// Every input line MUST appear in the output in the same RELATIVE
// ORDER as input. The wrap may insert lines (preamble, postamble,
// safety wraps) but must not reorder the toolpath. A reorder would
// change cut sequencing and could crash the machine.
function inputOrderPreserved(
  output: string,
  inputs: readonly string[]
): boolean {
  let cursor = 0
  for (const line of inputs) {
    const idx = output.indexOf(line, cursor)
    if (idx < 0) return false
    cursor = idx + line.length
  }
  return true
}

describe('post-process property extension [ID-0192] -- input toolpath order preservation', () => {
  it('Laguna with allocation: input lines appear in same relative order', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          { vacuumZoneAllocation: allocation }
        )
        return inputOrderPreserved(gcode, safeToolpath)
      }),
      FAST_RUNS
    )
  })

  it('Laguna with allocation: variable-length toolpath order preserved', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeToolpathArb,
        allocationArb,
        async (toolpath, allocation) => {
          const { gcode } = await renderPost(
            resourcesRoot,
            lagunaProfile,
            toolpath,
            { vacuumZoneAllocation: allocation }
          )
          return inputOrderPreserved(gcode, toolpath)
        }
      ),
      FAST_RUNS
    )
  })

  for (const { label, profile } of [
    { label: 'Carvera 3-axis', profile: carvera3Profile },
    { label: 'Carvera 4-axis', profile: carvera4Profile },
    { label: 'K2 Plus', profile: k2Profile },
  ]) {
    it(`${label}: input lines appear in same relative order`, async () => {
      await fc.assert(
        fc.asyncProperty(safeToolpathArb, async (toolpath) => {
          const { gcode } = await renderPost(resourcesRoot, profile, toolpath)
          return inputOrderPreserved(gcode, toolpath)
        }),
        FAST_RUNS_LIGHT
      )
    })
  }
})

// --------------------------------------------------------------------
// Property group C -- M64 / M65 multiset + ordering invariants
// --------------------------------------------------------------------
// When digital outputs are enabled:
//   - Every engage MUST have a paired release (multiset equality of
//     P-numbers in M64 vs M65). Missing M65 leaves a vacuum zone
//     latched ON after the job ends -- real-world safety hazard.
//   - The set of M64 P-numbers MUST equal the set of P-numbers that
//     map to engaged zones. Catches a regression where a refactor
//     accidentally emits M64 for ALL zones, not just engaged ones.
//   - Both M64 and M65 must appear in registry / column-major order
//     (P-numbers strictly increasing). The post template's
//     `for (const zoneId of allocation.engaged)` loop pins this -- a
//     refactor to Set iteration would break it silently otherwise.
function extractPNumbers(gcode: string, mcode: 'M64' | 'M65'): number[] {
  const pattern = new RegExp(`^${mcode}\\s+P(\\d+)`, 'gm')
  const out: number[] = []
  for (const m of gcode.matchAll(pattern)) {
    out.push(parseInt(m[1]!, 10))
  }
  return out
}

function isStrictlyIncreasing(xs: readonly number[]): boolean {
  for (let i = 1; i < xs.length; i++) {
    const prev = xs[i - 1]
    const cur = xs[i]
    if (prev === undefined || cur === undefined) return false
    if (prev >= cur) return false
  }
  return true
}

function multisetEqual(
  a: readonly number[],
  b: readonly number[]
): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort((x, y) => x - y)
  const sortedB = [...b].sort((x, y) => x - y)
  for (let i = 0; i < sortedA.length; i++) {
    if (sortedA[i] !== sortedB[i]) return false
  }
  return true
}

describe('post-process property extension [ID-0192] -- M64/M65 multiset + ordering invariants when digital outputs enabled', () => {
  it('M64 and M65 P-number multisets are equal (every engage has a paired release)', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          {
            vacuumZoneAllocation: allocation,
            vacuumOptions: { enableMach3DigitalOutputs: true },
          }
        )
        const m64 = extractPNumbers(gcode, 'M64')
        const m65 = extractPNumbers(gcode, 'M65')
        return multisetEqual(m64, m65)
      }),
      FAST_RUNS
    )
  })

  it('M64 P-numbers exactly match P-numbers from engaged zones (column-major map)', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          {
            vacuumZoneAllocation: allocation,
            vacuumOptions: { enableMach3DigitalOutputs: true },
          }
        )
        const m64 = extractPNumbers(gcode, 'M64')
        const expected = allocation.engaged
          .map((id) => LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP[id])
          .filter((p): p is number => typeof p === 'number')
        return multisetEqual(m64, expected)
      }),
      FAST_RUNS
    )
  })

  it('M64 P-numbers appear in strictly increasing order (registry / column-major order)', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          {
            vacuumZoneAllocation: allocation,
            vacuumOptions: { enableMach3DigitalOutputs: true },
          }
        )
        const m64 = extractPNumbers(gcode, 'M64')
        return isStrictlyIncreasing(m64)
      }),
      FAST_RUNS
    )
  })

  it('M65 P-numbers appear in strictly increasing order (registry / column-major order)', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          {
            vacuumZoneAllocation: allocation,
            vacuumOptions: { enableMach3DigitalOutputs: true },
          }
        )
        const m65 = extractPNumbers(gcode, 'M65')
        return isStrictlyIncreasing(m65)
      }),
      FAST_RUNS
    )
  })
})

// --------------------------------------------------------------------
// Property group D -- variable-length toolpath byte preservation
// --------------------------------------------------------------------
// Item (i) from Section 22.9: graduate the constant SAFE_TOOLPATH_LINES
// fixture to a fuzzed subarray. The header rapids and trailing retract
// stay constant (so the "header before first cut" / "end retract"
// universal post invariants are not the thing being fuzzed). All input
// lines MUST be preserved verbatim regardless of toolpath length --
// including the empty-cuts case (rapids + retract only).
describe('post-process property extension [ID-0192] -- variable-length toolpath byte preservation', () => {
  it('Laguna with allocation: every input line is present verbatim regardless of length', async () => {
    await fc.assert(
      fc.asyncProperty(
        safeToolpathArb,
        allocationArb,
        async (toolpath, allocation) => {
          const { gcode } = await renderPost(
            resourcesRoot,
            lagunaProfile,
            toolpath,
            { vacuumZoneAllocation: allocation }
          )
          for (const line of toolpath) {
            if (!gcode.includes(line)) return false
          }
          return true
        }
      ),
      FAST_RUNS
    )
  })

  it('Carvera 4-axis no-opts: every input line is present verbatim regardless of length', async () => {
    await fc.assert(
      fc.asyncProperty(safeToolpathArb, async (toolpath) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          carvera4Profile,
          toolpath
        )
        for (const line of toolpath) {
          if (!gcode.includes(line)) return false
        }
        return true
      }),
      FAST_RUNS_LIGHT
    )
  })

  it('K2 Plus no-opts: every input line is present verbatim regardless of length', async () => {
    await fc.assert(
      fc.asyncProperty(safeToolpathArb, async (toolpath) => {
        const { gcode } = await renderPost(resourcesRoot, k2Profile, toolpath)
        for (const line of toolpath) {
          if (!gcode.includes(line)) return false
        }
        return true
      }),
      FAST_RUNS_LIGHT
    )
  })
})

// --------------------------------------------------------------------
// Property group E -- vacuum-marker preservation (item iv)
// --------------------------------------------------------------------
// Item (iv) from Section 22.9: promote the Cycle 109 concrete-input
// "vacuum markers never end up inside a subroutine body" pin to a
// property over input-space allocations. We do not have a subroutine
// body in the SEED toolpath, but we DO have the universal pre/post
// wrap; the property here is the logical generalization: the four
// vacuum markers always appear EXACTLY ONCE each, in the canonical
// (preOpen -> preClose -> postOpen -> postClose) order, and never as
// duplicates (which would indicate a wrap accidentally re-running).
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let n = 0
  let i = 0
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++
    i += needle.length
  }
  return n
}

describe('post-process property extension [ID-0192] -- vacuum-marker preservation (item iv property promotion)', () => {
  it('all four vacuum markers appear exactly once each, in canonical order', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          { vacuumZoneAllocation: allocation }
        )
        const cPreOpen = countOccurrences(gcode, LAGUNA_VACUUM_PREAMBLE_OPEN)
        const cPreClose = countOccurrences(
          gcode,
          LAGUNA_VACUUM_PREAMBLE_CLOSE
        )
        const cPostOpen = countOccurrences(
          gcode,
          LAGUNA_VACUUM_POSTAMBLE_OPEN
        )
        const cPostClose = countOccurrences(
          gcode,
          LAGUNA_VACUUM_POSTAMBLE_CLOSE
        )
        return (
          cPreOpen === 1 &&
          cPreClose === 1 &&
          cPostOpen === 1 &&
          cPostClose === 1
        )
      }),
      FAST_RUNS
    )
  })

  it('vacuum markers appear in canonical preOpen<preClose<postOpen<postClose ORDER', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          { vacuumZoneAllocation: allocation }
        )
        const i1 = gcode.indexOf(LAGUNA_VACUUM_PREAMBLE_OPEN)
        const i2 = gcode.indexOf(LAGUNA_VACUUM_PREAMBLE_CLOSE)
        const i3 = gcode.indexOf(LAGUNA_VACUUM_POSTAMBLE_OPEN)
        const i4 = gcode.indexOf(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
        return i1 >= 0 && i1 < i2 && i2 < i3 && i3 < i4
      }),
      FAST_RUNS
    )
  })
})

// --------------------------------------------------------------------
// Property group F -- pure synchronous ordering invariants
// --------------------------------------------------------------------
// These do not call renderPost; they pin pure-function invariants over
// the allocator + P-number map. Larger numRuns is fine because there
// is no async overhead. Pairs naturally with the SEED file's
// "allocator property fuzz" describe block but pivots from
// shape-only invariants to ORDER and MAPPING invariants.
describe('allocator + P-number map property extension [ID-0192] -- ordering invariants', () => {
  it('engaged ids appear in the same relative order as LAGUNA_VACUUM_ZONES (registry order)', () => {
    const zoneIdsInOrder = LAGUNA_VACUUM_ZONES.map((z) => z.id)
    fc.assert(
      fc.property(allocationArb, (allocation) => {
        // Walk the registry; every engaged id we see must come AFTER
        // every previously-seen engaged id in allocation.engaged.
        const engagedSet = new Set(allocation.engaged)
        const expectedOrder = zoneIdsInOrder.filter((id) => engagedSet.has(id))
        if (expectedOrder.length !== allocation.engaged.length) return false
        for (let i = 0; i < expectedOrder.length; i++) {
          if (expectedOrder[i] !== allocation.engaged[i]) return false
        }
        return true
      }),
      SYNC_RUNS
    )
  })

  it('engaged P-numbers are strictly increasing (column-major monotonic)', () => {
    fc.assert(
      fc.property(allocationArb, (allocation) => {
        const ps = allocation.engaged
          .map((id) => LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP[id])
          .filter((p): p is number => typeof p === 'number')
        if (ps.length !== allocation.engaged.length) return false
        return isStrictlyIncreasing(ps)
      }),
      SYNC_RUNS
    )
  })

  it('every zone id resolves to a P-number in [0, 5]', () => {
    fc.assert(
      fc.property(allocationArb, (allocation) => {
        for (const id of [...allocation.engaged, ...allocation.idle]) {
          const p = LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP[id]
          if (typeof p !== 'number') return false
          if (p < 0 || p > 5) return false
          if (!Number.isInteger(p)) return false
        }
        return true
      }),
      SYNC_RUNS
    )
  })

  it('engaged + idle P-number multisets union to exactly {0,1,2,3,4,5}', () => {
    fc.assert(
      fc.property(allocationArb, (allocation) => {
        const all = [...allocation.engaged, ...allocation.idle]
          .map((id) => LAGUNA_VACUUM_DIGITAL_OUTPUT_MAP[id])
          .filter((p): p is number => typeof p === 'number')
        const sorted = [...all].sort((x, y) => x - y)
        if (sorted.length !== 6) return false
        for (let i = 0; i < 6; i++) {
          if (sorted[i] !== i) return false
        }
        return true
      }),
      SYNC_RUNS
    )
  })
})

// --------------------------------------------------------------------
// Paired-pin sanity -- not a property test, but a static assertion
// that the helper extractors above behave correctly on a hand-built
// fixture. Catches a regression in `extractPNumbers` /
// `inputOrderPreserved` / `multisetEqual` themselves -- the helpers
// must hold their own contract before they can guard the wrap.
// --------------------------------------------------------------------
describe('post-process property extension [ID-0192] -- helper self-tests', () => {
  it('extractPNumbers parses M64 P<n> lines correctly', () => {
    const sample = [
      '; preamble open',
      'M64 P0              ; engage A1',
      'M64 P3              ; engage B2',
      'M64 P5              ; engage C3',
      'G1 X1 Y1 F100',
      'M65 P0              ; release A1',
    ].join('\n')
    expect(extractPNumbers(sample, 'M64')).toEqual([0, 3, 5])
    expect(extractPNumbers(sample, 'M65')).toEqual([0])
  })

  it('extractPNumbers returns [] when no matching mcode lines exist', () => {
    expect(extractPNumbers('G0 X0 Y0\nG1 X10 F100', 'M64')).toEqual([])
    expect(extractPNumbers('', 'M65')).toEqual([])
  })

  it('isStrictlyIncreasing handles edge cases', () => {
    expect(isStrictlyIncreasing([])).toBe(true)
    expect(isStrictlyIncreasing([0])).toBe(true)
    expect(isStrictlyIncreasing([0, 1, 2, 3, 4, 5])).toBe(true)
    expect(isStrictlyIncreasing([0, 1, 1])).toBe(false) // equal not allowed
    expect(isStrictlyIncreasing([5, 3, 1])).toBe(false)
  })

  it('multisetEqual handles permutations and length mismatches', () => {
    expect(multisetEqual([], [])).toBe(true)
    expect(multisetEqual([1, 2, 3], [3, 2, 1])).toBe(true)
    expect(multisetEqual([1, 2, 3], [1, 2])).toBe(false)
    expect(multisetEqual([1, 1, 2], [1, 2, 2])).toBe(false)
  })

  it('inputOrderPreserved finds inputs in order even when interleaved with extra text', () => {
    expect(
      inputOrderPreserved(
        'X\nA\nY\nB\nZ\nC',
        ['A', 'B', 'C']
      )
    ).toBe(true)
    expect(
      inputOrderPreserved(
        'C\nB\nA',
        ['A', 'B', 'C']
      )
    ).toBe(false) // wrong order
    expect(inputOrderPreserved('X\nY', ['A'])).toBe(false) // missing
    expect(inputOrderPreserved('A', [])).toBe(true) // empty input always trivially preserved
  })
})
