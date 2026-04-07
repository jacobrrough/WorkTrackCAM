/** Persisted shell column widths (px). */

export const SHELL_BROWSER_WIDTH_KEY = 'ufs_shell_browser_px'
export const SHELL_PROPERTIES_WIDTH_KEY = 'ufs_shell_properties_px'

export const SHELL_BROWSER_DEFAULT = 260
export const SHELL_BROWSER_MIN = 180
export const SHELL_BROWSER_MAX = 420

export const SHELL_PROPERTIES_DEFAULT = 280
export const SHELL_PROPERTIES_MIN = 200
export const SHELL_PROPERTIES_MAX = 480

function clamp(n: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, n)))
}

function readKey(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null || raw === '') return fallback
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n)) return fallback
    return clamp(n, min, max)
  } catch {
    return fallback
  }
}

export function readShellBrowserWidth(): number {
  return readKey(SHELL_BROWSER_WIDTH_KEY, SHELL_BROWSER_DEFAULT, SHELL_BROWSER_MIN, SHELL_BROWSER_MAX)
}

export function readShellPropertiesWidth(): number {
  return readKey(
    SHELL_PROPERTIES_WIDTH_KEY,
    SHELL_PROPERTIES_DEFAULT,
    SHELL_PROPERTIES_MIN,
    SHELL_PROPERTIES_MAX
  )
}

export function writeShellBrowserWidth(px: number): void {
  try {
    localStorage.setItem(SHELL_BROWSER_WIDTH_KEY, String(clamp(px, SHELL_BROWSER_MIN, SHELL_BROWSER_MAX)))
  } catch {
    /* ignore */
  }
}

export function writeShellPropertiesWidth(px: number): void {
  try {
    localStorage.setItem(
      SHELL_PROPERTIES_WIDTH_KEY,
      String(clamp(px, SHELL_PROPERTIES_MIN, SHELL_PROPERTIES_MAX))
    )
  } catch {
    /* ignore */
  }
}
