/**
 * DrawingView GD&T model — unit pin (model-level, node-env).
 *
 * The renderer test environment is `node` (no jsdom, no @testing-library), so
 * the interactive click→persist→re-resolve path in `DrawingView.tsx` cannot be
 * driven through a rendered component. All of that logic lives in the pure
 * `drawing-gdt-model.ts` module (the orchestration target), which IS
 * unit-testable. This suite pins the GD&T contract `DrawingView` relies on:
 *
 *   1. Snap-resolved PERSISTENCE — a one-click anchored placement that lands on
 *      a snap point mints a `GdtFeatureControlFrame` whose anchor `refId` is the
 *      snapped feature's `sourceId` and whose `cachedPoint`/`placement` is the
 *      resolved coordinate. The result parses against the persistence schema (so
 *      it can be written into `sheet.annotations.featureControlFrames`).
 *   2. The ESCAPING PASSTHROUGH (Safety Rule 4) — the operator free-text that
 *      reaches `<text>` markup on a GD&T frame is the `datums` list. The
 *      model→`cad.annotateGdt`-spec mapping (`gdtFrameToSpec`) must pass a
 *      markup-bearing datum through *verbatim* — NOT escaped — so the sidecar
 *      (the single trust boundary, `_build_fcf_svg`) still receives the raw
 *      string and entity-escapes it. The model must NEITHER drop NOR pre-mangle
 *      the datum (pre-escaping would mask a regression in the real escaping
 *      site). A sibling pytest asserts the sidecar actually escapes it.
 *   3. The DANGLING flag — on re-projection, a frame whose anchor `refId` is gone
 *      flags `dangling` (drawn from the stale cachedPoint fallback); a resolved
 *      anchor refreshes its cachedPoint + placement; a free anchor never dangles.
 *
 * Safety Rule 1: documentation overlays only — no G-code / STL touched.
 * Safety Rule 3: no `any`.
 */

import { describe, expect, it } from 'vitest'
import {
  buildGdtFrame,
  gdtFrameToSpec,
  gdtFramesToSpecs,
  isAssociativeGdtFrame,
  reanchorGdtFrame,
  reanchorGdtFrames,
  FREE_ANCHOR_REF_ID,
} from '../drawing-gdt-model'
import { buildSnapIndex, type FreshSnapPoint, type ResolvedClick } from '../drawing-annotation-model'
import { GDT_CHARACTERISTIC_ORDER, parseDatumField } from '../DrawingView'
import {
  drawingSheetAnnotationsSchema,
  gdtFeatureControlFrameSchema,
} from '../../../shared/drawing-annotation-schema'

// ── Fixtures ────────────────────────────────────────────────────────────────

/** A click that snapped to a feature with the given sourceId. */
function snapClick(sourceId: string, x: number, y: number): ResolvedClick {
  return { sourceId, point: { x, y } }
}

/** A free (un-snapped) click at the given coordinate. */
function freeClick(x: number, y: number): ResolvedClick {
  return { sourceId: null, point: { x, y } }
}

function snapPoint(id: string, sourceId: string, x: number, y: number): FreshSnapPoint {
  return { id, sourceId, x, y }
}

/** A datum string carrying SVG markup — the stored-XSS payload Stack 1 shipped. */
const MARKUP_DATUM = '</text><script>alert(1)</script>'

// ── (A) Anchored-frame build → persistence ───────────────────────────────────

