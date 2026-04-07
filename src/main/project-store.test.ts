import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockReadFile, mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn()
}))

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir
}))

import { newProject, readProjectFile, writeProjectFile } from './project-store'

const minimalProjectJson = JSON.stringify({
  version: 1,
  name: 'Fixture',
  updatedAt: '2020-01-01T00:00:00.000Z',
  activeMachineId: 'machine-a',
  meshes: ['part.stl'],
  importHistory: [],
  notes: 'hello'
})

describe('project-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
  })

  describe('newProject', () => {
    it('returns a v1 project with expected defaults', () => {
      const p = newProject('My Job', 'm-1')
      expect(p).toEqual({
        version: 1,
        name: 'My Job',
        updatedAt: expect.any(String),
        activeMachineId: 'm-1',
        meshes: [],
        importHistory: [],
        notes: ''
      })
    })
  })

  describe('readProjectFile', () => {
    it('reads and parses project.json with schema', async () => {
      mockReadFile.mockResolvedValue(minimalProjectJson)
      const dir = '/tmp/proj'
      const p = await readProjectFile(dir)
      expect(mockReadFile).toHaveBeenCalledWith(join(dir, 'project.json'), 'utf-8')
      expect(p.name).toBe('Fixture')
      expect(p.meshes).toEqual(['part.stl'])
      expect(p.notes).toBe('hello')
    })

    it('rejects invalid project payload', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ version: 1 }))
      await expect(readProjectFile('/x')).rejects.toThrow()
    })
  })

  describe('writeProjectFile', () => {
    it('mkdir recursive, then writes pretty JSON', async () => {
      const dir = '/data/my-project'
      const project = newProject('Out', 'mid')
      await writeProjectFile(dir, project)
      expect(mockMkdir).toHaveBeenCalledWith(dir, { recursive: true })
      expect(mockWriteFile).toHaveBeenCalledWith(
        join(dir, 'project.json'),
        expect.stringContaining('"name": "Out"'),
        'utf-8'
      )
      const written = mockWriteFile.mock.calls[0]![1] as string
      expect(written).toContain('\n')
    })
  })
})
