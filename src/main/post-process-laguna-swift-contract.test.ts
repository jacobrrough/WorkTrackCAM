/**
 * Laguna Swift 5x10 RichAuto-A post-processor contract pin (Cycle 70 [ID-0154]).
 *
 * Doc-tied paired pins: each invariant section asserts BOTH the documented
 * text in `.claude/skills/gcode-safety/references/laguna-swift.md` AND the
 * runtime behavior of `renderPost()` against the bundled
 * `resources/machines/laguna-swift-5x10.json` profile + the bundled
 * `resources/posts/vcarve_mach3.hbs` template. Doc-vs-code drift fails one
 * of the pair.
 *
 * Mirrors the per-machine pin set:
 *   - Cycle 64 [ID-0007b-followup]: K2 Moonraker upload contract
 *   - Cycle 65 [ID-0156]: Carvera 4-axis post contract
 *   - Cycle 67 [ID-0155]: Carvera 3-axis post contract
 *   - Cycle 70 [ID-0154] (this file): Laguna Swift RichAuto-A post contract
 *
 * Where Carvera-3axis is "M2 program end, NO % markers" and Carvera-4axis
 * is "no M6 — rotary occupies ATC zone", Laguna is the OPPOSITE shape on
 * BOTH:
 *   - Laguna MUST emit `M30` (Mach3 terminator), NEVER `M2` (Carvera)
 *   - Laguna MUST emit `%` tape markers (Mach3/RichAuto convention)
 *   - Laguna spindle dialect is `mach3` -> `{ on: 'M3', off: 'M5' }`
 *     (no S<rpm> baked into the snippet — a router post relies on the
 *     dialect resolver staying lean since spindleRpm is set per-job via
 *     the `spindleRpm` opt; see post-process-dialects.ts case 'mach3')
 *
 * Why a SEPARATE file from generic header/footer/safe-Z invariant tests:
 *   Those files cover ALL three machines through validator helpers and pin
 *   the GENERIC invariants. This file pins the Laguna-Swift-SPECIFIC
 *   contract: the Mach3-vs-RichAuto dialect superset note (doc lines 8-12),
 *   the dustCollection flag round-trip (M7 with paired M9), the
 *   spindle warm-up dwell `G4 P2.0`, the cool-down dwell `G4 P3.0`, the
 *   1524x3048x203 work envelope, and the [8000, 18000] RPM band. The two
 *   layers complement.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

// --- Fixture loading -------------------------------------------------------

const RESOURCES_ROOT = join(process.cwd(), 'resources')
const REFERENCE_PATH = join(
  process.cwd(),
  '.claude',
  'skills',
  'gcode-safety',
  'references',
  'laguna-swift.md'
)
const referenceText = readFileSync(REFERENCE_PATH, 'utf-8')

function loadLagunaSwiftProfile(): MachineProfile {
  const path = join(RESOURCES_ROOT, 'machines', 'laguna-swift-5x10.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

/**
 * Representative Laguna Swift wood-routing facing pass. Stays inside the
 * Laguna's [8000, 18000] RPM band (controlled by spindleRpm opt) and the
 * 12000 mm/min feed ceiling. No A-word (3-axis router).
 */
const SAMPLE_LAGUNA_TOOLPATH = [
  '; --- Laguna Swift facing pass ---',
  'G0 X10.000 Y10.000 Z25.000',
  'G1 X10.000 Y10.000 Z-3.000 F600',
  'G1 X600.000 Y10.000 Z-3.000 F8000',
  'G1 X600.000 Y400.000 Z-3.000 F8000',
  'G1 X10.000 Y400.000 Z-3.000 F8000',
  'G1 X10.000 Y10.000 Z-3.000 F8000',
  'G0 Z25.000'
]

function linesOf(gcode: string): string[] {
  return gcode.split('\n').map((l) => l.trim())
}

// --- 1. Architecture-note pins ---------------------------------------------

