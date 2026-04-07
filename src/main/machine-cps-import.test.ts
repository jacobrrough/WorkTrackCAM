import { describe, expect, it } from 'vitest'
import { machineProfileFromCpsContent, machineProfileWithSummaryFromCps, tryExtractCpsLabel } from './machine-cps-import'

describe('tryExtractCpsLabel', () => {
  it('prefers first line // comment', () => {
    expect(tryExtractCpsLabel('// Plasma table\nother')).toBe('Plasma table')
  })

  it('reads description = double-quoted', () => {
    expect(tryExtractCpsLabel('description = "My vendor post";\n')).toBe('My vendor post')
  })

  it('reads description = single-quoted', () => {
    expect(tryExtractCpsLabel("description = 'Laser head';\n")).toBe('Laser head')
  })
})

describe('machineProfileFromCpsContent', () => {
  const sampleCps = `// Grbl-style export
description = "Bench mill wrapper";
vendor = "custom";
function onOpen() {}
`

  it('builds stub profile with id from filename', () => {
    const m = machineProfileFromCpsContent('bench_mill.cps', sampleCps)
    expect(m.id).toBe('bench_mill')
    expect(m.kind).toBe('cnc')
    expect(m.dialect).toBe('grbl')
    expect(m.postTemplate).toBe('cnc_generic_mm.hbs')
    expect(m.workAreaMm).toEqual({ x: 300, y: 300, z: 120 })
    expect(m.meta?.importedFromCps).toBe(true)
    expect(m.meta?.cpsOriginalBasename).toBe('bench_mill.cps')
  })

  it('uses first // line for name when present', () => {
    const m = machineProfileFromCpsContent('ignored_name.cps', sampleCps)
    expect(m.name).toBe('Grbl-style export')
  })

  it('uses title from basename when no label in file', () => {
    const m = machineProfileFromCpsContent('haas_vf2.cps', 'var x = 1;\n')
    expect(m.name).toBe('Haas Vf2')
  })

  it('uses fallback id when basename has no alphanumeric', () => {
    const m = machineProfileFromCpsContent('@@@.cps', '')
    expect(m.id).toMatch(/^cps_import_\d+$/)
  })
})