describe('buildGdtFrame — snap-resolved anchored placement', () => {
  it('records the snapped feature sourceId as the anchor refId (the live link)', () => {
    const frame = buildGdtFrame(snapClick('e:edge-7', 42, 18), {
      characteristic: 'position',
      toleranceMm: 0.1,
      datums: ['A', 'B'],
    })
    expect(frame.characteristic).toBe('position')
    expect(frame.toleranceMm).toBeCloseTo(0.1)
    expect(frame.datums).toEqual(['A', 'B'])
    expect(frame.anchor.refId).toBe('e:edge-7')
    expect(frame.anchor.cachedPoint).toEqual({ x: 42, y: 18 })
    // The frame box defaults to the resolved click coordinate.
    expect(frame.placement).toEqual({ x: 42, y: 18 })
    expect(isAssociativeGdtFrame(frame)).toBe(true)
    expect(typeof frame.id).toBe('string')
    expect(frame.id.length).toBeGreaterThan(0)
  })

  it('encodes a free click with the empty refId sentinel (non-associative)', () => {
    const frame = buildGdtFrame(freeClick(5, 6), { characteristic: 'flatness', toleranceMm: 0.05 })
    expect(frame.anchor.refId).toBe(FREE_ANCHOR_REF_ID)
    expect(isAssociativeGdtFrame(frame)).toBe(false)
    expect(frame.datums).toEqual([])
  })

  it('clamps datums to 3 and drops empty entries (schema-safe)', () => {
    const frame = buildGdtFrame(snapClick('v:a', 0, 0), {
      characteristic: 'position',
      toleranceMm: 0.2,
      datums: ['A', '', 'B', 'C', 'D'],
    })
    expect(frame.datums).toEqual(['A', 'B', 'C'])
  })

  it('a placed frame parses into the sheet annotations schema (featureControlFrames)', () => {
    const frame = buildGdtFrame(snapClick('v:hole-1', 12, 34), {
      characteristic: 'position',
      toleranceMm: 0.25,
      datums: ['A', 'B', 'C'],
    })
    const parsed = drawingSheetAnnotationsSchema.parse({ featureControlFrames: [frame] })
    expect(parsed.featureControlFrames).toHaveLength(1)
    expect(parsed.featureControlFrames[0]).toEqual(frame)
    // The associative link survived the round-trip.
    expect(parsed.featureControlFrames[0].anchor.refId).toBe('v:hole-1')
  })

  it('every GD&T characteristic id is accepted by the persistence schema', () => {
    for (const characteristic of GDT_CHARACTERISTIC_ORDER) {
      const frame = buildGdtFrame(freeClick(0, 0), { characteristic, toleranceMm: 0 })
      expect(() => gdtFeatureControlFrameSchema.parse(frame)).not.toThrow()
    }
  })
})

// ── (B) Escaping passthrough (Safety Rule 4) ──────────────────────────────────

describe('gdtFrameToSpec — operator free-text escaping passthrough', () => {
  it('passes a markup-bearing datum through VERBATIM (sidecar is the escaping boundary)', () => {
    const frame = buildGdtFrame(snapClick('v:a', 10, 20), {
      characteristic: 'position',
      toleranceMm: 0.1,
      datums: [MARKUP_DATUM, 'B'],
    })
    const spec = gdtFrameToSpec(frame)
    // The raw payload must reach the sidecar UNCHANGED so the real escaping site
    // (engines/cad/cadquery_drawing.py::_build_fcf_svg) can entity-escape it.
    expect(spec.datums).toEqual([MARKUP_DATUM, 'B'])
    // It must NOT have been pre-escaped at the model layer (that would mask a
    // regression in the sidecar escaping).
    expect(spec.datums?.[0]).toBe(MARKUP_DATUM)
    expect(spec.datums?.[0]).not.toContain('&lt;script&gt;')
    // And it must NOT have been silently dropped.
    expect(spec.datums).toHaveLength(2)
  })

  it('maps the frame box placement to the resolved anchor cachedPoint', () => {
    const frame = buildGdtFrame(snapClick('v:a', 7, 9), {
      characteristic: 'flatness',
      toleranceMm: 0.05,
    })
    const spec = gdtFrameToSpec(frame)
    expect(spec.placement).toEqual({ x: 7, y: 9 })
    expect(spec.characteristic).toBe('flatness')
    expect(spec.toleranceMm).toBeCloseTo(0.05)
    // No datums → the spec omits the field entirely (sidecar default).
    expect(spec.datums).toBeUndefined()
  })

  it('gdtFramesToSpecs preserves render order and per-frame datums verbatim', () => {
    const frames = [
      buildGdtFrame(snapClick('v:a', 0, 0), {
        characteristic: 'position',
        toleranceMm: 0.1,
        datums: [MARKUP_DATUM],
      }),
      buildGdtFrame(snapClick('v:b', 1, 1), { characteristic: 'parallelism', toleranceMm: 0.2 }),
    ]
    const specs = gdtFramesToSpecs(frames)
    expect(specs).toHaveLength(2)
    expect(specs[0].datums).toEqual([MARKUP_DATUM])
    expect(specs[1].characteristic).toBe('parallelism')
  })
})

// ── (C) parseDatumField ───────────────────────────────────────────────────────

