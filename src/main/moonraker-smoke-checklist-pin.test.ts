/**
 * Smoke-checklist pin -- [P2-K2-PUSH]
 *
 * Ensures `docs/SMOKE-K2-MOONRAKER.md` stays in lockstep with the actual
 * Moonraker wire endpoints used by `src/main/moonraker-push.ts` and the
 * IPC handlers wired in `src/main/ipc-fabrication.ts`.
 *
 * Failure shape: if the production code renames an endpoint (e.g. swap
 * `/printer/print/start` to a new Moonraker rev) without updating the
 * smoke checklist, the operator-facing doc drifts and Jacob's bench
 * procedure goes stale. This file asserts the doc references every load-
 * bearing endpoint and IPC handler by string match, so the next CI run
 * reds out before the drift escapes the repo.
 *
 * Companion to (not a replacement for):
 *   - `src/main/moonraker-push-e2e.test.ts` (mock-Moonraker wire pins).
 *   - `src/main/k2-moonraker-upload-contract.test.ts` (doc-tied invariant
 *     pins against `.claude/skills/gcode-safety/references/k2-plus-fdm.md`).
 *   - `src/main/moonraker-push-pin.test.ts` (paired-pin source-text pins).
 *
 * Safety posture:
 *   - Safety Rule 1 (G-code is sacred): no G-code emitted; doc-vs-code
 *     drift gate only.
 *   - Safety Rule 2 (additive/optional): new test file; no schema
 *     changes; no public-surface changes.
 *   - Safety Rule 4 (no security vulnerabilities): pure file reads
 *     against in-repo paths; no network; no subprocess.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DOC_PATH = join(process.cwd(), 'docs', 'SMOKE-K2-MOONRAKER.md')
const PUSH_PATH = join(process.cwd(), 'src', 'main', 'moonraker-push.ts')
const IPC_PATH = join(process.cwd(), 'src', 'main', 'ipc-fabrication.ts')
const REF_PATH = join(
  process.cwd(),
  '.claude',
  'skills',
  'gcode-safety',
  'references',
  'k2-plus-fdm.md'
)
const MACHINE_PATH = join(process.cwd(), 'resources', 'machines', 'creality-k2-plus.json')

const docText = readFileSync(DOC_PATH, 'utf-8')
const pushText = readFileSync(PUSH_PATH, 'utf-8')
const ipcText = readFileSync(IPC_PATH, 'utf-8')
const refText = readFileSync(REF_PATH, 'utf-8')
const machine = JSON.parse(readFileSync(MACHINE_PATH, 'utf-8')) as {
  workAreaMm: { x: number; y: number; z: number }
  maxNozzleTempC: number
  maxBedTempC: number
  chamberTempC: number
}

describe('[P2-K2-PUSH] smoke-checklist pin -- docs/SMOKE-K2-MOONRAKER.md', () => {
  describe('A. file existence + Phase 2 anchors', () => {
    it('A1: doc file exists with non-trivial body', () => {
      expect(docText.length).toBeGreaterThan(2_000)
      expect(docText).toMatch(/^# Creality K2 Plus -- Moonraker push smoke checklist/m)
    })

    it('A2: doc declares its Phase 2 [P2-K2-PUSH] tag', () => {
      expect(docText).toContain('[P2-K2-PUSH]')
    })

    it('A3: doc references the CLAUDE.md PHASE 2 directive header', () => {
      expect(docText).toContain('PHASE 2 -- END-TO-END INTEGRATION')
    })

    it('A4: doc cross-references docs/SLICING.md for the slicer arm of K2 Plus DoD', () => {
      expect(docText).toContain('docs/SLICING.md')
    })
  })

  describe('B. wire endpoints stay in sync with src/main/moonraker-push.ts', () => {
    // The 6 endpoints actually used in production. If any rename, the doc
    // pin reds out so the operator-facing checklist gets updated in the
    // same change.
    const endpoints: ReadonlyArray<readonly [string, string]> = [
      ['/server/files/upload', 'upload (multipart)'],
      ['/printer/print/start', 'start print'],
      ['/printer/objects/query', 'status query'],
      ['/printer/print/cancel', 'cancel'],
      ['/printer/print/pause', 'pause'],
      ['/printer/print/resume', 'resume'],
    ]

    for (const [endpoint, label] of endpoints) {
      it(`B-${endpoint}: production code uses '${endpoint}' (${label})`, () => {
        expect(pushText).toContain(endpoint)
      })

      it(`B-${endpoint}-doc: smoke checklist mentions '${endpoint}' (${label})`, () => {
        expect(docText).toContain(endpoint)
      })
    }

    it('B-server-info: doc tells the operator to curl /server/info as pre-flight (Moonraker readiness probe)', () => {
      expect(docText).toContain('/server/info')
    })
  })

  describe('C. IPC handler names stay in sync with src/main/ipc-fabrication.ts', () => {
    const ipcChannels: ReadonlyArray<string> = [
      'moonraker:push',
      'moonraker:status',
      'moonraker:cancel',
      'moonraker:pause',
      'moonraker:resume',
    ]

    for (const channel of ipcChannels) {
      it(`C-${channel}: production IPC registers '${channel}'`, () => {
        expect(ipcText).toContain(`'${channel}'`)
      })

      it(`C-${channel}-doc: smoke checklist mentions '${channel}'`, () => {
        expect(docText).toContain(channel)
      })
    }
  })

  describe('D. machine-profile values match resources/machines/creality-k2-plus.json', () => {
    it('D1: K2 Plus build volume 350 x 350 x 350 mm appears in the doc', () => {
      expect(machine.workAreaMm).toEqual({ x: 350, y: 350, z: 350 })
      expect(docText).toContain('350 x 350 x 350 mm')
    })

    it('D2: nozzle ceiling 350 C appears in the doc', () => {
      expect(machine.maxNozzleTempC).toBe(350)
      expect(docText).toContain('nozzle <= 350 C')
    })

    it('D3: bed ceiling 120 C appears in the doc', () => {
      expect(machine.maxBedTempC).toBe(120)
      expect(docText).toContain('bed <= 120 C')
    })

    it('D4: chamber ceiling 60 C appears in the doc', () => {
      expect(machine.chamberTempC).toBe(60)
      expect(docText).toContain('chamber <= 60 C')
    })
  })

  describe('E. step structure is intact (operator follows steps 0..7)', () => {
    const stepHeaders = [
      '## Step 0 -- pre-flight',
      '## Step 1 -- mock-server sanity',
      '## Step 2 -- launch and configure WorkTrackCAM',
      '## Step 3 -- upload-only test',
      '## Step 4 -- upload + start a 5-minute air-print',
      '## Step 5 -- pause / resume / cancel',
      '## Step 6 -- failure-mode dry runs',
      '## Step 7 -- the real benchy',
    ]
    for (const header of stepHeaders) {
      it(`E-${header}: present`, () => {
        expect(docText).toContain(header)
      })
    }

    it('E-step-0-must-precede-others: pre-flight is step 0, not buried later', () => {
      const idx = docText.indexOf('## Step 0 -- pre-flight')
      const idx7 = docText.indexOf('## Step 7 -- the real benchy')
      expect(idx).toBeGreaterThan(0)
      expect(idx7).toBeGreaterThan(idx)
    })
  })

  describe('F. Jacob sign-off lines are present (paper trail)', () => {
    // Every load-bearing step except 0/1/2 (pre-flight + mock + launch)
    // gets a sign-off line. The final benchy line is the [P2-K2-PUSH]
    // Definition-of-Done acceptance gate.
    const signoffSteps = ['Step 3 PASS', 'Step 4 PASS', 'Step 5 PASS', 'Step 6 PASS']
    for (const label of signoffSteps) {
      it(`F-${label}: sign-off line present`, () => {
        expect(docText).toContain(`- [ ] ${label}`)
      })
    }

    it('F-final-acceptance: calibration-cube acceptance gate present', () => {
      expect(docText).toContain('Calibration cube printed via WorkTrackCAM Moonraker push')
    })
  })

  describe('G. safety anchors -- pre-upload validator + AbortController', () => {
    it('G1: doc names the pre-upload temperature validator [ID-0073]', () => {
      expect(docText).toContain('[ID-0073]')
      expect(pushText).toContain('[ID-0073]')
    })

    it('G2: doc names the AbortController-bound timeout [ID-0082]', () => {
      expect(docText).toContain('[ID-0082]')
      expect(pushText).toContain('[ID-0082]')
    })

    it('G3: doc lists the 6.4 / 6.5 over-ceiling failure-mode dry runs (M109 S400, M190 S150)', () => {
      // The two canonical over-ceiling fixtures from the e2e test.
      expect(docText).toMatch(/M109\s+S400/)
      expect(docText).toMatch(/M190\s+S150/)
    })

    it('G4: doc names the Fluidd .gcode filename filter (anti-pattern from k2-plus-fdm.md)', () => {
      // Reference doc warns that `.g` / `.nc` get filtered. Doc must
      // surface this so the operator knows to keep the .gcode suffix.
      expect(refText).toContain('.gcode')
      expect(docText).toMatch(/\.gcode/)
      expect(docText).toContain('.g')
    })
  })

  describe('H. cross-references to test surfaces are accurate', () => {
    const testPaths = [
      'src/main/moonraker-push-e2e.test.ts',
      'src/main/k2-moonraker-upload-contract.test.ts',
      'src/main/moonraker-push-pin.test.ts',
      'src/main/moonraker-push.ts',
      'src/main/ipc-fabrication.ts',
      'src/renderer/src/moonraker-push-payload-pin.test.ts',
      '.claude/skills/gcode-safety/references/k2-plus-fdm.md',
    ]
    for (const p of testPaths) {
      it(`H-${p}: doc cross-references '${p}'`, () => {
        expect(docText).toContain(p)
      })
    }
  })

  describe('I. doc does NOT instruct the operator to bypass safety', () => {
    // Negative pins: the doc must NOT contain phrases that would bypass
    // the production safety gates. If a future edit removes these checks
    // we want the test to red out.
    it('I1: doc does NOT recommend disabling the temperature validator', () => {
      expect(docText).not.toMatch(/disable.*temp.*validator/i)
      expect(docText).not.toMatch(/skip.*ceiling/i)
    })

    it('I2: doc does NOT recommend pushing to a printer outside the operator\'s LAN', () => {
      // The safety net IS the LAN; this is an explicit warning we want
      // present in the doc.
      expect(docText).toMatch(/safety net is your LAN/i)
    })

    it('I3: doc gates Step 4 (auto-start) on Step 3 (upload-only) passing first', () => {
      expect(docText).toMatch(/ONLY proceed if Step 3 passed/)
    })

    it('I4: doc requires an air-print before a real benchy', () => {
      expect(docText).toMatch(/air-print/i)
    })
  })

  describe('J. on-disk source provenance', () => {
    it('J1: doc exists at the canonical path', () => {
      expect(DOC_PATH).toMatch(/SMOKE-K2-MOONRAKER\.md$/)
      expect(docText.length).toBeGreaterThan(0)
    })

    it('J2: doc has a Last updated date in 2026', () => {
      expect(docText).toMatch(/\*\*Last updated\*\*: 2026-/)
    })

    it('J3: doc has at most one trailing newline (no double-newline tail drift)', () => {
      expect(docText.endsWith('\n')).toBe(true)
      expect(docText.endsWith('\n\n')).toBe(false)
    })
  })
})
