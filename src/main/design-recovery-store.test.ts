/**
 * AUTOSAVE + CRASH RECOVERY - main-process snapshot store tests (REAL fs in a
 * temp dir; the store takes `userDataDir` as a parameter so no Electron mock
 * is needed). Covers: validated write round-trip, safe rejection of malformed
 * payloads/files, delete-on-clean-save semantics (idempotent delete), the
 * persisted-sketch mtime stat, and the traversal-proof hashed filename.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteDesignRecoverySnapshot,
  designRecoveryFileName,
  readDesignRecoverySnapshot,
  writeDesignRecoverySnapshot
} from './design-recovery-store'
import { emptyDesign } from '../shared/design-schema'
import type { DesignRecoverySnapshot } from '../shared/design-recovery'

let userDataDir: string
let projectDir: string

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'wt-recovery-ud-'))
  projectDir = mkdtempSync(join(tmpdir(), 'wt-recovery-proj-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

function validSnapshot(savedAtMs = 1234): DesignRecoverySnapshot {
  return {
    version: 1,
    projectDir,
    savedAtMs,
    design: {
      ...emptyDesign(),
      entities: [{ id: 'r1', kind: 'rect', cx: 1, cy: 2, w: 10, h: 20, rotation: 0 }]
    }
  }
}

describe('designRecoveryFileName', () => {
  it('is deterministic and separator/case/trailing-slash insensitive', () => {
    const a = designRecoveryFileName('C:\\Users\\jacob\\proj')
    expect(designRecoveryFileName('C:/Users/jacob/proj')).toBe(a)
    expect(designRecoveryFileName('C:/Users/Jacob/Proj')).toBe(a)
    expect(designRecoveryFileName('C:/Users/jacob/proj/')).toBe(a)
  })

  it('differs for different projects', () => {
    expect(designRecoveryFileName('C:/a')).not.toBe(designRecoveryFileName('C:/b'))
  })

  it('is a plain hashed filename - projectDir content can never traverse paths', () => {
    const name = designRecoveryFileName('../../../../etc/passwd')
    expect(name).toMatch(/^design-[0-9a-f]{24}\.json$/)
  })
})

describe('writeDesignRecoverySnapshot / readDesignRecoverySnapshot', () => {
  it('validated write -> read round-trip preserves the snapshot', async () => {
    const snap = validSnapshot()
    const w = await writeDesignRecoverySnapshot(userDataDir, JSON.stringify(snap))
    expect(w).toEqual({ ok: true })
    const r = await readDesignRecoverySnapshot(userDataDir, projectDir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot).toEqual(snap)
      // No design/sketch.json in the temp project yet -> mtime is null.
      expect(r.persistedDesignMtimeMs).toBeNull()
    }
  })

  it('rejects malformed JSON without touching disk', async () => {
    const w = await writeDesignRecoverySnapshot(userDataDir, 'not json {{{')
    expect(w).toEqual({ ok: false, reason: 'invalid' })
    expect(() => readdirSync(join(userDataDir, 'recovery'))).toThrow()
  })

  it('rejects a schema-invalid snapshot (wrong version) without writing', async () => {
    const w = await writeDesignRecoverySnapshot(
      userDataDir,
      JSON.stringify({ ...validSnapshot(), version: 99 })
    )
    expect(w).toEqual({ ok: false, reason: 'invalid' })
  })

  it('read of a missing snapshot -> { ok: false, reason: none }', async () => {
    const r = await readDesignRecoverySnapshot(userDataDir, projectDir)
    expect(r).toEqual({ ok: false, reason: 'none' })
  })

  it('read of a corrupted on-disk snapshot -> rejected safely as invalid', async () => {
    const dir = join(userDataDir, 'recovery')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, designRecoveryFileName(projectDir)), '{"torn":', 'utf-8')
    const r = await readDesignRecoverySnapshot(userDataDir, projectDir)
    expect(r).toEqual({ ok: false, reason: 'invalid' })
  })

  it('read of a schema-invalid on-disk snapshot -> rejected safely as invalid', async () => {
    const dir = join(userDataDir, 'recovery')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, designRecoveryFileName(projectDir)),
      JSON.stringify({ version: 1, projectDir, savedAtMs: 1, design: { nope: true } }),
      'utf-8'
    )
    const r = await readDesignRecoverySnapshot(userDataDir, projectDir)
    expect(r).toEqual({ ok: false, reason: 'invalid' })
  })

  it('stats the persisted design/sketch.json mtime for the newer-than decision', async () => {
    mkdirSync(join(projectDir, 'design'), { recursive: true })
    writeFileSync(join(projectDir, 'design', 'sketch.json'), JSON.stringify(emptyDesign()), 'utf-8')
    await writeDesignRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot()))
    const r = await readDesignRecoverySnapshot(userDataDir, projectDir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(typeof r.persistedDesignMtimeMs).toBe('number')
      expect(r.persistedDesignMtimeMs).toBeGreaterThan(0)
    }
  })

  it('a second write replaces the first (latest snapshot wins)', async () => {
    await writeDesignRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot(1000)))
    await writeDesignRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot(2000)))
    const r = await readDesignRecoverySnapshot(userDataDir, projectDir)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.snapshot.savedAtMs).toBe(2000)
  })
})

describe('deleteDesignRecoverySnapshot - delete on clean save', () => {
  it('removes the snapshot so the next read finds none', async () => {
    await writeDesignRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot()))
    await deleteDesignRecoverySnapshot(userDataDir, projectDir)
    const r = await readDesignRecoverySnapshot(userDataDir, projectDir)
    expect(r).toEqual({ ok: false, reason: 'none' })
  })

  it('is idempotent - deleting a missing snapshot never throws', async () => {
    await expect(deleteDesignRecoverySnapshot(userDataDir, projectDir)).resolves.toBeUndefined()
    await expect(deleteDesignRecoverySnapshot(userDataDir, projectDir)).resolves.toBeUndefined()
  })

  it('only deletes the target project snapshot (sibling projects untouched)', async () => {
    const other = { ...validSnapshot(), projectDir: projectDir + '-other' }
    await writeDesignRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot()))
    await writeDesignRecoverySnapshot(userDataDir, JSON.stringify(other))
    await deleteDesignRecoverySnapshot(userDataDir, projectDir)
    const r = await readDesignRecoverySnapshot(userDataDir, projectDir + '-other')
    expect(r.ok).toBe(true)
  })
})
