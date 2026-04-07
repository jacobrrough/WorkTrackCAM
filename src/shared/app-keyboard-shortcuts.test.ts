import { describe, expect, it } from 'vitest'
import {
  APP_KEYBOARD_SHORTCUT_GROUPS,
  commandPaletteShortcutLabel,
  isTypableKeyboardTarget,
  matchesCommandPaletteToggle,
  matchesGenerate,
  matchesKeyboardShortcutsReference,
  matchesOpenProject,
  matchesSaveProject
} from './app-keyboard-shortcuts'

describe('app-keyboard-shortcuts', () => {
  it('defines non-empty groups', () => {
    expect(APP_KEYBOARD_SHORTCUT_GROUPS.length).toBeGreaterThanOrEqual(4)
    for (const g of APP_KEYBOARD_SHORTCUT_GROUPS) {
      expect(g.rows.length).toBeGreaterThan(0)
    }
  })

  it('matchesCommandPaletteToggle', () => {
    expect(matchesCommandPaletteToggle({ ctrlKey: true, shiftKey: false, altKey: false, key: 'k' } as KeyboardEvent)).toBe(
      true
    )
    expect(matchesCommandPaletteToggle({ metaKey: true, shiftKey: false, altKey: false, key: 'K' } as KeyboardEvent)).toBe(
      true
    )
    expect(matchesCommandPaletteToggle({ ctrlKey: true, shiftKey: true, altKey: false, key: 'k' } as KeyboardEvent)).toBe(
      false
    )
    expect(matchesCommandPaletteToggle({ ctrlKey: true, shiftKey: false, altKey: false, key: 'j' } as KeyboardEvent)).toBe(
      false
    )
  })

  it('matchesKeyboardShortcutsReference', () => {
    expect(
      matchesKeyboardShortcutsReference({ ctrlKey: true, shiftKey: true, altKey: false, key: '?' } as KeyboardEvent)
    ).toBe(true)
    expect(
      matchesKeyboardShortcutsReference({ metaKey: true, shiftKey: true, altKey: false, key: '?' } as KeyboardEvent)
    ).toBe(true)
    expect(
      matchesKeyboardShortcutsReference({ ctrlKey: true, shiftKey: false, altKey: false, key: '?' } as KeyboardEvent)
    ).toBe(false)
  })

  it('matchesOpenProject — Ctrl+O and Cmd+O, rejects Shift+O and Alt+O', () => {
    expect(matchesOpenProject({ ctrlKey: true, shiftKey: false, altKey: false, key: 'o' } as KeyboardEvent)).toBe(true)
    expect(matchesOpenProject({ ctrlKey: true, shiftKey: false, altKey: false, key: 'O' } as KeyboardEvent)).toBe(true)
    expect(matchesOpenProject({ metaKey: true, shiftKey: false, altKey: false, key: 'o' } as KeyboardEvent)).toBe(true)
    expect(matchesOpenProject({ ctrlKey: true, shiftKey: true, altKey: false, key: 'o' } as KeyboardEvent)).toBe(false)
    expect(matchesOpenProject({ ctrlKey: true, shiftKey: false, altKey: true, key: 'o' } as KeyboardEvent)).toBe(false)
    expect(matchesOpenProject({ ctrlKey: false, shiftKey: false, altKey: false, key: 'o' } as KeyboardEvent)).toBe(false)
    expect(matchesOpenProject({ ctrlKey: true, shiftKey: false, altKey: false, key: 'p' } as KeyboardEvent)).toBe(false)
  })

  it('matchesSaveProject — Ctrl+S and Cmd+S, rejects Shift+S', () => {
    expect(matchesSaveProject({ ctrlKey: true, shiftKey: false, altKey: false, key: 's' } as KeyboardEvent)).toBe(true)
    expect(matchesSaveProject({ ctrlKey: true, shiftKey: false, altKey: false, key: 'S' } as KeyboardEvent)).toBe(true)
    expect(matchesSaveProject({ metaKey: true, shiftKey: false, altKey: false, key: 's' } as KeyboardEvent)).toBe(true)
    expect(matchesSaveProject({ ctrlKey: true, shiftKey: true, altKey: false, key: 's' } as KeyboardEvent)).toBe(false)
    expect(matchesSaveProject({ ctrlKey: false, shiftKey: false, altKey: false, key: 's' } as KeyboardEvent)).toBe(false)
  })

  it('global group includes Ctrl+O and Ctrl+S entries', () => {
    const globalGroup = APP_KEYBOARD_SHORTCUT_GROUPS.find(g => g.id === 'global')
    expect(globalGroup).toBeDefined()
    const keys = globalGroup!.rows.map(r => r.keysWin)
    expect(keys).toContain('Ctrl+O')
    expect(keys).toContain('Ctrl+S')
  })

  it('global group includes F5/Ctrl+Enter generate entry', () => {
    const globalGroup = APP_KEYBOARD_SHORTCUT_GROUPS.find(g => g.id === 'global')
    expect(globalGroup).toBeDefined()
    const entry = globalGroup!.rows.find(r => r.keysWin.includes('F5'))
    expect(entry).toBeDefined()
    expect(entry!.keysWin).toContain('Ctrl+Enter')
    expect(entry!.action).toMatch(/generate|slice/i)
  })

  it('matchesGenerate — F5 (no modifiers)', () => {
    const mk = (overrides: Partial<KeyboardEvent>) =>
      ({ key: 'F5', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides } as KeyboardEvent)
    expect(matchesGenerate(mk({}))).toBe(true)
    expect(matchesGenerate(mk({ ctrlKey: true }))).toBe(false)  // Ctrl+F5 is not the shortcut
    expect(matchesGenerate(mk({ shiftKey: true }))).toBe(false)
    expect(matchesGenerate(mk({ altKey: true }))).toBe(false)
  })

  it('matchesGenerate — Ctrl+Enter and Cmd+Enter', () => {
    const mk = (overrides: Partial<KeyboardEvent>) =>
      ({ key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...overrides } as KeyboardEvent)
    expect(matchesGenerate(mk({ ctrlKey: true }))).toBe(true)
    expect(matchesGenerate(mk({ metaKey: true }))).toBe(true)
    expect(matchesGenerate(mk({ ctrlKey: true, shiftKey: true }))).toBe(false)  // Ctrl+Shift+Enter not matched
    expect(matchesGenerate(mk({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(matchesGenerate(mk({}))).toBe(false)  // bare Enter not matched
  })

  it('matchesGenerate — unrelated keys return false', () => {
    const mk = (key: string, ctrl = false) =>
      ({ key, ctrlKey: ctrl, metaKey: false, shiftKey: false, altKey: false } as KeyboardEvent)
    expect(matchesGenerate(mk('g', true))).toBe(false)
    expect(matchesGenerate(mk('F4'))).toBe(false)
    expect(matchesGenerate(mk('F6'))).toBe(false)
    expect(matchesGenerate(mk(' ', true))).toBe(false)
  })

  it('isTypableKeyboardTarget rejects non-elements', () => {
    expect(isTypableKeyboardTarget(null)).toBe(false)
    expect(isTypableKeyboardTarget({} as EventTarget)).toBe(false)
  })

  it('commandPaletteShortcutLabel matches platform copy', () => {
    const s = commandPaletteShortcutLabel()
    expect(s === 'Ctrl+K' || s === '⌘K').toBe(true)
  })
})
