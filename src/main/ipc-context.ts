import type { BrowserWindow } from 'electron'

export type MainIpcWindowContext = { getMainWindow: () => BrowserWindow | null }
