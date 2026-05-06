/**
 * Carvera 3-axis post-processor contract pin (Cycle 67 [ID-0155]).
 *
 * Doc-tied paired pins: each invariant section asserts BOTH the documented
 * text in `.claude/skills/gcode-safety/references/carvera-3axis.md` AND the
 * runtime behavior of `renderPost()` against the bundled
 * `resources/machines/makera-carvera-3axis.json` profile + the bundled
 * `resources/posts/carvera_3axis.hbs` template. Doc-vs-code drift fails one
 * of the pair.
 *
 * Mirrors the Cycle 65 [ID-0156] Carvera 4-axis contract pin file
 * (`src/main/post-process-carvera-4axis-contract.test.ts`). Where Cycle 65
 * pinned a rotary-kinematics G-code contract, this file pins the Carvera
 * 3-axis contract — which is the OPPOSITE shape on several invariants:
 *   - 3-axis MUST emit M6 + G43 (4-axis MUST NOT — rotary occupies ATC zone)
 *   - 3-axis Z envelope is 140 mm (4-axis is 46 mm — rotary attachment
 *     reduces clearance)
 *   - 3-axis dialect is "grbl" (4-axis dialect is "grbl_4axis")
 *   - 3-axis has no A-axis word preservation tests
 *   - Both share the M2-NOT-M30 Smoothieware gotcha
 *
 * Companions in the per-machine pin set:
 *   - Cycle 64 [ID-0007b-followup]: K2 Moonraker upload contract
 *   - Cycle 65 [ID-0156]: Carvera 4-axis post contract
 *   - Cycle 67 [ID-0155] (this file): Carvera 3-axis post contract
 *   - [ID-0154] pending: Laguna Swift RichAuto-A post contract
 *
 * Why a SEPARATE file from generic header/footer/safe-Z invariant tests:
 *   Those files cover ALL three machines through validator helpers and pin
 *   the GENERIC invariants. This file pins the Carvera-3-axis-SPECIFIC
 *   contract: ATC slot semantics (T0=probe, T-1=no tool, T1–T6=cutters),
 *   the Smoothieware "M30 may delete file" gotcha, the 2400 mm/min feed
 *   ceiling, and the 6000–15000 RPM spindle band. The two layers complement.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

// ─── Fixture loading ───────────────────────────────────────────────────────────

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const REFERENCE_PATH = join(
  process.cwd(),
  '.claude',
  'skills',
  'gcode-safety',
  'references',
  'carvera-3axis.md'
)
const referenceText = readFileSync(REFERENCE_PATH, 'utf-8')

function loadCarvera3AxisProfile(): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', 'makera-carvera-3axis.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

/**
 * Representative 3-axis facing pass on a small bar.
 * - Z stays inside [0, 140] (Carvera 3-axis envelope)
 * - Feeds stay inside Carvera's 2400 mm/min ceiling
 * - Pure 3-axis (no A-word — this is the discriminator from 4-axis)
 */
const SAMPLE_3AXIS_TOOLPATH = [
  '; --- 3-axis facing pass ---',
  'G0 X10.000 Y10.000 Z140.000',
  'G1 X10.000 Y10.000 Z2.000 F600',
  'G1 X100.000 Y10.000 Z2.000 F2400',
  'G1 X100.000 Y50.000 Z2.000 F2400',
  'G1 X10.000 Y50.000 Z2.000 F2400',
  'G1 X10.000 Y10.000 Z2.000 F2400',
  'G0 Z140.000'
]

function linesOf(gcode: string): string[] {
  return gcode.split('\n').map((l) => l.trim())
}

// ─── 1. Architecture-note pins ────────────────────────────────────────────────

