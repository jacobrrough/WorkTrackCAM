/**
 * [ID-0173] Cycle 85 -- post-processing safety contract.
 *
 * Pins the 4-axis rotary bypass contract on `applyArcFitting` in
 * `src/main/post-process.ts`. Arc fitting is XY-plane-only -- the helper
 * pipeline (`parseG1Point` -> buffer -> `fitArcsToLinearPath` ->
 * `segmentToGcodeLine`) only knows about X / Y / Z words and would silently
 * strip any rotary-axis word (A / B / C) from a fitted G2 / G3 segment.
 * That is a CLAUDE.md "Safety Rule 1: G-code is sacred" violation for the
 * **Makera Carvera + 4th Axis Rotary** target machine, where the rotary
 * A-word is the entire point of the toolpath.
 *
 * This file pins the safety contract via paired-pin tests (each invariant
 * asserted against BOTH the source-text JSDoc / comment AND the runtime
 * behaviour of `applyArcFitting()` -- doc-vs-code drift fails one of the
 * pair). Companions in the post-processing safety-rail family:
 *   - Cycle 64 [ID-0007b-followup]: K2 Moonraker upload contract
 *   - Cycle 65 [ID-0156]: Carvera 4-axis post contract
 *   - Cycle 67 [ID-0157]: Carvera 3-axis post contract
 *   - Cycle 70 [ID-0154]: Laguna Swift post contract
 *   - Cycle 77 [ID-0165]: sequenceMultiToolJob multi-tool contract
 *   - Cycle 85 [ID-0173] (THIS FILE): applyArcFitting 4-axis bypass
 *
 * Three machines covered (CLAUDE.md "USER CONTEXT -- TARGET MACHINES"):
 *   - **Makera Carvera + 4th Axis Rotary** -- primary target. The 4-axis
 *     post (`carvera_4axis.hbs`) emits A-word lines; arc fitting on those
 *     would strip the A-word. The bypass keeps the toolpath byte-identical.
 *   - **Laguna Swift 5x10** -- 3-axis only; arc fitting still works on
 *     pure XYZ output (regression-checked via the fall-through tests).
 *   - **Creality K2 Plus** -- FDM passthrough; never calls arc fitting in
 *     practice (slicer emits arcs natively), but the helper is shared.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyArcFitting, renderPost } from './post-process'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'

// ─── Fixture loading ──────────────────────────────────────────────────────────

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const POST_PROCESS_SOURCE = readFileSync(
  join(process.cwd(), 'src', 'main', 'post-process.ts'),
  'utf-8'
)

function loadCarvera4Axis(): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', 'makera-carvera-4axis.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

/** A pure 3-axis quarter-arc XY toolpath -- many points, fittable. */
function buildQuarterArcXy(radius = 10, n = 16): string[] {
  const out: string[] = []
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * (Math.PI / 2)
    const x = radius * Math.cos(angle)
    const y = radius * Math.sin(angle)
    out.push(`G1 X${x.toFixed(4)} Y${y.toFixed(4)} Z0 F800`)
  }
  return out
}

// ─── 1. A-axis (Carvera 4th Axis Rotary) bypass ───────────────────────────────

describe('applyArcFitting -- [ID-0173] 4-axis A-axis bypass', () => {
  it('returns input unchanged when a single G1 line carries an A-word', () => {
    const lines = ['G1 X10 Y0 Z2 A45 F800']
    const out = applyArcFitting(lines, 0.01)
    expect(out).toEqual(lines)
    // Fresh array contract: caller-mutation of the result must not mutate input.
    out.push('G1 X99 Y99 Z99')
    expect(lines.length).toBe(1)
  })

  it('returns full toolpath unchanged when even one A-word line is interspersed in a fittable XY arc', () => {
    const arc = buildQuarterArcXy(10, 16)
    // Splice a Carvera-style 4-axis line into the middle of an otherwise fittable arc.
    const mixed = [...arc.slice(0, 8), 'G1 X0 Y0 Z2 A45 F600', ...arc.slice(8)]
    const out = applyArcFitting(mixed, 0.01)
    // Bypass: byte-identical pass-through (no G2/G3 emitted anywhere).
    expect(out).toEqual(mixed)
    expect(out.some((l) => /^G[23]\s/.test(l))).toBe(false)
  })

  it('triggers bypass on a negative A-value (e.g. A-5.5 from a CCW indexed segment)', () => {
    const lines = [
      'G1 X10 Y0 Z0 F800',
      'G1 X12 Y0 Z0 A-5.5 F800',
      'G1 X14 Y0 Z0 F800'
    ]
    const out = applyArcFitting(lines, 0.01)
    expect(out).toEqual(lines)
  })

  it('triggers bypass on a zero A-value (A0 emitted as the rotary anchor)', () => {
    // The Carvera 4-axis template emits ``G0 X0 Y0`` BUT the toolpath itself
    // often opens with ``G0 ... A0`` to anchor the rotary frame. That single
    // A0 reference must be enough to disable arc fitting on the entire job.
    const lines = [
      'G0 X10 Y0 Z46 A0',
      'G1 X10 Y0 Z23 F600',
      'G1 X11 Y0 Z23 F600',
      'G1 X12 Y0 Z23 F600',
      'G1 X13 Y0 Z23 F600'
    ]
    const out = applyArcFitting(lines, 0.01)
    expect(out).toEqual(lines)
    expect(out.some((l) => /^G[23]\s/.test(l))).toBe(false)
  })
})

