import { app, dialog, ipcMain } from 'electron'
import { statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { isPathSafe, isPythonPathSafe } from './path-security'
import { describeCamOperationKind } from './cam-operation-policy'
import { runCamDomain } from './cam-domain'
import type { CamProgressEvent } from '../shared/cam-progress'
import { listAllPosts, saveUserPost, readPostContent } from './posts-manager'
import {
  deleteMaterial,
  importMaterialsFile,
  importMaterialsJson,
  listAllMaterials,
  saveMaterial
} from './materials-manager'
import { deleteFilament, listAllFilaments, saveFilament } from './filament-manager'
import { carveraUpload, type CarveraUploadPayload } from './carvera-cli-run'
import {
  generateCarvera4AxisSetup,
  generateCarveraAAxisZero,
  generateCarveraPreflightCheck,
  generateCarveraWcsZero,
  generateCarveraZProbe
} from '../shared/carvera-zeroing'
import { moonrakerCancel, moonrakerPause, moonrakerPush, moonrakerResume, moonrakerStatus } from './moonraker-push'
import { moonrakerInfo } from './moonraker-info'
import { runOrcaSlice } from './slicer/orca-wrapper'
import { parseFdmGcodeLayersFromFile } from './slicer/fdm-gcode-stream-parser'
import type { FdmLayerBreakdownResult } from '../shared/fdm-gcode-layer-breakdown'
import type { FdmCapabilityFields, GcodeTempSample } from '../shared/gcode-temp-validator'
import {
  deleteUserMachine,
  getMachineById,
  importMachineProfileFromFile,
  loadAllMachines,
  loadMachineCatalog,
  parseMachineProfileText,
  saveUserMachine
} from './machines'
import { loadMachineToolLibrary, saveMachineToolLibrary } from './machine-tool-library'
import { getResourcesRoot } from './paths'
// 2026-05-27 pivot: slicer.ts (CuraEngine) was deleted; the OrcaSlicer-backed
// `slice:orca` IPC handler below replaces it (task #9). The previous
// `slice:cura` handler is gone; `stageStlForProject` is inlined here so the
// renderer's STL-staging IPC keeps working without the deleted slicer.ts shim.
import { copyFile, mkdir as mkdirFs } from 'node:fs/promises'

/**
 * Copy an STL into a project's assets/ directory. Inlined from the deleted
 * slicer.ts. Returns the absolute destination path.
 */
async function stageStlForProject(projectDir: string, sourceStlPath: string): Promise<string> {
  const assets = join(projectDir, 'assets')
  await mkdirFs(assets, { recursive: true })
  const base = sourceStlPath.split(/[/\\]/).pop() ?? 'model.stl'
  const dest = join(assets, base)
  await copyFile(sourceStlPath, dest)
  return dest
}
import {
  inferToolRecordsFromFileBuffer,
  mergeToolLibraries,
  parseFusionToolExport,
  parseFusionToolsCsv,
  parseToolsCsv,
  parseToolsJson
} from './tools-import'
import { machineProfileWithSummaryFromCps, type CpsImportSummary } from './machine-cps-import'
import { formatZodError, isENOENT, parseJsonText } from '../shared/file-parse-errors'
import {
  emptyManufacture,
  manufactureFileSchema,
  type ManufactureFile,
  type ManufactureSetup
} from '../shared/manufacture-schema'
import { buildMigrationPipeline, migrateManufactureV1toV2 } from '../shared/schema-migration'
import { toolLibraryFileSchema, type ToolLibraryFile } from '../shared/tool-schema'
import { ZodError } from 'zod'
import type { MainIpcWindowContext } from './ipc-context'
import { loadSettings } from './settings-store'
import { parseDxf, convertDxfToMm } from '../shared/dxf-parser'
import { auditMaterialPresets } from '../shared/material-audit'
import { checkFixtureCollision, type ToolpathPoint } from '../shared/fixture-collision'
import type { FixtureRecord } from '../shared/fixture-schema'
import { autoAssignWcsOffsets, validateSetupSequence, suggestFlipSetup } from '../shared/multi-setup-utils'
import { generateProbeCycle, type ProbeCycleType, type ProbeBaseParams } from '../shared/probing-cycles'
import { camRunPayloadSchema } from '../shared/cam-ipc-contract'
import { listStaleSourceMeshesVersusGcode, type CamSourceMeshMtime } from '../shared/cam-source-stale'
import {
  buildCalibrationGcode,
  type CalibrationGeneratePayload,
  type CalibrationTestKind
} from './calibration/k2-plus-tests'
import {
  nestPolygonsOnSheet,
  type NestOptions,
  type NestResult,
  type Polygon,
  type Rotation,
  type SheetSpec
} from './nesting/true-shape-v1'
import { nestPolygonsNfp, type NfpNestOptions } from './nesting/true-shape-nfp'

export type { MainIpcWindowContext } from './ipc-context'

// ── nesting:nest-polygons wire contract (Wave 3j: NFP v2 default + BLF fallback) ──
//
// Additive-only versus the original v1 wire shape (the renderer + the
// laguna-nesting-pin tests depend on the existing field names):
//   request opts — gains OPTIONAL `engine` ('nfp' default | 'blf' fallback),
//                   `rotationStepDeg`, `maxSheets`; `allowedRotations` widens to
//                   any finite degrees (the BLF path still validates that every
//                   entry is cardinal and reports `nesting_failed` otherwise).
//   result       — placements gain OPTIONAL `sheetIndex` (multi-sheet); the
//                   result gains OPTIONAL `sheetsUsed` / `nestVersion` /
//                   `engineUsed`. No field is removed or renamed.

/** Wire request options for `nesting:nest-polygons`: superset of v1 NestOptions + NFP v2 knobs. */
export interface NestPolygonsWireOptions {
  /** BLF-only: snap grid in mm (ignored by the NFP engine). */
  snapMm?: number
  /** Inter-part clearance in mm (both engines; default 3). */
  partMarginMm?: number
  /**
   * Allowed rotations in degrees. The NFP engine accepts any finite values;
   * the BLF fallback accepts only 0 / 90 / 180 / 270 and rejects others.
   */
  allowedRotations?: ReadonlyArray<number>
  /** Engine selector (additive). Default 'nfp' — true-shape No-Fit-Polygon, multi-sheet. */
  engine?: 'nfp' | 'blf'
  /** NFP-only: candidate rotations 0, step, 2·step, … < 360 (valid range 1..360). */
  rotationStepDeg?: number
  /** NFP-only: multi-sheet overflow cap (default 8, hard cap 16). */
  maxSheets?: number
}

/** Wire placement: the v1 triple + OPTIONAL additive `sheetIndex` (NFP multi-sheet). */
export interface NestPolygonsWirePlacement {
  partId: string
  xMm: number
  yMm: number
  /** CCW degrees. BLF emits only 0/90/180/270; NFP may emit any allowed rotation. */
  rotationDeg: number
  /** 0-based sheet this part landed on (NFP only). Absent = sheet 0 (v1 BLF shape). */
  sheetIndex?: number
}

/**
 * Wire result: field-for-field superset of the v1 NestResult. Enforced via
 * `extends Omit<NestResult, 'placements'>` so renaming/removing a v1 field
 * becomes a compile error here, not a silent renderer break.
 */
export interface NestPolygonsWireResult extends Omit<NestResult, 'placements'> {
  placements: NestPolygonsWirePlacement[]
  /** Sheets that received >= 1 part. The BLF path reports 1 (0 when nothing placed). */
  sheetsUsed?: number
  /** Engine marker for layout diffing: 'v1' (BLF) | 'nfp-v2'. */
  nestVersion?: 'v1' | 'nfp-v2'
  /** Which engine actually ran (the request `engine` is optional, default 'nfp'). */
  engineUsed?: 'nfp' | 'blf'
}

/**
 * Narrow wire options to the v1 BLF engine's NestOptions. Throws on a
 * non-cardinal rotation — surfaced to the caller as `nesting_failed`,
 * matching the v1 engine's own validation contract.
 */
function toBlfNestOptions(opts: NestPolygonsWireOptions | undefined): NestOptions | undefined {
  if (!opts) return undefined
  const out: NestOptions = {}
  if (opts.snapMm !== undefined) out.snapMm = opts.snapMm
  if (opts.partMarginMm !== undefined) out.partMarginMm = opts.partMarginMm
  if (opts.allowedRotations !== undefined) {
    const rotations: Rotation[] = []
    for (const r of opts.allowedRotations) {
      if (r !== 0 && r !== 90 && r !== 180 && r !== 270) {
        throw new Error(`Invalid rotation ${r}; the blf fallback engine supports only 0, 90, 180, 270`)
      }
      rotations.push(r)
    }
    out.allowedRotations = rotations
  }
  return out
}

/**
 * Migration pipeline for manufacture.json files.
 *
 * v1 -> v2 (Gap #7: multi-plate / multi-job project):
 *   - Legacy `setups` + `operations` are auto-wrapped into a single
 *     `Default plate` at `plates[0]` so existing saved projects open seamlessly.
 *   - Top-level `setups` + `operations` are cleared to empty arrays on v2 but
 *     remain present for back-compat (see `migrateManufactureV1toV2`).
 *
 * To add v2 -> v3 later: append `{ fromVersion: 2, toVersion: 3, migrate: ... }`.
 */
const manufactureMigrationPipeline = buildMigrationPipeline<ManufactureFile>(
  [
    {
      fromVersion: 1,
      toVersion: 2,
      migrate: (data: unknown) =>
        migrateManufactureV1toV2(
          data as { version: 1; setups: unknown[]; operations: unknown[] }
        )
    }
  ],
  1
)

/** Tracks the AbortController for any currently running cam:run operation. */
let activeCamController: AbortController | null = null

/**
 * Payload shape accepted by the `moonraker:push` IPC handler AND by the
 * pure `resolveMoonrakerPushCapabilities` helper below. Matches
 * `MoonrakerPushPayload` from `./moonraker-push` extended with the
 * optional `machineId` hook that the handler resolves into concrete
 * `FdmCapabilityFields` (see [ID-0078]).
 */
export type MoonrakerPushIpcPayload = {
  gcodePath: string
  printerUrl: string
  uploadPath?: string
  startAfterUpload?: boolean
  timeoutMs?: number
  machineId?: string
  machineCapabilities?: FdmCapabilityFields | null
  /**
   * Creality K2 Plus CFS slot id (0..3). When supplied, the main-process
   * push appends `?cfs_slot=N` to the `/server/files/upload` URL so a
   * printer-side Klipper macro / future Moonraker plugin can read the
   * slot the operator picked. Safety Rule 1: this NEVER mutates the
   * G-code bytes -- it only travels on the URL. Additive / optional.
   */
  cfsSlotId?: number
}

/**
 * Extracts the three FDM capability temperature ceilings from a machine
 * profile if it looks like an FDM profile. Any missing / non-positive /
 * non-finite field is dropped so downstream callers see "not declared".
 * Returns `null` when none of the three fields are declared (signals
 * "this profile has nothing to contribute" -- callers then treat the
 * capability bundle as absent).
 */
export function extractFdmCapabilitiesFromProfile(
  profile: { maxNozzleTempC?: unknown; maxBedTempC?: unknown; chamberTempC?: unknown } | null | undefined
): FdmCapabilityFields | null {
  if (!profile || typeof profile !== 'object') return null
  const out: FdmCapabilityFields = {}
  const n = (profile as { maxNozzleTempC?: unknown }).maxNozzleTempC
  const b = (profile as { maxBedTempC?: unknown }).maxBedTempC
  const c = (profile as { chamberTempC?: unknown }).chamberTempC
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) out.maxNozzleTempC = n
  if (typeof b === 'number' && Number.isFinite(b) && b > 0) out.maxBedTempC = b
  if (typeof c === 'number' && Number.isFinite(c) && c > 0) out.chamberTempC = c
  return Object.keys(out).length === 0 ? null : out
}

