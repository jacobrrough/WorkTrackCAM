import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  designRecoverySnapshotSchema,
  type DesignRecoveryReadResult,
  type DesignRecoveryWriteResult
} from '../shared/design-recovery'
import { isENOENT } from '../shared/file-parse-errors'

/**
 * AUTOSAVE + CRASH RECOVERY - main-process snapshot store.
 *
 * Snapshots live OUTSIDE the project directory (in Electron userData) so a
 * crash mid-write can never corrupt project files, and so recovery survives
 * even when the project folder itself is on removable/network storage.
 * Every function takes `userDataDir` as a parameter so the store is testable
 * without an Electron `app` mock (the IPC layer injects
 * `app.getPath('userData')`).
 *
 * Path safety: the recovery filename is a sha256 hash of the normalized
 * project directory - the projectDir string can never traverse out of
 * `userData/recovery/` regardless of its content.
 */

/**
 * Deterministic recovery filename for a project directory. Normalizes
 * separators, trailing slashes, and case (Windows paths are case-insensitive)
 * so the same project always maps to the same file.
 */
export function designRecoveryFileName(projectDir: string): string {
  const normalized = projectDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const hash = createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 24)
  return `design-${hash}.json`
}

export function designRecoveryDir(userDataDir: string): string {
  return join(userDataDir, 'recovery')
}

function designRecoveryPath(userDataDir: string, projectDir: string): string {
  return join(designRecoveryDir(userDataDir), designRecoveryFileName(projectDir))
}

/**
 * Validate + persist a recovery snapshot. The JSON is parsed and re-validated
 * against `designRecoverySnapshotSchema` before anything touches disk (a
 * malformed payload is rejected, never written). The write is
 * write-temp-then-rename so a crash MID-WRITE leaves either the previous
 * intact snapshot or the new one - never a torn file.
 */
export async function writeDesignRecoverySnapshot(
  userDataDir: string,
  snapshotJson: string
): Promise<DesignRecoveryWriteResult> {
  let data: unknown
  try {
    data = JSON.parse(snapshotJson) as unknown
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const parsed = designRecoverySnapshotSchema.safeParse(data)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  const file = designRecoveryPath(userDataDir, parsed.data.projectDir)
  try {
    await mkdir(designRecoveryDir(userDataDir), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(parsed.data), 'utf-8')
    await rename(tmp, file)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'write_failed' }
  }
}

/**
 * Read + validate the recovery snapshot for a project. A missing file is the
 * normal case (`reason: 'none'`); a corrupt or schema-invalid file is
 * rejected safely (`reason: 'invalid'`) - the renderer then simply never
 * offers a restore. Also stats `<projectDir>/design/sketch.json` so the
 * offer decision can run the newer-than comparison against the persisted
 * state (null when no sketch has ever been saved).
 */
export async function readDesignRecoverySnapshot(
  userDataDir: string,
  projectDir: string
): Promise<DesignRecoveryReadResult> {
  const file = designRecoveryPath(userDataDir, projectDir)
  let raw: string
  try {
    raw = await readFile(file, 'utf-8')
  } catch (e) {
    return { ok: false, reason: isENOENT(e) ? 'none' : 'read_failed' }
  }
  let data: unknown
  try {
    data = JSON.parse(raw) as unknown
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const parsed = designRecoverySnapshotSchema.safeParse(data)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  let persistedDesignMtimeMs: number | null = null
  try {
    const st = await stat(join(projectDir, 'design', 'sketch.json'))
    persistedDesignMtimeMs = st.mtimeMs
  } catch {
    persistedDesignMtimeMs = null
  }
  return { ok: true, snapshot: parsed.data, persistedDesignMtimeMs }
}

/**
 * Remove the recovery snapshot for a project (clean save / clean teardown /
 * explicit Discard). Idempotent - a missing file is not an error, and any
 * filesystem failure is swallowed (recovery cleanup must never break a save).
 */
export async function deleteDesignRecoverySnapshot(
  userDataDir: string,
  projectDir: string
): Promise<void> {
  try {
    await rm(designRecoveryPath(userDataDir, projectDir), { force: true })
  } catch {
    // Best-effort cleanup; a stale snapshot is filtered by the newer-than
    // comparison on the next read anyway.
  }
}
