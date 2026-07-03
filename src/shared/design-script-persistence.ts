import { z } from 'zod'
import type { DesignRecoveryWriteResult } from './design-recovery'

/**
 * CADQUERY SCRIPT BUFFER DISK PERSISTENCE (Fusion-parity wave 4).
 *
 * Before this module, the Design editor's CadQuery script buffer lived ONLY
 * in renderer state: `WorkspaceHost.designScript` seeded `DesignWorkspace`'s
 * mount-only `initialScript`, and Save merely copied the buffer back into
 * that same React state ("saved to session"). Nothing ever reached disk — an
 * app close or crash lost the script entirely. (The dormant
 * `project.json#designModels[].scriptText` slot is written by no runtime
 * code path, and rewriting all of `project.json` from the Design workspace
 * would race the concurrent `manufacture:*` writers — so the script gets its
 * own project-relative file instead, next to the design session's other
 * part files.)
 *
 * On-disk home: `<projectDir>/design/script.cq.py` — a sibling of
 * `design/sketch.json`, diff-friendly, and directly runnable/inspectable.
 * Writes are atomic (temp-then-rename) and path-validated inside the project
 * directory (Security Rule 4) in `src/main/design-script-store.ts`.
 *
 * Crash coverage mirrors the wave-2 design recovery pattern
 * (`design-recovery.ts` / `design-recovery-store.ts`): a WRITE-AHEAD script
 * snapshot lands in `userData/recovery/` before every project save attempt,
 * a clean save deletes it, and the next project-open runs
 * {@link decideScriptRecoveryOffer} — an OFFER (banner), never an auto-apply
 * (the Cycle-249 contract: state-replacing restores are explicit user
 * actions only).
 *
 * Additive only: a new sidecar file format + a new project-relative file;
 * `project.json` is never touched (Safety Rule 2). SAFETY: script text only —
 * no G-code is generated or modified anywhere in this path.
 */

/** Project-relative home of the persisted CadQuery script. */
export const DESIGN_SCRIPT_RELATIVE_PATH = 'design/script.cq.py'

/**
 * Upper bound on a persistable script (UTF-8 bytes). Hand-authored CadQuery
 * scripts are a few KB; 2 MB is far beyond any legitimate buffer and bounds
 * both the IPC payload and the recovery snapshot file.
 */
export const MAX_DESIGN_SCRIPT_BYTES = 2 * 1024 * 1024

/** Wire result of the `designScript:save` IPC. */
export type DesignScriptSaveResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'write_failed' }

/** Wire result of the `designScript:load` IPC (`mtimeMs` of the script file). */
export type DesignScriptLoadResult =
  | { ok: true; script: string; mtimeMs: number }
  | { ok: false; reason: 'none' | 'invalid' | 'read_failed' }

/** Bump only with a migration path; readers reject unknown versions safely. */
export const DESIGN_SCRIPT_RECOVERY_SNAPSHOT_VERSION = 1

export const designScriptRecoverySnapshotSchema = z.object({
  version: z.literal(1),
  /**
   * Absolute project directory the snapshot belongs to. Echoed back on read
   * and re-checked by {@link decideScriptRecoveryOffer} so a hash collision
   * or a moved project can never restore the wrong project's script.
   */
  projectDir: z.string().min(1),
  /** Epoch ms when the renderer captured the snapshot. */
  savedAtMs: z.number().finite().nonnegative(),
  /** The full volatile script buffer. */
  script: z.string()
})

export type DesignScriptRecoverySnapshot = z.infer<typeof designScriptRecoverySnapshotSchema>

/**
 * Wire result of the `designScript:recoveryRead` IPC.
 * `persistedScriptMtimeMs` is the mtime of
 * `<projectDir>/design/script.cq.py` (null when the project has no saved
 * script yet) so the offer decision can compare snapshot freshness against
 * the persisted state WITHOUT trusting renderer clocks alone.
 */
