/**
 * `deriveAtcCapability` / `machineSupportsAtc` helper tests.
 * Roadmap [ID-0093].
 *
 * Pins the pure helper that turns a `MachineProfile` into a discriminated
 * `AtcCapability` value the future M6 macro emitter will branch on.
 *
 * Coverage:
 *   - FDM machines never support ATC (returns `reason: 'fdm'`).
 *   - CNC machines without `atcSlotCount` never support ATC
 *     (returns `reason: 'no-atc-slots'`).
 *   - CNC machines with positive `atcSlotCount` support ATC; the
 *     discriminated `supported: true` branch carries the slot count and,
 *     if set, the probe slot.
 *   - Bundled `makera-carvera-3axis.json` reports `supported: true,
 *     slotCount: 6, probeSlot: 0`.
 *   - Bundled `makera-carvera-4axis.json` reports `supported: false,
 *     reason: 'no-atc-slots'` (rotary occupies ATC bay).
 *   - Bundled `creality-k2-plus.json` reports `supported: false,
 *     reason: 'fdm'`.
 *   - Bundled `laguna-swift-5x10.json` reports `supported: false,
 *     reason: 'no-atc-slots'` (manual ER-20 collet).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from './machine-schema'
import {
  deriveAtcCapability,
  machineSupportsAtc
} from './post-process-atc-capability'

const RESOURCES_ROOT = join(process.cwd(), 'resources')

function loadProfile(filename: string): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', filename)
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

const minimalCnc: Pick<
  MachineProfile,
  'kind' | 'atcSlotCount' | 'atcProbeSlot'
> = {
  kind: 'cnc'
}

describe('deriveAtcCapability ([ID-0093])', () => {
  describe('FDM machines', () => {
    it('returns supported:false with reason "fdm" for FDM machines', () => {
      const cap = deriveAtcCapability({ kind: 'fdm' })
      expect(cap.supported).toBe(false)
      if (!cap.supported) {
        expect(cap.reason).toBe('fdm')
      }
    })

    it('ignores atcSlotCount when kind is FDM (FDM never has ATC)', () => {
      // Even if a malformed profile somehow set atcSlotCount on FDM,
      // the helper must still report not-supported with reason 'fdm'.
      const cap = deriveAtcCapability({
        kind: 'fdm',
        atcSlotCount: 6,
        atcProbeSlot: 0
      })
      expect(cap.supported).toBe(false)
      if (!cap.supported) {
        expect(cap.reason).toBe('fdm')
      }
    })
  })

  describe('CNC machines without atcSlotCount', () => {
    it('returns supported:false with reason "no-atc-slots" when atcSlotCount is undefined', () => {
      const cap = deriveAtcCapability(minimalCnc)
      expect(cap.supported).toBe(false)
      if (!cap.supported) {
        expect(cap.reason).toBe('no-atc-slots')
      }
    })
  })

  describe('CNC machines with atcSlotCount set', () => {
    it('returns supported:true and carries the slot count when probeSlot is unset', () => {
      const cap = deriveAtcCapability({ ...minimalCnc, atcSlotCount: 6 })
      expect(cap.supported).toBe(true)
      if (cap.supported) {
        expect(cap.slotCount).toBe(6)
        expect(cap.probeSlot).toBeUndefined()
      }
    })

    it('returns supported:true and carries both slotCount and probeSlot when both are set', () => {
      const cap = deriveAtcCapability({
        ...minimalCnc,
        atcSlotCount: 6,
        atcProbeSlot: 0
      })
      expect(cap.supported).toBe(true)
      if (cap.supported) {
        expect(cap.slotCount).toBe(6)
        expect(cap.probeSlot).toBe(0)
      }
    })

    it('preserves probeSlot when it is a positive integer', () => {
      const cap = deriveAtcCapability({
        ...minimalCnc,
        atcSlotCount: 8,
        atcProbeSlot: 1
      })
      expect(cap.supported).toBe(true)
      if (cap.supported) {
        expect(cap.slotCount).toBe(8)
        expect(cap.probeSlot).toBe(1)
      }
    })
  })

  describe('bundled profile pinning', () => {
    it('Makera Carvera 3-axis -> supported, 6 slots, probe at T0', () => {
      const m = loadProfile('makera-carvera-3axis.json')
      const cap = deriveAtcCapability(m)
      expect(cap.supported).toBe(true)
      if (cap.supported) {
        expect(cap.slotCount).toBe(6)
        expect(cap.probeSlot).toBe(0)
      }
    })

    it('Makera Carvera 4-axis -> NOT supported (rotary occupies ATC bay)', () => {
      const m = loadProfile('makera-carvera-4axis.json')
      const cap = deriveAtcCapability(m)
      expect(cap.supported).toBe(false)
      if (!cap.supported) {
        expect(cap.reason).toBe('no-atc-slots')
      }
    })

    it('Laguna Swift 5x10 -> NOT supported (manual ER-20 collet)', () => {
      const m = loadProfile('laguna-swift-5x10.json')
      const cap = deriveAtcCapability(m)
      expect(cap.supported).toBe(false)
      if (!cap.supported) {
        expect(cap.reason).toBe('no-atc-slots')
      }
    })

    it('Creality K2 Plus -> NOT supported (FDM)', () => {
      const m = loadProfile('creality-k2-plus.json')
      const cap = deriveAtcCapability(m)
      expect(cap.supported).toBe(false)
      if (!cap.supported) {
        expect(cap.reason).toBe('fdm')
      }
    })
  })
})

describe('machineSupportsAtc ([ID-0093] convenience predicate)', () => {
  it('returns true for the bundled Carvera 3-axis profile', () => {
    expect(machineSupportsAtc(loadProfile('makera-carvera-3axis.json'))).toBe(
      true
    )
  })

  it('returns false for the bundled Carvera 4-axis profile', () => {
    expect(machineSupportsAtc(loadProfile('makera-carvera-4axis.json'))).toBe(
      false
    )
  })

  it('returns false for the bundled Laguna Swift profile', () => {
    expect(machineSupportsAtc(loadProfile('laguna-swift-5x10.json'))).toBe(
      false
    )
  })

  it('returns false for the bundled Creality K2 Plus profile', () => {
    expect(machineSupportsAtc(loadProfile('creality-k2-plus.json'))).toBe(false)
  })

  it('agrees byte-for-byte with deriveAtcCapability(...).supported across the bundled fleet', () => {
    for (const fname of [
      'makera-carvera-3axis.json',
      'makera-carvera-4axis.json',
      'laguna-swift-5x10.json',
      'creality-k2-plus.json'
    ] as const) {
      const m = loadProfile(fname)
      expect(machineSupportsAtc(m)).toBe(deriveAtcCapability(m).supported)
    }
  })
})
