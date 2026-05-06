/**
 * command-palette-memory-pin.test.ts -- [ID-0208] Cycle 131 test-coverage paired-pin
 *
 * Pins the contract of `src/renderer/commands/command-palette-memory.ts` -- the
 * renderer-side localStorage-backed memory for the Fusion-style command palette
 * (recent-commands LRU + saved filter state). Sister cycles: 119 [ID-0196]
 * derive-features, 124 [ID-0201] viewport3d-bounds, 129 [ID-0206]
 * design-viewport-interaction, 130 [ID-0207] shop-stock-bounds.
 *
 * The module had ZERO test coverage of any kind before this pin -- this is a
 * first-time-vitest-visibility cycle. Surfaced during Cycle 130 inventory as
 * the smallest of four ZERO-coverage helpers (83 lines vs. 89 / 114 / 129).
 *
 * Cross-cuts every machine indirectly -- the command palette is the substrate
 * for the operator's "search and run" Fusion-style UX across all three target
 * machines (K2 Plus FDM / Laguna Swift 5x10 / Carvera + 4-axis). The recent-
 * command LRU is what makes the palette feel responsive after the second use,
 * and the filter state is what keeps `implementedOnly: true` defaulting on so
 * stub commands don't pollute search results.
 *
 * Pin coverage:
 *   (A) module shape -- exported names + types,
 *   (B) localStorage-key constants pinned to their exact wire format,
 *   (C) readRecentCommandIds parse / fallback / cap behaviour,
 *   (D) pushRecentCommandId LRU promote / cap / dedupe behaviour,
 *   (E) readPaletteFilters parse / per-field fallback / default behaviour,
 *   (F) writePaletteFilters round-trip,
 *   (G) workspace + ribbon validator branch coverage,
 *   (H) source-text whitelist pinning the exact key strings, MAX_RECENT
 *       literal, default-filter shape, and the catalog import.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycles 119 / 124 / 129 / 130).
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// --- localStorage shim (Node test environment lacks it) ---------------------
const store: Record<string, string> = {}
const mockLocalStorage = {
  getItem: vi.fn((key: string) => (key in store ? store[key]! : null)),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key]
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(store)) delete store[k]
  }),
  get length() {
    return Object.keys(store).length
  },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null)
}
Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true
})

import type { PaletteFilters } from './command-palette-memory'
const M = await import('./command-palette-memory')
const {
  pushRecentCommandId,
  readPaletteFilters,
  readRecentCommandIds,
  writePaletteFilters
} = M

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'command-palette-memory.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

const RECENT_KEY = 'ufs_cmd_palette_recent'
const FILTER_KEY = 'ufs_cmd_palette_filters'

beforeEach(() => {
  mockLocalStorage.clear()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0208] command-palette-memory module shape', () => {
  it('exports readRecentCommandIds as a function', () => {
    expect(typeof readRecentCommandIds).toBe('function')
  })

  it('exports pushRecentCommandId as a function', () => {
    expect(typeof pushRecentCommandId).toBe('function')
  })

  it('exports readPaletteFilters as a function', () => {
    expect(typeof readPaletteFilters).toBe('function')
  })

  it('exports writePaletteFilters as a function', () => {
    expect(typeof writePaletteFilters).toBe('function')
  })

  it('does not leak the private writeRecentCommandIds / defaultPaletteFilters helpers', () => {
    expect((M as Record<string, unknown>).writeRecentCommandIds).toBeUndefined()
    expect((M as Record<string, unknown>).defaultPaletteFilters).toBeUndefined()
    expect((M as Record<string, unknown>).isWorkspaceFilter).toBeUndefined()
    expect((M as Record<string, unknown>).isRibbonFilter).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// (B) localStorage key constants (pinned via observation)
// ---------------------------------------------------------------------------

describe('[ID-0208] localStorage key constants (observed via writes)', () => {
  it('pushRecentCommandId writes under RECENT_KEY = ufs_cmd_palette_recent', () => {
    pushRecentCommandId('cmd:foo')
    expect(store[RECENT_KEY]).toBeDefined()
    expect(JSON.parse(store[RECENT_KEY]!)).toEqual(['cmd:foo'])
  })

  it('writePaletteFilters writes under FILTER_KEY = ufs_cmd_palette_filters', () => {
    writePaletteFilters({ implementedOnly: false, workspaceFilter: 'design', ribbonFilter: 'all' })
    expect(store[FILTER_KEY]).toBeDefined()
    const parsed = JSON.parse(store[FILTER_KEY]!) as PaletteFilters
    expect(parsed.implementedOnly).toBe(false)
    expect(parsed.workspaceFilter).toBe('design')
    expect(parsed.ribbonFilter).toBe('all')
  })

  it('RECENT_KEY and FILTER_KEY are distinct so reads cannot cross-contaminate', () => {
    pushRecentCommandId('cmd:bar')
    writePaletteFilters({ implementedOnly: true, workspaceFilter: 'all', ribbonFilter: 'all' })
    expect(RECENT_KEY).not.toBe(FILTER_KEY)
    expect(store[RECENT_KEY]).toBeDefined()
    expect(store[FILTER_KEY]).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// (C) readRecentCommandIds
// ---------------------------------------------------------------------------

describe('[ID-0208] readRecentCommandIds', () => {
  it('returns [] when no key is set', () => {
    expect(readRecentCommandIds()).toEqual([])
  })

  it('returns parsed array when stored data is a string array', () => {
    store[RECENT_KEY] = JSON.stringify(['cmd:a', 'cmd:b', 'cmd:c'])
    expect(readRecentCommandIds()).toEqual(['cmd:a', 'cmd:b', 'cmd:c'])
  })

  it('returns [] when stored data is invalid JSON', () => {
    store[RECENT_KEY] = 'not-json{{{'
    expect(readRecentCommandIds()).toEqual([])
  })

  it('returns [] when stored data is a non-array primitive', () => {
    store[RECENT_KEY] = JSON.stringify('a string')
    expect(readRecentCommandIds()).toEqual([])
  })

  it('filters out non-string entries', () => {
    store[RECENT_KEY] = JSON.stringify(['cmd:a', 42, null, 'cmd:b', { x: 1 }, true, 'cmd:c'])
    expect(readRecentCommandIds()).toEqual(['cmd:a', 'cmd:b', 'cmd:c'])
  })

  it('caps the returned slice at MAX_RECENT = 12 (extras ignored)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `cmd:${i}`)
    store[RECENT_KEY] = JSON.stringify(ids)
    const got = readRecentCommandIds()
    expect(got.length).toBe(12)
    expect(got[0]).toBe('cmd:0')
    expect(got[11]).toBe('cmd:11')
  })

  it('returns a fresh array (not a reference to the stored JSON internal)', () => {
    store[RECENT_KEY] = JSON.stringify(['cmd:a'])
    const a = readRecentCommandIds()
    const b = readRecentCommandIds()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// (D) pushRecentCommandId
// ---------------------------------------------------------------------------

describe('[ID-0208] pushRecentCommandId', () => {
  it('inserts a new id at the front of an empty list', () => {
    pushRecentCommandId('cmd:a')
    expect(readRecentCommandIds()).toEqual(['cmd:a'])
  })

  it('promotes an existing id to the front (MRU semantics)', () => {
    pushRecentCommandId('cmd:a')
    pushRecentCommandId('cmd:b')
    pushRecentCommandId('cmd:c')
    pushRecentCommandId('cmd:a') // touch a -> should jump to front
    expect(readRecentCommandIds()).toEqual(['cmd:a', 'cmd:c', 'cmd:b'])
  })

  it('preserves the order of untouched ids when promoting', () => {
    for (const id of ['cmd:a', 'cmd:b', 'cmd:c', 'cmd:d']) pushRecentCommandId(id)
    pushRecentCommandId('cmd:c') // mid-list promotion
    expect(readRecentCommandIds()).toEqual(['cmd:c', 'cmd:d', 'cmd:b', 'cmd:a'])
  })

  it('caps the list at MAX_RECENT = 12 (oldest evicted)', () => {
    for (let i = 0; i < 15; i++) pushRecentCommandId(`cmd:${i}`)
    const got = readRecentCommandIds()
    expect(got.length).toBe(12)
    // Newest at front, oldest 3 evicted.
    expect(got[0]).toBe('cmd:14')
    expect(got[11]).toBe('cmd:3')
  })

  it('idempotent for the same id pushed back-to-back', () => {
    pushRecentCommandId('cmd:a')
    pushRecentCommandId('cmd:a')
    pushRecentCommandId('cmd:a')
    expect(readRecentCommandIds()).toEqual(['cmd:a'])
  })

  it('does not throw when localStorage.setItem throws', () => {
    const original = mockLocalStorage.setItem
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('quota exceeded')
    })
    expect(() => pushRecentCommandId('cmd:a')).not.toThrow()
    mockLocalStorage.setItem = original
  })
})

// ---------------------------------------------------------------------------
// (E) readPaletteFilters
// ---------------------------------------------------------------------------

describe('[ID-0208] readPaletteFilters', () => {
  it('returns defaults when no key is set', () => {
    const f = readPaletteFilters()
    expect(f.implementedOnly).toBe(true)
    expect(f.workspaceFilter).toBe('all')
    expect(f.ribbonFilter).toBe('all')
  })

  it('returns parsed values when stored data is a valid PaletteFilters object', () => {
    store[FILTER_KEY] = JSON.stringify({
      implementedOnly: false,
      workspaceFilter: 'design',
      ribbonFilter: 'sketch_create'
    })
    const f = readPaletteFilters()
    expect(f.implementedOnly).toBe(false)
    expect(f.workspaceFilter).toBe('design')
    expect(f.ribbonFilter).toBe('sketch_create')
  })

  it('falls back to defaults for invalid JSON', () => {
    store[FILTER_KEY] = '{not json'
    expect(readPaletteFilters()).toEqual({
      implementedOnly: true,
      workspaceFilter: 'all',
      ribbonFilter: 'all'
    })
  })

  it('falls back to defaults for non-object JSON', () => {
    store[FILTER_KEY] = JSON.stringify('a string')
    // Note: typeof "a string" === "string", not "object", so the type guard
    // returns defaults -- but the source uses `typeof j !== "object" || j === null`.
    // String passes typeof !== object so falls back. Verified.
    expect(readPaletteFilters()).toEqual({
      implementedOnly: true,
      workspaceFilter: 'all',
      ribbonFilter: 'all'
    })
  })

  it('falls back to defaults for null JSON', () => {
    store[FILTER_KEY] = JSON.stringify(null)
    expect(readPaletteFilters()).toEqual({
      implementedOnly: true,
      workspaceFilter: 'all',
      ribbonFilter: 'all'
    })
  })

  it('per-field fallback: missing implementedOnly defaults to true', () => {
    store[FILTER_KEY] = JSON.stringify({ workspaceFilter: 'design', ribbonFilter: 'all' })
    expect(readPaletteFilters().implementedOnly).toBe(true)
  })

  it('per-field fallback: invalid workspaceFilter defaults to all', () => {
    store[FILTER_KEY] = JSON.stringify({
      implementedOnly: false,
      workspaceFilter: 'not-a-workspace',
      ribbonFilter: 'all'
    })
    expect(readPaletteFilters().workspaceFilter).toBe('all')
  })

  it('per-field fallback: invalid ribbonFilter defaults to all', () => {
    store[FILTER_KEY] = JSON.stringify({
      implementedOnly: false,
      workspaceFilter: 'design',
      ribbonFilter: 'not-a-ribbon-id'
    })
    expect(readPaletteFilters().ribbonFilter).toBe('all')
  })

  it('per-field fallback: wrong-type implementedOnly (number 1) defaults to true', () => {
    store[FILTER_KEY] = JSON.stringify({
      implementedOnly: 1, // not a boolean
      workspaceFilter: 'all',
      ribbonFilter: 'all'
    })
    expect(readPaletteFilters().implementedOnly).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (F) writePaletteFilters
// ---------------------------------------------------------------------------

describe('[ID-0208] writePaletteFilters', () => {
  it('persists the full filter shape to FILTER_KEY', () => {
    writePaletteFilters({
      implementedOnly: false,
      workspaceFilter: 'manufacture',
      ribbonFilter: 'manufacture_3d'
    })
    const parsed = JSON.parse(store[FILTER_KEY]!) as PaletteFilters
    expect(parsed.implementedOnly).toBe(false)
    expect(parsed.workspaceFilter).toBe('manufacture')
    expect(parsed.ribbonFilter).toBe('manufacture_3d')
  })

  it('round-trip: write then read returns the same shape', () => {
    const f: PaletteFilters = {
      implementedOnly: true,
      workspaceFilter: 'utilities',
      ribbonFilter: 'inspect'
    }
    writePaletteFilters(f)
    const got = readPaletteFilters()
    expect(got).toEqual(f)
  })

  it('does not throw when localStorage.setItem throws (quota / disabled storage)', () => {
    const original = mockLocalStorage.setItem
    mockLocalStorage.setItem = vi.fn(() => {
      throw new Error('quota exceeded')
    })
    expect(() =>
      writePaletteFilters({
        implementedOnly: true,
        workspaceFilter: 'all',
        ribbonFilter: 'all'
      })
    ).not.toThrow()
    mockLocalStorage.setItem = original
  })
})

// ---------------------------------------------------------------------------
// (G) Workspace + ribbon validator branch coverage
// ---------------------------------------------------------------------------

describe('[ID-0208] workspace + ribbon validator branches', () => {
  it.each(['all', 'design', 'assemble', 'manufacture', 'utilities'] as const)(
    'workspaceFilter accepts %s',
    (ws) => {
      store[FILTER_KEY] = JSON.stringify({
        implementedOnly: true,
        workspaceFilter: ws,
        ribbonFilter: 'all'
      })
      expect(readPaletteFilters().workspaceFilter).toBe(ws)
    }
  )

  it.each(['unknown', '', 'designer', 'DESIGN', null, 42, true])(
    'workspaceFilter rejects %p (falls back to all)',
    (junk) => {
      store[FILTER_KEY] = JSON.stringify({
        implementedOnly: true,
        workspaceFilter: junk,
        ribbonFilter: 'all'
      })
      expect(readPaletteFilters().workspaceFilter).toBe('all')
    }
  )

  it.each([
    'all',
    'sketch_create',
    'solid_modify',
    'manufacture_setup',
    'manufacture_3d',
    'drawing',
    'inspect'
  ] as const)('ribbonFilter accepts %s (catalog member)', (rb) => {
    store[FILTER_KEY] = JSON.stringify({
      implementedOnly: true,
      workspaceFilter: 'all',
      ribbonFilter: rb
    })
    expect(readPaletteFilters().ribbonFilter).toBe(rb)
  })

  it.each(['random', '', 'sketch_destroy', 42, null])(
    'ribbonFilter rejects %p (falls back to all)',
    (junk) => {
      store[FILTER_KEY] = JSON.stringify({
        implementedOnly: true,
        workspaceFilter: 'all',
        ribbonFilter: junk
      })
      expect(readPaletteFilters().ribbonFilter).toBe('all')
    }
  )
})

// ---------------------------------------------------------------------------
// (H) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0208] command-palette-memory source-text whitelist', () => {
  it("RECENT_KEY literal is exactly 'ufs_cmd_palette_recent'", () => {
    expect(SRC).toContain("const RECENT_KEY = 'ufs_cmd_palette_recent'")
  })

  it("FILTER_KEY literal is exactly 'ufs_cmd_palette_filters'", () => {
    expect(SRC).toContain("const FILTER_KEY = 'ufs_cmd_palette_filters'")
  })

  it('MAX_RECENT literal is exactly 12', () => {
    expect(SRC).toContain('const MAX_RECENT = 12')
  })

  it('imports COMMAND_CATALOG_RIBBON_FILTER_OPTIONS from fusion-style-command-catalog', () => {
    expect(SRC).toContain('COMMAND_CATALOG_RIBBON_FILTER_OPTIONS')
    expect(SRC).toContain("from '../../shared/fusion-style-command-catalog'")
  })

  it('imports CommandRibbonGroup and CommandShellWorkspace types', () => {
    expect(SRC).toContain('type CommandRibbonGroup')
    expect(SRC).toContain('type CommandShellWorkspace')
  })

  it('isWorkspaceFilter validator names the exact 4 workspace literals + all', () => {
    // The source uses an OR chain on the literal strings.
    expect(SRC).toContain("v === 'all'")
    expect(SRC).toContain("v === 'design'")
    expect(SRC).toContain("v === 'assemble'")
    expect(SRC).toContain("v === 'manufacture'")
    expect(SRC).toContain("v === 'utilities'")
  })

  it('default filter shape is { implementedOnly: true, workspaceFilter: all, ribbonFilter: all }', () => {
    expect(SRC).toContain(
      "return { implementedOnly: true, workspaceFilter: 'all', ribbonFilter: 'all' }"
    )
  })

  it('PaletteFilters type is exported with implementedOnly / workspaceFilter / ribbonFilter members', () => {
    expect(SRC).toContain('export type PaletteFilters')
    expect(SRC).toContain('implementedOnly: boolean')
    expect(SRC).toContain('workspaceFilter:')
    expect(SRC).toContain('ribbonFilter:')
  })

  it('VALID_RIBBON is built from COMMAND_CATALOG_RIBBON_FILTER_OPTIONS.map(o => o.id)', () => {
    expect(SRC).toContain('COMMAND_CATALOG_RIBBON_FILTER_OPTIONS.map')
    expect(SRC).toContain('o.id')
  })

  it('all four public functions catch storage errors with try / catch (defensive against private-mode storage)', () => {
    // Each public function wraps its localStorage call in try / catch.
    const publicFns = ['readRecentCommandIds', 'pushRecentCommandId', 'readPaletteFilters', 'writePaletteFilters']
    for (const name of publicFns) {
      expect(SRC).toContain(`function ${name}`)
    }
    // try { localStorage. ... } catch
    const tryCount = (SRC.match(/try\s*\{/g) ?? []).length
    expect(tryCount).toBeGreaterThanOrEqual(4)
  })
})
