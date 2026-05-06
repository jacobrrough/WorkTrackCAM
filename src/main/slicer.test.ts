import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURA_SLICE_PRESETS } from '../shared/cura-slice-defaults'
import {
  buildCuraSliceArgs,
  buildCuraSliceArgsFromSettingsMap,
  resolveCuraSliceArgv
} from './slicer'

describe('buildCuraSliceArgs (K2 / CuraEngine)', () => {
  it('includes slice, definition json, and model paths', () => {
    const root = join('C:', 'app', 'resources')
    const args = buildCuraSliceArgs(root, {
      inputStlPath: 'C:\\job\\assets\\cube.stl',
      outputGcodePath: 'C:\\job\\out.gcode'
    })
    expect(args[0]).toBe('slice')
    expect(args).toContain('-j')
    expect(args).toContain(join(root, 'slicer', 'creality_k2_plus.def.json'))
    expect(args).toContain('-l')
    expect(args).toContain('C:\\job\\assets\\cube.stl')
    expect(args).toContain('-o')
    expect(args).toContain('C:\\job\\out.gcode')
    expect(args).toContain('layer_height=0.2')
    expect(args).toContain('line_width=0.4')
    expect(args).toContain('wall_line_count=2')
    expect(args).toContain('infill_sparse_density=15')
  })

  it('accepts a preset param bundle (draft)', () => {
    const root = join('C:', 'app', 'resources')
    const args = buildCuraSliceArgs(
      root,
      {
        inputStlPath: 'C:\\job\\assets\\cube.stl',
        outputGcodePath: 'C:\\job\\out.gcode'
      },
      CURA_SLICE_PRESETS.draft
    )
    expect(args).toContain(`layer_height=${CURA_SLICE_PRESETS.draft.layerHeightMm}`)
    expect(args).toContain(`wall_line_count=${CURA_SLICE_PRESETS.draft.wallLineCount}`)
    expect(args).toContain(`infill_sparse_density=${CURA_SLICE_PRESETS.draft.infillSparseDensity}`)
  })

  it('buildCuraSliceArgsFromSettingsMap preserves custom keys', () => {
    const root = join('C:', 'app', 'resources')
    const map = new Map<string, string>([
      ['layer_height', '0.15'],
      ['infill_pattern', 'grid']
    ])
    const args = buildCuraSliceArgsFromSettingsMap(
      root,
      {
        inputStlPath: 'C:\\job\\assets\\cube.stl',
        outputGcodePath: 'C:\\job\\out.gcode'
      },
      map
    )
    expect(args).toContain('layer_height=0.15')
    expect(args).toContain('infill_pattern=grid')
  })
})

// ----------------------------------------------------------------------------
// Roadmap [ID-0068] -- machineCapabilities threaded into the Cura argv
// ----------------------------------------------------------------------------
describe('resolveCuraSliceArgv -- K2 FDM capability ceilings [ID-0068]', () => {
  const ROOT = join('C:', 'app', 'resources')
  const commonReq = {
    curaEnginePath: 'CuraEngine',
    inputStlPath: 'C:\\job\\cube.stl',
    outputGcodePath: 'C:\\job\\out.gcode'
  } as const

  it('emits machine_nozzle_temp_max, machine_max_bed_temp, build_volume_temperature for the K2 Plus', () => {
    const argv = resolveCuraSliceArgv(ROOT, {
      ...commonReq,
      machineCapabilities: { maxNozzleTempC: 350, maxBedTempC: 120, chamberTempC: 60 }
    })
    expect(argv).toContain('machine_nozzle_temp_max=350')
    expect(argv).toContain('machine_max_bed_temp=120')
    expect(argv).toContain('build_volume_temperature=60')
    expect(argv).toContain('machine_heated_build_volume=true')
    // The usual preset defaults are still present when no override map is set.
    expect(argv).toContain('layer_height=0.2')
  })

  it('behaves byte-identically to buildCuraSliceArgs when no machine capabilities are supplied', () => {
    const argvA = resolveCuraSliceArgv(ROOT, commonReq)
    const argvB = buildCuraSliceArgs(ROOT, commonReq)
    expect(argvA).toEqual(argvB)
  })

  it('does not emit a chamber flag when chamberTempC is absent (unheated chambers stay off)', () => {
    const argv = resolveCuraSliceArgv(ROOT, {
      ...commonReq,
      machineCapabilities: { maxNozzleTempC: 260, maxBedTempC: 100 }
    })
    expect(argv).not.toContain('machine_heated_build_volume=true')
    expect(argv.some((a) => a.startsWith('build_volume_temperature='))).toBe(false)
    expect(argv).toContain('machine_nozzle_temp_max=260')
  })

  it('lets an explicit curaEngineSettings override win over the capability ceiling', () => {
    const argv = resolveCuraSliceArgv(ROOT, {
      ...commonReq,
      machineCapabilities: { maxNozzleTempC: 350 },
      curaEngineSettings: { machine_nozzle_temp_max: '380', infill_pattern: 'grid' }
    })
    expect(argv).toContain('machine_nozzle_temp_max=380')
    expect(argv).not.toContain('machine_nozzle_temp_max=350')
    expect(argv).toContain('infill_pattern=grid')
  })

  it('matches the bundled K2 Plus machine profile end-to-end', () => {
    // Cross-check against resources/machines/creality-k2-plus.json so that
    // a drift in the ship values drops this test.
    type K2Meta = {
      maxNozzleTempC?: number
      maxBedTempC?: number
      chamberTempC?: number
    }
    const k2 = JSON.parse(
      readFileSync(
        join(process.cwd(), 'resources', 'machines', 'creality-k2-plus.json'),
        'utf-8'
      )
    ) as K2Meta
    const argv = resolveCuraSliceArgv(ROOT, {
      ...commonReq,
      machineCapabilities: k2
    })
    expect(argv).toContain(`machine_nozzle_temp_max=${k2.maxNozzleTempC}`)
    expect(argv).toContain(`machine_max_bed_temp=${k2.maxBedTempC}`)
    expect(argv).toContain(`build_volume_temperature=${k2.chamberTempC}`)
    expect(argv).toContain('machine_heated_build_volume=true')
  })
})
