import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { dialog } from 'electron'

// Track registered handlers
const handlers = new Map<string, Function>()

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  shell: {
    openPath: vi.fn()
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn().mockRejectedValue(new Error('ENOENT')),
  copyFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./paths', () => ({
  getResourcesRoot: vi.fn().mockReturnValue('/mock/resources')
}))

vi.mock('./app-runtime', () => ({
  getAppVersion: vi.fn().mockReturnValue('1.0.0-test')
}))

vi.mock('./project-store', () => ({
  newProject: vi.fn().mockReturnValue({
    version: 1,
    name: 'Test',
    updatedAt: '2024-01-01',
    activeMachineId: 'm1',
    meshes: [],
    importHistory: []
  }),
  readProjectFile: vi.fn().mockResolvedValue({
    version: 1,
    name: 'Loaded',
    updatedAt: '2024-01-01',
    activeMachineId: 'm1',
    meshes: [],
    importHistory: []
  }),
  writeProjectFile: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('./settings-store', () => ({
  loadSettings: vi.fn().mockResolvedValue({ theme: 'dark', recentProjectPaths: [] }),
  saveSettings: vi.fn().mockResolvedValue(undefined)
}))

import { registerCoreIpc } from './ipc-core'
import type { MainIpcWindowContext } from './ipc-context'

function createMockContext(): MainIpcWindowContext {
  return {
    getMainWindow: () => null
  }
}

describe('ipc-core', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('registerCoreIpc registers all expected channels', () => {
    const ctx = createMockContext()
    registerCoreIpc(ctx)

    const expectedChannels = [
      'app:getVersion',
      'settings:get',
      'settings:set',
      'project:openDir',
      'project:read',
      'project:create',
      'project:save',
      'dialog:openFile',
      'dialog:openFiles',
      'dialog:saveFile',
      'shell:openPath',
      'file:readText',
      'file:writeText',
      'samples:list',
      'wizard:copySample'
    ]

    for (const ch of expectedChannels) {
      expect(handlers.has(ch), `missing handler for channel "${ch}"`).toBe(true)
    }
  })

  it('app:getVersion returns a version string', async () => {
    const ctx = createMockContext()
    registerCoreIpc(ctx)
    const handler = handlers.get('app:getVersion')!
    const result = await handler()
    expect(result).toBe('1.0.0-test')
  })

  it('settings:get returns settings object', async () => {
    const ctx = createMockContext()
    registerCoreIpc(ctx)
    const handler = handlers.get('settings:get')!
    const result = await handler()
    expect(result).toHaveProperty('theme')
  })

  it('project:openDir returns null when no window', async () => {
    const ctx = createMockContext()
    registerCoreIpc(ctx)
    const handler = handlers.get('project:openDir')!
    const result = await handler()
    expect(result).toBeNull()
  })

  it('project:read calls readProjectFile', async () => {
    const ctx = createMockContext()
    registerCoreIpc(ctx)
    const handler = handlers.get('project:read')!
    const result = await handler({}, '/some/dir')
    expect(result).toHaveProperty('name', 'Loaded')
  })

  it('project:create returns a new project', async () => {
    const ctx = createMockContext()
    registerCoreIpc(ctx)
    const handler = handlers.get('project:create')!
    const result = await handler({}, { dir: '/tmp', name: 'Test', machineId: 'm1' })
    expect(result).toHaveProperty('version', 1)
    expect(result).toHaveProperty('name', 'Test')
  })

  it('registers file:readText and file:writeText handlers', () => {
    const ctx = createMockContext()
    registerCoreIpc(ctx)
    expect(handlers.has('file:readText')).toBe(true)
    expect(handlers.has('file:writeText')).toBe(true)
  })

  // ── Dialog null-byte injection guards ───────────────────────────────────
  // Even though native OS file dialogs are extremely unlikely to ever return
  // a path containing a NUL byte, the dialog handlers sit on the IPC trust
  // boundary and their results flow straight into `writeFile`, post-processors,
  // and subprocess args downstream. The other path-accepting handlers in this
  // file (file:readText, file:writeText, shell:openPath) already reject NUL
  // bytes; these tests pin the same guard onto the dialog handlers.

  // Cast `dialog.showOpenDialog`/`showSaveDialog` to the mock interface we
  // declared in `vi.mock('electron', ...)` so we can stage return values.
  const mockedShowOpenDialog = dialog.showOpenDialog as unknown as ReturnType<typeof vi.fn>
  const mockedShowSaveDialog = dialog.showSaveDialog as unknown as ReturnType<typeof vi.fn>

  // The dialog handlers short-circuit when `getMainWindow()` returns null,
  // so we need a non-null window stub to exercise the validation path.
  function createCtxWithWindow(): MainIpcWindowContext {
    return {
      getMainWindow: () => ({} as unknown as Electron.BrowserWindow)
    }
  }

  it('dialog:openFile rejects null-byte paths returned by the OS dialog', async () => {
    mockedShowOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/evil\0extra.stl']
    })
    const ctx = createCtxWithWindow()
    registerCoreIpc(ctx)
    const handler = handlers.get('dialog:openFile')!
    const result = await handler({}, [])
    // The handler must NOT return the poisoned path. Returning `null` matches
    // the existing "user cancelled" semantics so the renderer's `if (!p)`
    // guards naturally treat the rejection as a no-op rather than passing a
    // half-truncated path further down the pipeline.
    expect(result).toBeNull()
  })

  it('dialog:openFile passes through a clean path', async () => {
    mockedShowOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/safe.stl']
    })
    const ctx = createCtxWithWindow()
    registerCoreIpc(ctx)
    const handler = handlers.get('dialog:openFile')!
    const result = await handler({}, [])
    expect(result).toBe('/tmp/safe.stl')
  })

  it('dialog:openFiles rejects the whole batch if any path has a null byte', async () => {
    mockedShowOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/ok-a.stl', '/tmp/poisoned\0name.stl', '/tmp/ok-b.stl']
    })
    const ctx = createCtxWithWindow()
    registerCoreIpc(ctx)
    const handler = handlers.get('dialog:openFiles')!
    const result = await handler({}, [])
    // Empty array is the existing "no selection" return shape -- safe for
    // callers iterating with `for (const p of paths)`.
    expect(result).toEqual([])
  })

  it('dialog:openFiles passes through a clean batch', async () => {
    mockedShowOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/tmp/a.stl', '/tmp/b.stl']
    })
    const ctx = createCtxWithWindow()
    registerCoreIpc(ctx)
    const handler = handlers.get('dialog:openFiles')!
    const result = await handler({}, [])
    expect(result).toEqual(['/tmp/a.stl', '/tmp/b.stl'])
  })

  it('dialog:saveFile rejects null-byte paths returned by the OS dialog', async () => {
    mockedShowSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: '/tmp/out\0evil.gcode'
    })
    const ctx = createCtxWithWindow()
    registerCoreIpc(ctx)
    const handler = handlers.get('dialog:saveFile')!
    const result = await handler({}, [])
    expect(result).toBeNull()
  })

  it('dialog:saveFile passes through a clean path', async () => {
    mockedShowSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: '/tmp/out.gcode'
    })
    const ctx = createCtxWithWindow()
    registerCoreIpc(ctx)
    const handler = handlers.get('dialog:saveFile')!
    const result = await handler({}, [])
    expect(result).toBe('/tmp/out.gcode')
  })
})
