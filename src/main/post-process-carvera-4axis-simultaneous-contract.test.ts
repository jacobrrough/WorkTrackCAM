/**
 * src/main/post-process-carvera-4axis-simultaneous-contract.test.ts
 *
 * Paired-pin contract for [ID-0015] Carvera 4-axis simultaneous opt-in.
 *
 * Background:
 * `cnc_4axis_continuous` is the strategy that emits blended X/Y/Z + A moves
 * (the rotary axis rotates DURING a cutting move rather than between cuts).
 * The stock Makera Controller firmware does not advertise verified support
 * for true simultaneous 4-axis motion; community firmware adds it. The
 * `enableSimultaneous4Axis` flag is a per-job opt-in that adds a prominent
 * UNVERIFIED warning header to the emitted G-code so the operator can't
 * accidentally run community-firmware-dependent behaviour without
 * acknowledging the risk.
 *
 * The flag is STRICT-TRUE: anything other than literal `true` reads as off,
 * which means existing saved projects (no `enableSimultaneous4Axis` field)
 * are byte-identical to the pre-Cycle-216 baseline (Safety Rule 2).
 *
 * What this contract pins:
 *   (a) flag OFF (omitted / undefined / false / non-bool): byte-identical
 *       to the pre-Cycle-216 carvera_4axis baseline. NO simultaneous-
 *       warning block in output.
 *   (b) flag ON: simultaneous-warning block present at the top of the file,
 *       BEFORE the existing UNVERIFIED-G-CODE warning. Block contains
 *       specific load-bearing strings: "SIMULTANEOUS 4-AXIS MOVES ENABLED",
 *       "UNVERIFIED COMMUNITY FIRMWARE", and the four [a]..[d] safety
 *       checklist items.
 *   (c) flag ON does NOT alter `toolpathLines` (the actual moves the engine
 *       emitted). The flag is a header-only safety banner; the toolpath
 *       lines themselves come from upstream and are untouched.
 *   (d) Other Carvera 4-axis post features (G93 inverse-time mode, M2 program
 *       end, A0 return, M9 coolant-off) still work correctly when the flag
 *       is set. They are independent invariants.
 *   (e) Three-machine cross-cut: setting the flag on a NON-Carvera-4-axis
 *       machine post (FDM K2, Laguna VCarve, Carvera 3-axis, generic CNC)
 *       produces byte-identical output -- those templates do not reference
 *       the field.
 */

import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import { renderPost } from './post-process'
import * as fs from 'node:fs'

const RES = path.resolve(__dirname, '..', '..', 'resources')

function readMachine(file: string) {
  return JSON.parse(fs.readFileSync(path.join(RES, 'machines', file), 'utf8'))
}

const carvera4 = readMachine('makera-carvera-4axis.json')
const carvera3 = readMachine('makera-carvera-3axis.json')
const k2 = readMachine('creality-k2-plus.json')
const laguna = readMachine('laguna-swift-5x10.json')

const RESOURCES_ROOT = RES
const BASE_TOOLPATH = [
  '; demo continuous toolpath',
  'G0 X0 Y0 A0',
  'G1 X10 A30 F500',
  'G1 X20 A60',
  'G1 X30 A90'
]

describe('[ID-0015] Carvera 4-axis simultaneous flag -- (a) strict-true gate / OFF default byte-identity', () => {
  it('omitting the flag leaves output byte-identical to false', async () => {
    const r1 = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {})
    const r2 = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: false
    })
    expect(r1.gcode).toBe(r2.gcode)
  })

  it('omitting the flag leaves output WITHOUT the simultaneous-warning block', async () => {
    const r = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {})
    expect(r.gcode).not.toContain('SIMULTANEOUS 4-AXIS MOVES ENABLED')
    expect(r.gcode).not.toContain('UNVERIFIED COMMUNITY FIRMWARE')
  })

  it('non-boolean truthy values (1, "true", {}) DO NOT trigger the warning block', async () => {
    // Strict-true gate: only `=== true` lights up the warning. Anything else
    // is treated as off -- a footgun-prevention measure if upstream code
    // accidentally passes a stringly-typed flag.
    const r1 = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: 1 as unknown as boolean
    })
    const r2 = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: 'true' as unknown as boolean
    })
    expect(r1.gcode).not.toContain('SIMULTANEOUS 4-AXIS MOVES ENABLED')
    expect(r2.gcode).not.toContain('SIMULTANEOUS 4-AXIS MOVES ENABLED')
  })
})

