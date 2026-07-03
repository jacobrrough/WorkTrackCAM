/**
 * CADQUERY SCRIPT PERSISTENCE - main-process store tests (REAL fs in temp
 * dirs; the store takes explicit dirs so no Electron mock is needed).
 * Covers: path validation (absolute-only + containment - Security Rule 4),
 * atomic save round-trip (no .tmp residue), size caps, the write-ahead
 * script crash snapshot round-trip, corrupt/schema-invalid rejection, the
 * persisted-script mtime stat, and the traversal-proof hashed filename.
 * Mirrors design-recovery-store.test.ts.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteDesignScriptRecoverySnapshot,
  designScriptRecoveryFileName,
  loadDesignScriptFromProject,
  readDesignScriptRecoverySnapshot,
  resolveDesignScriptPath,
  saveDesignScriptToProject,
  writeDesignScriptRecoverySnapshot
} from './design-script-store'
import {
  MAX_DESIGN_SCRIPT_BYTES,
  type DesignScriptRecoverySnapshot
} from '../shared/design-script-persistence'

let userDataDir: string
let projectDir: string

const SCRIPT = '# demo\nimport cadquery as cq\nresult = cq.Workplane("XY").box(10, 20, 5)\n'

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'wt-script-ud-'))
  projectDir = mkdtempSync(join(tmpdir(), 'wt-script-proj-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

function validSnapshot(savedAtMs = 1234, script = SCRIPT): DesignScriptRecoverySnapshot {
  return { version: 1, projectDir, savedAtMs, script }
}

describe('resolveDesignScriptPath - Security Rule 4 path validation', () => {
  it('resolves the constant design/script.cq.py under an absolute project dir', () => {
    const p = resolveDesignScriptPath(projectDir)
    expect(p).toBe(join(projectDir, 'design', 'script.cq.py'))
  })

  it('rejects relative and empty project dirs', () => {
    expect(resolveDesignScriptPath('projects/mine')).toBeNull()
    expect(resolveDesignScriptPath('')).toBeNull()
    expect(resolveDesignScriptPath('   ')).toBeNull()
    expect(resolveDesignScriptPath('../../etc')).toBeNull()
  })

  it('stays inside the RESOLVED project dir even for dot-dotted absolute input', () => {
    const dotted = join(projectDir, 'sub', '..')
    const p = resolveDesignScriptPath(dotted)
    expect(p).toBe(join(projectDir, 'design', 'script.cq.py'))
  })
})

describe('saveDesignScriptToProject / loadDesignScriptFromProject', () => {
  it('atomic save -> load round-trip preserves the exact script text', async () => {
    const w = await saveDesignScriptToProject(projectDir, SCRIPT)
    expect(w).toEqual({ ok: true })
    const r = await loadDesignScriptFromProject(projectDir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.script).toBe(SCRIPT)
      expect(r.mtimeMs).toBeGreaterThan(0)
    }
  })

  it('preserves CRLF + unicode content verbatim', async () => {
    const gnarly = '# umlaut ü, CJK 中, emoji ⚙️\r\nresult = 1\r\n'
    await saveDesignScriptToProject(projectDir, gnarly)
    const r = await loadDesignScriptFromProject(projectDir)
    expect(r.ok && r.script === gnarly).toBe(true)
  })

  it('leaves no .tmp residue after a save (temp-then-rename)', async () => {
    await saveDesignScriptToProject(projectDir, SCRIPT)
    const entries = readdirSync(join(projectDir, 'design'))
    expect(entries).toEqual(['script.cq.py'])
  })

  it('a second save replaces the first (latest script wins)', async () => {
    await saveDesignScriptToProject(projectDir, 'result = 1\n')
    await saveDesignScriptToProject(projectDir, 'result = 2\n')
    const r = await loadDesignScriptFromProject(projectDir)
    expect(r.ok && r.script === 'result = 2\n').toBe(true)
  })

  it('rejects a relative project dir without touching disk', async () => {
    const w = await saveDesignScriptToProject('relative/dir', SCRIPT)
    expect(w).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects an oversize script without writing', async () => {
    const big = 'x'.repeat(MAX_DESIGN_SCRIPT_BYTES + 1)
    const w = await saveDesignScriptToProject(projectDir, big)
    expect(w).toEqual({ ok: false, reason: 'invalid' })
    expect(existsSync(join(projectDir, 'design', 'script.cq.py'))).toBe(false)
  })

  it('never creates a project tree as a side effect (missing root -> write_failed)', async () => {
    const ghost = join(projectDir, 'does-not-exist')
    const w = await saveDesignScriptToProject(ghost, SCRIPT)
    expect(w).toEqual({ ok: false, reason: 'write_failed' })
    expect(existsSync(ghost)).toBe(false)
  })

  it('load of a missing script -> { ok: false, reason: none }', async () => {
    const r = await loadDesignScriptFromProject(projectDir)
    expect(r).toEqual({ ok: false, reason: 'none' })
  })

  it('load rejects an oversize on-disk file as invalid', async () => {
    mkdirSync(join(projectDir, 'design'), { recursive: true })
    writeFileSync(
      join(projectDir, 'design', 'script.cq.py'),
      'x'.repeat(MAX_DESIGN_SCRIPT_BYTES + 1),
      'utf-8'
    )
    const r = await loadDesignScriptFromProject(projectDir)
    expect(r).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('designScriptRecoveryFileName', () => {
  it('is deterministic and separator/case/trailing-slash insensitive', () => {
    const a = designScriptRecoveryFileName('C:\\Users\\jacob\\proj')
    expect(designScriptRecoveryFileName('C:/Users/jacob/proj')).toBe(a)
    expect(designScriptRecoveryFileName('C:/Users/Jacob/Proj')).toBe(a)
    expect(designScriptRecoveryFileName('C:/Users/jacob/proj/')).toBe(a)
  })

  it('is a plain hashed filename - projectDir content can never traverse paths', () => {
    const name = designScriptRecoveryFileName('../../../../etc/passwd')
    expect(name).toMatch(/^script-[0-9a-f]{24}\.json$/)
  })

  it('never collides with the sketch snapshot family (distinct prefix)', () => {
    expect(designScriptRecoveryFileName('C:/a').startsWith('script-')).toBe(true)
  })
})

describe('writeDesignScriptRecoverySnapshot / readDesignScriptRecoverySnapshot', () => {
  it('validated write -> read round-trip preserves the snapshot', async () => {
    const snap = validSnapshot()
    const w = await writeDesignScriptRecoverySnapshot(userDataDir, JSON.stringify(snap))
    expect(w).toEqual({ ok: true })
    const r = await readDesignScriptRecoverySnapshot(userDataDir, projectDir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot).toEqual(snap)
      // No design/script.cq.py in the temp project yet -> mtime is null.
      expect(r.persistedScriptMtimeMs).toBeNull()
    }
  })

  it('rejects malformed JSON without touching disk', async () => {
    const w = await writeDesignScriptRecoverySnapshot(userDataDir, 'not json {{{')
    expect(w).toEqual({ ok: false, reason: 'invalid' })
    expect(existsSync(join(userDataDir, 'recovery'))).toBe(false)
  })

  it('rejects a schema-invalid snapshot (wrong version) without writing', async () => {
    const w = await writeDesignScriptRecoverySnapshot(
      userDataDir,
      JSON.stringify({ ...validSnapshot(), version: 99 })
    )
    expect(w).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects an oversize snapshot script', async () => {
    const w = await writeDesignScriptRecoverySnapshot(
      userDataDir,
      JSON.stringify(validSnapshot(1, 'x'.repeat(MAX_DESIGN_SCRIPT_BYTES + 1)))
    )
    expect(w).toEqual({ ok: false, reason: 'invalid' })
  })

  it('read of a missing snapshot -> { ok: false, reason: none }', async () => {
    const r = await readDesignScriptRecoverySnapshot(userDataDir, projectDir)
    expect(r).toEqual({ ok: false, reason: 'none' })
  })

  it('read of a corrupted on-disk snapshot -> rejected safely as invalid', async () => {
    const dir = join(userDataDir, 'recovery')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, designScriptRecoveryFileName(projectDir)), '{"torn":', 'utf-8')
    const r = await readDesignScriptRecoverySnapshot(userDataDir, projectDir)
    expect(r).toEqual({ ok: false, reason: 'invalid' })
  })

  it('stats the persisted script mtime for the newer-than decision', async () => {
    await saveDesignScriptToProject(projectDir, SCRIPT)
    await writeDesignScriptRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot()))
    const r = await readDesignScriptRecoverySnapshot(userDataDir, projectDir)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(typeof r.persistedScriptMtimeMs).toBe('number')
      expect(r.persistedScriptMtimeMs).toBeGreaterThan(0)
    }
  })

  it('a second write replaces the first (latest snapshot wins)', async () => {
    await writeDesignScriptRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot(1000)))
    await writeDesignScriptRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot(2000)))
    const r = await readDesignScriptRecoverySnapshot(userDataDir, projectDir)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.snapshot.savedAtMs).toBe(2000)
  })
})

describe('deleteDesignScriptRecoverySnapshot - delete on clean save', () => {
  it('removes the snapshot so the next read finds none', async () => {
    await writeDesignScriptRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot()))
    await deleteDesignScriptRecoverySnapshot(userDataDir, projectDir)
    const r = await readDesignScriptRecoverySnapshot(userDataDir, projectDir)
    expect(r).toEqual({ ok: false, reason: 'none' })
  })

  it('is idempotent - deleting a missing snapshot never throws', async () => {
    await expect(deleteDesignScriptRecoverySnapshot(userDataDir, projectDir)).resolves.toBeUndefined()
    await expect(deleteDesignScriptRecoverySnapshot(userDataDir, projectDir)).resolves.toBeUndefined()
  })

  it('only deletes the target project snapshot (sibling projects untouched)', async () => {
    const other = { ...validSnapshot(), projectDir: projectDir + '-other' }
    await writeDesignScriptRecoverySnapshot(userDataDir, JSON.stringify(validSnapshot()))
    await writeDesignScriptRecoverySnapshot(userDataDir, JSON.stringify(other))
    await deleteDesignScriptRecoverySnapshot(userDataDir, projectDir)
    const r = await readDesignScriptRecoverySnapshot(userDataDir, projectDir + '-other')
    expect(r.ok).toBe(true)
  })
})
