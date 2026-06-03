import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveTheme, applyTheme } from './useTheme'
import { THEMES, THEME_IDS, DEFAULT_THEME, isThemeId } from './theme-registry'

describe('theme-registry', () => {
  it('exposes exactly 10 themes, all valid ids, Titanium as default', () => {
    expect(THEME_IDS).toHaveLength(10)
    expect(THEMES).toHaveLength(10)
    expect(new Set(THEMES.map(t => t.id))).toEqual(new Set(THEME_IDS))
    expect(THEME_IDS).toContain(DEFAULT_THEME)
    expect(DEFAULT_THEME).toBe('titanium')
  })

  it('every theme has a label, mode, and blurb', () => {
    for (const t of THEMES) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.mode === 'dark' || t.mode === 'light').toBe(true)
      expect(t.blurb.length).toBeGreaterThan(0)
    }
  })

  it('isThemeId accepts the 10 ids and rejects legacy / unknown / non-strings', () => {
    expect(isThemeId('titanium')).toBe(true)
    expect(isThemeId('neon')).toBe(true)
    expect(isThemeId('dark')).toBe(false)
    expect(isThemeId('light')).toBe(false)
    expect(isThemeId('system')).toBe(false)
    expect(isThemeId('bogus')).toBe(false)
    expect(isThemeId(undefined)).toBe(false)
    expect(isThemeId(42)).toBe(false)
  })
})

describe('resolveTheme', () => {
  it('passes the 10 theme ids through unchanged', () => {
    for (const id of THEME_IDS) expect(resolveTheme(id)).toBe(id)
  })

  it('maps legacy dark -> titanium and light -> precision', () => {
    expect(resolveTheme('dark')).toBe('titanium')
    expect(resolveTheme('light')).toBe('precision')
  })

  it('falls back to the default theme for undefined / null / unknown values', () => {
    expect(resolveTheme(undefined)).toBe('titanium')
    expect(resolveTheme(null)).toBe('titanium')
    expect(resolveTheme('not-a-theme')).toBe('titanium')
    expect(resolveTheme(123)).toBe('titanium')
  })

  it('resolves system to one of the valid theme ids', () => {
    // Node env: no real matchMedia, so this falls back to the default; either way
    // the result must be a concrete theme the CSS knows about.
    expect(THEME_IDS as readonly string[]).toContain(resolveTheme('system'))
  })
})

describe('applyTheme', () => {
  // Repo vitest env is 'node' (no jsdom). Stub a minimal document and restore it
  // — the single-thread pool shares globals across files, so cleanup is required.
  const realDocument = (globalThis as { document?: unknown }).document

  beforeEach(() => {
    ;(globalThis as { document?: unknown }).document = {
      documentElement: { dataset: {} as Record<string, string> }
    }
  })

  afterEach(() => {
    if (realDocument === undefined) {
      delete (globalThis as { document?: unknown }).document
    } else {
      ;(globalThis as { document?: unknown }).document = realDocument
    }
  })

  it('writes the resolved id to <html data-theme> and returns it', () => {
    expect(applyTheme('neon')).toBe('neon')
    const doc = (globalThis as { document: { documentElement: { dataset: Record<string, string> } } }).document
    expect(doc.documentElement.dataset.theme).toBe('neon')
  })

  it('applies the mapped theme for a legacy value', () => {
    expect(applyTheme('dark')).toBe('titanium')
    const doc = (globalThis as { document: { documentElement: { dataset: Record<string, string> } } }).document
    expect(doc.documentElement.dataset.theme).toBe('titanium')
  })
})
