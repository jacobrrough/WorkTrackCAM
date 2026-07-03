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
  addFacesToSelection,
  clearSelection,
  isSameEntity,
  makeEdgeSelection,
  makeFaceSelection,
  makeMultiEdgeSelection,
  makeMultiFaceSelection,
  makeVertexSelection,
  selectedEdgeEntries,
  selectedEdgeIds,
  selectedFaceIds,
  selectionToSurface,
  setSelection,
  toggleEdgeInSelection,
  toggleFaceInSelection,
  toggleSelection,
  type EdgePickEntry,
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

// ── WINDOW/BOX SELECT — multi-face selection (Phase 2) ─────────────────────

describe('selectedFaceIds — the single multi-face accessor', () => {
  it('returns [] for null / edge / vertex selections', () => {
    expect(selectedFaceIds(null)).toEqual([])
    expect(selectedFaceIds(makeEdgeSelection(3))).toEqual([])
    expect(selectedFaceIds(makeVertexSelection(3))).toEqual([])
  })

  it('returns [faceId] for a plain single-click face pick', () => {
    expect(selectedFaceIds(makeFaceSelection(7))).toEqual([7])
  })

  it('returns the faceIds payload verbatim for a multi-face pick', () => {
    const multi = makeMultiFaceSelection([4, 9, 2])
    expect(multi).not.toBeNull()
    expect(selectedFaceIds(multi)).toEqual([4, 9, 2])
  })
})

describe('makeMultiFaceSelection — normalization contract', () => {
  it('returns null for an empty id list', () => {
    expect(makeMultiFaceSelection([])).toBeNull()
  })

  it('drops non-finite / non-integer / duplicate ids (and nulls out when nothing survives)', () => {
    expect(makeMultiFaceSelection([Number.NaN, 1.5, Number.POSITIVE_INFINITY])).toBeNull()
    expect(selectedFaceIds(makeMultiFaceSelection([3, 3, Number.NaN, 5, 3]))).toEqual([3, 5])
  })

  it('normalizes a ONE-face set to the classic single shape — no faceIds key', () => {
    const sel = makeMultiFaceSelection([6])
    expect(sel).toEqual({ kind: 'face', faceId: 6 })
    expect(Object.keys(sel ?? {}).sort()).toEqual(['faceId', 'kind'])
  })

  it('a 2+ set carries faceIds and seats the FIRST id as primary by default', () => {
    const sel = makeMultiFaceSelection([8, 2, 5])
    expect(sel).toEqual({ kind: 'face', faceId: 8, faceIds: [8, 2, 5] })
  })

  it('a member primary donates its faceId + occtHash/signature metadata', () => {
    const primary = makeFaceSelection(2, 'f:abc')
    const sel = makeMultiFaceSelection([8, 2, 5], primary)
    expect(sel).toEqual({ kind: 'face', faceId: 2, occtHash: 'f:abc', faceIds: [8, 2, 5] })
  })

  it('a NON-member primary is ignored (never fabricates membership)', () => {
    const primary = makeFaceSelection(99, 'f:zzz')
    const sel = makeMultiFaceSelection([8, 2], primary)
    expect(sel).toEqual({ kind: 'face', faceId: 8, faceIds: [8, 2] })
    expect(sel).not.toHaveProperty('occtHash')
  })
})

describe('addFacesToSelection — box-select union transition', () => {
  it('an empty hit-set changes NOTHING (returns prev by reference)', () => {
    const prev = makeFaceSelection(4)
    expect(addFacesToSelection(prev, [])).toBe(prev)
    expect(addFacesToSelection(null, [])).toBeNull()
  })

  it('selects the boxed set when nothing was selected', () => {
    expect(addFacesToSelection(null, [3, 1])).toEqual({
      kind: 'face',
      faceId: 3,
      faceIds: [3, 1],
    })
  })

  it('a one-face box over nothing behaves exactly like a click (single shape)', () => {
    expect(addFacesToSelection(null, [5])).toEqual({ kind: 'face', faceId: 5 })
  })

  it('unions into an existing face selection, keeping prev primary + metadata', () => {
    const prev = makeFaceSelection(4, 'f:keep')
    const next = addFacesToSelection(prev, [9, 4, 11])
    expect(next).toEqual({
      kind: 'face',
      faceId: 4,
      occtHash: 'f:keep',
      faceIds: [4, 9, 11],
    })
  })

  it('replaces an edge/vertex selection with the boxed face set (kind switch)', () => {
    const prev = makeEdgeSelection(2, 'e:x')
    expect(addFacesToSelection(prev, [7, 8])).toEqual({
      kind: 'face',
      faceId: 7,
      faceIds: [7, 8],
    })
  })

  it('is idempotent for already-selected faces (dedupe union)', () => {
    const prev = addFacesToSelection(null, [1, 2])
    expect(addFacesToSelection(prev, [2, 1])).toEqual({
      kind: 'face',
      faceId: 1,
      faceIds: [1, 2],
    })
  })
})