/**
 * Resolves the effective `machineCapabilities` for a `moonraker:push`
 * payload (see [ID-0078]). Precedence:
 *   1. `payload.machineCapabilities` is explicit (any non-undefined value,
 *      including `null` to opt out) -- returned unchanged, machineId is
 *      stripped from the outgoing payload.
 *   2. `payload.machineId` is present AND the resolved profile declares
 *      at least one of the three FDM ceilings -- extracted and threaded
 *      as `machineCapabilities`. machineId is still stripped.
 *   3. Neither hook is set OR the resolver found nothing -- the outgoing
 *      payload omits `machineCapabilities` entirely, producing
 *      byte-identical pre-[ID-0078] behavior for `moonrakerPush`.
 *
 * Safety Rule 2: additive / optional -- existing callers that never set
 * machineId or machineCapabilities see zero change in behavior.
 */
export async function resolveMoonrakerPushCapabilities(
  payload: MoonrakerPushIpcPayload
): Promise<{
  gcodePath: string
  printerUrl: string
  uploadPath?: string
  startAfterUpload?: boolean
  timeoutMs?: number
  machineCapabilities?: FdmCapabilityFields | null
  cfsSlotId?: number
}> {
  const { machineId, machineCapabilities, ...rest } = payload
  // Rule 1: explicit override wins (including explicit null).
  if (machineCapabilities !== undefined) {
    return { ...rest, machineCapabilities }
  }
  // Rule 2: try to resolve from the machine profile.
  if (typeof machineId === 'string' && machineId.length > 0) {
    try {
      const profile = await getMachineById(machineId)
      const caps = extractFdmCapabilitiesFromProfile(profile)
      if (caps) return { ...rest, machineCapabilities: caps }
    } catch {
      // Swallow profile-resolution failures -- the pre-upload validator
      // is a defense-in-depth layer, not load-bearing for correctness.
      // Falling through to the no-caps path preserves pre-[ID-0078]
      // behavior so a transient FS error cannot block a valid print.
    }
  }
  // Rule 3: neither hook produced caps; omit the field entirely. The
  // CFS slot id (if any) rides along in `rest` regardless of capability
  // resolution -- it is independent of the temperature-ceiling pipeline.
  return rest
}

