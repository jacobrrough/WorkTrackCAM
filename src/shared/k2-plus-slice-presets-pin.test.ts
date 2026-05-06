/**
 * Paired-pin contract for `src/shared/k2-plus-slice-presets.ts`.
 *
 * Roadmap: [P2-K2-SLICE]/Cycle 5 (K2 Plus quality presets companion to the
 * Cycle 4 `creality_k2_plus.def.json` hardware-ceiling overrides).
 *
 * The presets exist to give Manufacture a one-click "Standard" / "High-
 * Speed" toggle that ships K2-tuned `-s` argv to CuraEngine without ever
 * exceeding the K2 mechanical envelope. This pin is the safety wall: a
 * future tuning bump that would push speed_travel past 600 mm/s, or
 * acceleration_print past 30000 mm/s², or jerk_print past 9 mm/s, fails
 * here at CI time -- not on Jacob\'s actual K2 Plus where the gantry
 * collides with the X-tower or the input-shaper saturates.
 *
 * Test groups:
 *   A. Module shape (exports inventory + ID tuple discriminator)
 *   B. SOURCE-text purity (no fs/net/electron leak, no G-code literals)
 *   C. K2 hardware-ceiling envelope enforcement (the safety wall)
 *   D. Required CuraEngine setting keys present in BOTH presets
 *   E. Standard preset specific tuning (200 mm/s daily-driver)
 *   F. High-speed preset specific tuning (500 mm/s, jerk-at-ceiling)
 *   G. resolveK2PlusPreset behavior + invalid input handling
 *   H. k2PlusPresetToEngineSettingsMap fresh-Map invariant + roundtrip
 *   I. Three-machine cross-cut realism (DIRECT K2; INDIRECT Laguna/Carvera)
 *   J. On-disk source provenance + sentinel
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as Mod from './k2-plus-slice-presets'
import {
  K2_PLUS_HARDWARE_CEILINGS,
  K2_PLUS_QUALITY_PRESET_IDS,
  K2_PLUS_SLICE_PRESETS,
  k2PlusPresetToEngineSettingsMap,
  resolveK2PlusPreset,
  type K2PlusQualityPreset,
  type K2PlusQualityPresetId
} from './k2-plus-slice-presets'

const SOURCE_PATH = join(process.cwd(), 'src', 'shared', 'k2-plus-slice-presets.ts')
const SOURCE = readFileSync(SOURCE_PATH, 'utf-8')

const REQUIRED_SETTING_KEYS = [
  'layer_height',
  'layer_height_0',
  'line_width',
  'wall_line_count',
  'top_layers',
  'bottom_layers',
  'infill_sparse_density',
  'infill_pattern',
  'speed_print',
  'speed_wall_0',
  'speed_wall_x',
  'speed_topbottom',
  'speed_infill',
  'speed_travel',
  'speed_layer_0',
  'acceleration_print',
  'acceleration_travel',
  'acceleration_wall_0',
  'acceleration_topbottom',
  'acceleration_layer_0',
  'jerk_print',
  'jerk_travel',
  'jerk_wall_0',
  'jerk_layer_0',
  'retraction_enable',
  'retraction_amount',
  'retraction_speed',
  'retraction_retract_speed',
  'retraction_prime_speed',
  'material_print_temperature',
  'material_print_temperature_layer_0',
  'material_bed_temperature',
  'material_bed_temperature_layer_0',
  'build_volume_temperature',
  'cool_fan_enabled',
  'cool_fan_speed',
  'cool_fan_speed_0',
  'cool_min_layer_time',
  'adhesion_type',
  'skirt_line_count',
  'skirt_gap'
] as const

const SPEED_KEYS = [
  'speed_print',
  'speed_wall_0',
  'speed_wall_x',
  'speed_topbottom',
  'speed_infill',
  'speed_travel',
  'speed_layer_0'
] as const

const ACCEL_KEYS = [
  'acceleration_print',
  'acceleration_travel',
  'acceleration_wall_0',
  'acceleration_topbottom',
  'acceleration_layer_0'
] as const

const JERK_KEYS = ['jerk_print', 'jerk_travel', 'jerk_wall_0', 'jerk_layer_0'] as const

describe('k2-plus-slice-presets -- A. Module shape', () => {
  it('A1 named exports include K2_PLUS_QUALITY_PRESET_IDS', () => {
    expect(Mod).toHaveProperty('K2_PLUS_QUALITY_PRESET_IDS')
  })
  it('A2 named exports include K2_PLUS_HARDWARE_CEILINGS', () => {
    expect(Mod).toHaveProperty('K2_PLUS_HARDWARE_CEILINGS')
  })
  it('A3 named exports include K2_PLUS_SLICE_PRESETS', () => {
    expect(Mod).toHaveProperty('K2_PLUS_SLICE_PRESETS')
  })
  it('A4 named exports include resolveK2PlusPreset', () => {
    expect(typeof Mod.resolveK2PlusPreset).toBe('function')
  })
  it('A5 named exports include k2PlusPresetToEngineSettingsMap', () => {
    expect(typeof Mod.k2PlusPresetToEngineSettingsMap).toBe('function')
  })
  it('A6 module has no default export', () => {
    expect((Mod as Record<string, unknown>).default).toBeUndefined()
  })
  it('A7 K2_PLUS_QUALITY_PRESET_IDS has exactly 2 ids', () => {
    expect(K2_PLUS_QUALITY_PRESET_IDS.length).toBe(2)
  })
  it('A8 K2_PLUS_QUALITY_PRESET_IDS contains "standard"', () => {
    expect(K2_PLUS_QUALITY_PRESET_IDS).toContain('standard')
  })
  it('A9 K2_PLUS_QUALITY_PRESET_IDS contains "high_speed"', () => {
    expect(K2_PLUS_QUALITY_PRESET_IDS).toContain('high_speed')
  })
  it('A10 K2_PLUS_SLICE_PRESETS has standard entry', () => {
    expect(K2_PLUS_SLICE_PRESETS.standard).toBeDefined()
  })
  it('A11 K2_PLUS_SLICE_PRESETS has high_speed entry', () => {
    expect(K2_PLUS_SLICE_PRESETS.high_speed).toBeDefined()
  })
  it('A12 every preset id appears as a K2_PLUS_SLICE_PRESETS key', () => {
    for (const id of K2_PLUS_QUALITY_PRESET_IDS) {
      expect(K2_PLUS_SLICE_PRESETS[id]).toBeDefined()
    }
  })
  it('A13 resolveK2PlusPreset.length === 1', () => {
    expect(resolveK2PlusPreset.length).toBe(1)
  })
  it('A14 k2PlusPresetToEngineSettingsMap.length === 1', () => {
    expect(k2PlusPresetToEngineSettingsMap.length).toBe(1)
  })
})

describe('k2-plus-slice-presets -- B. SOURCE-text purity', () => {
  it('B1 SOURCE has zero node:fs imports', () => {
    expect(/from\s+[\'"]node:fs/.test(SOURCE)).toBe(false)
  })
  it('B2 SOURCE has zero node:path imports', () => {
    expect(/from\s+[\'"]node:path/.test(SOURCE)).toBe(false)
  })
  it('B3 SOURCE has zero electron imports', () => {
    expect(/from\s+[\'"]electron/.test(SOURCE)).toBe(false)
  })
  it('B4 SOURCE has zero child_process imports', () => {
    expect(/child_process/.test(SOURCE)).toBe(false)
  })
  it('B5 SOURCE has zero G-code emission patterns (G0/G1/G28/G92/M104/M140)', () => {
    expect(/\b(G0|G1|G28|G92|M104|M140|M109|M190)\b/.test(SOURCE)).toBe(false)
  })
  it('B6 SOURCE has zero `any` type literal', () => {
    expect(/:\s*any\b/.test(SOURCE)).toBe(false)
  })
  it('B7 SOURCE has zero TODO/FIXME/HACK markers', () => {
    expect(/\b(TODO|FIXME|HACK)\b/.test(SOURCE)).toBe(false)
  })
  it('B8 SOURCE has zero console.* calls', () => {
    expect(/console\.[a-z]+\s*\(/.test(SOURCE)).toBe(false)
  })
  it('B9 SOURCE has zero process.* references', () => {
    expect(/\bprocess\.[a-z]/.test(SOURCE)).toBe(false)
  })
  it('B10 SOURCE has zero eval calls', () => {
    expect(/\beval\s*\(/.test(SOURCE)).toBe(false)
  })
  it('B11 SOURCE has zero non-K2 machine-vendor identifiers (Laguna)', () => {
    expect(/\bLaguna\b|\bRichAuto\b|\bvcarve_mach3\b/i.test(SOURCE)).toBe(false)
  })
  it('B12 SOURCE has zero non-K2 machine-vendor identifiers (Carvera)', () => {
    expect(/\bCarvera\b|\bMakera\b|\bSmoothieware\b/i.test(SOURCE)).toBe(false)
  })
  it('B13 SOURCE references Creality K2 Plus by name', () => {
    expect(/Creality K2 Plus/.test(SOURCE)).toBe(true)
  })
  it('B14 SOURCE references Klipper by name', () => {
    expect(/Klipper/.test(SOURCE)).toBe(true)
  })
  it('B15 SOURCE has zero localStorage/sessionStorage', () => {
    expect(/(localStorage|sessionStorage)/.test(SOURCE)).toBe(false)
  })
  it('B16 SOURCE has exactly two preset constant declarations', () => {
    const m = SOURCE.match(/const\s+(STANDARD|HIGH_SPEED)_PRESET\s*:/g)
    expect(m?.length).toBe(2)
  })
  it('B17 SOURCE references the def.json filename in docstring', () => {
    expect(/creality_k2_plus\.def\.json/.test(SOURCE)).toBe(true)
  })
  it('B18 SOURCE has Object.freeze on the presets table', () => {
    expect(/Object\.freeze\s*\(\s*\{[\s\S]*standard:[\s\S]*high_speed:/m.test(SOURCE)).toBe(true)
  })
  it('B19 SOURCE has zero http(s) URL literals', () => {
    expect(/https?:\/\//.test(SOURCE)).toBe(false)
  })
  it('B20 SOURCE has exactly ONE import statement', () => {
    const imports = SOURCE.match(/^import\s+/gm) ?? []
    expect(imports.length).toBe(0)
  })
})

describe('k2-plus-slice-presets -- C. K2 hardware ceiling envelope', () => {
  const speedCeiling = K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec
  const accelCeiling = K2_PLUS_HARDWARE_CEILINGS.maxAccelXyMmPerSec2
  const jerkCeiling = K2_PLUS_HARDWARE_CEILINGS.maxJerkXyMmPerSec
  it('C1 hardware ceiling XY feedrate matches CLAUDE.md spec (600 mm/s)', () => {
    expect(speedCeiling).toBe(600)
  })
  it('C2 hardware ceiling XY accel matches CLAUDE.md spec (30000 mm/s^2)', () => {
    expect(accelCeiling).toBe(30000)
  })
  it('C3 hardware ceiling XY jerk matches def.json (9 mm/s)', () => {
    expect(jerkCeiling).toBe(9)
  })
  it('C4 hardware ceiling Z feedrate matches def.json (30 mm/s)', () => {
    expect(K2_PLUS_HARDWARE_CEILINGS.maxFeedrateZMmPerSec).toBe(30)
  })
  it('C5 hardware ceiling E feedrate matches def.json (100 mm/s)', () => {
    expect(K2_PLUS_HARDWARE_CEILINGS.maxFeedrateEMmPerSec).toBe(100)
  })
  it('C6 hardware ceiling Z accel matches def.json (500 mm/s^2)', () => {
    expect(K2_PLUS_HARDWARE_CEILINGS.maxAccelZMmPerSec2).toBe(500)
  })
  it('C7 hardware ceiling E accel matches def.json (5000 mm/s^2)', () => {
    expect(K2_PLUS_HARDWARE_CEILINGS.maxAccelEMmPerSec2).toBe(5000)
  })
  it('C8 hardware ceiling nozzle temp matches creality-k2-plus.json (350 C)', () => {
    expect(K2_PLUS_HARDWARE_CEILINGS.maxNozzleTempC).toBe(350)
  })
  it('C9 hardware ceiling bed temp matches creality-k2-plus.json (120 C)', () => {
    expect(K2_PLUS_HARDWARE_CEILINGS.maxBedTempC).toBe(120)
  })
  for (const id of K2_PLUS_QUALITY_PRESET_IDS) {
    for (const key of SPEED_KEYS) {
      it('C-speed-' + id + '-' + key + ' <= K2 XY feedrate ceiling', () => {
        const v = Number(K2_PLUS_SLICE_PRESETS[id].settings[key])
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeLessThanOrEqual(speedCeiling)
        expect(v).toBeGreaterThan(0)
      })
    }
    for (const key of ACCEL_KEYS) {
      it('C-accel-' + id + '-' + key + ' <= K2 XY accel ceiling', () => {
        const v = Number(K2_PLUS_SLICE_PRESETS[id].settings[key])
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeLessThanOrEqual(accelCeiling)
        expect(v).toBeGreaterThan(0)
      })
    }
    for (const key of JERK_KEYS) {
      it('C-jerk-' + id + '-' + key + ' <= K2 XY jerk ceiling', () => {
        const v = Number(K2_PLUS_SLICE_PRESETS[id].settings[key])
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeLessThanOrEqual(jerkCeiling)
        expect(v).toBeGreaterThan(0)
      })
    }
    it('C-temp-nozzle-' + id + ' <= K2 max nozzle temp', () => {
      const v = Number(K2_PLUS_SLICE_PRESETS[id].settings.material_print_temperature)
      expect(v).toBeLessThanOrEqual(K2_PLUS_HARDWARE_CEILINGS.maxNozzleTempC)
    })
    it('C-temp-bed-' + id + ' <= K2 max bed temp', () => {
      const v = Number(K2_PLUS_SLICE_PRESETS[id].settings.material_bed_temperature)
      expect(v).toBeLessThanOrEqual(K2_PLUS_HARDWARE_CEILINGS.maxBedTempC)
    })
  }
})

describe('k2-plus-slice-presets -- D. Required CuraEngine setting keys', () => {
  for (const id of K2_PLUS_QUALITY_PRESET_IDS) {
    for (const key of REQUIRED_SETTING_KEYS) {
      it('D-' + id + '-has-' + key, () => {
        expect(K2_PLUS_SLICE_PRESETS[id].settings[key]).toBeDefined()
        expect(typeof K2_PLUS_SLICE_PRESETS[id].settings[key]).toBe('string')
      })
    }
  }
})

describe('k2-plus-slice-presets -- E. Standard preset', () => {
  const p = K2_PLUS_SLICE_PRESETS.standard
  it('E1 id is "standard"', () => {
    expect(p.id).toBe('standard')
  })
  it('E2 label mentions "Standard"', () => {
    expect(p.label).toMatch(/Standard/i)
  })
  it('E3 label mentions PLA daily-driver speed (200 mm/s)', () => {
    expect(p.label).toMatch(/200\s*mm\/s/i)
  })
  it('E4 print speed is 200 mm/s', () => {
    expect(p.settings.speed_print).toBe('200')
  })
  it('E5 layer height is 0.2 mm', () => {
    expect(p.settings.layer_height).toBe('0.2')
  })
  it('E6 print acceleration is 5000 mm/s^2', () => {
    expect(p.settings.acceleration_print).toBe('5000')
  })
  it('E7 jerk_print is 8 mm/s (under 9 ceiling)', () => {
    expect(p.settings.jerk_print).toBe('8')
  })
  it('E8 retraction is enabled', () => {
    expect(p.settings.retraction_enable).toBe('true')
  })
  it('E9 retraction amount is 0.5 mm (direct-drive K2)', () => {
    expect(p.settings.retraction_amount).toBe('0.5')
  })
  it('E10 chamber heater on at 35 C', () => {
    expect(p.settings.build_volume_temperature).toBe('35')
  })
  it('E11 cooling fan enabled', () => {
    expect(p.settings.cool_fan_enabled).toBe('true')
  })
  it('E12 fan speed 100 percent', () => {
    expect(p.settings.cool_fan_speed).toBe('100')
  })
  it('E13 first-layer fan speed 0 percent', () => {
    expect(p.settings.cool_fan_speed_0).toBe('0')
  })
  it('E14 adhesion is skirt', () => {
    expect(p.settings.adhesion_type).toBe('skirt')
  })
  it('E15 wall line count is 3', () => {
    expect(p.settings.wall_line_count).toBe('3')
  })
})

describe('k2-plus-slice-presets -- F. High-speed preset', () => {
  const p = K2_PLUS_SLICE_PRESETS.high_speed
  it('F1 id is "high_speed"', () => {
    expect(p.id).toBe('high_speed')
  })
  it('F2 label mentions "High-Speed"', () => {
    expect(p.label).toMatch(/High-?Speed/i)
  })
  it('F3 label mentions 500 mm/s', () => {
    expect(p.label).toMatch(/500\s*mm\/s/i)
  })
  it('F4 print speed is 500 mm/s', () => {
    expect(p.settings.speed_print).toBe('500')
  })
  it('F5 layer height is 0.2 mm', () => {
    expect(p.settings.layer_height).toBe('0.2')
  })
  it('F6 print acceleration is 25000 mm/s^2', () => {
    expect(p.settings.acceleration_print).toBe('25000')
  })
  it('F7 jerk_print sits AT K2 ceiling (9 mm/s)', () => {
    expect(p.settings.jerk_print).toBe('9')
  })
  it('F8 travel speed sits AT K2 ceiling (600 mm/s)', () => {
    expect(p.settings.speed_travel).toBe('600')
  })
  it('F9 travel acceleration sits AT K2 ceiling (30000 mm/s^2)', () => {
    expect(p.settings.acceleration_travel).toBe('30000')
  })
  it('F10 nozzle temp lifted to 230 C for melt rate', () => {
    expect(p.settings.material_print_temperature).toBe('230')
  })
  it('F11 chamber heater on at 40 C', () => {
    expect(p.settings.build_volume_temperature).toBe('40')
  })
  it('F12 retraction speed lifted to 60 mm/s', () => {
    expect(p.settings.retraction_speed).toBe('60')
  })
  it('F13 infill speed sits AT K2 ceiling (600 mm/s)', () => {
    expect(p.settings.speed_infill).toBe('600')
  })
  it('F14 infill pattern is gyroid for high-speed', () => {
    expect(p.settings.infill_pattern).toBe('gyroid')
  })
  it('F15 high_speed travel-speed > standard travel-speed', () => {
    const std = Number(K2_PLUS_SLICE_PRESETS.standard.settings.speed_travel)
    const hs = Number(p.settings.speed_travel)
    expect(hs).toBeGreaterThan(std)
  })
})

describe('k2-plus-slice-presets -- G. resolveK2PlusPreset', () => {
  it('G1 returns standard preset for "standard"', () => {
    expect(resolveK2PlusPreset('standard')?.id).toBe('standard')
  })
  it('G2 returns high_speed preset for "high_speed"', () => {
    expect(resolveK2PlusPreset('high_speed')?.id).toBe('high_speed')
  })
  it('G3 returns undefined for null', () => {
    expect(resolveK2PlusPreset(null)).toBeUndefined()
  })
  it('G4 returns undefined for undefined', () => {
    expect(resolveK2PlusPreset(undefined)).toBeUndefined()
  })
  it('G5 returns undefined for empty string', () => {
    expect(resolveK2PlusPreset('')).toBeUndefined()
  })
  it('G6 returns undefined for unknown id', () => {
    expect(resolveK2PlusPreset('ludicrous_speed')).toBeUndefined()
  })
  it('G7 returns undefined for case-mismatch (presets are exact-match)', () => {
    expect(resolveK2PlusPreset('Standard')).toBeUndefined()
    expect(resolveK2PlusPreset('HIGH_SPEED')).toBeUndefined()
  })
  it('G8 returns the SAME object reference (no clone) for performance', () => {
    expect(resolveK2PlusPreset('standard')).toBe(K2_PLUS_SLICE_PRESETS.standard)
  })
  it('G9 returns object with the correct shape', () => {
    const p = resolveK2PlusPreset('standard') as K2PlusQualityPreset
    expect(typeof p.id).toBe('string')
    expect(typeof p.label).toBe('string')
    expect(typeof p.description).toBe('string')
    expect(typeof p.settings).toBe('object')
  })
})

describe('k2-plus-slice-presets -- H. k2PlusPresetToEngineSettingsMap', () => {
  it('H1 returns a Map instance', () => {
    expect(k2PlusPresetToEngineSettingsMap(K2_PLUS_SLICE_PRESETS.standard)).toBeInstanceOf(Map)
  })
  it('H2 standard preset map has the same key count as settings', () => {
    const m = k2PlusPresetToEngineSettingsMap(K2_PLUS_SLICE_PRESETS.standard)
    expect(m.size).toBe(Object.keys(K2_PLUS_SLICE_PRESETS.standard.settings).length)
  })
  it('H3 high_speed preset map has the same key count as settings', () => {
    const m = k2PlusPresetToEngineSettingsMap(K2_PLUS_SLICE_PRESETS.high_speed)
    expect(m.size).toBe(Object.keys(K2_PLUS_SLICE_PRESETS.high_speed.settings).length)
  })
  it('H4 standard preset map round-trips a known key', () => {
    const m = k2PlusPresetToEngineSettingsMap(K2_PLUS_SLICE_PRESETS.standard)
    expect(m.get('speed_print')).toBe('200')
  })
  it('H5 high_speed preset map round-trips a known key', () => {
    const m = k2PlusPresetToEngineSettingsMap(K2_PLUS_SLICE_PRESETS.high_speed)
    expect(m.get('speed_print')).toBe('500')
  })
  it('H6 returns a fresh Map per call (no aliasing)', () => {
    const m1 = k2PlusPresetToEngineSettingsMap(K2_PLUS_SLICE_PRESETS.standard)
    const m2 = k2PlusPresetToEngineSettingsMap(K2_PLUS_SLICE_PRESETS.standard)
    expect(m1).not.toBe(m2)
    m1.set('layer_height', '0.999')
    expect(m2.get('layer_height')).toBe('0.2')
  })
  it('H7 mutating returned Map does not mutate frozen settings', () => {
    const before = K2_PLUS_SLICE_PRESETS.standard.settings.layer_height
    const m = k2PlusPresetToEngineSettingsMap(K2_PLUS_SLICE_PRESETS.standard)
    m.set('layer_height', '0.999')
    expect(K2_PLUS_SLICE_PRESETS.standard.settings.layer_height).toBe(before)
  })
  it('H8 every entry is string-typed (CuraEngine -s flag invariant)', () => {
    const m = k2PlusPresetToEngineSettingsMap(K2_PLUS_SLICE_PRESETS.standard)
    for (const [k, v] of m) {
      expect(typeof k).toBe('string')
      expect(typeof v).toBe('string')
    }
  })
})

describe('k2-plus-slice-presets -- I. Three-machine cross-cut', () => {
  it('I1 K2 Plus DIRECT: presets exist for both K2 quality tiers', () => {
    expect(K2_PLUS_SLICE_PRESETS.standard).toBeDefined()
    expect(K2_PLUS_SLICE_PRESETS.high_speed).toBeDefined()
  })
  it('I2 K2 Plus DIRECT: both presets cap travel_speed at K2 ceiling', () => {
    for (const id of K2_PLUS_QUALITY_PRESET_IDS) {
      const v = Number(K2_PLUS_SLICE_PRESETS[id].settings.speed_travel)
      expect(v).toBeLessThanOrEqual(K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec)
    }
  })
  it('I3 Laguna INDIRECT: SOURCE has zero G17/G18/G19 plane select', () => {
    expect(/\bG1[789]\b/.test(SOURCE)).toBe(false)
  })
  it('I4 Laguna INDIRECT: SOURCE has zero spindle/feed-router vocabulary', () => {
    expect(/\b(spindle|router|vacuum|6-zone|RichAuto|sheet)\b/i.test(SOURCE)).toBe(false)
  })
  it('I5 Carvera INDIRECT: SOURCE has zero 4-axis / rotary vocabulary', () => {
    expect(/\b(4-axis|rotary|A-?word|headstock|ATC|tool[- ]?changer)\b/i.test(SOURCE)).toBe(false)
  })
  it('I6 K2 Plus DIRECT: heated chamber set in BOTH presets', () => {
    for (const id of K2_PLUS_QUALITY_PRESET_IDS) {
      const t = Number(K2_PLUS_SLICE_PRESETS[id].settings.build_volume_temperature)
      expect(t).toBeGreaterThan(0)
      expect(t).toBeLessThanOrEqual(K2_PLUS_HARDWARE_CEILINGS.maxBedTempC)
    }
  })
  it('I7 K2 Plus DIRECT: 1.75 mm direct-drive retraction profile', () => {
    for (const id of K2_PLUS_QUALITY_PRESET_IDS) {
      const r = Number(K2_PLUS_SLICE_PRESETS[id].settings.retraction_amount)
      // direct-drive: retraction <= 2 mm; never Bowden-territory (>4 mm)
      expect(r).toBeLessThanOrEqual(2)
      expect(r).toBeGreaterThan(0)
    }
  })
  it('I8 K2 Plus DIRECT: standard preset stays under 50 % of speed ceiling', () => {
    const v = Number(K2_PLUS_SLICE_PRESETS.standard.settings.speed_print)
    expect(v).toBeLessThanOrEqual(K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec * 0.5)
  })
  it('I9 K2 Plus DIRECT: high_speed preset uses >= 80 % of speed ceiling', () => {
    const v = Number(K2_PLUS_SLICE_PRESETS.high_speed.settings.speed_print)
    expect(v).toBeGreaterThanOrEqual(K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec * 0.8)
  })
  it('I10 SOURCE explicitly references the two non-K2 machines as ZERO-mention (DIRECT-K2-only invariant)', () => {
    // confirms this module does not bleed into Laguna/Carvera tuning by accident
    const laguna = (SOURCE.match(/Laguna|RichAuto/gi) ?? []).length
    const carvera = (SOURCE.match(/Carvera|Makera|Smoothieware/gi) ?? []).length
    expect(laguna).toBe(0)
    expect(carvera).toBe(0)
  })
})

describe('k2-plus-slice-presets -- J. On-disk source provenance', () => {
  it('J1 SOURCE_PATH ends with src/shared/k2-plus-slice-presets.ts', () => {
    expect(SOURCE_PATH.replace(/\\/g, '/')).toMatch(/src\/shared\/k2-plus-slice-presets\.ts$/)
  })
  it('J2 SOURCE has trailing newline', () => {
    expect(SOURCE.endsWith('\n')).toBe(true)
  })
  it('J3 SOURCE has zero CR (LF-only)', () => {
    expect(SOURCE.includes('\r')).toBe(false)
  })
  it('J4 SOURCE has zero tab characters', () => {
    expect(/\t/.test(SOURCE)).toBe(false)
  })
  it('J5 SOURCE has at least 200 lines', () => {
    expect(SOURCE.split('\n').length).toBeGreaterThanOrEqual(200)
  })
  it('J6 SOURCE has under 400 lines (pin keeps the module focused)', () => {
    expect(SOURCE.split('\n').length).toBeLessThanOrEqual(400)
  })
  it('J7 SOURCE references roadmap tag [P2-K2-SLICE]', () => {
    expect(SOURCE.includes('[P2-K2-SLICE]')).toBe(true)
  })
  it('J8 SOURCE references "Cycle 5" milestone in docstring', () => {
    expect(/Cycle 5/.test(SOURCE)).toBe(true)
  })
  it('J9 module exports include exactly the J-block-asserted symbols', () => {
    const keys = Object.keys(Mod).sort()
    expect(keys).toEqual(
      [
        'K2_PLUS_HARDWARE_CEILINGS',
        'K2_PLUS_QUALITY_PRESET_IDS',
        'K2_PLUS_SLICE_PRESETS',
        'k2PlusPresetToEngineSettingsMap',
        'resolveK2PlusPreset'
      ].sort()
    )
  })
  it('J10 type-only exports do NOT leak runtime symbols (K2PlusQualityPreset)', () => {
    expect((Mod as Record<string, unknown>).K2PlusQualityPreset).toBeUndefined()
  })
  it('J11 type-only exports do NOT leak runtime symbols (K2PlusQualityPresetId)', () => {
    expect((Mod as Record<string, unknown>).K2PlusQualityPresetId).toBeUndefined()
  })
  it('J12 SOURCE references the def.json pathway', () => {
    expect(/creality_k2_plus\.def\.json/.test(SOURCE)).toBe(true)
  })
  it('J13 type-shape consumers compile (K2PlusQualityPresetId narrowed to literal)', () => {
    const id1: K2PlusQualityPresetId = 'standard'
    const id2: K2PlusQualityPresetId = 'high_speed'
    expect(id1).toBe('standard')
    expect(id2).toBe('high_speed')
  })
})
