/**
 * Auto-update lifecycle for WorkTrackCAM.
 *
 * Uses electron-updater to check for updates from GitHub Releases (or a
 * configured update server). The module is safe to import in any environment
 * -- when running in dev or when no publish config is present, the update
 * check is silently skipped.
 *
 * Update server URL resolution order:
 *   1. `WORKTRACK_UPDATE_URL` environment variable
 *   2. `appSettings.updateServerUrl` from the settings store
 *   3. Default GitHub Releases feed (electron-updater default)
 *
 * Call `initAutoUpdater()` once from the main process after the window is
 * ready. It registers IPC handlers so the renderer can query update status.
 */
import { ipcMain, type BrowserWindow } from 'electron'
import type { UpdateCheckResult, UpdateInfo } from 'electron-updater'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

let currentStatus: UpdateStatus = { state: 'idle' }

function setStatus(status: UpdateStatus): void {
  currentStatus = status
}

/**
 * Resolve the update server URL from environment or settings.
 * Returns `undefined` when the default GitHub Releases feed should be used.
 */
export function resolveUpdateServerUrl(settingsUrl?: string): string | undefined {
  const envUrl = process.env['WORKTRACK_UPDATE_URL']
  if (envUrl && envUrl.trim().length > 0) return envUrl.trim()
  if (settingsUrl && settingsUrl.trim().length > 0) return settingsUrl.trim()
  return undefined
}

/**
 * Initialize the auto-updater. Registers IPC handlers and kicks off an
 * initial update check.
 *
 * This function intentionally catches all errors so a misconfigured or
 * unavailable update feed never crashes the app.
 *
 * @param getMainWindow  Returns the current main BrowserWindow (or null).
 * @param settingsUpdateUrl  Optional custom update server URL from app settings.
 */
export async function initAutoUpdater(
  getMainWindow: () => BrowserWindow | null,
  settingsUpdateUrl?: string
): Promise<void> {
  // Register IPC before any async work so the renderer can query immediately
  ipcMain.handle('updater:status', () => currentStatus)
  ipcMain.handle('updater:checkNow', async () => {
    await safeCheckForUpdates(settingsUpdateUrl)
    return currentStatus
  })
  ipcMain.handle('updater:quitAndInstall', () => {
    try {
      // Dynamic import to avoid loading electron-updater when not needed
      import('electron-updater').then(({ autoUpdater }) => {
        autoUpdater.quitAndInstall()
      }).catch(() => { /* ignore */ })
    } catch { /* ignore */ }
  })

  // Delay initial check to avoid slowing down startup
  setTimeout(() => {
    void safeCheckForUpdates(settingsUpdateUrl)
  }, 10_000)
}

/**
 * Manually check for updates. Can be called from anywhere in the main process
 * (e.g. a menu item or IPC handler triggered by the UI).
 *
 * Returns the resulting `UpdateStatus` after the check completes.
 */
export async function checkForUpdatesManual(settingsUpdateUrl?: string): Promise<UpdateStatus> {
  await safeCheckForUpdates(settingsUpdateUrl)
  return currentStatus
}

async function safeCheckForUpdates(settingsUpdateUrl?: string): Promise<void> {
  try {
    setStatus({ state: 'checking' })

    const { autoUpdater } = await import('electron-updater')

    // Configure: don't auto-download (let user decide), and log to console
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    // Apply custom update server URL when configured
    const customUrl = resolveUpdateServerUrl(settingsUpdateUrl)
    if (customUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: customUrl })
    }

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      setStatus({
        state: 'available',
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : undefined
      })
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      setStatus({ state: 'not-available', version: info.version })
    })

    autoUpdater.on('download-progress', (progress) => {
      setStatus({ state: 'downloading', percent: Math.round(progress.percent) })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      setStatus({ state: 'downloaded', version: info.version })
    })

    autoUpdater.on('error', (err: Error) => {
      // Don't surface "no published versions" or network errors as critical
      const msg = err.message || 'Unknown update error'
      console.warn('[WorkTrackCAM] Auto-update error (non-fatal):', msg)
      setStatus({ state: 'error', message: msg })
    })

    const result: UpdateCheckResult | null = await autoUpdater.checkForUpdates()
    if (!result) {
      setStatus({ state: 'idle' })
    }
  } catch (err: unknown) {
    // Expected in dev mode or when no publish config exists
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') ||
        msg.includes('No published versions') ||
        msg.includes('ENOENT') ||
        msg.includes('net::') ||
        msg.includes('HttpError')) {
      // Silently ignore expected failures (dev, offline, no releases)
      setStatus({ state: 'idle' })
    } else {
      console.warn('[WorkTrackCAM] Auto-update check failed (non-fatal):', msg)
      setStatus({ state: 'error', message: msg })
    }
  }
}
