/**
 * Machine schema -- ATC (automatic tool changer) capability fields.
 * Roadmap [ID-0093].
 *
 * Pins the two new optional CNC-side fields that scaffold the future
 * Carvera ATC M6 tool-change macro:
 *   - `atcSlotCount`  -- positive int   (Carvera 3-axis: 6)
 *   - `atcProbeSlot`  -- non-negative int (Carvera: 0 = T0 probe)
 *
 * Safety Rule 2 (schema changes need migrations): both fields are
 * *optional* additions. Pre-existing saved projects that reference the
 * older shape must still parse without error. The "minimal profile
 * still parses" + "pre-[ID-0093] Carvera-3axis shape still parses"
 * tests pin this invariant directly.
 *
 * Bundled-profile pinning:
 *   - Loads `resources/machines/makera-carvera-3axis.json` and asserts
 *     concrete values so a future drift (e.g. atcSlotCount regressing
 *     to 4 or atcProbeSlot regressing to undefined) is caught at the
 *     schema layer.
 *   - Loads `resources/machines/makera-carvera-4axis.json` and asserts
 *     atcSlotCount IS undefined (rotary attachment occupies the ATC
 *     bay; ATC unsupported in 4-axis mode -- see the maintainer note
 *     in `resources/posts/carvera_4axis.hbs` lines 5-7).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema } from './machine-schema'

const minimalCnc = {
  id: 'cnc1',
  name: 'Bench',
  kind: 'cnc' as const,
  workAreaMm: { x: 200, y: 200, z: 50 },
  maxFeedMmMin: 3000,
  postTemplate: 'grbl_mm.hbs',
  dialect: 'grbl' as const
}

const RESOURCES_ROOT = join(process.cwd(), 'resources')

function loadCarvera3axisJson(): unknown {
  const path = join(RESOURCES_ROOT, 'machines', 'makera-carvera-3axis.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function loadCarvera4axisJson(): unknown {
  const path = join(RESOURCES_ROOT, 'machines', 'makera-carvera-4axis.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('machineProfileSchema -- ATC fields ([ID-0093])', () => {
  describe('atcSlotCount', () => {
    it('accepts a positive integer (Carvera 3-axis: 6)', () => {
      const m = machineProfileSchema.parse({ ...minimalCnc, atcSlotCount: 6 })
      expect(m.atcSlotCount).toBe(6)
    })

    it('accepts a small positive integer (1)', () => {
      const m = machineProfileSchema.parse({ ...minimalCnc, atcSlotCount: 1 })
      expect(m.atcSlotCount).toBe(1)
    })

    it('rejects zero (no ATC should be modeled by leaving the field undefined, not by setting 0)', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, atcSlotCount: 0 })
      ).toThrow()
    })

    it('rejects negative counts', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, atcSlotCount: -1 })
      ).toThrow()
    })

    it('rejects non-integer counts (3.5 slots is meaningless)', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, atcSlotCount: 3.5 })
      ).toThrow()
    })

    it('rejects string values', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, atcSlotCount: '6' as never })
      ).toThrow()
    })

    it('is optional (absent from minimal CNC profile)', () => {
      const m = machineProfileSchema.parse(minimalCnc)
      expect(m.atcSlotCount).toBeUndefined()
    })
  })

  describe('atcProbeSlot', () => {
    it('accepts zero (Carvera: T0 = wireless probe)', () => {
      const m = machineProfileSchema.parse({ ...minimalCnc, atcProbeSlot: 0 })
      expect(m.atcProbeSlot).toBe(0)
    })

    it('accepts a positive integer (a future controller might reserve T1)', () => {
      const m = machineProfileSchema.parse({ ...minimalCnc, atcProbeSlot: 1 })
      expect(m.atcProbeSlot).toBe(1)
    })

    it('rejects negative slot indices', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, atcProbeSlot: -1 })
      ).toThrow()
    })

    it('rejects non-integer slot indices', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, atcProbeSlot: 0.5 })
      ).toThrow()
    })

    it('is optional (absent from minimal CNC profile)', () => {
      const m = machineProfileSchema.parse(minimalCnc)
      expect(m.atcProbeSlot).toBeUndefined()
    })
  })

  describe('migration safety (Safety Rule 2)', () => {
    it('pre-[ID-0093] Carvera-3axis shape (no atc fields) still parses', () => {
      const preShape = {
        id: 'makera-carvera-3axis',
        name: 'Makera Carvera (3-Axis)',
        kind: 'cnc' as const,
        workAreaMm: { x: 360, y: 240, z: 140 },
        maxFeedMmMin: 2400,
        postTemplate: 'carvera_3axis.hbs',
        dialect: 'grbl' as const,
        axisCount: 3,
        maxSpindleRpm: 15000,
        minSpindleRpm: 6000,
        meta: {
          manufacturer: 'Makera',
          model: 'Carvera',
          source: 'bundled' as const,
          cncProfile: '3d' as const
        }
      }
      const m = machineProfileSchema.parse(preShape)
      expect(m.atcSlotCount).toBeUndefined()
      expect(m.atcProbeSlot).toBeUndefined()
      // Identity preservation: nothing else changed.
      expect(m.id).toBe('makera-carvera-3axis')
      expect(m.dialect).toBe('grbl')
      expect(m.axisCount).toBe(3)
    })

    it('atcSlotCount and atcProbeSlot are independently composable', () => {
      // Set just atcSlotCount.
      const a = machineProfileSchema.parse({ ...minimalCnc, atcSlotCount: 6 })
      expect(a.atcSlotCount).toBe(6)
      expect(a.atcProbeSlot).toBeUndefined()
      // Set just atcProbeSlot. Schema does not require atcSlotCount to be set.
      const b = machineProfileSchema.parse({ ...minimalCnc, atcProbeSlot: 0 })
      expect(b.atcSlotCount).toBeUndefined()
      expect(b.atcProbeSlot).toBe(0)
    })

    it('FDM profiles can omit both fields without complaint', () => {
      const minimalFdm = {
        id: 'fdm1',
        name: 'Bench FDM',
        kind: 'fdm' as const,
        workAreaMm: { x: 220, y: 220, z: 250 },
        maxFeedMmMin: 18000,
        postTemplate: 'fdm_passthrough.hbs',
        dialect: 'generic_mm' as const
      }
      const m = machineProfileSchema.parse(minimalFdm)
      expect(m.atcSlotCount).toBeUndefined()
      expect(m.atcProbeSlot).toBeUndefined()
      expect(m.kind).toBe('fdm')
    })
  })

  describe('bundled profile pinning -- Carvera 3-axis', () => {
    it('parses with the new ATC fields set to expected values', () => {
      const m = machineProfileSchema.parse(loadCarvera3axisJson())
      expect(m.id).toBe('makera-carvera-3axis')
      expect(m.atcSlotCount).toBe(6)
      expect(m.atcProbeSlot).toBe(0)
    })

    it('preserves all pre-[ID-0093] identity fields after the additive bump', () => {
      const m = machineProfileSchema.parse(loadCarvera3axisJson())
      expect(m.kind).toBe('cnc')
      // [ID-0160] Cycle 68 — Carvera 3-axis dialect flipped 'grbl' → 'smoothieware'
      // (Smoothieware-family controllers support TLC; GRBL_NO_TLC false-positive
      // resolved by the dialect-compliance validator's smoothieware family).
      expect(m.dialect).toBe('smoothieware')
      expect(m.postTemplate).toBe('carvera_3axis.hbs')
      expect(m.axisCount).toBe(3)
      expect(m.maxSpindleRpm).toBe(15000)
      // Bumped from 6000 to 13000 per CLAUDE.md 200 W spindle spec
      // (13,000–15,000 RPM); sub-13k risks spindle damage.
      expect(m.minSpindleRpm).toBe(13000)
      expect(m.workAreaMm).toEqual({ x: 360, y: 240, z: 140 })
    })
  })

  describe('bundled profile pinning -- Carvera 4-axis', () => {
    it('intentionally OMITS atcSlotCount (rotary occupies ATC bay; see carvera_4axis.hbs maintainer note)', () => {
      const m = machineProfileSchema.parse(loadCarvera4axisJson())
      expect(m.atcSlotCount).toBeUndefined()
      expect(m.atcProbeSlot).toBeUndefined()
      // Cross-check that the JSON literally does not declare the keys.
      const raw = loadCarvera4axisJson() as Record<string, unknown>
      expect(Object.keys(raw)).not.toContain('atcSlotCount')
      expect(Object.keys(raw)).not.toContain('atcProbeSlot')
    })

    it('still has axisCount=4 and the rotary chuck radius set', () => {
      const m = machineProfileSchema.parse(loadCarvera4axisJson())
      expect(m.axisCount).toBe(4)
      expect(m.rotaryChuckOuterRadiusMm).toBe(46)
    })
  })
})