export type DesignScriptRecoveryReadResult =
  | {
      ok: true
      snapshot: DesignScriptRecoverySnapshot
      persistedScriptMtimeMs: number | null
    }
  | { ok: false; reason: 'none' | 'invalid' | 'read_failed' }

export type DesignScriptRecoveryOfferDecision =
  | { offer: true; snapshot: DesignScriptRecoverySnapshot }
  | {
      offer: false
      reason:
        | 'no_snapshot'
        | 'invalid_snapshot'
        | 'wrong_project'
        | 'stale_snapshot'
        | 'same_as_loaded'
    }

/**
 * Pure decide-to-offer logic — a 1:1 mirror of `decideRecoveryOffer` in
 * `design-recovery.ts`, specialised to the script string. An offer is made
 * ONLY when every check passes:
 *   1. a snapshot exists and parsed against the schema;
 *   2. the snapshot's own projectDir matches the open project;
 *   3. the snapshot is strictly NEWER than the persisted script on disk
 *      (equal-or-older means a clean save landed after the snapshot);
 *      a missing on-disk script (mtime null) passes this check;
 *   4. the snapshot's script actually differs from the script loaded from
 *      disk (restoring an identical buffer would be noise).
 *
 * NEVER applies anything — callers surface a banner and wait for an explicit
 * user action (the Cycle-249 lesson: restores must be user-initiated, not
 * effect-initiated).
 */
