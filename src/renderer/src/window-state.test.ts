import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

/**
 * Provide a minimal localStorage shim for Node test environment.
 * The vitest default environment is Node, which lacks localStorage.
 */
const store: Record<string, string> = {}
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k] }),
  get length() { return Object.keys(store).length },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
}

// Install before importing the module under test
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true })

// Dynamic import to ensure localStorage is available when the module loads
const { loadWindowState, saveWindowState, WINDOW_STATE_KEY } = await import('./window-state')

describe('window-state persistence', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
    vi.clearAllMocks()
  })

  it('returns empty object when nothing is stored', () => {
    expect(loadWindowState()).toEqual({})
  })

  it('returns empty object when stored data is invalid JSON', () => {
    store[WINDOW_STATE_KEY] = 'not-json{{'
    expect(loadWindowState()).toEqual({})
  })

  it('returns empty object when stored data is a non-object primitive', () => {
    store[WINDOW_STATE_KEY] = '"just a string"'
    // "just a string" is valid JSON but not an object
    expect(loadWindowState()).toEqual({})
  })

  it('saves and loads view state', () => {
    saveWindowState({ view: 'library' })
    const state = loadWindowState()
    expect(state.view).toBe('library')
  })

  it('saves and loads logOpen state', () => {
    saveWindowState({ logOpen: true })
    const state = loadWindowState()
    expect(state.logOpen).toBe(true)
  })

  it('merges partial patches without losing other fields', () => {
    saveWindowState({ view: 'jobs', logOpen: false })
    saveWindowState({ logOpen: true })
    const state = loadWindowState()
    expect(state.view).toBe('jobs')
    expect(state.logOpen).toBe(true)
  })

  it('overwrites existing field values on patch', () => {
    saveWindowState({ view: 'jobs' })
    saveWindowState({ view: 'settings' })
    expect(loadWindowState().view).toBe('settings')
  })

  it('handles libTab field', () => {
    saveWindowState({ libTab: 'tools' })
    expect(loadWindowState().libTab).toBe('tools')
  })

  it('survives multiple sequential saves', () => {
    saveWindowState({ view: 'jobs' })
    saveWindowState({ logOpen: true })
    saveWindowState({ libTab: 'materials' })
    const state = loadWindowState()
    expect(state.view).toBe('jobs')
    expect(state.logOpen).toBe(true)
    expect(state.libTab).toBe('materials')
  })

  it('gracefully handles setItem throwing (quota exceeded)', () => {
    mockLocalStorage.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError')
    })
    // Should not throw
    expect(() => saveWindowState({ view: 'jobs' })).not.toThrow()
  })

  it('gracefully handles getItem throwing (security error)', () => {
    mockLocalStorage.getItem.mockImplementationOnce(() => {
      throw new Error('SecurityError')
    })
    expect(loadWindowState()).toEqual({})
  })
})
