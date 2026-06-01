/**
 * Carvera 4-axis post-processor contract pin (Cycle 65 [ID-0156]).
 *
 * Doc-tied paired pins: each invariant section asserts BOTH the documented
 * text in `.claude/skills/gcode-safety/references/carvera-4axis.md` AND the
 * runtime behavior of `renderPost()` against the bundled
 * `resources/machines/makera-carvera-4axis.json` profile + the bundled
 * `resources/posts/carvera_4axis.hbs` template. Doc-vs-code drift fails one
 * of the pair.
 *
 * Mirrors the Cycle 64 [ID-0007b-followup] K2-Moonraker contract pin file
 * (`src/main/k2-moonraker-upload-contract.test.ts`). Where Cycle 64 pinned
 * an HTTP-protocol contract via a 127.0.0.1 mock server, this file pins a
 * G-code-emission contract via the post-processor's pure-render path.
 *
 * Companions in the per-machine pin set:
 *   - Cycle 64 [ID-0007b-followup]: K2 Moonraker upload contract
 *   - Cycle 65 [ID-0156] (this file): Carvera 4-axis post contract
 *   - [ID-0154] pending: Laguna Swift RichAuto-A post contract
 *   - [ID-0155] pending: Carvera 3-axis post contract
 *
 * Why a SEPARATE file from `post-process-4axis-integration.test.ts`:
 *   That file covers `carvera_4axis_grbl.hbs` (renamed from `cnc_4axis_grbl.hbs` in the pre-launch rank-16 cleanup) against a synthetic baseMachine
 *   and pins generic 4-axis structure (header/footer/spindle ordering).
 *   This file pins the Carvera-specific contract: rotary kinematics
 *   ("Y MUST be 0", "Z=0 at stock center", "no M6", "M2 NOT M30",
 *   "G93/G94 balance"). The two files complement; both should be present.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { assertYAxisIsZeroForProfile, assertRotaryHeadstockXOffsetSet } from './cam-axis4/validation'
import { renderPost } from './post-process'

// ─── Fixture loading ───────────────────────────────────────────────────────────

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const REFERENCE_PATH = join(
  process.cwd(),
  '.claude',
  'skills',
  'gcode-safety',
  'references',
  'carvera-4axis.md'
)
const referenceText = readFileSync(REFERENCE_PATH, 'utf-8')

function loadCarveraProfile(): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', 'makera-carvera-4axis.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

/** Representative 4-axis toolpath with X/Y/Z/A words (Y=0 throughout). */
const SAMPLE_4AXIS_TOOLPATH = [
  '; --- 4-axis groove pass ---',
  'G0 X10.000 Y0 Z46.000 A0',
  'G1 X10.000 Y0 Z23.000 F600',
  'G1 X20.000 Y0 Z23.000 A45.000 F900',
  'G1 X30.000 Y0 Z23.000 A90.000 F900',
  'G1 X40.000 Y0 Z23.000 A180.000 F900',
  'G1 X50.000 Y0 Z23.000 A270.000 F900',
  'G0 Z46.000'
]

function linesOf(gcode: string): string[] {
  return gcode.split('\n').map((l) => l.trim())
}

// ─── 1. Architecture-note pins ────────────────────────────────────────────────

describe('carvera-4axis contract: architecture note (rotary kinematics)', () => {
  it('doc states A-axis rotates around X (aAxisOrientation: "x")', () => {
    expect(referenceText).toMatch(/A-axis rotates around \*\*X\*\*|A axis is the rotary axis/i)
    expect(referenceText).toContain('aAxisOrientation')
  })

  it('runtime: profile asserts aAxisOrientation === "x" + axisCount === 4', () => {
    const m = loadCarveraProfile()
    expect(m.axisCount).toBe(4)
    expect(m.aAxisOrientation).toBe('x')
  })

  it('doc states A-axis is continuous via aAxisRangeDeg: 99999', () => {
    expect(referenceText).toContain('aAxisRangeDeg: 99999')
  })

  it('runtime: profile asserts aAxisRangeDeg === 99999 (continuous)', () => {
    const m = loadCarveraProfile()
    expect(m.aAxisRangeDeg).toBe(99999)
  })

  it('doc states post template is carvera_4axis.hbs and dialect is grbl_4axis', () => {
    expect(referenceText).toMatch(/Post template.*carvera_4axis\.hbs/)
    expect(referenceText).toMatch(/Dialect.*grbl_4axis/)
  })

  it('runtime: profile pins postTemplate + dialect to bundled values', () => {
    const m = loadCarveraProfile()
    expect(m.postTemplate).toBe('carvera_4axis.hbs')
    expect(m.dialect).toBe('grbl_4axis')
  })
})

