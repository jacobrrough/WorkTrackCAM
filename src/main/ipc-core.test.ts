import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

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
  writeFile: vi.fn()
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
      'file:writeText'
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
})
