import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  registerShortcut,
  unregisterShortcut,
  getShortcutMap,
  matchRegisteredShortcut,
  tooltipWithShortcut,
  shortcutHint,
} from './keyboard-shortcuts'

/** Helper to create a minimal KeyboardEvent-like object. */
function mkEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: '',
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...overrides,
  } as KeyboardEvent
}

describe('keyboard-shortcuts registry', () => {
  // Clean up between tests so each starts with a fresh registry
  beforeEach(() => {
    for (const combo of [...getShortcutMap().keys()]) {
      unregisterShortcut(combo)
    }
  })
  afterEach(() => {
    for (const combo of [...getShortcutMap().keys()]) {
      unregisterShortcut(combo)
    }
  })

  describe('registerShortcut / unregisterShortcut', () => {
    it('registers a shortcut and retrieves it from the map', () => {
      registerShortcut('Ctrl+N', () => {}, 'New file')
      expect(getShortcutMap().has('Ctrl+N')).toBe(true)
      expect(getShortcutMap().get('Ctrl+N')!.description).toBe('New file')
    })

    it('unregisters a shortcut', () => {
      registerShortcut('Ctrl+N', () => {}, 'New file')
      unregisterShortcut('Ctrl+N')
      expect(getShortcutMap().has('Ctrl+N')).toBe(false)
    })

    it('unregister of non-existent combo is a no-op', () => {
      expect(() => unregisterShortcut('Ctrl+Z')).not.toThrow()
    })

    it('overwrites duplicate combos', () => {
      registerShortcut('Ctrl+N', () => {}, 'First')
      registerShortcut('Ctrl+N', () => {}, 'Second')
      expect(getShortcutMap().get('Ctrl+N')!.description).toBe('Second')
    })
  })

  describe('matchRegisteredShortcut', () => {
    it('matches Ctrl+N (ctrlKey)', () => {
      const fn = (): void => {}
      registerShortcut('Ctrl+N', fn, 'New')
      const result = matchRegisteredShortcut(mkEvent({ key: 'n', ctrlKey: true }))
      expect(result).not.toBeNull()
      expect(result!.description).toBe('New')
    })

    it('matches Ctrl+N (metaKey for macOS)', () => {
      registerShortcut('Ctrl+N', () => {}, 'New')
      const result = matchRegisteredShortcut(mkEvent({ key: 'n', metaKey: true }))
      expect(result).not.toBeNull()
    })

    it('does NOT match when extra modifiers are present', () => {
      registerShortcut('Ctrl+N', () => {}, 'New')
      expect(matchRegisteredShortcut(mkEvent({ key: 'n', ctrlKey: true, shiftKey: true }))).toBeNull()
      expect(matchRegisteredShortcut(mkEvent({ key: 'n', ctrlKey: true, altKey: true }))).toBeNull()
    })

    it('does NOT match plain key when Ctrl is required', () => {
      registerShortcut('Ctrl+N', () => {}, 'New')
      expect(matchRegisteredShortcut(mkEvent({ key: 'n' }))).toBeNull()
    })

    it('matches Ctrl+Shift+? (compound modifier)', () => {
      registerShortcut('Ctrl+Shift+?', () => {}, 'Shortcuts')
      const result = matchRegisteredShortcut(mkEvent({ key: '?', ctrlKey: true, shiftKey: true }))
      expect(result).not.toBeNull()
    })

    it('matches F5 (no modifiers)', () => {
      registerShortcut('F5', () => {}, 'Generate')
      expect(matchRegisteredShortcut(mkEvent({ key: 'F5' }))).not.toBeNull()
      // With Ctrl held → no match (F5 alone is registered)
      expect(matchRegisteredShortcut(mkEvent({ key: 'F5', ctrlKey: true }))).toBeNull()
    })

    it('matches Delete (no modifiers)', () => {
      registerShortcut('Delete', () => {}, 'Delete op')
      expect(matchRegisteredShortcut(mkEvent({ key: 'Delete' }))).not.toBeNull()
    })

    it('matches Escape (no modifiers)', () => {
      registerShortcut('Escape', () => {}, 'Close')
      expect(matchRegisteredShortcut(mkEvent({ key: 'Escape' }))).not.toBeNull()
    })

    it('handles "or" alternatives (e.g. "F5 or Ctrl+Enter")', () => {
      registerShortcut('F5 or Ctrl+Enter', () => {}, 'Generate')
      expect(matchRegisteredShortcut(mkEvent({ key: 'F5' }))).not.toBeNull()
      expect(matchRegisteredShortcut(mkEvent({ key: 'Enter', ctrlKey: true }))).not.toBeNull()
      expect(matchRegisteredShortcut(mkEvent({ key: 'Enter' }))).toBeNull()
    })

    it('returns null when nothing is registered', () => {
      expect(matchRegisteredShortcut(mkEvent({ key: 'a', ctrlKey: true }))).toBeNull()
    })
  })

  describe('tooltipWithShortcut', () => {
    it('appends the combo in parentheses', () => {
      expect(tooltipWithShortcut('Generate', 'F5')).toBe('Generate (F5)')
      expect(tooltipWithShortcut('Save', 'Ctrl+S')).toBe('Save (Ctrl+S)')
    })
  })

  describe('shortcutHint', () => {
    it('returns the combo wrapped in parens when registered', () => {
      registerShortcut('Ctrl+S', () => {}, 'Save')
      expect(shortcutHint('Ctrl+S')).toBe('(Ctrl+S)')
    })

    it('returns empty string when not registered', () => {
      expect(shortcutHint('Ctrl+Z')).toBe('')
    })
  })
})