describe('laguna-swift contract: architecture note (Mach3 vs RichAuto A-series)', () => {
  it('doc states post template is vcarve_mach3.hbs and dialect is mach3', () => {
    expect(referenceText).toMatch(/Post template.*vcarve_mach3\.hbs/)
    expect(referenceText).toMatch(/Dialect.*`mach3`/)
  })

  it('runtime: profile pins postTemplate=vcarve_mach3.hbs + dialect=mach3', () => {
    const m = loadLagunaSwiftProfile()
    expect(m.postTemplate).toBe('vcarve_mach3.hbs')
    expect(m.dialect).toBe('mach3')
  })

  it('doc explains RichAuto A-series accepts Mach3 G-code as a strict superset', () => {
    // The dialect-note section is the most-burned-by source of confusion
    // for the Laguna profile. Pin both halves of the explanation so neither
    // can drift unnoticed: the controller IS RichAuto A-series, and the
    // post emits Mach3-style G-code which RichAuto accepts.
    expect(referenceText).toMatch(/RichAuto A-series/)
    expect(referenceText).toMatch(/Mach3-compatible|Mach3-style|Mach3 conventions/)
  })

  it('doc warns against mutating vcarve_mach3.hbs for RichAuto-only syntax', () => {
    // Keeps the future-direction guidance (separate richauto_a.hbs if
    // dialect-specific syntax is ever needed) pinned to its rationale.
    expect(referenceText).toMatch(/add a new post template.*richauto_a\.hbs|rather than mutating `vcarve_mach3\.hbs`/i)
  })
})

// --- 2. Header invariants --------------------------------------------------

describe('laguna-swift contract: header invariants', () => {
  it('doc lists % tape start, then operator-visible header, then G21, G90, G17, G94', () => {
    expect(referenceText).toMatch(/^1\. `%` — program tape start marker \(Mach3 requirement\)/m)
    expect(referenceText).toMatch(/G21 or G20.*must be explicit/i)
    expect(referenceText).toMatch(/G90.*absolute distance mode/i)
    expect(referenceText).toMatch(/G17.*XY plane for G2\/G3 arcs/i)
    expect(referenceText).toMatch(/G94.*feed in units per minute/i)
  })

  it('runtime: header emits % then G21 then G90 then G17 then G94 in order', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    const tapeStart = gcode.search(/^%\s*$/m)
    const g21 = gcode.indexOf('G21')
    const g90 = gcode.indexOf('G90')
    const g17 = gcode.indexOf('G17')
    const g94 = gcode.indexOf('G94')
    expect(tapeStart).toBeGreaterThan(-1)
    expect(g21).toBeGreaterThan(tapeStart)
    expect(g90).toBeGreaterThan(g21)
    expect(g17).toBeGreaterThan(g90)
    expect(g94).toBeGreaterThan(g17)
  })

  it('doc requires G4 P2.0 dwell after spindle on (wood router warmup)', () => {
    expect(referenceText).toMatch(/G4 P2\.0.*dwell for spindle ramp-up/i)
  })

  it('runtime: M3 ... -> G4 P2.0 -> first toolpath line in that order', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    const m3 = gcode.search(/^M3\b/m)
    const g4 = gcode.indexOf('G4 P2.0')
    const firstTp = gcode.indexOf(SAMPLE_LAGUNA_TOOLPATH[0]!)
    expect(m3).toBeGreaterThan(-1)
    expect(g4).toBeGreaterThan(m3)
    expect(firstTp).toBeGreaterThan(g4)
  })

  it('runtime: WCS line emits G54 BEFORE spindle on when workCoordinateIndex=1', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH, {
      workCoordinateIndex: 1
    })
    const g54 = gcode.search(/^G54\b/m)
    const m3 = gcode.search(/^M3\b/m)
    expect(g54).toBeGreaterThan(-1)
    expect(m3).toBeGreaterThan(g54)
  })

  it('runtime: WCS line OMITTED when workCoordinateIndex is undefined', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    expect(gcode).not.toMatch(/^G54\b/m)
    expect(gcode).not.toMatch(/^G55\b/m)
  })

  it('runtime: header emits pre-cut safe-Z lift G0 Z<workAreaZ> before toolpath ([ID-0110])', async () => {
    const m = loadLagunaSwiftProfile()
    expect(m.workAreaMm.z).toBe(203) // pin profile value too
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    // The header includes a pre-toolpath G0 Z203 retract for known-clearance.
    // Mirror of carvera_3axis.hbs / carvera_4axis.hbs per template comment.
    const safeZ = gcode.indexOf('G0 Z203')
    const firstTp = gcode.indexOf(SAMPLE_LAGUNA_TOOLPATH[0]!)
    expect(safeZ).toBeGreaterThan(-1)
    expect(safeZ).toBeLessThan(firstTp)
  })
})

