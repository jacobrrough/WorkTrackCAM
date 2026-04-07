import { useState, type ReactNode } from 'react'
import type { ManufactureFile, ManufactureOperation, ManufactureSetup } from '../../shared/manufacture-schema'
import { isManufactureKindBlockedFromCam } from '../../shared/manufacture-cam-gate'

/** Icon character for each operation kind — mirrors Makera CAM's operation type icons. */
function opKindIcon(kind: ManufactureOperation['kind']): string {
  switch (kind) {
    case 'cnc_contour': return '⬡'
    case 'cnc_pocket': return '⬢'
    case 'cnc_drill': return '⊙'
    case 'cnc_chamfer': return '◸'
    case 'cnc_thread_mill': return '⌇'
    case 'cnc_laser': return '✦'
    case 'cnc_pcb_isolation': return '⊞'
    case 'cnc_pcb_drill': return '⊛'
    case 'cnc_pcb_contour': return '⬡'
    case 'cnc_parallel': return '≡'
    case 'cnc_adaptive': return '⟳'
    case 'cnc_waterline': return '∿'
    case 'cnc_raster': return '⊟'
    case 'cnc_pencil': return '✎'
    case 'cnc_3d_rough': return '⬛'
    case 'cnc_3d_finish': return '◻'
    case 'cnc_4axis_roughing': return '↻'
    case 'cnc_4axis_finishing': return '◎'
    case 'cnc_4axis_contour': return '↺'
    case 'cnc_4axis_indexed': return '⊕'
    case 'cnc_spiral_finish': return '🌀'
    case 'cnc_morphing_finish': return '⊶'
    case 'cnc_trochoidal_hsm': return '⟐'
    case 'cnc_steep_shallow': return '⧖'
    case 'cnc_scallop_finish': return '∾'
    case 'cnc_4axis_continuous': return '⟲'
    case 'cnc_5axis_contour': return '⬠'
    case 'cnc_5axis_swarf': return '⫽'
    case 'cnc_5axis_flowline': return '↝'
    case 'cnc_auto_select': return '⚙'
    case 'cnc_probe': return '⌖'
    case 'fdm_slice': return '⊚'
    case 'export_stl': return '↓'
    default: return '●'
  }
}

/** Human short label for operation kinds. */
function opKindShortLabel(kind: ManufactureOperation['kind']): string {
  switch (kind) {
    case 'cnc_contour': return '2D Contour'
    case 'cnc_pocket': return '2D Pocket'
    case 'cnc_drill': return '2D Drill'
    case 'cnc_chamfer': return '2D Chamfer'
    case 'cnc_thread_mill': return 'Thread Mill'
    case 'cnc_laser': return 'Laser'
    case 'cnc_pcb_isolation': return 'PCB Isolation'
    case 'cnc_pcb_drill': return 'PCB Drill'
    case 'cnc_pcb_contour': return 'PCB Outline'
    case 'cnc_parallel': return '3D Parallel'
    case 'cnc_adaptive': return '3D Adaptive'
    case 'cnc_waterline': return '3D Waterline'
    case 'cnc_raster': return '3D Raster'
    case 'cnc_pencil': return '3D Pencil'
    case 'cnc_3d_rough': return '3D Rough'
    case 'cnc_3d_finish': return '3D Finish'
    case 'cnc_4axis_roughing': return '4-Axis Rough'
    case 'cnc_4axis_finishing': return '4-Axis Finish'
    case 'cnc_4axis_contour': return '4-Axis Contour'
    case 'cnc_4axis_indexed': return '4-Axis Index'
    case 'cnc_spiral_finish': return 'Spiral Finish'
    case 'cnc_morphing_finish': return 'Morphing Finish'
    case 'cnc_trochoidal_hsm': return 'Trochoidal HSM'
    case 'cnc_steep_shallow': return 'Steep & Shallow'
    case 'cnc_scallop_finish': return 'Scallop Finish'
    case 'cnc_4axis_continuous': return '4-Axis Continuous'
    case 'cnc_5axis_contour': return '5-Axis Contour'
    case 'cnc_5axis_swarf': return '5-Axis Swarf'
    case 'cnc_5axis_flowline': return '5-Axis Flowline'
    case 'cnc_auto_select': return 'Auto Select'
    case 'cnc_probe': return 'Probe Cycle'
    case 'fdm_slice': return 'FDM Slice'
    case 'export_stl': return 'Export STL'
    default: return kind
  }
}

