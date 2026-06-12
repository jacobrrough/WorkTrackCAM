/**
 * Sketch S2 -- exhaustive units for the PURE node/vertex-editing module
 * (`sketch2d-node-edit.ts`): the node listing per entity kind, the moveNode
 * appliers (shared point-ref semantics + every param mapping), polyline
 * vertex insert/delete with the closed-loop integrity floor + orphan rules,
 * and the segment/handle pick helpers the canvas gestures resolve through.
 *
 * Node-SSR per repo convention: pure data in, pure data out -- no DOM.
 */

import { describe, expect, it } from 'vitest'
import {
  emptyDesign,
  type DesignFileV2,
  type SketchEntity,
  type SketchPoint
} from '../../../shared/design-schema'
import {
  deletePolylineNode,
  insertPolylineNode,
  listEditableNodes,
  MIN_PARAM_MM,
  moveNode,
  nearestEditableNode,
  nearestPolylineSegment,
  NODE_HANDLE_PICK_PX,
  nodeHandlePickToleranceMm,
  type SketchEditableNode
} from '../sketch2d-node-edit'

function designWith(
  entities: SketchEntity[],
  points: Record<string, SketchPoint> = {}
): DesignFileV2 {
  return { ...emptyDesign(), entities, points }
}

const PTS_ABC: Record<string, SketchPoint> = {
  a: { x: 0, y: 0 },
  b: { x: 10, y: 0 },
  c: { x: 10, y: 10 }
}

const PL_OPEN: SketchEntity = { id: 'pl1', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: false }

function nodeIds(nodes: readonly SketchEditableNode[]): string[] {
  return nodes.map((n) => n.nodeId)
}

function nodeById(nodes: readonly SketchEditableNode[], id: string): SketchEditableNode {
  const n = nodes.find((x) => x.nodeId === id)
  expect(n, `node ${id} present`).toBeDefined()
  return n!
}

// ---- listEditableNodes ------------------------------------------------------

