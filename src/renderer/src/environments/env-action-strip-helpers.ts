/**
 * Pure helpers used by `EnvActionStrip.tsx`. Kept in a `.ts` module so they
 * can be unit-tested in the node environment without importing React.
 */
import type { MachineProfile, MaterialRecord } from '../shop-types'
import type { ShopEnvironment } from './registry'

// ── VCarve Pro: wood material filter ────────────────────────────────────────

/**
 * Material name/category keywords that mark a record as a wood for the
 * VCarve Pro quick-pick. Matched case-insensitively against `name` and
 * `category`.
 */
export const WOOD_KEYWORDS = [
  'wood',
  'plywood',
  'mdf',
  'oak',
  'pine',
  'maple',
  'birch',
  'walnut',
  'softwood',
  'hardwood'
]

/** True when the material name or category includes a wood keyword. */
export function isWoodMaterial(m: MaterialRecord): boolean {
  const name = (m.name ?? '').toLowerCase()
  const category = ((m as { category?: string }).category ?? '').toLowerCase()
  return WOOD_KEYWORDS.some((kw) => name.includes(kw) || category.includes(kw))
}

// ── Creality Print: filament material filter ────────────────────────────────

/**
 * Material name/category keywords that mark a record as a filament. Filaments
 * are not yet a discriminated material kind in the schema — a dedicated
 * `filaments.json` bundle is the proper long-term home — but matching by name
 * keeps the strip honest: it only surfaces records the user has explicitly
 * named after a filament family, instead of fronting CNC stock as filament.
 */
export const FILAMENT_KEYWORDS = [
  'pla',
  'petg',
  'pet-g',
  'abs',
  'asa',
  'tpu',
  'nylon',
  'pa6',
  'pa12',
  'pc',
  'polycarbonate',
  'pva',
  'hips',
  'peek',
  'pei',
  'pekk',
  'filament'
]

/** True when the material name or category includes a filament keyword. */
export function isFilamentMaterial(m: MaterialRecord): boolean {
  const name = (m.name ?? '').toLowerCase()
  const category = ((m as { category?: string }).category ?? '').toLowerCase()
  return FILAMENT_KEYWORDS.some((kw) => name.includes(kw) || category.includes(kw))
}

// ── Makera CAM: 3-axis ↔ 4-axis HD variant resolution ───────────────────────

/**
 * Resolve the Carvera variants for the Makera environment in their declared
 * order. Filters the global machine list down to entries listed in the
 * environment's `machineIds` and preserves that order so the axis pill
 * always renders 3-Axis before 4-Axis HD.
 */
export function resolveMakeraVariants(
  env: ShopEnvironment,
  machines: readonly MachineProfile[]
): MachineProfile[] {
  return env.machineIds
    .map((id) => machines.find((m) => m.id === id))
    .filter((m): m is MachineProfile => Boolean(m))
}

/**
 * True when a machine profile is the 4-axis HD Carvera variant. The Makera
 * strip uses this to label the pill ("4-Axis HD" vs "3-Axis"). Matches both
 * the explicit `axisCount` field and the dialect string for safety.
 */
export function isFourAxisCarvera(m: MachineProfile): boolean {
  return (m.axisCount ?? 3) >= 4 || m.dialect.includes('4axis')
}

/**
 * Build a quick-pick subset that keeps the currently selected material visible
 * while prioritizing records that match the environment filter.
 */
export function buildQuickPickMaterials(
  materials: readonly MaterialRecord[],
  selectedId: string | null,
  predicate: (material: MaterialRecord) => boolean,
  limit = 6
): MaterialRecord[] {
  const selected = selectedId ? materials.find((m) => m.id === selectedId) : undefined
  const prioritized = materials.filter(predicate)
  const fallback = prioritized.length > 0 ? prioritized : [...materials]
  const merged: MaterialRecord[] = []
  if (selected) merged.push(selected)
  for (const material of fallback) {
    if (merged.some((m) => m.id === material.id)) continue
    merged.push(material)
    if (merged.length >= limit) break
  }
  return merged
}
