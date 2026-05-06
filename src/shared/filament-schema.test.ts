import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  filamentLibrarySchema,
  filamentRecordSchema,
  filamentToCuraSettings,
  FILAMENT_TYPE_LABELS,
  filamentTypeEnum,
  type FilamentRecord
} from './filament-schema'

const BUNDLED_PATH = join(__dirname, '../../resources/materials/default-filaments.json')
const K2_MAX_NOZZLE = 350
const K2_MAX_BED = 120

function loadBundledFilaments(): FilamentRecord[] {
  const raw = readFileSync(BUNDLED_PATH, 'utf-8')
  return filamentLibrarySchema.parse(JSON.parse(raw)).filaments
}

describe('filament-schema', () => {
  describe('bundled filaments parse cleanly', () => {
    const filaments = loadBundledFilaments()

    it('has at least 10 bundled filaments', () => {
      expect(filaments.length).toBeGreaterThanOrEqual(10)
    })

    it('every filament parses against the schema', () => {
      for (const f of filaments) {
        expect(() => filamentRecordSchema.parse(f)).not.toThrow()
      }
    })

    it('all filament ids are unique', () => {
      const ids = filaments.map(f => f.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('all filament types have labels', () => {
      for (const f of filaments) {
        expect(FILAMENT_TYPE_LABELS[f.type]).toBeDefined()
      }
    })
  })

  describe('K2 Plus hardware ceiling enforcement', () => {
    const filaments = loadBundledFilaments()

    it('nozzle temp within K2 ceiling (350C)', () => {
      for (const f of filaments) {
        expect(f.printSettings.nozzleTempC).toBeLessThanOrEqual(K2_MAX_NOZZLE)
        if (f.printSettings.nozzleTempFirstLayerC != null) {
          expect(f.printSettings.nozzleTempFirstLayerC).toBeLessThanOrEqual(K2_MAX_NOZZLE)
        }
      }
    })

    it('bed temp within K2 ceiling (120C)', () => {
      for (const f of filaments) {
        expect(f.printSettings.bedTempC).toBeLessThanOrEqual(K2_MAX_BED)
        if (f.printSettings.bedTempFirstLayerC != null) {
          expect(f.printSettings.bedTempFirstLayerC).toBeLessThanOrEqual(K2_MAX_BED)
        }
      }
    })

    it('fan speed percent in 0..100', () => {
      for (const f of filaments) {
        expect(f.printSettings.fanSpeedPercent).toBeGreaterThanOrEqual(0)
        expect(f.printSettings.fanSpeedPercent).toBeLessThanOrEqual(100)
      }
    })
  })

  describe('filamentToCuraSettings', () => {
    const pla: FilamentRecord = {
      id: 'test-pla',
      name: 'Test PLA',
      type: 'PLA',
      diameterMm: 1.75,
      printSettings: {
        nozzleTempC: 215,
        bedTempC: 60,
        chamberTempC: 35,
        fanSpeedPercent: 100,
        retractionMm: 0.5,
        retractionSpeedMmPerSec: 40
      }
    }

    it('maps nozzle temp to material_print_temperature', () => {
      const m = filamentToCuraSettings(pla)
      expect(m.get('material_print_temperature')).toBe('215')
    })

    it('maps bed temp to material_bed_temperature', () => {
      const m = filamentToCuraSettings(pla)
      expect(m.get('material_bed_temperature')).toBe('60')
    })

    it('maps chamber temp to build_volume_temperature', () => {
      const m = filamentToCuraSettings(pla)
      expect(m.get('build_volume_temperature')).toBe('35')
    })

    it('maps fan speed to cool_fan_speed', () => {
      const m = filamentToCuraSettings(pla)
      expect(m.get('cool_fan_speed')).toBe('100')
    })

    it('maps retraction to retraction_amount and retraction_speed', () => {
      const m = filamentToCuraSettings(pla)
      expect(m.get('retraction_amount')).toBe('0.5')
      expect(m.get('retraction_speed')).toBe('40')
    })

    it('omits optional keys when not set', () => {
      const minimal: FilamentRecord = {
        id: 'min',
        name: 'Minimal',
        type: 'PLA',
        diameterMm: 1.75,
        printSettings: {
          nozzleTempC: 200,
          bedTempC: 50,
          fanSpeedPercent: 100
        }
      }
      const m = filamentToCuraSettings(minimal)
      expect(m.has('build_volume_temperature')).toBe(false)
      expect(m.has('retraction_amount')).toBe(false)
      expect(m.has('retraction_speed')).toBe(false)
      expect(m.has('cool_fan_speed_0')).toBe(false)
    })

    it('includes first-layer overrides when set', () => {
      const abs: FilamentRecord = {
        id: 'abs',
        name: 'ABS',
        type: 'ABS',
        diameterMm: 1.75,
        printSettings: {
          nozzleTempC: 250,
          nozzleTempFirstLayerC: 255,
          bedTempC: 100,
          bedTempFirstLayerC: 105,
          fanSpeedPercent: 30,
          fanSpeedFirstLayerPercent: 0
        }
      }
      const m = filamentToCuraSettings(abs)
      expect(m.get('material_print_temperature_layer_0')).toBe('255')
      expect(m.get('material_bed_temperature_layer_0')).toBe('105')
      expect(m.get('cool_fan_speed_0')).toBe('0')
    })
  })

  describe('filamentTypeEnum', () => {
    it('has 13 types', () => {
      expect(filamentTypeEnum.options.length).toBe(13)
    })

    it('includes core types', () => {
      for (const t of ['PLA', 'ABS', 'PETG', 'TPU', 'ASA', 'PA', 'PC']) {
        expect(filamentTypeEnum.safeParse(t).success).toBe(true)
      }
    })
  })
})