describe('carvera-3axis contract: architecture note (3-axis Smoothieware ATC)', () => {
  it('doc states post template is carvera_3axis.hbs and dialect family is GRBL-flavored Smoothieware', () => {
    expect(referenceText).toMatch(/Post template.*carvera_3axis\.hbs/)
    // The doc historically labels the dialect "grbl" while explaining it is a
    // misnomer for Smoothieware-family. Cycle 68 [ID-0160] introduced the
    // 'smoothieware' dialect enum entry to resolve the misnomer at the
    // schema layer; the doc body still describes the GRBL-flavored heritage.
    expect(referenceText).toMatch(/Dialect.*grbl[^_]/) // doc body retains the GRBL-flavored heritage line
  })

  it('runtime: profile pins postTemplate + dialect=smoothieware + axisCount=3 to bundled values', () => {
    const m = loadCarvera3AxisProfile()
    expect(m.postTemplate).toBe('carvera_3axis.hbs')
    // [ID-0160] Cycle 68 — the 3-axis profile now carries dialect="smoothieware"
    // so the dialect-compliance validator stops emitting GRBL_NO_TLC false-
    // positives on the legitimate G43/G49 ATC block. Before Cycle 68, this
    // field was "grbl" — see the warning-set paired pin at the bottom of
    // this file for the corresponding behavior change.
    expect(m.dialect).toBe('smoothieware')
    expect(m.axisCount).toBe(3)
  })

  it('doc warns the "grbl" dialect label is a misnomer (Smoothieware-family, not true GRBL)', () => {
    // The defining sentence in the dialect note explains why M30 vs M2 matters.
    expect(referenceText).toMatch(/grbl.*misnomer|Smoothieware-family, not true GRBL/i)
    expect(referenceText).toMatch(/M30.*delete the file from the SD card/)
  })

  it('runtime: profile firmware/dialect alignment is the source of the M30 gotcha', () => {
    const m = loadCarvera3AxisProfile()
    // The dialect string is what drives the snippet table; the post template
    // is what drives the M2-not-M30 emission. Both must remain pinned.
    // [ID-0160] Cycle 68 — dialect flipped from "grbl" to "smoothieware";
    // both values resolve to the same M3 S12000 / M5 / G21 snippet set in
    // resolveDialectSnippets() (post-process-dialects.ts) so the post output
    // is byte-identical pre- vs post-fix outside the validator-warning set.
    expect(m.dialect).toBe('smoothieware')
    expect(m.postTemplate).toBe('carvera_3axis.hbs')
  })
})

// ─── 2. Header invariants ────────────────────────────────────────────────────

describe('carvera-3axis contract: header invariants', () => {
  it('doc lists G21, G90, G17 as the first three header codes (lines 2–4)', () => {
    expect(referenceText).toMatch(/G21.*?millimeter/i)
    expect(referenceText).toMatch(/G90.*?absolute/i)
    expect(referenceText).toMatch(/G17.*?XY plane/i)
  })

  it('runtime: header emits G21 then G90 then G17 in order', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    expect(g21).toBeGreaterThan(-1)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
  })

  it('doc requires safe Z retract emitted as G0 Z<workAreaZ> with 140 mm Z envelope', () => {
    expect(referenceText).toContain('G0 Z<workAreaZ>')
    expect(referenceText).toMatch(/140 mm/)
  })

  it('runtime: header emits G0 Z140 (Carvera 3-axis Z envelope from profile)', async () => {
    const m = loadCarvera3AxisProfile()
    expect(m.workAreaMm.z).toBe(140) // pin profile value too
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    expect(gcode).toContain('G0 Z140')
  })

  it('doc requires G4 P2 spindle dwell after spindle on (M3 S<rpm>)', () => {
    expect(referenceText).toMatch(/G4 P2[\s\S]{0,80}2 second dwell/)
  })

  it('runtime: M3 ... → G4 P2 → first toolpath line in that order', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    const m3 = gcode.indexOf('M3')
    const g4 = gcode.indexOf('G4 P2')
    const firstTp = gcode.indexOf(SAMPLE_3AXIS_TOOLPATH[0]!)
    expect(m3).toBeGreaterThan(-1)
    expect(g4).toBeGreaterThan(m3)
    expect(firstTp).toBeGreaterThan(g4)
  })

  it('runtime: WCS line emits G54 BEFORE the M6/G43 ATC block when workCoordinateIndex=1', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH, {
      workCoordinateIndex: 1
    })
    const g54 = gcode.indexOf('G54')
    const m6 = gcode.indexOf('M6 T')
    expect(g54).toBeGreaterThan(-1)
    expect(m6).toBeGreaterThan(g54)
  })

  it('runtime: WCS line OMITTED when workCoordinateIndex is undefined', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    // No standalone G54..G59 line should be emitted; the only G5x in output
    // would be the conventional WCS lines we explicitly opt out of here.
    expect(gcode).not.toMatch(/^G54\b/m)
    expect(gcode).not.toMatch(/^G55\b/m)
  })
})

