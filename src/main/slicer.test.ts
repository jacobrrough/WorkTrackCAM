import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURA_SLICE_PRESETS } from '../shared/cura-slice-defaults'
import { buildCuraSliceArgs, buildCuraSliceArgsFromSettingsMap } from './slicer'

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
