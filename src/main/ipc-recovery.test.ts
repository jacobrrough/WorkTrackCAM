/**
 * AUTOSAVE + CRASH RECOVERY - `recovery:*` IPC surface tests (the ipc-machine
 * pattern: mock electron, capture handlers, invoke them directly). Also pins
 * the src/main/index.ts registration ordering invariant: registerRecoveryIpc
 * runs inside app.whenReady() BEFORE createWindow(), next to the other
 * register*Ipc calls, so a cold-start preload can never hit
 * "No handler registered for recovery:*".
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// ── Track registered IPC channels ───────────────────────────────────────────
const handlers = new Map<string, (...args: unknown[]) => unknown>()
let userDataDir = ''

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  },
  app: {
    getPath: vi.fn((name: string) => {
      if (name !== 'userData') throw new Error('unexpected getPath: ' + name)
      return userDataDir
    })
  }
}))

import { registerRecoveryIpc } from './ipc-recovery'
import { emptyDesign } from '../shared/design-schema'
import type { DesignRecoverySnapshot } from '../shared/design-recovery'
import type { MainIpcWindowContext } from './ipc-context'

const ctx: MainIpcWindowContext = { getMainWindow: () => null }
let projectDir = ''

beforeAll(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'wt-recovery-ipc-ud-'))
  projectDir = mkdtempSync(join(tmpdir(), 'wt-recovery-ipc-proj-'))
  registerRecoveryIpc(ctx)
})

afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

function snapshotJson(): string {
  const snap: DesignRecoverySnapshot = {
    version: 1,
    projectDir,
    savedAtMs: 4242,
    design: emptyDesign()
  }
  return JSON.stringify(snap)
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const h = handlers.get(channel)
  expect(h, channel + ' registered').toBeDefined()
  return (h as (...a: unknown[]) => unknown)(null, ...args)
}

describe('registerRecoveryIpc - channel registration', () => {
  it('registers exactly the three recovery channels', () => {
    expect(handlers.has('recovery:designWrite')).toBe(true)
    expect(handlers.has('recovery:designRead')).toBe(true)
    expect(handlers.has('recovery:designDelete')).toBe(true)
  })
})

describe('recovery:designWrite / designRead / designDelete round trip', () => {
  it('write -> read -> delete -> read-none, all through the IPC handlers', async () => {
    const w = await invoke('recovery:designWrite', snapshotJson())
    expect(w).toEqual({ ok: true })

    const r = (await invoke('recovery:designRead', projectDir)) as {
      ok: boolean
      snapshot?: DesignRecoverySnapshot
    }
    expect(r.ok).toBe(true)
    expect(r.snapshot?.savedAtMs).toBe(4242)

    await invoke('recovery:designDelete', projectDir)
    const r2 = await invoke('recovery:designRead', projectDir)
    expect(r2).toEqual({ ok: false, reason: 'none' })
  })

  it('write with a non-string payload -> structured invalid (never throws)', async () => {
    await expect(invoke('recovery:designWrite', { not: 'a string' })).resolves.toEqual({
      ok: false,
      reason: 'invalid'
    })
  })

  it('write with malformed JSON -> structured invalid (never throws)', async () => {
    await expect(invoke('recovery:designWrite', 'nope {{{')).resolves.toEqual({
      ok: false,
      reason: 'invalid'
    })
  })

  it('read with a non-string / empty projectDir -> structured none (never throws)', async () => {
    await expect(invoke('recovery:designRead', 42)).resolves.toEqual({ ok: false, reason: 'none' })
    await expect(invoke('recovery:designRead', '')).resolves.toEqual({ ok: false, reason: 'none' })
  })

  it('delete with a non-string projectDir is a safe no-op', async () => {
    await expect(invoke('recovery:designDelete', null)).resolves.toBeUndefined()
  })
})

describe('src/main/index.ts - IPC ordering invariant (source pin)', () => {
  const INDEX_SRC = readFileSync(join(__dirname, 'index.ts'), 'utf-8')

  it('registerRecoveryIpc is registered inside app.whenReady() BEFORE createWindow()', () => {
    const reg = INDEX_SRC.indexOf('registerRecoveryIpc(ipcCtx)')
    // The CALL site inside whenReady (not the function declaration above it).
    const win = INDEX_SRC.indexOf('  createWindow()')
    const ready = INDEX_SRC.indexOf('app.whenReady()')
    expect(reg).toBeGreaterThan(ready)
    expect(reg).toBeGreaterThan(-1)
    expect(win).toBeGreaterThan(-1)
    expect(reg).toBeLessThan(win)
  })

  it('sits next to the other register*Ipc calls (same whenReady block)', () => {
    expect(INDEX_SRC).toContain("import { registerRecoveryIpc } from './ipc-recovery'")
    const machine = INDEX_SRC.indexOf('registerMachineIpc(ipcCtx)')
    const recovery = INDEX_SRC.indexOf('registerRecoveryIpc(ipcCtx)')
    expect(machine).toBeGreaterThan(-1)
    expect(recovery).toBeGreaterThan(machine)
  })
})
