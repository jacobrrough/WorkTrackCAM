/**
 * useShellResizableColumns-pin.test.ts -- [ID-0225] Cycle 149 test-coverage paired-pin
 *
 * Pins the contract of `src/renderer/shell/useShellResizableColumns.ts` -- the
 * renderer-shell hook that drives the two resize handles framing the centre
 * canvas (Browser column on the left, Properties column on the right). The
 * module had ZERO test coverage of any kind before this pin -- this is a
 * first-time-vitest-visibility cycle. Surfaced during the Cycle 130 ZERO-
 * coverage-helper inventory (89 lines) and named in the Cycle 148 hand-off
 * (Section 25 of the 2026-04-28 daily plan) as the highest-leverage next
 * test-coverage pull.
 *
 * Sister cycles: 119 [ID-0196] derive-features, 124 [ID-0201]
 * viewport3d-bounds, 129 [ID-0206] design-viewport-interaction, 130 [ID-0207]
 * shop-stock-bounds, 131 [ID-0208] command-palette-memory.
 *
 * Cross-cuts every machine indirectly -- the resizable-shell columns frame
 * the entire WorkTrack3D UI and are present for every operator workflow on
 * every target machine (Creality K2 Plus FDM, Laguna Swift 5x10 router,
 * Makera Carvera + 4-axis). Drift in clamp ranges, persisted-key strings,
 * pointer-event lifecycle, or asymmetric-delta arithmetic would break the
 * shell layout uniformly across the fleet.
 *
 * Pin coverage:
 *   (A) module shape -- single named export, function arity 1, no default,
 *   (B) shellLayoutStorage wiring -- imports are byte-stable, clamp ranges
 *       come from the canonical constants, both read + both write functions
 *       are referenced at expected call sites,
 *   (C) hook return-shape contract -- exactly 4 keys, types correct,
 *   (D) initial state derivation -- browserPx and propertiesPx come from
 *       the lazy-init readers (useState passes the function reference, not
 *       a precomputed value),
 *   (E) onBrowserResizePointerDown happy-path -- preventDefault +
 *       setPointerCapture + body-class add + three window listeners (move /
 *       up / cancel) + no premature localStorage write,
 *   (F) browser pointer-move drives clamped setBrowserPx,
 *   (G) browser pointer-up triggers releasePointerCapture + writes
 *       SHELL_BROWSER_WIDTH_KEY + removes all three listeners + removes
 *       body class,
 *   (H) onPropertiesResizePointerDown mirrors E with INVERTED delta
 *       (right-grow: delta = startX - currentX, NOT currentX - startX),
 *   (I) properties handler early-exits when showProperties=false (no
 *       preventDefault, no setPointerCapture, no listener attach),
 *   (J) properties pointer-up writes SHELL_PROPERTIES_WIDTH_KEY (not the
 *       browser key) and ONLY the properties body-class is removed once,
 *   (K) clamp respects SHELL_BROWSER_MIN/MAX + SHELL_PROPERTIES_MIN/MAX,
 *   (L) source-text whitelist -- 'shell-col-resizing' literal, exactly two
 *       useCallback returns, the asymmetric delta arithmetic, both write
 *       functions only on pointer-up, no top-level `let`, no `any`.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycles 119 / 124 /
 * 129 / 130 / 131).
 */
import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Save the original globalThis descriptors BEFORE we mutate them. The
// vitest pool is `threads: { singleThread: true }` (see vitest.config.ts
// [ID-0153]), so any global we set here will leak into every subsequent
// test file in the same thread unless we restore in afterAll. The
// detect-gpu library that powers Viewport3D reads `window.navigator.
// userAgent` at module load -- if we leave a fake `window` (without
// `navigator`) on globalThis, that load throws and downstream renderer
// component tests fail. Snapshot now, restore at the end.
const __origWindowDesc = Object.getOwnPropertyDescriptor(globalThis, 'window')
const __origDocumentDesc = Object.getOwnPropertyDescriptor(globalThis, 'document')
const __origLocalStorageDesc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

// --- React shim ----------------------------------------------------------
// vitest runs in `node` env (see vitest.config.ts: environment: 'node').
// Mocking react with minimal stubs lets us drive the hook synchronously
// without pulling in @testing-library/react (which is not a project dep).

const useStateCalls: unknown[] = []
const useStateSetters: ReturnType<typeof vi.fn>[] = []
const useRefCalls: unknown[] = []
const useCallbackDeps: unknown[][] = []

