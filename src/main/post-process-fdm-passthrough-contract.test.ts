/**
 * Creality K2 Plus -- `resources/posts/fdm_passthrough.hbs` paired-pin
 * template-structure contract test [ID-0204].
 *
 * This file is the structural-contract companion to the existing
 * `post-process-k2-capabilities.test.ts` (which pins ONLY the four
 * [ID-0092] capability header lines + Safety Rule 2 byte-identical
 * baseline). The k2-capabilities file does NOT pin: ruler-line scaffolding,
 * the WorkTrack3D banner / Machine identity / Work-volume line ordering,
 * the operationLabel optional emission, the disclaimer block content,
 * the toolpath verbatim contract for the empty-toolpath edge case, the
 * footer banner + end-marker line, the Safety-Rule-1 PostContext-leak
 * prevention surface (no spindle/coolant/WCS/ATC/cutter-comp leaks even
 * when `renderPost` is called with rich opts that populate `PostContext`),
 * and the source-text pin proving the .hbs template references ONLY the
 * whitelisted PostContext fields.
 *
 * Why a separate file: the k2-capabilities file is scoped narrowly to the
 * [ID-0092] capability-header invariants. Splicing this template-structure
 * + Safety-Rule-1-leak surface into it would inflate it past 500 lines and
 * mix two distinct concerns. Mirrors the cam-axis4 paired-pin convention
 * established in Cycles 119-126 (each module gets a sibling `-contract`
 * file pinning the broader contract surface left unpinned by the original).
 *
 * Safety posture:
 *   - Safety Rule 1 (G-code is sacred): the (I) describe block proves NO
 *     M-codes / non-toolpath G-codes leak through fdm_passthrough.hbs even
 *     when `renderPost` opts populate spindle / WCS / tool / dust-collection
 *     / cutter-comp fields (which the FDM template MUST IGNORE so the
 *     OrcaSlicer-emitted toolpath is the source of truth -- per the
 *     template's own `; This is a passthrough` disclaimer block).
 *   - Safety Rule 2 (no churn for existing saved projects): the structural
 *     pins assert exact-byte landmarks for the bundled K2 Plus profile so
 *     any future template edit that drifts the passthrough output is caught
 *     here, not when an operator's saved project re-renders to mismatched
 *     output.
 *
 * Roadmap: [ID-0204] (post-processing rotation slot, Cycle 127).
 * Companions: `post-process-k2-capabilities.test.ts` ([ID-0092]),
 * `post-process-end-program-invariants.test.ts`,
 * `post-process-header-invariants.test.ts`,
 * `post-process-safe-z-retract-invariants.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const TEMPLATE_PATH = join(RESOURCES_ROOT, 'posts', 'fdm_passthrough.hbs')
const TEMPLATE_SOURCE = readFileSync(TEMPLATE_PATH, 'utf-8')

function loadK2(): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', 'creality-k2-plus.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

// Bare FDM profile: NONE of the [ID-0092] capability fields set, so the
// header structure can be inspected without the four optional capability
// lines getting in the way.
function bareFdm(): MachineProfile {
  return machineProfileSchema.parse({
    id: 'bare-fdm',
    name: 'Bare FDM',
    kind: 'fdm',
    workAreaMm: { x: 220, y: 220, z: 250 },
    maxFeedMmMin: 6000,
    postTemplate: 'fdm_passthrough.hbs',
    dialect: 'generic_mm'
  })
}

// Representative passthrough toolpath body.
const SAMPLE_TOOLPATH: ReadonlyArray<string> = [
  'G21',
  'G90',
  'G0 X0 Y0 Z5',
  'G1 F1800',
  'G1 Z0.2'
] as const

// The ruler line emitted by the template at four landmark positions.
const RULER = '; ' + '-'.repeat(75)

describe('fdm_passthrough.hbs paired-pin contract [ID-0204]', () => {
  // ------------------------------------------------------------------
  // (A) Header banner ruler-line structure
  // ------------------------------------------------------------------
  describe('(A) ruler-line scaffolding', () => {
    it('emits the canonical ruler line `; ` + 75 hyphens at exactly four landmark positions', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      const ruler = '; ' + '-'.repeat(75)
      const lines = gcode.split('\n')
      const rulerCount = lines.filter((l) => l === ruler).length
      expect(rulerCount).toBe(4)
    })

    it('the ruler line is exactly 77 characters (`; ` + 75 hyphens; no trailing whitespace)', () => {
      expect(RULER.length).toBe(77)
      expect(RULER.startsWith('; ')).toBe(true)
      expect(RULER.endsWith('-')).toBe(true)
      expect(RULER.split('-').length - 1).toBe(75)
    })

    it('the four ruler positions split the output into exactly four banner brackets (header / disclaimer / toolpath / footer)', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      const lines = gcode.split('\n')
      const rulerIdx = lines
        .map((l, i) => (l === RULER ? i : -1))
        .filter((i) => i >= 0)
      expect(rulerIdx).toHaveLength(4)
      // Header banner above ruler[0], disclaimer between [1]..[2], toolpath
      // between [2]..[3]. Each ruler must come in strictly ascending order.
      for (let i = 1; i < rulerIdx.length; i++) {
        expect(rulerIdx[i]).toBeGreaterThan(rulerIdx[i - 1]!)
      }
    })
  })

  // ------------------------------------------------------------------
  // (B) Machine identity line
  // ------------------------------------------------------------------
  describe('(B) machine identity line', () => {
    it('emits `; Machine: <name> (<id>)` with both name and id from the MachineProfile', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      expect(gcode).toContain(`; Machine: ${machine.name} (${machine.id})`)
    })

    it('bundled K2 Plus profile renders with its shipping name and id', async () => {
      const machine = loadK2()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      expect(gcode).toContain(`; Machine: ${machine.name} (${machine.id})`)
      // Cross-check the shipping K2 fields are what the template will substitute.
      expect(machine.id).toBe('creality-k2-plus')
      expect(machine.kind).toBe('fdm')
    })

    it('Machine line appears strictly between the header ruler[0] and the work-volume line', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      const lines = gcode.split('\n')
      const rulerIdx = lines.findIndex((l) => l === RULER)
      const machineIdx = lines.findIndex((l) =>
        l.startsWith(`; Machine: ${machine.name}`)
      )
      const workVolumeIdx = lines.findIndex((l) => l.startsWith('; Work volume (mm):'))
      expect(rulerIdx).toBeGreaterThanOrEqual(0)
      expect(machineIdx).toBeGreaterThan(rulerIdx)
      expect(workVolumeIdx).toBeGreaterThan(machineIdx)
    })
  })

  // ------------------------------------------------------------------
  // (C) operationLabel optional emission and ordering
  // ------------------------------------------------------------------
  describe('(C) operationLabel optional emission', () => {
    it('absent operationLabel: NO `; Operation:` line in the output', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      expect(gcode).not.toMatch(/^; Operation:/m)
    })

    it('present operationLabel: emits exactly one `; Operation: <label>` line', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH], {
        operationLabel: 'Print PLA tensile bar v3'
      })
      const matches = gcode.match(/^; Operation: Print PLA tensile bar v3$/gm) ?? []
      expect(matches).toHaveLength(1)
    })

    it('Operation line lands strictly between the Machine line and the Work-volume line', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH], {
        operationLabel: 'op-label'
      })
      const lines = gcode.split('\n')
      const machineIdx = lines.findIndex((l) => l.startsWith('; Machine: '))
      const opIdx = lines.findIndex((l) => l === '; Operation: op-label')
      const wvIdx = lines.findIndex((l) => l.startsWith('; Work volume (mm):'))
      expect(machineIdx).toBeGreaterThanOrEqual(0)
      expect(opIdx).toBe(machineIdx + 1)
      expect(wvIdx).toBe(opIdx + 1)
    })

    it('empty-string operationLabel is treated as absent (Handlebars `{{#if}}` falsy)', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH], {
        operationLabel: ''
      })
      expect(gcode).not.toMatch(/^; Operation:/m)
    })
  })

  // ------------------------------------------------------------------
  // (D) Work-volume line format
  // ------------------------------------------------------------------
  describe('(D) work-volume line', () => {
    it('emits `; Work volume (mm): X x Y x Z` with the MachineProfile.workAreaMm fields', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      const expected = `; Work volume (mm): ${machine.workAreaMm.x} x ${machine.workAreaMm.y} x ${machine.workAreaMm.z}`
      expect(gcode).toContain(expected)
    })

    it('K2 Plus shipping profile renders 350 x 350 x 350 (Safety Rule 1 anti-crash bedsize check)', async () => {
      const machine = loadK2()
      // Cross-check the K2 [ID-0006] bedsize-fix landmarks: workArea must
      // match the verified 350x350x350 build envelope (defends against the
      // Cycle 1 / Cycle 0 scenario where a 500x500x500 default would have
      // crashed the gantry ~150 mm past hard stops).
      expect(machine.workAreaMm.x).toBe(350)
      expect(machine.workAreaMm.y).toBe(350)
      expect(machine.workAreaMm.z).toBe(350)
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      expect(gcode).toContain('; Work volume (mm): 350 x 350 x 350')
    })

    it('non-square build volume renders as `<x> x <y> x <z>` in workArea field order', async () => {
      const machine = machineProfileSchema.parse({
        id: 'rect-fdm',
        name: 'Rect FDM',
        kind: 'fdm',
        workAreaMm: { x: 200, y: 220, z: 250 },
        maxFeedMmMin: 6000,
        postTemplate: 'fdm_passthrough.hbs',
        dialect: 'generic_mm'
      })
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      expect(gcode).toContain('; Work volume (mm): 200 x 220 x 250')
    })
  })

  // ------------------------------------------------------------------
  // (E) [ID-0092] capability cross-link
  // ------------------------------------------------------------------
  describe('(E) [ID-0092] capability-header cross-link', () => {
    it('the capability-header block lives between the work-volume line and the disclaimer ruler (companion to k2-capabilities.test.ts)', async () => {
      const machine = loadK2()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      const lines = gcode.split('\n')
      const wvIdx = lines.findIndex((l) => l.startsWith('; Work volume (mm):'))
      const presetsIdx = lines.findIndex((l) => l.startsWith('; Input shaping presets:'))
      const rulerIndices = lines
        .map((l, i) => (l === RULER ? i : -1))
        .filter((i) => i >= 0)
      // First ruler tops the header; second ruler starts the disclaimer.
      expect(rulerIndices.length).toBeGreaterThanOrEqual(2)
      const headerRuler = rulerIndices[0]!
      const disclaimerRuler = rulerIndices[1]!
      expect(presetsIdx).toBeGreaterThan(wvIdx)
      expect(presetsIdx).toBeGreaterThan(headerRuler)
      expect(presetsIdx).toBeLessThan(disclaimerRuler)
    })

    it('source-text pin: template references the four [ID-0092] capability fields by name', () => {
      // Companion contract -- the per-line emission semantics live in
      // post-process-k2-capabilities.test.ts; this pin only proves the
      // field-name surface has not been silently dropped.
      expect(TEMPLATE_SOURCE).toContain('inputShapingPresets')
      expect(TEMPLATE_SOURCE).toContain('rfidFilamentSupport')
      expect(TEMPLATE_SOURCE).toContain('cfsMultiColorEnabled')
      expect(TEMPLATE_SOURCE).toContain('powerLossRecovery')
    })
  })

  // ------------------------------------------------------------------
  // (F) Disclaimer block
  // ------------------------------------------------------------------
  describe('(F) disclaimer block', () => {
    it('emits all three disclaimer comment lines verbatim and in template-source order', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      expect(gcode).toContain(
        '; This is a passthrough — slicing is performed by OrcaSlicer and the resulting'
      )
      expect(gcode).toContain('; G-code is the source of truth. Verify start/end macros, bed/nozzle temps,')
      expect(gcode).toContain('; and home/park sequences match your Creality Klipper firmware before printing.')
    })

    it('disclaimer lines appear strictly between the second and third ruler lines', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      const lines = gcode.split('\n')
      const rulerIndices = lines
        .map((l, i) => (l === RULER ? i : -1))
        .filter((i) => i >= 0)
      const passIdx = lines.findIndex((l) => l.startsWith('; This is a passthrough'))
      const truthIdx = lines.findIndex((l) => l.startsWith('; G-code is the source of truth'))
      const homeIdx = lines.findIndex((l) => l.startsWith('; and home/park sequences'))
      expect(rulerIndices.length).toBe(4)
      const r1 = rulerIndices[1]!
      const r2 = rulerIndices[2]!
      expect(passIdx).toBe(r1 + 1)
      expect(truthIdx).toBe(r1 + 2)
      expect(homeIdx).toBe(r1 + 3)
      expect(homeIdx).toBeLessThan(r2)
    })

    it('disclaimer block names OrcaSlicer, bed/nozzle temps, and home/park sequences (audit-trail content pin)', () => {
      // Source-text pin keeps the disclaimer's substantive operator-safety
      // claims locked. Post-2026-05-27 pivot the slicer is OrcaSlicer (not the
      // deleted CuraEngine bundle); if any future edit weakens or removes the
      // "OrcaSlicer is the source of truth" phrasing, the pin trips.
      expect(TEMPLATE_SOURCE).toContain('OrcaSlicer')
      expect(TEMPLATE_SOURCE).toContain('bed/nozzle temps')
      expect(TEMPLATE_SOURCE).toContain('home/park sequences')
      expect(TEMPLATE_SOURCE).toContain('Creality Klipper firmware')
      // The deleted CuraEngine bundle must NOT be referenced in the template.
      expect(TEMPLATE_SOURCE).not.toContain('CuraEngine')
    })

    it('disclaimer block has exactly 3 disclaimer comment lines (no creep)', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      const lines = gcode.split('\n')
      const rulerIndices = lines
        .map((l, i) => (l === RULER ? i : -1))
        .filter((i) => i >= 0)
      const r1 = rulerIndices[1]!
      const r2 = rulerIndices[2]!
      expect(r2 - r1 - 1).toBe(3)
    })
  })

  // ------------------------------------------------------------------
  // (G) Toolpath verbatim emission
  // ------------------------------------------------------------------
  describe('(G) toolpath verbatim emission', () => {
    it('emits every toolpath line in the SAME order as the input array, no comment prefix added', async () => {
      const machine = bareFdm()
      const tp = ['G21', 'G90', 'G0 X10 Y20 Z5.5', 'G1 F1500 X10 Y20 Z0.3']
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, tp)
      const lines = gcode.split('\n')
      const startIdx = lines.findIndex((l) => l === tp[0])
      // Subsequent toolpath lines must appear in the SAME relative order.
      for (let i = 0; i < tp.length; i++) {
        expect(lines[startIdx + i]).toBe(tp[i]!)
      }
    })

    it('empty toolpath array still emits the four-ruler scaffolding (header + disclaimer + footer)', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [])
      const lines = gcode.split('\n')
      const rulerCount = lines.filter((l) => l === RULER).length
      expect(rulerCount).toBe(4)
      expect(gcode).toContain(`; Machine: ${machine.name} (${machine.id})`)
      expect(gcode).toContain('; End of WorkTrack3D passthrough output')
      // No actual G-code lines between the third and fourth rulers.
      const rulerIdx = lines
        .map((l, i) => (l === RULER ? i : -1))
        .filter((i) => i >= 0)
      const r2 = rulerIdx[2]!
      const r3 = rulerIdx[3]!
      // Allow zero or only blank lines between the third ruler (above
      // toolpath) and the fourth ruler (below toolpath) when toolpath is
      // empty. NOT enforcing zero-blank-lines because Handlebars `{{#each}}`
      // emits a blank for the empty body.
      const between = lines.slice(r2 + 1, r3)
      const nonBlank = between.filter((l) => l.trim() !== '')
      expect(nonBlank).toHaveLength(0)
    })

    it('toolpath line containing a `;` comment is emitted verbatim (not double-commented)', async () => {
      const machine = bareFdm()
      // A Cura-emitted comment line should pass through unchanged.
      const tp = ['; LAYER:0', 'G1 F1800 X10']
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, tp)
      const lines = gcode.split('\n')
      const layerIdx = lines.indexOf('; LAYER:0')
      expect(layerIdx).toBeGreaterThan(0)
      // Must NOT appear with double-comment prefix `;; LAYER:0`.
      expect(lines).not.toContain(';; LAYER:0')
    })

    it('toolpath line with embedded G-code that LOOKS like a milling command is still emitted verbatim (no template post-filtering)', async () => {
      const machine = bareFdm()
      // Even if Cura ever emitted M3 / G54 (it should not), the passthrough
      // template MUST forward whatever the upstream slicer emitted. The
      // Safety Rule 1 contract here is "do not mutate", not "veto upstream".
      const tp = ['G54', 'M3 S1000', 'G1 X1 Y1']
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, tp)
      expect(gcode).toContain('G54')
      expect(gcode).toContain('M3 S1000')
      expect(gcode).toContain('G1 X1 Y1')
    })
  })

  // ------------------------------------------------------------------
  // (H) Footer banner + end-marker
  // ------------------------------------------------------------------
  describe('(H) footer banner', () => {
    it('emits `; End of WorkTrack3D passthrough output` as the LAST non-blank line', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      const lines = gcode.split('\n').filter((l) => l !== '')
      expect(lines[lines.length - 1]).toBe('; End of WorkTrack3D passthrough output')
    })

    it('the fourth ruler line directly precedes the end-marker line', async () => {
      const machine = bareFdm()
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, [...SAMPLE_TOOLPATH])
      const lines = gcode.split('\n')
      const rulerIdx = lines
        .map((l, i) => (l === RULER ? i : -1))
        .filter((i) => i >= 0)
      const r3 = rulerIdx[3]!
      expect(lines[r3 + 1]).toBe('; End of WorkTrack3D passthrough output')
    })
  })

  // ------------------------------------------------------------------
  // (I) Safety Rule 1 -- PostContext-leak prevention
  // ------------------------------------------------------------------
  describe('(I) Safety Rule 1 -- PostContext leak prevention', () => {
    // Helper: given `gcode`, count occurrences of any line outside the
    // toolpath body that match a "milling code" regex. The disclaimer
    // text contains `M-codes` and `firmware` words but NEVER bare
    // M-or-G-code tokens, so this regex is safe.
    function findLeakingCodes(gcode: string, toolpath: ReadonlyArray<string>): string[] {
      const tpSet = new Set(toolpath)
      const leaks: string[] = []
      for (const raw of gcode.split('\n')) {
        const line = raw.trim()
        if (line === '') continue
        if (tpSet.has(raw)) continue
        if (line.startsWith(';')) continue // any comment is allowed
        // Bare code tokens that should NEVER appear outside the toolpath:
        //   M3 / M4 / M5  spindle on/off
        //   M6            tool change
        //   M7 / M8 / M9  coolant / dust collection
        //   M30           program end
        //   G0 / G1       motion
        //   G2 / G3       arcs
        //   G17/G18/G19   plane select
        //   G20/G21       units
        //   G40/G41/G42   cutter comp
        //   G43           tool length comp
        //   G54..G59      WCS
        //   G90/G91       absolute / relative
        //   G93/G94       feed mode
        //   T<n>          tool select
        if (/^(M[0-9]+|G[0-9]+|T[0-9]+)\b/.test(line)) {
          leaks.push(raw)
        }
      }
      return leaks
    }

    it('opts.workCoordinateIndex DOES NOT add G54..G59 to the FDM passthrough output', async () => {
      const machine = bareFdm()
      const tp = [...SAMPLE_TOOLPATH]
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, tp, {
        workCoordinateIndex: 1
      })
      expect(gcode).not.toMatch(/^G5[4-9]\b/m)
      expect(findLeakingCodes(gcode, tp)).toHaveLength(0)
    })

    it('opts.spindleRpm DOES NOT add M3/M5 to the FDM passthrough output', async () => {
      const machine = bareFdm()
      const tp = [...SAMPLE_TOOLPATH]
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, tp, {
        spindleRpm: 12000
      })
      expect(gcode).not.toMatch(/^M3\b/m)
      expect(gcode).not.toMatch(/^M5\b/m)
      expect(findLeakingCodes(gcode, tp)).toHaveLength(0)
    })

    it('opts.toolNumber DOES NOT add T<n> M6 to the FDM passthrough output', async () => {
      const machine = bareFdm()
      const tp = [...SAMPLE_TOOLPATH]
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, tp, { toolNumber: 3 })
      expect(gcode).not.toMatch(/^T\d+\b/m)
      expect(gcode).not.toMatch(/^M6\b/m)
      expect(findLeakingCodes(gcode, tp)).toHaveLength(0)
    })

    it('opts.dustCollection DOES NOT add M7/M9 to the FDM passthrough output', async () => {
      const machine = bareFdm()
      const tp = [...SAMPLE_TOOLPATH]
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, tp, {
        dustCollection: true
      })
      expect(gcode).not.toMatch(/^M7\b/m)
      expect(gcode).not.toMatch(/^M9\b/m)
      expect(findLeakingCodes(gcode, tp)).toHaveLength(0)
    })

    it('opts.cutterCompensation = "left" with an M-code-only toolpath emits ZERO G41/G42/G40 (template + transform short-circuit)', async () => {
      const machine = bareFdm()
      // The cutter-compensation transform inserts G41/G40 around the FIRST
      // and LAST G-feed move (regex `^G0?[123]\b` per `applyCutterCompensation`).
      // To pin the TEMPLATE-LEVEL leak contract independent of that
      // upstream transform, we pass a toolpath that contains NO G-feed
      // moves -- pure M-codes + comments + an `;` line. The transform
      // then short-circuits (`firstFeedIdx === -1` -> `return lines`),
      // so any G41/G42/G40 in the rendered output would have to come
      // from the FDM template itself. The template MUST emit none.
      const tp = ['M104 S200', '; LAYER:0', 'M82']
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, tp, {
        cutterCompensation: 'left'
      })
      // No G41/G40/G42 lines anywhere in the output.
      expect(gcode).not.toMatch(/^G40\b/m)
      expect(gcode).not.toMatch(/^G41\b/m)
      expect(gcode).not.toMatch(/^G42\b/m)
      // Toolpath body still emitted verbatim (Safety Rule 1: passthrough).
      expect(gcode).toContain('M104 S200')
      expect(gcode).toContain('; LAYER:0')
      expect(gcode).toContain('M82')
    })

    it('all opts fields populated simultaneously: zero leaks beyond comment lines and the user-supplied toolpath', async () => {
      const machine = bareFdm()
      const tp = [...SAMPLE_TOOLPATH]
      const { gcode } = await renderPost(RESOURCES_ROOT, machine, tp, {
        workCoordinateIndex: 1,
        spindleRpm: 12000,
        toolNumber: 3,
        dustCollection: true,
        cutterCompensation: 'none', // 'left'/'right' would mutate tp; pin template-side leaks only
        operationLabel: 'leak-test'
      })
      const leaks = findLeakingCodes(gcode, tp)
      expect(leaks).toEqual([])
    })
  })

  // ------------------------------------------------------------------
  // (J) Template source-text pin
  // ------------------------------------------------------------------
  describe('(J) template source-text pin', () => {
    it('template does NOT reference any spindle / WCS / units / tool-comp / probing PostContext fields', () => {
      // Whitelist is enforced negatively: prove the template never
      // references the milling-only PostContext fields. If a future
      // edit wires `{{spindleOn}}` or `{{wcsLine}}` into the FDM post,
      // this pin trips and forces a Safety Rule 1 review.
      const banned = [
        '{{spindleOn}}',
        '{{spindleOff}}',
        '{{units}}',
        '{{wcsLine}}',
        '{{spindleWarning}}',
        '{{toolNumber}}',
        '{{toolWearOffsetH}}',
        '{{toolWearOffsetD}}',
        '{{cutterCompensation}}',
        '{{cutterCompDRegister}}',
        '{{dustCollection}}',
        '{{carveraProbingBlock}}',
        '{{{carveraProbingBlock}}}',
        '{{inverseTimeFeed}}',
        '{{enableSubroutines}}',
        '{{subroutineDialect}}',
        '{{enableArcFitting}}'
      ]
      for (const token of banned) {
        expect(TEMPLATE_SOURCE).not.toContain(token)
      }
    })

    it('template references ONLY the whitelisted context fields (machine, operationLabel, capability flags, toolpathLines)', () => {
      // Positive whitelist: every `{{...}}` substitution in the template
      // body (excluding the comment-block top-of-file documentation)
      // must reference one of the allowed names.
      // Strip the {{!-- ... --}} doc block first.
      const body = TEMPLATE_SOURCE.replace(/\{\{!--[\s\S]*?--\}\}/g, '')
      const refs = Array.from(body.matchAll(/\{\{[#\/\^]?\s*([a-zA-Z@][\w.]*)/g)).map(
        (m) => m[1]!
      )
      const whitelist = new Set([
        'if',
        'unless',
        'each',
        'this',
        '@last',
        'machine.name',
        'machine.id',
        'machine.workAreaMm.x',
        'machine.workAreaMm.y',
        'machine.workAreaMm.z',
        'machine.inputShapingPresets',
        'machine.rfidFilamentSupport',
        'machine.cfsMultiColorEnabled',
        'machine.powerLossRecovery',
        'operationLabel',
        'toolpathLines'
      ])
      const offenders = refs.filter((r) => !whitelist.has(r))
      expect(offenders).toEqual([])
    })

    it('every non-blank, non-substitution line in the template body starts with `;` (comment-only emission contract)', () => {
      // Strip the top-of-file documentation block, then split on lines.
      const body = TEMPLATE_SOURCE.replace(/\{\{!--[\s\S]*?--\}\}/g, '')
      const lines = body.split('\n')
      for (const raw of lines) {
        const line = raw.trim()
        if (line === '') continue
        if (line.startsWith('{{')) continue
        // The only non-comment substitution-bearing lines start with `{{#`
        // or `{{/` block tags or with the `; ` prefix. After stripping the
        // doc block, the non-block-tag remainder must lead with `;` OR be
        // a `{{this}}` line that emits the toolpath verbatim (which we
        // explicitly exempt because the upstream slicer is responsible for
        // the contents of that line, not the template).
        if (line === '{{this}}') continue
        expect(line.startsWith(';')).toBe(true)
      }
    })

    it('top-of-file documentation block names the [ID-0092] capability header and the Safety-Rule-2 byte-identical contract', () => {
      // Ensure the template's own self-documentation tracks the roadmap.
      expect(TEMPLATE_SOURCE).toContain('[ID-0092]')
      expect(TEMPLATE_SOURCE).toContain('Safety Rule 2')
      expect(TEMPLATE_SOURCE).toContain('byte-identical')
    })
  })
})
