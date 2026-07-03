/**
 * Unit tests for `src/main/ipc-assembly-step-import.ts` — the Phase-4
 * "Insert from file" IPC (`assembly:importStepPart`). Covers:
 *
 *   A. Registration pin — the channel is registered (mirrors the pin posture in
 *      `ipc-cad.test.ts` / `ipc-modeling.test.ts`).
 *   B. Validation matrix through the handler — traversal, null byte, wrong ext,
 *      missing file, size cap all fold into `{ ok:false, error, hint }`.
 *   C. Pipeline round-trip — a mocked PythonBridge running `cad.import_step` →
 *      `cad.tessellate_with_ids` produces the AssemblyPart-shaped envelope with
 *      the durable external-STEP geometry source.
 *
 * The real sidecar round-trip lives in the pure-helper test
 * (`assembly-step-import.test.ts`, against a mock bridge) + the existing
 * `sidecar/cad-import-step.test.ts` (against the real sidecar). This file mocks
 * the bridge so no Python is spawned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/mock/app')
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('./settings-store', () => ({
  loadSettings: vi.fn().mockResolvedValue({ theme: 'dark', recentProjectPaths: [], pythonPath: 'python' })
}))

// Existence + size stat is IO; mock it so tests never touch the disk. Per-test
// scripting recovers the mock via vi.mocked().
vi.mock('node:fs/promises', () => ({
  stat: vi.fn()
}))

// Mock the PythonBridge (same factory posture as ipc-cad.test.ts). The two
// production calls (cad.import_step then cad.tessellate_with_ids) route through
// bridgeCall; per-test scripting drives the outcome.
vi.mock('./sidecar/python-bridge', () => {
  const bridgeCall = vi.fn()
  const bridgeStop = vi.fn().mockResolvedValue(undefined)
  const bridgeStart = vi.fn(() => ({ call: bridgeCall, stop: bridgeStop }))
  return {
    PythonBridge: { start: bridgeStart },
    __mocks: { bridgeCall, bridgeStop, bridgeStart }
  }
})

import { stat } from 'node:fs/promises'
import { registerAssemblyStepImportIpc, type AssemblyImportStepPartResponse } from './ipc-assembly-step-import'
import type { MainIpcWindowContext } from './ipc-context'
import * as pythonBridgeModule from './sidecar/python-bridge'

const bridgeMocks = (
  pythonBridgeModule as unknown as {
    __mocks: {
      bridgeCall: ReturnType<typeof vi.fn>
      bridgeStop: ReturnType<typeof vi.fn>
      bridgeStart: ReturnType<typeof vi.fn>
    }
  }
).__mocks
const bridgeCallMock = bridgeMocks.bridgeCall
const bridgeStopMock = bridgeMocks.bridgeStop
const bridgeStartMock = bridgeMocks.bridgeStart
const statMock = vi.mocked(stat)

function createMockContext(): MainIpcWindowContext {
  return { getMainWindow: () => null }
}

function invoke(path: unknown): Promise<AssemblyImportStepPartResponse> {
  const handler = handlers.get('assembly:importStepPart')
  if (!handler) throw new Error('assembly:importStepPart not registered')
  return handler({}, path) as Promise<AssemblyImportStepPartResponse>
}

beforeEach(() => {
  handlers.clear()
  bridgeCallMock.mockReset()
  bridgeStopMock.mockReset().mockResolvedValue(undefined)
  bridgeStartMock.mockClear()
  statMock.mockReset()
})

// ── A. Registration pin ──────────────────────────────────────────────────────

describe('registerAssemblyStepImportIpc', () => {
  it('registers the assembly:importStepPart channel', () => {
    registerAssemblyStepImportIpc(createMockContext())
    expect(handlers.has('assembly:importStepPart')).toBe(true)
  })
})

// ── B. Validation matrix (through the handler) ───────────────────────────────

describe('assembly:importStepPart — path validation', () => {
  beforeEach(() => registerAssemblyStepImportIpc(createMockContext()))

  it('rejects a null byte without touching the filesystem', async () => {
    const r = await invoke('C:/vendor/evil\0.step')
    expect(r).toMatchObject({ ok: false, error: 'null_byte' })
    expect(statMock).not.toHaveBeenCalled()
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('rejects a wrong extension', async () => {
    const r = await invoke('C:/vendor/mesh.stl')
    expect(r).toMatchObject({ ok: false, error: 'bad_extension' })
    expect(statMock).not.toHaveBeenCalled()
  })

  it('rejects a traversal path', async () => {
    const r = await invoke('C:/vendor/../../etc/x.step')
    expect(r).toMatchObject({ ok: false, error: 'path_traversal' })
    expect(statMock).not.toHaveBeenCalled()
  })

  it('rejects an empty path', async () => {
    const r = await invoke('')
    expect(r).toMatchObject({ ok: false, error: 'empty_path' })
  })

  it('rejects a missing file', async () => {
    statMock.mockRejectedValueOnce(new Error('ENOENT'))
    const r = await invoke('C:/vendor/gone.step')
    expect(r).toMatchObject({ ok: false, error: 'file_not_found' })
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('rejects a non-file (directory)', async () => {
    statMock.mockResolvedValueOnce({ isFile: () => false, size: 0 } as unknown as Awaited<ReturnType<typeof stat>>)
    const r = await invoke('C:/vendor/adir.step')
    expect(r).toMatchObject({ ok: false, error: 'not_a_file' })
  })

  it('rejects an oversize file (size cap)', async () => {
    statMock.mockResolvedValueOnce({
      isFile: () => true,
      size: 200 * 1024 * 1024
    } as unknown as Awaited<ReturnType<typeof stat>>)
    const r = await invoke('C:/vendor/huge.step')
    expect(r).toMatchObject({ ok: false, error: 'file_too_large' })
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })
})

// ── C. Pipeline round-trip (mocked bridge) ───────────────────────────────────

describe('assembly:importStepPart — pipeline round-trip', () => {
  beforeEach(() => {
    registerAssemblyStepImportIpc(createMockContext())
    statMock.mockResolvedValue({ isFile: () => true, size: 1024 } as unknown as Awaited<ReturnType<typeof stat>>)
  })

  it('imports + tessellates into an AssemblyPart-shaped envelope', async () => {
    bridgeCallMock.mockImplementation((method: string) => {
      if (method === 'cad.import_step') {
        return Promise.resolve({ handle: 'step:abc', bbox: { min: [-5, -5, -5], max: [5, 5, 5] } })
      }
      if (method === 'cad.tessellate_with_ids') {
        return Promise.resolve({
          vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
          indices: [0, 1, 2],
          faceIds: [0],
          triangleCount: 1,
          bbox: { min: [-5, -5, -5], max: [5, 5, 5] }
        })
      }
      return Promise.reject(new Error(`unexpected method ${method}`))
    })

    const r = await invoke('C:/vendor/M6-bolt.step')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.result.name).toBe('M6-bolt')
    expect(r.result.handle).toBe('step:abc')
    expect(r.result.geometrySource.kind).toBe('step')
    expect(r.result.geometrySource.stepPath).toBe('C:/vendor/M6-bolt.step')
    expect(r.result.geometrySource.cachedDims).toEqual([10, 10, 10])
    expect(r.result.mesh.triangleCount).toBe(1)
    // id is a minted UUID — just assert it is a non-empty string.
    expect(typeof r.result.id).toBe('string')
    expect(r.result.id.length).toBeGreaterThan(0)
    // Both sidecar calls ran on one bridge, and it was stopped.
    expect(bridgeCallMock).toHaveBeenCalledTimes(2)
    expect(bridgeStopMock).toHaveBeenCalledTimes(1)
  })

  it('folds a sidecar import error into an envelope (never throws)', async () => {
    bridgeCallMock.mockImplementation((method: string) => {
      if (method === 'cad.import_step') {
        return Promise.reject({ code: 'sidecar_error', sidecarCode: 'step_read_error', message: 'bad STEP' })
      }
      return Promise.reject(new Error('should not tessellate'))
    })
    const r = await invoke('C:/vendor/bad.step')
    expect(r).toEqual({ ok: false, error: 'step_read_error', hint: 'bad STEP' })
    // Tessellate was never attempted.
    expect(bridgeCallMock).toHaveBeenCalledTimes(1)
    expect(bridgeStopMock).toHaveBeenCalledTimes(1)
  })

  it('folds a malformed tessellate envelope into a bad-response error', async () => {
    bridgeCallMock.mockImplementation((method: string) => {
      if (method === 'cad.import_step') {
        return Promise.resolve({ handle: 'step:abc', bbox: { min: [0, 0, 0], max: [1, 1, 1] } })
      }
      // Missing vertices → coercer returns null → bad_response rejection.
      return Promise.resolve({ indices: [0, 1, 2] })
    })
    const r = await invoke('C:/vendor/x.step')
    expect(r.ok).toBe(false)
    if (r.ok) return
    // buildStepImportPart maps a bad_response bridge reject via fallback code.
    expect(r.error).toBe('step_tessellate_failed')
  })
})
