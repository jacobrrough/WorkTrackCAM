/**
 * DrawingView surface-finish model + render pins (node-env).
 *
 * Sibling of `DrawingView.gdt.test.tsx`. The renderer test environment is `node`
 * (no jsdom, no @testing-library), so the interactive click→persist→re-resolve
 * path in `DrawingView.tsx` cannot be driven through a rendered component. All of
 * that logic lives in the pure `drawing-surface-finish-model.ts` module (the
 * orchestration target), which IS unit-testable. The component's static surface
 * is pinned with `renderToStaticMarkup` exactly like the existing DrawingView
 * pins. This suite covers:
 *
 *   1. Snap-resolved PERSISTENCE — a one-click anchored placement that lands on a
 *      snap point mints a `SurfaceFinishSymbol` whose anchor `refId` is the
 *      snapped feature's `sourceId` and whose `placement` is the resolved
 *      coordinate. The result parses against the persistence schema.
 *   2. The ISO 1302 SVG EMITTER — `surfaceFinishToSvg` draws the check-mark with
 *      the correct material variant (bar / circle / bare), the Ra value, the
 *      machining allowance, and the lay glyph; the layer composes onto a base SVG
 *      before `</svg>`; every emitted value is markup-safe (numbers + fixed
 *      glyphs, no operator free-text → no escaping surface).
 *   3. The DANGLING flag — on re-projection, a symbol whose anchor `refId` is gone
 *      flags `dangling`; a resolved anchor refreshes its placement; a free anchor
 *      never dangles.
 *   4. The DrawingView AFFORDANCE — the populated state renders the surface-finish
 *      toolbar (material / Ra / allowance / lay controls + the place button), and
 *      a supplied `persistedSurfaceFinishes` list composes the symbol SVG into the
 *      canvas. A drawing WITHOUT the prop still renders (back-compat).
 *
 * Safety Rule 1: documentation overlays only — no G-code / STL touched.
 * Safety Rule 3: no `any`.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildSurfaceFinish,
  composeSurfaceFinishIntoSvg,
  formatSurfaceFinishValue,
  isAssociativeSurfaceFinish,
  reanchorSurfaceFinish,
  reanchorSurfaceFinishes,
  surfaceFinishLayerSvg,
  surfaceFinishToSvg,
  SURFACE_FINISH_LAY_GLYPH,
  FREE_ANCHOR_REF_ID,
} from '../drawing-surface-finish-model'
import { buildSnapIndex, type FreshSnapPoint, type ResolvedClick } from '../drawing-annotation-model'
import {
  DrawingView,
  SURFACE_FINISH_LAY_ORDER,
  SURFACE_FINISH_MATERIAL_ORDER,
} from '../DrawingView'
import {
  drawingSheetAnnotationsSchema,
  surfaceFinishSymbolSchema,
  type SurfaceFinishSymbol,
} from '../../../shared/drawing-annotation-schema'

// ── window.fab shim (see DrawingView.test.tsx for rationale) ──────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function snapClick(sourceId: string, x: number, y: number): ResolvedClick {
  return { sourceId, point: { x, y } }
}
function freeClick(x: number, y: number): ResolvedClick {
  return { sourceId: null, point: { x, y } }
}
function snapPoint(id: string, sourceId: string, x: number, y: number): FreshSnapPoint {
  return { id, sourceId, x, y }
}

// ── (A) Anchored-symbol build → persistence ───────────────────────────────────

describe('buildSurfaceFinish — snap-resolved anchored placement', () => {
  it('records the snapped feature sourceId as the anchor refId (the live link)', () => {
    const sym = buildSurfaceFinish(snapClick('e:edge-7', 42, 18), {
      material: 'required',
      ra: 1.6,
      machiningAllowanceMm: 0.5,
      lay: 'perpendicular',
    })
    expect(sym.material).toBe('required')
    expect(sym.ra).toBeCloseTo(1.6)
    expect(sym.machiningAllowanceMm).toBeCloseTo(0.5)
    expect(sym.lay).toBe('perpendicular')
    expect(sym.anchor.refId).toBe('e:edge-7')
    expect(sym.anchor.cachedPoint).toEqual({ x: 42, y: 18 })
    expect(sym.placement).toEqual({ x: 42, y: 18 })
    expect(isAssociativeSurfaceFinish(sym)).toBe(true)
    expect(typeof sym.id).toBe('string')
    expect(sym.id.length).toBeGreaterThan(0)
  })

  it('encodes a free click with the empty refId sentinel (non-associative)', () => {
    const sym = buildSurfaceFinish(freeClick(5, 6), { material: 'any' })
    expect(sym.anchor.refId).toBe(FREE_ANCHOR_REF_ID)
    expect(isAssociativeSurfaceFinish(sym)).toBe(false)
    // A bare symbol omits Ra / allowance / lay entirely.
    expect(sym.ra).toBeUndefined()
    expect(sym.machiningAllowanceMm).toBeUndefined()
    expect(sym.lay).toBeUndefined()
  })

  it('drops a non-finite / negative Ra and a non-positive allowance (schema-safe)', () => {
    const sym = buildSurfaceFinish(snapClick('v:a', 0, 0), {
      material: 'required',
      ra: Number.NaN,
      machiningAllowanceMm: -3,
    })
    expect(sym.ra).toBeUndefined()
    expect(sym.machiningAllowanceMm).toBeUndefined()
  })

  it('a placed symbol parses into the sheet annotations schema (surfaceFinishes)', () => {
    const sym = buildSurfaceFinish(snapClick('v:face-1', 12, 34), {
      material: 'prohibited',
      ra: 3.2,
    })
    const parsed = drawingSheetAnnotationsSchema.parse({ surfaceFinishes: [sym] })
    expect(parsed.surfaceFinishes).toHaveLength(1)
    expect(parsed.surfaceFinishes[0]).toEqual(sym)
    expect(parsed.surfaceFinishes[0].anchor.refId).toBe('v:face-1')
  })

  it('every material id is accepted by the persistence schema', () => {
    for (const material of SURFACE_FINISH_MATERIAL_ORDER) {
      const sym = buildSurfaceFinish(freeClick(0, 0), { material })
      expect(() => surfaceFinishSymbolSchema.parse(sym)).not.toThrow()
    }
  })

  it('every lay id is accepted by the persistence schema', () => {
    for (const lay of SURFACE_FINISH_LAY_ORDER) {
      const sym = buildSurfaceFinish(freeClick(0, 0), { material: 'required', lay })
      expect(() => surfaceFinishSymbolSchema.parse(sym)).not.toThrow()
    }
  })
})

// ── (B) ISO 1302 SVG emitter ──────────────────────────────────────────────────

describe('surfaceFinishToSvg — ISO 1302 / ASME Y14.36 glyph', () => {
  it('always draws the check-mark polyline (the two legs of the vee)', () => {
    const sym = buildSurfaceFinish(freeClick(10, 20), { material: 'any' })
    const svg = surfaceFinishToSvg(sym)
    expect(svg).toContain('<polyline')
    expect(svg).toContain('data-sf-id="' + sym.id + '"')
    expect(svg).toContain('class="surface-finish"')
  })

  it('material=required adds a horizontal bar (closed-triangle variant)', () => {
    const sym = buildSurfaceFinish(freeClick(0, 0), { material: 'required' })
    const svg = surfaceFinishToSvg(sym)
    expect(svg).toContain('<line')
    // No removal-prohibited circle on the required variant.
    expect(svg).not.toContain('<circle')
  })

  it('material=prohibited adds a circle in the vee (no bar)', () => {
    const sym = buildSurfaceFinish(freeClick(0, 0), { material: 'prohibited' })
    const svg = surfaceFinishToSvg(sym)
    expect(svg).toContain('<circle')
    expect(svg).not.toContain('<line')
  })

  it('material=any is the bare check-mark (no bar, no circle)', () => {
    const sym = buildSurfaceFinish(freeClick(0, 0), { material: 'any' })
    const svg = surfaceFinishToSvg(sym)
    expect(svg).not.toContain('<line')
    expect(svg).not.toContain('<circle')
  })

  it('renders the Ra value, the allowance, and the lay glyph as text', () => {
    const sym = buildSurfaceFinish(freeClick(0, 0), {
      material: 'required',
      ra: 1.6,
      machiningAllowanceMm: 0.5,
      lay: 'perpendicular',
    })
    const svg = surfaceFinishToSvg(sym)
    expect(svg).toContain('Ra 1.6')
    expect(svg).toContain('>0.5<')
    expect(svg).toContain('>' + SURFACE_FINISH_LAY_GLYPH.perpendicular + '<')
  })

  it('omits Ra / allowance / lay text when those fields are absent', () => {
    const sym = buildSurfaceFinish(freeClick(0, 0), { material: 'any' })
    const svg = surfaceFinishToSvg(sym)
    expect(svg).not.toContain('Ra ')
    expect(svg).not.toContain('<text')
  })

  it('is markup-safe: a wild Ra value emits only digits + dot (no injection surface)', () => {
    // Every field is numeric / enum, so there is no operator free-text. Even a
    // pathological Ra renders to a bounded decimal string — never markup.
    const sym = buildSurfaceFinish(freeClick(0, 0), { material: 'required', ra: 1234.56789 })
    const svg = surfaceFinishToSvg(sym)
    expect(svg).not.toContain('<script')
    // The Ra text is the formatted number (3 dp cap, trailing zeros trimmed).
    expect(svg).toContain('Ra 1234.568')
  })

  it('flags dangling with the modifier class + data attr', () => {
    const sym = buildSurfaceFinish(snapClick('v:a', 0, 0), { material: 'required', ra: 1.6 })
    const svg = surfaceFinishToSvg(sym, { dangling: true })
    expect(svg).toContain('surface-finish--dangling')
    expect(svg).toContain('data-sf-dangling="true"')
  })
})

describe('formatSurfaceFinishValue', () => {
  it('trims trailing zeros and caps at 3 decimals', () => {
    expect(formatSurfaceFinishValue(1.6)).toBe('1.6')
    expect(formatSurfaceFinishValue(3)).toBe('3')
    expect(formatSurfaceFinishValue(0.125)).toBe('0.125')
    expect(formatSurfaceFinishValue(0.1259)).toBe('0.126')
  })

  it('collapses a non-finite value to 0', () => {
    expect(formatSurfaceFinishValue(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('surfaceFinishLayerSvg / composeSurfaceFinishIntoSvg', () => {
  it('wraps the symbols in a testable layer group', () => {
    const syms = [
      buildSurfaceFinish(freeClick(0, 0), { material: 'required', ra: 1.6 }),
      buildSurfaceFinish(freeClick(5, 5), { material: 'any' }),
    ]
    const layer = surfaceFinishLayerSvg(syms)
    expect(layer).toContain('class="surface-finish-layer"')
    expect(layer).toContain('data-testid="design-drawing-surface-finish-layer"')
    // Both symbols are present.
    expect((layer.match(/data-sf-id=/g) ?? [])).toHaveLength(2)
  })

  it('returns the empty string for no symbols', () => {
    expect(surfaceFinishLayerSvg([])).toBe('')
  })

  it('splices the layer in just before </svg>', () => {
    const base = '<svg width="800" height="600"><rect/></svg>'
    const syms = [buildSurfaceFinish(freeClick(0, 0), { material: 'required', ra: 1.6 })]
    const composed = composeSurfaceFinishIntoSvg(base, syms)
    expect(composed.indexOf('surface-finish-layer')).toBeGreaterThan(composed.indexOf('<rect/>'))
    expect(composed.indexOf('surface-finish-layer')).toBeLessThan(composed.indexOf('</svg>'))
    // The original linework is preserved.
    expect(composed).toContain('<rect/>')
  })

  it('returns the input SVG unchanged when there are no symbols', () => {
    const base = '<svg></svg>'
    expect(composeSurfaceFinishIntoSvg(base, [])).toBe(base)
  })
})

// ── (C) reanchorSurfaceFinish / reanchorSurfaceFinishes — the dangling flag ────

describe('reanchorSurfaceFinish — per-symbol re-resolution', () => {
  it('refreshes a resolved symbol anchor + placement and reports dangling=false', () => {
    const sym = buildSurfaceFinish(snapClick('v:a', 0, 0), { material: 'required', ra: 1.6 })
    const index = buildSnapIndex([snapPoint('s:1', 'v:a', 55, 60)])
    const { symbol: next, dangling } = reanchorSurfaceFinish(sym, index)
    expect(dangling).toBe(false)
    expect(next.anchor.cachedPoint).toEqual({ x: 55, y: 60 })
    expect(next.placement).toEqual({ x: 55, y: 60 })
    // Input is never mutated.
    expect(sym.anchor.cachedPoint).toEqual({ x: 0, y: 0 })
  })

  it('flags dangling and KEEPS the stale anchor when the refId is gone', () => {
    const sym = buildSurfaceFinish(snapClick('v:GONE', 7, 9), { material: 'any' })
    const index = buildSnapIndex([snapPoint('s:1', 'v:a', 1, 1)])
    const { symbol: next, dangling } = reanchorSurfaceFinish(sym, index)
    expect(dangling).toBe(true)
    expect(next.anchor.cachedPoint).toEqual({ x: 7, y: 9 })
  })

  it('a free-anchored symbol never dangles', () => {
    const sym = buildSurfaceFinish(freeClick(3, 4), { material: 'prohibited' })
    const { dangling } = reanchorSurfaceFinish(sym, buildSnapIndex([]))
    expect(dangling).toBe(false)
  })
})

describe('reanchorSurfaceFinishes — list-level dangling set', () => {
  it('collects the ids of every symbol that lost its anchor', () => {
    const kept = buildSurfaceFinish(snapClick('v:a', 0, 0), { material: 'required', ra: 1.6 })
    const lost = buildSurfaceFinish(snapClick('v:GONE', 5, 5), { material: 'any' })
    const fresh = [snapPoint('s:1', 'v:a', 0, 0)]
    const { symbols, danglingIds } = reanchorSurfaceFinishes([kept, lost], fresh)
    expect(symbols).toHaveLength(2)
    expect(danglingIds.has(lost.id)).toBe(true)
    expect(danglingIds.has(kept.id)).toBe(false)
    expect(danglingIds.size).toBe(1)
  })

  it('re-resolved symbols still parse into the persistence schema', () => {
    const sym = buildSurfaceFinish(snapClick('v:a', 0, 0), { material: 'required', ra: 1.6 })
    const { symbols } = reanchorSurfaceFinishes([sym], [snapPoint('s:1', 'v:a', 2, 2)])
    const parsed = drawingSheetAnnotationsSchema.parse({ surfaceFinishes: symbols })
    expect(parsed.surfaceFinishes[0].material).toBe('required')
  })
})

// ── (D) DrawingView affordance + symbol render ────────────────────────────────

describe('DrawingView — surface-finish affordance render contract', () => {
  it('renders the surface-finish toolbar with all four controls + the place button', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-surface-finish-toolbar"')
    expect(html).toContain('data-testid="design-drawing-surface-finish-material"')
    expect(html).toContain('data-testid="design-drawing-surface-finish-ra"')
    expect(html).toContain('data-testid="design-drawing-surface-finish-allowance"')
    expect(html).toContain('data-testid="design-drawing-surface-finish-lay"')
    expect(html).toContain('data-testid="design-drawing-surface-finish-place"')
    expect(html).toContain('Surface finish')
  })

  it('reports an empty surface-finish count by default + hides Clear', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-surface-finish-count"')
    expect(html).toContain('No surface finishes')
    expect(html).not.toContain('data-testid="design-drawing-surface-finish-clear"')
  })

  it('omits the surface-finish toolbar in the empty-state branch', () => {
    const html = renderToStaticMarkup(createElement(DrawingView, { partHandle: null }))
    expect(html).not.toContain('data-testid="design-drawing-surface-finish-toolbar"')
  })

  it('composes a persisted symbol into the canvas SVG (Ra text reaches the markup)', () => {
    const sym: SurfaceFinishSymbol = {
      id: 'sf-1',
      material: 'required',
      ra: 1.6,
      anchor: { refId: 'e1', cachedPoint: { x: 20, y: 8 } },
      placement: { x: 20, y: 8 },
    }
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg width="800" height="600"><rect/></svg>',
        persistedSurfaceFinishes: [sym],
      }),
    )
    // The symbol layer + its Ra text are spliced into the inline SVG host.
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).toContain('surface-finish-layer')
    expect(html).toContain('Ra 1.6')
    // The count reflects the supplied symbol (controlled mode).
    expect(html).toContain('1 surface finish')
  })

  it('reports the plural count + shows Clear when multiple symbols are supplied', () => {
    const mk = (id: string): SurfaceFinishSymbol => ({
      id,
      material: 'any',
      anchor: { refId: '', cachedPoint: { x: 0, y: 0 } },
      placement: { x: 0, y: 0 },
    })
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
        persistedSurfaceFinishes: [mk('a'), mk('b')],
      }),
    )
    expect(html).toContain('2 surface finishes')
    expect(html).toContain('data-testid="design-drawing-surface-finish-clear"')
  })

  it('renders fine for a drawing WITHOUT the surfaceFinishes prop (back-compat)', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg><circle/></svg>',
      }),
    )
    // The base drawing still renders, and the toolbar is present but inert.
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).toContain('<circle')
    expect(html).toContain('data-testid="design-drawing-surface-finish-toolbar"')
    // No symbol layer when none are supplied.
    expect(html).not.toContain('surface-finish-layer')
  })
})