// --- 3. Footer invariants (M30, NOT M2 — opposite of Carvera) -------------

describe('laguna-swift contract: footer invariants', () => {
  it('doc requires footer order: M5 -> G4 P3.0 cool-down -> G0 Z<workAreaZ> -> G0 X0 Y0 -> M30 -> %', () => {
    expect(referenceText).toMatch(/Spindle off via.*spindleOff.*emits M5/)
    expect(referenceText).toMatch(/G0 Z<workAreaZ>.*safe-Z retract before XY parking/i)
    expect(referenceText).toMatch(/G0 X0 Y0.*park at WCS origin/i)
    expect(referenceText).toMatch(/M30.*program end \+ rewind\. \*\*This is Mach3's terminator\. NOT M2\.\*\*/)
    expect(referenceText).toMatch(/`%` — program tape end marker/)
  })

  it('runtime: footer emits M5 -> G4 P3.0 -> G0 Z203 -> G0 X0 Y0 -> M30 -> % in order', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    const lastTp = gcode.lastIndexOf(SAMPLE_LAGUNA_TOOLPATH[SAMPLE_LAGUNA_TOOLPATH.length - 1]!)
    expect(lastTp).toBeGreaterThan(-1)
    const m5 = gcode.indexOf('M5', lastTp)
    const g4cool = gcode.indexOf('G4 P3.0', m5)
    const safeZ = gcode.indexOf('G0 Z203', g4cool)
    const x0y0 = gcode.indexOf('G0 X0 Y0', safeZ)
    const m30 = gcode.search(/^M30\b/m)
    // Tape-end % is the final non-empty line.
    const lines = linesOf(gcode).filter((l) => l.length > 0)
    const lastLine = lines[lines.length - 1]
    expect(m5).toBeGreaterThan(lastTp)
    expect(g4cool).toBeGreaterThan(m5)
    expect(safeZ).toBeGreaterThan(g4cool)
    expect(x0y0).toBeGreaterThan(safeZ)
    expect(m30).toBeGreaterThan(x0y0)
    expect(lastLine).toBe('%')
  })

  it('doc requires M30 (Mach3 terminator); doc anti-pattern explicitly forbids M2 (Carvera terminator)', () => {
    expect(referenceText).toMatch(/M30.*program end \+ rewind/)
    expect(referenceText).toMatch(/M2 in the footer.*That's Carvera's terminator/i)
  })

  it('runtime: program end is M30; M2 NEVER appears as an emitted line (forbidden Carvera-style mix)', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    expect(gcode).toMatch(/^M30\b/m)
    // Line-anchored — the literal "M2" can appear inside other tokens (e.g.,
    // operator-visible text in a comment) without being a program-end line.
    expect(gcode).not.toMatch(/^M2\b/m)
  })

  it('runtime: rendered output has BOTH leading and trailing % tape markers (RichAuto preference)', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    const tapeMarkerLines = linesOf(gcode).filter((l) => l === '%')
    expect(tapeMarkerLines.length).toBe(2)
  })
})

// --- 4. Anti-pattern pins (forbidden emissions) ---------------------------

