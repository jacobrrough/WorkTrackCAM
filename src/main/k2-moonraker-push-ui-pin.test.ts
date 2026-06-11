/**
 * Phase 2 [P2-K2-PUSH]/Cycle 349 paired pin: K2 Plus "Send to Printer"
 * UI surface end-to-end IPC + harness plumbing.
 *
 * Mirrors the SOURCE-pin pattern of `k2-quality-preset-ipc-pin.test.ts`
 * (C344) and `carvera-tool-table-pin.test.ts` (C348). Each describe
 * block asserts the on-disk source text at one layer of the wire so a
 * careless rename, drop, or re-route at any layer fails CI BEFORE it
 * can ship.
 *
 * Layers covered (top → bottom of the renderer-→-Moonraker stack):
 *
 *   A. AppSettings schema declares `moonrakerUrl` (the renderer-side
 *      gating field). Roundtrip parse confirms `optional` semantics
 *      and that an empty payload is still accepted (Safety Rule 2).
 *   B. SliceManufacturePanel renders the Send-to-K2-Plus button only
 *      when active machine kind === 'fdm'; the button gating uses the
 *      three-condition rule (isK2Plus + lastSliceGcodePath + moonrakerUrl).
 *      Wave 3m INTENDED DRIFT: the button's dispatch now routes through
 *      the export-safety seam (`gcode-send-gate.ts#runK2PushSurface`),
 *      which owns the payload build + failure formatting + machineId
 *      threading the panel used to inline -- B5-B8 follow the wire into
 *      that module so the same end-to-end contract stays pinned.
 *   C. ManufactureAuxPanelsProps declares the new `lastSliceGcodePath`
 *      prop and the panel reads it via `p.lastSliceGcodePath`.
 *   D. ManufactureWorkspace tracks the slice output path in state
 *      (`lastSliceGcodePath`) and threads it into the aux-panel props.
 *   E. ipc-fabrication.ts still exposes the `moonraker:push` handler
 *      (pre-existing surface; this is a regression pin so the new UI
 *      cannot accidentally be wired against a deleted IPC channel).
 *   F. preload/index.ts still exposes the `moonrakerPush` bridge.
 *   G. The mock-Moonraker harness module exists at the directive's
 *      requested path and exports the expected helpers.
 *
 * Three-machine cross-cut: DIRECT on Creality K2 Plus (the only FDM
 * in the three-machine cohort; the Send button is gated on
 * `kind === 'fdm'`). INDIRECT on Laguna Swift 5x10 + Makera Carvera
 * (the button is hidden — pin G-block asserts the gate cannot leak
 * onto a non-FDM panel render).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { appSettingsSchema } from '../shared/project-schema'
import {
  freshMockMoonrakerState,
  resetMockMoonrakerState,
  startMockMoonraker,
  stopMockMoonraker
} from './__mocks__/moonraker-fake'

const REPO_ROOT = resolve(__dirname, '..', '..')
const SCHEMA_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'shared', 'project-schema.ts'),
  'utf8'
)
const PRELOAD_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'preload', 'index.ts'),
  'utf8'
)
const IPC_SRC = readFileSync(resolve(REPO_ROOT, 'src', 'main', 'ipc-fabrication.ts'), 'utf8')
const PANELS_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureAuxPanels.tsx'),
  'utf8'
)
const WORKSPACE_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'ManufactureWorkspace.tsx'),
  'utf8'
)
const SEND_GATE_SRC = readFileSync(
  resolve(REPO_ROOT, 'src', 'renderer', 'manufacture', 'gcode-send-gate.ts'),
  'utf8'
)
const FAKE_PATH = resolve(REPO_ROOT, 'src', 'main', '__mocks__', 'moonraker-fake.ts')
const FAKE_SRC = readFileSync(FAKE_PATH, 'utf8')

describe('A. AppSettings schema accepts moonrakerUrl', () => {
  it('A1: schema field is declared as z.string().optional() in source text', () => {
    expect(SCHEMA_SRC).toContain('moonrakerUrl: z.string().optional()')
  })

  it('A2: appSettingsSchema accepts moonrakerUrl="http://k2plus.local"', () => {
    const r = appSettingsSchema.safeParse({ moonrakerUrl: 'http://k2plus.local' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.moonrakerUrl).toBe('http://k2plus.local')
  })

  it('A3: appSettingsSchema accepts moonrakerUrl with port "http://192.168.1.50:7125"', () => {
    const r = appSettingsSchema.safeParse({ moonrakerUrl: 'http://192.168.1.50:7125' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.moonrakerUrl).toBe('http://192.168.1.50:7125')
  })

  it('A4: appSettingsSchema treats moonrakerUrl as optional (omit OK)', () => {
    const r = appSettingsSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.moonrakerUrl).toBeUndefined()
  })

  it('A5: schema docstring tags Phase 2 [P2-K2-PUSH] roadmap', () => {
    expect(SCHEMA_SRC).toContain('[P2-K2-PUSH]')
  })

  it('A6: schema docstring documents the field is K2-Plus-only (`fdm` machine kind)', () => {
    expect(SCHEMA_SRC).toMatch(/K2 Plus|active machine kind is\s+`?fdm`?/i)
  })
})

describe('B. SliceManufacturePanel gates the Send button on isK2Plus + path + url', () => {
  it('B1: panel source declares the `k2-send-to-printer-section` testid', () => {
    expect(PANELS_SRC).toContain('data-testid="k2-send-to-printer-section"')
  })

  it('B2: panel source declares the `k2-send-to-printer-button` testid', () => {
    expect(PANELS_SRC).toContain('data-testid="k2-send-to-printer-button"')
  })

  it('B3: button section is rendered only when isK2Plus is true', () => {
    // The literal `{isK2Plus ? (` precedes the section JSX and the
    // matching `: null}` follows — single-rooted ternary gate.
    expect(PANELS_SRC).toMatch(/isK2Plus \? \(\s*<section[\s\S]*?k2-send-to-printer-section/)
  })

  it('B4: canSendToK2 gating combines isK2Plus + sendCandidatePath + moonrakerUrl', () => {
    expect(PANELS_SRC).toContain('const canSendToK2 =')
    expect(PANELS_SRC).toMatch(
      /canSendToK2\s*=\s*[\s\S]*?isK2Plus[\s\S]*?sendCandidatePath\.length\s*>\s*0[\s\S]*?moonrakerUrl\.length\s*>\s*0/
    )
  })

  it('B5: button routes through runK2PushSurface, which builds the payload and uses the moonrakerPush IPC bridge', () => {
    // Wave 3m: the panel injects the IPC boundary; the seam owns the payload.
    expect(PANELS_SRC).toContain('await runK2PushSurface({')
    expect(PANELS_SRC).toContain('moonrakerPush: (payload) => window.fab.moonrakerPush(payload)')
    expect(SEND_GATE_SRC).toContain('buildMoonrakerPushPayload(')
    expect(SEND_GATE_SRC).toContain('await input.moonrakerPush(payload)')
  })

  it('B6: failure path calls formatMoonrakerPushFailure for a single-line toast (now inside the seam)', () => {
    expect(SEND_GATE_SRC).toContain('formatMoonrakerPushFailure(r)')
  })

  it('B7: payload threads machineId so the IPC resolver can apply temperature ceilings', () => {
    // Panel passes the active machine; the seam threads its id onto the payload.
    expect(PANELS_SRC).toContain('machine: p.activeMachine,')
    expect(SEND_GATE_SRC).toContain('machineId: input.machine?.id ?? null')
  })

  it('B8: success status mentions "Started on K2 Plus" so the operator sees the right label', () => {
    expect(SEND_GATE_SRC).toContain('Started on K2 Plus')
  })

  it('B9: busy state guards against double-click (k2SendBusy gate)', () => {
    expect(PANELS_SRC).toContain('const [k2SendBusy, setK2SendBusy] = useState(false)')
    expect(PANELS_SRC).toContain('disabled={!canSendToK2 || k2SendBusy}')
  })

  it('B10: Phase 2 roadmap tag tied to the surface', () => {
    expect(PANELS_SRC).toContain('[P2-K2-PUSH]')
  })
})

describe('C. ManufactureAuxPanelsProps declares the lastSliceGcodePath prop', () => {
  it('C1: prop is declared on the props type as `string | null` optional', () => {
    expect(PANELS_SRC).toMatch(/lastSliceGcodePath\?:\s*string\s*\|\s*null/)
  })

  it('C2: panel reads p.lastSliceGcodePath', () => {
    expect(PANELS_SRC).toContain('p.lastSliceGcodePath?.trim() ?? \'\'')
  })

  it('C3: prop docstring explains the on-disk-only contract', () => {
    expect(PANELS_SRC).toMatch(/NEVER fabricates a path|on-disk write path is pushed/i)
  })
})

describe('D. ManufactureWorkspace tracks lastSliceGcodePath state', () => {
  it('D1: workspace declares useState for lastSliceGcodePath with null default', () => {
    expect(WORKSPACE_SRC).toContain(
      'const [lastSliceGcodePath, setLastSliceGcodePath] = useState<string | null>(null)'
    )
  })

  it('D2: setter is called after a successful slice', () => {
    expect(WORKSPACE_SRC).toContain('setLastSliceGcodePath(out)')
  })

  it('D3: aux-panel props bundle threads the value to the panel', () => {
    expect(WORKSPACE_SRC).toContain('lastSliceGcodePath')
    // Specifically inside the auxPanelProps bundle, not just any reference
    expect(WORKSPACE_SRC).toMatch(/auxPanelProps[\s\S]{0,2000}?lastSliceGcodePath/)
  })

  it('D4: roadmap tag attaches the state addition to [P2-K2-PUSH]/Cycle 349', () => {
    expect(WORKSPACE_SRC).toContain('[P2-K2-PUSH]/Cycle 349')
  })
})

describe('E. ipc-fabrication still exposes moonraker:push (regression pin)', () => {
  it('E1: handler is registered for the moonraker:push channel', () => {
    expect(IPC_SRC).toMatch(/ipcMain\.handle\(\s*'moonraker:push'/)
  })

  it('E2: handler delegates to moonrakerPush via resolveMoonrakerPushCapabilities', () => {
    expect(IPC_SRC).toContain('await resolveMoonrakerPushCapabilities(payload)')
    expect(IPC_SRC).toContain('return moonrakerPush(resolved)')
  })
})

describe('F. preload bridges moonrakerPush to the renderer', () => {
  it('F1: preload Api type declares moonrakerPush', () => {
    expect(PRELOAD_SRC).toContain('moonrakerPush:')
  })

  it('F2: preload implementation invokes the moonraker:push channel', () => {
    expect(PRELOAD_SRC).toContain("ipcRenderer.invoke('moonraker:push', payload)")
  })
})

describe('G. mock-Moonraker harness lives at the directive-requested path', () => {
  it('G1: src/main/__mocks__/moonraker-fake.ts exists on disk', () => {
    expect(existsSync(FAKE_PATH)).toBe(true)
  })

  it('G2: harness exports freshMockMoonrakerState / resetMockMoonrakerState / startMockMoonraker / stopMockMoonraker', () => {
    expect(FAKE_SRC).toContain('export function freshMockMoonrakerState')
    expect(FAKE_SRC).toContain('export function resetMockMoonrakerState')
    expect(FAKE_SRC).toContain('export function startMockMoonraker')
    expect(FAKE_SRC).toContain('export function stopMockMoonraker')
  })

  it('G3: harness routes /server/files/upload, /printer/print/start, /printer/print/cancel', () => {
    expect(FAKE_SRC).toContain("'/server/files/upload'")
    expect(FAKE_SRC).toContain("/printer/print/start")
    expect(FAKE_SRC).toContain("'/printer/print/cancel'")
  })

  it('G4: harness boots on 127.0.0.1:0 (kernel-assigned port, never public)', () => {
    expect(FAKE_SRC).toContain("server.listen(0, '127.0.0.1'")
  })

  it('G5: roundtrip — start + capture + stop works against a real socket', async () => {
    const state = freshMockMoonrakerState()
    const { server, url } = await startMockMoonraker(state)
    try {
      // Hit each routed verb to confirm the harness captures them.
      const r1 = await fetch(`${url}/server/files/upload`, {
        method: 'POST',
        body: 'hello'
      })
      expect(r1.status).toBe(201)
      const r2 = await fetch(`${url}/printer/print/start?filename=cube.gcode`, {
        method: 'POST'
      })
      expect(r2.status).toBe(200)
      expect(state.captured.length).toBe(2)
      expect(state.captured[0]?.path).toBe('/server/files/upload')
      expect(state.captured[1]?.path).toBe('/printer/print/start?filename=cube.gcode')

      // Reset clears captures.
      resetMockMoonrakerState(state)
      expect(state.captured.length).toBe(0)
    } finally {
      await stopMockMoonraker(server)
    }
  })

  it('G6: unmocked routes return 404 with a JSON `{error: ...}` body', async () => {
    const state = freshMockMoonrakerState()
    const { server, url } = await startMockMoonraker(state)
    try {
      const r = await fetch(`${url}/printer/objects/nonexistent`, { method: 'POST' })
      expect(r.status).toBe(404)
      const body = (await r.json()) as { error: string }
      expect(body.error).toMatch(/no mock route/i)
    } finally {
      await stopMockMoonraker(server)
    }
  })
})

describe('H. existing E2E coverage still imports from the new harness path', () => {
  it('H1: moonraker-push-e2e.test.ts pulls helpers from ./__mocks__/moonraker-fake', () => {
    const e2eSrc = readFileSync(
      resolve(REPO_ROOT, 'src', 'main', 'moonraker-push-e2e.test.ts'),
      'utf8'
    )
    expect(e2eSrc).toContain("from './__mocks__/moonraker-fake'")
    expect(e2eSrc).toContain('startMockMoonraker')
    expect(e2eSrc).toContain('stopMockMoonraker')
  })
})