// ─── 2. Header invariants (G21 / G90 / G17 / safe-Z / G0 Y0 / spindle / G4 P2)

describe('carvera-4axis contract: header invariants', () => {
  it('doc lists G21, G90, G17 as the first three header codes', () => {
    expect(referenceText).toMatch(/G21.*?millimeter/i)
    expect(referenceText).toMatch(/G90.*?absolute/i)
    expect(referenceText).toMatch(/G17.*?XY plane/i)
  })

  it('runtime: header emits G21 then G90 then G17 in order', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
  })

  it('doc requires "G0 Y0 -- critical centering on rotation axis"', () => {
    // Note: the doc heading uses an em-dash; match liberally.
    expect(referenceText).toMatch(/G0 Y0[\s\S]{0,80}critical centering on rotation axis/i)
  })

  it('runtime: header emits G0 Y0 BEFORE the first toolpath line', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    const g0Y0 = gcode.indexOf('G0 Y0')
    const firstToolpath = gcode.indexOf(SAMPLE_4AXIS_TOOLPATH[0]!)
    expect(g0Y0).toBeGreaterThan(-1)
    expect(g0Y0).toBeLessThan(firstToolpath)
  })

  it('doc requires safe Z retract emitted as G0 Z<workAreaZ> with 46 mm Z envelope', () => {
    expect(referenceText).toContain('G0 Z<workAreaZ>')
    expect(referenceText).toMatch(/46 mm/)
  })

  it('runtime: header emits G0 Z46 (Carvera 4-axis Z envelope from profile)', async () => {
    const m = loadCarveraProfile()
    expect(m.workAreaMm.z).toBe(46) // pin profile value too
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    expect(gcode).toContain('G0 Z46')
  })

  it('doc requires G4 P2 spindle dwell after spindle on (M3 S<rpm>)', () => {
    expect(referenceText).toMatch(/G4 P2[\s\S]{0,60}2 second spindle dwell/)
  })

  it('runtime: M3 ... → G4 P2 → first toolpath line in that order', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    const m3 = gcode.indexOf('M3')
    const g4 = gcode.indexOf('G4 P2')
    const firstTp = gcode.indexOf(SAMPLE_4AXIS_TOOLPATH[0]!)
    expect(m3).toBeGreaterThan(-1)
    expect(g4).toBeGreaterThan(m3)
    expect(firstTp).toBeGreaterThan(g4)
  })
})

// ─── 3. G93 / G94 inverse-time feed balance ───────────────────────────────────

describe('carvera-4axis contract: G93/G94 inverse-time feed balance', () => {
  it('doc warns G93 must be matched by G94 to restore feed-per-minute', () => {
    expect(referenceText).toMatch(/G93[\s\S]{0,80}G94[\s\S]{0,80}feed[- ]per[- ]minute/i)
  })

  it('runtime: inverseTimeFeed: false (default) emits NEITHER G93 NOR G94', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    // Match as standalone lines (not inside comment text).
    expect(gcode).not.toMatch(/^G93\b/m)
    expect(gcode).not.toMatch(/^G94\b/m)
  })

  it('runtime: inverseTimeFeed: true emits G93 BEFORE toolpath AND G94 AFTER', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH, {
      inverseTimeFeed: true
    })
    const g93 = gcode.search(/^G93\b/m)
    const g94 = gcode.search(/^G94\b/m)
    const firstTp = gcode.indexOf(SAMPLE_4AXIS_TOOLPATH[1]!) // first non-comment toolpath line
    expect(g93).toBeGreaterThan(-1)
    expect(g94).toBeGreaterThan(-1)
    expect(g93).toBeLessThan(firstTp)
    expect(g94).toBeGreaterThan(firstTp)
  })
})

