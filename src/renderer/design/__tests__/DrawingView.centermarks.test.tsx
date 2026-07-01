/**
 * DrawingView center-mark + centerline model + render pins (node-env).
 *
 * Sibling of `DrawingView.notes.test.tsx` (the template this mirrors). The
 * renderer test environment is `node` (no jsdom, no @testing-library), so the
 * interactive click->persist->re-resolve path in `DrawingView.tsx` cannot be
 * driven through a rendered component. All of that logic lives in the pure
 * center-mark / centerline section of `drawing-annotation-model.ts`, which IS
 * unit-testable; the component's static surface is pinned with
 * `renderToStaticMarkup`, and the TWO-CLICK centerline state machine is
 * source-pinned (the drawings-persistence-wiring convention). This suite
 * covers:
 *
 *   1. PLACEMENT COMMIT -- a one-click center-mark placement on a snap point
 *      mints a `DrawingCenterMark` whose anchor `refId` is the snapped
 *      feature's `sourceId`; the two-click centerline flow's commit product
 *      (`buildCenterline(start, end)`) carries BOTH anchors. Results parse
 *      against the persistence schema (`sheet.annotations.centerMarks` /
 *      `.centerlines`).
 *   2. SCHEMA back-compat -- a legacy annotations payload WITHOUT the new
 *      arrays parses unchanged and defaults both to [] (Safety Rule 2).
 *   3. EMITTER pins -- the center-mark crosshair geometry (two perpendicular
 *      lines, the 0.7/0.15/0.3 five-entry dash pattern scaled by sizeMm) and
 *      the centerline chain dash (`6 1.5 1.5 1.5`) + past-both-ends extension.
 *      `currentColor` styling; dangling modifier class / data attr.
 *   4. RE-ANCHOR + DANGLING -- resolved anchors refresh their cachedPoint; a
 *      vanished refId flags dangling (either endpoint for a centerline); free
 *      anchors never dangle.
 *   5. DELETE / CLEAR -- the pure removeCenterMark / removeCenterline helpers.
 *   6. The DrawingView AFFORDANCE -- toolbar + size field + both place
 *      buttons; persisted marks/lines compose into the canvas SVG and render
 *      per-item delete rows; a drawing WITHOUT the props still renders
 *      (back-compat); the two-click flow + center-kind snap preference are
 *      source-pinned.
 *
 * Safety Rule 1: documentation overlays only -- no G-code / STL touched.
 * Safety Rule 3: no `any`. No free text reaches these emitters (no
 * Safety-Rule-4 surface); ids are still escaped defensively.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildCenterMark,
  buildCenterline,
  buildSnapIndex,
  centerlinesLayerSvg,
  centerlineToSvg,
  centerMarksLayerSvg,
  centerMarkToSvg,
  composeCenterlinesIntoSvg,
  composeCenterMarksIntoSvg,
  isAssociativeCenterMark,
  reanchorCenterline,
  reanchorCenterlines,
  reanchorCenterMark,
  reanchorCenterMarks,
  removeCenterline,
  removeCenterMark,
  CENTERLINE_DASH_PATTERN,
  CENTERLINE_EXTENSION_MM,
  DEFAULT_CENTER_MARK_SIZE_MM,
  FREE_ANCHOR_REF_ID,
  type FreshSnapPoint,
  type ResolvedClick,
} from '../drawing-annotation-model'
import { DrawingView } from '../DrawingView'
import {
  drawingCenterMarkSchema,
  drawingSheetAnnotationsSchema,
  type DrawingCenterline,
  type DrawingCenterMark,
} from '../../../shared/drawing-annotation-schema'

// -- window.fab shim (see DrawingView.test.tsx for rationale) ------------------
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

// -- Fixtures ------------------------------------------------------------------

function snapClick(sourceId: string, x: number, y: number): ResolvedClick {
  return { sourceId, point: { x, y } }
}
function freeClick(x: number, y: number): ResolvedClick {
  return { sourceId: null, point: { x, y } }
}
function snapPoint(id: string, sourceId: string, x: number, y: number): FreshSnapPoint {
  return { id, sourceId, x, y }
}

const DRAWING_VIEW_SRC = readFileSync(join(__dirname, '..', 'DrawingView.tsx'), 'utf-8')

// -- (A) Placement commit -> persistence ----------------------------------------

describe('buildCenterMark -- one-click anchored placement', () => {
  it('records a snapped click as the anchor with the default mark size', () => {
    const mark = buildCenterMark(snapClick('c:hole-7', 42, 18))
    expect(mark.anchor.refId).toBe('c:hole-7')
    expect(mark.anchor.cachedPoint).toEqual({ x: 42, y: 18 })
    expect(mark.sizeMm).toBe(DEFAULT_CENTER_MARK_SIZE_MM)
    expect(isAssociativeCenterMark(mark)).toBe(true)
    expect(typeof mark.id).toBe('string')
    expect(mark.id.length).toBeGreaterThan(0)
  })

  it('honours a custom mark size and coerces an invalid one to the default', () => {
    expect(buildCenterMark(snapClick('c:1', 0, 0), { sizeMm: 5 }).sizeMm).toBe(5)
    expect(buildCenterMark(snapClick('c:1', 0, 0), { sizeMm: 0 }).sizeMm).toBe(
      DEFAULT_CENTER_MARK_SIZE_MM,
    )
    expect(buildCenterMark(snapClick('c:1', 0, 0), { sizeMm: Number.NaN }).sizeMm).toBe(
      DEFAULT_CENTER_MARK_SIZE_MM,
    )
  })

  it('a free click mints a free (non-associative) mark at the cursor point', () => {
    const mark = buildCenterMark(freeClick(5, 6))
    expect(mark.anchor.refId).toBe(FREE_ANCHOR_REF_ID)
    expect(mark.anchor.cachedPoint).toEqual({ x: 5, y: 6 })
    expect(isAssociativeCenterMark(mark)).toBe(false)
  })

  it('a placed mark parses into the sheet annotations schema (centerMarks)', () => {
    const mark = buildCenterMark(snapClick('c:bore-1', 12, 34), { sizeMm: 4 })
    const parsed = drawingSheetAnnotationsSchema.parse({ centerMarks: [mark] })
    expect(parsed.centerMarks).toHaveLength(1)
    expect(parsed.centerMarks[0]).toEqual(mark)
    expect(() => drawingCenterMarkSchema.parse(mark)).not.toThrow()
  })
})

describe('buildCenterline -- the two-click flow commit product', () => {
  it('records both resolved clicks as start / end anchors', () => {
    const line = buildCenterline(snapClick('c:hole-1', 10, 8), snapClick('c:hole-2', 40, 8))
    expect(line.start.refId).toBe('c:hole-1')
    expect(line.start.cachedPoint).toEqual({ x: 10, y: 8 })
    expect(line.end.refId).toBe('c:hole-2')
    expect(line.end.cachedPoint).toEqual({ x: 40, y: 8 })
  })

  it('either endpoint may be free (associative-inert)', () => {
    const line = buildCenterline(snapClick('c:1', 0, 0), freeClick(30, 0))
    expect(line.start.refId).toBe('c:1')
    expect(line.end.refId).toBe(FREE_ANCHOR_REF_ID)
  })

  it('a placed centerline parses into the sheet annotations schema (centerlines)', () => {
    const line = buildCenterline(snapClick('c:1', 0, 0), snapClick('c:2', 30, 0))
    const parsed = drawingSheetAnnotationsSchema.parse({ centerlines: [line] })
    expect(parsed.centerlines).toHaveLength(1)
    expect(parsed.centerlines[0]).toEqual(line)
  })
})

// -- (B) Schema back-compat (Safety Rule 2) --------------------------------------

describe('drawingSheetAnnotationsSchema -- additive back-compat', () => {
  it('a legacy payload without the new arrays defaults both to []', () => {
    const parsed = drawingSheetAnnotationsSchema.parse({})
    expect(parsed.centerMarks).toEqual([])
    expect(parsed.centerlines).toEqual([])
  })

  it('a legacy payload with ONLY the old arrays parses unchanged', () => {
    const parsed = drawingSheetAnnotationsSchema.parse({
      dimensions: [],
      notes: [{ id: 'n1', text: 'LEGACY', placement: { x: 0, y: 0 } }],
    })
    expect(parsed.notes).toHaveLength(1)
    expect(parsed.centerMarks).toEqual([])
    expect(parsed.centerlines).toEqual([])
  })
})

// -- (C) Emitter pins -------------------------------------------------------------

describe('centerMarkToSvg -- crosshair emitter', () => {
  it('emits two perpendicular lines with the drafting dash pattern scaled by sizeMm', () => {
    const mark: DrawingCenterMark = {
      id: 'cm-1',
      anchor: { refId: 'c:1', cachedPoint: { x: 10, y: 20 } },
      sizeMm: 4,
    }
    const svg = centerMarkToSvg(mark)
    // Long 0.7s / gap 0.15s / short center dash 0.3s / gap / long -- sums to 2s.
    expect(svg).toContain('stroke-dasharray="2.8 0.6 1.2 0.6 2.8"')
    expect((svg.match(/<line /g) ?? [])).toHaveLength(2)
    // Horizontal leg spans x-s .. x+s at y; vertical leg spans y-s .. y+s at x.
    expect(svg).toContain('x1="6" y1="20" x2="14" y2="20"')
    expect(svg).toContain('x1="10" y1="16" x2="10" y2="24"')
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).toContain('class="drawing-center-mark"')
    expect(svg).toContain('data-center-mark-id="cm-1"')
    expect(svg).not.toContain('stroke-opacity')
  })

  it('flags dangling with the modifier class + data attr + reduced opacity', () => {
    const mark = buildCenterMark(snapClick('c:GONE', 0, 0))
    const svg = centerMarkToSvg(mark, { dangling: true })
    expect(svg).toContain('drawing-center-mark--dangling')
    expect(svg).toContain('data-center-mark-dangling="true"')
    expect(svg).toContain('stroke-opacity="0.5"')
  })

  it('is pure: same input -> byte-identical output', () => {
    const mark = buildCenterMark(snapClick('c:1', 3, 4), { sizeMm: 2 })
    expect(centerMarkToSvg(mark)).toBe(centerMarkToSvg(mark))
  })
})

describe('centerlineToSvg -- chain-dashed line emitter', () => {
  it('draws the long-short-long chain dash extended past both anchors', () => {
    const line: DrawingCenterline = {
      id: 'cl-1',
      start: { refId: 'c:1', cachedPoint: { x: 0, y: 0 } },
      end: { refId: 'c:2', cachedPoint: { x: 10, y: 0 } },
    }
    const svg = centerlineToSvg(line)
    expect(svg).toContain(`stroke-dasharray="${CENTERLINE_DASH_PATTERN}"`)
    // Extended CENTERLINE_EXTENSION_MM (3) past each end along +x.
    expect(svg).toContain('x1="-3" y1="0" x2="13" y2="0"')
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).toContain('class="drawing-centerline"')
    expect(svg).toContain('data-centerline-id="cl-1"')
  })

  it('extends along the true line direction for a diagonal line', () => {
    const line = buildCenterline(snapClick('a', 0, 0), snapClick('b', 3, 4))
    const svg = centerlineToSvg(line)
    // Unit direction (0.6, 0.8) x extension 3 = (1.8, 2.4).
    expect(svg).toContain('x1="-1.8" y1="-2.4" x2="4.8" y2="6.4"')
  })

  it('a degenerate zero-length line falls back to the +x direction', () => {
    const line = buildCenterline(snapClick('a', 5, 5), snapClick('b', 5, 5))
    const svg = centerlineToSvg(line)
    expect(svg).toContain(
      `x1="${5 - CENTERLINE_EXTENSION_MM}" y1="5" x2="${5 + CENTERLINE_EXTENSION_MM}" y2="5"`,
    )
  })

  it('flags dangling with the modifier class + data attr + reduced opacity', () => {
    const line = buildCenterline(snapClick('c:GONE', 0, 0), freeClick(10, 0))
    const svg = centerlineToSvg(line, { dangling: true })
    expect(svg).toContain('drawing-centerline--dangling')
    expect(svg).toContain('data-centerline-dangling="true"')
    expect(svg).toContain('stroke-opacity="0.5"')
  })
})

describe('layer + compose helpers', () => {
  it('wraps marks / lines in testable layer groups', () => {
    const marks = [buildCenterMark(freeClick(0, 0)), buildCenterMark(freeClick(5, 5))]
    const lines = [buildCenterline(freeClick(0, 0), freeClick(10, 0))]
    const markLayer = centerMarksLayerSvg(marks)
    expect(markLayer).toContain('class="drawing-center-mark-layer"')
    expect(markLayer).toContain('data-testid="design-drawing-center-mark-layer"')
    expect((markLayer.match(/data-center-mark-id=/g) ?? [])).toHaveLength(2)
    const lineLayer = centerlinesLayerSvg(lines)
    expect(lineLayer).toContain('class="drawing-centerline-layer"')
    expect(lineLayer).toContain('data-testid="design-drawing-centerline-layer"')
  })

  it('returns the empty string for no items', () => {
    expect(centerMarksLayerSvg([])).toBe('')
    expect(centerlinesLayerSvg([])).toBe('')
  })

  it('splices both layers in just before </svg> (marks before lines when chained)', () => {
    const base = '<svg width="800" height="600"><rect/></svg>'
    const marks = [buildCenterMark(freeClick(0, 0))]
    const lines = [buildCenterline(freeClick(0, 0), freeClick(10, 0))]
    const composed = composeCenterlinesIntoSvg(composeCenterMarksIntoSvg(base, marks), lines)
    const rectIdx = composed.indexOf('<rect/>')
    const markIdx = composed.indexOf('drawing-center-mark-layer')
    const lineIdx = composed.indexOf('drawing-centerline-layer')
    const closeIdx = composed.indexOf('</svg>')
    expect(rectIdx).toBeGreaterThanOrEqual(0)
    expect(markIdx).toBeGreaterThan(rectIdx)
    expect(lineIdx).toBeGreaterThan(markIdx)
    expect(closeIdx).toBeGreaterThan(lineIdx)
  })

  it('returns the input SVG unchanged when there is nothing to compose', () => {
    const base = '<svg></svg>'
    expect(composeCenterMarksIntoSvg(base, [])).toBe(base)
    expect(composeCenterlinesIntoSvg(base, [])).toBe(base)
  })
})

// -- (D) removeCenterMark / removeCenterline --------------------------------------

describe('removeCenterMark / removeCenterline -- pure delete', () => {
  it('removes exactly the matching item (inputs untouched)', () => {
    const a = buildCenterMark(freeClick(0, 0))
    const b = buildCenterMark(freeClick(1, 1))
    const marks = [a, b]
    const next = removeCenterMark(marks, b.id)
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(a.id)
    expect(marks).toHaveLength(2)

    const l1 = buildCenterline(freeClick(0, 0), freeClick(1, 0))
    const l2 = buildCenterline(freeClick(0, 1), freeClick(1, 1))
    const lines = [l1, l2]
    expect(removeCenterline(lines, l1.id)[0].id).toBe(l2.id)
    expect(lines).toHaveLength(2)
  })

  it('is a no-op for an unknown id', () => {
    const a = buildCenterMark(freeClick(0, 0))
    expect(removeCenterMark([a], 'nope')).toHaveLength(1)
    const l = buildCenterline(freeClick(0, 0), freeClick(1, 0))
    expect(removeCenterline([l], 'nope')).toHaveLength(1)
  })
})

// -- (E) reanchor + dangling -------------------------------------------------------

describe('reanchorCenterMark(s) -- anchor re-resolution', () => {
  it('refreshes a resolved anchor cachedPoint (the mark rides its feature)', () => {
    const mark = buildCenterMark(snapClick('c:a', 10, 10))
    const index = buildSnapIndex([snapPoint('s:1', 'c:a', 15, 13)])
    const { mark: next, dangling } = reanchorCenterMark(mark, index)
    expect(dangling).toBe(false)
    expect(next.anchor.cachedPoint).toEqual({ x: 15, y: 13 })
    // Input is never mutated.
    expect(mark.anchor.cachedPoint).toEqual({ x: 10, y: 10 })
  })

  it('flags dangling and KEEPS the stale cachedPoint when the refId is gone', () => {
    const mark = buildCenterMark(snapClick('c:GONE', 7, 9))
    const { mark: next, dangling } = reanchorCenterMark(
      mark,
      buildSnapIndex([snapPoint('s:1', 'c:a', 1, 1)]),
    )
    expect(dangling).toBe(true)
    expect(next.anchor.cachedPoint).toEqual({ x: 7, y: 9 })
  })

  it('a free mark never dangles', () => {
    const mark = buildCenterMark(freeClick(3, 4))
    expect(reanchorCenterMark(mark, buildSnapIndex([])).dangling).toBe(false)
  })

  it('collects the ids of every dangling mark at the list level', () => {
    const kept = buildCenterMark(snapClick('c:a', 0, 0))
    const lost = buildCenterMark(snapClick('c:GONE', 5, 5))
    const free = buildCenterMark(freeClick(9, 9))
    const { centerMarks, danglingIds } = reanchorCenterMarks(
      [kept, lost, free],
      [snapPoint('s:1', 'c:a', 0, 0)],
    )
    expect(centerMarks).toHaveLength(3)
    expect(danglingIds.has(lost.id)).toBe(true)
    expect(danglingIds.has(kept.id)).toBe(false)
    expect(danglingIds.has(free.id)).toBe(false)
    expect(danglingIds.size).toBe(1)
    // Re-resolved marks still parse into the persistence schema.
    expect(() => drawingSheetAnnotationsSchema.parse({ centerMarks })).not.toThrow()
  })
})

describe('reanchorCenterline(s) -- BOTH endpoints re-resolve', () => {
  it('refreshes both resolved endpoints', () => {
    const line = buildCenterline(snapClick('c:a', 0, 0), snapClick('c:b', 10, 0))
    const index = buildSnapIndex([
      snapPoint('s:1', 'c:a', 1, 1),
      snapPoint('s:2', 'c:b', 11, 1),
    ])
    const { centerline: next, dangling } = reanchorCenterline(line, index)
    expect(dangling).toBe(false)
    expect(next.start.cachedPoint).toEqual({ x: 1, y: 1 })
    expect(next.end.cachedPoint).toEqual({ x: 11, y: 1 })
  })

  it('flags dangling when EITHER endpoint refId is gone (stale point kept)', () => {
    const line = buildCenterline(snapClick('c:a', 0, 0), snapClick('c:GONE', 10, 0))
    const index = buildSnapIndex([snapPoint('s:1', 'c:a', 2, 0)])
    const { centerline: next, dangling } = reanchorCenterline(line, index)
    expect(dangling).toBe(true)
    expect(next.start.cachedPoint).toEqual({ x: 2, y: 0 })
    expect(next.end.cachedPoint).toEqual({ x: 10, y: 0 })
  })

  it('free endpoints never dangle', () => {
    const line = buildCenterline(freeClick(0, 0), freeClick(10, 0))
    expect(reanchorCenterline(line, buildSnapIndex([])).dangling).toBe(false)
  })

  it('collects the ids of every dangling line at the list level', () => {
    const kept = buildCenterline(snapClick('c:a', 0, 0), snapClick('c:b', 5, 0))
    const lost = buildCenterline(snapClick('c:a', 0, 0), snapClick('c:GONE', 9, 0))
    const fresh = [snapPoint('s:1', 'c:a', 0, 0), snapPoint('s:2', 'c:b', 5, 0)]
    const { centerlines, danglingIds } = reanchorCenterlines([kept, lost], fresh)
    expect(centerlines).toHaveLength(2)
    expect(danglingIds.has(lost.id)).toBe(true)
    expect(danglingIds.has(kept.id)).toBe(false)
  })
})

// -- (F) DrawingView affordance + render pins --------------------------------------

describe('DrawingView -- center-mark / centerline affordance render contract', () => {
  const MARK: DrawingCenterMark = {
    id: 'cm-1',
    anchor: { refId: 'c:h1', cachedPoint: { x: 20, y: 8 } },
    sizeMm: 4,
  }
  const LINE: DrawingCenterline = {
    id: 'cl-1',
    start: { refId: 'c:h1', cachedPoint: { x: 20, y: 8 } },
    end: { refId: 'c:h2', cachedPoint: { x: 60, y: 8 } },
  }

  it('renders the toolbar with the size field and both place buttons', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-centermark-toolbar"')
    expect(html).toContain('data-testid="design-drawing-centermark-size"')
    expect(html).toContain('data-testid="design-drawing-centermark-place"')
    expect(html).toContain('data-testid="design-drawing-centerline-place"')
    expect(html).toContain('Center mark')
    expect(html).toContain('Centerline')
  })

  it('reports an empty count by default + hides Clear and the item list', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-centermark-count"')
    expect(html).toContain('No center marks')
    expect(html).not.toContain('data-testid="design-drawing-centermark-clear"')
    expect(html).not.toContain('data-testid="design-drawing-centerline-clear"')
    expect(html).not.toContain('data-testid="design-drawing-centermark-list"')
  })

  it('omits the toolbar in the empty-state branch', () => {
    const html = renderToStaticMarkup(createElement(DrawingView, { partHandle: null }))
    expect(html).not.toContain('data-testid="design-drawing-centermark-toolbar"')
  })

  it('composes a persisted center mark into the canvas SVG + renders the delete row', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg width="800" height="600"><rect/></svg>',
        persistedCenterMarks: [MARK],
      }),
    )
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).toContain('drawing-center-mark-layer')
    // The size-4 crosshair dash pattern reaches the markup.
    expect(html).toContain('2.8 0.6 1.2 0.6 2.8')
    expect(html).toContain('1 center mark, 0 centerlines')
    expect(html).toContain('data-testid="design-drawing-centermark-clear"')
    expect(html).toContain('data-testid="design-drawing-centermark-list"')
    expect(html).toContain('data-testid="design-drawing-centermark-delete-cm-1"')
    expect(html).toContain('Center mark @ (20.0, 8.0)')
  })

  it('composes a persisted centerline into the canvas SVG + renders the delete row', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg width="800" height="600"><rect/></svg>',
        persistedCenterlines: [LINE],
      }),
    )
    expect(html).toContain('drawing-centerline-layer')
    expect(html).toContain(CENTERLINE_DASH_PATTERN)
    expect(html).toContain('0 center marks, 1 centerline')
    expect(html).toContain('data-testid="design-drawing-centerline-clear"')
    expect(html).toContain('data-testid="design-drawing-centerline-delete-cl-1"')
  })

  it('renders both layers + the combined count when both props are supplied', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg><circle/></svg>',
        persistedCenterMarks: [MARK],
        persistedCenterlines: [LINE],
      }),
    )
    expect(html).toContain('drawing-center-mark-layer')
    expect(html).toContain('drawing-centerline-layer')
    expect(html).toContain('1 center mark, 1 centerline')
  })

  it('renders fine for a drawing WITHOUT the new props (back-compat)', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg><circle/></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).toContain('<circle')
    expect(html).toContain('data-testid="design-drawing-centermark-toolbar"')
    expect(html).not.toContain('drawing-center-mark-layer')
    expect(html).not.toContain('drawing-centerline-layer')
  })
})

// -- (G) Two-click flow + snap preference (source pins) ----------------------------

describe('DrawingView -- two-click centerline flow + center-kind snap preference (source pins)', () => {
  it('the ToolMode union carries the step-0 / step-1 centerline states', () => {
    expect(DRAWING_VIEW_SRC).toContain("{ readonly tool: 'centerline'; readonly step: 0 }")
    expect(DRAWING_VIEW_SRC).toContain(
      "{ readonly tool: 'centerline'; readonly step: 1; readonly start: ResolvedClick }",
    )
  })

  it('the first click stores the FULL ResolvedClick; the second commits both', () => {
    expect(DRAWING_VIEW_SRC).toContain(
      "setToolMode({ tool: 'centerline', step: 1, start: resolvedClick })",
    )
    expect(DRAWING_VIEW_SRC).toContain('commitCenterline(start, resolvedClick)')
  })

  it('the center-mark tool prefers center-kind snap points (honest fallback to any kind)', () => {
    expect(DRAWING_VIEW_SRC).toContain(
      "toolMode !== null && toolMode.tool === 'center-mark' ? 'center' : undefined",
    )
    expect(DRAWING_VIEW_SRC).toContain("snapPoints.filter((sp) => sp.kind === preferKind)")
  })

  it('center marks + centerlines compose into displaySvg AFTER notes', () => {
    const notesIdx = DRAWING_VIEW_SRC.indexOf('composeNotesIntoSvg(composed')
    const marksIdx = DRAWING_VIEW_SRC.indexOf('composeCenterMarksIntoSvg(composed')
    const linesIdx = DRAWING_VIEW_SRC.indexOf('composeCenterlinesIntoSvg(composed')
    expect(notesIdx).toBeGreaterThan(-1)
    expect(marksIdx).toBeGreaterThan(notesIdx)
    expect(linesIdx).toBeGreaterThan(marksIdx)
  })

  it('both re-anchor effects use the converge guard (deep-equality before persisting)', () => {
    expect(DRAWING_VIEW_SRC).toContain(
      'JSON.stringify(reanchored) !== JSON.stringify(persistedCenterMarks)',
    )
    expect(DRAWING_VIEW_SRC).toContain(
      'JSON.stringify(reanchored) !== JSON.stringify(persistedCenterlines)',
    )
  })
})