describe('listEditableNodes -- point-record-backed kinds expose the SHARED point id', () => {
  it('polyline (pointIds): one point-ref node per vertex at the record position', () => {
    const nodes = listEditableNodes(PL_OPEN, PTS_ABC)
    expect(nodeIds(nodes)).toEqual(['a', 'b', 'c'])
    expect(nodes.every((n) => n.role === 'point-ref')).toBe(true)
    expect(nodeById(nodes, 'b').point).toEqual([10, 0])
  })

  it('skips vertices whose point record is missing (degenerate model, no throw)', () => {
    const nodes = listEditableNodes(PL_OPEN, { a: { x: 0, y: 0 }, c: { x: 10, y: 10 } })
    expect(nodeIds(nodes)).toEqual(['a', 'c'])
  })

  it('dedupes a point id that appears twice in the same entity (one handle per record)', () => {
    const pl: SketchEntity = { id: 'p', kind: 'polyline', pointIds: ['a', 'b', 'a'], closed: false }
    const nodes = listEditableNodes(pl, PTS_ABC)
    expect(nodeIds(nodes)).toEqual(['a', 'b'])
  })

  it('arc: start/via/end are point-ref nodes', () => {
    const arc: SketchEntity = { id: 'arc1', kind: 'arc', startId: 'a', viaId: 'b', endId: 'c' }
    const nodes = listEditableNodes(arc, PTS_ABC)
    expect(nodeIds(nodes)).toEqual(['a', 'b', 'c'])
    expect(nodes.every((n) => n.role === 'point-ref')).toBe(true)
  })

  it('spline_fit + spline_cp: control vertices are point-ref nodes', () => {
    const fit: SketchEntity = { id: 's1', kind: 'spline_fit', pointIds: ['a', 'b', 'c'] }
    const cp: SketchEntity = {
      id: 's2',
      kind: 'spline_cp',
      pointIds: ['a', 'b', 'c', 'd'],
      closed: false
    }
    expect(nodeIds(listEditableNodes(fit, PTS_ABC))).toEqual(['a', 'b', 'c'])
    const cpPts = { ...PTS_ABC, d: { x: 0, y: 10 } }
    expect(nodeIds(listEditableNodes(cp, cpPts))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('legacy inline-points polyline: param:v:<index> handles at each coordinate', () => {
    const pl: SketchEntity = {
      id: 'leg',
      kind: 'polyline',
      points: [
        [0, 0],
        [5, 5]
      ],
      closed: false
    }
    const nodes = listEditableNodes(pl, {})
    expect(nodeIds(nodes)).toEqual(['param:v:0', 'param:v:1'])
    expect(nodes.every((n) => n.role === 'param')).toBe(true)
    expect(nodeById(nodes, 'param:v:1').point).toEqual([5, 5])
  })
})

describe('listEditableNodes -- param-backed kinds (documented mapping)', () => {
  it('rect: center + 4 corners (unrotated positions match worldCornersFromRectParams order)', () => {
    const rect: SketchEntity = { id: 'r', kind: 'rect', cx: 10, cy: 20, w: 20, h: 10, rotation: 0 }
    const nodes = listEditableNodes(rect, {})
    expect(nodeIds(nodes)).toEqual([
      'param:center',
      'param:corner:0',
      'param:corner:1',
      'param:corner:2',
      'param:corner:3'
    ])
    expect(nodeById(nodes, 'param:center').point).toEqual([10, 20])
    expect(nodeById(nodes, 'param:corner:0').point).toEqual([0, 15])
    expect(nodeById(nodes, 'param:corner:2').point).toEqual([20, 25])
    expect(nodes.every((n) => n.role === 'param')).toBe(true)
  })

  it('rect rotated 90 deg: corner handles rotate with the entity', () => {
    const rect: SketchEntity = {
      id: 'r',
      kind: 'rect',
      cx: 0,
      cy: 0,
      w: 20,
      h: 10,
      rotation: Math.PI / 2
    }
    const nodes = listEditableNodes(rect, {})
    const c0 = nodeById(nodes, 'param:corner:0')
    // local (-10,-5) rotated 90deg -> (5, -10)
    expect(c0.point[0]).toBeCloseTo(5, 9)
    expect(c0.point[1]).toBeCloseTo(-10, 9)
  })

  it('circle: center + rim handle on the +X rim', () => {
    const circle: SketchEntity = { id: 'c', kind: 'circle', cx: 30, cy: 0, r: 5 }
    const nodes = listEditableNodes(circle, {})
    expect(nodeIds(nodes)).toEqual(['param:center', 'param:rim'])
    expect(nodeById(nodes, 'param:rim').point).toEqual([35, 0])
  })

  it('slot: center + length cap-center on the +axis end + width side handle', () => {
    const slot: SketchEntity = {
      id: 's',
      kind: 'slot',
      cx: 0,
      cy: 0,
      length: 20,
      width: 8,
      rotation: 0
    }
    const nodes = listEditableNodes(slot, {})
    expect(nodeIds(nodes)).toEqual(['param:center', 'param:length', 'param:width'])
    expect(nodeById(nodes, 'param:length').point).toEqual([10, 0])
    const wid = nodeById(nodes, 'param:width')
    expect(wid.point[0]).toBeCloseTo(0, 9)
    expect(wid.point[1]).toBeCloseTo(4, 9)
  })

  it('slot rotated 90 deg: handles follow the axis/perp frame', () => {
    const slot: SketchEntity = {
      id: 's',
      kind: 'slot',
      cx: 0,
      cy: 0,
      length: 20,
      width: 8,
      rotation: Math.PI / 2
    }
    const nodes = listEditableNodes(slot, {})
    const len = nodeById(nodes, 'param:length')
    const wid = nodeById(nodes, 'param:width')
    expect(len.point[0]).toBeCloseTo(0, 9)
    expect(len.point[1]).toBeCloseTo(10, 9)
    expect(wid.point[0]).toBeCloseTo(-4, 9)
    expect(wid.point[1]).toBeCloseTo(0, 9)
  })

  it('ellipse: center + rx tip on the major axis + ry tip on the minor axis', () => {
    const ell: SketchEntity = {
      id: 'e',
      kind: 'ellipse',
      cx: 5,
      cy: 5,
      rx: 10,
      ry: 4,
      rotation: 0
    }
    const nodes = listEditableNodes(ell, {})
    expect(nodeIds(nodes)).toEqual(['param:center', 'param:rx', 'param:ry'])
    expect(nodeById(nodes, 'param:rx').point).toEqual([15, 5])
    expect(nodeById(nodes, 'param:ry').point).toEqual([5, 9])
  })
})

// ---- moveNode: point-ref semantics ------------------------------------------

describe('moveNode -- point-ref nodes update the SHARED record (S1 semantic)', () => {
  it('moves the record once; EVERY entity referencing the point follows', () => {
    const arc: SketchEntity = { id: 'arc1', kind: 'arc', startId: 'c', viaId: 'd', endId: 'e' }
    const pts: Record<string, SketchPoint> = {
      ...PTS_ABC,
      d: { x: 20, y: 10 },
      e: { x: 30, y: 0 }
    }
    const design = designWith([PL_OPEN, arc], pts)
    const next = moveNode(design, 'pl1', 'c', [12, 14])

    expect(next).not.toBe(design)
    expect(next.points['c']).toEqual({ x: 12, y: 14 })
    // ONE record rewritten -- both sharers see it; entity objects untouched.
    expect(next.entities).toBe(design.entities)
    expect(listEditableNodes(arc, next.points)[0]!.point).toEqual([12, 14])
  })

  it('preserves the `fixed` flag on the moved record', () => {
    const design = designWith([PL_OPEN], { ...PTS_ABC, a: { x: 0, y: 0, fixed: true } })
    const next = moveNode(design, 'pl1', 'a', [1, 2])
    expect(next.points['a']).toEqual({ x: 1, y: 2, fixed: true })
  })

  it('never mutates the input design (pure)', () => {
    const design = designWith([PL_OPEN], PTS_ABC)
    const frozen = JSON.stringify(design)
    moveNode(design, 'pl1', 'b', [99, 99])
    expect(JSON.stringify(design)).toBe(frozen)
  })

  it('same coordinates -> SAME reference back (cheap skip)', () => {
    const design = designWith([PL_OPEN], PTS_ABC)
    expect(moveNode(design, 'pl1', 'b', [10, 0])).toBe(design)
  })

  it('unknown entity / unknown node / point NOT referenced by that entity -> same ref', () => {
    const circle: SketchEntity = { id: 'c1', kind: 'circle', cx: 50, cy: 50, r: 5 }
    const design = designWith([PL_OPEN, circle], PTS_ABC)
    expect(moveNode(design, 'nope', 'a', [1, 1])).toBe(design)
    expect(moveNode(design, 'pl1', 'zz', [1, 1])).toBe(design)
    // `a` is a live record but the circle does not reference it.
    expect(moveNode(design, 'c1', 'a', [1, 1])).toBe(design)
  })

  it('non-finite target -> same ref', () => {
    const design = designWith([PL_OPEN], PTS_ABC)
    expect(moveNode(design, 'pl1', 'a', [Number.NaN, 0])).toBe(design)
    expect(moveNode(design, 'pl1', 'a', [0, Number.POSITIVE_INFINITY])).toBe(design)
  })

  it('missing point record -> same ref (id referenced but record absent)', () => {
    const design = designWith([PL_OPEN], { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } })
    expect(moveNode(design, 'pl1', 'c', [5, 5])).toBe(design)
  })
})

// ---- moveNode: param mappings ----------------------------------------------

describe('moveNode -- rect param handles', () => {
  const RECT: SketchEntity = { id: 'r', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 }

  it('center drag translates cx/cy only', () => {
    const design = designWith([RECT])
    const next = moveNode(design, 'r', 'param:center', [7, -3])
    const r = next.entities[0]!
    expect(r).toMatchObject({ kind: 'rect', cx: 7, cy: -3, w: 20, h: 10, rotation: 0 })
  })

  it('corner drag keeps the OPPOSITE corner fixed and recomputes w/h/cx/cy', () => {
    const design = designWith([RECT])
    // corner 0 = (-10,-5); opposite corner 2 = (10,5) stays put.
    const next = moveNode(design, 'r', 'param:corner:0', [-14, -9])
    const r = next.entities[0]!
    expect(r).toMatchObject({ kind: 'rect', w: 24, h: 14, rotation: 0 })
    if (r.kind === 'rect') {
      expect(r.cx).toBeCloseTo(-2, 9)
      expect(r.cy).toBeCloseTo(-2, 9)
      const corners = listEditableNodes(r, {})
      expect(nodeById(corners, 'param:corner:2').point[0]).toBeCloseTo(10, 9)
      expect(nodeById(corners, 'param:corner:2').point[1]).toBeCloseTo(5, 9)
    }
  })

  it('corner drag collapsing the rect clamps w/h at MIN_PARAM_MM (schema stays valid)', () => {
    const design = designWith([RECT])
    // Drag corner 0 right up against the opposite corner.
    const next = moveNode(design, 'r', 'param:corner:0', [9.9, 4.9])
    const r = next.entities[0]!
    if (r.kind === 'rect') {
      expect(r.w).toBeGreaterThanOrEqual(MIN_PARAM_MM)
      expect(r.h).toBeGreaterThanOrEqual(MIN_PARAM_MM)
    }
  })

  it('ROTATED rect corner drag works in the rotated frame; rotation untouched', () => {
    const rect: SketchEntity = {
      id: 'r',
      kind: 'rect',
      cx: 0,
      cy: 0,
      w: 20,
      h: 10,
      rotation: Math.PI / 2
    }
    const design = designWith([rect])
    // corner 0 world = (5,-10); opposite corner 2 world = (-5,10) stays fixed.
    const next = moveNode(design, 'r', 'param:corner:0', [7, -12])
    const r = next.entities[0]!
    if (r.kind === 'rect') {
      expect(r.rotation).toBe(Math.PI / 2)
      expect(r.w).toBeCloseTo(22, 9)
      expect(r.h).toBeCloseTo(12, 9)
      expect(r.cx).toBeCloseTo(1, 9)
      expect(r.cy).toBeCloseTo(-1, 9)
      // The dragged corner landed where the pointer put it.
      const c0 = nodeById(listEditableNodes(r, {}), 'param:corner:0')
      expect(c0.point[0]).toBeCloseTo(7, 9)
      expect(c0.point[1]).toBeCloseTo(-12, 9)
    }
  })

  it('unknown corner index -> same ref', () => {
    const design = designWith([RECT])
    expect(moveNode(design, 'r', 'param:corner:4', [0, 0])).toBe(design)
    expect(moveNode(design, 'r', 'param:bogus', [0, 0])).toBe(design)
  })
})

describe('moveNode -- circle / slot / ellipse param handles', () => {
  it('circle rim drag sets r from the distance to center (min clamp)', () => {
    const circle: SketchEntity = { id: 'c', kind: 'circle', cx: 30, cy: 0, r: 5 }
    const design = designWith([circle])
    const next = moveNode(design, 'c', 'param:rim', [30, 8])
    expect(next.entities[0]).toMatchObject({ kind: 'circle', cx: 30, cy: 0, r: 8 })
    const tiny = moveNode(design, 'c', 'param:rim', [30, 0.1])
    const t = tiny.entities[0]!
    if (t.kind === 'circle') expect(t.r).toBe(MIN_PARAM_MM)
  })

  it('circle center drag translates; same-position drag -> same ref', () => {
    const circle: SketchEntity = { id: 'c', kind: 'circle', cx: 30, cy: 0, r: 5 }
    const design = designWith([circle])
    const next = moveNode(design, 'c', 'param:center', [1, 2])
    expect(next.entities[0]).toMatchObject({ cx: 1, cy: 2, r: 5 })
    expect(moveNode(design, 'c', 'param:center', [30, 0])).toBe(design)
  })

  it('slot length handle: new center-to-center length = 2x|axis projection| (rotation respected)', () => {
    const slot: SketchEntity = {
      id: 's',
      kind: 'slot',
      cx: 0,
      cy: 0,
      length: 20,
      width: 8,
      rotation: Math.PI / 2
    }
    const design = designWith([slot])
    // Axis is +Y; drag the cap to y=15 (perp x component ignored).
    const next = moveNode(design, 's', 'param:length', [3, 15])
    const s = next.entities[0]!
    if (s.kind === 'slot') {
      expect(s.length).toBeCloseTo(30, 9)
      expect(s.width).toBe(8)
      expect(s.rotation).toBe(Math.PI / 2)
    }
  })

  it('slot length can clamp to 0 (a pure circle slot is schema-legal); width clamps at MIN', () => {
    const slot: SketchEntity = {
      id: 's',
      kind: 'slot',
      cx: 0,
      cy: 0,
      length: 20,
      width: 8,
      rotation: 0
    }
    const design = designWith([slot])
    const zeroLen = moveNode(design, 's', 'param:length', [0, 7])
    const z = zeroLen.entities[0]!
    if (z.kind === 'slot') expect(z.length).toBe(0)
    const thin = moveNode(design, 's', 'param:width', [5, 0.05])
    const t = thin.entities[0]!
    if (t.kind === 'slot') expect(t.width).toBe(MIN_PARAM_MM)
  })

  it('slot width handle: new width = 2x|perp projection|', () => {
    const slot: SketchEntity = {
      id: 's',
      kind: 'slot',
      cx: 10,
      cy: 0,
      length: 20,
      width: 8,
      rotation: 0
    }
    const design = designWith([slot])
    const next = moveNode(design, 's', 'param:width', [12, -6])
    const s = next.entities[0]!
    if (s.kind === 'slot') {
      expect(s.width).toBeCloseTo(12, 9)
      expect(s.length).toBe(20)
    }
  })

  it('ellipse rx/ry tip drags set the |projection| radius in the rotated frame', () => {
    const ell: SketchEntity = {
      id: 'e',
      kind: 'ellipse',
      cx: 0,
      cy: 0,
      rx: 10,
      ry: 4,
      rotation: Math.PI / 2
    }
    const design = designWith([ell])
    // Major axis now +Y: drag the rx tip to y = -14 (|projection| = 14).
    const nx = moveNode(design, 'e', 'param:rx', [2, -14])
    const e1 = nx.entities[0]!
    if (e1.kind === 'ellipse') {
      expect(e1.rx).toBeCloseTo(14, 9)
      expect(e1.ry).toBe(4)
    }
    // Minor axis is -X: drag the ry tip out to x = 6.
    const ny = moveNode(design, 'e', 'param:ry', [6, 1])
    const e2 = ny.entities[0]!
    if (e2.kind === 'ellipse') {
      expect(e2.ry).toBeCloseTo(6, 9)
      expect(e2.rx).toBe(10)
    }
  })

  it('legacy inline polyline param:v:<i> replaces exactly that vertex', () => {
    const pl: SketchEntity = {
      id: 'leg',
      kind: 'polyline',
      points: [
        [0, 0],
        [5, 5],
        [10, 0]
      ],
      closed: false
    }
    const design = designWith([pl])
    const next = moveNode(design, 'leg', 'param:v:1', [6, 7])
    const e = next.entities[0]!
    if (e.kind === 'polyline' && 'points' in e) {
      expect(e.points).toEqual([
        [0, 0],
        [6, 7],
        [10, 0]
      ])
    }
    expect(moveNode(design, 'leg', 'param:v:9', [1, 1])).toBe(design)
  })
})

// ---- insertPolylineNode ------------------------------------------------------

describe('insertPolylineNode -- vertex insert on segment i (after vertex i)', () => {
  it('open polyline: insert on segment 0 lands between vertices 0 and 1, with a fresh record', () => {
    const design = designWith([PL_OPEN], PTS_ABC)
    const next = insertPolylineNode(design, 'pl1', 0, [5, 0], 'new1')
    const e = next.entities[0]!
    if (e.kind === 'polyline' && 'pointIds' in e) {
      expect(e.pointIds).toEqual(['a', 'new1', 'b', 'c'])
    }
    expect(next.points['new1']).toEqual({ x: 5, y: 0 })
    // Pure: the input design is untouched.
    expect(design.points['new1']).toBeUndefined()
    expect((design.entities[0] as { pointIds: string[] }).pointIds).toEqual(['a', 'b', 'c'])
  })

  it('closed polyline: the wrap segment (last->first) appends at the end', () => {
    const closed: SketchEntity = { id: 'cl', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true }
    const design = designWith([closed], PTS_ABC)
    const next = insertPolylineNode(design, 'cl', 2, [5, 5], 'new2')
    const e = next.entities[0]!
    if (e.kind === 'polyline' && 'pointIds' in e) {
      expect(e.pointIds).toEqual(['a', 'b', 'c', 'new2'])
    }
  })

  it('segment index out of range -> same ref (open n-1 segments; closed n)', () => {
    const design = designWith([PL_OPEN], PTS_ABC)
    expect(insertPolylineNode(design, 'pl1', 2, [5, 5], 'x')).toBe(design) // open: segs 0..1
    const closed: SketchEntity = { id: 'cl', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true }
    const d2 = designWith([closed], PTS_ABC)
    expect(insertPolylineNode(d2, 'cl', 3, [5, 5], 'x')).toBe(d2) // closed: segs 0..2
  })

  it('invalid inputs -> same ref (negative / non-integer / non-finite / wrong kind / id collision)', () => {
    const circle: SketchEntity = { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 5 }
    const design = designWith([PL_OPEN, circle], PTS_ABC)
    expect(insertPolylineNode(design, 'pl1', -1, [5, 5], 'x')).toBe(design)
    expect(insertPolylineNode(design, 'pl1', 0.5, [5, 5], 'x')).toBe(design)
    expect(insertPolylineNode(design, 'pl1', 0, [Number.NaN, 5], 'x')).toBe(design)
    expect(insertPolylineNode(design, 'c1', 0, [5, 5], 'x')).toBe(design)
    expect(insertPolylineNode(design, 'pl1', 0, [5, 5], 'a')).toBe(design) // collides with live record
  })

  it('omitted newPointId mints a fresh uuid record', () => {
    const design = designWith([PL_OPEN], PTS_ABC)
    const next = insertPolylineNode(design, 'pl1', 1, [10, 5])
    const e = next.entities[0]!
    if (e.kind === 'polyline' && 'pointIds' in e) {
      expect(e.pointIds).toHaveLength(4)
      const minted = e.pointIds[2]!
      expect(['a', 'b', 'c']).not.toContain(minted)
      expect(next.points[minted]).toEqual({ x: 10, y: 5 })
    }
  })

  it('legacy inline-points polyline splices the coordinate array', () => {
    const pl: SketchEntity = {
      id: 'leg',
      kind: 'polyline',
      points: [
        [0, 0],
        [10, 0]
      ],
      closed: false
    }
    const design = designWith([pl])
    const next = insertPolylineNode(design, 'leg', 0, [5, 2])
    const e = next.entities[0]!
    if (e.kind === 'polyline' && 'points' in e) {
      expect(e.points).toEqual([
        [0, 0],
        [5, 2],
        [10, 0]
      ])
    }
  })
})

// ---- deletePolylineNode ------------------------------------------------------

describe('deletePolylineNode -- integrity floor + orphan rules', () => {
  it('open polyline: deletes the vertex and prunes the now-orphaned record', () => {
    const design = designWith([PL_OPEN], PTS_ABC)
    const next = deletePolylineNode(design, 'pl1', 'b')
    const e = next.entities[0]!
    if (e.kind === 'polyline' && 'pointIds' in e) {
      expect(e.pointIds).toEqual(['a', 'c'])
    }
    expect(next.points['b']).toBeUndefined()
    expect(Object.keys(next.points).sort()).toEqual(['a', 'c'])
  })

  it('open polyline floor: 2 vertices must remain (refuses below)', () => {
    const two: SketchEntity = { id: 'p2', kind: 'polyline', pointIds: ['a', 'b'], closed: false }
    const design = designWith([two], PTS_ABC)
    expect(deletePolylineNode(design, 'p2', 'a')).toBe(design)
  })

  it('closed loop floor: 3 vertices must remain (4 -> 3 ok; 3 -> refuse)', () => {
    const four: SketchEntity = {
      id: 'p4',
      kind: 'polyline',
      pointIds: ['a', 'b', 'c', 'd'],
      closed: true
    }
    const three: SketchEntity = { id: 'p3', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true }
    const pts = { ...PTS_ABC, d: { x: 0, y: 10 } }
    const d4 = designWith([four], pts)
    const next = deletePolylineNode(d4, 'p4', 'd')
    const e = next.entities[0]!
    if (e.kind === 'polyline' && 'pointIds' in e) {
      expect(e.pointIds).toEqual(['a', 'b', 'c'])
    }
    const d3 = designWith([three], PTS_ABC)
    expect(deletePolylineNode(d3, 'p3', 'b')).toBe(d3)
  })

  it('a point shared with ANOTHER entity keeps its record (only the reference is dropped)', () => {
    const arc: SketchEntity = { id: 'arc1', kind: 'arc', startId: 'b', viaId: 'x', endId: 'y' }
    const pts = { ...PTS_ABC, x: { x: 20, y: 5 }, y: { x: 30, y: 0 } }
    const design = designWith([PL_OPEN, arc], pts)
    const next = deletePolylineNode(design, 'pl1', 'b')
    const e = next.entities[0]!
    if (e.kind === 'polyline' && 'pointIds' in e) {
      expect(e.pointIds).toEqual(['a', 'c'])
    }
    expect(next.points['b']).toEqual({ x: 10, y: 0 }) // arc still references it
  })

  it('a constraint-referenced point keeps its record', () => {
    const design: DesignFileV2 = {
      ...designWith([PL_OPEN], PTS_ABC),
      constraints: [{ id: 'k1', type: 'fix', pointId: 'b' }]
    }
    const next = deletePolylineNode(design, 'pl1', 'b')
    expect(next.points['b']).toEqual({ x: 10, y: 0 })
  })

  it('a dimension-referenced point keeps its record', () => {
    const design: DesignFileV2 = {
      ...designWith([PL_OPEN], PTS_ABC),
      dimensions: [{ id: 'dim1', kind: 'linear', aId: 'a', bId: 'b' }]
    }
    const next = deletePolylineNode(design, 'pl1', 'b')
    expect(next.points['b']).toEqual({ x: 10, y: 0 })
  })

  it('legacy inline-points polyline: param:v:<i> deletes that vertex with the same floors', () => {
    const pl: SketchEntity = {
      id: 'leg',
      kind: 'polyline',
      points: [
        [0, 0],
        [5, 5],
        [10, 0]
      ],
      closed: false
    }
    const design = designWith([pl])
    const next = deletePolylineNode(design, 'leg', 'param:v:1')
    const e = next.entities[0]!
    if (e.kind === 'polyline' && 'points' in e) {
      expect(e.points).toEqual([
        [0, 0],
        [10, 0]
      ])
    }
    // Floor: open keeps >= 2.
    const two: SketchEntity = {
      id: 'l2',
      kind: 'polyline',
      points: [
        [0, 0],
        [5, 5]
      ],
      closed: false
    }
    const d2 = designWith([two])
    expect(deletePolylineNode(d2, 'l2', 'param:v:0')).toBe(d2)
  })

  it('unknown node / wrong kind / pure no-op -> same ref', () => {
    const circle: SketchEntity = { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 5 }
    const design = designWith([PL_OPEN, circle], PTS_ABC)
    expect(deletePolylineNode(design, 'pl1', 'zz')).toBe(design)
    expect(deletePolylineNode(design, 'c1', 'a')).toBe(design)
    const frozen = JSON.stringify(design)
    deletePolylineNode(design, 'pl1', 'b')
    expect(JSON.stringify(design)).toBe(frozen)
  })
})

// ---- pick helpers ------------------------------------------------------------

describe('nearestPolylineSegment -- the double-click insert resolver', () => {
  it('picks the nearest segment within tolerance (segment i joins vertex i..i+1)', () => {
    // a(0,0) -> b(10,0) -> c(10,10)
    expect(nearestPolylineSegment(PL_OPEN, PTS_ABC, [5, 0.5], 2)).toEqual({ segmentIndex: 0 })
    expect(nearestPolylineSegment(PL_OPEN, PTS_ABC, [9.5, 5], 2)).toEqual({ segmentIndex: 1 })
  })

  it('closed loops include the wrap segment (last -> first)', () => {
    const closed: SketchEntity = { id: 'cl', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true }
    // Wrap segment c(10,10) -> a(0,0); midpoint (5,5).
    expect(nearestPolylineSegment(closed, PTS_ABC, [5.4, 4.6], 1)).toEqual({ segmentIndex: 2 })
  })

  it('outside tolerance / missing record / wrong kind -> null', () => {
    expect(nearestPolylineSegment(PL_OPEN, PTS_ABC, [50, 50], 2)).toBeNull()
    expect(nearestPolylineSegment(PL_OPEN, { a: { x: 0, y: 0 } }, [5, 0], 2)).toBeNull()
    const circle: SketchEntity = { id: 'c1', kind: 'circle', cx: 0, cy: 0, r: 5 }
    expect(nearestPolylineSegment(circle, {}, [5, 0], 2)).toBeNull()
    expect(nearestPolylineSegment(PL_OPEN, PTS_ABC, [5, 0], 0)).toBeNull()
  })

  it('legacy inline-points polylines resolve segments too', () => {
    const pl: SketchEntity = {
      id: 'leg',
      kind: 'polyline',
      points: [
        [0, 0],
        [10, 0],
        [10, 10]
      ],
      closed: false
    }
    expect(nearestPolylineSegment(pl, {}, [10.3, 5], 1)).toEqual({ segmentIndex: 1 })
  })
})

describe('nearestEditableNode + the handle aperture', () => {
  const NODES: SketchEditableNode[] = [
    { nodeId: 'n0', point: [0, 0], role: 'point-ref' },
    { nodeId: 'n1', point: [10, 0], role: 'point-ref' },
    { nodeId: 'n2', point: [10.5, 0], role: 'param' }
  ]

  it('picks the nearest node within tolerance', () => {
    expect(nearestEditableNode(NODES, [9.9, 0.1], 1)?.nodeId).toBe('n1')
    expect(nearestEditableNode(NODES, [10.45, 0], 1)?.nodeId).toBe('n2')
    expect(nearestEditableNode(NODES, [4, 4], 1)).toBeNull()
  })

  it('guards non-finite input + non-positive tolerance', () => {
    expect(nearestEditableNode(NODES, [Number.NaN, 0], 1)).toBeNull()
    expect(nearestEditableNode(NODES, [0, 0], 0)).toBeNull()
    expect(nearestEditableNode([], [0, 0], 1)).toBeNull()
  })

  it('nodeHandlePickToleranceMm converts the px aperture at the zoom scale (floor-guarded)', () => {
    expect(nodeHandlePickToleranceMm(2)).toBeCloseTo(NODE_HANDLE_PICK_PX / 2, 12)
    expect(nodeHandlePickToleranceMm(0)).toBeCloseTo(NODE_HANDLE_PICK_PX / 0.05, 12)
  })
})