/** Category label for operation kinds. */
function opKindCategory(kind: ManufactureOperation['kind']): '2D' | '3D' | '4-Axis' | '5-Axis' | 'Laser' | 'PCB' | 'Other' {
  if (kind === 'cnc_contour' || kind === 'cnc_pocket' || kind === 'cnc_drill' || kind === 'cnc_chamfer' || kind === 'cnc_thread_mill') return '2D'
  if (kind === 'cnc_parallel' || kind === 'cnc_adaptive' || kind === 'cnc_waterline' || kind === 'cnc_raster' || kind === 'cnc_pencil' || kind === 'cnc_3d_rough' || kind === 'cnc_3d_finish' || kind === 'cnc_spiral_finish' || kind === 'cnc_morphing_finish' || kind === 'cnc_trochoidal_hsm' || kind === 'cnc_steep_shallow' || kind === 'cnc_scallop_finish' || kind === 'cnc_auto_select') return '3D'
  if (kind === 'cnc_4axis_roughing' || kind === 'cnc_4axis_finishing' || kind === 'cnc_4axis_contour' || kind === 'cnc_4axis_indexed' || kind === 'cnc_4axis_continuous') return '4-Axis'
  if (kind === 'cnc_5axis_contour' || kind === 'cnc_5axis_swarf' || kind === 'cnc_5axis_flowline') return '5-Axis'
  if (kind === 'cnc_laser') return 'Laser'
  if (kind === 'cnc_pcb_isolation' || kind === 'cnc_pcb_drill' || kind === 'cnc_pcb_contour') return 'PCB'
  return 'Other'
}

type OpStatus = 'ready' | 'missing' | 'stale' | 'suppressed' | 'non-cam'

type Props = {
  mfg: ManufactureFile
  selectedSetupIndex: number
  selectedOpIndex: number
  onSelectSetup: (i: number) => void
  onAddSetup: () => void
  onRemoveSetup: (i: number) => void
  onSelectOp: (i: number) => void
  onToggleSuppressed: (i: number) => void
  onAddOp: () => void
  onRemoveOp: (i: number) => void
  onMoveOpUp: (i: number) => void
  onMoveOpDown: (i: number) => void
  /** Per-operation readiness status */
  opStatus: (op: ManufactureOperation) => OpStatus
  /** STL asset paths for the models list */
  assetStlPaths: string[]
  /** Which op currently uses which source mesh */
  currentSourceMesh: string | undefined
}

/** Status indicator dot for each operation. */
function OpStatusDot({ status }: { status: OpStatus }): ReactNode {
  const colors: Record<OpStatus, string> = {
    ready: '#22c55e',
    missing: '#ef4444',
    stale: '#f59e0b',
    suppressed: '#64748b',
    'non-cam': '#475569'
  }
  const labels: Record<OpStatus, string> = {
    ready: 'Ready',
    missing: 'Missing geometry',
    stale: 'Geometry stale',
    suppressed: 'Suppressed',
    'non-cam': 'Not a CAM operation'
  }
  return (
    <span
      className="mkr-fn-op-dot"
      style={{ background: colors[status] }}
      title={labels[status]}
      aria-label={labels[status]}
    />
  )
}

