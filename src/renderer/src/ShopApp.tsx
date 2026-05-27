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
import MoonrakerPreviewBanner from './MoonrakerPreviewBanner'
import type { GcodeTempSample } from '../../shared/gcode-temp-validator'
import { ErrorBoundary } from './ErrorBoundary'
import { autoOrient } from '../../shared/auto-orient'
import { triangulateBinaryStl } from '../../shared/stl-binary-preview'
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
import { assessGcodeForExportSafety } from './gcode-export-safety'
import {
  buildMoonrakerPushPayload,
  formatMoonrakerPushFailure,
  splitMoonrakerPushFailureForToast
} from './moonraker-push-payload'

// ── Extracted components ──────────────────────────────────────────────────────
import { EnvironmentSplash } from './environments/EnvironmentSplash'
import { EnvActionStrip } from './environments/EnvActionStrip'
import { getEnvironmentForMachine } from './environments/env-routing'
import { resolveQuickSwitchMachine } from './environments/quick-switch'
import { ENVIRONMENT_LIST, isEnvironmentId, type EnvironmentId } from './environments/registry'
import {
  finalizeLegacyJobsMigration,
  loadEnvJobs,
  saveEnvJobs
} from './environments/env-jobs-storage'
import { LeftPanel } from './LeftPanel'
import { HelpPanel } from './HelpPanel'
import { OnboardingOverlay } from './OnboardingOverlay'
import { FirstLaunchWizard, wizardStarterOpKind, type FirstLaunchWizardCompletion } from './FirstLaunchWizard'
import { LibraryDrawer } from '../shell/LibraryDrawer'
import { SettingsDrawer } from '../shell/SettingsDrawer'
import { MyShopDrawer } from '../shell/MyShopDrawer'
import { NavRail, type NavSection } from './NavRail'
import { PropertyPanel } from './PropertyPanel'
import { OpSequencer } from './OpSequencer'
import { AppHeader } from './AppHeader'
import { AppStatusBar } from './AppStatusBar'
import type { MyShopPreset, MyShopMachineId } from './environments/my-shop-presets'
import { composePresetLaunchPlan } from './environments/preset-launch-plan'
import { ENVIRONMENTS } from './environments/registry'

// ── Context providers ────────────────────────────────────────────────────────
import { AppProviders, useToast, useUI, useMachineSession } from '../contexts'

// Lazy-loaded: LibraryView is used by the machine-splash overlay; SettingsView
// is loaded directly by the SettingsDrawer.
const LibraryView = lazy(() => import('./LibraryView').then(m => ({ default: m.LibraryView })))