describe('parseDatumField', () => {
  it('splits on commas and whitespace, de-dupes, caps at 3', () => {
    expect(parseDatumField('A, B C')).toEqual(['A', 'B', 'C'])
    expect(parseDatumField('A A B')).toEqual(['A', 'B'])
    expect(parseDatumField('A B C D E')).toEqual(['A', 'B', 'C'])
    expect(parseDatumField('   ')).toEqual([])
  })

  it('does NOT escape — operator markup survives the parse for the sidecar to escape', () => {
    // A single token containing no separators passes through verbatim.
    expect(parseDatumField('<b>X</b>')).toEqual(['<b>X</b>'])
  })
})

// ── (D) reanchorGdtFrame / reanchorGdtFrames — the dangling flag ──────────────

describe('reanchorGdtFrame — per-frame re-resolution', () => {
  it('refreshes a resolved frame anchor + placement and reports dangling=false', () => {
    const frame = buildGdtFrame(snapClick('v:a', 0, 0), {
      characteristic: 'position',
      toleranceMm: 0.1,
      datums: ['A'],
    })
    // Part regenerated: same feature, new projected coordinate.
    const index = buildSnapIndex([snapPoint('s:1', 'v:a', 55, 60)])
    const { frame: next, dangling } = reanchorGdtFrame(frame, index)
    expect(dangling).toBe(false)
    expect(next.anchor.cachedPoint).toEqual({ x: 55, y: 60 })
    expect(next.placement).toEqual({ x: 55, y: 60 }) // box tracks the anchor
    // Input is never mutated.
    expect(frame.anchor.cachedPoint).toEqual({ x: 0, y: 0 })
  })

  it('flags dangling and KEEPS the stale anchor when the refId is gone', () => {
    const frame = buildGdtFrame(snapClick('v:GONE', 7, 9), {
      characteristic: 'flatness',
      toleranceMm: 0.05,
    })
    const index = buildSnapIndex([snapPoint('s:1', 'v:a', 1, 1)])
    const { frame: next, dangling } = reanchorGdtFrame(frame, index)
    expect(dangling).toBe(true)
    expect(next.anchor.cachedPoint).toEqual({ x: 7, y: 9 }) // graceful fallback
  })

  it('a free-anchored frame never dangles', () => {
    const frame = buildGdtFrame(freeClick(3, 4), { characteristic: 'circularity', toleranceMm: 0.02 })
    const { dangling } = reanchorGdtFrame(frame, buildSnapIndex([]))
    expect(dangling).toBe(false)
  })
})

describe('reanchorGdtFrames — list-level dangling set', () => {
  it('collects the ids of every frame that lost its anchor', () => {
    const kept = buildGdtFrame(snapClick('v:a', 0, 0), { characteristic: 'position', toleranceMm: 0.1 })
    const lost = buildGdtFrame(snapClick('v:GONE', 5, 5), { characteristic: 'flatness', toleranceMm: 0.05 })
    const fresh = [snapPoint('s:1', 'v:a', 0, 0)]
    const { frames, danglingIds } = reanchorGdtFrames([kept, lost], fresh)
    expect(frames).toHaveLength(2)
    expect(danglingIds.has(lost.id)).toBe(true)
    expect(danglingIds.has(kept.id)).toBe(false)
    expect(danglingIds.size).toBe(1)
  })

  it('with NO fresh snap points every associative frame dangles, free ones do not', () => {
    const assoc = buildGdtFrame(snapClick('v:a', 0, 0), { characteristic: 'position', toleranceMm: 0.1 })
    const free = buildGdtFrame(freeClick(0, 0), { characteristic: 'flatness', toleranceMm: 0.05 })
    const { danglingIds } = reanchorGdtFrames([assoc, free], [])
    expect(danglingIds.has(assoc.id)).toBe(true)
    expect(danglingIds.has(free.id)).toBe(false)
  })

  it('re-resolved frames still parse into the persistence schema', () => {
    const frame = buildGdtFrame(snapClick('v:a', 0, 0), {
      characteristic: 'position',
      toleranceMm: 0.1,
      datums: ['A'],
    })
    const { frames } = reanchorGdtFrames([frame], [snapPoint('s:1', 'v:a', 2, 2)])
    const parsed = drawingSheetAnnotationsSchema.parse({ featureControlFrames: frames })
    expect(parsed.featureControlFrames[0].characteristic).toBe('position')
  })
})
