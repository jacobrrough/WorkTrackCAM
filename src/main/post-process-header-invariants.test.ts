// [ID-0018] Integration tests: the three target machines' real post templates
// must satisfy every universal header invariant when rendered end-to-end via
// renderPost(). A regression here means a post template was edited in a way
// that dropped G21 / G90 / G17 / G54, which would ship as a pipeline warning
// and surface in operator-facing output instead of shipping broken G-code.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import {
  headerInvariantModeForMachine,
  validateGcodeHeaderInvariants
} from '../shared/gcode-header-invariants'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

async function loadMachine(filename: string): Promise<MachineProfile> {
  const raw = await readFile(join(resourcesRoot, 'machines', filename), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(raw))
}

const sampleToolpath = ['G0 X10 Y10', 'G1 Z-2.000 F200', 'G1 X50 Y30 F800', 'G0 Z10.000']

// resolveWorkOffsetLine: index in [1..6] maps to G54..G59.
const WCS_G54_INDEX = 1

describe('[ID-0018] renderPost -- three-machine header invariants', () => {
  it('Laguna Swift 5x10 (vcarve_mach3.hbs) emits zero header-invariant issues', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const headerIssues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(headerIssues).toEqual([])
    expect(warnings.filter(w => /^\[HEADER_/.test(w))).toEqual([])
  })

  it('Makera Carvera 3-axis (carvera_3axis.hbs) emits zero header-invariant issues', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const headerIssues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(headerIssues).toEqual([])
    expect(warnings.filter(w => /^\[HEADER_/.test(w))).toEqual([])
  })

  it('Makera Carvera 4-axis (carvera_4axis.hbs) emits zero header-invariant issues', async () => {
    const machine = await loadMachine('makera-carvera-4axis.json')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const headerIssues = validateGcodeHeaderInvariants(gcode, 'cnc')
    expect(headerIssues).toEqual([])
    expect(warnings.filter(w => /^\[HEADER_/.test(w))).toEqual([])
  })

  it('Creality K2 Plus (fdm_passthrough.hbs) short-circuits as fdm mode', async () => {
    // K2 Plus is kind=fdm -- the validator skips every header check because
    // slicer-generated G-code + Klipper firmware defaults handle unit/mode
    // invariants differently than a CNC dialect. We still assert that the
    // mode resolver chose 'fdm' and that the validator returns an empty
    // array regardless of the rendered content.
    const machine = await loadMachine('creality-k2-plus.json')
    expect(headerInvariantModeForMachine(machine)).toBe('fdm')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const mode = headerInvariantModeForMachine(machine)
    const headerIssues = validateGcodeHeaderInvariants(gcode, mode)
    expect(headerIssues).toEqual([])
    expect(warnings.filter(w => /^\[HEADER_/.test(w))).toEqual([])
  })

  it('workCoordinateIndex omitted on a CNC post surfaces HEADER_NO_WCS as a warning', async () => {
    // WCS posture: the real post templates default the WCS line to G54 when no
    // workCoordinateIndex is supplied (the header is NEVER WCS-implicit), so the
    // emitted G-code carries G54. The validator's scan-for-missing-WCS therefore
    // cannot fire -- the HEADER_NO_WCS *nudge* is re-based in renderPost on the
    // MISSING explicit index: it MUST still surface as a warning (not an error)
    // so the operator is reminded to confirm fixture zero against the default.
    const machine = await loadMachine('laguna-swift-5x10.json')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    // The safe default IS present in the output...
    expect(gcode).toMatch(/^G54\b/m)
    // ...and the verify nudge still fires exactly once.
    const wcsWarnings = warnings.filter(w => /^\[HEADER_NO_WCS\]/.test(w))
    expect(wcsWarnings.length).toBe(1)
    // The reworked message conveys the safe default + the verify ask.
    expect(wcsWarnings[0]).toMatch(/defaulted to.*G54/i)
    expect(wcsWarnings[0]).toMatch(/verify/i)
    // Sanity: no HEADER_NO_UNITS / HEADER_NO_ABSOLUTE_MODE / HEADER_NO_PLANE_SELECT
    // -- the template still emits G21 / G90 / G17.
    const errorWarnings = warnings.filter(w =>
      /^\[HEADER_NO_(UNITS|ABSOLUTE_MODE|PLANE_SELECT)\]/.test(w)
    )
    expect(errorWarnings).toEqual([])
  })

  it('a deliberate workCoordinateIndex suppresses the HEADER_NO_WCS nudge', async () => {
    // The flip side of the rework: when the operator DID select a work offset
    // (a valid 1..6 index), the verify nudge must NOT fire -- the choice was
    // explicit. The emitted G-code still carries the selected WCS line.
    const machine = await loadMachine('laguna-swift-5x10.json')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    expect(gcode).toMatch(/^G54\b/m)
    expect(warnings.filter(w => /^\[HEADER_NO_WCS\]/.test(w))).toEqual([])
  })

  it('header warnings carry a first-motion-line anchor in the message', async () => {
    // Pin the warning-string shape so downstream renderers / operator
    // toasts can parse "(first motion line N)" reliably.
    const machine = await loadMachine('laguna-swift-5x10.json')
    const { warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const wcsWarning = warnings.find(w => /^\[HEADER_NO_WCS\]/.test(w))
    expect(wcsWarning).toBeDefined()
    expect(wcsWarning).toMatch(/\(first motion line \d+\)$/)
  })
})
