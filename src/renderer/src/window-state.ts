/**
 * Window state persistence — saves/restores panel sizes, splitter positions,
 * and workspace state to localStorage. Survives app restarts.
 */

export const WINDOW_STATE_KEY = 'fab-window-state-v1'

export interface CameraState {
  positionX?: number
  positionY?: number
  positionZ?: number
  targetX?: number
  targetY?: number
  targetZ?: number
  zoom?: number
}

export interface WindowState {
  view?: string
  logOpen?: boolean
  libTab?: string
  leftPanelWidth?: number
  rightPanelWidth?: number
  viewportCamera?: CameraState
}

/**
 * Load previously-saved window state from localStorage.
 * Returns an empty object if nothing is stored or data is corrupt.
 */
export function loadWindowState(): WindowState {
  try {
    const raw = localStorage.getItem(WINDOW_STATE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') return parsed as WindowState
    }
  } catch { /* ignore corrupt data */ }
  return {}
}

/**
 * Merge a partial patch into the persisted window state.
 * Reads the current state first so other fields are preserved.
 */
export function saveWindowState(patch: Partial<WindowState>): void {
  try {
    const prev = loadWindowState()
    localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify({ ...prev, ...patch }))
  } catch { /* quota exceeded — ignore */ }
}
