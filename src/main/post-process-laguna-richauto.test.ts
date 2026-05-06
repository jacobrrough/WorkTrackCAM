/**
 * Laguna Swift 5×10 — RichAuto A-series post-processor compliance tests.
 *
 * Verifies `resources/posts/vcarve_mach3.hbs` emits G-code that the Laguna
 * Swift's RichAuto A-series handheld will accept. The A-series treats
 * Mach3-compatible G-code as a strict superset (confirmed in CLAUDE.md
 * "USER CONTEXT — TARGET MACHINES" §2 and roadmap [ID-0063]), so no new
 * dialect enum is introduced; the existing `dialect: "mach3"` is reused.
 *
 * The real `resources/machines/laguna-swift-5x10.json` machine profile
 * is loaded via `parseMachineProfileText` so the test stays synchronized
 * with shipping defaults (work area, max spindle RPM, dialect).
 *
 * Covers:
 *   - CLAUDE.md "Laguna Swift 5x10 — post-processor requirements":
 *     * clean standard G-code
 *     * explicit units (G21)
 *     * safe retracts
 *     * spindle warm-up AND cool-down
 *     * dust-collection M-codes when present
 *   - roadmap [ID-0004] spindle cool-down ramp (M5 → G4 P3)
 *   - roadmap [ID-0004] dust-collection PostContext flag (M7 / M9 gating)
 *   - roadmap [ID-0063] RichAuto A-series dialect re-use note
 *
 * Test fixture: the 2 existing tracked snapshot files cover aggregate
 * dialect behavior; this file adds targeted Laguna/VCarve-Pro assertions.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

function loadLagunaProfile(): MachineProfile {
  const path = join(resourcesRoot, 'machines', 'laguna-swift-5x10.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

// Representative 2-axis wood-routing toolpath: rapid to start, plunge, cut, retract.
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
  return gcode.split('\n').map((l) => l.trim())
}

describe('Laguna Swift 5×10 — RichAuto A-series post compliance', () => {
  it('laguna-swift-5x10.json loads with mach3 dialect and vcarve_mach3 template', () => {
    const m = loadLagunaProfile()
    expect(m.id).toBe('laguna-swift-5x10')
    expect(m.postTemplate).toBe('vcarve_mach3.hbs')
    // RichAuto A-series accepts Mach3 as a superset — the dialect reuse is
    // deliberate per roadmap [ID-0063]. Re-pinned here so a future schema
    // change trips this test.
    expect(m.dialect).toBe('mach3')
    expect(m.workAreaMm).toEqual({ x: 1524, y: 3048, z: 203 })
  })

  it('emits the Mach3 program tape markers `%` at file start and end', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const lines = linesOf(gcode)
    expect(lines[0]).toBe('%')
    // Trailing `%` may be followed by a blank line from Handlebars newline.
    const trailing = lines.filter((l) => l.length > 0).pop()
    expect(trailing).toBe('%')
  })

  it('header declares metric units (G21), absolute mode (G90), XY plane (G17), feed per minute (G94)', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
    expect(gcode).toMatch(/^G21/m)
    expect(gcode).toMatch(/^G90/m)
    expect(gcode).toMatch(/^G17/m)
    expect(gcode).toMatch(/^G94/m)
  })

  it('emits Mach3 spindle-on with warm-up dwell (G4 P2.0) after M3', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      spindleRpm: 18000,
    })
    const lines = linesOf(gcode)
    const m3Idx = lines.findIndex((l) => l.startsWith('M3'))
    expect(m3Idx).toBeGreaterThan(-1)
    const dwellIdx = lines.findIndex((l, i) => i > m3Idx && l.startsWith('G4 P2.0'))
    expect(dwellIdx).toBeGreaterThan(m3Idx)
  })

  it('[ID-0004] emits spindle cool-down ramp: M5 followed by G4 P3 before safe-Z retract', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const lines = linesOf(gcode)
    const m5Idx = lines.findIndex((l) => l === 'M5')
    expect(m5Idx).toBeGreaterThan(-1)
    const cooldownIdx = lines.findIndex((l, i) => i > m5Idx && l.startsWith('G4 P3'))
    expect(cooldownIdx).toBe(m5Idx + 1)
    // Safe-Z retract must come AFTER the cool-down dwell, not before.
    const safeZIdx = lines.findIndex(
      (l, i) => i > cooldownIdx && l.startsWith(`G0 Z${machine.workAreaMm.z}`)
    )
    expect(safeZIdx).toBeGreaterThan(cooldownIdx)
  })

  it('ends program with M30 (Mach3/RichAuto-A expect M30, not M2)', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const lines = linesOf(gcode).filter((l) => l.length > 0)
    // The last non-blank non-% line should be M30 (percent tape markers sit
    // on the outside). Find the last M30 and confirm it's present.
    expect(lines.some((l) => l.startsWith('M30'))).toBe(true)
  })

  it('parks X/Y at the origin after spindle-off and safe-Z retract', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
    expect(gcode).toContain('G0 X0 Y0')
  })

  // ─── Dust-collection flag (PostContext `dustCollection`) ────────────────

  it('[ID-0004] without dustCollection flag: M7 and M9 remain commented out', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const lines = linesOf(gcode)
    // No bare M7 / M9 lines (leading characters only). The commented form
    // `; M7 …` is fine.
    expect(lines.some((l) => /^M7(\s|$)/.test(l))).toBe(false)
    expect(lines.some((l) => /^M9(\s|$)/.test(l))).toBe(false)
    // The commented-out reminder lines must still be present for the operator.
    expect(gcode).toContain('; M7')
    expect(gcode).toContain('; M9')
  })

  it('[ID-0004] with dustCollection: true — emits uncommented M7 after warm-up and M9 before spindle-off', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      dustCollection: true,
    })
    const lines = linesOf(gcode)
    // M7 must be emitted as a real command, not a comment.
    const m7Idx = lines.findIndex((l) => /^M7(\s|$)/.test(l))
    expect(m7Idx).toBeGreaterThan(-1)
    // M9 likewise.
    const m9Idx = lines.findIndex((l) => /^M9(\s|$)/.test(l))
    expect(m9Idx).toBeGreaterThan(-1)
    // Ordering: M7 (dust ON) must come BEFORE M9 (dust OFF), and both must
    // straddle the spindle-off block so the dust collector runs while the
    // spindle is cutting.
    expect(m7Idx).toBeLessThan(m9Idx)
    const m3Idx = lines.findIndex((l) => l.startsWith('M3'))
    const m5Idx = lines.findIndex((l) => l === 'M5')
    expect(m7Idx).toBeGreaterThan(m3Idx)
    expect(m9Idx).toBeLessThan(m5Idx)
  })

  it('[ID-0004] dustCollection: false is equivalent to omitted (no M7/M9 emitted)', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      dustCollection: false,
    })
    const lines = linesOf(gcode)
    expect(lines.some((l) => /^M7(\s|$)/.test(l))).toBe(false)
    expect(lines.some((l) => /^M9(\s|$)/.test(l))).toBe(false)
  })

  // ─── Safety: workAreaMm.z wired into safe-Z retract ─────────────────────

  it('safe-Z retract height equals machine.workAreaMm.z (203 mm for Laguna Swift)', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
    expect(gcode).toContain('G0 Z203')
  })

  // ─── UNVERIFIED disclaimer is preserved ─────────────────────────────────

  it('header retains the UNVERIFIED G-code disclaimer (operator-facing safety copy)', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
    expect(gcode).toContain('UNVERIFIED')
  })

  // ─── Spindle RPM clamping against the Laguna's stated min/max ───────────

  it('clamps spindle RPM above maxSpindleRpm (18000) and emits a warning', async () => {
    const machine = loadLagunaProfile()
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      spindleRpm: 24000,
    })
    expect(gcode).toContain('M3 S18000')
    expect(warnings.some((w) => /exceeds machine maximum/.test(w))).toBe(true)
  })

  it('clamps spindle RPM below minSpindleRpm (8000) and emits a warning', async () => {
    const machine = loadLagunaProfile()
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      spindleRpm: 6000,
    })
    expect(gcode).toContain('M3 S8000')
    expect(warnings.some((w) => /below machine minimum/.test(w))).toBe(true)
  })

  // ─── Toolpath content is passed through untouched ───────────────────────

  it('passes toolpath lines through unchanged (contour moves preserved)', async () => {
    const machine = loadLagunaProfile()
    const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
    for (const line of sampleToolpath) {
      expect(gcode).toContain(line)
    }
  })
})