// ─── 2. B-axis and C-axis defensive coverage ─────────────────────────────────

describe('applyArcFitting -- [ID-0173] B-axis and C-axis defensive bypass', () => {
  it('triggers bypass on a B-word (5-axis tilt-axis common naming)', () => {
    const lines = [
      'G1 X10 Y0 Z0 F800',
      'G1 X10 Y0 Z0 B30 F800',
      'G1 X20 Y0 Z0 F800'
    ]
    const out = applyArcFitting(lines, 0.01)
    expect(out).toEqual(lines)
  })

  it('triggers bypass on a C-word (rotary table around Z naming)', () => {
    const lines = [
      'G1 X10 Y0 Z0 F800',
      'G1 X10 Y0 Z0 C90 F800',
      'G1 X20 Y0 Z0 F800'
    ]
    const out = applyArcFitting(lines, 0.01)
    expect(out).toEqual(lines)
  })
})

// ─── 3. 3-axis fall-through (no regression) ───────────────────────────────────

describe('applyArcFitting -- 3-axis fall-through (no regression beyond [ID-0173])', () => {
  it('quarter-arc XYZ without rotary words still produces at least one G2/G3 arc', () => {
    const lines = buildQuarterArcXy(10, 16)
    const out = applyArcFitting(lines, 0.01)
    expect(out.some((l) => l.startsWith('G2') || l.startsWith('G3'))).toBe(true)
    // Output should be strictly shorter than input -- arcs compress.
    expect(out.length).toBeLessThan(lines.length)
  })

  it('straight-line XY G1 sequence still emits G1 unchanged (no false-positive arc)', () => {
    const lines = [
      'G1 X0 Y0 Z0 F800',
      'G1 X10 Y0 Z0 F800',
      'G1 X20 Y0 Z0 F800',
      'G1 X30 Y0 Z0 F800'
    ]
    const out = applyArcFitting(lines, 0.01)
    expect(out.every((l) => /^G1\s/.test(l))).toBe(true)
  })

  it('empty array returns empty array (degenerate input)', () => {
    expect(applyArcFitting([], 0.01)).toEqual([])
  })
})

// ─── 4. HAS_ROTARY_AXIS_WORD regex precision ──────────────────────────────────

describe('applyArcFitting -- [ID-0173] HAS_ROTARY_AXIS_WORD regex precision', () => {
  it('rotary word at start-of-line triggers bypass (e.g. ``A1 X10 ...``)', () => {
    // Some controllers accept rotary-first ordering; the leading-anchor
    // ``(?:^|\s)`` must catch this case via the ``^`` alternation.
    const lines = ['A1 X10 Y0 Z0 F800', 'G1 X20 Y0 Z0 F800']
    const out = applyArcFitting(lines, 0.01)
    expect(out).toEqual(lines)
  })

  it('letter A inside another token does not trigger bypass (e.g. ``HAB1`` in a comment)', () => {
    // The leading anchor ``(?:^|\s)`` requires whitespace OR start-of-string
    // immediately before the rotary letter. ``HAB1`` has ``H`` before ``A``,
    // so the regex must NOT match. This pin guards against an over-eager
    // ``[ABC][+-]?\d`` regex that would false-positive on ``HAB1`` and
    // disable arc fitting on innocent 3-axis comments.
    const lines = [
      '; calibration HAB1 sensor on',
      ...buildQuarterArcXy(10, 16)
    ]
    const out = applyArcFitting(lines, 0.01)
    // Should still arc-fit the quarter arc despite the ``HAB1`` substring.
    expect(out.some((l) => l.startsWith('G2') || l.startsWith('G3'))).toBe(true)
    expect(out.length).toBeLessThan(lines.length)
  })

  it('a comment line of the form ``; A1 mode`` triggers bypass (over-conservative, safe direction)', () => {
    // Whitespace-then-A1 inside a comment will trigger the bypass. This is
    // a documented over-conservative outcome -- inhibiting arc fitting is
    // always safe; emitting a rotary-stripped arc is not. Pinning this
    // direction here so a future "tighter" regex change cannot regress to
    // false negatives without flipping this test.
    const arc = buildQuarterArcXy(10, 16)
    const lines = ['; A1 mode rotary calibration', ...arc]
    const out = applyArcFitting(lines, 0.01)
    expect(out).toEqual(lines)
    expect(out.some((l) => /^G[23]\s/.test(l))).toBe(false)
  })
})

