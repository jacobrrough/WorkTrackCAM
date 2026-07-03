import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { Buffer } from 'node:buffer'
import {
  MAX_DESIGN_SCRIPT_BYTES,
  designScriptRecoverySnapshotSchema,
  type DesignScriptLoadResult,
  type DesignScriptRecoveryReadResult,
  type DesignScriptSaveResult
} from '../shared/design-script-persistence'
import type { DesignRecoveryWriteResult } from '../shared/design-recovery'
import { isENOENT } from '../shared/file-parse-errors'

/**
 * CADQUERY SCRIPT PERSISTENCE — main-process stores.
 *
 * Two stores, mirroring the wave-2 design recovery split:
 *
 *   1. PROJECT STORE — the durable script at
 *      `<projectDir>/design/script.cq.py`. Path-validated (Security Rule 4):
 *      the project dir must be absolute, must exist, and the resolved target
 *      must stay inside it (the relative segment is a constant, so traversal
 *      is impossible by construction — the containment check guards future
 *      edits and hostile projectDir values anyway). Writes are
 *      temp-then-rename so a crash MID-WRITE leaves either the previous
 *      intact script or the new one — never a torn file.
 *
 *   2. RECOVERY STORE — write-ahead crash snapshots in
 *      `userData/recovery/script-<hash>.json`, OUTSIDE the project directory
 *      (same rationale + hashed-filename traversal proofing as
 *      `design-recovery-store.ts`). Every function takes `userDataDir` as a
 *      parameter so the store is testable without an Electron `app` mock.
 *
 * SAFETY: script text only — nothing here reads or writes G-code.
 */

const SCRIPT_SEGMENTS = ['design', 'script.cq.py'] as const

/**
 * Resolve the on-disk script path for a project directory, or null when the
 * directory fails validation (non-string shape guards live in the IPC layer;
 * this enforces absolute + containment).
 */
export function resolveDesignScriptPath(projectDir: string): string | null {
  if (projectDir.trim().length === 0) return null
  if (!isAbsolute(projectDir)) return null
  const root = resolve(projectDir)
  const file = resolve(root, ...SCRIPT_SEGMENTS)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (!file.startsWith(prefix)) return null
  return file
}

/**
 * Atomically persist the script to `<projectDir>/design/script.cq.py`.
 * Rejects (never throws): invalid/relative project dirs, non-existent
 * project roots, and oversize payloads (> {@link MAX_DESIGN_SCRIPT_BYTES}).
 */
export async function saveDesignScriptToProject(
  projectDir: string,
  scriptText: string
): Promise<DesignScriptSaveResult> {
  const file = resolveDesignScriptPath(projectDir)
  if (file === null) return { ok: false, reason: 'invalid' }
  if (Buffer.byteLength(scriptText, 'utf-8') > MAX_DESIGN_SCRIPT_BYTES) {
    return { ok: false, reason: 'invalid' }
  }
  try {
    const rootStat = await stat(resolve(projectDir))
    if (!rootStat.isDirectory()) return { ok: false, reason: 'write_failed' }
  } catch {
    // Never create a project tree as a side effect of a script save.
    return { ok: false, reason: 'write_failed' }
  }
  try {
    await mkdir(join(resolve(projectDir), SCRIPT_SEGMENTS[0]), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, scriptText, 'utf-8')
    await rename(tmp, file)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'write_failed' }
  }
}

/**
 * Read the persisted script (+ its mtime for the recovery newer-than
 * comparison). A missing file is the normal case (`reason: 'none'`); an
 * oversize file is rejected as `invalid` (symmetric with the save cap).
 */
export async function loadDesignScriptFromProject(
  projectDir: string
): Promise<DesignScriptLoadResult> {
  const file = resolveDesignScriptPath(projectDir)
  if (file === null) return { ok: false, reason: 'invalid' }
  let mtimeMs: number
  try {
    const st = await stat(file)
    if (st.size > MAX_DESIGN_SCRIPT_BYTES) return { ok: false, reason: 'invalid' }
    mtimeMs = st.mtimeMs
  } catch (e) {
    return { ok: false, reason: isENOENT(e) ? 'none' : 'read_failed' }
  }
  try {
    const script = await readFile(file, 'utf-8')
    return { ok: true, script, mtimeMs }
  } catch {
    return { ok: false, reason: 'read_failed' }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Write-ahead crash snapshots (userData/recovery/script-<hash>.json)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic snapshot filename for a project directory. Same
 * normalization as `designRecoveryFileName` (separators, trailing slashes,
 * case) with a distinct `script-` prefix so the two snapshot families can
 * never collide. The projectDir string can never traverse out of
 * `userData/recovery/` regardless of its content.
 */
export function designScriptRecoveryFileName(projectDir: string): string {
  const normalized = projectDir.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const hash = createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 24)
  return `script-${hash}.json`
}

function scriptRecoveryDir(userDataDir: string): string {
  return join(userDataDir, 'recovery')
}

function scriptRecoveryPath(userDataDir: string, projectDir: string): string {
  return join(scriptRecoveryDir(userDataDir), designScriptRecoveryFileName(projectDir))
}

/**
 * Validate + persist a script recovery snapshot (write-temp-then-rename; a
 * malformed payload is rejected, never written). Mirrors
 * `writeDesignRecoverySnapshot`.
 */
export async function writeDesignScriptRecoverySnapshot(
  userDataDir: string,
  snapshotJson: string
): Promise<DesignRecoveryWriteResult> {
  let data: unknown
  try {
    data = JSON.parse(snapshotJson) as unknown
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  const parsed = designScriptRecoverySnapshotSchema.safeParse(data)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  if (Buffer.byteLength(parsed.data.script, 'utf-8') > MAX_DESIGN_SCRIPT_BYTES) {
    return { ok: false, reason: 'invalid' }
  }
  const file = scriptRecoveryPath(userDataDir, parsed.data.projectDir)
  try {
    await mkdir(scriptRecoveryDir(userDataDir), { recursive: true })
    const tmp = `${file}.tmp`
    await writeFile(tmp, JSON.stringify(parsed.data), 'utf-8')
    await rename(tmp, file)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'write_failed' }
  }
}

/**
 * Read + validate the script snapshot for a project. Also stats
 * `<projectDir>/design/script.cq.py` so `decideScriptRecoveryOffer` can run
 * the newer-than comparison against the persisted state (null when no
 * script has ever been saved).
 */
export async function readDesignScriptRecoverySnapshot(
  userDataDir: string,
  projectDir: string
): Promise<DesignScriptRecoveryReadResult> {
  const file = scriptRecoveryPath(userDataDir, projectDir)
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
  const parsed = designScriptRecoverySnapshotSchema.safeParse(data)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  let persistedScriptMtimeMs: number | null = null
  try {
    const st = await stat(join(projectDir, ...SCRIPT_SEGMENTS))
    persistedScriptMtimeMs = st.mtimeMs
  } catch {
    persistedScriptMtimeMs = null
  }
  return { ok: true, snapshot: parsed.data, persistedScriptMtimeMs }
}

/**
 * Remove the script snapshot (clean save / explicit Discard). Idempotent —
 * a missing file is not an error, and any filesystem failure is swallowed
 * (recovery cleanup must never break a save).
 */
export async function deleteDesignScriptRecoverySnapshot(
  userDataDir: string,
  projectDir: string
): Promise<void> {
  try {
    await rm(scriptRecoveryPath(userDataDir, projectDir), { force: true })
  } catch {
    // Best-effort cleanup; a stale snapshot is filtered by the newer-than
    // comparison on the next read anyway.
  }
}
