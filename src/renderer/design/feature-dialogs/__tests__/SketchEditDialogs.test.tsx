/**
 * Wave 3g · Sketch vector-edit dialogs (Offset / Boolean / Array) render + map test.
 *
 * Pins:
 *   1. RENDER — each dialog mounts its fields + Apply button, and every
 *      interactive element is a `<button type="button">` / native control.
 *   2. GATING — Apply is disabled (with an honest hint) when the selection is
 *      insufficient (no closed loop for offset; < 2 for boolean; nothing for
 *      array), and enabled once a valid selection is present.
 *   3. MAPPING — `sketchEditDialogForCommand` routes the four catalog ids to the
 *      right dialog (both array ids → the single Array dialog), and
 *      `SKETCH_EDIT_COMMAND_IDS` lists exactly those four.
 *
 * Env: `node` + `renderToStaticMarkup` (no jsdom) — matches every other
 * feature-dialog render test.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ArraySketchDialog,
  BooleanSketchDialog,
  OffsetSketchDialog,
  SKETCH_EDIT_COMMAND_IDS,
  sketchEditDialogForCommand
} from '../SketchEditDialogs'
import { emptyDesign, type DesignFileV2, type SketchEntity } from '../../../../shared/design-schema'

const noop = (): void => undefined

/** A closed square polyline (4 vertices) — a real machinable loop. */
function squareDesign(id: string, cx: number, cy: number, half: number): DesignFileV2 {
  const pid = (n: number): string => `${id}_p${n}`
  const corners: ReadonlyArray<[number, number]> = [
    [cx - half, cy - half],
    [cx + half, cy - half],
    [cx + half, cy + half],
    [cx - half, cy + half]
  ]
  const points: Record<string, { x: number; y: number }> = {}
  corners.forEach(([x, y], i) => {
    points[pid(i)] = { x, y }
  })
  const entity: SketchEntity = {
    id,
    kind: 'polyline',
    pointIds: corners.map((_, i) => pid(i)),
    closed: true
  }
  return { ...emptyDesign(), points, entities: [entity] }
}

/** Merge a second square into an existing design (two selectable loops). */
function withSecondSquare(base: DesignFileV2, id: string, cx: number, cy: number, half: number): DesignFileV2 {
  const sq = squareDesign(id, cx, cy, half)
  return { ...base, points: { ...base.points, ...sq.points }, entities: [...base.entities, ...sq.entities] }
}

describe('sketchEditDialogForCommand + SKETCH_EDIT_COMMAND_IDS', () => {
  it('maps each catalog id to the right dialog (both array ids → array)', () => {
    expect(sketchEditDialogForCommand('sk_offset')).toBe('offset')
    expect(sketchEditDialogForCommand('sk_boolean')).toBe('boolean')
    expect(sketchEditDialogForCommand('sk_array_rect')).toBe('array')
    expect(sketchEditDialogForCommand('sk_array_circular')).toBe('array')
  })

  it('returns null for non-edit ids', () => {
    expect(sketchEditDialogForCommand('sk_line')).toBeNull()
    expect(sketchEditDialogForCommand('sk_text')).toBeNull()
    expect(sketchEditDialogForCommand('')).toBeNull()
  })

  it('SKETCH_EDIT_COMMAND_IDS lists exactly the four edit ids', () => {
    expect([...SKETCH_EDIT_COMMAND_IDS].sort()).toEqual(
      ['sk_array_circular', 'sk_array_rect', 'sk_boolean', 'sk_offset'].sort()
    )
    // Every listed id resolves to a dialog.
    for (const id of SKETCH_EDIT_COMMAND_IDS) {
      expect(sketchEditDialogForCommand(id)).not.toBeNull()
    }
  })
})

