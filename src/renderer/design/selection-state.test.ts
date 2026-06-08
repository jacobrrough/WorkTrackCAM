/**
 * Pure-helper test pin for CAD V1 Workflow H selection state.
 *
 * These tests run in the `node` vitest environment (no jsdom, no
 * Three.js) — the selection-state module is intentionally framework-
 * agnostic so this test stays cheap and fast.
 *
 * Pinned contracts:
 *   - `makeFaceSelection(faceId)` produces a `{ kind: 'face', faceId }`
 *     shape with no extra keys when no `occtHash` is provided. Adding a
 *     stray key here would silently break the OCCT-hash migration path
 *     ([Selection V1.5]).
 *   - `setSelection(prev, next)` is the canonical "set" transition --
 *     pure, returns `next` regardless of `prev`. The wrapper exists so
 *     a future telemetry hook lands in exactly one place.
 *   - `toggleSelection(prev, next)` toggles when the click hits the
 *     same entity (clears to null) and replaces otherwise. Equality is
 *     determined by `kind` + `faceId` only -- the OCCT hash is
 *     deliberately ignored so V1 deselect works before the sidecar
 *     starts emitting hashes.
 *   - `clearSelection()` always returns `null`. The named export
 *     ensures consumers can rely on function identity in `useEffect`
 *     dependency arrays.
 *   - `isSameEntity` is symmetric (a == b iff b == a) and reflexive
 *     (a == a) -- both axioms hold for the toggle behavior to be
 *     stable across click order.
 */

import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION_SURFACE,
  clearSelection,
  isSameEntity,
  makeEdgeSelection,
  makeFaceSelection,
  makeVertexSelection,
  selectionToSurface,
  setSelection,
  toggleSelection,
  type Selection,
} from './selection-state'

describe('makeFaceSelection — face constructor', () => {
  it('emits the canonical {kind, faceId} shape with no extra keys when no hash is provided', () => {
    const sel = makeFaceSelection(7)
    expect(sel).toEqual({ kind: 'face', faceId: 7 })
    // Spread keys ⇒ guard against drift (e.g. an accidental
    // `normal: undefined` leaking into the shape).
    expect(Object.keys(sel).sort()).toEqual(['faceId', 'kind'])
  })

  it('includes occtHash only when explicitly provided', () => {
    const withHash = makeFaceSelection(3, 'abc123')
    expect(withHash).toEqual({ kind: 'face', faceId: 3, occtHash: 'abc123' })
    const withoutHash = makeFaceSelection(3)
    expect(withoutHash).not.toHaveProperty('occtHash')
  })
})

describe('setSelection — pure set transition', () => {
  it('returns the next value untouched on a fresh selection (prev=null)', () => {
    const next = makeFaceSelection(2)
    const result = setSelection(null, next)
    expect(result).toBe(next)
  })

  it('replaces the previous selection with the new one (no merge, no array)', () => {
    const prev = makeFaceSelection(1)
    const next = makeFaceSelection(9)
    const result = setSelection(prev, next)
    expect(result).toBe(next)
    expect(result).not.toBe(prev)
  })

  it('accepts null as next (symmetry with React setState signature)', () => {
    expect(setSelection(makeFaceSelection(1), null)).toBeNull()
  })
})

describe('toggleSelection — click-to-deselect behavior', () => {
  it('selects when nothing is selected', () => {
    const next = makeFaceSelection(4)
    expect(toggleSelection(null, next)).toBe(next)
  })

  it('clears when the click hits the currently selected face', () => {
    const same = makeFaceSelection(4)
    // Construct a fresh value with identical faceId / kind so the
    // helper cannot cheat via `===` comparison.
    const clicked = makeFaceSelection(4)
    expect(toggleSelection(same, clicked)).toBeNull()
  })

  it('replaces when the click hits a different face', () => {
    const prev = makeFaceSelection(4)
    const next = makeFaceSelection(7)
    expect(toggleSelection(prev, next)).toBe(next)
  })

  it('ignores occtHash for equality — V1 deselect works before the sidecar emits hashes', () => {
    const withHash = makeFaceSelection(4, 'old-hash')
    const noHash = makeFaceSelection(4)
    // Same faceId, different hash ⇒ still treated as the same entity
    // so the operator can re-click to dismiss.
    expect(toggleSelection(withHash, noHash)).toBeNull()
  })
})

