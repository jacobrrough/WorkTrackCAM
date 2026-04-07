import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockReadFile, mockWriteFile, mockMkdir, mockExistsSync } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockExistsSync: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData')
  }
}))

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir
}))

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync
}))

vi.mock('./paths', () => ({
  getResourcesRoot: vi.fn().mockReturnValue('/mock/resources')
}))

// Provide a working materialLibrarySchema mock
vi.mock('../shared/material-schema', () => {
  const parse = (data: unknown): { version: number; materials: Array<Record<string, unknown>> } => {
    if (typeof data !== 'object' || data === null) throw new Error('Invalid')
    const d = data as Record<string, unknown>
    return {
      version: (d.version as number) ?? 1,
      materials: (d.materials as Array<Record<string, unknown>>) ?? []
    }
  }
  return {
    materialLibrarySchema: { parse }
  }
})

import { listAllMaterials, saveMaterial, deleteMaterial, importMaterialsJson } from './materials-manager'

describe('materials-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockExistsSync.mockReturnValue(false)
  })

  describe('listAllMaterials', () => {
    it('returns empty array when no bundled or user materials exist', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'))
      mockExistsSync.mockReturnValue(false)
      const result = await listAllMaterials()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })

    it('returns bundled materials when user materials file missing', async () => {
      const bundled = {
        version: 1,
        materials: [{ id: 'alum', name: 'Aluminum', category: 'metal' }]
      }
      mockReadFile.mockResolvedValueOnce(JSON.stringify(bundled))
      mockExistsSync.mockReturnValue(false)
      const result = await listAllMaterials()
      expect(result.length).toBe(1)
      expect(result[0]!.id).toBe('alum')
    })

    it('user materials override bundled with same id', async () => {
      const bundled = {
        version: 1,
        materials: [{ id: 'alum', name: 'Aluminum (bundled)', category: 'metal' }]
      }
      const user = {
        version: 1,
        materials: [{ id: 'alum', name: 'Aluminum (custom)', category: 'metal' }]
      }
      mockReadFile
        .mockResolvedValueOnce(JSON.stringify(bundled))
        .mockResolvedValueOnce(JSON.stringify(user))
      mockExistsSync.mockReturnValue(true)
      const result = await listAllMaterials()
      expect(result.length).toBe(1)
      expect(result[0]!.name).toBe('Aluminum (custom)')
      expect(result[0]!.source).toBe('user')
    })

    it('returns sorted results by name', async () => {
      const bundled = {
        version: 1,
        materials: [
          { id: 'z_mat', name: 'Zinc', category: 'metal' },
          { id: 'a_mat', name: 'Aluminum', category: 'metal' }
        ]
      }
      mockReadFile.mockResolvedValueOnce(JSON.stringify(bundled))
      mockExistsSync.mockReturnValue(false)
      const result = await listAllMaterials()
      expect(result[0]!.name).toBe('Aluminum')
      expect(result[1]!.name).toBe('Zinc')
    })
  })

  describe('saveMaterial', () => {
    it('saves a new material to user library', async () => {
      mockExistsSync.mockReturnValue(false)
      const record = { id: 'new-mat', name: 'New Material', category: 'other', source: 'user' as const }
      const result = await saveMaterial(record as never)
      expect(result.id).toBe('new-mat')
      expect(result.source).toBe('user')
      expect(mockWriteFile).toHaveBeenCalledTimes(1)
    })

    it('updates existing material by id', async () => {
      const existing = {
        version: 1,
        materials: [{ id: 'mat1', name: 'Old Name', category: 'metal' }]
      }
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify(existing))
      const record = { id: 'mat1', name: 'New Name', category: 'metal', source: 'user' as const }
      const result = await saveMaterial(record as never)
      expect(result.name).toBe('New Name')
    })
  })

  describe('deleteMaterial', () => {
    it('returns false when no user materials file exists', async () => {
      mockExistsSync.mockReturnValue(false)
      const result = await deleteMaterial('nonexistent')
      expect(result).toBe(false)
    })

    it('returns false when material id not found in user library', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify({
        version: 1,
        materials: [{ id: 'other', name: 'Other', category: 'metal' }]
      }))
      const result = await deleteMaterial('nonexistent')
      expect(result).toBe(false)
    })

    it('returns true and removes material from user library', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify({
        version: 1,
        materials: [{ id: 'to-delete', name: 'Delete Me', category: 'metal' }]
      }))
      const result = await deleteMaterial('to-delete')
      expect(result).toBe(true)
      expect(mockWriteFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('importMaterialsJson', () => {
    it('imports materials from JSON text and merges into user library', async () => {
      mockExistsSync.mockReturnValue(false)
      const jsonText = JSON.stringify({
        version: 1,
        materials: [{ id: 'imported', name: 'Imported Mat', category: 'plastic' }]
      })
      const result = await importMaterialsJson(jsonText)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(1)
      expect(result[0]!.id).toBe('imported')
    })

    it('merges imported materials with existing user materials', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue(JSON.stringify({
        version: 1,
        materials: [{ id: 'existing', name: 'Existing', category: 'metal' }]
      }))
      const jsonText = JSON.stringify({
        version: 1,
        materials: [{ id: 'new-import', name: 'New Import', category: 'wood' }]
      })
      const result = await importMaterialsJson(jsonText)
      expect(result.length).toBe(2)
    })

    it('throws on invalid JSON', async () => {
      await expect(importMaterialsJson('not json')).rejects.toThrow()
    })
  })
})