export function registerFabricationIpc(ctx: MainIpcWindowContext): void {
  ipcMain.handle('machines:list', async () => loadAllMachines())
  ipcMain.handle('machines:catalog', async () => loadMachineCatalog())
  ipcMain.handle('machines:saveUser', async (_e, profile: unknown) => {
    const { machineProfileSchema } = await import('../shared/machine-schema')
    const parsed = machineProfileSchema.parse(profile)
    return saveUserMachine(parsed)
  })
  ipcMain.handle('machines:deleteUser', async (_e, machineId: string) => deleteUserMachine(machineId))
  ipcMain.handle('machines:importJson', async (_e, text: string) => {
    return saveUserMachine(parseMachineProfileText(text, 'pasted-profile'))
  })
  ipcMain.handle('machines:importFile', async (_e, filePath: string) => importMachineProfileFromFile(filePath))
  ipcMain.handle('machines:exportUser', async (_e, machineId: string) => {
    const win = ctx.getMainWindow()
    if (!win) return { ok: false as const, error: 'no_window' }
    const catalog = await loadMachineCatalog()
    const hit = catalog.machines.find((m) => m.id === machineId)
    if (!hit) return { ok: false as const, error: 'machine_not_found' }
    const r = await dialog.showSaveDialog(win, {
      title: 'Export machine profile',
      defaultPath: `${machineId}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (r.canceled || !r.filePath) return { ok: false as const, error: 'canceled' }
    await writeFile(r.filePath, JSON.stringify(hit, null, 2), 'utf-8')
    return { ok: true as const, path: r.filePath }
  })

  ipcMain.handle('stl:stage', async (_e, projectDir: string, stlPath: string) =>
    stageStlForProject(projectDir, stlPath)
  )
  ipcMain.handle(
    'stl:transformForCam',
    async (
      _e,
      payload: {
        stlPath: string
        transform: {
          position: { x: number; y: number; z: number }
          rotation: { x: number; y: number; z: number }
          scale: { x: number; y: number; z: number }
        }
      }
    ) => {
      const { transformBinaryStlWithPlacement } = await import('./binary-stl-placement')
      const source = await readFile(payload.stlPath)
      const t = payload.transform
      // Use 'center_origin' so the STL is centered at origin before applying the
      // user transform, matching Three.js ShopModelViewer's geo.translate(-cx,-cy,-cz).
      // Without this, rotations orbit around the raw STL origin instead of the
      // geometry center, producing a completely different mesh orientation.
      const transformed = transformBinaryStlWithPlacement(source, 'center_origin', 'y_up', {
        // ShopModelViewer maps model Y->Three.js Z and model Z->Three.js Y.
        rotateDeg: [t.rotation.x, t.rotation.z, t.rotation.y],
        translateMm: [t.position.x, t.position.z, t.position.y],
        scale: [t.scale.x, t.scale.z, t.scale.y]
      })
      if (!transformed.ok) {
        throw new Error(transformed.detail ? `${transformed.error}: ${transformed.detail}` : transformed.error)
      }
      const ext = extname(payload.stlPath) || '.stl'
      // Strip any existing `.cam-aligned` segments so that re-running CAM on a
      // previously-aligned file does not accumulate suffixes
      // (e.g. `model.cam-aligned.cam-aligned.stl`).
      const stem = basename(payload.stlPath, ext).replace(/(\.cam-aligned)+$/i, '')
      const outPath = join(dirname(payload.stlPath), `${stem}.cam-aligned${ext}`)
      await writeFile(outPath, transformed.buffer)
      return outPath
    }
  )

  // 2026-05-27 pivot: 'slice:cura' IPC handler was removed alongside the
  // CuraEngine bundle. The OrcaSlicer replacement lives below as
  // 'slice:orca' (task #9). The renderer reaches it via the preload
  // `sliceOrca` bridge. Profile .ini files are resolved relative to
  // `resources/orca-slicer/profiles/`; the bundle itself ships separately
  // (`Follow-up — Bundle the OrcaSlicer binary` per PR #9 description).
  ipcMain.handle(
    'slice:orca',
    async (
      _e,
      payload: {
        stlPath: string
        outPath: string
        machineId: string
        qualityPresetId?: 'standard' | 'high_speed'
        filamentId?: string
        overrides?: Record<string, string | number>
      }
    ): Promise<
      | { ok: true; outputGcodePath: string; stdout: string; stderr: string; warnings: string[] }
      | { ok: false; error: string; hint?: string; stdout?: string; stderr?: string }
    > => {
      if (!payload || typeof payload !== 'object') {
        return { ok: false as const, error: 'invalid_payload', hint: "slice:orca requires { stlPath, outPath, machineId, ... }" }
      }
      if (typeof payload.stlPath !== 'string' || payload.stlPath.length === 0) {
        return { ok: false as const, error: 'missing_stl_path' }
      }
      if (typeof payload.outPath !== 'string' || payload.outPath.length === 0) {
        return { ok: false as const, error: 'missing_out_path' }
      }
      if (typeof payload.machineId !== 'string' || payload.machineId.length === 0) {
        return { ok: false as const, error: 'missing_machine_id' }
      }
      // Null-byte rejection -- mirrors the pattern in `fs:readBase64`. The
      // renderer is the only IPC caller; absolute paths under the project
      // tree are expected. Full path-root containment is not enforced here
      // because the project root is not part of the payload (matches
      // sibling handlers `stl:stage`, `stl:transformForCam`, `cam:run`).
      if (payload.stlPath.includes('\0') || payload.outPath.includes('\0')) {
        return { ok: false as const, error: 'invalid_path' }
      }
      const machine = await getMachineById(payload.machineId)
      if (!machine || machine.kind !== 'fdm') {
        return {
          ok: false as const,
          error: 'not_fdm_machine',
          hint: 'slice:orca requires an FDM machine profile (e.g. Creality K2 Plus). Select an FDM machine in Manufacture.'
        }
      }
      const appRoot = app.getAppPath()
      const profilesDir = join(appRoot, 'resources', 'orca-slicer', 'profiles')
      const qualityPresetId = payload.qualityPresetId ?? 'standard'
      const filamentId =
        typeof payload.filamentId === 'string' && payload.filamentId.length > 0
          ? payload.filamentId
          : 'pla-generic'
      // OrcaSlicer 2.3.x requires its own Bambu/Orca-flavour JSON profile
      // files (the CLI calls `load_from_json` and rejects Slic3r .ini with
      // a parse error). The on-disk profile tree under
      // `resources/orca-slicer/profiles/{machines,process,filament}/` is
      // populated with .json files written specifically for the K2 Plus.
      const machineProfileIni = join(profilesDir, 'machines', `${payload.machineId}.json`)
      const processProfileIni = join(profilesDir, 'process', `${qualityPresetId}.json`)
      const filamentProfileIni = join(profilesDir, 'filament', `${filamentId}.json`)
      try {
        const result = await runOrcaSlice(appRoot, {
          inputPath: payload.stlPath,
          outputGcodePath: payload.outPath,
          machineProfileIni,
          processProfileIni,
          filamentProfileIni,
          ...(payload.overrides ? { overrides: payload.overrides } : {})
        })
        if (!result.ok) {
          return {
            ok: false as const,
            error: 'orca_slice_failed',
            hint: result.stderr.trim() || `OrcaSlicer exited with code ${result.exitCode}`,
            stdout: result.stdout,
            stderr: result.stderr
          }
        }
        return {
          ok: true as const,
          outputGcodePath: result.outputGcodePath,
          stdout: result.stdout,
          stderr: result.stderr,
          // Per-slice override clamp warnings (e.g. a requested nozzle temp
          // above the K2 ceiling was reduced). Surfaced to the operator so a
          // clamp is never silent. Empty when there were no overrides.
          warnings: result.warnings
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          ok: false as const,
          error: 'orca_unavailable',
          hint: msg
        }
      }
    }
  )

  // CAD V1.5 — TRUE per-layer slice breakdown for the K2 Plus FDM Preview
  // stage. Replaces the renderer-side coarse uniform distribution
  // (`gcode-layer-parser.ts`) with real per-layer stats parsed by the
  // streaming main-process parser (`./slicer/fdm-gcode-stream-parser.ts`).
  // The parser reads the file line-by-line (constant memory — a tall K2
  // print is 1,500+ layers / 5–30 MB) and degrades gracefully to uniform
  // distribution when per-layer comments are absent. Session-only result;
  // never persisted. Plan: docs/plans/cad-v15-per-layer-slicer-breakdowns.md.
  //
  // Security: null-byte rejection mirrors the `slice:orca` handler above;
  // the renderer is the only caller and passes the absolute on-disk path
  // recorded in `lastSliceGcodePath` after a successful slice.
  ipcMain.handle(
    'slice:layerBreakdown',
    async (
      _e,
      payload: { gcodePath: string }
    ): Promise<
      | { ok: true; result: FdmLayerBreakdownResult }
      | { ok: false; error: string; hint?: string }
    > => {
      if (!payload || typeof payload !== 'object') {
        return { ok: false as const, error: 'invalid_payload', hint: 'slice:layerBreakdown requires { gcodePath }' }
      }
      if (typeof payload.gcodePath !== 'string' || payload.gcodePath.length === 0) {
        return { ok: false as const, error: 'missing_gcode_path' }
      }
      // Null-byte rejection — same pattern as `slice:orca` / `fs:readBase64`.
      if (payload.gcodePath.includes('\0')) {
        return { ok: false as const, error: 'invalid_path' }
      }
      try {
        const result = await parseFdmGcodeLayersFromFile(payload.gcodePath)
        return { ok: true as const, result }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return {
          ok: false as const,
          error: 'layer_breakdown_failed',
          hint: msg
        }
      }
    }
  )

  /**
   * Settings-panel helper — reports whether the OrcaSlicer CLI binary is
   * actually bundled at the expected platform path. Pure existsSync check;
   * no subprocess spawn. Used by the Real Settings view (Paths subsection)
   * to render "Bundled" vs "Not bundled" with the script hint.
   */
  ipcMain.handle('slicer:orcaStatus', async () => {
    const appRoot = app.getAppPath()
    const platformDir =
      process.platform === 'win32'
        ? 'win32-x64'
        : process.platform === 'darwin'
        ? 'darwin-arm64'
        : 'linux-x64'
    const binName = process.platform === 'win32' ? 'orca-slicer.exe' : 'orca-slicer'
    const expectedPath = join(appRoot, 'resources', 'orca-slicer', platformDir, binName)
    let bundled = false
    try { bundled = statSync(expectedPath).isFile() } catch { bundled = false }
    return { bundled, expectedPath, platform: process.platform }
  })

  ipcMain.handle(
    'cam:run',
    async (_e, payload: unknown) => {
      const parsedPayload = camRunPayloadSchema.safeParse(payload)
      if (!parsedPayload.success) {
        return {
          ok: false as const,
          error: 'invalid_cam_payload',
          hint: parsedPayload.error.issues.map((issue) => issue.message).join('; ')
        }
      }
      const camPayload = parsedPayload.data
      if (activeCamController !== null) {
        return {
          ok: false as const,
          error: 'cam_already_running',
          hint: 'A CAM job is already in progress. Cancel it first with cam:cancel, then retry.'
        }
      }
      // Validate python path before spawning subprocess
      if (!isPythonPathSafe(camPayload.pythonPath)) {
        return {
          ok: false as const,
          error: 'invalid_python_path',
          hint: 'The configured Python path contains invalid characters. Check Settings → Python Path.'
        }
      }
      const controller = new AbortController()
      activeCamController = controller
      try {
        const policy = describeCamOperationKind(camPayload.operationKind)
        if (!policy.runnable) {
          return {
            ok: false as const,
            error: policy.error ?? 'cam_not_supported',
            ...(policy.hint ? { hint: policy.hint } : {})
          }
        }
        const machine = await getMachineById(camPayload.machineId)
        if (!machine || machine.kind !== 'cnc') {
          return {
            ok: false as const,
            error: 'No CNC machine profile matches the selected machine ID.',
            hint: 'Choose a CNC machine in Manufacture setup (or project active machine). Make → Generate CAM requires a `kind: cnc` profile from resources/machines.'
          }
        }
        const resourcesRoot = getResourcesRoot()
        const appRoot = app.getAppPath()
        const result = await runCamDomain({
          stlPath: camPayload.stlPath,
          outputGcodePath: camPayload.outPath,
          machine,
          resourcesRoot,
          appRoot,
          zPassMm: camPayload.zPassMm,
          stepoverMm: camPayload.stepoverMm,
          feedMmMin: camPayload.feedMmMin,
          plungeMmMin: camPayload.plungeMmMin,
          safeZMm: camPayload.safeZMm,
          pythonPath: camPayload.pythonPath,
          operationKind: camPayload.operationKind,
          operationLabel: camPayload.operationLabel,
          workCoordinateIndex: camPayload.workCoordinateIndex,
          toolDiameterMm: camPayload.toolDiameterMm,
          operationParams: camPayload.operationParams,
          rotaryStockLengthMm: camPayload.rotaryStockLengthMm,
          rotaryStockDiameterMm: camPayload.rotaryStockDiameterMm,
          rotaryChuckDepthMm: camPayload.rotaryChuckDepthMm,
          rotaryClampOffsetMm: camPayload.rotaryClampOffsetMm,
          stockBoxZMm: camPayload.stockBoxZMm,
          stockBoxXMm: camPayload.stockBoxXMm,
          stockBoxYMm: camPayload.stockBoxYMm,
          priorPostedGcode: camPayload.priorPostedGcode,
          useMeshMachinableXClamp: camPayload.useMeshMachinableXClamp,
          toolSlot: camPayload.toolSlot,
          placement: camPayload.placement,
          // 4-axis chuck/tailstock collision sweep input. Advisory-only: the
          // engine emits clearance WARNINGS, never changes the toolpath. When
          // absent the engine falls back to the machine-default chuck-only sweep.
          rotaryFixture: camPayload.rotaryFixture,
          signal: controller.signal,
          onProgress: (event: CamProgressEvent) => {
            const win = ctx.getMainWindow()
            if (win && !win.isDestroyed()) {
              win.webContents.send('cam:progress', event)
            }
          }
        })
        // If user cancelled during the run, report cancellation regardless of engine result.
        if (controller.signal.aborted) {
          return {
            ok: false as const,
            error: 'cam_cancelled',
            hint: 'CAM run was cancelled by the user.'
          }
        }
        if (result.ok && (policy.hint || result.warnings?.length)) {
          const hintParts = [result.hint, policy.hint].filter(Boolean)
          if (result.warnings?.length) {
            hintParts.push(`Spindle: ${result.warnings.join('; ')}`)
          }
          return { ...result, hint: hintParts.join(' ') }
        }
        return result
      } catch (e) {
        if (controller.signal.aborted) {
          return {
            ok: false as const,
            error: 'cam_cancelled',
            hint: 'CAM run was cancelled by the user.'
          }
        }
        const msg = e instanceof Error ? e.message : String(e)
        return {
          ok: false as const,
          error: msg,
          hint: 'Unexpected CAM failure — check staged STL path, output folder permissions, and machine post resources. If it persists, capture the message for a bug report.'
        }
      } finally {
        activeCamController = null
      }
    }
  )

  ipcMain.handle('cam:cancel', async () => {
    if (activeCamController !== null) {
      activeCamController.abort()
      return { cancelled: true }
    }
    return { cancelled: false }
  })

  ipcMain.handle('tools:read', async (_e, projectDir: string) => {
    const p = join(projectDir, 'tools.json')
    try {
      const raw = await readFile(p, 'utf-8')
      return toolLibraryFileSchema.parse(JSON.parse(raw) as unknown)
    } catch {
      const empty: ToolLibraryFile = { version: 1, tools: [] }
      return empty
    }
  })

  ipcMain.handle('tools:save', async (_e, projectDir: string, lib: ToolLibraryFile) => {
    const p = join(projectDir, 'tools.json')
    await writeFile(p, JSON.stringify(lib, null, 2), 'utf-8')
  })

  ipcMain.handle(
    'tools:import',
    async (
      _e,
      projectDir: string,
      payload: { kind: 'csv' | 'json' | 'fusion' | 'fusion_csv'; content: string }
    ) => {
      const p = join(projectDir, 'tools.json')
      let cur: ToolLibraryFile
      try {
        cur = toolLibraryFileSchema.parse(JSON.parse(await readFile(p, 'utf-8')))
      } catch {
        cur = { version: 1, tools: [] }
      }
      let extra = []
      if (payload.kind === 'csv') extra = parseToolsCsv(payload.content)
      else if (payload.kind === 'json') {
        const parsed = parseToolsJson(payload.content)
        return mergeToolLibraries(cur, parsed.tools)
      } else if (payload.kind === 'fusion_csv') {
        extra = parseFusionToolsCsv(payload.content)
      } else extra = parseFusionToolExport(payload.content)
      return mergeToolLibraries(cur, extra)
    }
  )

  ipcMain.handle('tools:importFile', async (_e, projectDir: string, filePath: string) => {
    const p = join(projectDir, 'tools.json')
    let cur: ToolLibraryFile
    try {
      cur = toolLibraryFileSchema.parse(JSON.parse(await readFile(p, 'utf-8')))
    } catch {
      cur = { version: 1, tools: [] }
    }
    const buf = await readFile(filePath)
    const name = basename(filePath)
    const extra = inferToolRecordsFromFileBuffer(name, buf)
    if (extra.length === 0) {
      throw new Error(`No tools found in "${name}" (${buf.length} bytes)`)
    }
    return mergeToolLibraries(cur, extra)
  })

  ipcMain.handle('machineTools:read', async (_e, machineId: string) => loadMachineToolLibrary(machineId))

  ipcMain.handle('machineTools:save', async (_e, machineId: string, lib: unknown) => {
    const parsed = toolLibraryFileSchema.parse(lib)
    return saveMachineToolLibrary(machineId, parsed)
  })

  ipcMain.handle(
    'machineTools:import',
    async (
      _e,
      machineId: string,
      payload: { kind: 'csv' | 'json' | 'fusion' | 'fusion_csv'; content: string }
    ) => {
      const cur = await loadMachineToolLibrary(machineId)
      let extra = []
      if (payload.kind === 'csv') extra = parseToolsCsv(payload.content)
      else if (payload.kind === 'json') {
        const parsed = parseToolsJson(payload.content)
        return mergeToolLibraries(cur, parsed.tools)
      } else if (payload.kind === 'fusion_csv') {
        extra = parseFusionToolsCsv(payload.content)
      } else extra = parseFusionToolExport(payload.content)
      return mergeToolLibraries(cur, extra)
    }
  )

  ipcMain.handle('machineTools:importFile', async (_e, machineId: string, filePath: string) => {
    const cur = await loadMachineToolLibrary(machineId)
    const buf = await readFile(filePath)
    const name = basename(filePath)
    const extra = inferToolRecordsFromFileBuffer(name, buf)
    if (extra.length === 0) {
      throw new Error(`No tools found in "${name}" (${buf.length} bytes)`)
    }
    const merged = mergeToolLibraries(cur, extra)
    await saveMachineToolLibrary(machineId, merged)
    return merged
  })

  ipcMain.handle('machineTools:migrateFromProject', async (_e, machineId: string, projectDir: string) => {
    const p = join(projectDir, 'tools.json')
    let projectLib: ToolLibraryFile
    try {
      projectLib = toolLibraryFileSchema.parse(JSON.parse(await readFile(p, 'utf-8')))
    } catch {
      projectLib = { version: 1, tools: [] }
    }
    const cur = await loadMachineToolLibrary(machineId)
    const merged = mergeToolLibraries(cur, projectLib.tools)
    return saveMachineToolLibrary(machineId, merged)
  })

  ipcMain.handle('manufacture:load', async (_e, projectDir: string) => {
    const p = join(projectDir, 'manufacture.json')
    try {
      const raw = await readFile(p, 'utf-8')
      const data = parseJsonText(raw, 'manufacture.json')

      // Run through migration pipeline if the file has a version field
      if (
        typeof data === 'object' &&
        data !== null &&
        'version' in data &&
        typeof (data as Record<string, unknown>).version === 'number'
      ) {
        const versioned = data as { version: number; [key: string]: unknown }
        if (manufactureMigrationPipeline.canMigrate(versioned.version)) {
          const migrated = manufactureMigrationPipeline.migrateToLatest(versioned)
          return manufactureFileSchema.parse(migrated.data)
        }
      }

      return manufactureFileSchema.parse(data)
    } catch (e) {
      if (isENOENT(e)) return emptyManufacture()
      if (e instanceof ZodError) throw new Error(formatZodError(e, 'manufacture.json'))
      throw e instanceof Error ? e : new Error(String(e))
    }
  })

  ipcMain.handle('manufacture:save', async (_e, projectDir: string, json: string) => {
    const p = join(projectDir, 'manufacture.json')
    try {
      const data = parseJsonText(json, 'manufacture.json (save)')
      const parsed = manufactureFileSchema.parse(data)
      await writeFile(p, JSON.stringify(parsed, null, 2), 'utf-8')
    } catch (e) {
      if (e instanceof ZodError) throw new Error(formatZodError(e, 'manufacture.json (save)'))
      throw e instanceof Error ? e : new Error(String(e))
    }
  })

  /**
   * Compare mtimes of project `output/cam.nc` (or `gcodeRelativePath`) vs manufacture source meshes.
   * Used for “regenerate G-code” hints — not a full associativity graph.
   */
  ipcMain.handle(
    'fabrication:camSourceStaleVersusOutput',
    async (_e, projectDir: string, meshRelPaths: unknown, gcodeRel?: unknown) => {
      if (typeof projectDir !== 'string' || !projectDir.trim()) {
        return { ok: false as const, error: 'project_dir_required' }
      }
      const relOut =
        typeof gcodeRel === 'string' && gcodeRel.trim()
          ? gcodeRel.trim().replace(/^[\\/]+/, '')
          : 'output/cam.nc'
      const gPath = isPathSafe(relOut, projectDir)
      if (!gPath) return { ok: false as const, error: 'gcode_path_unsafe' }
      let gcodeMtimeMs: number | null = null
      try {
        gcodeMtimeMs = statSync(gPath).mtimeMs
      } catch {
        gcodeMtimeMs = null
      }
      const rawPaths = Array.isArray(meshRelPaths) ? meshRelPaths : []
      const meshes: CamSourceMeshMtime[] = []
      for (const item of rawPaths) {
        if (typeof item !== 'string') continue
        const rel = item.trim().replace(/^[\\/]+/, '')
        if (!rel) continue
        const abs = isPathSafe(rel, projectDir)
        if (!abs) continue
        try {
          meshes.push({ relativePath: rel, mtimeMs: statSync(abs).mtimeMs })
        } catch {
          meshes.push({ relativePath: rel, mtimeMs: null })
        }
      }
      const { staleRelativePaths, noGcode } = listStaleSourceMeshesVersusGcode(gcodeMtimeMs, meshes)
      return {
        ok: true as const,
        gcodeMtimeMs,
        gcodeRelativePath: relOut,
        meshes,
        staleRelativePaths,
        noGcode
      }
    }
  )

  // ── Post-processor management ─────────────────────────────────────────────

  ipcMain.handle('posts:list', async () => listAllPosts())

  ipcMain.handle('posts:save', async (_e, filename: string, content: string) =>
    saveUserPost(filename, content)
  )

  ipcMain.handle('posts:read', async (_e, filename: string) => readPostContent(filename))

  ipcMain.handle('posts:uploadFile', async (_e, filePath: string) => {
    const content = await readFile(filePath, 'utf-8')
    return saveUserPost(basename(filePath), content)
  })

  ipcMain.handle('posts:pickAndUpload', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Upload post-processor template',
      filters: [{ name: 'Handlebars template', extensions: ['hbs'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]!
    const content = await readFile(filePath, 'utf-8')
    return saveUserPost(basename(filePath), content)
  })

  // ── Makera Carvera (carvera-cli upload) ─────────────────────────────────────

  ipcMain.handle('carvera:upload', async (_e, payload: CarveraUploadPayload) => {
    const settings = await loadSettings()
    return carveraUpload(settings, payload)
  })

  ipcMain.handle(
    'carvera:generateSetup',
    async (
      _e,
      payload: {
        mode: 'a_axis_zero' | 'wcs_zero' | 'z_probe' | 'full_4axis_setup' | 'preflight_check'
        projectDir: string
        axes?: ('x' | 'y' | 'z' | 'a')[]
        wcsIndex?: number
        probeDistMm?: number
        probeFeedMmMin?: number
        retractMm?: number
        spindleRpm?: number
        feedMmMin?: number
      }
    ) => {
      try {
        let gcode: string
        switch (payload.mode) {
          case 'a_axis_zero':
            gcode = generateCarveraAAxisZero()
            break
          case 'wcs_zero':
            gcode = generateCarveraWcsZero({
              axes: payload.axes ?? ['x', 'y', 'z'],
              wcsIndex: payload.wcsIndex
            })
            break
          case 'z_probe':
            gcode = generateCarveraZProbe({
              probeDistMm: payload.probeDistMm,
              probeFeedMmMin: payload.probeFeedMmMin,
              retractMm: payload.retractMm
            })
            break
          case 'full_4axis_setup':
            gcode = generateCarvera4AxisSetup({
              probeDistMm: payload.probeDistMm,
              probeFeedMmMin: payload.probeFeedMmMin
            })
            break
          case 'preflight_check':
            gcode = generateCarveraPreflightCheck({
              spindleRpm: payload.spindleRpm,
              feedMmMin: payload.feedMmMin
            })
            break
        }
        const outDir = join(payload.projectDir, 'output')
        await mkdir(outDir, { recursive: true })
        const filePath = join(outDir, 'carvera-setup.nc')
        await writeFile(filePath, gcode, 'utf-8')
        return { ok: true as const, gcode, filePath }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }
  )

  // ── Moonraker / Creality K2 Plus network push ──────────────────────────────

  ipcMain.handle(
    'moonraker:push',
    async (
      _e,
      payload: {
        gcodePath: string
        printerUrl: string
        uploadPath?: string
        startAfterUpload?: boolean
        timeoutMs?: number
        /**
         * Optional machine id. When supplied AND `machineCapabilities` is not
         * explicitly set on the payload (see [ID-0078]), the handler resolves
         * the active machine profile via `getMachineById(machineId)` and
         * threads `maxNozzleTempC` / `maxBedTempC` / `chamberTempC` into the
         * pre-upload G-code temperature validator (see [ID-0070] +
         * [ID-0073]). The renderer no longer has to re-read the machine
         * profile just to surface these safety ceilings.
         *
         * Safety Rule 2: additive / optional. Absent machineId + absent
         * machineCapabilities produces byte-identical pre-[ID-0078] behavior.
         */
        machineId?: string
        /**
         * Optional explicit capability override. When present (including
         * `null` to opt out of the resolver), takes precedence over the
         * `machineId`-driven resolution. This is the explicit override hook
         * for callers that already have capabilities in hand.
         */
        machineCapabilities?: FdmCapabilityFields | null
        /**
         * Optional K2 Plus CFS slot id (0..3). When supplied, the main-
         * process push appends `?cfs_slot=N` to the upload URL so a
         * printer-side Klipper macro / future Moonraker plugin can read
         * the slot the operator picked. Safety Rule 1: never mutates
         * G-code bytes. Additive / optional.
         */
        cfsSlotId?: number
      }
    ) => {
      const resolved = await resolveMoonrakerPushCapabilities(payload)
      return moonrakerPush(resolved)
    }
  )

  ipcMain.handle(
    'moonraker:status',
    async (_e, printerUrl: string, timeoutMs?: number) => moonrakerStatus(printerUrl, timeoutMs)
  )

  /**
   * Rich "Test connection" probe for the Settings → Network & Printers
   * panel. Goes beyond `moonraker:status` (which only reports print
   * state) by ALSO fetching hostname / firmware version / live bed +
   * nozzle temperatures from /printer/info + /printer/objects/query.
   *
   * Errors NEVER throw — every failure is folded into
   * `{ ok: false, error, detail }` so the renderer can surface the real
   * reason (timeout / 4xx / non-JSON body / network).
   *
   * Safety: Read-only probe. No G-code emission, no machine actuation,
   * no shell commands.
   */
  ipcMain.handle(
    'moonraker:info',
    async (_e, printerUrl: string, timeoutMs?: number) => moonrakerInfo(printerUrl, timeoutMs)
  )

  ipcMain.handle(
    'moonraker:cancel',
    async (_e, printerUrl: string, timeoutMs?: number) => moonrakerCancel(printerUrl, timeoutMs)
  )

  ipcMain.handle(
    'moonraker:pause',
    async (_e, printerUrl: string, timeoutMs?: number) => moonrakerPause(printerUrl, timeoutMs)
  )

  ipcMain.handle(
    'moonraker:resume',
    async (_e, printerUrl: string, timeoutMs?: number) => moonrakerResume(printerUrl, timeoutMs)
  )

  /**
   * Pre-flight Moonraker temperature preview hook -- registered for
   * [ID-0072-followup] (Cycle 50 ui-polish). The renderer surfaces a
   * `formatFdmTempPreview` banner above the Send button; this handler
   * is the IPC counterpart so the renderer can ALSO log the preview
   * event for future telemetry / dry-run hooks WITHOUT importing
   * `electron` directly. Validation is intentionally light:
   *   - `samples` must be a non-empty array.
   *   - Every entry must have a finite `targetC` -- a single bad
   *     sample is enough to short-circuit (Safety Rule 4: validate
   *     payloads at the IPC boundary; do not let malformed data
   *     reach downstream handlers).
   * NO network I/O. NO machine touch. The `{ ok: true }` reply is a
   * pure ack; the visible UI lives entirely in the renderer.
   */
  ipcMain.handle(
    'moonraker:preview',
    async (
      _e,
      samples: readonly GcodeTempSample[]
    ): Promise<{ ok: true } | { ok: false; reason: string }> => {
      if (!Array.isArray(samples) || samples.length === 0) {
        return { ok: false as const, reason: 'no-samples' }
      }
      for (const s of samples) {
        if (
          !s ||
          typeof s.targetC !== 'number' ||
          !Number.isFinite(s.targetC)
        ) {
          return { ok: false as const, reason: 'invalid-sample' }
        }
      }
      return { ok: true as const }
    }
  )

  // ── Material library ─────────────────────────────────────────────────────────
  ipcMain.handle('materials:list', async () => listAllMaterials())
  ipcMain.handle('materials:save', async (_e, record) => saveMaterial(record))
  ipcMain.handle('materials:delete', async (_e, id: string) => deleteMaterial(id))
  ipcMain.handle('materials:importJson', async (_e, jsonText: string) => importMaterialsJson(jsonText))
  ipcMain.handle('materials:importFile', async (_e, filePath: string) => importMaterialsFile(filePath))
  ipcMain.handle('materials:pickAndImport', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import material library',
      filters: [{ name: 'Material Library JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return importMaterialsFile(result.filePaths[0]!)
  })

  // ── Filament library ────────────────────────────────────────────────────────
  ipcMain.handle('filaments:list', async () => listAllFilaments())
  ipcMain.handle('filaments:save', async (_e, record) => saveFilament(record))
  ipcMain.handle('filaments:delete', async (_e, id: string) => deleteFilament(id))

  /**
   * Read any local file as a base64 string so the renderer can decode it
   * without needing direct file:// protocol access (which Chromium blocks).
   */
  ipcMain.handle('fs:readBase64', async (_e, filePath: string) => {
    if (!filePath || typeof filePath !== 'string' || filePath.includes('\0')) {
      throw new Error('Invalid file path for fs:readBase64')
    }
    const buf = await readFile(filePath)
    return buf.toString('base64')
  })

  // ── CPS post-processor import ─────────────────────────────────────────────
  ipcMain.handle('machines:importCpsFile', async (_e, filePath: string): Promise<CpsImportSummary> => {
    const buf = await readFile(filePath)
    const text = buf.toString('utf-8')
    const base = basename(filePath)
    const summary = machineProfileWithSummaryFromCps(base, text)
    await saveUserMachine(summary.profile)
    return summary
  })

  ipcMain.handle('machines:pickAndImportCps', async (): Promise<CpsImportSummary | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Import Fusion 360 / HSM Post-Processor',
      filters: [
        { name: 'Post-Processor Files', extensions: ['cps'] },
        { name: 'All Files', extensions: ['*'] }
      ],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]!
    const buf = await readFile(filePath)
    const text = buf.toString('utf-8')
    const base = basename(filePath)
    const summary = machineProfileWithSummaryFromCps(base, text)
    await saveUserMachine(summary.profile)
    return summary
  })

  // ── DXF Import ────────────────────────────────────────────────────────────
  ipcMain.handle('dxf:import', async (_e, filePath: string) => {
    try {
      const text = await readFile(filePath, 'utf-8')
      const result = parseDxf(text)
      convertDxfToMm(result)
      return { ok: true as const, ...result }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false as const, error: msg }
    }
  })

  // ── Material Audit ────────────────────────────────────────────────────────
  ipcMain.handle('material:audit', async () => {
    try {
      const materials = await listAllMaterials()
      const result = auditMaterialPresets(materials)
      return { ok: true as const, ...result }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false as const, error: msg }
    }
  })

  // ── Fixture Collision Check ───────────────────────────────────────────────
  ipcMain.handle(
    'fixture:checkCollision',
    async (
      _e,
      payload: {
        toolpath: ToolpathPoint[]
        fixture: FixtureRecord
        toolDiameterMm: number
        toolLengthMm?: number
      }
    ) => {
      try {
        const result = checkFixtureCollision(
          payload.toolpath,
          payload.fixture,
          payload.toolDiameterMm,
          payload.toolLengthMm
        )
        return { ok: true as const, ...result }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }
  )

  // ── Multi-Setup Automation ────────────────────────────────────────────────
  ipcMain.handle('setup:autoAssignWcs', async (_e, setups: ManufactureSetup[]) => {
    try {
      const result = autoAssignWcsOffsets(setups)
      return { ok: true as const, setups: result }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle('setup:validate', async (_e, setups: ManufactureSetup[]) => {
    try {
      const result = validateSetupSequence(setups)
      return { ok: true as const, ...result }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(
    'setup:suggestFlip',
    async (
      _e,
      payload: {
        currentSetup: ManufactureSetup
        existingSetups?: ManufactureSetup[]
        flipAxis?: 'X' | 'Y'
      }
    ) => {
      try {
        const result = suggestFlipSetup(
          payload.currentSetup,
          payload.existingSetups ?? [],
          payload.flipAxis ?? 'X'
        )
        return { ok: true as const, ...result }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }
  )

  // ── Probing Cycles ────────────────────────────────────────────────────────
  ipcMain.handle(
    'probe:generate',
    async (
      _e,
      payload: {
        type: ProbeCycleType
        params: ProbeBaseParams & Record<string, unknown>
      }
    ) => {
      try {
        const gcode = generateProbeCycle(payload.type, payload.params)
        return { ok: true as const, gcode }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: msg }
      }
    }
  )

  // ── K2 Plus calibration suite ─────────────────────────────────────────────
  // Gap #4 (docs/COMPETITIVE-GAP-ANALYSIS.md): one-click calibration tests
  // (temperature tower, flow rate, pressure advance) for the Creality K2 Plus.
  // The handler dispatches by kind, builds the Klipper-flavor program via the
  // pure `buildCalibrationGcode` helper, writes it to the supplied
  // `outputGcodePath` (under `<projectDir>/output/calibration/...`), and
  // returns the absolute path. The renderer then offers a "Send to K2 Plus"
  // button that reuses the existing `moonraker:push` IPC.
  //
  // Safety Rule 1 (G-code is sacred): the builder asserts every emitted
  // feed/accel/temp value stays under K2_PLUS_HARDWARE_CEILINGS; the
  // paired-pin contract `src/main/calibration/k2-plus-tests-pin.test.ts`
  // re-asserts on the produced gcode at CI time.
  ipcMain.handle(
    'calibration:generate',
    async (
      _e,
      payload: CalibrationGeneratePayload
    ): Promise<
      | { ok: true; outputGcodePath: string; description: string; args: string[] }
      | { ok: false; error: string; hint?: string }
    > => {
      if (!payload || typeof payload !== 'object') {
        return { ok: false as const, error: 'invalid_payload', hint: "calibration:generate requires { kind, params }" }
      }
      const VALID_KINDS: ReadonlySet<CalibrationTestKind> = new Set([
        'temperature-tower',
        'flow-rate',
        'pressure-advance',
        'retraction-tower',
        'max-volumetric-flow',
        'tolerance',
        'cornering',
        'vfa'
      ])
      if (typeof payload.kind !== 'string' || !VALID_KINDS.has(payload.kind as CalibrationTestKind)) {
        return { ok: false as const, error: 'invalid_kind', hint: `kind must be one of: ${[...VALID_KINDS].join(', ')}` }
      }
      if (!payload.params || typeof payload.params !== 'object') {
        return { ok: false as const, error: 'invalid_params' }
      }
      const outputGcodePath = (payload.params as { outputGcodePath?: unknown }).outputGcodePath
      if (typeof outputGcodePath !== 'string' || outputGcodePath.length === 0) {
        return { ok: false as const, error: 'missing_output_path' }
      }
      // Null-byte rejection -- same pattern as `slice:orca` and `fs:readBase64`.
      if (outputGcodePath.includes('\0')) {
        return { ok: false as const, error: 'invalid_path' }
      }
      try {
        const result = buildCalibrationGcode(payload)
        // Ensure the parent directory exists, then write the gcode.
        await mkdir(dirname(result.outputGcodePath), { recursive: true })
        await writeFile(result.outputGcodePath, result.gcode, 'utf-8')
        return {
          ok: true as const,
          outputGcodePath: result.outputGcodePath,
          description: result.description,
          args: result.args
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: 'calibration_failed', hint: msg }
      }
    }
  )

  // ── True-shape nesting (Laguna only) — NFP v2 default + BLF v1 fallback ──
  // Gap #9 (docs/COMPETITIVE-GAP-ANALYSIS.md) + Wave 3j
  // (docs/plans/catalog/vcarve-laguna.md — polygon-NFP P1 + multi-sheet P2).
  // The renderer's "Nest parts on stock" button (Laguna-only) calls this
  // with an array of closed 2D polygons (one per cnc_contour op) and the
  // sheet spec from the Laguna stock. Routing is additive: `opts.engine`
  // defaults to 'nfp' (true-shape no-fit-polygon with multi-sheet overflow);
  // 'blf' keeps the original nestPolygonsOnSheet bounding-box engine
  // selectable as the fallback. The response is a field-for-field superset
  // of the v1 shape — see NestPolygonsWireResult above.
  //
  // Safety Rule 1 (G-code is sacred): this handler returns placements only.
  // It does NOT emit G-code; the existing CAM runner + post-processors
  // consume the placement when generating the toolpath. The NFP engine
  // additionally commits a placement only after an exact zero-overlap
  // intersection gate, so a returned layout can never overlap parts or
  // exceed the sheet — a bad nest scraps a full 5x10 sheet of stock.
  ipcMain.handle(
    'nesting:nest-polygons',
    async (
      _e,
      payload: {
        parts: ReadonlyArray<Polygon>
        sheet: SheetSpec
        opts?: NestPolygonsWireOptions
      }
    ): Promise<
      { ok: true; result: NestPolygonsWireResult } | { ok: false; error: string; hint?: string }
    > => {
      if (!payload || typeof payload !== 'object') {
        return { ok: false as const, error: 'invalid_payload', hint: 'nesting:nest-polygons requires { parts, sheet, opts? }' }
      }
      if (!Array.isArray(payload.parts)) {
        return { ok: false as const, error: 'invalid_parts', hint: 'parts must be an array of polygons' }
      }
      if (!payload.sheet || typeof payload.sheet !== 'object') {
        return { ok: false as const, error: 'invalid_sheet', hint: 'sheet must be { widthMm, heightMm, marginMm? }' }
      }
      const engine: 'nfp' | 'blf' = payload.opts?.engine === 'blf' ? 'blf' : 'nfp'
      try {
        if (engine === 'blf') {
          const result = nestPolygonsOnSheet(payload.parts, payload.sheet, toBlfNestOptions(payload.opts))
          return {
            ok: true as const,
            result: {
              ...result,
              sheetsUsed: result.placements.length > 0 ? 1 : 0,
              nestVersion: 'v1' as const,
              engineUsed: 'blf' as const
            }
          }
        }
        const nfpOpts: NfpNestOptions = {}
        if (payload.opts?.partMarginMm !== undefined) nfpOpts.partMarginMm = payload.opts.partMarginMm
        if (payload.opts?.allowedRotations !== undefined) nfpOpts.allowedRotations = payload.opts.allowedRotations
        if (payload.opts?.rotationStepDeg !== undefined) nfpOpts.rotationStepDeg = payload.opts.rotationStepDeg
        if (payload.opts?.maxSheets !== undefined) nfpOpts.maxSheets = payload.opts.maxSheets
        const result = nestPolygonsNfp(payload.parts, payload.sheet, nfpOpts)
        return { ok: true as const, result: { ...result, engineUsed: 'nfp' as const } }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return { ok: false as const, error: 'nesting_failed', hint: msg }
      }
    }
  )
}