describe('machineProfileWithSummaryFromCps', () => {
  it('returns profile and detected flags for a basic CPS file', () => {
    const cps = `// Bench router post\ndescription = "Bench router";\nfunction onOpen() {}`
    const { profile, detected } = machineProfileWithSummaryFromCps('bench_router.cps', cps)
    expect(profile.kind).toBe('cnc')
    expect(profile.id).toBe('bench_router')
    // Label extracted from // comment → name detected
    expect(detected.name).toBe(true)
    // No work area pattern → not detected
    expect(detected.workArea).toBe(false)
    // No feedrate → not detected
    expect(detected.maxFeed).toBe(false)
    // No 4-axis keywords → axisCount flag false
    expect(detected.axisCount).toBe(false)
  })

  it('detects work area from xAxisMaximum/yAxisMaximum/zAxisMaximum declarations', () => {
    const cps = [
      '// Vertical mill',
      'var xAxisMaximum = 600;',
      'var yAxisMaximum = 400;',
      'var zAxisMaximum = 200;'
    ].join('\n')
    const { profile, detected } = machineProfileWithSummaryFromCps('vmill.cps', cps)
    expect(detected.workArea).toBe(true)
    expect(profile.workAreaMm).toEqual({ x: 600, y: 400, z: 200 })
  })

  it('detects maxFeed from maximumFeedrate declaration', () => {
    const cps = 'maximumFeedrate = 8000;\nfunction onOpen() {}'
    const { profile, detected } = machineProfileWithSummaryFromCps('fast_mill.cps', cps)
    expect(detected.maxFeed).toBe(true)
    expect(profile.maxFeedMmMin).toBe(8000)
  })

  it('detects 4-axis from aOutput keyword and sets axisCount flag', () => {
    const cps = 'var aOutput = createVariable({}, xyzFormat);\nfunction onOpen() {}'
    const { profile, detected } = machineProfileWithSummaryFromCps('rotary.cps', cps)
    expect(detected.axisCount).toBe(true)
    expect(profile.axisCount).toBe(4)
  })

  it('reports spindleMax when maximumSpindleSpeed is present', () => {
    const cps = 'maximumSpindleSpeed = 24000;\nfunction onOpen() {}'
    const { detected } = machineProfileWithSummaryFromCps('spindle_mill.cps', cps)
    expect(detected.spindleMax).toBe(24000)
  })

  it('spindleMax is undefined when not declared in CPS', () => {
    const { detected } = machineProfileWithSummaryFromCps('plain.cps', 'function onOpen() {}')
    expect(detected.spindleMax).toBeUndefined()
  })

  it('detects dialect from file name — fanuc sets generic_mm', () => {
    const cps = '// Fanuc post\nfunction onOpen() {}'
    const { profile, detected } = machineProfileWithSummaryFromCps('fanuc_post.cps', cps)
    expect(profile.dialect).toBe('generic_mm')
    expect(detected.dialect).toBe(true)
  })

  it('detects fanuc_4axis when Fanuc keywords + aOutput present', () => {
    const cps = '// Fanuc 4-axis post\nvar aOutput = createVariable({}, xyzFormat);\nfunction onOpen() {}'
    const { profile } = machineProfileWithSummaryFromCps('fanuc_rotary.cps', cps)
    expect(profile.dialect).toBe('fanuc_4axis')
    expect(profile.axisCount).toBe(4)
    expect(profile.postTemplate).toBe('cnc_4axis_fanuc.hbs')
  })

  it('detects mach3_4axis when Mach3 keywords + aOutput present', () => {
    const cps = '// Mach3 4-axis router\nvar aOutput = createVariable({}, xyzFormat);\nfunction onOpen() {}'
    const { profile } = machineProfileWithSummaryFromCps('mach3_rotary.cps', cps)
    expect(profile.dialect).toBe('mach3_4axis')
    expect(profile.axisCount).toBe(4)
    expect(profile.postTemplate).toBe('cnc_4axis_mach3.hbs')
  })

  it('detects mach3 (not mach3_4axis) when Mach3 keywords but no 4-axis', () => {
    const cps = '// Mach3 router post\nfunction onOpen() {}'
    const { profile } = machineProfileWithSummaryFromCps('mach3_3axis.cps', cps)
    expect(profile.dialect).toBe('mach3')
  })

  it('detects siemens_4axis when Siemens/Sinumerik keywords + aOutput present', () => {
    const cps = '// Sinumerik 4-axis post\nvar aOutput = createVariable({}, xyzFormat);\nfunction onOpen() {}'
    const { profile } = machineProfileWithSummaryFromCps('siemens_rotary.cps', cps)
    expect(profile.dialect).toBe('siemens_4axis')
    expect(profile.axisCount).toBe(4)
    expect(profile.postTemplate).toBe('cnc_4axis_siemens.hbs')
  })

  it('detects siemens (not siemens_4axis) when Siemens keywords but no 4-axis', () => {
    const cps = '// Siemens Sinumerik post\nfunction onOpen() {}'
    const { profile } = machineProfileWithSummaryFromCps('siemens_3axis.cps', cps)
    expect(profile.dialect).toBe('siemens')
  })

  it('detects heidenhain_4axis when Heidenhain keywords + aOutput present', () => {
    const cps = '// Heidenhain TNC post\nvar aOutput = createVariable({}, xyzFormat);\nfunction onOpen() {}'
    const { profile } = machineProfileWithSummaryFromCps('heidenhain_rotary.cps', cps)
    expect(profile.dialect).toBe('heidenhain_4axis')
    expect(profile.axisCount).toBe(4)
    expect(profile.postTemplate).toBe('cnc_4axis_heidenhain.hbs')
  })

  it('detects heidenhain (not heidenhain_4axis) when Heidenhain keywords but no 4-axis', () => {
    const cps = '// Heidenhain TNC post\nfunction onOpen() {}'
    const { profile } = machineProfileWithSummaryFromCps('heidenhain_3axis.cps', cps)
    expect(profile.dialect).toBe('heidenhain')
  })

  it('detected.name is false when CPS has no comment or description', () => {
    const { detected } = machineProfileWithSummaryFromCps('no_name.cps', 'var x = 1;')
    expect(detected.name).toBe(false)
  })
})