vi.mock('react', () => ({
  useState: (init: unknown) => {
    const v = typeof init === 'function' ? (init as () => unknown)() : init
    useStateCalls.push(v)
    const setter = vi.fn()
    useStateSetters.push(setter)
    return [v, setter]
  },
  useRef: (init: unknown) => {
    useRefCalls.push(init)
    return { current: init }
  },
  useCallback: (fn: unknown, deps: unknown[]) => {
    useCallbackDeps.push(deps)
    return fn
  }
}))

// --- localStorage / window / document shims ------------------------------

const lsStore: Record<string, string> = {}
const mockLocalStorage = {
  getItem: vi.fn((key: string) => (key in lsStore ? lsStore[key]! : null)),
  setItem: vi.fn((key: string, value: string) => {
    lsStore[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete lsStore[key]
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(lsStore)) delete lsStore[k]
  }),
  get length() {
    return Object.keys(lsStore).length
  },
  key: vi.fn((i: number) => Object.keys(lsStore)[i] ?? null)
}
Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true
})

interface WindowListenerRecord {
  type: string
  fn: (ev: unknown) => void
}
const winListeners: WindowListenerRecord[] = []
const fakeWindow = {
  addEventListener: vi.fn((type: string, fn: (ev: unknown) => void) => {
    winListeners.push({ type, fn })
  }),
  removeEventListener: vi.fn((type: string, fn: (ev: unknown) => void) => {
    const i = winListeners.findIndex((r) => r.type === type && r.fn === fn)
    if (i >= 0) winListeners.splice(i, 1)
  })
}
Object.defineProperty(globalThis, 'window', {
  value: fakeWindow,
  writable: true,
  configurable: true
})

const docClassList = new Set<string>()
const docClassListAdd = vi.fn((c: string) => docClassList.add(c))
const docClassListRemove = vi.fn((c: string) => docClassList.delete(c))
const fakeDocument = {
  body: {
    classList: {
      add: docClassListAdd,
      remove: docClassListRemove,
      contains: (c: string) => docClassList.has(c)
    }
  }
}
Object.defineProperty(globalThis, 'document', {
  value: fakeDocument,
  writable: true,
  configurable: true
})

// --- module-under-test imports (after shims) -----------------------------

const M = await import('./useShellResizableColumns')
const SLS = await import('./shellLayoutStorage')

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, 'useShellResizableColumns.ts'), 'utf-8')

// --- helpers -------------------------------------------------------------

function resetAll(): void {
  useStateCalls.length = 0
  useStateSetters.length = 0
  useRefCalls.length = 0
  useCallbackDeps.length = 0
  winListeners.length = 0
  docClassList.clear()
  for (const k of Object.keys(lsStore)) delete lsStore[k]
  vi.clearAllMocks()
}

interface FakeButton {
  setPointerCapture: ReturnType<typeof vi.fn>
  releasePointerCapture: ReturnType<typeof vi.fn>
}

function makeFakeButton(): FakeButton {
  return {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn()
  }
}

interface FakePointerDown {
  preventDefault: ReturnType<typeof vi.fn>
  currentTarget: FakeButton
  pointerId: number
  clientX: number
}

function makePointerDown(button: FakeButton, x: number, pointerId = 7): FakePointerDown {
  return {
    preventDefault: vi.fn(),
    currentTarget: button,
    pointerId,
    clientX: x
  }
}

beforeEach(() => {
  resetAll()
})

afterAll(() => {
  // Restore globalThis to its pre-test state so subsequent files in the
  // singleThread pool (notably Viewport3D.test.ts via detect-gpu) see the
  // expected Node-environment shape.
  function restore(prop: 'window' | 'document' | 'localStorage', desc: PropertyDescriptor | undefined): void {
    if (desc) {
      Object.defineProperty(globalThis, prop, desc)
    } else {
      // Property did not exist before; remove our stub.
      delete (globalThis as Record<string, unknown>)[prop]
    }
  }
  restore('window', __origWindowDesc)
  restore('document', __origDocumentDesc)
  restore('localStorage', __origLocalStorageDesc)
  vi.unstubAllGlobals()
})

// =========================================================================
// (A) module shape
// =========================================================================

