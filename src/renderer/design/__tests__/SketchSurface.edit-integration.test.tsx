/**
 * Wave 3g · Offset/Boolean/Array integration on the live sketch surface.
 *
 * The task contract: "select a loop → offset → the merged design has the offset
 * loop AND is cam-2d-derive-consumable." This file pins that end-to-end seam at
 * the unit level:
 *
 *   1. RENDER — the mounted `SketchSurface` exposes the three Modify launchers
 *      (Offset / Boolean / Array) so the operator can reach the tools, and the
 *      surface still mounts the canvas (no regression of Wave 3e/3f; the
 *      redundant in-surface tool palette was removed).
 *
 *   2. INTEGRATION — drive the exact data path a click produces: the operator
 *      selects a closed loop, opens Offset, and Applies. Apply runs the pure
 *      `offsetSketchEntities` engine on the selected id and hands the merged
 *      design back through `onDesignChange`. We assert the returned design (a) is
 *      a schema-valid v2 design that survives the session's save→load round-trip,
 *      (b) contains a NEW closed loop in addition to the original, and (c) is
 *      consumable by `cam-2d-derive` (`listContourCandidatesFromDesign` sees the
 *      offset loop as a machinable contour candidate). The same path is checked
 *      for Boolean (union of two loops) and Array (rectangular copies).
 *
 * The renderer tests are node-env SSR (no jsdom/canvas), so a true pointer click
 * is out of scope; we pin the load-bearing engine→merge→onDesignChange contract
 * the click feeds, which is exactly what makes the feature real.
 *
 * Env: `node` + `renderToStaticMarkup`.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SketchSurface } from '../SketchSurface'
import {
  emptyDesign,
  normalizeDesign,
  type DesignFileV2,
  type SketchEntity
} from '../../../shared/design-schema'
import {
  booleanSketchEntities,
  closedLoopEntityIds,
  offsetSketchEntities
} from '../../../shared/sketch-boolean-offset'
import { rectangularArray } from '../../../shared/sketch-array'
import { listContourCandidatesFromDesign } from '../../../shared/cam-2d-derive'

const noop = (): void => undefined

/** A closed square polyline (4 vertices) centered at (cx,cy), half-width `half`. */
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

function withSecondSquare(
  base: DesignFileV2,
  id: string,
  cx: number,
  cy: number,
  half: number
): DesignFileV2 {
  const sq = squareDesign(id, cx, cy, half)
  return {
    ...base,
    points: { ...base.points, ...sq.points },
    entities: [...base.entities, ...sq.entities]
  }
}

describe('SketchSurface — Modify launchers are reachable', () => {
  it('mounts the Offset / Boolean / Array buttons next to the canvas', () => {
    const html = renderToStaticMarkup(
      createElement(SketchSurface, { design: squareDesign('sq', 0, 0, 20), onDesignChange: noop })
    )
    expect(html).toContain('data-testid="sketch-surface-offset"')
    expect(html).toContain('data-testid="sketch-surface-boolean"')
    expect(html).toContain('data-testid="sketch-surface-array"')
    // No regression: the canvas still mounts (the redundant in-surface tool
    // palette was removed — tools are armed from the ribbon).
    expect(html).toContain('data-testid="sketch-surface"')
    expect(html).not.toContain('data-testid="sketch-surface-palette"')
    expect(html).toContain('class="sketch-canvas"')
  })

  it('all three launchers are type="button" and unpressed at rest', () => {
    const html = renderToStaticMarkup(
      createElement(SketchSurface, { design: squareDesign('sq', 0, 0, 20), onDesignChange: noop })
    )
    for (const id of ['offset', 'boolean', 'array']) {
      const tag = (html.match(new RegExp(`<button[^>]*data-testid="sketch-surface-${id}"[^>]*>`)) ?? [])[0] ?? ''
      expect(tag, id).toContain('type="button"')
      expect(tag, id).toContain('aria-pressed="false"')
    }
  })

  it('every interactive element on the surface is a type="button" (with a loop drawn)', () => {
    const html = renderToStaticMarkup(
      createElement(SketchSurface, {
        design: squareDesign('sq', 0, 0, 20),
        onDesignChange: noop,
        onImportDxf: noop
      })
    )
    const openTags = html.match(/<button[^>]*>/g) ?? []
    expect(openTags.length).toBeGreaterThan(0)
    for (const tag of openTags) expect(tag).toContain('type="button"')
  })
})