export function decideScriptRecoveryOffer(
  read: DesignScriptRecoveryReadResult,
  args: { projectDir: string; loadedScript: string | null }
): DesignScriptRecoveryOfferDecision {
  if (!read.ok) {
    return {
      offer: false,
      reason: read.reason === 'invalid' ? 'invalid_snapshot' : 'no_snapshot'
    }
  }
  const { snapshot, persistedScriptMtimeMs } = read
  if (snapshot.projectDir !== args.projectDir) {
    return { offer: false, reason: 'wrong_project' }
  }
  if (persistedScriptMtimeMs !== null && snapshot.savedAtMs <= persistedScriptMtimeMs) {
    return { offer: false, reason: 'stale_snapshot' }
  }
  if (args.loadedScript !== null && snapshot.script === args.loadedScript) {
    return { offer: false, reason: 'same_as_loaded' }
  }
  return { offer: true, snapshot }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure host seams (the `workspace-host-handoff` pattern): WorkspaceHost wires
// these to the real `window.fab` bridge; tests wire them to the real
// main-process store over a temp dir, proving the save→load round-trip
// without mounting the full provider chain.
// ─────────────────────────────────────────────────────────────────────────────

/** Outcome of a Save gesture, folded down to the honest toast to show. */
export type ScriptSaveOutcome = {
  /** True only when the script verifiably landed in the project file. */
  readonly persisted: boolean
  readonly toast: { readonly kind: 'ok' | 'warn' | 'err'; readonly message: string }
}

export interface RunScriptSaveDeps {
  /** Open project directory, or null when no project is open. */
  readonly projectDir: string | null
  /** The script buffer handed up by the editor's Save. */
  readonly script: string
  /** `window.fab.designScriptSave` (atomic project write). */
  readonly saveScript: (projectDir: string, script: string) => Promise<DesignScriptSaveResult>
  /** `window.fab.designScriptRecoveryWrite` (write-ahead crash snapshot). */
  readonly writeRecovery: (snapshotJson: string) => Promise<DesignRecoveryWriteResult>
  /** Injectable clock for deterministic tests. */
  readonly nowMs?: () => number
}

/**
 * Save the script buffer durably. Order matters:
 *   1. WRITE-AHEAD snapshot to `userData/recovery/` (best-effort — a
 *      snapshot failure never blocks the save) so a crash MID-save still
 *      leaves a restorable copy;
 *   2. atomic project write to `design/script.cq.py`;
 *   3. on success the main-process handler deletes the snapshot (clean-save
 *      semantics), so the caller only needs to clear any stale banner.
 * With no project open there is nothing durable to write — the outcome says
 * so honestly (the old "saved to session" toast implied durability it never
 * had).
 */
export async function runScriptSave(deps: RunScriptSaveDeps): Promise<ScriptSaveOutcome> {
  const { projectDir, script } = deps
  if (projectDir === null) {
    return {
      persisted: false,
      toast: {
        kind: 'warn',
        message: 'Script saved for this session only — open a project to keep it on disk.'
      }
    }
  }
  const snapshot: DesignScriptRecoverySnapshot = {
    version: 1,
    projectDir,
    savedAtMs: (deps.nowMs ?? Date.now)(),
    script
  }
  try {
    await deps.writeRecovery(JSON.stringify(snapshot))
  } catch {
    // Best-effort write-ahead; the atomic project write below is the real save.
  }
  let saved: DesignScriptSaveResult
  try {
    saved = await deps.saveScript(projectDir, script)
  } catch (e) {
    saved = { ok: false, reason: 'write_failed' }
    void e
  }
  if (saved.ok) {
    return {
      persisted: true,
      toast: { kind: 'ok', message: `Script saved to ${DESIGN_SCRIPT_RELATIVE_PATH}.` }
    }
  }
  return {
    persisted: false,
    toast: {
      kind: 'err',
      message: `Script could NOT be written to disk (${saved.reason}) — kept in session and crash-protected.`
    }
  }
}

/** What the host should do after a project-open script load. */
export interface ScriptProjectOpenDecision {
  /**
   * Non-null → replace the editor buffer with this script (and remount the
   * editor). Only ever non-null when the current buffer is still the
   * pristine starter — a manual in-session edit is NEVER clobbered by a
   * disk copy without the user acting (Cycle-249).
   */
  readonly seedScript: string | null
  /** The script found on disk (null when the project has none saved). */
  readonly loadedScript: string | null
  /** Non-null → surface the Restore/Discard banner for this snapshot. */
  readonly recoveryOffer: DesignScriptRecoverySnapshot | null
}

export interface RunScriptProjectOpenDeps {
  readonly projectDir: string
  /** The buffer the host currently holds (last-saved session script). */
  readonly currentBuffer: string
  /** The untouched default (STARTER_SCRIPT) — the only clobber-safe buffer. */
  readonly pristineBuffer: string
  /** `window.fab.designScriptLoad`. */
  readonly loadScript: (projectDir: string) => Promise<DesignScriptLoadResult>
  /** `window.fab.designScriptRecoveryRead`. */
  readonly readRecovery: (projectDir: string) => Promise<DesignScriptRecoveryReadResult>
}

/**
 * Project-open sequence: load `design/script.cq.py`, decide whether the
 * editor may be seeded from it (pristine buffer only), then run the crash
 * snapshot offer decision against the loaded state. Both IPC calls degrade
 * to structured misses on rejection — this seam never throws.
 */
export async function runScriptProjectOpen(
  deps: RunScriptProjectOpenDeps
): Promise<ScriptProjectOpenDecision> {
  let loaded: DesignScriptLoadResult
  try {
    loaded = await deps.loadScript(deps.projectDir)
  } catch {
    loaded = { ok: false, reason: 'read_failed' }
  }
  const loadedScript = loaded.ok ? loaded.script : null
  const seedScript =
    loadedScript !== null &&
    deps.currentBuffer === deps.pristineBuffer &&
    loadedScript !== deps.currentBuffer
      ? loadedScript
      : null

  let read: DesignScriptRecoveryReadResult
  try {
    read = await deps.readRecovery(deps.projectDir)
  } catch {
    read = { ok: false, reason: 'read_failed' }
  }
  const decision = decideScriptRecoveryOffer(read, {
    projectDir: deps.projectDir,
    loadedScript
  })
  // Suppress the offer when the snapshot matches what the editor will show
  // anyway (the seeded disk copy, or the untouched session buffer).
  const effectiveBuffer = seedScript ?? deps.currentBuffer
  const recoveryOffer =
    decision.offer && decision.snapshot.script !== effectiveBuffer ? decision.snapshot : null
  return { seedScript, loadedScript, recoveryOffer }
}