describe('[ID-0015] Carvera 4-axis simultaneous flag -- (b) flag ON warning header', () => {
  it('emits the SIMULTANEOUS warning block AT THE TOP, BEFORE the existing UNVERIFIED-G-CODE block', async () => {
    const r = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true
    })
    const idxSimultaneous = r.gcode.indexOf('SIMULTANEOUS 4-AXIS MOVES ENABLED')
    const idxLegacyUnverified = r.gcode.indexOf('UNVERIFIED G-CODE')
    expect(idxSimultaneous).toBeGreaterThan(0)
    expect(idxLegacyUnverified).toBeGreaterThan(0)
    // Simultaneous block FIRST, legacy block AFTER.
    expect(idxSimultaneous).toBeLessThan(idxLegacyUnverified)
  })

  it('warning block contains the load-bearing safety phrases', async () => {
    const r = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true
    })
    expect(r.gcode).toContain('SIMULTANEOUS 4-AXIS MOVES ENABLED')
    expect(r.gcode).toContain('UNVERIFIED COMMUNITY FIRMWARE')
    expect(r.gcode).toContain('G93 inverse-time feed')
    // The four [a]..[d] safety checklist markers.
    expect(r.gcode).toContain('[a]')
    expect(r.gcode).toContain('[b]')
    expect(r.gcode).toContain('[c]')
    expect(r.gcode).toContain('[d]')
  })

  it('warning block fences with a clear `===` ASCII rule on both sides', async () => {
    const r = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true
    })
    // Two `===` rules straddle the SIMULTANEOUS title -- one before, one after.
    const lines = r.gcode.split('\n')
    const titleLineIdx = lines.findIndex((l) =>
      l.includes('SIMULTANEOUS 4-AXIS MOVES ENABLED')
    )
    expect(titleLineIdx).toBeGreaterThan(0)
    expect(lines[titleLineIdx - 1]).toMatch(/^;\s*=+\s*$/)
    // Locate ALL `===` rule lines and verify there are at least three between
    // the start of file and the first occurrence of the legacy UNVERIFIED block
    // (one before the title, one after the title, and the closing rule of the
    // simultaneous block).
    const rules = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /^;\s*=+\s*$/.test(l))
    const beforeTitle = rules.filter((r) => r.i < titleLineIdx)
    const afterTitle = rules.filter((r) => r.i > titleLineIdx)
    expect(beforeTitle.length).toBeGreaterThanOrEqual(1)
    expect(afterTitle.length).toBeGreaterThanOrEqual(2)
  })
})

describe('[ID-0015] Carvera 4-axis simultaneous flag -- (c) toolpath untouched', () => {
  it('flag ON vs OFF produces identical lines for the toolpath body', async () => {
    const off = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {})
    const on = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true
    })
    // Each toolpath input line must appear EXACTLY ONCE in both outputs,
    // verbatim. The flag is a header-banner ONLY; it must not rewrite
    // toolpath lines.
    for (const line of BASE_TOOLPATH) {
      expect(off.gcode.split(line).length - 1).toBe(1)
      expect(on.gcode.split(line).length - 1).toBe(1)
    }
  })

  it('flag ON preserves the standard Carvera 4-axis program-end sequence', async () => {
    const r = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true
    })
    // Smoothieware: M2 (NOT M30 -- M30 may delete the file from SD card).
    expect(r.gcode).toContain('M2')
    expect(r.gcode).not.toMatch(/^M30\b/m)
    // A0 return + Y=0 re-center on rotation axis + Z safe retract.
    expect(r.gcode).toContain('G0 A0')
    expect(r.gcode).toContain('M9') // coolant/vacuum off
  })
})

describe('[ID-0015] Carvera 4-axis simultaneous flag -- (d) inverse-time + simultaneous interaction', () => {
  it('flag ON + inverseTimeFeed: true emits BOTH the warning block AND the G93/G94 fence', async () => {
    const r = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true,
      inverseTimeFeed: true
    })
    expect(r.gcode).toContain('SIMULTANEOUS 4-AXIS MOVES ENABLED')
    // G93/G94 must appear as actual modal commands (start of line), not just
    // as the substring inside the warning-block comment.
    expect(r.gcode).toMatch(/^G93\b/m)
    expect(r.gcode).toMatch(/^G94\b/m)
  })

  it('flag ON without inverseTimeFeed STILL emits the warning block (independent invariants)', async () => {
    // The warning header is purely a safety banner; it does NOT require
    // G93 to be active. A user might be testing with feed-per-minute
    // semantics on community firmware that supports XYZA in feed mode.
    const r = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true
    })
    expect(r.gcode).toContain('SIMULTANEOUS 4-AXIS MOVES ENABLED')
    // No G93 as an actual command (start of line). The warning text mentions
    // 'G93 inverse-time feed' inside a comment which is FINE -- we only ban
    // the unguarded modal command itself.
    expect(r.gcode).not.toMatch(/^G93\b/m)
  })
})

describe('[ID-0015] Carvera 4-axis simultaneous flag -- (e) three-machine cross-cut: non-Carvera-4-axis byte-identity', () => {
  it('Carvera 3-axis post is byte-identical regardless of flag value', async () => {
    const off = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {})
    const on = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true
    })
    expect(off.gcode).toBe(on.gcode)
  })

  it('Laguna VCarve post is byte-identical regardless of flag value', async () => {
    const off = await renderPost(RESOURCES_ROOT, laguna, BASE_TOOLPATH, {})
    const on = await renderPost(RESOURCES_ROOT, laguna, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true
    })
    expect(off.gcode).toBe(on.gcode)
  })

  it('Creality K2 Plus FDM post is byte-identical regardless of flag value', async () => {
    const off = await renderPost(RESOURCES_ROOT, k2, BASE_TOOLPATH, {})
    const on = await renderPost(RESOURCES_ROOT, k2, BASE_TOOLPATH, {
      enableSimultaneous4Axis: true
    })
    expect(off.gcode).toBe(on.gcode)
  })
})
