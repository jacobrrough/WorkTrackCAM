import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronApp = vi.hoisted(() => ({
  isPackaged: false,
  getAppPath: vi.fn(() => '/fake/app-path')
}))

vi.mock('electron', () => ({
  app: electronApp
}))

import { getEnginesRoot, getMainDir, getResourcesRoot } from './paths'

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
})
