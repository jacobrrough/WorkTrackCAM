import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockReaddir, mockReadFile, mockWriteFile, mockMkdir, mockExistsSync } = vi.hoisted(() => ({
  mockReaddir: vi.fn(),
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
  readdir: mockReaddir,
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

import { listAllPosts, saveUserPost, readPostContent } from './posts-manager'

describe('posts-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
  })

  describe('listAllPosts', () => {
    it('returns empty array when no directories exist', async () => {
      mockExistsSync.mockReturnValue(false)
      const result = await listAllPosts()
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })

    it('returns bundled posts when only bundled dir exists', async () => {
      mockExistsSync
        .mockReturnValueOnce(false)   // user dir
        .mockReturnValueOnce(true)    // bundled dir
      mockReaddir.mockResolvedValue(['grbl-mm.hbs', 'fanuc.hbs'])
      mockReadFile.mockResolvedValue('G28 G91 Z0\nG90\nG21')
      const result = await listAllPosts()
      expect(result.length).toBe(2)
      expect(result[0]!.source).toBe('bundled')
    })

    it('user posts override bundled posts with same filename', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReaddir
        .mockResolvedValueOnce(['grbl-mm.hbs'])   // user
        .mockResolvedValueOnce(['grbl-mm.hbs', 'fanuc.hbs'])  // bundled
      mockReadFile.mockResolvedValue('user template content')
      const result = await listAllPosts()
      const grblPosts = result.filter((p) => p.filename === 'grbl-mm.hbs')
      expect(grblPosts.length).toBe(1)
      expect(grblPosts[0]!.source).toBe('user')
    })

    it('only includes .hbs files', async () => {
      mockExistsSync
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
      mockReaddir.mockResolvedValue(['template.hbs', 'readme.txt', 'data.json'])
      mockReadFile.mockResolvedValue('template')
      const result = await listAllPosts()
      expect(result.length).toBe(1)
      expect(result[0]!.filename).toBe('template.hbs')
    })

    it('returns results sorted by filename', async () => {
      mockExistsSync
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true)
      mockReaddir.mockResolvedValue(['z-post.hbs', 'a-post.hbs', 'm-post.hbs'])
      mockReadFile.mockResolvedValue('content')
      const result = await listAllPosts()
      expect(result[0]!.filename).toBe('a-post.hbs')
      expect(result[1]!.filename).toBe('m-post.hbs')
      expect(result[2]!.filename).toBe('z-post.hbs')
    })
  })

  describe('saveUserPost', () => {
    it('saves a .hbs file and returns PostEntry', async () => {
      const result = await saveUserPost('my-post.hbs', 'G28 G91 Z0\nG90\nG21')
      expect(result.filename).toBe('my-post.hbs')
      expect(result.source).toBe('user')
      expect(result.preview).toContain('G28')
      expect(mockWriteFile).toHaveBeenCalledTimes(1)
    })

    it('strips path traversal from filename (uses basename)', async () => {
      const result = await saveUserPost('../../evil.hbs', 'content')
      expect(result.filename).toBe('evil.hbs')
    })

    it('throws for non-.hbs filenames', async () => {
      await expect(saveUserPost('template.txt', 'content')).rejects.toThrow(/\.hbs/)
    })

    it('creates user posts directory if needed', async () => {
      await saveUserPost('new.hbs', 'content')
      expect(mockMkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true })
    })

    it('preview filters out handlebars comments', async () => {
      const template = '{{!-- comment --}}\nG28\nG91\nG90\nG21'
      const result = await saveUserPost('test.hbs', template)
      expect(result.preview).not.toContain('{{!--')
      expect(result.preview).toContain('G28')
    })
  })

  describe('readPostContent', () => {
    it('reads from user dir first if file exists', async () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFile.mockResolvedValue('user template')
      const result = await readPostContent('grbl.hbs')
      expect(result).toBe('user template')
    })

    it('falls back to bundled dir when user file does not exist', async () => {
      mockExistsSync.mockReturnValue(false)
      mockReadFile.mockResolvedValue('bundled template')
      const result = await readPostContent('grbl.hbs')
      expect(result).toBe('bundled template')
    })

    it('strips path traversal from filename (uses basename)', async () => {
      mockExistsSync.mockReturnValue(false)
      mockReadFile.mockResolvedValue('content')
      await readPostContent('../../etc/passwd.hbs')
      // Verify it called with basename'd path, not the traversal path
      const call = mockReadFile.mock.calls[0]![0] as string
      expect(call).not.toContain('..')
    })
  })
})