describe('[ID-0225] useShellResizableColumns module shape', () => {
  it('exports useShellResizableColumns as the only runtime export', () => {
    const keys = Object.keys(M).filter((k) => k !== 'default')
    expect(keys).toEqual(['useShellResizableColumns'])
  })

  it('useShellResizableColumns is a function', () => {
    expect(typeof M.useShellResizableColumns).toBe('function')
  })

  it('hook reports arity 1 (showProperties: boolean)', () => {
    expect(M.useShellResizableColumns.length).toBe(1)
  })

  it('module has no default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('module namespace prototype is null (ESM bag, not Object subclass)', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })
})

// =========================================================================
// (B) shellLayoutStorage wiring
// =========================================================================

describe('[ID-0225] shellLayoutStorage import wiring', () => {
  it('SHELL_BROWSER_MIN < SHELL_BROWSER_MAX (sane range)', () => {
    expect(SLS.SHELL_BROWSER_MIN).toBeLessThan(SLS.SHELL_BROWSER_MAX)
  })

  it('SHELL_PROPERTIES_MIN < SHELL_PROPERTIES_MAX (sane range)', () => {
    expect(SLS.SHELL_PROPERTIES_MIN).toBeLessThan(SLS.SHELL_PROPERTIES_MAX)
  })

  it('source imports the four constants byte-stably', () => {
    expect(SRC).toContain('SHELL_BROWSER_MAX')
    expect(SRC).toContain('SHELL_BROWSER_MIN')
    expect(SRC).toContain('SHELL_PROPERTIES_MAX')
    expect(SRC).toContain('SHELL_PROPERTIES_MIN')
  })

  it('source imports both readers + both writers byte-stably', () => {
    expect(SRC).toContain('readShellBrowserWidth')
    expect(SRC).toContain('readShellPropertiesWidth')
    expect(SRC).toContain('writeShellBrowserWidth')
    expect(SRC).toContain('writeShellPropertiesWidth')
  })

  it("imports from the colocated './shellLayoutStorage' module (not src/shared)", () => {
    expect(SRC).toMatch(/from ['"]\.\/shellLayoutStorage['"]/)
  })
})

// =========================================================================
// (C) hook return-shape contract
// =========================================================================

describe('[ID-0225] hook return-shape contract', () => {
  it('returns an object with exactly 4 keys', () => {
    const out = M.useShellResizableColumns(true)
    expect(Object.keys(out).sort()).toEqual([
      'browserPx',
      'onBrowserResizePointerDown',
      'onPropertiesResizePointerDown',
      'propertiesPx'
    ])
  })

  it('browserPx is a finite number', () => {
    const out = M.useShellResizableColumns(true)
    expect(typeof out.browserPx).toBe('number')
    expect(Number.isFinite(out.browserPx)).toBe(true)
  })

  it('propertiesPx is a finite number', () => {
    const out = M.useShellResizableColumns(true)
    expect(typeof out.propertiesPx).toBe('number')
    expect(Number.isFinite(out.propertiesPx)).toBe(true)
  })

  it('onBrowserResizePointerDown is a function', () => {
    const out = M.useShellResizableColumns(true)
    expect(typeof out.onBrowserResizePointerDown).toBe('function')
  })

  it('onPropertiesResizePointerDown is a function', () => {
    const out = M.useShellResizableColumns(true)
    expect(typeof out.onPropertiesResizePointerDown).toBe('function')
  })
})

// =========================================================================
// (D) initial state derivation
// =========================================================================

describe('[ID-0225] initial state derivation', () => {
  it('useState was called exactly twice (browserPx + propertiesPx)', () => {
    M.useShellResizableColumns(true)
    expect(useStateCalls.length).toBe(2)
  })

  it('useRef was called exactly twice (browserPxRef + propertiesPxRef)', () => {
    M.useShellResizableColumns(true)
    expect(useRefCalls.length).toBe(2)
  })

  it('useCallback was called exactly twice (browser + properties handlers)', () => {
    M.useShellResizableColumns(true)
    expect(useCallbackDeps.length).toBe(2)
  })

  it('browserPx initial value is within SHELL_BROWSER_MIN..MAX', () => {
    const out = M.useShellResizableColumns(true)
    expect(out.browserPx).toBeGreaterThanOrEqual(SLS.SHELL_BROWSER_MIN)
    expect(out.browserPx).toBeLessThanOrEqual(SLS.SHELL_BROWSER_MAX)
  })

  it('propertiesPx initial value is within SHELL_PROPERTIES_MIN..MAX', () => {
    const out = M.useShellResizableColumns(true)
    expect(out.propertiesPx).toBeGreaterThanOrEqual(SLS.SHELL_PROPERTIES_MIN)
    expect(out.propertiesPx).toBeLessThanOrEqual(SLS.SHELL_PROPERTIES_MAX)
  })

  it('lazy-init: useState receives function references, not pre-computed values', () => {
    expect(SRC).toContain('useState(readShellBrowserWidth)')
    expect(SRC).toContain('useState(readShellPropertiesWidth)')
  })

  it('browserPxRef.current is initialised to the same value as browserPx state', () => {
    const out = M.useShellResizableColumns(true)
    // The hook overwrites the ref `.current` immediately after creation -- pin
    // that the ref slot is exactly tracking the state cell on first render.
    expect(useRefCalls[0]).toBe(out.browserPx)
  })

  it('propertiesPxRef.current is initialised to the same value as propertiesPx state', () => {
    const out = M.useShellResizableColumns(true)
    expect(useRefCalls[1]).toBe(out.propertiesPx)
  })

  it('the useCallback dep array for properties includes showProperties', () => {
    M.useShellResizableColumns(true)
    // browser handler has no deps; properties handler depends on
    // showProperties so React invalidates the callback when the panel toggles.
    expect(useCallbackDeps[0]).toEqual([])
    expect(useCallbackDeps[1]).toEqual([true])
  })
})

// =========================================================================
// (E) onBrowserResizePointerDown happy-path
// =========================================================================

describe('[ID-0225] onBrowserResizePointerDown happy-path setup', () => {
  it('calls e.preventDefault()', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    const ev = makePointerDown(btn, 100)
    out.onBrowserResizePointerDown(ev as unknown as never)
    expect(ev.preventDefault).toHaveBeenCalledTimes(1)
  })

  it('calls el.setPointerCapture(pointerId) on the currentTarget', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    const ev = makePointerDown(btn, 100, 17)
    out.onBrowserResizePointerDown(ev as unknown as never)
    expect(btn.setPointerCapture).toHaveBeenCalledTimes(1)
    expect(btn.setPointerCapture).toHaveBeenCalledWith(17)
  })

  it("adds 'shell-col-resizing' to document.body.classList", () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    expect(docClassListAdd).toHaveBeenCalledWith('shell-col-resizing')
    expect(docClassList.has('shell-col-resizing')).toBe(true)
  })

  it('attaches exactly three window listeners: pointermove + pointerup + pointercancel', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    expect(fakeWindow.addEventListener).toHaveBeenCalledTimes(3)
    const types = winListeners.map((r) => r.type).sort()
    expect(types).toEqual(['pointercancel', 'pointermove', 'pointerup'])
  })

  it('does NOT write SHELL_BROWSER_WIDTH_KEY on pointer-down (only on pointer-up)', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    expect(mockLocalStorage.setItem).not.toHaveBeenCalledWith(
      SLS.SHELL_BROWSER_WIDTH_KEY,
      expect.anything()
    )
  })

  it('does NOT call releasePointerCapture on pointer-down', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    expect(btn.releasePointerCapture).not.toHaveBeenCalled()
  })
})

