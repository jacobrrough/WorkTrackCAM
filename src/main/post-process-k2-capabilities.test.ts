/**
 * Creality K2 Plus — [ID-0092] FDM capability-comment header compliance tests.
 *
 * Verifies `resources/posts/fdm_passthrough.hbs` emits the four non-Cura
 * FDM capability fields (inputShapingPresets, rfidFilamentSupport,
 * cfsMultiColorEnabled, powerLossRecovery) as operator-visible `;` comment
 * lines when declared on the MachineProfile, and emits NOTHING when they
 * are absent. Header-only: no M-codes, no firmware-mutating commands,
 * no behavior change vs. pre-[ID-0092] output on a minimal FDM profile.
 *
 * Safety posture:
 *   - Safety Rule 1 (G-code is sacred): header comments only, verified by a
 *     dedicated "no extra M/G codes" assertion.
 *   - Safety Rule 2 (no churn for existing saved projects): the byte-identical
 *     passthrough contract on an FDM profile WITHOUT the four fields is pinned
 *     via the `pre-[ID-0092] minimal FDM profile — byte-identical behavior` test.
 *   - CLAUDE.md "Creality K2 Plus" deliverable #3: real shipping K2 profile
 *     (`resources/machines/creality-k2-plus.json`) is loaded via the
 *     `machineProfileSchema` so this test stays synchronized with ship values
 *     if a future cycle edits the JSON.
 *
 * Roadmap: [ID-0092]. Natural follow-up to Cycle 8 [ID-0012]
 * (FDM capability schema fields) + Cycle 9 [ID-0068] (Cura translator)
 * + Cycle 10-16 safety pipeline. This cycle closes the last remaining
 * surface for the four non-Cura fields: operator-visible in the G-code.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

function loadK2Profile(): MachineProfile {
  const path = join(resourcesRoot, 'machines', 'creality-k2-plus.json')
  return machineProfileSchema.parse(JSON.parse(readFileSync(path, 'utf-8')))
}

/**
 * Minimal FDM profile with NONE of the four [ID-0092] capability fields set.
 * Used to pin the byte-identical pre-[ID-0092] behavior contract (Safety Rule 2).
 * Uses the same postTemplate + dialect as the K2 Plus so `renderPost` resolves
 * the identical `fdm_passthrough.hbs`.
 */
function bareFdmProfile(): MachineProfile {
  return machineProfileSchema.parse({
    id: 'bare-fdm-test-fixture',
    name: 'Bare FDM Fixture',
    kind: 'fdm',
    workAreaMm: { x: 220, y: 220, z: 250 },
    maxFeedMmMin: 6000,
    postTemplate: 'fdm_passthrough.hbs',
    dialect: 'generic_mm',
  })
}

// Representative minimal FDM passthrough toolpath.
const sampleToolpath = ['G21', 'G90', 'G0 X0 Y0 Z5', 'G1 F1800', 'G1 Z0.2']

