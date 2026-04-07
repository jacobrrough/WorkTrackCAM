import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import { MESH_IMPORT_FILE_EXTENSIONS, MESH_PYTHON_EXTENSIONS, STEP_IGES_EXTENSIONS } from '../shared/mesh-import-formats'
import type { MeshImportPlacement, MeshImportTransform, MeshImportUpAxis } from '../shared/mesh-import-placement'
import type { ImportHistoryEntry } from '../shared/project-schema'
import { importStepToProjectStl, importStlToProjectAssets, runPythonJson } from './cad/occt-import'
import { getEnginesRoot } from './paths'
import { resolveUniqueFilenameInDir } from './unique-asset-filename'

export type MeshImportRoute = 'stl' | 'step' | 'mesh_python' | 'dxf'

export function meshImportRouteFromPath(filePath: string): MeshImportRoute | null {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.stl') return 'stl'
  const short = ext.replace(/^\./, '')
  if (STEP_IGES_EXTENSIONS.has(short)) return 'step'
  if (ext === '.dxf') return 'dxf'
  if (MESH_PYTHON_EXTENSIONS.has(short)) return 'mesh_python'
  return null
}

export const MESH_IMPORT_DIALOG_EXTENSIONS = [...MESH_IMPORT_FILE_EXTENSIONS]

export type MeshImportOk = {
  ok: true
  stlPath: string
  /** POSIX-style path relative to project root */
  relativePath: string
  report: ImportHistoryEntry
}

export type MeshImportErr = { ok: false; error: string; detail?: string }

export type MeshImportResult = MeshImportOk | MeshImportErr

function posixRel(projectDir: string, absolutePath: string): string {
  return relative(projectDir, absolutePath).replace(/\\/g, '/')
}

function buildReport(params: {
  projectDir: string
  stlPath: string
  sourcePath: string
  sourceFormat: string
  roundTripLevel: ImportHistoryEntry['roundTripLevel']
  warnings?: string[]
}): ImportHistoryEntry {
  return {
    id: randomUUID(),
    importedAt: new Date().toISOString(),
    sourceFormat: params.sourceFormat,
    sourceFileName: basename(params.sourcePath),
    assetRelativePath: posixRel(params.projectDir, params.stlPath),
    roundTripLevel: params.roundTripLevel,
    ...(params.warnings?.length ? { warnings: params.warnings } : {})
  }
}

export type MeshImportPlacementParams = {
  placement?: MeshImportPlacement
  upAxis?: MeshImportUpAxis
  transform?: MeshImportTransform
}

async function finalizeImportedStlWithPlacement(
  projectDir: string,
  stlPath: string,
  report: ImportHistoryEntry,
  placementOpts?: MeshImportPlacementParams
): Promise<MeshImportResult> {
  const placement = placementOpts?.placement ?? 'as_is'
  const upAxis = placementOpts?.upAxis ?? 'y_up'
  if (placement === 'as_is' && upAxis === 'y_up') {
    return {
      ok: true,
      stlPath,
      relativePath: posixRel(projectDir, stlPath),
      report
    }
  }
  const { transformBinaryStlWithPlacement } = await import('./binary-stl-placement')
  const buf = await readFile(stlPath)
  const tr = transformBinaryStlWithPlacement(buf, placement, upAxis, placementOpts?.transform)
  if (!tr.ok) {
    return { ok: false, error: tr.error, detail: tr.detail }
  }
  await writeFile(stlPath, tr.buffer)
  const warnings = [...(report.warnings ?? []), 'Import placement / up-axis applied to the binary STL under assets/.']
  return {
    ok: true,
    stlPath,
    relativePath: posixRel(projectDir, stlPath),
    report: { ...report, warnings }
  }
}

/**
 * Unified import: STL copy, STEP→STL (CadQuery), mesh formats→STL (trimesh).
 */
export async function importMeshViaRegistry(params: {
  projectDir: string
  sourcePath: string
  pythonPath: string
  appRoot: string
  placementOpts?: MeshImportPlacementParams
}): Promise<MeshImportResult> {
  const route = meshImportRouteFromPath(params.sourcePath)
  if (!route) {
    return { ok: false, error: 'unsupported_mesh_format', detail: extname(params.sourcePath) }
  }

  const assets = join(params.projectDir, 'assets')
  const ext = extname(params.sourcePath).toLowerCase().replace(/^\./, '')

  if (route === 'stl') {
    const r = await importStlToProjectAssets(params.sourcePath, assets)
    const report = buildReport({
      projectDir: params.projectDir,
      stlPath: r.stlPath,
      sourcePath: params.sourcePath,
      sourceFormat: ext,
      roundTripLevel: 'mesh_only'
    })
    return finalizeImportedStlWithPlacement(params.projectDir, r.stlPath, report, params.placementOpts)
  }

  if (route === 'step') {
    const r = await importStepToProjectStl({
      stepPath: params.sourcePath,
      projectAssetsDir: assets,
      pythonPath: params.pythonPath || 'python',
      appRoot: params.appRoot
    })
    if (!r.ok) {
      return { ok: false, error: r.error, detail: r.detail }
    }
    const report = buildReport({
      projectDir: params.projectDir,
      stlPath: r.stlPath,
      sourcePath: params.sourcePath,
      sourceFormat: ext,
      roundTripLevel: 'partial',
      warnings: ['STEP tessellated to STL; parametric history is not preserved in UFS.']
    })
    return finalizeImportedStlWithPlacement(params.projectDir, r.stlPath, report, params.placementOpts)
  }

  const base = basename(params.sourcePath).replace(/\.[^.]+$/, '') || 'import'
  const outStl = await resolveUniqueFilenameInDir(assets, `${base}.stl`)
  const script = join(getEnginesRoot(), 'mesh', 'mesh_to_stl.py')
  const { code, json } = await runPythonJson(params.pythonPath || 'python', [script, params.sourcePath, outStl], params.appRoot)
  if (code !== 0 || !json?.ok) {
    return {
      ok: false,
      error: (json?.error as string) ?? 'mesh_import_failed',
      detail: json?.detail as string | undefined
    }
  }
  const report = buildReport({
    projectDir: params.projectDir,
    stlPath: outStl,
    sourcePath: params.sourcePath,
    sourceFormat: ext,
    roundTripLevel: 'mesh_only',
    warnings: ['Converted via trimesh → STL; verify units and orientation before CAM.']
  })
  return finalizeImportedStlWithPlacement(params.projectDir, outStl, report, params.placementOpts)
}
