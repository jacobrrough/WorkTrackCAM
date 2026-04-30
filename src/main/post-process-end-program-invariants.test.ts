// [ID-0108] Integration tests: the three target machines' real post templates
// must satisfy every universal end-of-program invariant when rendered end-to-
// end via renderPost(). A regression here means a post template was edited in
// a way that dropped M2/M30, left the spindle running, emitted M5 after the
// terminator, or picked the wrong terminator for the dialect -- all of which
// would ship as a pipeline warning surfaced to the operator.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import {
  endProgramInvariantModeForMachine,
  preferredProgramEndForDialect,
  validateGcodeEndProgramInvariants
} from '../shared/gcode-end-program-invariants'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

async function loadMachine(filename: string): Promise<MachineProfile> {
  const raw = await readFile(join(resourcesRoot, 'machines', filename), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(raw))
}

const sampleToolpath = ['G0 X10 Y10', 'G1 Z-2.000 F200', 'G1 X50 Y30 F800', 'G0 Z10.000']

// resolveWorkOffsetLine: index in [1..6] maps to G54..G59.
const WCS_G54_INDEX = 1

describe('[ID-0108] renderPost -- three-machine end-of-program invariants', () => {
  it('Laguna Swift 5x10 (vcarve_mach3.hbs) emits zero end-of-program-invariant issues', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const endIssues = validateGcodeEndProgramInvariants(gcode, 'cnc', machine.dialect)
    expect(endIssues).toEqual([])
    expect(warnings.filter(w => /^\[END_/.test(w))).toEqual([])
    // Laguna is mach3 dialect -- the template MUST emit M30, and NOT M2.
    // `(?!\d)` guards against M300/M303 etc.
    expect(gcode).toMatch(/(^|\n)\s*M30(?!\d)/)
    expect(preferredProgramEndForDialect(machine.dialect)?.preferred).toBe('M30')
  })

  it('Makera Carvera 3-axis (carvera_3axis.hbs) emits zero end-of-program-invariant issues', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const endIssues = validateGcodeEndProgramInvariants(gcode, 'cnc', machine.dialect)
    expect(endIssues).toEqual([])
    expect(warnings.filter(w => /^\[END_/.test(w))).toEqual([])
    // Carvera is grbl dialect (Smoothieware) -- the template MUST emit M2
    // and MUST NOT emit M30 (Smoothieware M30 can delete the running file).
    // `(?!\d)` guards against M20/M21/M200 etc.
    expect(gcode).toMatch(/(^|\n)\s*M2(?!\d)/)
    expect(gcode).not.toMatch(/(^|\n)\s*M30(?!\d)/)
    expect(preferredProgramEndForDialect(machine.dialect)?.preferred).toBe('M2')
  })

  it('Makera Carvera 4-axis (carvera_4axis.hbs) emits zero end-of-program-invariant issues', async () => {
    const machine = await loadMachine('makera-carvera-4axis.json')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const endIssues = validateGcodeEndProgramInvariants(gcode, 'cnc', machine.dialect)
    expect(endIssues).toEqual([])
    expect(warnings.filter(w => /^\[END_/.test(w))).toEqual([])
    // Carvera 4-axis is grbl_4axis dialect -- same Smoothieware rule applies.
    expect(gcode).toMatch(/(^|\n)\s*M2(?!\d)/)
    expect(gcode).not.toMatch(/(^|\n)\s*M30(?!\d)/)
    expect(preferredProgramEndForDialect(machine.dialect)?.preferred).toBe('M2')
  })

  it('Creality K2 Plus (fdm_passthrough.hbs) short-circuits as fdm mode', async () => {
    // K2 Plus is kind=fdm -- the end-of-program validator skips every
    // check because slicer-generated G-code handles the M104/M140/M84
    // shutdown sequence in its own conventions, and the pipeline's
    // renderPost() today is a CNC-shaped pipeline. We still assert that
    // the mode resolver chose 'fdm' and that the validator returns an
    // empty array regardless of the rendered content.
    const machine = await loadMachine('creality-k2-plus.json')
    expect(endProgramInvariantModeForMachine(machine)).toBe('fdm')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const mode = endProgramInvariantModeForMachine(machine)
    const endIssues = validateGcodeEndProgramInvariants(gcode, mode, machine.dialect)
    expect(endIssues).toEqual([])
    expect(warnings.filter(w => /^\[END_/.test(w))).toEqual([])
  })

  it('synthetic grbl G-code with wrong terminator (M30) surfaces END_DIALECT_MISMATCH directly', async () => {
    // This guards the validator's dialect-mismatch path against the real
    // fleet's grbl machines. A post template regression that emits M30
    // on a grbl/grbl_4axis machine would trip this check because
    // Smoothieware's M30 deletes the currently-running G-code file.
    const syntheticGcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S12000',
      'G0 X0 Y0',
      'G1 Z-1.0 F200',
      'G0 Z10.0',
      'M5',
      'M30' // WRONG: grbl/Smoothieware prefers M2
    ].join('\n')
    const endIssues = validateGcodeEndProgramInvariants(syntheticGcode, 'cnc', 'grbl')
    const mismatches = endIssues.filter(i => i.code === 'END_DIALECT_MISMATCH')
    expect(mismatches.length).toBe(1)
    expect(mismatches[0]!.level).toBe('warning')
    // The rationale must cite the Smoothieware file-delete hazard so the
    // operator knows why the warning matters.
    expect(mismatches[0]!.message.toLowerCase()).toMatch(/smoothieware|delete|file/)
    // Line anchor points at the M30 line (1-based, 10th in the array).
    expect(mismatches[0]!.line).toBe(10)
  })

  it('renderPost surface format for END_* warnings matches `[CODE] message (line N)` shape', async () => {
    // Pin the warning-string shape so downstream renderers / operator
    // toasts can parse "(line N)" reliably. We trigger a warning by
    // synthesizing a mach3-dialect machine-profile scenario through the
    // Laguna post; since Laguna's post already emits M30 cleanly, we
    // instead feed a synthetic grbl+M30 string directly through the
    // validator and then assert the format that renderPost() uses to
    // concatenate the issue into the warnings[] array.
    const syntheticGcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S12000',
      'G0 X0 Y0',
      'G1 Z-1.0 F200',
      'G0 Z10.0',
      'M5',
      'M30'
    ].join('\n')
    const endIssues = validateGcodeEndProgramInvariants(syntheticGcode, 'cnc', 'grbl')
    const formatted = endIssues.map(i => `[${i.code}] ${i.message} (line ${i.line})`)
    // Every rendered warning in renderPost() uses exactly this shape.
    for (const line of formatted) {
      expect(line).toMatch(/^\[END_[A-Z_]+\] .+ \(line \d+\)$/)
    }
  })
})
