import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { AppSettings, ProjectFile } from '../../shared/project-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import {
  deriveContourPointsFromDesign,
  deriveDrillPointsFromDesign,
  listContourCandidatesFromDesign,
  type DerivedContourCandidate
} from '../../shared/cam-2d-derive'
import { EmptyState } from '../src/EmptyState'
import {
  formatDurationShort,
  formatFilamentMm
} from './gcode-layer-parser'
import type {
  FdmLayerBreakdown,
  FdmLayerBreakdownResult
} from '../../shared/fdm-gcode-layer-breakdown'
import { formatDistanceMm, parseToolpathStats } from './gcode-toolpath-stats'
import { resolveManufactureSetupForCam } from '../../shared/cam-cut-params'
import { MESH_IMPORT_FILE_EXTENSIONS } from '../../shared/mesh-import-formats'
import type { ManufactureFile, ManufactureOperation, ManufactureSetup } from '../../shared/manufacture-schema'
import { emptyManufacture } from '../../shared/manufacture-schema'
import { computeBinaryStlBoundingBox, stockBoxDimensionsFromPartBounds } from '../../shared/stl-binary-preview'
import {
  readPersistedManufactureActionableOnly,
  readPersistedManufactureOpFilter,
  type ManufactureOpFilter,
  type ManufacturePanelTab,
  writePersistedManufactureActionableOnly,
  writePersistedManufactureOpFilter
} from '../shell/workspaceMemory'
import { estimateFeedMmMinFromTool } from '../../shared/tool-feed-hint'
import type { ToolLibraryFile, ToolRecord } from '../../shared/tool-schema'
import { CamManufacturePanel, SliceManufacturePanel, ToolsManufacturePanel } from './ManufactureAuxPanels'
import { CalibrationPanel } from './CalibrationPanel'
import { ManufactureSetupStrip } from './ManufactureSetupStrip'
import { ManufactureCamSimulationPanel } from './ManufactureCamSimulationPanel'
import { ManufactureSubTabStrip } from './ManufactureSubTabStrip'
import { PlateTabs } from './PlateTabs'
import {
  addPlate as addPlateState,
  getActivePlate,
  getPlates,
  removePlate as removePlateState,
  renamePlate as renamePlateState,
  updateActivePlate,
  viewMfgAsActivePlate
} from './plate-state'
import { MakeraFunctionsPanel } from './MakeraFunctionsPanel'
import { CamProgressBar } from './CamProgressBar'
import { ToolChangeTimeline } from './ToolChangeTimeline'
import type { StockMaterialType, WcsOriginPoint } from '../../shared/manufacture-schema'
import { buildSetupSheetJobFromManufacture, generateSetupSheet, parseGcodeStats } from '../src/setup-sheet'
import {
  resolveManufactureCamMachine,
  opReadiness,
  opStatusForPanel
} from './manufacture-op-helpers'
import { ManufactureOperationList } from './ManufactureOperationList'
import { ManufactureSetupList } from './ManufactureSetupList'
import { ManufacturePlanToolbar } from './ManufacturePlanToolbar'
import { ManufactureSetupTab } from './ManufactureSetupTab'
import { LagunaNestingPanel } from './LagunaNestingPanel'
import { ManufactureNoSetupBanner } from './ManufactureNoSetupBanner'
import { ProbeCyclePanel } from './ProbeCyclePanel'
import { ProfileStack } from './ProfileStack'
import { FdmProcessPanel } from './FdmProcessPanel'
import { FdmDeviceControls } from './FdmDeviceControls'
import {
  buildFdmSliceOverrides,
  parseFdmProcessOverrides,
  serializeFdmProcessOverrides,
  type FdmProcessOverrides
} from '../../shared/fdm-process-overrides'
import type { K2PlusQualityPresetId } from '../../shared/k2-plus-slice-presets'
import type { Placement } from './rotary-placement'


/**
 * UX MOVE 4 — Workflow-stage tabs above the viewport (Bambu / Orca / Fusion 360
 * pattern). The segmented control renders directly above the existing
 * Manufacture sub-tab strip and gates which secondary panels are visible.
 *
 * Stage sets are env-specific (CLAUDE.md My-Shop-Only):
 *   - FDM (K2 Plus):                 Prepare / Preview / Device
 *   - CNC (Laguna / Carvera 3/4-axis): Setup / Toolpaths / Simulate / Send
 *
 * For the MVP, each stage swaps the visible secondary panel only — the existing
 * sub-tab strip + plate tabs continue to render underneath so the operator
 * doesn't lose any existing controls. Gizmo wiring is a follow-up.
 */
export type WorkflowStageFdm = 'prepare' | 'preview' | 'device'
export type WorkflowStageCnc = 'setup' | 'toolpaths' | 'simulate' | 'probing' | 'send'
export type WorkflowStage = WorkflowStageFdm | WorkflowStageCnc
export type WorkflowEnv = 'fdm' | 'cnc'

type WorkflowStageDef<T extends WorkflowStage> = {
  id: T
  label: string
  title: string
}

const FDM_STAGES: ReadonlyArray<WorkflowStageDef<WorkflowStageFdm>> = [
  { id: 'prepare', label: 'Prepare', title: 'Arrange plate, pick parts, define job tree' },
  { id: 'preview', label: 'Preview', title: 'Slice preview — layer-by-layer review' },
  { id: 'device', label: 'Device', title: 'Send to printer over Moonraker' }
] as const

const CNC_STAGES: ReadonlyArray<WorkflowStageDef<WorkflowStageCnc>> = [
  { id: 'setup', label: 'Setup', title: 'Stock, WCS origin, axis mode' },
  { id: 'toolpaths', label: 'Toolpaths', title: 'Tool selection + CAM generation' },
  { id: 'simulate', label: 'Simulate', title: '3D toolpath simulation' },
  { id: 'probing', label: 'Probing', title: 'On-machine touch-probe cycles (WCS / bore / boss / corner / tool length)' },
  { id: 'send', label: 'Send', title: 'Post-process and send G-code to controller' }
] as const

/** Pick the default workflow stage for the given env (Prepare for FDM, Setup for CNC). */
export function defaultWorkflowStageFor(env: WorkflowEnv): WorkflowStage {
  return env === 'fdm' ? 'prepare' : 'setup'
}

export type WorkflowStageTabsProps = {
  env: WorkflowEnv
  stage: WorkflowStage
  onChange: (s: WorkflowStage) => void
}

/**
 * Segmented control rendered above the viewport. Roving-tabindex + arrow-key
 * navigation matches `ManufactureSubTabStrip`. The CSS for `.workflow-stage-tabs`
 * is owned by Agent 1 in `src/renderer/styles/components.css`.
 */
