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
