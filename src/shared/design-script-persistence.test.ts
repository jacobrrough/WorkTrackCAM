/**
 * CADQUERY SCRIPT PERSISTENCE - shared logic tests: the recovery snapshot
 * schema, the pure decide-to-offer mirror of decideRecoveryOffer, and the
 * two pure host seams (runScriptSave / runScriptProjectOpen) WorkspaceHost
 * wires to window.fab. All dependency functions are injected fakes here;
 * the real-store round-trip lives in
 * src/renderer/app/__tests__/WorkspaceHost.script-persistence.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DESIGN_SCRIPT_RELATIVE_PATH,
  decideScriptRecoveryOffer,
  designScriptRecoverySnapshotSchema,
  runScriptProjectOpen,
  runScriptSave,
  type DesignScriptRecoveryReadResult,
  type DesignScriptRecoverySnapshot
} from './design-script-persistence'

const PROJECT = 'C:/jobs/bracket'
const SCRIPT = 'result = cq.Workplane("XY").box(1, 2, 3)\n'

function snap(over: Partial<DesignScriptRecoverySnapshot> = {}): DesignScriptRecoverySnapshot {
  return { version: 1, projectDir: PROJECT, savedAtMs: 5000, script: SCRIPT, ...over }
}

function okRead(
  snapshot: DesignScriptRecoverySnapshot,
  persistedScriptMtimeMs: number | null
): DesignScriptRecoveryReadResult {
  return { ok: true, snapshot, persistedScriptMtimeMs }
}

describe('designScriptRecoverySnapshotSchema', () => {
  it('accepts a valid snapshot (empty script allowed)', () => {
    expect(designScriptRecoverySnapshotSchema.safeParse(snap()).success).toBe(true)
    expect(designScriptRecoverySnapshotSchema.safeParse(snap({ script: '' })).success).toBe(true)
  })

  it('rejects wrong version / empty projectDir / negative timestamp / non-string script', () => {
    expect(designScriptRecoverySnapshotSchema.safeParse({ ...snap(), version: 2 }).success).toBe(false)
    expect(designScriptRecoverySnapshotSchema.safeParse({ ...snap(), projectDir: '' }).success).toBe(false)
    expect(designScriptRecoverySnapshotSchema.safeParse({ ...snap(), savedAtMs: -1 }).success).toBe(false)
    expect(designScriptRecoverySnapshotSchema.safeParse({ ...snap(), script: 42 }).success).toBe(false)
  })
})

describe('decideScriptRecoveryOffer - mirror of decideRecoveryOffer', () => {
  it('no snapshot -> no_snapshot; invalid file -> invalid_snapshot', () => {
    expect(
      decideScriptRecoveryOffer({ ok: false, reason: 'none' }, { projectDir: PROJECT, loadedScript: null })
    ).toEqual({ offer: false, reason: 'no_snapshot' })
    expect(
      decideScriptRecoveryOffer({ ok: false, reason: 'invalid' }, { projectDir: PROJECT, loadedScript: null })
    ).toEqual({ offer: false, reason: 'invalid_snapshot' })
  })

  it('snapshot for another project -> wrong_project', () => {
    const d = decideScriptRecoveryOffer(okRead(snap({ projectDir: 'C:/other' }), null), {
      projectDir: PROJECT,
      loadedScript: null
    })
    expect(d).toEqual({ offer: false, reason: 'wrong_project' })
  })

  it('snapshot equal-or-older than the persisted script -> stale_snapshot', () => {
    const d = decideScriptRecoveryOffer(okRead(snap({ savedAtMs: 5000 }), 5000), {
      projectDir: PROJECT,
      loadedScript: 'older'
    })
    expect(d).toEqual({ offer: false, reason: 'stale_snapshot' })
  })

  it('snapshot identical to the loaded script -> same_as_loaded', () => {
    const d = decideScriptRecoveryOffer(okRead(snap(), 1000), {
      projectDir: PROJECT,
      loadedScript: SCRIPT
    })
    expect(d).toEqual({ offer: false, reason: 'same_as_loaded' })
  })

  it('newer, differing snapshot -> offer (missing on-disk script passes the mtime check)', () => {
    const s = snap()
    expect(
      decideScriptRecoveryOffer(okRead(s, null), { projectDir: PROJECT, loadedScript: null })
    ).toEqual({ offer: true, snapshot: s })
    expect(
      decideScriptRecoveryOffer(okRead(s, 1000), { projectDir: PROJECT, loadedScript: 'different' })
    ).toEqual({ offer: true, snapshot: s })
  })
})

describe('runScriptSave - the Save gesture seam', () => {
  it('no project open -> honest session-only warning, no IPC at all', async () => {
    const saveScript = vi.fn()
    const writeRecovery = vi.fn()
    const outcome = await runScriptSave({
      projectDir: null,
      script: SCRIPT,
      saveScript,
      writeRecovery
    })
    expect(outcome.persisted).toBe(false)
    expect(outcome.toast.kind).toBe('warn')
    expect(saveScript).not.toHaveBeenCalled()
    expect(writeRecovery).not.toHaveBeenCalled()
  })

  it('writes the WRITE-AHEAD snapshot before the project save, then reports persisted', async () => {
    const calls: string[] = []
    const outcome = await runScriptSave({
      projectDir: PROJECT,
      script: SCRIPT,
      nowMs: () => 7777,
      saveScript: async () => {
        calls.push('save')
        return { ok: true }
      },
      writeRecovery: async (json) => {
        calls.push('recovery')
        const parsed = designScriptRecoverySnapshotSchema.parse(JSON.parse(json))
        expect(parsed).toEqual({ version: 1, projectDir: PROJECT, savedAtMs: 7777, script: SCRIPT })
        return { ok: true }
      }
    })
    expect(calls).toEqual(['recovery', 'save'])
    expect(outcome.persisted).toBe(true)
    expect(outcome.toast.kind).toBe('ok')
    expect(outcome.toast.message).toContain(DESIGN_SCRIPT_RELATIVE_PATH)
  })

  it('a failed disk save folds to an err toast (buffer kept + crash-protected)', async () => {
    const outcome = await runScriptSave({
      projectDir: PROJECT,
      script: SCRIPT,
      saveScript: async () => ({ ok: false, reason: 'write_failed' }),
      writeRecovery: async () => ({ ok: true })
    })
    expect(outcome.persisted).toBe(false)
    expect(outcome.toast.kind).toBe('err')
    expect(outcome.toast.message).toContain('write_failed')
  })

  it('a THROWING bridge never escapes the seam (rejections fold to err)', async () => {
    const outcome = await runScriptSave({
      projectDir: PROJECT,
      script: SCRIPT,
      saveScript: async () => {
        throw new Error('ipc gone')
      },
      writeRecovery: async () => {
        throw new Error('ipc gone')
      }
    })
    expect(outcome.persisted).toBe(false)
    expect(outcome.toast.kind).toBe('err')
  })
})

describe('runScriptProjectOpen - the project-open seam', () => {
  const noRecovery = async (): Promise<DesignScriptRecoveryReadResult> => ({
    ok: false,
    reason: 'none'
  })

  it('seeds from disk ONLY while the buffer is still the pristine starter', async () => {
    const loadScript = async () => ({ ok: true as const, script: SCRIPT, mtimeMs: 1 })
    const seeded = await runScriptProjectOpen({
      projectDir: PROJECT,
      currentBuffer: '# starter',
      pristineBuffer: '# starter',
      loadScript,
      readRecovery: noRecovery
    })
    expect(seeded.seedScript).toBe(SCRIPT)

    // Cycle-249: a manual in-session edit is NEVER clobbered by a disk copy.
    const kept = await runScriptProjectOpen({
      projectDir: PROJECT,
      currentBuffer: '# my unsaved masterpiece',
      pristineBuffer: '# starter',
      loadScript,
      readRecovery: noRecovery
    })
    expect(kept.seedScript).toBeNull()
    expect(kept.loadedScript).toBe(SCRIPT)
  })

  it('no script on disk -> nothing seeded, nothing offered', async () => {
    const d = await runScriptProjectOpen({
      projectDir: PROJECT,
      currentBuffer: '# starter',
      pristineBuffer: '# starter',
      loadScript: async () => ({ ok: false as const, reason: 'none' as const }),
      readRecovery: noRecovery
    })
    expect(d).toEqual({ seedScript: null, loadedScript: null, recoveryOffer: null })
  })

  it('surfaces a newer differing snapshot as an OFFER (never applied here)', async () => {
    const s = snap({ script: '# crashed unsaved work' })
    const d = await runScriptProjectOpen({
      projectDir: PROJECT,
      currentBuffer: '# starter',
      pristineBuffer: '# starter',
      loadScript: async () => ({ ok: true as const, script: SCRIPT, mtimeMs: 1 }),
      readRecovery: async () => okRead(s, 1000)
    })
    expect(d.seedScript).toBe(SCRIPT)
    expect(d.recoveryOffer).toEqual(s)
  })

  it('suppresses the offer when the snapshot matches what the editor will show', async () => {
    const d = await runScriptProjectOpen({
      projectDir: PROJECT,
      currentBuffer: '# starter',
      pristineBuffer: '# starter',
      loadScript: async () => ({ ok: false as const, reason: 'none' as const }),
      readRecovery: async () => okRead(snap({ script: '# starter' }), null)
    })
    expect(d.recoveryOffer).toBeNull()
  })

  it('throwing bridges degrade to structured misses (seam never throws)', async () => {
    const d = await runScriptProjectOpen({
      projectDir: PROJECT,
      currentBuffer: '# starter',
      pristineBuffer: '# starter',
      loadScript: async () => {
        throw new Error('ipc gone')
      },
      readRecovery: async () => {
        throw new Error('ipc gone')
      }
    })
    expect(d).toEqual({ seedScript: null, loadedScript: null, recoveryOffer: null })
  })
})
