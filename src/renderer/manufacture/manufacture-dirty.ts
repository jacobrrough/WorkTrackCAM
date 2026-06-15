/**
 * manufacture-dirty — PURE dirty-tracking primitives for the Manufacture
 * workspace's unsaved-changes navigation guard.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ──────────────────────────────────────────────────────────────────────────
 * `ManufactureWorkspace` holds the manufacture plan (`mfg`) in memory and only
 * writes it to disk on the explicit Save button. Switching workspaces UNMOUNTS
 * the workspace and destroys that in-memory plan (see `navigation-guard.ts`).
 * To warn before that loss, the workspace must know whether `mfg` has diverged
 * from the last-persisted snapshot.
 *
 * `manufacturePlanFingerprint(mfg)` produces a STABLE string of the persisted
 * plan shape; `isManufacturePlanDirty(current, baseline)` is a plain string
 * compare of two fingerprints. The workspace records the baseline fingerprint
 * at the three moments the on-disk and in-memory plans are known-equal:
 *   (a) right after the load effect's `setMfg(loaded)`,
 *   (b) on the empty / no-project branch (`emptyManufacture()`),
 *   (c) after a SUCCESSFUL save.
 * Any subsequent edit (`setMfg(...)`) changes the live fingerprint → dirty.
 *
 * WHY A CANONICAL FINGERPRINT INSTEAD OF `JSON.stringify(mfg) !== baseline`:
 * a raw `JSON.stringify` is key-ORDER sensitive. React state updates and the
 * Zod-parsed disk reload can legitimately reorder object keys without changing
 * the persisted meaning, which would flip a clean plan to "dirty" and nag the
 * operator on every navigation. This module serializes with sorted keys so the
 * fingerprint depends only on the plan's CONTENT, not on key insertion order —
 * the exact independence the unit tests pin.
 *
 * SCOPE: the fingerprint covers the fields `manufactureSave` actually persists
 * (`version`, `setups`, `operations`, `plates`). It mirrors what the operator
 * would lose, not transient UI state (selected op index, collapse flags, etc.),
 * which is intentionally excluded — losing those on a route switch is not data
 * loss.
 *
 * SAFETY: PURE — no React, no IPC, no disk I/O, no G-code. Node-SSR testable.
 */
import type { ManufactureFile } from '../../shared/manufacture-schema'

/**
 * Recursively serialize a JSON-ish value with OBJECT KEYS SORTED, so the output
 * depends only on content, not on key insertion order. Arrays keep their order
 * (order is meaningful for operations / setups / plates). `undefined` object
 * values are dropped (they are not persisted by `JSON.stringify` either), so an
 * absent key and an explicit `undefined` fingerprint identically.
 */
function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value !== 'object') {
    // function / symbol / bigint / undefined — none are persisted; normalize.
    return 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')
  return `{${body}}`
}

/**
 * Compute a stable fingerprint of the PERSISTED shape of a manufacture plan.
 *
 * Only the fields written to `manufacture.json` are folded in (`version`,
 * `setups`, `operations`, `plates`). Object keys are sorted recursively so two
 * plans that are equal-up-to-key-order fingerprint identically (the operator
 * should not be nagged when nothing they would lose has changed).
 *
 * Adding a setup, operation, or plate — or editing any persisted field of one —
 * changes the fingerprint, which is what flips the workspace to "dirty".
 *
 * PURE: never mutates `mfg`.
 */
export function manufacturePlanFingerprint(mfg: ManufactureFile): string {
  // Project to exactly the persisted fields, in case the live object ever
  // carries extra transient keys; stableStringify then sorts for order safety.
  const persisted = {
    version: mfg.version,
    setups: mfg.setups,
    operations: mfg.operations,
    plates: mfg.plates
  }
  return stableStringify(persisted)
}

/**
 * Whether the current plan diverges from the last-persisted baseline.
 *
 * A plain string compare of two {@link manufacturePlanFingerprint} outputs:
 * `true` means there are unsaved changes (the route-switch guard should
 * confirm before unmounting), `false` means the in-memory plan matches disk.
 *
 * PURE.
 */
export function isManufacturePlanDirty(current: string, baseline: string): boolean {
  return current !== baseline
}
