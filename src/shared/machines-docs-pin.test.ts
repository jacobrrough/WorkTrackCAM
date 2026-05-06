/**
 * docs/MACHINES.md -- docs-drift guard [ID-0083] (Cycle 15, docs-and-dx).
 *
 * This test file is the pin between the operator-facing reference doc
 * (docs/MACHINES.md) and the bundled profile JSONs under
 * resources/machines/. It exists because machine-facing numbers (temp
 * ceilings, spindle HP, chuck radius, vacuum zones, safe retracts) are
 * quoted in two places:
 *
 *   1. docs/MACHINES.md -- what an operator reads before bolting a part in.
 *   2. resources/machines/<id>.json + machine-schema.ts -- what the runtime
 *      actually enforces.
 *
 * If either side drifts, the doc misleads the operator or the runtime
 * quietly deviates from documented behavior. This test asserts the
 * documented numbers ARE the shipping numbers, AND the documented module
 * references (pre-upload validator, bounded-read helper, IPC resolver) are
 * still present in the doc body after any future docs restructure.
 *
 * Safety Rule 2 (schema changes need migrations):
 *   Any bundled profile value bump that deviates from what MACHINES.md
 *   still says will fail this gate. Either the profile change is wrong
 *   and must be reverted, or MACHINES.md must be updated in the same
 *   cycle to match the new reality. No silent drift.
 *
 * Scope: the bundled values for the three target machines' capability
 * fields added in Cycles 4-14 (roadmap IDs [ID-0005], [ID-0006], [ID-0008],
 * [ID-0012], [ID-0070], [ID-0073], [ID-0075], [ID-0078]). Identity fields
 * (id / kind / dialect / workAreaMm) are already pinned by the
 * per-machine meta tests and are NOT re-pinned here.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema } from './machine-schema'

const repoRoot = join(__dirname, '..', '..')

function loadMachinesMd(): string {
  return readFileSync(join(repoRoot, 'docs', 'MACHINES.md'), 'utf-8')
}

function loadK2() {
  return machineProfileSchema.parse(
    JSON.parse(
      readFileSync(
        join(repoRoot, 'resources', 'machines', 'creality-k2-plus.json'),
        'utf-8'
      )
    )
  )
}

function loadLaguna() {
  return machineProfileSchema.parse(
    JSON.parse(
      readFileSync(
        join(repoRoot, 'resources', 'machines', 'laguna-swift-5x10.json'),
        'utf-8'
      )
    )
  )
}

function loadCarvera4() {
  return machineProfileSchema.parse(
    JSON.parse(
      readFileSync(
        join(repoRoot, 'resources', 'machines', 'makera-carvera-4axis.json'),
        'utf-8'
      )
    )
  )
}

function loadCarvera3() {
  return machineProfileSchema.parse(
    JSON.parse(
      readFileSync(
        join(repoRoot, 'resources', 'machines', 'makera-carvera-3axis.json'),
        'utf-8'
      )
    )
  )
}

describe('docs/MACHINES.md pins [ID-0083]', () => {
  describe('K2 Plus FDM capability table', () => {
    it('documents `maxNozzleTempC` at the bundled value of 350 C', () => {
      const doc = loadMachinesMd()
      const m = loadK2()
      expect(m.maxNozzleTempC).toBe(350)
      // Doc table row: `| `maxNozzleTempC` | `350` |` -- assert both
      // the field name and value appear in the same line for robustness
      // to column-ordering changes.
      const lines = doc.split('\n')
      const row = lines.find((l) => l.includes('`maxNozzleTempC`'))
      expect(row).toBeDefined()
      expect(row).toMatch(/`350`/)
    })

    it('documents `maxBedTempC` at the bundled value of 120 C', () => {
      const doc = loadMachinesMd()
      const m = loadK2()
      expect(m.maxBedTempC).toBe(120)
      const row = doc.split('\n').find((l) => l.includes('`maxBedTempC`'))
      expect(row).toBeDefined()
      expect(row).toMatch(/`120`/)
    })

    it('documents `chamberTempC` at the bundled value of 60 C', () => {
      const doc = loadMachinesMd()
      const m = loadK2()
      expect(m.chamberTempC).toBe(60)
      const row = doc.split('\n').find((l) => l.includes('`chamberTempC`'))
      expect(row).toBeDefined()
      expect(row).toMatch(/`60`/)
    })

    it('documents the input-shaping presets that ship with the bundled profile', () => {
      const doc = loadMachinesMd()
      const m = loadK2()
      const presets = m.inputShapingPresets ?? []
      // Every shipping preset MUST appear by name in the doc -- a future
      // slicer UI change that drops a preset from the bundled list
      // without updating the doc will trip this gate.
      for (const preset of presets) {
        expect(doc).toContain(preset)
      }
      // Sanity: Klipper baseline presets ship in the bundled profile.
      expect(presets).toEqual(
        expect.arrayContaining(['ZV', 'MZV', 'EI', '2HUMP_EI', '3HUMP_EI'])
      )
    })

    it('documents `rfidFilamentSupport = true` consistent with the bundled profile', () => {
      const doc = loadMachinesMd()
      const m = loadK2()
      expect(m.rfidFilamentSupport).toBe(true)
      expect(doc).toMatch(/`rfidFilamentSupport`\s*\|\s*`true`/)
    })

    it('documents `cfsMultiColorEnabled = true` consistent with the bundled profile', () => {
      const doc = loadMachinesMd()
      const m = loadK2()
      expect(m.cfsMultiColorEnabled).toBe(true)
      expect(doc).toMatch(/`cfsMultiColorEnabled`\s*\|\s*`true`/)
    })

    it('documents `powerLossRecovery = true` consistent with the bundled profile', () => {
      const doc = loadMachinesMd()
      const m = loadK2()
      expect(m.powerLossRecovery).toBe(true)
      expect(doc).toMatch(/`powerLossRecovery`\s*\|\s*`true`/)
    })

    it('documents the K2 work area at the bundled 350 mm on every axis', () => {
      const doc = loadMachinesMd()
      const m = loadK2()
      // Cycle 4 [ID-0006] reduced the slicer def from 500 to 350 on every
      // axis to prevent a crash on first print. If this value ever
      // regresses to 500 the doc is the operator-facing landmine.
      expect(m.workAreaMm.x).toBe(350)
      expect(m.workAreaMm.y).toBe(350)
      expect(m.workAreaMm.z).toBe(350)
      expect(doc).toMatch(/350 ×\s*350 ×\s*350 mm/)
    })
  })

  describe('Laguna Swift 5x10 fields', () => {
    it('documents `spindleVariantHp = 3` at the bundled value', () => {
      const doc = loadMachinesMd()
      const m = loadLaguna()
      expect(m.spindleVariantHp).toBe(3)
      expect(doc).toMatch(/spindleVariantHp:\s*3/)
    })

    it('documents `vacuumZoneCount = 6` at the bundled value', () => {
      const doc = loadMachinesMd()
      const m = loadLaguna()
      expect(m.vacuumZoneCount).toBe(6)
      expect(doc).toMatch(/vacuumZoneCount:\s*6/)
    })

    it('documents `safeRetractZMm = 25` at the bundled value', () => {
      const doc = loadMachinesMd()
      const m = loadLaguna()
      expect(m.safeRetractZMm).toBe(25)
      expect(doc).toMatch(/safeRetractZMm:\s*25/)
    })

    it('documents the Mach3-superset dialect-reuse decision for RichAuto', () => {
      const doc = loadMachinesMd()
      // The post template explicitly reuses the mach3 dialect because
      // RichAuto A-series accepts a Mach3 superset. If the profile ever
      // switches to a dedicated `richauto_a` enum this doc claim becomes
      // stale and operators reading it would be misled.
      expect(doc).toMatch(/mach3/i)
      expect(doc).toMatch(/RichAuto/i)
    })

    it('documents `laguna-vacuum-allocator.ts` module path with the [ID-0014b] tag (Cycle 98)', () => {
      const doc = loadMachinesMd()
      // Cycle 98 [ID-0014b] landed the 6-zone vacuum allocator. The
      // operator-facing reference doc must point at the implementation
      // module so an operator (or future maintainer) can find the
      // engagement rule in the code.
      expect(doc).toMatch(/`laguna-vacuum-allocator\.ts`/)
      expect(doc).toMatch(/\.\.\/src\/shared\/laguna-vacuum-allocator\.ts/)
      expect(doc).toMatch(/\[ID-0014b\]/)
    })

    it('documents `laguna-full-sheet-stock.ts` module path with the [ID-0014] tag (Cycle 97)', () => {
      const doc = loadMachinesMd()
      expect(doc).toMatch(/`laguna-full-sheet-stock\.ts`/)
      expect(doc).toMatch(/\.\.\/src\/shared\/laguna-full-sheet-stock\.ts/)
      // [ID-0014] occurs both bare and as [ID-0014b]; assert we have the bare
      // form somewhere in the file so the Cycle-97 reference is not dropped.
      expect(doc).toMatch(/\[ID-0014\](?!b)/)
    })

    it('documents the three sheet planforms (48x96 / 48x48 / 24x48 in)', () => {
      const doc = loadMachinesMd()
      expect(doc).toMatch(/full sheet \(48 . 96 in\)/i)
      expect(doc).toMatch(/half sheet \(48 . 48 in\)/i)
      expect(doc).toMatch(/quarter sheet \(24 . 48 in\)/i)
    })

    it('documents the four sheet thicknesses (1/4, 1/2, 3/4, 1 in)', () => {
      const doc = loadMachinesMd()
      expect(doc).toMatch(/1\/4, 1\/2, 3\/4, 1 in/)
    })

    it('documents the two sheet materials (plywood, MDF)', () => {
      const doc = loadMachinesMd()
      expect(doc).toMatch(/plywood, MDF/i)
    })

    it('documents the engagement-pattern summary (full -> 6, half -> 4, quarter -> 2)', () => {
      const doc = loadMachinesMd()
      // The default-origin (margin = 0) engagement counts are the
      // operator-facing summary lines; if the allocator changes its
      // engagement rule (e.g. inclusive vs strict-positive overlap)
      // these counts will move and operators reading the doc would
      // be misled.
      expect(doc).toMatch(/full sheet . all 6 zones/i)
      expect(doc).toMatch(/half sheet . 4 zones/i)
      expect(doc).toMatch(/quarter sheet . 2 zones/i)
    })

    it('references the one-shot helper names (`resolveLagunaFullSheet` and `allocateLagunaVacuumZonesForSheet`)', () => {
      const doc = loadMachinesMd()
      expect(doc).toMatch(/resolveLagunaFullSheet/)
      expect(doc).toMatch(/allocateLagunaVacuumZonesForSheet/)
    })

    it('preserves the existing `vacuumZoneCount: 6` pin after the Cycle 99 docs refresh', () => {
      // Regression-style: the Cycle 15 [ID-0083] pin still holds.
      const doc = loadMachinesMd()
      expect(doc).toMatch(/vacuumZoneCount:\s*6/)
    })
  })

  describe('Carvera 4-axis rotary chuck', () => {
    it('documents `rotaryChuckOuterRadiusMm = 46` at the bundled value', () => {
      const doc = loadMachinesMd()
      const m = loadCarvera4()
      expect(m.rotaryChuckOuterRadiusMm).toBe(46)
      expect(doc).toMatch(/rotaryChuckOuterRadiusMm:\s*46/)
    })

    it('documents the HD module diameter rationale (92 mm -> 46 mm radius)', () => {
      const doc = loadMachinesMd()
      // CLAUDE.md USER CONTEXT #3 pins the harmonic-drive module at
      // "max ~92 mm diameter". The doc must connect the 46 mm chuck
      // radius to the 92 mm module so a future reader can verify.
      expect(doc).toMatch(/92 mm/)
    })

    it('documents the A-axis continuous-rotation sentinel of 99999', () => {
      const doc = loadMachinesMd()
      const m = loadCarvera4()
      expect(m.aAxisRangeDeg).toBe(99999)
      expect(doc).toMatch(/99999/)
    })
  })

  describe('Moonraker upload safety pipeline references', () => {
    it('references the pre-upload temperature validator module by path', () => {
      const doc = loadMachinesMd()
      // The doc's safety-pipeline section must point operators to the
      // real enforcement point -- a link to a moved/renamed file is
      // worse than no link at all.
      expect(doc).toMatch(/src\/shared\/gcode-temp-validator\.ts/)
    })

    it('references the Moonraker push implementation by path', () => {
      const doc = loadMachinesMd()
      expect(doc).toMatch(/src\/main\/moonraker-push\.ts/)
    })

    it('references the bounded header-read helper by path', () => {
      const doc = loadMachinesMd()
      expect(doc).toMatch(/src\/main\/gcode-header-read\.ts/)
    })

    it('references the IPC capability-resolving handler by path', () => {
      const doc = loadMachinesMd()
      expect(doc).toMatch(/src\/main\/ipc-fabrication\.ts/)
    })

    it('documents the 128 KiB header-read cap', () => {
      const doc = loadMachinesMd()
      // Perf cycle [ID-0075] pinned the header read at 128 KiB. The
      // operator-facing note must quote this number so any future cap
      // change is accompanied by a doc update.
      expect(doc).toMatch(/128 KiB/)
    })

    it('documents the zero-bytes-on-wire safety property on violation', () => {
      const doc = loadMachinesMd()
      // The critical property a K2 operator relies on: when the
      // validator flags a temp violation, NO bytes cross the network.
      // Paraphrase-tolerant match: "no bytes" + "network" in the same
      // sentence neighborhood.
      const lines = doc.split('\n')
      const hit = lines.find(
        (l) =>
          /no bytes/i.test(l) &&
          /network/i.test(l) &&
          !l.trim().startsWith('>')
      )
      expect(hit, 'MACHINES.md must spell out that no bytes cross the network when temp validation rejects an upload').toBeDefined()
    })
  })

  describe('ATC capability per-machine summary [ID-0093]', () => {
    // Cycle 55 [ID-0093] landed the schema-side ATC plumbing
    // (`atcSlotCount` + `atcProbeSlot` optional fields on
    // `machineProfileSchema` + the `deriveAtcCapability` helper in
    // `src/shared/post-process-atc-capability.ts`). Cycle 56
    // [ID-0067-data-v8] documented this in MACHINES.md and these
    // pins keep the doc table aligned with the bundled profiles.
    // If a future profile change bumps a slot count, removes a probe
    // slot, or renames a field, this gate fires before any operator
    // reads stale ATC capability claims.

    it('documents the dedicated `## ATC capability (per-machine summary)` section header', () => {
      const doc = loadMachinesMd()
      // Operators discovering the doc must be able to find the ATC
      // capability summary by section name. The header must be a
      // top-level `##` so it appears in the rendered TOC alongside
      // "Smoothieware quirks" and "Dialect reference".
      expect(doc).toMatch(/^## ATC capability \(per-machine summary\)$/m)
    })

    it('references the `deriveAtcCapability` helper by name and module path', () => {
      const doc = loadMachinesMd()
      // The doc must point operators (and future maintainers) at the
      // single source of truth for ATC capability decisions. A renamed
      // helper or moved file would mislead anyone reading the doc.
      expect(doc).toContain('deriveAtcCapability')
      expect(doc).toMatch(/src\/shared\/post-process-atc-capability\.ts/)
    })

    it('documents the discriminated-union shape of the helper return type', () => {
      const doc = loadMachinesMd()
      // Safety Rule 3 (no `any`) is encoded into the helper as a
      // discriminated union. The doc must surface that shape so
      // call-site authors know to pattern-match on `.supported`.
      expect(doc).toContain('supported: false')
      expect(doc).toContain('supported: true')
      expect(doc).toMatch(/reason:\s*'fdm'|reason:\s*'no-atc-slots'/)
    })

    it('pins the Carvera 3-axis bundled profile at atcSlotCount=6 and atcProbeSlot=0', () => {
      const doc = loadMachinesMd()
      const m = loadCarvera3()
      // CLAUDE.md USER CONTEXT #3: T1-T6 cutting + T0 wireless probe.
      // If the bundled profile ever drifts off these values, the doc
      // table is the operator-facing landmine.
      expect(m.atcSlotCount).toBe(6)
      expect(m.atcProbeSlot).toBe(0)
      // Per-machine row in the ATC summary table must cite both values.
      const lines = doc.split('\n')
      const row = lines.find((l) =>
        l.includes('`makera-carvera-3axis`') && l.includes('`6`') && l.includes('`0`')
      )
      expect(row, 'MACHINES.md ATC table must cite Carvera 3-axis with atcSlotCount=6 and atcProbeSlot=0 in the same row').toBeDefined()
    })

    it('pins the Carvera 4-axis bundled profile as omitting both atcSlotCount and atcProbeSlot', () => {
      const m = loadCarvera4()
      // The 4-axis profile intentionally OMITS both fields because the
      // rotary chuck occupies the ATC bay. This is non-negotiable: if
      // either field appears on the 4-axis profile a future M6 emit
      // would crash the spindle into the rotary fixture.
      expect(m.atcSlotCount).toBeUndefined()
      expect(m.atcProbeSlot).toBeUndefined()
    })

    it('documents the Carvera 4-axis row as `(absent)` -> `no-atc-slots`', () => {
      const doc = loadMachinesMd()
      // The doc must explicitly tell the operator that 4-axis mode has
      // no ATC. The summary row pairs `(absent)` with the helper's
      // `'no-atc-slots'` reason so the operator can grep either way.
      const lines = doc.split('\n')
      const row = lines.find((l) =>
        l.includes('`makera-carvera-4axis`') && l.includes('(absent)') && l.includes("'no-atc-slots'")
      )
      expect(row, 'MACHINES.md ATC table must cite Carvera 4-axis with absent fields and no-atc-slots reason').toBeDefined()
    })

    it('documents the Laguna row as `(absent)` -> `no-atc-slots` (manual ER-20 collet)', () => {
      const doc = loadMachinesMd()
      const m = loadLaguna()
      // Laguna is a 3-axis CNC but uses a manual ER-20 collet, so the
      // bundled profile leaves both ATC fields unset. The doc table
      // must reflect this so an operator looking for ATC support on
      // their Laguna doesn't incorrectly assume there is one.
      expect(m.atcSlotCount).toBeUndefined()
      expect(m.atcProbeSlot).toBeUndefined()
      const lines = doc.split('\n')
      const row = lines.find((l) =>
        l.includes('`laguna-swift-5x10`') && l.includes('(absent)') && l.includes("'no-atc-slots'")
      )
      expect(row, 'MACHINES.md ATC table must cite Laguna Swift with absent fields and no-atc-slots reason').toBeDefined()
    })

    it('documents the K2 Plus row as `(n/a)` -> `fdm` short-circuit', () => {
      const doc = loadMachinesMd()
      const m = loadK2()
      // FDM machines have no tool-changer concept, so the helper
      // short-circuits on `kind === 'fdm'` before reading the ATC
      // fields at all. The doc must reflect this so an operator
      // doesn't try to populate ATC fields on the FDM profile.
      expect(m.kind).toBe('fdm')
      const lines = doc.split('\n')
      const row = lines.find((l) =>
        l.includes('`creality-k2-plus`') && l.includes('(n/a)') && l.includes("'fdm'")
      )
      expect(row, 'MACHINES.md ATC table must cite K2 Plus with n/a fields and fdm reason').toBeDefined()
    })

    it('cites the [ID-0093] roadmap entry on both Carvera bundled-profile sections', () => {
      const doc = loadMachinesMd()
      // [ID-0093] is the source-of-truth roadmap ticket for the ATC
      // schema fields + the helper. Both Carvera sections must cite
      // it so a future reader can trace the why and the follow-up
      // M-code emission cycle.
      const matches = doc.match(/\[ID-0093\]/g) ?? []
      expect(matches.length).toBeGreaterThanOrEqual(2)
    })

    it('documents the `M-code emission lands in a follow-up cycle` half-and-half claim', () => {
      const doc = loadMachinesMd()
      // Cycle 55 is the FIRST half of [ID-0093] -- schema + helper
      // under tests, no template edits. The doc must surface this
      // staging so a future reader doesn't assume the post template
      // is already wired and start emitting unsafe M6 macros.
      expect(doc).toMatch(/M-code emission lands in a follow-up cycle/i)
      expect(doc).toMatch(/Safety Rule 1/i)
    })
  })
})
