import { app as electronApp } from 'electron'
import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** True when running as a packaged Electron app with `resourcesPath` set. */
function isPackagedElectronApp(): boolean {
  return Boolean(
    electronApp &&
      typeof electronApp.isPackaged === 'boolean' &&
      electronApp.isPackaged &&
      typeof process.resourcesPath === 'string' &&
      process.resourcesPath.length > 0
  )
}

function appPathOrCwd(): string {
  const ap = electronApp?.getAppPath?.()
  if (typeof ap === 'string' && ap.length > 0) return ap
  return process.cwd()
}

/** Relative paths under `engines/` that must exist for Python CAM + mesh import. */
export const ENGINES_CAM_SENTINELS = [
  'cam/ocl_toolpath.py',
  'cam/advanced/__main__.py',
  'cam/toolpath_engine/__main__.py'
] as const

export const ENGINES_MESH_SCRIPT = 'mesh/mesh_to_stl.py' as const
export const ENGINES_OCCT_STEP_SCRIPT = 'occt/step_to_stl.py' as const

/** Root containing `resources/` (machines, posts, slicer defs). */
export function getResourcesRoot(): string {
  if (isPackagedElectronApp()) {
    return join(process.resourcesPath, 'resources')
  }
  return join(appPathOrCwd(), 'resources')
}

export function getEnginesRoot(): string {
  if (isPackagedElectronApp()) {
    return join(process.resourcesPath, 'engines')
  }
  return join(appPathOrCwd(), 'engines')
}

/** Directory of this main bundle (for resolving relative test fixtures). */
export function getMainDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

async function pathReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Verifies on-disk Python engine scripts exist (packaged app uses `extraResources/engines`).
 */
export async function getEnginesBundleDiagnostics(): Promise<{
  enginesRoot: string
  directoryReadable: boolean
  camBundleComplete: boolean
  missingCamSentinels: string[]
  meshScriptPresent: boolean
  occtStepScriptPresent: boolean
}> {
  const enginesRoot = getEnginesRoot()
  let directoryReadable = true
  try {
    await access(enginesRoot, constants.R_OK)
  } catch {
    directoryReadable = false
  }
  const missingCamSentinels: string[] = []
  for (const rel of ENGINES_CAM_SENTINELS) {
    const p = join(enginesRoot, rel)
    if (!(await pathReadable(p))) missingCamSentinels.push(rel)
  }
  const meshScriptPresent = await pathReadable(join(enginesRoot, ENGINES_MESH_SCRIPT))
  const occtStepScriptPresent = await pathReadable(join(enginesRoot, ENGINES_OCCT_STEP_SCRIPT))
  return {
    enginesRoot,
    directoryReadable,
    camBundleComplete: directoryReadable && missingCamSentinels.length === 0,
    missingCamSentinels,
    meshScriptPresent,
    occtStepScriptPresent
  }
}

export async function getRuntimeRootsDiagnostics(): Promise<{
  resourcesRoot: string
  enginesRoot: string
  resourcesReadable: boolean
  enginesReadable: boolean
  enginesBundle: Awaited<ReturnType<typeof getEnginesBundleDiagnostics>>
}> {
  const resourcesRoot = getResourcesRoot()
  const enginesRoot = getEnginesRoot()
  let resourcesReadable = true
  let enginesReadable = true
  try {
    await access(resourcesRoot, constants.R_OK)
  } catch {
    resourcesReadable = false
  }
  try {
    await access(enginesRoot, constants.R_OK)
  } catch {
    enginesReadable = false
  }
  const enginesBundle = await getEnginesBundleDiagnostics()
  return {
    resourcesRoot,
    enginesRoot,
    resourcesReadable,
    enginesReadable,
    enginesBundle
  }
}
