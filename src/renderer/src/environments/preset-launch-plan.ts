/**
 * Preset launch plan — given a My Shop preset, resolve the concrete action
 * the UI should take: switch machines, show a toast, or open the Library
 * drawer when the target machine is not installed.
 *
 * Pure module — no React imports, no localStorage I/O, no side effects.
 * The discriminated-union return lets the caller (`ShopApp.tsx`) stay
 * declarative: match on `plan.kind` and dispatch exactly one branch.
 *
 * Delegates the env -> machine selection to `resolveQuickSwitchMachine`
 * so My Shop preset launches honour the SAME variant-memory / idempotent
 * / default-machine rules the brand-bar env switcher already uses. The
 * caller persists `updatedVariantMap` to localStorage on the 'switch'
 * branch (see ShopApp.tsx `LAST_VARIANT_STORAGE_KEY`).
 */
import type { MachineProfile } from '../../../shared/machine-schema'
import type { MyShopPreset } from './my-shop-presets'
import type { EnvironmentId, ShopEnvironment } from './registry'
import { resolveQuickSwitchMachine } from './quick-switch'

// -- Return types ------------------------------------------------------------

export type PresetLaunchPlan =
  | PresetLaunchEnvNotFound
  | PresetLaunchNoMachine
  | PresetLaunchAlreadyActive
  | PresetLaunchSwitch

/** Programmer-error case: the preset names an env not in the registry. */
interface PresetLaunchEnvNotFound {
  readonly kind: 'env-not-found'
}

/** No owned machine for the env is installed -- caller should open Library. */
interface PresetLaunchNoMachine {
  readonly kind: 'no-machine-installed'
  readonly toastMessage: string
}

/** Idempotent: the active machine already belongs to the preset's env. */
interface PresetLaunchAlreadyActive {
  readonly kind: 'already-active'
  readonly toastMessage: string
}

/** A machine swap should occur -- caller persists variant memory + switches. */
interface PresetLaunchSwitch {
  readonly kind: 'switch'
  readonly next: MachineProfile
  readonly updatedVariantMap: Partial<Record<EnvironmentId, string>>
  readonly toastMessage: string
}

// -- Composer ----------------------------------------------------------------

/**
 * Compose the launch plan for the given My Shop preset. Pure function — the
 * caller decides what to do with each plan branch (see `handleLaunchMyShopPreset`
 * in `ShopApp.tsx`).
 */
export function composePresetLaunchPlan(
  preset: MyShopPreset,
  environments: Readonly<Record<EnvironmentId, ShopEnvironment>>,
  machines: readonly MachineProfile[],
  lastVariantByEnvId: Readonly<Partial<Record<EnvironmentId, string>>>,
  currentMachineId: string | null
): PresetLaunchPlan {
  const env = environments[preset.environmentId]
  if (!env) {
    return { kind: 'env-not-found' }
  }

  const resolved = resolveQuickSwitchMachine(
    env,
    machines,
    lastVariantByEnvId,
    currentMachineId
  )

  if (!resolved) {
    return {
      kind: 'no-machine-installed',
      toastMessage: `No ${env.name} machine installed — open the Library to add one.`
    }
  }

  if (resolved.id === currentMachineId) {
    return {
      kind: 'already-active',
      toastMessage: `${preset.label} — already active on ${resolved.name ?? resolved.id}.`
    }
  }

  return {
    kind: 'switch',
    next: resolved,
    updatedVariantMap: { ...lastVariantByEnvId, [env.id]: resolved.id },
    toastMessage: `Switched to ${resolved.name ?? resolved.id} for ${preset.label}.`
  }
}
