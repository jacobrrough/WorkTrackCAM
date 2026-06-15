/**
 * manufacture-load-guard — the anti-clobber primitives for the Manufacture
 * workspace's disk-load + Design→Manufacture STL hand-off.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (the "disappearing-sketch" bug class, Cycle 249 shape)
 * ──────────────────────────────────────────────────────────────────────────
 * `ManufactureWorkspace` holds the manufacture plan (`mfg`) in an in-memory
 * `useState`. Edits — adding a setup, editing an op, renaming/adding a plate —
 * mutate that state and are NOT written to disk until the operator clicks Save.
 * Two destructive paths could wipe those unsaved edits:
 *
 *   1. The workspace's disk-load effect calls `setMfg(loaded)`, REPLACING the
 *      in-memory plan with the on-disk copy. It is keyed on
 *      `[fab, projectDir, reloadNonce]`; a spurious effect re-fire (e.g. a new
 *      dep identity from a parent re-render) would re-read disk over unsaved
 *      edits — exactly the Cycle-249 sketch-clobber, but for CAM state.
 *
 *   2. The Design→Manufacture "Send to CAM" hand-off used to run ENTIRELY in
 *      `ManufactureHost`: it loaded the plan FROM DISK, merged the imported STL,
 *      saved, then bumped `reloadNonce` to force the workspace to re-read disk.
 *      That disk read happened WITHOUT the operator's unsaved in-memory edits,
 *      so the merge+save+reload silently discarded them (and overwrote them on
 *      disk) — the DXF-import persistence-race shape.
 *
 * THE FIX (mirrors `designLoadKey` + the DesignSessionContext load guard):
 *   - `manufactureLoadKey(projectDir, reloadNonce)` is the identity the load
 *     effect remembers; it skips a redundant reload when the key is unchanged,
 *     so a re-fire can never clobber unsaved edits (layer 1).
 *   - `mergeMeshImportIntoLivePlan(...)` lets the hand-off merge into the LIVE
 *     in-memory plan instead of stale disk, preserving unsaved edits (layer 2).
 *
 * SAFETY: this module is PURE — no IPC, no disk I/O, no G-code. It only
 * computes a string key and folds a relative mesh path into a `ManufactureFile`
 * via the existing {@link importStlIntoFirstPlate} reducer.
 */
import {
  importStlIntoFirstPlate,
  type CamImportEnv
} from '../app/import-stl-into-first-plate'
import type { ManufactureFile } from '../../shared/manufacture-schema'

/**
 * The identity the Manufacture load effect was last run for. The effect
 * remembers the last key and skips reloading when it is unchanged, so a
 * spurious effect re-fire (a churning dependency from a parent re-render) can
 * never re-read the on-disk plan over unsaved in-memory edits.
 *
 * `null` when no project is open (nothing to load, nothing to clobber).
 *
 * The `reloadNonce` is folded into the key so a GENUINE host-driven reload
 * (after a Send-to-CAM disk merge bumps the nonce) still produces a new key and
 * therefore still reloads — only redundant re-fires at the SAME (dir, nonce)
 * are suppressed.
 *
 * Exported so the regression test pins the anti-clobber contract.
 */
export function manufactureLoadKey(
  projectDir: string | null,
  reloadNonce: number | undefined
): string | null {
  return projectDir === null ? null : JSON.stringify([projectDir, reloadNonce ?? 0])
}

/** A queued Design→Manufacture mesh import, applied to the LIVE plan. */
export interface PendingMeshImport {
  /** Project-relative mesh path returned by `assets:importMesh`. */
  readonly relPath: string
  /** Seeds the op kind when the first plate is empty (`fdm_slice` vs `cnc_*`). */
  readonly env: CamImportEnv
  /** Optional label for a freshly-seeded op. */
  readonly opLabel?: string
}

/**
 * Fold a queued mesh import into the LIVE in-memory manufacture plan.
 *
 * This is the persistence-race fix: the Send-to-CAM hand-off previously read
 * the plan from DISK before merging, so any unsaved in-memory edits were lost
 * when the merged result was saved + reloaded. By merging into the live `mfg`
 * the workspace already holds, the operator's unsaved setups/ops survive — the
 * imported part is bound on top of them, not on top of a stale disk snapshot.
 *
 * Delegates the actual plate/op mutation to the proven
 * {@link importStlIntoFirstPlate} reducer (binds onto the first plate's first
 * op, or seeds one when the plate is empty), so the targeting contract pinned
 * by `import-stl-into-first-plate.test.ts` is unchanged.
 *
 * PURE: returns a NEW `ManufactureFile`; never mutates `live`.
 */
export function mergeMeshImportIntoLivePlan(
  live: ManufactureFile,
  req: PendingMeshImport
): ManufactureFile {
  return importStlIntoFirstPlate(live, req.relPath, {
    env: req.env,
    ...(req.opLabel !== undefined ? { opLabel: req.opLabel } : {})
  })
}
