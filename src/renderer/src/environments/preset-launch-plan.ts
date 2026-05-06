/**
 * Preset-launch plan composer — wraps `resolveQuickSwitchMachine` for the
 * My Shop preset flow. Returns a discriminated union so `ShopApp.tsx` can
 * switch on `plan.kind` rather than doing inline null / idempotent checks.
 *
 * Pure module — no React imports, no localStorage, no side effects.
 */
import type { MachineProfile } from '../../../shared/machine-schema'
import type { MyShopPreset } from './my-shop-presets'
import { resolveQuickSwitchMachine } from './quick-switch'
import type { EnvironmentId, ShopEnvironment } from './registry'

export type PresetLaunchPlan =
  | { readonly kind: 'env-not-found' }
  | { readonly kind: 'no-machine-installed'; readonly toastMessage: string }
  | { readonly kind: 'already-active'; readonly toastMessage: string }
  | {
      readonly kind: 'switch'
      readonly next: MachineProfile
      readonly updatedVariantMap: Partial<Record<EnvironmentId, string>>
      readonly toastMessage: string
    }

export function composePresetLaunchPlan(
  preset: MyShopPreset,
  environments: Readonly<Record<EnvironmentId, ShopEnvironment>>,
  machines: readonly MachineProfile[],
  lastVariantByEnvId: Readonly<Partial<Record<EnvironmentId, string>>>,
  currentMachineId: string | null
): PresetLaunchPlan {
  const targetEnv = environments[preset.environmentId]
  if (!targetEnv) return { kind: 'env-not-found' }

  const next = resolveQuickSwitchMachine(
    targetEnv,
    machines,
    lastVariantByEnvId,
    currentMachineId
  )

  if (!next) {
    return {
      kind: 'no-machine-installed',
      toastMessage: `No ${targetEnv.name} machine installed. Open the Library to add one.`
    }
  }

  if (currentMachineId === next.id) {
    return {
      kind: 'already-active',
      toastMessage: `${targetEnv.name} is already active.`
    }
  }

  return {
    kind: 'switch',
    next,
    updatedVariantMap: { ...lastVariantByEnvId, [preset.environmentId]: next.id },
    toastMessage: `Switched to ${next.name ?? targetEnv.name}.`
  }
}
