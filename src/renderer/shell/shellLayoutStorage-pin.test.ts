/**
 * shellLayoutStorage-pin.test.ts -- [ID-0233] Cycle 161 ui-polish paired-pin
 *
 * Pins the contract of `src/renderer/shell/shellLayoutStorage.ts` -- the
 * renderer-side localStorage-backed persistence helper for the Browser and
 * Properties column widths that frame the centre canvas in the WorkTrackCAM
 * shell. Sister cycles in the renderer pure-helper paired-pin chain:
 *   119 [ID-0196] derive-features
 *   124 [ID-0201] viewport3d-bounds
 *   129 [ID-0206] design-viewport-interaction
 *   130 [ID-0207] shop-stock-bounds
 *   131 [ID-0208] command-palette-memory  (closest sister: localStorage-backed)
 *   134 [ID-0210] brand-bar-machine-badge
 *   146 [ID-0220] my-shop-presets
 *   149 [ID-0225] useShellResizableColumns (ZERO-coverage shell hook; CONSUMES this module)
 *   151 [ID-0226] (renderer pure helper)
 *   156 [ID-0229] command-palette-search
 *
 * The module had ZERO test coverage of any kind before this cycle -- this pin
 * is its first-time vitest visibility AND its co-located source-text guard.
 * Surfaced during Cycle 161 ui-polish inventory of unpinned `src/renderer/`
 * helpers (60 lines, the smallest ZERO-coverage candidate in the renderer
 * tree at this cycle's snapshot).
 *
 * Cross-cuts ALL THREE TARGET MACHINES indirectly: the Browser + Properties
 * column-width persistence frames the centre canvas regardless of which
 * machine is selected in the My Shop quick-switch. The Cycle 149 [ID-0225]
 * pin already covered the consuming hook (`useShellResizableColumns.ts`);
 * THIS pin closes the contract on the storage-key strings and the clamp
 * bounds those resize handles ride against.
 *
 * Pin coverage:
 *   (A) module shape -- exact 12-runtime-symbol inventory + null prototype
 *       + Symbol.toStringTag-only invariant + no default + no Symbol leak;
 *   (B) localStorage-key constants pinned to their exact wire format
 *       ('ufs_shell_browser_px' / 'ufs_shell_properties_px') -- drift would
 *       silently abandon the operator's saved layout from a prior session;
 *   (C) numeric-bound constants pinned to the exact literals used by the
 *       Cycle 149 [ID-0225] resize hook (browser 260/180/420; properties
 *       280/200/480) -- drift would let the hook clamp inputs against
 *       different bounds than the storage round-trip;
 *   (D) readShellBrowserWidth contract -- empty-store fallback, valid
 *       value, under-min clamp, over-max clamp, NaN fallback, empty-string
 *       fallback, throwing-storage swallow, decimal Math.round behaviour;
 *   (E) readShellPropertiesWidth contract -- same matrix, independent
 *       constants;
 *   (F) writeShellBrowserWidth contract -- under-min clamp on write,
 *       over-max clamp on write, integer-cast (Math.round) on write,
 *       throwing-storage swallow;
 *   (G) writeShellPropertiesWidth contract -- same matrix, independent
 *       constants;
 *   (H) cross-helper independence + round-trip invariants -- each helper
 *       reads only its own key + a write/read cycle preserves the clamped
 *       integer + writes to one key never affect reads of the other;
 *   (I) source-text whitelist -- exact 4 const-string literals + 6 numeric
 *       bound literals + Math.round + Number.parseInt(..., 10) + radix=10
 *       + Number.isFinite + try/catch count == 3 (shared readKey + 2 writers) +
 *       no default export + no top-level let/var + no `:any` / `as any` /
 *       `<any>` + no electron / fs / path / child_process / dgram / net /
 *       tls / React / DOM / Three.js / Handlebars / G-code / M-code /
 *       foreign-machine vendor (Safety Rule 1 G-code-is-sacred) -- enforced
 *       via a codeOnly() comment-stripped + string-stripped negative regex.
 *
 * ZERO production-code edits this cycle (`shellLayoutStorage.ts` is
 * byte-identical pre/post). Pure paired-pin (mirrors the renderer pure-helper
 * convention from Cycles 119 / 124 / 129 / 130 / 131 / 134 / 146 / 149 / 151
 * / 156 / 160).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ---------------------------------------------------------------------------
// localStorage shim (the Node test environment lacks a window/localStorage)
// ---------------------------------------------------------------------------

interface MockStorageState {
  store: Record<string, string>
  throwOnGet: boolean
  throwOnSet: boolean
}

const state: MockStorageState = {
  store: {},
  throwOnGet: false,
  throwOnSet: false
}

const mockLocalStorage = {
  getItem: vi.fn((key: string): string | null => {
    if (state.throwOnGet) throw new Error('mock getItem failure')
    return key in state.store ? state.store[key]! : null
  }),
  setItem: vi.fn((key: string, value: string): void => {
    if (state.throwOnSet) throw new Error('mock setItem failure')
    state.store[key] = value
  }),
  removeItem: vi.fn((key: string): void => {
    delete state.store[key]
  }),
  clear: vi.fn((): void => {
    for (const k of Object.keys(state.store)) delete state.store[k]
  }),
  get length(): number {
    return Object.keys(state.store).length
  },
  key: vi.fn((i: number): string | null => Object.keys(state.store)[i] ?? null)
}

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true
})

// ---------------------------------------------------------------------------
// Module under test (imported AFTER localStorage shim is installed)
// ---------------------------------------------------------------------------

const M = await import('./shellLayoutStorage')
const {
  SHELL_BROWSER_WIDTH_KEY,
  SHELL_PROPERTIES_WIDTH_KEY,
  SHELL_BROWSER_DEFAULT,
  SHELL_BROWSER_MIN,
  SHELL_BROWSER_MAX,
  SHELL_PROPERTIES_DEFAULT,
  SHELL_PROPERTIES_MIN,
  SHELL_PROPERTIES_MAX,
  readShellBrowserWidth,
  readShellPropertiesWidth,
  writeShellBrowserWidth,
  writeShellPropertiesWidth
} = M

// ---------------------------------------------------------------------------
// Source-text helpers
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'shellLayoutStorage.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

/**
 * codeOnly() strips line-comments + block-comments + JSDoc + string literals
 * (single / double / template) so negative regexes can target only TS code
 * text (not commentary, not intentional string-constant content). Mirrors
 * the convention from sister pins (Cycles 137 / 142 / 147 / 160 / etc.).
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
}

beforeEach(() => {
  state.store = {}
  state.throwOnGet = false
  state.throwOnSet = false
  vi.clearAllMocks()
})

// ===========================================================================
// (A) Module shape -- exact named exports + namespace invariants
// ===========================================================================

describe('[ID-0233] shellLayoutStorage module shape', () => {
  it('exports exactly the documented 12-symbol set', () => {
    const runtimeKeys = Object.keys(M).filter((key) => key !== '__esModule')
    expect(runtimeKeys.sort()).toEqual(
      [
        'SHELL_BROWSER_DEFAULT',
        'SHELL_BROWSER_MAX',
        'SHELL_BROWSER_MIN',
        'SHELL_BROWSER_WIDTH_KEY',
        'SHELL_PROPERTIES_DEFAULT',
        'SHELL_PROPERTIES_MAX',
        'SHELL_PROPERTIES_MIN',
        'SHELL_PROPERTIES_WIDTH_KEY',
        'readShellBrowserWidth',
        'readShellPropertiesWidth',
        'writeShellBrowserWidth',
        'writeShellPropertiesWidth'
      ].sort()
    )
  })

  it('namespace prototype is null (ESM module-namespace invariant)', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('namespace exposes only string-keyed runtime members (no Symbol-key leak besides toStringTag)', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M).filter(
      (s) => s !== Symbol.toStringTag
    )
    expect(symbolKeys).toEqual([])
  })

  it('Symbol.toStringTag is "Module" when present', () => {
    const tag = (M as unknown as Record<symbol, unknown>)[Symbol.toStringTag]
    if (tag !== undefined) {
      expect(tag).toBe('Module')
    } else {
      expect(tag).toBeUndefined()
    }
  })

  it('has no default export', () => {
    expect((M as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('exports exactly 4 functions and 8 constants', () => {
    const keys = Object.keys(M).filter((k) => k !== '__esModule')
    const fns = keys.filter((k) => typeof (M as Record<string, unknown>)[k] === 'function')
    const consts = keys.filter(
      (k) => typeof (M as Record<string, unknown>)[k] !== 'function'
    )
    expect(fns.sort()).toEqual([
      'readShellBrowserWidth',
      'readShellPropertiesWidth',
      'writeShellBrowserWidth',
      'writeShellPropertiesWidth'
    ])
    expect(consts.length).toBe(8)
  })

  it('readShellBrowserWidth has arity 0', () => {
    expect(readShellBrowserWidth.length).toBe(0)
  })

  it('readShellPropertiesWidth has arity 0', () => {
    expect(readShellPropertiesWidth.length).toBe(0)
  })

  it('writeShellBrowserWidth has arity 1', () => {
    expect(writeShellBrowserWidth.length).toBe(1)
  })

  it('writeShellPropertiesWidth has arity 1', () => {
    expect(writeShellPropertiesWidth.length).toBe(1)
  })
})

// ===========================================================================
// (B) localStorage-key constants pinned to exact wire format
// ===========================================================================

describe('[ID-0233] shellLayoutStorage key constants', () => {
  it('SHELL_BROWSER_WIDTH_KEY is byte-equal to "ufs_shell_browser_px"', () => {
    expect(SHELL_BROWSER_WIDTH_KEY).toBe('ufs_shell_browser_px')
  })

  it('SHELL_PROPERTIES_WIDTH_KEY is byte-equal to "ufs_shell_properties_px"', () => {
    expect(SHELL_PROPERTIES_WIDTH_KEY).toBe('ufs_shell_properties_px')
  })

  it('keys carry the WorkTrackCAM "ufs_" prefix (cross-helper convention)', () => {
    expect(SHELL_BROWSER_WIDTH_KEY.startsWith('ufs_')).toBe(true)
    expect(SHELL_PROPERTIES_WIDTH_KEY.startsWith('ufs_')).toBe(true)
  })

  it('keys are pure ASCII identifiers (no whitespace, no separators)', () => {
    expect(/^[a-z0-9_]+$/.test(SHELL_BROWSER_WIDTH_KEY)).toBe(true)
    expect(/^[a-z0-9_]+$/.test(SHELL_PROPERTIES_WIDTH_KEY)).toBe(true)
  })

  it('keys are mutually distinct (no aliasing risk)', () => {
    expect(SHELL_BROWSER_WIDTH_KEY).not.toBe(SHELL_PROPERTIES_WIDTH_KEY)
  })

  it('keys end with the unit suffix "_px"', () => {
    expect(SHELL_BROWSER_WIDTH_KEY.endsWith('_px')).toBe(true)
    expect(SHELL_PROPERTIES_WIDTH_KEY.endsWith('_px')).toBe(true)
  })
})

// ===========================================================================
// (C) Numeric-bound constants pinned to the exact literals
// ===========================================================================

describe('[ID-0233] shellLayoutStorage numeric bounds', () => {
  it('SHELL_BROWSER_DEFAULT === 260', () => {
    expect(SHELL_BROWSER_DEFAULT).toBe(260)
  })

  it('SHELL_BROWSER_MIN === 180', () => {
    expect(SHELL_BROWSER_MIN).toBe(180)
  })

  it('SHELL_BROWSER_MAX === 420', () => {
    expect(SHELL_BROWSER_MAX).toBe(420)
  })

  it('SHELL_PROPERTIES_DEFAULT === 280', () => {
    expect(SHELL_PROPERTIES_DEFAULT).toBe(280)
  })

  it('SHELL_PROPERTIES_MIN === 200', () => {
    expect(SHELL_PROPERTIES_MIN).toBe(200)
  })

  it('SHELL_PROPERTIES_MAX === 480', () => {
    expect(SHELL_PROPERTIES_MAX).toBe(480)
  })

  it('browser MIN < DEFAULT < MAX (well-ordered)', () => {
    expect(SHELL_BROWSER_MIN).toBeLessThan(SHELL_BROWSER_DEFAULT)
    expect(SHELL_BROWSER_DEFAULT).toBeLessThan(SHELL_BROWSER_MAX)
  })

  it('properties MIN < DEFAULT < MAX (well-ordered)', () => {
    expect(SHELL_PROPERTIES_MIN).toBeLessThan(SHELL_PROPERTIES_DEFAULT)
    expect(SHELL_PROPERTIES_DEFAULT).toBeLessThan(SHELL_PROPERTIES_MAX)
  })

  it('all 6 numeric bounds are positive integers', () => {
    for (const n of [
      SHELL_BROWSER_DEFAULT,
      SHELL_BROWSER_MIN,
      SHELL_BROWSER_MAX,
      SHELL_PROPERTIES_DEFAULT,
      SHELL_PROPERTIES_MIN,
      SHELL_PROPERTIES_MAX
    ]) {
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThan(0)
    }
  })

  it('all 6 numeric bounds are finite (no Infinity / NaN)', () => {
    for (const n of [
      SHELL_BROWSER_DEFAULT,
      SHELL_BROWSER_MIN,
      SHELL_BROWSER_MAX,
      SHELL_PROPERTIES_DEFAULT,
      SHELL_PROPERTIES_MIN,
      SHELL_PROPERTIES_MAX
    ]) {
      expect(Number.isFinite(n)).toBe(true)
    }
  })

  it('browser bounds are a tight band around the default (clamp range >= 100 px)', () => {
    expect(SHELL_BROWSER_MAX - SHELL_BROWSER_MIN).toBeGreaterThanOrEqual(100)
  })

  it('properties bounds are a tight band around the default (clamp range >= 100 px)', () => {
    expect(SHELL_PROPERTIES_MAX - SHELL_PROPERTIES_MIN).toBeGreaterThanOrEqual(100)
  })
})

// ===========================================================================
// (D) readShellBrowserWidth contract
// ===========================================================================

describe('[ID-0233] readShellBrowserWidth contract', () => {
  it('returns SHELL_BROWSER_DEFAULT when localStorage is empty', () => {
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_DEFAULT)
  })

  it('returns SHELL_BROWSER_DEFAULT when the stored value is the empty string', () => {
    state.store[SHELL_BROWSER_WIDTH_KEY] = ''
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_DEFAULT)
  })

  it('returns SHELL_BROWSER_DEFAULT when the stored value is non-numeric junk', () => {
    state.store[SHELL_BROWSER_WIDTH_KEY] = 'banana'
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_DEFAULT)
  })

  it('returns the parsed value when the stored value is a valid integer in range', () => {
    state.store[SHELL_BROWSER_WIDTH_KEY] = '300'
    expect(readShellBrowserWidth()).toBe(300)
  })

  it('clamps to SHELL_BROWSER_MIN when the stored value is below the minimum', () => {
    state.store[SHELL_BROWSER_WIDTH_KEY] = '50'
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_MIN)
  })

  it('clamps to SHELL_BROWSER_MAX when the stored value is above the maximum', () => {
    state.store[SHELL_BROWSER_WIDTH_KEY] = '9999'
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_MAX)
  })

  it('clamps a strongly negative stored value to SHELL_BROWSER_MIN', () => {
    state.store[SHELL_BROWSER_WIDTH_KEY] = '-500'
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_MIN)
  })

  it('parseInt accepts a leading-decimal string by truncating before the dot', () => {
    // Number.parseInt('310.7', 10) === 310 -- decimal portion is dropped.
    state.store[SHELL_BROWSER_WIDTH_KEY] = '310.7'
    expect(readShellBrowserWidth()).toBe(310)
  })

  it('parseInt accepts a string with trailing non-digits by greedy-prefix match', () => {
    // Number.parseInt('310px', 10) === 310 -- trailing 'px' is dropped.
    state.store[SHELL_BROWSER_WIDTH_KEY] = '310px'
    expect(readShellBrowserWidth()).toBe(310)
  })

  it('returns the boundary value SHELL_BROWSER_MIN when stored exactly at the minimum', () => {
    state.store[SHELL_BROWSER_WIDTH_KEY] = String(SHELL_BROWSER_MIN)
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_MIN)
  })

  it('returns the boundary value SHELL_BROWSER_MAX when stored exactly at the maximum', () => {
    state.store[SHELL_BROWSER_WIDTH_KEY] = String(SHELL_BROWSER_MAX)
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_MAX)
  })

  it('swallows a throwing localStorage.getItem and returns SHELL_BROWSER_DEFAULT', () => {
    state.throwOnGet = true
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_DEFAULT)
  })

  it('returns a primitive number (not a Number object)', () => {
    expect(typeof readShellBrowserWidth()).toBe('number')
  })
})

// ===========================================================================
// (E) readShellPropertiesWidth contract
// ===========================================================================

describe('[ID-0233] readShellPropertiesWidth contract', () => {
  it('returns SHELL_PROPERTIES_DEFAULT when localStorage is empty', () => {
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_DEFAULT)
  })

  it('returns SHELL_PROPERTIES_DEFAULT when the stored value is the empty string', () => {
    state.store[SHELL_PROPERTIES_WIDTH_KEY] = ''
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_DEFAULT)
  })

  it('returns SHELL_PROPERTIES_DEFAULT when the stored value is non-numeric junk', () => {
    state.store[SHELL_PROPERTIES_WIDTH_KEY] = 'kumquat'
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_DEFAULT)
  })

  it('returns the parsed value when the stored value is a valid integer in range', () => {
    state.store[SHELL_PROPERTIES_WIDTH_KEY] = '350'
    expect(readShellPropertiesWidth()).toBe(350)
  })

  it('clamps to SHELL_PROPERTIES_MIN when the stored value is below the minimum', () => {
    state.store[SHELL_PROPERTIES_WIDTH_KEY] = '50'
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_MIN)
  })

  it('clamps to SHELL_PROPERTIES_MAX when the stored value is above the maximum', () => {
    state.store[SHELL_PROPERTIES_WIDTH_KEY] = '9999'
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_MAX)
  })

  it('clamps a strongly negative stored value to SHELL_PROPERTIES_MIN', () => {
    state.store[SHELL_PROPERTIES_WIDTH_KEY] = '-500'
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_MIN)
  })

  it('returns the boundary value SHELL_PROPERTIES_MIN when stored exactly at the minimum', () => {
    state.store[SHELL_PROPERTIES_WIDTH_KEY] = String(SHELL_PROPERTIES_MIN)
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_MIN)
  })

  it('returns the boundary value SHELL_PROPERTIES_MAX when stored exactly at the maximum', () => {
    state.store[SHELL_PROPERTIES_WIDTH_KEY] = String(SHELL_PROPERTIES_MAX)
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_MAX)
  })

  it('swallows a throwing localStorage.getItem and returns SHELL_PROPERTIES_DEFAULT', () => {
    state.throwOnGet = true
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_DEFAULT)
  })

  it('returns a primitive number (not a Number object)', () => {
    expect(typeof readShellPropertiesWidth()).toBe('number')
  })
})

// ===========================================================================
// (F) writeShellBrowserWidth contract
// ===========================================================================

describe('[ID-0233] writeShellBrowserWidth contract', () => {
  it('persists an in-range integer to the browser key as a string', () => {
    writeShellBrowserWidth(300)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe('300')
  })

  it('clamps an under-min value up to SHELL_BROWSER_MIN before persisting', () => {
    writeShellBrowserWidth(50)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe(String(SHELL_BROWSER_MIN))
  })

  it('clamps an over-max value down to SHELL_BROWSER_MAX before persisting', () => {
    writeShellBrowserWidth(9999)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe(String(SHELL_BROWSER_MAX))
  })

  it('persists exact MIN boundary unchanged', () => {
    writeShellBrowserWidth(SHELL_BROWSER_MIN)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe(String(SHELL_BROWSER_MIN))
  })

  it('persists exact MAX boundary unchanged', () => {
    writeShellBrowserWidth(SHELL_BROWSER_MAX)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe(String(SHELL_BROWSER_MAX))
  })

  it('Math.rounds a half-up decimal before persisting (260.7 -> 261)', () => {
    writeShellBrowserWidth(260.7)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe('261')
  })

  it('Math.rounds a half-down decimal before persisting (260.3 -> 260)', () => {
    writeShellBrowserWidth(260.3)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe('260')
  })

  it('Math.rounds a precisely-half decimal banker-style (260.5 -> 261, JS default)', () => {
    // Math.round(260.5) === 261 in JS (round-half-towards-+Infinity).
    writeShellBrowserWidth(260.5)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe('261')
  })

  it('clamps NaN -> Math.max(MIN, NaN) === NaN -> Math.min(MAX, NaN) === NaN -> Math.round(NaN) === NaN; persists "NaN" string (current behaviour pinned)', () => {
    // Pinning current behaviour: clamp(NaN, ...) returns NaN; String(NaN) === 'NaN'.
    // A future hardening pass would reject NaN before write; this pin is a
    // deliberate-update gate for that future change.
    writeShellBrowserWidth(Number.NaN)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe('NaN')
  })

  it('swallows a throwing localStorage.setItem (no exception propagates)', () => {
    state.throwOnSet = true
    expect(() => writeShellBrowserWidth(300)).not.toThrow()
  })

  it('does not mutate the properties key', () => {
    writeShellBrowserWidth(300)
    expect(SHELL_PROPERTIES_WIDTH_KEY in state.store).toBe(false)
  })

  it('returns void (undefined)', () => {
    expect(writeShellBrowserWidth(300)).toBeUndefined()
  })
})

// ===========================================================================
// (G) writeShellPropertiesWidth contract
// ===========================================================================

describe('[ID-0233] writeShellPropertiesWidth contract', () => {
  it('persists an in-range integer to the properties key as a string', () => {
    writeShellPropertiesWidth(350)
    expect(state.store[SHELL_PROPERTIES_WIDTH_KEY]).toBe('350')
  })

  it('clamps an under-min value up to SHELL_PROPERTIES_MIN before persisting', () => {
    writeShellPropertiesWidth(50)
    expect(state.store[SHELL_PROPERTIES_WIDTH_KEY]).toBe(String(SHELL_PROPERTIES_MIN))
  })

  it('clamps an over-max value down to SHELL_PROPERTIES_MAX before persisting', () => {
    writeShellPropertiesWidth(9999)
    expect(state.store[SHELL_PROPERTIES_WIDTH_KEY]).toBe(String(SHELL_PROPERTIES_MAX))
  })

  it('persists exact MIN boundary unchanged', () => {
    writeShellPropertiesWidth(SHELL_PROPERTIES_MIN)
    expect(state.store[SHELL_PROPERTIES_WIDTH_KEY]).toBe(String(SHELL_PROPERTIES_MIN))
  })

  it('persists exact MAX boundary unchanged', () => {
    writeShellPropertiesWidth(SHELL_PROPERTIES_MAX)
    expect(state.store[SHELL_PROPERTIES_WIDTH_KEY]).toBe(String(SHELL_PROPERTIES_MAX))
  })

  it('Math.rounds a half-up decimal before persisting (300.7 -> 301)', () => {
    writeShellPropertiesWidth(300.7)
    expect(state.store[SHELL_PROPERTIES_WIDTH_KEY]).toBe('301')
  })

  it('Math.rounds a half-down decimal before persisting (300.3 -> 300)', () => {
    writeShellPropertiesWidth(300.3)
    expect(state.store[SHELL_PROPERTIES_WIDTH_KEY]).toBe('300')
  })

  it('swallows a throwing localStorage.setItem (no exception propagates)', () => {
    state.throwOnSet = true
    expect(() => writeShellPropertiesWidth(350)).not.toThrow()
  })

  it('does not mutate the browser key', () => {
    writeShellPropertiesWidth(350)
    expect(SHELL_BROWSER_WIDTH_KEY in state.store).toBe(false)
  })

  it('returns void (undefined)', () => {
    expect(writeShellPropertiesWidth(350)).toBeUndefined()
  })
})

// ===========================================================================
// (H) Cross-helper independence + round-trip invariants
// ===========================================================================

describe('[ID-0233] cross-helper independence + round-trip', () => {
  it('write/read browser preserves the clamped integer', () => {
    writeShellBrowserWidth(300)
    expect(readShellBrowserWidth()).toBe(300)
  })

  it('write/read properties preserves the clamped integer', () => {
    writeShellPropertiesWidth(350)
    expect(readShellPropertiesWidth()).toBe(350)
  })

  it('writing browser does not affect the properties read', () => {
    writeShellBrowserWidth(300)
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_DEFAULT)
  })

  it('writing properties does not affect the browser read', () => {
    writeShellPropertiesWidth(350)
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_DEFAULT)
  })

  it('write -> read round-trips through clamp on under-min input', () => {
    writeShellBrowserWidth(10)
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_MIN)
  })

  it('write -> read round-trips through clamp on over-max input', () => {
    writeShellPropertiesWidth(99999)
    expect(readShellPropertiesWidth()).toBe(SHELL_PROPERTIES_MAX)
  })

  it('write -> read round-trips through Math.round on decimal input', () => {
    writeShellBrowserWidth(260.6)
    expect(readShellBrowserWidth()).toBe(261)
  })

  it('multiple writes overwrite the same key (last-write-wins)', () => {
    writeShellBrowserWidth(200)
    writeShellBrowserWidth(300)
    writeShellBrowserWidth(400)
    expect(readShellBrowserWidth()).toBe(400)
  })

  it('reading an in-range pre-existing value does not call setItem', () => {
    state.store[SHELL_BROWSER_WIDTH_KEY] = '300'
    mockLocalStorage.setItem.mockClear()
    readShellBrowserWidth()
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled()
  })

  it('readers issue exactly one getItem call per invocation', () => {
    mockLocalStorage.getItem.mockClear()
    readShellBrowserWidth()
    expect(mockLocalStorage.getItem).toHaveBeenCalledTimes(1)
    mockLocalStorage.getItem.mockClear()
    readShellPropertiesWidth()
    expect(mockLocalStorage.getItem).toHaveBeenCalledTimes(1)
  })

  it('writers issue exactly one setItem call per invocation', () => {
    mockLocalStorage.setItem.mockClear()
    writeShellBrowserWidth(300)
    expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1)
    mockLocalStorage.setItem.mockClear()
    writeShellPropertiesWidth(350)
    expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1)
  })

  it('readShellBrowserWidth queries the browser key (not the properties key)', () => {
    mockLocalStorage.getItem.mockClear()
    readShellBrowserWidth()
    expect(mockLocalStorage.getItem).toHaveBeenCalledWith(SHELL_BROWSER_WIDTH_KEY)
  })

  it('readShellPropertiesWidth queries the properties key (not the browser key)', () => {
    mockLocalStorage.getItem.mockClear()
    readShellPropertiesWidth()
    expect(mockLocalStorage.getItem).toHaveBeenCalledWith(SHELL_PROPERTIES_WIDTH_KEY)
  })

  it('writeShellBrowserWidth writes to the browser key (not the properties key)', () => {
    writeShellBrowserWidth(300)
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      SHELL_BROWSER_WIDTH_KEY,
      '300'
    )
  })

  it('writeShellPropertiesWidth writes to the properties key (not the browser key)', () => {
    writeShellPropertiesWidth(350)
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      SHELL_PROPERTIES_WIDTH_KEY,
      '350'
    )
  })
})

// ===========================================================================
// (I) Source-text whitelist
// ===========================================================================

describe('[ID-0233] shellLayoutStorage source-text whitelist', () => {
  it('contains the SHELL_BROWSER_WIDTH_KEY string literal verbatim', () => {
    expect(SRC).toContain("'ufs_shell_browser_px'")
  })

  it('contains the SHELL_PROPERTIES_WIDTH_KEY string literal verbatim', () => {
    expect(SRC).toContain("'ufs_shell_properties_px'")
  })

  it('contains the 6 numeric bound literals verbatim (260, 180, 420, 280, 200, 480)', () => {
    expect(SRC).toMatch(/=\s*260\b/)
    expect(SRC).toMatch(/=\s*180\b/)
    expect(SRC).toMatch(/=\s*420\b/)
    expect(SRC).toMatch(/=\s*280\b/)
    expect(SRC).toMatch(/=\s*200\b/)
    expect(SRC).toMatch(/=\s*480\b/)
  })

  it('uses Math.round (the integer-cast path)', () => {
    expect(SRC).toContain('Math.round(')
  })

  it('uses Math.min and Math.max for clamping', () => {
    expect(SRC).toContain('Math.min(')
    expect(SRC).toContain('Math.max(')
  })

  it('uses Number.parseInt with explicit radix=10', () => {
    expect(SRC).toMatch(/Number\.parseInt\([^,]+,\s*10\)/)
  })

  it('uses Number.isFinite for the parsed-value guard', () => {
    expect(SRC).toContain('Number.isFinite(')
  })

  it('contains exactly 3 try/catch blocks (one shared readKey helper + 2 writers)', () => {
    // The two readers share a private readKey() helper that owns the
    // single read-side try/catch; the two writers each own their own
    // try/catch. Drift to 4 would mean the readers stopped sharing the
    // helper; drift to 2 would mean a writer dropped its defensive guard.
    const matches = SRC.match(/\btry\s*\{/g) ?? []
    expect(matches.length).toBe(3)
  })

  it('contains exactly 4 export function declarations (the public helpers)', () => {
    const matches = SRC.match(/^export function /gm) ?? []
    expect(matches.length).toBe(4)
  })

  it('contains exactly 8 export const declarations (the public constants)', () => {
    const matches = SRC.match(/^export const /gm) ?? []
    expect(matches.length).toBe(8)
  })

  it('has no default export', () => {
    expect(SRC).not.toMatch(/export\s+default\b/)
  })

  it('has no top-level let / var (codeOnly)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/^\s*(let|var)\s/m)
  })

  it('has no `:any` (codeOnly)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/:\s*any\b/)
  })

  it('has no `as any` (codeOnly)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bas\s+any\b/)
  })

  it('has no `<any>` (codeOnly)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/<\s*any\s*>/)
  })

  it('has no electron / fs / path / child_process / dgram / net / tls imports', () => {
    expect(SRC).not.toMatch(
      /from\s+['"](electron|node:fs|fs|node:path|path|node:child_process|child_process|node:dgram|dgram|node:net|net|node:tls|tls)['"]/
    )
  })

  it('has no React / DOM / Three.js imports', () => {
    expect(SRC).not.toMatch(/from\s+['"](react|react-dom|three)['"]/)
  })

  it('has no Handlebars tokens or imports', () => {
    expect(SRC).not.toMatch(/from\s+['"]handlebars['"]/)
    const code = codeOnly(SRC)
    expect(code).not.toContain('{{')
    expect(code).not.toContain('}}')
  })

  it('has no foreign-machine vendor names (Bambu / Prusa / Fanuc / Haas / Tormach / Mach3 / Mach4 / Shapeoko / Onefinity / X-Carve)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(
      /\b(Bambu|Prusa|Fanuc|Haas|Tormach|Mach3|Mach4|Shapeoko|Onefinity|X-Carve)\b/i
    )
  })

  it('has no target-machine names hard-coded in code (machine-agnostic helper)', () => {
    // The shell-layout helper is machine-agnostic -- the column widths are
    // operator-UI state, not machine state. Drift here would suggest a
    // boundary leak (e.g., per-machine layout overrides creeping into the
    // storage key). codeOnly() ensures we don't trip on JSDoc references.
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\b(Creality|K2 Plus|Laguna|Makera|Carvera)\b/)
  })

  it('has no toolpath G-code emissions in code (Safety Rule 1)', () => {
    // Negative regex: codeOnly() removes string literals and comments,
    // so any G0/G1/G17/.../G91 word-boundary match would be a real
    // violation. The shell-layout module is INTERFACE-ONLY; emitting
    // G-code here would be a Safety Rule 1 break.
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bG(0|1|17|18|19|20|21|54|55|56|57|58|59|90|91)\b/)
  })

  it('has no toolpath M-code emissions in code (Safety Rule 1)', () => {
    const code = codeOnly(SRC)
    expect(code).not.toMatch(/\bM(3|4|5|6|7|8|9|30|64|65)\b/)
  })

  it('source file is under 100 lines (small helper canary)', () => {
    const lineCount = SRC.split('\n').length
    expect(lineCount).toBeLessThan(100)
  })

  it('source file is under 4 KB (small helper canary)', () => {
    expect(SRC.length).toBeLessThan(4096)
  })

  it('uses fallback-on-throw idiom (try { ... } catch { return fallback })', () => {
    // Verify the read-side catch block is structured as a defensive
    // fallback (not a logging-only catch that swallows errors).
    expect(SRC).toMatch(/catch\s*\{\s*\n\s*return\s+fallback\s*\n\s*\}/)
  })

  it('has zero runtime imports (pure helper, no dependencies)', () => {
    // Module-level imports MUST be empty -- this is a leaf-level helper
    // depending only on the global localStorage. Drift here would suggest
    // a layering violation.
    const importLines = SRC.match(/^import\s.*$/gm) ?? []
    expect(importLines.length).toBe(0)
  })

  it('JSDoc header documents the persistence shape ("Persisted shell column widths")', () => {
    expect(SRC).toMatch(/Persisted\s+shell\s+column\s+widths/i)
  })
})

// ===========================================================================
// (J) Cross-cutting safety
// ===========================================================================

describe('[ID-0233] cross-cutting safety invariants', () => {
  it('successive empty-store reads return identical primitive defaults (no hidden state)', () => {
    const a = readShellBrowserWidth()
    const b = readShellBrowserWidth()
    const c = readShellPropertiesWidth()
    const d = readShellPropertiesWidth()
    expect(a).toBe(b)
    expect(c).toBe(d)
    expect(a).toBe(SHELL_BROWSER_DEFAULT)
    expect(c).toBe(SHELL_PROPERTIES_DEFAULT)
  })

  it('write idempotence: writing the same value twice leaves storage unchanged on the second call', () => {
    writeShellBrowserWidth(300)
    const after1 = state.store[SHELL_BROWSER_WIDTH_KEY]
    writeShellBrowserWidth(300)
    const after2 = state.store[SHELL_BROWSER_WIDTH_KEY]
    expect(after1).toBe(after2)
    expect(after2).toBe('300')
  })

  it('throw-on-set does NOT corrupt the read path (subsequent read still hits localStorage successfully)', () => {
    state.throwOnSet = true
    writeShellBrowserWidth(300) // swallowed
    state.throwOnSet = false
    state.store[SHELL_BROWSER_WIDTH_KEY] = '350'
    expect(readShellBrowserWidth()).toBe(350)
  })

  it('throw-on-get does NOT corrupt the write path (subsequent write still succeeds)', () => {
    state.throwOnGet = true
    expect(readShellBrowserWidth()).toBe(SHELL_BROWSER_DEFAULT) // swallowed
    state.throwOnGet = false
    writeShellBrowserWidth(300)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe('300')
  })

  it('helpers operate on independent localStorage keys (no key-collision risk)', () => {
    writeShellBrowserWidth(300)
    writeShellPropertiesWidth(350)
    expect(state.store[SHELL_BROWSER_WIDTH_KEY]).toBe('300')
    expect(state.store[SHELL_PROPERTIES_WIDTH_KEY]).toBe('350')
    expect(Object.keys(state.store).sort()).toEqual(
      [SHELL_BROWSER_WIDTH_KEY, SHELL_PROPERTIES_WIDTH_KEY].sort()
    )
  })

  it('reading after a successful write returns the EXACT integer that was persisted', () => {
    for (const v of [180, 200, 260, 300, 350, 420]) {
      // Each value is in-range for its respective helper; pin both round-trips.
      const brWriteVal = Math.max(SHELL_BROWSER_MIN, Math.min(SHELL_BROWSER_MAX, v))
      const prWriteVal = Math.max(
        SHELL_PROPERTIES_MIN,
        Math.min(SHELL_PROPERTIES_MAX, v)
      )
      writeShellBrowserWidth(brWriteVal)
      writeShellPropertiesWidth(prWriteVal)
      expect(readShellBrowserWidth()).toBe(brWriteVal)
      expect(readShellPropertiesWidth()).toBe(prWriteVal)
    }
  })

  it('no helper inspects a "machine" / "kind" / "profile" identifier (machine-agnostic invariant)', () => {
    // Defense-in-depth: the codeOnly() check above forbids machine names,
    // but this assertion forbids the broader concept-drift of any per-machine
    // branching by inspecting the runtime call-graph. Spy on getItem and
    // verify only the two known keys are queried regardless of fixture state.
    mockLocalStorage.getItem.mockClear()
    readShellBrowserWidth()
    readShellPropertiesWidth()
    const calls = mockLocalStorage.getItem.mock.calls.map((args) => args[0])
    expect(new Set(calls)).toEqual(
      new Set([SHELL_BROWSER_WIDTH_KEY, SHELL_PROPERTIES_WIDTH_KEY])
    )
  })
})
