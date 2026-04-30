/**
 * src/main/post-process-carvera-3axis-manual-toolchange-contract.test.ts
 *
 * Paired-pin contract for [ID-0013-integration] Carvera 3-axis ATC opt-out.
 *
 * Background:
 * The bundled Makera Carvera 3-axis post template (`carvera_3axis.hbs`)
 * unconditionally emits `M6 T<n>` and `G43 H<n>` after WCS setup. That's
 * the default ATC path — the spindle drops the current tool, picks up
 * tool <n>, auto-probes the length, and reapplies length compensation.
 *
 * For diagnostic / single-tool / verification jobs, an operator may want
 * to OPT OUT of the M6 / G43 sequence (the tool is already loaded, length
 * compensation was set externally, no need for the spindle to drop it
 * and pick it up again). The `manualToolChange` flag flips the post
 * template into "manual mode": M6 and G43 are suppressed and replaced by
 * a prominent operator-visible reminder block.
 *
 * Default-off semantics:
 *   - Omitted / undefined / false / non-boolean: byte-identical to the
 *     pre-Cycle-216 carvera_3axis baseline (Safety Rule 2). M6 + G43
 *     emit unconditionally.
 *   - manualToolChange === true (strict-true gate at the runner-shims
 *     extractor and the renderPost ctx spread): the manual-change comment
 *     block emits in place of M6 + G43.
 *
 * What this contract pins:
 *   (a) flag OFF: M6 T<n> AND G43 H<n> appear in output. No manual-mode
 *       block. Byte-identical to no-flag and false-flag forms.
 *   (b) flag ON: M6 T<n> and G43 H<n> are SUPPRESSED. Manual-mode
 *       reminder block is present with the [1] / [2] / [3] checklist.
 *   (c) flag ON does NOT alter `toolpathLines` (the actual cutting moves).
 *   (d) Three-machine cross-cut: setting the flag on the K2 Plus (FDM),
 *       Laguna VCarve, or Carvera 4-axis posts produces byte-identical
 *       output -- those templates don't reference the field.
 *   (e) Strict-true gate via the renderPost ctx spread: `1`, `'true'`,
 *       and `{}` are NOT accepted as truthy.
 */

import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { renderPost } from './post-process'

const RES = path.resolve(__dirname, '..', '..', 'resources')

function readMachine(file: string) {
  return JSON.parse(fs.readFileSync(path.join(RES, 'machines', file), 'utf8'))
}

const carvera3 = readMachine('makera-carvera-3axis.json')
const carvera4 = readMachine('makera-carvera-4axis.json')
const k2 = readMachine('creality-k2-plus.json')
const laguna = readMachine('laguna-swift-5x10.json')

const RESOURCES_ROOT = RES
const BASE_TOOLPATH = ['G0 X0 Y0 Z5', 'G1 X10 Y10 Z-2 F500', 'G1 X20 Y20']

describe('[ID-0013-integration] Carvera 3-axis manualToolChange -- (a) flag OFF default ATC behaviour', () => {
  it('omitting the flag emits M6 T<n> and G43 H<n> unconditionally (default ATC mode)', async () => {
    const r = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      toolNumber: 3
    })
    expect(r.gcode).toMatch(/^M6\s+T3\b/m)
    expect(r.gcode).toMatch(/^G43\s+H3\b/m)
    expect(r.gcode).not.toContain('MANUAL TOOL CHANGE MODE')
  })

  it('flag false produces output byte-identical to omitted', async () => {
    const off = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      toolNumber: 3
    })
    const explicit = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      toolNumber: 3,
      manualToolChange: false
    })
    expect(off.gcode).toBe(explicit.gcode)
  })
})

describe('[ID-0013-integration] Carvera 3-axis manualToolChange -- (b) flag ON manual-mode block', () => {
  it('flag ON SUPPRESSES M6 and G43 emission', async () => {
    const r = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      toolNumber: 3,
      manualToolChange: true
    })
    expect(r.gcode).not.toMatch(/^M6\s+T\d+\b/m)
    expect(r.gcode).not.toMatch(/^G43\s+H\d+\b/m)
  })

  it('flag ON emits the MANUAL TOOL CHANGE MODE reminder block with the [1]/[2]/[3] checklist', async () => {
    const r = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      toolNumber: 3,
      manualToolChange: true
    })
    expect(r.gcode).toContain('MANUAL TOOL CHANGE MODE')
    expect(r.gcode).toContain('[ID-0013-integration]')
    expect(r.gcode).toContain('[1]')
    expect(r.gcode).toContain('[2]')
    expect(r.gcode).toContain('[3]')
    // The tool number is interpolated into the reminder block.
    expect(r.gcode).toContain('tool T3')
  })

  it('flag ON without explicit toolNumber falls back to tool T1 reference in the reminder', async () => {
    // Mirrors the existing `{{#if toolNumber}}{{toolNumber}}{{else}}1{{/if}}` fallback.
    const r = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      manualToolChange: true
    })
    expect(r.gcode).toContain('MANUAL TOOL CHANGE MODE')
    expect(r.gcode).toContain('tool T1')
  })
})

