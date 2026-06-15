/**
 * Sketch S4 -- render + source contracts for the session-wired Sketch2DCanvas
 * dimension tool + the select-mode inline value editor.
 *
 * Repo tests are node-SSR (renderToStaticMarkup; no jsdom / pointer events), so
 * per the S1/S2/S3 convention this file pins:
 *   - the load-bearing resolvers as PURE units (sketch2d-dimension-pick.test.ts
 *     + the other agent's sketch-dimension-drive.test.ts);
 *   - the DOM-visible halves as markup (the dimension toolbar + the diameter
 *     toggle; the additive-prop byte-identity);
 *   - the pointer halves SSR cannot click (the placement gesture + the inline
 *     editor open/commit) as source text.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DesignFileV2 } from '../../../shared/design-schema'
import { emptyDesign } from '../../../shared/design-schema'
import { Sketch2DCanvas } from '../Sketch2DCanvas'

type CanvasProps = ComponentProps<typeof Sketch2DCanvas>

function fixtureDesign(): DesignFileV2 {
  return {
    ...emptyDesign(),
    points: { a: { x: 0, y: 0 }, b: { x: 20, y: 0 }, c: { x: 20, y: 10 } },
    entities: [
      { id: 'c1', kind: 'circle', cx: 40, cy: 0, r: 6 },
      { id: 'pl1', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: false }
    ]
  }
}

function markup(extra: Partial<CanvasProps> = {}): string {
  const props: CanvasProps = {
    width: 800,
    height: 600,
    design: fixtureDesign(),
    onDesignChange: () => undefined,
    activeTool: 'line',
    gridMm: 5,
    ...extra
  }
  return renderToStaticMarkup(createElement(Sketch2DCanvas, props))
}

/** The S4 callbacks, wired with no-ops. */
function s4Wired(): Partial<CanvasProps> {
  return {
    onPlaceDimension: () => undefined,
    onCommitDimensionValue: () => undefined
  }
}

describe('Sketch2DCanvas dimension tool -- render contract (node-SSR)', () => {
  it('S4 props absent on a non-dimension tool -> byte-identical with or without them', () => {
    const baseline = markup()
    const withProps = markup({ ...s4Wired() })
    expect(withProps).toBe(baseline)
  })

  it('dimension tool UNWIRED -> no dimension toolbar (inert)', () => {
    const html = markup({ activeTool: 'dimension' })
    expect(html).not.toContain('data-testid="sketch-dimension-toolbar"')
  })

  it('dimension tool + wired -> toolbar with the diameter toggle + cancel', () => {
    const html = markup({ activeTool: 'dimension', ...s4Wired() })
    expect(html).toContain('data-testid="sketch-dimension-toolbar"')
    expect(html).toContain('data-testid="sketch-dimension-diameter-toggle"')
    expect(html).toContain('data-testid="sketch-dimension-cancel"')
    // No first pick yet -> cancel disabled, "Click a vertex to start" prompt.
    expect(html).toMatch(/data-testid="sketch-dimension-cancel"[^>]*disabled/)
    expect(html).toContain('Click a vertex to start a dimension')
  })

  it('the inline editor is NOT in the initial markup (it opens on a label click)', () => {
    // editingDim starts null; SSR cannot flush the click that opens it.
    const html = markup({ activeTool: 'select', ...s4Wired(), onEntityPick: () => undefined })
    expect(html).not.toContain('data-testid="sketch-dimension-edit-input"')
  })

  it('every interactive element in the dimension toolbar is a type="button" or input', () => {
    const html = markup({ activeTool: 'dimension', ...s4Wired() })
    const buttons = html.match(/<button[^>]*data-testid="sketch-dimension-cancel"[^>]*>/g) ?? []
    expect(buttons.length).toBe(1)
    expect(buttons[0]).toContain('type="button"')
  })
})

const SRC = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')
const DRAW = readFileSync(resolve(__dirname, '../sketch2d-draw.ts'), 'utf-8')

