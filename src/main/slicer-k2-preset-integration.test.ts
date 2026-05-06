/**
 * Integration test for the K2 Plus quality preset wiring into
 * `resolveCuraSliceArgv` (Phase 2 [P2-K2-SLICE]/Cycle 5).
 *
 * Cycle 5 added a `k2QualityPresetId` field to `SliceRequest`. When set AND
 * `curaEngineSettings` is empty/unset, the preset's settings are used as
 * the BASE map for the engine -- replacing the generic 'balanced' / 'draft'
 * / 'fine' baseline. The precedence chain (lowest -> highest) is now:
 *
 *   1. Generic `slicePreset` baseline (CURA_SLICE_PRESETS)
 *   2. K2 quality preset (`k2QualityPresetId`)
 *   3. Explicit `curaEngineSettings`
 *   4. `machineCapabilities` always merges UNDER 1-3 (never overrides).
 *
 * This pin nails down each of those four points so a future refactor can\'t
 * silently flip the precedence and change which G-code lands on Jacob\'s
 * K2 Plus.
 */
import { describe, expect, it } from 'vitest'
import { resolveCuraSliceArgv } from './slicer'
import {
  K2_PLUS_SLICE_PRESETS,
  type K2PlusQualityPresetId
} from '../shared/k2-plus-slice-presets'

const RESOURCES_ROOT = '/fake/resources'
const BASE_REQ = {
  inputStlPath: '/tmp/in.stl',
  outputGcodePath: '/tmp/out.gcode'
}

function flagValue(argv: string[], key: string): string | undefined {
  // CuraEngine flags are passed as `-s` `key=value` pairs.
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === '-s' && argv[i + 1].startsWith(key + '=')) {
      return argv[i + 1].slice(key.length + 1)
    }
  }
  return undefined
}

describe('K2 preset integration -- argv shape', () => {
  it('with no preset and no settings, defaults flow through', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, BASE_REQ)
    // CURA_SLICE_CLI_DEFAULTS layer_height = 0.2, line_width = 0.4
    expect(flagValue(argv, 'layer_height')).toBe('0.2')
    expect(flagValue(argv, 'line_width')).toBe('0.4')
  })
  it('with k2 standard preset, K2-tuned settings flow through', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      k2QualityPresetId: 'standard'
    })
    expect(flagValue(argv, 'speed_print')).toBe('200')
    expect(flagValue(argv, 'acceleration_print')).toBe('5000')
    expect(flagValue(argv, 'jerk_print')).toBe('8')
    expect(flagValue(argv, 'build_volume_temperature')).toBe('35')
  })
  it('with k2 high_speed preset, K2-tuned settings flow through', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      k2QualityPresetId: 'high_speed'
    })
    expect(flagValue(argv, 'speed_print')).toBe('500')
    expect(flagValue(argv, 'speed_travel')).toBe('600')
    expect(flagValue(argv, 'acceleration_print')).toBe('25000')
    expect(flagValue(argv, 'jerk_print')).toBe('9')
    expect(flagValue(argv, 'material_print_temperature')).toBe('230')
    expect(flagValue(argv, 'build_volume_temperature')).toBe('40')
  })
})

describe('K2 preset integration -- precedence', () => {
  it('curaEngineSettings explicit OVERRIDES the K2 preset values', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      k2QualityPresetId: 'high_speed',
      curaEngineSettings: { material_print_temperature: '250' }
    })
    expect(flagValue(argv, 'material_print_temperature')).toBe('250')
    // K2 preset provides base; explicit overrides layer on top
    expect(flagValue(argv, 'speed_print')).toBe('500')
  })
  it('K2 preset OVERRIDES the generic slicePreset', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      slicePreset: 'fine',
      k2QualityPresetId: 'standard'
    })
    // 'fine' generic preset: layer_height 0.12. K2 standard: layer_height 0.2.
    // K2 wins.
    expect(flagValue(argv, 'layer_height')).toBe('0.2')
  })
  it('machineCapabilities merge UNDER the K2 preset', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      k2QualityPresetId: 'high_speed',
      machineCapabilities: {
        maxNozzleTempC: 350,
        maxBedTempC: 120,
        chamberTempC: 60
      }
    })
    // High-speed preset sets material_print_temperature = 230. The capability
    // merge layers UNDER, so the preset value remains.
    expect(flagValue(argv, 'material_print_temperature')).toBe('230')
  })
  it('with both preset AND empty curaEngineSettings, preset still wins', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      k2QualityPresetId: 'standard',
      curaEngineSettings: {}
    })
    expect(flagValue(argv, 'speed_print')).toBe('200')
  })
  it('an unknown k2QualityPresetId falls back to the generic baseline', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      // Cast escape hatch: simulate a stale persisted project file with
      // an unknown preset id (e.g. a future "ludicrous" preset that this
      // build doesn\'t know about). resolver returns undefined; the
      // baseline kicks in.
      k2QualityPresetId: 'ludicrous_speed' as unknown as K2PlusQualityPresetId
    })
    expect(flagValue(argv, 'layer_height')).toBe('0.2') // generic default
    expect(flagValue(argv, 'speed_print')).toBeUndefined() // K2 preset NOT used
  })
})

describe('K2 preset integration -- argv hygiene', () => {
  it('argv begins with `slice -v -j <defPath>`', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      k2QualityPresetId: 'standard'
    })
    expect(argv[0]).toBe('slice')
    expect(argv[1]).toBe('-v')
    expect(argv[2]).toBe('-j')
  })
  it('argv ends with `-l <stl> -o <gcode>`', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      k2QualityPresetId: 'high_speed'
    })
    const lIdx = argv.lastIndexOf('-l')
    const oIdx = argv.lastIndexOf('-o')
    expect(argv[lIdx + 1]).toBe('/tmp/in.stl')
    expect(argv[oIdx + 1]).toBe('/tmp/out.gcode')
  })
  it('every -s flag is followed by a key=value pair (no orphan flags)', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      k2QualityPresetId: 'high_speed'
    })
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '-s') {
        expect(i + 1).toBeLessThan(argv.length)
        expect(argv[i + 1]).toMatch(/^[a-z][a-z_0-9]*=.+$/)
      }
    }
  })
  it('K2 preset emits all 41 required keys as -s flags', () => {
    const argv = resolveCuraSliceArgv(RESOURCES_ROOT, {
      ...BASE_REQ,
      k2QualityPresetId: 'standard'
    })
    const sFlagCount = argv.filter((s) => s === '-s').length
    expect(sFlagCount).toBe(Object.keys(K2_PLUS_SLICE_PRESETS.standard.settings).length)
  })
})
