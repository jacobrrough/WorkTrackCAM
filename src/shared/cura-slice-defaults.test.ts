import { describe, expect, it } from 'vitest'
import {
  CURA_SLICE_CLI_DEFAULTS,
  CURA_SLICE_PRESETS,
  buildCuraEngineSettingsMap,
  mergeCuraSliceInvocationSettings,
  parseCuraEngineExtraSettingsJson,
  parseCuraSliceProfilesJson,
  resolveCuraSliceParams
} from './cura-slice-defaults'

describe('resolveCuraSliceParams', () => {
  it('returns balanced defaults for unknown preset ids', () => {
    expect(resolveCuraSliceParams('unknown')).toEqual(CURA_SLICE_CLI_DEFAULTS)
    expect(resolveCuraSliceParams(null)).toEqual(CURA_SLICE_CLI_DEFAULTS)
  })

  it('returns typed preset values for draft and fine', () => {
    expect(resolveCuraSliceParams('draft')).toEqual(CURA_SLICE_PRESETS.draft)
    expect(resolveCuraSliceParams('fine')).toEqual(CURA_SLICE_PRESETS.fine)
  })
})

describe('parseCuraEngineExtraSettingsJson', () => {
  it('parses strings and numbers', () => {
    expect(parseCuraEngineExtraSettingsJson('{"a":"x","b":2}')).toEqual({ a: 'x', b: '2' })
  })

  it('returns {} on invalid', () => {
    expect(parseCuraEngineExtraSettingsJson('not json')).toEqual({})
  })
})

describe('mergeCuraSliceInvocationSettings', () => {
  it('merges global JSON over preset keys', () => {
    const m = mergeCuraSliceInvocationSettings({
      curaSlicePreset: 'balanced',
      curaEngineExtraSettingsJson: '{"layer_height":"0.16","infill_pattern":"lines"}'
    })
    expect(m.get('layer_height')).toBe('0.16')
    expect(m.get('infill_pattern')).toBe('lines')
  })

  it('applies named profile base preset and settings', () => {
    const profiles = JSON.stringify([
      { id: 'p1', label: 'P', basePreset: 'draft', settingsJson: '{"wall_line_count":"3"}' }
    ])
    const m = mergeCuraSliceInvocationSettings({
      curaSlicePreset: 'balanced',
      curaSliceProfilesJson: profiles,
      curaActiveSliceProfileId: 'p1'
    })
    expect(m.get('layer_height')).toBe(String(CURA_SLICE_PRESETS.draft.layerHeightMm))
    expect(m.get('wall_line_count')).toBe('3')
  })
})

describe('buildCuraEngineSettingsMap', () => {
  it('profile basePreset overrides top-level preset id', () => {
    const m = buildCuraEngineSettingsMap({
      presetId: 'balanced',
      profile: { id: 'x', label: 'X', basePreset: 'fine' }
    })
    expect(m.get('layer_height')).toBe(String(CURA_SLICE_PRESETS.fine.layerHeightMm))
  })
})

describe('parseCuraSliceProfilesJson', () => {
  it('parses settingsJson on profiles', () => {
    const a = parseCuraSliceProfilesJson(
      '[{"id":"a","label":"A","basePreset":"balanced","settingsJson":"{\\"x\\":\\"y\\"}"}]'
    )
    expect(a[0]?.settings).toEqual({ x: 'y' })
  })
})

// ----------------------------------------------------------------------------
// FDM capability bridge -- roadmap [ID-0068] (follow-up to [ID-0012])
// ----------------------------------------------------------------------------
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FDM_CAPABILITY_CURA_KEYS,
  fdmCapabilitiesToEngineSettings,
  mergeFdmCapabilitiesUnder,
  type FdmCapabilityFields
} from './cura-slice-defaults'

