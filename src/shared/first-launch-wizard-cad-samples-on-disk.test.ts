/**
 * UNIFY 2: pin that the three bundled CadQuery starter scripts exist on
 * disk under `resources/samples/cad/` and that each one is referenced by
 * `WIZARD_MACHINE_TO_CAD_SAMPLE`.
 *
 * If a future cleanup accidentally deletes `bracket.cq.py`, `sign.cq.py`,
 * or `cylinder.cq.py`, this test fails and the first-launch wizard's
 * "Start a parametric design" 4th option breaks silently otherwise --
 * the `wizard:readCadSample` IPC returns `ok: false` and the wizard
 * surfaces a soft error instead of crashing, but the user never sees
 * the bundled starter. The on-disk pin keeps these files load-bearing.
 *
 * Companion to `FirstLaunchWizard.test.tsx` (which pins the in-process
 * mapping) and `ipc-wizard.test.ts` (which pins the IPC contract with
 * mocked fs).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { WIZARD_MACHINE_TO_CAD_SAMPLE } from './first-launch-wizard-contract'

describe('bundled CadQuery starter scripts', () => {
  const cadDir = resolve(__dirname, '..', '..', 'resources', 'samples', 'cad')

  it('ships the three required starter scripts on disk', () => {
    const required = ['bracket.cq.py', 'sign.cq.py', 'cylinder.cq.py']
    for (const fileName of required) {
      const fullPath = resolve(cadDir, fileName)
      expect(existsSync(fullPath), `missing bundled CadQuery sample: ${fullPath}`).toBe(true)
      // Sanity-check size so a future zero-byte truncation also fails fast.
      const size = statSync(fullPath).size
      expect(size, `bundled CadQuery sample is empty: ${fullPath}`).toBeGreaterThan(100)
    }
  })

  it('each WIZARD_MACHINE_TO_CAD_SAMPLE entry points at an existing file', () => {
    for (const [machineId, entry] of Object.entries(WIZARD_MACHINE_TO_CAD_SAMPLE)) {
      const fullPath = resolve(cadDir, entry.fileName)
      expect(
        existsSync(fullPath),
        `${machineId} -> ${entry.fileName} is missing on disk`
      ).toBe(true)
    }
  })

  it('bracket.cq.py reads as plausible CadQuery (imports cadquery + assigns result)', () => {
    const src = readFileSync(resolve(cadDir, 'bracket.cq.py'), 'utf-8')
    expect(src).toMatch(/import\s+cadquery/)
    expect(src).toMatch(/result\s*=/)
    expect(src).toMatch(/show_object\(/)
  })

  it('sign.cq.py reads as plausible CadQuery (text + extrude)', () => {
    const src = readFileSync(resolve(cadDir, 'sign.cq.py'), 'utf-8')
    expect(src).toMatch(/import\s+cadquery/)
    expect(src).toMatch(/\.text\(/)
    expect(src).toMatch(/result\s*=/)
  })

  it('cylinder.cq.py reads as plausible CadQuery (cylinder geometry + helical pattern)', () => {
    const src = readFileSync(resolve(cadDir, 'cylinder.cq.py'), 'utf-8')
    expect(src).toMatch(/import\s+cadquery/)
    // Helical/rotary cue: pitch and groove parameters.
    expect(src).toMatch(/helix|groove|pitch/)
    expect(src).toMatch(/result\s*=/)
  })
})
