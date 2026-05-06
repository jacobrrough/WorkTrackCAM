import { z } from 'zod'

export const filamentTypeEnum = z.enum([
  'PLA',
  'ABS',
  'PETG',
  'TPU',
  'ASA',
  'PA',
  'PC',
  'PVA',
  'HIPS',
  'PLA_CF',
  'PETG_CF',
  'PA_CF',
  'other'
])
export type FilamentType = z.infer<typeof filamentTypeEnum>

export const FILAMENT_TYPE_LABELS: Record<FilamentType, string> = {
  PLA: 'PLA',
  ABS: 'ABS',
  PETG: 'PETG',
  TPU: 'TPU (Flexible)',
  ASA: 'ASA',
  PA: 'Nylon (PA)',
  PC: 'Polycarbonate (PC)',
  PVA: 'PVA (Support)',
  HIPS: 'HIPS (Support)',
  PLA_CF: 'PLA Carbon Fiber',
  PETG_CF: 'PETG Carbon Fiber',
  PA_CF: 'Nylon Carbon Fiber',
  other: 'Other'
}

export const FILAMENT_TYPE_GROUPS: Record<string, FilamentType[]> = {
  'Standard': ['PLA', 'ABS', 'PETG', 'TPU'],
  'Engineering': ['ASA', 'PA', 'PC', 'PLA_CF', 'PETG_CF', 'PA_CF'],
  'Support': ['PVA', 'HIPS'],
  'Other': ['other']
}

export const filamentPrintSettingsSchema = z.object({
  nozzleTempC: z.number().int().positive(),
  nozzleTempFirstLayerC: z.number().int().positive().optional(),
  bedTempC: z.number().int().nonnegative(),
  bedTempFirstLayerC: z.number().int().nonnegative().optional(),
  chamberTempC: z.number().int().nonnegative().optional(),
  fanSpeedPercent: z.number().min(0).max(100),
  fanSpeedFirstLayerPercent: z.number().min(0).max(100).optional(),
  maxVolFlowMm3PerSec: z.number().positive().optional(),
  retractionMm: z.number().nonnegative().optional(),
  retractionSpeedMmPerSec: z.number().positive().optional()
})
export type FilamentPrintSettings = z.infer<typeof filamentPrintSettingsSchema>

export const filamentRecordSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: filamentTypeEnum,
  brand: z.string().optional(),
  color: z.string().optional(),
  diameterMm: z.number().positive().default(1.75),
  densityGPerCm3: z.number().positive().optional(),
  printSettings: filamentPrintSettingsSchema,
  notes: z.string().optional(),
  source: z.enum(['bundled', 'user']).optional()
})
export type FilamentRecord = z.infer<typeof filamentRecordSchema>

export const filamentLibrarySchema = z.object({
  version: z.literal(1),
  filaments: z.array(filamentRecordSchema)
})
export type FilamentLibrary = z.infer<typeof filamentLibrarySchema>

/**
 * Map filament print settings to CuraEngine `-s` key/value pairs.
 * These layer OVER quality-preset defaults and UNDER explicit user overrides.
 */
export function filamentToCuraSettings(filament: FilamentRecord): Map<string, string> {
  const m = new Map<string, string>()
  const s = filament.printSettings

  m.set('material_print_temperature', String(s.nozzleTempC))
  if (s.nozzleTempFirstLayerC != null) {
    m.set('material_print_temperature_layer_0', String(s.nozzleTempFirstLayerC))
  }
  m.set('material_bed_temperature', String(s.bedTempC))
  if (s.bedTempFirstLayerC != null) {
    m.set('material_bed_temperature_layer_0', String(s.bedTempFirstLayerC))
  }
  if (s.chamberTempC != null) {
    m.set('build_volume_temperature', String(s.chamberTempC))
  }
  m.set('cool_fan_speed', String(s.fanSpeedPercent))
  if (s.fanSpeedFirstLayerPercent != null) {
    m.set('cool_fan_speed_0', String(s.fanSpeedFirstLayerPercent))
  }
  if (s.retractionMm != null) {
    m.set('retraction_amount', String(s.retractionMm))
  }
  if (s.retractionSpeedMmPerSec != null) {
    m.set('retraction_speed', String(s.retractionSpeedMmPerSec))
  }
  if (s.maxVolFlowMm3PerSec != null) {
    m.set('machine_max_feedrate_e', String(s.maxVolFlowMm3PerSec))
  }

  return m
}
