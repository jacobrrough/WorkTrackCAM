/**
 * CADQUERY SCRIPT PERSISTENCE — `designScript:*` IPC surface tests (the
 * ipc-recovery pattern: mock electron, capture handlers, invoke them
 * directly). Also pins the src/main/index.ts registration ordering invariant:
 * registerDesignScriptIpc runs inside app.whenReady() BEFORE createWindow(),
 * next to the other register*Ipc calls, so a cold-start preload can never hit
 * "No handler registered for designScript:*".
 *
 * SAFETY: script text only — no G-code is read or written here.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
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

import { registerDesignScriptIpc } from './ipc-design-script'
import type { MainIpcWindowContext } from './ipc-context'
import type {
  DesignScriptLoadResult,
  DesignScriptRecoveryReadResult,
  DesignScriptSaveResult
} from '../shared/design-script-persistence'

const ctx: MainIpcWindowContext = { getMainWindow: () => null }
let projectDir = ''

const SCRIPT = '# demo\nresult = cq.Workplane("XY").box(10, 20, 5)\n'

beforeAll(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'wt-script-ipc-ud-'))
  projectDir = mkdtempSync(join(tmpdir(), 'wt-script-ipc-proj-'))
  registerDesignScriptIpc(ctx)
})

afterAll(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

function snapshotJson(savedAtMs = 4242): string {
  return JSON.stringify({ version: 1, projectDir, savedAtMs, script: SCRIPT })
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const h = handlers.get(channel)
  expect(h, channel + ' registered').toBeDefined()
  return (h as (...a: unknown[]) => unknown)(null, ...args)
}

describe('registerDesignScriptIpc — channel registration', () => {
  it('registers exactly the five designScript channels', () => {
    expect(handlers.has('designScript:save')).toBe(true)
    expect(handlers.has('designScript:load')).toBe(true)
    expect(handlers.has('designScript:recoveryWrite')).toBe(true)
    expect(handlers.has('designScript:recoveryRead')).toBe(true)
    expect(handlers.has('designScript:recoveryDelete')).toBe(true)
  })
})

describe('designScript:save / load round trip through the IPC handlers', () => {
  it('save → load returns the exact script text', async () => {
    const w = (await invoke('designScript:save', projectDir, SCRIPT)) as DesignScriptSaveResult
    expect(w).toEqual({ ok: true })
    const r = (await invoke('designScript:load', projectDir)) as DesignScriptLoadResult
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.script).toBe(SCRIPT)
  })

  it('a SUCCESSFUL save also deletes the write-ahead crash snapshot (clean-save)', async () => {
    // Seed a snapshot, then a clean save must remove it.
    const wr = await invoke('designScript:recoveryWrite', snapshotJson())
    expect(wr).toEqual({ ok: true })
    const rr1 = (await invoke(
      'designScript:recoveryRead',
      projectDir
    )) as DesignScriptRecoveryReadResult
    expect(rr1.ok).toBe(true)

    await invoke('designScript:save', projectDir, SCRIPT)
    const rr2 = await invoke('designScript:recoveryRead', projectDir)
    expect(rr2).toEqual({ ok: false, reason: 'none' })
  })

  it('save with a non-string / empty projectDir → structured invalid (never throws)', async () => {
    await expect(invoke('designScript:save', '', SCRIPT)).resolves.toEqual({
      ok: false,
      reason: 'invalid'
    })
    await expect(invoke('designScript:save', 42, SCRIPT)).resolves.toEqual({
      ok: false,
      reason: 'invalid'
    })
    await expect(invoke('designScript:save', projectDir, 42)).resolves.toEqual({
      ok: false,
      reason: 'invalid'
    })
  })

  it('load with a non-string / empty projectDir → structured none (never throws)', async () => {
    await expect(invoke('designScript:load', '')).resolves.toEqual({ ok: false, reason: 'none' })
    await expect(invoke('designScript:load', null)).resolves.toEqual({ ok: false, reason: 'none' })
  })
})

describe('designScript:recovery* round trip through the IPC handlers', () => {
  it('recoveryWrite → recoveryRead → recoveryDelete → read-none', async () => {
    const w = await invoke('designScript:recoveryWrite', snapshotJson(9999))
    expect(w).toEqual({ ok: true })
    const r = (await invoke(
      'designScript:recoveryRead',
      projectDir
    )) as DesignScriptRecoveryReadResult
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.snapshot.savedAtMs).toBe(9999)

    await invoke('designScript:recoveryDelete', projectDir)
    const r2 = await invoke('designScript:recoveryRead', projectDir)
    expect(r2).toEqual({ ok: false, reason: 'none' })
  })

  it('recoveryWrite with a non-string payload → structured invalid (never throws)', async () => {
    await expect(invoke('designScript:recoveryWrite', { not: 'a string' })).resolves.toEqual({
      ok: false,
      reason: 'invalid'
    })
  })

  it('recoveryWrite with malformed JSON → structured invalid (never throws)', async () => {
    await expect(invoke('designScript:recoveryWrite', 'nope {{{')).resolves.toEqual({
      ok: false,
      reason: 'invalid'
    })
  })

  it('recoveryDelete with a non-string projectDir is a safe no-op', async () => {
    await expect(invoke('designScript:recoveryDelete', null)).resolves.toBeUndefined()
  })
})

describe('src/main/index.ts — IPC ordering invariant (source pin)', () => {
  const INDEX_SRC = readFileSync(join(__dirname, 'index.ts'), 'utf-8')

  it('registerDesignScriptIpc is registered inside app.whenReady() BEFORE createWindow()', () => {
    const reg = INDEX_SRC.indexOf('registerDesignScriptIpc(ipcCtx)')
    const win = INDEX_SRC.indexOf('  createWindow()')
    const ready = INDEX_SRC.indexOf('app.whenReady()')
    expect(reg).toBeGreaterThan(ready)
    expect(reg).toBeGreaterThan(-1)
    expect(win).toBeGreaterThan(-1)
    expect(reg).toBeLessThan(win)
  })

  it('sits next to the other register*Ipc calls (imported + after registerRecoveryIpc)', () => {
    expect(INDEX_SRC).toContain("import { registerDesignScriptIpc } from './ipc-design-script'")
    const recovery = INDEX_SRC.indexOf('registerRecoveryIpc(ipcCtx)')
    const script = INDEX_SRC.indexOf('registerDesignScriptIpc(ipcCtx)')
    expect(recovery).toBeGreaterThan(-1)
    expect(script).toBeGreaterThan(recovery)
  })
})
