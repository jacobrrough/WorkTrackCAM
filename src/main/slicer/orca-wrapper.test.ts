import { describe, it, expect } from 'vitest'
import { buildOrcaArgs, resolveOrcaInstall, type OrcaSliceConfig } from './orca-wrapper'

const baseConfig: OrcaSliceConfig = {
  inputPath: '/jobs/widget.stl',
  outputGcodePath: '/jobs/widget.gcode',
  machineProfileIni: '/profiles/k2-plus-machine.ini',
  processProfileIni: '/profiles/standard-process.ini',
  filamentProfileIni: '/profiles/pla-filament.ini',
}

describe('buildOrcaArgs', () => {
  it('emits --load × 3 + --output + -g in the documented order', () => {
    const args = buildOrcaArgs(baseConfig)
    expect(args).toEqual([
      '--load',
      '/profiles/k2-plus-machine.ini',
      '--load',
      '/profiles/standard-process.ini',
      '--load',
      '/profiles/pla-filament.ini',
      '--output',
      '/jobs/widget.gcode',
      '-g',
      '/jobs/widget.stl',
    ])
  })

  it('threads numeric overrides as --set key=value pairs before --output', () => {
    const args = buildOrcaArgs({
      ...baseConfig,
      overrides: { nozzle_temperature: 220, layer_height: 0.2 },
    })
    const setIdx = args.indexOf('--set')
    const outputIdx = args.indexOf('--output')
    expect(setIdx).toBeGreaterThan(0)
    expect(outputIdx).toBeGreaterThan(setIdx)
    expect(args).toContain('nozzle_temperature=220')
    expect(args).toContain('layer_height=0.2')
  })

  it('threads string overrides as --set key=value pairs', () => {
    const args = buildOrcaArgs({
      ...baseConfig,
      overrides: { wall_pattern: 'monotonic' },
    })
    expect(args).toContain('wall_pattern=monotonic')
  })

  it('preserves the order: machine → process → filament for the three --load args', () => {
    const args = buildOrcaArgs(baseConfig)
    const loadValues = args
      .map((a, i) => (a === '--load' ? args[i + 1] : null))
      .filter((v): v is string => v !== null)
    expect(loadValues).toEqual([
      '/profiles/k2-plus-machine.ini',
      '/profiles/standard-process.ini',
      '/profiles/pla-filament.ini',
    ])
  })

  it('omits --set when no overrides supplied', () => {
    const args = buildOrcaArgs(baseConfig)
    expect(args).not.toContain('--set')
  })

  it('places the input mesh argument last (after -g)', () => {
    const args = buildOrcaArgs(baseConfig)
    expect(args[args.length - 2]).toBe('-g')
    expect(args[args.length - 1]).toBe('/jobs/widget.stl')
  })
})

describe('resolveOrcaInstall', () => {
  it('throws a descriptive error when the binary is not bundled', () => {
    // resources/orca-slicer/ does not exist in dev — the test asserts the
    // promise that the wrapper surfaces a clear error rather than a cryptic
    // ENOENT from spawn.
    expect(() => resolveOrcaInstall('/nonexistent/app/root')).toThrow(
      /OrcaSlicer binary not bundled/,
    )
  })
})
