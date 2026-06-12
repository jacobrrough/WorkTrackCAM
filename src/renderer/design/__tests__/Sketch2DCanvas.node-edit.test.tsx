/**
 * Sketch S2 -- render + source contracts for the canvas node/vertex editing
 * (square grip handles, handle drag -> ONE onNodeMove, double-click segment
 * insert, Delete on an armed node).
 *
 * Repo tests are node-SSR (renderToStaticMarkup; no jsdom / pointer events),
 * so per the S1 convention this file pins:
 *   - the load-bearing resolvers as PURE units (sketch2d-node-edit.test.ts);
 *   - the DOM-visible half as markup (the data-node-editing availability flag
 *     + node-mode toolbar copy + additive-prop byte-identity);
 *   - the pointer/keyboard halves SSR cannot click as source text.
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
      { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 },
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

/** The S1 selection callbacks, wired with no-ops. */
function s1Wired(): Partial<CanvasProps> {
  return {
    onEntityPick: () => undefined,
    onMoveSelected: () => undefined,
    onDeleteSelected: () => undefined
  }
}

/** The S2 node-edit callbacks, wired with no-ops. */
function nodeWired(): Partial<CanvasProps> {
  return {
    onNodeMove: () => undefined,
    onNodeInsert: () => undefined,
    onNodeDelete: () => undefined
  }
}

describe('Sketch2DCanvas node editing -- render contract (node-SSR)', () => {
  it('node props absent on a non-select tool: byte-identical with or without S2 props', () => {
    const baseline = markup({ ...s1Wired(), selectedEntityIds: new Set(['r1']) })
    const withNode = markup({ ...s1Wired(), ...nodeWired(), selectedEntityIds: new Set(['r1']) })
    expect(withNode).toBe(baseline)
  })

  it('S1-only mounts never render the availability flag (absent prop = no attribute at all)', () => {
    const html = markup({
      activeTool: 'select',
      ...s1Wired(),
      selectedEntityIds: new Set(['r1'])
    })
    expect(html).toContain('data-testid="sketch-select-toolbar"')
    expect(html).not.toContain('data-node-editing')
  })

  it('select + node-wired + EXACTLY ONE selected -> availability flag true + node-mode copy', () => {
    const html = markup({
      activeTool: 'select',
      ...s1Wired(),
      ...nodeWired(),
      selectedEntityIds: new Set(['pl1'])
    })
    expect(html).toContain('data-node-editing="true"')
    expect(html).toContain('drag a node handle to reshape')
    expect(html).toContain('double-click a segment to add a node')
  })

  it('two selected -> flag false, node-mode copy absent (single-selection gate)', () => {
    const html = markup({
      activeTool: 'select',
      ...s1Wired(),
      ...nodeWired(),
      selectedEntityIds: new Set(['r1', 'pl1'])
    })
    expect(html).toContain('data-node-editing="false"')
    expect(html).not.toContain('drag a node handle to reshape')
  })

  it('node props without onEntityPick render no select chrome (pick wiring stays the gate)', () => {
    const html = markup({
      activeTool: 'select',
      ...nodeWired(),
      selectedEntityIds: new Set(['pl1'])
    })
    expect(html).not.toContain('sketch-select-toolbar')
    expect(html).not.toContain('data-node-editing')
  })
})

const SRC = readFileSync(resolve(__dirname, '../Sketch2DCanvas.tsx'), 'utf-8')
const DRAW = readFileSync(resolve(__dirname, '../sketch2d-draw.ts'), 'utf-8')

