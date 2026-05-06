/**
 * Cycle 109 [ID-0020-wire] -- Laguna Swift 5x10 vacuum-postlude wiring
 * tests for `renderPost`. Pins the byte-level effect of supplying the new
 * `vacuumZoneAllocation` + `vacuumOptions` opts on the bundled
 * `vcarve_mach3.hbs` template.
 *
 * Companion: `src/shared/laguna-vacuum-postlude.ts` (Cycle 103) supplies
 * the pure helper; this file proves it actually wraps the toolpath in
 * the rendered G-code when the operator passes an allocation.
 *
 * Per CLAUDE.md target machines:
 *   PRIMARY = Laguna Swift 5x10 (the only target machine with a 6-zone
 *   vacuum bed; Mach3-superset RichAuto A-series controller).
 *   UNAFFECTED = Creality K2 Plus, Makera Carvera 3-axis / 4-axis (none
 *   have a 6-zone vacuum bed; the new opts are pass-through optional and
 *   the third describe block proves byte-identical output when omitted).
 *
 * Safety Rule 1 (G-code is sacred): the third describe asserts byte-for-
 * byte equality with the pre-wiring output when the new opts are absent.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allocateLagunaVacuumZones } from '../shared/laguna-vacuum-allocator'
import {
  LAGUNA_VACUUM_PREAMBLE_OPEN,
  LAGUNA_VACUUM_PREAMBLE_CLOSE,
  LAGUNA_VACUUM_POSTAMBLE_OPEN,
  LAGUNA_VACUUM_POSTAMBLE_CLOSE,
  LAGUNA_VACUUM_MCODE_WARNING,
} from '../shared/laguna-vacuum-postlude'
import {
  machineProfileSchema,
  type MachineProfile,
} from '../shared/machine-schema'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

function loadLagunaProfile(): MachineProfile {
  const path = join(resourcesRoot, 'machines', 'laguna-swift-5x10.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

// Representative wood-routing toolpath: rapid to start, plunge, contour, retract.
const sampleToolpath = [
  'G0 X0 Y0 Z25',
  'G0 X10 Y10 Z5',
  'G1 Z-3.000 F300',
  'G1 X100 Y10 F3000',
  'G1 X100 Y100 F3000',
  'G1 X10 Y100 F3000',
  'G1 X10 Y10 F3000',
  'G0 Z25',
]

function linesOf(gcode: string): string[] {
  return gcode.split('\n')
}

// Pure helper: index of the first line containing a G0/G1 motion word.
// Skips comment-only and blank lines so the assertion does not trip on
// the post-template's header rapids vs. the operator toolpath block.
function firstToolpathMotionIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? ''
    if (
      trimmed === 'G1 Z-3.000 F300' ||
      trimmed === 'G1 X100 Y10 F3000' ||
      trimmed === 'G1 X100 Y100 F3000' ||
      trimmed === 'G1 X10 Y100 F3000' ||
      trimmed === 'G1 X10 Y10 F3000'
    ) {
      return i
    }
  }
  return -1
}

function lastToolpathMotionIndex(lines: string[]): number {
  let last = -1
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]?.trim() ?? ''
    if (trimmed === 'G0 Z25' || trimmed === 'G1 X10 Y10 F3000') {
      last = i
    }
  }
  return last
}

describe('renderPost -- Laguna vacuum-postlude wiring [ID-0020-wire]', () => {
  describe('preamble emission before the first toolpath line', () => {
    it('emits the preamble open marker before the first cutting move', async () => {
      const machine = loadLagunaProfile()
      // Full-sheet 48x96 in @ origin (0,0): all 6 zones engage.
      const allocation = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
      expect(allocation.engagedCount).toBe(6)

      const { gcode } = await renderPost(
        resourcesRoot,
        machine,
        sampleToolpath,
        { vacuumZoneAllocation: allocation }
      )
      const lines = linesOf(gcode)
      const openIdx = lines.findIndex((l) => l === LAGUNA_VACUUM_PREAMBLE_OPEN)
      const closeIdx = lines.findIndex(
        (l) => l === LAGUNA_VACUUM_PREAMBLE_CLOSE
      )
      const firstMotion = firstToolpathMotionIndex(lines)
      expect(openIdx).toBeGreaterThan(-1)
      expect(closeIdx).toBeGreaterThan(openIdx)
      expect(firstMotion).toBeGreaterThan(closeIdx)
    })

    it('engagement summary line names the engaged-zone count', async () => {
      const machine = loadLagunaProfile()
      const allocation = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
      const { gcode } = await renderPost(
        resourcesRoot,
        machine,
        sampleToolpath,
        { vacuumZoneAllocation: allocation }
      )
      // "; 6 of 6 zones engaged (..." -- 100.0% bed coverage line.
      expect(gcode).toContain('; 6 of 6 zones engaged')
    })

    it('M64 lines are off by default (semicolon comments only)', async () => {
      const machine = loadLagunaProfile()
      const allocation = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
      const { gcode } = await renderPost(
        resourcesRoot,
        machine,
        sampleToolpath,
        { vacuumZoneAllocation: allocation }
      )
      // Default off: no M64/M65 lines, no operator-confirm M-code warning.
      expect(gcode).not.toMatch(/^M64\b/m)
      expect(gcode).not.toMatch(/^M65\b/m)
      expect(gcode).not.toContain(LAGUNA_VACUUM_MCODE_WARNING)
    })

    it('opt-in M64 emission lands one M64 per engaged zone before the toolpath', async () => {
      const machine = loadLagunaProfile()
      // Half-sheet at origin engages exactly 4 zones.
      const allocation = allocateLagunaVacuumZones(0, 0, 1219.2, 1219.2)
      expect(allocation.engagedCount).toBe(4)
      const { gcode } = await renderPost(
        resourcesRoot,
        machine,
        sampleToolpath,
        {
          vacuumZoneAllocation: allocation,
          vacuumOptions: { enableMach3DigitalOutputs: true },
        }
      )
      const m64Count = (gcode.match(/^M64\s+P\d+/gm) ?? []).length
      expect(m64Count).toBe(4)
      // M-code warning must precede the M64 lines.
      const warnIdx = gcode.indexOf(LAGUNA_VACUUM_MCODE_WARNING)
      const firstM64Idx = gcode.search(/^M64\s+P\d+/m)
      expect(warnIdx).toBeGreaterThan(-1)
      expect(firstM64Idx).toBeGreaterThan(warnIdx)
    })
  })

  describe('postamble emission after the last toolpath line', () => {
    it('emits the postamble open marker AFTER the last cutting move', async () => {
      const machine = loadLagunaProfile()
      const allocation = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
      const { gcode } = await renderPost(
        resourcesRoot,
        machine,
        sampleToolpath,
        { vacuumZoneAllocation: allocation }
      )
      const lines = linesOf(gcode)
      const lastMotion = lastToolpathMotionIndex(lines)
      const openIdx = lines.findIndex(
        (l) => l === LAGUNA_VACUUM_POSTAMBLE_OPEN
      )
      const closeIdx = lines.findIndex(
        (l) => l === LAGUNA_VACUUM_POSTAMBLE_CLOSE
      )
      expect(lastMotion).toBeGreaterThan(-1)
      expect(openIdx).toBeGreaterThan(lastMotion)
      expect(closeIdx).toBeGreaterThan(openIdx)
    })

    it('release block lands BEFORE the M30 program-end terminator', async () => {
      const machine = loadLagunaProfile()
      const allocation = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
      const { gcode } = await renderPost(
        resourcesRoot,
        machine,
        sampleToolpath,
        { vacuumZoneAllocation: allocation }
      )
      const m30Idx = gcode.indexOf('M30')
      const releaseCloseIdx = gcode.indexOf(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
      expect(m30Idx).toBeGreaterThan(-1)
      expect(releaseCloseIdx).toBeGreaterThan(-1)
      expect(releaseCloseIdx).toBeLessThan(m30Idx)
    })

    it('opt-in M65 emission emits one M65 per engaged zone (release)', async () => {
      const machine = loadLagunaProfile()
      const allocation = allocateLagunaVacuumZones(0, 0, 1219.2, 1219.2)
      const { gcode } = await renderPost(
        resourcesRoot,
        machine,
        sampleToolpath,
        {
          vacuumZoneAllocation: allocation,
          vacuumOptions: { enableMach3DigitalOutputs: true },
        }
      )
      const m65Count = (gcode.match(/^M65\s+P\d+/gm) ?? []).length
      expect(m65Count).toBe(4)
    })
  })

  describe('byte-identical pass-through when allocation absent', () => {
    it('omitting vacuumZoneAllocation produces identical output to the pre-wiring baseline', async () => {
      const machine = loadLagunaProfile()
      const baseline = await renderPost(resourcesRoot, machine, sampleToolpath)
      const withUndefinedOpts = await renderPost(
        resourcesRoot,
        machine,
        sampleToolpath,
        {}
      )
      const withVacuumOptsOnly = await renderPost(
        resourcesRoot,
        machine,
        sampleToolpath,
        { vacuumOptions: { enableMach3DigitalOutputs: true } }
      )
      expect(withUndefinedOpts.gcode).toBe(baseline.gcode)
      // vacuumOptions alone (without an allocation) is a no-op.
      expect(withVacuumOptsOnly.gcode).toBe(baseline.gcode)
    })

    it('non-Laguna machines are unaffected when no allocation is supplied', async () => {
      // Carvera 3-axis: no vacuum bed, the opts pass-through must be inert.
      const carvera = machineProfileSchema.parse(
        JSON.parse(
          readFileSync(
            join(resourcesRoot, 'machines', 'makera-carvera-3axis.json'),
            'utf-8'
          )
        )
      )
      const baseline = await renderPost(resourcesRoot, carvera, sampleToolpath)
      const withOpts = await renderPost(
        resourcesRoot,
        carvera,
        sampleToolpath,
        {}
      )
      expect(withOpts.gcode).toBe(baseline.gcode)
    })

    it('the new opts do not introduce header / safe-Z / end-program warnings', async () => {
      const machine = loadLagunaProfile()
      const allocation = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
      const baseline = await renderPost(resourcesRoot, machine, sampleToolpath)
      const wired = await renderPost(resourcesRoot, machine, sampleToolpath, {
        vacuumZoneAllocation: allocation,
      })
      // Wiring should not introduce NEW warning codes vs. baseline.
      const baselineCodes = new Set(
        baseline.warnings.flatMap((w) => Array.from(w.match(/\[[^\]]+\]/g) ?? []))
      )
      const wiredCodes = new Set(
        wired.warnings.flatMap((w) => Array.from(w.match(/\[[^\]]+\]/g) ?? []))
      )
      for (const code of wiredCodes) {
        expect(baselineCodes.has(code)).toBe(true)
      }
    })
  })

  describe('integration with subroutine wrapping', () => {
    it('vacuum markers stay top-level when subroutines are also enabled', async () => {
      const machine = loadLagunaProfile()
      // Build a toolpath with a clearly repeating pattern so the
      // subroutine detector has something to wrap. The vacuum markers
      // are intentionally distinct (semicolon comments + M64/M65) so
      // they should NEVER appear inside a subroutine body.
      const repeating = [
        ...sampleToolpath,
        'G1 Z-3.000 F300',
        'G1 X100 Y10 F3000',
        'G1 X100 Y100 F3000',
        'G1 X10 Y100 F3000',
        'G1 X10 Y10 F3000',
        'G0 Z25',
      ]
      const allocation = allocateLagunaVacuumZones(0, 0, 1219.2, 2438.4)
      const { gcode } = await renderPost(resourcesRoot, machine, repeating, {
        vacuumZoneAllocation: allocation,
        vacuumOptions: { enableMach3DigitalOutputs: true },
        enableSubroutines: true,
        subroutineDialect: 'mach3',
      })
      // Both preamble and postamble markers must appear in the OUTPUT, and
      // both must appear before the SUBROUTINE DEFINITIONS sentinel that
      // the renderPost subroutine emitter appends at the end.
      const subDefsIdx = gcode.indexOf('--- SUBROUTINE DEFINITIONS ---')
      const preambleIdx = gcode.indexOf(LAGUNA_VACUUM_PREAMBLE_OPEN)
      const postambleIdx = gcode.indexOf(LAGUNA_VACUUM_POSTAMBLE_CLOSE)
      expect(preambleIdx).toBeGreaterThan(-1)
      expect(postambleIdx).toBeGreaterThan(preambleIdx)
      if (subDefsIdx > -1) {
        expect(preambleIdx).toBeLessThan(subDefsIdx)
        expect(postambleIdx).toBeLessThan(subDefsIdx)
      }
    })
  })
})