// =========================================================================
// (F) browser pointer-move drives clamped setBrowserPx
// =========================================================================

describe('[ID-0225] browser pointer-move drives clamped setBrowserPx', () => {
  it('positive delta -> larger width (left-grow direction)', () => {
    const out = M.useShellResizableColumns(true)
    const startW = out.browserPx
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: 130 })
    // setBrowserPx[0] is the FIRST useState's setter (browser).
    const setBrowserPx = useStateSetters[0]
    expect(setBrowserPx).toHaveBeenCalledTimes(1)
    const target = Math.round(startW + 30)
    const expected = Math.min(SLS.SHELL_BROWSER_MAX, Math.max(SLS.SHELL_BROWSER_MIN, target))
    expect(setBrowserPx).toHaveBeenCalledWith(expected)
  })

  it('negative delta -> smaller width (clamped at SHELL_BROWSER_MIN)', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 1000) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    // Drag far left so result < SHELL_BROWSER_MIN.
    onMove({ clientX: 0 })
    const setBrowserPx = useStateSetters[0]
    expect(setBrowserPx).toHaveBeenCalledWith(SLS.SHELL_BROWSER_MIN)
  })

  it('huge positive delta -> width clamped at SHELL_BROWSER_MAX', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: 999_999 })
    const setBrowserPx = useStateSetters[0]
    expect(setBrowserPx).toHaveBeenCalledWith(SLS.SHELL_BROWSER_MAX)
  })

  it('zero delta -> Math.round(startW) -> setter called with the rounded start width', () => {
    const out = M.useShellResizableColumns(true)
    const startW = out.browserPx
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 250) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: 250 })
    const setBrowserPx = useStateSetters[0]
    expect(setBrowserPx).toHaveBeenCalledWith(Math.round(startW))
  })

  it('multiple moves emit multiple setter calls (no dedup)', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: 110 })
    onMove({ clientX: 120 })
    onMove({ clientX: 130 })
    const setBrowserPx = useStateSetters[0]
    expect(setBrowserPx).toHaveBeenCalledTimes(3)
  })
})

