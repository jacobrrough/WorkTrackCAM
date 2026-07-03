/**
 * CADQUERY SCRIPT BUFFER DISK PERSISTENCE (Fusion-parity wave 4) — the
 * save→load round-trip proven THROUGH the host seam.
 *
 * `WorkspaceHost` wires the Design editor's Save/project-open to the pure
 * `runScriptSave` / `runScriptProjectOpen` seams (`design-script-persistence`),
 * which in turn call `window.fab.designScript*`. The renderer test env is node
 * (no DOM renderer / no real click — see the sibling `workspace-host-handoff`
 * test), so rather than mount the whole provider chain we bind those seams to
 * the REAL main-process store (`design-script-store`) over a temp dir — the
 * exact code the IPC handlers run — and drive the same call graph the mounted
 * host would. This proves:
 *   - Save persists to `<projectDir>/design/script.cq.py` AND a project-open on
 *     a pristine buffer seeds the editor back from that file (the durability
 *     the buffer-only "Save" never had);
 *   - a manual in-session edit is NEVER clobbered by the disk copy on open
 *     (the Cycle-249 contract);
 *   - a crash (Save wrote the write-ahead snapshot but the project write is
 *     rolled back) surfaces a Restore OFFER on the next open — same
 *     restore-offer semantics as the wave-2 sketch recovery;
 *   - a clean save deletes the snapshot so no stale offer survives.
 *
 * SAFETY: script text only — no G-code is produced anywhere in this path.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  runScriptProjectOpen,
  runScriptSave,
  DESIGN_SCRIPT_RELATIVE_PATH
} from '../../../shared/design-script-persistence'
import {
  deleteDesignScriptRecoverySnapshot,
  loadDesignScriptFromProject,
  readDesignScriptRecoverySnapshot,
  saveDesignScriptToProject,
  writeDesignScriptRecoverySnapshot
} from '../../../main/design-script-store'

const STARTER = '# WorkTrack3D CadQuery starter — a parametric box.\nresult = 1\n'
const EDITED = '# my bracket\nresult = cq.Workplane("XY").box(40, 20, 8)\n'

let userDataDir: string
let projectDir: string

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'wt-host-script-ud-'))
  projectDir = mkdtempSync(join(tmpdir(), 'wt-host-script-proj-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  rmSync(projectDir, { recursive: true, force: true })
})

/**
 * The seam deps `WorkspaceHost` supplies, but pointed at the REAL store over
 * the temp dirs. `saveScript` mirrors the `designScript:save` IPC handler
 * (`ipc-design-script.ts`): a SUCCESSFUL project write also deletes the
 * write-ahead snapshot, which is exactly the clean-save semantics under test.
 */
function hostDeps(): {
  saveScript: (dir: string, s: string) => ReturnType<typeof saveDesignScriptToProject>
  writeRecovery: (json: string) => ReturnType<typeof writeDesignScriptRecoverySnapshot>
  loadScript: (dir: string) => ReturnType<typeof loadDesignScriptFromProject>
  readRecovery: (dir: string) => ReturnType<typeof readDesignScriptRecoverySnapshot>
} {
  return {
    saveScript: async (dir, s) => {
      const result = await saveDesignScriptToProject(dir, s)
      if (result.ok) await deleteDesignScriptRecoverySnapshot(userDataDir, dir)
      return result
    },
    writeRecovery: (json) => writeDesignScriptRecoverySnapshot(userDataDir, json),
    loadScript: (dir) => loadDesignScriptFromProject(dir),
    readRecovery: (dir) => readDesignScriptRecoverySnapshot(userDataDir, dir)
  }
}

