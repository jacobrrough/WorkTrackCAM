/**
 * EnvActionStrip — small environment-specific action header rendered at the
 * top of the left panel. Each environment surfaces its highest-value
 * controls without lifting the entire shell:
 *
 *   • VCarve Pro:    wood material quick-pick (Hardwood / Plywood / MDF / Softwood)
 *   • Creality Print: filament quick-pick (matched by name keyword — PLA / PETG / ABS / TPU / Nylon / …)
 *   • Makera CAM:    3-axis ↔ 4-axis HD toggle (swaps sessionMachine in place)
 *
 * All callbacks are wired by the ShopApp so this component stays presentation-only.
 */
import React from 'react'
import type { Job, MachineProfile, MaterialRecord } from '../shop-types'
import type { ShopEnvironment } from './registry'
import {
  buildQuickPickMaterials,
  isFilamentMaterial,
  isFourAxisCarvera,
  isWoodMaterial,
  resolveMakeraVariants
} from './env-action-strip-helpers'

export interface EnvActionStripProps {
  env: ShopEnvironment
  /** All known machine profiles (used by Makera axis toggle to find variants). */
  machines: readonly MachineProfile[]
  /** Currently bound session machine. */
  sessionMachine: MachineProfile | null
  /** Swap the active session machine to a sibling variant inside the same env. */
  onSwitchMachine: (machine: MachineProfile) => void
  /** All loaded material records (used by VCarve wood quick-pick). */
  materials: readonly MaterialRecord[]
  /** Active job — the strip writes materialId on the job when a wood preset is picked. */
  activeJob: Job | null
  /** Update active job (e.g. set materialId from a quick-pick). */
  onUpdateJob: (id: string, patch: Partial<Job>) => void
}

export function EnvActionStrip(props: EnvActionStripProps): React.ReactElement | null {
  const { env } = props
  if (env.id === 'vcarve_pro') return <VCarveStrip {...props} />
  if (env.id === 'makera_cam') return <MakeraStrip {...props} />
  if (env.id === 'creality_print') return <CrealityStrip {...props} />
  return null
}

// ── VCarve Pro: wood material quick-pick ────────────────────────────────────

function VCarveStrip({ materials, activeJob, onUpdateJob }: EnvActionStripProps): React.ReactElement {
  const selectedId = activeJob?.materialId ?? null
  const visible = buildQuickPickMaterials(materials, selectedId, isWoodMaterial, 6)

  return (
    <div className="env-action-strip" data-environment="vcarve_pro">
      <div className="env-action-strip__label">Wood quick-pick</div>
      <div className="env-action-strip__chips">
        {visible.length === 0 && (
          <span className="env-action-strip__empty">No materials installed</span>
        )}
        {visible.map((m) => {
          const active = m.id === selectedId
          return (
            <button
              key={m.id}
              type="button"
              className={`env-action-chip${active ? ' env-action-chip--active' : ''}`}
              disabled={!activeJob}
              onClick={() => activeJob && onUpdateJob(activeJob.id, { materialId: m.id })}
              title={m.name}
            >
              {m.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Makera CAM: 3-axis ↔ 4-axis HD toggle ───────────────────────────────────

function MakeraStrip({
  env,
  machines,
  sessionMachine,
  onSwitchMachine
}: EnvActionStripProps): React.ReactElement {
  const variants = resolveMakeraVariants(env, machines)

  return (
    <div className="env-action-strip" data-environment="makera_cam">
      <div className="env-action-strip__label">Axis mode</div>
      <div className="env-action-strip__chips" role="radiogroup" aria-label="Carvera axis mode">
        {variants.length === 0 && (
          <span className="env-action-strip__empty">No Carvera variants installed</span>
        )}
        {variants.map((m) => {
          const active = m.id === sessionMachine?.id
          // Friendly short label: "3-Axis" or "4-Axis HD"
          const shortLabel = isFourAxisCarvera(m) ? '4-Axis HD' : '3-Axis'
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`env-action-chip${active ? ' env-action-chip--active' : ''}`}
              onClick={() => onSwitchMachine(m)}
              title={m.name}
            >
              {shortLabel}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Creality Print: filament quick-pick ─────────────────────────────────────

function CrealityStrip({ materials, activeJob, onUpdateJob }: EnvActionStripProps): React.ReactElement {
  const selectedId = activeJob?.materialId ?? null
  const filaments = buildQuickPickMaterials(materials, selectedId, isFilamentMaterial, 6)
  return (
    <div className="env-action-strip" data-environment="creality_print">
      <div className="env-action-strip__label">Filament</div>
      <div className="env-action-strip__chips">
        {filaments.length === 0 && (
          <span className="env-action-strip__empty">No filament profiles installed</span>
        )}
        {filaments.map((m) => {
          const active = m.id === selectedId
          return (
            <button
              key={m.id}
              type="button"
              className={`env-action-chip${active ? ' env-action-chip--active' : ''}`}
              disabled={!activeJob}
              onClick={() => activeJob && onUpdateJob(activeJob.id, { materialId: m.id })}
              title={m.name}
            >
              {m.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