// ─── 4. Footer invariants (M5 / G0 Z / G0 A0 / G0 X0 Y0 / M9 / M2) ───────────

describe('carvera-4axis contract: footer invariants', () => {
  it('doc requires footer order: spindle off → safe Z → A0 → X0 Y0 → M9 → M2', () => {
    // Match the numbered list in the doc footer section.
    expect(referenceText).toMatch(/Spindle off[\s\S]{0,60}M5/)
    expect(referenceText).toMatch(/G0 A0[\s\S]{0,80}return rotary to zero/i)
    expect(referenceText).toMatch(/G0 X0 Y0[\s\S]{0,80}park X[\s\S]{0,40}re-center Y/i)
    expect(referenceText).toMatch(/M9[\s\S]{0,80}coolant\/vacuum off/)
    expect(referenceText).toMatch(/M2[\s\S]{0,80}program end/)
  })

  it('runtime: footer emits M5 → G0 Z46 → G0 A0 → G0 X0 Y0 → M9 → M2 in order', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    const lastTp = gcode.lastIndexOf(SAMPLE_4AXIS_TOOLPATH[SAMPLE_4AXIS_TOOLPATH.length - 1]!)
    expect(lastTp).toBeGreaterThan(-1)
    const m5 = gcode.indexOf('M5', lastTp)
    const safeZ = gcode.indexOf('G0 Z46', m5)
    const a0 = gcode.indexOf('G0 A0', safeZ)
    const x0y0 = gcode.indexOf('G0 X0 Y0', a0)
    const m9 = gcode.indexOf('M9', x0y0)
    const m2 = gcode.indexOf('M2', m9)
    expect(m5).toBeGreaterThan(lastTp)
    expect(safeZ).toBeGreaterThan(m5)
    expect(a0).toBeGreaterThan(safeZ)
    expect(x0y0).toBeGreaterThan(a0)
    expect(m9).toBeGreaterThan(x0y0)
    expect(m2).toBeGreaterThan(m9)
  })

  it('doc reminds M2 is used (NOT M30) — Smoothieware "M30 may delete file" gotcha', () => {
    expect(referenceText).toMatch(/M2.*\*\*NOT M30\*\*|NOT M30/)
  })

  it('runtime: program end is M2; M30 NEVER appears in output', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    expect(gcode).toMatch(/^M2\b/m)
    // Line-anchored: an actual M30 emission line (not the literal "M30" inside
    // the template's "NOT M30 -- M30 may delete file" comment) MUST NOT appear.
    // The failing pattern would be a bare "M30" or "M30 ..." at line start.
    expect(gcode).not.toMatch(/^M30\b/m)
  })
})

// ─── 5. Anti-pattern: no ATC tool change in 4-axis (M6 forbidden) ─────────────

describe('carvera-4axis contract: no M6 (rotary occupies ATC zone)', () => {
  it('doc anti-pattern lists "Emitting M6" as forbidden in 4-axis output', () => {
    expect(referenceText).toMatch(/Emitting M6.*Breaks the "no ATC in 4-axis"/)
    expect(referenceText).toMatch(/Do NOT emit `M6` in 4-axis output/)
  })

  it('runtime: rendered output contains ZERO M6 tool-change codes', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH, {
      // Even with toolNumber set, the carvera_4axis.hbs template MUST NOT
      // emit M6 — the rotary attachment occupies the ATC's work zone.
      toolNumber: 3
    })
    expect(gcode).not.toContain('M6')
  })

  it('doc states "tool changes are manual" (operator pause M0/M1 for multi-tool)', () => {
    expect(referenceText).toMatch(/Tool changes are manual/i)
    expect(referenceText).toMatch(/M0.*M1.*manual change|operator pause/)
  })
})

// ─── 6. Anti-pattern: Y must be 0 (centering on rotation axis) ────────────────

