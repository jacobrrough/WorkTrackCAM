/**
 * ShopApp -- WorkTrackCAM
 *
 * Environment-first workflow:
 *   1. EnvironmentSplash -- three-card picker (VCarve Pro / Creality Print /
 *                           Makera CAM) shown on every launch
 *   2. Main UI           -- toolbar + left panel + viewport, themed via the
 *                           active environment's `data-environment` accent
 *                           and gated by the env's available op kinds
 *
 * Per-environment job lists are persisted under env-scoped localStorage keys
 * via `environments/env-jobs-storage.ts` (legacy `fab-jobs-v1` is migrated on
 * first load and removed once every env has claimed its share).
 *
 * Decomposed: EnvironmentSplash, LeftPanel, FeedsCalcModal, LibraryView,
 * SettingsView are extracted into their own files. ShopApp owns state
 * management + composition.
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState, Fragment, lazy, Suspense
} from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import type { ManufactureOperation, ManufactureOperationKind } from '../../shared/manufacture-schema'
import type { ToolRecord } from '../../shared/tool-schema'
import type { MaterialRecord } from '../../shared/material-schema'
import { resolveCamCutParamsWithMaterial, applyMaterialToNewOpParams } from '../../shared/cam-cut-params'
import { CAM_CUT_DEFAULTS } from '../../shared/cam-cut-params'
import { shopJobStockAsCamSetup } from '../../shared/cam-setup-defaults'
import { friendlyError } from '../../shared/file-parse-errors'
import { ShopModelViewer, defaultTransform } from './ShopModelViewer'
import { ErrorBoundary } from './ErrorBoundary'
import { ConfirmDialog } from './ConfirmDialog'
import type { ModelTransform, GizmoMode } from './ShopModelViewer'
import {
  type MachineUIMode,
  fitModelToStock,
  modelFitsInStock
} from './shop-stock-bounds'
import { generateSetupSheet, parseGcodeStats } from './setup-sheet'
import type { SetupSheetJob } from './setup-sheet'
// window-state is now handled by UIContext
import {
  APP_KEYBOARD_SHORTCUT_GROUPS,
  isTypableKeyboardTarget,
  matchesKeyboardShortcutsReference,
  matchesOpenProject,
  matchesNewProject,
  matchesGenerate,
} from '../../shared/app-keyboard-shortcuts'
import { useFocusTrap } from './useFocusTrap'
import { useUndo } from './useUndo'
import { PropertyEditCommand, AddItemCommand, DeleteItemCommand } from './undo-manager'
import { formatErrorForToast } from './error-messages'

// ── Extracted components ──────────────────────────────────────────────────────
import { EnvironmentSplash } from './environments/EnvironmentSplash'
import { EnvActionStrip } from './environments/EnvActionStrip'
import { getEnvironmentForMachine } from './environments/env-routing'
import {
  finalizeLegacyJobsMigration,
  loadEnvJobs,
  saveEnvJobs
} from './environments/env-jobs-storage'
import { LeftPanel } from './LeftPanel'
import { HelpPanel } from './HelpPanel'
import { OnboardingOverlay, shouldShowOnboarding } from './OnboardingOverlay'
import { LibraryDrawer } from '../shell/LibraryDrawer'
import { SettingsDrawer } from '../shell/SettingsDrawer'

// ── Context providers ────────────────────────────────────────────────────────
import { AppProviders, useToast, useUI, useMachineSession } from '../contexts'

// Lazy-loaded: LibraryView is used by the machine-splash overlay; SettingsView
// is loaded directly by the SettingsDrawer.
const LibraryView = lazy(() => import('./LibraryView').then(m => ({ default: m.LibraryView })))

// ── Shared types & utilities ──────────────────────────────────────────────────
import type { Toast, Job } from './shop-types'
import { fab, getMachineMode, MODE_LABELS, MODE_ICONS, OPS_BY_MODE, KIND_LABELS } from './shop-types'

// ── Material apply helper ─────────────────────────────────────────────────────
type MaterialApplyResult = {
  operations: ManufactureOperation[]
  changed: boolean
}

function applyMaterialToOperations(
  operations: ManufactureOperation[],
  materialId: string | null,
  materials: MaterialRecord[],
  tools: ToolRecord[],
  jobStock?: { x: number; y: number; z: number }
): MaterialApplyResult {
  if (!materialId) return { operations, changed: false }
  const setup = jobStock ? shopJobStockAsCamSetup(jobStock) : undefined
  let changed = false
  const next = operations.map((op) => {
    if (!op.kind.startsWith('cnc_')) return op
    const resolved = resolveCamCutParamsWithMaterial({
      operation: op,
      materialId,
      materials,
      tools,
      setup
    })
    const prev = (op.params ?? {}) as Record<string, unknown>
    const nextParams: Record<string, unknown> = {
      ...prev,
      zPassMm: resolved.zPassMm,
      stepoverMm: resolved.stepoverMm,
      feedMmMin: resolved.feedMmMin,
      plungeMmMin: resolved.plungeMmMin,
      safeZMm: resolved.safeZMm
    }
    if (
      prev.zPassMm !== nextParams.zPassMm ||
      prev.stepoverMm !== nextParams.stepoverMm ||
      prev.feedMmMin !== nextParams.feedMmMin ||
      prev.plungeMmMin !== nextParams.plungeMmMin ||
      prev.safeZMm !== nextParams.safeZMm
    ) {
      changed = true
      return { ...op, params: nextParams }
    }
    return op
  })
  return { operations: changed ? next : operations, changed }
}

function newJob(name: string, machineId?: string): Job {
  return {
    id: crypto.randomUUID(), name,
    stlPath: null, machineId: machineId ?? null, materialId: null,
    stock: { x: 100, y: 100, z: 20 }, transform: defaultTransform(),
    stockProfile: 'cylinder',
    operations: [], posts: null, chuckDepthMm: 5, clampOffsetMm: 0,
    gcodeOut: null, status: 'idle', lastLog: '', printerUrl: ''
  }
}

function newOp(kind: ManufactureOperationKind): ManufactureOperation {
  const defaults: Record<string, Record<string, unknown>> = {
    cnc_parallel:       { zPassMm: -1,   stepoverMm: 2,   feedMmMin: 1200, plungeMmMin: 400,  safeZMm: 5, toolDiameterMm: 6 },
    cnc_contour:        { zPassMm: -1,   stepoverMm: 2,   feedMmMin: 1200, plungeMmMin: 400,  safeZMm: 5, toolDiameterMm: 6 },
    cnc_pocket:         { zPassMm: -1,   stepoverMm: 2,   feedMmMin: 1200, plungeMmMin: 400,  safeZMm: 5, toolDiameterMm: 6 },
    cnc_drill:          { zPassMm: -5,   feedMmMin: 400,  plungeMmMin: 200, safeZMm: 5, toolDiameterMm: 3 },
    cnc_adaptive:       { zPassMm: -1,   stepoverMm: 3,   feedMmMin: 1500, plungeMmMin: 400,  safeZMm: 5, toolDiameterMm: 6 },
    cnc_waterline:      { zPassMm: -0.5, stepoverMm: 1.5, feedMmMin: 1000, plungeMmMin: 300,  safeZMm: 5, toolDiameterMm: 6 },
    cnc_raster:         { zPassMm: -0.5, stepoverMm: 1.5, feedMmMin: 1000, plungeMmMin: 300,  safeZMm: 5, toolDiameterMm: 6, rasterRestStockMm: 0 },
    cnc_pencil:         { zPassMm: -0.3, stepoverMm: 0.5, feedMmMin: 800,  plungeMmMin: 300,  safeZMm: 5, toolDiameterMm: 3, rasterRestStockMm: 0 },
    cnc_4axis_roughing: {
      zPassMm: -3, stepoverMm: 2, zStepMm: 1, feedMmMin: 1000, plungeMmMin: 300, safeZMm: 5, toolDiameterMm: 6
    },
    cnc_4axis_finishing: {
      zPassMm: -3, stepoverMm: 1, feedMmMin: 800, plungeMmMin: 300, safeZMm: 5, toolDiameterMm: 6
    },
    cnc_4axis_contour: {
      zPassMm: -1, feedMmMin: 600, plungeMmMin: 200, safeZMm: 5, toolDiameterMm: 3
    },
    cnc_4axis_indexed: {
      zPassMm: -1, stepoverMm: 2, zStepMm: 1, feedMmMin: 1000, plungeMmMin: 300, safeZMm: 5, toolDiameterMm: 6,
      indexAnglesDeg: [0, 90, 180, 270]
    },
    cnc_3d_rough:       { zPassMm: -2,   stepoverMm: 4,   feedMmMin: 1500, plungeMmMin: 400,  safeZMm: 5, toolDiameterMm: 8, stockAllowanceMm: 0.5 },
    cnc_3d_finish:      { zPassMm: -0.5, stepoverMm: 1,   feedMmMin: 1000, plungeMmMin: 300,  safeZMm: 5, toolDiameterMm: 6, finishStrategy: 'raster', finishStepoverMm: 0.5, finishScallopMm: 0, rasterRestStockMm: 0 },
    fdm_slice:          { slicePreset: null },
    export_stl:         {}
  }
  return { id: crypto.randomUUID(), kind, label: KIND_LABELS[kind] ?? kind, params: defaults[kind] ?? {} }
}

// ── Scrub input -- drag the label to scrub value (Blender-style) ───────────────
function ScrubInput({ label, value, step, onChange, color, suffix }: {
  label: string; value: number; step: number
  onChange: (v: number) => void; color?: string; suffix?: string
}): React.ReactElement {
  const startRef = useRef<{ x: number; val: number } | null>(null)
  const [scrubbing, setScrubbing] = useState(false)

  const onLabelDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    startRef.current = { x: e.clientX, val: value }
    setScrubbing(true)
    const onMove = (me: MouseEvent): void => {
      if (!startRef.current) return
      const mul = me.shiftKey ? 10 : me.ctrlKey ? 0.1 : 1
      const delta = (me.clientX - startRef.current.x) * step * mul
      const raw = startRef.current.val + delta
      const precision = step < 0.01 ? 4 : step < 0.1 ? 3 : step < 1 ? 2 : 1
      onChange(parseFloat(raw.toFixed(precision)))
    }
    const onUp = (): void => {
      startRef.current = null; setScrubbing(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="xyz-cell">
      <span
        className={`xyz-label${scrubbing ? ' xyz-label--scrubbing' : ''}`}
        onMouseDown={onLabelDown}
        style={scrubbing ? undefined : (color ? { color } : undefined)}
        title="Drag to scrub \u00B7 Shift = \u00D710 \u00B7 Ctrl = \u00D70.1"
      >
        {label}
      </span>
      <input
        type="number" step={step}
        value={value}
        aria-label={label}
        onChange={e => onChange(+e.target.value)}
        className={scrubbing ? 'xyz-input--scrubbing' : undefined}
      />
      {suffix && <span className="xyz-suffix">{suffix}</span>}
    </div>
  )
}

// ── Viewport area ─────────────────────────────────────────────────────────────
const GIZMO_MODES: { mode: GizmoMode; icon: string; title: string }[] = [
  { mode: 'translate', icon: '\u22B9', title: 'Move (G)' },
  { mode: 'rotate',    icon: '\u21BB', title: 'Rotate (R)' },
  { mode: 'scale',     icon: '\u2921', title: 'Scale (S)' },
]
const AX_COLORS = { x: '#e74c3c', y: '#2ecc71', z: '#3d7eff' } as const

const ViewportArea = React.memo(function ViewportArea({ job, mode, onUpdateJob, onToast, modelSize, setModelSize, gcodeGeneration = 0 }: {
  job: Job | null; mode: MachineUIMode
  onUpdateJob: (id: string, patch: Partial<Job>) => void
  onToast: (kind: Toast['kind'], msg: string) => void
  modelSize: { x: number; y: number; z: number } | null
  setModelSize: (s: { x: number; y: number; z: number } | null) => void
  gcodeGeneration?: number
}): React.ReactElement {
  const [floatOpen,    setFloatOpen]    = useState(true)
  const [dragging,     setDragging]     = useState(false)
  const [gizmoMode,    setGizmoMode]    = useState<GizmoMode>('translate')

  const handleModelLoaded = useCallback((x: number, y: number, z: number) => {
    setModelSize({ x, y, z })
  }, [setModelSize])

  const fitsInStock = useMemo(() => {
    if (!job?.stlPath || !modelSize || !job?.transform || !job?.stock) return true
    try {
      return modelFitsInStock(modelSize, job.transform, job.stock, mode, {
        chuckDepthMm: job.chuckDepthMm,
        clampOffsetMm: job.clampOffsetMm ?? 0,
        stockProfile: job.stockProfile
      })
    } catch {
      return true
    }
  }, [modelSize, job?.transform, job?.stock, job?.stlPath, mode, job?.chuckDepthMm, job?.clampOffsetMm])

  const handleFitToStock = useCallback((): void => {
    if (!job || !modelSize) return
    const fit = fitModelToStock(modelSize, job.stock, mode, {
      chuckDepthMm: job.chuckDepthMm,
      clampOffsetMm: job.clampOffsetMm ?? 0,
      stockProfile: job.stockProfile
    })
    onUpdateJob(job.id, { transform: { ...job.transform, ...fit } })
  }, [job, modelSize, mode, onUpdateJob])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'g' || e.key === 'G') setGizmoMode(m => m === 'translate' ? null : 'translate')
      if (e.key === 'r' || e.key === 'R') setGizmoMode(m => m === 'rotate'    ? null : 'rotate')
      if (e.key === 's' || e.key === 'S') setGizmoMode(m => m === 'scale'     ? null : 'scale')
      if (e.key === 'f' || e.key === 'F') handleFitToStock()
      if (e.key === 'Escape') setGizmoMode(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleFitToStock])

  const handleDxfImport = useCallback(async (filePath: string) => {
    try {
      const result = await fab().dxfImport(filePath)
      if (!result.ok) { onToast('err', `DXF import failed: ${result.error}`); return }
      const warnCount = result.warnings.length
      const layerList = result.layers.length > 0 ? ` [${result.layers.join(', ')}]` : ''
      onToast('ok', `DXF imported: ${result.entities.length} entities, ${result.layers.length} layer(s)${layerList}, units: ${result.units}${warnCount > 0 ? ` (${warnCount} warning${warnCount > 1 ? 's' : ''})` : ''}`)
    } catch (e) {
      onToast('err', `DXF import error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [onToast])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    if (!job) return
    const file = e.dataTransfer.files[0]
    if (!file) return
    const name = file.name.toLowerCase()
    const filePath = (file as unknown as { path?: string }).path ?? ''
    if (name.endsWith('.dxf')) { handleDxfImport(filePath); return }
    if (!name.endsWith('.stl')) { onToast('warn', 'Drop an .stl or .dxf file'); return }
    try {
      const staged = await fab().stlStage('default', filePath)
      onUpdateJob(job.id, { stlPath: staged })
    } catch { onUpdateJob(job.id, { stlPath: filePath || null }) }
  }, [job, onUpdateJob, onToast, handleDxfImport])

  const browseModel = async (): Promise<void> => {
    if (!job) return
    const p = await fab().dialogOpenFile([{ name: 'CAD Models', extensions: ['stl', 'dxf'] }])
    if (!p) return
    if (p.toLowerCase().endsWith('.dxf')) { handleDxfImport(p); return }
    onUpdateJob(job.id, { stlPath: p })
  }

  const setField = (field: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', val: number): void => {
    if (!job) return
    const t = job.transform ?? defaultTransform()
    onUpdateJob(job.id, { transform: { ...t, [field]: { ...(t[field] ?? {}), [axis]: val } } })
  }

  const handleTransformChange = (t: ModelTransform): void => {
    if (!job) return
    onUpdateJob(job.id, { transform: t })
  }

  const axes: ('x' | 'y' | 'z')[] = ['x', 'y', 'z']

  return (
    <div className="shop-viewport"
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}>

      <ShopModelViewer
        stlPath={job?.stlPath ?? null}
        stock={job?.stock ?? { x: 100, y: 100, z: 20 }}
        stockProfile={job?.stockProfile ?? 'cylinder'}
        transform={job?.transform ?? defaultTransform()}
        transformMode={mode !== 'fdm' ? gizmoMode : null}
        mode={mode}
        gcodeOut={job?.gcodeOut ?? null}
        gcodeGeneration={gcodeGeneration}
        chuckDepthMm={job?.chuckDepthMm ?? 5}
        clampOffsetMm={job?.clampOffsetMm ?? 0}
        posts={job?.posts ?? null}
        onTransformChange={handleTransformChange}
        onModelLoaded={handleModelLoaded}
      />

      {!job?.stlPath && !dragging && (
        <div className="viewport-drop vp-empty-overlay">
          <div className="vp-empty-content">
            <div className="vp-empty-icon">{MODE_ICONS[mode]}</div>
            <div className="vp-empty-title">{MODE_LABELS[mode]}</div>
            <div className="vp-empty-hint">Drop an STL or DXF file here or</div>
            {job
              ? <button className="btn btn-ghost btn--force-visible" onClick={browseModel}>Browse for Model{'\u2026'}</button>
              : <div className="vp-empty-hint">Create or select a job first</div>}
          </div>
        </div>
      )}

      {dragging && (
        <div className="viewport-drop vp-drag-overlay">
          <div className="vp-drag-content">
            <div className="vp-drag-icon">{'\u2B21'}</div>
            <div className="vp-drag-title">Drop STL to load model</div>
          </div>
        </div>
      )}

      {!fitsInStock && job?.stlPath && mode !== 'fdm' && (
        <div className="vp-warning-banner">
          <span className="vp-warning-banner__icon">{'\u26A0'}</span>
          <span>Model extends outside stock</span>
          <button
            onClick={handleFitToStock}
            className="vp-warning-banner__btn">
            Auto-fit
          </button>
        </div>
      )}

      {mode !== 'fdm' && (
        <div className="vp-hud-group">
          {GIZMO_MODES.map(({ mode: m, icon, title }) => (
            <button key={m} title={title}
              aria-label={title}
              aria-pressed={gizmoMode === m}
              onClick={() => setGizmoMode(g => g === m ? null : m)}
              className={`vp-hud-btn${gizmoMode === m ? ' vp-hud-btn--active' : ''}`}>
              {icon}
            </button>
          ))}
          {gizmoMode && (
            <button title="No gizmo (Esc)"
              aria-label="Deselect gizmo"
              onClick={() => setGizmoMode(null)}
              className="vp-hud-btn">
              {'\u2715'}
            </button>
          )}
        </div>
      )}

      {gizmoMode && mode !== 'fdm' && (
        <div className="vp-hud-hint">
          <span className="vp-hud-hint__mode">{gizmoMode}</span>
          <span className="vp-hud-hint__keys">Drag axis {'\u00B7'} G/R/S/F {'\u00B7'} Esc</span>
        </div>
      )}

      {job && mode !== 'fdm' && (
        <div className="vp-float-panel">
          <div className="vp-float-header"
            role="button"
            tabIndex={0}
            aria-expanded={floatOpen}
            onClick={() => setFloatOpen(o => !o)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFloatOpen(o => !o) } }}>
            <div className="flex gap-2" onClick={e => e.stopPropagation()}>
              {GIZMO_MODES.map(({ mode: m, icon, title }) => (
                <button key={m} title={title}
                  aria-label={title}
                  onClick={() => setGizmoMode(g => g === m ? null : m)}
                  className={`vp-hud-btn--sm${gizmoMode === m ? ' vp-hud-btn--active' : ''}`}>
                  {icon}
                </button>
              ))}
            </div>
            <div className="flex-spacer" />
            <button
              title={modelSize ? 'Fit model to stock \u2014 auto-orient + scale (F)' : 'Load a model first'}
              disabled={!modelSize}
              onClick={e => { e.stopPropagation(); handleFitToStock() }}
              className="vp-fit-btn">
              {'\u229E'} Fit
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" title="Reset transform (\u21BA)" aria-label="Reset transform"
              onClick={e => { e.stopPropagation(); onUpdateJob(job.id, { transform: defaultTransform() }) }}>{'\u21BA'}</button>
            <span className="chevron-sm chevron-sm--spaced">{floatOpen ? '\u25BE' : '\u25B8'}</span>
          </div>

          {floatOpen && (
            <div className="vp-float-body">
              {(['position', 'rotation', 'scale'] as const).map(field => (
                <div key={field} className="vp-float-field">
                  <div className="vp-float-field-label">
                    {field === 'position' ? 'Position (mm)' : field === 'rotation' ? 'Rotation (\u00B0)' : 'Scale'}
                    {field === 'rotation' && (
                      <button className="btn btn-ghost btn-sm vp-float-reset-btn"
                        onClick={() => {
                          if (!job) return
                          onUpdateJob(job.id, { transform: { ...job.transform, rotation: { x: 0, y: 0, z: 0 } } })
                        }}>Reset</button>
                    )}
                  </div>
                  <div className="xyz-grid">
                    {axes.map(ax => (
                      <ScrubInput
                        key={ax}
                        label={ax.toUpperCase()}
                        value={+(job.transform[field][ax] as number).toFixed(field === 'scale' ? 3 : 2)}
                        step={field === 'scale' ? 0.01 : field === 'rotation' ? 1 : 0.1}
                        color={AX_COLORS[ax]}
                        suffix={field === 'rotation' ? '\u00B0' : undefined}
                        onChange={v => setField(field, ax, v)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

// ── Command palette ────────────────────────────────────────────────────────────
interface Command { id: string; group: string; label: string; icon: string; action: () => void }

function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }): React.ReactElement {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(c => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q))
  }, [query, commands])
  useEffect(() => { setActiveIdx(0) }, [filtered.length])

  const groups = useMemo(() => {
    const map = new Map<string, Command[]>()
    for (const c of filtered) { const a = map.get(c.group) ?? []; a.push(c); map.set(c.group, a) }
    return map
  }, [filtered])

  const handleKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter')     { filtered[activeIdx]?.action(); onClose() }
    if (e.key === 'Escape')    onClose()
  }
  const hl = (text: string, q: string): React.ReactNode => {
    if (!q.trim()) return text
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx < 0) return text
    return <>{text.slice(0, idx)}<mark className="cmd-highlight">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>
  }
  let gi = 0
  return (
    <div className="cmd-overlay" role="dialog" aria-modal="true" aria-label="Command palette" onClick={onClose}>
      <div className="cmd-box" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-row">
          <span className="cmd-icon" aria-hidden="true">{'\u2318'}</span>
          <input ref={inputRef} className="cmd-input" placeholder="Type a command\u2026"
            aria-label="Search commands"
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-autocomplete="list"
            aria-controls="cmd-results-list"
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKey} />
          <kbd className="cmd-esc-hint" aria-hidden="true">Esc</kbd>
        </div>
        <div className="cmd-results" id="cmd-results-list" role="listbox">
          {filtered.length === 0 && <div className="text-muted cmd-empty">No commands match</div>}
          {Array.from(groups.entries()).map(([group, cmds]) => (
            <Fragment key={group}>
              <div className="cmd-group-label" role="presentation">{group}</div>
              {cmds.map(cmd => {
                const myIdx = gi++
                return (
                  <div key={cmd.id}
                    role="option"
                    aria-selected={myIdx === activeIdx}
                    className={`cmd-item${myIdx === activeIdx ? ' cmd-item--active' : ''}`}
                    onMouseEnter={() => setActiveIdx(myIdx)}
                    onClick={() => { cmd.action(); onClose() }}>
                    <span className="cmd-item-icon" aria-hidden="true">{cmd.icon}</span>
                    <span className="cmd-item-label">{hl(cmd.label, query)}</span>
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Keyboard Shortcuts Reference Dialog ──────────────────────────────────────
function KeyboardShortcutsDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const trapRef = useFocusTrap<HTMLDivElement>()
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={onClose}>
      <div ref={trapRef} className="modal-dialog modal-dialog--md shortcuts-dialog" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span id="shortcuts-title" className="modal-title">Keyboard Shortcuts</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Close">{'\u2715'}</button>
        </div>
        <div className="modal-body shortcuts-dialog__body">
          {APP_KEYBOARD_SHORTCUT_GROUPS.map(group => (
            <section key={group.id} className="shortcuts-group">
              <h3 className="shortcuts-group__title">{group.title}</h3>
              <table className="shortcuts-table">
                <tbody>
                  {group.rows.map((row, i) => (
                    <tr key={i} className="shortcuts-table__row">
                      <td className="shortcuts-table__action">{row.action}</td>
                      <td className="shortcuts-table__keys">
                        <kbd className="shortcuts-kbd">{row.keysWin}</kbd>
                      </td>
                      {row.context && (
                        <td className="shortcuts-table__context">{row.context}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function ShopApp(): React.ReactElement {
  return (
    <AppProviders>
      <ShopAppInner />
    </AppProviders>
  )
}

function ShopAppInner(): React.ReactElement {
  const {
    phase, setPhase,
    sessionMachine, setSessionMachine,
    machines,
    materials,
    machineTools,
    lastMachineId, setLastMachineId,
    reloadMachines,
    loadToolsForMachine,
  } = useMachineSession()
  const [jobs, setJobs] = useState<Job[]>([])
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [gcodeViewerPath, setGcodeViewerPath] = useState<string | null>(null)
  const [gcodeViewerText, setGcodeViewerText] = useState('')
  const [gcodeViewerLoading, setGcodeViewerLoading] = useState(false)
  const [modelSize, setModelSize] = useState<{ x: number; y: number; z: number } | null>(null)
  const [splashLibOpen, setSplashLibOpen] = useState(false)
  // New slide-over drawers (replace the old library/settings tab views)
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false)
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false)
  const { pushToast } = useToast()
  const {
    view, setView,
    cmdOpen, setCmdOpen,
    showShortcuts, setShowShortcuts,
    helpOpen, setHelpOpen,
    showOnboarding, setShowOnboarding,
    logOpen, setLogOpen,
    gcodeViewerOpen, setGcodeViewerOpen,
    leftPanelWidth, setLeftPanelWidth,
    savedIndicator, setSavedIndicator,
  } = useUI()
  const [gcodeGeneration, setGcodeGeneration] = useState(0)
  const [lastGenMs, setLastGenMs] = useState<number | null>(null)
  const splitterDragRef = useRef<{ startX: number; startW: number } | null>(null)

  const { execute: undoExec } = useUndo()

  // Set onboarding on first mount
  useEffect(() => { if (shouldShowOnboarding()) setShowOnboarding(true) }, [])

  const activeJob = useMemo(() => jobs.find(j => j.id === activeJobId) ?? null, [jobs, activeJobId])
  const mode: MachineUIMode = sessionMachine ? getMachineMode(sessionMachine) : 'cnc_2d'
  const isFdm = mode === 'fdm'

  /** The environment that owns the active session machine, or null at the splash phase. */
  const activeEnv = useMemo(
    () => getEnvironmentForMachine(sessionMachine?.id ?? null),
    [sessionMachine?.id]
  )

  // ── Per-environment jobs storage ──────────────────────────────────────────
  // Load jobs whenever the environment changes (which happens on machine pick).
  // Migrates from the legacy `fab-jobs-v1` bucket on first load and stamps
  // every restored job with `environmentId`.
  const lastLoadedEnvIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeEnv) return
    if (lastLoadedEnvIdRef.current === activeEnv.id) return
    lastLoadedEnvIdRef.current = activeEnv.id
    try {
      const result = loadEnvJobs(activeEnv, localStorage)
      if (result.jobs.length === 0) {
        setJobs([])
        setActiveJobId(null)
        return
      }
      const migrated: Job[] = result.jobs.map((j) => ({
        ...newJob(j.name ?? 'Job', j.machineId ?? undefined),
        ...j,
        transform: j.transform ?? defaultTransform(),
        stock: j.stock ?? { x: 100, y: 100, z: 20 },
        operations: Array.isArray(j.operations) ? j.operations : [],
        posts: j.posts
          ? { count: j.posts.count ?? 1, diameterMm: j.posts.diameterMm ?? 6, offsetRadiusMm: j.posts.offsetRadiusMm ?? 0 }
          : null,
        chuckDepthMm: (j.chuckDepthMm === 10 ? 10 : 5) as 5 | 10,
        clampOffsetMm: typeof j.clampOffsetMm === 'number' ? j.clampOffsetMm : 0,
        gcodeOut: j.gcodeOut ?? null,
        status: j.status ?? 'idle',
        lastLog: j.lastLog ?? '',
        printerUrl: j.printerUrl ?? '',
        environmentId: activeEnv.id
      }))
      setJobs(migrated)
      setActiveJobId(migrated[0]?.id ?? null)
      // Once every env has had a chance to migrate, clean up the legacy bucket.
      finalizeLegacyJobsMigration(localStorage)
    } catch {
      /* corrupt storage — ignore, fall through to empty list */
    }
  }, [activeEnv])

  // Persist jobs to the per-environment scoped key whenever they change.
  useEffect(() => {
    if (!activeEnv) return
    try { saveEnvJobs(activeEnv, jobs, localStorage) } catch { /* */ }
  }, [jobs, activeEnv])

  // Load tools whenever the active job's machine or session machine changes.
  // (Initial machine/material/settings load is handled by MachineSessionProvider.)
  useEffect(() => {
    void loadToolsForMachine(activeJob?.machineId ?? sessionMachine?.id ?? null)
  }, [activeJob?.machineId, sessionMachine?.id, loadToolsForMachine])

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (isTypableKeyboardTarget(e.target)) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(x => !x) }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveProjectFile() }
      if (matchesNewProject(e)) { e.preventDefault(); void newProject() }
      if (matchesOpenProject(e)) { e.preventDefault(); void loadProjectFile() }
      if (matchesKeyboardShortcutsReference(e)) { e.preventDefault(); setShowShortcuts(x => !x) }
      if (matchesGenerate(e) && view === 'jobs' && !running) { e.preventDefault(); void generate() }
      if (e.key === 'F1' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); setHelpOpen(x => !x) }
      if (e.key === 'Escape') {
        setCmdOpen(false)
        setGcodeViewerOpen(false)
        setShowShortcuts(false)
        setHelpOpen(false)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, activeJobId, view, running])

  const updateJob = useCallback((id: string, patch: Partial<Job>): void =>
    setJobs(js => js.map(j => j.id === id ? { ...j, ...patch } : j)), [])

  const createJob = useCallback((): void => {
    const machId = sessionMachine?.id ?? undefined
    const j = newJob('_', machId)
    setJobs(prev => [...prev, { ...j, name: `Job ${prev.length + 1}` }])
    setActiveJobId(j.id)
  }, [sessionMachine?.id])
  const deleteJob = (id: string): void => {
    const idx = jobs.findIndex(j => j.id === id)
    if (idx < 0) return
    const deletedJob = jobs[idx]
    undoExec(new DeleteItemCommand(
      {
        get: () => jobs,
        set: (js) => {
          setJobs(js)
          if (activeJobId === id) setActiveJobId(js.find(j => j.id !== id)?.id ?? null)
        },
      },
      idx,
      `Delete job "${deletedJob.name}"`,
    ))
  }
  const addOp = (kind: ManufactureOperationKind): void => {
    if (!activeJob) return
    const base = newOp(kind)
    const smartParams = applyMaterialToNewOpParams(base.params ?? {}, {
      materialId: activeJob.materialId,
      materials,
      tools: machineTools,
    })
    const op = smartParams !== base.params ? { ...base, params: smartParams } : base
    const jobId = activeJob.id
    undoExec(new AddItemCommand(
      {
        get: () => (jobs.find(j => j.id === jobId)?.operations ?? []),
        set: (ops) => setJobs(js => js.map(j => j.id === jobId ? { ...j, operations: ops } : j)),
      },
      op,
      `Add ${KIND_LABELS[kind] ?? kind}`,
    ))
  }
  const removeOp = useCallback((opId: string): void => {
    if (!activeJob) return
    const ops = activeJob.operations
    const idx = ops.findIndex(o => o.id === opId)
    if (idx < 0) return
    const jobId = activeJob.id
    undoExec(new DeleteItemCommand(
      {
        get: () => (jobs.find(j => j.id === jobId)?.operations ?? []),
        set: (newOps) => setJobs(js => js.map(j => j.id === jobId ? { ...j, operations: newOps, gcodeOut: null, status: 'idle' } : j)),
      },
      idx,
      `Remove ${ops[idx].label}`,
    ))
  }, [activeJob, jobs, undoExec])
  const updateOpParams = useCallback((opId: string, params: Record<string, unknown>): void => {
    if (!activeJob) return
    const op = activeJob.operations.find(o => o.id === opId)
    if (!op) return
    const jobId = activeJob.id
    const oldParams = { ...(op.params ?? {}) } as Record<string, unknown>
    undoExec(new PropertyEditCommand(
      {
        get: () => {
          const j = jobs.find(j2 => j2.id === jobId)
          const o = j?.operations.find(o2 => o2.id === opId)
          return (o?.params ?? {}) as Record<string, unknown>
        },
        set: (p) => setJobs(js => js.map(j => j.id === jobId
          ? { ...j, operations: j.operations.map(o => o.id === opId ? { ...o, params: p } : o) }
          : j)),
      },
      oldParams,
      params,
      `Edit ${op.label} params`,
      `op-params-${opId}`,
    ))
  }, [activeJob, jobs, undoExec])
  const applyMaterial = (): void => {
    if (!activeJob?.materialId) { pushToast('warn', 'No material selected'); return }
    const mat = materials.find(m => m.id === activeJob.materialId)
    if (!mat) { pushToast('warn', 'Selected material not found in library'); return }
    const applied = applyMaterialToOperations(
      activeJob.operations,
      activeJob.materialId,
      materials,
      machineTools,
      activeJob.stock
    )
    if (applied.changed) {
      updateJob(activeJob.id, { operations: applied.operations })
    }
    pushToast('ok', `Applied ${mat.name} to ${applied.operations.filter(o => o.kind.startsWith('cnc_')).length} op(s)`)
  }

  // Re-apply material cut params when the selected material changes.
  // Depend only on materialId (not the full activeJob) to avoid re-firing
  // when this very effect updates operations.
  const activeJobMaterialId = activeJob?.materialId ?? null
  const activeJobIdStable = activeJob?.id ?? null
  useEffect(() => {
    if (!activeJobMaterialId || !activeJobIdStable) return
    // Read current job state from the latest jobs array to get fresh operations
    setJobs(prevJobs => {
      const job = prevJobs.find(j => j.id === activeJobIdStable)
      if (!job || job.operations.length === 0) return prevJobs
      const applied = applyMaterialToOperations(
        job.operations,
        activeJobMaterialId,
        materials,
        machineTools,
        job.stock
      )
      if (!applied.changed) return prevJobs
      return prevJobs.map(j => j.id === activeJobIdStable ? { ...j, operations: applied.operations } : j)
    })
  }, [activeJobMaterialId, activeJobIdStable, materials, machineTools])

  // ── Remove model from the active job ─────────────────────────────────────────
  const [showRemoveModelConfirm, setShowRemoveModelConfirm] = useState(false)

  const doRemoveModel = useCallback((): void => {
    if (!activeJob) return
    setShowRemoveModelConfirm(false)
    updateJob(activeJob.id, { stlPath: null, gcodeOut: null, status: 'idle' })
    setModelSize(null)
    pushToast('ok', 'Model removed from job')
  }, [activeJob, updateJob, pushToast, setModelSize])

  const removeModel = useCallback((): void => {
    if (!activeJob) return
    if (activeJob.operations.length > 0) {
      setShowRemoveModelConfirm(true)
      return
    }
    doRemoveModel()
  }, [activeJob, doRemoveModel])

  // ── Import model into the active job ─────────────────────────────────────────
  const importModel = useCallback(async (): Promise<void> => {
    if (!activeJob) { pushToast('warn', 'Create or select a job first'); return }
    const p = await fab().dialogOpenFile([
      { name: 'CAD Models', extensions: ['stl', 'dxf', 'step', 'stp', 'iges', 'igs', 'obj', '3mf'] }
    ])
    if (!p) return
    if (p.toLowerCase().endsWith('.dxf')) {
      try {
        const result = await fab().dxfImport(p)
        if (!result.ok) { pushToast('err', `DXF import failed: ${result.error}`); return }
        const warnCount = result.warnings.length
        pushToast('ok', `DXF imported: ${result.entities.length} entities, ${result.layers.length} layer(s), units: ${result.units}${warnCount > 0 ? ` (${warnCount} warning${warnCount > 1 ? 's' : ''})` : ''}`)
      } catch (e) { pushToast('err', `DXF import error: ${e instanceof Error ? e.message : String(e)}`) }
      return
    }
    try {
      const staged = await fab().stlStage('default', p)
      updateJob(activeJob.id, { stlPath: staged })
    } catch {
      updateJob(activeJob.id, { stlPath: p })
    }
    pushToast('ok', `Model loaded: ${p.split(/[\\/]/).pop() ?? p}`)
  }, [activeJob, updateJob, pushToast])

  // ── Save project ──────────────────────────────────────────────────────────────
  const saveProjectFile = async (): Promise<void> => {
    const payload = JSON.stringify({ version: 1, jobs, activeJobId }, null, 2)
    const p = await fab().dialogSaveFile(
      [{ name: 'Fab Session', extensions: ['fabsession'] }, { name: 'JSON', extensions: ['json'] }],
      'session.fabsession'
    )
    if (!p) return
    await fab().fsWriteText(p, payload)
    setSavedIndicator(true)
    setTimeout(() => setSavedIndicator(false), 2000)
    pushToast('ok', `Saved to ${p.split(/[\\/]/).pop()}`)
  }

  // ── New project -- reset all state ───────────────────────────────────────────
  const [projectDirty, setProjectDirty] = useState(false)
  useEffect(() => {
    // Track dirtiness: any time jobs change after initial load, mark dirty
    if (jobs.length > 0) setProjectDirty(true)
  }, [jobs])

  const [showNewProjectConfirm, setShowNewProjectConfirm] = useState(false)

  const doNewProject = useCallback(async (saveBefore: boolean): Promise<void> => {
    setShowNewProjectConfirm(false)
    if (saveBefore) await saveProjectFile()
    setJobs([])
    setActiveJobId(null)
    setModelSize(null)
    setLog([])
    setGcodeViewerOpen(false)
    setGcodeViewerPath(null)
    setGcodeViewerText('')
    setProjectDirty(false)
    if (activeEnv) {
      try { saveEnvJobs(activeEnv, [], localStorage) } catch { /* */ }
    }
    pushToast('ok', 'New project started')
  }, [pushToast, activeEnv])

  const newProject = useCallback((): void => {
    if (projectDirty && jobs.length > 0) {
      setShowNewProjectConfirm(true)
      return
    }
    void doNewProject(false)
  }, [projectDirty, jobs.length, doNewProject])

  const loadProjectFile = async (): Promise<void> => {
    const p = await fab().dialogOpenFile(
      [{ name: 'Fab Session', extensions: ['fabsession', 'json'] }]
    )
    if (!p) return
    try {
      const raw = await fab().fsReadBase64(p)
      const text = atob(raw)
      const { jobs: loadedJobs, activeJobId: loadedActiveId } = JSON.parse(text) as { version: number; jobs: Job[]; activeJobId: string | null }
      if (!Array.isArray(loadedJobs)) throw new Error('Invalid session file')
      setJobs(loadedJobs)
      setActiveJobId(loadedJobs.find(j => j.id === loadedActiveId)?.id ?? loadedJobs[0]?.id ?? null)
      pushToast('ok', `Loaded ${loadedJobs.length} job(s)`)
    } catch (e) { pushToast('err', formatErrorForToast(e instanceof Error ? e.message : String(e), 'Load failed')) }
  }

  const generate = async (): Promise<void> => {
    if (!activeJob?.stlPath || !activeJob.machineId || activeJob.operations.length === 0) {
      pushToast('warn', 'Need a model, machine, and at least one operation'); return
    }
    const jobId = activeJob.id
    const materialApplied = applyMaterialToOperations(
      activeJob.operations,
      activeJob.materialId,
      materials,
      machineTools,
      activeJob.stock
    )
    const runOps = materialApplied.operations
    if (materialApplied.changed) {
      updateJob(jobId, { operations: runOps })
    }
    const genStartMs = Date.now()
    setRunning(true); setLog([]); setLogOpen(true)
    updateJob(jobId, { status: 'running', gcodeOut: null })
    let allOk = true
    try {
      const s = await fab().settingsGet()
      const pythonPath = String(s.pythonPath || 'python')
      const outPath = activeJob.stlPath.replace(/\.stl$/i, '.gcode')
      let camStlPath = activeJob.stlPath
      try {
        camStlPath = await fab().stlTransformForCam({
          stlPath: activeJob.stlPath,
          transform: activeJob.transform
        })
      } catch (e) {
        setLog((l) => [...l, `Transform-for-CAM failed; using raw STL: ${String(e)}`])
      }
      for (const op of runOps) {
        const p = (op.params ?? {}) as Record<string, unknown>
        const cut = resolveCamCutParamsWithMaterial({
          operation: op,
          materialId: activeJob.materialId,
          materials,
          tools: machineTools,
          setup: shopJobStockAsCamSetup(activeJob.stock)
        })
        const toolDiameterMm =
          typeof p.toolDiameterMm === 'number' && Number.isFinite(p.toolDiameterMm) && p.toolDiameterMm > 0
            ? p.toolDiameterMm
            : 6
        const needs4axis = op.kind === 'cnc_4axis_roughing' || op.kind === 'cnc_4axis_finishing' || op.kind === 'cnc_4axis_contour' || op.kind === 'cnc_4axis_indexed'
        const materialTag = activeJob.materialId
          ? materials.find((m) => m.id === activeJob.materialId)?.name ?? activeJob.materialId
          : 'default'
        setLog((l) => [
          ...l,
          `Running ${op.label}\u2026${needs4axis ? ` (Python: ${pythonPath})` : ''} [mat=${materialTag}; F=${Math.round(cut.feedMmMin)}; P=${Math.round(cut.plungeMmMin)}]`
        ])
        let priorPostedGcode: string | undefined
        if (p['usePriorPostedGcodeRest'] === true) {
          try {
            priorPostedGcode = await fab().readTextFile(outPath)
          } catch {
            priorPostedGcode = undefined
          }
        }
        try {
          const r = await fab().camRun({
            stlPath: camStlPath, outPath, machineId: activeJob.machineId!,
            zPassMm: cut.zPassMm,
            stepoverMm: cut.stepoverMm,
            feedMmMin: cut.feedMmMin,
            plungeMmMin: cut.plungeMmMin,
            safeZMm: cut.safeZMm ?? CAM_CUT_DEFAULTS.safeZMm,
            pythonPath,
            operationKind: op.kind,
            toolDiameterMm,
            operationParams: p,
            rotaryStockLengthMm: activeJob.stock.x,
            rotaryStockDiameterMm: activeJob.stock.y,
            rotaryChuckDepthMm: activeJob.chuckDepthMm,
            rotaryClampOffsetMm: activeJob.clampOffsetMm ?? 0,
            stockBoxZMm: activeJob.stock.z,
            stockBoxXMm: activeJob.stock.x,
            stockBoxYMm: activeJob.stock.y,
            ...(needs4axis ? { useMeshMachinableXClamp: p['useMeshMachinableXClamp'] === true } : {}),
            ...(priorPostedGcode?.trim() ? { priorPostedGcode } : {})
          })
          if (r.ok) {
            const hintLine = r.hint ? `\n    ${r.hint}` : ''
            const warnLine = r.warnings?.length ? `\n    \u26A0 ${r.warnings.join('; ')}` : ''
            setLog((l) => [...l, `  \u2713 ${op.label} \u2014 ${r.usedEngine ?? 'builtin'}${hintLine}${warnLine}`])
            if (r.warnings?.length) pushToast('warn', r.warnings.join('; '))
            if (r.gcode) updateJob(jobId, { gcodeOut: outPath })
          }
          else { setLog(l => [...l, `  \u2715 ${op.label}: ${r.error}${r.hint ? `\nHint: ${r.hint}` : ''}`]); allOk = false }
        } catch (e) { setLog(l => [...l, `  \u2715 ${op.label}: ${String(e)}`]); allOk = false }
      }
      updateJob(jobId, { status: allOk ? 'done' : 'error' })
      if (allOk) setGcodeGeneration(n => n + 1)
      pushToast(
        allOk ? 'ok' : 'err',
        allOk
          ? `G-code: ${outPath.split(/[/\\]/).pop() ?? outPath} (toolbar: G-code / Export\u2026 / Open file)`
          : 'Some operations failed'
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLog(l => [...l, `Generate failed: ${msg}`])
      updateJob(jobId, { status: 'error' })
      pushToast('err', formatErrorForToast(msg, 'Generate failed'))
    } finally {
      setLastGenMs(Date.now() - genStartMs)
      setRunning(false)
    }
  }

  const sendToPrinter = async (): Promise<void> => {
    if (!activeJob?.gcodeOut) { pushToast('warn', 'Generate G-code first'); return }
    if (!activeJob.printerUrl) { pushToast('warn', 'Enter printer URL'); return }
    try {
      const r = await fab().moonrakerPush({ gcodePath: activeJob.gcodeOut, printerUrl: activeJob.printerUrl, startAfterUpload: true })
      r.ok ? pushToast('ok', `Sent: ${r.filename}`) : pushToast('err', formatErrorForToast(r.error ?? 'Send failed', 'Send to printer'))
    } catch (e) { pushToast('err', friendlyError(e, 'Send failed')) }
  }

  const openGcodeViewer = async (): Promise<void> => {
    if (!activeJob?.gcodeOut) {
      pushToast('warn', 'Generate G-code first (output is saved next to your STL as .gcode)')
      return
    }
    setGcodeViewerOpen(true)
    setGcodeViewerPath(activeJob.gcodeOut)
    setGcodeViewerLoading(true)
    setGcodeViewerText('')
    try {
      const text = await fab().readTextFile(activeJob.gcodeOut)
      setGcodeViewerText(text)
    } catch (e) {
      setGcodeViewerText(`(${formatErrorForToast(e instanceof Error ? e.message : String(e), 'Could not read file')})`)
    } finally {
      setGcodeViewerLoading(false)
    }
  }

  const exportGcodeCopy = async (): Promise<void> => {
    if (!activeJob?.gcodeOut) {
      pushToast('warn', 'Generate G-code first')
      return
    }
    try {
      const text = await fab().readTextFile(activeJob.gcodeOut)
      const base = activeJob.gcodeOut.replace(/^.*[/\\]/, '') || 'output.gcode'
      const savePath = await fab().dialogSaveFile(
        [
          { name: 'G-code', extensions: ['gcode', 'nc', 'ngc', 'tap', 'txt'] },
          { name: 'All', extensions: ['*'] }
        ],
        base
      )
      if (savePath) {
        await fab().fsWriteText(savePath, text)
        pushToast('ok', `Saved ${savePath.split(/[/\\]/).pop() ?? savePath}`)
      }
    } catch (e) {
      pushToast('err', formatErrorForToast(e instanceof Error ? e.message : String(e), 'Export failed'))
    }
  }

  const openGcodeInSystemApp = async (): Promise<void> => {
    if (!activeJob?.gcodeOut) {
      pushToast('warn', 'Generate G-code first')
      return
    }
    try {
      await fab().shellOpenPath(activeJob.gcodeOut)
    } catch (e) {
      pushToast('err', formatErrorForToast(e instanceof Error ? e.message : String(e), 'Open file failed'))
    }
  }

  const copyGcodePath = async (pathOverride?: string | null): Promise<void> => {
    const p = (pathOverride ?? activeJob?.gcodeOut)?.trim()
    if (!p) {
      pushToast('warn', 'No G-code path')
      return
    }
    try {
      await navigator.clipboard.writeText(p)
      pushToast('ok', 'File path copied to clipboard')
    } catch {
      pushToast('err', 'Clipboard not available')
    }
  }

  const openSetupSheet = async (): Promise<void> => {
    if (!activeJob) { pushToast('warn', 'No active job'); return }
    try {
      let gcodeStats = null
      let gcodeText: string | null = null
      if (activeJob.gcodeOut) {
        try {
          const b64 = await fab().fsReadBase64(activeJob.gcodeOut)
          const text = decodeURIComponent(escape(atob(b64)))
          gcodeText = text
          gcodeStats = parseGcodeStats(text)
        } catch { /* gcode not readable -- skip stats */ }
      }
      const machineMode = sessionMachine ? getMachineMode(sessionMachine) : null
      const sheetJob: SetupSheetJob = {
        name: activeJob.name,
        stlPath: activeJob.stlPath,
        machineId: activeJob.machineId,
        materialId: activeJob.materialId,
        stock: activeJob.stock,
        rotarySetup:
          machineMode === 'cnc_4axis' || machineMode === 'cnc_5axis'
            ? {
                cylinderDiameterMm: activeJob.stock.y,
                cylinderLengthMm: activeJob.stock.x,
                chuckDepthMm: activeJob.chuckDepthMm,
                clampOffsetMm: activeJob.clampOffsetMm ?? 0
              }
            : undefined,
        operations: activeJob.operations.map(op => ({
          id: op.id, kind: op.kind, label: op.label,
          params: (op.params ?? {}) as Record<string, unknown>
        })),
        gcodeOut: activeJob.gcodeOut
      }
      const mat = materials.find(m => m.id === activeJob.materialId) ?? null
      const html = generateSetupSheet({
        job: sheetJob,
        machine: sessionMachine,
        material: mat,
        tools: machineTools,
        gcodeStats,
        gcodeText
      })
      const basePath = activeJob.gcodeOut ?? activeJob.stlPath
      const dir = basePath ? basePath.replace(/[/\\][^/\\]*$/, '') : null
      const fileName = `${activeJob.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_setup_sheet.html`
      const outPath = dir ? `${dir}/${fileName}` : null
      if (outPath) {
        await fab().fsWriteText(outPath, html)
        await fab().shellOpenPath(outPath)
        pushToast('ok', `Setup sheet opened: ${fileName}`)
      } else {
        const savePath = await fab().dialogSaveFile(
          [{ name: 'HTML', extensions: ['html'] }], fileName
        )
        if (savePath) {
          await fab().fsWriteText(savePath, html)
          await fab().shellOpenPath(savePath)
          pushToast('ok', `Setup sheet saved`)
        }
      }
    } catch (e) { pushToast('err', formatErrorForToast(e instanceof Error ? e.message : String(e), 'Setup sheet failed')) }
  }

  const handleMachineSelect = async (m: MachineProfile): Promise<void> => {
    setSessionMachine(m); setLastMachineId(m.id); setPhase('app')
    try { await fab().settingsSet({ lastMachineId: m.id }) } catch { /* */ }
  }

  const commands = useMemo((): Command[] => {
    const c: Command[] = []
    c.push({ id: 'new_project', group: 'File', label: 'New Project (Ctrl+N)', icon: '\u{1F4C4}', action: () => void newProject() })
    c.push({ id: 'new_job', group: 'Jobs', label: 'New Job', icon: '\u{1F527}', action: createJob })
    c.push({ id: 'change_machine', group: 'Session', label: 'Change machine', icon: '\u{1F5A5}', action: () => setPhase('splash') })
    if (activeJob) {
      c.push({ id: 'import_model', group: 'Jobs', label: 'Import Model\u2026', icon: '\u{1F4C2}', action: () => void importModel() })
      if (activeJob.stlPath) {
        c.push({ id: 'remove_model', group: 'Jobs', label: 'Remove Model from Job', icon: '\u{1F5D1}', action: removeModel })
      }
      c.push({ id: 'browse_stl', group: 'Jobs', label: 'Load Model (STL/DXF)\u2026', icon: '\u{1F4C4}', action: async () => {
        const p = await fab().dialogOpenFile([{ name: 'CAD Models', extensions: ['stl', 'dxf'] }])
        if (!p) return
        if (p.toLowerCase().endsWith('.dxf')) {
          try {
            const result = await fab().dxfImport(p)
            if (!result.ok) { pushToast('err', `DXF import failed: ${result.error}`); return }
            const warnCount = result.warnings.length
            pushToast('ok', `DXF imported: ${result.entities.length} entities, ${result.layers.length} layer(s), units: ${result.units}${warnCount > 0 ? ` (${warnCount} warning${warnCount > 1 ? 's' : ''})` : ''}`)
          } catch (e) { pushToast('err', `DXF import error: ${e instanceof Error ? e.message : String(e)}`) }
          return
        }
        updateJob(activeJob.id, { stlPath: p })
      }})
      c.push({ id: 'generate', group: 'Jobs', label: isFdm ? 'Slice' : 'Generate G-code', icon: '\u25B6', action: generate })
      if (activeJob.gcodeOut) c.push({ id: 'send', group: 'Jobs', label: 'Send to Printer', icon: '\u2192', action: sendToPrinter })
      if (activeJob.gcodeOut) {
        c.push({ id: 'gcode_view', group: 'Jobs', label: 'View G-code', icon: '\u{1F4C4}', action: openGcodeViewer })
        c.push({ id: 'gcode_export', group: 'Jobs', label: 'Export G-code\u2026', icon: '\u{1F4BE}', action: exportGcodeCopy })
        c.push({ id: 'gcode_open_ext', group: 'Jobs', label: 'Open G-code in default app', icon: '\u2197', action: openGcodeInSystemApp })
        c.push({ id: 'gcode_copy_path', group: 'Jobs', label: 'Copy G-code file path', icon: '\u{1F4CB}', action: copyGcodePath })
      }
      if (!isFdm) c.push({ id: 'apply_mat', group: 'Jobs', label: 'Apply Material Cut Params \u26A1', icon: '\u{1F9F1}', action: applyMaterial })
      if (!isFdm) c.push({ id: 'setup_sheet', group: 'Jobs', label: 'Generate Setup Sheet \u{1F4CB}', icon: '\u{1F4CB}', action: openSetupSheet })
      const { primary, secondary } = OPS_BY_MODE[mode]
      ;[...primary, ...secondary].forEach(k =>
        c.push({ id: `add_op_${k}`, group: 'Add Operation', label: KIND_LABELS[k] ?? k, icon: '\u{1F529}', action: () => addOp(k) })
      )
    }
    machines.forEach(m => c.push({ id: `set_machine_${m.id}`, group: 'Machines', label: `Set machine: ${m.name}`, icon: '\u{1F5A5}', action: () => { if (activeJob) updateJob(activeJob.id, { machineId: m.id }) } }))
    materials.forEach(m => c.push({ id: `set_mat_${m.id}`, group: 'Materials', label: `Set material: ${m.name}`, icon: '\u{1F9F1}', action: () => { if (activeJob) updateJob(activeJob.id, { materialId: m.id }) } }))
    c.push({ id: 'library', group: 'Navigate', label: 'Open Library', icon: '\u{1F4E6}', action: () => setLibraryDrawerOpen(true) })
    c.push({ id: 'settings', group: 'Navigate', label: 'Open Settings', icon: '\u2699', action: () => setSettingsDrawerOpen(true) })
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, machines, materials, jobs.length, mode, isFdm])

  const stockField = (ax: 'x' | 'y' | 'z'): React.ReactElement => (
    <input key={ax} type="number" step="1" min="1" className="tb-stock-input"
      title={`Stock ${ax.toUpperCase()} (mm)`} aria-label={`Stock ${ax.toUpperCase()} (mm)`}
      value={activeJob?.stock[ax] ?? ''} disabled={!activeJob}
      onChange={e => activeJob && updateJob(activeJob.id, { stock: { ...activeJob.stock, [ax]: +e.target.value } })} />
  )

  // ── Splash ──
  if (phase === 'splash') {
    return (
      <>
        {!splashLibOpen && (
          <EnvironmentSplash
            machines={machines}
            lastMachineId={lastMachineId}
            onSelect={(_env, machine) => { void handleMachineSelect(machine) }}
            onAddMachine={() => setSplashLibOpen(true)}
          />
        )}
        {splashLibOpen && (
          <div className="machine-lib-overlay">
            <div className="machine-lib-overlay__header">
              <span className="machine-lib-overlay__title">Machine Library</span>
              <div className="flex-spacer" />
              <button className="btn btn-ghost btn-sm" onClick={async () => {
                await reloadMachines()
                setSplashLibOpen(false)
              }}>{'\u2190'} Back to environment picker</button>
            </div>
            <div className="machine-lib-overlay__body">
              <Suspense fallback={<div className="text-muted p-16">Loading library{'\u2026'}</div>}>
                <LibraryView onToast={pushToast} onMachinesChanged={reloadMachines} />
              </Suspense>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── Main app ──
  return (
    <div className="shop-shell" data-environment={activeEnv?.id ?? undefined}>
      {/* Brand header bar (top-most strip) */}
      <header className="shop-brand-bar" role="banner">
        <div className="shop-brand-bar__left">
          <span className="shop-brand-bar__logo" aria-hidden="true">
            {activeEnv?.iconGlyph ?? '\u25C6'}
          </span>
          <span className="shop-brand-bar__title">
            {activeEnv?.name ?? 'WorkTrackCAM'}
          </span>
          <span className="shop-brand-bar__sub">
            {activeEnv ? `WorkTrackCAM \u00B7 ${activeEnv.tagline}` : 'Professional CAM & FDM'}
          </span>
        </div>
        <div className="shop-brand-bar__center">
          <button
            type="button"
            className={`workspace-pill${view === 'jobs' ? ' workspace-pill--active' : ''}`}
            onClick={() => setView('jobs')}
            aria-current={view === 'jobs' ? 'page' : undefined}
          >
            {'\u{1F527}'} Manufacture
          </button>
        </div>
        <div className="shop-brand-bar__right">
          <button
            type="button"
            className="tb-btn"
            title="Tool & material library"
            aria-label="Open library"
            onClick={() => setLibraryDrawerOpen(true)}
          >
            {'\u{1F4DA}'}
          </button>
          <button
            type="button"
            className="tb-btn"
            title="Settings"
            aria-label="Open settings"
            onClick={() => setSettingsDrawerOpen(true)}
          >
            {'\u2699'}
          </button>
          <button
            type="button"
            className="tb-btn"
            title="Command palette (Ctrl+K)"
            aria-label="Command palette"
            onClick={() => setCmdOpen(true)}
          >
            {'\u2318'}
          </button>
          <button
            type="button"
            className="tb-btn"
            title="Keyboard shortcuts (Ctrl+Shift+?)"
            aria-label="Keyboard shortcuts"
            onClick={() => setShowShortcuts((x) => !x)}
          >
            ?
          </button>
        </div>
      </header>

      <div className="shop-toolbar" role="toolbar" aria-label="Main toolbar">
        <button className={`tb-machine-badge tb-machine-badge--${mode}`}
          title={`Current machine: ${sessionMachine?.name ?? 'None'} \u2014 Click to change`}
          onClick={() => setPhase('splash')}>
          {MODE_ICONS[mode]} {sessionMachine?.name ?? 'No machine'}
        </button>

        <div className="tb-sep" />

        {view === 'jobs' && (
          <input className="tb-job-name" placeholder="Job name\u2026" aria-label="Job name"
            value={activeJob?.name ?? ''} disabled={!activeJob}
            onChange={e => activeJob && updateJob(activeJob.id, { name: e.target.value })} />
        )}

        {view === 'jobs' && !isFdm && (
          <>
            <div className="tb-sep" />
            <select className="tb-select tb-select-sm" title="Material \u2014 sets feeds, speeds, and cut depths for all operations" aria-label="Material" value={activeJob?.materialId ?? ''} disabled={!activeJob}
              onChange={e => activeJob && updateJob(activeJob.id, { materialId: e.target.value || null })}>
              <option value="">{'\u2014'} material {'\u2014'}</option>
              {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="tb-btn" title="Apply material cut params to all operations (\u26A1)" aria-label="Apply material cut params" disabled={!activeJob?.materialId} onClick={applyMaterial}>{'\u26A1'}</button>
            <div className="tb-sep" />
            {(mode === 'cnc_4axis' || mode === 'cnc_5axis') && (
              <select className="tb-select tb-select-sm" title="Stock cross-section shape" aria-label="Stock profile"
                value={activeJob?.stockProfile ?? 'cylinder'} disabled={!activeJob}
                onChange={e => activeJob && updateJob(activeJob.id, { stockProfile: e.target.value as 'cylinder' | 'square' })}>
                <option value="cylinder">{'\u25CB'} Cylinder</option>
                <option value="square">{'\u25A1'} Square</option>
              </select>
            )}
            <div className="tb-xyz">
              <span className="tb-xyz-label">X</span>{stockField('x')}
              <span className="tb-xyz-label">{(mode === 'cnc_4axis' || mode === 'cnc_5axis') ? (activeJob?.stockProfile === 'square' ? 'Side' : '\u00D8') : 'Y'}</span>{stockField('y')}
              <span className="tb-xyz-label">Z</span>{stockField('z')}
              <span className="tb-xyz-unit">mm</span>
            </div>
          </>
        )}

        <div className="tb-spacer" />

        {activeJob && view === 'jobs' && (
          <span className="job-status-badge">
            <span className={`job-status-dot job-status-dot--${activeJob.status}`} />
            {activeJob.status}
          </span>
        )}

        {view === 'jobs' && (
          <>
            <button className="btn-generate" disabled={running || !activeJob} onClick={generate}
              title={isFdm ? 'Slice (F5 or Ctrl+Enter)' : 'Generate G-code (F5 or Ctrl+Enter)'}>
              {running ? <><span className="spinner spinner--sm mr-4 v-mid" /> Running{'\u2026'}</> : isFdm ? '\u25B6 Slice' : '\u25B6 Generate'}
            </button>
            <button className="btn-send" title="Send G-code to printer via Moonraker" disabled={!activeJob?.gcodeOut} onClick={sendToPrinter}>{'\u2192'} Send</button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={!activeJob?.gcodeOut}
              title={activeJob?.gcodeOut ? `View G-code\n${activeJob.gcodeOut}` : 'Generate G-code first'}
              onClick={() => void openGcodeViewer()}
            >
              G-code
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={!activeJob?.gcodeOut}
              title="Export G-code \u2014 save a copy to a different location"
              onClick={() => void exportGcodeCopy()}
            >
              Export{'\u2026'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              disabled={!activeJob?.gcodeOut}
              title="Open G-code file in your system's default editor"
              onClick={() => void openGcodeInSystemApp()}
            >
              Open file
            </button>
          </>
        )}

        <div className="tb-sep" />
        {view === 'jobs' && activeJob && !isFdm && (
          <button className="tb-btn" title="Generate Setup Sheet \u2014 creates an HTML reference with all job parameters" aria-label="Generate setup sheet" onClick={openSetupSheet}>{'\u{1F4CB}'}</button>
        )}
        {view === 'jobs' && (
          <button className="tb-btn" title="Import model \u2014 load an STL, DXF, STEP, IGES, OBJ, or 3MF file into the active job" aria-label="Import model" disabled={!activeJob} onClick={() => void importModel()}>{'\u{1F4E5}'}</button>
        )}
        <button className="tb-btn" title="New project (Ctrl+N)" aria-label="New project" onClick={() => void newProject()}>{'\u{1F4C4}'}</button>
        <button className="tb-btn" title="Open project file (Ctrl+O)" aria-label="Open project" onClick={loadProjectFile}>{'\u{1F4C2}'}</button>
        <button className={`tb-btn${savedIndicator ? ' tb-btn--saved' : ''}`} title="Save session to file (Ctrl+S)" aria-label="Save session" onClick={saveProjectFile}>
          {savedIndicator ? '\u2713' : '\u{1F4BE}'}
        </button>
        <button className={`tb-btn${helpOpen ? ' tb-btn--active' : ''}`} title="Help reference panel (F1)" aria-label="Help" onClick={() => setHelpOpen(x => !x)}>{'\u{2753}'}</button>
      </div>

      {view === 'jobs' ? (
        <div className="shop-workspace" style={{ '--left-w': `${leftPanelWidth}px` } as React.CSSProperties}>
          <ErrorBoundary label="Operations Panel" severity="panel">
            <LeftPanel
              jobs={jobs} activeJobId={activeJobId} setActiveJobId={setActiveJobId}
              createJob={createJob} deleteJob={deleteJob}
              activeJob={activeJob} mode={mode}
              activeEnv={activeEnv}
              envHeaderSlot={
                activeEnv ? (
                  <EnvActionStrip
                    env={activeEnv}
                    machines={machines}
                    sessionMachine={sessionMachine}
                    onSwitchMachine={(m) => {
                      setSessionMachine(m)
                      setLastMachineId(m.id)
                      void fab().settingsSet({ lastMachineId: m.id }).catch(() => { /* */ })
                    }}
                    materials={materials}
                    activeJob={activeJob}
                    onUpdateJob={updateJob}
                  />
                ) : undefined
              }
              onUpdateJob={updateJob} onAddOp={addOp}
              onRemoveOp={removeOp}
              onUpdateOpParams={updateOpParams}
              onImportModel={importModel}
              onRemoveModel={removeModel}
              machineTools={machineTools}
              materials={materials}
            />
          </ErrorBoundary>
          <button
            type="button"
            className="shell-resize-handle"
            aria-label="Resize left panel"
            onMouseDown={e => {
              e.preventDefault()
              splitterDragRef.current = { startX: e.clientX, startW: leftPanelWidth }
              const onMove = (me: MouseEvent): void => {
                if (!splitterDragRef.current) return
                const newW = splitterDragRef.current.startW + (me.clientX - splitterDragRef.current.startX)
                setLeftPanelWidth(newW)
              }
              const onUp = (): void => {
                splitterDragRef.current = null
                window.removeEventListener('mousemove', onMove)
                window.removeEventListener('mouseup', onUp)
              }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
          />
          <ErrorBoundary label="3D Viewport" severity="panel">
            <ViewportArea
              job={activeJob} mode={mode} onUpdateJob={updateJob} onToast={pushToast}
              modelSize={modelSize} setModelSize={setModelSize}
              gcodeGeneration={gcodeGeneration}
            />
          </ErrorBoundary>
        </div>
      ) : null}

      {/* Slide-over drawers (replace the old library/settings tab views) */}
      <LibraryDrawer
        open={libraryDrawerOpen}
        onClose={() => setLibraryDrawerOpen(false)}
        onToast={pushToast}
        onMachinesChanged={reloadMachines}
      />
      <SettingsDrawer
        open={settingsDrawerOpen}
        onClose={() => setSettingsDrawerOpen(false)}
        onToast={pushToast}
      />

      {gcodeViewerOpen && (
        <div
          className="shop-gcode-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-gcode-title"
          onClick={() => setGcodeViewerOpen(false)}
        >
          <div className="shop-gcode-sheet" onClick={(e) => e.stopPropagation()}>
            <ErrorBoundary label="G-code Viewer" severity="panel">
            <div className="shop-gcode-sheet-bar">
              <span id="shop-gcode-title" className="shop-gcode-title">
                G-code
              </span>
              {gcodeViewerPath ? (
                <span
                  className="shop-gcode-path"
                  title={gcodeViewerPath}
                >
                  {gcodeViewerPath}
                </span>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!gcodeViewerPath}
                onClick={() => void copyGcodePath(gcodeViewerPath)}
              >
                Copy path
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!activeJob?.gcodeOut}
                onClick={() => void exportGcodeCopy()}
              >
                Export{'\u2026'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setGcodeViewerOpen(false)} aria-label="Close">
                {'\u2715'}
              </button>
            </div>
            <div className="shop-gcode-sheet-body">
              {gcodeViewerLoading ? (
                <span className="shop-gcode-loading">Loading{'\u2026'}</span>
              ) : (
                <pre className="shop-gcode-pre" tabIndex={0}>
                  {gcodeViewerText || '(empty)'}
                </pre>
              )}
            </div>
            </ErrorBoundary>
          </div>
        </div>
      )}

      {logOpen && (
        <div className="shop-log" role="region" aria-label="Output log">
          <div className="shop-log-bar">
            <span className="shop-log-title">Output Log</span>
            {running && <span className="spinner spinner--sm ml-8" aria-label="Processing" />}
            <div className="flex-spacer" />
            <button className="btn btn-ghost btn-sm btn-icon" aria-label="Clear log" onClick={() => setLog([])}>Clear</button>
            <button className="btn btn-ghost btn-sm btn-icon" aria-label="Close log" onClick={() => setLogOpen(false)}>{'\u2715'}</button>
          </div>
          {running && <div className="progress-bar progress-bar--indeterminate" role="progressbar" aria-label="Generation in progress"><div className="progress-bar__fill" /></div>}
          <div className="shop-log-body" aria-live="polite">
            {log.map((l, i) => (
              <div key={i} className={`shop-log-line${l.includes('\u2715') ? ' log-line--error' : l.includes('\u2713') ? ' log-line--ok' : ''}`}>
                {l}
              </div>
            ))}
          </div>
        </div>
      )}

      {cmdOpen && (
        <ErrorBoundary label="Command Palette" severity="panel">
          <CommandPalette commands={commands} onClose={() => setCmdOpen(false)} />
        </ErrorBoundary>
      )}
      {showShortcuts && (
        <ErrorBoundary label="Keyboard Shortcuts" severity="panel">
          <KeyboardShortcutsDialog onClose={() => setShowShortcuts(false)} />
        </ErrorBoundary>
      )}

      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}

      {showOnboarding && <OnboardingOverlay onDismiss={() => setShowOnboarding(false)} />}

      <div className="app-status-bar app-status-bar--split" role="status" aria-live="polite">
        <span className="app-status-text">
          {running ? (
            <span className="status-warn"><span className="spinner spinner--sm mr-4 v-mid" /> Generating{'\u2026'}</span>
          ) : activeJob?.status === 'error' ? (
            <span className="status-err">{'\u2715'} Error {'\u2014'} check output log</span>
          ) : activeJob?.status === 'done' ? (
            <span className="status-ok">{'\u2713'} Ready</span>
          ) : (
            <span>Engine idle</span>
          )}
        </span>
        <span className="app-status-text">
          {activeJob ? `${activeJob.operations.length} op${activeJob.operations.length !== 1 ? 's' : ''}` : 'No job'}
          {sessionMachine ? ` \u00B7 ${sessionMachine.name}` : ''}
        </span>
        <span className="app-status-text">
          {lastGenMs !== null
            ? `Last gen: ${lastGenMs < 1000 ? `${lastGenMs}ms` : `${(lastGenMs / 1000).toFixed(1)}s`}`
            : 'F1 Help \u00B7 Ctrl+Shift+? Shortcuts \u00B7 Ctrl+K Commands'}
        </span>
      </div>

      {/* ── Confirm dialogs ────────────────────────────────────── */}
      <ConfirmDialog
        open={showRemoveModelConfirm}
        title="Remove Model"
        message={`This job has ${activeJob?.operations.length ?? 0} operation(s) that reference the model.\n\nRemove the model anyway?`}
        confirmLabel="Remove"
        danger
        onConfirm={doRemoveModel}
        onCancel={() => setShowRemoveModelConfirm(false)}
      />
      <ConfirmDialog
        open={showNewProjectConfirm}
        title="Unsaved Changes"
        message="Current project has unsaved changes."
        confirmLabel="Save & Continue"
        secondaryLabel="Don't Save"
        onSecondary={() => void doNewProject(false)}
        onConfirm={() => void doNewProject(true)}
        onCancel={() => setShowNewProjectConfirm(false)}
      />
    </div>
  )
}