describe('Sketch2DCanvas node editing -- source pins (gesture halves SSR cannot click)', () => {
  it('node editing is gated to select tool + wired callback + EXACTLY ONE selected entity', () => {
    expect(SRC).toContain(
      "if (activeTool !== 'select' || !onNodeMove || selectedEntityIds?.size !== 1) return null"
    )
  })

  it('a handle hit consumes the press BEFORE the entity hit-test in the select branch', () => {
    expect(SRC).toMatch(
      /if \(!onEntityPick\) return\s*\n\s*if \(beginNodeDragAtPoint\(\[raw\[0\], raw\[1\]\]\)\) return\s*\n\s*const hit = hitTestSketchEntities\(\{/
    )
  })

  it('the handle pick resolves through the pure nearestEditableNode at the handle aperture', () => {
    expect(SRC).toContain(
      'const hit = nearestEditableNode(editableNodes, raw, nodeHandlePickToleranceMm(scale))'
    )
  })

  it('node drags resolve through the SHARED osnap engine with the edited entity excluded', () => {
    expect(SRC).toMatch(
      /resolveNodeDragPoint = \([\s\S]{0,200}?resolveSnappedPoint\(\{/
    )
    expect(SRC).toContain(
      'osnapCandidates: collectOsnapCandidates({ design, excludeEntityIds: [nodeEditEntity.id] })'
    )
  })

  it('release emits EXACTLY ONE onNodeMove per drag (no per-frame emits)', () => {
    expect(SRC.match(/onNodeMove\?\.\(/g) ?? []).toHaveLength(1)
    expect(SRC).toContain('onNodeMove?.(nd.entityId, nd.nodeId, placed)')
  })

  it('the live ghost runs the SAME pure moveNode the release commits (preview IS the result)', () => {
    expect(SRC).toContain(
      'const ghostDesign = moveNode(design, nodeEditEntity.id, nodeGhost.nodeId, nodeGhost.point)'
    )
    expect(SRC).toContain('entityOutlineWorld(ghostEntity, ghostDesign.points)')
  })

  it('an in-place release ARMS the node; a second click disarms (toggle)', () => {
    expect(SRC).toContain('setActiveNodeId((prev) => (prev === nd.nodeId ? null : nd.nodeId))')
  })

  it('Delete with an ARMED node deletes the node; the S1 entity-delete branch is untouched below', () => {
    const nodeBranch = SRC.indexOf('onNodeDelete(nodeEditEntity.id, activeNodeId)')
    const entityBranch = SRC.indexOf(
      "if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedCount > 0) {"
    )
    expect(nodeBranch).toBeGreaterThan(-1)
    expect(entityBranch).toBeGreaterThan(-1)
    expect(nodeBranch).toBeLessThan(entityBranch)
  })

  it('Escape cancels the node gesture FIRST (drag, then armed node, then S1 behavior)', () => {
    expect(SRC).toMatch(
      /if \(ev\.key === 'Escape'\) \{\s*\n\s*if \(cancelNodeGestureOnEscape\(ev\)\) return/
    )
    const helper = SRC.slice(
      SRC.indexOf('const cancelNodeGestureOnEscape'),
      SRC.indexOf('/** Press on an entity in select mode')
    )
    expect(helper).toContain('if (nodeDragRef.current) {')
    expect(helper).toContain('if (activeNodeId !== null) {')
  })

  it('double-click inserts on the nearest segment of the single-selected polyline only', () => {
    expect(SRC).toContain(
      "onDoubleClick={activeTool === 'select' && onNodeInsert ? onCanvasDoubleClick : undefined}"
    )
    expect(SRC).toContain(
      'const seg = nearestPolylineSegment(nodeEditEntity, points, raw, selectPickToleranceMm(scale))'
    )
    expect(SRC).toContain('onNodeInsert(nodeEditEntity.id, seg.segmentIndex, placed.point)')
  })

  it('mouseleave cancels an in-flight node drag without emitting', () => {
    expect(SRC).toMatch(
      /likewise cancel an in-flight node drag[\s\S]{0,120}?nodeDragRef\.current = null\s*\n\s*setNodeGhost\(null\)/
    )
  })

  it('tool switch / selection change tears down the node gesture state', () => {
    expect(SRC).toMatch(
      /useEffect\(\(\) => \{\s*\n\s*nodeDragRef\.current = null\s*\n\s*setNodeGhost\(null\)\s*\n\s*setActiveNodeId\(null\)\s*\n\s*\}, \[activeTool, nodeEditEntity\?\.id\]\)/
    )
  })

  it('the draw module gained the additive node overlay (squares; active fills; ghost dashed)', () => {
    expect(DRAW).toContain('nodeEditOverlay?: {')
    expect(DRAW).toContain('handles: ReadonlyArray<{ x: number; y: number; active: boolean }>')
    expect(DRAW).toContain('ctx.rect(hx - half, hy - half, half * 2, half * 2)')
    expect(DRAW).toContain("ctx.fillStyle = grip.active ? '#4ade80' : '#0c0612'")
    expect(DRAW).toMatch(/ghostOutline[\s\S]{0,400}?'#86efac'/)
  })

  it('the canvas threads the overlay into drawSketch2D (param + dependency)', () => {
    expect(SRC).toMatch(/osnapMarker: osnapHover,\s*\n\s*nodeEditOverlay,/)
  })

  it('the MVP variant is untouched by the node-edit wave (its readout intact)', () => {
    expect(SRC).toContain('sketch-mvp-cursor-readout')
  })

  it('no `any` types in the LIVE canvas component (CLAUDE.md rule; MVP region out of scope)', () => {
    const live = SRC.slice(0, SRC.indexOf('// MvpSketchCanvas (CAD V1 MVP sketcher)'))
    expect(live.length).toBeGreaterThan(1000)
    expect(live).not.toMatch(/: any\b/)
    expect(live).not.toMatch(/as any\b/)
  })
})