describe('carvera-4axis contract: Y must be 0 (rotary axis centering)', () => {
  it('doc anti-pattern lists "Omitting G0 Y0 from the header" as forbidden', () => {
    expect(referenceText).toMatch(/Omitting `?G0 Y0`? from the header/)
  })

  it('doc body invariants require "Y stays at 0" with red-flag warning if not', () => {
    expect(referenceText).toMatch(/Y stays at 0[\s\S]{0,200}red flag/i)
  })

  it('runtime: G0 Y0 appears explicitly + no Y<nonzero> in any header line', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    const headerEnd = gcode.indexOf(SAMPLE_4AXIS_TOOLPATH[0]!)
    const headerSlice = gcode.slice(0, headerEnd)
    expect(headerSlice).toContain('G0 Y0')
    // Any Y word in the header that's not Y0 is a defect.
    const offendingY = headerSlice.match(/Y(?!0\b)[\d.]+/g)
    expect(offendingY).toBeNull()
  })
})

// ─── 7. Z=0 at rotation axis (safety-comment preservation) ────────────────────

describe('carvera-4axis contract: Z=0 at stock CENTER reminder', () => {
  it('doc anti-pattern warns: do not remove the "Z=0 is at stock CENTER" comment', () => {
    expect(referenceText).toMatch(/Z=0[\s\S]{0,80}stock CENTER|Z=0 at stock surface instead of rotation axis/)
  })

  it('runtime: rendered header includes the "Z=0 ... stock CENTER" safety comment', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    // Template emits: ; [4] Z=0 is at stock CENTER (rotation axis), NOT surface
    expect(gcode).toMatch(/Z=0 is at stock CENTER.*NOT surface/)
  })
})

// ─── 8. Toolpath round-trip (A-words preserved, ordering preserved) ──────────

describe('carvera-4axis contract: toolpath A-word preservation', () => {
  it('runtime: every A-axis value from the toolpath survives in the output', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    expect(gcode).toContain('A45.000')
    expect(gcode).toContain('A90.000')
    expect(gcode).toContain('A180.000')
    expect(gcode).toContain('A270.000')
  })

  it('runtime: toolpath lines appear in the exact submitted order', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    let cursor = -1
    for (const line of SAMPLE_4AXIS_TOOLPATH) {
      const idx = gcode.indexOf(line, cursor + 1)
      expect(idx).toBeGreaterThan(cursor)
      cursor = idx
    }
  })
})

// ─── 9. Machine scope (CLAUDE.md My-Shop-Only Mode) ──────────────────────────

describe('carvera-4axis contract: machine scope (My-Shop-Only Mode)', () => {
  it('doc Architecture note ties this contract to Makera Carvera 4-axis only', () => {
    expect(referenceText).toMatch(/Makera Carvera \(4-axis rotary\)/)
    expect(referenceText).toMatch(/Harmonic-drive rotary module/)
  })

  it('runtime: profile id is exactly "makera-carvera-4axis" (no fallback)', () => {
    const m = loadCarveraProfile()
    expect(m.id).toBe('makera-carvera-4axis')
    expect(m.name).toMatch(/Makera Carvera/)
  })

  it('runtime: profile spindle range matches Carvera 200 W spec (6000–15000 RPM)', () => {
    const m = loadCarveraProfile()
    expect(m.minSpindleRpm).toBe(6000)
    expect(m.maxSpindleRpm).toBe(15000)
  })

  it('runtime: profile work envelope matches Carvera 4-axis spec (240×92×46 mm)', () => {
    const m = loadCarveraProfile()
    expect(m.workAreaMm).toEqual({ x: 240, y: 92, z: 46 })
  })
})

// ─── 10. Cross-cutting: rendered output is non-trivial (sanity floor) ────────

describe('carvera-4axis contract: smoke / sanity', () => {
  it('rendered output is non-empty and ends in a newline', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    expect(gcode.length).toBeGreaterThan(200)
    expect(gcode.endsWith('\n')).toBe(true)
  })

  it('rendered output contains the "4-Axis Rotary G-code" header banner', async () => {
    const m = loadCarveraProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH)
    expect(linesOf(gcode).some((l) => l.includes('4-Axis Rotary G-code'))).toBe(true)
  })

  it('renderPost completes without warnings when called with WCS + safe-Z toolpath', async () => {
    // Canonical good-citizen call: WCS index supplied + sample toolpath above
    // uses Z=46 for all rapids (matches profile.workAreaMm.z). No safety
    // warnings should fire. If a future change weakens either the WCS gate
    // or the safe-Z gate, this test goes red.
    const m = loadCarveraProfile()
    const { warnings } = await renderPost(RESOURCES_ROOT, m, SAMPLE_4AXIS_TOOLPATH, {
      workCoordinateIndex: 1
    })
    expect(warnings).toEqual([])
  })
})