// ── Shared types & utilities ──────────────────────────────────────────────────
import type { Toast, Job } from './shop-types'
import { fab, getMachineMode, MODE_LABELS, MODE_ICONS, OPS_BY_MODE, KIND_LABELS } from './shop-types'
import {
  formatMachineBadgeAriaLabel,
  formatMachineBadgeLabel,
  formatMachineBadgeTitle
} from './brand-bar-machine-badge'

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

  const [autoOrienting, setAutoOrienting] = useState(false)
  // Auto-orient (FDM): read the loaded STL, run pure-math autoOrient(), push the
  // result into the per-job transform.rotation. NO disk write, NO G-code emission
  // — only the in-memory Three.js transform changes (safety: G-code is sacred).
  const handleAutoOrient = useCallback(async (): Promise<void> => {
    if (!job?.stlPath) {
      onToast('warn', 'Load an STL first to auto-orient.')
      return
    }
    if (mode !== 'fdm') return
    setAutoOrienting(true)
    try {
      const b64 = await fab().fsReadBase64(job.stlPath)
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      // Triangulate up to 60K triangles for orientation scoring — bounds runtime
      // at well under the 100ms budget for typical FDM parts and keeps the UI snappy
      // on huge sculptures (>200K) too.
      const tri = triangulateBinaryStl(bytes, 60_000)
      if ('error' in tri) {
        onToast('err', `Auto-orient failed to read STL: ${tri.error}`)
        return
      }
      const r = autoOrient({ positions: tri.positions })
      const [rx, ry, rz] = r.rotationEulerDegXyz
      onUpdateJob(job.id, {
        transform: {
          ...job.transform,
          rotation: {
            x: +rx.toFixed(2),
            y: +ry.toFixed(2),
            z: +rz.toFixed(2)
          }
        }
      })
      onToast('ok', `Auto-orient applied (${r.candidatesEvaluated} candidates). ${r.reason}`)
    } catch (e) {
      onToast('err', `Auto-orient failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAutoOrienting(false)
    }
  }, [job, mode, onToast, onUpdateJob])

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
              ? <button type="button" className="btn btn-ghost btn--force-visible" onClick={browseModel}>Browse for Model{'\u2026'}</button>
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
          <button type="button"
            onClick={handleFitToStock}
            className="vp-warning-banner__btn">
            Auto-fit
          </button>
        </div>
      )}

      {mode !== 'fdm' && (
        <div className="vp-hud-group">
          {GIZMO_MODES.map(({ mode: m, icon, title }) => (
            <button type="button" key={m} title={title}
              aria-label={title}
              aria-pressed={gizmoMode === m}
              onClick={() => setGizmoMode(g => g === m ? null : m)}
              className={`vp-hud-btn${gizmoMode === m ? ' vp-hud-btn--active' : ''}`}>
              {icon}
            </button>
          ))}
          {gizmoMode && (
            <button type="button" title="No gizmo (Esc)"
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

      {mode === 'fdm' && job?.stlPath && (
        <div className="vp-hud-group" role="toolbar" aria-label="FDM viewport tools">
          <button
            type="button"
            title={autoOrienting ? 'Auto-orienting\u2026' : 'Auto-orient model for FDM (minimize overhang, maximize bed contact)'}
            aria-label="Auto-orient model"
            aria-busy={autoOrienting}
            disabled={autoOrienting}
            onClick={() => { void handleAutoOrient() }}
            className="vp-hud-btn"
          >
            <span aria-hidden="true">{autoOrienting ? '\u29D7' : '\u293E'}</span>
            {' '}Auto-orient
          </button>
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
                <button type="button" key={m} title={title}
                  aria-label={title}
                  onClick={() => setGizmoMode(g => g === m ? null : m)}
                  className={`vp-hud-btn--sm${gizmoMode === m ? ' vp-hud-btn--active' : ''}`}>
                  {icon}
                </button>
              ))}
            </div>
            <div className="flex-spacer" />
            <button type="button"
              title={modelSize ? 'Fit model to stock \u2014 auto-orient + scale (F)' : 'Load a model first'}
              disabled={!modelSize}
              onClick={e => { e.stopPropagation(); handleFitToStock() }}
              className="vp-fit-btn">
              {'\u229E'} Fit
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Reset transform (\u21BA)" aria-label="Reset transform"
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
                      <button type="button" className="btn btn-ghost btn-sm vp-float-reset-btn"
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
          <input type="text" ref={inputRef} className="cmd-input" placeholder="Type a command\u2026"
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
  const [myShopDrawerOpen, setMyShopDrawerOpen] = useState(false)
  // v2 Control Center layout state
  const [navSection, setNavSection] = useState<NavSection>('jobs')
  const [selectedOpId, setSelectedOpId] = useState<string | null>(null)
  const [propCollapsed, setPropCollapsed] = useState(false)
  const { pushToast } = useToast()
  const {
    view, setView,
    cmdOpen, setCmdOpen,
    showShortcuts, setShowShortcuts,
    helpOpen, setHelpOpen,
    showOnboarding, setShowOnboarding,
    showFirstLaunchWizard, setShowFirstLaunchWizard,
    logOpen, setLogOpen,
    gcodeViewerOpen, setGcodeViewerOpen,
    leftPanelWidth, setLeftPanelWidth,
    savedIndicator, setSavedIndicator,
  } = useUI()
  // Recent projects + projects root for the first-launch wizard. Both are
  // pulled fresh on mount; the wizard treats missing/empty arrays as no
  // recent projects (zero crashes when the MRU is authored by a parallel
  // agent and not yet shipped).
  const [recentProjectPaths, setRecentProjectPaths] = useState<readonly string[]>([])
  const [projectsRoot, setProjectsRoot] = useState<string | null>(null)
  const [gcodeGeneration, setGcodeGeneration] = useState(0)
  const [lastGenMs, setLastGenMs] = useState<number | null>(null)
  const [gcodeSafetyAckKey, setGcodeSafetyAckKey] = useState<string | null>(null)
  // [ID-0072-followup] Cycle 50 ui-polish: pre-flight Moonraker
  // temperature preview samples. Populated from
  // `MoonrakerPushResult.tempValidation.samples` after each push
  // attempt (which may also be a rejection); reset whenever the
  // active job's gcodeOut changes. Renders nothing for non-FDM jobs
  // and for jobs that have never produced validator output.
  const [moonrakerPreviewSamples, setMoonrakerPreviewSamples] = useState<
    readonly GcodeTempSample[] | undefined
  >(undefined)
  const splitterDragRef = useRef<{ startX: number; startW: number } | null>(null)

  // Recent-project MRU for the EnvironmentSplash. Persisted to
  // `appSettings.recentProjectPaths` (already in the schema; see
  // `src/shared/project-schema.ts`). Capped at 5 and de-duped by absolute
  // path on every push.
  const [recentProjects, setRecentProjects] = useState<readonly string[]>([])

  // Load existing recent-projects on first mount.
  useEffect(() => {
    void (async () => {
      try {
        const s = await fab().settingsGet()
        const arr = (s as { recentProjectPaths?: unknown }).recentProjectPaths
        if (Array.isArray(arr)) {
          const cleaned: string[] = []
          for (const p of arr) {
            if (typeof p === 'string' && p.length > 0) cleaned.push(p)
          }
          setRecentProjects(cleaned.slice(0, 5))
        }
      } catch { /* settings unavailable — render empty MRU */ }
    })()
  }, [])

  /**
   * Push a project path onto the front of the MRU, dedupe by absolute path,
   * cap at 5, and persist via the existing `settings:set` IPC. Called from
   * `loadProjectFile` (file-open path) and from the EnvironmentSplash
   * recent-project-click handler so the just-opened path bubbles to the top.
   */
  const pushRecentProject = useCallback(async (path: string): Promise<void> => {
    if (!path || typeof path !== 'string') return
    const next = [path, ...recentProjects.filter(p => p !== path)].slice(0, 5)
    setRecentProjects(next)
    try {
      await fab().settingsSet({ recentProjectPaths: next })
    } catch { /* persistence is best-effort */ }
  }, [recentProjects])

  const { execute: undoExec } = useUndo()

  // First-launch project wizard trigger.
  // On every mount: read `hasCompletedOnboarding` from settings (the new
  // source of truth). Show the wizard iff the flag is NOT true. Also
  // hydrate the recent-projects MRU + projectsRoot so the wizard has
  // them available without a second round-trip.
  useEffect(() => {
    let cancelled = false
    fab().settingsGet()
      .then((s) => {
        if (cancelled) return
        const mru = Array.isArray(s.recentProjectPaths) ? s.recentProjectPaths : []
        setRecentProjectPaths(mru)
        setProjectsRoot(typeof s.projectsRoot === 'string' && s.projectsRoot.length > 0 ? s.projectsRoot : null)
        if (s.hasCompletedOnboarding !== true) {
          setShowFirstLaunchWizard(true)
        }
      })
      .catch(() => { /* settings unavailable -- skip wizard quietly */ })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeJob = useMemo(() => jobs.find(j => j.id === activeJobId) ?? null, [jobs, activeJobId])

  // [ID-0072-followup] Cycle 50 ui-polish: clear the preview banner
  // whenever the active job switches OR a fresh G-code is generated
  // (changes `gcodeOut`). Stale samples from a previous job must
  // never leak into the current K2 fab drawer.
  useEffect(() => {
    setMoonrakerPreviewSamples(undefined)
  }, [activeJobId, activeJob?.gcodeOut])
  const mode: MachineUIMode = sessionMachine ? getMachineMode(sessionMachine) : 'cnc_2d'
  const isFdm = mode === 'fdm'

  /** The environment that owns the active session machine, or null at the splash phase. */
  const activeEnv = useMemo(
    () => getEnvironmentForMachine(sessionMachine?.id ?? null),
    [sessionMachine?.id]
  )

  // ── Quick-switch variant memory (per-env last-used machine) ───────────────
  // Lets the brand-bar env buttons restore the Makera 3-axis vs 4-axis choice
  // across switches. Persisted under `fab-env-last-variant-v1` (mirrors the
  // `fab-jobs-<env>-v1` naming pattern). Reads and writes are guarded because
  // localStorage can throw on quota/disabled-cookies in Electron edge cases.
  const LAST_VARIANT_STORAGE_KEY = 'fab-env-last-variant-v1'
  const [lastVariantByEnvId, setLastVariantByEnvId] = useState<Partial<Record<EnvironmentId, string>>>(() => {
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
  })

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

  useEffect(() => {
    setGcodeSafetyAckKey(null)
  }, [gcodeGeneration, activeJob?.gcodeOut])

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
    await loadProjectFromPath(p)
  }

  /**
   * Shared implementation of "open a .fabsession at `path`". Used by the
   * Open dialog flow (`loadProjectFile`) and the EnvironmentSplash recent-
   * projects MRU. On success, pushes `path` onto the MRU so a re-click
   * surfaces it as &quot;most recent&quot;.
   */
  const loadProjectFromPath = useCallback(async (p: string): Promise<void> => {
    try {
      const raw = await fab().fsReadBase64(p)
      const text = atob(raw)
      const { jobs: loadedJobs, activeJobId: loadedActiveId } = JSON.parse(text) as { version: number; jobs: Job[]; activeJobId: string | null }
      if (!Array.isArray(loadedJobs)) throw new Error('Invalid session file')
      setJobs(loadedJobs)
      setActiveJobId(loadedJobs.find(j => j.id === loadedActiveId)?.id ?? loadedJobs[0]?.id ?? null)
      pushToast('ok', `Loaded ${loadedJobs.length} job(s)`)
      // Only push to MRU on a successful load — never log failed paths.
      void pushRecentProject(p)
    } catch (e) {
      pushToast('err', formatErrorForToast(e instanceof Error ? e.message : String(e), 'Load failed'))
    }
  }, [pushToast, pushRecentProject])

  const generate = async (): Promise<void> => {
    if (!activeJob) {
      pushToast('warn', 'Select or create a job first.')
      return
    }
    if (!activeJob.stlPath?.trim()) {
      pushToast('warn', 'Load a model (drop STL/DXF on the viewport or use Browse).')
      return
    }
    if (!activeJob.machineId?.trim()) {
      pushToast('warn', 'Choose a machine for this job (Library drawer or job settings).')
      return
    }
    if (activeJob.operations.length === 0) {
      pushToast('warn', 'Add at least one operation in the left panel (Operations → +).')
      return
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
      // Strip any accumulated `.cam-aligned` segments from the source stem so the
      // gcode output doesn't inherit suffixes like `model.cam-aligned.cam-aligned.gcode`.
      const outPath = activeJob.stlPath
        .replace(/(\.cam-aligned)+(\.stl)$/i, '$2')
        .replace(/\.stl$/i, '.gcode')
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
        const needs4axis = op.kind === 'cnc_4axis_roughing' || op.kind === 'cnc_4axis_finishing' || op.kind === 'cnc_4axis_contour' || op.kind === 'cnc_4axis_indexed' || op.kind === 'cnc_4axis_continuous'
        // 4-axis ops use the new facade, which applies the user gizmo
        // transform itself via `placement`. Send the raw STL path so the
        // facade does not double-apply the renderer-baked transform. 3-axis
        // ops keep using `camStlPath` (the baked `.cam-aligned.stl`).
        const stlPathForCam = needs4axis ? activeJob.stlPath : camStlPath
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
            stlPath: stlPathForCam, outPath, machineId: activeJob.machineId!,
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
            ...(needs4axis
              ? {
                  useMeshMachinableXClamp: p['useMeshMachinableXClamp'] === true,
                  placement: activeJob.transform
                }
              : {}),
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
    const ensureSafetyGate = async (actionLabel: string): Promise<boolean> => {
      if (!activeJob?.gcodeOut) return false
      const machine = sessionMachine ?? machines.find((m) => m.id === activeJob.machineId) ?? null
      if (!machine) {
        pushToast('warn', `${actionLabel} blocked: machine profile is unavailable`)
        return false
      }
      try {
        const text = await fab().readTextFile(activeJob.gcodeOut)
        const safety = assessGcodeForExportSafety({
          gcode: text,
          dialect: machine.dialect,
          safeRetractZMm: machine.workAreaMm.z
        })
        if (safety.blockingErrors.length > 0) {
          pushToast('err', `${actionLabel} blocked: ${safety.blockingErrors[0]}`)
          return false
        }
        if (safety.warnings.length > 0) {
          const ackKey = `${activeJob.gcodeOut}|${machine.dialect}`
          if (gcodeSafetyAckKey !== ackKey) {
            setGcodeSafetyAckKey(ackKey)
            pushToast('warn', `${actionLabel}: ${safety.warnings[0]} Run the action again to acknowledge.`)
            return false
          }
        }
      } catch (e) {
        pushToast('err', formatErrorForToast(e instanceof Error ? e.message : String(e), `${actionLabel} safety check failed`))
        return false
      }
      return true
    }
    if (!(await ensureSafetyGate('Send to printer'))) return
    try {
      // [ID-0080] Thread `machineId` so the main-process `moonraker:push`
      // handler resolves FDM temperature ceilings from the active profile
      // and runs the pre-upload validator (see [ID-0070]/[ID-0073]/[ID-0078]).
      // Without this, the pre-upload temperature guard was disarmed in
      // production. `formatMoonrakerPushFailure` surfaces the validator's
      // structured `detail` string (e.g. "M109 targets 400 C but exceeds
      // the nozzle ceiling of 350 C ...") alongside the high-level error.
      const payload = buildMoonrakerPushPayload(
        { gcodeOut: activeJob.gcodeOut, printerUrl: activeJob.printerUrl, machineId: activeJob.machineId },
        { startAfterUpload: true }
      )
      const r = await fab().moonrakerPush(payload)
      // [ID-0072-followup] Cycle 50 ui-polish: when the validator
      // surfaced samples (typically on the rejection path -- see
      // `MoonrakerPushResult.tempValidation.samples`), thread them
      // into the pre-flight banner state so subsequent renders show
      // the operator the peak heat targets above the Send button.
      // Also fire the `moonraker:preview` IPC hook for future
      // telemetry / dry-run integrations -- errors are intentionally
      // swallowed to keep the user-facing flow identical to the
      // pre-[ID-0072-followup] behavior (Safety Rule 2: additive).
      const previewSamples = r.tempValidation?.samples
      if (previewSamples && previewSamples.length > 0) {
        setMoonrakerPreviewSamples(previewSamples)
        void fab().moonrakerPreview(previewSamples).catch(() => { /* preview hook is non-critical */ })
      }
      if (r.ok) {
        pushToast('ok', `Sent: ${r.filename}`)
        // Quick-win bundle (undo/redo + K2 thumbnail + Klipper header):
        // surface any non-fatal slicer-header warnings (typically the
        // missing-thumbnail nudge) as a soft warn toast so the operator
        // knows the upload landed AND knows what to fix in the next slice.
        if (r.warnings && r.warnings.length > 0) {
          for (const w of r.warnings) pushToast('warn', w)
        }
      } else {
        // [ID-0088] Render rejections as a two-line toast so the long-form
        // detail (typical: "M109 targets 400 C but exceeds the nozzle
        // ceiling of 350 C ... (+2 more) — will heat: Nozzle: 215 C")
        // is not chopped at 200 chars by `formatErrorForToast`. The Copy
        // button on the toast row reconstructs the full single-line text
        // for paste-into-bug-report. `formatMoonrakerPushFailure` is kept
        // imported as the byte-identical legacy fallback for any future
        // call-site that still needs a single string.
        const split = splitMoonrakerPushFailureForToast(r)
        const titleForToast = formatErrorForToast(split.title, 'Send to printer')
        if (split.detail !== null) {
          pushToast('err', titleForToast, split.detail)
        } else {
          pushToast('err', titleForToast)
        }
        // ASSUMPTION: `formatErrorForToast` is intentionally applied to
        // the title only — the long-form `split.detail` is the
        // validator's structured output and should appear verbatim so
        // the operator can match it against the G-code line.
      }
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
    const machine = sessionMachine ?? machines.find((m) => m.id === activeJob.machineId) ?? null
    if (!machine) {
      pushToast('warn', 'Export blocked: machine profile is unavailable')
      return
    }
    try {
      const text = await fab().readTextFile(activeJob.gcodeOut)
      const safety = assessGcodeForExportSafety({
        gcode: text,
        dialect: machine.dialect,
        safeRetractZMm: machine.workAreaMm.z
      })
      if (safety.blockingErrors.length > 0) {
        pushToast('err', `Export blocked: ${safety.blockingErrors[0]}`)
        return
      }
      if (safety.warnings.length > 0) {
        const ackKey = `${activeJob.gcodeOut}|${machine.dialect}`
        if (gcodeSafetyAckKey !== ackKey) {
          setGcodeSafetyAckKey(ackKey)
          pushToast('warn', `Export warning: ${safety.warnings[0]} Run Export again to acknowledge.`)
          return
        }
      }
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
    const machine = sessionMachine ?? machines.find((m) => m.id === activeJob.machineId) ?? null
    if (!machine) {
      pushToast('warn', 'Open file blocked: machine profile is unavailable')
      return
    }
    try {
      const text = await fab().readTextFile(activeJob.gcodeOut)
      const safety = assessGcodeForExportSafety({
        gcode: text,
        dialect: machine.dialect,
        safeRetractZMm: machine.workAreaMm.z
      })
      if (safety.blockingErrors.length > 0) {
        pushToast('err', `Open file blocked: ${safety.blockingErrors[0]}`)
        return
      }
      if (safety.warnings.length > 0) {
        const ackKey = `${activeJob.gcodeOut}|${machine.dialect}`
        if (gcodeSafetyAckKey !== ackKey) {
          setGcodeSafetyAckKey(ackKey)
          pushToast('warn', `Open file warning: ${safety.warnings[0]} Run Open file again to acknowledge.`)
          return
        }
      }
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

  /**
   * First-launch wizard completion handler. The wizard has already:
   *   - Created the project via `project:create`
   *   - Optionally copied a sample STL via `wizard:copySample`
   *   - Persisted `hasCompletedOnboarding = true`
   *
   * This handler activates the chosen machine, seeds the in-memory job
   * list with a starter job (always), and -- when the user picked
   * sample / import -- attaches the model + a starter operation kind.
   */
  const handleWizardFinish = async (completion: FirstLaunchWizardCompletion): Promise<void> => {
    setShowFirstLaunchWizard(false)
    // 1. Activate the machine + transition to the main app.
    await handleMachineSelect(completion.machine)
    // 2. Build a starter job. Always create one so the user lands in
    //    a real working surface (the "3-clicks-from-launch" rule).
    const baseJob = newJob(completion.projectName || 'Job 1', completion.machine.id)
    const starter = completion.starterContent
    let stlPathForJob: string | null = null
    if (starter.kind === 'sample') {
      stlPathForJob = starter.absolutePath
    } else if (starter.kind === 'imported') {
      stlPathForJob = starter.sourcePath
    }
    const job: Job = { ...baseJob, stlPath: stlPathForJob }
    if (starter.kind === 'sample' || starter.kind === 'imported') {
      // Pre-seed one operation matching the machine kind.
      const op = newOp(starter.starterOpKind)
      job.operations = [op]
    }
    setJobs([job])
    setActiveJobId(job.id)
    pushToast('ok', `Project "${completion.projectName}" created.`)
  }

  const handleWizardSkip = (): void => {
    setShowFirstLaunchWizard(false)
  }

  /**
   * Brand-bar env quick-switch. Resolves the target machine via the pure
   * helper, records the choice in per-env variant memory (localStorage), and
   * delegates to `handleMachineSelect`. When no owned machine is installed,
   * toasts a hint and opens the Library drawer rather than failing silently.
   */
  const handleQuickSwitchEnv = (envId: EnvironmentId): void => {
    const targetEnv = ENVIRONMENT_LIST.find((e) => e.id === envId)
    if (!targetEnv) return
    const next = resolveQuickSwitchMachine(
      targetEnv,
      machines,
      lastVariantByEnvId,
      sessionMachine?.id ?? null
    )
    if (!next) {
      pushToast('warn', `No ${targetEnv.name} machine installed. Open the Library to add one.`)
      setLibraryDrawerOpen(true)
      return
    }
    // No-op when the env already owns the current machine (idempotent rule).
    if (sessionMachine?.id === next.id) return
    const updated: Partial<Record<EnvironmentId, string>> = { ...lastVariantByEnvId, [envId]: next.id }
    setLastVariantByEnvId(updated)
    try { localStorage.setItem(LAST_VARIANT_STORAGE_KEY, JSON.stringify(updated)) } catch { /* quota / disabled */ }
    void handleMachineSelect(next)
  }

  /**
   * My Shop preset launcher. Delegates to the same quick-switch resolver
   * the brand-bar env buttons use so variant-memory + missing-machine
   * rules stay centralised. Closes the drawer when the preset successfully
   * activates a machine. [ID-0009]
   */
  const handleLaunchMyShopPreset = (preset: MyShopPreset): void => {
    const plan = composePresetLaunchPlan(
      preset,
      ENVIRONMENTS,
      machines,
      lastVariantByEnvId,
      sessionMachine?.id ?? null
    )
    switch (plan.kind) {
      case 'env-not-found':
        // Programmer error / drift — preset names an env not in the registry.
        // Bail rather than silently picking another env.
        return
      case 'no-machine-installed':
        pushToast('warn', plan.toastMessage)
        setLibraryDrawerOpen(true)
        return
      case 'already-active':
        // Active machine already belongs to the preset's env — no session
        // switch, no variant-memory mutation, just surface the success toast.
        pushToast('ok', plan.toastMessage)
        return
      case 'switch':
        setLastVariantByEnvId(plan.updatedVariantMap)
        try {
          localStorage.setItem(
            LAST_VARIANT_STORAGE_KEY,
            JSON.stringify(plan.updatedVariantMap)
          )
        } catch {
          /* quota / disabled */
        }
        void handleMachineSelect(plan.next)
        pushToast('ok', plan.toastMessage)
        return
    }
  }

  /** Library-drawer fallback when a My Shop card's machine is not installed. */
  const handleInstallMyShopMachine = (_machineId: MyShopMachineId): void => {
    setLibraryDrawerOpen(true)
  }

  const handleNavSelect = useCallback((section: NavSection): void => {
    if (section === 'library') { setLibraryDrawerOpen(true); return }
    if (section === 'settings') { setSettingsDrawerOpen(true); return }
    if (section === 'myshop') { setMyShopDrawerOpen(true); return }
    setNavSection(s => s === section ? null : section)
  }, [])

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
    // First-launch wizard re-trigger (acceptance criterion: re-triggerable
    // from a menu/command palette item).
    c.push({
      id: 'new_project_wizard',
      group: 'File',
      label: 'New Project from Wizard\u2026',
      icon: '\u{2728}',
      action: () => setShowFirstLaunchWizard(true)
    })
    c.push({
      id: 'app_tour',
      group: 'Help',
      label: 'Show app tour (What\u2019s new)',
      icon: '\u{1F4D6}',
      action: () => setShowOnboarding(true)
    })
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
            recentProjects={recentProjects}
            onOpenRecent={(p) => { void loadProjectFromPath(p) }}
          />
        )}
        {splashLibOpen && (
          <div className="machine-lib-overlay">
            <div className="machine-lib-overlay__header">
              <span className="machine-lib-overlay__title">Machine Library</span>
              <div className="flex-spacer" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
                await reloadMachines()
                setSplashLibOpen(false)
              }}>{'←'} Back to environment picker</button>
            </div>
            <div className="machine-lib-overlay__body">
              <Suspense fallback={<div className="text-muted p-16">Loading library{'…'}</div>}>
                <LibraryView onToast={pushToast} onMachinesChanged={reloadMachines} />
              </Suspense>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── v2 Control Center layout ──
  return (
    <div className="cc-shell" data-environment={activeEnv?.id ?? undefined}>
      {/* Header */}
      <AppHeader
        sessionMachine={sessionMachine}
        activeEnv={activeEnv}
        mode={mode}
        activeJob={activeJob}
        running={running}
        isFdm={isFdm}
        savedIndicator={savedIndicator}
        onSwitchEnv={handleQuickSwitchEnv}
        onChangeMachine={() => setPhase('splash')}
        onCmdOpen={() => setCmdOpen(true)}
        onShortcuts={() => setShowShortcuts(x => !x)}
        onHelp={() => setHelpOpen(x => !x)}
        onGenerate={generate}
        onSendToPrinter={sendToPrinter}
        onGcodeView={() => void openGcodeViewer()}
        onGcodeExport={() => void exportGcodeCopy()}
        onGcodeOpenFile={() => void openGcodeInSystemApp()}
        onImportModel={() => void importModel()}
        onNewProject={() => void newProject()}
        onOpenProject={loadProjectFile}
        onSaveProject={saveProjectFile}
        onSetupSheet={openSetupSheet}
      />

      {isFdm && (
        <MoonrakerPreviewBanner samples={moonrakerPreviewSamples} />
      )}

      {/* Main workspace: rail + panel + viewport + properties */}
      <div className="cc-workspace">
        <NavRail
          active={navSection}
          onSelect={handleNavSelect}
          jobCount={jobs.length}
          opCount={activeJob?.operations.length ?? 0}
        />

        {navSection === 'jobs' && (
          <div className="cc-nav-panel" style={{ width: `${leftPanelWidth}px` }}>
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
              aria-label="Resize panel"
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
          </div>
        )}

        {navSection === 'tools' && (
          <div className="cc-nav-panel" style={{ width: `${leftPanelWidth}px` }}>
            <div className="cc-nav-panel__header">
              <span className="cc-nav-panel__title">{'\u{1F527}'} Tools & Materials</span>
            </div>
            <div className="cc-nav-panel__body">
              <div className="prop-section">
                <h3 className="prop-section__title">{'\u{1F9F1}'} Material</h3>
                <select
                  className="prop-field__input"
                  value={activeJob?.materialId ?? ''}
                  disabled={!activeJob}
                  onChange={e => activeJob && updateJob(activeJob.id, { materialId: e.target.value || null })}
                >
                  <option value="">{'—'} None {'—'}</option>
                  {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                {activeJob?.materialId && !isFdm && (
                  <button type="button" className="prop-section__action" onClick={applyMaterial}>
                    {'⚡'} Apply to all ops
                  </button>
                )}
              </div>
              <div className="prop-section">
                <h3 className="prop-section__title">{'\u{1F527}'} Tool Library</h3>
                <p className="prop-field__hint">
                  {machineTools.length} tool{machineTools.length !== 1 ? 's' : ''} loaded.
                </p>
                <button type="button" className="prop-section__action" onClick={() => setLibraryDrawerOpen(true)}>
                  Open Library
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Central column: viewport + sequencer */}
        <div className="cc-center-col">
          <ErrorBoundary label="3D Viewport" severity="panel">
            <ViewportArea
              job={activeJob} mode={mode} onUpdateJob={updateJob} onToast={pushToast}
              modelSize={modelSize} setModelSize={setModelSize}
              gcodeGeneration={gcodeGeneration}
            />
          </ErrorBoundary>

          <OpSequencer
            operations={activeJob?.operations ?? []}
            selectedOpId={selectedOpId}
            onSelectOp={setSelectedOpId}
            onAddOp={addOp}
            onRemoveOp={removeOp}
            mode={mode}
            running={running}
            disabled={!activeJob}
          />

          {logOpen && (
            <div className="shop-log" role="region" aria-label="Output log">
              <div className="shop-log-bar">
                <span className="shop-log-title">Output Log</span>
                {running && <span className="spinner spinner--sm ml-8" aria-label="Processing" />}
                <div className="flex-spacer" />
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Clear log" onClick={() => setLog([])}>Clear</button>
                <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Close log" onClick={() => setLogOpen(false)}>{'✕'}</button>
              </div>
              {running && <div className="progress-bar progress-bar--indeterminate" role="progressbar" aria-label="Generation in progress"><div className="progress-bar__fill" /></div>}
              <div className="shop-log-body" aria-live="polite">
                {log.map((l, i) => (
                  <div key={i} className={`shop-log-line${l.includes('✕') ? ' log-line--error' : l.includes('✓') ? ' log-line--ok' : ''}`}>
                    {l}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <PropertyPanel
          activeJob={activeJob}
          mode={mode}
          isFdm={isFdm}
          sessionMachine={sessionMachine}
          materials={materials}
          machineTools={machineTools}
          selectedOpId={selectedOpId}
          onUpdateJob={updateJob}
          onUpdateOpParams={updateOpParams}
          onApplyMaterial={applyMaterial}
          collapsed={propCollapsed}
          onToggle={() => setPropCollapsed(c => !c)}
        />
      </div>

      <AppStatusBar
        activeJob={activeJob}
        running={running}
        sessionMachine={sessionMachine}
        lastGenMs={lastGenMs}
        logOpen={logOpen}
        onToggleLog={() => setLogOpen(x => !x)}
      />

      {/* Drawers */}
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
      <MyShopDrawer
        open={myShopDrawerOpen}
        onClose={() => setMyShopDrawerOpen(false)}
        machines={machines}
        currentMachineId={sessionMachine?.id ?? null}
        onLaunchPreset={handleLaunchMyShopPreset}
        onInstallMachine={handleInstallMyShopMachine}
      />

      {/* Overlays */}
      {gcodeViewerOpen && (
        <div className="shop-gcode-overlay" role="dialog" aria-modal="true" aria-labelledby="shop-gcode-title" onClick={() => setGcodeViewerOpen(false)}>
          <div className="shop-gcode-sheet" onClick={(e) => e.stopPropagation()}>
            <ErrorBoundary label="G-code Viewer" severity="panel">
            <div className="shop-gcode-sheet-bar">
              <span id="shop-gcode-title" className="shop-gcode-title">G-code</span>
              {gcodeViewerPath && <span className="shop-gcode-path" title={gcodeViewerPath}>{gcodeViewerPath}</span>}
              <button type="button" className="btn btn-ghost btn-sm" disabled={!gcodeViewerPath} onClick={() => void copyGcodePath(gcodeViewerPath)}>Copy path</button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={!activeJob?.gcodeOut} onClick={() => void exportGcodeCopy()}>Export{'…'}</button>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setGcodeViewerOpen(false)} aria-label="Close">{'✕'}</button>
            </div>
            <div className="shop-gcode-sheet-body">
              {gcodeViewerLoading
                ? <span className="shop-gcode-loading">Loading{'…'}</span>
                : <pre className="shop-gcode-pre" tabIndex={0}>{gcodeViewerText || '(empty)'}</pre>}
            </div>
            </ErrorBoundary>
          </div>
        </div>
      )}

      {cmdOpen && <ErrorBoundary label="Command Palette" severity="panel"><CommandPalette commands={commands} onClose={() => setCmdOpen(false)} /></ErrorBoundary>}
      {showShortcuts && <ErrorBoundary label="Keyboard Shortcuts" severity="panel"><KeyboardShortcutsDialog onClose={() => setShowShortcuts(false)} /></ErrorBoundary>}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {showOnboarding && <OnboardingOverlay onDismiss={() => setShowOnboarding(false)} />}
      {showFirstLaunchWizard && (
        <ErrorBoundary label="First-launch wizard" severity="panel">
          <FirstLaunchWizard
            machines={machines}
            recentProjectPaths={recentProjectPaths}
            defaultProjectsRoot={projectsRoot}
            onFinish={(c) => { void handleWizardFinish(c) }}
            onSkip={handleWizardSkip}
            onOpenRecent={(p) => {
              setShowFirstLaunchWizard(false)
              // The host doesn't currently have a single "open recent
              // project path" API exposed at this level, so fall back to
              // the existing fabsession picker -- the wizard's MRU is a
              // convenience that hands off to the normal Open Project
              // flow seeded with the chosen folder.
              void (async () => {
                try {
                  // Best-effort: read project.json + activate its machine.
                  const pf = await fab().projectRead(p)
                  const mach = machines.find((m) => m.id === pf.activeMachineId)
                  if (mach) {
                    await handleMachineSelect(mach)
                    pushToast('ok', `Opened "${pf.name}"`)
                  } else {
                    pushToast('warn', `Project "${pf.name}" references an unknown machine.`)
                  }
                } catch (e) {
                  pushToast('err', `Failed to open recent project: ${e instanceof Error ? e.message : String(e)}`)
                }
              })()
            }}
          />
        </ErrorBoundary>
      )}

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
