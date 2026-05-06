/**
 * Quick-switch resolver for the brand-bar "My Shop" environment triad.
 *
 * Given a target environment, the installed machine list, a per-environment
 * "last used" variant map, and the currently active session machine, return
 * the `MachineProfile` the UI should switch to (or `null` when no owned
 * machine is installed and the caller must route to the Library drawer).
 *
 * Pure module — no React imports, no localStorage I/O, no side effects.
 * The variant-memory map is passed in as a plain object so persistence stays
 * in the caller; see `ShopApp.tsx` for the `fab-env-last-variant-v1` wiring.
 *
 * Resolution rules (evaluated in order):
 *   1. Idempotent: if the env already owns the current machine, return it.
 *   2. Variant memory: if `lastVariantByEnvId[targetEnv.id]` names an owned
 *      installed machine, return that (preserves Makera 3-axis vs 4-axis).
 *   3. Default: return the machine matching `targetEnv.defaultMachineId`.
 *   4. Missing: return `null` — caller shows a toast and opens the Library.
 */
import type { MachineProfile } from '../../../shared/machine-schema'
import { getMachinesForEnvironment } from './env-routing'
import type { EnvironmentId, ShopEnvironment } from './registry'

/**
 * Resolve which machine profile the UI should switch to when the user clicks
 * an env button in the brand bar. See the rule list in the module header.
 */
export function resolveQuickSwitchMachine(
  targetEnv: ShopEnvironment,
  machines: readonly MachineProfile[],
  lastVariantByEnvId: Readonly<Partial<Record<EnvironmentId, string>>>,
  currentMachineId: string | null
): MachineProfile | null {
  const owned = getMachinesForEnvironment(targetEnv, machines)
  if (owned.length === 0) return null

  // Rule 1 — idempotent: active machine already belongs to the target env.
  if (currentMachineId !== null) {
    const current = owned.find((m) => m.id === currentMachineId)
    if (current) return current
  }

  // Rule 2 — variant memory: honour the caller's last-used choice for this env.
  const rememberedId = lastVariantByEnvId[targetEnv.id]
  if (typeof rememberedId === 'string' && rememberedId.length > 0) {
    const remembered = owned.find((m) => m.id === rememberedId)
    if (remembered) return remembered
  }

  // Rule 3 — env default.
  const byDefault = owned.find((m) => m.id === targetEnv.defaultMachineId)
  if (byDefault) return byDefault

  // Rule 4 — default missing from owned set: fall through to null so the
  // caller can route to the Library drawer rather than silently picking
  // an unrelated machine.
  return null
}