// ─── 11. Defense-in-depth schema gates (pre-launch punch-list rank 13) ───────
//
// Two new schema fields (yAxisMustBeZero, rotaryHeadstockXOffsetMm) push the
// existing safety stack one layer further upstream: today's belt-and-
// suspenders is the post-emit `G0 Y0` hardcode + the engine's chuck-span
// validator. These contract pins assert the bundled Carvera profile sets
// both fields AND that the upstream `runCamPipeline` validator rejects a
// non-zero-Y request rather than silently letting the post-template
// re-center the tool.
//
// Safety Rule 2: backward compat. A profile loaded WITHOUT these fields
// still parses through `machineProfileSchema` (both are .optional()), so
// existing saved projects are unaffected. Only when the field is present
// AND set do the downstream validators fire.

describe('carvera-4axis contract: defense-in-depth schema (rank 13)', () => {
  it('bundled profile sets yAxisMustBeZero: true (Carvera rotary centering)', () => {
    const m = loadCarveraProfile()
    expect(m.yAxisMustBeZero).toBe(true)
  })

  it('bundled profile sets rotaryHeadstockXOffsetMm: 5 (operator-measured)', () => {
    const m = loadCarveraProfile()
    expect(m.rotaryHeadstockXOffsetMm).toBe(5)
  })

  it('Safety Rule 2: a profile WITHOUT the new fields still parses (additive/optional)', () => {
    // Strip both fields and verify schema parse still succeeds. This pins
    // the .optional() contract — an existing saved project that predates
    // the rank-13 fields must continue to load without manual migration.
    const path = join(RESOURCES_ROOT, 'machines', 'makera-carvera-4axis.json')
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    delete raw.yAxisMustBeZero
    delete raw.rotaryHeadstockXOffsetMm
    expect(() => machineProfileSchema.parse(raw)).not.toThrow()
    const parsed = machineProfileSchema.parse(raw)
    expect(parsed.yAxisMustBeZero).toBeUndefined()
    expect(parsed.rotaryHeadstockXOffsetMm).toBeUndefined()
  })

  it('assertYAxisIsZeroForProfile rejects non-zero Y when bundled profile yAxisMustBeZero is true', () => {
    // The bundled profile sets yAxisMustBeZero: true. The validator
    // function -- imported and exercised here against the actual profile
    // value (not a synthetic literal) -- rejects an explicit Y=12.5
    // toolpath segment. This pins the schema-to-validator wire: if a
    // future change drops the flag from the profile OR changes the gate
    // semantics, the contract goes red.
    const m = loadCarveraProfile()
    const r = assertYAxisIsZeroForProfile({
      yAxisMustBeZero: m.yAxisMustBeZero,
      toolpathYValues: [0, 12.5, 0]
    })
    expect(r).not.toBeNull()
    if (r) {
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/Y=0 \(yAxisMustBeZero\)/)
      expect(r.hint).toMatch(/Carvera 4-axis HD/)
    }
  })

  it('assertRotaryHeadstockXOffsetSet accepts the bundled profile (axisCount 4 + offset 5 mm)', () => {
    // Mirror of the above: pin the wire from schema to validator. A future
    // change that drops `rotaryHeadstockXOffsetMm` from the bundled profile
    // would make this validator return ValidationFailure, surfacing the
    // regression.
    const m = loadCarveraProfile()
    const r = assertRotaryHeadstockXOffsetSet({
      axisCount: m.axisCount ?? 3,
      rotaryHeadstockXOffsetMm: m.rotaryHeadstockXOffsetMm
    })
    expect(r).toBeNull()
  })
})
