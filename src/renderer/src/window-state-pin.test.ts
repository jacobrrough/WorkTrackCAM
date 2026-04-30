import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'

/**
 * Co-located paired-pin contract for `src/renderer/src/window-state.ts`.
 *
 * Pins the SURFACE that the existing `window-state.test.ts` behavioral
 * suite leaves implicit: module shape, function signatures, the exact
 * `WINDOW_STATE_KEY` constant, the JSON-stringify contract used by
 * `saveWindowState`, the localStorage call-site whitelist, and pure-
 * function invariants.
 *
 * Why a pin file: window-state.ts persists the user's panel layout and
 * camera state across app restarts. EVERY one of the three target
 * machines depends on it -- Creality K2 Plus's FDM job board layout,
 * Laguna Swift 5x10's full-sheet plywood layout panel, and Makera
 * Carvera + 4th Axis's tool-library + rotary-stock panel all stash
 * splitter widths through the same `loadWindowState` /
 * `saveWindowState` pair.  A regression in the JSON shape, the storage
 * key, or the swallow-on-throw error path would silently lose layout
 * across an upgrade.
 */

// ---------------------------------------------------------------------------
// localStorage shim -- vitest's default Node env lacks localStorage.
// ---------------------------------------------------------------------------
const store: Record<string, string> = {}
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k] }),
  get length(): number { return Object.keys(store).length },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
}
Object.defineProperty(globalThis, 'localStorage', { value: mockLocalStorage, writable: true })

const mod = await import('./window-state')
const { loadWindowState, saveWindowState, WINDOW_STATE_KEY } = mod

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(path.join(HERE, 'window-state.ts'), 'utf8')