// ─── 3. ATC invariants (M6 + G43 — OPPOSITE of 4-axis) ───────────────────────

describe('carvera-3axis contract: ATC tool-change MUST be present', () => {
  it('doc requires the M6 Tn → G43 Hn tool-change block (header step 6)', () => {
    expect(referenceText).toMatch(/Tool-change block.*M6 Tn.*followed by.*G43 Hn/i)
  })

  it('runtime: header emits M6 T<n> then G43 H<n> in that order (default T1)', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    const m6 = gcode.search(/^M6 T1\b/m)
    const g43 = gcode.search(/^G43 H1\b/m)
    expect(m6).toBeGreaterThan(-1)
    expect(g43).toBeGreaterThan(m6)
  })

  it('runtime: explicit toolNumber=3 routes through M6 T3 + G43 H3 (matched pair)', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH, {
      toolNumber: 3
    })
    expect(gcode).toMatch(/^M6 T3\b/m)
    expect(gcode).toMatch(/^G43 H3\b/m)
    // And the default T1/H1 lines must NOT appear when an explicit tool was set.
    expect(gcode).not.toMatch(/^M6 T1\b/m)
    expect(gcode).not.toMatch(/^G43 H1\b/m)
  })

  it('doc states T0 = wireless probe (do not use for cutting)', () => {
    expect(referenceText).toMatch(/T0.*wireless probe/i)
    expect(referenceText).toMatch(/do not use for cutting/i)
  })

  it('runtime: profile encodes the T0-as-probe convention (atcProbeSlot === 0)', () => {
    const m = loadCarvera3AxisProfile()
    expect(m.atcProbeSlot).toBe(0)
  })

  it('runtime: profile encodes the 6-slot ATC capacity (atcSlotCount === 6)', () => {
    const m = loadCarvera3AxisProfile()
    expect(m.atcSlotCount).toBe(6)
  })
})

// ─── 4. Footer invariants ────────────────────────────────────────────────────

describe('carvera-3axis contract: footer invariants', () => {
  it('doc requires footer order: M5 → G49 → G0 Z<workAreaZ> → G0 X0 Y0 → M9 → M2', () => {
    // The doc footer section is a numbered list; pin each entry's literal text.
    expect(referenceText).toMatch(/Spindle off.*M5/)
    expect(referenceText).toMatch(/G49.*cancel tool length compensation/i)
    expect(referenceText).toMatch(/G0 Z<workAreaZ>.*safe-Z retract/i)
    expect(referenceText).toMatch(/G0 X0 Y0.*park at origin/i)
    expect(referenceText).toMatch(/M9.*coolant\/vacuum off/i)
    expect(referenceText).toMatch(/M2.*program end.*\*\*NOT M30\*\*/)
  })

  it('runtime: footer emits M5 → G49 → G0 Z140 → G0 X0 Y0 → M9 → M2 in order', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    const lastTp = gcode.lastIndexOf(SAMPLE_3AXIS_TOOLPATH[SAMPLE_3AXIS_TOOLPATH.length - 1]!)
    expect(lastTp).toBeGreaterThan(-1)
    const m5 = gcode.indexOf('M5', lastTp)
    const g49 = gcode.indexOf('G49', m5)
    const safeZ = gcode.indexOf('G0 Z140', g49)
    const x0y0 = gcode.indexOf('G0 X0 Y0', safeZ)
    const m9 = gcode.indexOf('M9', x0y0)
    const m2 = gcode.search(/^M2\b/m)
    expect(m5).toBeGreaterThan(lastTp)
    expect(g49).toBeGreaterThan(m5)
    expect(safeZ).toBeGreaterThan(g49)
    expect(x0y0).toBeGreaterThan(safeZ)
    expect(m9).toBeGreaterThan(x0y0)
    expect(m2).toBeGreaterThan(m9)
  })

  it('doc reminds M2 is used (NOT M30) — Smoothieware "M30 may delete file" gotcha', () => {
    expect(referenceText).toMatch(/\*\*NOT M30\*\*|M30.*delete the file from the SD card/)
  })

  it('runtime: program end is M2; M30 NEVER appears as an emitted line', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    expect(gcode).toMatch(/^M2\b/m)
    // Line-anchored: an actual M30 emission line MUST NOT appear.
    // The literal "M30" inside the template's "NOT M30 -- M30 may delete file"
    // comment is NOT line-anchored and remains permitted.
    expect(gcode).not.toMatch(/^M30\b/m)
  })

  it('doc states no % tape markers (Smoothieware does not use them)', () => {
    expect(referenceText).toMatch(/No `%` tape markers.*Smoothieware doesn't use them/i)
  })

  it('runtime: rendered output contains ZERO % tape-marker lines', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    expect(gcode).not.toMatch(/^%\s*$/m)
  })
})