describe('toggleFaceInSelection — Ctrl/Cmd-click membership toggle', () => {
  it('selects the clicked face when nothing / edge / vertex was selected', () => {
    const next = makeFaceSelection(4)
    expect(toggleFaceInSelection(null, next)).toBe(next)
    expect(toggleFaceInSelection(makeEdgeSelection(4), next)).toBe(next)
  })

  it('ADDS an unselected face — the clicked face becomes primary with metadata', () => {
    const prev = makeFaceSelection(1)
    const clicked = makeFaceSelection(6, 'f:new')
    expect(toggleFaceInSelection(prev, clicked)).toEqual({
      kind: 'face',
      faceId: 6,
      occtHash: 'f:new',
      faceIds: [1, 6],
    })
  })

  it('REMOVES a selected non-primary face — the primary + metadata survive', () => {
    const prev = makeMultiFaceSelection([2, 5, 9], makeFaceSelection(2, 'f:keep'))
    expect(prev).not.toBeNull()
    const next = toggleFaceInSelection(prev, makeFaceSelection(5))
    expect(next).toEqual({ kind: 'face', faceId: 2, occtHash: 'f:keep', faceIds: [2, 9] })
  })

  it('REMOVES the primary — the first survivor is re-seated WITHOUT metadata (honest V1)', () => {
    const prev = makeMultiFaceSelection([2, 5], makeFaceSelection(2, 'f:gone'))
    const next = toggleFaceInSelection(prev, makeFaceSelection(2))
    expect(next).toEqual({ kind: 'face', faceId: 5 })
    expect(next).not.toHaveProperty('occtHash')
  })

  it('removing the LAST face clears the selection to null', () => {
    expect(toggleFaceInSelection(makeFaceSelection(3), makeFaceSelection(3))).toBeNull()
  })

  it('a two-step add/remove round-trips back to the single-face shape', () => {
    const single = makeFaceSelection(1)
    const added = toggleFaceInSelection(single, makeFaceSelection(2))
    const removed = toggleFaceInSelection(added, makeFaceSelection(2))
    expect(removed).toEqual({ kind: 'face', faceId: 1 })
    expect(Object.keys(removed ?? {}).sort()).toEqual(['faceId', 'kind'])
  })
})

describe('multi-face selection — command-surface honesty', () => {
  it('a multi-face selection presents EXACTLY like a single face pick', () => {
    const multi = makeMultiFaceSelection([1, 2, 3])
    expect(selectionToSurface(multi)).toEqual({ hasSelection: true, selectionKind: 'face' })
  })

  it('single-click regression — setSelection still replaces unconditionally', () => {
    const multi = makeMultiFaceSelection([1, 2, 3])
    const single = makeFaceSelection(9)
    // A plain click over a multi-face selection collapses to the new pick.
    expect(setSelection(multi, single)).toBe(single)
  })
})

// ── MULTI-EDGE selection (viewport edge picking, wave 4) ────────────────────

describe('makeMultiEdgeSelection — edge set constructor', () => {
  const entry = (edgeId: number, occtHash?: string): EdgePickEntry =>
    occtHash !== undefined ? { edgeId, occtHash } : { edgeId }

  it('returns null when every ordinal is malformed', () => {
    expect(makeMultiEdgeSelection([])).toBeNull()
    expect(makeMultiEdgeSelection([{ edgeId: Number.NaN }])).toBeNull()
    expect(makeMultiEdgeSelection([{ edgeId: 1.5 }])).toBeNull()
  })

  it('one entry normalizes to a PLAIN single EdgeSelection (no `edges` key)', () => {
    const sel = makeMultiEdgeSelection([entry(4, 'e:abc')])
    expect(sel).toEqual({ kind: 'edge', faceId: 4, occtHash: 'e:abc' })
    expect(sel && 'edges' in sel).toBe(false)
  })

  it('two+ entries carry the `edges` payload + the primary fields', () => {
    const sel = makeMultiEdgeSelection([entry(4, 'e:a'), entry(7, 'e:b')])
    expect(sel?.kind).toBe('edge')
    expect(sel?.faceId).toBe(4) // first entry is primary by default
    expect(sel?.occtHash).toBe('e:a')
    expect(sel?.edges).toEqual([{ edgeId: 4, occtHash: 'e:a' }, { edgeId: 7, occtHash: 'e:b' }])
  })

  it('dedupes by edgeId, first occurrence wins', () => {
    const sel = makeMultiEdgeSelection([entry(4, 'e:a'), entry(4, 'e:dup'), entry(7, 'e:b')])
    expect(selectedEdgeIds(sel)).toEqual([4, 7])
    // The FIRST 4 keeps its metadata (no clobber from the duplicate).
    expect(selectedEdgeEntries(sel)[0]).toEqual({ edgeId: 4, occtHash: 'e:a' })
  })

  it('primaryEdgeId selects which entry donates the primary fields', () => {
    const sel = makeMultiEdgeSelection([entry(4, 'e:a'), entry(7, 'e:b')], 7)
    expect(sel?.faceId).toBe(7)
    expect(sel?.occtHash).toBe('e:b')
  })
})

