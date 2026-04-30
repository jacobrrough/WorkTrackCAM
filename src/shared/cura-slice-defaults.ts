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

// ----------------------------------------------------------------------------
// FDM capability fields -> CuraEngine -s settings bridge  (roadmap [ID-0068])
// ----------------------------------------------------------------------------
// Rationale: Cycle 8 [ID-0012] added 7 optional FDM capability fields to
// `machineProfileSchema` (maxNozzleTempC, maxBedTempC, chamberTempC,
// inputShapingPresets, rfidFilamentSupport, cfsMultiColorEnabled,
// powerLossRecovery). Those fields were declared + populated + pinned by
// unit tests but never consumed by any G-code emission path. [ID-0068]
// (DISCOVERED-TODAY 2026-04-24) closes the loop for the three Cura-mappable
// fields: translate maxNozzleTempC / maxBedTempC / chamberTempC into the
// matching CuraEngine `-s` keys so the bundled K2 Plus profile (350 C / 120 C
// / 60 C heated chamber) is consumed by `buildCuraSliceArgsFromSettingsMap`
// instead of being declarative-only.
//
// The four non-temperature fields (inputShapingPresets, rfidFilamentSupport,
// cfsMultiColorEnabled, powerLossRecovery) are all Creality-firmware /
// Klipper-macro concerns with NO native CuraEngine setting key. They stay
// as machine-profile metadata for future consumers (pre-flight validator,
// Moonraker status UI, per-job preset selector).
//
// Safety Rule 1: no G-code emitted by this module. Only `-s` key/value
// strings for the CuraEngine CLI invocation.
// Safety Rule 2: additive and fully optional. An empty input produces an
// empty output map; callers that do not supply a machine profile see
// byte-identical behavior to pre-ID-0068.
// ----------------------------------------------------------------------------

/**
 * Structural subset of `MachineProfile` consumed by the FDM capability
 * bridge. Declared here (rather than importing `MachineProfile` directly)
 * so this pure module stays decoupled from Zod / `machine-schema.ts` and
 * can be called with any subset-shaped object.
 */
export type FdmCapabilityFields = {
  /** Firmware-enforced nozzle temperature ceiling in deg C. K2 Plus: 350. */
  maxNozzleTempC?: number
  /** Firmware-enforced bed temperature ceiling in deg C. K2 Plus: 120. */
  maxBedTempC?: number
  /**
   * Heated-build-chamber target in deg C. Absent means "no heated chamber"
   * -- callers must NOT emit `machine_heated_build_volume=true` with an
   * unset chamber target.
   */
  chamberTempC?: number
}

/**
 * Mapping of FDM capability fields to CuraEngine `-s` keys. Kept public so
 * tests and future consumers can assert the exact key strings emitted.
 */
export const FDM_CAPABILITY_CURA_KEYS = {
  maxNozzleTempC: 'machine_nozzle_temp_max',
  maxBedTempC: 'machine_max_bed_temp',
  chamberTempC: 'build_volume_temperature',
  heatedBuildVolumeFlag: 'machine_heated_build_volume'
} as const

/**
 * Translate a machine profile's FDM capability fields into CuraEngine `-s`
 * settings. Returns an empty map when no relevant fields are set. Numeric
 * values <= 0 or non-finite are ignored (defensive: protects against
 * accidentally emitting `machine_max_bed_temp=-5`, which some CuraEngine
 * builds silently accept and then skip bed-heat ramps).
 *
 * The three temp keys are always safe to merge over a preset/profile map
 * because they describe firmware ceilings, not slicing targets -- callers
 * still supply `material_print_temperature`, `material_bed_temperature`
 * etc. at slice time.
 *
 * When `chamberTempC` is present AND > 0, the helper ALSO sets
 * `machine_heated_build_volume=true` so CuraEngine enables the chamber
 * heater path (without this flag, `build_volume_temperature` is ignored).
 */
export function fdmCapabilitiesToEngineSettings(
  caps: FdmCapabilityFields | null | undefined
): Map<string, string> {
  const m = new Map<string, string>()
  if (caps == null) return m
  const { maxNozzleTempC, maxBedTempC, chamberTempC } = caps
  if (typeof maxNozzleTempC === 'number' && Number.isFinite(maxNozzleTempC) && maxNozzleTempC > 0) {
    m.set(FDM_CAPABILITY_CURA_KEYS.maxNozzleTempC, String(maxNozzleTempC))
  }
  if (typeof maxBedTempC === 'number' && Number.isFinite(maxBedTempC) && maxBedTempC > 0) {
    m.set(FDM_CAPABILITY_CURA_KEYS.maxBedTempC, String(maxBedTempC))
  }
  if (typeof chamberTempC === 'number' && Number.isFinite(chamberTempC) && chamberTempC > 0) {
    m.set(FDM_CAPABILITY_CURA_KEYS.heatedBuildVolumeFlag, 'true')
    m.set(FDM_CAPABILITY_CURA_KEYS.chamberTempC, String(chamberTempC))
  }
  return m
}

/**
 * Merge FDM capability settings UNDER an existing preset/profile map so
 * explicit user-supplied settings always win. This is the preferred
 * entrypoint for slicer.ts's `sliceWithCuraEngine` because it preserves
 * the existing "preset < profile < explicit override" precedence chain.
 *
 *   Precedence (lowest first):
 *     1. Machine FDM capability ceilings  (this helper's input)
 *     2. Existing preset/profile map      (caller-supplied)
 *
 * In other words: if the caller already set `machine_max_bed_temp=115`
 * for a specific job, the capability's `maxBedTempC=120` does NOT
 * overwrite it. Callers who want the opposite precedence can swap the
 * arguments.
 */
export function mergeFdmCapabilitiesUnder(
  caps: FdmCapabilityFields | null | undefined,
  over: Map<string, string>
): Map<string, string> {
  const base = fdmCapabilitiesToEngineSettings(caps)
  for (const [k, v] of over.entries()) base.set(k, v)
  return base
}
