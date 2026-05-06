/**
 * Creality K2 Plus -- machine-schema extension tests ([ID-0012]).
 *
 * Pins the seven new optional FDM fields that CLAUDE.md's "USER CONTEXT --
 * TARGET MACHINES #1 (Creality K2 Plus)" calls out as first-class
 * capabilities:
 *   - maxNozzleTempC        (positive number)  -- K2 Plus: 350 C ceiling
 *   - maxBedTempC           (positive number)  -- K2 Plus: 120 C ceiling
 *   - chamberTempC          (positive number)  -- heated-chamber target
 *   - inputShapingPresets   (array of strings) -- Klipper preset names
 *   - rfidFilamentSupport   (boolean)          -- RFID spool detection
 *   - cfsMultiColorEnabled  (boolean)          -- Creality CFS attached
 *   - powerLossRecovery     (boolean)          -- resume after power cut
 *
 * Safety Rule 2 (schema changes need migrations):
 *   All seven fields are *optional* additions. Pre-existing saved projects
 *   that reference the old shape must still parse without error. The
 *   "pre-ID-0012 minimal profile still parses" test pins this directly.
 *
 * Per-machine coverage:
 *   The bundled `resources/machines/creality-k2-plus.json` is loaded and
 *   its concrete values are asserted, so the test catches any drift in the
 *   shipping defaults (e.g. maxBedTempC regressing to 100 would silently
 *   under-report the machine's envelope and break material-profile
 *   validation for high-bed materials like ABS/ASA/PC).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema } from './machine-schema'

const minimalFdm = {
  id: 'fdm1',
  name: 'Bench FDM',
  kind: 'fdm' as const,
  workAreaMm: { x: 200, y: 200, z: 200 },
  maxFeedMmMin: 9000,
  postTemplate: 'fdm_passthrough.hbs',
  dialect: 'generic_mm' as const
}

const RESOURCES_ROOT = join(process.cwd(), 'resources')

function loadK2Json(): unknown {
  const path = join(RESOURCES_ROOT, 'machines', 'creality-k2-plus.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

describe('machineProfileSchema -- K2 Plus meta extension (ID-0012)', () => {
  describe('maxNozzleTempC', () => {
    it('accepts the 350 C K2 Plus ceiling', () => {
      const m = machineProfileSchema.parse({ ...minimalFdm, maxNozzleTempC: 350 })
      expect(m.maxNozzleTempC).toBe(350)
    })

    it('accepts a lower machine ceiling (e.g. 260 C)', () => {
      const m = machineProfileSchema.parse({ ...minimalFdm, maxNozzleTempC: 260 })
      expect(m.maxNozzleTempC).toBe(260)
    })

    it('rejects zero (no hotend is not a machine)', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalFdm, maxNozzleTempC: 0 })
      ).toThrow()
    })

    it('rejects negative nozzle ceilings', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalFdm, maxNozzleTempC: -5 })
      ).toThrow()
    })

    it('is optional (absent from minimal profile)', () => {
      const m = machineProfileSchema.parse(minimalFdm)
      expect(m.maxNozzleTempC).toBeUndefined()
    })
  })

  describe('maxBedTempC', () => {
    it('accepts the 120 C K2 Plus ceiling', () => {
      const m = machineProfileSchema.parse({ ...minimalFdm, maxBedTempC: 120 })
      expect(m.maxBedTempC).toBe(120)
    })

    it('rejects zero', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalFdm, maxBedTempC: 0 })
      ).toThrow()
    })

    it('rejects negative bed ceilings', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalFdm, maxBedTempC: -10 })
      ).toThrow()
    })

    it('is optional (absent from minimal profile)', () => {
      const m = machineProfileSchema.parse(minimalFdm)
      expect(m.maxBedTempC).toBeUndefined()
    })
  })

  describe('chamberTempC', () => {
    it('accepts a positive chamber target (K2 Plus ships 60 C)', () => {
      const m = machineProfileSchema.parse({ ...minimalFdm, chamberTempC: 60 })
      expect(m.chamberTempC).toBe(60)
    })

    it('rejects zero (absence means no chamber, not zero chamber)', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalFdm, chamberTempC: 0 })
      ).toThrow()
    })

    it('rejects negative chamber targets', () => {
      expect(() =>
        machineProfileSchema.parse({ ...minimalFdm, chamberTempC: -1 })
      ).toThrow()
    })

    it('is optional -- absent means "no heated chamber"', () => {
      const m = machineProfileSchema.parse(minimalFdm)
      expect(m.chamberTempC).toBeUndefined()
    })
  })

  describe('inputShapingPresets', () => {
    it('accepts the K2 Plus / Klipper preset set', () => {
      const presets = ['ZV', 'MZV', 'EI', '2HUMP_EI', '3HUMP_EI']
      const m = machineProfileSchema.parse({
        ...minimalFdm,
        inputShapingPresets: presets
      })
      expect(m.inputShapingPresets).toEqual(presets)
    })

    it('accepts an empty list (machine exposes no presets)', () => {
      const m = machineProfileSchema.parse({
        ...minimalFdm,
        inputShapingPresets: []
      })
      expect(m.inputShapingPresets).toEqual([])
    })

    it('rejects empty-string preset names', () => {
      expect(() =>
        machineProfileSchema.parse({
          ...minimalFdm,
          inputShapingPresets: ['ZV', '']
        })
      ).toThrow()
    })

    it('rejects whitespace-only preset names', () => {
      expect(() =>
        machineProfileSchema.parse({
          ...minimalFdm,
          inputShapingPresets: ['   ']
        })
      ).toThrow()
    })

    it('rejects non-string preset entries', () => {
      expect(() =>
        machineProfileSchema.parse({
          ...minimalFdm,
          inputShapingPresets: ['ZV', 42 as unknown as string]
        })
      ).toThrow()
    })

    it('is optional (absent from minimal profile)', () => {
      const m = machineProfileSchema.parse(minimalFdm)
      expect(m.inputShapingPresets).toBeUndefined()
    })
  })

  describe('rfidFilamentSupport / cfsMultiColorEnabled / powerLossRecovery', () => {
    it('accepts true for all three boolean capability flags', () => {
      const m = machineProfileSchema.parse({
        ...minimalFdm,
        rfidFilamentSupport: true,
        cfsMultiColorEnabled: true,
        powerLossRecovery: true
      })
      expect(m.rfidFilamentSupport).toBe(true)
      expect(m.cfsMultiColorEnabled).toBe(true)
      expect(m.powerLossRecovery).toBe(true)
    })

    it('accepts false for all three (non-K2 FDM machine)', () => {
      const m = machineProfileSchema.parse({
        ...minimalFdm,
        rfidFilamentSupport: false,
        cfsMultiColorEnabled: false,
        powerLossRecovery: false
      })
      expect(m.rfidFilamentSupport).toBe(false)
      expect(m.cfsMultiColorEnabled).toBe(false)
      expect(m.powerLossRecovery).toBe(false)
    })

    it('rejects non-boolean values on each flag', () => {
      for (const key of [
        'rfidFilamentSupport',
        'cfsMultiColorEnabled',
        'powerLossRecovery'
      ] as const) {
        expect(
          () =>
            machineProfileSchema.parse({
              ...minimalFdm,
              [key]: 'yes' as unknown as boolean
            }),
          `${key} should reject a string`
        ).toThrow()
        expect(
          () =>
            machineProfileSchema.parse({
              ...minimalFdm,
              [key]: 1 as unknown as boolean
            }),
          `${key} should reject a number`
        ).toThrow()
      }
    })

    it('all three are optional (absent from minimal profile)', () => {
      const m = machineProfileSchema.parse(minimalFdm)
      expect(m.rfidFilamentSupport).toBeUndefined()
      expect(m.cfsMultiColorEnabled).toBeUndefined()
      expect(m.powerLossRecovery).toBeUndefined()
    })
  })

  describe('migration safety -- Safety Rule 2', () => {
    it('pre-existing minimal profile (no new fields) still parses cleanly', () => {
      const m = machineProfileSchema.parse(minimalFdm)
      expect(m.maxNozzleTempC).toBeUndefined()
      expect(m.maxBedTempC).toBeUndefined()
      expect(m.chamberTempC).toBeUndefined()
      expect(m.inputShapingPresets).toBeUndefined()
      expect(m.rfidFilamentSupport).toBeUndefined()
      expect(m.cfsMultiColorEnabled).toBeUndefined()
      expect(m.powerLossRecovery).toBeUndefined()
    })

    it('pre-ID-0012 K2 profile shape still parses (saved projects)', () => {
      // Replays exactly the K2 Plus profile shape shipped before [ID-0012]
      // landed. This is the bundled profile as of 2026-04-23 -- any saved
      // project referencing this shape must continue to parse indefinitely.
      const preId0012 = {
        id: 'creality-k2-plus',
        name: 'Creality K2 Plus',
        kind: 'fdm' as const,
        workAreaMm: { x: 350, y: 350, z: 350 },
        maxFeedMmMin: 18000,
        postTemplate: 'fdm_passthrough.hbs',
        dialect: 'generic_mm' as const,
        meta: {
          manufacturer: 'Creality',
          model: 'K2 Plus',
          source: 'bundled' as const
        }
      }
      const m = machineProfileSchema.parse(preId0012)
      expect(m.id).toBe('creality-k2-plus')
      expect(m.maxNozzleTempC).toBeUndefined()
      expect(m.maxBedTempC).toBeUndefined()
      expect(m.chamberTempC).toBeUndefined()
      expect(m.inputShapingPresets).toBeUndefined()
      expect(m.rfidFilamentSupport).toBeUndefined()
      expect(m.cfsMultiColorEnabled).toBeUndefined()
      expect(m.powerLossRecovery).toBeUndefined()
    })
  })

  describe('bundled resources/machines/creality-k2-plus.json', () => {
    it('parses against the current machineProfileSchema', () => {
      expect(() => machineProfileSchema.parse(loadK2Json())).not.toThrow()
    })

    it('ships maxNozzleTempC = 350 (CLAUDE.md K2 Plus ceiling)', () => {
      const m = machineProfileSchema.parse(loadK2Json())
      expect(m.maxNozzleTempC).toBe(350)
    })

    it('ships maxBedTempC = 120 (CLAUDE.md K2 Plus ceiling)', () => {
      const m = machineProfileSchema.parse(loadK2Json())
      expect(m.maxBedTempC).toBe(120)
    })

    it('ships a positive chamberTempC (heated chamber is a K2 Plus feature)', () => {
      const m = machineProfileSchema.parse(loadK2Json())
      expect(m.chamberTempC).toBeDefined()
      const c = m.chamberTempC as number
      expect(c).toBeGreaterThan(0)
      // Chamber target must be below the bed ceiling (physical reality:
      // the bed is the dominant chamber heat source on the K2 Plus).
      expect(c).toBeLessThanOrEqual(m.maxBedTempC ?? Number.POSITIVE_INFINITY)
    })

    it('ships at least one input-shaping preset (Klipper exposes several)', () => {
      const m = machineProfileSchema.parse(loadK2Json())
      expect(m.inputShapingPresets).toBeDefined()
      const presets = m.inputShapingPresets as string[]
      expect(presets.length).toBeGreaterThan(0)
      // All three Klipper baseline presets must be present.
      for (const required of ['ZV', 'MZV', 'EI']) {
        expect(presets).toContain(required)
      }
    })

    it('ships rfidFilamentSupport = true (K2 Plus ships with RFID)', () => {
      const m = machineProfileSchema.parse(loadK2Json())
      expect(m.rfidFilamentSupport).toBe(true)
    })

    it('ships cfsMultiColorEnabled = true (K2 Plus CFS-ready)', () => {
      const m = machineProfileSchema.parse(loadK2Json())
      expect(m.cfsMultiColorEnabled).toBe(true)
    })

    it('ships powerLossRecovery = true (K2 Plus firmware capability)', () => {
      const m = machineProfileSchema.parse(loadK2Json())
      expect(m.powerLossRecovery).toBe(true)
    })

    it('preserves the K2 Plus identity fields (id / kind / dialect / post / workArea)', () => {
      // Guards against accidental collateral edits when new fields land.
      const m = machineProfileSchema.parse(loadK2Json())
      expect(m.id).toBe('creality-k2-plus')
      expect(m.name).toBe('Creality K2 Plus')
      expect(m.kind).toBe('fdm')
      expect(m.dialect).toBe('generic_mm')
      expect(m.postTemplate).toBe('fdm_passthrough.hbs')
      expect(m.workAreaMm).toEqual({ x: 350, y: 350, z: 350 })
    })
  })

  describe('schema self-consistency', () => {
    it('new top-level fields all carry .describe() annotations', () => {
      const shape = machineProfileSchema.shape
      expect(shape.maxNozzleTempC.description).toBeTruthy()
      expect(shape.maxBedTempC.description).toBeTruthy()
      expect(shape.chamberTempC.description).toBeTruthy()
      expect(shape.inputShapingPresets.description).toBeTruthy()
      expect(shape.rfidFilamentSupport.description).toBeTruthy()
      expect(shape.cfsMultiColorEnabled.description).toBeTruthy()
      expect(shape.powerLossRecovery.description).toBeTruthy()
    })

    it('fields compose independently (any subset is accepted)', () => {
      // Proves a caller can populate one without the others -- essential
      // for future FDM machines that only share a subset of these traits.
      const a = machineProfileSchema.parse({ ...minimalFdm, maxNozzleTempC: 300 })
      expect(a.maxBedTempC).toBeUndefined()
      expect(a.rfidFilamentSupport).toBeUndefined()

      const b = machineProfileSchema.parse({ ...minimalFdm, cfsMultiColorEnabled: true })
      expect(b.maxNozzleTempC).toBeUndefined()
      expect(b.powerLossRecovery).toBeUndefined()

      const c = machineProfileSchema.parse({
        ...minimalFdm,
        inputShapingPresets: ['ZV']
      })
      expect(c.chamberTempC).toBeUndefined()
      expect(c.rfidFilamentSupport).toBeUndefined()
    })
  })
})
