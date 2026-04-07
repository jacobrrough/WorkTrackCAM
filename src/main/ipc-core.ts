import { dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { getAppVersion } from './app-runtime'
import type { MainIpcWindowContext } from './ipc-context'
import { newProject, readProjectFile, writeProjectFile } from './project-store'
import { loadSettings, saveSettings } from './settings-store'
import { appSettingsSchema, projectSchema } from '../shared/project-schema'
import { isSafeExternalUrl } from './path-security'

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
      return r.filePaths[0]
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
}
