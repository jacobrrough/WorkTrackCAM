/**
 * useUndo-pin.test.ts -- [ID-0226] Cycle 151 ui-polish paired-pin
 *
 * Pins the contract of `src/renderer/src/useUndo.ts` -- the React hook
 * wrapping the framework-agnostic UndoManager. Provides Ctrl+Z /
 * Ctrl+Shift+Z (and Ctrl+Y) keyboard bindings + re-renders on history
 * changes via `useSyncExternalStore`. The hook had ZERO test coverage
 * of any kind before this pin -- first-time-vitest-visibility cycle.
 * Surfaced during the Cycle 130 ZERO-coverage-helper inventory and
 * named in the Cycle 150 [ID-0221] hand-off (Section 27 of the
 * 2026-04-28 daily plan) as the next ui-polish-slot pull.
 *
 * Sister cycles in the post-Cycle-127-reset paired-pin chain that this
 * pin extends: 119 [ID-0196] / 124 [ID-0201] / 129 [ID-0206] / 130
 * [ID-0207] / 131 [ID-0208] / 132 [ID-0209] / 134 [ID-0210] / 135
 * [ID-0211] / 136 [ID-0212] / 137 [ID-0213] / 139 [ID-0214] / 140
 * [ID-0215] / 142 [ID-0216] / 144 [ID-0217] / 145 [ID-0218] / 146
 * [ID-0220] / 147 [ID-0222] / 149 [ID-0225] / 150 [ID-0221].
 *
 * CROSS-CUTS ALL THREE TARGET MACHINES indirectly -- the undo / redo
 * substrate is shared across every operator workflow on every target
 * machine (Creality K2 Plus FDM tool / setup edits, Laguna Swift 5x10
 * router stock / vacuum-zone edits, Makera Carvera + 4-axis tool /
 * fixture edits). Drift in keyboard bindings, input-element skip
 * logic, useSyncExternalStore tear-free pattern, or singleton lifecycle
 * would degrade the workflow uniformly across the fleet.
 *
 * Pin coverage:
 *   (A) module shape -- exact named-export inventory (2 functions),
 *       arities, type exports (1), no default,
 *   (B) `setSharedUndoManager` singleton lifecycle -- replacement
 *       semantics, idempotency,
 *   (C) UseUndoReturn shape contract -- 7 keys with the documented
 *       names,
 *   (D) source-text whitelist -- React import surface, Ctrl+Z / Cmd+Z
 *       dual-mod binding, INPUT / TEXTAREA / SELECT / isContentEditable
 *       skip-logic, addEventListener / removeEventListener pairing on
 *       `window`, useSyncExternalStore tear-free version-cache pattern,
 *       no `any` (3 forms), `let sharedManager` is the ONLY top-level
 *       `let` (legitimate singleton),
 *   (E) cross-cutting safety -- no electron / fs / G-code / Handlebars
 *       / foreign-machine vendor names.
 *
 * The hook itself cannot be invoked outside a React render tree, so
 * this pin file exercises (A) (B) (C) at the module level + (D) (E) via
 * source-text inspection. Behavioural pins on the keyboard handler /
 * useSyncExternalStore lifecycle are deferred to a follow-up pin that
 * brings in @testing-library/react if/when that dep is added (currently
 * not a project dep per Cycle 149 [ID-0225]).
 *
 * ZERO production-code edits. Pure paired-pin.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './useUndo'
import { setSharedUndoManager } from './useUndo'
import { UndoManager } from './undo-manager'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_PATH = join(__dirname, 'useUndo.ts')
const SRC = readFileSync(SRC_PATH, 'utf8')

// ---------------------------------------------------------------------------
// A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0226] A) module shape', () => {
  it('exports exactly the documented runtime named symbols', () => {
    const stringKeys = Object.keys(M).sort()
    expect(stringKeys).toEqual(['setSharedUndoManager', 'useUndo'].sort())
  })

  it('does NOT expose a default export', () => {
    expect((M as Record<string, unknown>).default).toBeUndefined()
  })

  it('only carries Symbol.toStringTag among Symbol-keyed properties', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M)
    expect(symbolKeys).toEqual([Symbol.toStringTag])
  })

  it('has a null prototype on the ESM namespace object', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('declares Function.length === 0 for useUndo (no args)', () => {
    expect(M.useUndo.length).toBe(0)
  })

  it('declares Function.length === 1 for setSharedUndoManager (manager arg)', () => {
    expect(setSharedUndoManager.length).toBe(1)
  })

  it('both runtime symbols are functions', () => {
    expect(typeof M.useUndo).toBe('function')
    expect(typeof setSharedUndoManager).toBe('function')
  })

  it('does NOT export a `getSharedManager` helper (internal-only)', () => {
    expect((M as Record<string, unknown>).getSharedManager).toBeUndefined()
  })

  it('does NOT export the `sharedManager` mutable binding directly', () => {
    expect((M as Record<string, unknown>).sharedManager).toBeUndefined()
  })

  it('does NOT export the `UndoSnapshot` interface as a runtime value (it is type-only)', () => {
    expect((M as Record<string, unknown>).UndoSnapshot).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// B) setSharedUndoManager singleton lifecycle
// ---------------------------------------------------------------------------

describe('[ID-0226] B) setSharedUndoManager singleton lifecycle', () => {
  it('accepts an UndoManager instance without throwing', () => {
    const m = new UndoManager()
    expect(() => setSharedUndoManager(m)).not.toThrow()
  })

  it('returns void (undefined) -- pure side-effect setter', () => {
    const m = new UndoManager()
    expect(setSharedUndoManager(m)).toBeUndefined()
  })

  it('idempotent for the same manager (call twice; no throw, no return value)', () => {
    const m = new UndoManager()
    setSharedUndoManager(m)
    expect(() => setSharedUndoManager(m)).not.toThrow()
  })

  it('can replace the singleton with a different manager mid-session', () => {
    const a = new UndoManager()
    const b = new UndoManager()
    setSharedUndoManager(a)
    expect(() => setSharedUndoManager(b)).not.toThrow()
  })

  it('two distinct UndoManager instances are NOT === reference-equal', () => {
    const a = new UndoManager()
    const b = new UndoManager()
    expect(a).not.toBe(b)
  })

  it('passing UndoManager via setSharedUndoManager keeps its constructor identity', () => {
    const m = new UndoManager()
    setSharedUndoManager(m)
    expect(m).toBeInstanceOf(UndoManager)
  })

  it('UndoManager construction yields canUndo=false and canRedo=false (clean baseline)', () => {
    const m = new UndoManager()
    expect(m.canUndo).toBe(false)
    expect(m.canRedo).toBe(false)
  })

  it('UndoManager construction yields an empty history', () => {
    const m = new UndoManager()
    expect(m.history).toEqual([])
  })

  it('UndoManager has a numeric `version` counter that starts at 0', () => {
    const m = new UndoManager()
    expect(typeof m.version).toBe('number')
    expect(m.version).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// C) UseUndoReturn shape contract (TypeScript surface)
// ---------------------------------------------------------------------------

describe('[ID-0226] C) UseUndoReturn shape contract', () => {
  it('source declares the UseUndoReturn interface as exported', () => {
    expect(SRC).toMatch(/^export interface UseUndoReturn /m)
  })

  it('UseUndoReturn declares exactly 7 documented members', () => {
    // Scan the interface body for top-level member declarations. Each
    // member is either a field (ident: type) or a method-like field
    // (ident: () => ...). Lines starting with `*` are JSDoc comments
    // and excluded.
    const ifaceMatch = SRC.match(/^export interface UseUndoReturn \{([\s\S]*?)^\}/m)
    expect(ifaceMatch).toBeTruthy()
    const body = ifaceMatch![1]
    // Count member-declaration lines (start with whitespace then an
    // identifier followed by a colon or paren). Exclude JSDoc lines.
    const lines = body.split('\n').map((l) => l.trim())
    const memberLines = lines.filter((l) => /^[a-zA-Z_][a-zA-Z0-9_]*[:?]/.test(l))
    expect(memberLines).toHaveLength(7)
  })

  it('UseUndoReturn includes the `manager` field', () => {
    expect(SRC).toMatch(/^\s*manager:\s*UndoManager$/m)
  })

  it('UseUndoReturn includes the `undo` and `redo` callback fields', () => {
    expect(SRC).toMatch(/^\s*undo:\s*\(\)\s*=>\s*void$/m)
    expect(SRC).toMatch(/^\s*redo:\s*\(\)\s*=>\s*void$/m)
  })

  it('UseUndoReturn includes the `canUndo` and `canRedo` boolean fields', () => {
    expect(SRC).toMatch(/^\s*canUndo:\s*boolean$/m)
    expect(SRC).toMatch(/^\s*canRedo:\s*boolean$/m)
  })

  it('UseUndoReturn includes the `history` readonly array of HistoryEntry', () => {
    expect(SRC).toMatch(/^\s*history:\s*readonly HistoryEntry\[\]$/m)
  })

  it('UseUndoReturn includes the `execute` callback that takes UndoableCommand', () => {
    expect(SRC).toMatch(/^\s*execute:\s*\(cmd:\s*UndoableCommand\)\s*=>\s*void$/m)
  })

  it('UseUndoReturn does NOT expose a setter for `sharedManager` directly', () => {
    const ifaceMatch = SRC.match(/^export interface UseUndoReturn \{([\s\S]*?)^\}/m)
    expect(ifaceMatch![1]).not.toMatch(/sharedManager/)
  })
})

// ---------------------------------------------------------------------------
// D) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0226] D) source-text whitelist', () => {
  it('JSDoc framing names the hook as the React wrapper around UndoManager', () => {
    expect(SRC).toMatch(/useUndo .{0,5}React hook wrapping the framework-agnostic UndoManager/)
  })

  it('JSDoc names Ctrl\\+Z and Ctrl\\+Shift\\+Z bindings', () => {
    expect(SRC).toContain('Ctrl+Z')
    expect(SRC).toContain('Ctrl+Shift+Z')
  })

  it('imports React hooks from `react` (useCallback / useEffect / useMemo / useRef / useSyncExternalStore)', () => {
    expect(SRC).toMatch(
      /import \{ useCallback, useEffect, useMemo, useRef, useSyncExternalStore \} from 'react'/
    )
  })

  it('imports UndoManager (value) from `./undo-manager`', () => {
    expect(SRC).toMatch(/^import \{ UndoManager \} from '\.\/undo-manager'$/m)
  })

  it('imports UndoableCommand + HistoryEntry as type-only from `./undo-manager`', () => {
    expect(SRC).toMatch(
      /^import type \{ UndoableCommand, HistoryEntry \} from '\.\/undo-manager'$/m
    )
  })

  it('declares the singleton with `let sharedManager: UndoManager | null = null` (the ONLY top-level `let`)', () => {
    expect(SRC).toMatch(/^let sharedManager: UndoManager \| null = null$/m)
    const topLevelLets = SRC.match(/^let /gm) ?? []
    expect(topLevelLets).toHaveLength(1)
  })

  it('declares an internal `getSharedManager()` helper (not exported)', () => {
    expect(SRC).toMatch(/^function getSharedManager\(\): UndoManager \{/m)
  })

  it('exports `setSharedUndoManager` with a `UndoManager` parameter', () => {
    expect(SRC).toMatch(/^export function setSharedUndoManager\(m: UndoManager\): void \{/m)
  })

  it('exports the `useUndo` hook with no parameters', () => {
    expect(SRC).toMatch(/^export function useUndo\(\): UseUndoReturn \{/m)
  })

  it('exactly 2 named functions are exported via `export function `', () => {
    const matches = SRC.match(/^export function /gm) ?? []
    expect(matches).toHaveLength(2)
  })

  it('exactly 1 named interface is exported via `export interface `', () => {
    const matches = SRC.match(/^export interface /gm) ?? []
    expect(matches).toHaveLength(1)
  })

  it('NO default export', () => {
    expect(SRC).not.toMatch(/^export default /m)
  })

  it('uses useSyncExternalStore for tear-free reads (CRITICAL JSDoc note present)', () => {
    expect(SRC).toContain('useSyncExternalStore')
    expect(SRC).toMatch(/CRITICAL: getSnapshot MUST return a cached reference/)
  })

  it('caches the snapshot via useRef and the manager.version counter', () => {
    expect(SRC).toMatch(/cachedSnap = useRef<UndoSnapshot>/)
    expect(SRC).toMatch(/cachedSnap\.current\.version === v/)
  })

  it('subscribe wires `mgr.on(\'change\', onStoreChange)`', () => {
    expect(SRC).toMatch(/mgr\.on\('change', onStoreChange\)/)
  })

  it('keyboard handler delegates Cmd/Ctrl detection to matchesUndo / matchesRedo', () => {
    // Post-refactor: the hook dispatches via the central shortcut catalog so
    // the in-app shortcut reference and the runtime stay in lock-step.
    expect(SRC).toMatch(/matchesUndo\(e\)/)
    expect(SRC).toMatch(/matchesRedo\(e\)/)
  })

  it('keyboard handler skips typable targets via the shared `isTypableKeyboardTarget` helper', () => {
    expect(SRC).toMatch(/isTypableKeyboardTarget\(e\.target\)/)
  })

  it('Undo branch calls mgr.undo() after matchesUndo()', () => {
    expect(SRC).toMatch(/matchesUndo\(e\)[\s\S]{0,120}mgr\.undo\(\)/)
  })

  it('Redo branch calls mgr.redo() after matchesRedo()', () => {
    expect(SRC).toMatch(/matchesRedo\(e\)[\s\S]{0,120}mgr\.redo\(\)/)
  })

  it('imports the matchesUndo / matchesRedo / isTypableKeyboardTarget helpers from the shortcut catalog', () => {
    expect(SRC).toMatch(/from '\.\.\/\.\.\/shared\/app-keyboard-shortcuts'/)
    expect(SRC).toMatch(/matchesUndo/)
    expect(SRC).toMatch(/matchesRedo/)
    expect(SRC).toMatch(/isTypableKeyboardTarget/)
  })

  it('keyboard handler calls preventDefault on a matched shortcut', () => {
    const matches = SRC.match(/e\.preventDefault\(\)/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('addEventListener pairs with removeEventListener (cleanup discipline)', () => {
    expect(SRC).toMatch(/window\.addEventListener\('keydown', handler\)/)
    expect(SRC).toMatch(/window\.removeEventListener\('keydown', handler\)/)
  })

  it('returns a fresh object literal with the 7 documented fields', () => {
    expect(SRC).toMatch(/return \{[\s\S]*manager: mgr[\s\S]*undo,[\s\S]*redo,[\s\S]*canUndo:[\s\S]*canRedo:[\s\S]*history:[\s\S]*execute,[\s\S]*\}/)
  })

  it('NO `any` type usage in three forms (`: any`, `<any>`, `as any`)', () => {
    expect(SRC).not.toMatch(/:\s*any\b/)
    expect(SRC).not.toMatch(/<any>/)
    expect(SRC).not.toMatch(/\bas any\b/)
  })

  it('useState is NOT used (the hook uses useSyncExternalStore + useRef + useMemo only)', () => {
    expect(SRC).not.toContain('useState')
  })

  it('useReducer is NOT used (singleton + external store pattern)', () => {
    expect(SRC).not.toContain('useReducer')
  })

  it('useMemo wraps getSharedManager so the same instance is returned across renders', () => {
    expect(SRC).toMatch(/useMemo\(\(\) => getSharedManager\(\), \[\]\)/)
  })

  it('useCallback wraps subscribe / undo / redo / execute (memoized handlers)', () => {
    const matches = SRC.match(/useCallback\(/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(4)
  })

  it('manager.version counter is the staleness key (NOT a deep-equal snapshot compare)', () => {
    expect(SRC).toMatch(/const v = mgr\.version/)
  })
})

// ---------------------------------------------------------------------------
// E) Cross-cutting safety -- no foreign deps, no G-code, no machine bleed
// ---------------------------------------------------------------------------

describe('[ID-0226] E) cross-cutting safety', () => {
  it('NO electron import (renderer-only hook)', () => {
    expect(SRC).not.toMatch(/from 'electron'/)
    expect(SRC).not.toMatch(/from "electron"/)
  })

  it('NO node:fs / node:path / node:url imports (renderer-only hook)', () => {
    expect(SRC).not.toMatch(/from 'node:fs'/)
    expect(SRC).not.toMatch(/from 'node:path'/)
    expect(SRC).not.toMatch(/from 'node:url'/)
  })

  it('NO child_process imports (renderer-only hook)', () => {
    expect(SRC).not.toMatch(/child_process/)
  })

  it('NO Handlebars template tokens (this is a TS hook, NOT a post template)', () => {
    expect(SRC).not.toMatch(/\{\{/)
    expect(SRC).not.toMatch(/\}\}/)
  })

  it('NO G-code or M-code emission (this is UI substrate, NOT a generator)', () => {
    expect(SRC).not.toMatch(/'G\d/)
    expect(SRC).not.toMatch(/'M\d/)
    expect(SRC).not.toMatch(/`G\d/)
    expect(SRC).not.toMatch(/`M\d/)
  })

  it('NO foreign-machine vendor names (Klipper / Moonraker / RichAuto / Bambu / Prusa / Voron / Ender-N / Onefinity / Shapeoko / Longmill)', () => {
    // Word-boundary anchors avoid collisions with "rendere*r*" (matches /\bender/)
    // -- pin must use the digit-suffix Ender-N model regex.
    expect(SRC).not.toMatch(/\bKlipper\b/i)
    expect(SRC).not.toMatch(/\bMoonraker\b/i)
    expect(SRC).not.toMatch(/\bRichAuto\b/i)
    expect(SRC).not.toMatch(/\bbambu/i)
    expect(SRC).not.toMatch(/\bprusa/i)
    expect(SRC).not.toMatch(/\bvoron/i)
    expect(SRC).not.toMatch(/\bender[- ]?\d/i)
    expect(SRC).not.toMatch(/\bonefinity/i)
    expect(SRC).not.toMatch(/\bshapeoko/i)
    expect(SRC).not.toMatch(/\blongmill/i)
  })

  it('NO target-machine string ids (no laguna / k2 / carvera ids in this generic helper)', () => {
    expect(SRC).not.toMatch(/laguna-swift/i)
    expect(SRC).not.toMatch(/creality-k2/i)
    expect(SRC).not.toMatch(/makera-carvera/i)
  })

  it('source file is small (< 130 lines) -- thin React-hook wrapper, no bloat', () => {
    expect(SRC.split('\n').length).toBeLessThan(130)
  })

  it('source file size is < 4 KB -- shared-substrate discipline canary', () => {
    expect(SRC.length).toBeLessThan(4 * 1024)
  })
})