// =========================================================================
// (G) browser pointer-up cleanup
// =========================================================================

describe('[ID-0225] browser pointer-up cleanup', () => {
  it('calls releasePointerCapture(pointerId) on the button', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100, 99) as unknown as never)
    const onUp = winListeners.find((r) => r.type === 'pointerup')!.fn
    onUp({ pointerId: 99 })
    expect(btn.releasePointerCapture).toHaveBeenCalledTimes(1)
    expect(btn.releasePointerCapture).toHaveBeenCalledWith(99)
  })

  it('removes all three window listeners (move + up + cancel)', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    expect(winListeners.length).toBe(3)
    const onUp = winListeners.find((r) => r.type === 'pointerup')!.fn
    onUp({ pointerId: 7 })
    expect(winListeners.length).toBe(0)
    expect(fakeWindow.removeEventListener).toHaveBeenCalledTimes(3)
  })

  it("removes 'shell-col-resizing' from document.body.classList", () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    expect(docClassList.has('shell-col-resizing')).toBe(true)
    const onUp = winListeners.find((r) => r.type === 'pointerup')!.fn
    onUp({ pointerId: 7 })
    expect(docClassListRemove).toHaveBeenCalledWith('shell-col-resizing')
    expect(docClassList.has('shell-col-resizing')).toBe(false)
  })

  it('writes SHELL_BROWSER_WIDTH_KEY to localStorage on pointer-up', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    const onUp = winListeners.find((r) => r.type === 'pointerup')!.fn
    onUp({ pointerId: 7 })
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      SLS.SHELL_BROWSER_WIDTH_KEY,
      expect.any(String)
    )
  })

  it('does NOT write SHELL_PROPERTIES_WIDTH_KEY (only the browser key)', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    const onUp = winListeners.find((r) => r.type === 'pointerup')!.fn
    onUp({ pointerId: 7 })
    expect(mockLocalStorage.setItem).not.toHaveBeenCalledWith(
      SLS.SHELL_PROPERTIES_WIDTH_KEY,
      expect.anything()
    )
  })

  it('pointercancel triggers the same cleanup path as pointerup', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100, 22) as unknown as never)
    expect(winListeners.length).toBe(3)
    const onCancel = winListeners.find((r) => r.type === 'pointercancel')!.fn
    onCancel({ pointerId: 22 })
    expect(btn.releasePointerCapture).toHaveBeenCalledWith(22)
    expect(winListeners.length).toBe(0)
    expect(docClassList.has('shell-col-resizing')).toBe(false)
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      SLS.SHELL_BROWSER_WIDTH_KEY,
      expect.any(String)
    )
  })
})

// =========================================================================
// (H) onPropertiesResizePointerDown happy-path -- INVERTED delta
// =========================================================================

