import React from 'react'
import type { ManufactureOperation, ManufactureOperationKind } from '../../shared/manufacture-schema'
import type { ToolRecord } from '../../shared/tool-schema'
import type { MaterialRecord } from '../../shared/material-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import type { Job, MachineUIMode, StockDimensions } from './shop-types'
import { KIND_LABELS } from './shop-types'

interface PropertyPanelProps {
  activeJob: Job | null
  mode: MachineUIMode
  isFdm: boolean
  sessionMachine: MachineProfile | null
  materials: readonly MaterialRecord[]
  machineTools: readonly ToolRecord[]
  selectedOpId: string | null
  onUpdateJob: (id: string, patch: Partial<Job>) => void
  onUpdateOpParams: (opId: string, params: Record<string, unknown>) => void
  onApplyMaterial: () => void
  collapsed: boolean
  onToggle: () => void
}

export function PropertyPanel({
  activeJob, mode, isFdm, sessionMachine, materials, machineTools,
  selectedOpId, onUpdateJob, onUpdateOpParams, onApplyMaterial,
  collapsed, onToggle
}: PropertyPanelProps): React.ReactElement {
  const selectedOp = activeJob?.operations.find(o => o.id === selectedOpId) ?? null

  if (collapsed) {
    return (
      <div className="prop-panel prop-panel--collapsed">
        <button
          type="button"
          className="prop-panel__toggle"
          onClick={onToggle}
          aria-label="Expand properties"
          title="Expand properties"
        >
          {'◀'}
        </button>
      </div>
    )
  }

  return (
    <aside className="prop-panel" role="complementary" aria-label="Properties">
      <div className="prop-panel__header">
        <span className="prop-panel__title">Properties</span>
        <button
          type="button"
          className="prop-panel__toggle"
          onClick={onToggle}
          aria-label="Collapse properties"
          title="Collapse properties"
        >
          {'▶'}
        </button>
      </div>

      {!activeJob && (
        <div className="prop-panel__empty">
          <span className="prop-panel__empty-icon">{'\u{1F4CB}'}</span>
          <span>No job selected</span>
          <span className="prop-panel__empty-hint">Create or select a job to see properties</span>
        </div>
      )}

      {activeJob && (
        <div className="prop-panel__body">
          {/* Job section */}
          <section className="prop-section">
            <h3 className="prop-section__title">{'\u{1F4CB}'} Job</h3>
            <div className="prop-field">
              <label className="prop-field__label">Name</label>
              <input
                type="text"
                className="prop-field__input"
                value={activeJob.name}
                onChange={e => onUpdateJob(activeJob.id, { name: e.target.value })}
              />
            </div>
          </section>

          {/* Machine section */}
          {sessionMachine && (
            <section className="prop-section">
              <h3 className="prop-section__title">{'\u{1F5A5}'} Machine</h3>
              <div className="prop-info-row">
                <span className="prop-info-row__label">Name</span>
                <span className="prop-info-row__value">{sessionMachine.name}</span>
              </div>
              <div className="prop-info-row">
                <span className="prop-info-row__label">Work area</span>
                <span className="prop-info-row__value">
                  {sessionMachine.workAreaMm.x} {'×'} {sessionMachine.workAreaMm.y} {'×'} {sessionMachine.workAreaMm.z} mm
                </span>
              </div>
            </section>
          )}

          {/* Material section (CNC only) */}
          {!isFdm && (
            <section className="prop-section">
              <h3 className="prop-section__title">{'\u{1F9F1}'} Material</h3>
              <div className="prop-field">
                <select
                  className="prop-field__input"
                  value={activeJob.materialId ?? ''}
                  onChange={e => onUpdateJob(activeJob.id, { materialId: e.target.value || null })}
                >
                  <option value="">{'—'} None {'—'}</option>
                  {materials.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              {activeJob.materialId && (
                <button
                  type="button"
                  className="prop-section__action"
                  onClick={onApplyMaterial}
                >
                  {'⚡'} Apply to ops
                </button>
              )}
            </section>
          )}

          {/* Stock section (CNC only) */}
          {!isFdm && (
            <section className="prop-section">
              <h3 className="prop-section__title">{'\u{1F4D0}'} Stock</h3>
              {(mode === 'cnc_4axis' || mode === 'cnc_5axis') && (
                <div className="prop-field">
                  <label className="prop-field__label">Profile</label>
                  <select
                    className="prop-field__input"
                    value={activeJob.stockProfile ?? 'cylinder'}
                    onChange={e => onUpdateJob(activeJob.id, { stockProfile: e.target.value as 'cylinder' | 'square' })}
                  >
                    <option value="cylinder">{'○'} Cylinder</option>
                    <option value="square">{'□'} Square</option>
                  </select>
                </div>
              )}
              <div className="prop-stock-grid">
                {(['x', 'y', 'z'] as const).map(ax => (
                  <div key={ax} className="prop-stock-cell">
                    <label className="prop-stock-cell__label" style={{ color: ax === 'x' ? '#e74c3c' : ax === 'y' ? '#2ecc71' : '#4d8aff' }}>
                      {(mode === 'cnc_4axis' || mode === 'cnc_5axis')
                        ? (ax === 'x' ? 'L' : ax === 'y' ? (activeJob.stockProfile === 'square' ? 'Side' : 'Ø') : 'Z')
                        : ax.toUpperCase()
                      }
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      className="prop-stock-cell__input"
                      value={activeJob.stock[ax]}
                      onChange={e => onUpdateJob(activeJob.id, { stock: { ...activeJob.stock, [ax]: +e.target.value } })}
                    />
                  </div>
                ))}
                <span className="prop-stock-unit">mm</span>
              </div>
            </section>
          )}

          {/* Selected operation detail */}
          {selectedOp && (
            <section className="prop-section prop-section--highlight">
              <h3 className="prop-section__title">{'\u{1F529}'} {selectedOp.label}</h3>
              <OpDetail
                op={selectedOp}
                tools={machineTools as ToolRecord[]}
                onUpdateParams={(params) => onUpdateOpParams(selectedOp.id, params)}
                jobStock={activeJob.stock}
              />
            </section>
          )}
        </div>
      )}
    </aside>
  )
}

function OpDetail({ op, tools, onUpdateParams, jobStock }: {
  op: ManufactureOperation
  tools: ToolRecord[]
  onUpdateParams: (params: Record<string, unknown>) => void
  jobStock: { x: number; y: number; z: number }
}): React.ReactElement {
  const p = (op.params ?? {}) as Record<string, unknown>
  const set = (k: string, v: unknown) => onUpdateParams({ ...p, [k]: v })

  const TOOL_TYPE_LABEL: Record<string, string> = {
    endmill: 'Flat Endmill', ball: 'Ball Nose', vbit: 'V-Bit',
    drill: 'Drill', face: 'Face Mill', other: 'Other'
  }

  if (op.kind === 'fdm_slice') {
    return (
      <div className="prop-field">
        <label className="prop-field__label">Slice Preset</label>
        <input
          type="text"
          className="prop-field__input"
          value={String(p.slicePreset ?? '')}
          placeholder="default"
          onChange={e => set('slicePreset', e.target.value || null)}
        />
      </div>
    )
  }

  if (op.kind === 'export_stl') {
    return <div className="prop-field__hint">No parameters — exports staged STL.</div>
  }

  return (
    <>
      <div className="prop-field">
        <label className="prop-field__label">Tool</label>
        <select
          className="prop-field__input"
          value={String(p.toolId ?? '')}
          onChange={e => {
            const toolId = e.target.value
            if (!toolId) { onUpdateParams({ ...p, toolId: undefined }); return }
            const t = tools.find(t => t.id === toolId)
            if (t) onUpdateParams({ ...p, toolId, toolDiameterMm: t.diameterMm })
          }}
        >
          <option value="">{'—'} Manual {'—'}</option>
          {tools.map(t => (
            <option key={t.id} value={t.id}>
              {t.diameterMm}mm {TOOL_TYPE_LABEL[t.type] ?? t.type}
              {t.name ? ` — ${t.name}` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="prop-field-row">
        <NumField label="Tool Ø" value={p.toolDiameterMm} onChange={v => set('toolDiameterMm', v)} />
        <NumField label="Feed" value={p.feedMmMin} onChange={v => set('feedMmMin', v)} />
      </div>
      <div className="prop-field-row">
        <NumField label="Plunge" value={p.plungeMmMin} onChange={v => set('plungeMmMin', v)} />
        <NumField label="Z Pass" value={p.zPassMm} onChange={v => set('zPassMm', v)} />
      </div>
      <div className="prop-field-row">
        {op.kind !== 'cnc_drill' && (
          <NumField label="Stepover" value={p.stepoverMm} onChange={v => set('stepoverMm', v)} />
        )}
        <NumField label="Safe Z" value={p.safeZMm} onChange={v => set('safeZMm', v)} />
      </div>
    </>
  )
}

function NumField({ label, value, onChange }: {
  label: string; value: unknown; onChange: (v: number | undefined) => void
}): React.ReactElement {
  return (
    <div className="prop-num-field">
      <label className="prop-num-field__label">{label}</label>
      <input
        type="number"
        step="any"
        className="prop-num-field__input"
        value={value == null ? '' : String(value)}
        onChange={e => onChange(e.target.value === '' ? undefined : +e.target.value)}
      />
    </div>
  )
}