// ─── 5. Anti-pattern pins (forbidden emissions) ──────────────────────────────

describe('carvera-3axis contract: anti-patterns (forbidden emissions)', () => {
  it('doc anti-pattern lists M30 in the footer as the most burned-by gotcha', () => {
    expect(referenceText).toMatch(/M30 in the footer.*delete.*the program from the SD card|single most burned-by gotcha/i)
  })

  it('doc anti-pattern lists "Missing G49" as forbidden (TLC leaks across programs)', () => {
    expect(referenceText).toMatch(/Missing G49.*tool-length compensation active across programs/i)
  })

  it('runtime: G49 always appears after M5 (cancels TLC before retract)', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    const m5 = gcode.indexOf('M5')
    const g49 = gcode.indexOf('G49', m5)
    expect(m5).toBeGreaterThan(-1)
    expect(g49).toBeGreaterThan(m5)
  })

  it('doc anti-pattern lists inch units (G20) as forbidden', () => {
    expect(referenceText).toMatch(/Inch units.*Don't emit G20/i)
  })

  it('runtime: rendered output contains ZERO G20 (inch) directives', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    expect(gcode).not.toMatch(/^G20\b/m)
  })

  it('doc anti-pattern lists skipping M6 when changing tools as forbidden', () => {
    expect(referenceText).toMatch(/Skipping M6.*just updates the register.*won't actually change the tool/i)
  })
})

// ─── 6. Toolpath round-trip preservation ─────────────────────────────────────

describe('carvera-3axis contract: toolpath preservation', () => {
  it('runtime: every X/Y/Z coordinate from the toolpath survives in the output', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    expect(gcode).toContain('X100.000')
    expect(gcode).toContain('Y50.000')
    expect(gcode).toContain('Z2.000')
    expect(gcode).toContain('F2400')
  })

  it('runtime: toolpath lines appear in the exact submitted order', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    let cursor = -1
    for (const line of SAMPLE_3AXIS_TOOLPATH) {
      const idx = gcode.indexOf(line, cursor + 1)
      expect(idx).toBeGreaterThan(cursor)
      cursor = idx
    }
  })

  it('runtime: rendered output emits NO A-word (3-axis post must not bleed rotary words)', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    // No bare "A<number>" tokens. (Filter out comments first to avoid matching
    // operator-visible text like "after M6" if it were present.)
    const codeOnly = gcode
      .split('\n')
      .filter((l) => !l.trim().startsWith(';'))
      .join('\n')
    expect(codeOnly).not.toMatch(/\bA-?\d/)
  })
})

// ─── 7. Machine scope (CLAUDE.md My-Shop-Only Mode) ──────────────────────────