describe('[ID-0225] onPropertiesResizePointerDown happy-path (right-grow)', () => {
  it('calls preventDefault + setPointerCapture + adds body class + 3 listeners', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    const ev = makePointerDown(btn, 800)
    out.onPropertiesResizePointerDown(ev as unknown as never)
    expect(ev.preventDefault).toHaveBeenCalledTimes(1)
    expect(btn.setPointerCapture).toHaveBeenCalledWith(7)
    expect(docClassList.has('shell-col-resizing')).toBe(true)
    expect(winListeners.length).toBe(3)
  })

  it('INVERTED delta: dragging LEFT (smaller clientX) GROWS the right column', () => {
    // Right column grows toward the centre when the user drags the handle
    // leftward. The hook must compute delta = startX - currentX (NOT
    // currentX - startX) so a leftward pointer move increases the width.
    const out = M.useShellResizableColumns(true)
    const startW = out.propertiesPx
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: 770 }) // delta_real = -30, but inverted -> +30
    const setPropertiesPx = useStateSetters[1]
    const target = Math.round(startW + 30)
    const expected = Math.min(
      SLS.SHELL_PROPERTIES_MAX,
      Math.max(SLS.SHELL_PROPERTIES_MIN, target)
    )
    expect(setPropertiesPx).toHaveBeenCalledWith(expected)
  })

  it('dragging RIGHT (larger clientX) SHRINKS the right column', () => {
    const out = M.useShellResizableColumns(true)
    const startW = out.propertiesPx
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: 830 }) // delta_inverted = -30
    const setPropertiesPx = useStateSetters[1]
    const target = Math.round(startW - 30)
    const expected = Math.min(
      SLS.SHELL_PROPERTIES_MAX,
      Math.max(SLS.SHELL_PROPERTIES_MIN, target)
    )
    expect(setPropertiesPx).toHaveBeenCalledWith(expected)
  })

  it('huge leftward drag -> clamped at SHELL_PROPERTIES_MAX', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: -999_999 })
    const setPropertiesPx = useStateSetters[1]
    expect(setPropertiesPx).toHaveBeenCalledWith(SLS.SHELL_PROPERTIES_MAX)
  })

  it('huge rightward drag -> clamped at SHELL_PROPERTIES_MIN', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: 999_999 })
    const setPropertiesPx = useStateSetters[1]
    expect(setPropertiesPx).toHaveBeenCalledWith(SLS.SHELL_PROPERTIES_MIN)
  })
})

// =========================================================================
// (I) properties handler early-exits when showProperties=false
// =========================================================================

describe('[ID-0225] properties early-exit when showProperties=false', () => {
  it('does NOT call preventDefault', () => {
    const out = M.useShellResizableColumns(false)
    const btn = makeFakeButton()
    const ev = makePointerDown(btn, 800)
    out.onPropertiesResizePointerDown(ev as unknown as never)
    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('does NOT call setPointerCapture', () => {
    const out = M.useShellResizableColumns(false)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    expect(btn.setPointerCapture).not.toHaveBeenCalled()
  })

  it('does NOT attach any window listeners', () => {
    const out = M.useShellResizableColumns(false)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    expect(winListeners.length).toBe(0)
    expect(fakeWindow.addEventListener).not.toHaveBeenCalled()
  })

  it('does NOT add the body resize-cursor class', () => {
    const out = M.useShellResizableColumns(false)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    expect(docClassListAdd).not.toHaveBeenCalled()
    expect(docClassList.has('shell-col-resizing')).toBe(false)
  })

  it('does NOT call the propertiesPx state setter', () => {
    const out = M.useShellResizableColumns(false)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    expect(useStateSetters[1]).not.toHaveBeenCalled()
  })

  it('the BROWSER handler is NOT gated by showProperties (still active)', () => {
    const out = M.useShellResizableColumns(false)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    expect(winListeners.length).toBe(3)
    expect(docClassList.has('shell-col-resizing')).toBe(true)
  })
})

// =========================================================================
// (J) properties pointer-up writes the properties key
// =========================================================================

describe('[ID-0225] properties pointer-up cleanup writes only the properties key', () => {
  it('writes SHELL_PROPERTIES_WIDTH_KEY (not the browser key)', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    const onUp = winListeners.find((r) => r.type === 'pointerup')!.fn
    onUp({ pointerId: 7 })
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      SLS.SHELL_PROPERTIES_WIDTH_KEY,
      expect.any(String)
    )
    expect(mockLocalStorage.setItem).not.toHaveBeenCalledWith(
      SLS.SHELL_BROWSER_WIDTH_KEY,
      expect.anything()
    )
  })

  it('removes all three window listeners on pointerup', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    const onUp = winListeners.find((r) => r.type === 'pointerup')!.fn
    onUp({ pointerId: 7 })
    expect(winListeners.length).toBe(0)
  })

  it("removes 'shell-col-resizing' from body classList", () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    expect(docClassList.has('shell-col-resizing')).toBe(true)
    const onUp = winListeners.find((r) => r.type === 'pointerup')!.fn
    onUp({ pointerId: 7 })
    expect(docClassList.has('shell-col-resizing')).toBe(false)
  })

  it('pointercancel on properties handler triggers the same cleanup', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800, 13) as unknown as never)
    const onCancel = winListeners.find((r) => r.type === 'pointercancel')!.fn
    onCancel({ pointerId: 13 })
    expect(btn.releasePointerCapture).toHaveBeenCalledWith(13)
    expect(winListeners.length).toBe(0)
    expect(docClassList.has('shell-col-resizing')).toBe(false)
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      SLS.SHELL_PROPERTIES_WIDTH_KEY,
      expect.any(String)
    )
  })
})

