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
  mkdirMock: vi.fn(),
  readFileMock: vi.fn()
}))
const { accessMock, copyFileMock, mkdirMock, readFileMock } = fsMocks

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
  readFile: fsMocks.readFileMock,
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
    readFileMock.mockReset()
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

  // ── wizard:readCadSample (UNIFY 2 starter design) ──────────────────────

  describe('wizard:readCadSample', () => {
    it('refuses non-object payload', async () => {
      const handler = handlers.get('wizard:readCadSample')!
      const result = await handler({}, null)
      expect(result.ok).toBe(false)
    })

    it('refuses an unknown machine id', async () => {
      const handler = handlers.get('wizard:readCadSample')!
      const result = await handler({}, { machineId: 'nonexistent-machine' })
      expect(result).toEqual({ ok: false, error: 'Unknown wizard machine id' })
    })

    it('refuses when the bundled CadQuery script is missing from resources', async () => {
      accessMock.mockRejectedValue(new Error('ENOENT'))
      const handler = handlers.get('wizard:readCadSample')!
      const result = await handler({}, { machineId: 'creality-k2-plus' })
      expect(result.ok).toBe(false)
      expect((result as { error: string }).error).toMatch(/CadQuery sample not found/)
    })

    it('reads the bracket starter for K2 Plus', async () => {
      accessMock.mockResolvedValue(undefined)
      readFileMock.mockResolvedValue('import cadquery as cq\nresult = cq.Workplane("XY").box(1,1,1)\n')
      const handler = handlers.get('wizard:readCadSample')!
      const result = await handler({}, { machineId: 'creality-k2-plus' })
      expect(result).toEqual({
        ok: true,
        designName: 'L-Bracket',
        fileName: 'bracket.cq.py',
        scriptText: 'import cadquery as cq\nresult = cq.Workplane("XY").box(1,1,1)\n'
      })
      // The handler must reach into resources/samples/cad/<filename>
      expect(readFileMock.mock.calls[0][0]).toContain('cad')
      expect(readFileMock.mock.calls[0][0]).toContain('bracket.cq.py')
    })

    it('reads the cylinder starter for Carvera 4-axis', async () => {
      accessMock.mockResolvedValue(undefined)
      readFileMock.mockResolvedValue('# cylinder helix\nresult = None\n')
      const handler = handlers.get('wizard:readCadSample')!
      const result = await handler({}, { machineId: 'makera-carvera-4axis' })
      expect(result.ok).toBe(true)
      expect((result as { designName: string }).designName).toBe('Rotary Cylinder')
      expect((result as { fileName: string }).fileName).toBe('cylinder.cq.py')
    })

    it('reads the sign starter for Laguna', async () => {
      accessMock.mockResolvedValue(undefined)
      readFileMock.mockResolvedValue('# sign\nresult = None\n')
      const handler = handlers.get('wizard:readCadSample')!
      const result = await handler({}, { machineId: 'laguna-swift-5x10' })
      expect(result.ok).toBe(true)
      expect((result as { designName: string }).designName).toBe('Sign Board')
      expect((result as { fileName: string }).fileName).toBe('sign.cq.py')
    })

    it('returns ok=false when readFile throws (no silent swallow)', async () => {
      accessMock.mockResolvedValue(undefined)
      readFileMock.mockRejectedValue(new Error('EACCES'))
      const handler = handlers.get('wizard:readCadSample')!
      const result = await handler({}, { machineId: 'creality-k2-plus' })
      expect(result.ok).toBe(false)
      expect((result as { error: string }).error).toContain('EACCES')
    })
  })

  // ── font:read (Wave 3f — Text → machinable vectors) ─────────────────────

  describe('font:read', () => {
    it('refuses a non-object payload', async () => {
      const handler = handlers.get('font:read')!
      const result = await handler({}, null)
      expect(result).toEqual({ ok: false, error: 'Invalid font:read payload' })
    })

    it('refuses an unknown font id (no path traversal)', async () => {
      const handler = handlers.get('font:read')!
      const result = await handler({}, { fontId: '../../etc/passwd' })
      expect(result).toEqual({ ok: false, error: 'Unknown bundled font id' })
    })

    it('refuses when the bundled font file is missing from resources', async () => {
      accessMock.mockRejectedValue(new Error('ENOENT'))
      const handler = handlers.get('font:read')!
      const result = await handler({}, { fontId: 'roboto-regular' })
      expect(result.ok).toBe(false)
      expect((result as { error: string }).error).toMatch(/Bundled font not found/)
    })

    it('reads the bundled Roboto face as base64 from resources/fonts', async () => {
      accessMock.mockResolvedValue(undefined)
      // The handler base64-encodes the Buffer it reads, so return a Buffer.
      readFileMock.mockResolvedValue(Buffer.from('FONTBYTES'))
      const handler = handlers.get('font:read')!
      const result = await handler({}, { fontId: 'roboto-regular' })
      expect(result).toEqual({
        ok: true,
        fontId: 'roboto-regular',
        base64: Buffer.from('FONTBYTES').toString('base64')
      })
      // The handler must reach resources/fonts/Roboto-Regular.ttf.
      const readPath = String(readFileMock.mock.calls[0][0])
      expect(readPath).toContain('fonts')
      expect(readPath).toContain('Roboto-Regular.ttf')
    })

    it('returns ok=false when readFile throws (no silent swallow)', async () => {
      accessMock.mockResolvedValue(undefined)
      readFileMock.mockRejectedValue(new Error('EACCES'))
      const handler = handlers.get('font:read')!
      const result = await handler({}, { fontId: 'roboto-regular' })
      expect(result.ok).toBe(false)
      expect((result as { error: string }).error).toContain('EACCES')
    })
  })
})