describe('fdmCapabilitiesToEngineSettings [ID-0068]', () => {
  it('returns an empty map when the input is null or undefined', () => {
    expect(fdmCapabilitiesToEngineSettings(null).size).toBe(0)
    expect(fdmCapabilitiesToEngineSettings(undefined).size).toBe(0)
  })

  it('returns an empty map when no capability fields are set', () => {
    expect(fdmCapabilitiesToEngineSettings({}).size).toBe(0)
  })

  it('emits machine_nozzle_temp_max when maxNozzleTempC is set', () => {
    const m = fdmCapabilitiesToEngineSettings({ maxNozzleTempC: 350 })
    expect(m.get('machine_nozzle_temp_max')).toBe('350')
    expect(m.size).toBe(1)
  })

  it('emits machine_max_bed_temp when maxBedTempC is set', () => {
    const m = fdmCapabilitiesToEngineSettings({ maxBedTempC: 120 })
    expect(m.get('machine_max_bed_temp')).toBe('120')
    expect(m.size).toBe(1)
  })

  it('emits chamber flag AND temperature together when chamberTempC > 0', () => {
    const m = fdmCapabilitiesToEngineSettings({ chamberTempC: 60 })
    expect(m.get('machine_heated_build_volume')).toBe('true')
    expect(m.get('build_volume_temperature')).toBe('60')
    expect(m.size).toBe(2)
  })

  it('rejects non-positive and non-finite numeric values (defensive guard)', () => {
    // Zero and negative values are dropped so a profile mis-populate does not
    // silently emit `machine_max_bed_temp=-5` to CuraEngine.
    const bad: FdmCapabilityFields = {
      maxNozzleTempC: 0,
      maxBedTempC: -5,
      chamberTempC: Number.NaN
    }
    expect(fdmCapabilitiesToEngineSettings(bad).size).toBe(0)
  })

  it('rejects non-numeric values coming in through a JSON import', () => {
    // @ts-expect-error -- deliberately passing wrong runtime shape.
    const m = fdmCapabilitiesToEngineSettings({ maxNozzleTempC: '350', maxBedTempC: true })
    expect(m.size).toBe(0)
  })

  it('emits ALL three keys (plus chamber flag) for the bundled K2 Plus machine profile', () => {
    // Cross-check against the REAL resources/machines/creality-k2-plus.json so
    // that a future drift in the bundled profile drops this test on its face.
    type K2Meta = {
      maxNozzleTempC?: number
      maxBedTempC?: number
      chamberTempC?: number
    }
    const k2 = JSON.parse(
      readFileSync(join(process.cwd(), 'resources', 'machines', 'creality-k2-plus.json'), 'utf-8')
    ) as K2Meta
    const m = fdmCapabilitiesToEngineSettings(k2)
    expect(m.get('machine_nozzle_temp_max')).toBe('350')
    expect(m.get('machine_max_bed_temp')).toBe('120')
    expect(m.get('build_volume_temperature')).toBe('60')
    expect(m.get('machine_heated_build_volume')).toBe('true')
  })

  it('FDM_CAPABILITY_CURA_KEYS values match the CuraEngine setting-id strings', () => {
    // Pin the exact CuraEngine setting names so a rename here is a deliberate
    // choice made alongside the CuraEngine version bump that requires it.
    expect(FDM_CAPABILITY_CURA_KEYS.maxNozzleTempC).toBe('machine_nozzle_temp_max')
    expect(FDM_CAPABILITY_CURA_KEYS.maxBedTempC).toBe('machine_max_bed_temp')
    expect(FDM_CAPABILITY_CURA_KEYS.chamberTempC).toBe('build_volume_temperature')
    expect(FDM_CAPABILITY_CURA_KEYS.heatedBuildVolumeFlag).toBe('machine_heated_build_volume')
  })
})

describe('mergeFdmCapabilitiesUnder [ID-0068]', () => {
  it('preserves an explicit override over the capability ceiling', () => {
    // Job-specific experiment: push the hot-end past the firmware ceiling.
    // Capability says 350, job override says 380 -- override wins.
    const over = new Map<string, string>([['machine_nozzle_temp_max', '380']])
    const m = mergeFdmCapabilitiesUnder({ maxNozzleTempC: 350 }, over)
    expect(m.get('machine_nozzle_temp_max')).toBe('380')
  })

  it('adds capability keys that the override map does not already carry', () => {
    const over = new Map<string, string>([['layer_height', '0.2']])
    const m = mergeFdmCapabilitiesUnder(
      { maxNozzleTempC: 350, maxBedTempC: 120, chamberTempC: 60 },
      over
    )
    expect(m.get('layer_height')).toBe('0.2')
    expect(m.get('machine_nozzle_temp_max')).toBe('350')
    expect(m.get('machine_max_bed_temp')).toBe('120')
    expect(m.get('build_volume_temperature')).toBe('60')
    expect(m.get('machine_heated_build_volume')).toBe('true')
  })

  it('returns a copy of `over` when `caps` is null (additive, no mutation)', () => {
    const over = new Map<string, string>([['layer_height', '0.2']])
    const m = mergeFdmCapabilitiesUnder(null, over)
    expect(m.get('layer_height')).toBe('0.2')
    expect(m.size).toBe(1)
    // Does not mutate the caller's input.
    over.set('layer_height', '0.3')
    expect(m.get('layer_height')).toBe('0.2')
  })
})
