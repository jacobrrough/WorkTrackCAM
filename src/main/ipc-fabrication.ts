import { app, dialog, ipcMain } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { isPythonPathSafe } from './path-security'
import { describeCamOperationKind } from './cam-operation-policy'
import { runCamPipeline } from './cam-runner'
import type { CamProgressEvent } from '../shared/cam-progress'
import { listAllPosts, saveUserPost, readPostContent } from './posts-manager'
import {
  deleteMaterial,
  importMaterialsFile,
  importMaterialsJson,
  listAllMaterials,
  saveMaterial
} from './materials-manager'
import { carveraUpload, type CarveraUploadPayload } from './carvera-cli-run'
import {
  generateCarvera4AxisSetup,
  generateCarveraAAxisZero,
  generateCarveraPreflightCheck,
  generateCarveraWcsZero,
  generateCarveraZProbe
} from '../shared/carvera-zeroing'
import { moonrakerCancel, moonrakerPause, moonrakerPush, moonrakerResume, moonrakerStatus } from './moonraker-push'
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
import { sliceWithCuraEngine, stageStlForProject } from './slicer'
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
import { buildMigrationPipeline } from '../shared/schema-migration'
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

export type { MainIpcWindowContext } from './ipc-context'

/**
 * Migration pipeline for manufacture.json files.
 *
 * Currently v1-only (identity). When a v2 schema is added:
 *   1. Import migrateManufactureV1toV2 from schema-migration
 *   2. Add the step: { fromVersion: 1, toVersion: 2, migrate: migrateManufactureV1toV2 }
 *   3. Widen manufactureFileSchema.version to accept 2
 */
const manufactureMigrationPipeline = buildMigrationPipeline<ManufactureFile>([], 1)

/** Tracks the AbortController for any currently running cam:run operation. */
let activeCamController: AbortController | null = null

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
      const stem = basename(payload.stlPath, ext)
      const outPath = join(dirname(payload.stlPath), `${stem}.cam-aligned${ext}`)
      await writeFile(outPath, transformed.buffer)
      return outPath
    }
  )

  ipcMain.handle(
    'slice:cura',
    async (
      _e,
      payload: {
        stlPath: string
        outPath: string
        curaEnginePath: string
        definitionsPath?: string
        definitionPath?: string
        slicePreset?: string | null
        curaEngineSettings?: Record<string, string>
      }
    ) => {
      // Validate executable path before spawning
      if (!isPythonPathSafe(payload.curaEnginePath)) {
        return { ok: false, stderr: 'Invalid CuraEngine path: contains shell metacharacters.' }
      }
      return sliceWithCuraEngine({
        curaEnginePath: payload.curaEnginePath,
        inputStlPath: payload.stlPath,
        outputGcodePath: payload.outPath,
        definitionPath: payload.definitionPath,
        curaDefinitionsPath: payload.definitionsPath,
        slicePreset: payload.slicePreset,
        curaEngineSettings: payload.curaEngineSettings
      })
    }
  )

  ipcMain.handle(
    'cam:run',
    async (
      _e,
      payload: {
        stlPath: string
        outPath: string
        machineId: string
        zPassMm: number
        stepoverMm: number
        feedMmMin: number
        plungeMmMin: number
        safeZMm: number
        pythonPath: string
        operationKind?: string
        workCoordinateIndex?: number
        toolDiameterMm?: number
        operationParams?: Record<string, unknown>
        rotaryStockLengthMm?: number
        rotaryStockDiameterMm?: number
        rotaryChuckDepthMm?: number
        rotaryClampOffsetMm?: number
        stockBoxZMm?: number
        stockBoxXMm?: number
        stockBoxYMm?: number
        priorPostedGcode?: string
        useMeshMachinableXClamp?: boolean
        /** ATC tool slot number (1–6) from the tool library. */
        toolSlot?: number
      }
    ) => {
      if (activeCamController !== null) {
        return {
          ok: false as const,
          error: 'cam_already_running',
          hint: 'A CAM job is already in progress. Cancel it first with cam:cancel, then retry.'
        }
      }
      // Validate python path before spawning subprocess
      if (!isPythonPathSafe(payload.pythonPath)) {
        return {
          ok: false as const,
          error: 'invalid_python_path',
          hint: 'The configured Python path contains invalid characters. Check Settings → Python Path.'
        }
      }
      const controller = new AbortController()
      activeCamController = controller
      try {
        const policy = describeCamOperationKind(payload.operationKind)
        if (!policy.runnable) {
          return {
            ok: false as const,
            error: policy.error ?? 'cam_not_supported',
            ...(policy.hint ? { hint: policy.hint } : {})
          }
        }
        const machine = await getMachineById(payload.machineId)
        if (!machine || machine.kind !== 'cnc') {
          return {
            ok: false as const,
            error: 'No CNC machine profile matches the selected machine ID.',
            hint: 'Choose a CNC machine in Manufacture setup (or project active machine). Make → Generate CAM requires a `kind: cnc` profile from resources/machines.'
          }
        }
        const resourcesRoot = getResourcesRoot()
        const appRoot = app.getAppPath()
        const result = await runCamPipeline({
          stlPath: payload.stlPath,
          outputGcodePath: payload.outPath,
          machine,
          resourcesRoot,
          appRoot,
          zPassMm: payload.zPassMm,
          stepoverMm: payload.stepoverMm,
          feedMmMin: payload.feedMmMin,
          plungeMmMin: payload.plungeMmMin,
          safeZMm: payload.safeZMm,
          pythonPath: payload.pythonPath,
          operationKind: payload.operationKind,
          workCoordinateIndex: payload.workCoordinateIndex,
          toolDiameterMm: payload.toolDiameterMm,
          operationParams: payload.operationParams,
          rotaryStockLengthMm: payload.rotaryStockLengthMm,
          rotaryStockDiameterMm: payload.rotaryStockDiameterMm,
          rotaryChuckDepthMm: payload.rotaryChuckDepthMm,
          rotaryClampOffsetMm: payload.rotaryClampOffsetMm,
          stockBoxZMm: payload.stockBoxZMm,
          stockBoxXMm: payload.stockBoxXMm,
          stockBoxYMm: payload.stockBoxYMm,
          priorPostedGcode: payload.priorPostedGcode,
          useMeshMachinableXClamp: payload.useMeshMachinableXClamp,
          toolSlot: payload.toolSlot,
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
      }
    ) => moonrakerPush(payload)
  )

  ipcMain.handle(
    'moonraker:status',
    async (_e, printerUrl: string, timeoutMs?: number) => moonrakerStatus(printerUrl, timeoutMs)
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
}
