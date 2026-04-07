/**
 * WorkTrackCAM preload — exposes CAM/fabrication + core IPC to the renderer.
 * Design, assembly, drawing, and kernel build APIs are NOT included.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, ImportHistoryEntry, ProjectFile } from '../shared/project-schema'
import type { MachineProfile } from '../shared/machine-schema'
import type { CpsImportSummary } from '../main/machine-cps-import'
import type { ManufactureFile } from '../shared/manufacture-schema'
import type { ToolLibraryFile } from '../shared/tool-schema'
import type { MeshImportPlacement, MeshImportTransform, MeshImportUpAxis } from '../shared/mesh-import-placement'
import type { MaterialRecord } from '../shared/material-schema'
import type { CarveraUploadPayload, CarveraUploadResult } from '../main/carvera-cli-run'
import type { DesignFileV2 } from '../shared/design-schema'
import type { KernelManifest } from '../shared/kernel-manifest-schema'
import type { PartFeaturesFile } from '../shared/part-features-schema'
import type { CamProgressEvent } from '../shared/cam-progress'
import type { PythonDepCheckOutcome } from '../main/python-dep-check'
import type { UpdateStatus } from '../main/auto-updater'
import type { DxfParseResult } from '../shared/dxf-parser'
import type { MaterialAuditResult } from '../shared/material-audit'
import type { FixtureCollisionResult, ToolpathPoint } from '../shared/fixture-collision'
import type { FixtureRecord } from '../shared/fixture-schema'
import type { ManufactureSetup } from '../shared/manufacture-schema'
import type { SetupSequenceValidation, FlipSetupSuggestion } from '../shared/multi-setup-utils'
import type { ProbeCycleType, ProbeBaseParams } from '../shared/probing-cycles'

export type Api = {
  // ── Core ──────────────────────────────────────────────────────────────────
  appGetVersion: () => Promise<string>
  settingsGet: () => Promise<AppSettings>
  settingsSet: (partial: Partial<AppSettings>) => Promise<AppSettings>
  projectOpenDir: () => Promise<string | null>
  projectRead: (dir: string) => Promise<ProjectFile>
  projectCreate: (payload: { dir: string; name: string; machineId: string }) => Promise<ProjectFile>
  projectSave: (dir: string, project: ProjectFile) => Promise<void>
  dialogOpenFile: (filters: { name: string; extensions: string[] }[], defaultPath?: string) => Promise<string | null>
  dialogOpenFiles: (filters: { name: string; extensions: string[] }[], defaultPath?: string) => Promise<string[]>
  dialogSaveFile: (filters: { name: string; extensions: string[] }[], defaultPath?: string) => Promise<string | null>
  shellOpenPath: (p: string) => Promise<void>
  readTextFile: (p: string) => Promise<string>
  fsReadBase64: (filePath: string) => Promise<string>
  fsWriteText: (filePath: string, content: string) => Promise<void>

  // ── Python dependency check ─────────────────────────────────────────────
  /** Full structured dependency check result (cached after first call). */
  pythonDepsCheck: () => Promise<PythonDepCheckOutcome>
  /** User-friendly warning string, or null if everything is fine. */
  pythonDepsWarning: () => Promise<string | null>

  // ── Auto-updater ────────────────────────────────────────────────────────
  /** Current update status. */
  updaterStatus: () => Promise<UpdateStatus>
  /** Trigger an update check now. */
  updaterCheckNow: () => Promise<UpdateStatus>
  /** Quit and install a downloaded update. */
  updaterQuitAndInstall: () => Promise<void>

  // ── Machines ─────────────────────────────────────────────────────────────
  machinesList: () => Promise<MachineProfile[]>
  machinesCatalog: () => Promise<{ machines: MachineProfile[]; diagnostics: Array<{ source: string; file: string; error: string }> }>
  machinesSaveUser: (profile: MachineProfile) => Promise<MachineProfile>
  machinesDeleteUser: (machineId: string) => Promise<boolean>
  machinesImportJson: (text: string) => Promise<MachineProfile>
  machinesImportFile: (filePath: string) => Promise<MachineProfile>
  machinesExportUser: (machineId: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
  machinesImportCpsFile: (filePath: string) => Promise<CpsImportSummary>
  machinesPickAndImportCps: () => Promise<CpsImportSummary | null>

  // ── STL / Mesh ───────────────────────────────────────────────────────────
  stlStage: (projectDir: string, stlPath: string) => Promise<string>
  stlTransformForCam: (payload: {
    stlPath: string
    transform: {
      position: { x: number; y: number; z: number }
      rotation: { x: number; y: number; z: number }
      scale: { x: number; y: number; z: number }
    }
  }) => Promise<string>
  assetsImportMesh: (
    projectDir: string,
    sourcePath: string,
    pythonPath: string,
    placement?: { placement?: MeshImportPlacement; upAxis?: MeshImportUpAxis; transform?: MeshImportTransform }
  ) => Promise<
    | { ok: true; stlPath: string; relativePath: string; report: ImportHistoryEntry }
    | { ok: false; error: string; detail?: string }
  >

  // ── CAM ──────────────────────────────────────────────────────────────────
  camRun: (payload: {
    stlPath: string; outPath: string; machineId: string
    zPassMm: number; stepoverMm: number; feedMmMin: number
    plungeMmMin: number; safeZMm: number; pythonPath: string
    operationKind?: string; workCoordinateIndex?: number; toolDiameterMm?: number
    operationParams?: Record<string, unknown>
    rotaryStockLengthMm?: number; rotaryStockDiameterMm?: number
    rotaryChuckDepthMm?: number; rotaryClampOffsetMm?: number
    stockBoxZMm?: number; stockBoxXMm?: number; stockBoxYMm?: number
    priorPostedGcode?: string; useMeshMachinableXClamp?: boolean
  }) => Promise<
    | { ok: true; gcode?: string; usedEngine: string; engine: { requestedEngine: string; usedEngine: string; fallbackApplied: boolean; fallbackReason?: string; fallbackDetail?: string }; hint?: string; warnings?: string[] }
    | { ok: false; error: string; hint?: string }
  >
  /** Cancel any currently running cam:run operation. Returns `{ cancelled: true }` if a run was aborted, `{ cancelled: false }` if no run was active. */
  camCancel: () => Promise<{ cancelled: boolean }>
  /**
   * Subscribe to real-time CAM progress events from the Python engine.
   * Returns an unsubscribe function. Events are forwarded from main via `cam:progress`.
   */
  onCamProgress: (callback: (event: CamProgressEvent) => void) => () => void
  sliceCura: (payload: {
    stlPath: string; outPath: string; curaEnginePath: string
    definitionsPath?: string; definitionPath?: string
    slicePreset?: string | null; curaEngineSettings?: Record<string, string>
  }) => Promise<{ ok: boolean; stderr?: string; stdout?: string }>

  // ── Manufacture file ─────────────────────────────────────────────────────
  manufactureLoad: (projectDir: string) => Promise<ManufactureFile>
  manufactureSave: (projectDir: string, json: string) => Promise<void>

  // ── Tools ────────────────────────────────────────────────────────────────
  toolsRead: (projectDir: string) => Promise<ToolLibraryFile>
  toolsSave: (projectDir: string, lib: ToolLibraryFile) => Promise<void>
  toolsImport: (projectDir: string, payload: { kind: 'csv' | 'json' | 'fusion' | 'fusion_csv'; content: string }) => Promise<ToolLibraryFile>
  toolsImportFile: (projectDir: string, filePath: string) => Promise<ToolLibraryFile>
  machineToolsRead: (machineId: string) => Promise<ToolLibraryFile>
  machineToolsSave: (machineId: string, lib: ToolLibraryFile) => Promise<ToolLibraryFile>
  machineToolsImport: (machineId: string, payload: { kind: 'csv' | 'json' | 'fusion' | 'fusion_csv'; content: string }) => Promise<ToolLibraryFile>
  machineToolsImportFile: (machineId: string, filePath: string) => Promise<ToolLibraryFile>
  machineToolsMigrateFromProject: (machineId: string, projectDir: string) => Promise<ToolLibraryFile>

  // ── Design/Assembly read-only (CAM reads design data from project files) ─
  designLoad: (projectDir: string) => Promise<DesignFileV2 | null>
  assemblyReadStlBase64: (projectDir: string, meshPath: string) => Promise<{ ok: true; base64: string } | { ok: false; error: string }>
  meshPreviewStlBase64: (sourcePath: string, pythonPath: string) => Promise<{ ok: true; base64: string } | { ok: false; error: string; detail?: string }>
  featuresLoad: (projectDir: string) => Promise<PartFeaturesFile>
  featuresSave: (projectDir: string, json: string) => Promise<void>
  designSave: (projectDir: string, json: string) => Promise<void>
  designReadKernelManifest: (projectDir: string) => Promise<KernelManifest | null>
  designReadKernelStlBase64: (projectDir: string) => Promise<{ ok: true; base64: string } | { ok: false; error: string }>
  modelExportStl: (projectDir: string, filename: string, base64: string) => Promise<{ ok: true; path: string } | { ok: false; error: string }>

  // ── Post-processors ──────────────────────────────────────────────────────
  postsList: () => Promise<Array<{ filename: string; path: string; source: 'bundled' | 'user'; preview: string }>>
  postsSave: (filename: string, content: string) => Promise<{ filename: string; path: string; source: 'bundled' | 'user'; preview: string }>
  postsRead: (filename: string) => Promise<string>
  postsUploadFile: (filePath: string) => Promise<{ filename: string; path: string; source: 'bundled' | 'user'; preview: string }>
  postsPickAndUpload: () => Promise<{ filename: string; path: string; source: 'bundled' | 'user'; preview: string } | null>

  // ── Materials ────────────────────────────────────────────────────────────
  materialsList: () => Promise<MaterialRecord[]>
  materialsSave: (record: MaterialRecord) => Promise<MaterialRecord>
  materialsDelete: (id: string) => Promise<boolean>
  materialsImportJson: (jsonText: string) => Promise<MaterialRecord[]>
  materialsImportFile: (filePath: string) => Promise<MaterialRecord[]>
  materialsPickAndImport: () => Promise<MaterialRecord[] | null>

  // ── Machine upload ───────────────────────────────────────────────────────
  moonrakerPush: (payload: { gcodePath: string; printerUrl: string; uploadPath?: string; startAfterUpload?: boolean; timeoutMs?: number }) => Promise<
    | { ok: true; filename: string; uploadedPath: string; printStarted: boolean; printerUrl: string }
    | { ok: false; error: string; detail?: string }
  >
  moonrakerStatus: (printerUrl: string, timeoutMs?: number) => Promise<
    | { ok: true; state: string; filename?: string; progress?: number; etaSeconds?: number; rawState?: string }
    | { ok: false; error: string; detail?: string }
  >
  moonrakerCancel: (printerUrl: string, timeoutMs?: number) => Promise<{ ok: boolean; error?: string }>
  moonrakerPause: (printerUrl: string, timeoutMs?: number) => Promise<{ ok: boolean; error?: string }>
  moonrakerResume: (printerUrl: string, timeoutMs?: number) => Promise<{ ok: boolean; error?: string }>
  carveraUpload: (payload: CarveraUploadPayload) => Promise<CarveraUploadResult>
  carveraGenerateSetup: (payload: {
    mode: 'a_axis_zero' | 'wcs_zero' | 'z_probe' | 'full_4axis_setup' | 'preflight_check'
    projectDir: string
    axes?: ('x' | 'y' | 'z' | 'a')[]
    wcsIndex?: number
    probeDistMm?: number
    probeFeedMmMin?: number
    retractMm?: number
    spindleRpm?: number
    feedMmMin?: number
  }) => Promise<{ ok: true; gcode: string; filePath: string } | { ok: false; error: string }>

  // ── DXF Import ──────────────────────────────────────────────────────────
  dxfImport: (filePath: string) => Promise<
    | ({ ok: true } & DxfParseResult)
    | { ok: false; error: string }
  >

  // ── Material Audit ──────────────────────────────────────────────────────
  materialAudit: () => Promise<
    | ({ ok: true } & MaterialAuditResult)
    | { ok: false; error: string }
  >

  // ── Fixture Collision Check ─────────────────────────────────────────────
  fixtureCheckCollision: (payload: {
    toolpath: ToolpathPoint[]
    fixture: FixtureRecord
    toolDiameterMm: number
    toolLengthMm?: number
  }) => Promise<
    | ({ ok: true } & FixtureCollisionResult)
    | { ok: false; error: string }
  >

  // ── Multi-Setup Automation ──────────────────────────────────────────────
  setupAutoAssignWcs: (setups: ManufactureSetup[]) => Promise<
    | { ok: true; setups: ManufactureSetup[] }
    | { ok: false; error: string }
  >
  setupValidate: (setups: ManufactureSetup[]) => Promise<
    | ({ ok: true } & SetupSequenceValidation)
    | { ok: false; error: string }
  >
  setupSuggestFlip: (payload: {
    currentSetup: ManufactureSetup
    existingSetups?: ManufactureSetup[]
    flipAxis?: 'X' | 'Y'
  }) => Promise<
    | ({ ok: true } & FlipSetupSuggestion)
    | { ok: false; error: string }
  >

  // ── Probing Cycles ──────────────────────────────────────────────────────
  probeGenerate: (payload: {
    type: ProbeCycleType
    params: ProbeBaseParams & Record<string, unknown>
  }) => Promise<
    | { ok: true; gcode: string }
    | { ok: false; error: string }
  >
}

