import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isPythonPathSafe } from './path-security'
import { buildAssemblyInterferenceReport, safeProjectMeshPath } from './assembly-mesh-interference'
import { buildKernelPartFromProject } from './cad/build-kernel-part'
import { comparePlacementParityFromBounds } from './cad/kernel-placement-parity'
import { importStepToProjectStl, runPythonJson } from './cad/occt-import'
import { runDrawingExport, type DrawingExportPayload } from './drawing-export-service'
import { loadDrawingFile, saveDrawingFile } from './drawing-file-store'
import type { MainIpcWindowContext } from './ipc-context'
import { importMeshViaRegistry } from './mesh-import-registry'
import { getEnginesRoot } from './paths'
import { isLikelyAsciiStl, parseBinaryStl } from './stl'
import {
  assemblyFileSchema,
  buildAssemblyBomCsvLines,
  buildAssemblySummaryReport,
  buildBomHierarchyJsonText,
  buildHierarchicalBomText,
  emptyAssembly,
  parseAssemblyFile,
  type AssemblySummaryReport
} from '../shared/assembly-schema'
import { solveAssemblyKinematics } from '../shared/assembly-kinematics-core'
import {
  designFileSchemaV2,
  designParametersExportSchema,
  emptyDesign,
  mergeParametersIntoDesign,
  normalizeDesign,
  type DesignFileV2
} from '../shared/design-schema'
import { parseDrawingFile } from '../shared/drawing-sheet-schema'
import { formatZodError, isENOENT, parseJsonText } from '../shared/file-parse-errors'
import { kernelManifestSchema, type KernelManifest } from '../shared/kernel-manifest-schema'
import { defaultPartFeatures, partFeaturesFileSchema } from '../shared/part-features-schema'
import { parseMeshImportPlacementPayload } from '../shared/mesh-import-placement'
import { ZodError } from 'zod'

