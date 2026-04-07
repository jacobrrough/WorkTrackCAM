import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockReadFile, mockWriteFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData')
  }
}))

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile
}))

import { loadSettings, saveSettings } from './settings-store'
import type { AppSettings } from '../shared/project-schema'

describe('settings-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteFile.mockResolvedValue(undefined)
  })

  describe('loadSettings', () => {
    it('returns defaults when settings file does not exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      const result = await loadSettings()
      expect(result.theme).toBe('dark')
      expect(result.recentProjectPaths).toEqual([])
    })

    it('returns defaults when settings file is malformed JSON', async () => {
      mockReadFile.mockResolvedValue('not json {{{')
      const result = await loadSettings()
      expect(result.theme).toBe('dark')
    })

    it('merges saved settings over defaults', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ theme: 'light', pythonPath: '/usr/bin/python3' }))
      const result = await loadSettings()
      expect(result.theme).toBe('light')
      expect(result.pythonPath).toBe('/usr/bin/python3')
      expect(result.recentProjectPaths).toEqual([])
    })

    it('handles an empty object gracefully', async () => {
      mockReadFile.mockResolvedValue('{}')
      const result = await loadSettings()
      expect(result.theme).toBe('dark')
    })

    it('handles null stored value gracefully', async () => {
      mockReadFile.mockResolvedValue('null')
      const result = await loadSettings()
      expect(result.theme).toBe('dark')
    })

    it('handles array stored value gracefully', async () => {
      mockReadFile.mockResolvedValue('[1,2,3]')
      const result = await loadSettings()
      expect(result.theme).toBe('dark')
    })

    it('reads from correct file path', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      await loadSettings()
      expect(mockReadFile).toHaveBeenCalledWith(
        expect.stringContaining('settings.json'),
        'utf-8'
      )
    })
  })

  describe('saveSettings', () => {
    it('writes merged settings to file', async () => {
      const settings: AppSettings = {
        theme: 'light',
        recentProjectPaths: ['/project/a']
      }
      await saveSettings(settings)
      expect(mockWriteFile).toHaveBeenCalledTimes(1)
      const [path, content] = mockWriteFile.mock.calls[0]!
      expect(path).toContain('settings.json')
      const parsed = JSON.parse(content)
      expect(parsed.theme).toBe('light')
      expect(parsed.recentProjectPaths).toEqual(['/project/a'])
    })

    it('validates settings through schema before writing', async () => {
      const settings: AppSettings = {
        theme: 'dark',
        recentProjectPaths: []
      }
      await saveSettings(settings)
      expect(mockWriteFile).toHaveBeenCalledTimes(1)
      const [, content] = mockWriteFile.mock.calls[0]!
      const parsed = JSON.parse(content)
      expect(parsed.theme).toBe('dark')
    })

    it('formats output with 2-space indentation', async () => {
      await saveSettings({ theme: 'dark', recentProjectPaths: [] })
      const [, content] = mockWriteFile.mock.calls[0]!
      expect(content).toContain('  ')
    })
  })
})