describe('selectedEdgeIds / selectedEdgeEntries — accessors', () => {
  it('null / face / vertex selections have no edges', () => {
    expect(selectedEdgeIds(null)).toEqual([])
    expect(selectedEdgeIds(makeFaceSelection(2))).toEqual([])
    expect(selectedEdgeIds(makeVertexSelection(3))).toEqual([])
    expect(selectedEdgeEntries(makeFaceSelection(2))).toEqual([])
  })

  it('a single edge pick yields a one-id / one-entry list built from the primary', () => {
    const sel = makeEdgeSelection(5, 'e:x')
    expect(selectedEdgeIds(sel)).toEqual([5])
    expect(selectedEdgeEntries(sel)).toEqual([{ edgeId: 5, occtHash: 'e:x' }])
  })

  it('a multi pick yields one id / one entry per member in order', () => {
    const sel = makeMultiEdgeSelection([{ edgeId: 1, occtHash: 'e:1' }, { edgeId: 9, occtHash: 'e:9' }])
    expect(selectedEdgeIds(sel)).toEqual([1, 9])
    expect(selectedEdgeEntries(sel).map((e) => e.edgeId)).toEqual([1, 9])
  })
})

describe('toggleEdgeInSelection — Ctrl/Cmd-click membership (mirror of faces)', () => {
  it('nothing / face / vertex selected → the clicked edge (plain single pick)', () => {
    const next = makeEdgeSelection(3, 'e:3')
    expect(toggleEdgeInSelection(null, next)).toEqual(next)
    expect(toggleEdgeInSelection(makeFaceSelection(2), next)).toEqual(next)
    expect(toggleEdgeInSelection(makeVertexSelection(1), next)).toEqual(next)
  })

  it('ADDS a new edge → it becomes the PRIMARY, previous rides along', () => {
    const prev = makeEdgeSelection(3, 'e:3')
    const result = toggleEdgeInSelection(prev, makeEdgeSelection(8, 'e:8'))
    expect(result?.kind).toBe('edge')
    expect(selectedEdgeIds(result)).toEqual([3, 8])
    // The clicked edge is the new primary (latest explicit pick).
    expect((result as { faceId: number }).faceId).toBe(8)
    expect((result as { occtHash?: string }).occtHash).toBe('e:8')
  })

  it('REMOVES an already-selected edge; the last removal clears to null', () => {
    const two = makeMultiEdgeSelection([{ edgeId: 3, occtHash: 'e:3' }, { edgeId: 8, occtHash: 'e:8' }])!
    // Toggle 8 off → back to a single-edge selection of 3.
    const afterRemove8 = toggleEdgeInSelection(two, makeEdgeSelection(8, 'e:8'))
    expect(selectedEdgeIds(afterRemove8)).toEqual([3])
    // Toggle the last one off → null.
    expect(toggleEdgeInSelection(makeEdgeSelection(3, 'e:3'), makeEdgeSelection(3, 'e:3'))).toBeNull()
  })

  it('removing the PRIMARY re-seats a survivor as primary, keeping ITS metadata', () => {
    const two = makeMultiEdgeSelection([{ edgeId: 3, occtHash: 'e:3' }, { edgeId: 8, occtHash: 'e:8' }], 3)!
    // Primary is 3; toggling 3 off leaves 8 as the survivor primary WITH e:8.
    const result = toggleEdgeInSelection(two, makeEdgeSelection(3, 'e:3'))
    expect(selectedEdgeIds(result)).toEqual([8])
    expect((result as { occtHash?: string }).occtHash).toBe('e:8')
  })

  it('accumulation flow: three Ctrl-clicks build a 3-edge set', () => {
    let sel: Selection | null = null
    sel = toggleEdgeInSelection(sel, makeEdgeSelection(1, 'e:1'))
    sel = toggleEdgeInSelection(sel, makeEdgeSelection(2, 'e:2'))
    sel = toggleEdgeInSelection(sel, makeEdgeSelection(3, 'e:3'))
    expect(selectedEdgeIds(sel)).toEqual([1, 2, 3])
    expect(selectionToSurface(sel)).toEqual({ hasSelection: true, selectionKind: 'edge' })
  })
})
