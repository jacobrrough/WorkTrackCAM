/**
 * src/main/post-process-carvera-3axis-atc-footer-safety.test.ts
 *
 * Wave-B [ID-0013] integration pin: the Carvera 3-axis ATC tool-change
 * emission and the program-end footer must hold their SAFETY invariants
 * SIMULTANEOUSLY, in BOTH ATC-enabled and manualToolChange opt-out modes.
 *
 * Why a new file rather than extending the existing pins:
 *   - `post-process-carvera-3axis-contract.test.ts` (Cycle 67 [ID-0155])
 *     pins the ATC-ENABLED header/footer ordering, but does NOT exercise
 *     the `manualToolChange: true` opt-out.
 *   - `post-process-carvera-3axis-manual-toolchange-contract.test.ts`
 *     ([ID-0013-integration]) pins that the opt-out SUPPRESSES M6/G43 and
 *     prints the reminder block, but does NOT co-assert that the program-end
 *     FOOTER survives the opt-out (M2 preserved, G49 still cancels TLC, and
 *     — the single most burned-by Carvera gotcha — M30 NEVER appears).
 *
 * The gap this file closes: a future template edit that wraps the footer in
 * the same `{{#if manualToolChange}}…{{else}}…{{/if}}` block as the M6/G43
 * sequence (an easy mistake when refactoring the tool-change region) could
 * silently drop the M2 footer — or worse, leak an M30 — in manual mode while
 * every existing pin stayed green. CLAUDE.md Safety Rule 1: G-code is sacred.
 *
 * Pure read-side: renders the bundled `carvera_3axis.hbs` against the bundled
 * `makera-carvera-3axis.json` profile via `renderPost`. No fixture writes, no
 * snapshots (byte layout is already snapshotted in
 * `post-process-gcode-snapshot.test.ts` — this file pins the SAFETY semantics,
 * not the exact bytes).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

const RESOURCES_ROOT = join(process.cwd(), 'resources')

function loadCarvera3AxisProfile(): MachineProfile {
  return machineProfileSchema.parse(
    JSON.parse(
      readFileSync(
        join(RESOURCES_ROOT, 'machines', 'makera-carvera-3axis.json'),
        'utf-8'
      )
    )
  )
}

/**
 * Representative single-tool 3-axis pass. Z stays inside [0, 140], feeds
 * inside the 2400 mm/min ceiling, pure 3-axis (no A-word).
 */
const SAMPLE_3AXIS_TOOLPATH = [
  'G0 X10.000 Y10.000 Z140.000',
  'G1 X10.000 Y10.000 Z2.000 F600',
  'G1 X100.000 Y10.000 Z2.000 F2400',
  'G0 Z140.000'
]

/**
 * Assert the Smoothieware program-end footer is intact in a rendered program:
 *   - M2 program-end terminator IS present (line-anchored).
 *   - G49 (cancel tool-length compensation) IS present.
 *   - M30 NEVER appears as an emitted line (it may only appear inside the
 *     "NOT M30 — M30 may delete file" comment, which is not line-anchored).
 *
 * Shared by the ATC-enabled and manual-mode describe blocks so a single
 * helper edit keeps both modes' footer expectations in lockstep.
 */
function expectSmoothiewareFooterIntact(gcode: string): void {
  // M2 program end — line-anchored so the comment "NOT M30 …" can't satisfy it.
  expect(gcode).toMatch(/^M2\b/m)
  // G49 cancels TLC before the final retract (mandatory; leaking TLC corrupts
  // the next program's Z origin).
  expect(gcode).toMatch(/^G49\b/m)
  // The most burned-by Carvera gotcha: an emitted M30 deletes the running file
  // from the SD card on community firmware. It must NEVER appear as a command.
  expect(gcode).not.toMatch(/^M30\b/m)
}

// ─── ATC enabled: M6 + G43 with matched tool / H numbers AND a safe footer ───

describe('Carvera 3-axis ATC footer-safety [ID-0013] — ATC enabled', () => {
  it('explicit toolNumber=4 emits M6 T4 then G43 H4 (matched pair) AND keeps the M2/G49 footer with no M30', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH, {
      toolNumber: 4
    })
    const lines = gcode.split('\n')
    const m6Idx = lines.findIndex((l) => /^M6 T4\b/.test(l))
    expect(m6Idx).toBeGreaterThan(-1)
    // G43 H<n> on the line DIRECTLY after M6 T<n>, with the SAME number — the
    // controller would otherwise apply the wrong (or no) tool-length offset.
    expect(lines[m6Idx + 1] ?? '').toMatch(/^G43 H4\b/)
    // No stray default T1/H1 leak when an explicit tool was requested.
    expect(gcode).not.toMatch(/^M6 T1\b/m)
    expect(gcode).not.toMatch(/^G43 H1\b/m)
    expectSmoothiewareFooterIntact(gcode)
  })

  it('default tool (no toolNumber) emits M6 T1 then G43 H1 AND keeps the safe footer', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH)
    const lines = gcode.split('\n')
    const m6Idx = lines.findIndex((l) => /^M6 T1\b/.test(l))
    expect(m6Idx).toBeGreaterThan(-1)
    expect(lines[m6Idx + 1] ?? '').toMatch(/^G43 H1\b/)
    expectSmoothiewareFooterIntact(gcode)
  })

  it('emits exactly ONE M6 and ONE G43 in a single-tool template program (no duplicate tool-change block)', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH, {
      toolNumber: 2
    })
    const m6Count = (gcode.match(/^M6 T\d+\b/gm) ?? []).length
    const g43Count = (gcode.match(/^G43 H\d+\b/gm) ?? []).length
    expect(m6Count).toBe(1)
    expect(g43Count).toBe(1)
  })
})

// ─── manualToolChange opt-out: M6/G43 absent, footer STILL safe ──────────────

describe('Carvera 3-axis ATC footer-safety [ID-0013] — manualToolChange opt-out', () => {
  it('manual mode suppresses ALL M6 and G43 emission yet PRESERVES the M2/G49 footer with no M30', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH, {
      toolNumber: 4,
      manualToolChange: true
    })
    // No automatic tool change is emitted in manual mode…
    expect(gcode).not.toMatch(/^M6 T\d+\b/m)
    expect(gcode).not.toMatch(/^G43 H\d+\b/m)
    // …but the program-end footer is NOT gated by the opt-out — it stays safe.
    expectSmoothiewareFooterIntact(gcode)
  })

  it('manual-mode footer is byte-identical to the ATC-enabled footer (only the tool-change region differs)', async () => {
    const m = loadCarvera3AxisProfile()
    const { gcode: atc } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH, {
      toolNumber: 4
    })
    const { gcode: manual } = await renderPost(RESOURCES_ROOT, m, SAMPLE_3AXIS_TOOLPATH, {
      toolNumber: 4,
      manualToolChange: true
    })
    // Slice each program from its "; --- End ---" footer banner to EOF and
    // require the two footers to match exactly. This pins that the opt-out
    // never reaches past the tool-change block into the footer.
    const footerOf = (g: string): string => {
      const idx = g.indexOf('; --- End ---')
      expect(idx).toBeGreaterThan(-1)
      return g.slice(idx)
    }
    expect(footerOf(manual)).toBe(footerOf(atc))
  })
})
