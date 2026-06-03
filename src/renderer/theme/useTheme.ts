import { useEffect } from 'react'
import { DEFAULT_THEME, isThemeId, type ThemeId } from './theme-registry'

/**
 * Resolve a persisted `theme` setting to a concrete ThemeId.
 *
 * Accepts the 10 theme ids directly; maps the legacy `'dark'` / `'light'`
 * values and `'system'` (OS preference) onto concrete themes; and falls back
 * to the default brand theme for anything unknown or absent. Pure — safe to
 * call in render and in tests.
 */
export function resolveTheme(setting: unknown): ThemeId {
  if (isThemeId(setting)) return setting
  if (setting === 'light') return 'precision'
  if (setting === 'system') {
    const prefersLight =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: light)').matches
    return prefersLight ? 'precision' : DEFAULT_THEME
  }
  // legacy 'dark', undefined, null, or any unrecognized value -> default brand theme
  return DEFAULT_THEME
}

/**
 * Imperatively apply a theme setting to `<html data-theme>` right now and return
 * the resolved id. Use for one-shot application (e.g. instant preview when the
 * Settings picker changes); use {@link useTheme} for declarative React wiring.
 */
export function applyTheme(setting: unknown): ThemeId {
  const resolved = resolveTheme(setting)
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved
  }
  return resolved
}

/**
 * Apply the resolved theme to `<html data-theme>`, re-applying when the setting
 * changes and (for `'system'`) when the OS color-scheme flips. Returns the
 * resolved ThemeId. The `:root` block in themes.css already defaults to the
 * brand theme, so there is no unstyled flash before this runs.
 */
export function useTheme(setting: unknown): ThemeId {
  const resolved = resolveTheme(setting)

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = resolved
    }
  }, [resolved])

  useEffect(() => {
    if (setting !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => {
      document.documentElement.dataset.theme = resolveTheme('system')
    }
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [setting])

  return resolved
}
