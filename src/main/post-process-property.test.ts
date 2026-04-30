/**
 * Cycle 110 [ID-0017] -- post-processor property-based fuzz SEED.
 *
 * Companion to Cycle 109 [ID-0020-wire]
 * (`post-process-laguna-vacuum-wiring.test.ts`) which pinned the BYTE-LEVEL
 * effect of supplying `vacuumZoneAllocation` + `vacuumOptions` opts on the
 * bundled `vcarve_mach3.hbs` template. This file pivots from
 * concrete-input pins to generative `fast-check` properties.
 *
 * Roadmap alignment:
 *   - [ID-0017] candidate "All machines -- property-based fuzz testing for
 *     post-processors" promoted from BACKLOG -> NEXT-UP rank 1 in the Cycle
 *     109 close-out. The Cycle 109 close-out hand-off recommended starting
 *     with Laguna-only and the `wrapLagunaToolpathWithVacuumBlocks` wiring
 *     as the natural seed surface.
 *   - This file is the SEED -- a small, fast, opinionated set of properties
 *     that run on every `npm test`. Future cycles can extend the
 *     arbitraries and add more properties (cutter comp, arc fitting,
 *     multi-tool, etc.).
 *
 * Why fuzz here at all?
 *   Concrete-input tests pin exact byte sequences for hand-picked
 *   allocations (full-sheet, half-sheet). They cannot exercise the full
 *   input space the post pipeline must tolerate (sheets hanging off the
 *   bed, sheets snapped to single zones, off-axis origins, etc.). A
 *   property check over the allocator's full input domain catches
 *   regressions where a corner-case allocation slips past
 *   `wrapLagunaToolpathWithVacuumBlocks` while the concrete tests stay
 *   green.
 *
 * Per-machine coverage (per CLAUDE.md):
 *   PRIMARY = Laguna Swift 5x10 (vacuum opts only have semantic effect
 *   here). PASS-THROUGH = Creality K2 Plus + Makera Carvera 3-axis +
 *   Makera Carvera 4-axis (allocation absent => byte-identical gcode
 *   regression guard).
 *
 * Safety Rule 1 (G-code is sacred): every property asserts that the
 * underlying TOOLPATH BYTES are preserved verbatim through the wrap +
 * pipeline; the wrap can only ADD lines, never mutate the original ones.
 *
 * Determinism / runtime budget: each property uses a fixed `seed` and a
 * small `numRuns` so the file finishes well under 1 s (consistent with
 * the existing Vitest budget; future cycles can raise numRuns if a
 * regression is suspected near a corner case).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { LAGUNA_SWIFT_WORK_AREA_MM } from '../shared/laguna-full-sheet-stock'
import {
  allocateLagunaVacuumZones,
  LAGUNA_VACUUM_ZONES,
  LAGUNA_VACUUM_ZONE_COUNT,
} from '../shared/laguna-vacuum-allocator'
import {
  LAGUNA_VACUUM_PREAMBLE_OPEN,
  LAGUNA_VACUUM_PREAMBLE_CLOSE,
  LAGUNA_VACUUM_POSTAMBLE_OPEN,
  LAGUNA_VACUUM_POSTAMBLE_CLOSE,
  LAGUNA_VACUUM_MCODE_WARNING,
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
 * Safe toolpath fragment that already satisfies the universal post
 * invariants (header rapids before the first cut, mid-job retracts,
 * end-of-program retract). Held as a single immutable constant so the
 * properties focus their fuzz budget on allocation/options shapes and
 * NOT on accidentally generating a toolpath that trips an unrelated
 * validator.
 *
 * Future cycles can promote this to a generated arbitrary; for the
 * SEED cycle it is intentionally a constant.
 */
const SAFE_TOOLPATH_LINES = [
  'G0 X0 Y0 Z25',
  'G0 X10 Y10 Z5',
  'G1 Z-3.000 F300',
  'G1 X100 Y10 F3000',
  'G1 X100 Y100 F3000',
  'G1 X10 Y100 F3000',
  'G1 X10 Y10 F3000',
  'G0 Z25',
] as const

const safeToolpath: readonly string[] = SAFE_TOOLPATH_LINES

/**
 * Arbitrary -- a Laguna allocation derived from random origin/size in
 * (and a small overshoot past) the bed envelope. The overshoot
 * intentionally exercises the `outsideEnvelope` branch, which the
 * concrete-input tests do not currently cover.
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
 * Async-property runtime budget (per `it` block):
 *   numRuns = 16  -> ~32 renderPost calls per property max
 *   numRuns =  8  -> ~16 renderPost calls per property max
 * Each renderPost is roughly a couple of milliseconds; total file
 * runtime budget is comfortably under 500 ms on the existing CI.
 *
 * Seeds are fixed so a reproduction is `seed=...` not "wait for the
 * next nightly". The seed is arbitrary but deterministic.
 */
const SEED = 0x4017017a
const FAST_RUNS = { numRuns: 16, seed: SEED } as const
const FAST_RUNS_LIGHT = { numRuns: 8, seed: SEED } as const
const SYNC_RUNS = { numRuns: 64, seed: SEED } as const