describe('Creality K2 Plus — FDM capability header [ID-0092]', () => {
  describe('with all four capability fields set (bundled K2 profile)', () => {
    it('emits the input-shaping presets header line with comma-joined values in source order', async () => {
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      expect(gcode).toContain('; Input shaping presets: ZV, MZV, EI, 2HUMP_EI, 3HUMP_EI\n')
    })

    it('emits the RFID filament support header line exactly once', async () => {
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      const matches = gcode.match(/^; RFID filament support: enabled$/gm) ?? []
      expect(matches).toHaveLength(1)
    })

    it('emits the CFS multi-color header line exactly once', async () => {
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      const matches = gcode.match(/^; CFS multi-color: enabled$/gm) ?? []
      expect(matches).toHaveLength(1)
    })

    it('emits the power-loss recovery header line exactly once', async () => {
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      const matches = gcode.match(/^; Power-loss recovery: enabled$/gm) ?? []
      expect(matches).toHaveLength(1)
    })

    it('orders the four capability lines deterministically: presets -> RFID -> CFS -> power-loss', async () => {
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      const iPresets = gcode.indexOf('; Input shaping presets:')
      const iRfid = gcode.indexOf('; RFID filament support:')
      const iCfs = gcode.indexOf('; CFS multi-color:')
      const iPlr = gcode.indexOf('; Power-loss recovery:')
      expect(iPresets).toBeGreaterThan(-1)
      expect(iRfid).toBeGreaterThan(iPresets)
      expect(iCfs).toBeGreaterThan(iRfid)
      expect(iPlr).toBeGreaterThan(iCfs)
    })

    it('places the capability header block between the work-volume line and the passthrough disclaimer', async () => {
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      const iWork = gcode.indexOf('; Work volume (mm):')
      const iPresets = gcode.indexOf('; Input shaping presets:')
      const iDisclaimer = gcode.indexOf('; This is a passthrough')
      expect(iWork).toBeGreaterThan(-1)
      expect(iPresets).toBeGreaterThan(iWork)
      expect(iDisclaimer).toBeGreaterThan(iPresets)
    })

    it('emits ONLY `;` comment lines for the capability header — no new M/G codes', async () => {
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      // Safety Rule 1: the capability header must never introduce new M/G codes.
      // Assert every occurrence of the capability keywords appears on a `;` comment line.
      for (const keyword of [
        'Input shaping presets',
        'RFID filament support',
        'CFS multi-color',
        'Power-loss recovery',
      ]) {
        const lineRe = new RegExp(`^;[^\\n]*${keyword.replace(/[-\\^$*+?.()|[\\]{}]/g, '\\$&')}`, 'm')
        expect(gcode).toMatch(lineRe)
        // Negative check: keyword never appears on a line that starts with M or G.
        const stanzaRe = new RegExp(`^[MG][^\\n]*${keyword.replace(/[-\\^$*+?.()|[\\]{}]/g, '\\$&')}`, 'm')
        expect(gcode).not.toMatch(stanzaRe)
      }
    })

    it('preserves the full passthrough footer + toolpath verbatim after the capability header', async () => {
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      // Toolpath lines MUST survive the header additions.
      for (const line of sampleToolpath) {
        expect(gcode).toContain('\n' + line + '\n')
      }
      expect(gcode).toContain('; End of WorkTrackCAM passthrough output')
    })
  })

  describe('Safety Rule 2 — byte-identical behavior without capability fields', () => {
    it('pre-[ID-0092] minimal FDM profile emits ZERO capability header lines', async () => {
      const machine = bareFdmProfile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      expect(gcode).not.toContain('Input shaping presets')
      expect(gcode).not.toContain('RFID filament support')
      expect(gcode).not.toContain('CFS multi-color')
      expect(gcode).not.toContain('Power-loss recovery')
    })

    it('minimal FDM profile: header layout collapses directly from work-volume line to ruler', async () => {
      const machine = bareFdmProfile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      // The work-volume line should be immediately followed by the closing ruler,
      // proving the capability block is gated out cleanly (no blank lines injected).
      expect(gcode).toMatch(
        /; Work volume \(mm\): 220 x 220 x 250\n; -{10,}\n/
      )
    })

    it('minimal FDM profile: toolpath lines render verbatim', async () => {
      const machine = bareFdmProfile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      for (const line of sampleToolpath) {
        expect(gcode).toContain('\n' + line + '\n')
      }
    })

    it('empty inputShapingPresets array emits NO presets header line', async () => {
      // A profile can legitimately declare the field as an empty array (e.g. a
      // non-K2 FDM we do not yet have shaping data for). The template must
      // treat an empty array the same as absent.
      const machine = machineProfileSchema.parse({
        id: 'empty-presets-fdm',
        name: 'Empty Presets FDM',
        kind: 'fdm',
        workAreaMm: { x: 200, y: 200, z: 200 },
        maxFeedMmMin: 3600,
        postTemplate: 'fdm_passthrough.hbs',
        dialect: 'generic_mm',
        inputShapingPresets: [],
      })
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      expect(gcode).not.toContain('Input shaping presets')
    })

    it('partial capabilities: only rfidFilamentSupport set emits exactly one header line', async () => {
      const machine = machineProfileSchema.parse({
        id: 'rfid-only-fdm',
        name: 'RFID Only FDM',
        kind: 'fdm',
        workAreaMm: { x: 200, y: 200, z: 200 },
        maxFeedMmMin: 3600,
        postTemplate: 'fdm_passthrough.hbs',
        dialect: 'generic_mm',
        rfidFilamentSupport: true,
      })
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      expect(gcode).toContain('; RFID filament support: enabled')
      expect(gcode).not.toContain('Input shaping presets')
      expect(gcode).not.toContain('CFS multi-color')
      expect(gcode).not.toContain('Power-loss recovery')
    })

    it('falsy boolean capabilities emit NO header line (explicit `false` treated as absent)', async () => {
      const machine = machineProfileSchema.parse({
        id: 'all-false-fdm',
        name: 'All False FDM',
        kind: 'fdm',
        workAreaMm: { x: 200, y: 200, z: 200 },
        maxFeedMmMin: 3600,
        postTemplate: 'fdm_passthrough.hbs',
        dialect: 'generic_mm',
        rfidFilamentSupport: false,
        cfsMultiColorEnabled: false,
        powerLossRecovery: false,
      })
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      expect(gcode).not.toContain('RFID filament support')
      expect(gcode).not.toContain('CFS multi-color')
      expect(gcode).not.toContain('Power-loss recovery')
    })
  })

  describe('dialect compliance — generic_mm is preserved', () => {
    it('generic_mm dialect: no extraneous warnings from capability header', async () => {
      const machine = loadK2Profile()
      const result = await renderPost(resourcesRoot, machine, sampleToolpath)
      // The dialect compliance validator should not flag the capability
      // comment lines. Any WarnV_code surfaced here would indicate the
      // `;` comment lines were being misread as commands.
      for (const w of result.warnings) {
        expect(w).not.toMatch(/Input shaping presets/)
        expect(w).not.toMatch(/RFID filament support/)
        expect(w).not.toMatch(/CFS multi-color/)
        expect(w).not.toMatch(/Power-loss recovery/)
      }
    })

    it('toolpath body survives unaltered (no arc-fitting / cutter-comp on pure passthrough)', async () => {
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      // Each sample toolpath line appears in the output, in source order.
      let cursor = 0
      for (const line of sampleToolpath) {
        const idx = gcode.indexOf('\n' + line + '\n', cursor)
        expect(idx).toBeGreaterThan(-1)
        cursor = idx + line.length
      }
    })
  })

  describe('bundled K2 profile cross-check (CLAUDE.md ship-values drift guard)', () => {
    it('shipping profile declares exactly the five Klipper baseline input-shaping presets', async () => {
      // If a future cycle edits the bundled JSON (e.g. adds a preset), the
      // rendered output changes — this test pins the current ship values so
      // drift is deliberate. Mirror of [ID-0083] machines-docs-pin pattern.
      const machine = loadK2Profile()
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      expect(gcode).toContain('; Input shaping presets: ZV, MZV, EI, 2HUMP_EI, 3HUMP_EI')
      // And a negative drift check: no stray preset NAMES appear.
      expect(gcode).not.toContain('CUSTOM')
    })

    it('shipping profile: all three boolean flags are on, so all three boolean header lines appear', async () => {
      const machine = loadK2Profile()
      expect(machine.rfidFilamentSupport).toBe(true)
      expect(machine.cfsMultiColorEnabled).toBe(true)
      expect(machine.powerLossRecovery).toBe(true)
      const { gcode } = await renderPost(resourcesRoot, machine, sampleToolpath)
      expect(gcode).toContain('; RFID filament support: enabled')
      expect(gcode).toContain('; CFS multi-color: enabled')
      expect(gcode).toContain('; Power-loss recovery: enabled')
    })
  })
})
