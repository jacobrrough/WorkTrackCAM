import React from 'react'
import type { ManufactureOperation, ManufactureOperationKind } from '../../shared/manufacture-schema'
import type { MachineUIMode } from './shop-types'
import { KIND_LABELS, OPS_BY_MODE } from './shop-types'

interface OpSequencerProps {
  operations: readonly ManufactureOperation[]
  selectedOpId: string | null
  onSelectOp: (id: string | null) => void
  onAddOp: (kind: ManufactureOperationKind) => void
  onRemoveOp: (id: string) => void
  mode: MachineUIMode
  running: boolean
  disabled: boolean
}

const OP_ICONS: Partial<Record<string, string>> = {
  cnc_parallel: '═',
  cnc_contour: '◯',
  cnc_pocket: '▣',
  cnc_drill: '◎',
  cnc_adaptive: '\u{1F300}',
  cnc_waterline: '\u{1F30A}',
  cnc_raster: '≡',
  cnc_pencil: '✎',
  cnc_3d_rough: '\u{1F5FB}',
  cnc_3d_finish: '✨',
  cnc_4axis_roughing: '\u{1F504}',
  cnc_4axis_finishing: '\u{1F504}',
  cnc_4axis_contour: '\u{1F504}',
  cnc_4axis_indexed: '\u{1F504}',
  fdm_slice: '\u{1F5A8}',
  export_stl: '\u{1F4E4}',
}

export function OpSequencer({
  operations, selectedOpId, onSelectOp, onAddOp, onRemoveOp,
  mode, running, disabled
}: OpSequencerProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const { primary, secondary } = OPS_BY_MODE[mode]
  const allOps = [...primary, ...secondary]

  return (
    <div className="op-seq" role="region" aria-label="Operation sequencer">
      <div className="op-seq__track">
        {operations.length === 0 && (
          <div className="op-seq__empty">
            No operations — click + to add
          </div>
        )}
        {operations.map((op, i) => {
          const isSelected = op.id === selectedOpId
          return (
            <React.Fragment key={op.id}>
              {i > 0 && <span className="op-seq__arrow" aria-hidden="true">{'→'}</span>}
              <button
                type="button"
                className={`op-seq__card${isSelected ? ' op-seq__card--selected' : ''}`}
                onClick={() => onSelectOp(isSelected ? null : op.id)}
                title={`${op.label} — click to select, right-click to remove`}
                onContextMenu={e => { e.preventDefault(); onRemoveOp(op.id) }}
              >
                <span className="op-seq__card-icon" aria-hidden="true">
                  {OP_ICONS[op.kind] ?? '\u{1F529}'}
                </span>
                <span className="op-seq__card-label">{op.label}</span>
              </button>
            </React.Fragment>
          )
        })}
      </div>

      <div className="op-seq__actions">
        <div className="op-seq__add-wrap">
          <button
            type="button"
            className="op-seq__add-btn"
            disabled={disabled || running}
            onClick={() => setMenuOpen(o => !o)}
            aria-label="Add operation"
            aria-expanded={menuOpen}
            title="Add operation"
          >
            +
          </button>
          {menuOpen && (
            <>
              <div className="op-seq__menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="op-seq__menu" role="menu">
                {primary.length > 0 && (
                  <div className="op-seq__menu-group">
                    <div className="op-seq__menu-group-label">Primary</div>
                    {primary.map(k => (
                      <button
                        key={k}
                        type="button"
                        role="menuitem"
                        className="op-seq__menu-item"
                        onClick={() => { onAddOp(k); setMenuOpen(false) }}
                      >
                        <span className="op-seq__menu-item-icon">{OP_ICONS[k] ?? '\u{1F529}'}</span>
                        {KIND_LABELS[k] ?? k}
                      </button>
                    ))}
                  </div>
                )}
                {secondary.length > 0 && (
                  <div className="op-seq__menu-group">
                    <div className="op-seq__menu-group-label">More</div>
                    {secondary.map(k => (
                      <button
                        key={k}
                        type="button"
                        role="menuitem"
                        className="op-seq__menu-item"
                        onClick={() => { onAddOp(k); setMenuOpen(false) }}
                      >
                        <span className="op-seq__menu-item-icon">{OP_ICONS[k] ?? '\u{1F529}'}</span>
                        {KIND_LABELS[k] ?? k}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
