/**
 * Sketch S1 -- render + source contracts for the session-wired Sketch2DCanvas
 * select tool (click-select / drag-move ghost / Delete / Esc).
 *
 * Repo tests are node-SSR (renderToStaticMarkup; no jsdom, no pointer
 * events), so the contract splits per the established convention:
 *   - the load-bearing resolvers are PURE and unit-tested in
 *     `sketch2d-hit-test.test.ts` (hit test, snapped drag delta, thresholds);
 *   - the DOM-visible halves are pinned here as markup (select toolbar,
 *     focusable canvas, additive-props byte-identity);
 *   - the pointer/keyboard halves SSR cannot click are pinned as source text,
 *     mirroring `sketch-cursor-world-threading-pin.test.ts`.
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
    entities: [
      { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 },
      { id: 'c1', kind: 'circle', cx: 30, cy: 0, r: 5 }
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

/** The three new callbacks, wired with no-ops (zero-arg fns are assignable). */
function wired(): Partial<CanvasProps> {
  return {
    onEntityPick: () => undefined,
    onMoveSelected: () => undefined,
    onDeleteSelected: () => undefined
  }
}

describe('Sketch2DCanvas select tool -- render contract (node-SSR)', () => {
  it('new props absent OR wired on a non-select tool -> markup is byte-identical', () => {
    const baseline = markup()
    const withProps = markup({ ...wired(), selectedEntityIds: new Set(['r1']) })
    expect(withProps).toBe(baseline)
  })

  it("select tool UNWIRED -> no select chrome at all (today's behavior preserved)", () => {
    const html = markup({ activeTool: 'select' })
    expect(html).not.toContain('sketch-select-toolbar')
    expect(html).not.toContain('tabindex')
  })

  it('selection set without onEntityPick renders NO select chrome (pick wiring is the gate)', () => {
    const html = markup({ activeTool: 'select', selectedEntityIds: new Set(['r1']) })
    expect(html).not.toContain('sketch-select-toolbar')
  })

  it('select + wired + selection -> toolbar with live count, enabled actions, focusable canvas', () => {
    const html = markup({
      activeTool: 'select',
      ...wired(),
      selectedEntityIds: new Set(['r1', 'c1'])
    })
    expect(html).toContain('data-testid="sketch-select-toolbar"')
    expect(html).toContain('data-selected-count="2"')
    expect(html).toContain('2 selected')
    expect(html).toContain('tabindex="0"')
    expect(html).toMatch(/data-testid="sketch-select-delete"(?![^>]*disabled)/)
    expect(html).toMatch(/data-testid="sketch-select-clear"(?![^>]*disabled)/)
  })

  it('select + wired + EMPTY selection -> prompt copy and disabled actions', () => {
    const html = markup({ activeTool: 'select', ...wired(), selectedEntityIds: new Set() })
    expect(html).toContain('data-selected-count="0"')
    expect(html).toContain('Select: click an entity')
    expect(html).toMatch(/data-testid="sketch-select-delete"[^>]*disabled/)
    expect(html).toMatch(/data-testid="sketch-select-clear"[^>]*disabled/)
  })
})

const SRC = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')
const DRAW = readFileSync(resolve(__dirname, '../sketch2d-draw.ts'), 'utf-8')

describe('Sketch2DCanvas select tool -- source pins (pointer halves SSR cannot click)', () => {
  it('mousedown select branch resolves the pick through the pure hit test at the RAW point', () => {
    // S4 widened the window: the select branch now leads with a dimension-label
    // edit hit-test (`hitTestDimensionLabel`) before the entity hit-test.
    expect(SRC).toMatch(
      /if \(activeTool === 'select'\) \{[\s\S]{0,1400}?hitTestSketchEntities\(\{[\s\S]{0,120}?worldPoint: raw/
    )
  })

  it('drag release emits EXACTLY ONE resolved onMoveSelected (single undoable step upstream)', () => {
    const emits = SRC.match(/onMoveSelected\?\.\(/g) ?? []
    expect(emits).toHaveLength(1)
    expect(SRC).toContain('const [dxMm, dyMm] = resolveSelectDragDelta(sd, raw).deltaMm')
    expect(SRC).toContain('if (dxMm !== 0 || dyMm !== 0) onMoveSelected?.(dxMm, dyMm)')
  })

  it('the live ghost offset is the SAME snapped delta the release will commit', () => {
    expect(SRC).toContain('const dragRes = resolveSelectDragDelta(sd, raw)')
    expect(SRC).toContain('setSelectGhostOffset(dragRes.deltaMm)')
  })

  it('Escape clears via onEntityPick(null, false); Delete/Backspace fire onDeleteSelected', () => {
    expect(SRC).toContain("if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedCount > 0)")
    expect(SRC).toContain('onDeleteSelected?.()')
    expect(SRC).toMatch(/key === 'Escape'[\s\S]{0,420}?onEntityPick\?\.\(null, false\)/)
  })

  it('select keys bind to the CANVAS element (focus-scoped) -- never a window capture', () => {
    // The canvas onKeyDown still routes the select tool to onSelectKeyDown. A polyline branch was
    // added (Tab-to-type), but select keys stay focus-scoped on the element — never a window capture.
    expect(SRC).toMatch(
      /onKeyDown=\{\s*activeTool === 'select' && onEntityPick\s*\?\s*onSelectKeyDown/
    )
    expect(SRC).not.toMatch(/window\.addEventListener\([^)]*onSelectKeyDown/)
  })

  it('Shift+left over an entity is an ADDITIVE pick; empty Shift+left still pans', () => {
    expect(SRC).toMatch(/beginSelectGesture\(sHit\.entityId, \[sraw\[0\], sraw\[1\]\], true\)/)
    expect(SRC).toContain('panRef.current = { sx: ev.clientX, sy: ev.clientY, ox, oy }')
  })

  it('a fresh press picks on mousedown; a press on an already-selected entity defers to release', () => {
    expect(SRC).toContain('const alreadySelected = !!selectedEntityIds?.has(entityId)')
    expect(SRC).toContain('} else if (!sd.moved && !sd.pickedOnDown) {')
  })

  it('mouseleave + Escape cancel an in-flight drag WITHOUT emitting a move', () => {
    expect(SRC).toMatch(/cancel any in-flight select drag[\s\S]{0,200}?selectDragRef\.current = null/)
  })

  it('the draw module re-strokes selected outlines and ghosts them at the snapped offset (additive params)', () => {
    expect(DRAW).toContain('selectedEntityIds?: ReadonlySet<string>')
    expect(DRAW).toContain('selectionGhostOffsetMm?: [number, number] | null')
    expect(DRAW).toContain('entityOutlineWorld(e, points)')
    expect(DRAW).toContain("ctx.strokeStyle = '#4ade80'")
  })

  it("the SketchTool union gained 'select' without disturbing the existing tools", () => {
    // S4 inserted 'dimension' between 'select' and 'point' (the Annotate tool).
    expect(SRC).toMatch(/export type SketchTool =\s+\| 'select'\s+\| 'dimension'\s+\| 'point'/)
  })

  it('the MVP variant is untouched by the select wave (its own readout intact)', () => {
    expect(SRC).toContain('sketch-mvp-cursor-readout')
  })
})
