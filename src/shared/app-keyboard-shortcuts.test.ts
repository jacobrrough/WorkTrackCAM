import { describe, expect, it } from 'vitest'
import {
  APP_KEYBOARD_SHORTCUT_GROUPS,
  commandPaletteShortcutLabel,
  isTypableKeyboardTarget,
  matchesCommandPaletteToggle,
  matchesGenerate,
  matchesKeyboardShortcutsReference,
  matchesOpenProject,
  matchesRedo,
  matchesSaveProject,
  matchesUndo
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

  it('matchesUndo — Ctrl+Z and Cmd+Z, rejects Shift/Alt and other keys', () => {
    const mk = (overrides: Partial<KeyboardEvent>) =>
      ({
        key: 'z',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        ...overrides
      }) as KeyboardEvent
    expect(matchesUndo(mk({ ctrlKey: true }))).toBe(true)
    expect(matchesUndo(mk({ metaKey: true }))).toBe(true)
    expect(matchesUndo(mk({ ctrlKey: true, key: 'Z' }))).toBe(true)
    // Ctrl+Shift+Z is the redo binding, NOT undo.
    expect(matchesUndo(mk({ ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matchesUndo(mk({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(matchesUndo(mk({ key: 'z' }))).toBe(false) // bare z
    expect(matchesUndo(mk({ ctrlKey: true, key: 'y' }))).toBe(false) // redo key
  })

  it('matchesRedo — Ctrl+Y, Cmd+Y, Ctrl+Shift+Z, Cmd+Shift+Z; rejects Ctrl+Z and Alt', () => {
    const mk = (overrides: Partial<KeyboardEvent>) =>
      ({
        key: 'y',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        ...overrides
      }) as KeyboardEvent
    expect(matchesRedo(mk({ ctrlKey: true }))).toBe(true)
    expect(matchesRedo(mk({ metaKey: true }))).toBe(true)
    expect(matchesRedo(mk({ ctrlKey: true, shiftKey: true, key: 'z' }))).toBe(true)
    expect(matchesRedo(mk({ metaKey: true, shiftKey: true, key: 'Z' }))).toBe(true)
    // bare Ctrl+Z is undo, not redo
    expect(matchesRedo(mk({ ctrlKey: true, key: 'z' }))).toBe(false)
    expect(matchesRedo(mk({ ctrlKey: true, altKey: true }))).toBe(false)
    expect(matchesRedo(mk({ key: 'y' }))).toBe(false) // bare y
    expect(matchesRedo(mk({ ctrlKey: true, shiftKey: true, key: 'y' }))).toBe(false)
  })

  it('global group includes Undo and Redo entries', () => {
    const globalGroup = APP_KEYBOARD_SHORTCUT_GROUPS.find(g => g.id === 'global')
    expect(globalGroup).toBeDefined()
    const actions = globalGroup!.rows.map(r => r.action)
    expect(actions.some(a => /undo/i.test(a))).toBe(true)
    expect(actions.some(a => /redo/i.test(a))).toBe(true)
    const undoRow = globalGroup!.rows.find(r => /undo/i.test(r.action))
    const redoRow = globalGroup!.rows.find(r => /redo/i.test(r.action))
    expect(undoRow!.keysWin).toContain('Ctrl+Z')
    expect(redoRow!.keysWin).toContain('Ctrl+Y')
    expect(redoRow!.keysWin).toContain('Ctrl+Shift+Z')
  })

  it('navrail group lists the LIVE WorkspaceNav rail (FG-7), not the retired ShopApp labels', () => {
    const navrail = APP_KEYBOARD_SHORTCUT_GROUPS.find(g => g.id === 'navrail')
    expect(navrail).toBeDefined()
    const actions = navrail!.rows.map(r => r.action)
    // Live rail labels, in nav order (1–6), matching WorkspaceNav / the FG-1 engine.
    expect(actions.slice(0, 6)).toEqual(['Design', 'Assemble', 'Make', 'Drawings', 'Workshop', 'Utilities'])
    // 1–6 are bound to those six rows.
    expect(navrail!.rows.slice(0, 6).map(r => r.keysWin)).toEqual(['1', '2', '3', '4', '5', '6'])
    // Retired ShopApp labels must be gone.
    for (const stale of ['Jobs', 'Tools', 'My Shop', 'Library', 'Settings']) {
      expect(actions).not.toContain(stale)
    }
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