const api: Api = {
  // Core
  appGetVersion: () => ipcRenderer.invoke('app:getVersion'),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (partial) => ipcRenderer.invoke('settings:set', partial),
  projectOpenDir: () => ipcRenderer.invoke('project:openDir'),
  projectRead: (dir) => ipcRenderer.invoke('project:read', dir),
  projectCreate: (payload) => ipcRenderer.invoke('project:create', payload),
  projectSave: (dir, project) => ipcRenderer.invoke('project:save', dir, project),
  dialogOpenFile: (filters, defaultPath) => ipcRenderer.invoke('dialog:openFile', filters, defaultPath),
  dialogOpenFiles: (filters, defaultPath) => ipcRenderer.invoke('dialog:openFiles', filters, defaultPath),
  dialogSaveFile: (filters, defaultPath) => ipcRenderer.invoke('dialog:saveFile', filters, defaultPath),
  shellOpenPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  readTextFile: (p) => ipcRenderer.invoke('file:readText', p),
  fsReadBase64: (filePath) => ipcRenderer.invoke('fs:readBase64', filePath),
  fsWriteText: (filePath, content) => ipcRenderer.invoke('file:writeText', filePath, content),

  // Python dependency check
  pythonDepsCheck: () => ipcRenderer.invoke('pythonDeps:check'),
  pythonDepsWarning: () => ipcRenderer.invoke('pythonDeps:warning'),

  // Auto-updater
  updaterStatus: () => ipcRenderer.invoke('updater:status'),
  updaterCheckNow: () => ipcRenderer.invoke('updater:checkNow'),
  updaterQuitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),

  // Machines
  machinesList: () => ipcRenderer.invoke('machines:list'),
  machinesCatalog: () => ipcRenderer.invoke('machines:catalog'),
  machinesSaveUser: (profile) => ipcRenderer.invoke('machines:saveUser', profile),
  machinesDeleteUser: (machineId) => ipcRenderer.invoke('machines:deleteUser', machineId),
  machinesImportJson: (text) => ipcRenderer.invoke('machines:importJson', text),
  machinesImportFile: (filePath) => ipcRenderer.invoke('machines:importFile', filePath),
  machinesExportUser: (machineId) => ipcRenderer.invoke('machines:exportUser', machineId),
  machinesImportCpsFile: (filePath) => ipcRenderer.invoke('machines:importCpsFile', filePath),
  machinesPickAndImportCps: () => ipcRenderer.invoke('machines:pickAndImportCps'),

  // STL / Mesh
  stlStage: (projectDir, stlPath) => ipcRenderer.invoke('stl:stage', projectDir, stlPath),
  stlTransformForCam: (payload) => ipcRenderer.invoke('stl:transformForCam', payload),
  assetsImportMesh: (projectDir, sourcePath, pythonPath, placement) =>
    ipcRenderer.invoke('assets:importMesh', projectDir, sourcePath, pythonPath, placement ?? {}),

  // CAM
  camRun: (payload) => ipcRenderer.invoke('cam:run', payload),
  camCancel: () => ipcRenderer.invoke('cam:cancel'),
  onCamProgress: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: CamProgressEvent): void => {
      callback(data)
    }
    ipcRenderer.on('cam:progress', handler)
    return () => { ipcRenderer.removeListener('cam:progress', handler) }
  },
  sliceCura: (payload) => ipcRenderer.invoke('slice:cura', payload),

  // Manufacture file
  manufactureLoad: (projectDir) => ipcRenderer.invoke('manufacture:load', projectDir),
  manufactureSave: (projectDir, json) => ipcRenderer.invoke('manufacture:save', projectDir, json),

  // Tools
  toolsRead: (projectDir) => ipcRenderer.invoke('tools:read', projectDir),
  toolsSave: (projectDir, lib) => ipcRenderer.invoke('tools:save', projectDir, lib),
  toolsImport: (projectDir, payload) => ipcRenderer.invoke('tools:import', projectDir, payload),
  toolsImportFile: (projectDir, filePath) => ipcRenderer.invoke('tools:importFile', projectDir, filePath),
  machineToolsRead: (machineId) => ipcRenderer.invoke('machineTools:read', machineId),
  machineToolsSave: (machineId, lib) => ipcRenderer.invoke('machineTools:save', machineId, lib),
  machineToolsImport: (machineId, payload) => ipcRenderer.invoke('machineTools:import', machineId, payload),
  machineToolsImportFile: (machineId, filePath) => ipcRenderer.invoke('machineTools:importFile', machineId, filePath),
  machineToolsMigrateFromProject: (machineId, projectDir) =>
    ipcRenderer.invoke('machineTools:migrateFromProject', machineId, projectDir),

  // Design/Assembly read-only
  designLoad: (projectDir) => ipcRenderer.invoke('design:load', projectDir),
  assemblyReadStlBase64: (projectDir, meshPath) => ipcRenderer.invoke('assembly:readStlBase64', projectDir, meshPath),
  meshPreviewStlBase64: (sourcePath, pythonPath) => ipcRenderer.invoke('mesh:previewStlBase64', sourcePath, pythonPath),
  featuresLoad: (projectDir) => ipcRenderer.invoke('features:load', projectDir),
  featuresSave: (projectDir, json) => ipcRenderer.invoke('features:save', projectDir, json),
  designSave: (projectDir, json) => ipcRenderer.invoke('design:save', projectDir, json),
  designReadKernelManifest: (projectDir) => ipcRenderer.invoke('design:readKernelManifest', projectDir),
  designReadKernelStlBase64: (projectDir) => ipcRenderer.invoke('design:readKernelStlBase64', projectDir),
  modelExportStl: (projectDir, filename, base64) => ipcRenderer.invoke('model:exportStl', { projectDir, filename, base64 }),

  // Post-processors
  postsList: () => ipcRenderer.invoke('posts:list'),
  postsSave: (filename, content) => ipcRenderer.invoke('posts:save', filename, content),
  postsRead: (filename) => ipcRenderer.invoke('posts:read', filename),
  postsUploadFile: (filePath) => ipcRenderer.invoke('posts:uploadFile', filePath),
  postsPickAndUpload: () => ipcRenderer.invoke('posts:pickAndUpload'),

  // Materials
  materialsList: () => ipcRenderer.invoke('materials:list'),
  materialsSave: (record) => ipcRenderer.invoke('materials:save', record),
  materialsDelete: (id) => ipcRenderer.invoke('materials:delete', id),
  materialsImportJson: (jsonText) => ipcRenderer.invoke('materials:importJson', jsonText),
  materialsImportFile: (filePath) => ipcRenderer.invoke('materials:importFile', filePath),
  materialsPickAndImport: () => ipcRenderer.invoke('materials:pickAndImport'),

  // Machine upload
  moonrakerPush: (payload) => ipcRenderer.invoke('moonraker:push', payload),
  moonrakerStatus: (printerUrl, timeoutMs) => ipcRenderer.invoke('moonraker:status', printerUrl, timeoutMs),
  moonrakerCancel: (printerUrl, timeoutMs) => ipcRenderer.invoke('moonraker:cancel', printerUrl, timeoutMs),
  moonrakerPause: (printerUrl, timeoutMs) => ipcRenderer.invoke('moonraker:pause', printerUrl, timeoutMs),
  moonrakerResume: (printerUrl, timeoutMs) => ipcRenderer.invoke('moonraker:resume', printerUrl, timeoutMs),
  carveraUpload: (payload) => ipcRenderer.invoke('carvera:upload', payload),
  carveraGenerateSetup: (payload) => ipcRenderer.invoke('carvera:generateSetup', payload),

  // DXF Import
  dxfImport: (filePath) => ipcRenderer.invoke('dxf:import', filePath),

  // Material Audit
  materialAudit: () => ipcRenderer.invoke('material:audit'),

  // Fixture Collision Check
  fixtureCheckCollision: (payload) => ipcRenderer.invoke('fixture:checkCollision', payload),

  // Multi-Setup Automation
  setupAutoAssignWcs: (setups) => ipcRenderer.invoke('setup:autoAssignWcs', setups),
  setupValidate: (setups) => ipcRenderer.invoke('setup:validate', setups),
  setupSuggestFlip: (payload) => ipcRenderer.invoke('setup:suggestFlip', payload),

  // Probing Cycles
  probeGenerate: (payload) => ipcRenderer.invoke('probe:generate', payload),
}

contextBridge.exposeInMainWorld('fab', api)
