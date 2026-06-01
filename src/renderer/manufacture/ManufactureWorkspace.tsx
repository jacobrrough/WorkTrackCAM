import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { AppSettings, ProjectFile } from '../../shared/project-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import {
  deriveContourPointsFromDesign,
  deriveDrillPointsFromDesign,
  listContourCandidatesFromDesign,
  type DerivedContourCandidate
} from '../../shared/cam-2d-derive'
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
export type WorkflowStageCnc = 'setup' | 'toolpaths' | 'simulate' | 'send'
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
  onAfterMeshImport
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
    const r = await fab.sliceOrca({
      stlPath,
      outPath: out,
      machineId: activeMachineId,
      qualityPresetId: settings?.k2QualityPresetId,
      filamentId: settings?.activeFilamentId
    })
    if (r.ok) {
      setLastSliceGcodePath(out)
      onStatus?.(`Sliced via OrcaSlicer → ${out}`)
    } else {
      onStatus?.(`Slice failed (${r.error})${r.hint ? `: ${r.hint}` : ''}`)
    }
  }

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

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="manufacture-workspace-wrap" data-workflow-stage={workflowStage} data-workflow-env={workflowEnv}>
      <WorkflowStageTabs env={workflowEnv} stage={workflowStage} onChange={setWorkflowStage} />
      <PlateTabs
        plates={platesForStrip}
        activePlateId={activePlateId}
        onSelectPlate={handleSelectPlate}
        onAddPlate={handleAddPlate}
        onRemovePlate={handleRemovePlate}
        onRenamePlate={handleRenamePlate}
      />
      <ManufactureSubTabStrip tab={panelTab} onChange={onPanelTabChange} />
      <CamProgressBar running={camRunning} onCancel={() => void handleCamCancel()} />
      <div
        id="manufacture-workspace-panel"
        role="tabpanel"
        aria-labelledby={`mfg-subtab-${panelTab}`}
      >
        {panelTab === 'plan' ? (
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
        )}
      </div>
    </div>
  )
}
