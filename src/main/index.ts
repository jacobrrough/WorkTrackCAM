import { app, BrowserWindow, ipcMain, session } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerCoreIpc } from './ipc-core'
import { registerFabricationIpc } from './ipc-fabrication'
import { registerModelingIpc } from './ipc-modeling'
import { registerMainProcessDiagnostics } from './main-process-diagnostics'
import {
  checkPythonDeps,
  buildPythonDepsUserMessage,
  type PythonDepCheckOutcome
} from './python-dep-check'
import { initAutoUpdater } from './auto-updater'
import { loadSettings } from './settings-store'

registerMainProcessDiagnostics()

const __dirname = dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    icon: join(__dirname, '../../build/icons/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    },
    title: 'WorkTrackCAM'
  })

  // Block navigation to external URLs (prevents renderer XSS from escaping the app)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:' && !url.startsWith(process.env.ELECTRON_RENDERER_URL ?? '')) {
      event.preventDefault()
    }
  })

  // Block new window creation (prevents window.open exploits)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    if (process.env.NODE_ENV !== 'production') {
      mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/**
 * Cached Python dependency check outcome (populated once at startup).
 * Renderer can query this at any time via `pythonDeps:check`.
 */
let cachedDepCheck: PythonDepCheckOutcome | null = null

app.whenReady().then(async () => {
  // ── Content Security Policy ─────────────────────────────────────────
  // Restricts script, style, and connection sources to the app itself.
  // In dev mode, allow the Vite dev server origin; in production only
  // allow 'self' and inline styles (needed by Three.js canvas).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isDev = !!process.env.ELECTRON_RENDERER_URL
    const connectSrc = isDev ? "'self' ws: http://localhost:*" : "'self'"
    const scriptSrc = isDev ? "'self' 'unsafe-eval' 'unsafe-inline'" : "'self'"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src ${connectSrc}; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`
        ]
      }
    })
  })

  createWindow()

  const ipcCtx = { getMainWindow: () => mainWindow }
  registerCoreIpc(ipcCtx)
  registerFabricationIpc(ipcCtx)
  registerModelingIpc(ipcCtx)

  // ── IPC: Python dependency check (renderer pull) ─────────────────────
  ipcMain.handle('pythonDeps:check', async () => {
    if (cachedDepCheck) return cachedDepCheck
    const settings = await loadSettings()
    const pythonPath = settings.pythonPath?.trim() || 'python'
    cachedDepCheck = await checkPythonDeps(pythonPath)
    return cachedDepCheck
  })

  ipcMain.handle('pythonDeps:warning', async () => {
    if (!cachedDepCheck) {
      const settings = await loadSettings()
      const pythonPath = settings.pythonPath?.trim() || 'python'
      cachedDepCheck = await checkPythonDeps(pythonPath)
    }
    return buildPythonDepsUserMessage(cachedDepCheck)
  })

  // ── Auto-updater (non-blocking, safe in dev) ─────────────────────────
  void initAutoUpdater(() => mainWindow)

  // ── Fire-and-forget startup dep check ────────────────────────────────
  // Runs asynchronously so it doesn't block window creation. The result
  // is cached for the renderer to query via `pythonDeps:check`.
  void (async () => {
    try {
      const settings = await loadSettings()
      const pythonPath = settings.pythonPath?.trim() || 'python'
      cachedDepCheck = await checkPythonDeps(pythonPath)
      const warning = buildPythonDepsUserMessage(cachedDepCheck)
      if (warning) {
        console.warn('[WorkTrackCAM] Python dependency warning:', warning)
      }
    } catch (err) {
      console.error('[WorkTrackCAM] Failed to run startup dep check:', err)
    }
  })()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
