/**
 * Laguna Swift 5×10 — machine-schema extension tests ([ID-0005]).
 *
 * Pins the three new optional fields that CLAUDE.md's "USER CONTEXT —
 * TARGET MACHINES §2" calls out as first-class Laguna metadata:
 *   - `spindleVariantHp`   (3 | 6)               — spindle HP variant
 *   - `vacuumZoneCount`    (positive int)        — zoned vacuum table
 *   - `safeRetractZMm`     (positive number)     — post-emitted safe-Z
 *
 * Safety Rule 2 (schema changes need migrations):
 *   All three fields are *optional* additions. Pre-existing saved
 *   projects that reference the old shape must still parse without
 *   error. The "existing minimal profile still parses with the new
 *   fields absent" test pins this invariant directly.
 *
 * Per-machine coverage:
 *   The bundled `resources/machines/laguna-swift-5x10.json` is loaded
 *   and its concrete values are asserted so the test catches any future
 *   drift in the shipping defaults (e.g. vacuumZoneCount regressing to
 *   4 would silently break full-sheet job planning).
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

function loadLagunaJson(): unknown {
  const path = join(RESOURCES_ROOT, 'machines', 'laguna-swift-5x10.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('machineProfileSchema — Laguna meta extension (ID-0005)', () => {
  describe('spindleVariantHp', () => {
    it('accepts the 3 HP variant', () => {
      const m = machineProfileSchema.parse({ ...minimalCnc, spindleVariantHp: 3 })
      expect(m.spindleVariantHp).toBe(3)
    })

    it('accepts the 6 HP variant', () => {
      const m = machineProfileSchema.parse({ ...minimalCnc, spindleVariantHp: 6 })
      expect(m.spindleVariantHp).toBe(6)
    })

    it('rejects unsupported HP values (literal union enforced)', () => {
      for (const bogus of [0, 1, 2, 4, 5, 7, 10, 9999]) {
        expect(
          () =>
            machineProfileSchema.parse({
              ...minimalCnc,
              spindleVariantHp: bogus as never
            }),
          `spindleVariantHp=${bogus} should not parse`
        ).toThrow()
      }
    })

    it('rejects non-numeric HP values', () => {
      expect(() =>
        machineProfileSchema.parse({
          ...minimalCnc,
          spindleVariantHp: '3' as never
        })
      ).toThrow()
    })

    it('is optional (absent from minimal profile)', () => {
      const m = machineProfileSchema.parse(minimalCnc)
      expect(m.spindleVariantHp).toBeUndefined()
    })
  })

  describe('vacuumZoneCount', () => {
    it('accepts a positive integer count (Laguna default: 6)', () => {
      const m = machineProfileSchema.parse({ ...minimalCnc, vacuumZoneCount: 6 })
      expect(m.vacuumZoneCount).toBe(6)
    })

    it('rejects zero', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, vacuumZoneCount: 0 })
      ).toThrow()
    })

    it('rejects negative counts', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, vacuumZoneCount: -1 })
      ).toThrow()
    })

    it('rejects non-integer counts (0.5 zones makes no physical sense)', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, vacuumZoneCount: 2.5 })
      ).toThrow()
    })

    it('is optional (absent from minimal profile)', () => {
      const m = machineProfileSchema.parse(minimalCnc)
      expect(m.vacuumZoneCount).toBeUndefined()
    })
  })

  describe('safeRetractZMm', () => {
    it('accepts a positive retract height', () => {
      const m = machineProfileSchema.parse({ ...minimalCnc, safeRetractZMm: 25 })
      expect(m.safeRetractZMm).toBe(25)
    })

    it('accepts a sub-millimeter retract (e.g. small desktop machine)', () => {
      const m = machineProfileSchema.parse({ ...minimalCnc, safeRetractZMm: 0.5 })
      expect(m.safeRetractZMm).toBe(0.5)
    })

    it('rejects zero (no retract is not safe)', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, safeRetractZMm: 0 })
      ).toThrow()
    })

    it('rejects negative retracts', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalCnc, safeRetractZMm: -5 })
      ).toThrow()
    })

    it('is optional (absent from minimal profile)', () => {
      const m = machineProfileSchema.parse(minimalCnc)
      expect(m.safeRetractZMm).toBeUndefined()
    })
  })

  describe('migration safety — Safety Rule 2', () => {
    it('pre-existing minimal profile (no new fields) still parses cleanly', () => {
      // Simulates a saved project that references the old machine-schema shape.
      // If ANY of the new fields becomes required, this test will fail loudly.
      const m = machineProfileSchema.parse(minimalCnc)
      expect(m.spindleVariantHp).toBeUndefined()
      expect(m.vacuumZoneCount).toBeUndefined()
      expect(m.safeRetractZMm).toBeUndefined()
    })

    it('old Laguna-style profile without the new fields still parses', () => {
      // Replays exactly the shape shipped before ID-0005 landed.
      const preId0005 = {
        id: 'laguna-swift-5x10',
        name: 'Laguna Swift 5×10',
        kind: 'cnc' as const,
        workAreaMm: { x: 1524, y: 3048, z: 203 },
        maxFeedMmMin: 12000,
        postTemplate: 'vcarve_mach3.hbs',
        dialect: 'mach3' as const,
        maxSpindleRpm: 18000,
        minSpindleRpm: 8000,
        meta: {
          manufacturer: 'Laguna',
          model: 'Swift 5×10',
          source: 'bundled' as const,
          cncProfile: '2d' as const
        }
      }
      const m = machineProfileSchema.parse(preId0005)
      expect(m.id).toBe('laguna-swift-5x10')
      expect(m.spindleVariantHp).toBeUndefined()
      expect(m.vacuumZoneCount).toBeUndefined()
      expect(m.safeRetractZMm).toBeUndefined()
    })
  })

  describe('bundled resources/machines/laguna-swift-5x10.json', () => {
    it('parses against the current machineProfileSchema', () => {
      const json = loadLagunaJson()
      expect(() => machineProfileSchema.parse(json)).not.toThrow()
    })

    it('ships spindleVariantHp = 3 (base Laguna Swift 5×10 variant)', () => {
      const m = machineProfileSchema.parse(loadLagunaJson())
      expect(m.spindleVariantHp).toBe(3)
    })

    it('ships vacuumZoneCount = 6 per CLAUDE.md "6-zone typical"', () => {
      const m = machineProfileSchema.parse(loadLagunaJson())
      expect(m.vacuumZoneCount).toBe(6)
    })

    it('ships safeRetractZMm > 0 and strictly less than workAreaMm.z', () => {
      // The 25 mm default is conservative: well below the 203 mm envelope
      // top (full-retract), well above typical workpiece heights.
      const m = machineProfileSchema.parse(loadLagunaJson())
      expect(m.safeRetractZMm).toBeDefined()
      const retract = m.safeRetractZMm as number
      expect(retract).toBeGreaterThan(0)
      expect(retract).toBeLessThan(m.workAreaMm.z)
    })

    it('preserves the Laguna Swift identity fields (id / kind / dialect / post)', () => {
      // Guards against accidental collateral edits when new fields land.
      const m = machineProfileSchema.parse(loadLagunaJson())
      expect(m.id).toBe('laguna-swift-5x10')
      expect(m.kind).toBe('cnc')
      expect(m.dialect).toBe('mach3')
      expect(m.postTemplate).toBe('vcarve_mach3.hbs')
    })
  })

  describe('schema self-consistency', () => {
    it('new top-level fields all carry .describe() annotations', () => {
      // Mirrors the existing "all top-level fields have .describe()" test —
      // pins it specifically for the three fields ID-0005 adds.
      const shape = machineProfileSchema.shape
      expect(shape.spindleVariantHp.description).toBeTruthy()
      expect(shape.vacuumZoneCount.description).toBeTruthy()
      expect(shape.safeRetractZMm.description).toBeTruthy()
    })

    it('fields compose independently (any subset is accepted)', () => {
      // Proves a caller can populate one without the others — essential
      // for future machines that may only share a subset of these traits.
      const a = machineProfileSchema.parse({ ...minimalCnc, spindleVariantHp: 3 })
      expect(a.vacuumZoneCount).toBeUndefined()
      expect(a.safeRetractZMm).toBeUndefined()

      const b = machineProfileSchema.parse({ ...minimalCnc, vacuumZoneCount: 2 })
      expect(b.spindleVariantHp).toBeUndefined()
      expect(b.safeRetractZMm).toBeUndefined()

      const c = machineProfileSchema.parse({ ...minimalCnc, safeRetractZMm: 10 })
      expect(c.spindleVariantHp).toBeUndefined()
      expect(c.vacuumZoneCount).toBeUndefined()
    })
  })
})
