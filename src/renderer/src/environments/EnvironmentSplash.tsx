/**
 * EnvironmentSplash — three large cards, one per supported shop environment.
 * Replaces the legacy MachineSplash mode-tab + machine-grid picker.
 *
 * Each card is themed via `data-environment` so the accent color preview
 * matches the inside of the env shell. The Makera CAM card has an inline
 * 3-Axis / 4-Axis HD picker (the env owns both Carvera variants).
 */
import React, { useMemo, useState } from 'react'
import type { MachineProfile } from '../shop-types'
import {
  ENVIRONMENT_LIST,
  type EnvironmentId,
  type ShopEnvironment
} from './registry'
import { getMachinesForEnvironment } from './env-routing'

export interface EnvironmentSplashProps {
  /** All known machine profiles (bundled + user). */
  machines: readonly MachineProfile[]
  /** Last machine the user picked — used to pre-select the matching env card. */
  lastMachineId: string | null
  /** Called when the user confirms a (env, machine) pick. */
  onSelect: (env: ShopEnvironment, machine: MachineProfile) => void
  /** Called when the user wants to open the Library drawer to add/import a machine. */
  onAddMachine: () => void
}

export function EnvironmentSplash({
  machines,
  lastMachineId,
  onSelect,
  onAddMachine
}: EnvironmentSplashProps): React.ReactElement {
  // Pre-select the env that matches the last-used machine, defaulting to the
  // first env in the registry on a fresh install.
  const initialEnvId = useMemo<EnvironmentId>(() => {
    if (lastMachineId) {
      const env = ENVIRONMENT_LIST.find((e) => e.machineIds.includes(lastMachineId))
      if (env) return env.id
    }
    return ENVIRONMENT_LIST[0].id
  }, [lastMachineId])

  const [activeEnvId, setActiveEnvId] = useState<EnvironmentId>(initialEnvId)
  // Track per-env machine choice (only meaningful when an env owns >1 machine).
  const [machineChoiceByEnv, setMachineChoiceByEnv] = useState<Record<EnvironmentId, string | null>>(() => {
    const initial: Record<EnvironmentId, string | null> = {
      vcarve_pro: null,
      creality_print: null,
      makera_cam: null
    }
    if (lastMachineId) {
      for (const env of ENVIRONMENT_LIST) {
        if (env.machineIds.includes(lastMachineId)) {
          initial[env.id] = lastMachineId
          break
        }
      }
    }
    return initial
  })

  const activeEnv = ENVIRONMENT_LIST.find((e) => e.id === activeEnvId) ?? ENVIRONMENT_LIST[0]
  const ownedMachines = getMachinesForEnvironment(activeEnv, machines)

  const resolvedMachineId =
    machineChoiceByEnv[activeEnv.id] ??
    (ownedMachines.find((m) => m.id === activeEnv.defaultMachineId) ?? ownedMachines[0])?.id ??
    null
  const resolvedMachine = ownedMachines.find((m) => m.id === resolvedMachineId) ?? null

  const handleEnter = (): void => {
    if (resolvedMachine) onSelect(activeEnv, resolvedMachine)
  }

  return (
    <div className="env-splash">
      <div className="env-splash__header">
        <div className="env-splash__logo" aria-hidden="true">{'\u25C6'}</div>
        <div className="env-splash__title">WorkTrackCAM</div>
        <div className="env-splash__subtitle">Pick a shop environment to get started.</div>
      </div>

      <div className="env-splash__cards" role="radiogroup" aria-label="Shop environment">
        {ENVIRONMENT_LIST.map((env) => {
          const owned = getMachinesForEnvironment(env, machines)
          const isActive = env.id === activeEnvId
          const allMachinesMissing = owned.length === 0
          return (
            <button
              key={env.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              data-environment={env.id}
              className={`env-splash__card${isActive ? ' env-splash__card--active' : ''}${allMachinesMissing ? ' env-splash__card--unavailable' : ''}`}
              onClick={() => setActiveEnvId(env.id)}
              disabled={allMachinesMissing}
            >
              <div className="env-splash__card-icon" aria-hidden="true">
                {env.iconGlyph}
              </div>
              <div className="env-splash__card-name">{env.name}</div>
              <div className="env-splash__card-tagline">{env.tagline}</div>
              <div className="env-splash__card-machines">
                {owned.length === 0 && (
                  <span className="env-splash__card-empty">No matching machines installed</span>
                )}
                {owned.map((m) => (
                  <span key={m.id} className="env-splash__card-machine">
                    {m.name}
                    {' \u00B7 '}
                    {m.workAreaMm.x} {'\u00D7'} {m.workAreaMm.y} {'\u00D7'} {m.workAreaMm.z} mm
                  </span>
                ))}
              </div>
              {/* Inline machine picker for envs that own >1 machine (Makera). */}
              {isActive && owned.length > 1 && (
                <div
                  className="env-splash__card-variant-picker"
                  role="radiogroup"
                  aria-label={`${env.name} machine variant`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {owned.map((m) => {
                    const selected = (machineChoiceByEnv[env.id] ?? env.defaultMachineId) === m.id
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        className={`env-splash__variant-btn${selected ? ' env-splash__variant-btn--selected' : ''}`}
                        onClick={() => setMachineChoiceByEnv((s) => ({ ...s, [env.id]: m.id }))}
                      >
                        {m.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </button>
          )
        })}
      </div>

      <div className="env-splash__cta" data-environment={activeEnv.id}>
        <button
          type="button"
          className="env-splash__enter-btn"
          disabled={!resolvedMachine}
          onClick={handleEnter}
        >
          {resolvedMachine ? `Enter ${activeEnv.name} \u2192` : 'Install a machine to continue'}
        </button>
        <button
          type="button"
          className="env-splash__add-machine-btn"
          onClick={onAddMachine}
        >
          + Add or import a machine
        </button>
      </div>
    </div>
  )
}