describe('laguna-swift contract: anti-patterns (forbidden emissions)', () => {
  it('doc anti-pattern lists Missing % markers as forbidden (RichAuto strongly prefers them)', () => {
    expect(referenceText).toMatch(/Missing.*`%` markers.*RichAuto A-series strongly prefers the tape markers/i)
  })

  it('doc anti-pattern lists Inches by default as forbidden (controller may persist last units)', () => {
    expect(referenceText).toMatch(/Inches by default.*controller may persist the last units/i)
  })

  it('runtime: rendered output contains ZERO G20 (inch) directives', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    expect(gcode).not.toMatch(/^G20\b/m)
  })

  it('doc anti-pattern lists Spindle direction mistakes — M4 reverses, wood bits are M3-only', () => {
    expect(referenceText).toMatch(/Spindle direction mistakes.*M4 reverses/i)
  })

  it('runtime: header emits M3 (clockwise); M4 NEVER appears as an emitted line (wood-routing convention)', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    expect(gcode).toMatch(/^M3\b/m)
    expect(gcode).not.toMatch(/^M4\b/m)
  })

  it('doc anti-pattern lists Z retract too low for a 5x10 job; profile pins workAreaMm.z=203 as the safe-Z source', () => {
    expect(referenceText).toMatch(/Z retract too low for a 5x10 job/)
    expect(referenceText).toMatch(/workAreaMm\.z.*203 mm/i)
    const m = loadLagunaSwiftProfile()
    expect(m.workAreaMm.z).toBe(203)
  })
})

// --- 5. Dust-collection flag round-trip (M7/M9 paired) --------------------

describe('laguna-swift contract: dust-collection M7/M9 paired emission', () => {
  it('doc requires that if dust-on emits, the matching dust-off MUST emit in the footer', () => {
    expect(referenceText).toMatch(/If a shop-specific post enables dust-on.*MUST emit the matching dust-off/i)
  })

  it('runtime: dustCollection=true emits BOTH M7 (header) and M9 (footer)', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH, {
      dustCollection: true
    })
    const m7 = gcode.search(/^M7\b/m)
    const m9 = gcode.search(/^M9\b/m)
    expect(m7).toBeGreaterThan(-1)
    expect(m9).toBeGreaterThan(m7) // M9 must follow M7 (footer after header)
    // M7 must precede the first toolpath line; M9 must follow the last.
    const firstTp = gcode.indexOf(SAMPLE_LAGUNA_TOOLPATH[0]!)
    const lastTp = gcode.lastIndexOf(SAMPLE_LAGUNA_TOOLPATH[SAMPLE_LAGUNA_TOOLPATH.length - 1]!)
    expect(m7).toBeLessThan(firstTp)
    expect(m9).toBeGreaterThan(lastTp)
  })

  it('runtime: dustCollection unset (default) emits NEITHER M7 nor M9 as live lines', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    // The template leaves both behind a `;` comment; line-anchored pin
    // ensures neither is emitted as an executable line.
    expect(gcode).not.toMatch(/^M7\b/m)
    expect(gcode).not.toMatch(/^M9\b/m)
  })

  it('doc warns NOT to emit M7/M8 unconditionally (flood-coolant on a wood router = template bug)', () => {
    expect(referenceText).toMatch(/Do NOT emit M7\/M8 unconditionally/i)
  })
})

// --- 6. Toolpath round-trip preservation ----------------------------------

describe('laguna-swift contract: toolpath preservation', () => {
  it('runtime: every X/Y/Z/F coordinate from the toolpath survives in the output', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    expect(gcode).toContain('X600.000')
    expect(gcode).toContain('Y400.000')
    expect(gcode).toContain('Z-3.000')
    expect(gcode).toContain('F8000')
  })

  it('runtime: toolpath lines appear in the exact submitted order', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    let cursor = -1
    for (const line of SAMPLE_LAGUNA_TOOLPATH) {
      const idx = gcode.indexOf(line, cursor + 1)
      expect(idx).toBeGreaterThan(cursor)
      cursor = idx
    }
  })

  it('runtime: rendered output emits NO A-word (3-axis router must not bleed rotary words)', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    const codeOnly = gcode
      .split('\n')
      .filter((l) => !l.trim().startsWith(';'))
      .join('\n')
    expect(codeOnly).not.toMatch(/\bA-?\d/)
  })
})

// --- 7. Machine scope (CLAUDE.md My-Shop-Only Mode) -----------------------