describe('Sketch2DCanvas dimension tool -- source pins (pointer halves SSR cannot click)', () => {
  it("the SketchTool union gained 'dimension' right after 'select'", () => {
    expect(SRC).toMatch(/export type SketchTool =\s+\| 'select'\s+\| 'dimension'\s+\| 'point'/)
  })

  it('the dimension branch emits a radial/diameter intent on a circle/arc pick', () => {
    expect(SRC).toContain("if (activeTool === 'dimension') {")
    expect(SRC).toContain('if (!onPlaceDimension) return')
    expect(SRC).toContain("{ kind: 'diameter', entityId: entHit.entityId }")
    expect(SRC).toContain("{ kind: 'radial', entityId: entHit.entityId }")
    // diameter when the toolbar toggle is on OR Shift is held.
    expect(SRC).toContain('const wantDiameter = dimDiameterMode || ev.shiftKey')
  })

  it('aligned point picks must snap to an EXISTING vertex id (no loose-point race)', () => {
    expect(SRC).toContain('const vid = nearestPointIdWithin(design, raw, osnapToleranceMm(scale))')
    expect(SRC).toContain('setDimFirstPoint(vid)')
    expect(SRC).toContain("onPlaceDimension({ kind: 'aligned', aId: dimFirstPoint, bId: vid })")
  })

  it('the select branch opens the inline editor when a dimension label is clicked', () => {
    // Resolved at the RAW point, BEFORE the entity hit-test, only when wired.
    expect(SRC).toContain('if (onCommitDimensionValue) {')
    expect(SRC).toContain(
      'const dimHit = hitTestDimensionLabel(design, raw, dimensionLabelPickToleranceMm(scale))'
    )
    expect(SRC).toContain('setEditingDim({ dimId: dimHit.dimId, anchorWorld: dimHit.anchorWorld })')
    // pre-fills with the current (driven-or-measured) value.
    expect(SRC).toContain('dimensionCurrentValue(dm, design)')
  })

  it('the inline editor commits ONE (dimId, value) on Enter/blur and cancels on Esc', () => {
    expect(SRC).toContain('data-testid="sketch-dimension-edit-input"')
    expect(SRC).toMatch(/if \(Number\.isFinite\(v\)\) onCommitDimensionValue\(editingDim\.dimId, v\)/)
    // exactly one commit call site.
    expect(SRC.match(/onCommitDimensionValue\(editingDim\.dimId, v\)/g) ?? []).toHaveLength(1)
    expect(SRC).toContain('onBlur={commit}')
    expect(SRC).toMatch(/e\.key === 'Escape'[\s\S]{0,140}?cancel\(\)/)
  })

  it('the editor is latched against a double-finalize (Enter/Esc then unmount blur)', () => {
    // Enter/Esc closes the input; React fires blur on unmount, which would
    // commit a SECOND time (two undo steps) without this guard.
    expect(SRC).toContain('const dimEditDoneRef = useRef(false)')
    expect(SRC).toMatch(/const commit = \(\): void => \{\s*\n\s*if \(dimEditDoneRef\.current\) return/)
    expect(SRC).toMatch(/const cancel = \(\): void => \{\s*\n\s*if \(dimEditDoneRef\.current\) return/)
    // the latch resets when a fresh editor opens.
    expect(SRC).toContain('dimEditDoneRef.current = false')
  })

  it('the editor closes when leaving select mode or losing the commit wiring', () => {
    expect(SRC).toMatch(
      /if \(activeTool !== 'select' \|\| !onCommitDimensionValue\) setEditingDim\(null\)/
    )
  })

  it('the dimension draft is torn down on tool switch (mirrors the other drafts)', () => {
    expect(SRC).toMatch(/if \(activeTool !== 'dimension'\) setDimFirstPoint\(null\)/)
  })

  it('the draw module renders driving dimensions in a distinct colour + fx marker', () => {
    expect(DRAW).toContain("const DIM_DRIVEN_COLOR = '#67e8f9'")
    expect(DRAW).toContain("const fxMark = isDriven ? 'fx ' : ''")
    // the value text uses the shared label anchor so render == pick.
    expect(DRAW).toContain('const anchor = dimensionLabelAnchorWorld(dm, design)')
  })

  it('the draw module gained the additive dimension draft-point ring', () => {
    expect(DRAW).toContain('dimensionDraftPoint?: readonly [number, number] | null')
    expect(DRAW).toContain("ctx.strokeStyle = '#67e8f9'")
  })

  it('the MVP variant is untouched by the dimension wave (its readout intact)', () => {
    expect(SRC).toContain('sketch-mvp-cursor-readout')
  })

  it('no `any` types in the LIVE canvas component (CLAUDE.md rule; MVP region out of scope)', () => {
    const live = SRC.slice(0, SRC.indexOf('// MvpSketchCanvas (CAD V1 MVP sketcher)'))
    expect(live).not.toMatch(/: any\b/)
    expect(live).not.toMatch(/as any\b/)
  })
})
