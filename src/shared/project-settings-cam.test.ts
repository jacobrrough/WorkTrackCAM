import { describe, expect, it } from 'vitest'
import { appSettingsSchema } from './project-schema'

const baseSettings = { theme: 'dark' as const, recentProjectPaths: [] as string[] }

describe('appSettingsSchema JSON field validation', () => {
  it('accepts valid curaEngineExtraSettingsJson object string', () => {
    const parsed = appSettingsSchema.parse({
      ...baseSettings,
      curaEngineExtraSettingsJson: '{"infill_pattern":"grid","material_print_temperature":"210"}'
    })
    expect(parsed.curaEngineExtraSettingsJson).toBe('{"infill_pattern":"grid","material_print_temperature":"210"}')
  })

  it('rejects curaEngineExtraSettingsJson that is not a JSON object', () => {
    expect(() =>
      appSettingsSchema.parse({ ...baseSettings, curaEngineExtraSettingsJson: '[1,2,3]' })
    ).toThrow()
    expect(() =>
      appSettingsSchema.parse({ ...baseSettings, curaEngineExtraSettingsJson: '"just a string"' })
    ).toThrow()
  })

  it('rejects curaEngineExtraSettingsJson that is malformed JSON', () => {
    expect(() =>
      appSettingsSchema.parse({ ...baseSettings, curaEngineExtraSettingsJson: '{invalid json}' })
    ).toThrow()
  })

  it('accepts valid curaSliceProfilesJson array string', () => {
    const profilesJson = '[{"id":"pla","label":"PLA","basePreset":"balanced","settingsJson":"{}"}]'
    const parsed = appSettingsSchema.parse({ ...baseSettings, curaSliceProfilesJson: profilesJson })
    expect(parsed.curaSliceProfilesJson).toBe(profilesJson)
  })

  it('rejects curaSliceProfilesJson that is not a JSON array', () => {
    expect(() =>
      appSettingsSchema.parse({ ...baseSettings, curaSliceProfilesJson: '{"not":"an array"}' })
    ).toThrow()
  })

  it('rejects curaSliceProfilesJson that is malformed JSON', () => {
    expect(() =>
      appSettingsSchema.parse({ ...baseSettings, curaSliceProfilesJson: '[{broken' })
    ).toThrow()
  })

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

  it('accepts settings with all three JSON fields absent (all optional)', () => {
    const parsed = appSettingsSchema.parse(baseSettings)
    expect(parsed.curaEngineExtraSettingsJson).toBeUndefined()
    expect(parsed.curaSliceProfilesJson).toBeUndefined()
    expect(parsed.carveraCliExtraArgsJson).toBeUndefined()
  })

  it('accepts empty JSON object for curaEngineExtraSettingsJson', () => {
    const parsed = appSettingsSchema.parse({ ...baseSettings, curaEngineExtraSettingsJson: '{}' })
    expect(parsed.curaEngineExtraSettingsJson).toBe('{}')
  })

  it('accepts empty JSON array for curaSliceProfilesJson', () => {
    const parsed = appSettingsSchema.parse({ ...baseSettings, curaSliceProfilesJson: '[]' })
    expect(parsed.curaSliceProfilesJson).toBe('[]')
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
