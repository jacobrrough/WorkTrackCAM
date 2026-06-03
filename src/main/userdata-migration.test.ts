import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mock electron so importing the module resolves cleanly in the node test env.
// The core `migrateUserDataDirs` takes explicit paths and runs against real fs;
// only `migrateLegacyUserData` touches `app.getPath`.
vi.mock('electron', () => ({
  app: { getPath: vi.fn() }
}))

import { app } from 'electron'
import { migrateUserDataDirs, migrateLegacyUserData } from './userdata-migration'

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

describe('userdata-migration', () => {
  let root: string
  let legacyDir: string
  let currentDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    root = await mkdtemp(join(tmpdir(), 'wt3d-migrate-'))
    legacyDir = join(root, 'WorkTrackCAM')
    currentDir = join(root, 'WorkTrack3D')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('copies settings.json and machines/ from the legacy dir on first launch', async () => {
    await mkdir(join(legacyDir, 'machines'), { recursive: true })
    await writeFile(
      join(legacyDir, 'settings.json'),
      JSON.stringify({ moonrakerUrl: 'http://k2.local', hasCompletedOnboarding: true }),
      'utf-8'
    )
    await writeFile(join(legacyDir, 'machines', 'custom.json'), '{"id":"custom"}', 'utf-8')

    const result = await migrateUserDataDirs(currentDir, legacyDir)

    expect(result.migrated).toBe(true)
    expect(result.copied).toContain('settings.json')
    expect(result.copied).toContain('machines')
    expect(result.from).toBe(legacyDir)

    expect(await exists(join(currentDir, 'settings.json'))).toBe(true)
    const moved = JSON.parse(await readFile(join(currentDir, 'settings.json'), 'utf-8'))
    expect(moved.moonrakerUrl).toBe('http://k2.local')
    expect(moved.hasCompletedOnboarding).toBe(true)
    expect(await exists(join(currentDir, 'machines', 'custom.json'))).toBe(true)
  })

  it('carries every allowlisted profile dir (materials, tool-libraries, posts)', async () => {
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'settings.json'), '{}', 'utf-8')
    for (const dir of ['materials', 'tool-libraries', 'posts']) {
      await mkdir(join(legacyDir, dir), { recursive: true })
      await writeFile(join(legacyDir, dir, 'entry.json'), '{}', 'utf-8')
    }

    const result = await migrateUserDataDirs(currentDir, legacyDir)

    expect(result.copied).toEqual(
      expect.arrayContaining(['settings.json', 'materials', 'tool-libraries', 'posts'])
    )
    for (const dir of ['materials', 'tool-libraries', 'posts']) {
      expect(await exists(join(currentDir, dir, 'entry.json'))).toBe(true)
    }
  })

  it('is a no-op and does NOT clobber when the new dir already has settings.json', async () => {
    await mkdir(currentDir, { recursive: true })
    await writeFile(join(currentDir, 'settings.json'), '{"theme":"graphite"}', 'utf-8')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'settings.json'), '{"theme":"light"}', 'utf-8')

    const result = await migrateUserDataDirs(currentDir, legacyDir)

    expect(result.migrated).toBe(false)
    const kept = JSON.parse(await readFile(join(currentDir, 'settings.json'), 'utf-8'))
    expect(kept.theme).toBe('graphite')
  })

  it('is a no-op for a fresh install (no legacy dir)', async () => {
    const result = await migrateUserDataDirs(currentDir, legacyDir)
    expect(result.migrated).toBe(false)
    expect(result.copied).toEqual([])
    expect(await exists(currentDir)).toBe(false)
  })

  it('copies ONLY the allowlist — never Electron internals or logs', async () => {
    await mkdir(join(legacyDir, 'GPUCache'), { recursive: true })
    await mkdir(join(legacyDir, 'logs'), { recursive: true })
    await writeFile(join(legacyDir, 'settings.json'), '{}', 'utf-8')
    await writeFile(join(legacyDir, 'GPUCache', 'data_0'), 'x', 'utf-8')
    await writeFile(join(legacyDir, 'logs', 'main-process.log'), 'log', 'utf-8')

    await migrateUserDataDirs(currentDir, legacyDir)

    expect(await exists(join(currentDir, 'settings.json'))).toBe(true)
    expect(await exists(join(currentDir, 'GPUCache'))).toBe(false)
    expect(await exists(join(currentDir, 'logs'))).toBe(false)
  })

  it('returns migrated=false when legacy === current (rename was a no-op)', async () => {
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'settings.json'), '{}', 'utf-8')
    const result = await migrateUserDataDirs(legacyDir, legacyDir)
    expect(result.migrated).toBe(false)
  })

  it('migrateLegacyUserData wires app.getPath(userData) + appData/WorkTrackCAM', async () => {
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, 'settings.json'), '{"units":"inch"}', 'utf-8')
    vi.mocked(app.getPath).mockImplementation((name: string): string =>
      name === 'userData' ? currentDir : root
    )

    const result = await migrateLegacyUserData()

    expect(result.migrated).toBe(true)
    expect(await exists(join(currentDir, 'settings.json'))).toBe(true)
    const moved = JSON.parse(await readFile(join(currentDir, 'settings.json'), 'utf-8'))
    expect(moved.units).toBe('inch')
  })
})