describe('Offset integration — select a loop → offset → merged + cam-consumable', () => {
  it('the offset Apply merges a NEW closed loop the original keeps + cam-2d-derive reads', () => {
    // The live design holds ONE closed square loop (what the operator drew).
    const before = squareDesign('sq', 0, 0, 20)
    expect(closedLoopEntityIds(before)).toEqual(['sq'])

    // The surface lets the operator select 'sq', open Offset, and Apply. Apply
    // runs exactly this engine call (selectedIds=['sq']) and pushes the result
    // through onDesignChange. We use a deterministic idPrefix so the new loop id
    // is stable for the assertion (the dialog itself defaults to a timestamp tag).
    const result = offsetSketchEntities({
      design: before,
      entityIds: ['sq'],
      distanceMm: 5,
      joinType: 'miter',
      idPrefix: 'off_test'
    })
    const merged = result.design

    // (a) NEW closed loop added; the original is preserved (additive, base intact).
    expect(result.empty).toBe(false)
    expect(merged.entities).toHaveLength(2)
    expect(merged.entities.map((e) => e.id)).toContain('sq')
    const added = merged.entities.find((e) => e.id !== 'sq')
    expect(added).toBeDefined()
    expect(added?.kind).toBe('polyline')
    expect(added && 'closed' in added ? added.closed : false).toBe(true)
    // The base design was NOT mutated.
    expect(before.entities).toHaveLength(1)

    // (b) Schema-valid + survives the session save→load round-trip.
    expect(() => normalizeDesign(merged)).not.toThrow()
    const reloaded = normalizeDesign(JSON.parse(JSON.stringify(merged)))
    expect(reloaded.entities).toHaveLength(2)

    // (c) cam-2d-derive-consumable: BOTH the original and the offset loop are
    // machinable contour candidates downstream.
    const candidates = listContourCandidatesFromDesign(merged)
    expect(candidates).toHaveLength(2)
    const ids = candidates.map((c) => c.sourceId)
    expect(ids).toContain('sq')
    expect(ids).toContain(added?.id)

    // The +5 mm outset grows the 40 mm square outward (offset loop is larger).
    const offsetCand = candidates.find((c) => c.sourceId === added?.id)
    expect(offsetCand).toBeDefined()
    const xs = offsetCand!.points.map((p) => p[0])
    expect(Math.max(...xs)).toBeGreaterThan(20) // beyond the original +20 edge
  })
})

describe('Boolean integration — union two loops → merged + cam-consumable', () => {
  it('union of two overlapping squares yields a welded loop cam-2d-derive reads', () => {
    const two = withSecondSquare(squareDesign('a', 0, 0, 20), 'b', 20, 0, 20)
    expect(closedLoopEntityIds(two).sort()).toEqual(['a', 'b'])

    // Union: every selected loop is a subject (the dialog passes subjectIds=all,
    // clipIds=[] for union). Overlapping squares merge into one outline.
    const result = booleanSketchEntities({
      design: two,
      subjectIds: ['a', 'b'],
      clipIds: [],
      op: 'union',
      idPrefix: 'bool_test'
    })
    expect(result.empty).toBe(false)
    // At least one merged outer loop was produced.
    const outers = result.loops.filter((l) => !l.isHole)
    expect(outers.length).toBeGreaterThanOrEqual(1)

    // cam-2d-derive sees the welded result loop(s) as contour candidates.
    const candidates = listContourCandidatesFromDesign(result.design)
    const newIds = result.entities.map((e) => e.id)
    for (const id of newIds) {
      expect(candidates.map((c) => c.sourceId)).toContain(id)
    }
    expect(() => normalizeDesign(result.design)).not.toThrow()
  })
})

describe('Array integration — rectangular copies → merged + cam-consumable', () => {
  it('a 2×1 grid adds one copy; both loops are machinable contours', () => {
    const before = squareDesign('sq', 0, 0, 10)
    const result = rectangularArray({
      design: before,
      sourceIds: ['sq'],
      cols: 2,
      rows: 1,
      dxMm: 30,
      dyMm: 0
    })
    // cols·rows − 1 = 1 copy emitted (the merged design holds 2 instances).
    expect(result.copyCount).toBe(1)
    expect(result.design.entities).toHaveLength(2)
    // Base untouched.
    expect(before.entities).toHaveLength(1)

    const candidates = listContourCandidatesFromDesign(result.design)
    expect(candidates).toHaveLength(2)
    expect(() => normalizeDesign(result.design)).not.toThrow()
  })
})