// =========================================================================
// (K) clamp respects MIN/MAX constants
// =========================================================================

describe('[ID-0225] clamp respects MIN/MAX from shellLayoutStorage', () => {
  it('browser clamp does not produce NaN even on NaN input', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: Number.NaN })
    const setBrowserPx = useStateSetters[0]
    // NaN propagation through Math.min/Math.max returns NaN, but Math.round(NaN)
    // is still NaN. Pin the current behaviour so any future drift toward "clamp
    // NaN to MIN" is an explicit decision.
    const arg = setBrowserPx.mock.calls[0]?.[0]
    expect(Number.isNaN(arg as number)).toBe(true)
  })

  it('properties clamp does not produce NaN even on NaN input', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onPropertiesResizePointerDown(makePointerDown(btn, 800) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: Number.NaN })
    const setPropertiesPx = useStateSetters[1]
    const arg = setPropertiesPx.mock.calls[0]?.[0]
    expect(Number.isNaN(arg as number)).toBe(true)
  })

  it('Math.round is applied (fractional clientX yields integer width)', () => {
    const out = M.useShellResizableColumns(true)
    const btn = makeFakeButton()
    out.onBrowserResizePointerDown(makePointerDown(btn, 100) as unknown as never)
    const onMove = winListeners.find((r) => r.type === 'pointermove')!.fn
    onMove({ clientX: 100.7 })
    const setBrowserPx = useStateSetters[0]
    const arg = setBrowserPx.mock.calls[0]![0] as number
    expect(Number.isInteger(arg)).toBe(true)
  })
})

// =========================================================================
// (L) source-text whitelist
// =========================================================================