export function registerModelingIpc(ctx: MainIpcWindowContext): void {
  ipcMain.handle('drawing:export', async (_e, payload: DrawingExportPayload) => {
    const win =
      ctx.getMainWindow() ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (!win) return { ok: false as const, error: 'No window' }
    return runDrawingExport(win, payload)
  })

  ipcMain.handle('drawing:load', async (_e, projectDir: string) => loadDrawingFile(projectDir))

  ipcMain.handle('drawing:save', async (_e, projectDir: string, json: string) => {
    let data: unknown
    try {
      data = JSON.parse(json) as unknown
    } catch {
      throw new Error('drawing_save_invalid_json')
    }
    const file = parseDrawingFile(data)
    await saveDrawingFile(projectDir, file)
  })

  ipcMain.handle('cad:importStl', async (_e, projectDir: string, stlPath: string) => {
    const r = await importMeshViaRegistry({
      projectDir,
      sourcePath: stlPath,
      pythonPath: 'python',
      appRoot: app.getAppPath()
    })
    if (!r.ok) return { ok: false as const, error: r.error, detail: r.detail }
    return { ok: true as const, stlPath: r.stlPath }
  })

  ipcMain.handle('cad:importStep', async (_e, projectDir: string, stepPath: string, pythonPath: string) => {
    const safePy = pythonPath || 'python'
    if (!isPythonPathSafe(safePy)) {
      return { ok: false as const, error: 'invalid_python_path', detail: 'Python path contains shell metacharacters.' }
    }
    const r = await importMeshViaRegistry({
      projectDir,
      sourcePath: stepPath,
      pythonPath: safePy,
      appRoot: app.getAppPath()
    })
    if (!r.ok) return { ok: false as const, error: r.error, detail: r.detail }
    return { ok: true as const, stlPath: r.stlPath }
  })

  ipcMain.handle(
    'assets:importMesh',
    async (_e, projectDir: string, sourcePath: string, pythonPath: string, placementPayload?: unknown) => {
      const safePy = pythonPath || 'python'
      if (!isPythonPathSafe(safePy)) {
        return { ok: false as const, error: 'invalid_python_path', detail: 'Python path contains shell metacharacters.' }
      }
      const parsed = parseMeshImportPlacementPayload(placementPayload)
      const placementOpts =
        parsed.placement !== undefined || parsed.upAxis !== undefined || parsed.transform !== undefined
          ? { placement: parsed.placement, upAxis: parsed.upAxis, transform: parsed.transform }
          : undefined
      return importMeshViaRegistry({
        projectDir,
        sourcePath,
        pythonPath: safePy,
        appRoot: app.getAppPath(),
        placementOpts
      })
    }
  )

  ipcMain.handle('mesh:previewStlBase64', async (_e, sourcePath: string, pythonPath: string) => {
    const safePy = pythonPath || 'python'
    if (!isPythonPathSafe(safePy)) {
      return { ok: false as const, error: 'invalid_python_path', detail: 'Python path contains shell metacharacters.' }
    }
    const lower = sourcePath.toLowerCase()
    if (lower.endsWith('.stl')) {
      const buf = await readFile(sourcePath)
      return { ok: true as const, base64: buf.toString('base64') }
    }
    const tmpRoot = await mkdtemp(join(app.getPath('temp'), 'ufs-mesh-preview-'))
    try {
      if (lower.endsWith('.step') || lower.endsWith('.stp') || lower.endsWith('.iges') || lower.endsWith('.igs')) {
        const r = await importStepToProjectStl({
          stepPath: sourcePath,
          projectAssetsDir: tmpRoot,
          pythonPath: safePy,
          appRoot: app.getAppPath()
        })
        if (!r.ok) return { ok: false as const, error: r.error, detail: r.detail }
        const buf = await readFile(r.stlPath)
        return { ok: true as const, base64: buf.toString('base64') }
      }
      const outStl = join(tmpRoot, 'preview.stl')
      const script = join(getEnginesRoot(), 'mesh', 'mesh_to_stl.py')
      const { code, json } = await runPythonJson(safePy, [script, sourcePath, outStl], app.getAppPath())
      if (code !== 0 || !json?.ok) {
        return {
          ok: false as const,
          error: typeof json?.error === 'string' ? json.error : 'mesh_preview_failed',
          detail: typeof json?.detail === 'string' ? json.detail : undefined
        }
      }
      const buf = await readFile(outStl)
      return { ok: true as const, base64: buf.toString('base64') }
    } finally {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
    }
  })

  ipcMain.handle('cad:kernelBuild', async (_e, projectDir: string, pythonPath: string) => {
    const safePy = pythonPath || 'python'
    if (!isPythonPathSafe(safePy)) {
      return { ok: false as const, error: 'invalid_python_path', detail: 'Python path contains shell metacharacters.' }
    }
    return buildKernelPartFromProject({
      projectDir,
      pythonPath: safePy,
      appRoot: app.getAppPath()
    })
  })

  ipcMain.handle(
    'cad:comparePreviewKernel',
    async (_e, projectDir: string, kernelStlPath: string, previewStlBase64: string) => {
      try {
        const kernelBuf = await readFile(kernelStlPath)
        if (isLikelyAsciiStl(kernelBuf)) return { ok: false as const, error: 'kernel_ascii_stl_not_supported' }
        const previewBuf = Buffer.from(previewStlBase64, 'base64')
        if (isLikelyAsciiStl(previewBuf)) return { ok: false as const, error: 'preview_ascii_stl_not_supported' }
        const kernelBounds = parseBinaryStl(kernelBuf)
        const previewBounds = parseBinaryStl(previewBuf)
        const parity = comparePlacementParityFromBounds(previewBounds, kernelBounds)

        const manifestPath = join(projectDir, 'part', 'kernel-manifest.json')
        try {
          const raw = await readFile(manifestPath, 'utf-8')
          const current = JSON.parse(raw) as Record<string, unknown>
          const next = {
            ...current,
            placementParity: parity.parity,
            placementParityDetail: parity.detail,
            placementParityMaxDeltaMm: parity.maxDeltaMm
          }
          await writeFile(manifestPath, JSON.stringify(next, null, 2), 'utf-8')
        } catch {
          // Keep response useful even if manifest update fails.
        }
        return { ok: true as const, ...parity }
      } catch (e) {
        return {
          ok: false as const,
          error: 'placement_parity_failed',
          detail: e instanceof Error ? e.message : String(e)
        }
      }
    }
  )

  ipcMain.handle('design:load', async (_e, projectDir: string) => {
    const p = join(projectDir, 'design', 'sketch.json')
    try {
      const raw = await readFile(p, 'utf-8')
      const data = parseJsonText(raw, 'design/sketch.json')
      return normalizeDesign(data)
    } catch (e) {
      if (isENOENT(e)) return null
      if (e instanceof ZodError) throw new Error(formatZodError(e, 'design/sketch.json'))
      throw e instanceof Error ? e : new Error(String(e))
    }
  })

  ipcMain.handle(
    'design:readKernelManifest',
    async (_e, projectDir: string): Promise<KernelManifest | null> => {
      const p = join(projectDir, 'part', 'kernel-manifest.json')
      try {
        const raw = await readFile(p, 'utf-8')
        const data = parseJsonText(raw, 'part/kernel-manifest.json')
        const parsed = kernelManifestSchema.safeParse(data)
        return parsed.success ? parsed.data : null
      } catch (e) {
        if (isENOENT(e)) return null
        return null
      }
    }
  )

  ipcMain.handle(
    'design:readKernelStlBase64',
    async (
      _e,
      projectDir: string
    ): Promise<{ ok: true; base64: string } | { ok: false; error: string }> => {
      const p = join(projectDir, 'output', 'kernel-part.stl')
      try {
        const buf = await readFile(p)
        if (isLikelyAsciiStl(buf)) return { ok: false, error: 'ascii_stl_not_supported_in_viewport' }
        return { ok: true, base64: buf.toString('base64') }
      } catch {
        return { ok: false, error: 'read_failed' }
      }
    }
  )

  ipcMain.handle('design:save', async (_e, projectDir: string, json: string) => {
    const p = join(projectDir, 'design', 'sketch.json')
    await mkdir(dirname(p), { recursive: true })
    try {
      const data = parseJsonText(json, 'design/sketch.json (save)')
      const parsed = designFileSchemaV2.parse(data)
      await writeFile(p, JSON.stringify(parsed, null, 2), 'utf-8')
    } catch (e) {
      if (e instanceof ZodError) throw new Error(formatZodError(e, 'design/sketch.json (save)'))
      throw e instanceof Error ? e : new Error(String(e))
    }
  })

  ipcMain.handle('design:exportParameters', async (_e, projectDir: string) => {
    const p = join(projectDir, 'design', 'sketch.json')
    let design = normalizeDesign(emptyDesign())
    try {
      const raw = await readFile(p, 'utf-8')
      design = normalizeDesign(parseJsonText(raw, 'design/sketch.json'))
    } catch (e) {
      if (!isENOENT(e)) throw e instanceof Error ? e : new Error(String(e))
    }
    const out = join(projectDir, 'output', 'design-parameters.json')
    await mkdir(dirname(out), { recursive: true })
    const payload = {
      exportedAt: new Date().toISOString(),
      source: 'design/sketch.json',
      parameters: design.parameters
    }
    await writeFile(out, JSON.stringify(payload, null, 2), 'utf-8')
    return { path: out, keyCount: Object.keys(design.parameters).length }
  })

  ipcMain.handle('design:mergeParameters', async (_e, projectDir: string, json: string) => {
    const p = join(projectDir, 'design', 'sketch.json')
    let data: unknown
    try {
      data = parseJsonText(json, 'design-parameters-merge.json')
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'parameters_import_invalid_json')
    }
    const parsed = designParametersExportSchema.safeParse(data)
    if (!parsed.success) {
      throw new Error(formatZodError(parsed.error, 'design-parameters-merge.json'))
    }
    let design: DesignFileV2
    try {
      const raw = await readFile(p, 'utf-8')
      design = normalizeDesign(parseJsonText(raw, 'design/sketch.json'))
    } catch (e) {
      if (isENOENT(e)) {
        throw new Error('design_sketch_missing: save a design before merging parameters')
      }
      throw e instanceof Error ? e : new Error(String(e))
    }
    const incoming = parsed.data.parameters
    const merged = mergeParametersIntoDesign(design, incoming)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, JSON.stringify(merged, null, 2), 'utf-8')
    return { mergedKeyCount: Object.keys(incoming).length }
  })

  ipcMain.handle('assembly:load', async (_e, projectDir: string) => {
    const p = join(projectDir, 'assembly.json')
    try {
      const raw = await readFile(p, 'utf-8')
      const data = parseJsonText(raw, 'assembly.json')
      return parseAssemblyFile(data)
    } catch (e) {
      if (isENOENT(e)) return emptyAssembly()
      if (e instanceof ZodError) throw new Error(formatZodError(e, 'assembly.json'))
      throw e instanceof Error ? e : new Error(String(e))
    }
  })

  ipcMain.handle('assembly:save', async (_e, projectDir: string, json: string) => {
    const p = join(projectDir, 'assembly.json')
    try {
      const data = parseJsonText(json, 'assembly.json (save)')
      const parsed = assemblyFileSchema.parse(data)
      await writeFile(p, JSON.stringify(parsed, null, 2), 'utf-8')
    } catch (e) {
      if (e instanceof ZodError) throw new Error(formatZodError(e, 'assembly.json (save)'))
      throw e instanceof Error ? e : new Error(String(e))
    }
  })

  ipcMain.handle('assembly:exportBom', async (_e, projectDir: string) => {
    const p = join(projectDir, 'assembly.json')
    let asm = emptyAssembly()
    try {
      asm = parseAssemblyFile(JSON.parse(await readFile(p, 'utf-8')))
    } catch {
      /* default */
    }
    const out = join(projectDir, 'output', 'bom.csv')
    await mkdir(dirname(out), { recursive: true })
    const lines = buildAssemblyBomCsvLines(asm)
    await writeFile(out, lines.join('\n'), 'utf-8')
    return out
  })

  ipcMain.handle('assembly:exportBomHierarchical', async (_e, projectDir: string) => {
    const p = join(projectDir, 'assembly.json')
    let asm = emptyAssembly()
    try {
      asm = parseAssemblyFile(JSON.parse(await readFile(p, 'utf-8')))
    } catch {
      /* default */
    }
    const out = join(projectDir, 'output', 'bom-hierarchical.txt')
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, buildHierarchicalBomText(asm), 'utf-8')
    return out
  })

  ipcMain.handle('assembly:exportBomHierarchyJson', async (_e, projectDir: string) => {
    const p = join(projectDir, 'assembly.json')
    let asm = emptyAssembly()
    try {
      asm = parseAssemblyFile(JSON.parse(await readFile(p, 'utf-8')))
    } catch {
      /* default */
    }
    const out = join(projectDir, 'output', 'bom-hierarchy.json')
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, buildBomHierarchyJsonText(asm), 'utf-8')
    return out
  })

  ipcMain.handle('assembly:saveInterferenceReport', async (_e, projectDir: string, json: string) => {
    let data: unknown
    try {
      data = JSON.parse(json)
    } catch {
      throw new Error('interference_report_invalid_json')
    }
    if (data === null || typeof data !== 'object') {
      throw new Error('interference_report_not_object')
    }
    let asm = emptyAssembly()
    try {
      asm = parseAssemblyFile(JSON.parse(await readFile(join(projectDir, 'assembly.json'), 'utf-8')))
    } catch {
      /* default */
    }
    const name = (asm.name || 'assembly').replace(/[^\w\-]+/g, '_')
    const out = join(projectDir, 'output', `${name}-interference.json`)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, JSON.stringify(data, null, 2), 'utf-8')
    return out
  })

  ipcMain.handle('assembly:interferenceCheck', async (_e, projectDir: string) => {
    let asm = emptyAssembly()
    try {
      const raw = await readFile(join(projectDir, 'assembly.json'), 'utf-8')
      asm = parseAssemblyFile(JSON.parse(raw) as unknown)
    } catch {
      /* default */
    }
    return buildAssemblyInterferenceReport(projectDir, asm)
  })

  ipcMain.handle('assembly:interferenceCheckSimulated', async (_e, projectDir: string, assemblyInput: unknown) => {
    const asm = parseAssemblyFile(assemblyInput)
    const active = asm.components.filter((c) => !c.suppressed)
    const solved = solveAssemblyKinematics(active)
    return buildAssemblyInterferenceReport(projectDir, asm, solved.transforms)
  })

  ipcMain.handle('assembly:summary', async (_e, projectDir: string): Promise<AssemblySummaryReport> => {
    let asm = emptyAssembly()
    try {
      const raw = await readFile(join(projectDir, 'assembly.json'), 'utf-8')
      asm = parseAssemblyFile(JSON.parse(raw) as unknown)
    } catch {
      /* default */
    }
    return buildAssemblySummaryReport(asm)
  })

  ipcMain.handle('assembly:solve', async (_e, assemblyInput: unknown) => {
    const asm = parseAssemblyFile(assemblyInput)
    const active = asm.components.filter((c) => !c.suppressed)
    const solved = solveAssemblyKinematics(active)
    return {
      ok: true as const,
      transforms: [...solved.transforms.entries()].map(([id, t]) => ({ id, transform: t })),
      diagnostics: solved.diagnostics
    }
  })

  ipcMain.handle('assembly:simulate', async (_e, assemblyInput: unknown, sampleCountRaw?: number) => {
    const asm = parseAssemblyFile(assemblyInput)
    const active = asm.components.filter((c) => !c.suppressed)
    const solved = solveAssemblyKinematics(active)
    const sampleCount = Math.max(1, Math.min(200, Math.floor(sampleCountRaw ?? 12)))
    const pose = [...solved.transforms.entries()].map(([id, t]) => ({ id, transform: t }))
    return {
      ok: true as const,
      sampleCount,
      poses: Array.from({ length: sampleCount }, (_, i) => ({ sample: i, transforms: pose })),
      diagnostics: solved.diagnostics
    }
  })

  ipcMain.handle(
    'assembly:readStlBase64',
    async (_e, projectDir: string, meshPath: string): Promise<{ ok: true; base64: string } | { ok: false; error: string }> => {
      const abs = safeProjectMeshPath(projectDir, meshPath)
      if (!abs) return { ok: false, error: 'invalid_or_unsafe_mesh_path' }
      try {
        const buf = await readFile(abs)
        if (isLikelyAsciiStl(buf)) return { ok: false, error: 'ascii_stl_not_supported_in_viewport' }
        return { ok: true, base64: buf.toString('base64') }
      } catch {
        return { ok: false, error: 'read_failed' }
      }
    }
  )

  ipcMain.handle('features:load', async (_e, projectDir: string) => {
    const p = join(projectDir, 'part', 'features.json')
    try {
      const raw = await readFile(p, 'utf-8')
      const data = parseJsonText(raw, 'part/features.json')
      return partFeaturesFileSchema.parse(data)
    } catch (e) {
      if (isENOENT(e)) return defaultPartFeatures()
      if (e instanceof ZodError) throw new Error(formatZodError(e, 'part/features.json'))
      throw e instanceof Error ? e : new Error(String(e))
    }
  })

  ipcMain.handle('features:save', async (_e, projectDir: string, json: string) => {
    const p = join(projectDir, 'part', 'features.json')
    await mkdir(dirname(p), { recursive: true })
    try {
      const data = parseJsonText(json, 'part/features.json (save)')
      const parsed = partFeaturesFileSchema.parse(data)
      await writeFile(p, JSON.stringify(parsed, null, 2), 'utf-8')
    } catch (e) {
      if (e instanceof ZodError) throw new Error(formatZodError(e, 'part/features.json (save)'))
      throw e instanceof Error ? e : new Error(String(e))
    }
  })

  ipcMain.handle(
    'model:exportStl',
    async (_e, payload: { projectDir: string; filename: string; base64: string }) => {
      const name = basename(payload.filename.replace(/\\/g, '/'))
      if (!name.toLowerCase().endsWith('.stl')) {
        return { ok: false as const, error: 'invalid_filename' }
      }
      if (name.includes('..') || /[<>:"|?*]/.test(name)) {
        return { ok: false as const, error: 'invalid_filename' }
      }
      const dest = join(payload.projectDir, 'assets', name)
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, Buffer.from(payload.base64, 'base64'))
      return { ok: true as const, path: dest }
    }
  )
}
