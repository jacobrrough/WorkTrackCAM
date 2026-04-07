import type { AppSettings } from './project-schema'

/**
 * CuraEngine `-s` values used by `buildCuraSliceArgs` in `src/main/slicer.ts`.
 * Keep docs (Utilities → Slice, VERIFICATION) aligned with this object.
 */
export const CURA_SLICE_CLI_DEFAULTS = {
  layerHeightMm: 0.2,
  lineWidthMm: 0.4,
  wallLineCount: 2,
  infillSparseDensity: 15
}

export type CuraSliceCliParams = {
  layerHeightMm: number
  lineWidthMm: number
  wallLineCount: number
  infillSparseDensity: number
}

/** Named presets (Utilities → Slice). `balanced` matches {@link CURA_SLICE_CLI_DEFAULTS}. */
export const CURA_SLICE_PRESET_IDS = ['balanced', 'draft', 'fine'] as const
export type CuraSlicePresetId = (typeof CURA_SLICE_PRESET_IDS)[number]

export const CURA_SLICE_PRESETS: Record<CuraSlicePresetId, CuraSliceCliParams> = {
  balanced: { ...CURA_SLICE_CLI_DEFAULTS },
  draft: { layerHeightMm: 0.3, lineWidthMm: 0.4, wallLineCount: 1, infillSparseDensity: 10 },
  fine: { layerHeightMm: 0.12, lineWidthMm: 0.4, wallLineCount: 3, infillSparseDensity: 20 }
}

export function resolveCuraSliceParams(presetId?: string | null): CuraSliceCliParams {
  if (presetId && presetId in CURA_SLICE_PRESETS) {
    return { ...CURA_SLICE_PRESETS[presetId as CuraSlicePresetId] }
  }
  return { ...CURA_SLICE_CLI_DEFAULTS }
}

/** Maps bundled numeric preset → CuraEngine setting keys (underscore ids). */
export function curaCliParamsToEngineSettingsMap(p: CuraSliceCliParams): Map<string, string> {
  return new Map([
    ['layer_height', String(p.layerHeightMm)],
    ['line_width', String(p.lineWidthMm)],
    ['wall_line_count', String(Math.round(p.wallLineCount))],
    ['infill_sparse_density', String(p.infillSparseDensity)]
  ])
}

/** Parse JSON object of Cura `-s` keys → string values (invalid JSON → {}). */
export function parseCuraEngineExtraSettingsJson(raw: string | undefined | null): Record<string, string> {
  if (raw == null || typeof raw !== 'string' || raw.trim() === '') return {}
  try {
    const o = JSON.parse(raw) as unknown
    if (o == null || typeof o !== 'object' || Array.isArray(o)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = String(k).trim()
      if (!key) continue
      if (typeof v === 'string') out[key] = v
      else if (typeof v === 'number' && Number.isFinite(v)) out[key] = String(v)
      else if (typeof v === 'boolean') out[key] = v ? 'true' : 'false'
    }
    return out
  } catch {
    return {}
  }
}

export type CuraSliceNamedProfile = {
  id: string
  label: string
  basePreset?: CuraSlicePresetId
  settings?: Record<string, string>
}

/**
 * Parse named material profiles from settings JSON, e.g.
 * `[{"id":"pla","label":"PLA","basePreset":"balanced","settingsJson":"{}"}]`
 */
export function parseCuraSliceProfilesJson(raw: string | undefined | null): CuraSliceNamedProfile[] {
  if (raw == null || typeof raw !== 'string' || raw.trim() === '') return []
  try {
    const a = JSON.parse(raw) as unknown
    if (!Array.isArray(a)) return []
    const out: CuraSliceNamedProfile[] = []
    for (const item of a) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id.trim() : ''
      const label = typeof o.label === 'string' ? o.label.trim() : ''
      if (!id || !label) continue
      const basePreset =
        o.basePreset === 'balanced' || o.basePreset === 'draft' || o.basePreset === 'fine'
          ? o.basePreset
          : undefined
      let settings: Record<string, string> | undefined
      if (typeof o.settingsJson === 'string') {
        settings = parseCuraEngineExtraSettingsJson(o.settingsJson)
      } else if (o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings)) {
        const inner: Record<string, string> = {}
        for (const [k, v] of Object.entries(o.settings as Record<string, unknown>)) {
          if (typeof v === 'string') inner[k] = v
          else if (typeof v === 'number' && Number.isFinite(v)) inner[k] = String(v)
          else if (typeof v === 'boolean') inner[k] = v ? 'true' : 'false'
        }
        settings = Object.keys(inner).length ? inner : undefined
      }
      out.push({ id, label, basePreset, settings })
    }
    return out
  } catch {
    return []
  }
}

export function buildCuraEngineSettingsMap(input: {
  presetId?: string | null
  globalExtraJson?: string | null
  profile?: CuraSliceNamedProfile | null
}): Map<string, string> {
  const effPreset = input.profile?.basePreset ?? input.presetId
  const params = resolveCuraSliceParams(effPreset)
  const map = curaCliParamsToEngineSettingsMap(params)
  for (const [k, v] of Object.entries(parseCuraEngineExtraSettingsJson(input.globalExtraJson))) {
    map.set(k, v)
  }
  if (input.profile?.settings) {
    for (const [k, v] of Object.entries(input.profile.settings)) {
      map.set(k, v)
    }
  }
  return map
}

/** Merged Cura `-s` map for the Slice tab / `slice:cura` (preset + global JSON + active profile). */
export function mergeCuraSliceInvocationSettings(
  settings: Partial<AppSettings> | null | undefined
): Map<string, string> {
  const s = settings ?? {}
  const profiles = parseCuraSliceProfilesJson(s.curaSliceProfilesJson)
  const activeId = typeof s.curaActiveSliceProfileId === 'string' ? s.curaActiveSliceProfileId.trim() : ''
  const profile = activeId ? profiles.find((p) => p.id === activeId) : undefined
  return buildCuraEngineSettingsMap({
    presetId: s.curaSlicePreset,
    globalExtraJson: s.curaEngineExtraSettingsJson,
    profile
  })
}