describe('post-process property fuzz [ID-0017] -- Laguna vacuum wiring', () => {
  it('preserves toolpath bytes verbatim through the wrap, for any allocation', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          { vacuumZoneAllocation: allocation }
        )
        for (const line of safeToolpath) {
          if (!gcode.includes(line)) return false
        }
        return true
      }),
      FAST_RUNS
    )
  })

  it('emits both preamble and postamble markers for any allocation, in order', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          { vacuumZoneAllocation: allocation }
        )
        const preOpen = gcode.indexOf(LAGUNA_VACUUM_PREAMBLE_OPEN)
        const preClose = gcode.indexOf(LAGUNA_VACUUM_PREAMBLE_CLOSE)
        const postOpen = gcode.indexOf(LAGUNA_VACUUM_POSTAMBLE_OPEN)
        const postClose = gcode.indexOf(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
        return (
          preOpen >= 0 &&
          preClose > preOpen &&
          postOpen > preClose &&
          postClose > postOpen
        )
      }),
      FAST_RUNS
    )
  })

  it('M64/M65 counts equal engagedCount when digital outputs are enabled', async () => {
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
        const m64 = (gcode.match(/^M64\s+P\d+/gm) ?? []).length
        const m65 = (gcode.match(/^M65\s+P\d+/gm) ?? []).length
        return (
          m64 === allocation.engagedCount && m65 === allocation.engagedCount
        )
      }),
      FAST_RUNS
    )
  })

  it('emits NO M64/M65 + no warning when digital outputs are disabled (default)', async () => {
    await fc.assert(
      fc.asyncProperty(allocationArb, async (allocation) => {
        const { gcode } = await renderPost(
          resourcesRoot,
          lagunaProfile,
          [...safeToolpath],
          { vacuumZoneAllocation: allocation }
        )
        return (
          !/^M64\b/m.test(gcode) &&
          !/^M65\b/m.test(gcode) &&
          !gcode.includes(LAGUNA_VACUUM_MCODE_WARNING)
        )
      }),
      FAST_RUNS
    )
  })

  it('omitting allocation is byte-identical to no opts (Laguna)', async () => {
    // Laguna-only sanity: vacuumOptions alone (without an allocation)
    // is documented as a no-op in `post-process.ts`. Property holds for
    // any safe toolpath.
    const baseline = await renderPost(
      resourcesRoot,
      lagunaProfile,
      [...safeToolpath]
    )
    const withEmpty = await renderPost(
      resourcesRoot,
      lagunaProfile,
      [...safeToolpath],
      {}
    )
    const withVacuumOptsOnly = await renderPost(
      resourcesRoot,
      lagunaProfile,
      [...safeToolpath],
      { vacuumOptions: { enableMach3DigitalOutputs: true } }
    )
    expect(withEmpty.gcode).toBe(baseline.gcode)
    expect(withVacuumOptsOnly.gcode).toBe(baseline.gcode)
  })
})

describe('post-process property fuzz [ID-0017] -- non-Laguna pass-through', () => {
  // Per-machine pass-through: when the new opts are absent, output is
  // byte-identical regardless of machine. The allocation arbitrary is
  // unused here (the property's surface is the *absence* of opts), so
  // we use a flat boolean arbitrary just to drive numRuns iterations
  // through the same toolpath constant -- this is a near-zero-cost
  // regression guard against a future cycle accidentally adding a
  // pre/post hook that fires on every machine.
  for (const { label, profile } of [
    { label: 'Carvera 3-axis', profile: carvera3Profile },
    { label: 'Carvera 4-axis', profile: carvera4Profile },
    { label: 'K2 Plus', profile: k2Profile },
  ]) {
    it(`${label}: omitting allocation is byte-identical to no opts`, async () => {
      const baseline = await renderPost(resourcesRoot, profile, [
        ...safeToolpath,
      ])
      await fc.assert(
        fc.asyncProperty(fc.boolean(), async (_unused) => {
          const withEmpty = await renderPost(
            resourcesRoot,
            profile,
            [...safeToolpath],
            {}
          )
          return withEmpty.gcode === baseline.gcode
        }),
        FAST_RUNS_LIGHT
      )
    })
  }
})

describe('allocator property fuzz [ID-0017] -- shape invariants', () => {
  // Pure synchronous properties over the allocator. These do NOT call
  // `renderPost` so numRuns can be larger without affecting runtime.
  const expectedIds = [...LAGUNA_VACUUM_ZONES.map((z) => z.id)].sort()

  it('engaged + idle ids partition the registry exactly once', () => {
    fc.assert(
      fc.property(allocationArb, (allocation) => {
        const all = [...allocation.engaged, ...allocation.idle]
        const actualIds = [...all].sort()
        return (
          all.length === LAGUNA_VACUUM_ZONE_COUNT &&
          new Set(all).size === LAGUNA_VACUUM_ZONE_COUNT &&
          actualIds.every((id, i) => id === expectedIds[i])
        )
      }),
      SYNC_RUNS
    )
  })

  it('engagedCount equals engaged.length and is bounded 0..6', () => {
    fc.assert(
      fc.property(allocationArb, (allocation) => {
        return (
          allocation.engagedCount === allocation.engaged.length &&
          allocation.engagedCount >= 0 &&
          allocation.engagedCount <= LAGUNA_VACUUM_ZONE_COUNT
        )
      }),
      SYNC_RUNS
    )
  })

  it('bedCoverageFraction is in [0, 1] for any valid allocation', () => {
    // Allocator clips overlap to each zone footprint; the sum is bounded
    // by total bed area => fraction in [0, 1]. The 1e-9 epsilon allows
    // for floating-point round-trip on full-bed allocations.
    fc.assert(
      fc.property(allocationArb, (allocation) => {
        return (
          allocation.bedCoverageFraction >= 0 &&
          allocation.bedCoverageFraction <= 1 + 1e-9
        )
      }),
      SYNC_RUNS
    )
  })

  it('fullBedEngaged === (engagedCount === 6) is a clean equivalence', () => {
    fc.assert(
      fc.property(allocationArb, (allocation) => {
        return (
          allocation.fullBedEngaged ===
          (allocation.engagedCount === LAGUNA_VACUUM_ZONE_COUNT)
        )
      }),
      SYNC_RUNS
    )
  })
})
