/**
 * Environment routing helpers — translate between machine profiles and the
 * shop environment registry. Pure functions, no React, no localStorage.
 */
import type { MachineProfile } from '../../../shared/machine-schema'
import {
  ENVIRONMENT_LIST,
  ENVIRONMENTS,
  type EnvironmentId,
  type ShopEnvironment
} from './registry'

/**
 * Resolve the environment that owns the given machine ID.
 *
 * Returns `null` for unknown machine IDs (the splash screen treats this as
 * "no environment selected" and shows the chooser).
 */
export function getEnvironmentForMachine(machineId: string | null | undefined): ShopEnvironment | null {
  if (!machineId) return null
  return ENVIRONMENT_LIST.find((env) => env.machineIds.includes(machineId)) ?? null
}

/**
 * Resolve the default machine profile for an environment from a list of
 * available machines (typically from `MachineSessionContext.machines`).
 *
 * Returns `null` when the default machine ID is not present in the list — the
 * caller should fall back to a generic chooser or show an "install machine"
 * prompt.
 */
export function getDefaultMachineForEnvironment(
  env: ShopEnvironment,
  machines: readonly MachineProfile[]
): MachineProfile | null {
  return machines.find((m) => m.id === env.defaultMachineId) ?? null
}

/**
 * Resolve all machine profiles that belong to an environment, in the order
 * declared on the environment definition.
 *
 * Used by the Makera CAM splash card to render both Carvera variants side by
 * side, and by the brand-bar machine badge to show the variant picker.
 */
export function getMachinesForEnvironment(
  env: ShopEnvironment,
  machines: readonly MachineProfile[]
): MachineProfile[] {
  const owned: MachineProfile[] = []
  for (const id of env.machineIds) {
    const m = machines.find((candidate) => candidate.id === id)
    if (m) owned.push(m)
  }
  return owned
}

/**
 * Look up an environment by ID. Throws on unknown IDs to surface registry
 * mismatches loudly during development.
 */
export function getEnvironmentById(id: EnvironmentId): ShopEnvironment {
  const env = ENVIRONMENTS[id]
  if (!env) {
    throw new Error(`Unknown shop environment id: ${id}`)
  }
  return env
}
