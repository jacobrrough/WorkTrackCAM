import { describe, it, expect } from 'vitest'
import {
  isCadEdgeMapEntry,
  isCadEdgePolyline,
  isSidecarResponse,
  type CadProjectDrawingParams,
  type CadTessellateWithIdsResult,
} from './sidecar-protocol'

describe('isSidecarResponse', () => {
  it('accepts a valid success envelope', () => {
    expect(
      isSidecarResponse({
        id: 'req-1',
        ok: true,
        result: { pong: true, version: '0.1.0' },
      }),
    ).toBe(true)
  })

  it('accepts a valid error envelope (no detail)', () => {
    expect(
      isSidecarResponse({
        id: 'req-1',
        ok: false,
        error: { code: 'unknown_method', message: 'Unknown method: foo' },
      }),
    ).toBe(true)
  })

  it('accepts a valid error envelope (with detail)', () => {
    expect(
      isSidecarResponse({
        id: 'req-1',
        ok: false,
        error: { code: 'handler_error', message: 'kaboom', detail: 'traceback...' },
      }),
    ).toBe(true)
  })

  it('rejects non-object values', () => {
    expect(isSidecarResponse(null)).toBe(false)
    expect(isSidecarResponse(undefined)).toBe(false)
    expect(isSidecarResponse('string')).toBe(false)
    expect(isSidecarResponse(42)).toBe(false)
    expect(isSidecarResponse([])).toBe(false)
  })

  it('rejects missing or empty id', () => {
    expect(isSidecarResponse({ ok: true, result: {} })).toBe(false)
    expect(isSidecarResponse({ id: '', ok: true, result: {} })).toBe(false)
    expect(isSidecarResponse({ id: 42, ok: true, result: {} })).toBe(false)
  })

  it('rejects missing ok discriminant', () => {
    expect(isSidecarResponse({ id: 'x', result: {} })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: 'true', result: {} })).toBe(false)
  })

  it('rejects success envelope with non-object result', () => {
    expect(isSidecarResponse({ id: 'x', ok: true, result: 'bad' })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: true, result: null })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: true })).toBe(false)
  })

  it('rejects error envelope with missing or wrong-shape error', () => {
    expect(isSidecarResponse({ id: 'x', ok: false })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: false, error: {} })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: false, error: { code: 'c' } })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: false, error: { message: 'm' } })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: false, error: { code: 42, message: 'm' } })).toBe(false)
  })
})

// ── SIDECAR EDGE-ID EMISSION (Phase-2 parity) ──────────────────────────────
//
// The `cad.tessellate_with_ids` result carries per-edge sampled polylines
// (`edges`), the metadata dict keyed by the same stable ids (`edgeMap`), and
// the honest `edgesTruncated` flag. These guards are the shared wire-shape
// contract the main-process coercer and the renderer's edge overlay both
// depend on — malformed entries are droppable per-edge, and a pre-edge-emission
// response (no edge fields at all) must still validate at the envelope level.

/** A minimal well-formed tessellation result WITHOUT any edge data (the shape
 * an older sidecar build returns) — must still satisfy the envelope guard. */
const legacyResult = {
  vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
  faceIds: [0],
  triangleCount: 1,
  bbox: { min: [0, 0, 0], max: [1, 1, 0] },
  faceMap: { '0': { kind: 'face', occtHash: 0, occtId: 'f:abc', area: 0.5 } },
}

const edgePolyline = {
  id: 'e:00aa11bb22cc33dd',
  points: [
    [0, 0, 0],
    [10, 0, 0],
  ],
}

const edgeMapEntry = {
  kind: 'edge',
  occtId: 'e:00aa11bb22cc33dd',
  occtHash: 0,
  length: 10,
}

describe('edge-emission envelope back-compat', () => {
  it('accepts a success envelope WITHOUT edge data (older sidecar build)', () => {
    expect(isSidecarResponse({ id: 'req-1', ok: true, result: legacyResult })).toBe(true)
  })

  it('accepts a success envelope WITH edges + edgeMap + edgesTruncated', () => {
    const result = {
      ...legacyResult,
      edgeMap: { [edgeMapEntry.occtId]: edgeMapEntry },
      edges: [edgePolyline],
      edgesTruncated: false,
    }
    expect(isSidecarResponse({ id: 'req-1', ok: true, result })).toBe(true)
    // Compile-time pin: the full literal (with the optional flag) satisfies
    // the wire type — drift in the field names breaks this assignment.
    const typed: CadTessellateWithIdsResult = {
      vertices: result.vertices,
      indices: result.indices,
      faceIds: result.faceIds,
      triangleCount: 1,
      bbox: { min: [0, 0, 0], max: [1, 1, 0] },
      faceMap: { '0': { kind: 'face', occtHash: 0, occtId: 'f:abc', area: 0.5 } },
      edgeMap: { 'e:00aa11bb22cc33dd': { kind: 'edge', occtId: 'e:00aa11bb22cc33dd', occtHash: 0, length: 10 } },
      edges: [{ id: 'e:00aa11bb22cc33dd', points: [[0, 0, 0], [10, 0, 0]] }],
      edgesTruncated: false,
    }
    expect(typed.edges).toHaveLength(1)
  })
})

