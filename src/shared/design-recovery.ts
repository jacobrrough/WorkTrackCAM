import { z } from 'zod'
import { designFileSchemaV2, type DesignFileV2 } from './design-schema'

/**
 * AUTOSAVE + CRASH RECOVERY (Phase 1, docs/PARITY-ROADMAP.md).
 *
 * The design session's in-memory sketch model (`DesignFileV2` in the doc
 * reducer) is the ONLY volatile piece of the Design workspace: kernel-op
 * timeline gestures persist immediately (commitKernelFeatures), drawing edits
 * persist behind a 400 ms debounce + unmount flush, but sketch edits live in
 * memory until an explicit Save or a kernel build. A crash (sidecar, Electron,
 * power) between edits and Save loses them. The recovery snapshot captures
 * exactly that volatile state to `userData/recovery/` so the next launch can
 * OFFER (never auto-apply) a restore.
 *
 * Additive only: this schema is a NEW sidecar file format; it never changes
 * `project.json` / `design/sketch.json` (Safety Rule 2).
 */

/** Bump only with a migration path; readers reject unknown versions safely. */
export const DESIGN_RECOVERY_SNAPSHOT_VERSION = 1

export const designRecoverySnapshotSchema = z.object({
  version: z.literal(1),
  /**
   * Absolute project directory the snapshot belongs to. Echoed back on read
   * and re-checked by {@link decideRecoveryOffer} so a hash collision or a
   * moved project can never restore the wrong project's sketch.
   */
  projectDir: z.string().min(1),
  /** Epoch ms when the renderer captured the snapshot. */
  savedAtMs: z.number().finite().nonnegative(),
  /** The full volatile sketch model, validated against the REAL design schema. */
  design: designFileSchemaV2
})

export type DesignRecoverySnapshot = z.infer<typeof designRecoverySnapshotSchema>

/** Wire result of the `recovery:designWrite` IPC. */
export type DesignRecoveryWriteResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'write_failed' }

/**
 * Wire result of the `recovery:designRead` IPC. `persistedDesignMtimeMs` is
 * the mtime of `<projectDir>/design/sketch.json` (null when the project has
 * no saved sketch yet) so the offer decision can compare snapshot freshness
 * against the persisted state WITHOUT trusting renderer clocks alone.
 */
export type DesignRecoveryReadResult =
  | { ok: true; snapshot: DesignRecoverySnapshot; persistedDesignMtimeMs: number | null }
  | { ok: false; reason: 'none' | 'invalid' | 'read_failed' }

export type DesignRecoveryOfferDecision =
  | { offer: true; snapshot: DesignRecoverySnapshot }
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
 * Pure decide-to-offer logic (node-tested). An offer is made ONLY when every
 * check passes:
 *   1. a snapshot exists and parsed against the schema (a corrupt/invalid
 *      recovery file is rejected safely - never offered, never thrown);
 *   2. the snapshot's own projectDir matches the open project;
 *   3. the snapshot is strictly NEWER than the persisted sketch on disk
 *      (equal-or-older means the operator saved after the snapshot was taken,
 *      e.g. via a direct designSave path - the snapshot protects nothing);
 *      a missing on-disk sketch (mtime null) passes this check;
 *   4. the snapshot's design actually differs from the design loaded from
 *      disk (restoring an identical model would be noise).
 *
 * NEVER applies anything - callers surface a banner and wait for an explicit
 * user action (the Cycle-249 lesson: restores must be user-initiated, not
 * effect-initiated).
 */
export function decideRecoveryOffer(
  read: DesignRecoveryReadResult,
  args: { projectDir: string; loadedDesign: DesignFileV2 | null }
): DesignRecoveryOfferDecision {
  if (!read.ok) {
    return {
      offer: false,
      reason: read.reason === 'invalid' ? 'invalid_snapshot' : 'no_snapshot'
    }
  }
  const { snapshot, persistedDesignMtimeMs } = read
  if (snapshot.projectDir !== args.projectDir) {
    return { offer: false, reason: 'wrong_project' }
  }
  if (persistedDesignMtimeMs !== null && snapshot.savedAtMs <= persistedDesignMtimeMs) {
    return { offer: false, reason: 'stale_snapshot' }
  }
  if (
    args.loadedDesign !== null &&
    JSON.stringify(snapshot.design) === JSON.stringify(args.loadedDesign)
  ) {
    return { offer: false, reason: 'same_as_loaded' }
  }
  return { offer: true, snapshot }
}