describe('OffsetSketchDialog', () => {
  it('renders the distance + corners fields and the Apply button', () => {
    const html = renderToStaticMarkup(
      createElement(OffsetSketchDialog, {
        design: squareDesign('sq', 0, 0, 20),
        selectedIds: ['sq'],
        onApply: noop
      })
    )
    expect(html).toContain('data-testid="fd-sk-offset"')
    expect(html).toContain('data-testid="fd-sk-offset-distance"')
    expect(html).toContain('data-testid="fd-sk-offset-join"')
    expect(html).toContain('data-testid="fd-sk-offset-apply"')
  })

  it('enables Apply with a closed loop selected', () => {
    const html = renderToStaticMarkup(
      createElement(OffsetSketchDialog, {
        design: squareDesign('sq', 0, 0, 20),
        selectedIds: ['sq'],
        onApply: noop
      })
    )
    const tag = (html.match(/<button[^>]*data-testid="fd-sk-offset-apply"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).not.toContain('disabled')
    expect(html).toContain('1 closed loop selected')
  })

  it('disables Apply (with a hint) when no closed loop is selected', () => {
    const html = renderToStaticMarkup(
      createElement(OffsetSketchDialog, {
        design: squareDesign('sq', 0, 0, 20),
        selectedIds: [], // nothing picked
        onApply: noop
      })
    )
    const tag = (html.match(/<button[^>]*data-testid="fd-sk-offset-apply"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).toContain('disabled')
    expect(html).toContain('Select one or more closed loops to offset.')
  })

  it('ignores an OPEN polyline in the selection (cannot bound a region)', () => {
    const openLine: SketchEntity = { id: 'ln', kind: 'polyline', pointIds: ['a', 'b'], closed: false }
    const design: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      entities: [openLine]
    }
    const html = renderToStaticMarkup(
      createElement(OffsetSketchDialog, { design, selectedIds: ['ln'], onApply: noop })
    )
    const tag = (html.match(/<button[^>]*data-testid="fd-sk-offset-apply"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).toContain('disabled')
  })
})

describe('BooleanSketchDialog', () => {
  it('needs two closed loops — disabled with one, enabled with two', () => {
    const one = squareDesign('a', 0, 0, 20)
    const oneHtml = renderToStaticMarkup(
      createElement(BooleanSketchDialog, { design: one, selectedIds: ['a'], onApply: noop })
    )
    const oneTag = (oneHtml.match(/<button[^>]*data-testid="fd-sk-boolean-apply"[^>]*>/) ?? [])[0] ?? ''
    expect(oneTag).toContain('disabled')
    expect(oneHtml).toContain('Select two or more closed loops to combine.')

    const two = withSecondSquare(one, 'b', 10, 0, 20)
    const twoHtml = renderToStaticMarkup(
      createElement(BooleanSketchDialog, { design: two, selectedIds: ['a', 'b'], onApply: noop })
    )
    const twoTag = (twoHtml.match(/<button[^>]*data-testid="fd-sk-boolean-apply"[^>]*>/) ?? [])[0] ?? ''
    expect(twoTag).not.toContain('disabled')
    expect(twoHtml).toContain('data-testid="fd-sk-boolean-op"')
  })
})

describe('ArraySketchDialog', () => {
  it('renders rectangular params by default and enables Apply with a selection', () => {
    const html = renderToStaticMarkup(
      createElement(ArraySketchDialog, {
        design: squareDesign('sq', 0, 0, 20),
        selectedIds: ['sq'],
        onApply: noop
      })
    )
    expect(html).toContain('data-testid="fd-sk-array-mode"')
    expect(html).toContain('data-testid="fd-sk-array-rect-params"')
    expect(html).toContain('data-testid="fd-sk-array-cols"')
    expect(html).toContain('data-testid="fd-sk-array-rows"')
    const tag = (html.match(/<button[^>]*data-testid="fd-sk-array-apply"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).not.toContain('disabled')
  })

  it('disables Apply (with a hint) when nothing is selected', () => {
    const html = renderToStaticMarkup(
      createElement(ArraySketchDialog, {
        design: squareDesign('sq', 0, 0, 20),
        selectedIds: [],
        onApply: noop
      })
    )
    const tag = (html.match(/<button[^>]*data-testid="fd-sk-array-apply"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).toContain('disabled')
    expect(html).toContain('Select one or more entities to pattern.')
  })

  it('arrays accept open entities too (not just closed loops)', () => {
    const openLine: SketchEntity = { id: 'ln', kind: 'polyline', pointIds: ['a', 'b'], closed: false }
    const design: DesignFileV2 = {
      ...emptyDesign(),
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      entities: [openLine]
    }
    const html = renderToStaticMarkup(
      createElement(ArraySketchDialog, { design, selectedIds: ['ln'], onApply: noop })
    )
    const tag = (html.match(/<button[^>]*data-testid="fd-sk-array-apply"[^>]*>/) ?? [])[0] ?? ''
    expect(tag).not.toContain('disabled') // an open guide curve is still arrayable
  })
})

describe('every interactive element is a type="button" (CLAUDE.md rule)', () => {
  for (const [name, el] of [
    ['Offset', createElement(OffsetSketchDialog, { design: squareDesign('sq', 0, 0, 20), selectedIds: ['sq'], onApply: noop })],
    ['Boolean', createElement(BooleanSketchDialog, { design: squareDesign('sq', 0, 0, 20), selectedIds: ['sq'], onApply: noop })],
    ['Array', createElement(ArraySketchDialog, { design: squareDesign('sq', 0, 0, 20), selectedIds: ['sq'], onApply: noop })]
  ] as const) {
    it(`${name} dialog`, () => {
      const html = renderToStaticMarkup(el)
      const openTags = html.match(/<button[^>]*>/g) ?? []
      expect(openTags.length).toBeGreaterThan(0)
      for (const tag of openTags) expect(tag).toContain('type="button"')
    })
  }
})
