import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  getAppPath: vi.fn(() => '/fake/app-path')
}))

const accessMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: electronApp
}))

vi.mock('node:fs/promises', () => ({
  access: accessMock
}))

import { getEnginesRoot, getMainDir, getResourcesRoot, getRuntimeRootsDiagnostics } from './paths'

describe('paths', () => {
  describe('getMainDir', () => {
    it('returns the directory containing paths.ts', () => {
      const dir = getMainDir()
      expect(dir).toMatch(/[/\\]main$/)
    })
  })

  describe('getResourcesRoot', () => {
    beforeEach(() => {
      electronApp.isPackaged = false
      electronApp.getAppPath.mockReturnValue('/fake/app-path')
      accessMock.mockReset().mockResolvedValue(undefined)
      Reflect.deleteProperty(process, 'resourcesPath')
    })

    it('joins app path and resources in development', () => {
      expect(getResourcesRoot()).toBe(join('/fake/app-path', 'resources'))
    })

    it('joins process.resourcesPath and resources when packaged', () => {
      electronApp.isPackaged = true
      Object.assign(process, { resourcesPath: '/electron/Resources' })
      expect(getResourcesRoot()).toBe(join('/electron/Resources', 'resources'))
    })
  })

  describe('getEnginesRoot', () => {
    beforeEach(() => {
      electronApp.isPackaged = false
      electronApp.getAppPath.mockReturnValue('/fake/app-path')
      accessMock.mockReset().mockResolvedValue(undefined)
      Reflect.deleteProperty(process, 'resourcesPath')
    })

    it('joins app path and engines in development', () => {
      expect(getEnginesRoot()).toBe(join('/fake/app-path', 'engines'))
    })

    it('joins process.resourcesPath and engines when packaged', () => {
      electronApp.isPackaged = true
      Object.assign(process, { resourcesPath: '/electron/Resources' })
      expect(getEnginesRoot()).toBe(join('/electron/Resources', 'engines'))
    })
  })

  describe('getRuntimeRootsDiagnostics', () => {
    beforeEach(() => {
      electronApp.isPackaged = false
      electronApp.getAppPath.mockReturnValue('/fake/app-path')
      accessMock.mockReset().mockResolvedValue(undefined)
      Reflect.deleteProperty(process, 'resourcesPath')
    })

    it('reports readable roots when both paths are accessible', async () => {
      const result = await getRuntimeRootsDiagnostics()
      expect(result.resourcesReadable).toBe(true)
      expect(result.enginesReadable).toBe(true)
      expect(result.resourcesRoot).toBe(join('/fake/app-path', 'resources'))
      expect(result.enginesRoot).toBe(join('/fake/app-path', 'engines'))
      expect(result.enginesBundle.enginesRoot).toBe(join('/fake/app-path', 'engines'))
      expect(result.enginesBundle.directoryReadable).toBe(true)
    })

    it('reports unreadable roots when access checks fail', async () => {
      let call = 0
      accessMock.mockImplementation(() => {
        call += 1
        if (call === 1) return Promise.reject(new Error('no resources'))
        if (call === 2) return Promise.reject(new Error('no engines'))
        return Promise.resolve(undefined)
      })
      const result = await getRuntimeRootsDiagnostics()
      expect(result.resourcesReadable).toBe(false)
      expect(result.enginesReadable).toBe(false)
    })
  })
})
