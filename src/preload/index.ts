/**
 * WorkTrack3D preload — exposes CAM/fabrication + core IPC to the renderer.
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
import type { FilamentRecord } from '../shared/filament-schema'
import type { CarveraUploadPayload, CarveraUploadResult } from '../main/carvera-cli-run'
import type { GcodeTempSample } from '../shared/gcode-temp-validator'
import type { FdmLayerBreakdownResult } from '../shared/fdm-gcode-layer-breakdown'
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
import type { CamRunPayload, CamRunResultContract } from '../shared/cam-ipc-contract'
import type {
  WizardSamplesAvailability,
  WizardCopySampleRequest,
  WizardCopySampleResult,
  WizardReadCadSampleRequest,
  WizardReadCadSampleResult
} from '../shared/first-launch-wizard-contract'
import type {
  NestOptions,
  NestResult,
  Polygon as NestPolygon,
  SheetSpec
} from '../main/nesting/true-shape-v1'
import type {
  CadCreateAssemblyPayload,
  CadCreateAssemblyResponse,
  CadExecutePayload,
  CadExecuteResponse,
  CadExportAssemblyPayload,
  CadExportAssemblyResponse,
  CadExportDrawingPayload,
  CadExportDrawingResponse,
  CadExportPayload,
  CadExportResponse,
  CadListOperationsPayload,
  CadListOperationsResponse,
  CadProjectDrawingPayload,
  CadProjectDrawingResponse,
  CadSolveSketchPayload,
  CadSolveSketchResponse,
  CadTessellateAssemblyPayload,
  CadTessellateAssemblyResponse,
  CadTessellateWithIdsPayload,
  CadTessellateWithIdsResponse
} from '../main/ipc-cad'
import type { MachineEstopPayload, MachineEstopResult } from '../main/ipc-machine'

export type Api = {
  // ── Core ──────────────────────────────────────────────────────────────────
  appGetVersion: () => Promise<string>
  settingsGet: () => Promise<AppSettings>
  settingsSet: (partial: Partial<AppSettings>) => Promise<AppSettings>
  projectOpenDir: () => Promise<string | null>
  projectRead: (dir: string) => Promise<ProjectFile>
  projectCreate: (payload: { dir: string; name: string; machineId: string }) => Promise<ProjectFile>
  projectSave: (dir: string, project: ProjectFile) => Promise<void>
  /** First-launch wizard: which machines have bundled starter STLs on disk. */
  samplesList: () => Promise<WizardSamplesAvailability>
  /** First-launch wizard: copy the bundled sample STL into `<projectDir>/assets/`. */
  wizardCopySample: (payload: WizardCopySampleRequest) => Promise<WizardCopySampleResult>
  /** First-launch wizard: read the bundled CadQuery starter script for a machine. */
  wizardReadCadSample: (payload: WizardReadCadSampleRequest) => Promise<WizardReadCadSampleResult>
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
  camRun: (payload: CamRunPayload) => Promise<CamRunResultContract>
  /** Cancel any currently running cam:run operation. Returns `{ cancelled: true }` if a run was aborted, `{ cancelled: false }` if no run was active. */
  camCancel: () => Promise<{ cancelled: boolean }>
  /**
   * Subscribe to real-time CAM progress events from the Python engine.
   * Returns an unsubscribe function. Events are forwarded from main via `cam:progress`.
   */
  onCamProgress: (callback: (event: CamProgressEvent) => void) => () => void
  /**
   * 2026-05-27 OrcaSlicer pivot (task #9). Bridges the renderer's K2 Plus
   * slice button to the bundled OrcaSlicer CLI via the `slice:orca` IPC
   * handler. Profile JSON files are resolved in the main process from
   * `resources/orca-slicer/profiles/{machines,process,filament}/<id>.json`
   * (switched from .ini -> .json on 2026-05-27 CLI fix).
   */
  sliceOrca: (payload: {
    stlPath: string
    outPath: string
    machineId: string
    qualityPresetId?: 'standard' | 'high_speed'
    filamentId?: string
    overrides?: Record<string, string | number>
  }) => Promise<
    | { ok: true; outputGcodePath: string; stdout: string; stderr: string }
    | { ok: false; error: string; hint?: string; stdout?: string; stderr?: string }
  >
  /**
   * Settings-panel helper — reports whether the bundled OrcaSlicer CLI binary
   * is present at the expected platform path. Pure filesystem check; no
   * subprocess spawn. Used by the Real Settings view (Paths subsection) to
   * render "Bundled" vs "Not bundled — run scripts/bundle-orca-slicer.ps1".
   */
  slicerOrcaStatus: () => Promise<{ bundled: boolean; expectedPath: string; platform: string }>
  /**
   * CAD V1.5 — TRUE per-layer slice breakdown for the K2 Plus FDM Preview
   * stage. Streams the sliced G-code file in the main process
   * (`slice:layerBreakdown` -> `fdm-gcode-stream-parser.ts`) and returns
   * real per-layer time / filament / line-type stats, degrading gracefully
   * to a uniform distribution from the header totals when per-layer comments
   * are absent. Session-only result; never persisted.
   */
  sliceLayerBreakdown: (payload: { gcodePath: string }) => Promise<
    | { ok: true; result: FdmLayerBreakdownResult }
    | { ok: false; error: string; hint?: string }
  >

  // ── Manufacture file ─────────────────────────────────────────────────────
  manufactureLoad: (projectDir: string) => Promise<ManufactureFile>
  manufactureSave: (projectDir: string, json: string) => Promise<void>
  /** Mtime compare: source meshes vs posted `output/cam.nc` (or custom relative path). */
  camSourceStaleVersusOutput: (
    projectDir: string,
    meshRelPaths: string[],
    gcodeRelativePath?: string
  ) => Promise<
    | {
        ok: true
        gcodeMtimeMs: number | null
        gcodeRelativePath: string
        meshes: { relativePath: string; mtimeMs: number | null }[]
        staleRelativePaths: string[]
        noGcode: boolean
      }
    | { ok: false; error: string }
  >

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
  /**
   * Phase 2 (IPC) + Phase 3 (UI): run the iterative assembly mate solver on the given assembly
   * input. Returns solved transforms, diagnostics, and (when mateConstraints are present) a
   * SolverConvergenceReport. Delegates to the `assembly:solve` IPC channel.
   */
  assemblySolve: (assemblyInput: unknown) => Promise<{
    ok: true
    transforms: Array<{ id: string; transform: { x: number; y: number; z: number; rxDeg: number; ryDeg: number; rzDeg: number } }>
    diagnostics: {
      violations: unknown[]
      clampedDofs: string[]
      residuals: number[]
      convergenceReport?: {
        converged: boolean
        iterations: number
        finalResidual: number
        perConstraintResiduals: Array<{ constraintId: string; residual: number }>
        status: 'converged' | 'max_iterations_reached' | 'diverged' | 'over_constrained' | 'under_constrained'
        conflictingConstraintIds?: string[]
        freeVariableCount?: number
      }
    }
    convergenceReport?: {
      converged: boolean
      iterations: number
      finalResidual: number
      perConstraintResiduals: Array<{ constraintId: string; residual: number }>
      status: 'converged' | 'max_iterations_reached' | 'diverged' | 'over_constrained' | 'under_constrained'
      conflictingConstraintIds?: string[]
      freeVariableCount?: number
    }
  }>
  /**
   * Phase 2 (IPC): run a real motion study for the given assembly by stepping jointed components
   * across their limit range. `sampleCount` defaults to 12 (clamped 1-200). Returns one pose per
   * sample with per-sample transforms (each sample has a distinct joint-state fraction).
   */
  assemblySimulate: (assemblyInput: unknown, sampleCount?: number) => Promise<{
    ok: true
    sampleCount: number
    poses: Array<{ sample: number; transforms: Array<{ id: string; transform: unknown }> }>
    diagnostics: unknown
    convergenceReport?: unknown
  }>
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

  // ── Filaments ────────────────────────────────────────────────────────────
  filamentsList: () => Promise<FilamentRecord[]>
  filamentsSave: (record: FilamentRecord) => Promise<FilamentRecord>
  filamentsDelete: (id: string) => Promise<boolean>

  // ── Machine upload ───────────────────────────────────────────────────────
  moonrakerPush: (payload: {
    gcodePath: string
    printerUrl: string
    uploadPath?: string
    startAfterUpload?: boolean
    timeoutMs?: number
    /**
     * Optional active machine id. When supplied, the main-process
     * `moonraker:push` handler resolves `maxNozzleTempC` / `maxBedTempC` /
     * `chamberTempC` from the profile and threads them through the
     * pre-upload temperature validator (see [ID-0070]/[ID-0073]/[ID-0078]).
     * Absent machineId = byte-identical pre-[ID-0078] behavior.
     */
    machineId?: string
  }) => Promise<
    | {
        ok: true
        filename: string
        uploadedPath: string
        printStarted: boolean
        printerUrl: string
        /**
         * [ID-0072-followup] Cycle 50: align the preload type with
         * `MoonrakerPushResult` from `src/main/moonraker-push.ts`
         * so the renderer can read pre-flight validator samples on
         * the success path too once a future cycle widens the main-
         * process handler. Today the success branch never carries
         * samples; the optional shape is purely future-proofing the
         * renderer-side typing without requiring another preload
         * change.
         */
        tempValidation?: { samples?: readonly GcodeTempSample[] }
        /**
         * Quick-win bundle (undo/redo + K2 thumbnail + Klipper header):
         * non-fatal advisory warnings the main-process parser emitted
         * (typical: "no '; thumbnail begin' block detected ..."). Upload
         * still succeeded; renderer should soft-toast each entry.
         */
        warnings?: readonly string[]
        /**
         * Quick-win bundle: structured `GcodeHeaderHealth` snapshot so the
         * renderer can render a badge before Send. Optional shape -- main
         * process only populates when the bounded header read succeeded.
         */
        headerHealth?: {
          ok: boolean
          missingFields: readonly string[]
          fields: {
            timeSeconds?: number
            filament?: { mm?: number; grams?: number }
            layerCount?: number
            thumbnail?: { widthPx: number; heightPx: number; bytes: number }
          }
          summary: string
        }
      }
    | {
        ok: false
        error: string
        detail?: string
        /**
         * [ID-0072-followup] Cycle 50: structured pre-upload
         * temperature validator samples (Cycle 27 [ID-0072]). Present
         * when `validateGcodeFileTemps` produced a sample set --
         * either because a violation blocked the upload or for a
         * future preview-only path.
         */
        tempValidation?: { samples?: readonly GcodeTempSample[] }
      }
  >
  moonrakerStatus: (printerUrl: string, timeoutMs?: number) => Promise<
    | { ok: true; state: string; filename?: string; progress?: number; etaSeconds?: number; rawState?: string }
    | { ok: false; error: string; detail?: string }
  >
  moonrakerCancel: (printerUrl: string, timeoutMs?: number) => Promise<{ ok: boolean; error?: string }>
  moonrakerPause: (printerUrl: string, timeoutMs?: number) => Promise<{ ok: boolean; error?: string }>
  moonrakerResume: (printerUrl: string, timeoutMs?: number) => Promise<{ ok: boolean; error?: string }>
  /**
   * Rich "Test connection" probe for Settings → Network & Printers
   * (Creality K2 Plus). Fetches printer hostname / Klipper firmware
   * version / live bed + nozzle temperatures so the operator can verify
   * they are talking to the real K2 Plus without opening Fluidd.
   *
   * Errors NEVER reject — every failure is surfaced as a structured
   * `{ ok: false, error, detail }` so the UI can show a real reason.
   */
  moonrakerInfo: (printerUrl: string, timeoutMs?: number) => Promise<
    | {
        ok: true
        hostname?: string
        firmwareVersion?: string
        state?: string
        bed?: { presentC?: number; targetC?: number }
        nozzle?: { presentC?: number; targetC?: number }
      }
    | { ok: false; error: string; detail?: string }
  >
  /**
   * Pre-flight Moonraker temperature preview hook ([ID-0072-followup],
   * Cycle 50 ui-polish). Lightweight signal that the renderer is about
   * to surface a `formatFdmTempPreview` banner above the Send button.
   * The handler does NOT touch the network or any device -- it exists
   * so a future telemetry / dry-run path has a single registered IPC
   * channel to attach to. Returns `{ ok: false, reason }` when there
   * is nothing to preview (empty / fully invalid samples).
   */
  moonrakerPreview: (
    samples: readonly GcodeTempSample[]
  ) => Promise<{ ok: true } | { ok: false; reason: string }>
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

  // ── K2 Plus Calibration Suite ───────────────────────────────────────────
  /**
   * Gap #4 (docs/COMPETITIVE-GAP-ANALYSIS.md): build a K2 Plus calibration
   * G-code file (temperature tower, flow rate, or pressure advance). The
   * main-process handler writes the file to `outputGcodePath` and returns
   * the absolute path so the renderer can offer "Send to K2 Plus" via the
   * existing `moonraker:push` IPC.
   */
  calibrationGenerate: (payload:
    | {
        kind: 'temperature-tower'
        params: {
          outputGcodePath: string
          startTempC?: number
          endTempC?: number
          stepTempC?: number
          bedTempC?: number
        }
      }
    | {
        kind: 'flow-rate'
        params: {
          outputGcodePath: string
          cubeSizeMm?: number
          cubeHeightMm?: number
          wallCount?: number
          nozzleTempC?: number
          bedTempC?: number
        }
      }
    | {
        kind: 'pressure-advance'
        params: {
          outputGcodePath: string
          startPa?: number
          endPa?: number
          stepPa?: number
          lineLengthMm?: number
          nozzleTempC?: number
          bedTempC?: number
        }
      }
    | {
        kind: 'retraction-tower'
        params: {
          outputGcodePath: string
          startRetractMm?: number
          endRetractMm?: number
          stepRetractMm?: number
          bandHeightMm?: number
          pillarGapMm?: number
          pillarSizeMm?: number
          retractSpeedMmPerSec?: number
          nozzleTempC?: number
          bedTempC?: number
        }
      }
    | {
        kind: 'max-volumetric-flow'
        params: {
          outputGcodePath: string
          startFlowMmCubePerSec?: number
          endFlowMmCubePerSec?: number
          stepFlowMmCubePerSec?: number
          bandHeightMm?: number
          tubeDiameterMm?: number
          nozzleTempC?: number
          bedTempC?: number
          filamentDensity?: number
        }
      }
    | {
        kind: 'tolerance'
        params: {
          outputGcodePath: string
          cubeSizeMm?: number
          pegHoleCount?: number
          holeBaseDiameterMm?: number
          clearanceStepMm?: number
          nozzleTempC?: number
          bedTempC?: number
        }
      }
    | {
        kind: 'cornering'
        params: {
          outputGcodePath: string
          startScvMmPerSec?: number
          endScvMmPerSec?: number
          stepScvMmPerSec?: number
          bandHeightMm?: number
          squareSizeMm?: number
          printSpeedMmPerSec?: number
          nozzleTempC?: number
          bedTempC?: number
        }
      }
    | {
        kind: 'vfa'
        params: {
          outputGcodePath: string
          tubeDiameterMm?: number
          tubeHeightMm?: number
          wallSpeedMmPerSec?: number
          nozzleTempC?: number
          bedTempC?: number
        }
      }
  ) => Promise<
    | { ok: true; outputGcodePath: string; description: string; args: string[] }
    | { ok: false; error: string; hint?: string }
  >

  /**
   * Gap #9 (docs/COMPETITIVE-GAP-ANALYSIS.md): Laguna true-shape nesting v1.
   * Pure planning call — no G-code is emitted. The renderer collects polygons
   * from cnc_contour ops, calls this with the sheet spec, then writes the
   * resulting placements back onto each op's `params.placement` field for the
   * post-processor to consume. Laguna-only in the UI.
   */
  nestingNestPolygons: (payload: {
    parts: ReadonlyArray<NestPolygon>
    sheet: SheetSpec
    opts?: NestOptions
  }) => Promise<{ ok: true; result: NestResult } | { ok: false; error: string; hint?: string }>

  // ── Machine control (Workflow F: AppHeader STOP button) ─────────────────
  /**
   * Safety-critical e-stop dispatch keyed on `machineId`:
   *   - `creality-k2-plus`     → POST Moonraker `/printer/emergency_stop`
   *                              (canonical Klipper M112 abort path).
   *   - `makera-carvera-*`     → structured fallback toast — the community
   *                              carvera-cli does not expose an abort verb,
   *                              so the operator must use the physical
   *                              e-stop button.
   *   - `laguna-swift-5x10`    → structured "no remote abort" toast —
   *                              the RichAuto pendant's red mushroom
   *                              button is the only abort channel.
   *
   * Errors NEVER throw — every failure folds into
   * `{ ok: false, error, hint? }` so the AppHeader can render an
   * advisory toast without try/catch.
   */
  machine: {
    estop: (payload: MachineEstopPayload) => Promise<MachineEstopResult>
  }

  // ── Parametric CAD Design workspace (BUILD 2) ───────────────────────────
  /**
   * Parametric CAD bridge over the Python sidecar. Backed by
   * `src/main/ipc-cad.ts` -- which fans out to `cad.execute_script` /
   * `cad.export` / `cad.list_operations` in `engines/sidecar/cad_handlers.py`.
   *
   * The renderer's Design workspace consumes this surface; errors NEVER
   * throw -- every failure folds into `{ ok: false, error, hint? }`.
   */
  cad: {
    /**
     * Run a CadQuery script via cqgi.parse(...).build(...). Each
     * `show_object` body is tessellated to a binary STL (0.1 mm tolerance
     * default; Safety Rule 1: degenerate triangles are filtered before
     * write) and stashed in the sidecar handle table so cad.export /
     * cam.run_toolpath can reach it later.
     */
    execute: (payload: CadExecutePayload) => Promise<CadExecuteResponse>
    /**
     * Export the body referenced by `handle` to STEP / STL / DXF. The
     * sidecar validates `outPath` is absolute and under the project root
     * before writing. Used by the "Send to CAM" handoff (STL at 0.1 mm
     * tolerance) and the future Export menu.
     */
    export: (payload: CadExportPayload) => Promise<CadExportResponse>
    /**
     * Static parse of the script -- AST walk + cqgi.parse for declared
     * parameters. Does NOT execute the script; safe to debounce on
     * every keystroke for the Design workspace's read-only FeatureTree.
     */
    listOperations: (payload: CadListOperationsPayload) => Promise<CadListOperationsResponse>
    /**
     * Selection-grade tessellation (CAD V1 Workflow H foundation).
     * Returns the same per-triangle vertex/index buffers as
     * `cad.tessellate`, plus a parallel `faceIds` array so the renderer
     * can map a clicked triangle back to the source CadQuery face. Used
     * by the Design workspace to power 3D entity picking (the
     * Viewport3D ray-pick handler stashes `faceIds` onto the mesh's
     * `userData` so the click handler can resolve a face ID in O(1)).
     */
    tessellateWithIds: (
      payload: CadTessellateWithIdsPayload
    ) => Promise<CadTessellateWithIdsResponse>
    /**
     * CAD V1 sketcher: solve a 2D constraint system server-side via
     * the sidecar's `cad.solve_sketch` handler. The renderer's
     * Sketch2DCanvas dispatches this whenever constraints / parameters
     * change so the solved positions stay in sync with the geometry
     * engine the rest of the CAD pipeline uses.
     */
    solveSketch: (
      payload: CadSolveSketchPayload
    ) => Promise<CadSolveSketchResponse>
    /**
     * CAD V2 Assembly view (Wave 2): resolve an assembly tree
     * (instances / parts / joints) into the sidecar handle table.
     * Returns the parent assembly handle + a union bbox so the renderer
     * can frame the assembly before a separate `tessellateAssembly` call.
     * Delegates to the sidecar's `cad.create_assembly` (Agent A1).
     */
    createAssembly: (
      payload: CadCreateAssemblyPayload
    ) => Promise<CadCreateAssemblyResponse>
    /**
     * CAD V2 Assembly view: per-instance binary STL emission for the
     * Assembly viewport. Returns one mesh per visible instance so the
     * renderer can place each STL in world space. Delegates to
     * `cad.tessellate_assembly`.
     */
    tessellateAssembly: (
      payload: CadTessellateAssemblyPayload
    ) => Promise<CadTessellateAssemblyResponse>
    /**
     * CAD V2 Assembly view: export the assembled body referenced by
     * `handle` to STEP or STL on disk. DXF is rejected at the IPC
     * validator -- it makes no sense for a multi-part 3D body.
     * Delegates to `cad.export_assembly`.
     */
    exportAssembly: (
      payload: CadExportAssemblyPayload
    ) => Promise<CadExportAssemblyResponse>
    /**
     * CAD V2 Drawing view (Wave 2): run the documentation projection
     * pipeline for a single `DrawingSheet`. Returns projected linework
     * (visible + hidden segments) per `viewPlaceholder` so the renderer
     * can draw the 2D documentation canvas. Delegates to
     * `cad.project_drawing` (Agent A2). No G-code involved.
     */
    projectDrawing: (
      payload: CadProjectDrawingPayload
    ) => Promise<CadProjectDrawingResponse>
    /**
     * CAD V2 Drawing view: render the projected linework into PDF or
     * DXF on disk. Whitelist enforced at the validator
     * (`CAD_DRAWING_EXPORT_FORMATS`). Delegates to `cad.export_drawing`.
     */
    exportDrawing: (
      payload: CadExportDrawingPayload
    ) => Promise<CadExportDrawingResponse>
    /**
     * CAD V1.5 Assembly mate (Wave 3): attach a structural mate to the
     * assembly handle table (coincident / concentric / distance / angle).
     * Permissive payload/result envelopes -- mirrors the precedent set by
     * `solveSketch` / `createAssembly` / `projectDrawing` so the renderer
     * and sidecar can co-evolve the mate-schema without dragging the IPC
     * boundary along. Errors fold into `{ ok: false, error, hint? }`.
     * Delegates to the sidecar's `cad.add_assembly_mate` handler.
     */
    addAssemblyMate: (
      payload: Record<string, unknown>
    ) => Promise<
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: string; hint?: string }
    >
    /**
     * CAD V1.5 Drawing dimension (Wave 3): stamp a dimension annotation
     * (linear / radial / angular / diametric) onto a projected drawing
     * view. Permissive envelope -- the renderer's Zod parser owns the
     * deep dimension shape (anchor points, alignment, tolerance string).
     * Delegates to `cad.dimension_drawing`.
     */
    dimensionDrawing: (
      payload: Record<string, unknown>
    ) => Promise<
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: string; hint?: string }
    >
    /**
     * CAD V1.5 Drawing section view (Wave 3): cut a section plane through
     * a body and return the projected sectioned linework + hatch regions.
     * Permissive envelope -- ``handle`` references a body or assembly in
     * the sidecar handle table and ``sheet`` carries the section-line
     * placement + hatch options. Delegates to `cad.section_drawing`.
     */
    sectionDrawing: (
      payload: Record<string, unknown>
    ) => Promise<
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: string; hint?: string }
    >
    /**
     * CAD V1.5 3D viewport section (Wave 3): compute a true hidden-line-
     * removal section overlay (visible/hidden edges + cap face) for a body
     * handle. Distinct from `sectionDrawing` (2D SVG). Permissive envelope --
     * the renderer builds the typed { handle, planeNormal, planeOffset,
     * viewDir, toleranceMm? } payload. Delegates to `cad.hlr_section`.
     */
    hlrSection: (
      payload: Record<string, unknown>
    ) => Promise<
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: string; hint?: string }
    >
    /**
     * CAD V1.5 Title block (Wave 3): attach (or replace) a title-block
     * metadata blob on a drawing sheet so the next `exportDrawing` call
     * stamps it onto the rendered shell. Permissive envelope -- the
     * renderer's `drawingSheetSchema` Zod parser owns the title-block
     * field shape (company / part-number / revision / date / etc.).
     * Delegates to `cad.attach_title_block`.
     */
    attachTitleBlock: (
      payload: Record<string, unknown>
    ) => Promise<
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: string; hint?: string }
    >
    /**
     * CAD V1.5 Associative-dimension geometry (Wave 3): project a body handle
     * for a view and return the projected vertices / edges / snap points WITH
     * stable ids. The renderer's DrawingView feeds the snapPoints into its
     * two-click dimension placement so a placed dimension records the snapped
     * feature's `sourceId` (associative anchor). Permissive envelope --
     * the renderer builds the typed { handle, view } payload and reads the
     * { view, vertices, edges, snapPoints } result. Delegates to
     * `cad.extract_drawing_geometry`. No G-code involved.
     */
    extractDrawingGeometry: (
      payload: Record<string, unknown>
    ) => Promise<
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: string; hint?: string }
    >
    /**
     * CAD V1.5 BOM table (Wave 3): stamp a bill-of-materials table `<g>` into
     * an SVG from the rows the assembly already provides. Pure SVG
     * composition -- does NOT recompute the BOM. Permissive envelope -- the
     * renderer passes { svg, rows, columns?, title? } and reads the
     * { svg, bytes, rowCount } result. Delegates to `cad.drawing_bom_table`.
     */
    drawingBomTable: (
      payload: Record<string, unknown>
    ) => Promise<
      | { ok: true; result: Record<string, unknown> }
      | { ok: false; error: string; hint?: string }
    >
  }
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
  samplesList: () => ipcRenderer.invoke('samples:list'),
  wizardCopySample: (payload) => ipcRenderer.invoke('wizard:copySample', payload),
  wizardReadCadSample: (payload) => ipcRenderer.invoke('wizard:readCadSample', payload),
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
  sliceOrca: (payload) => ipcRenderer.invoke('slice:orca', payload),
  slicerOrcaStatus: () => ipcRenderer.invoke('slicer:orcaStatus'),
  sliceLayerBreakdown: (payload) => ipcRenderer.invoke('slice:layerBreakdown', payload),

  // Manufacture file
  manufactureLoad: (projectDir) => ipcRenderer.invoke('manufacture:load', projectDir),
  manufactureSave: (projectDir, json) => ipcRenderer.invoke('manufacture:save', projectDir, json),
  camSourceStaleVersusOutput: (projectDir, meshRelPaths, gcodeRelativePath) =>
    ipcRenderer.invoke('fabrication:camSourceStaleVersusOutput', projectDir, meshRelPaths, gcodeRelativePath),

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
  assemblySolve: (assemblyInput) => ipcRenderer.invoke('assembly:solve', assemblyInput),
  assemblySimulate: (assemblyInput, sampleCount) => ipcRenderer.invoke('assembly:simulate', assemblyInput, sampleCount),
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

  // Filaments
  filamentsList: () => ipcRenderer.invoke('filaments:list'),
  filamentsSave: (record) => ipcRenderer.invoke('filaments:save', record),
  filamentsDelete: (id) => ipcRenderer.invoke('filaments:delete', id),

  // Machine upload
  moonrakerPush: (payload) => ipcRenderer.invoke('moonraker:push', payload),
  moonrakerStatus: (printerUrl, timeoutMs) => ipcRenderer.invoke('moonraker:status', printerUrl, timeoutMs),
  moonrakerCancel: (printerUrl, timeoutMs) => ipcRenderer.invoke('moonraker:cancel', printerUrl, timeoutMs),
  moonrakerPause: (printerUrl, timeoutMs) => ipcRenderer.invoke('moonraker:pause', printerUrl, timeoutMs),
  moonrakerResume: (printerUrl, timeoutMs) => ipcRenderer.invoke('moonraker:resume', printerUrl, timeoutMs),
  moonrakerInfo: (printerUrl, timeoutMs) => ipcRenderer.invoke('moonraker:info', printerUrl, timeoutMs),
  moonrakerPreview: (samples) => {
    // Short-circuit absent / empty samples WITHOUT invoking the IPC
    // channel -- preserves the renderer-side guarantee that an empty
    // banner never produces telemetry noise.
    if (!Array.isArray(samples) || samples.length === 0) {
      return Promise.resolve({ ok: false as const, reason: 'no-samples' })
    }
    return ipcRenderer.invoke('moonraker:preview', samples) as Promise<
      { ok: true } | { ok: false; reason: string }
    >
  },
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

  // K2 Plus Calibration Suite
  calibrationGenerate: (payload) => ipcRenderer.invoke('calibration:generate', payload),

  // Laguna true-shape nesting v1 (Gap #9)
  nestingNestPolygons: (payload) => ipcRenderer.invoke('nesting:nest-polygons', payload),

  // Machine control (Workflow F: AppHeader STOP button)
  machine: {
    estop: (payload) =>
      ipcRenderer.invoke('machine:estop', payload) as Promise<MachineEstopResult>
  },

  // Parametric CAD Design workspace (BUILD 2 + CAD V1 sketcher + CAD V2 assembly/drawing)
  cad: {
    execute: (payload) => ipcRenderer.invoke('cad:execute', payload) as Promise<CadExecuteResponse>,
    export: (payload) => ipcRenderer.invoke('cad:export', payload) as Promise<CadExportResponse>,
    listOperations: (payload) =>
      ipcRenderer.invoke('cad:listOperations', payload) as Promise<CadListOperationsResponse>,
    tessellateWithIds: (payload) =>
      ipcRenderer.invoke('cad:tessellateWithIds', payload) as Promise<CadTessellateWithIdsResponse>,
    solveSketch: (payload) =>
      ipcRenderer.invoke('cad:solveSketch', payload) as Promise<CadSolveSketchResponse>,
    // CAD V2 — Assembly view
    createAssembly: (payload) =>
      ipcRenderer.invoke('cad:createAssembly', payload) as Promise<CadCreateAssemblyResponse>,
    tessellateAssembly: (payload) =>
      ipcRenderer.invoke('cad:tessellateAssembly', payload) as Promise<CadTessellateAssemblyResponse>,
    exportAssembly: (payload) =>
      ipcRenderer.invoke('cad:exportAssembly', payload) as Promise<CadExportAssemblyResponse>,
    // CAD V2 — Drawing view
    projectDrawing: (payload) =>
      ipcRenderer.invoke('cad:projectDrawing', payload) as Promise<CadProjectDrawingResponse>,
    exportDrawing: (payload) =>
      ipcRenderer.invoke('cad:exportDrawing', payload) as Promise<CadExportDrawingResponse>,
    // CAD V1.5 (Wave 3) -- mates / dimensions / sections / title blocks.
    // Permissive payload/result envelopes; pin-tested by the IPC handler
    // tests Agents 2 + 3 add.
    addAssemblyMate: (payload) =>
      ipcRenderer.invoke('cad:addAssemblyMate', payload) as Promise<
        | { ok: true; result: Record<string, unknown> }
        | { ok: false; error: string; hint?: string }
      >,
    dimensionDrawing: (payload) =>
      ipcRenderer.invoke('cad:dimensionDrawing', payload) as Promise<
        | { ok: true; result: Record<string, unknown> }
        | { ok: false; error: string; hint?: string }
      >,
    sectionDrawing: (payload) =>
      ipcRenderer.invoke('cad:sectionDrawing', payload) as Promise<
        | { ok: true; result: Record<string, unknown> }
        | { ok: false; error: string; hint?: string }
      >,
    hlrSection: (payload) =>
      ipcRenderer.invoke('cad:hlrSection', payload) as Promise<
        | { ok: true; result: Record<string, unknown> }
        | { ok: false; error: string; hint?: string }
      >,
    attachTitleBlock: (payload) =>
      ipcRenderer.invoke('cad:attachTitleBlock', payload) as Promise<
        | { ok: true; result: Record<string, unknown> }
        | { ok: false; error: string; hint?: string }
      >,
    // CAD V1.5 (Wave 3) -- associative-dimension geometry + BOM-table stamp.
    // Permissive payload/result envelopes; the renderer builds the typed
    // { handle, view } / { svg, rows, columns?, title? } payloads.
    extractDrawingGeometry: (payload) =>
      ipcRenderer.invoke('cad:extractDrawingGeometry', payload) as Promise<
        | { ok: true; result: Record<string, unknown> }
        | { ok: false; error: string; hint?: string }
      >,
    drawingBomTable: (payload) =>
      ipcRenderer.invoke('cad:drawingBomTable', payload) as Promise<
        | { ok: true; result: Record<string, unknown> }
        | { ok: false; error: string; hint?: string }
      >
  }
}

contextBridge.exposeInMainWorld('fab', api)