describe('isCadEdgePolyline', () => {
  it('accepts a straight 2-point polyline', () => {
    expect(isCadEdgePolyline(edgePolyline)).toBe(true)
  })

  it('accepts a dense curved polyline', () => {
    const points = Array.from({ length: 32 }, (_v, i) => [
      Math.cos(i / 5),
      Math.sin(i / 5),
      2.5,
    ])
    expect(isCadEdgePolyline({ id: 'e:ff00ff00ff00ff00', points })).toBe(true)
  })

  it('rejects malformed polylines', () => {
    expect(isCadEdgePolyline(null)).toBe(false)
    expect(isCadEdgePolyline([])).toBe(false)
    expect(isCadEdgePolyline({})).toBe(false)
    // Empty / missing / non-string id.
    expect(isCadEdgePolyline({ ...edgePolyline, id: '' })).toBe(false)
    expect(isCadEdgePolyline({ points: edgePolyline.points })).toBe(false)
    expect(isCadEdgePolyline({ ...edgePolyline, id: 42 })).toBe(false)
    // Missing / short / malformed points.
    expect(isCadEdgePolyline({ id: 'e:x' })).toBe(false)
    expect(isCadEdgePolyline({ id: 'e:x', points: [[0, 0, 0]] })).toBe(false)
    expect(isCadEdgePolyline({ id: 'e:x', points: [[0, 0], [1, 1]] })).toBe(false)
    expect(isCadEdgePolyline({ id: 'e:x', points: [[0, 0, 0], [1, 1, Number.NaN]] })).toBe(false)
    expect(isCadEdgePolyline({ id: 'e:x', points: [[0, 0, 0], [1, 1, Infinity]] })).toBe(false)
    expect(isCadEdgePolyline({ id: 'e:x', points: [[0, 0, 0], 'not-a-point'] })).toBe(false)
    expect(isCadEdgePolyline({ id: 'e:x', points: 'not-an-array' })).toBe(false)
  })
})

describe('isCadEdgeMapEntry', () => {
  it('accepts a well-formed entry', () => {
    expect(isCadEdgeMapEntry(edgeMapEntry)).toBe(true)
  })

  it('accepts an entry with the optional Tier-2 signature riding along', () => {
    expect(
      isCadEdgeMapEntry({
        ...edgeMapEntry,
        signature: { kind: 'line', lengthRank: 0, midpointOctant: 13, incidentFaceKinds: 'plane|plane' },
      }),
    ).toBe(true)
  })

  it('rejects malformed entries', () => {
    expect(isCadEdgeMapEntry(null)).toBe(false)
    expect(isCadEdgeMapEntry([])).toBe(false)
    expect(isCadEdgeMapEntry({})).toBe(false)
    // Wrong discriminant (a faceMap entry is NOT an edgeMap entry).
    expect(isCadEdgeMapEntry({ ...edgeMapEntry, kind: 'face' })).toBe(false)
    // Missing / empty / non-string occtId.
    expect(isCadEdgeMapEntry({ ...edgeMapEntry, occtId: '' })).toBe(false)
    expect(isCadEdgeMapEntry({ kind: 'edge', occtHash: 0, length: 10 })).toBe(false)
    // Non-finite numerics.
    expect(isCadEdgeMapEntry({ ...edgeMapEntry, occtHash: Number.NaN })).toBe(false)
    expect(isCadEdgeMapEntry({ ...edgeMapEntry, length: Infinity })).toBe(false)
    expect(isCadEdgeMapEntry({ ...edgeMapEntry, length: 'ten' })).toBe(false)
  })
})


describe('CadProjectDrawingParams — includeHlr additive back-compat', () => {
  it('compiles WITHOUT includeHlr (older renderer / back-compat)', () => {
    // Compile-time pin: the pre-HLR payload shape must still satisfy the wire
    // type. If includeHlr were made required, this assignment would fail to
    // compile and break every existing caller.
    const legacy: CadProjectDrawingParams = { handle: 'script:abc', view: 'front' }
    expect(legacy.handle).toBe('script:abc')
    expect(legacy.view).toBe('front')
    // includeHlr is optional -> undefined when omitted.
    expect(legacy.includeHlr).toBeUndefined()
  })

  it('compiles WITH includeHlr: true (HLR opt-in)', () => {
    const hlr: CadProjectDrawingParams = {
      handle: 'script:abc',
      view: 'iso',
      includeHlr: true,
    }
    expect(hlr.includeHlr).toBe(true)
  })

  it('compiles WITH includeHlr: false (explicit mesh-edge)', () => {
    const plain: CadProjectDrawingParams = {
      handle: 'script:abc',
      view: 'top',
      includeHlr: false,
    }
    expect(plain.includeHlr).toBe(false)
  })
})
