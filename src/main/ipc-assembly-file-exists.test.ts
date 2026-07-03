/**
 * Unit tests for `src/main/ipc-assembly-file-exists.ts` — the wave-8 external-STEP
 * dangling probe (`assembly:fileExists`). Covers:
 *
 *   A. Registration pin — the channel is registered (mirrors the pin posture in
 *      `ipc-assembly-step-import.test.ts`).
 *   B. Null-byte / non-string / empty reject — no `stat` attempted.
 *   C. true / false — an existing regular file resolves `true`; a directory, a
 *      missing file, and a `stat` rejection all resolve `false`.
 *
 * The pure helper `assemblyFileExists` is exercised directly (no Electron mock
 * needed for the core logic); the handler path is exercised via the mocked
 * `ipcMain.handle` registry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

// Existence stat is IO; mock it so tests never touch the disk.
vi.mock('node:fs/promises', () => ({
  stat: vi.fn()
}))

import { stat } from 'node:fs/promises'
import { assemblyFileExists, registerAssemblyFileExistsIpc } from './ipc-assembly-file-exists'
import type { MainIpcWindowContext } from './ipc-context'

const statMock = vi.mocked(stat)

function createMockContext(): MainIpcWindowContext {
  return { getMainWindow: () => null }
}

function invoke(path: unknown): Promise<boolean> {
  const handler = handlers.get('assembly:fileExists')
  if (!handler) throw new Error('assembly:fileExists not registered')
  return handler({}, path) as Promise<boolean>
}

beforeEach(() => {
  handlers.clear()
  statMock.mockReset()
})

// ── A. Registration pin ──────────────────────────────────────────────────────

describe('registerAssemblyFileExistsIpc', () => {
  it('registers the assembly:fileExists channel', () => {
    registerAssemblyFileExistsIpc(createMockContext())
    expect(handlers.has('assembly:fileExists')).toBe(true)
  })
})

// ── B. Lexical rejects (no stat) ─────────────────────────────────────────────

describe('assemblyFileExists — lexical rejects', () => {
  it('rejects a null-byte path WITHOUT touching the filesystem', async () => {
    await expect(assemblyFileExists('C:/vendor/evil\0.step')).resolves.toBe(false)
    expect(statMock).not.toHaveBeenCalled()
  })

  it('rejects a non-string path', async () => {
    await expect(assemblyFileExists(undefined)).resolves.toBe(false)
    await expect(assemblyFileExists(42)).resolves.toBe(false)
    await expect(assemblyFileExists(null)).resolves.toBe(false)
    expect(statMock).not.toHaveBeenCalled()
  })

  it('rejects an empty / whitespace-only path', async () => {
    await expect(assemblyFileExists('')).resolves.toBe(false)
    await expect(assemblyFileExists('   ')).resolves.toBe(false)
    expect(statMock).not.toHaveBeenCalled()
  })
})

// ── C. true / false ──────────────────────────────────────────────────────────

describe('assemblyFileExists — existence', () => {
  it('returns true for an existing regular file', async () => {
    statMock.mockResolvedValueOnce({ isFile: () => true } as unknown as Awaited<ReturnType<typeof stat>>)
    await expect(assemblyFileExists('C:/vendor/M6-bolt.step')).resolves.toBe(true)
    expect(statMock).toHaveBeenCalledTimes(1)
  })

  it('returns false for a directory (exists but not a regular file)', async () => {
    statMock.mockResolvedValueOnce({ isFile: () => false } as unknown as Awaited<ReturnType<typeof stat>>)
    await expect(assemblyFileExists('C:/vendor')).resolves.toBe(false)
  })

  it('returns false when the file is missing (stat rejects)', async () => {
    statMock.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(assemblyFileExists('C:/vendor/gone.step')).resolves.toBe(false)
  })

  it('trims surrounding whitespace before the stat', async () => {
    statMock.mockResolvedValueOnce({ isFile: () => true } as unknown as Awaited<ReturnType<typeof stat>>)
    await expect(assemblyFileExists('  C:/vendor/M6-bolt.step  ')).resolves.toBe(true)
    expect(statMock).toHaveBeenCalledWith('C:/vendor/M6-bolt.step')
  })
})

// ── D. Through the registered handler ────────────────────────────────────────

describe('assembly:fileExists — through the handler', () => {
  beforeEach(() => registerAssemblyFileExistsIpc(createMockContext()))

  it('resolves true for an existing file via the IPC handler', async () => {
    statMock.mockResolvedValueOnce({ isFile: () => true } as unknown as Awaited<ReturnType<typeof stat>>)
    await expect(invoke('C:/vendor/motor.stp')).resolves.toBe(true)
  })

  it('resolves false for a null-byte path via the IPC handler (no stat)', async () => {
    await expect(invoke('C:/vendor/x\0.step')).resolves.toBe(false)
    expect(statMock).not.toHaveBeenCalled()
  })

  it('resolves false for a missing file via the IPC handler', async () => {
    statMock.mockRejectedValueOnce(new Error('ENOENT'))
    await expect(invoke('C:/vendor/moved.step')).resolves.toBe(false)
  })
})
