import { app, ipcMain } from 'electron'
import type { MainIpcWindowContext } from './ipc-context'
import {
  deleteDesignScriptRecoverySnapshot,
  loadDesignScriptFromProject,
  readDesignScriptRecoverySnapshot,
  saveDesignScriptToProject,
  writeDesignScriptRecoverySnapshot
} from './design-script-store'

/**
 * CADQUERY SCRIPT PERSISTENCE IPC namespace (`designScript:*`).
 *
 * Thin dispatch onto `design-script-store` with `app.getPath('userData')`
 * injected for the recovery channels — all validation (path containment,
 * size caps, snapshot schema) lives in the store. Registered in
 * `src/main/index.ts` inside `app.whenReady()` BEFORE `createWindow()` next
 * to the other register*Ipc calls (the IPC ordering invariant), so a
 * cold-start renderer can never hit "No handler registered".
 *
 * Clean-save semantics: a SUCCESSFUL `designScript:save` also deletes the
 * project's write-ahead script snapshot main-side (the renderer's
 * `runScriptSave` writes the snapshot BEFORE attempting the save), so the
 * snapshot only survives when the save failed or never completed — exactly
 * the states worth offering a restore for.
 *
 * Handlers never throw: every failure path returns a structured envelope so
 * the renderer treats persistence as best-effort and degrades to an honest
 * toast. SAFETY: script text only — no G-code is read or written here.
 */
export function registerDesignScriptIpc(_ctx: MainIpcWindowContext): void {
  ipcMain.handle('designScript:save', async (_e, projectDir: unknown, scriptText: unknown) => {
    if (
      typeof projectDir !== 'string' ||
      projectDir.length === 0 ||
      typeof scriptText !== 'string'
    ) {
      return { ok: false as const, reason: 'invalid' as const }
    }
    const result = await saveDesignScriptToProject(projectDir, scriptText)
    if (result.ok) {
      await deleteDesignScriptRecoverySnapshot(app.getPath('userData'), projectDir)
    }
    return result
  })

  ipcMain.handle('designScript:load', async (_e, projectDir: unknown) => {
    if (typeof projectDir !== 'string' || projectDir.length === 0) {
      return { ok: false as const, reason: 'none' as const }
    }
    return loadDesignScriptFromProject(projectDir)
  })

  ipcMain.handle('designScript:recoveryWrite', async (_e, snapshotJson: unknown) => {
    if (typeof snapshotJson !== 'string') {
      return { ok: false as const, reason: 'invalid' as const }
    }
    return writeDesignScriptRecoverySnapshot(app.getPath('userData'), snapshotJson)
  })

  ipcMain.handle('designScript:recoveryRead', async (_e, projectDir: unknown) => {
    if (typeof projectDir !== 'string' || projectDir.length === 0) {
      return { ok: false as const, reason: 'none' as const }
    }
    return readDesignScriptRecoverySnapshot(app.getPath('userData'), projectDir)
  })

  ipcMain.handle('designScript:recoveryDelete', async (_e, projectDir: unknown) => {
    if (typeof projectDir !== 'string' || projectDir.length === 0) return
    await deleteDesignScriptRecoverySnapshot(app.getPath('userData'), projectDir)
  })
}
