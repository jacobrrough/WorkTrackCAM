import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveUniqueFilenameInDir } from './unique-asset-filename'

describe('resolveUniqueFilenameInDir', () => {
  it('returns preferred when free, else suffixes', async () => {
    const dir = join(tmpdir(), `ufs-unique-${Date.now()}`)
    await mkdir(dir, { recursive: true })
    const a = await resolveUniqueFilenameInDir(dir, 'part.stl')
    expect(a).toMatch(/[/\\]part\.stl$/)
    await writeFile(a, '')
    const b = await resolveUniqueFilenameInDir(dir, 'part.stl')
    expect(b).toMatch(/part_1\.stl$/)

    await writeFile(b, '')
    const c = await resolveUniqueFilenameInDir(dir, 'part.stl')
    expect(c).toMatch(/part_2\.stl$/)
  })
})
