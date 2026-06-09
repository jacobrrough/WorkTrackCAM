import { dialog, ipcMain, shell } from 'electron'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { constants as fsConstants } from 'node:fs'
import { getAppVersion } from './app-runtime'
import type { MainIpcWindowContext } from './ipc-context'
import { newProject, readProjectFile, writeProjectFile } from './project-store'
import { loadSettings, saveSettings } from './settings-store'
import { appSettingsSchema, projectSchema } from '../shared/project-schema'
import { isSafeExternalUrl } from './path-security'
import { getResourcesRoot } from './paths'
import {
  WIZARD_MACHINE_TO_CAD_SAMPLE,
  WIZARD_MACHINE_TO_SAMPLE_FILE,
  type WizardStarterMachineId
} from '../shared/first-launch-wizard-contract'
import {
  BUNDLED_FONT_FILE,
  isBundledFontId,
  type BundledFontId
} from '../shared/bundled-font-contract'

export function registerCoreIpc(ctx: MainIpcWindowContext): void {
  ipcMain.handle('app:getVersion', async () => getAppVersion())

  ipcMain.handle('settings:get', async () => loadSettings())
  ipcMain.handle('settings:set', async (_e, partial: Record<string, unknown>) => {
    const cur = await loadSettings()
    const merged: Record<string, unknown> = { ...cur }
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined) delete merged[k]
      else merged[k] = v
    }
    const next = appSettingsSchema.parse(merged)
    await saveSettings(next)
    return next
  })

  ipcMain.handle('project:openDir', async () => {
    const win = ctx.getMainWindow()
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  ipcMain.handle('project:read', async (_e, dir: string) => readProjectFile(dir))

  ipcMain.handle('project:create', async (_e, payload: { dir: string; name: string; machineId: string }) => {
    const p = newProject(payload.name, payload.machineId)
    await writeProjectFile(payload.dir, p)
    return p
  })

  ipcMain.handle('project:save', async (_e, dir: string, project: unknown) => {
    const parsed = projectSchema.parse(project)
    await writeProjectFile(dir, parsed)
  })

  ipcMain.handle(
    'dialog:openFile',
    async (
      _e,
      filters: { name: string; extensions: string[] }[],
      defaultPath?: string
    ) => {
      const win = ctx.getMainWindow()
      if (!win) return null
      const r = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: filters.length ? filters : [{ name: 'All', extensions: ['*'] }],
        ...(defaultPath != null && String(defaultPath).trim() !== ''
          ? { defaultPath: String(defaultPath).trim() }
          : {})
      })
      if (r.canceled || !r.filePaths[0]) return null
      // Null-byte rejection -- mirrors the pattern in `file:readText`,
      // `file:writeText`, and `slice:orca` (ipc-fabrication.ts:340). Even
      // though the path comes from the native OS dialog (not the renderer),
      // we never trust untrusted bytes flowing back across the IPC boundary.
      const picked = r.filePaths[0]
      if (picked.includes('\0')) return null
      return picked
    }
  )

  ipcMain.handle(
    'dialog:openFiles',
    async (_e, filters: { name: string; extensions: string[] }[], defaultPath?: string) => {
      const win = ctx.getMainWindow()
      if (!win) return []
      const r = await dialog.showOpenDialog(win, {
        properties: ['openFile', 'multiSelections'],
        filters: filters.length ? filters : [{ name: 'All', extensions: ['*'] }],
        ...(defaultPath != null && String(defaultPath).trim() !== ''
          ? { defaultPath: String(defaultPath).trim() }
          : {})
      })
      if (r.canceled || r.filePaths.length === 0) return []
      // Null-byte rejection (see `dialog:openFile` for rationale). If *any*
      // path in the selection is poisoned, reject the whole batch -- callers
      // expect a homogeneous array of safe paths or an empty list.
      for (const p of r.filePaths) {
        if (p.includes('\0')) return []
      }
      return r.filePaths
    }
  )

  ipcMain.handle('shell:openPath', async (_e, p: string) => {
    if (!p || typeof p !== 'string' || p.includes('\0')) {
      throw new Error('Invalid path for shell:openPath')
    }
    // If the string looks like a URL (e.g. https:// or http://), validate
    // the protocol before opening to block javascript: / file:// exploits.
    if (/^[a-z][a-z0-9+.-]*:/i.test(p)) {
      if (!isSafeExternalUrl(p)) {
        throw new Error('Only http: and https: URLs are allowed for external open.')
      }
      await shell.openExternal(p)
      return
    }
    await shell.openPath(p)
  })

  ipcMain.handle('file:readText', async (_e, p: string) => {
    if (!p || typeof p !== 'string' || p.includes('\0')) {
      throw new Error('Invalid file path for file:readText')
    }
    try {
      return await readFile(p, 'utf-8')
    } catch (e) {
      throw new Error(`Failed to read file "${p}": ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  ipcMain.handle(
    'dialog:saveFile',
    async (
      _e,
      filters: { name: string; extensions: string[] }[],
      defaultPath?: string
    ) => {
      const win = ctx.getMainWindow()
      if (!win) return null
      const r = await dialog.showSaveDialog(win, {
        filters: filters.length ? filters : [{ name: 'All', extensions: ['*'] }],
        ...(defaultPath != null && String(defaultPath).trim() !== ''
          ? { defaultPath: String(defaultPath).trim() }
          : {})
      })
      if (r.canceled || !r.filePath) return null
      // Null-byte rejection (see `dialog:openFile`). The save target is fed
      // straight into `writeFile`/post-processor pipelines downstream, so a
      // poisoned path here would defeat the per-handler guards.
      if (r.filePath.includes('\0')) return null
      return r.filePath
    }
  )

  ipcMain.handle('file:writeText', async (_e, p: string, content: string) => {
    if (!p || typeof p !== 'string' || p.includes('\0')) {
      throw new Error('Invalid file path for file:writeText')
    }
    if (typeof content !== 'string') {
      throw new Error('Content must be a string for file:writeText')
    }
    try {
      await writeFile(p, content, 'utf-8')
    } catch (e) {
      throw new Error(`Failed to write file "${p}": ${e instanceof Error ? e.message : String(e)}`)
    }
  })

  // ── First-launch project wizard ──────────────────────────────────────
  // `samples:list` -- which wizard machine IDs currently have a bundled
  // starter STL under `resources/samples/<machineId>/`. Drives the
  // disabled state of the wizard's Step 3 "Sample STL" option.
  ipcMain.handle('samples:list', async () => {
    const resourcesRoot = getResourcesRoot()
    const samplesRoot = join(resourcesRoot, 'samples')
    const availableMachineIds: WizardStarterMachineId[] = []
    for (const [machineId, sampleFile] of Object.entries(
      WIZARD_MACHINE_TO_SAMPLE_FILE
    )) {
      const samplePath = join(samplesRoot, machineId, sampleFile)
      try {
        await access(samplePath, fsConstants.R_OK)
        availableMachineIds.push(machineId as WizardStarterMachineId)
      } catch {
        // Sample missing -- not an error; the wizard disables the option.
      }
    }
    return { availableMachineIds }
  })

  // `wizard:copySample` -- copies the bundled sample STL for a given
  // wizard machine ID into `<projectDir>/assets/`. Returns the relative
  // POSIX path so the renderer can stage it as a starter mesh. Refuses
  // missing samples and missing project directories. Path-traversal-safe
  // because both inputs are validated before any filesystem touch.
  ipcMain.handle('wizard:copySample', async (_e, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid wizard:copySample payload' }
    }
    const { projectDir, machineId } = payload as {
      projectDir?: unknown
      machineId?: unknown
    }
    if (
      typeof projectDir !== 'string' ||
      projectDir.length === 0 ||
      projectDir.includes('\0')
    ) {
      return { ok: false as const, error: 'Invalid projectDir' }
    }
    if (
      typeof machineId !== 'string' ||
      !(machineId in WIZARD_MACHINE_TO_SAMPLE_FILE)
    ) {
      return { ok: false as const, error: 'Unknown wizard machine id' }
    }
    const sampleFile = WIZARD_MACHINE_TO_SAMPLE_FILE[machineId as WizardStarterMachineId]
    const sourcePath = join(getResourcesRoot(), 'samples', machineId, sampleFile)
    try {
      await access(sourcePath, fsConstants.R_OK)
    } catch {
      return {
        ok: false as const,
        error: `Sample bundle not found for ${machineId}.`
      }
    }
    const assetsDir = join(projectDir, 'assets')
    try {
      await mkdir(assetsDir, { recursive: true })
    } catch (e) {
      return {
        ok: false as const,
        error: `Failed to create project assets directory: ${
          e instanceof Error ? e.message : String(e)
        }`
      }
    }
    const destPath = join(assetsDir, basename(sampleFile))
    try {
      await copyFile(sourcePath, destPath)
    } catch (e) {
      return {
        ok: false as const,
        error: `Failed to copy sample: ${
          e instanceof Error ? e.message : String(e)
        }`
      }
    }
    return {
      ok: true as const,
      assetRelativePath: `assets/${basename(sampleFile)}`
    }
  })

  // `wizard:readCadSample` -- read the bundled CadQuery starter script
  // for a given machine id (UNIFY 2 first-launch wizard 4th option).
  // The script text is staged into `project.designModels[0].scriptText`
  // by the renderer after `project:create` succeeds, so the user lands
  // in the Design workspace with a parametric body already authored.
  // Read-only: never touches the project directory or any G-code path.
  ipcMain.handle('wizard:readCadSample', async (_e, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid wizard:readCadSample payload' }
    }
    const { machineId } = payload as { machineId?: unknown }
    if (
      typeof machineId !== 'string' ||
      !(machineId in WIZARD_MACHINE_TO_CAD_SAMPLE)
    ) {
      return { ok: false as const, error: 'Unknown wizard machine id' }
    }
    const entry = WIZARD_MACHINE_TO_CAD_SAMPLE[machineId as WizardStarterMachineId]
    const sourcePath = join(getResourcesRoot(), 'samples', 'cad', entry.fileName)
    try {
      await access(sourcePath, fsConstants.R_OK)
    } catch {
      return {
        ok: false as const,
        error: `CadQuery sample not found for ${machineId}.`
      }
    }
    try {
      const scriptText = await readFile(sourcePath, 'utf-8')
      return {
        ok: true as const,
        designName: entry.designName,
        fileName: entry.fileName,
        scriptText
      }
    } catch (e) {
      return {
        ok: false as const,
        error: `Failed to read CadQuery sample: ${
          e instanceof Error ? e.message : String(e)
        }`
      }
    }
  })

  // `font:read` -- stream a BUNDLED font (resources/fonts/*.ttf) to the renderer
  // as base64 for the Text -> machinable-vectors engine. Read-only, exactly like
  // `wizard:readCadSample`: the request carries a fixed font id (never a path),
  // so the handler maps it to a known filename under getResourcesRoot()/fonts and
  // can't be coerced into traversing the filesystem. Never touches a project dir
  // or any G-code path.
  ipcMain.handle('font:read', async (_e, payload: unknown) => {
    if (!payload || typeof payload !== 'object') {
      return { ok: false as const, error: 'Invalid font:read payload' }
    }
    const { fontId } = payload as { fontId?: unknown }
    if (!isBundledFontId(fontId)) {
      return { ok: false as const, error: 'Unknown bundled font id' }
    }
    const id: BundledFontId = fontId
    const sourcePath = join(getResourcesRoot(), 'fonts', BUNDLED_FONT_FILE[id])
    try {
      await access(sourcePath, fsConstants.R_OK)
    } catch {
      return { ok: false as const, error: `Bundled font not found: ${BUNDLED_FONT_FILE[id]}` }
    }
    try {
      const buf = await readFile(sourcePath)
      return { ok: true as const, fontId: id, base64: buf.toString('base64') }
    } catch (e) {
      return {
        ok: false as const,
        error: `Failed to read bundled font: ${e instanceof Error ? e.message : String(e)}`
      }
    }
  })
}
