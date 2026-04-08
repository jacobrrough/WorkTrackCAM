/**
 * EnvActionStrip — small environment-specific action header rendered at the
 * top of the left panel. Each environment surfaces its highest-value
 * controls without lifting the entire shell:
 *
 *   • VCarve Pro:    wood material quick-pick (Hardwood / Plywood / MDF / Softwood)
 *   • Creality Print: filament + slice preset hint (placeholder until SliceTray lands)
 *   • Makera CAM:    3-axis ↔ 4-axis HD toggle (swaps sessionMachine in place)
 *
 * All callbacks are wired by the ShopApp so this component stays presentation-only.
 */
import React from 'react'
import type { Job, MachineProfile, MaterialRecord } from '../shop-types'
import type { ShopEnvironment } from './registry'

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

const WOOD_KEYWORDS = ['wood', 'plywood', 'mdf', 'oak', 'pine', 'maple', 'birch', 'walnut', 'softwood', 'hardwood']

function VCarveStrip({ materials, activeJob, onUpdateJob }: EnvActionStripProps): React.ReactElement {
  // Filter materials whose name/category looks wood-related. Falls back to
  // showing every material if nothing matches (so the picker is never empty).
  const woods = materials.filter((m) => {
    const name = (m.name ?? '').toLowerCase()
    const category = ((m as { category?: string }).category ?? '').toLowerCase()
    return WOOD_KEYWORDS.some((kw) => name.includes(kw) || category.includes(kw))
  })
  const visible = woods.length > 0 ? woods : materials
  const selectedId = activeJob?.materialId ?? null

  return (
    <div className="env-action-strip" data-environment="vcarve_pro">
      <div className="env-action-strip__label">Wood quick-pick</div>
      <div className="env-action-strip__chips">
        {visible.length === 0 && (
          <span className="env-action-strip__empty">No materials installed</span>
        )}
        {visible.slice(0, 6).map((m) => {
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
  // Resolve the two Carvera variants in declared order.
  const variants = env.machineIds
    .map((id) => machines.find((m) => m.id === id))
    .filter((m): m is MachineProfile => Boolean(m))

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
          const isFourAxis = (m.axisCount ?? 3) >= 4 || m.dialect.includes('4axis')
          const shortLabel = isFourAxis ? '4-Axis HD' : '3-Axis'
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

// ── Creality Print: filament hint placeholder ───────────────────────────────

function CrealityStrip({ materials, activeJob, onUpdateJob }: EnvActionStripProps): React.ReactElement {
  // Filaments are not yet a discriminated material kind (Phase 4 follow-up
  // bundles `filaments.json`). Until then, show every material so the user
  // still has a quick way to pick a print profile from this strip.
  const selectedId = activeJob?.materialId ?? null
  return (
    <div className="env-action-strip" data-environment="creality_print">
      <div className="env-action-strip__label">Filament</div>
      <div className="env-action-strip__chips">
        {materials.length === 0 && (
          <span className="env-action-strip__empty">No filament profiles installed</span>
        )}
        {materials.slice(0, 6).map((m) => {
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
