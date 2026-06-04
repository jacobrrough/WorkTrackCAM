/**
 * EnvSwitcher — the new shell's 3-button environment/machine quick-switcher
 * (VCarve Pro / Creality Print / Makera CAM), rendered in the TopBar.
 *
 * Clicking an env switches the active session machine to that environment's
 * machine, mirroring the legacy `ShopApp.handleQuickSwitchEnv`:
 *   1. Resolve the target machine via the pure `resolveQuickSwitchMachine`
 *      helper (idempotent → variant-memory → env default → null).
 *   2. `null` → toast a "no machine installed" hint and bail.
 *   3. Already the current machine → no-op (idempotent rule).
 *   4. Otherwise → record the choice in per-env variant memory (state +
 *      localStorage `fab-env-last-variant-v1`), activate the machine on the
 *      session, persist `lastMachineId`, and reload that machine's tools.
 *
 * The active env (the one owning the current session machine) is marked with
 * `aria-pressed` + the `wt-envswitch__btn--active` class. Styling is supplied
 * by the integrator's CSS — this component sets no inline styles.
 */
import { useState } from 'react'
import type { ReactElement } from 'react'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { useToast } from '../contexts/ToastContext'
import { fab } from '../src/shop-types'
import { getEnvironmentForMachine } from '../src/environments/env-routing'
import { resolveQuickSwitchMachine } from '../src/environments/quick-switch'
import {
  ENVIRONMENT_LIST,
  isEnvironmentId,
  type EnvironmentId,
  type ShopEnvironment
} from '../src/environments/registry'

/**
 * localStorage key for the per-environment "last used machine" variant memory.
 * Mirrors the legacy `ShopApp` key so the new shell and old shell share state
 * (e.g. the Makera 3-axis vs 4-axis choice survives a shell swap).
 */
const LAST_VARIANT_STORAGE_KEY = 'fab-env-last-variant-v1'

/**
 * Read + validate the per-env variant map from localStorage. Guarded against
 * disabled storage (throws on access) and malformed / legacy JSON. Only keeps
 * entries whose key is a known `EnvironmentId` and whose value is a non-empty
 * string machine id.
 */
function readLastVariantByEnvId(): Partial<Record<EnvironmentId, string>> {
  try {
    const raw = localStorage.getItem(LAST_VARIANT_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Partial<Record<EnvironmentId, string>> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEnvironmentId(k) && typeof v === 'string' && v.length > 0) {
        out[k] = v
      }
    }
    return out
  } catch {
    return {}
  }
}

export function EnvSwitcher(): ReactElement {
  const {
    sessionMachine,
    setSessionMachine,
    machines,
    setLastMachineId,
    loadToolsForMachine
  } = useMachineSession()
  const { pushToast } = useToast()

  // Per-env last-used variant memory, seeded from localStorage. Kept as
  // component state so clicks update the highlighted variant immediately.
  const [lastVariantByEnvId, setLastVariantByEnvId] =
    useState<Partial<Record<EnvironmentId, string>>>(readLastVariantByEnvId)

  const activeEnv: ShopEnvironment | null = getEnvironmentForMachine(sessionMachine?.id ?? null)

  const handleSwitch = (targetEnv: ShopEnvironment): void => {
    const next = resolveQuickSwitchMachine(
      targetEnv,
      machines,
      lastVariantByEnvId,
      sessionMachine?.id ?? null
    )
    if (!next) {
      pushToast('warn', `No ${targetEnv.name} machine installed. Open the Library to add one.`)
      return
    }
    // No-op when the env already owns the current machine (idempotent rule).
    if (sessionMachine?.id === next.id) return

    const updated: Partial<Record<EnvironmentId, string>> = {
      ...lastVariantByEnvId,
      [targetEnv.id]: next.id
    }
    setLastVariantByEnvId(updated)
    try {
      localStorage.setItem(LAST_VARIANT_STORAGE_KEY, JSON.stringify(updated))
    } catch {
      /* quota / disabled storage — variant memory stays in-session only */
    }

    setSessionMachine(next)
    setLastMachineId(next.id)
    void fab().settingsSet({ lastMachineId: next.id })
    void loadToolsForMachine(next.id)
  }

  return (
    <div className="wt-envswitch" role="group" aria-label="Switch environment">
      {ENVIRONMENT_LIST.map((env) => {
        const isActive = activeEnv?.id === env.id
        return (
          <button
            key={env.id}
            type="button"
            className={`wt-envswitch__btn${isActive ? ' wt-envswitch__btn--active' : ''}`}
            aria-pressed={isActive}
            title={env.name}
            onClick={() => handleSwitch(env)}
          >
            <span className="wt-envswitch__icon" aria-hidden="true">
              {env.iconGlyph}
            </span>
            <span className="wt-envswitch__name">{env.name}</span>
          </button>
        )
      })}
    </div>
  )
}