describe('carvera-3axis contract: machine scope (My-Shop-Only Mode)', () => {
  it('runtime: profile id is exactly "makera-carvera-3axis" (no fallback)', () => {
    const m = loadCarvera3AxisProfile()
    expect(m.id).toBe('makera-carvera-3axis')
    expect(m.name).toMatch(/Makera Carvera/)
    expect(m.name).toMatch(/3-Axis/i)
  })

  it('runtime: profile spindle range matches Carvera 200 W spec (6000–15000 RPM)', () => {
    const m = loadCarvera3AxisProfile()
    expect(m.minSpindleRpm).toBe(6000)
    expect(m.maxSpindleRpm).toBe(15000)
  })

  it('runtime: profile work envelope matches Carvera 3-axis spec (360×240×140 mm)', () => {
    const m = loadCarvera3AxisProfile()
    expect(m.workAreaMm).toEqual({ x: 360, y: 240, z: 140 })
  })

  it('doc records the 2400 mm/min feed cap; profile pins maxFeedMmMin === 2400', () => {
    expect(referenceText).toMatch(/Max feed is 2400 mm\/min/i)
    const m = loadCarvera3AxisProfile()
    expect(m.maxFeedMmMin).toBe(2400)
  })

  it('doc explicitly warns NOT to copy Laguna feeds into Carvera jobs', () => {
    // This is the cross-machine-pollution guard: the doc reminds devs that
    // the Laguna's higher feed ceiling isn't transferable.
    expect(referenceText).toMatch(/don't copy Laguna feeds into Carvera jobs/i)
  })
})

// ─── 8. Cross-cutting: rendered output is non-trivial (sanity floor) ─────────

describe('carvera-3axis contract: smoke / sanity', () => {
  it('rendered output is non-empty and ends in a newline', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    expect(gcode.length).toBeGreaterThan(200)
    expect(gcode.endsWith('\n')).toBe(true)
  })

  it('rendered output contains the "Carvera — 3-Axis G-code" header banner', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    expect(linesOf(gcode).some((l) => l.includes('Carvera — 3-Axis G-code'))).toBe(true)
  })

  it('renderPost good-citizen call produces ZERO warnings after [ID-0160] dialect=smoothieware fix', async () => {
    // PAIRED PIN — FLIPPED 2026-04-26 Cycle 68 [ID-0160]:
    //
    // The Carvera 3-axis machine profile previously labeled its dialect
    // as "grbl" (per `resources/machines/makera-carvera-3axis.json`).
    // The post-process safety validator saw that label and fired
    // [GRBL_NO_TLC] warnings for the M6/G43/G49 ATC block — because
    // stock GRBL firmware genuinely does not support tool-length
    // compensation. But the Carvera runs Smoothieware, which DOES
    // support TLC. Cycle 67 [ID-0155] captured the false-positive as
    // a paired pin (then asserting `toHaveLength(2)` against
    // `[GRBL_NO_TLC]` warnings) and filed [ID-0160] as the fix-side
    // follow-up.
    //
    // Cycle 68 [ID-0160] resolved this by:
    //   1. Adding a 'smoothieware' entry to the machine-schema dialect enum
    //      (additive — existing 'grbl' values still parse).
    //   2. Adding a `checkSmoothieware()` family in
    //      `src/shared/gcode-dialect-compliance.ts` that mirrors the GRBL
    //      checks but skips the TLC warning (Smoothieware supports G43/G49).
    //   3. Flipping the bundled `makera-carvera-3axis.json` profile from
    //      dialect="grbl" to dialect="smoothieware".
    //
    // POST-FIX EXPECTATION: the good-citizen call now emits ZERO warnings.
    // No GRBL_NO_TLC false-positives, no SMOOTHIEWARE_* warnings (the
    // bundled post uses `;` comments and stays under the 256-char line
    // length budget). If the validator gets weakened or the profile gets
    // flipped back, this pin goes red.
    const m = loadCarvera3AxisProfile()
    const { warnings } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH, {
      workCoordinateIndex: 1
    })
    expect(warnings).toEqual([])
  })

  it('doc explains the historical source of the misnomer (now resolved by [ID-0160])', () => {
    // Companion to the warning-set pin above — keeps the doc and the
    // test in lockstep so neither can drift unnoticed. Cycle 68 [ID-0160]
    // resolved the misnomer in code (validator + schema) but the doc-side
    // narrative still describes the GRBL-flavored heritage so future
    // readers understand WHY the dialect entry exists.
    expect(referenceText).toMatch(/grbl.*misnomer|Smoothieware-family, not true GRBL/i)
    expect(referenceText).toMatch(/M30.*delete the file from the SD card/)
  })
})
