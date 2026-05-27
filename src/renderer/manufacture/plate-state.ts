/**
 * Gap #7 v1: multi-plate / multi-job project -- pure plate-state helpers.
 *
 * The `ManufactureWorkspace` component stores a `ManufactureFile` whose v2 shape
 * holds per-plate Setup + Op bundles under `plates: Plate[]`. The existing
 * downstream components (`MakeraFunctionsPanel`, `ManufactureOperationList`,
 * `ManufactureSetupList`, etc.) all expect a `ManufactureFile` with `setups`
 * and `operations` at the top level -- they were written before plates existed.
 *
 * Rather than rewrite every consumer, we synthesize an **effective** `ManufactureFile`
 * for the active plate: a copy of `mfg` whose top-level `setups` and `operations`
 * point at the active plate\'s arrays. Consumers read it as a normal mfg; writes
 * are routed back into the active plate via `updateActivePlate`.
 *
 * If `mfg.plates` is absent (a brand-new in-memory `emptyManufacture()` will
 * have plates, but a v1 file loaded outside the IPC migration path will not),
 * we fall back to the legacy top-level arrays so the renderer never crashes.
 *
 * No new IPC, no schema mutation here -- all migration and persistence is owned
 * by `manufacture-schema.ts` + `ipc-fabrication.ts` + `schema-migration.ts`.
 */
import {
  createDefaultPlate,
  DEFAULT_PLATE_ID,
  type ManufactureFile,
  type ManufactureOperation,
  type ManufactureSetup,
  type Plate
} from '../../shared/manufacture-schema'

/**
 * Return the plate list for the given mfg, **always non-empty**.
 *
 * - If `mfg.plates` exists and has at least one entry, returns it as-is.
 * - Otherwise synthesizes a single default plate from the legacy top-level
 *   `setups` / `operations` arrays (handles v1 files loaded outside the IPC
 *   migration pipeline + defensive UI state).
 */
export function getPlates(mfg: ManufactureFile): Plate[] {
  if (mfg.plates && mfg.plates.length > 0) {
    return [...mfg.plates]
  }
  return [
    {
      id: DEFAULT_PLATE_ID,
      label: 'Default plate',
      setups: mfg.setups,
      operations: mfg.operations
    }
  ]
}

/**
 * Find the active plate by id, falling back to plates[0] when the id is unknown
 * or the plates array is empty. Always returns a Plate so callers can render
 * without null-checks.
 */
export function getActivePlate(mfg: ManufactureFile, activePlateId: string | null): Plate {
  const plates = getPlates(mfg)
  if (activePlateId) {
    const match = plates.find((p) => p.id === activePlateId)
    if (match) return match
  }
  return plates[0]!
}

/**
 * Build an "effective" ManufactureFile whose top-level `setups` + `operations`
 * mirror the active plate. Use this when passing `mfg` to legacy components
 * (`MakeraFunctionsPanel`, `ManufactureOperationList`, `ManufactureSetupList`,
 * `ManufactureCamSimulationPanel`, etc.) that read `mfg.setups` / `mfg.operations`
 * directly.
 *
 * The returned file keeps `version`, `plates`, and any future top-level fields
 * intact -- only `setups` / `operations` are rewritten to the active plate\'s
 * contents.
 */
export function viewMfgAsActivePlate(
  mfg: ManufactureFile,
  activePlateId: string | null
): ManufactureFile {
  const plate = getActivePlate(mfg, activePlateId)
  return {
    ...mfg,
    setups: plate.setups,
    operations: plate.operations
  }
}

/**
 * Apply a pure update to the active plate\'s contents and return a new
 * `ManufactureFile`. Used to wrap existing setMfg callers so they continue
 * to feel like "mfg has top-level setups/operations" while actually mutating
 * the per-plate bundle.
 */
export function updateActivePlate(
  mfg: ManufactureFile,
  activePlateId: string | null,
  updater: (plate: Plate) => Plate
): ManufactureFile {
  const plates = getPlates(mfg)
  const targetIdx = activePlateId
    ? Math.max(0, plates.findIndex((p) => p.id === activePlateId))
    : 0
  const nextPlates = plates.map((p, i) => (i === targetIdx ? updater(p) : p))
  return {
    ...mfg,
    // Keep top-level setups/operations cleared on v2 (they\'re a deprecated mirror).
    setups: [],
    operations: [],
    plates: nextPlates
  }
}

/**
 * Append a new plate and return both the updated mfg and the new plate\'s id
 * (so the caller can select it after adding). The label is auto-numbered as
 * "Plate N" where N is the next available index -- OrcaSlicer-style.
 */
export function addPlate(mfg: ManufactureFile): { mfg: ManufactureFile; newPlateId: string } {
  const plates = getPlates(mfg)
  const newPlate: Plate = {
    ...createDefaultPlate(),
    id: `plate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: `Plate ${plates.length + 1}`,
    createdAt: new Date().toISOString()
  }
  return {
    mfg: {
      ...mfg,
      setups: [],
      operations: [],
      plates: [...plates, newPlate]
    },
    newPlateId: newPlate.id
  }
}

/**
 * Remove the plate with the given id. **Refuses** to remove the last plate
 * (returns mfg unchanged) -- UI must hide the close button in that case but we
 * keep the invariant honored in the reducer too.
 *
 * Returns the next-active plate id so the caller can update activePlateId state.
 */
export function removePlate(
  mfg: ManufactureFile,
  plateId: string
): { mfg: ManufactureFile; nextActivePlateId: string } {
  const plates = getPlates(mfg)
  if (plates.length <= 1) {
    return { mfg, nextActivePlateId: plates[0]!.id }
  }
  const removeIdx = plates.findIndex((p) => p.id === plateId)
  if (removeIdx < 0) {
    return { mfg, nextActivePlateId: plates[0]!.id }
  }
  const nextPlates = plates.filter((_, i) => i !== removeIdx)
  // Bias activation toward the previous plate, falling back to index 0.
  const nextIdx = Math.max(0, removeIdx - 1)
  const nextActivePlateId = nextPlates[nextIdx]!.id
  return {
    mfg: {
      ...mfg,
      setups: [],
      operations: [],
      plates: nextPlates
    },
    nextActivePlateId
  }
}

/**
 * Rename a plate. Whitespace-only labels are ignored (caller\'s UI should
 * already trim/validate, but this is a defensive guard for the reducer).
 */
export function renamePlate(
  mfg: ManufactureFile,
  plateId: string,
  newLabel: string
): ManufactureFile {
  const trimmed = newLabel.trim()
  if (!trimmed) return mfg
  const plates = getPlates(mfg)
  const nextPlates = plates.map((p) => (p.id === plateId ? { ...p, label: trimmed } : p))
  return {
    ...mfg,
    setups: [],
    operations: [],
    plates: nextPlates
  }
}

/**
 * Re-export the Setup / Operation types so the workspace and tests can import
 * everything plate-related from a single module.
 */
export type { ManufactureFile, ManufactureSetup, ManufactureOperation, Plate }