export function WorkflowStageTabs({ env, stage, onChange }: WorkflowStageTabsProps) {
  const stages: ReadonlyArray<WorkflowStageDef<WorkflowStage>> =
    env === 'fdm' ? FDM_STAGES : CNC_STAGES

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>, stageId: WorkflowStage) => {
      const idx = stages.findIndex((s) => s.id === stageId)
      if (idx < 0) return
      let nextIdx = -1
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        nextIdx = (idx + 1) % stages.length
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        nextIdx = (idx - 1 + stages.length) % stages.length
      } else if (e.key === 'Home') {
        e.preventDefault()
        nextIdx = 0
      } else if (e.key === 'End') {
        e.preventDefault()
        nextIdx = stages.length - 1
      }
      if (nextIdx < 0) return
      const next = stages[nextIdx]!
      onChange(next.id)
      queueMicrotask(() => document.getElementById(`workflow-stage-${next.id}`)?.focus())
    },
    [stages, onChange]
  )

  return (
    <div
      className="workflow-stage-tabs"
      role="tablist"
      aria-label={env === 'fdm' ? 'FDM workflow stages' : 'CNC workflow stages'}
      aria-orientation="horizontal"
      data-env={env}
      data-testid="workflow-stage-tabs"
    >
      {stages.map((s, index) => (
        <button
          key={s.id}
          id={`workflow-stage-${s.id}`}
          type="button"
          role="tab"
          aria-selected={stage === s.id}
          aria-controls="manufacture-workspace-panel"
          aria-posinset={index + 1}
          aria-setsize={stages.length}
          tabIndex={stage === s.id ? 0 : -1}
          className={`workflow-stage-tab${stage === s.id ? ' workflow-stage-tab--active' : ''}`}
          title={s.title}
          data-stage={s.id}
          data-testid={`workflow-stage-tab-${s.id}`}
          onClick={() => onChange(s.id)}
          onKeyDown={(e) => onKeyDown(e, s.id)}
        >
          <span className="workflow-stage-tab__label">{s.label}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * CAD V1.5 — Layer preview body for the FDM `preview` workflow stage.
 *
 * When the operator switches the workflow stage to "Preview" the right-panel
 * content swaps to this focused view. The per-layer breakdown is produced by
 * the streaming main-process parser (`slice:layerBreakdown` ->
 * `src/main/slicer/fdm-gcode-stream-parser.ts`) so the renderer never loads
 * multi-MB G-code text — it receives a compact `FdmLayerBreakdownResult`.
 * The body renders a single-layer readout + a horizontal scrubber, plus a
 * full per-layer table (index, Z, time, filament) and — when the slice
 * carried `;TYPE:` annotations — a line-type breakdown row for the active
 * layer.
 *
 * The breakdown reports REAL per-layer values when the slice carried
 * per-layer comments and degrades gracefully to a uniform distribution from
 * the header totals otherwise (see the parser docstring) — never worse than
 * the legacy renderer-side coarse estimate.
 *
 * Pure presentation; no IPC or G-code mutation. Exported so the
 * `ManufactureWorkspace.stage-content.test.tsx` render-pin tests can mount
 * it directly via `renderToStaticMarkup` without dragging in Three.js or
 * the plate-state stack.
 *
 * Fallback path: when no breakdown is available (operator hasn't sliced yet,
 * the breakdown is still loading, or the file had no layer markers) the body
 * renders the shared `EmptyState` per CLAUDE.md convention.
 */
export interface LayerPreviewBodyProps {
  /**
   * Per-layer breakdown of the most recent successful slice, or null while
   * loading / when no slice has run / when the breakdown IPC call failed.
   */
  readonly layerBreakdown: FdmLayerBreakdownResult | null
  /** Absolute path to the most recent successfully-sliced G-code (null if none). */
  readonly lastSliceGcodePath: string | null
  /**
   * Currently-selected layer index (1-based) for the scrubber. Defaults to
   * the top (highest-Z) layer when unset. Callers can wire a piece of
   * state to make the scrubber interactive — for SSR / render-pin tests
   * the prop alone is enough to deterministically pick a layer.
   */
  readonly selectedLayerIndex?: number
  /** Optional change handler — when present, the slider becomes interactive. */
  readonly onSelectLayerIndex?: (index: number) => void
}

/**
 * Pick the visible layer from the breakdown array given the (optional)
 * selected index. Clamps to the first/last layer bounds and falls back
 * to the top layer when nothing is selected.
 */
function pickActiveLayer(
  layers: readonly FdmLayerBreakdown[],
  selectedIndex: number | undefined
): FdmLayerBreakdown | null {
  if (layers.length === 0) return null
  if (selectedIndex == null || !Number.isFinite(selectedIndex)) {
    return layers[layers.length - 1] ?? null
  }
  const clamped = Math.max(1, Math.min(layers.length, Math.trunc(selectedIndex)))
  return layers[clamped - 1] ?? layers[layers.length - 1] ?? null
}

/**
 * Render the active layer's line-type breakdown as a compact comma-joined
 * summary (e.g. "Outer wall 12, Inner wall 24, Sparse infill 60"). Returns
 * null when the layer carried no `;TYPE:` annotations so the caller can omit
 * the row entirely.
 */
function formatLineTypeCounts(layer: FdmLayerBreakdown): string | null {
  const counts = layer.lineTypeCounts
  if (!counts) return null
  const entries = Object.entries(counts).filter(([, n]) => typeof n === 'number' && n > 0)
  if (entries.length === 0) return null
  return entries.map(([type, n]) => `${type} ${n}`).join(', ')
}

export function LayerPreviewBody({
  layerBreakdown,
  lastSliceGcodePath,
  selectedLayerIndex,
  onSelectLayerIndex
}: LayerPreviewBodyProps): ReactNode {
  const hasPath = (lastSliceGcodePath?.trim() ?? '').length > 0
  const layers = layerBreakdown?.layers ?? []
  // Empty-state when no slice file has been produced, the breakdown is still
  // loading / failed (null), OR the produced file contained no recognisable
  // OrcaSlicer layer markers.
  if (!hasPath || layers.length === 0) {
    return (
      <section
        className="panel workspace-stage-body workspace-stage-body--preview"
        aria-labelledby="mfg-stage-preview-heading"
        data-testid="workflow-stage-body-preview"
      >
        <h2 id="mfg-stage-preview-heading">Layer preview</h2>
        <EmptyState
          testId="workflow-stage-preview-empty"
          title="Layer preview — slice first"
          body="Run a slice from the Prepare stage to populate the layer-by-layer preview."
        />
      </section>
    )
  }

  const active = pickActiveLayer(layers, selectedLayerIndex)
  // `active` is non-null because `layers.length > 0` is guarded above —
  // assert via a fallback so the JSX below can be unconditional.
  const layer: FdmLayerBreakdown = active ?? layers[layers.length - 1]!
  const maxLayer = layers.length
  const minLayer = 1
  const lineTypeSummary = formatLineTypeCounts(layer)

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    if (!onSelectLayerIndex) return
    const n = Number.parseInt(e.target.value, 10)
    if (Number.isFinite(n)) onSelectLayerIndex(n)
  }

  return (
    <section
      className="panel workspace-stage-body workspace-stage-body--preview"
      aria-labelledby="mfg-stage-preview-heading"
      data-testid="workflow-stage-body-preview"
    >
      <h2 id="mfg-stage-preview-heading">Layer preview</h2>
      <p className="msg msg--muted">
        Latest slice: <code data-testid="workflow-stage-preview-path">{lastSliceGcodePath}</code>
      </p>
      <dl
        className="toolpath-stats workflow-stage-preview-stats"
        data-testid="workflow-stage-preview-stats"
      >
        <div className="toolpath-stats__table">
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Layer</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-preview-layer-index"
            >
              {layer.index} / {maxLayer}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Z height</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-preview-layer-z"
            >
              {layer.zMm.toFixed(2)} mm
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Est. time</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-preview-layer-time"
            >
              {formatDurationShort(layer.estTimeSec)}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Est. filament</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-preview-layer-filament"
            >
              {formatFilamentMm(layer.estFilamentMm)}
            </dd>
          </div>
          {lineTypeSummary != null && (
            <div className="toolpath-stats__row">
              <dt className="toolpath-stats__key">Line types</dt>
              <dd
                className="toolpath-stats__value"
                data-testid="workflow-stage-preview-layer-linetypes"
              >
                {lineTypeSummary}
              </dd>
            </div>
          )}
        </div>
      </dl>
      <div
        className="layer-slider"
        data-testid="workflow-stage-preview-slider"
      >
        <label
          htmlFor="workflow-stage-preview-slider-input"
          className="layer-slider__label"
        >
          Scrub layer
        </label>
        <input
          id="workflow-stage-preview-slider-input"
          data-testid="workflow-stage-preview-slider-input"
          type="range"
          className="layer-slider__track"
          min={minLayer}
          max={maxLayer}
          step={1}
          value={layer.index}
          aria-label={`Scrub between layer ${minLayer} and layer ${maxLayer}`}
          aria-valuemin={minLayer}
          aria-valuemax={maxLayer}
          aria-valuenow={layer.index}
          aria-valuetext={`Layer ${layer.index} of ${maxLayer}, Z = ${layer.zMm.toFixed(2)} mm`}
          onChange={handleChange}
        />
        <span
          className="layer-slider__label"
          data-testid="workflow-stage-preview-slider-readout"
        >
          Layer {layer.index} of {maxLayer}
        </span>
      </div>
      <table
        className="layer-breakdown-table"
        data-testid="workflow-stage-preview-table"
      >
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Z (mm)</th>
            <th scope="col">Time</th>
            <th scope="col">Filament</th>
          </tr>
        </thead>
        <tbody>
          {layers.map((row) => (
            <tr
              key={row.index}
              data-testid={`workflow-stage-preview-table-row-${row.index}`}
              className={
                row.index === layer.index
                  ? 'layer-breakdown-table__row layer-breakdown-table__row--active'
                  : 'layer-breakdown-table__row'
              }
              aria-current={row.index === layer.index ? 'true' : undefined}
            >
              <td>{row.index}</td>
              <td>{row.zMm.toFixed(2)}</td>
              <td>{formatDurationShort(row.estTimeSec)}</td>
              <td>{formatFilamentMm(row.estFilamentMm)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/**
 * UX MOVE 5 — Toolpath simulation body for the CNC `simulate` workflow stage.
 *
 * Shows an EmptyState when no G-code has been generated yet, and a full
 * toolpath statistics readout once `output/cam.nc` exists. The readout
 * is computed by `gcode-toolpath-stats.ts`:
 *
 *   - Total lines
 *   - Rapid count (G0)
 *   - Cut count (G1)
 *   - Arc count (G2 + G3)
 *   - Rapid distance (mm / m)
 *   - Cut distance (mm / m, includes arc chord length)
 *   - Tool changes (M6)
 *   - Spindle starts (M3 / M4)
 *
 * The full 3D simulation still lives behind the `panelTab='simulate'`
 * sub-tab; this body is the focused at-a-glance summary that anchors the
 * Simulate workflow stage.
 *
 * Safety Rule 1: pure read of G-code text — no mutation, no re-emit.
 */
export interface ToolpathSimulationBodyProps {
  /** G-code text from the most recent `cam:run` (empty when no toolpath yet). */
  readonly camOut: string
}

export function ToolpathSimulationBody({ camOut }: ToolpathSimulationBodyProps): ReactNode {
  const trimmed = camOut.trim()
  if (trimmed.length === 0) {
    return (
      <section
        className="panel workspace-stage-body workspace-stage-body--simulate"
        aria-labelledby="mfg-stage-simulate-heading"
        data-testid="workflow-stage-body-simulate"
      >
        <h2 id="mfg-stage-simulate-heading">Toolpath simulation</h2>
        <EmptyState
          testId="workflow-stage-simulate-empty"
          title="No simulation yet — generate G-code first"
          body="Generate a toolpath from the Toolpaths stage, then return here to inspect it."
        />
      </section>
    )
  }
  const stats = parseToolpathStats(camOut)
  return (
    <section
      className="panel workspace-stage-body workspace-stage-body--simulate"
      aria-labelledby="mfg-stage-simulate-heading"
      data-testid="workflow-stage-body-simulate"
    >
      <h2 id="mfg-stage-simulate-heading">Toolpath simulation</h2>
      <p className="msg msg--muted">
        Switch to the <strong>Simulate</strong> sub-tab below for the full 3D visualization.
        This summary surfaces high-level G-code motion + spindle counts.
      </p>
      <dl
        className="toolpath-stats workflow-stage-simulate-stats"
        data-testid="workflow-stage-simulate-stats"
      >
        <div className="toolpath-stats__table">
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Total lines</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-simulate-total-lines"
            >
              {stats.totalLines}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Motion lines (G0 / G1)</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-simulate-motion-lines"
            >
              {stats.rapidCount + stats.cutCount}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Rapid moves (G0)</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-simulate-rapid-count"
            >
              {stats.rapidCount}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Cut moves (G1)</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-simulate-cut-count"
            >
              {stats.cutCount}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Arc moves (G2 / G3)</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-simulate-arc-count"
            >
              {stats.arcCount}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Rapid distance</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-simulate-rapid-distance"
            >
              {formatDistanceMm(stats.rapidDistanceMm)}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Cut distance</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-simulate-cut-distance"
            >
              {formatDistanceMm(stats.cutDistanceMm)}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Tool changes (M6)</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-simulate-tool-changes"
            >
              {stats.toolChangeCount}
            </dd>
          </div>
          <div className="toolpath-stats__row">
            <dt className="toolpath-stats__key">Spindle starts (M3 / M4)</dt>
            <dd
              className="toolpath-stats__value"
              data-testid="workflow-stage-simulate-spindle-starts"
            >
              {stats.spindleStartCount}
            </dd>
          </div>
        </div>
      </dl>
    </section>
  )
}

type Props = {
  projectDir: string | null
  machines: MachineProfile[]
  /** Merged machine-first + project tools for CAM pickers */
  tools?: ToolLibraryFile | null
  /** Project-folder tools.json (may be empty) */
  projectTools?: ToolLibraryFile | null
  /** App userData library for active machine */
  machineTools?: ToolLibraryFile | null
  /** Project active machine id — matches which manufacture setup Make → Generate CAM prefers */
  activeMachineId?: string | null
  onSaveActiveMachineId?: (machineId: string) => void | Promise<void>
  onStatus?: (msg: string) => void
  onAfterSave?: () => void
  panelTab: ManufacturePanelTab
  onPanelTabChange: (t: ManufacturePanelTab) => void
  settings: AppSettings | null
  project: ProjectFile | null
  sliceOut: string
  camOut: string
  camLastHint: string
  importText: string
  onImportTextChange: (value: string) => void
  onSaveSettingsField: (partial: Partial<AppSettings>) => void
  onRunSlice: () => void
  onRunCam: (ctx: { mfg: ManufactureFile; selectedOpIndex: number }) => void | Promise<void>
  onImportTools: (kind: 'csv' | 'json' | 'fusion' | 'fusion_csv', target?: 'project' | 'machine') => void
  onImportToolLibraryFromFile: (target?: 'project' | 'machine') => void | Promise<void>
  onMigrateProjectToolsToMachine?: () => void | Promise<void>
  onGoSettings: () => void
  onGoProject: () => void
  /** After importing a mesh into the project from Manufacture, refresh project sidecars (e.g. `project.json`). */
  onAfterMeshImport?: () => void | Promise<void>
  /**
   * Wave 3a (Mill-4 ribbon) � host-requested workflow stage. When set to a
   * stage valid for the active env, the workspace switches to it and then
   * fires `onRequestedStageHandled` so the host can clear the request. Lets
   * the CAM ribbon commands (openSetup / openProbing / openSimulate / openSend)
   * navigate the workflow-stage strip the workspace owns internally. Optional �
   * absent keeps the workspace fully self-driven (existing behavior).
   */
  requestedStage?: WorkflowStage | null
  onRequestedStageHandled?: () => void
  /**
   * Wave 3a (Mill-4 ribbon) � host-requested new-operation kind (a runtime
   * `cnc_*` op kind). When set, the workspace seeds a new operation of that
   * kind on the active plate and fires `onRequestedNewOpKindHandled`. Drives
   * the ribbon's `newOperation(kind)` action. Optional.
   */
  requestedNewOpKind?: string | null
  onRequestedNewOpKindHandled?: () => void
}

export function ManufactureWorkspace({
  projectDir,
  machines,
  tools,
  projectTools = null,
  machineTools = null,
  activeMachineId = null,
  onSaveActiveMachineId,
  onStatus,
  onAfterSave,
  panelTab,
  onPanelTabChange,
  settings,
  project,
  sliceOut,
  camOut,
  camLastHint,
  importText,
  onImportTextChange,
  onSaveSettingsField,
  onRunSlice,
  onRunCam,
  onImportTools,
  onImportToolLibraryFromFile,
  onMigrateProjectToolsToMachine,
  onGoSettings,
  onGoProject,
  onAfterMeshImport,
  requestedStage = null,
  onRequestedStageHandled,
  requestedNewOpKind = null,
  onRequestedNewOpKindHandled
}: Props) {
  const [mfg, setMfg] = useState<ManufactureFile>(() => emptyManufacture())
  // Gap #7 v1 — active plate id. Initialized lazily so emptyManufacture() always
  // produces a single plate the renderer can show. Updated whenever the underlying
  // mfg is loaded from disk (see useEffect below) and whenever the user clicks
  // the PlateTabs +, x, or rename controls.
  const [activePlateId, setActivePlateId] = useState<string | null>(() => {
    const initial = emptyManufacture()
    return initial.plates?.[0]?.id ?? null
  })
  const [contourCandidates, setContourCandidates] = useState<DerivedContourCandidate[]>([])
  const [nowTickMs, setNowTickMs] = useState<number>(() => Date.now())
  const [opFilter, setOpFilter] = useState<ManufactureOpFilter>(() => readPersistedManufactureOpFilter('all'))
  const [actionableOnly, setActionableOnly] = useState<boolean>(() => readPersistedManufactureActionableOnly(false))
  const [selectedOpIndex, setSelectedOpIndex] = useState(0)
  const [selectedSetupIndex, setSelectedSetupIndex] = useState(0)
  const [fabPlanSidebarCollapsed, setFabPlanSidebarCollapsed] = useState(false)
  const [fitStockPadMm, setFitStockPadMm] = useState(2)
  // Project type chooser (Makera-style launch screen): shown once when manufacture file is empty & no ops
  const [projectTypeChosen, setProjectTypeChosen] = useState(false)
  /** Tracks whether a CAM generation run is in progress (for progress bar). */
  const [camRunning, setCamRunning] = useState(false)
  // Phase 2 [P2-K2-PUSH]/Cycle 349: most recent successfully-sliced
  // FDM G-code path on disk. Set by `runFdmSliceFromOp` after the
  // slicer reports `r.ok`. Threaded through the aux-panel props so
  // the K2 Plus "Send to Printer" button has a concrete file to push
  // to Moonraker. `null` means no slice has succeeded this session.
  const [lastSliceGcodePath, setLastSliceGcodePath] = useState<string | null>(null)

  // CAD V1.5 — TRUE per-layer breakdown of the most recent slice, fetched
  // from the streaming main-process parser via `fab.sliceLayerBreakdown`.
  // `null` while loading / when no slice has run / when the IPC call fails.
  // The fetch effect is owned by the workspace (not the body) because the
  // body is exported as a pure component for render-pin tests. Session-only
  // — never persisted.
  const [sliceLayerBreakdown, setSliceLayerBreakdown] =
    useState<FdmLayerBreakdownResult | null>(null)

  // Selected layer index for the Preview stage scrubber (1-based). When
  // null, the body falls back to the top layer (highest Z).
  const [selectedPreviewLayer, setSelectedPreviewLayer] = useState<number | null>(null)

  /**
   * UX MOVE 4 — Workflow-stage tab state. The env is derived from the active
   * machine's `kind` (`'fdm'` for K2 Plus, `'cnc'` for Laguna / Carvera). The
   * default stage is `'prepare'` for FDM and `'setup'` for CNC. We seed lazily
   * so the first render shows the correct default; an effect below switches
   * the stage when the operator changes machines and the current stage is
   * not valid for the new env.
   */
  const initialWorkflowEnv: WorkflowEnv = (() => {
    const m = machines.find((x) => x.id === project?.activeMachineId)
    return m?.kind === 'fdm' ? 'fdm' : 'cnc'
  })()
  const [workflowStage, setWorkflowStage] = useState<WorkflowStage>(() =>
    defaultWorkflowStageFor(initialWorkflowEnv)
  )

  const fab = window.fab

  // Wave-3b (K2 FDM) — editable PROCESS overrides for the next slice.
  // Hydrated from AppSettings.k2ProcessOverridesJson (persisted) and edited
  // via the FdmProcessPanel in the Device stage. The pure mapping +
  // input-side temperature clamp live in shared/fdm-process-overrides.ts;
  // this state is just the form model. An effect below resyncs it whenever
  // the persisted settings string changes (e.g. on project load).
  const [processOverrides, setProcessOverrides] = useState<FdmProcessOverrides>(() =>
    parseFdmProcessOverrides(settings?.k2ProcessOverridesJson)
  )
  // Per-plate slice status for the PlateTabs status pills + the device
  // stage's live controls. Session-only; keyed by plate id.
  const [plateSliceStatus, setPlateSliceStatus] = useState<Record<string, 'idle' | 'slicing' | 'done' | 'error'>>({})

  /**
   * Gap #7 v1 — "effective" manufacture file projected onto the active plate.
   *
   * The existing setup/op list components (`MakeraFunctionsPanel`,
   * `ManufactureOperationList`, `ManufactureSetupList`,
   * `ManufactureCamSimulationPanel`, etc.) all read `mfg.setups` / `mfg.operations`
   * at the top level — they predate the plate concept. To avoid touching every
   * consumer this cycle, we synthesize an mfg whose top-level setups + operations
   * mirror the active plate's content. Writes still route back into the active
   * plate via the helpers in `plate-state.ts`.
   */
  const effectiveMfg = useMemo(
    () => viewMfgAsActivePlate(mfg, activePlateId),
    [mfg, activePlateId]
  )

  const meshRelPathsForStaleCheck = useMemo(() => {
    const u = new Set<string>()
    for (const op of effectiveMfg.operations) {
      const sm = op.sourceMesh?.trim().replace(/^[\\/]+/, '')
      if (sm) u.add(sm)
    }
    return [...u].sort()
  }, [effectiveMfg.operations])

  const [camStaleMeshRelativePaths, setCamStaleMeshRelativePaths] = useState<string[]>([])

  // ── Effects ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    setSelectedOpIndex((i) => {
      if (effectiveMfg.operations.length === 0) return 0
      return Math.min(Math.max(0, i), effectiveMfg.operations.length - 1)
    })
  }, [effectiveMfg.operations.length])

  useEffect(() => {
    if (!projectDir) {
      const empty = emptyManufacture()
      setMfg(empty)
      setActivePlateId(empty.plates?.[0]?.id ?? null)
      return
    }
    void fab
      .manufactureLoad(projectDir)
      .then((loaded) => {
        setMfg(loaded)
        // Gap #7 v1: snap the active plate to the first plate of the loaded mfg.
        // Falls back to null when (defensively) plates is missing — the PlateTabs
        // strip itself synthesizes a Default plate via plate-state.getPlates.
        const plates = getPlates(loaded)
        setActivePlateId(plates[0]?.id ?? null)
      })
      .catch((e) => {
        onStatus?.(e instanceof Error ? e.message : String(e))
        const empty = emptyManufacture()
        setMfg(empty)
        setActivePlateId(empty.plates?.[0]?.id ?? null)
      })
  }, [fab, projectDir])

  useEffect(() => {
    if (!projectDir) {
      setContourCandidates([])
      return
    }
    void loadContourCandidates()
  }, [projectDir])

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTickMs(Date.now())
    }, 30000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    writePersistedManufactureOpFilter(opFilter)
  }, [opFilter])

  useEffect(() => {
    writePersistedManufactureActionableOnly(actionableOnly)
  }, [actionableOnly])

  // CAD V1.5 — fetch the TRUE per-layer breakdown for the Layer preview
  // stage. Runs whenever the slice path changes. The main-process parser
  // streams the file line-by-line (constant memory — a tall K2 print is
  // 1,500+ layers / 5–30 MB), so the renderer never loads the raw G-code
  // text. The body is purely presentational; the breakdown flows through
  // props. Degrades gracefully: on IPC failure or a no-op result the body
  // falls back to its EmptyState.
  useEffect(() => {
    if (!lastSliceGcodePath?.trim()) {
      setSliceLayerBreakdown(null)
      setSelectedPreviewLayer(null)
      return
    }
    let cancelled = false
    void fab
      .sliceLayerBreakdown({ gcodePath: lastSliceGcodePath })
      .then((r) => {
        if (cancelled) return
        setSliceLayerBreakdown(r.ok ? r.result : null)
        setSelectedPreviewLayer(null)
      })
      .catch(() => {
        if (cancelled) return
        // Silently drop — body falls back to EmptyState when no breakdown
        // is available.
        setSliceLayerBreakdown(null)
        setSelectedPreviewLayer(null)
      })
    return () => {
      cancelled = true
    }
  }, [fab, lastSliceGcodePath])

  useEffect(() => {
    if (!projectDir?.trim() || meshRelPathsForStaleCheck.length === 0) {
      setCamStaleMeshRelativePaths([])
      return
    }
    let cancelled = false
    void fab
      .camSourceStaleVersusOutput(projectDir, meshRelPathsForStaleCheck)
      .then((r) => {
        if (cancelled || r.ok !== true) return
        setCamStaleMeshRelativePaths(r.staleRelativePaths)
      })
      .catch(() => {
        if (!cancelled) setCamStaleMeshRelativePaths([])
      })
    return () => {
      cancelled = true
    }
  }, [projectDir, meshRelPathsForStaleCheck.join('\0'), camOut])

  // ── Data loading ──────────────────────────────────────────────────────────────

  async function loadContourCandidates(): Promise<void> {
    if (!projectDir) return
    const d = await fab.designLoad(projectDir)
    if (!d) {
      setContourCandidates([])
      return
    }
    setContourCandidates(listContourCandidatesFromDesign(d))
  }

  // ── Save ──────────────────────────────────────────────────────────────────────

  const save = useCallback(async () => {
    if (!projectDir) return
    try {
      await fab.manufactureSave(projectDir, JSON.stringify(mfg))
      onStatus?.('Manufacture plan saved.')
      onAfterSave?.()
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    }
  }, [fab, projectDir, mfg, onStatus, onAfterSave])

  // ── FDM slice from operation ──────────────────────────────────────────────────

  /**
   * 2026-05-27 OrcaSlicer pivot (task #9). Calls the new `slice:orca`
   * IPC handler with the active machine + K2 quality preset from
   * settings. On success records the absolute output path in
   * `lastSliceGcodePath` so the SliceManufacturePanel's Send-to-K2
   * button (Phase 2 [P2-K2-PUSH]/Cycle 349) has a concrete file to
   * push to Moonraker.
   *
   * Op-shape contract preserved from the pre-pivot CuraEngine path:
   *   - Op must be `kind === 'fdm_slice'`.
   *   - Op must declare a `sourceMesh` (project-relative path).
   *   - Output lands at `<projectDir>/output/slice.gcode`.
   */
  async function runFdmSliceFromOp(opIndex: number): Promise<void> {
    if (!projectDir) {
      onStatus?.('Open a project before running an FDM slice.')
      return
    }
    const op = effectiveMfg.operations[opIndex]
    if (!op || op.kind !== 'fdm_slice') {
      onStatus?.('Selected operation is not an FDM slice.')
      return
    }
    if (!activeMachineId) {
      onStatus?.('Select an FDM machine before running an FDM slice.')
      return
    }
    if (!op.sourceMesh || op.sourceMesh.trim().length === 0) {
      onStatus?.('Operation is missing a source mesh.')
      return
    }
    const stlPath = `${projectDir}/${op.sourceMesh}`
    const out = `${projectDir}/output/slice.gcode`
    // Wave-3b: thread the editable PROCESS overrides into the slice. The
    // pure builder clamps temperatures to the K2 ceiling on the way out
    // (the main-process planOrcaOverrides clamps again, and the pre-upload
    // validateGcodeFileTemps gate is the final backstop) and never emits
    // G-code itself. `overrides: null` ⇒ field omitted ⇒ byte-identical
    // to a no-override slice.
    const { overrides, warnings: overrideWarnings } = buildFdmSliceOverrides(processOverrides)
    for (const w of overrideWarnings) onStatus?.(w)
    const r = await fab.sliceOrca({
      stlPath,
      outPath: out,
      machineId: activeMachineId,
      qualityPresetId: settings?.k2QualityPresetId,
      filamentId: settings?.activeFilamentId,
      ...(overrides ? { overrides } : {})
    })
    if (r.ok) {
      setLastSliceGcodePath(out)
      // Surface any per-slice override clamp warnings (e.g. a requested
      // temperature above the K2 ceiling was reduced) so a clamp is never
      // silent — the operator sees exactly what was capped before sending.
      const warn = r.warnings && r.warnings.length > 0 ? ` (${r.warnings.join('; ')})` : ''
      onStatus?.(`Sliced via OrcaSlicer → ${out}${warn}`)
    } else {
      onStatus?.(`Slice failed (${r.error})${r.hint ? `: ${r.hint}` : ''}`)
    }
  }

  // Wave-3b — resync the editable PROCESS overrides when the persisted
  // settings string changes (project load / external edit). Keeps the
  // form model in step with disk without clobbering in-flight edits on
  // unrelated re-renders (the dependency is the serialized string only).
  useEffect(() => {
    setProcessOverrides(parseFdmProcessOverrides(settings?.k2ProcessOverridesJson))
  }, [settings?.k2ProcessOverridesJson])

  // Wave-3b — persist an edit from the FdmProcessPanel. Mirrors into local
  // state immediately (so the panel is responsive) AND serializes to
  // AppSettings.k2ProcessOverridesJson via the parent. A cleared form
  // serializes to undefined so the setting is removed rather than stored
  // as an empty object.
  const handleChangeProcessOverrides = useCallback(
    (next: FdmProcessOverrides): void => {
      setProcessOverrides(next)
      const json = serializeFdmProcessOverrides(next)
      onSaveSettingsField({ k2ProcessOverridesJson: json ?? undefined })
    },
    [onSaveSettingsField]
  )

  // Wave-3b — persist a new K2 quality-preset baseline from the process
  // panel (same field the ProfileStack / Slice panel dropdowns write).
  const handleChangeQualityPreset = useCallback(
    (id: K2PlusQualityPresetId): void => {
      onSaveSettingsField({ k2QualityPresetId: id })
    },
    [onSaveSettingsField]
  )

  // Wave-3b — slice a specific plate by id (PlateTabs split-button primary).
  // Resolves the first FDM-sliceable op on that plate (an op with a source
  // mesh; fdm_slice preferred) and slices its source mesh DIRECTLY via the
  // proven `slice:orca` path (same override clamp + Send-to-K2 recording as
  // runFdmSliceFromOp). It does NOT route through runFdmSliceFromOp because
  // that reads the active-plate projection, which lags a just-issued plate
  // switch by one render. Defensive: non-FDM machine, no project/machine, or
  // no sliceable op ⇒ status + return before any IPC. No G-code emitted here.
  const slicePlateById = useCallback(
    async (plateId: string): Promise<void> => {
      const machineForSlice = machines.find((m) => m.id === activeMachineId)
      if (machineForSlice && machineForSlice.kind !== 'fdm') {
        onStatus?.('Slice is for the FDM printer (K2 Plus). Use Generate toolpath for CNC machines.')
        return
      }
      const plate = getPlates(mfg).find((pl) => pl.id === plateId)
      if (!plate) {
        onStatus?.('Plate not found.')
        return
      }
      const sliceOps = plate.operations
        .map((op, idx) => ({ op, idx }))
        .filter(({ op }) => op.kind === 'fdm_slice' && (op.sourceMesh?.trim().length ?? 0) > 0)
      const target =
        sliceOps[0] ??
        plate.operations
          .map((op, idx) => ({ op, idx }))
          .find(({ op }) => (op.sourceMesh?.trim().length ?? 0) > 0)
      if (!target) {
        onStatus?.('No FDM slice operation with a source mesh on this plate. Add one in the job tree.')
        return
      }
      if (!projectDir) {
        onStatus?.('Open a project before slicing.')
        return
      }
      if (!activeMachineId) {
        onStatus?.('Select an FDM machine before slicing.')
        return
      }
      // Reflect the slice on the plate strip + reveal the plate so the
      // operator sees which plate is slicing. Slicing itself reads the
      // resolved op's source mesh DIRECTLY (below) rather than via the
      // active-plate projection, so it is correct even before the
      // setActivePlateId state settles on the next render.
      if (activePlateId !== plateId) handleSelectPlate(plateId)
      setPlateSliceStatus((s) => ({ ...s, [plateId]: 'slicing' }))
      // Wave-3b: same override clamp + warning surfacing as runFdmSliceFromOp.
      const { overrides, warnings: overrideWarnings } = buildFdmSliceOverrides(processOverrides)
      for (const w of overrideWarnings) onStatus?.(w)
      const stlPath = `${projectDir}/${target.op.sourceMesh}`
      const out = `${projectDir}/output/slice.gcode`
      try {
        const r = await fab.sliceOrca({
          stlPath,
          outPath: out,
          machineId: activeMachineId,
          qualityPresetId: settings?.k2QualityPresetId,
          filamentId: settings?.activeFilamentId,
          ...(overrides ? { overrides } : {})
        })
        if (r.ok) {
          setLastSliceGcodePath(out)
          const warn = r.warnings && r.warnings.length > 0 ? ` (${r.warnings.join('; ')})` : ''
          onStatus?.(`Sliced ${plate.label} via OrcaSlicer → ${out}${warn}`)
          setPlateSliceStatus((s) => ({ ...s, [plateId]: 'done' }))
        } else {
          onStatus?.(`Slice failed (${r.error})${r.hint ? `: ${r.hint}` : ''}`)
          setPlateSliceStatus((s) => ({ ...s, [plateId]: 'error' }))
        }
      } catch (e) {
        onStatus?.(`Slice failed: ${e instanceof Error ? e.message : String(e)}`)
        setPlateSliceStatus((s) => ({ ...s, [plateId]: 'error' }))
      }
    },
    // handleSelectPlate is a stable component fn; mfg + activePlateId +
    // machines + activeMachineId + projectDir + settings + processOverrides
    // are the live inputs the slice reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mfg, activePlateId, machines, activeMachineId, projectDir, settings, processOverrides]
  )

  // Wave-3b — slice every plate sequentially (PlateTabs dropdown caret).
  const sliceAllPlatesSequential = useCallback(
    async (): Promise<void> => {
      for (const plate of getPlates(mfg)) {
        await slicePlateById(plate.id)
      }
    },
    [mfg, slicePlateById]
  )

  // ── Setup mutations ───────────────────────────────────────────────────────────

  function addSetup(): void {
    const id = crypto.randomUUID()
    const activePlate = getActivePlate(mfg, activePlateId)
    const st: ManufactureSetup = {
      id,
      label: `Setup ${activePlate.setups.length + 1}`,
      machineId: machines[0]?.id ?? 'laguna-swift-5x10',
      workCoordinateIndex: 1,
      stock: { kind: 'box', x: 200, y: 200, z: 25 }
    }
    setMfg((m) => updateActivePlate(m, activePlateId, (p) => ({ ...p, setups: [...p.setups, st] })))
  }

  function updateSetup(i: number, patch: Partial<ManufactureSetup>): void {
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => {
        const setups = [...p.setups]
        setups[i] = { ...setups[i]!, ...patch }
        return { ...p, setups }
      })
    )
  }

  function updateSetupStock(i: number, patch: Partial<NonNullable<ManufactureSetup['stock']>>): void {
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => {
        const setups = [...p.setups]
        const cur = setups[i]!
        const stock = { kind: 'box' as const, x: 200, y: 200, z: 25, ...cur.stock, ...patch }
        setups[i] = { ...cur, stock }
        return { ...p, setups }
      })
    )
  }

  function removeSetup(i: number): void {
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => ({ ...p, setups: p.setups.filter((_, j) => j !== i) }))
    )
  }

  function updateSetupWcsOrigin(si: number, point: WcsOriginPoint): void {
    updateSetup(si, { wcsOriginPoint: point })
  }

  function updateSetupAxisMode(si: number, mode: '3axis' | '4axis' | '5axis'): void {
    updateSetup(si, { axisMode: mode })
  }

  // Wave 3a � persist the 4-axis orient-gizmo placement on the setup. The
  // gizmo emits a viewer-space Placement; run-cam-for-op sends it to the
  // 4-axis engine in place of the historical hard-coded identity transform.
  function updateSetupRotaryPlacement(si: number, placement: Placement): void {
    updateSetup(si, { rotaryPlacement: placement })
  }

  // Wave 3a � replace the active plate's entire setups array (Multi-Setup
  // Wizard auto-assign WCS). Routes through the plate-state helper so the
  // write lands on the active plate, mirroring the other setup mutations.
  function replaceSetups(next: ManufactureSetup[]): void {
    setMfg((m) => updateActivePlate(m, activePlateId, (p) => ({ ...p, setups: next })))
  }

  // Wave 3a � append a single setup (Multi-Setup Wizard flip suggestion).
  function appendSetup(setup: ManufactureSetup): void {
    setMfg((m) => updateActivePlate(m, activePlateId, (p) => ({ ...p, setups: [...p.setups, setup] })))
  }

  function updateSetupMaterialType(si: number, mat: StockMaterialType | undefined): void {
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => {
        const setups = [...p.setups]
        const cur = setups[si]!
        const stock = { kind: 'box' as const, x: 200, y: 200, z: 25, ...cur.stock, materialType: mat }
        setups[si] = { ...cur, stock }
        return { ...p, setups }
      })
    )
  }

  // ── Operation mutations ───────────────────────────────────────────────────────

  function addOp(): void {
    const id = crypto.randomUUID()
    const activePlate = getActivePlate(mfg, activePlateId)
    const op: ManufactureOperation = {
      id,
      kind: 'cnc_parallel',
      label: `Op ${activePlate.operations.length + 1}`,
      sourceMesh: 'assets/design-sample.stl'
    }
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => ({ ...p, operations: [...p.operations, op] }))
    )
  }

  // Wave 3a (Mill-4 ribbon) � seed a new operation of a specific runtime op
  // kind (the ribbon's `newOperation(kind)` action passes a `cnc_*` kind via
  // CAM_COMMAND_OP_KIND). Mirrors `addOp` but takes the kind; the kind is
  // validated against the schema's known kinds by the caller (cam-commands).
  function addOpOfKind(kind: ManufactureOperation['kind']): void {
    const id = crypto.randomUUID()
    const activePlate = getActivePlate(mfg, activePlateId)
    const op: ManufactureOperation = {
      id,
      kind,
      label: `Op ${activePlate.operations.length + 1}`,
      sourceMesh: 'assets/design-sample.stl'
    }
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => ({ ...p, operations: [...p.operations, op] }))
    )
    setSelectedOpIndex(activePlate.operations.length)
  }

  function updateOp(i: number, patch: Partial<ManufactureOperation>): void {
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => {
        const ops = [...p.operations]
        ops[i] = { ...ops[i]!, ...patch }
        return { ...p, operations: ops }
      })
    )
  }

  function removeOp(i: number): void {
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => ({
        ...p,
        operations: p.operations.filter((_, j) => j !== i)
      }))
    )
  }

  /**
   * Gap #9 — Laguna nesting: apply the placements returned from the
   * `nesting:nest-polygons` handler back onto each matching cnc_contour op.
   *
   * Schema constraint: `op.params` values must be `JsonSafeValue`
   * (number | string | boolean | null | JsonSafeValue[]) — no plain objects.
   * To stay additive (existing saved projects parse cleanly), the placement
   * is stored as four scalar fields on `params`:
   *
   *   placementXMm:        number     — sheet-coordinate X offset (mm)
   *   placementYMm:        number     — sheet-coordinate Y offset (mm)
   *   placementRotationDeg: number    — 0 | 90 | 180 | 270
   *   placementNestVersion: string    — 'v1' (lets v2 layouts diff later)
   *
   * Downstream CAM runners + post-processors can read these fields to offset
   * the contour toolpath; ops without these fields are emitted at origin as
   * before. Safety Rule 1: no G-code is emitted here — placements only.
   * Only cnc_contour ops are touched; other op kinds pass through unchanged.
   */
  function applyNestingPlacements(placements: ReadonlyArray<{
    partId: string
    xMm: number
    yMm: number
    rotationDeg: 0 | 90 | 180 | 270
  }>): void {
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (plate) => {
        const byId = new Map(placements.map((pl) => [pl.partId, pl]))
        const ops = plate.operations.map((op) => {
          const pl = byId.get(op.id)
          if (!pl) return op
          if (op.kind !== 'cnc_contour') return op
          const baseParams: Record<string, unknown> = { ...(op.params ?? {}) }
          baseParams.placementXMm = pl.xMm
          baseParams.placementYMm = pl.yMm
          baseParams.placementRotationDeg = pl.rotationDeg
          baseParams.placementNestVersion = 'v1'
          return { ...op, params: baseParams }
        })
        return { ...plate, operations: ops }
      })
    )
  }

  function moveOpUp(i: number): void {
    if (i <= 0) return
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => {
        const ops = [...p.operations]
        const tmp = ops[i - 1]!
        ops[i - 1] = ops[i]!
        ops[i] = tmp
        return { ...p, operations: ops }
      })
    )
    setSelectedOpIndex((prev) => (prev === i ? i - 1 : prev === i - 1 ? i : prev))
  }

  function moveOpDown(i: number): void {
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => {
        if (i >= p.operations.length - 1) return p
        const ops = [...p.operations]
        const tmp = ops[i + 1]!
        ops[i + 1] = ops[i]!
        ops[i] = tmp
        return { ...p, operations: ops }
      })
    )
    setSelectedOpIndex((prev) => (prev === i ? i + 1 : prev === i + 1 ? i : prev))
  }

  // ── Operation parameter helpers ───────────────────────────────────────────────

  function setToolDiameterMm(i: number, raw: string): void {
    const op = effectiveMfg.operations[i]!
    const base: Record<string, unknown> = { ...(op.params ?? {}) }
    const t = raw.trim()
    if (t === '') {
      delete base.toolDiameterMm
    } else {
      const n = Number.parseFloat(t)
      if (Number.isFinite(n) && n > 0) base.toolDiameterMm = n
      else delete base.toolDiameterMm
    }
    updateOp(i, { params: Object.keys(base).length ? base : undefined })
  }

  function setToolFromLibrary(i: number, toolId: string): void {
    const op = effectiveMfg.operations[i]!
    const base: Record<string, unknown> = { ...(op.params ?? {}) }
    if (!toolId) {
      delete base.toolId
    } else {
      base.toolId = toolId
      const rec = tools?.tools.find((t) => t.id === toolId)
      if (rec) {
        base.toolDiameterMm = rec.diameterMm
        const hasFeed =
          typeof base.feedMmMin === 'number' && Number.isFinite(base.feedMmMin) && base.feedMmMin > 0
        const hint = estimateFeedMmMinFromTool(rec)
        if (!hasFeed && hint != null) base.feedMmMin = hint
      }
    }
    updateOp(i, { params: Object.keys(base).length ? base : undefined })
  }

  function setCutParam(i: number, key: string, raw: string, mode: 'nonzero' | 'positive' | 'nonnegative'): void {
    const op = effectiveMfg.operations[i]!
    const base: Record<string, unknown> = { ...(op.params ?? {}) }
    const t = raw.trim()
    if (t === '') {
      delete base[key]
    } else {
      const n = Number.parseFloat(t)
      if (!Number.isFinite(n)) {
        delete base[key]
      } else if (mode === 'nonzero') {
        if (n === 0) delete base[key]
        else base[key] = n
      } else if (mode === 'positive') {
        if (n <= 0) delete base[key]
        else base[key] = n
      } else if (n < 0) {
        delete base[key]
      } else {
        base[key] = n
      }
    }
    updateOp(i, { params: Object.keys(base).length ? base : undefined })
  }

  function setGeometryJson(i: number, key: 'contourPoints' | 'drillPoints', raw: string): void {
    const op = effectiveMfg.operations[i]!
    const base: Record<string, unknown> = { ...(op.params ?? {}) }
    const t = raw.trim()
    if (t === '') {
      delete base[key]
      updateOp(i, { params: Object.keys(base).length ? base : undefined })
      return
    }
    try {
      const parsed = JSON.parse(t) as unknown
      if (Array.isArray(parsed)) {
        base[key] = parsed
        updateOp(i, { params: base })
      }
    } catch {
      // Keep last valid JSON until user input is valid again.
    }
  }

  async function deriveOpGeometryFromSketch(i: number): Promise<void> {
    if (!projectDir) return
    const op = effectiveMfg.operations[i]
    if (!op) return
    const d = await fab.designLoad(projectDir)
    if (!d) {
      onStatus?.('No design/sketch.json found to derive geometry from.')
      return
    }
    const base: Record<string, unknown> = { ...(op.params ?? {}) }
    if (op.kind === 'cnc_4axis_contour') {
      const sourceId = typeof base['contourSourceId'] === 'string' ? base['contourSourceId'] : undefined
      const selected = sourceId ? listContourCandidatesFromDesign(d).find((c) => c.sourceId === sourceId) : undefined
      const contour = deriveContourPointsFromDesign(d, sourceId)
      if (contour.length < 2) {
        onStatus?.('No usable sketch profile for 4-axis contour wrap (need ≥2 points).')
        return
      }
      base.contourPoints = contour
      base.wrapMode = 'contour'
      if (selected) {
        base.contourSourceLabel = selected.label
        base.contourSourceSignature = selected.signature
      } else {
        delete base.contourSourceLabel
        delete base.contourSourceSignature
      }
      base.contourDerivedAt = new Date().toISOString()
      updateOp(i, { params: base })
      onStatus?.(`4-axis wrap: ${contour.length} vertices from sketch (wrap mode set to Contour).`)
      return
    }
    if (op.kind === 'cnc_contour' || op.kind === 'cnc_pocket') {
      const sourceId = typeof base['contourSourceId'] === 'string' ? base['contourSourceId'] : undefined
      const selected = sourceId ? listContourCandidatesFromDesign(d).find((c) => c.sourceId === sourceId) : undefined
      const contour = deriveContourPointsFromDesign(d, sourceId)
      if (contour.length < 3) {
        onStatus?.('No closed sketch profile found for contour/pocket derive.')
        return
      }
      base.contourPoints = contour
      if (selected) {
        base.contourSourceLabel = selected.label
        base.contourSourceSignature = selected.signature
      } else {
        delete base.contourSourceLabel
        delete base.contourSourceSignature
      }
      base.contourDerivedAt = new Date().toISOString()
      updateOp(i, { params: base })
      onStatus?.(`Derived contourPoints (${contour.length} vertices) from selected sketch profile.`)
      return
    }
    if (op.kind === 'cnc_drill') {
      const drill = deriveDrillPointsFromDesign(d)
      if (drill.length === 0) {
        onStatus?.('No circles found in sketch to derive drill points.')
        return
      }
      base.drillPoints = drill
      base.drillDerivedAt = new Date().toISOString()
      updateOp(i, { params: base })
      onStatus?.(`Derived drillPoints (${drill.length} holes) from sketch circles.`)
    }
  }

  // ── Derived / computed values ─────────────────────────────────────────────────

  const readinessCounts = effectiveMfg.operations.reduce(
    (acc, op) => {
      const r = opReadiness(op, contourCandidates).label
      acc[r] = (acc[r] ?? 0) + 1
      return acc
    },
    { ready: 0, 'missing geometry': 0, 'stale geometry': 0, suppressed: 0, 'non-cam': 0 } as Record<
      'ready' | 'missing geometry' | 'stale geometry' | 'suppressed' | 'non-cam',
      number
    >
  )

  const filteredOps = effectiveMfg.operations.filter((op) => {
    const label = opReadiness(op, contourCandidates).label
    if (actionableOnly) return label === 'missing geometry' || label === 'stale geometry'
    if (opFilter === 'all') return true
    return label === opFilter
  })
  const activeFilterLabel = actionableOnly
    ? 'actionable only'
    : opFilter === 'all'
      ? 'all'
      : opFilter === 'non-cam'
        ? 'not CAM'
        : opFilter

  function handlePanelKeydown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const t = e.target as HTMLElement | null
    const tag = t?.tagName?.toLowerCase() ?? ''
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return
    const k = e.key.toLowerCase()
    if (k === 'a') {
      setActionableOnly(false)
      setOpFilter('all')
      e.preventDefault()
    } else if (k === 'm') {
      setActionableOnly(false)
      setOpFilter('missing geometry')
      e.preventDefault()
    } else if (k === 's') {
      setActionableOnly(false)
      setOpFilter('stale geometry')
      e.preventDefault()
    } else if (k === 'u') {
      setActionableOnly(false)
      setOpFilter('suppressed')
      e.preventDefault()
    } else if (k === 'f') {
      setActionableOnly((v) => !v)
      e.preventDefault()
    } else if (k === 'c') {
      setActionableOnly(false)
      setOpFilter('all')
      e.preventDefault()
    }
  }

  const camMachine = resolveManufactureCamMachine(effectiveMfg, machines)

  const camRunCncMachineId = useMemo(() => {
    const cnc = machines.filter((m) => m.kind === 'cnc')
    if (cnc.length === 0) return undefined
    if (activeMachineId && cnc.some((m) => m.id === activeMachineId)) return activeMachineId
    return cnc[0]?.id
  }, [machines, activeMachineId])

  const camResolvedSetup = useMemo(
    () => resolveManufactureSetupForCam(effectiveMfg, camRunCncMachineId),
    [effectiveMfg, camRunCncMachineId]
  )

  const camResolvedSetupIdx = useMemo(() => {
    if (!camResolvedSetup) return 0
    const i = effectiveMfg.setups.findIndex((s) => s.id === camResolvedSetup.id)
    return i >= 0 ? i : 0
  }, [effectiveMfg.setups, camResolvedSetup])

  const camResolvedMachineName = useMemo(() => {
    if (!camResolvedSetup) return undefined
    return machines.find((m) => m.id === camResolvedSetup.machineId)?.name ?? camResolvedSetup.machineId
  }, [machines, camResolvedSetup])

  const activeMachine = useMemo(
    () => machines.find((x) => x.id === project?.activeMachineId),
    [machines, project?.activeMachineId]
  )

  /**
   * UX MOVE 4 — Active workflow env, derived from the active machine kind.
   * FDM → K2 Plus; CNC → Laguna Swift / Makera Carvera (3-axis + 4-axis).
   * Falls back to CNC when no machine is selected so the operator still sees
   * a coherent stage strip (Setup / Toolpaths / Simulate / Send).
   */
  const workflowEnv: WorkflowEnv = activeMachine?.kind === 'fdm' ? 'fdm' : 'cnc'

  /**
   * When the operator switches between FDM and CNC machines, snap the stage
   * back to the env's default if the current stage isn't valid for the new
   * env. This keeps the tab strip from showing a stale `aria-selected` state
   * (e.g. "Prepare" highlighted under a CNC machine).
   */
  useEffect(() => {
    const fdmIds = new Set<WorkflowStage>(FDM_STAGES.map((s) => s.id))
    const cncIds = new Set<WorkflowStage>(CNC_STAGES.map((s) => s.id))
    const valid = workflowEnv === 'fdm' ? fdmIds : cncIds
    if (!valid.has(workflowStage)) {
      setWorkflowStage(defaultWorkflowStageFor(workflowEnv))
    }
  }, [workflowEnv, workflowStage])

  // Wave 3a (Mill-4 ribbon) � apply a host-requested workflow stage. The CAM
  // ribbon commands set `requestedStage`; we honor it only when it is valid
  // for the active env (so e.g. a stale 'probing' request from a CNC ribbon
  // can't strand an FDM machine), then fire the consumed callback so the host
  // clears the one-shot request.
  useEffect(() => {
    if (!requestedStage) return
    const fdmIds = new Set<WorkflowStage>(FDM_STAGES.map((s) => s.id))
    const cncIds = new Set<WorkflowStage>(CNC_STAGES.map((s) => s.id))
    const valid = workflowEnv === 'fdm' ? fdmIds : cncIds
    if (valid.has(requestedStage)) setWorkflowStage(requestedStage)
    onRequestedStageHandled?.()
  }, [requestedStage, workflowEnv, onRequestedStageHandled])

  // Wave 3a (Mill-4 ribbon) � seed a host-requested new operation kind, then
  // clear the one-shot request. Navigates to the Plan tab so the freshly
  // seeded op is visible in the operation list/editor.
  useEffect(() => {
    if (!requestedNewOpKind) return
    addOpOfKind(requestedNewOpKind as ManufactureOperation['kind'])
    onPanelTabChange('plan')
    onRequestedNewOpKindHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on request change
  }, [requestedNewOpKind])

  /**
   * Gap #9 — Laguna sheet size derived from the first setup whose machineId
   * matches the active Laguna profile. Falls back to null so the panel uses
   * the canonical 1524 × 3048 mm default. Only the box stock kind has X/Y.
   */
  const lagunaSheetSizeMm = useMemo<{ widthMm: number | null; heightMm: number | null }>(() => {
    if (activeMachineId !== 'laguna-swift-5x10') return { widthMm: null, heightMm: null }
    const lagunaSetup = effectiveMfg.setups.find((s) => s.machineId === 'laguna-swift-5x10')
    if (!lagunaSetup?.stock || lagunaSetup.stock.kind !== 'box') {
      return { widthMm: null, heightMm: null }
    }
    return {
      widthMm: typeof lagunaSetup.stock.x === 'number' ? lagunaSetup.stock.x : null,
      heightMm: typeof lagunaSetup.stock.y === 'number' ? lagunaSetup.stock.y : null
    }
  }, [effectiveMfg.setups, activeMachineId])

  /** CNC profile for CAM simulation envelope (same id logic as Make → Generate CAM). */
  const camSimMachine = useMemo(
    () =>
      camRunCncMachineId
        ? machines.find((m) => m.id === camRunCncMachineId && m.kind === 'cnc')
        : undefined,
    [machines, camRunCncMachineId]
  )

  const assetStlOptions = useMemo(() => {
    const paths = new Set<string>()
    for (const m of project?.meshes ?? []) {
      if (m.toLowerCase().endsWith('.stl')) paths.add(m.replace(/\\/g, '/'))
    }
    for (const h of project?.importHistory ?? []) {
      const p = h.assetRelativePath.replace(/\\/g, '/')
      if (p.toLowerCase().endsWith('.stl')) paths.add(p)
    }
    return [...paths].sort((a, b) => a.localeCompare(b))
  }, [project?.meshes, project?.importHistory])

  // ── Async actions ─────────────────────────────────────────────────────────────

  async function importMeshForSelectedOp(): Promise<void> {
    if (!projectDir) return
    const py = settings?.pythonPath?.trim() || 'python'
    const filters = [{ name: 'Mesh', extensions: [...MESH_IMPORT_FILE_EXTENSIONS] }]
    const path = await fab.dialogOpenFile(filters, projectDir)
    if (!path) return
    const r = await fab.assetsImportMesh(projectDir, path, py)
    if (!r.ok) {
      onStatus?.(r.error + (r.detail ? ` — ${r.detail}` : ''))
      return
    }
    if (effectiveMfg.operations.length === 0) {
      onStatus?.('Add an operation first, then import a mesh to bind it.')
      return
    }
    const relPath = r.relativePath.replace(/\\/g, '/')
    setMfg((m) =>
      updateActivePlate(m, activePlateId, (p) => {
        const idx = Math.min(selectedOpIndex, p.operations.length - 1)
        const ops = [...p.operations]
        ops[idx] = { ...ops[idx]!, sourceMesh: relPath }
        return { ...p, operations: ops }
      })
    )
    onStatus?.(`Imported mesh → ${relPath}`)
    await onAfterMeshImport?.()
  }

  async function exportManufactureSetupSheet(): Promise<void> {
    if (!projectDir) {
      onStatus?.('Open a project first.')
      return
    }
    const name = project?.name?.trim() || 'Manufacture'
    const sep = projectDir.includes('\\') ? '\\' : '/'
    const gcodePath = `${projectDir}${sep}output${sep}cam.nc`
    let gcodeStats = null
    let gcodeText: string | null = null
    try {
      const text = await fab.readTextFile(gcodePath)
      gcodeText = text
      gcodeStats = parseGcodeStats(text)
    } catch {
      /* optional */
    }
    const rel = effectiveMfg.operations.find((o) => o.sourceMesh?.trim())?.sourceMesh?.trim() ?? null
    const stlAbs = rel ? `${projectDir}${sep}${rel.replace(/\//g, sep)}` : null
    const job = buildSetupSheetJobFromManufacture({
      projectName: name,
      mfg: effectiveMfg,
      camMachineId: camRunCncMachineId,
      gcodePath,
      sourceStlPath: stlAbs
    })
    const machineProf = camRunCncMachineId ? machines.find((m) => m.id === camRunCncMachineId) ?? null : null
    const toolList: ToolRecord[] = tools?.tools ?? projectTools?.tools ?? machineTools?.tools ?? []
    const html = generateSetupSheet({
      job,
      machine: machineProf,
      material: null,
      tools: toolList,
      gcodeStats,
      gcodeText
    })
    const fileName = `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}_setup_sheet.html`
    const outPath = `${projectDir}${sep}output${sep}${fileName}`
    try {
      await fab.fsWriteText(outPath, html)
      await fab.shellOpenPath(outPath)
      onStatus?.(`Setup sheet saved: ${fileName}`)
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    }
  }

  async function fitStockFromPartOnSetup(setupIndex: number): Promise<void> {
    if (!projectDir) return
    const op = effectiveMfg.operations[selectedOpIndex]
    const rel = op?.sourceMesh?.trim()
    if (!rel) {
      onStatus?.('Select an operation with a source mesh (.stl) first.')
      return
    }
    try {
      const r = await fab.assemblyReadStlBase64(projectDir, rel)
      if (!r.ok) {
        onStatus?.(r.error)
        return
      }
      const bin = atob(r.base64)
      const u8 = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      const bbox = computeBinaryStlBoundingBox(u8)
      if (!bbox) {
        onStatus?.('Could not read STL bounds (binary STL required).')
        return
      }
      const dim = stockBoxDimensionsFromPartBounds(bbox, Math.max(0, fitStockPadMm))
      updateSetupStock(setupIndex, {
        kind: 'box',
        x: dim.x,
        y: dim.y,
        z: dim.z,
        allowanceMm: fitStockPadMm > 0 ? fitStockPadMm : undefined
      })
      onStatus?.(
        `Stock set to ${dim.x.toFixed(2)}×${dim.y.toFixed(2)}×${dim.z.toFixed(2)} mm (part AABB + ${fitStockPadMm} mm/side).`
      )
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    }
  }

  /** Wraps onRunCam to track running state for the progress bar. */
  async function handleRunCam(): Promise<void> {
    setCamRunning(true)
    try {
      await onRunCam({ mfg: effectiveMfg, selectedOpIndex })
    } finally {
      setCamRunning(false)
    }
  }

  /** Cancel a running CAM generation via the preload bridge. */
  async function handleCamCancel(): Promise<void> {
    try {
      const result = await fab.camCancel()
      if (result.cancelled) {
        onStatus?.('CAM generation cancelled.')
      }
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    }
  }

  // ── Aux panel props bundle ────────────────────────────────────────────────────

  const auxPanelProps = {
    machines,
    settings,
    project,
    projectDir,
    tools: tools ?? null,
    projectTools,
    machineTools,
    activeMachine,
    sliceOut,
    camOut,
    camLastHint,
    importText,
    onImportTextChange,
    onSaveSettingsField,
    onRunSlice,
    onRunCam: () => {
      void handleRunCam()
    },
    onImportTools,
    onImportToolLibraryFromFile,
    onMigrateProjectToolsToMachine,
    manufacture: effectiveMfg,
    onGoSettings,
    onGoProject,
    onStatus,
    onExportSetupSheet: exportManufactureSetupSheet,
    camStaleMeshRelativePaths,
    lastSliceGcodePath
  }

  // ── Plan body (the main "Plan" sub-tab) ───────────────────────────────────────

  const planBody =
    !projectDir ? (
      <p className="msg panel">No project is open. Use <strong>File &gt; Open Project</strong> to load a project folder, then return here to define setups and operations.</p>
    ) : (
      <div className="panel manufacture-plan-root" tabIndex={0} onKeyDown={handlePanelKeydown}>
      <h2>Manufacture</h2>
      <ManufactureNoSetupBanner setupCount={effectiveMfg.setups.length} onAddSetup={addSetup} />
      <div
        className={`manufacture-plan-layout${fabPlanSidebarCollapsed ? ' manufacture-plan-layout--sidebar-collapsed' : ''} manufacture-plan-layout--makera`}
      >
        {/* -- MAKERA-STYLE FUNCTIONS PANEL (far left) -- */}
        <MakeraFunctionsPanel
          mfg={effectiveMfg}
          selectedSetupIndex={selectedSetupIndex}
          selectedOpIndex={selectedOpIndex}
          onSelectSetup={(si) => setSelectedSetupIndex(si)}
          onAddSetup={addSetup}
          onRemoveSetup={removeSetup}
          onSelectOp={setSelectedOpIndex}
          onToggleSuppressed={(i) => updateOp(i, { suppressed: !effectiveMfg.operations[i]?.suppressed })}
          onAddOp={addOp}
          onRemoveOp={removeOp}
          onMoveOpUp={moveOpUp}
          onMoveOpDown={moveOpDown}
          opStatus={(op) => opStatusForPanel(op, contourCandidates)}
          assetStlPaths={assetStlOptions}
          currentSourceMesh={effectiveMfg.operations[selectedOpIndex]?.sourceMesh?.trim()}
        />

        <div className="manufacture-plan-viewport-col">
          <div className="row row--align-center manufacture-plan-toolbar">
            <button
              type="button"
              className="secondary"
              onClick={() => setFabPlanSidebarCollapsed((c) => !c)}
              aria-expanded={!fabPlanSidebarCollapsed}
              aria-label={fabPlanSidebarCollapsed ? 'Show job panel sidebar' : 'Hide job panel sidebar'}
            >
              {fabPlanSidebarCollapsed ? 'Show job panel' : 'Hide job panel'}
            </button>
            <span className="msg msg--muted msg--xs">
              3D workspace — select an operation on the left to preview its mesh + toolpath.
            </span>
          </div>
          <ManufactureCamSimulationPanel
            projectDir={projectDir}
            mfg={effectiveMfg}
            tools={tools ?? null}
            machine={camSimMachine}
            layout="workspace"
            stockSetupIndex={camResolvedSetupIdx}
            previewMeshRelativePath={effectiveMfg.operations[selectedOpIndex]?.sourceMesh?.trim() ?? null}
            previewOperation={effectiveMfg.operations[selectedOpIndex] ?? null}
            camOut={camOut}
            camStaleMeshRelativePaths={camStaleMeshRelativePaths}
          />
        </div>
        <aside
          className={`manufacture-plan-sidebar${fabPlanSidebarCollapsed ? ' manufacture-plan-sidebar--collapsed' : ''}`}
          aria-hidden={fabPlanSidebarCollapsed}
        >
      {project && projectDir && onSaveActiveMachineId ? (
        <ManufactureSetupStrip
          project={project}
          machines={machines}
          machineToolCount={machineTools?.tools.length ?? 0}
          projectToolCount={projectTools?.tools.length ?? 0}
          onActiveMachineChange={onSaveActiveMachineId}
          onGoSettings={onGoSettings}
          onGoProject={onGoProject}
        />
      ) : null}
      <p className="msg">
        <strong>Plan</strong> sidebar: machine, stock, operations. Use <strong>Slice</strong> / <strong>CAM</strong> tabs for Cura and toolpath runs; meshes live under{' '}
        <code>assets/</code>. The <strong>Simulate</strong> tab shows tool motion and (when enabled) a simplified stock-removal preview — not holder collision or full machine kinematics.
      </p>
      <p className="msg msg--muted msg--xs">
        Quick one-off jobs without a project folder can use the <strong>Shop</strong> environment from the launch screen; this Manufacture workspace is for saved projects and design-linked setups.
      </p>
      <p className="msg manufacture-gcode-safety">
        Any generated G-code is <strong>unverified</strong> until you check posts, units, and clearances for your machine (
        <code>docs/MACHINES.md</code>).
      </p>
      {effectiveMfg.setups.length === 0 && !camResolvedSetup ? (
        <p className="msg msg--muted">Add a setup so work offset and stock context are defined for CAM.</p>
      ) : null}

      <ManufacturePlanToolbar
        operations={effectiveMfg.operations}
        selectedOpIndex={selectedOpIndex}
        camResolvedSetupIdx={camResolvedSetupIdx}
        camResolvedSetup={camResolvedSetup}
        camResolvedMachineName={camResolvedMachineName}
        assetStlOptions={assetStlOptions}
        fitStockPadMm={fitStockPadMm}
        onImportMesh={() => void importMeshForSelectedOp()}
        onBindStl={(sourceMesh) => updateOp(selectedOpIndex, { sourceMesh })}
        onFitStockPadChange={setFitStockPadMm}
        onFitStockFromPart={(si) => void fitStockFromPartOnSetup(si)}
        onAddSetup={addSetup}
        onAddOp={addOp}
        onSave={() => void save()}
      />

      <ManufactureSetupList
        setups={effectiveMfg.setups}
        machines={machines}
        onUpdateSetup={updateSetup}
        onUpdateSetupStock={updateSetupStock}
        onRemoveSetup={removeSetup}
      />

      <LagunaNestingPanel
        activeMachineId={activeMachineId}
        operations={effectiveMfg.operations}
        sheetWidthMm={lagunaSheetSizeMm.widthMm}
        sheetHeightMm={lagunaSheetSizeMm.heightMm}
        onApplyPlacements={applyNestingPlacements}
        onStatus={onStatus}
      />

      <ToolChangeTimeline
        operations={effectiveMfg.operations}
        tools={tools?.tools ?? projectTools?.tools ?? machineTools?.tools ?? []}
      />

      <ManufactureOperationList
        operations={effectiveMfg.operations}
        filteredOps={filteredOps}
        setups={effectiveMfg.setups}
        selectedOpIndex={selectedOpIndex}
        contourCandidates={contourCandidates}
        tools={tools ?? null}
        camMachine={camMachine}
        readinessCounts={readinessCounts}
        activeFilterLabel={activeFilterLabel}
        opFilter={opFilter}
        actionableOnly={actionableOnly}
        nowTickMs={nowTickMs}
        camStaleMeshRelativePaths={camStaleMeshRelativePaths}
        onSelectOp={setSelectedOpIndex}
        onSetOpFilter={setOpFilter}
        onSetActionableOnly={setActionableOnly}
        onUpdateOp={updateOp}
        onRemoveOp={removeOp}
        onSetToolDiameterMm={setToolDiameterMm}
        onSetToolFromLibrary={setToolFromLibrary}
        onSetCutParam={setCutParam}
        onSetGeometryJson={setGeometryJson}
        onDeriveOpGeometry={(i) => void deriveOpGeometryFromSketch(i)}
        onLoadContourCandidates={() => void loadContourCandidates()}
        onRunFdmSlice={(i) => void runFdmSliceFromOp(i)}
        onAddOp={addOp}
      />
        </aside>
      </div>
    </div>
    )

  // ── Plate Tabs handlers (Gap #7 v1) ──────────────────────────────────────────
  //
  // No new IPC: plates are part of `manufacture.json` saved via the existing
  // `manufacture:save`. The renderer never persists plate state directly —
  // changes flow back to disk on the next `save()` call.

  function handleAddPlate(): void {
    setMfg((m) => {
      const { mfg: next, newPlateId } = addPlateState(m)
      setActivePlateId(newPlateId)
      // Reset op-selection to top of the new (empty) plate so we don't show
      // a stale index into a different plate's operations list.
      setSelectedOpIndex(0)
      setSelectedSetupIndex(0)
      return next
    })
  }

  function handleRemovePlate(plateId: string): void {
    setMfg((m) => {
      const { mfg: next, nextActivePlateId } = removePlateState(m, plateId)
      setActivePlateId(nextActivePlateId)
      // Op selection bounds change with the new active plate — clamp to 0
      // and let the existing useEffect re-clamp once effectiveMfg updates.
      setSelectedOpIndex(0)
      setSelectedSetupIndex(0)
      return next
    })
  }

  function handleRenamePlate(plateId: string, newLabel: string): void {
    setMfg((m) => renamePlateState(m, plateId, newLabel))
  }

  function handleSelectPlate(plateId: string): void {
    setActivePlateId(plateId)
    // Reset op/setup selection — indices are per-plate and can be out of
    // bounds across plates with different op counts.
    setSelectedOpIndex(0)
    setSelectedSetupIndex(0)
  }

  const platesForStrip = useMemo(() => getPlates(mfg), [mfg])

  // ── Workflow-stage content (UX MOVE 5) ───────────────────────────────────────
  //
  // The chrome (WorkflowStageTabs / PlateTabs / ManufactureSubTabStrip /
  // CamProgressBar) renders unchanged across all stages. The body inside
  // `#manufacture-workspace-panel` swaps based on `workflowStage`:
  //
  //   FDM:
  //     - 'prepare' → existing panelTab dispatch (Plan / Setup / Simulate /
  //                   Slice / CAM / Calibrate / Tools). This is the default.
  //     - 'preview' → focused Layer-preview body with EmptyState fallback.
  //     - 'device'  → focused Send-to-K2 view with FilamentPicker + ProfileStack.
  //   CNC:
  //     - 'setup'     → existing panelTab dispatch (Setup is the natural
  //                     starting tab; operator can still navigate sub-tabs).
  //     - 'toolpaths' → existing panelTab dispatch (Toolpaths == panelTab='cam').
  //     - 'simulate'  → focused Toolpath-simulation summary + EmptyState fallback.
  //     - 'send'      → focused Send body with Carvera CLI + Laguna setup
  //                     sheet button + ProfileStack.
  //
  // No new state — `workflowStage` already exists. Existing
  // `WorkflowStageTabs.test.tsx` keeps passing because the chrome itself
  // is unchanged; only the body switches per stage.

  /**
   * Wraps the parent's `onSaveSettingsField` (`Partial<AppSettings> → void`)
   * so it matches the ProfileStack's API (`(field, value) → void`). This
   * keeps the ProfileStack contract loose and lets the parent stay strict-
   * typed against AppSettings.
   */
  const profileStackSaveSettingsField = useCallback(
    (field: string, value: unknown): void => {
      onSaveSettingsField({ [field]: value } as Partial<AppSettings>)
    },
    [onSaveSettingsField]
  )

  // Existing `panelTab` dispatch — extracted into a local variable so the
  // workflow-stage switch can reuse it for the "primary" stages.
  const panelTabBody: ReactNode = (
    panelTab === 'plan' ? (
      planBody
    ) : panelTab === 'setup' ? (
      <ManufactureSetupTab
        projectDir={projectDir}
        mfg={effectiveMfg}
        machines={machines}
        selectedSetupIndex={selectedSetupIndex}
        selectedOpIndex={selectedOpIndex}
        fitStockPadMm={fitStockPadMm}
        assetStlOptions={assetStlOptions}
        onSetSelectedSetupIndex={setSelectedSetupIndex}
        onAddSetup={addSetup}
        onRemoveSetup={removeSetup}
        onUpdateSetup={updateSetup}
        onUpdateSetupStock={updateSetupStock}
        onUpdateSetupMaterialType={updateSetupMaterialType}
        onUpdateSetupWcsOrigin={updateSetupWcsOrigin}
        onUpdateSetupAxisMode={updateSetupAxisMode}
        onFitStockPadChange={setFitStockPadMm}
        onFitStockFromPart={(si) => void fitStockFromPartOnSetup(si)}
        onSave={() => void save()}
        onUpdateSetupRotaryPlacement={updateSetupRotaryPlacement}
        onReplaceSetups={replaceSetups}
        onAppendSetup={appendSetup}
        onStatus={onStatus}
      />
    ) : panelTab === 'simulate' ? (
      /* -- SIMULATE TAB: full-screen 3D toolpath viewer -- */
      <section className="makera-simulate-panel" aria-labelledby="mfg-simulate-heading">
        <div className="makera-simulate-header">
          <h2 id="mfg-simulate-heading" className="makera-simulate-heading">3D Toolpath Simulation</h2>
          <p className="msg msg--muted makera-simulate-hint">
            Visualizes the generated G-code as feed (cyan) and rapid (amber) tubes over the part mesh.
            Generate a toolpath first via the <strong>CAM</strong> tab.
          </p>
        </div>
        <div className="makera-simulate-canvas-wrap">
          {projectDir ? (
            <ManufactureCamSimulationPanel
              projectDir={projectDir}
              mfg={effectiveMfg}
              tools={tools ?? null}
              machine={camSimMachine}
              layout="workspace"
              stockSetupIndex={camResolvedSetupIdx}
              previewMeshRelativePath={effectiveMfg.operations[selectedOpIndex]?.sourceMesh?.trim() ?? null}
              previewOperation={effectiveMfg.operations[selectedOpIndex] ?? null}
              camOut={camOut}
              camStaleMeshRelativePaths={camStaleMeshRelativePaths}
            />
          ) : (
            <p className="msg">No project is open. Load a project and generate a toolpath from the <strong>CAM</strong> tab to visualize it here.</p>
          )}
        </div>
      </section>
    ) : panelTab === 'slice' ? (
      <SliceManufacturePanel {...auxPanelProps} />
    ) : panelTab === 'cam' ? (
      <CamManufacturePanel {...auxPanelProps} />
    ) : panelTab === 'calibrate' ? (
      <CalibrationPanel
        activeMachine={activeMachine}
        settings={settings}
        projectDir={projectDir}
        onStatus={onStatus}
        onGoSettings={onGoSettings}
      />
    ) : (
      <ToolsManufacturePanel {...auxPanelProps} />
    )
  )

  // FDM 'preview' stage body — focused layer-preview summary. The
  // workspace owns the gcode text + selected-layer state; the body is a
  // pure presentation component so render-pin tests don't need IPC.
  const previewStageBody: ReactNode = (
    <LayerPreviewBody
      layerBreakdown={sliceLayerBreakdown}
      lastSliceGcodePath={lastSliceGcodePath}
      selectedLayerIndex={selectedPreviewLayer ?? undefined}
      onSelectLayerIndex={setSelectedPreviewLayer}
    />
  )

  // FDM 'device' stage body — editable Process editor + Supports, the
  // Send-to-K2 slice/upload surface, the live Pause/Resume/Cancel job
  // controls, and the ProfileStack. The FdmProcessPanel is only meaningful
  // for the K2 Plus; for any other FDM machine we still show the slice +
  // device surfaces but omit the K2-specific process editor.
  const isK2PlusActive = activeMachine?.id === 'creality-k2-plus'
  const deviceStageBody: ReactNode = (
    <div
      className="workspace-stage-body workspace-stage-body--device"
      data-testid="workflow-stage-body-device"
    >
      {isK2PlusActive ? (
        <FdmProcessPanel
          value={processOverrides}
          onChangeProcess={handleChangeProcessOverrides}
          qualityPresetId={settings?.k2QualityPresetId ?? 'standard'}
          onChangeQualityPreset={handleChangeQualityPreset}
        />
      ) : null}
      <SliceManufacturePanel {...auxPanelProps} />
      <FdmDeviceControls
        printerUrl={settings?.moonrakerUrl ?? ''}
        onStatus={onStatus}
      />
      <ProfileStack
        machineMode="fdm"
        machine={activeMachine ?? null}
        activeJob={null}
        settings={settings}
        manufacture={effectiveMfg}
        tools={tools ?? null}
        onSaveSettingsField={profileStackSaveSettingsField}
        onSend={null}
      />
    </div>
  )

  // CNC 'simulate' stage body — stats summary + full 3D simulation panel.
  // Both `ToolpathSimulationBody` (text stats / empty-state) and
  // `ManufactureCamSimulationPanel` (R3F 3D canvas) render together.
  // The panel is guarded by `projectDir` since it needs a file-system path.
  const simulateStageBody: ReactNode = (
    <div
      className="workspace-stage-body workspace-stage-body--simulate-stage"
      data-testid="workflow-stage-body-simulate-stage"
    >
      <ToolpathSimulationBody camOut={camOut} />
      {projectDir ? (
        <ManufactureCamSimulationPanel
          projectDir={projectDir}
          mfg={effectiveMfg}
          tools={tools ?? null}
          machine={camSimMachine}
          layout="workspace"
          stockSetupIndex={camResolvedSetupIdx}
          previewMeshRelativePath={effectiveMfg.operations[selectedOpIndex]?.sourceMesh?.trim() ?? null}
          previewOperation={effectiveMfg.operations[selectedOpIndex] ?? null}
          camOut={camOut}
          camStaleMeshRelativePaths={camStaleMeshRelativePaths}
        />
      ) : null}
    </div>
  )

  // CNC 'send' stage body — Carvera upload + Laguna setup sheet + ProfileStack.
  // CNC 'probing' stage body (Wave 3a) -- mounts the formerly-dead
  // ProbeCyclePanel (5 cycle types: single-surface / bore / boss / corner /
  // tool-length). The panel generates safe touch-probe G-code via the
  // probe:generate IPC and is self-contained (no props). SAFETY: probing
  // G-code is operator-verified on the controller before running; the panel
  // shows that advisory inline.
  const probingStageBody: ReactNode = (
    <section
      className="panel workspace-stage-body workspace-stage-body--probing"
      aria-labelledby="mfg-stage-probing-heading"
      data-testid="workflow-stage-body-probing"
    >
      <h2 id="mfg-stage-probing-heading">Probing</h2>
      <ProbeCyclePanel />
    </section>
  )

  const sendStageBody: ReactNode = (
    <div
      className="workspace-stage-body workspace-stage-body--send"
      data-testid="workflow-stage-body-send"
    >
      <CamManufacturePanel {...auxPanelProps} />
      <ProfileStack
        machineMode="cnc"
        machine={activeMachine ?? null}
        activeJob={null}
        settings={settings}
        manufacture={effectiveMfg}
        tools={tools ?? null}
        onSaveSettingsField={profileStackSaveSettingsField}
        onSend={null}
      />
    </div>
  )

  // Stage-level body selector. Primary stages fall through to the existing
  // panelTab dispatch so the operator can still drill into Plan / Setup /
  // Simulate / Slice / CAM / Calibrate / Tools sub-tabs.
  let stageBody: ReactNode
  switch (workflowStage) {
    case 'preview':
      stageBody = previewStageBody
      break
    case 'device':
      stageBody = deviceStageBody
      break
    case 'simulate':
      stageBody = simulateStageBody
      break
    case 'probing':
      stageBody = probingStageBody
      break
    case 'send':
      stageBody = sendStageBody
      break
    case 'prepare':
    case 'setup':
    case 'toolpaths':
    default:
      stageBody = panelTabBody
      break
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="manufacture-workspace-wrap" data-workflow-stage={workflowStage} data-workflow-env={workflowEnv}>
      <WorkflowStageTabs env={workflowEnv} stage={workflowStage} onChange={setWorkflowStage} />
      <PlateTabs
        plates={platesForStrip}
        activePlateId={activePlateId}
        plateStatuses={plateSliceStatus}
        onSelectPlate={handleSelectPlate}
        onAddPlate={handleAddPlate}
        onRemovePlate={handleRemovePlate}
        onRenamePlate={handleRenamePlate}
        onSlicePlate={(plateId) => void slicePlateById(plateId)}
        onSliceAllPlates={() => void sliceAllPlatesSequential()}
      />
      <ManufactureSubTabStrip tab={panelTab} onChange={onPanelTabChange} />
      <CamProgressBar running={camRunning} onCancel={() => void handleCamCancel()} />
      <div
        id="manufacture-workspace-panel"
        role="tabpanel"
        aria-labelledby={`mfg-subtab-${panelTab}`}
        data-stage-content={workflowStage}
      >
        {stageBody}
      </div>
    </div>
  )
}
