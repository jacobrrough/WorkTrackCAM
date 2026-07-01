/**
 * Construction (reference) geometry — renderer-side contracts.
 *
 * Fusion's X-key concept on the WorkTrack3D sketcher:
 *   1. PURE APPLIER — `toggleConstructionOnSelectedSketchEntities` (the
 *      sketch-history seam applier the palette action routes through): each
 *      selected entity toggles INDIVIDUALLY, same-reference no-op on an
 *      empty/stale selection, input never mutated.
 *   2. SURFACE — the palette's Modify group gains a "Construction" ACTION
 *      button (render-pinned; SSR cannot click-select, so the enabled path is
 *      source-pinned to the applyDesignEdit history seam).
 *   3. CANVAS — construction entities stroke DASHED + dimmer and are never
 *      filled; a SELECTED construction entity stays dashed in the selection
 *      green (both states visually distinct). Node-SSR cannot paint a canvas,
 *      so the draw module is source-pinned (the repo's established pattern —
 *      see Sketch2DCanvas.select-render.test.tsx).
 *   4. PREVIEW — `shapesFromEntities` (the Three solid preview) excludes
 *      construction entities, mirroring the kernel-side `extractKernelProfiles`
 *      exclusion so preview and built part always agree.
 *
 * The collinear toolbar button's render presence is covered by
 * SketchSurface.constraints.test.tsx (it loops TOOLBAR_CONSTRAINT_KINDS, which
 * now includes 'collinear'); an explicit belt-and-braces pin lives here too.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyDesign, type DesignFileV2 } from '../../../shared/design-schema'
import { toggleConstructionOnSelectedSketchEntities } from '../sketch-history'
import { CONSTRUCTION_DASH, CONSTRUCTION_STROKE } from '../sketch2d-draw'
import { shapesFromEntities } from '../sketch-mesh'
import { SketchSurface } from '../SketchSurface'

// ── window shim (matches the sibling SketchSurface tests) ────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) gAsRecord['window'] = globalThis
if (gAsRecord['fab'] === undefined) gAsRecord['fab'] = { cad: {} }

const noop = (): void => undefined

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SURFACE_SRC = readFileSync(join(__dirname, '..', 'SketchSurface.tsx'), 'utf8')
const DRAW_SRC = readFileSync(join(__dirname, '..', 'sketch2d-draw.ts'), 'utf8')

function fixture(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
    entities: [
      { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 },
      { id: 'c1', kind: 'circle', cx: 30, cy: 0, r: 5 },
      { id: 'l1', kind: 'polyline', pointIds: ['a', 'b'], closed: false, construction: true }
    ]
  }
}

const sel = (...ids: string[]): Set<string> => new Set(ids)

// ── 1. Pure toggle applier ───────────────────────────────────────────────────

describe('toggleConstructionOnSelectedSketchEntities (pure applier)', () => {
  it('flags a selected normal entity as construction', () => {
    const d = fixture()
    const next = toggleConstructionOnSelectedSketchEntities(d, sel('r1'))
    expect(next).not.toBe(d)
    expect(next.entities.find((e) => e.id === 'r1')?.construction).toBe(true)
    // Unselected entities untouched (same references).
    expect(next.entities.find((e) => e.id === 'c1')).toBe(d.entities[1])
  })

  it('clears the flag on an already-construction entity (round-trips)', () => {
    const d = fixture()
    const once = toggleConstructionOnSelectedSketchEntities(d, sel('l1'))
    expect(once.entities.find((e) => e.id === 'l1')?.construction).toBe(false)
    const twice = toggleConstructionOnSelectedSketchEntities(once, sel('l1'))
    expect(twice.entities.find((e) => e.id === 'l1')?.construction).toBe(true)
  })

  it('MIXED multi-selection toggles each entity individually (Fusion X semantics)', () => {
    const d = fixture()
    const next = toggleConstructionOnSelectedSketchEntities(d, sel('r1', 'l1'))
    expect(next.entities.find((e) => e.id === 'r1')?.construction).toBe(true)
    expect(next.entities.find((e) => e.id === 'l1')?.construction).toBe(false)
  })

  it('empty / stale selection returns the SAME reference (caller skips the undo push)', () => {
    const d = fixture()
    expect(toggleConstructionOnSelectedSketchEntities(d, sel())).toBe(d)
    expect(toggleConstructionOnSelectedSketchEntities(d, sel('ghost'))).toBe(d)
  })

  it('is PURE — the input design is never mutated', () => {
    const d = fixture()
    const before = JSON.stringify(d)
    toggleConstructionOnSelectedSketchEntities(d, sel('r1', 'c1', 'l1'))
    expect(JSON.stringify(d)).toBe(before)
  })
})

// ── 2. SketchSurface — the Construction action button (render + source) ─────

describe('SketchSurface — Construction action (Modify group)', () => {
  const html = renderToStaticMarkup(
    createElement(SketchSurface, { design: fixture(), onDesignChange: noop })
  )

  it('renders the Construction button in the palette, disabled at rest (empty selection)', () => {
    const tag =
      (html.match(/<button[^>]*data-testid="sketch-surface-construction"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).not.toBe('')
    expect(tag).toContain('type="button"')
    expect(tag).toContain('disabled')
  })

  it('the button sits inside the palette (Modify group), not the status row', () => {
    const paletteStart = html.indexOf('data-testid="sketch-surface-palette"')
    const statusStart = html.indexOf('data-testid="sketch-surface-status"')
    const btn = html.indexOf('data-testid="sketch-surface-construction"')
    expect(btn).toBeGreaterThan(paletteStart)
    expect(btn).toBeLessThan(statusStart)
  })

  it('the collinear constraint button is on the constraints toolbar (belt + braces)', () => {
    expect(html).toContain('data-testid="sketch-surface-constraint-collinear"')
  })

  it('SOURCE: the click routes the PURE applier through the applyDesignEdit history seam', () => {
    const body = SURFACE_SRC.slice(
      SURFACE_SRC.indexOf('function handleToggleConstruction'),
      SURFACE_SRC.indexOf('// Surface-level keyboard seam')
    )
    expect(body).toContain('toggleConstructionOnSelectedSketchEntities(cur, ids)')
    expect(body).toContain('if (next === cur) return')
    expect(body).toContain('applyDesignEdit(next)')
  })

  it('SOURCE: the button is gated on the live selection and renders in the Modify group', () => {
    expect(SURFACE_SRC).toContain("{group === 'Modify' && (")
    expect(SURFACE_SRC).toMatch(
      /data-testid="sketch-surface-construction"[\s\S]{0,200}?disabled=\{selectedIds\.length === 0\}/
    )
  })
})

// ── 3. Canvas draw module — dashed + dim render (source pins) ───────────────

describe('sketch2d-draw — construction render pins', () => {
  it('exports the shared dash + stroke tokens (one source of truth)', () => {
    expect(CONSTRUCTION_DASH.length).toBeGreaterThanOrEqual(2)
    expect(CONSTRUCTION_DASH.every((n) => n > 0)).toBe(true)
    // Dimmer than the solid entity stroke: an rgba() with alpha < 1.
    expect(CONSTRUCTION_STROKE).toMatch(/rgba\([^)]*0\.\d+\)/)
  })

  it('the ENTITY loop strokes construction entities dashed/dim/unfilled inside a save/restore fence', () => {
    const loop = DRAW_SRC.slice(
      DRAW_SRC.indexOf('for (const e of entities) {'),
      DRAW_SRC.indexOf('const dims = design.dimensions')
    )
    expect(loop).toContain('const isConstruction = e.construction === true')
    expect(loop).toContain('ctx.setLineDash([...CONSTRUCTION_DASH])')
    expect(loop).toContain('ctx.strokeStyle = CONSTRUCTION_STROKE')
    expect(loop).toContain("ctx.fillStyle = 'transparent'")
    expect(loop).toContain('if (isConstruction) ctx.restore()')
  })

  it('closed construction arcs/splines never fill (profile look reserved for real geometry)', () => {
    expect(
      DRAW_SRC.match(/e\.closed && !isConstruction \? 'rgba\(147, 51, 234, 0\.12\)' : 'transparent'/g) ?? []
    ).toHaveLength(2)
  })

  it('a SELECTED construction entity stays dashed in the selection green (distinct states)', () => {
    const selBlock = DRAW_SRC.slice(
      DRAW_SRC.indexOf('if (selectedEntityIds && selectedEntityIds.size > 0) {'),
      DRAW_SRC.indexOf('nodeEditOverlay &&')
    )
    expect(selBlock).toContain("ctx.strokeStyle = '#4ade80'")
    expect(selBlock).toContain(
      "ctx.setLineDash(e.construction === true ? [...CONSTRUCTION_DASH] : [])"
    )
  })
})

// ── 4. Three preview — construction never previews as solid ─────────────────

describe('sketch-mesh shapesFromEntities — construction exclusion (preview = kernel)', () => {
  it('a construction circle produces NO preview shape; the normal rect still does', () => {
    const d = fixture()
    const shapes = shapesFromEntities(d.entities, d.points)
    // rect + circle are real (2 shapes); flipping the circle to construction drops it.
    expect(shapes).toHaveLength(2)
    const flipped = toggleConstructionOnSelectedSketchEntities(d, sel('c1'))
    expect(shapesFromEntities(flipped.entities, flipped.points)).toHaveLength(1)
  })
})
