import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings, ProjectFile } from '../../shared/project-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import {
  deriveContourPointsFromDesign,
  deriveDrillPointsFromDesign,
  listContourCandidatesFromDesign,
  type DerivedContourCandidate
} from '../../shared/cam-2d-derive'
import { resolveManufactureSetupForCam } from '../../shared/cam-cut-params'
import { mergeCuraSliceInvocationSettings } from '../../shared/cura-slice-defaults'
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
import { ManufactureSetupStrip } from './ManufactureSetupStrip'
import { ManufactureCamSimulationPanel } from './ManufactureCamSimulationPanel'
import { ManufactureSubTabStrip } from './ManufactureSubTabStrip'
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
  const fab = window.fab

  // ── Effects ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    setSelectedOpIndex((i) => {
      if (mfg.operations.length === 0) return 0
      return Math.min(Math.max(0, i), mfg.operations.length - 1)
    })
  }, [mfg.operations.length])

  useEffect(() => {
    if (!projectDir) {
      setMfg(emptyManufacture())
      return
    }
    void fab
      .manufactureLoad(projectDir)
      .then(setMfg)
      .catch((e) => {
        onStatus?.(e instanceof Error ? e.message : String(e))
        setMfg(emptyManufacture())
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

  async function runFdmSliceFromOp(opIndex: number): Promise<void> {
    if (!projectDir) return
    const op = mfg.operations[opIndex]
    if (!op || op.kind !== 'fdm_slice') return
    const rel = op.sourceMesh?.trim()
    if (!rel) {
      onStatus?.('Set source mesh path (e.g. assets/model.stl) for this FDM operation.')
      return
    }
    const settings = await fab.settingsGet()
    if (!settings.curaEnginePath?.trim()) {
      onStatus?.('Configure CuraEngine path under File → Settings.')
      return
    }
    const sep = projectDir.includes('\\') ? '\\' : '/'
    const stlPath = `${projectDir}${sep}${rel.replace(/\//g, sep)}`
    const out = `${projectDir}${sep}output${sep}fdm_slice_${op.id}.gcode`
    const curaEngineSettings = Object.fromEntries(mergeCuraSliceInvocationSettings(settings))
    const r = await fab.sliceCura({
      stlPath,
      outPath: out,
      curaEnginePath: settings.curaEnginePath,
      definitionsPath: settings.curaDefinitionsPath,
      definitionPath: settings.curaMachineDefinitionPath?.trim() || undefined,
      slicePreset: settings.curaSlicePreset ?? 'balanced',
      curaEngineSettings
    })
    if (!r.ok) {
      onStatus?.(`FDM slice failed: ${r.stderr ?? 'unknown error'}`)
      return
    }
    onStatus?.(`FDM slice wrote ${out}`)
  }

  // ── Setup mutations ───────────────────────────────────────────────────────────

  function addSetup(): void {
    const id = crypto.randomUUID()
    const st: ManufactureSetup = {
      id,
      label: `Setup ${mfg.setups.length + 1}`,
      machineId: machines[0]?.id ?? 'laguna-swift-5x10',
      workCoordinateIndex: 1,
      stock: { kind: 'box', x: 200, y: 200, z: 25 }
    }
    setMfg((m) => ({ ...m, setups: [...m.setups, st] }))
  }

  function updateSetup(i: number, patch: Partial<ManufactureSetup>): void {
    setMfg((m) => {
      const setups = [...m.setups]
      setups[i] = { ...setups[i]!, ...patch }
      return { ...m, setups }
    })
  }

  function updateSetupStock(i: number, patch: Partial<NonNullable<ManufactureSetup['stock']>>): void {
    setMfg((m) => {
      const setups = [...m.setups]
      const cur = setups[i]!
      const stock = { kind: 'box' as const, x: 200, y: 200, z: 25, ...cur.stock, ...patch }
      setups[i] = { ...cur, stock }
      return { ...m, setups }
    })
  }

  function removeSetup(i: number): void {
    setMfg((m) => ({ ...m, setups: m.setups.filter((_, j) => j !== i) }))
  }

  function updateSetupWcsOrigin(si: number, point: WcsOriginPoint): void {
    updateSetup(si, { wcsOriginPoint: point })
  }

  function updateSetupAxisMode(si: number, mode: '3axis' | '4axis' | '5axis'): void {
    updateSetup(si, { axisMode: mode })
  }

  function updateSetupMaterialType(si: number, mat: StockMaterialType | undefined): void {
    setMfg((m) => {
      const setups = [...m.setups]
      const cur = setups[si]!
      const stock = { kind: 'box' as const, x: 200, y: 200, z: 25, ...cur.stock, materialType: mat }
      setups[si] = { ...cur, stock }
      return { ...m, setups }
    })
  }

  // ── Operation mutations ───────────────────────────────────────────────────────

  function addOp(): void {
    const id = crypto.randomUUID()
    const op: ManufactureOperation = {
      id,
      kind: 'cnc_parallel',
      label: `Op ${mfg.operations.length + 1}`,
      sourceMesh: 'assets/design-sample.stl'
    }
    setMfg((m) => ({ ...m, operations: [...m.operations, op] }))
  }

  function updateOp(i: number, patch: Partial<ManufactureOperation>): void {
    setMfg((m) => {
      const ops = [...m.operations]
      ops[i] = { ...ops[i]!, ...patch }
      return { ...m, operations: ops }
    })
  }

  function removeOp(i: number): void {
    setMfg((m) => ({ ...m, operations: m.operations.filter((_, j) => j !== i) }))
  }

  function moveOpUp(i: number): void {
    if (i <= 0) return
    setMfg((m) => {
      const ops = [...m.operations]
      const tmp = ops[i - 1]!
      ops[i - 1] = ops[i]!
      ops[i] = tmp
      return { ...m, operations: ops }
    })
    setSelectedOpIndex((prev) => (prev === i ? i - 1 : prev === i - 1 ? i : prev))
  }

  function moveOpDown(i: number): void {
    setMfg((m) => {
      if (i >= m.operations.length - 1) return m
      const ops = [...m.operations]
      const tmp = ops[i + 1]!
      ops[i + 1] = ops[i]!
      ops[i] = tmp
      return { ...m, operations: ops }
    })
    setSelectedOpIndex((prev) => (prev === i ? i + 1 : prev === i + 1 ? i : prev))
  }

  // ── Operation parameter helpers ───────────────────────────────────────────────

  function setToolDiameterMm(i: number, raw: string): void {
    const op = mfg.operations[i]!
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
    const op = mfg.operations[i]!
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
    const op = mfg.operations[i]!
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
    const op = mfg.operations[i]!
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
    const op = mfg.operations[i]
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

  const readinessCounts = mfg.operations.reduce(
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

  const filteredOps = mfg.operations.filter((op) => {
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

  const camMachine = resolveManufactureCamMachine(mfg, machines)

  const camRunCncMachineId = useMemo(() => {
    const cnc = machines.filter((m) => m.kind === 'cnc')
    if (cnc.length === 0) return undefined
    if (activeMachineId && cnc.some((m) => m.id === activeMachineId)) return activeMachineId
    return cnc[0]?.id
  }, [machines, activeMachineId])

  const camResolvedSetup = useMemo(
    () => resolveManufactureSetupForCam(mfg, camRunCncMachineId),
    [mfg, camRunCncMachineId]
  )

  const camResolvedSetupIdx = useMemo(() => {
    if (!camResolvedSetup) return 0
    const i = mfg.setups.findIndex((s) => s.id === camResolvedSetup.id)
    return i >= 0 ? i : 0
  }, [mfg.setups, camResolvedSetup])

  const camResolvedMachineName = useMemo(() => {
    if (!camResolvedSetup) return undefined
    return machines.find((m) => m.id === camResolvedSetup.machineId)?.name ?? camResolvedSetup.machineId
  }, [machines, camResolvedSetup])

  const activeMachine = useMemo(
    () => machines.find((x) => x.id === project?.activeMachineId),
    [machines, project?.activeMachineId]
  )

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
    if (mfg.operations.length === 0) {
      onStatus?.('Add an operation first, then import a mesh to bind it.')
      return
    }
    const relPath = r.relativePath.replace(/\\/g, '/')
    setMfg((m) => {
      const idx = Math.min(selectedOpIndex, m.operations.length - 1)
      const ops = [...m.operations]
      ops[idx] = { ...ops[idx]!, sourceMesh: relPath }
      return { ...m, operations: ops }
    })
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
    const rel = mfg.operations.find((o) => o.sourceMesh?.trim())?.sourceMesh?.trim() ?? null
    const stlAbs = rel ? `${projectDir}${sep}${rel.replace(/\//g, sep)}` : null
    const job = buildSetupSheetJobFromManufacture({
      projectName: name,
      mfg,
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
    const op = mfg.operations[selectedOpIndex]
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
      await onRunCam({ mfg, selectedOpIndex })
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
    manufacture: mfg,
    onGoSettings,
    onGoProject,
    onStatus,
    onExportSetupSheet: exportManufactureSetupSheet
  }

  // ── Plan body (the main "Plan" sub-tab) ───────────────────────────────────────

  const planBody =
    !projectDir ? (
      <p className="msg panel">No project is open. Use <strong>File &gt; Open Project</strong> to load a project folder, then return here to define setups and operations.</p>
    ) : (
      <div className="panel manufacture-plan-root" tabIndex={0} onKeyDown={handlePanelKeydown}>
      <h2>Manufacture</h2>
      <div
        className={`manufacture-plan-layout${fabPlanSidebarCollapsed ? ' manufacture-plan-layout--sidebar-collapsed' : ''} manufacture-plan-layout--makera`}
      >
        {/* -- MAKERA-STYLE FUNCTIONS PANEL (far left) -- */}
        <MakeraFunctionsPanel
          mfg={mfg}
          selectedSetupIndex={selectedSetupIndex}
          selectedOpIndex={selectedOpIndex}
          onSelectSetup={(si) => setSelectedSetupIndex(si)}
          onAddSetup={addSetup}
          onRemoveSetup={removeSetup}
          onSelectOp={setSelectedOpIndex}
          onToggleSuppressed={(i) => updateOp(i, { suppressed: !mfg.operations[i]?.suppressed })}
          onAddOp={addOp}
          onRemoveOp={removeOp}
          onMoveOpUp={moveOpUp}
          onMoveOpDown={moveOpDown}
          opStatus={(op) => opStatusForPanel(op, contourCandidates)}
          assetStlPaths={assetStlOptions}
          currentSourceMesh={mfg.operations[selectedOpIndex]?.sourceMesh?.trim()}
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
            mfg={mfg}
            tools={tools ?? null}
            machine={camSimMachine}
            layout="workspace"
            stockSetupIndex={camResolvedSetupIdx}
            previewMeshRelativePath={mfg.operations[selectedOpIndex]?.sourceMesh?.trim() ?? null}
            previewOperation={mfg.operations[selectedOpIndex] ?? null}
            camOut={camOut}
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
        <strong>Plan</strong> sidebar: machine, stock, operations. Use <strong>Slice</strong> / <strong>CAM</strong> tabs for
        Cura and toolpath runs; meshes live under <code>assets/</code>.
      </p>
      <p className="msg manufacture-gcode-safety">
        Any generated G-code is <strong>unverified</strong> until you check posts, units, and clearances for your machine (
        <code>docs/MACHINES.md</code>).
      </p>
      {mfg.setups.length === 0 && !camResolvedSetup ? (
        <p className="msg msg--muted">Add a setup so work offset and stock context are defined for CAM.</p>
      ) : null}

      <ManufacturePlanToolbar
        operations={mfg.operations}
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
        setups={mfg.setups}
        machines={machines}
        onUpdateSetup={updateSetup}
        onUpdateSetupStock={updateSetupStock}
        onRemoveSetup={removeSetup}
      />

      <ToolChangeTimeline
        operations={mfg.operations}
        tools={tools?.tools ?? projectTools?.tools ?? machineTools?.tools ?? []}
      />

      <ManufactureOperationList
        operations={mfg.operations}
        filteredOps={filteredOps}
        selectedOpIndex={selectedOpIndex}
        contourCandidates={contourCandidates}
        tools={tools ?? null}
        camMachine={camMachine}
        readinessCounts={readinessCounts}
        activeFilterLabel={activeFilterLabel}
        opFilter={opFilter}
        actionableOnly={actionableOnly}
        nowTickMs={nowTickMs}
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
      />
        </aside>
      </div>
    </div>
    )

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="manufacture-workspace-wrap">
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
            mfg={mfg}
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
                  mfg={mfg}
                  tools={tools ?? null}
                  machine={camSimMachine}
                  layout="workspace"
                  stockSetupIndex={camResolvedSetupIdx}
                  previewMeshRelativePath={mfg.operations[selectedOpIndex]?.sourceMesh?.trim() ?? null}
                  previewOperation={mfg.operations[selectedOpIndex] ?? null}
                  camOut={camOut}
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
        ) : (
          <ToolsManufacturePanel {...auxPanelProps} />
        )}
      </div>
    </div>
  )
}
