/**
 * Pin tests for the first-launch project wizard IPC channels:
 *   - `samples:list`     -- which wizard machine IDs have bundled samples
 *   - `wizard:copySample` -- copy bundled sample STL into project/assets
 *
 * Covers the integration contract used by `FirstLaunchWizard.tsx`. The
 * channels are non-destructive (read-only / additive) and exist on top
 * of the unchanged `project:create` IPC -- both new handlers refuse
 * malformed payloads to avoid silent corruption of a fresh project.
 *
 * Companion to `ipc-core.test.ts` which only checks channel registration.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const handlers = new Map<string, Function>()

// vi.mock factories are hoisted above top-level `const` declarations, so the
// mocks themselves must be created inside the factory. We expose them via
// `vi.hoisted(...)` so the test bodies can adjust their per-test behavior.
const fsMocks = vi.hoisted(() => ({
  accessMock: vi.fn(),
  copyFileMock: vi.fn(),
  mkdirMock: vi.fn()
}))
const { accessMock, copyFileMock, mkdirMock } = fsMocks

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: fsMocks.accessMock,
  copyFile: fsMocks.copyFileMock,
  mkdir: fsMocks.mkdirMock
}))

vi.mock('./app-runtime', () => ({
  getAppVersion: vi.fn().mockReturnValue('1.0.0-test')
}))

vi.mock('./project-store', () => ({
  newProject: vi.fn(),
  readProjectFile: vi.fn(),
  writeProjectFile: vi.fn()
}))

vi.mock('./settings-store', () => ({
  loadSettings: vi.fn().mockResolvedValue({ theme: 'dark', recentProjectPaths: [] }),
  saveSettings: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./paths', () => ({
  getResourcesRoot: vi.fn().mockReturnValue('/mock/resources')
}))

import { registerCoreIpc } from './ipc-core'
import type { MainIpcWindowContext } from './ipc-context'

function createMockContext(): MainIpcWindowContext {
  return { getMainWindow: () => null }
}

describe('first-launch wizard IPC', () => {
  beforeEach(() => {
    handlers.clear()
    accessMock.mockReset()
    copyFileMock.mockReset()
    mkdirMock.mockReset()
    registerCoreIpc(createMockContext())
  })

  // ── samples:list ────────────────────────────────────────────────────

  describe('samples:list', () => {
    it('returns empty list when no sample bundles exist on disk', async () => {
      accessMock.mockRejectedValue(new Error('ENOENT'))
      const handler = handlers.get('samples:list')!
      const result = await handler()
      expect(result).toEqual({ availableMachineIds: [] })
    })

    it('returns the machine IDs whose sample file exists', async () => {
      // K2 Plus + Carvera 3-axis present; Laguna + Carvera 4-axis absent.
      accessMock.mockImplementation(async (path: string) => {
        if (path.includes('creality-k2-plus')) return undefined
        if (path.includes('makera-carvera-3axis')) return undefined
        throw new Error('ENOENT')
      })
      const handler = handlers.get('samples:list')!
      const result = await handler()
      expect(result.availableMachineIds).toEqual(
        expect.arrayContaining(['creality-k2-plus', 'makera-carvera-3axis'])
      )
      expect(result.availableMachineIds).toHaveLength(2)
    })
  })

  // ── wizard:copySample ──────────────────────────────────────────────

  describe('wizard:copySample', () => {
    it('refuses non-object payload', async () => {
      const handler = handlers.get('wizard:copySample')!
      const result = await handler({}, null)
      expect(result.ok).toBe(false)
    })

    it('refuses missing projectDir', async () => {
      const handler = handlers.get('wizard:copySample')!
      const result = await handler({}, { machineId: 'creality-k2-plus' })
      expect(result).toEqual({ ok: false, error: 'Invalid projectDir' })
    })

    it('refuses projectDir containing a null byte', async () => {
      const handler = handlers.get('wizard:copySample')!
      const result = await handler({}, {
        projectDir: '/bad\0dir',
        machineId: 'creality-k2-plus'
      })
      expect(result).toEqual({ ok: false, error: 'Invalid projectDir' })
    })

    it('refuses an unknown machine id', async () => {
      const handler = handlers.get('wizard:copySample')!
      const result = await handler({}, {
        projectDir: '/tmp/proj',
        machineId: 'nonexistent-machine'
      })
      expect(result).toEqual({ ok: false, error: 'Unknown wizard machine id' })
    })

    it('refuses when the bundled sample is missing from resources', async () => {
      accessMock.mockRejectedValue(new Error('ENOENT'))
      const handler = handlers.get('wizard:copySample')!
      const result = await handler({}, {
        projectDir: '/tmp/proj',
        machineId: 'creality-k2-plus'
      })
      expect(result.ok).toBe(false)
      expect((result as { error: string }).error).toContain('creality-k2-plus')
    })

    it('copies the sample and returns the relative asset path on success', async () => {
      accessMock.mockResolvedValue(undefined)
      mkdirMock.mockResolvedValue(undefined)
      copyFileMock.mockResolvedValue(undefined)
      const handler = handlers.get('wizard:copySample')!
      const result = await handler({}, {
        projectDir: '/tmp/proj',
        machineId: 'creality-k2-plus'
      })
      expect(result).toEqual({
        ok: true,
        // Filename comes from WIZARD_MACHINE_TO_SAMPLE_FILE; the K2 Plus
        // sample is the procedural 20mm calibration cube.
        assetRelativePath: 'assets/calibration-cube-20mm.stl'
      })
      expect(mkdirMock).toHaveBeenCalledWith(
        expect.stringContaining('assets'),
        expect.objectContaining({ recursive: true })
      )
      expect(copyFileMock).toHaveBeenCalledTimes(1)
    })

    it('returns ok=false when copyFile throws (no silent swallow)', async () => {
      accessMock.mockResolvedValue(undefined)
      mkdirMock.mockResolvedValue(undefined)
      copyFileMock.mockRejectedValue(new Error('EACCES'))
      const handler = handlers.get('wizard:copySample')!
      const result = await handler({}, {
        projectDir: '/tmp/proj',
        machineId: 'laguna-swift-5x10'
      })
      expect(result.ok).toBe(false)
      expect((result as { error: string }).error).toContain('EACCES')
    })
  })
})