describe('laguna-swift contract: machine scope (My-Shop-Only Mode)', () => {
  it('runtime: profile id is exactly "laguna-swift-5x10" (no fallback)', () => {
    const m = loadLagunaSwiftProfile()
    expect(m.id).toBe('laguna-swift-5x10')
    expect(m.name).toMatch(/Laguna Swift/)
  })

  it('runtime: profile spindle range matches Laguna 3 HP / 6 HP wood-router spec (8000-18000 RPM)', () => {
    const m = loadLagunaSwiftProfile()
    expect(m.minSpindleRpm).toBe(8000)
    expect(m.maxSpindleRpm).toBe(18000)
  })

  it('runtime: profile work envelope matches Laguna Swift 5x10 spec (1524 x 3048 x 203 mm)', () => {
    const m = loadLagunaSwiftProfile()
    expect(m.workAreaMm).toEqual({ x: 1524, y: 3048, z: 203 })
  })

  it('doc records the 12000 mm/min feed cap; profile pins maxFeedMmMin === 12000', () => {
    expect(referenceText).toMatch(/maxFeedMmMin \(12000 mm\/min/)
    const m = loadLagunaSwiftProfile()
    expect(m.maxFeedMmMin).toBe(12000)
  })

  it('runtime: profile encodes 6-zone vacuum table (vacuumZoneCount === 6)', () => {
    const m = loadLagunaSwiftProfile()
    expect(m.vacuumZoneCount).toBe(6)
  })

  it('runtime: profile encodes 3 HP spindle variant (spindleVariantHp === 3)', () => {
    const m = loadLagunaSwiftProfile()
    // The bundled profile is the 3 HP variant; the 6 HP option exists in
    // CLAUDE.md USER CONTEXT but the bundled fixture is intentionally the
    // baseline 3 HP machine. If a 6 HP variant gets bundled later, this
    // pin tells the next reader where to update.
    expect(m.spindleVariantHp).toBe(3)
  })

  it('doc explicitly notes the 6-zone vacuum table is controlled from the RichAuto pendant, not G-code', () => {
    expect(referenceText).toMatch(/post has no zone-on\/zone-off M-codes.*vacuum is controlled from the RichAuto pendant, not from G-code/i)
  })
})

// --- 8. Smoke / sanity -----------------------------------------------------

describe('laguna-swift contract: smoke / sanity', () => {
  it('rendered output is non-empty and ends in a newline', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    expect(gcode.length).toBeGreaterThan(200)
    expect(gcode.endsWith('\n')).toBe(true)
  })

  it('rendered output contains the "VCarve Pro post" header banner with machine name', async () => {
    const m = loadLagunaSwiftProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH)
    expect(linesOf(gcode).some((l) => l.includes('VCarve Pro post') && l.includes('Laguna Swift'))).toBe(true)
  })

  it('renderPost good-citizen call (workCoordinateIndex=1, dustCollection=true, in-band feeds) is operational', async () => {
    // Smoke test that the documented "good shape" of a Laguna call still
    // produces a renderable program. We do NOT pin warnings to [] here
    // because the safe-Z validator may surface advisory warnings for the
    // sample toolpath's specific Z values vs profile.safeRetractZMm = 25;
    // a future cycle can tighten this once the sample's safe-Z is
    // demonstrated zero-warning.
    const m = loadLagunaSwiftProfile()
    const result = await renderPost(RESOURCES_ROOT, m, SAMPLE_LAGUNA_TOOLPATH, {
      workCoordinateIndex: 1,
      dustCollection: true
    })
    expect(result.gcode.length).toBeGreaterThan(200)
    expect(Array.isArray(result.warnings)).toBe(true)
  })

  it('doc records the known-good fixture recommendation (600 x 400 mm plywood, 6 mm end mill)', () => {
    // Pin the doc's snapshot recipe so future readers find it and use it
    // when extending Laguna coverage rather than reinventing one.
    expect(referenceText).toMatch(/600 .*400 mm plywood/i)
    expect(referenceText).toMatch(/6 mm end mill/)
  })
})