// ─── 5. JSDoc paired-pin (source text) ────────────────────────────────────────

describe('applyArcFitting -- [ID-0173] JSDoc paired-pin against source text', () => {
  it('source JSDoc names ID-0173 and the Carvera + 4th Axis Rotary target', () => {
    expect(POST_PROCESS_SOURCE).toContain('Safety [ID-0173]')
    expect(POST_PROCESS_SOURCE).toMatch(/Makera\s*\n?\s*\*\s*Carvera \+ 4th Axis Rotary/)
  })

  it('source JSDoc declares rotary axis words A / B / C bypass behaviour', () => {
    expect(POST_PROCESS_SOURCE).toMatch(/rotary axis word \(A \/ B \/ C\)/)
  })

  it('HAS_ROTARY_AXIS_WORD constant exists and is wired into applyArcFitting', () => {
    expect(POST_PROCESS_SOURCE).toContain('const HAS_ROTARY_AXIS_WORD =')
    // Function body must reference the constant at least once.
    const fnStart = POST_PROCESS_SOURCE.indexOf(
      'export function applyArcFitting('
    )
    expect(fnStart).toBeGreaterThan(0)
    const fnSlice = POST_PROCESS_SOURCE.slice(fnStart, fnStart + 800)
    expect(fnSlice).toContain('HAS_ROTARY_AXIS_WORD.test(line)')
  })
})

// ─── 6. renderPost integration on the bundled Carvera 4-axis profile ─────────

describe('renderPost -- [ID-0173] enableArcFitting on Makera Carvera + 4th Axis', () => {
  it('A-word is preserved verbatim in emitted G-code (no G2/G3 stripping)', async () => {
    const machine = loadCarvera4Axis()
    // 4-axis groove pass: many short XY-with-A moves that look superficially
    // arc-fittable in XY alone. Pre-[ID-0173] this would have stripped the A.
    const lines = [
      '; --- 4-axis groove pass ---',
      'G0 X10.0000 Y0.0000 Z46.0000 A0',
      'G1 X10.0000 Y0.0000 Z23.0000 F600',
      'G1 X12.0000 Y0.0000 Z23.0000 A30.0000 F600',
      'G1 X14.0000 Y0.0000 Z23.0000 A60.0000 F600',
      'G1 X16.0000 Y0.0000 Z23.0000 A90.0000 F600',
      'G1 X18.0000 Y0.0000 Z23.0000 A120.0000 F600',
      'G1 X20.0000 Y0.0000 Z23.0000 A150.0000 F600',
      'G1 X22.0000 Y0.0000 Z23.0000 A180.0000 F600',
      'G0 Z46.0000'
    ]
    const { gcode } = await renderPost(RESOURCES_ROOT, machine, lines, {
      enableArcFitting: true,
      arcTolerance: 0.01
    })
    // Every A-word from the input survives the renderPost pipeline.
    expect(gcode).toContain('A30.0000')
    expect(gcode).toContain('A60.0000')
    expect(gcode).toContain('A180.0000')
    // No G2/G3 was emitted from the rotary segment (bypass intact).
    const g23OnRotaryPasses = gcode
      .split('\n')
      .filter((l) => /^G[23]\s/.test(l.trim()))
    expect(g23OnRotaryPasses).toEqual([])
  })

  it('pure XYZ subset rendered through Carvera 4-axis profile still gets arc fitting (no over-broad bypass)', async () => {
    // A subprogram of a 4-axis job that only moves XY at a fixed A index
    // typically OMITS the A-word from the line stream once the index is set,
    // so the bypass should NOT fire and arc fitting should still kick in.
    const machine = loadCarvera4Axis()
    const lines = buildQuarterArcXy(10, 16)
    const { gcode } = await renderPost(RESOURCES_ROOT, machine, lines, {
      enableArcFitting: true,
      arcTolerance: 0.01
    })
    expect(gcode).toMatch(/G[23]\s+X/)
  })
})
