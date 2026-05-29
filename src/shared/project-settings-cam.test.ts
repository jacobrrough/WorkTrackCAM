import { describe, expect, it } from 'vitest'
import { appSettingsSchema } from './project-schema'

const baseSettings = { theme: 'dark' as const, recentProjectPaths: [] as string[] }

describe('appSettingsSchema JSON field validation', () => {
  it('accepts valid carveraCliExtraArgsJson array string', () => {
    const parsed = appSettingsSchema.parse({
      ...baseSettings,
      carveraCliExtraArgsJson: '["-m","carvera_cli"]'
    })
    expect(parsed.carveraCliExtraArgsJson).toBe('["-m","carvera_cli"]')
  })

  it('rejects carveraCliExtraArgsJson that is not a JSON array', () => {
    expect(() =>
      appSettingsSchema.parse({ ...baseSettings, carveraCliExtraArgsJson: '{"not":"array"}' })
    ).toThrow()
  })

  it('rejects carveraCliExtraArgsJson that is malformed JSON', () => {
    expect(() =>
      appSettingsSchema.parse({ ...baseSettings, carveraCliExtraArgsJson: 'not json at all' })
    ).toThrow()
  })

  it('accepts settings with the carveraCliExtraArgsJson field absent (optional)', () => {
    const parsed = appSettingsSchema.parse(baseSettings)
    expect(parsed.carveraCliExtraArgsJson).toBeUndefined()
  })

  it('accepts empty JSON array for carveraCliExtraArgsJson', () => {
    const parsed = appSettingsSchema.parse({ ...baseSettings, carveraCliExtraArgsJson: '[]' })
    expect(parsed.carveraCliExtraArgsJson).toBe('[]')
  })

  it('strips legacy CuraEngine slicer settings keys from old saved settings', () => {
    // The CuraEngine slicing path was removed in the 2026-05-27 OrcaSlicer pivot.
    // appSettingsSchema is a plain (non-strict) z.object, so old settings.json /
    // .wtcam files carrying these dead keys still parse — Zod strips them rather
    // than erroring. This pins the saved-project back-compat contract.
    const parsed = appSettingsSchema.parse({
      ...baseSettings,
      curaEngineExtraSettingsJson: '{"infill_pattern":"grid"}',
      curaSliceProfilesJson: '[{"id":"pla"}]',
      curaActiveSliceProfileId: 'pla',
      prusaSlicerPath: '/usr/bin/prusa-slicer'
    } as Record<string, unknown>) as Record<string, unknown>
    expect(parsed.curaEngineExtraSettingsJson).toBeUndefined()
    expect(parsed.curaSliceProfilesJson).toBeUndefined()
    expect(parsed.curaActiveSliceProfileId).toBeUndefined()
    expect(parsed.prusaSlicerPath).toBeUndefined()
  })
})

describe('appSettingsSchema WorkTrackCAM fields', () => {
  it('parses partial settings with manufacturing default and safety fields', () => {
    const parsed = appSettingsSchema.parse({
      theme: 'dark',
      recentProjectPaths: [],
      camGcodeSafetyAcknowledged: true,
      camDefaultPostTemplate: 'grbl-mm.gcode.hbs',
      camDefaultMachineDialect: 'generic_mm'
    })
    expect(parsed.camGcodeSafetyAcknowledged).toBe(true)
    expect(parsed.camDefaultPostTemplate).toBe('grbl-mm.gcode.hbs')
    expect(parsed.camDefaultMachineDialect).toBe('generic_mm')
  })

  it('allows CAM fields to be absent', () => {
    const parsed = appSettingsSchema.parse({ theme: 'dark', recentProjectPaths: [] })
    expect(parsed.camGcodeSafetyAcknowledged).toBeUndefined()
    expect(parsed.camDefaultPostTemplate).toBeUndefined()
    expect(parsed.camDefaultMachineDialect).toBeUndefined()
  })

  it('rejects invalid camDefaultMachineDialect', () => {
    expect(() =>
      appSettingsSchema.parse({
        theme: 'dark',
        recentProjectPaths: [],
        camDefaultMachineDialect: 'invalid'
      })
    ).toThrow()
  })

  it('merges like settings-store defaults + patch', () => {
    const defaults = { theme: 'dark' as const, recentProjectPaths: [] as string[] }
    const patch = { camGcodeSafetyAcknowledged: false }
    const parsed = appSettingsSchema.parse({ ...defaults, ...patch })
    expect(parsed.camGcodeSafetyAcknowledged).toBe(false)
    expect(parsed.theme).toBe('dark')
  })
})
