import { describe, expect, it } from 'vitest'
import {
  filamentTypeEnum,
  filamentRecordSchema,
  filamentPrintSettingsSchema,
  FILAMENT_TYPE_LABELS,
  FILAMENT_TYPE_GROUPS,
  type FilamentType
} from './filament-schema'

describe('filament-schema pin', () => {
  it('filamentTypeEnum has stable members', () => {
    expect(filamentTypeEnum.options).toEqual([
      'PLA', 'ABS', 'PETG', 'TPU', 'ASA', 'PA', 'PC',
      'PVA', 'HIPS', 'PLA_CF', 'PETG_CF', 'PA_CF', 'other'
    ])
  })

  it('FILAMENT_TYPE_LABELS covers every enum value', () => {
    for (const t of filamentTypeEnum.options) {
      expect(typeof FILAMENT_TYPE_LABELS[t]).toBe('string')
      expect(FILAMENT_TYPE_LABELS[t].length).toBeGreaterThan(0)
    }
  })

  it('FILAMENT_TYPE_GROUPS covers every enum value exactly once', () => {
    const all = Object.values(FILAMENT_TYPE_GROUPS).flat()
    expect(new Set(all).size).toBe(all.length)
    for (const t of filamentTypeEnum.options) {
      expect(all).toContain(t)
    }
  })

  it('filamentRecordSchema shape is stable', () => {
    const keys = Object.keys(filamentRecordSchema.shape).sort()
    expect(keys).toEqual([
      'brand', 'color', 'densityGPerCm3', 'diameterMm',
      'id', 'name', 'notes', 'printSettings', 'source', 'type'
    ])
  })

  it('filamentPrintSettingsSchema shape is stable', () => {
    const keys = Object.keys(filamentPrintSettingsSchema.shape).sort()
    expect(keys).toEqual([
      'bedTempC', 'bedTempFirstLayerC', 'chamberTempC',
      'fanSpeedFirstLayerPercent', 'fanSpeedPercent',
      'maxVolFlowMm3PerSec', 'nozzleTempC', 'nozzleTempFirstLayerC',
      'retractionMm', 'retractionSpeedMmPerSec'
    ])
  })
})
