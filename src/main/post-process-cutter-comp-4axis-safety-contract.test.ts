/**
 * [ID-0176] Cycle 90 -- post-processing safety contract.
 *
 * Pins the 4-axis rotary bypass contract on `applyCutterCompensation` in
 * `src/main/post-process.ts`. Cutter compensation (G41 / G42 / G40) is
 * XY-plane-only on every controller in CLAUDE.md "USER CONTEXT -- TARGET
 * MACHINES" scope (Mach3, RichAuto A-series, Smoothieware, Klipper).
 * Inserting G41 / G42 around a 4-axis toolpath that contains any rotary
 * axis word (A / B / C) yields controller rejection or unpredictable
 * diameter compensation while the rotary axis is moving -- a CLAUDE.md
 * "Safety Rule 1: G-code is sacred" violation for the **Makera Carvera +
 * 4th Axis Rotary** target machine.
 *
 * This file pins the safety contract via paired-pin tests (each invariant
 * asserted against BOTH the source-text JSDoc / comment AND the runtime
 * behaviour of `applyCutterCompensation()` -- doc-vs-code drift fails one
 * of the pair). Sister to Cycle 85 [ID-0173] which pinned the same bypass
 * pattern on `applyArcFitting`. Together [ID-0173] + [ID-0176] cover the
 * two XY-plane-only post-processor stages that previously consumed rotary
 * input silently.
 *
 * Companions in the post-processing safety-rail family:
 *   - Cycle 64 [ID-0007b-followup]: K2 Moonraker upload contract
 *   - Cycle 65 [ID-0156]: Carvera 4-axis post contract
 *   - Cycle 67 [ID-0157]: Carvera 3-axis post contract
 *   - Cycle 70 [ID-0154]: Laguna Swift post contract
 *   - Cycle 77 [ID-0165]: sequenceMultiToolJob multi-tool contract
 *   - Cycle 85 [ID-0173]: applyArcFitting 4-axis bypass
 *   - Cycle 90 [ID-0176] (THIS FILE): applyCutterCompensation 4-axis bypass
 *
 * Three machines covered (CLAUDE.md "USER CONTEXT -- TARGET MACHINES"):
 *   - **Makera Carvera + 4th Axis Rotary** -- primary target. The 4-axis
 *     post (`carvera_4axis.hbs`) emits A-word lines; cutter compensation
 *     on those would bracket a rotary stretch with G41 / G40 and trigger
 *     a Smoothieware "comp not allowed during rotary motion" rejection
 *     (or worse, silent comp-during-rotation on relaxed firmware).
 *   - **Laguna Swift 5x10** -- 3-axis only; cutter compensation still
 *     works on pure XYZ output (regression-checked via the fall-through
 *     tests below).
 *   - **Creality K2 Plus** -- FDM passthrough; never calls cutter
 *     compensation in practice (extruder kinematics, not router
 *     compensation), but the helper is shared.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyCutterCompensation, renderPost } from './post-process'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'

// --- Fixture loading ---------------------------------------------------------

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const POST_PROCESS_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'main', 'post-process.ts'),
  'utf-8'
)

function loadCarvera4Axis(): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', 'makera-carvera-4axis.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

// --- 1. A-axis (Carvera 4th Axis Rotary) bypass ------------------------------

describe('applyCutterCompensation -- [ID-0176] 4-axis A-axis bypass', () => {
  it('returns input unchanged when a single G1 line carries an A-word', () => {
    const lines = ['G0 X0 Y0 Z5', 'G1 X10 Y0 Z0 A45 F800']
    const out = applyCutterCompensation(lines, 'left')
    expect(out).toEqual(lines)
    // No G41 / G42 / G40 emitted anywhere.
    expect(out.some((l) => /^G4[012]/.test(l))).toBe(false)
    // Fresh array contract: caller-mutation must not mutate input.
    out.push('G1 X99 Y99 Z99')
    expect(lines.length).toBe(2)
  })

  it('returns full toolpath unchanged when even one A-word line is interspersed in an otherwise XY-only contour', () => {
    const lines = [
      'G0 X0 Y0 Z5',
      'G1 X10 Y0 Z0 F800',
      'G1 X10 Y10 Z0 A45 F800',
      'G1 X20 Y10 Z0 F800',
      'G1 X20 Y20 Z0 F800'
    ]
    const out = applyCutterCompensation(lines, 'right', 5)
    // Bypass: byte-identical pass-through (no G41 / G42 / G40 anywhere).
    expect(out).toEqual(lines)
    expect(out.some((l) => /^G4[012]/.test(l))).toBe(false)
  })

  it('triggers bypass on a negative A-value (A-30 from a CCW indexed segment)', () => {
    const lines = [
      'G0 X0 Y0 Z5',
      'G1 X10 Y0 Z0 F800',
      'G1 X10 Y0 Z0 A-30 F800'
    ]
    const out = applyCutterCompensation(lines, 'left')
    expect(out).toEqual(lines)
    expect(out.some((l) => /^G4[012]/.test(l))).toBe(false)
  })

  it('triggers bypass on a zero A-value (A0 emitted as the rotary anchor)', () => {
    // The Carvera 4-axis template often opens with G0 ... A0 to anchor the
    // rotary frame. That single A0 reference must be enough to disable
    // compensation insertion on the entire job.
    const lines = [
      'G0 X10 Y0 Z46 A0',
      'G1 X10 Y0 Z23 F600',
      'G1 X11 Y0 Z23 F600',
      'G1 X12 Y0 Z23 F600'
    ]
    const out = applyCutterCompensation(lines, 'right', 3)
    expect(out).toEqual(lines)
    expect(out.some((l) => /^G4[012]/.test(l))).toBe(false)
  })
})

// --- 2. B-axis and C-axis defensive coverage --------------------------------

describe('applyCutterCompensation -- [ID-0176] B-axis and C-axis defensive bypass', () => {
  it('triggers bypass on a B-word (5-axis tilt-axis common naming)', () => {
    const lines = [
      'G0 X0 Y0 Z5',
      'G1 X10 Y0 Z0 F800',
      'G1 X10 Y0 Z0 B30 F800',
      'G1 X20 Y0 Z0 F800'
    ]
    const out = applyCutterCompensation(lines, 'left')
    expect(out).toEqual(lines)
    expect(out.some((l) => /^G4[012]/.test(l))).toBe(false)
  })

  it('triggers bypass on a C-word (rotary table around Z naming)', () => {
    const lines = [
      'G0 X0 Y0 Z5',
      'G1 X10 Y0 Z0 F800',
      'G1 X10 Y0 Z0 C90 F800',
      'G1 X20 Y0 Z0 F800'
    ]
    const out = applyCutterCompensation(lines, 'right', 7)
    expect(out).toEqual(lines)
    expect(out.some((l) => /^G4[012]/.test(l))).toBe(false)
  })
})

// --- 3. 3-axis fall-through (no regression beyond [ID-0176]) ----------------

describe('applyCutterCompensation -- 3-axis fall-through (no regression beyond [ID-0176])', () => {
  it('pure XY contour still gets G41 inserted before first feed move', () => {
    const lines = [
      'G0 X0 Y0 Z5',
      'G1 X10 Y0 Z0 F800',
      'G1 X20 Y10 Z0 F800',
      'G1 X30 Y20 Z0 F800'
    ]
    const out = applyCutterCompensation(lines, 'left')
    expect(out).toContain('G41')
    expect(out).toContain('G40')
    // G41 lands strictly before the first G1.
    const g41Idx = out.indexOf('G41')
    const firstG1Idx = out.findIndex((l) => l.startsWith('G1'))
    expect(g41Idx).toBeGreaterThanOrEqual(0)
    expect(g41Idx).toBeLessThan(firstG1Idx)
  })

  it('pure XYZ contour with G2/G3 arcs still gets G42 inserted', () => {
    const lines = [
      'G0 X0 Y0 Z5',
      'G2 X10 Y10 Z0 I5 J0 F800',
      'G1 X20 Y10 Z0 F800'
    ]
    const out = applyCutterCompensation(lines, 'right', 2)
    expect(out).toContain('G42 D2')
    expect(out).toContain('G40')
  })

  it('empty array returns empty array (degenerate input)', () => {
    expect(applyCutterCompensation([], 'left')).toEqual([])
    expect(applyCutterCompensation([], 'right', 5)).toEqual([])
  })

  it("mode 'none' returns input unchanged regardless of rotary content", () => {
    // Rotary lines must NOT be modified at all when mode is 'none' -- the
    // bypass guard is gated behind buildCutterCompLines() returning null
    // first, so the early-return path is byte-identical.
    const lines = ['G0 X0 Y0 Z5 A0', 'G1 X10 Y0 Z0 A45 F800']
    expect(applyCutterCompensation(lines, 'none')).toEqual(lines)
    // And same for pure XY input under 'none'.
    const xy = ['G0 X0 Y0 Z5', 'G1 X10 Y0 Z0 F800']
    expect(applyCutterCompensation(xy, 'none')).toEqual(xy)
  })
})

// --- 4. HAS_ROTARY_AXIS_WORD regex precision (shared with [ID-0173]) ---------

describe('applyCutterCompensation -- [ID-0176] HAS_ROTARY_AXIS_WORD regex precision', () => {
  it('rotary word at start-of-line triggers bypass (e.g. ``A1 X10 ...``)', () => {
    // Some controllers accept rotary-first ordering; the leading-anchor
    // ``(?:^|\s)`` must catch this case via the ``^`` alternation.
    const lines = ['A1 X10 Y0 Z0 F800', 'G1 X20 Y0 Z0 F800']
    const out = applyCutterCompensation(lines, 'left')
    expect(out).toEqual(lines)
    expect(out.some((l) => /^G4[012]/.test(l))).toBe(false)
  })

  it('letter A inside another token does not trigger bypass (e.g. ``HAB1`` in a comment)', () => {
    // The leading anchor ``(?:^|\s)`` requires whitespace OR start-of-string
    // immediately before the rotary letter. ``HAB1`` has ``H`` before ``A``,
    // so the regex must NOT match. This pin guards against an over-eager
    // ``[ABC][+-]?\d`` regex that would false-positive on ``HAB1`` and
    // disable cutter compensation on innocent 3-axis comments.
    const lines = [
      '; calibration HAB1 sensor on',
      'G0 X0 Y0 Z5',
      'G1 X10 Y0 Z0 F800',
      'G1 X20 Y10 Z0 F800'
    ]
    const out = applyCutterCompensation(lines, 'left')
    // Bypass must NOT fire -- G41 and G40 should still appear.
    expect(out).toContain('G41')
    expect(out).toContain('G40')
  })

  it('a comment line of the form ``; A1 mode`` triggers bypass (over-conservative, safe direction)', () => {
    // Whitespace-then-A1 inside a comment will trigger the bypass. This is
    // a documented over-conservative outcome -- inhibiting compensation is
    // always safe; emitting comp around a rotary stretch is not. Pinning
    // this direction here so a future "tighter" regex change cannot regress
    // to false negatives without flipping this test.
    const lines = [
      '; A1 mode rotary calibration',
      'G0 X0 Y0 Z5',
      'G1 X10 Y0 Z0 F800',
      'G1 X20 Y10 Z0 F800'
    ]
    const out = applyCutterCompensation(lines, 'left')
    expect(out).toEqual(lines)
    expect(out.some((l) => /^G4[012]/.test(l))).toBe(false)
  })
})

// --- 5. JSDoc paired-pin (source text) ---------------------------------------

describe('applyCutterCompensation -- [ID-0176] JSDoc paired-pin against source text', () => {
  it('source JSDoc names ID-0176 and the Carvera + 4th Axis Rotary target', () => {
    expect(POST_PROCESS_SOURCE).toContain('Safety [ID-0176]')
    // Allow line-wrap inside the JSDoc -- match across optional asterisk gutter.
    expect(POST_PROCESS_SOURCE).toMatch(
      /Makera\s+Carvera \+ 4th Axis Rotary|Makera\s*\n?\s*\*\s*Carvera \+ 4th Axis Rotary/
    )
  })

  it('source JSDoc declares rotary axis word (A / B / C) bypass behaviour for cutter comp', () => {
    expect(POST_PROCESS_SOURCE).toMatch(/rotary axis word \(A \/ B \/ C\)/)
  })

  it('HAS_ROTARY_AXIS_WORD constant is wired into applyCutterCompensation function body', () => {
    // The constant itself was introduced for [ID-0173] in Cycle 85; this
    // test pins that the SAME constant is reused in applyCutterCompensation.
    expect(POST_PROCESS_SOURCE).toContain('const HAS_ROTARY_AXIS_WORD =')
    const fnStart = POST_PROCESS_SOURCE.indexOf(
      'export function applyCutterCompensation('
    )
    expect(fnStart).toBeGreaterThan(0)
    // Slice generously to cover the JSDoc-stripped function body. The bypass
    // guard sits within the first ~80 lines after the signature.
    const fnSlice = POST_PROCESS_SOURCE.slice(fnStart, fnStart + 1500)
    expect(fnSlice).toContain('HAS_ROTARY_AXIS_WORD.test(line)')
    expect(fnSlice).toContain('return lines.slice()')
  })

  it('source documents the controller-list rationale (Mach3 / RichAuto / Smoothieware / Klipper)', () => {
    // Pins that the safety rationale names the four controllers in the
    // CLAUDE.md "USER CONTEXT -- TARGET MACHINES" scope. A future doc-only
    // edit that drops the controller list (and thus dilutes the safety
    // case) will fail this pin.
    expect(POST_PROCESS_SOURCE).toMatch(/Mach3.*RichAuto.*Smoothieware.*Klipper/s)
  })
})

// --- 6. renderPost integration on the bundled Carvera 4-axis profile ---------

describe('renderPost -- [ID-0176] cutterCompensation on Makera Carvera + 4th Axis', () => {
  it("cutterCompensation 'left' on a rotary toolpath emits NO G41 / G42 / G40 (bypass intact)", async () => {
    const machine = loadCarvera4Axis()
    // 4-axis indexed contour: a tight stretch of XY-with-A moves that
    // pre-[ID-0176] would have been bracketed by G41 / G40.
    const lines = [
      '; --- 4-axis indexed contour pass ---',
      'G0 X10.0000 Y0.0000 Z46.0000 A0',
      'G1 X10.0000 Y0.0000 Z23.0000 F600',
      'G1 X12.0000 Y0.0000 Z23.0000 A30.0000 F600',
      'G1 X14.0000 Y0.0000 Z23.0000 A60.0000 F600',
      'G1 X16.0000 Y0.0000 Z23.0000 A90.0000 F600',
      'G1 X18.0000 Y0.0000 Z23.0000 A120.0000 F600',
      'G0 Z46.0000'
    ]
    const { gcode } = await renderPost(RESOURCES_ROOT, machine, lines, {
      cutterCompensation: 'left',
      cutterCompDRegister: 5
    })
    // Every A-word from the input survives the renderPost pipeline.
    expect(gcode).toContain('A30.0000')
    expect(gcode).toContain('A60.0000')
    expect(gcode).toContain('A120.0000')
    // No G41 / G42 / G40 wrapping the rotary motion (bypass intact). The
    // helper passes through untouched, so the only G4x in the rendered
    // output would come from the post template itself -- and the bundled
    // Carvera 4-axis template emits none.
    const compLines = gcode
      .split('\n')
      .filter((l) => /^G4[012]\b/.test(l.trim()))
    expect(compLines).toEqual([])
  })

  it("cutterCompensation 'right' with cutterCompDRegister works on a pure XY 4-axis subprogram (no over-broad bypass)", async () => {
    // A 4-axis program subset that only moves XY at a fixed A index typically
    // OMITS the A-word from the line stream once the index is set, so the
    // bypass should NOT fire and cutter compensation should still kick in.
    const machine = loadCarvera4Axis()
    const lines = [
      'G0 X0 Y0 Z5',
      'G1 X10 Y0 Z0 F600',
      'G1 X20 Y10 Z0 F600',
      'G1 X30 Y20 Z0 F600',
      'G0 Z5'
    ]
    const { gcode } = await renderPost(RESOURCES_ROOT, machine, lines, {
      cutterCompensation: 'right',
      cutterCompDRegister: 3
    })
    // G42 D3 must appear before the first G1 (renderPost inserts it via
    // applyCutterCompensation on this XY-only subset).
    expect(gcode).toContain('G42 D3')
    expect(gcode).toContain('G40')
  })
})