describe('clearSelection — explicit clear', () => {
  it('always returns null regardless of how many times it is called', () => {
    expect(clearSelection()).toBeNull()
    expect(clearSelection()).toBeNull()
  })

  it('preserves function identity (safe for useEffect deps)', () => {
    // Capture twice; useEffect / useCallback consumers rely on this.
    const fn1 = clearSelection
    const fn2 = clearSelection
    expect(fn1).toBe(fn2)
  })
})

describe('isSameEntity — toggle equality axioms', () => {
  it('reflexive: a == a', () => {
    const a = makeFaceSelection(3)
    expect(isSameEntity(a, a)).toBe(true)
  })

  it('symmetric: a == b ⇒ b == a', () => {
    const a: Selection = makeFaceSelection(3)
    const b: Selection = makeFaceSelection(3, 'hash')
    expect(isSameEntity(a, b)).toBe(isSameEntity(b, a))
  })

  it('returns false when kinds differ even at the same faceId', () => {
    const face: Selection = { kind: 'face', faceId: 5 }
    const edge: Selection = { kind: 'edge', faceId: 5 }
    expect(isSameEntity(face, edge)).toBe(false)
  })

  it('returns false when faceIds differ', () => {
    const a = makeFaceSelection(1)
    const b = makeFaceSelection(2)
    expect(isSameEntity(a, b)).toBe(false)
  })
})

describe('makeEdgeSelection / makeVertexSelection — FG-5a edge/vertex constructors', () => {
  it('makeEdgeSelection emits a canonical {kind:edge, faceId} shape, no stray keys', () => {
    const sel = makeEdgeSelection(11)
    expect(sel).toEqual({ kind: 'edge', faceId: 11 })
    expect(Object.keys(sel).sort()).toEqual(['faceId', 'kind'])
  })

  it('makeEdgeSelection carries occtHash only when provided', () => {
    expect(makeEdgeSelection(2, 'h')).toEqual({ kind: 'edge', faceId: 2, occtHash: 'h' })
    expect(makeEdgeSelection(2)).not.toHaveProperty('occtHash')
  })

  it('makeVertexSelection emits a canonical {kind:vertex, faceId} shape', () => {
    const sel = makeVertexSelection(5)
    expect(sel).toEqual({ kind: 'vertex', faceId: 5 })
    expect(Object.keys(sel).sort()).toEqual(['faceId', 'kind'])
  })

  it('edge and face at the same id are NOT the same entity (kind discriminates)', () => {
    expect(isSameEntity(makeFaceSelection(3), makeEdgeSelection(3))).toBe(false)
  })
})

describe('selectionToSurface — command-surface bridge', () => {
  it('maps null to the empty surface (stable reference)', () => {
    expect(selectionToSurface(null)).toBe(EMPTY_SELECTION_SURFACE)
    expect(EMPTY_SELECTION_SURFACE).toEqual({ hasSelection: false })
  })

  it('maps a face selection to { hasSelection: true, selectionKind: face }', () => {
    expect(selectionToSurface(makeFaceSelection(4))).toEqual({
      hasSelection: true,
      selectionKind: 'face',
    })
  })

  it('carries the discriminator for edge + vertex selections', () => {
    expect(selectionToSurface(makeEdgeSelection(1)).selectionKind).toBe('edge')
    expect(selectionToSurface(makeVertexSelection(1)).selectionKind).toBe('vertex')
  })

  it('the empty surface is frozen so callers cannot mutate the shared ref', () => {
    expect(Object.isFrozen(EMPTY_SELECTION_SURFACE)).toBe(true)
  })

  it('returns hasSelection:false ONLY for null (never drops a real pick)', () => {
    const kinds: Selection[] = [
      makeFaceSelection(0),
      makeEdgeSelection(0),
      makeVertexSelection(0),
    ]
    for (const sel of kinds) expect(selectionToSurface(sel).hasSelection).toBe(true)
  })
})
