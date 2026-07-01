import { app, ipcMain } from 'electron'
import type { MainIpcWindowContext } from './ipc-context'
import {
  deleteDesignRecoverySnapshot,
  readDesignRecoverySnapshot,
  writeDesignRecoverySnapshot
} from './design-recovery-store'

/**
 * AUTOSAVE + CRASH RECOVERY IPC namespace (`recovery:*`).
 *
 * Thin dispatch onto `design-recovery-store` with `app.getPath('userData')`
 * injected - all validation (schema on write AND read) lives in the store.
 * Registered in `src/main/index.ts` inside `app.whenReady()` BEFORE
 * `createWindow()` next to the other register*Ipc calls (the IPC ordering
 * invariant), so a cold-start renderer can never hit "No handler registered".
 *
 * Handlers never throw: every failure path returns a structured envelope
 * (write -> { ok:false, reason }, read -> { ok:false, reason }) so the
 * renderer treats recovery as best-effort and degrades silently.
 */
export function registerRecoveryIpc(_ctx: MainIpcWindowContext): void {
  ipcMain.handle('recovery:designWrite', async (_e, snapshotJson: unknown) => {
    if (typeof snapshotJson !== 'string') {
      return { ok: false as const, reason: 'invalid' as const }
    }
    return writeDesignRecoverySnapshot(app.getPath('userData'), snapshotJson)
  })

  ipcMain.handle('recovery:designRead', async (_e, projectDir: unknown) => {
    if (typeof projectDir !== 'string' || projectDir.length === 0) {
      return { ok: false as const, reason: 'none' as const }
    }
    return readDesignRecoverySnapshot(app.getPath('userData'), projectDir)
  })

  ipcMain.handle('recovery:designDelete', async (_e, projectDir: unknown) => {
    if (typeof projectDir !== 'string' || projectDir.length === 0) return
    await deleteDesignRecoverySnapshot(app.getPath('userData'), projectDir)
  })
}