describe('WorkspaceHost script persistence — save→load round-trip through the seam', () => {
  it('Save reaches disk, and a fresh project-open seeds the editor back from it', async () => {
    const deps = hostDeps()

    // The Save gesture: WorkspaceHost.handleDesignScriptSave → runScriptSave.
    const saved = await runScriptSave({
      projectDir,
      script: EDITED,
      saveScript: deps.saveScript,
      writeRecovery: deps.writeRecovery
    })
    expect(saved.persisted).toBe(true)
    expect(saved.toast.kind).toBe('ok')
    expect(saved.toast.message).toContain(DESIGN_SCRIPT_RELATIVE_PATH)

    // It really hit disk at the documented project-relative path.
    const onDisk = await readFile(join(projectDir, 'design', 'script.cq.py'), 'utf-8')
    expect(onDisk).toBe(EDITED)

    // A NEW session opens the project on the pristine starter — the open seam
    // seeds the editor from disk (the durability the buffer-only Save lacked).
    const open = await runScriptProjectOpen({
      projectDir,
      currentBuffer: STARTER,
      pristineBuffer: STARTER,
      loadScript: deps.loadScript,
      readRecovery: deps.readRecovery
    })
    expect(open.seedScript).toBe(EDITED)
    expect(open.loadedScript).toBe(EDITED)
    // A clean save deleted the snapshot ⇒ no stale restore offer.
    expect(open.recoveryOffer).toBeNull()
  })

  it('an unsaved in-session edit is NEVER clobbered by the disk copy on open (Cycle-249)', async () => {
    const deps = hostDeps()
    await saveDesignScriptToProject(projectDir, EDITED)

    // Operator has typed something NEW this session (buffer != pristine).
    const open = await runScriptProjectOpen({
      projectDir,
      currentBuffer: '# unsaved masterpiece\nresult = 2\n',
      pristineBuffer: STARTER,
      loadScript: deps.loadScript,
      readRecovery: deps.readRecovery
    })
    expect(open.seedScript).toBeNull()
    // The disk copy is still SURFACED (loadedScript) for the offer decision,
    // but the buffer is left untouched — a load effect never replaces edits.
    expect(open.loadedScript).toBe(EDITED)
  })

  it('a crash between snapshot + project write leaves a Restore OFFER on next open', async () => {
    // Simulate a crash MID-save: the write-ahead snapshot lands, but the
    // project write is rolled back (as if power died before rename committed).
    const crashDeps = {
      writeRecovery: (json: string) => writeDesignScriptRecoverySnapshot(userDataDir, json),
      // The project write "fails" — nothing reaches design/script.cq.py.
      saveScript: async () => ({ ok: false as const, reason: 'write_failed' as const })
    }
    const crashed = await runScriptSave({
      projectDir,
      script: EDITED,
      saveScript: crashDeps.saveScript,
      writeRecovery: crashDeps.writeRecovery
    })
    expect(crashed.persisted).toBe(false)
    expect(crashed.toast.kind).toBe('err')
    // The write-ahead snapshot survived the failed save.
    const snap = await readDesignScriptRecoverySnapshot(userDataDir, projectDir)
    expect(snap.ok).toBe(true)
    // No project file was written (crash-consistent).
    expect(existsSync(join(projectDir, 'design', 'script.cq.py'))).toBe(false)

    // Next launch opens the project (still pristine buffer, no disk script).
    const deps = hostDeps()
    const open = await runScriptProjectOpen({
      projectDir,
      currentBuffer: STARTER,
      pristineBuffer: STARTER,
      loadScript: deps.loadScript,
      readRecovery: deps.readRecovery
    })
    // Nothing to seed (project write never landed) but the crash snapshot is
    // OFFERED (never auto-applied — the banner + explicit Restore owns that).
    expect(open.seedScript).toBeNull()
    expect(open.recoveryOffer).not.toBeNull()
    expect(open.recoveryOffer?.script).toBe(EDITED)
    expect(open.recoveryOffer?.projectDir).toBe(projectDir)
  })

  it('a clean Save after a crash deletes the snapshot so no stale offer survives', async () => {
    // Leftover crash snapshot from a prior session.
    await writeDesignScriptRecoverySnapshot(
      userDataDir,
      JSON.stringify({ version: 1, projectDir, savedAtMs: 10, script: '# stale crash copy\n' })
    )
    const deps = hostDeps()

    // A clean Save now (the IPC handler deletes the snapshot on success).
    const saved = await runScriptSave({
      projectDir,
      script: EDITED,
      saveScript: deps.saveScript,
      writeRecovery: deps.writeRecovery
    })
    expect(saved.persisted).toBe(true)

    // The stale snapshot is gone; a subsequent open offers nothing.
    const open = await runScriptProjectOpen({
      projectDir,
      currentBuffer: STARTER,
      pristineBuffer: STARTER,
      loadScript: deps.loadScript,
      readRecovery: deps.readRecovery
    })
    expect(open.seedScript).toBe(EDITED)
    expect(open.recoveryOffer).toBeNull()
  })

  it('with no project open, Save is honest that nothing durable happened (no IPC)', async () => {
    let saveCalls = 0
    let recoveryCalls = 0
    const outcome = await runScriptSave({
      projectDir: null,
      script: EDITED,
      saveScript: async () => {
        saveCalls++
        return { ok: true }
      },
      writeRecovery: async () => {
        recoveryCalls++
        return { ok: true }
      }
    })
    expect(outcome.persisted).toBe(false)
    expect(outcome.toast.kind).toBe('warn')
    expect(saveCalls).toBe(0)
    expect(recoveryCalls).toBe(0)
  })
})
