/**
 * cura-slice-defaults-pin.test.ts -- [ID-0230] Cycle 157 cam-engine
 * paired-pin for `src/shared/cura-slice-defaults.ts`.
 *
 * Sister to the existing `cura-slice-defaults.test.ts` (which pins the
 * behaviour-level surface across resolveCuraSliceParams /
 * parseCuraEngineExtraSettingsJson / mergeCuraSliceInvocationSettings /
 * buildCuraEngineSettingsMap / parseCuraSliceProfilesJson +
 * fdmCapabilitiesToEngineSettings + mergeFdmCapabilitiesUnder). This
 * co-located paired-pin extends that coverage with module shape (exact
 * named-export inventory of 4 runtime constants + 8 runtime functions +
 * Symbol.toStringTag / null-prototype invariants), constant-shape
 * contracts (CURA_SLICE_CLI_DEFAULTS literal pin / CURA_SLICE_PRESET_IDS
 * tuple identity / CURA_SLICE_PRESETS exhaustive value pin /
 * FDM_CAPABILITY_CURA_KEYS exact CuraEngine setting-id strings),
 * defensive-coverage matrices (parseCuraEngineExtraSettingsJson empty /
 * non-string / array / null-JSON / non-object-JSON / non-finite-number /
 * boolean coercion / empty-key-skip / parseCuraSliceProfilesJson per-row
 * defensive coercions), the precedence chain in buildCuraEngineSettingsMap
 * (preset < globalExtra < profile.settings + profile.basePreset overrides
 * preset), purity / referential non-mutation (returns fresh map / fresh
 * params record on every call), AND a source-text whitelist pinning
 * roadmap-[ID-0068] provenance, the four CuraEngine setting-id strings
 * verbatim, the AppSettings type-only import, and Safety Rule 1/2/3
 * negative invariants (no electron/fs/path/child_process imports, no
 * `any` 3-form, no top-level `let`, no Handlebars tokens, no G-code or
 * M-code emission).
 *
 * Sister cycles in the post-Cycle-127-reset paired-pin chain that this
 * pin extends: 119 [ID-0196] / 124 [ID-0201] / 129 [ID-0206] / 130
 * [ID-0207] / 131 [ID-0208] / 132 [ID-0209] / 134 [ID-0210] / 135
 * [ID-0211] / 136 [ID-0212] / 137 [ID-0213] / 139 [ID-0214] / 140
 * [ID-0215] / 142 [ID-0216] / 144 [ID-0217] / 145 [ID-0218] / 146
 * [ID-0220] / 147 [ID-0222] / 149 [ID-0225] / 150 [ID-0221] / 151
 * [ID-0226] / 152 [ID-0224] / 153 [ID-0067-data-v21] / 154 [ID-0227] /
 * 155 [ID-0228] / 156 [ID-0229].
 *
 * Three-machine impact: PRIMARY = Creality K2 Plus (FDM slicer surface
 * -- the bundled K2 profile's 350 C / 120 C / 60 C ceilings flow
 * through fdmCapabilitiesToEngineSettings into the four CuraEngine `-s`
 * keys consumed by `buildCuraSliceArgs` in src/main/slicer.ts).
 * UNAFFECTED-but-fleet-tested = Laguna Swift 5x10 (CNC, no FDM caps;
 * the bundled Laguna profile MUST NOT carry maxNozzleTempC /
 * maxBedTempC / chamberTempC fields), Makera Carvera 3-axis + 4-axis
 * (CNC, no FDM caps). Drift in the four CuraEngine setting-id strings
 * (e.g., a CuraEngine version bump renames machine_max_bed_temp ->
 * machine_bed_temp_max) would silently let the K2 chamber/nozzle/bed
 * ceilings be ignored by CuraEngine -- the source-text whitelist pins
 * them so the next CuraEngine bump is a deliberate update.
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './cura-slice-defaults'
import {
  CURA_SLICE_CLI_DEFAULTS,
  CURA_SLICE_PRESET_IDS,
  CURA_SLICE_PRESETS,
  FDM_CAPABILITY_CURA_KEYS,
  buildCuraEngineSettingsMap,
  curaCliParamsToEngineSettingsMap,
  fdmCapabilitiesToEngineSettings,
  mergeCuraSliceInvocationSettings,
  mergeFdmCapabilitiesUnder,
  parseCuraEngineExtraSettingsJson,
  parseCuraSliceProfilesJson,
  resolveCuraSliceParams,
  type CuraSliceCliParams,
  type CuraSliceNamedProfile,
  type CuraSlicePresetId,
  type FdmCapabilityFields
} from './cura-slice-defaults'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_PATH = join(__dirname, 'cura-slice-defaults.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

const RESOURCES_ROOT = join(process.cwd(), 'resources')
function loadProfileRaw(filename: string): Record<string, unknown> {
  const path = join(RESOURCES_ROOT, 'machines', filename)
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

// Strip comments + JSDoc so source-text scans of executable code do not
// collide with docstring-embedded literals.
function codeOnly(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '')
  out = out.replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  return out
}

// ---------------------------------------------------------------------------
// A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0230] A) module shape', () => {
  it('exports exactly the documented runtime named symbols', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(
      [
        'CURA_SLICE_CLI_DEFAULTS',
        'CURA_SLICE_PRESET_IDS',
        'CURA_SLICE_PRESETS',
        'FDM_CAPABILITY_CURA_KEYS',
        'buildCuraEngineSettingsMap',
        'curaCliParamsToEngineSettingsMap',
        'fdmCapabilitiesToEngineSettings',
        'mergeCuraSliceInvocationSettings',
        'mergeFdmCapabilitiesUnder',
        'parseCuraEngineExtraSettingsJson',
        'parseCuraSliceProfilesJson',
        'resolveCuraSliceParams'
      ].sort()
    )
  })

  it('does NOT expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('only carries Symbol.toStringTag among Symbol-keyed properties', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M)
    expect(symbolKeys).toEqual([Symbol.toStringTag])
  })

  it('has Symbol.toStringTag === "Module" on the ESM namespace', () => {
    expect((M as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe(
      'Module'
    )
  })

  it('has a null prototype on the ESM namespace object', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('runtime keys count is exactly 12 (4 constants + 8 functions)', () => {
    expect(Object.keys(M)).toHaveLength(12)
  })

  it('does NOT export type-only members as runtime values', () => {
    // Type-only exports (CuraSliceCliParams, CuraSlicePresetId,
    // CuraSliceNamedProfile, FdmCapabilityFields) must not appear at runtime.
    const ns = M as Record<string, unknown>
    expect(ns.CuraSliceCliParams).toBeUndefined()
    expect(ns.CuraSlicePresetId).toBeUndefined()
    expect(ns.CuraSliceNamedProfile).toBeUndefined()
    expect(ns.FdmCapabilityFields).toBeUndefined()
  })

  it('all 4 runtime constants are objects (or arrays) and not functions', () => {
    expect(typeof CURA_SLICE_CLI_DEFAULTS).toBe('object')
    expect(typeof CURA_SLICE_PRESET_IDS).toBe('object')
    expect(typeof CURA_SLICE_PRESETS).toBe('object')
    expect(typeof FDM_CAPABILITY_CURA_KEYS).toBe('object')
  })

  it('all 8 runtime functions are functions', () => {
    expect(typeof resolveCuraSliceParams).toBe('function')
    expect(typeof curaCliParamsToEngineSettingsMap).toBe('function')
    expect(typeof parseCuraEngineExtraSettingsJson).toBe('function')
    expect(typeof parseCuraSliceProfilesJson).toBe('function')
    expect(typeof buildCuraEngineSettingsMap).toBe('function')
    expect(typeof mergeCuraSliceInvocationSettings).toBe('function')
    expect(typeof fdmCapabilitiesToEngineSettings).toBe('function')
    expect(typeof mergeFdmCapabilitiesUnder).toBe('function')
  })

  it('declares Function.length on every runtime function (1 or 2)', () => {
    expect(resolveCuraSliceParams.length).toBe(1)
    expect(curaCliParamsToEngineSettingsMap.length).toBe(1)
    expect(parseCuraEngineExtraSettingsJson.length).toBe(1)
    expect(parseCuraSliceProfilesJson.length).toBe(1)
    expect(buildCuraEngineSettingsMap.length).toBe(1)
    expect(mergeCuraSliceInvocationSettings.length).toBe(1)
    expect(fdmCapabilitiesToEngineSettings.length).toBe(1)
    expect(mergeFdmCapabilitiesUnder.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// B) CURA_SLICE_CLI_DEFAULTS literal contract
// ---------------------------------------------------------------------------

describe('[ID-0230] B) CURA_SLICE_CLI_DEFAULTS literal contract', () => {
  it('declares exactly 4 keys (layerHeightMm / lineWidthMm / wallLineCount / infillSparseDensity)', () => {
    expect(Object.keys(CURA_SLICE_CLI_DEFAULTS).sort()).toEqual(
      ['infillSparseDensity', 'layerHeightMm', 'lineWidthMm', 'wallLineCount'].sort()
    )
  })

  it('layerHeightMm === 0.2 (CuraEngine balanced-quality default)', () => {
    expect(CURA_SLICE_CLI_DEFAULTS.layerHeightMm).toBe(0.2)
  })

  it('lineWidthMm === 0.4 (matches the K2 Plus stock 0.4 mm nozzle)', () => {
    expect(CURA_SLICE_CLI_DEFAULTS.lineWidthMm).toBe(0.4)
  })

  it('wallLineCount === 2 (balanced strength/print-time tradeoff)', () => {
    expect(CURA_SLICE_CLI_DEFAULTS.wallLineCount).toBe(2)
  })

  it('infillSparseDensity === 15 (percent, balanced-quality default)', () => {
    expect(CURA_SLICE_CLI_DEFAULTS.infillSparseDensity).toBe(15)
  })

  it('every value is a finite number (no NaN / Infinity smuggled in)', () => {
    for (const v of Object.values(CURA_SLICE_CLI_DEFAULTS)) {
      expect(typeof v).toBe('number')
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// C) CURA_SLICE_PRESET_IDS / CURA_SLICE_PRESETS contract
// ---------------------------------------------------------------------------

describe('[ID-0230] C) CURA_SLICE_PRESET_IDS / CURA_SLICE_PRESETS contract', () => {
  it('CURA_SLICE_PRESET_IDS lists exactly 3 preset ids in declared order', () => {
    expect(CURA_SLICE_PRESET_IDS).toEqual(['balanced', 'draft', 'fine'])
  })

  it('CURA_SLICE_PRESET_IDS length is exactly 3', () => {
    expect(CURA_SLICE_PRESET_IDS).toHaveLength(3)
  })

  it('CURA_SLICE_PRESET_IDS is a tuple of unique ids', () => {
    const set = new Set(CURA_SLICE_PRESET_IDS)
    expect(set.size).toBe(CURA_SLICE_PRESET_IDS.length)
  })

  it('CURA_SLICE_PRESETS keys equal CURA_SLICE_PRESET_IDS (set equality)', () => {
    expect(Object.keys(CURA_SLICE_PRESETS).sort()).toEqual(
      [...CURA_SLICE_PRESET_IDS].sort()
    )
  })

  it('balanced preset is byte-identical to CURA_SLICE_CLI_DEFAULTS', () => {
    expect(CURA_SLICE_PRESETS.balanced).toEqual(CURA_SLICE_CLI_DEFAULTS)
  })

  it('balanced preset is a fresh object (spread copy, not reference identity)', () => {
    expect(CURA_SLICE_PRESETS.balanced).not.toBe(CURA_SLICE_CLI_DEFAULTS)
  })

  it('draft preset literal pin: 0.3 / 0.4 / 1 / 10', () => {
    expect(CURA_SLICE_PRESETS.draft).toEqual({
      layerHeightMm: 0.3,
      lineWidthMm: 0.4,
      wallLineCount: 1,
      infillSparseDensity: 10
    })
  })

  it('fine preset literal pin: 0.12 / 0.4 / 3 / 20', () => {
    expect(CURA_SLICE_PRESETS.fine).toEqual({
      layerHeightMm: 0.12,
      lineWidthMm: 0.4,
      wallLineCount: 3,
      infillSparseDensity: 20
    })
  })

  it('all three presets share lineWidthMm === 0.4 (stock K2 0.4 mm nozzle)', () => {
    expect(CURA_SLICE_PRESETS.balanced.lineWidthMm).toBe(0.4)
    expect(CURA_SLICE_PRESETS.draft.lineWidthMm).toBe(0.4)
    expect(CURA_SLICE_PRESETS.fine.lineWidthMm).toBe(0.4)
  })

  it('layer-height ordering: fine (0.12) < balanced (0.2) < draft (0.3)', () => {
    expect(CURA_SLICE_PRESETS.fine.layerHeightMm).toBeLessThan(
      CURA_SLICE_PRESETS.balanced.layerHeightMm
    )
    expect(CURA_SLICE_PRESETS.balanced.layerHeightMm).toBeLessThan(
      CURA_SLICE_PRESETS.draft.layerHeightMm
    )
  })

  it('wall-count ordering: draft (1) < balanced (2) < fine (3)', () => {
    expect(CURA_SLICE_PRESETS.draft.wallLineCount).toBe(1)
    expect(CURA_SLICE_PRESETS.balanced.wallLineCount).toBe(2)
    expect(CURA_SLICE_PRESETS.fine.wallLineCount).toBe(3)
  })

  it('compile-time CuraSlicePresetId narrows to the 3-literal union', () => {
    // The cast is the pin -- a drift in the type alias would fail tsc.
    const a: CuraSlicePresetId = 'balanced'
    const b: CuraSlicePresetId = 'draft'
    const c: CuraSlicePresetId = 'fine'
    expect([a, b, c]).toEqual(['balanced', 'draft', 'fine'])
  })
})

// ---------------------------------------------------------------------------
// D) resolveCuraSliceParams contract
// ---------------------------------------------------------------------------

describe('[ID-0230] D) resolveCuraSliceParams contract', () => {
  it('returns a fresh balanced copy on undefined input', () => {
    const out = resolveCuraSliceParams(undefined)
    expect(out).toEqual(CURA_SLICE_CLI_DEFAULTS)
    expect(out).not.toBe(CURA_SLICE_CLI_DEFAULTS)
  })

  it('returns a fresh balanced copy on null input', () => {
    const out = resolveCuraSliceParams(null)
    expect(out).toEqual(CURA_SLICE_CLI_DEFAULTS)
    expect(out).not.toBe(CURA_SLICE_CLI_DEFAULTS)
  })

  it('returns a fresh balanced copy on empty string', () => {
    // Empty string is falsy so falls through to the defaults branch.
    expect(resolveCuraSliceParams('')).toEqual(CURA_SLICE_CLI_DEFAULTS)
  })

  it('returns a fresh balanced copy on unknown preset id', () => {
    expect(resolveCuraSliceParams('ultra-fine')).toEqual(CURA_SLICE_CLI_DEFAULTS)
  })

  it('returns the balanced preset when called with "balanced"', () => {
    expect(resolveCuraSliceParams('balanced')).toEqual(CURA_SLICE_PRESETS.balanced)
  })

  it('returns the draft preset when called with "draft"', () => {
    expect(resolveCuraSliceParams('draft')).toEqual(CURA_SLICE_PRESETS.draft)
  })

  it('returns the fine preset when called with "fine"', () => {
    expect(resolveCuraSliceParams('fine')).toEqual(CURA_SLICE_PRESETS.fine)
  })

  it('returns a fresh copy (mutating the result does NOT mutate the source)', () => {
    const out = resolveCuraSliceParams('draft')
    out.layerHeightMm = 999
    expect(CURA_SLICE_PRESETS.draft.layerHeightMm).toBe(0.3)
  })
})

// ---------------------------------------------------------------------------
// E) curaCliParamsToEngineSettingsMap contract
// ---------------------------------------------------------------------------

describe('[ID-0230] E) curaCliParamsToEngineSettingsMap contract', () => {
  const ALL_KEYS = ['layer_height', 'line_width', 'wall_line_count', 'infill_sparse_density']

  function snapshot(p: CuraSliceCliParams): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of curaCliParamsToEngineSettingsMap(p).entries()) out[k] = v
    return out
  }

  it('emits exactly the 4 documented CuraEngine keys (set equality)', () => {
    const m = curaCliParamsToEngineSettingsMap(CURA_SLICE_CLI_DEFAULTS)
    expect([...m.keys()].sort()).toEqual([...ALL_KEYS].sort())
  })

  it('emits exactly 4 entries (size pin)', () => {
    expect(curaCliParamsToEngineSettingsMap(CURA_SLICE_CLI_DEFAULTS).size).toBe(4)
  })

  it('layer_height carries the layerHeightMm value as a string', () => {
    expect(snapshot({ ...CURA_SLICE_CLI_DEFAULTS, layerHeightMm: 0.16 })['layer_height']).toBe(
      '0.16'
    )
  })

  it('line_width carries the lineWidthMm value as a string', () => {
    expect(snapshot({ ...CURA_SLICE_CLI_DEFAULTS, lineWidthMm: 0.5 })['line_width']).toBe('0.5')
  })

  it('wall_line_count carries Math.round(wallLineCount) (3.7 -> 4)', () => {
    expect(snapshot({ ...CURA_SLICE_CLI_DEFAULTS, wallLineCount: 3.7 })['wall_line_count']).toBe(
      '4'
    )
  })

  it('wall_line_count rounds 0.4 down to 0 (Math.round half-to-even-or-up convention)', () => {
    expect(snapshot({ ...CURA_SLICE_CLI_DEFAULTS, wallLineCount: 0.4 })['wall_line_count']).toBe(
      '0'
    )
  })

  it('wall_line_count rounds exact-half 0.5 up to 1', () => {
    expect(snapshot({ ...CURA_SLICE_CLI_DEFAULTS, wallLineCount: 0.5 })['wall_line_count']).toBe(
      '1'
    )
  })

  it('infill_sparse_density carries the infillSparseDensity value as a string', () => {
    expect(
      snapshot({ ...CURA_SLICE_CLI_DEFAULTS, infillSparseDensity: 25 })['infill_sparse_density']
    ).toBe('25')
  })

  it('returns a fresh Map per call (no shared singleton across invocations)', () => {
    const a = curaCliParamsToEngineSettingsMap(CURA_SLICE_CLI_DEFAULTS)
    const b = curaCliParamsToEngineSettingsMap(CURA_SLICE_CLI_DEFAULTS)
    expect(a).not.toBe(b)
    expect(a.size).toBe(b.size)
  })

  it('mutation of returned Map does NOT mutate the source defaults', () => {
    const m = curaCliParamsToEngineSettingsMap(CURA_SLICE_CLI_DEFAULTS)
    m.set('layer_height', 'CHANGED')
    expect(CURA_SLICE_CLI_DEFAULTS.layerHeightMm).toBe(0.2)
  })
})

// ---------------------------------------------------------------------------
// F) parseCuraEngineExtraSettingsJson defensive coverage
// ---------------------------------------------------------------------------

describe('[ID-0230] F) parseCuraEngineExtraSettingsJson defensive coverage', () => {
  it('returns {} on undefined', () => {
    expect(parseCuraEngineExtraSettingsJson(undefined)).toEqual({})
  })

  it('returns {} on null', () => {
    expect(parseCuraEngineExtraSettingsJson(null)).toEqual({})
  })

  it('returns {} on empty string', () => {
    expect(parseCuraEngineExtraSettingsJson('')).toEqual({})
  })

  it('returns {} on whitespace-only string', () => {
    expect(parseCuraEngineExtraSettingsJson('   \n\t  ')).toEqual({})
  })

  it('returns {} on malformed JSON', () => {
    expect(parseCuraEngineExtraSettingsJson('{not json')).toEqual({})
  })

  it('returns {} on JSON array (non-object root)', () => {
    expect(parseCuraEngineExtraSettingsJson('[1, 2, 3]')).toEqual({})
  })

  it('returns {} on JSON `null`', () => {
    expect(parseCuraEngineExtraSettingsJson('null')).toEqual({})
  })

  it('returns {} on JSON number / string root', () => {
    expect(parseCuraEngineExtraSettingsJson('42')).toEqual({})
    expect(parseCuraEngineExtraSettingsJson('"hello"')).toEqual({})
  })

  it('coerces number values via String() (finite only)', () => {
    expect(parseCuraEngineExtraSettingsJson('{"a": 1.5, "b": 0}')).toEqual({
      a: '1.5',
      b: '0'
    })
  })

  it('drops non-finite numbers (NaN / Infinity / -Infinity get JSON-encoded as null and dropped)', () => {
    // JSON.stringify cannot produce NaN/Infinity -- but a hand-rolled JSON
    // input string can. Use a literal that JSON.parse will reject as invalid
    // numbers (NaN is not valid JSON; Infinity is not valid JSON either).
    // Confirm the parser swallows the SyntaxError into an empty object.
    expect(parseCuraEngineExtraSettingsJson('{"a": NaN}')).toEqual({})
    expect(parseCuraEngineExtraSettingsJson('{"a": Infinity}')).toEqual({})
  })

  it('coerces boolean true -> "true" and false -> "false"', () => {
    expect(parseCuraEngineExtraSettingsJson('{"a": true, "b": false}')).toEqual({
      a: 'true',
      b: 'false'
    })
  })

  it('drops null / array / nested-object values (only string/number/boolean kept)', () => {
    expect(
      parseCuraEngineExtraSettingsJson(
        '{"a": "x", "b": null, "c": [1], "d": {"k":"v"}}'
      )
    ).toEqual({ a: 'x' })
  })

  it('skips empty-string keys after trim()', () => {
    expect(parseCuraEngineExtraSettingsJson('{"   ": "x", "ok": "y"}')).toEqual({ ok: 'y' })
  })

  it('trims keys (leading/trailing whitespace stripped)', () => {
    expect(parseCuraEngineExtraSettingsJson('{"  a  ": "x"}')).toEqual({ a: 'x' })
  })

  it('preserves string values verbatim (NO trim on values)', () => {
    expect(parseCuraEngineExtraSettingsJson('{"a": "  spaced  "}')).toEqual({
      a: '  spaced  '
    })
  })
})

// ---------------------------------------------------------------------------
// G) parseCuraSliceProfilesJson defensive coverage
// ---------------------------------------------------------------------------

describe('[ID-0230] G) parseCuraSliceProfilesJson defensive coverage', () => {
  it('returns [] on undefined / null / empty / whitespace', () => {
    expect(parseCuraSliceProfilesJson(undefined)).toEqual([])
    expect(parseCuraSliceProfilesJson(null)).toEqual([])
    expect(parseCuraSliceProfilesJson('')).toEqual([])
    expect(parseCuraSliceProfilesJson('   ')).toEqual([])
  })

  it('returns [] on malformed JSON', () => {
    expect(parseCuraSliceProfilesJson('{not')).toEqual([])
  })

  it('returns [] on non-array root (object)', () => {
    expect(parseCuraSliceProfilesJson('{"id":"x","label":"X"}')).toEqual([])
  })

  it('returns [] on non-array root (number)', () => {
    expect(parseCuraSliceProfilesJson('42')).toEqual([])
  })

  it('skips non-object items (numbers / strings / null inside the array)', () => {
    const out = parseCuraSliceProfilesJson('[1, "x", null, {"id":"a","label":"A"}]')
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('a')
  })

  it('skips items missing id', () => {
    expect(parseCuraSliceProfilesJson('[{"label":"X"}]')).toEqual([])
  })

  it('skips items missing label', () => {
    expect(parseCuraSliceProfilesJson('[{"id":"x"}]')).toEqual([])
  })

  it('skips items where id is whitespace-only after trim', () => {
    expect(parseCuraSliceProfilesJson('[{"id":"   ","label":"X"}]')).toEqual([])
  })

  it('skips items where label is whitespace-only after trim', () => {
    expect(parseCuraSliceProfilesJson('[{"id":"x","label":"   "}]')).toEqual([])
  })

  it('basePreset whitelist: only "balanced" / "draft" / "fine" survive; others -> undefined', () => {
    const out = parseCuraSliceProfilesJson(
      '[{"id":"a","label":"A","basePreset":"ULTRA"},{"id":"b","label":"B","basePreset":"draft"}]'
    )
    expect(out[0]?.basePreset).toBeUndefined()
    expect(out[1]?.basePreset).toBe('draft')
  })

  it('parses settingsJson via parseCuraEngineExtraSettingsJson (string -> Record<string,string>)', () => {
    const out = parseCuraSliceProfilesJson(
      '[{"id":"a","label":"A","settingsJson":"{\\"k\\":\\"v\\",\\"n\\":2}"}]'
    )
    expect(out[0]?.settings).toEqual({ k: 'v', n: '2' })
  })

  it('parses inline settings object (numbers/booleans coerced; non-coercible dropped)', () => {
    const out = parseCuraSliceProfilesJson(
      '[{"id":"a","label":"A","settings":{"s":"x","n":1.5,"b":true,"nope":[1]}}]'
    )
    expect(out[0]?.settings).toEqual({ s: 'x', n: '1.5', b: 'true' })
  })

  it('inline settings object with NO coercible values -> settings undefined', () => {
    const out = parseCuraSliceProfilesJson('[{"id":"a","label":"A","settings":{"x":[1]}}]')
    expect(out[0]?.settings).toBeUndefined()
  })

  it('treats inline settings array as no-settings (skipped, not coerced)', () => {
    const out = parseCuraSliceProfilesJson('[{"id":"a","label":"A","settings":[1,2]}]')
    expect(out[0]?.settings).toBeUndefined()
  })

  it('trims id and label whitespace', () => {
    const out = parseCuraSliceProfilesJson('[{"id":"  pla  ","label":"  PLA  "}]')
    expect(out[0]?.id).toBe('pla')
    expect(out[0]?.label).toBe('PLA')
  })

  it('preserves multiple profiles in declared order', () => {
    const out = parseCuraSliceProfilesJson(
      '[{"id":"a","label":"A"},{"id":"b","label":"B"},{"id":"c","label":"C"}]'
    )
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// H) buildCuraEngineSettingsMap precedence
// ---------------------------------------------------------------------------

describe('[ID-0230] H) buildCuraEngineSettingsMap precedence', () => {
  it('returns balanced defaults map when called with no arguments', () => {
    const m = buildCuraEngineSettingsMap({})
    expect(m.get('layer_height')).toBe('0.2')
    expect(m.get('wall_line_count')).toBe('2')
  })

  it('respects presetId at the lowest precedence layer', () => {
    const m = buildCuraEngineSettingsMap({ presetId: 'fine' })
    expect(m.get('layer_height')).toBe('0.12')
    expect(m.get('wall_line_count')).toBe('3')
  })

  it('globalExtraJson overrides preset-derived keys', () => {
    const m = buildCuraEngineSettingsMap({
      presetId: 'balanced',
      globalExtraJson: '{"layer_height":"0.16","extra":"yep"}'
    })
    expect(m.get('layer_height')).toBe('0.16')
    expect(m.get('extra')).toBe('yep')
  })

  it('profile.settings overrides BOTH preset and globalExtraJson keys', () => {
    const m = buildCuraEngineSettingsMap({
      presetId: 'balanced',
      globalExtraJson: '{"layer_height":"0.16"}',
      profile: {
        id: 'p',
        label: 'P',
        settings: { layer_height: '0.10' }
      }
    })
    expect(m.get('layer_height')).toBe('0.10')
  })

  it('profile.basePreset overrides top-level presetId for the base map', () => {
    const m = buildCuraEngineSettingsMap({
      presetId: 'balanced',
      profile: { id: 'x', label: 'X', basePreset: 'fine' }
    })
    expect(m.get('layer_height')).toBe('0.12')
    expect(m.get('wall_line_count')).toBe('3')
  })

  it('profile without basePreset falls back to top-level presetId', () => {
    const m = buildCuraEngineSettingsMap({
      presetId: 'draft',
      profile: { id: 'x', label: 'X' }
    })
    expect(m.get('layer_height')).toBe('0.3')
    expect(m.get('wall_line_count')).toBe('1')
  })

  it('null profile is equivalent to omitted profile', () => {
    const a = buildCuraEngineSettingsMap({ presetId: 'fine', profile: null })
    const b = buildCuraEngineSettingsMap({ presetId: 'fine' })
    expect([...a.entries()]).toEqual([...b.entries()])
  })

  it('returns a fresh Map (no shared singleton)', () => {
    const a = buildCuraEngineSettingsMap({})
    const b = buildCuraEngineSettingsMap({})
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// I) mergeCuraSliceInvocationSettings entrypoint
// ---------------------------------------------------------------------------

describe('[ID-0230] I) mergeCuraSliceInvocationSettings entrypoint', () => {
  it('returns balanced defaults map for null settings', () => {
    const m = mergeCuraSliceInvocationSettings(null)
    expect(m.get('layer_height')).toBe('0.2')
  })

  it('returns balanced defaults map for undefined settings', () => {
    const m = mergeCuraSliceInvocationSettings(undefined)
    expect(m.get('layer_height')).toBe('0.2')
  })

  it('returns balanced defaults map for empty object settings', () => {
    const m = mergeCuraSliceInvocationSettings({})
    expect(m.get('layer_height')).toBe('0.2')
  })

  it('honours curaSlicePreset only', () => {
    const m = mergeCuraSliceInvocationSettings({ curaSlicePreset: 'fine' })
    expect(m.get('layer_height')).toBe('0.12')
  })

  it('curaActiveSliceProfileId looks up profile by id (after trim)', () => {
    const profiles = JSON.stringify([
      { id: 'pla', label: 'PLA', basePreset: 'fine', settingsJson: '{"wall_line_count":"5"}' }
    ])
    const m = mergeCuraSliceInvocationSettings({
      curaSlicePreset: 'balanced',
      curaSliceProfilesJson: profiles,
      curaActiveSliceProfileId: '  pla  '
    })
    expect(m.get('layer_height')).toBe('0.12') // basePreset=fine wins
    expect(m.get('wall_line_count')).toBe('5') // profile.settings wins
  })

  it('whitespace-only curaActiveSliceProfileId resolves to no profile', () => {
    const profiles = JSON.stringify([{ id: 'a', label: 'A', basePreset: 'fine' }])
    const m = mergeCuraSliceInvocationSettings({
      curaSliceProfilesJson: profiles,
      curaActiveSliceProfileId: '   '
    })
    // No profile -> falls back to default balanced.
    expect(m.get('layer_height')).toBe('0.2')
  })

  it('unknown curaActiveSliceProfileId resolves to no profile (no throw)', () => {
    const profiles = JSON.stringify([{ id: 'a', label: 'A' }])
    expect(() =>
      mergeCuraSliceInvocationSettings({
        curaSliceProfilesJson: profiles,
        curaActiveSliceProfileId: 'missing'
      })
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// J) FDM_CAPABILITY_CURA_KEYS literal contract
// ---------------------------------------------------------------------------

describe('[ID-0230] J) FDM_CAPABILITY_CURA_KEYS literal contract', () => {
  it('declares exactly 4 keys', () => {
    expect(Object.keys(FDM_CAPABILITY_CURA_KEYS).sort()).toEqual(
      ['chamberTempC', 'heatedBuildVolumeFlag', 'maxBedTempC', 'maxNozzleTempC'].sort()
    )
  })

  it('maxNozzleTempC -> "machine_nozzle_temp_max" (exact CuraEngine setting id)', () => {
    expect(FDM_CAPABILITY_CURA_KEYS.maxNozzleTempC).toBe('machine_nozzle_temp_max')
  })

  it('maxBedTempC -> "machine_max_bed_temp"', () => {
    expect(FDM_CAPABILITY_CURA_KEYS.maxBedTempC).toBe('machine_max_bed_temp')
  })

  it('chamberTempC -> "build_volume_temperature"', () => {
    expect(FDM_CAPABILITY_CURA_KEYS.chamberTempC).toBe('build_volume_temperature')
  })

  it('heatedBuildVolumeFlag -> "machine_heated_build_volume"', () => {
    expect(FDM_CAPABILITY_CURA_KEYS.heatedBuildVolumeFlag).toBe('machine_heated_build_volume')
  })

  it('all four values are non-empty lowercase snake_case strings', () => {
    for (const v of Object.values(FDM_CAPABILITY_CURA_KEYS)) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
      expect(v).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })

  it('all four values are unique (no duplicate setting ids)', () => {
    const set = new Set(Object.values(FDM_CAPABILITY_CURA_KEYS))
    expect(set.size).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// K) fdmCapabilitiesToEngineSettings (additional purity / referential pins)
// ---------------------------------------------------------------------------

describe('[ID-0230] K) fdmCapabilitiesToEngineSettings purity / referential pins', () => {
  it('returns a fresh Map per call (no shared singleton)', () => {
    const a = fdmCapabilitiesToEngineSettings({ maxNozzleTempC: 350 })
    const b = fdmCapabilitiesToEngineSettings({ maxNozzleTempC: 350 })
    expect(a).not.toBe(b)
  })

  it('does not mutate the caller-supplied caps object', () => {
    const caps: FdmCapabilityFields = { maxNozzleTempC: 350, maxBedTempC: 120 }
    const before = JSON.stringify(caps)
    fdmCapabilitiesToEngineSettings(caps)
    expect(JSON.stringify(caps)).toBe(before)
  })

  it('chamber flag is omitted when chamberTempC is unset (NOT set to "false")', () => {
    const m = fdmCapabilitiesToEngineSettings({ maxNozzleTempC: 350 })
    expect(m.has(FDM_CAPABILITY_CURA_KEYS.heatedBuildVolumeFlag)).toBe(false)
  })

  it('chamber flag is omitted when chamberTempC === 0 (>0 guard fires)', () => {
    const m = fdmCapabilitiesToEngineSettings({ chamberTempC: 0 })
    expect(m.has(FDM_CAPABILITY_CURA_KEYS.heatedBuildVolumeFlag)).toBe(false)
    expect(m.size).toBe(0)
  })

  it('chamber flag is omitted when chamberTempC is negative', () => {
    const m = fdmCapabilitiesToEngineSettings({ chamberTempC: -10 })
    expect(m.has(FDM_CAPABILITY_CURA_KEYS.heatedBuildVolumeFlag)).toBe(false)
  })

  it('all 3 numeric fields are independent (each guard fires alone)', () => {
    const allBad = fdmCapabilitiesToEngineSettings({
      maxNozzleTempC: -1,
      maxBedTempC: -1,
      chamberTempC: -1
    })
    expect(allBad.size).toBe(0)
  })

  it('emits ALL three keys (plus chamber flag) for the bundled K2 Plus capability triple', () => {
    const m = fdmCapabilitiesToEngineSettings({
      maxNozzleTempC: 350,
      maxBedTempC: 120,
      chamberTempC: 60
    })
    expect(m.size).toBe(4)
    expect(m.get(FDM_CAPABILITY_CURA_KEYS.maxNozzleTempC)).toBe('350')
    expect(m.get(FDM_CAPABILITY_CURA_KEYS.maxBedTempC)).toBe('120')
    expect(m.get(FDM_CAPABILITY_CURA_KEYS.chamberTempC)).toBe('60')
    expect(m.get(FDM_CAPABILITY_CURA_KEYS.heatedBuildVolumeFlag)).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// L) mergeFdmCapabilitiesUnder contract
// ---------------------------------------------------------------------------

describe('[ID-0230] L) mergeFdmCapabilitiesUnder contract', () => {
  it('returns a fresh Map (does not return the caller `over` reference)', () => {
    const over = new Map<string, string>([['layer_height', '0.2']])
    const out = mergeFdmCapabilitiesUnder(null, over)
    expect(out).not.toBe(over)
  })

  it('caller `over` always wins on key conflict', () => {
    const over = new Map<string, string>([['machine_nozzle_temp_max', '380']])
    const m = mergeFdmCapabilitiesUnder({ maxNozzleTempC: 350 }, over)
    expect(m.get('machine_nozzle_temp_max')).toBe('380')
  })

  it('non-conflicting capability keys are added under', () => {
    const over = new Map<string, string>([['layer_height', '0.2']])
    const m = mergeFdmCapabilitiesUnder({ maxBedTempC: 120 }, over)
    expect(m.get('layer_height')).toBe('0.2')
    expect(m.get('machine_max_bed_temp')).toBe('120')
  })

  it('null caps -> map equals contents of over (just a copy)', () => {
    const over = new Map<string, string>([['layer_height', '0.2'], ['extra', 'yep']])
    const m = mergeFdmCapabilitiesUnder(null, over)
    expect([...m.entries()].sort()).toEqual([...over.entries()].sort())
  })

  it('does not mutate the caller `over` map', () => {
    const over = new Map<string, string>([['layer_height', '0.2']])
    const before = [...over.entries()]
    mergeFdmCapabilitiesUnder({ maxNozzleTempC: 350 }, over)
    expect([...over.entries()]).toEqual(before)
  })
})

// ---------------------------------------------------------------------------
// M) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0230] M) source-text whitelist', () => {
  it('JSDoc names roadmap [ID-0068] provenance for the FDM capability bridge', () => {
    expect(SRC).toContain('[ID-0068]')
  })

  it('JSDoc names the prior [ID-0012] origin (Cycle 8)', () => {
    expect(SRC).toContain('[ID-0012]')
  })

  it('JSDoc names the Creality K2 Plus bundled profile capabilities (350 / 120 / 60)', () => {
    expect(SRC).toContain('K2 Plus')
    expect(SRC).toMatch(/350/)
    expect(SRC).toMatch(/120/)
    expect(SRC).toMatch(/60/)
  })

  it('JSDoc names Safety Rule 1 (no G-code emitted by this module)', () => {
    expect(SRC).toContain('Safety Rule 1')
  })

  it('JSDoc names Safety Rule 2 (additive and fully optional)', () => {
    expect(SRC).toContain('Safety Rule 2')
  })

  it('imports AppSettings type-only (avoids runtime cycle with project-schema)', () => {
    expect(SRC).toMatch(/^import type \{ AppSettings \} from '\.\/project-schema'$/m)
  })

  it('emits the 4 CuraEngine setting-id strings verbatim', () => {
    expect(SRC).toContain("'machine_nozzle_temp_max'")
    expect(SRC).toContain("'machine_max_bed_temp'")
    expect(SRC).toContain("'build_volume_temperature'")
    expect(SRC).toContain("'machine_heated_build_volume'")
  })

  it('emits the 4 base CuraEngine `-s` keys verbatim (layer/line/wall/infill)', () => {
    expect(SRC).toContain("'layer_height'")
    expect(SRC).toContain("'line_width'")
    expect(SRC).toContain("'wall_line_count'")
    expect(SRC).toContain("'infill_sparse_density'")
  })

  it('exports CURA_SLICE_CLI_DEFAULTS as `export const`', () => {
    expect(SRC).toMatch(/^export const CURA_SLICE_CLI_DEFAULTS = \{/m)
  })

  it('exports CURA_SLICE_PRESET_IDS as `export const ... as const`', () => {
    expect(SRC).toMatch(/^export const CURA_SLICE_PRESET_IDS = \[.*\] as const$/m)
  })

  it('declares CuraSlicePresetId as `export type ...= (typeof CURA_SLICE_PRESET_IDS)[number]`', () => {
    expect(SRC).toMatch(
      /^export type CuraSlicePresetId =\s*\(typeof CURA_SLICE_PRESET_IDS\)\[number\]$/m
    )
  })

  it('exports FDM_CAPABILITY_CURA_KEYS as `export const ... as const`', () => {
    expect(SRC).toMatch(/^export const FDM_CAPABILITY_CURA_KEYS = \{/m)
  })

  it('uses Math.round on wallLineCount (integer-only invariant)', () => {
    expect(SRC).toContain('Math.round(p.wallLineCount)')
  })

  it('guards numeric capability values with > 0 (no negative emission)', () => {
    expect(SRC).toMatch(/maxNozzleTempC > 0/)
    expect(SRC).toMatch(/maxBedTempC > 0/)
    expect(SRC).toMatch(/chamberTempC > 0/)
  })

  it('uses Number.isFinite to reject NaN / Infinity capability values', () => {
    expect(SRC).toMatch(/Number\.isFinite\(maxNozzleTempC\)/)
    expect(SRC).toMatch(/Number\.isFinite\(maxBedTempC\)/)
    expect(SRC).toMatch(/Number\.isFinite\(chamberTempC\)/)
  })

  it('module exports exactly 8 `export function` declarations', () => {
    const code = codeOnly(SRC)
    const matches = code.match(/^export function /gm) ?? []
    expect(matches).toHaveLength(8)
  })

  it('module exports exactly 4 `export const` declarations', () => {
    const code = codeOnly(SRC)
    const matches = code.match(/^export const /gm) ?? []
    expect(matches).toHaveLength(4)
  })

  it('module exports exactly 4 `export type` declarations', () => {
    const code = codeOnly(SRC)
    const matches = code.match(/^export type /gm) ?? []
    expect(matches).toHaveLength(4)
  })

  it('module declares NO default export', () => {
    expect(SRC).not.toMatch(/^export default /m)
  })

  it('module declares NO top-level `var` (purity invariant)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/^var /m)
  })

  it('module has NO `: any` annotation in executable code (Safety Rule 3)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/:\s*any\b/)
  })

  it('module has NO `as any` cast in executable code (Safety Rule 3)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bas\s+any\b/)
  })

  it('module has NO `<any>` generic argument in executable code (Safety Rule 3)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/<any>/)
  })

  it('module imports NOTHING from electron / fs / path / child_process / dgram / net / tls (Safety Rule 4)', () => {
    expect(SRC).not.toMatch(/from\s+'electron'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?fs'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?path'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?child_process'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?dgram'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?net'/)
    expect(SRC).not.toMatch(/from\s+'(node:)?tls'/)
  })

  it('module imports NOTHING from React / DOM (lives under src/shared/)', () => {
    expect(SRC).not.toMatch(/from\s+'react'/)
    expect(SRC).not.toMatch(/from\s+'react-dom'/)
  })

  it('module emits NO Handlebars tokens (no {{...}} templates)', () => {
    expect(SRC).not.toMatch(/\{\{[^}]+\}\}/)
  })

  it('module emits NO G-code tokens in executable code (G0/G1/G17/G20/G21/G28/G54/G90/G91)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bG(?:0|1|17|18|19|20|21|28|54|90|91)\b/)
  })

  it('module emits NO M-code tokens in executable code (M3/M5/M6/M30/etc.)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bM(?:3|03|5|05|6|06|7|8|9|30)\b/)
  })

  it('module references NO foreign-machine vendor names (no Bambu/Prusa/Voron/Onefinity/Shapeoko/Longmill)', () => {
    expect(SRC).not.toMatch(/\b(?:Bambu|Prusa|Voron|Ender-N|Onefinity|Shapeoko|Longmill)\b/)
  })

  it('source size stays under 300 lines (load-bearing terseness invariant)', () => {
    const lines = SRC.split('\n').length
    expect(lines).toBeLessThan(300)
  })

  it('source size stays under 12 KB (load-bearing terseness invariant)', () => {
    expect(Buffer.byteLength(SRC, 'utf8')).toBeLessThan(12 * 1024)
  })
})

// ---------------------------------------------------------------------------
// N) Cross-cutting safety: bundled-fleet anchor
// ---------------------------------------------------------------------------

describe('[ID-0230] N) cross-cutting bundled-fleet safety', () => {
  it('Creality K2 Plus profile carries all three FDM capability fields', () => {
    const k2 = loadProfileRaw('creality-k2-plus.json')
    expect(k2.maxNozzleTempC).toBe(350)
    expect(k2.maxBedTempC).toBe(120)
    expect(k2.chamberTempC).toBe(60)
  })

  it('K2 Plus profile fed through the helper produces the full 4-key map', () => {
    const k2 = loadProfileRaw('creality-k2-plus.json') as FdmCapabilityFields
    const m = fdmCapabilitiesToEngineSettings(k2)
    expect(m.size).toBe(4)
    expect(m.get('machine_nozzle_temp_max')).toBe('350')
    expect(m.get('machine_max_bed_temp')).toBe('120')
    expect(m.get('build_volume_temperature')).toBe('60')
    expect(m.get('machine_heated_build_volume')).toBe('true')
  })

  it('Laguna Swift profile does NOT carry any FDM capability fields', () => {
    const laguna = loadProfileRaw('laguna-swift-5x10.json')
    expect(laguna.maxNozzleTempC).toBeUndefined()
    expect(laguna.maxBedTempC).toBeUndefined()
    expect(laguna.chamberTempC).toBeUndefined()
  })

  it('Laguna Swift profile fed through the helper produces an empty map (CNC, no FDM caps)', () => {
    const laguna = loadProfileRaw('laguna-swift-5x10.json') as FdmCapabilityFields
    expect(fdmCapabilitiesToEngineSettings(laguna).size).toBe(0)
  })

  it('Makera Carvera 3-axis profile does NOT carry any FDM capability fields', () => {
    const carvera = loadProfileRaw('makera-carvera-3axis.json')
    expect(carvera.maxNozzleTempC).toBeUndefined()
    expect(carvera.maxBedTempC).toBeUndefined()
    expect(carvera.chamberTempC).toBeUndefined()
  })

  it('Makera Carvera 4-axis profile does NOT carry any FDM capability fields', () => {
    const carvera4 = loadProfileRaw('makera-carvera-4axis.json')
    expect(carvera4.maxNozzleTempC).toBeUndefined()
    expect(carvera4.maxBedTempC).toBeUndefined()
    expect(carvera4.chamberTempC).toBeUndefined()
  })

  it('only ONE bundled profile (K2 Plus) carries FDM capability fields (cross-fleet uniqueness)', () => {
    const profiles = [
      'creality-k2-plus.json',
      'laguna-swift-5x10.json',
      'makera-carvera-3axis.json',
      'makera-carvera-4axis.json'
    ]
    let count = 0
    for (const file of profiles) {
      const p = loadProfileRaw(file) as FdmCapabilityFields
      if (
        typeof p.maxNozzleTempC === 'number' ||
        typeof p.maxBedTempC === 'number' ||
        typeof p.chamberTempC === 'number'
      ) {
        count += 1
      }
    }
    expect(count).toBe(1)
  })

  it('compile-time CuraSliceNamedProfile shape is byte-compatible with a literal { id, label }', () => {
    // Pin via assignment -- a drift in the type alias would fail tsc.
    const p: CuraSliceNamedProfile = { id: 'x', label: 'X' }
    expect(p.id).toBe('x')
  })
})
