import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  filamentLibrarySchema,
  filamentRecordSchema,
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