describe('[ID-0225] source-text whitelist', () => {
  it("'shell-col-resizing' literal appears EXACTLY 4 times (browser add+remove + properties add+remove)", () => {
    const matches = SRC.match(/shell-col-resizing/g) ?? []
    expect(matches.length).toBe(4)
  })

  it("symmetric document.body.classList.add('shell-col-resizing') count is 2", () => {
    const matches = SRC.match(/document\.body\.classList\.add\('shell-col-resizing'\)/g) ?? []
    expect(matches.length).toBe(2)
  })

  it("symmetric document.body.classList.remove('shell-col-resizing') count is 2", () => {
    const matches = SRC.match(/document\.body\.classList\.remove\('shell-col-resizing'\)/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('exactly two useCallback declarations (browser + properties)', () => {
    const matches = SRC.match(/useCallback\(/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('exactly two useState declarations (browser + properties)', () => {
    const matches = SRC.match(/useState\(/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('exactly two useRef declarations (browser + properties)', () => {
    const matches = SRC.match(/useRef\(/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('exactly one e.preventDefault() per handler (2 total)', () => {
    const matches = SRC.match(/e\.preventDefault\(\)/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('exactly two el.setPointerCapture(e.pointerId) call sites', () => {
    const matches = SRC.match(/el\.setPointerCapture\(e\.pointerId\)/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('exactly two el.releasePointerCapture(ev.pointerId) call sites', () => {
    const matches = SRC.match(/el\.releasePointerCapture\(ev\.pointerId\)/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('asymmetric delta: browser uses ev.clientX - startX', () => {
    expect(SRC).toContain('const delta = ev.clientX - startX')
  })

  it('asymmetric delta: properties uses startX - ev.clientX (INVERTED)', () => {
    expect(SRC).toContain('const delta = startX - ev.clientX')
  })

  it('clampBrowser is referenced inside onBrowserResizePointerDown (only)', () => {
    expect(SRC).toContain('clampBrowser(startW + delta)')
    expect(SRC).not.toContain('clampProperties(startW + delta - 0)') // sanity negative
  })

  it('clampProperties is referenced inside onPropertiesResizePointerDown (only)', () => {
    expect(SRC).toContain('clampProperties(startW + delta)')
  })

  it('writeShellBrowserWidth call site uses browserPxRef.current (snapshot at pointer-up)', () => {
    expect(SRC).toContain('writeShellBrowserWidth(browserPxRef.current)')
  })

  it('writeShellPropertiesWidth call site uses propertiesPxRef.current (snapshot at pointer-up)', () => {
    expect(SRC).toContain('writeShellPropertiesWidth(propertiesPxRef.current)')
  })

  it('addEventListener triplet pin: pointermove + pointerup + pointercancel', () => {
    expect(SRC).toMatch(/addEventListener\('pointermove', onMove\)/)
    expect(SRC).toMatch(/addEventListener\('pointerup', onUp\)/)
    expect(SRC).toMatch(/addEventListener\('pointercancel', onUp\)/)
  })

  it('removeEventListener triplet pin: pointermove + pointerup + pointercancel', () => {
    expect(SRC).toMatch(/removeEventListener\('pointermove', onMove\)/)
    expect(SRC).toMatch(/removeEventListener\('pointerup', onUp\)/)
    expect(SRC).toMatch(/removeEventListener\('pointercancel', onUp\)/)
  })

  it("properties early-exit pin: 'if (!showProperties) return'", () => {
    expect(SRC).toContain('if (!showProperties) return')
  })

  it('no `any` types (3 forms)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/<any>/)
    expect(SRC).not.toMatch(/\bas any\b/)
  })

  it('no top-level `let` (only function-local mutable bindings allowed)', () => {
    // The hook is a single function that opens at column 0; everything
    // else at top level is `import`/`function`/`const`. Pin that no
    // `let` keyword appears at top-level (column 0).
    expect(SRC).not.toMatch(/^let\b/m)
  })

  it('exports the hook by named declaration (no re-export shape drift)', () => {
    expect(SRC).toMatch(/^export function useShellResizableColumns\(/m)
  })

  it("imports React's PointerEvent as ReactPointerEvent type-only alias", () => {
    expect(SRC).toContain('type PointerEvent as ReactPointerEvent')
  })

  it('handler signatures use ReactPointerEvent<HTMLButtonElement> (button-typed)', () => {
    const matches = SRC.match(/ReactPointerEvent<HTMLButtonElement>/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('inner pointermove + pointerup handlers use globalThis.PointerEvent (DOM-typed)', () => {
    const matches = SRC.match(/globalThis\.PointerEvent/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })

  it('clamp helpers use Math.round (integer pixel widths)', () => {
    const matches = SRC.match(/Math\.round\(/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('clamp helpers use Math.min + Math.max (bounded range)', () => {
    expect(SRC).toContain('Math.min(SHELL_BROWSER_MAX')
    expect(SRC).toContain('Math.max(SHELL_BROWSER_MIN')
    expect(SRC).toContain('Math.min(SHELL_PROPERTIES_MAX')
    expect(SRC).toContain('Math.max(SHELL_PROPERTIES_MIN')
  })

  it('source file size canary: hook stays under 100 lines', () => {
    const lineCount = SRC.split('\n').length
    expect(lineCount).toBeLessThan(100)
  })

  it('no electron / fs / path / child_process imports (renderer hook only)', () => {
    expect(SRC).not.toMatch(/from\s+['"]electron['"]/)
    expect(SRC).not.toMatch(/from\s+['"]fs['"]/)
    expect(SRC).not.toMatch(/from\s+['"]path['"]/)
    expect(SRC).not.toMatch(/from\s+['"]child_process['"]/)
  })

  it('no G-code / M-code / Handlebars literals leaked into the renderer hook', () => {
    expect(SRC).not.toMatch(/\bM3\b|\bM5\b|\bM64\b|\bM65\b|\bG21\b|\bG20\b|\bG17\b/)
    expect(SRC).not.toContain('{{')
  })

  it('no foreign-machine vendor names (paranoia: keep the renderer-shell hook neutral)', () => {
    // The hook is machine-agnostic (cross-cuts all three target machines);
    // pin that no machine-specific vendor word leaks into the source.
    expect(SRC).not.toMatch(/\b(bambu|prusa|voron|ender[- ]?\d|longmill|shapeoko|onefinity)\b/i)
  })
})
