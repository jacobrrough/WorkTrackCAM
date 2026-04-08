/**
 * LeftPanel -- Left sidebar panel with jobs, operations, support posts,
 * chuck depth, material, and tools sections.
 * Extracted from ShopApp.tsx (pure refactoring).
 */
import React, { useState, useEffect } from 'react'
import type { ManufactureOperation, ManufactureOperationKind, MachineUIMode, StockDimensions, ToolRecord, MaterialRecord, Job } from './shop-types'
import { OPS_BY_MODE, KIND_LABELS, MODE_LABELS, MODE_ICONS } from './shop-types'
import type { ShopEnvironment } from './environments/registry'
import type { PostConfig } from './shop-types'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'
import { FeedsCalcModal } from './FeedsCalcModal'
import { ErrorBoundary } from './ErrorBoundary'

// ── Op params editor ──────────────────────────────────────────────────────────
function OpParamsEditor({ op, onChange, tools, jobStock }: {
  op: ManufactureOperation
  onChange: (params: Record<string, unknown>) => void
  tools: ToolRecord[]
  jobStock?: StockDimensions | null
}): React.ReactElement {
  const p = (op.params ?? {}) as Record<string, unknown>
  const set = (k: string, v: unknown): void => onChange({ ...p, [k]: v })

  const applyTool = (toolId: string): void => {
    if (!toolId) { onChange({ ...p, toolId: undefined }); return }
    const t = tools.find(t => t.id === toolId)
    if (!t) return
    onChange({ ...p, toolId, toolDiameterMm: t.diameterMm })
  }
  const num = (label: string, key: string, step = 'any'): React.ReactElement => (
    <div className="form-group" key={key}>
      <label>{label}</label>
      <input type="number" step={step}
        value={p[key] == null ? '' : String(p[key])}
        onChange={e => set(key, e.target.value === '' ? undefined : +e.target.value)} />
    </div>
  )

  if (op.kind === 'fdm_slice') return (
    <div className="section-gap mt-8">
      <div className="form-group">
        <label>Slice Preset</label>
        <input type="text" value={String(p.slicePreset ?? '')} placeholder="default"
          onChange={e => set('slicePreset', e.target.value || null)} />
      </div>
    </div>
  )
  if (op.kind === 'export_stl') return (
    <div className="text-muted text-sm op-export-hint">No parameters {'\u2014'} exports staged STL.</div>
  )

  const is4axWrap = op.kind === 'cnc_4axis_roughing' || op.kind === 'cnc_4axis_finishing' || op.kind === 'cnc_4axis_contour'
  const is4axIdx  = op.kind === 'cnc_4axis_indexed'
  const is3dR     = op.kind === 'cnc_3d_rough'
  const is3dF     = op.kind === 'cnc_3d_finish'
  const isMeshRaster = op.kind === 'cnc_raster' || op.kind === 'cnc_pencil'

  const TOOL_TYPE_LABEL: Record<string, string> = {
    endmill: 'Flat Endmill', ball: 'Ball Nose', vbit: 'V-Bit',
    drill: 'Drill', face: 'Face Mill', other: 'Other'
  }

  return (
    <div className="section-gap mt-8">
      {/* Tool library picker */}
      <div className="form-group mb-8">
        <label className="label-upper">
          Tool from Library
        </label>
        <select
          value={String(p.toolId ?? '')}
          onChange={e => applyTool(e.target.value)}
          className="w-full">
          <option value="">{'\u2014'} Custom / Manual {'\u2014'}</option>
          {tools.length === 0 && (
            <option value="" disabled>No tools imported {'\u2014'} go to Library {'\u2192'} Tools</option>
          )}
          {tools.map(t => (
            <option key={t.id} value={t.id}>
              {t.diameterMm}mm {TOOL_TYPE_LABEL[t.type] ?? t.type}
              {t.name ? ` \u2014 ${t.name}` : ''}
              {t.material ? ` (${t.material})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row-3">
        {num('Tool \u00D8 (mm)', 'toolDiameterMm')}
        {num('Feed (mm/min)', 'feedMmMin')}
        {num('Plunge (mm/min)', 'plungeMmMin')}
      </div>
      <div className="form-row-3">
        {num('Z Pass (mm)', 'zPassMm')}
        {op.kind !== 'cnc_drill' && num('Stepover (mm)', 'stepoverMm')}
        {num('Safe Z (mm)', 'safeZMm')}
      </div>
      {(is4axWrap || is4axIdx) && (
        <div className="text-muted text-sm mb-8 lh-snug op-4axis-hint">
          4-axis: depth into the cylinder (radial). Negative or positive both work; the generator converts positive to a cut into stock.
        </div>
      )}
      {is3dR && <div className="form-row-3">{num('Stock Allow. (mm)', 'stockAllowanceMm')}</div>}
      {is3dF && (
        <div className="section-gap">
          <div className="form-row-3">
            <div className="form-group">
              <label>Finish Strategy</label>
              <select value={String(p.finishStrategy ?? 'raster')} onChange={e => set('finishStrategy', e.target.value)}>
                <option value="raster">Raster</option>
                <option value="waterline">Waterline</option>
                <option value="pencil">Pencil</option>
              </select>
            </div>
            {num('Finish Stepover (mm)', 'finishStepoverMm')}
            {num('Finish scallop (mm)', 'finishScallopMm')}
          </div>
          <div className="form-row-3">
            <div className="form-group">
              <label>Scallop mode</label>
              <select value={String(p.finishScallopMode ?? 'ball')} onChange={e => set('finishScallopMode', e.target.value)}>
                <option value="ball">Ball / cusp model</option>
                <option value="flat">Flat (floor cusp approx.)</option>
              </select>
            </div>
            {num('Raster rest stock (mm)', 'rasterRestStockMm')}
            <div className="form-group">
              <label className="text-muted text-xs">Finish</label>
              <span className="text-muted text-hint-block">
                If Finish Stepover &gt; 0 it wins; else scallop derives stepover from tool {'\u00D8'}. Rest stock offsets mesh raster Z (+Z allowance) on OCL fallback paths.
              </span>
            </div>
          </div>
        </div>
      )}
      {isMeshRaster && (
        <div className="form-row-3">
          {num('Raster rest stock (mm)', 'rasterRestStockMm')}
          <div className="form-group grid-span-2">
            <span className="text-muted text-sm">Built-in mesh raster only: leaves material along +Z on the STL envelope (coarse rest).</span>
          </div>
        </div>
      )}
      {is4axWrap && (
        <>
          {jobStock && (
            <div className="form-group grid-full">
              <label>Rotary stock</label>
              <div className="text-muted text-base lh-snug">
                {'\u00D8'} {jobStock.y} mm {'\u00D7'} length {jobStock.x} mm {'\u2014'} from job stock (X = length along axis, Y = diameter). Adjust in the job panel above.
              </div>
            </div>
          )}
          {op.kind === 'cnc_4axis_roughing' && (
            <div className="form-row-3">
              {num('Z depth step (mm)', 'zStepMm')}
              {num('Overcut (mm)', 'overcutMm')}
              <div className="form-group">
                <label className="text-muted text-xs">Roughing</label>
                <span className="text-muted text-hint-block">
                  Step-down from stock OD to Z Pass depth. Overcut extends past material edges.
                </span>
              </div>
            </div>
          )}
          {op.kind === 'cnc_4axis_finishing' && (
            <div className="form-row-3">
              {num('Finish stepover (\u00B0)', 'finishStepoverDeg')}
              {num('Finish allowance (mm)', 'rotaryFinishAllowanceMm')}
              <div className="form-group">
                <label className="text-muted text-xs">Finishing</label>
                <span className="text-muted text-hint-block">
                  Fine surface pass. Stepover defaults to half of main stepover.
                </span>
              </div>
            </div>
          )}
          {op.kind === 'cnc_4axis_contour' && (
            <div className="form-group grid-full">
              <label className="text-muted text-xs">Contour wrapping</label>
              <span className="text-muted text-hint-block">
                Wraps a 2D contour onto the cylinder surface for engraving. Set contourPoints in Manufacture workspace.
              </span>
            </div>
          )}
        </>
      )}
      {is4axIdx && (
        <>
          {jobStock && (
            <div className="form-group grid-full">
              <label>Rotary stock</label>
              <div className="text-muted text-base lh-snug">
                {'\u00D8'} {jobStock.y} mm {'\u00D7'} length {jobStock.x} mm {'\u2014'} from job stock (X = length along axis, Y = diameter). Adjust in the job panel above.
              </div>
            </div>
          )}
          <div className="form-row-3">
            {num('Z depth step (mm)', 'zStepMm')}
          </div>
          <div className="form-group">
            <label>Index Angles ({'\u00B0'}, comma-sep)</label>
            <input type="text"
              value={Array.isArray(p.indexAnglesDeg) ? (p.indexAnglesDeg as number[]).join(', ') : '0, 90, 180, 270'}
              onChange={e => {
                const arr = e.target.value.split(',').map(s => +s.trim()).filter(n => !isNaN(n))
                set('indexAnglesDeg', arr)
              }} />
          </div>
        </>
      )}
    </div>
  )
}

// ── LeftPanel ────────────────────────────────────────────────────────────────
export interface LeftPanelProps {
  jobs: Job[]
  activeJobId: string | null
  setActiveJobId: (id: string) => void
  createJob: () => void
  deleteJob: (id: string) => void
  activeJob: Job | null
  mode: MachineUIMode
  /**
   * Active shop environment, when one is selected. When provided, the
   * Add Operation menu is intersected with `env.availableOpKinds` so the
   * user only sees op kinds that are meaningful for this environment.
   */
  activeEnv?: ShopEnvironment | null
  /**
   * Optional slot rendered above the Jobs section. ShopApp uses this to inject
   * env-specific controls (wood quick-pick / axis toggle / filament hint) via
   * `EnvActionStrip` without entangling the env logic with the panel.
   */
  envHeaderSlot?: React.ReactNode
  onUpdateJob: (id: string, patch: Partial<Job>) => void
  onAddOp: (kind: ManufactureOperationKind) => void
  onRemoveOp?: (opId: string) => void
  onUpdateOpParams?: (opId: string, params: Record<string, unknown>) => void
  onImportModel?: () => void
  onRemoveModel?: () => void
  machineTools: ToolRecord[]
  materials: MaterialRecord[]
}

export const LeftPanel = React.memo(function LeftPanel({
  jobs, activeJobId, setActiveJobId, createJob, deleteJob,
  activeJob, mode, activeEnv, envHeaderSlot, onUpdateJob, onAddOp, onRemoveOp, onUpdateOpParams,
  onImportModel, onRemoveModel, machineTools, materials
}: LeftPanelProps): React.ReactElement {
  const [jobsOpen,    setJobsOpen]    = useState(true)
  const [opsOpen,     setOpsOpen]     = useState(true)
  const [tabsOpen,    setTabsOpen]    = useState(true)
  const [expandedOp,  setExpandedOp]  = useState<string | null>(null)
  const [addOpOpen,   setAddOpOpen]   = useState(false)
  const [showSecondary, setShowSecondary] = useState(false)
  const [showFeedsCalc, setShowFeedsCalc] = useState<string | null>(null)
  const [editingLabelOpId, setEditingLabelOpId] = useState<string | null>(null)
  const [editingLabelValue, setEditingLabelValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

  const { primary: modePrimary, secondary: modeSecondary } = OPS_BY_MODE[mode]
  // When an environment is active, intersect the mode-based op lists with
  // the env's allowed op kinds so the user only sees relevant operations.
  // Falls back to the full mode lists when no environment is bound (defensive
  // path — splash routing always sets one before reaching the main shell).
  const envAllowedOps = activeEnv ? new Set<ManufactureOperationKind>(activeEnv.availableOpKinds) : null
  const primary = envAllowedOps ? modePrimary.filter((k) => envAllowedOps.has(k)) : modePrimary
  const secondary = envAllowedOps ? modeSecondary.filter((k) => envAllowedOps.has(k)) : modeSecondary

  const updateOp = (opId: string, params: Record<string, unknown>): void => {
    if (!activeJob) return
    if (onUpdateOpParams) {
      onUpdateOpParams(opId, params)
    } else {
      onUpdateJob(activeJob.id, { operations: activeJob.operations.map(o => o.id === opId ? { ...o, params } : o) })
    }
  }
  const renameOp = (opId: string, label: string): void => {
    const trimmed = label.trim()
    if (!activeJob || !trimmed) return
    onUpdateJob(activeJob.id, { operations: activeJob.operations.map(o => o.id === opId ? { ...o, label: trimmed } : o) })
  }
  const removeOp = (opId: string): void => {
    if (!activeJob) return
    if (onRemoveOp) {
      onRemoveOp(opId)
    } else {
      onUpdateJob(activeJob.id, {
        operations: activeJob.operations.filter(o => o.id !== opId),
        gcodeOut: null,
        status: 'idle'
      })
    }
    if (expandedOp === opId) setExpandedOp(null)
  }
  const moveOp = (opId: string, dir: -1 | 1): void => {
    if (!activeJob) return
    const ops = [...activeJob.operations]
    const i = ops.findIndex(o => o.id === opId)
    const j = i + dir
    if (j < 0 || j >= ops.length) return
    ;[ops[i], ops[j]] = [ops[j], ops[i]]
    onUpdateJob(activeJob.id, { operations: ops, gcodeOut: null, status: 'idle' })
  }

  const duplicateOp = (opId: string): void => {
    if (!activeJob) return
    const op = activeJob.operations.find(o => o.id === opId)
    if (!op) return
    const copy = { ...op, id: crypto.randomUUID(), label: `${op.label} (copy)`, params: { ...(op.params ?? {}) } }
    const idx = activeJob.operations.findIndex(o => o.id === opId)
    const ops = [...activeJob.operations]
    ops.splice(idx + 1, 0, copy)
    onUpdateJob(activeJob.id, { operations: ops, gcodeOut: null, status: 'idle' })
  }

  const buildOpContextMenu = (opId: string): ContextMenuEntry[] => {
    if (!activeJob) return []
    const op = activeJob.operations.find(o => o.id === opId)
    if (!op) return []
    const idx = activeJob.operations.findIndex(o => o.id === opId)
    const items: ContextMenuEntry[] = [
      { id: 'rename', label: 'Rename', icon: '\u270F', action: () => { setEditingLabelOpId(opId); setEditingLabelValue(op.label) } },
      { id: 'duplicate', label: 'Duplicate', icon: '\u29C9', shortcut: 'Ctrl+D', action: () => duplicateOp(opId) },
      { separator: true },
      { id: 'move_up', label: 'Move Up', icon: '\u2191', disabled: idx === 0, action: () => moveOp(opId, -1) },
      { id: 'move_down', label: 'Move Down', icon: '\u2193', disabled: idx === activeJob.operations.length - 1, action: () => moveOp(opId, 1) },
    ]
    if (op.kind.startsWith('cnc_') && materials.length > 0) {
      items.push({ separator: true })
      items.push({ id: 'feeds', label: 'Feeds & Speeds\u2026', icon: '\u2699', action: () => setShowFeedsCalc(opId) })
    }
    items.push({ separator: true })
    items.push({ id: 'remove', label: 'Remove', icon: '\u{1F5D1}', danger: true, action: () => removeOp(opId) })
    return items
  }

  const buildJobContextMenu = (jobId: string): ContextMenuEntry[] => {
    const j = jobs.find(x => x.id === jobId)
    if (!j) return []
    return [
      { id: 'select', label: 'Select', icon: '\u25B8', disabled: jobId === activeJobId, action: () => setActiveJobId(jobId) },
      { separator: true },
      { id: 'delete', label: 'Delete', icon: '\u{1F5D1}', danger: true, action: () => deleteJob(jobId) },
    ]
  }

  // Ctrl+D to duplicate the currently expanded operation
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault()
        if (expandedOp) duplicateOp(expandedOp)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [expandedOp, activeJob])

  const STATUS_DOT: Record<Job['status'], string> = { idle: '#555', running: '#f0a500', done: '#22c55e', error: '#ef4444' }

  return (
    <>
    <nav className="shop-left" aria-label="Job and operations panel">
      {envHeaderSlot}
      {/* Jobs */}
      <div className="panel-section">
        <div className="panel-section-header"
          role="button"
          tabIndex={0}
          aria-expanded={jobsOpen}
          onClick={() => setJobsOpen(o => !o)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setJobsOpen(o => !o) } }}>
          <span className="panel-section-chevron">{jobsOpen ? '\u25BE' : '\u25B8'}</span>
          <span>JOBS</span>
          <div className="flex-spacer" />
          <button className="btn btn-ghost btn-sm btn-icon"
            aria-label="Create new job"
            onClick={e => { e.stopPropagation(); createJob() }}>+</button>
        </div>
        {jobsOpen && (
          <div className="panel-section-body panel-section-body--jobs" role="listbox" aria-label="Jobs list">
            {jobs.length === 0 && <div className="text-muted op-list-hint">No jobs {'\u2014'} click + to create one.</div>}
            {jobs.map(j => (
              <div key={j.id}
                role="option"
                tabIndex={0}
                aria-selected={j.id === activeJobId}
                className={`op-item${j.id === activeJobId ? ' op-item--active' : ''}`}
                onClick={() => setActiveJobId(j.id)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveJobId(j.id) } }}
                onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, items: buildJobContextMenu(j.id) }) }}>
                <span className="op-item-dot" style={{ background: STATUS_DOT[j.status] }} />
                <span className="op-item-info">{j.name || 'Untitled'}</span>
                {j.id === activeJobId && (
                  <button className="btn btn-ghost btn-sm btn-icon ml-auto opacity-50"
                    aria-label={`Delete job ${j.name || 'Untitled'}`}
                    onClick={e => { e.stopPropagation(); deleteJob(j.id) }}>{'\u{1F5D1}'}</button>
                )}
              </div>
            ))}
          </div>
        )}
        {jobsOpen && activeJob && (
          <div className="panel-footer-compact">
            <div className="label-upper--xs">
              {'\u{1F5A8}'} Printer URL
            </div>
            <input
              type="text"
              placeholder={mode === 'fdm' ? 'http://printer.local (Moonraker)' : 'http://printer.local'}
              aria-label="Printer URL"
              value={activeJob.printerUrl ?? ''}
              onChange={e => onUpdateJob(activeJob.id, { printerUrl: e.target.value })}
              className="printer-url-input"
            />
          </div>
        )}
      </div>

      {/* Model -- shows current model with import/remove controls */}
      {activeJob && (
        <div className="panel-section">
          <div className="panel-section-header">
            <span className="panel-section-chevron">{'\u25B8'}</span>
            <span>MODEL</span>
            <div className="flex-spacer" />
            {onImportModel && (
              <button className="btn btn-ghost btn-sm btn-icon"
                aria-label="Import model"
                title="Import model file (STL, DXF, STEP, IGES, OBJ, 3MF)"
                onClick={e => { e.stopPropagation(); onImportModel() }}>+</button>
            )}
          </div>
          <div className="panel-pad--sm">
            {activeJob.stlPath ? (
              <div className="model-info-row">
                <span className="model-info-name" title={activeJob.stlPath}>
                  {activeJob.stlPath.split(/[\\/]/).pop() ?? activeJob.stlPath}
                </span>
                {onRemoveModel && (
                  <button
                    className="btn btn-ghost btn-sm btn-icon btn-icon--danger"
                    aria-label="Remove model from job"
                    title="Remove model from this job"
                    onClick={onRemoveModel}>
                    {'\u2715'}
                  </button>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted lh-relaxed">
                No model loaded.{' '}
                {onImportModel && (
                  <button className="btn btn-ghost btn-sm btn-xs btn-inline"
                    onClick={onImportModel}>Import model{'\u2026'}</button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Support Posts -- 4-axis / 5-axis only */}
      {(mode === 'cnc_4axis' || mode === 'cnc_5axis') && (
        <div className="panel-section">
          <div className="panel-section-header"
            role="button"
            tabIndex={0}
            aria-expanded={tabsOpen}
            onClick={() => setTabsOpen(o => !o)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setTabsOpen(o => !o) } }}>
            <span className="panel-section-chevron">{tabsOpen ? '\u25BE' : '\u25B8'}</span>
            <span>SUPPORT POSTS</span>
            <div className="flex-spacer" />
            {activeJob && (
              <button className="btn btn-ghost btn-sm btn-icon"
                aria-label={activeJob.posts ? 'Remove support post' : 'Add support post'}
                title={activeJob.posts ? 'Remove support post' : 'Add support post'}
                onClick={e => {
                  e.stopPropagation()
                  if (!activeJob) return
                  onUpdateJob(activeJob.id, {
                    posts: activeJob.posts
                      ? null
                      : { count: 1, diameterMm: 6, offsetRadiusMm: 0 }
                  })
                  setTabsOpen(true)
                }}>
                {activeJob.posts ? '\u2715' : '+'}
              </button>
            )}
          </div>

          {tabsOpen && (
            <div className="panel-pad">
              {!activeJob && (
                <div className="text-base text-muted">Select a job first.</div>
              )}
              {activeJob && !activeJob.posts && (
                <div className="text-base text-muted lh-relaxed">
                  No support post configured.<br />
                  <span className="opacity-70">Click + to add {'\u2014'} a post runs axially
                  through the centre of the blank so the machine keeps its grip as
                  outer material is removed.</span>
                </div>
              )}
              {activeJob?.posts && (() => {
                const p = activeJob.posts!
                const set = (patch: Partial<PostConfig>): void =>
                  onUpdateJob(activeJob.id, { posts: { ...p, ...patch } })
                return (
                  <div className="axis4-config">

                    {/* Visual diagram */}
                    <div className="axis4-viz-center">
                      <svg width="120" height="60" viewBox="0 0 120 60">
                        <rect x="8" y="10" width="104" height="40" rx="4"
                          fill="none" stroke="var(--border-hi)" strokeWidth="1.5" />
                        <ellipse cx="8" cy="30" rx="5" ry="20"
                          fill="none" stroke="var(--border-hi)" strokeWidth="1.2" />
                        <ellipse cx="112" cy="30" rx="5" ry="20"
                          fill="none" stroke="var(--border-hi)" strokeWidth="1.2" />
                        {Array.from({ length: p.count }).map((_, i) => {
                          const angle = (i / p.count) * Math.PI * 2
                          const oy = p.offsetRadiusMm > 0
                            ? (p.offsetRadiusMm / (p.offsetRadiusMm + 15)) * 16 * Math.cos(angle)
                            : 0
                          const postR = Math.max(1.5, (p.diameterMm / (activeJob.stock.y || 50)) * 20)
                          return (
                            <rect key={i}
                              x="8" y={30 + oy - postR} width="104" height={postR * 2} rx={postR}
                              fill="#22c55e" opacity="0.85" />
                          )
                        })}
                        <line x1="8" y1="30" x2="112" y2="30"
                          stroke="#f97316" strokeWidth="0.8" strokeDasharray="4,3" opacity="0.5" />
                        <text x="60" y="57" textAnchor="middle"
                          fontSize="8" fill="var(--txt2)">post through centre {'\u2192'}</text>
                      </svg>
                    </div>

                    {/* Count */}
                    <div>
                      <label className="post-config-label">Posts</label>
                      <div className="axis4-chunk-row">
                        {([1, 2, 4] as const).map(n => (
                          <button key={n}
                            onClick={() => set({ count: n })}
                            className={`post-count-btn${p.count === n ? ' post-count-btn--active' : ''}`}>
                            {n === 1 ? '1 (centre)' : `${n} posts`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Diameter + offset */}
                    <div className="axis4-dims-grid">
                      <div>
                        <label className="post-config-label">Diameter (mm)</label>
                        <input type="number" min="1" max="30" step="0.5"
                          value={p.diameterMm}
                          onChange={e => set({ diameterMm: Math.max(1, +e.target.value) })}
                          className="w-full" />
                        <div className="axis4-dim-hint">post {'\u00D8'}</div>
                      </div>
                      {p.count > 1 && (
                        <div>
                          <label className="post-config-label">Offset radius (mm)</label>
                          <input type="number" min="0" max="40" step="1"
                            value={p.offsetRadiusMm}
                            onChange={e => set({ offsetRadiusMm: Math.max(0, +e.target.value) })}
                            className="w-full" />
                          <div className="axis4-dim-hint">from axis</div>
                        </div>
                      )}
                    </div>

                    {/* Summary */}
                    <div className="post-summary-box">
                      {p.count === 1
                        ? `Single \u00D8${p.diameterMm}mm post \u00B7 runs along rotation axis`
                        : `${p.count}\u00D7 \u00D8${p.diameterMm}mm posts \u00B7 ${p.offsetRadiusMm}mm from axis \u00B7 ${(360 / p.count).toFixed(0)}\u00B0 spacing`
                      }
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}

      {/* Chuck Depth -- 4-axis / 5-axis only */}
      {(mode === 'cnc_4axis' || mode === 'cnc_5axis') && activeJob && (
        <div className="panel-section">
          <div className="panel-pad">
            <div className="label-upper mb-8">
              CHUCK DEPTH
            </div>
            <div className="headstock-desc">
              Stock inserted into chuck {'\u2014'} shown as <span className="headstock-color-red">red</span> zone. Not machinable.
            </div>
            <div className="headstock-grip-row">
              {([5, 10] as const).map(d => (
                <button key={d}
                  className={`btn btn-sm flex-spacer text-base${activeJob.chuckDepthMm === d ? ' btn-primary' : ' btn-ghost'}`}
                  onClick={() => onUpdateJob(activeJob.id, { chuckDepthMm: d })}>
                  {d}mm
                </button>
              ))}
            </div>
            {/* Clamp offset */}
            <div className="clamp-section">
              <div className="label-upper">
                Clamp Offset <span className="text-warn">{'\u25A0'}</span>
              </div>
              <div className="text-sm text-muted mb-6 lh-snug">
                Safety buffer between chuck and model.
              </div>
              <div className="clamp-offset-row">
                <input type="number" min="0" max="50" step="0.5"
                  value={activeJob.clampOffsetMm}
                  onChange={e => onUpdateJob(activeJob.id, { clampOffsetMm: Math.max(0, +e.target.value) })}
                  className="clamp-offset-input" />
                <span className="text-muted text-sm">mm</span>
              </div>
            </div>
            <div className="clamp-machinable">
              Machinable: <strong>
                {Math.max(0, activeJob.stock.x - activeJob.chuckDepthMm - activeJob.clampOffsetMm)} mm
              </strong>{' '}of {activeJob.stock.x} mm total
            </div>
          </div>
        </div>
      )}

      {/* Material -- CNC modes only */}
      {mode !== 'fdm' && (
        <div className="panel-section">
          <div className="panel-section-header">
            <span className="panel-section-chevron">{'\u25B8'}</span>
            <span>MATERIAL</span>
          </div>
          <div className="panel-pad--sm">
            <select
              className="w-full text-base"
              aria-label="Select material"
              value={activeJob?.materialId ?? ''}
              disabled={!activeJob}
              onChange={e => activeJob && onUpdateJob(activeJob.id, { materialId: e.target.value || null })}>
              <option value="">{'\u2014'} select material {'\u2014'}</option>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {activeJob?.materialId && (
              <div className="tool-select-row">
                <button className="btn btn-ghost btn-sm btn-xs"
                  title="Apply material cut params to all CNC operations"
                  onClick={() => {
                    if (!activeJob?.materialId) return
                    // Delegate to parent via onUpdateJob with the material application
                    // The parent ShopApp handles applyMaterialToOperations
                  }}>{'\u26A1'} Apply to ops</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tools -- CNC modes only */}
      {mode !== 'fdm' && (
        <div className="panel-section">
          <div className="panel-section-header">
            <span className="panel-section-chevron">{'\u25B8'}</span>
            <span>TOOLS</span>
          </div>
          <div className="panel-pad--sm">
            {machineTools.length === 0 ? (
              <div className="text-sm text-muted lh-relaxed">
                No tools imported.<br />
                <span className="opacity-70">Go to <strong>Library {'\u2192'} Tools</strong> and import a tool library for this machine.</span>
              </div>
            ) : (
              <div className="tool-mini-list">
                {machineTools.map(t => (
                  <div key={t.id} className="tool-mini-item">
                    <span className="font-semibold">{'\u00D8'}{t.diameterMm}</span>
                    <span className="text-muted">{t.type}{t.fluteCount ? ` \u00B7 ${t.fluteCount}fl` : ''}</span>
                    <span className="tool-mini-name">{t.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Operations */}
      <div className="panel-section panel-section--grow">
        <div className="panel-section-header"
          role="button"
          tabIndex={0}
          aria-expanded={opsOpen}
          onClick={() => setOpsOpen(o => !o)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpsOpen(o => !o) } }}>
          <span className="panel-section-chevron">{opsOpen ? '\u25BE' : '\u25B8'}</span>
          <span>OPERATIONS</span>
          <div className="flex-spacer" />
          {activeJob && (
            <button className="btn btn-ghost btn-sm btn-icon"
              aria-label="Add operation"
              onClick={e => { e.stopPropagation(); setAddOpOpen(o => !o) }}>+</button>
          )}
        </div>

        {addOpOpen && activeJob && (
          <div className="add-op-menu">
            <div className="add-op-section-label--static">
              {activeEnv ? activeEnv.iconGlyph : MODE_ICONS[mode]}
              {' '}
              {activeEnv ? activeEnv.name : MODE_LABELS[mode]}
              {' \u2014 primary'}
            </div>
            {primary.map(k => (
              <div key={k} className="op-item op-item--indent"
                role="button"
                tabIndex={0}
                onClick={() => { onAddOp(k); setAddOpOpen(false) }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddOp(k); setAddOpOpen(false) } }}>
                <span className="op-item-info">{KIND_LABELS[k] ?? k}</span>
              </div>
            ))}
            {secondary.length > 0 && (
              <>
                <div className="add-op-section-label"
                  role="button"
                  tabIndex={0}
                  aria-expanded={showSecondary}
                  onClick={() => setShowSecondary(s => !s)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowSecondary(s => !s) } }}>
                  {showSecondary ? '\u25BE' : '\u25B8'} More operations
                </div>
                {showSecondary && secondary.map(k => (
                  <div key={k} className="op-item op-item--indent op-item--secondary"
                    role="button"
                    tabIndex={0}
                    onClick={() => { onAddOp(k); setAddOpOpen(false) }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAddOp(k); setAddOpOpen(false) } }}>
                    <span className="op-item-info">{KIND_LABELS[k] ?? k}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {opsOpen && (
          <ul role="list" className="op-list">
            {!activeJob && <li className="text-muted op-list-hint">Select a job first.</li>}
            {activeJob && activeJob.operations.length === 0 && (
              <li className="text-muted op-list-hint">No operations {'\u2014'} click + to add.</li>
            )}
            {activeJob && activeJob.operations.map((op, idx) => {
              const exp = expandedOp === op.id
              const isRenamingThis = editingLabelOpId === op.id
              return (
                <li key={op.id} className="op-item-group">
                  <div className={`op-item-header${exp ? ' op-item-header--open' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={exp}
                    onClick={() => { if (!isRenamingThis) setExpandedOp(exp ? null : op.id) }}
                    onKeyDown={e => { if (!isRenamingThis && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setExpandedOp(exp ? null : op.id) } }}
                    onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, items: buildOpContextMenu(op.id) }) }}>
                    <span className="op-item-idx">{idx + 1}</span>
                    {isRenamingThis ? (
                      <input
                        className="op-label-edit"
                        value={editingLabelValue}
                        autoFocus
                        onClick={e => e.stopPropagation()}
                        onChange={e => setEditingLabelValue(e.target.value)}
                        onBlur={() => { renameOp(op.id, editingLabelValue); setEditingLabelOpId(null) }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { renameOp(op.id, editingLabelValue); setEditingLabelOpId(null) }
                          if (e.key === 'Escape') { setEditingLabelOpId(null) }
                          e.stopPropagation()
                        }}
                      />
                    ) : (
                      <span
                        className="op-item-info flex-spacer text-base"
                        title="Double-click to rename"
                        onDoubleClick={e => { e.stopPropagation(); setEditingLabelOpId(op.id); setEditingLabelValue(op.label) }}
                      >{op.label}</span>
                    )}
                    {!isRenamingThis && <span className="chevron-sm">{exp ? '\u25BE' : '\u25B8'}</span>}
                  </div>
                  {exp && (
                    <div className="op-item-body">
                      <OpParamsEditor op={op} tools={machineTools} jobStock={activeJob.stock}
                        onChange={params => updateOp(op.id, params)} />
                      <div className="op-action-row">
                        <button className="btn btn-ghost btn-sm" aria-label="Move operation up" onClick={() => moveOp(op.id, -1)}>{'\u2191'}</button>
                        <button className="btn btn-ghost btn-sm" aria-label="Move operation down" onClick={() => moveOp(op.id, 1)}>{'\u2193'}</button>
                        {op.kind.startsWith('cnc_') && materials.length > 0 && (
                          <button className="btn btn-ghost btn-sm btn-xs"
                            title="Feeds & Speeds Calculator for this operation"
                            onClick={() => setShowFeedsCalc(op.id)}>{'\u2699'} F&S</button>
                        )}
                        <div className="flex-spacer" />
                        <button className="btn btn-ghost btn-sm text-danger"
                          onClick={() => removeOp(op.id)}>Remove</button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </nav>

    {/* Operation context menu */}
    {ctxMenu && <ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} />}

    {/* Feeds & Speeds Calculator Modal -- per-operation */}
    {showFeedsCalc !== null && activeJob && (() => {
      const targetOpId = showFeedsCalc
      return (
        <ErrorBoundary label="Feeds & Speeds" severity="panel">
        <FeedsCalcModal
          materials={materials}
          tools={machineTools}
          onApplyToOp={params => {
            const op = activeJob.operations.find(o => o.id === targetOpId)
            if (!op) return
            updateOp(targetOpId, { ...(op.params ?? {}), ...params })
          }}
          onApplyToAll={params => {
            const ops = activeJob.operations.map(op => op.kind.startsWith('cnc_')
              ? { ...op, params: { ...(op.params ?? {}), ...params } }
              : op
            )
            onUpdateJob(activeJob.id, { operations: ops })
          }}
          onClose={() => setShowFeedsCalc(null)}
        />
        </ErrorBoundary>
      )
    })()}
    </>
  )
})