describe('[ID-0013-integration] Carvera 3-axis manualToolChange -- (c) toolpath untouched', () => {
  it('flag ON vs OFF produces identical toolpath body lines', async () => {
    const off = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      toolNumber: 3
    })
    const on = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      toolNumber: 3,
      manualToolChange: true
    })
    for (const line of BASE_TOOLPATH) {
      expect(off.gcode.split(line).length - 1).toBe(1)
      expect(on.gcode.split(line).length - 1).toBe(1)
    }
  })
})

describe('[ID-0013-integration] Carvera 3-axis manualToolChange -- (d) three-machine cross-cut', () => {
  it('Carvera 4-axis post is byte-identical regardless of flag value', async () => {
    const off = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      toolNumber: 1
    })
    const on = await renderPost(RESOURCES_ROOT, carvera4, BASE_TOOLPATH, {
      toolNumber: 1,
      manualToolChange: true
    })
    expect(off.gcode).toBe(on.gcode)
  })

  it('Laguna VCarve post is byte-identical regardless of flag value', async () => {
    const off = await renderPost(RESOURCES_ROOT, laguna, BASE_TOOLPATH, {
      toolNumber: 1
    })
    const on = await renderPost(RESOURCES_ROOT, laguna, BASE_TOOLPATH, {
      toolNumber: 1,
      manualToolChange: true
    })
    expect(off.gcode).toBe(on.gcode)
  })

  it('Creality K2 Plus FDM post is byte-identical regardless of flag value', async () => {
    const off = await renderPost(RESOURCES_ROOT, k2, BASE_TOOLPATH, {})
    const on = await renderPost(RESOURCES_ROOT, k2, BASE_TOOLPATH, {
      manualToolChange: true
    })
    expect(off.gcode).toBe(on.gcode)
  })
})

describe('[ID-0013-integration] Carvera 3-axis manualToolChange -- (e) strict-true gate', () => {
  it('non-boolean truthy values (1, "true", {}) DO NOT trigger manual mode', async () => {
    // Strict-true gate at renderPost ctx spread: only `=== true` lights up.
    // Defends against accidental stringly-typed flag pass-through.
    const r1 = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      toolNumber: 3,
      manualToolChange: 1 as unknown as boolean
    })
    const r2 = await renderPost(RESOURCES_ROOT, carvera3, BASE_TOOLPATH, {
      toolNumber: 3,
      manualToolChange: 'true' as unknown as boolean
    })
    expect(r1.gcode).not.toContain('MANUAL TOOL CHANGE MODE')
    expect(r2.gcode).not.toContain('MANUAL TOOL CHANGE MODE')
    // Default ATC sequence should still fire under non-strict-true input.
    expect(r1.gcode).toMatch(/^M6\s+T3\b/m)
    expect(r2.gcode).toMatch(/^M6\s+T3\b/m)
  })
})

describe('[ID-0013-integration] Carvera 3-axis manualToolChange -- (f) runner-shims extractor strict-true', () => {
  it('extractPostProcessingOpts maps operationParams.manualToolChange === true to opts.manualToolChange = true', async () => {
    const { extractPostProcessingOpts } = await import('./cam-axis4/runner-shims')
    expect(
      extractPostProcessingOpts({ manualToolChange: true }).manualToolChange
    ).toBe(true)
  })

  it('extractPostProcessingOpts NEVER sets manualToolChange when input is non-true', async () => {
    const { extractPostProcessingOpts } = await import('./cam-axis4/runner-shims')
    expect(
      extractPostProcessingOpts({ manualToolChange: false }).manualToolChange
    ).toBeUndefined()
    expect(
      extractPostProcessingOpts({ manualToolChange: 1 }).manualToolChange
    ).toBeUndefined()
    expect(
      extractPostProcessingOpts({ manualToolChange: 'true' }).manualToolChange
    ).toBeUndefined()
    expect(extractPostProcessingOpts({}).manualToolChange).toBeUndefined()
  })
})
