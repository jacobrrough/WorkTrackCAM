/**
 * import-stl-into-first-plate — pure plate-mutation helper for the
 * Design → Manufacture STL hand-off (Wave 3h).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES
 * ──────────────────────────────────────────────────────────────────────────
 * After the shell hands a freshly-exported STL from the CAD Design workspace
 * to Manufacture, the STL has already been copied into the project's `assets/`
 * folder by the existing `assets:importMesh` IPC path (which returns a
 * project-relative path like `assets/design-output-xxx.stl`). This helper is
 * the LAST step: it binds that relative path onto the FIRST plate of the
 * manufacture plan so the part actually lands in CAM.
 *
 * Targeting rule (matches the hand-off brief — "import into the first plate"):
 *   - The FIRST plate (`getPlates(mfg)[0]`) is the target. `getPlates` always
 *     yields ≥1 plate (it folds a v1 top-level array into a synthetic default
 *     plate), so there is always a plate to write to.
 *   - If that plate already has operations, the relative mesh is bound onto its
 *     FIRST operation's `sourceMesh` (the operator's existing op picks up the
 *     part). Existing op kind / params are preserved — only `sourceMesh` moves.
 *   - If that plate has NO operations, a single new operation is seeded
 *     (`fdm_slice` for the K2 Plus FDM env, else `cnc_parallel` for the CNC
 *     routers) carrying the relative mesh, so the freshly-imported part is
 *     immediately visible + sliceable / machinable.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SAFETY
 * ──────────────────────────────────────────────────────────────────────────
 * This module is PURE: it takes a `ManufactureFile` + a project-relative mesh
 * path and returns a NEW `ManufactureFile`. It performs no IPC, no disk I/O,
 * and emits NO G-code or toolpath — it only edits the plate/op data model.
 * The write is routed through the existing {@link updateFirstPlate} mirror of
 * the plate-state reducer so the v2 `plates[]` shape stays canonical (top-level
 * `setups`/`operations` are kept as the deprecated empty mirror, exactly like
 * `plate-state.updateActivePlate`).
 *
 * Schema safety (CLAUDE.md Safety Rule 2): no schema change — the produced file
 * is a normal `ManufactureFile` whose ops use the already-existing `sourceMesh`
 * field. A project saved by this helper round-trips through `manufactureSave` /
 * `manufactureLoad` unchanged.
 */
import { getPlates } from '../manufacture/plate-state'
import type {
  ManufactureFile,
  ManufactureOperation,
  Plate
} from '../../shared/manufacture-schema'

/** Env hint used to pick the seeded op kind when the first plate is empty. */
export type CamImportEnv = 'fdm' | 'cnc'

/**
 * Normalize an imported mesh path to the project-relative POSIX form CAM
 * expects (`assets/foo.stl`). The `assets:importMesh` IPC already returns this
 * shape, but we defensively strip a leading slash and back-convert separators
 * so a caller passing a Windows-style or root-anchored path cannot produce an
 * op whose `sourceMesh` fails the `<projectDir>/<rel>` join used downstream.
 */
export function normalizeMeshRelPath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^[\\/]+/, '')
}

/**
 * Generate a stable-ish unique operation id without depending on `crypto`
 * (which is not guaranteed in every renderer/test/node context). Mirrors the
 * id shape used by `plate-state.addPlate` (`<prefix>-<base36 time>-<rand>`).
 */
function newOpId(): string {
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Apply a pure update to the FIRST plate and return a new `ManufactureFile`.
 *
 * This is the first-plate analogue of `plate-state.updateActivePlate` (which
 * targets the *active* plate). The hand-off always targets the first plate
 * regardless of which plate the Manufacture UI currently has selected, so the
 * imported part lands deterministically.
 *
 * Exported for the unit test that pins the first-plate-targeting contract.
 */
export function updateFirstPlate(
  mfg: ManufactureFile,
  updater: (plate: Plate) => Plate
): ManufactureFile {
  const plates = getPlates(mfg)
  const nextPlates = plates.map((p, i) => (i === 0 ? updater(p) : p))
  return {
    ...mfg,
    // Keep the deprecated top-level mirror cleared on the v2 shape, matching
    // every other plate-state reducer (updateActivePlate / addPlate / …).
    setups: [],
    operations: [],
    plates: nextPlates
  }
}

/**
 * Bind a project-relative STL path onto the first plate of `mfg`.
 *
 * @param mfg     the current manufacture plan (any v1/v2 shape; `getPlates`
 *                guarantees ≥1 plate to target).
 * @param relPath project-relative mesh path returned by `assets:importMesh`
 *                (e.g. `assets/design-output-xxx.stl`). Normalized internally.
 * @param opts.env       `'fdm'` seeds an `fdm_slice` op when the plate is empty,
 *                       `'cnc'` seeds a `cnc_parallel` op. Ignored when the
 *                       first plate already has an op (the existing first op is
 *                       reused). Defaults to `'cnc'`.
 * @param opts.opLabel   label for a freshly-seeded op (defaults to the source
 *                       file's stem, falling back to `Imported part`).
 *
 * @returns a NEW `ManufactureFile` with the mesh bound. Never mutates `mfg`.
 */
export function importStlIntoFirstPlate(
  mfg: ManufactureFile,
  relPath: string,
  opts?: { env?: CamImportEnv; opLabel?: string }
): ManufactureFile {
  const rel = normalizeMeshRelPath(relPath)
  const env: CamImportEnv = opts?.env ?? 'cnc'
  return updateFirstPlate(mfg, (plate) => {
    if (plate.operations.length > 0) {
      // Bind onto the existing first op — preserve its kind / params, move only
      // the source mesh. The operator's pre-existing op now cuts/slices the
      // freshly-imported part.
      const ops = [...plate.operations]
      const first = ops[0]!
      ops[0] = { ...first, sourceMesh: rel }
      return { ...plate, operations: ops }
    }
    // Empty plate — seed a single op so the imported part is immediately
    // visible + actionable. FDM gets a slice op; CNC gets a parallel finish.
    const label =
      opts?.opLabel?.trim() ||
      deriveLabelFromRelPath(rel) ||
      'Imported part'
    const seeded: ManufactureOperation = {
      id: newOpId(),
      kind: env === 'fdm' ? 'fdm_slice' : 'cnc_parallel',
      label,
      sourceMesh: rel
    }
    return { ...plate, operations: [seeded] }
  })
}

/**
 * Best-effort human label from a relative mesh path: the file stem with the
 * extension stripped (`assets/widget.stl` → `widget`). Returns `null` when no
 * usable stem can be derived so the caller can fall back.
 */
function deriveLabelFromRelPath(rel: string): string | null {
  const base = rel.split('/').pop() ?? ''
  const stem = base.replace(/\.[^.]+$/, '').trim()
  return stem.length > 0 ? stem : null
}
