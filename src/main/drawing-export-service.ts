import { app, BrowserWindow, dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DrawingViewPlaceholder } from '../shared/drawing-sheet-schema'
import { resolveExportViewRows } from '../shared/drawing-sheet-schema'
import { normalizeDesign } from '../shared/design-schema'
import { partFeaturesFileSchema } from '../shared/part-features-schema'
import { extractKernelProfiles } from '../shared/sketch-profile'
import {
  buildFlatPatternDxf,
  buildPlaceholderDxf,
  buildTitleBlockHtml,
  type ProjectedModelViewForExport,
  sanitizeFileStem
} from './drawing-export-templates'
import { projectDrawingViewsFromKernelStl } from './drawing-project-model-views'
import { loadDrawingFile } from './drawing-file-store'
import { loadSettings } from './settings-store'

export type DrawingExportPayload = { kind: 'pdf' | 'dxf'; projectName?: string; projectDir?: string }

export type DrawingExportResult =
  | { ok: true; path: string }
  | { ok: false; canceled?: boolean; error: string }

async function buildFlatPatternGeometry(projectDir: string): Promise<{
  outlinePoints: Array<[number, number]>
  bendLines: Array<[number, number, number, number]>
} | null> {
  try {
    const designRaw = await readFile(join(projectDir, 'design', 'sketch.json'), 'utf-8')
    const design = normalizeDesign(JSON.parse(designRaw) as unknown)
    const profiles = extractKernelProfiles(design)
    const loops = profiles?.filter((p): p is { type: 'loop'; points: Array<[number, number]> } => p.type === 'loop')
    if (!loops || loops.length === 0) return null
    const outlinePoints = loops[0]?.points ?? []
    if (outlinePoints.length < 3) return null

    const featuresRaw = await readFile(join(projectDir, 'part', 'features.json'), 'utf-8')
    const features = partFeaturesFileSchema.parse(JSON.parse(featuresRaw) as unknown)
    const bendLines = (features.kernelOps ?? [])
      .filter((op) => op.kind === 'sheet_fold')
      .map((op) => {
        const minX = Math.min(...outlinePoints.map((p) => p[0]))
        const maxX = Math.max(...outlinePoints.map((p) => p[0]))
        const y = (op as { bendLineYMm: number }).bendLineYMm
        return [minX, y, maxX, y] as [number, number, number, number]
      })
    return { outlinePoints, bendLines }
  } catch {
    return null
  }
}

async function tryProjectedModelViews(
  projectDir: string | undefined,
  placeholders: DrawingViewPlaceholder[] | undefined,
  meshProjectionTier?: 'A' | 'B' | 'C'
): Promise<ProjectedModelViewForExport[] | undefined> {
  if (!projectDir || !placeholders?.length) return undefined
  const settings = await loadSettings()
  const pythonPath = settings.pythonPath?.trim() || 'python'
  const r = await projectDrawingViewsFromKernelStl({
    projectDir,
    placeholders,
    pythonPath,
    appRoot: app.getAppPath(),
    meshProjectionTier
  })
  if (!r.ok) return undefined
  return r.views.map((v) => {
    const ph = placeholders.find((p) => p.id === v.id)
    return {
      id: v.id,
      label: v.label,
      axis: v.axis,
      segments: v.segments,
      layout: ph?.layout
        ? {
            originXMM: ph.layout.originXMM,
            originYMM: ph.layout.originYMM,
            widthMM: ph.layout.widthMM,
            heightMM: ph.layout.heightMM
          }
        : undefined
    }
  })
}

export async function runDrawingExport(
  parent: BrowserWindow,
  payload: DrawingExportPayload
): Promise<DrawingExportResult> {
  const stem = sanitizeFileStem(payload.projectName ?? 'drawing')
  const defaultName = payload.kind === 'pdf' ? `${stem}_sheet.pdf` : `${stem}_sheet.dxf`
  const filters =
    payload.kind === 'pdf'
      ? [{ name: 'PDF', extensions: ['pdf'] }]
      : [{ name: 'DXF', extensions: ['dxf'] }]

  const picked = await dialog.showSaveDialog(parent, {
    title: payload.kind === 'pdf' ? 'Export drawing PDF' : 'Export drawing DXF',
    defaultPath: defaultName,
    filters
  })

  if (picked.canceled || !picked.filePath) {
    return { ok: false, canceled: true, error: 'Canceled' }
  }

  const outPath = picked.filePath
  const now = new Date().toISOString()
  const projectTitle = payload.projectName?.trim() || 'Untitled project'

  let sheetTitle: string | undefined
  let sheetScale: string | undefined
  let meshTier: 'A' | 'B' | 'C' | undefined
  let viewPlaceholders: { kind: string; label: string; detailLine?: string }[] | undefined
  let rawPlaceholders: DrawingViewPlaceholder[] | undefined
  if (payload.projectDir) {
    try {
      const df = await loadDrawingFile(payload.projectDir)
      const sh = df.sheets[0]
      if (sh) {
        sheetTitle = sh.name
        sheetScale = sh.scale
        meshTier = sh.meshProjectionTier
        if (sh.viewPlaceholders?.length) {
          rawPlaceholders = sh.viewPlaceholders
          viewPlaceholders = resolveExportViewRows(sh.viewPlaceholders)
        }
      }
    } catch {
      /* malformed drawing.json — still export template */
    }
  }

  const projectedModelViews = await tryProjectedModelViews(
    payload.projectDir,
    rawPlaceholders,
    meshTier
  )

  try {
    if (payload.kind === 'dxf') {
      const flat = payload.projectDir ? await buildFlatPatternGeometry(payload.projectDir) : null
      const body = flat
        ? buildFlatPatternDxf({
            projectTitle,
            generatedAtIso: now,
            outlinePoints: flat.outlinePoints,
            bendLines: flat.bendLines
          })
        : buildPlaceholderDxf({
            projectTitle,
            generatedAtIso: now,
            sheetTitle,
            sheetScale,
            viewPlaceholders,
            projectedModelViews
          })
      await writeFile(outPath, body, 'utf-8')
      return { ok: true, path: outPath }
    }

    const html = buildTitleBlockHtml({
      projectTitle,
      generatedAtIso: now,
      appLabel: 'Unified Fab Studio',
      sheetTitle,
      sheetScale,
      viewPlaceholders,
      projectedModelViews
    })
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`

    const hidden = new BrowserWindow({
      show: false,
      width: 1240,
      height: 1754,
      webPreferences: {
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    try {
      await hidden.loadURL(dataUrl)
      const pdf = await hidden.webContents.printToPDF({
        printBackground: true,
        landscape: false,
        pageSize: 'A4',
        margins: { marginType: 'default' }
      })
      await writeFile(outPath, pdf)
    } finally {
      hidden.destroy()
    }

    return { ok: true, path: outPath }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const label = payload.kind === 'pdf' ? 'PDF' : 'DXF'
    const detail = msg.trim() || 'unknown error'
    return { ok: false, error: `${label} export failed: ${detail}` }
  }
}