export function MakeraFunctionsPanel({
  mfg,
  selectedSetupIndex,
  selectedOpIndex,
  onSelectSetup,
  onAddSetup,
  onRemoveSetup,
  onSelectOp,
  onToggleSuppressed,
  onAddOp,
  onRemoveOp,
  onMoveOpUp,
  onMoveOpDown,
  opStatus,
  assetStlPaths,
  currentSourceMesh
}: Props): ReactNode {
  const [modelsExpanded, setModelsExpanded] = useState(true)
  const [toolpathsExpanded, setToolpathsExpanded] = useState(true)
  const [contextOpIdx, setContextOpIdx] = useState<number | null>(null)

  const setups = mfg.setups
  const ops = mfg.operations

  /** Group operations by 2D / 3D / 4-Axis / PCB / Laser / Other for display. */
  const opsByCategory: Record<string, { op: ManufactureOperation; idx: number }[]> = {}
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    const cat = opKindCategory(op.kind)
    if (!opsByCategory[cat]) opsByCategory[cat] = []
    opsByCategory[cat]!.push({ op, idx: i })
  }

  return (
    <aside className="mkr-fn-panel" aria-label="Functions panel">
      {/* ── WCS TABS ── */}
      <div className="mkr-fn-wcs-tabs" role="tablist" aria-label="WCS setups">
        {setups.map((s, si) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={si === selectedSetupIndex}
            className={`mkr-fn-wcs-tab${si === selectedSetupIndex ? ' mkr-fn-wcs-tab--active' : ''}`}
            onClick={() => onSelectSetup(si)}
            title={`WCS: ${s.label} — G${53 + (s.workCoordinateIndex ?? 1)}`}
          >
            <span className="mkr-fn-wcs-tab__label">{s.label}</span>
            <span className="mkr-fn-wcs-tab__wcs">G{53 + (s.workCoordinateIndex ?? 1)}</span>
          </button>
        ))}
        <button
          type="button"
          className="mkr-fn-wcs-add"
          onClick={onAddSetup}
          title="Add new WCS setup"
          aria-label="Add new WCS setup"
        >
          +
        </button>
      </div>

      {/* ── MODELS SECTION ── */}
      <div className="mkr-fn-section">
        <button
          type="button"
          className="mkr-fn-section__header"
          onClick={() => setModelsExpanded((v) => !v)}
          aria-expanded={modelsExpanded}
        >
          <span className="mkr-fn-section__chevron">{modelsExpanded ? '▾' : '▸'}</span>
          <span className="mkr-fn-section__title">3D Models</span>
          <span className="mkr-fn-section__count">{assetStlPaths.length}</span>
        </button>
        {modelsExpanded && (
          <ul className="mkr-fn-models-list" aria-label="Imported 3D models">
            {assetStlPaths.length === 0 ? (
              <li className="mkr-fn-empty">No meshes imported yet</li>
            ) : (
              assetStlPaths.map((p) => {
                const active = p === currentSourceMesh
                return (
                  <li
                    key={p}
                    className={`mkr-fn-model-item${active ? ' mkr-fn-model-item--active' : ''}`}
                    title={p}
                  >
                    <span className="mkr-fn-model-icon">▣</span>
                    <span className="mkr-fn-model-name">{p.split('/').pop() ?? p}</span>
                    {active && <span className="mkr-fn-model-badge">preview</span>}
                  </li>
                )
              })
            )}
          </ul>
        )}
      </div>

      {/* ── TOOLPATHS SECTION ── */}
      <div className="mkr-fn-section mkr-fn-section--toolpaths">
        <div className="mkr-fn-section__header-row">
          <button
            type="button"
            className="mkr-fn-section__header"
            onClick={() => setToolpathsExpanded((v) => !v)}
            aria-expanded={toolpathsExpanded}
          >
            <span className="mkr-fn-section__chevron">{toolpathsExpanded ? '▾' : '▸'}</span>
            <span className="mkr-fn-section__title">Tool Paths</span>
            <span className="mkr-fn-section__count">{ops.length}</span>
          </button>
          <button
            type="button"
            className="mkr-fn-add-op-btn"
            onClick={onAddOp}
            title="Add new operation"
            aria-label="Add new operation"
          >
            +
          </button>
        </div>

        {toolpathsExpanded && (
          <div className="mkr-fn-toolpaths">
            {ops.length === 0 ? (
              <div className="mkr-fn-empty">No operations yet — click + to add</div>
            ) : (
              (['2D', '3D', '4-Axis', '5-Axis', 'Laser', 'PCB', 'Other'] as const).map((cat) => {
                const group = opsByCategory[cat]
                if (!group || group.length === 0) return null
                return (
                  <div key={cat} className="mkr-fn-op-group">
                    <div className="mkr-fn-op-group__label">{cat}</div>
                    {group.map(({ op, idx }) => {
                      const status = opStatus(op)
                      const isSelected = idx === selectedOpIndex
                      const isContextMenu = contextOpIdx === idx
                      return (
                        <div
                          key={op.id}
                          className={`mkr-fn-op-row${isSelected ? ' mkr-fn-op-row--selected' : ''}${op.suppressed ? ' mkr-fn-op-row--suppressed' : ''}`}
                          onClick={() => {
                            onSelectOp(idx)
                            setContextOpIdx(null)
                          }}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={isSelected ? 0 : -1}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { onSelectOp(idx); e.preventDefault() }
                          }}
                        >
                          <OpStatusDot status={status} />
                          <span className="mkr-fn-op-icon" title={opKindShortLabel(op.kind)}>
                            {opKindIcon(op.kind)}
                          </span>
                          <span className="mkr-fn-op-label" title={op.label}>
                            {op.label}
                          </span>
                          <span className="mkr-fn-op-kind-badge">{opKindShortLabel(op.kind)}</span>
                          <div className="mkr-fn-op-actions">
                            {/* Suppress toggle */}
                            <button
                              type="button"
                              className={`mkr-fn-op-action${op.suppressed ? ' mkr-fn-op-action--suppressed' : ''}`}
                              onClick={(e) => { e.stopPropagation(); onToggleSuppressed(idx) }}
                              title={op.suppressed ? 'Enable operation' : 'Suppress operation'}
                              aria-label={op.suppressed ? 'Enable operation' : 'Suppress operation'}
                            >
                              {op.suppressed ? '○' : '●'}
                            </button>
                            {/* Move up */}
                            <button
                              type="button"
                              className="mkr-fn-op-action"
                              onClick={(e) => { e.stopPropagation(); onMoveOpUp(idx) }}
                              disabled={idx === 0}
                              title="Move up"
                              aria-label="Move operation up"
                            >
                              ▲
                            </button>
                            {/* Move down */}
                            <button
                              type="button"
                              className="mkr-fn-op-action"
                              onClick={(e) => { e.stopPropagation(); onMoveOpDown(idx) }}
                              disabled={idx === ops.length - 1}
                              title="Move down"
                              aria-label="Move operation down"
                            >
                              ▼
                            </button>
                            {/* Remove */}
                            <button
                              type="button"
                              className="mkr-fn-op-action mkr-fn-op-action--danger"
                              onClick={(e) => { e.stopPropagation(); onRemoveOp(idx) }}
                              title="Remove operation"
                              aria-label="Remove operation"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* ── ACTIVE SETUP ACTIONS ── */}
      {setups.length > 0 && (
        <div className="mkr-fn-setup-actions">
          <button
            type="button"
            className="mkr-fn-setup-remove"
            onClick={() => onRemoveSetup(selectedSetupIndex)}
            disabled={setups.length <= 1}
            title="Remove current WCS setup"
          >
            Remove setup
          </button>
        </div>
      )}
    </aside>
  )
}