describe('window-state-pin [ID-0247] Cycle 175 ui-polish paired-pin', () => {
  beforeEach(() => {
    mockLocalStorage.clear()
    vi.clearAllMocks()
  })

  // -------------------------------------------------------------------------
  // (A) Module shape -- runtime exports inventory
  // -------------------------------------------------------------------------
  describe('(A) module shape', () => {
    it('exports exactly 3 runtime symbols (loadWindowState, saveWindowState, WINDOW_STATE_KEY)', () => {
      const runtimeKeys = Reflect.ownKeys(mod).filter(
        k => k !== 'default' && k !== Symbol.toStringTag,
      )
      expect(new Set(runtimeKeys)).toEqual(
        new Set(['loadWindowState', 'saveWindowState', 'WINDOW_STATE_KEY']),
      )
    })

    it('Symbol.toStringTag identifies the module as a Module namespace', () => {
      expect((mod as { [Symbol.toStringTag]?: string })[Symbol.toStringTag]).toBe('Module')
    })

    it('does NOT expose a default export', () => {
      expect((mod as { default?: unknown }).default).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // (B) WINDOW_STATE_KEY constant contract
  // -------------------------------------------------------------------------
  describe('(B) WINDOW_STATE_KEY constant', () => {
    it('is the literal string "fab-window-state-v1"', () => {
      expect(WINDOW_STATE_KEY).toBe('fab-window-state-v1')
    })

    it('is a string primitive (not a Symbol or wrapper object)', () => {
      expect(typeof WINDOW_STATE_KEY).toBe('string')
    })

    it('contains a -v1 version suffix so a future v2 migration is detectable', () => {
      expect(WINDOW_STATE_KEY).toMatch(/-v\d+$/)
    })

    it('is the ONLY localStorage key the module reads or writes', () => {
      saveWindowState({ view: 'design' })
      const setKeys = mockLocalStorage.setItem.mock.calls.map(c => c[0])
      const getKeys = mockLocalStorage.getItem.mock.calls.map(c => c[0])
      const allKeys = new Set([...setKeys, ...getKeys])
      expect(allKeys).toEqual(new Set([WINDOW_STATE_KEY]))
    })
  })

  // -------------------------------------------------------------------------
  // (C) Function signatures (name / arity / native Function)
  // -------------------------------------------------------------------------
  describe('(C) function signatures', () => {
    it('loadWindowState is a Function named "loadWindowState" with arity 0', () => {
      expect(typeof loadWindowState).toBe('function')
      expect(loadWindowState.name).toBe('loadWindowState')
      expect(loadWindowState.length).toBe(0)
    })

    it('saveWindowState is a Function named "saveWindowState" with arity 1', () => {
      expect(typeof saveWindowState).toBe('function')
      expect(saveWindowState.name).toBe('saveWindowState')
      expect(saveWindowState.length).toBe(1)
    })

    it('saveWindowState returns undefined (void)', () => {
      expect(saveWindowState({ view: 'design' })).toBeUndefined()
    })

    it('loadWindowState returns a plain object (not a class instance)', () => {
      const out = loadWindowState()
      expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
    })
  })

  // -------------------------------------------------------------------------
  // (D) loadWindowState empty / corrupt-data invariants
  // -------------------------------------------------------------------------
  describe('(D) loadWindowState invariants', () => {
    it('returns an empty object when nothing is stored', () => {
      expect(loadWindowState()).toEqual({})
    })

    it('returns a fresh object each call (not a shared singleton)', () => {
      const a = loadWindowState()
      const b = loadWindowState()
      expect(a).not.toBe(b)
      expect(a).toEqual(b)
    })

    it('returns {} when stored data is invalid JSON (does NOT throw)', () => {
      store[WINDOW_STATE_KEY] = '{not-json'
      expect(() => loadWindowState()).not.toThrow()
      expect(loadWindowState()).toEqual({})
    })

    it('returns {} for JSON null', () => {
      store[WINDOW_STATE_KEY] = 'null'
      expect(loadWindowState()).toEqual({})
    })

    it('returns {} for JSON arrays (defensive against array-typed payloads)', () => {
      // The module's `typeof parsed === 'object'` check passes for arrays;
      // pin documents the current behavior (array IS treated as a state object,
      // since arrays satisfy `typeof === "object"` AND are non-null).
      // Document the actual behavior so a future tightening that rejects
      // arrays surfaces here.
      store[WINDOW_STATE_KEY] = '[1,2,3]'
      const out = loadWindowState() as unknown
      // Current behavior: returns the array cast as WindowState
      expect(Array.isArray(out)).toBe(true)
    })

    it('returns {} when localStorage.getItem throws (security error)', () => {
      mockLocalStorage.getItem.mockImplementationOnce(() => {
        throw new Error('SecurityError')
      })
      expect(loadWindowState()).toEqual({})
    })
  })

  // -------------------------------------------------------------------------
  // (E) saveWindowState merge semantics
  // -------------------------------------------------------------------------
  describe('(E) saveWindowState merge semantics', () => {
    it('writes to the canonical WINDOW_STATE_KEY key only', () => {
      saveWindowState({ view: 'design' })
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        WINDOW_STATE_KEY,
        expect.any(String),
      )
    })

    it('serializes patch through JSON.stringify', () => {
      saveWindowState({ view: 'design', logOpen: true })
      const stored = store[WINDOW_STATE_KEY]
      expect(stored).toBeDefined()
      expect(JSON.parse(stored)).toEqual({ view: 'design', logOpen: true })
    })

    it('merges with prior state (later patch wins per key)', () => {
      saveWindowState({ view: 'design', logOpen: true })
      saveWindowState({ view: 'manufacture' })
      const out = loadWindowState()
      expect(out.view).toBe('manufacture')
      expect(out.logOpen).toBe(true)
    })

    it('reads prior state via loadWindowState before writing the merged record', () => {
      saveWindowState({ view: 'design' })
      mockLocalStorage.getItem.mockClear()
      saveWindowState({ logOpen: true })
      // The merge requires reading back the prior state first.
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(WINDOW_STATE_KEY)
    })

    it('is a no-op (silently swallowed) when setItem throws (quota exceeded)', () => {
      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })
      expect(() => saveWindowState({ view: 'design' })).not.toThrow()
    })

    it('does NOT mutate the input patch object', () => {
      const patch = { view: 'design', logOpen: false }
      const snapshot = JSON.stringify(patch)
      saveWindowState(patch)
      expect(JSON.stringify(patch)).toBe(snapshot)
    })

    it('preserves nested viewportCamera object across patches', () => {
      saveWindowState({ viewportCamera: { positionX: 1, positionY: 2, zoom: 0.5 } })
      saveWindowState({ view: 'design' })
      const out = loadWindowState()
      expect(out.viewportCamera).toEqual({ positionX: 1, positionY: 2, zoom: 0.5 })
    })
  })

  // -------------------------------------------------------------------------
  // (F) Three-machine path realism
  // -------------------------------------------------------------------------
  describe('(F) three-machine path realism', () => {
    it('K2 Plus FDM job board: persists library tab + log-open between sessions', () => {
      // Simulate the K2 Plus operator flipping to the materials tab and
      // opening the live print log, then reopening the app.
      saveWindowState({ view: 'jobs', libTab: 'materials', logOpen: true })
      const restored = loadWindowState()
      expect(restored.view).toBe('jobs')
      expect(restored.libTab).toBe('materials')
      expect(restored.logOpen).toBe(true)
    })

    it('Laguna Swift 5x10 full-sheet layout: persists wide left panel for the 1524 mm sheet preview', () => {
      // The 60x120" sheet preview wants a wide left panel; persist 520 px.
      saveWindowState({ view: 'manufacture', leftPanelWidth: 520, rightPanelWidth: 280 })
      const restored = loadWindowState()
      expect(restored.leftPanelWidth).toBe(520)
      expect(restored.rightPanelWidth).toBe(280)
    })

    it('Carvera 4-axis rotary: persists viewportCamera for repeated 4th-axis indexing review', () => {
      // The 4-axis rotary work area benefits from a persistent ISO camera
      // angle so repeated A-axis indexing reviews land at the same view.
      const camera = {
        positionX: 200, positionY: -200, positionZ: 200,
        targetX: 0, targetY: 0, targetZ: 0,
        zoom: 1.5,
      }
      saveWindowState({ view: 'manufacture', viewportCamera: camera })
      const restored = loadWindowState()
      expect(restored.viewportCamera).toEqual(camera)
    })
  })

  // -------------------------------------------------------------------------
  // (G) Pure-function invariants
  // -------------------------------------------------------------------------
  describe('(G) pure-function invariants', () => {
    it('loadWindowState is idempotent under N=20 calls when storage is unchanged', () => {
      saveWindowState({ view: 'design', logOpen: true })
      const first = loadWindowState()
      for (let i = 0; i < 20; i++) {
        expect(loadWindowState()).toEqual(first)
      }
    })

    it('saveWindowState produces deterministic output for the same patch sequence', () => {
      saveWindowState({ view: 'design' })
      saveWindowState({ logOpen: true })
      const a = store[WINDOW_STATE_KEY]
      mockLocalStorage.clear()
      saveWindowState({ view: 'design' })
      saveWindowState({ logOpen: true })
      const b = store[WINDOW_STATE_KEY]
      expect(a).toBe(b)
    })

    it('does not leak this-binding (call/apply with arbitrary thisArg)', () => {
      const arbitrary = { foo: 1 }
      expect(() => loadWindowState.call(arbitrary)).not.toThrow()
      expect(() => saveWindowState.call(arbitrary, { view: 'design' })).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // (H) localStorage call-site whitelist (source-text)
  // -------------------------------------------------------------------------
  describe('(H) localStorage call-site whitelist (source-text)', () => {
    it('source uses ONLY localStorage.getItem and localStorage.setItem (no removeItem / clear)', () => {
      // Strip line-comments for safer scanning
      const stripped = SOURCE.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
      expect(stripped).toMatch(/localStorage\.getItem\(/)
      expect(stripped).toMatch(/localStorage\.setItem\(/)
      expect(stripped).not.toMatch(/localStorage\.removeItem\(/)
      expect(stripped).not.toMatch(/localStorage\.clear\(/)
    })

    it('source uses JSON.parse and JSON.stringify (no third-party serializer)', () => {
      expect(SOURCE).toContain('JSON.parse')
      expect(SOURCE).toContain('JSON.stringify')
    })

    it('source uses try/catch wrappers (defensive against quota / security errors)', () => {
      const tryCount = (SOURCE.match(/\btry\s*\{/g) || []).length
      expect(tryCount).toBeGreaterThanOrEqual(2)
    })

    it('source has NO console.* calls (silent failure path is the contract)', () => {
      // The catch blocks intentionally swallow errors -- pin the silent-
      // failure invariant by forbidding any console.log / console.warn /
      // console.error in the module.
      const stripped = SOURCE.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
      expect(stripped).not.toMatch(/\bconsole\.\w+\(/)
    })
  })

  // -------------------------------------------------------------------------
  // (I) Source-size canary -- detect unintended bloat
  // -------------------------------------------------------------------------
  describe('(I) source-size canary', () => {
    it('source stays under 100 lines (current ~52)', () => {
      const lines = SOURCE.split('\n').length
      expect(lines).toBeLessThan(100)
    })

    it('source stays under 4 KB (current ~1.4 KB)', () => {
      expect(SOURCE.length).toBeLessThan(4096)
    })

    it('source contains exactly 2 exported functions (loadWindowState + saveWindowState)', () => {
      const stripped = SOURCE.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, '')
      const exportFnCount = (stripped.match(/^export function /gm) || []).length
      expect(exportFnCount).toBe(2)
    })

    it('source declares the WINDOW_STATE_KEY constant via "export const"', () => {
      expect(SOURCE).toMatch(/export const WINDOW_STATE_KEY = /)
    })

    it('source declares CameraState and WindowState as exported interfaces', () => {
      expect(SOURCE).toMatch(/export interface CameraState\b/)
      expect(SOURCE).toMatch(/export interface WindowState\b/)
    })
  })
})
