/**
 * Sketch S1 — END-TO-END direct-manipulation contract (data level, node-SSR).
 *
 * The S1 wave landed in two halves:
 *   - the CANVAS half (`Sketch2DCanvas` + `sketch2d-hit-test.ts`): click
 *     hit-testing, the drag threshold, the ONE grid-snapped move per drag;
 *   - the SURFACE half (`SketchSurface` + `sketch-history.ts`): the lifted
 *     selection state, the pure move/delete appliers, the undo/redo ring.
 *
 * Repo tests are node-SSR (no jsdom, no pointer events), so this file proves
 * the INTEGRATION at the data level: a harness that composes the REAL exported
 * primitives exactly the way `SketchSurface` + `Sketch2DCanvas` compose them
 * (the composition itself is source-pinned in `SketchSurface.history.test.tsx`
 * and `Sketch2DCanvas.select-render.test.tsx`), then walks the full journey:
 *
 *   draw → select (real hit test) → drag-move → undo → redo →
 *   delete → undo → redo → full unwind/replay
 *
 * asserting value round-trips at every hop INCLUDING shared-point integrity
 * (a polyline endpoint shared with an arc moves exactly once when both are
 * selected, drags the neighbor when only one is, survives deletion of one
 * referencing entity, and is restored verbatim by undo).
 *
 * Also pins the Wave-3g dialog linkage: the Offset / Boolean / Array dialogs
 * receive `selectedIds` derived from the SAME lifted state the canvas pick
 * writes — so a canvas-picked loop is what the dialogs operate on.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  emptyDesign,
  type DesignFileV2,
  type SketchEntity,
  type SketchPoint
} from '../../../shared/design-schema'
import {
  createSketchHistory,
  deleteSelectedSketchEntities,
  translateSelectedSketchEntities,
  type SketchHistoryOptions
} from '../sketch-history'
import {
  dragExceedsThreshold,
  hitTestSketchEntities,
  selectPickToleranceMm,
  snappedDragDelta
} from '../sketch2d-hit-test'
import { cloneDesign } from '../solver2d'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SURFACE_SRC = readFileSync(join(__dirname, '..', 'SketchSurface.tsx'), 'utf8')

/** SketchSurface's snap-ON grid pitch (SNAP_GRID_MM). */
const GRID_MM = 5
/** Sketch2DCanvas's initial zoom (px per mm). */
const SCALE = 2.5

type WorldPt = readonly [number, number]

/**
 * The integration harness — `SketchSurface`'s orchestration, handler for
 * handler, over the real pure primitives. Each method's body mirrors the
 * component function named in its comment; the source pins in
 * `SketchSurface.history.test.tsx` hold the component to the same shape.
 */
function createSurfaceHarness(options: SketchHistoryOptions = {}) {
  const history = createSketchHistory(undefined, options)
  /** Mirrors `liveDesignRef` + the session reducer's verbatim `edit` store. */
  let live: DesignFileV2 = emptyDesign()
  /** Mirrors the lifted `selectedEntityIds` state. */
  let selected: ReadonlySet<string> = new Set<string>()

  /** Mirrors `handleEntityPick` (null = empty click → clear; additive = toggle). */
  function pick(id: string | null, additive: boolean): void {
    const prev = selected
    if (id === null) {
      selected = prev.size === 0 ? prev : new Set<string>()
      return
    }
    if (!additive) {
      selected = new Set([id])
      return
    }
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected = next
  }

  /** Mirrors `applyDesignEdit` — pre-state into history, then apply. */
  function applyDesignEdit(next: DesignFileV2): void {
    history.push(live)
    live = next
  }

  /** Mirrors `handleMoveSelected` — narrowed selection, coalesced per-selection tag. */
  function moveSelected(dxMm: number, dyMm: number): void {
    const cur = live
    const ids = new Set([...selected].filter((id) => cur.entities.some((e) => e.id === id)))
    if (ids.size === 0) return
    const next = translateSelectedSketchEntities(cur, ids, dxMm, dyMm)
    if (next === cur) return
    history.pushCoalesced(cur, `move:${[...ids].sort().join('|')}`)
    live = next
  }

  /** Mirrors `handleDeleteSelected` — one push, selection pruned after. */
  function deleteSelected(): { removedEntityIds: readonly string[]; removedPointIds: readonly string[] } {
    const cur = live
    const result = deleteSelectedSketchEntities(cur, selected)
    if (result.removedEntityIds.length === 0) {
      return { removedEntityIds: [], removedPointIds: [] }
    }
    history.push(cur)
    live = result.design
    const next = new Set(selected)
    for (const id of result.removedEntityIds) next.delete(id)
    selected = next
    return { removedEntityIds: result.removedEntityIds, removedPointIds: result.removedPointIds }
  }

  /** Mirrors `performUndo` / `performRedo` — re-apply through the same path. */
  function undo(): boolean {
    const prev = history.undo(live)
    if (prev === null) return false
    live = prev
    return true
  }
  function redo(): boolean {
    const next = history.redo(live)
    if (next === null) return false
    live = next
    return true
  }

  /** Mirrors the `selectedIds` useMemo — the EXACT array the dialogs receive. */
  function liveSelectedIds(): string[] {
    const liveIds = new Set(live.entities.map((e) => e.id))
    return [...selected].filter((id) => liveIds.has(id))
  }

  // ── Canvas-gesture emulation over the real resolvers ───────────────────────

  /**
   * One click (press + in-place release) of the select tool — mirrors
   * `onMouseDown`'s select arm + `beginSelectGesture` + `onMouseUp`: a press
   * resolves the pick at the RAW world point via `hitTestSketchEntities`;
   * fresh picks emit on press, already-selected picks emit the toggle/replace
   * on release — either way exactly ONE `onEntityPick`. A plain empty click
   * clears; Shift+empty pans (no pick emitted).
   */
  function clickAt(world: WorldPt, additive = false, scale = SCALE): string | null {
    const hit = hitTestSketchEntities({
      design: live,
      worldPoint: world,
      toleranceMm: selectPickToleranceMm(scale)
    })
    if (!hit) {
      if (!additive) pick(null, false)
      return null
    }
    pick(hit.entityId, additive)
    return hit.entityId
  }

  /**
   * Press on an entity, drag, release — mirrors the full gesture: a press on
   * an UNSELECTED entity emits the pick first (so the drag moves the NEW
   * selection); past the 3 px threshold the release emits ONE grid-snapped
   * `onMoveSelected`; the zero-delta release emits nothing.
   */
  function dragAt(
    pressWorld: WorldPt,
    releaseWorld: WorldPt,
    additive = false,
    scale = SCALE,
    gridMm = GRID_MM
  ): void {
    const hit = hitTestSketchEntities({
      design: live,
      worldPoint: pressWorld,
      toleranceMm: selectPickToleranceMm(scale)
    })
    if (!hit) return
    const alreadySelected = selected.has(hit.entityId)
    if (!alreadySelected) pick(hit.entityId, additive)
    if (!dragExceedsThreshold(pressWorld, releaseWorld, scale)) {
      if (alreadySelected) pick(hit.entityId, additive)
      return
    }
    const [dxMm, dyMm] = snappedDragDelta(pressWorld, releaseWorld, gridMm)
    if (dxMm !== 0 || dyMm !== 0) moveSelected(dxMm, dyMm)
  }

  return {
    history,
    get design(): DesignFileV2 {
      return live
    },
    get selection(): ReadonlySet<string> {
      return selected
    },
    pick,
    applyDesignEdit,
    moveSelected,
    deleteSelected,
    undo,
    redo,
    liveSelectedIds,
    clickAt,
    dragAt
  }
}

type Harness = ReturnType<typeof createSurfaceHarness>

// ── The shared fixture: rect + circle + a polyline SHARING a point with an arc ─
//
//   pl1: open polyline pA(0,0) ── pB(40,0)
//   a1:  arc start pB (SHARED with pl1) via pV(60,20) end pE(80,0)
//        (circle center (60,0), r 20 — the via point is the arc's apex)
//   r1:  rect center (100,50) 20×10  → edges x∈{90,110}, y∈{45,55}
//   c1:  circle center (150,50) r 10

const RECT: SketchEntity = { id: 'r1', kind: 'rect', cx: 100, cy: 50, w: 20, h: 10, rotation: 0 }
const CIRCLE: SketchEntity = { id: 'c1', kind: 'circle', cx: 150, cy: 50, r: 10 }
const POLYLINE: SketchEntity = { id: 'pl1', kind: 'polyline', pointIds: ['pA', 'pB'], closed: false }
const ARC: SketchEntity = { id: 'a1', kind: 'arc', startId: 'pB', viaId: 'pV', endId: 'pE' }

/** Commit the four entities the way the canvas draw tools commit — one `onDesignChange` each. */
function drawFixture(h: Harness): void {
  // rect tool commit
  h.applyDesignEdit({ ...h.design, entities: [...h.design.entities, RECT] })
  // circle tool commit
  h.applyDesignEdit({ ...h.design, entities: [...h.design.entities, CIRCLE] })
  // line tool commit: point records + entity in ONE edit (closePolyline shape)
  h.applyDesignEdit({
    ...h.design,
    points: { ...h.design.points, pA: { x: 0, y: 0 }, pB: { x: 40, y: 0 } },
    entities: [...h.design.entities, POLYLINE]
  })
  // arc tool commit: REUSES the existing pB record, adds via + end
  h.applyDesignEdit({
    ...h.design,
    points: { ...h.design.points, pV: { x: 60, y: 20 }, pE: { x: 80, y: 0 } },
    entities: [...h.design.entities, ARC]
  })
}

function pointsOf(d: DesignFileV2): Record<string, SketchPoint> {
  return d.points
}

describe('Sketch S1 e2e — draw phase routes through the history seam', () => {
  it('four canvas commits = four undo steps; the model holds all four entities + the shared point once', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    expect(h.design.entities.map((e) => e.id)).toEqual(['r1', 'c1', 'pl1', 'a1'])
    expect(Object.keys(h.design.points).sort()).toEqual(['pA', 'pB', 'pE', 'pV'])
    expect(h.history.undoDepth()).toBe(4)
    expect(h.history.canRedo()).toBe(false)
  })
})

describe('Sketch S1 e2e — click-select through the REAL hit test', () => {
  it('a click on the rect OUTLINE picks r1; a click in its FILL picks nothing and clears', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    // On the right edge (x=110) — distance 0, well inside the 8px/2.5 = 3.2 mm aperture.
    expect(h.clickAt([110, 50])).toBe('r1')
    expect([...h.selection]).toEqual(['r1'])
    // Dead center of the rect: nearest edge is 5 mm away > 3.2 mm → outline-not-fill miss.
    expect(h.clickAt([100, 50])).toBeNull()
    expect(h.selection.size).toBe(0)
  })

  it('plain pick replaces; Shift pick adds; Shift pick again toggles OFF', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    expect(h.clickAt([20, 0.5])).toBe('pl1') // 0.5 mm off the segment
    expect(h.clickAt([60, 20.5], true)).toBe('a1') // 0.5 mm above the arc apex
    expect([...h.selection].sort()).toEqual(['a1', 'pl1'])
    expect(h.clickAt([60, 20.5], true)).toBe('a1') // toggle off
    expect([...h.selection]).toEqual(['pl1'])
    expect(h.clickAt([110, 50])).toBe('r1') // plain pick replaces
    expect([...h.selection]).toEqual(['r1'])
  })
})

describe('Sketch S1 e2e — drag-move with shared-point integrity', () => {
  function selectLineAndArc(h: Harness): void {
    h.clickAt([20, 0.5])
    h.clickAt([60, 20.5], true)
    expect([...h.selection].sort()).toEqual(['a1', 'pl1'])
  }

  it('one drag = ONE snapped move: every referenced point moves once (pB shared by BOTH selected entities)', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    selectLineAndArc(h)
    const preMove = cloneDesign(h.design)

    // Press on the already-selected polyline, drag (+12.4, +6.2) raw → (+10, +5) on the 5 mm grid.
    h.dragAt([20, 0], [32.4, 6.2])

    expect(pointsOf(h.design)).toEqual({
      pA: { x: 10, y: 5 },
      pB: { x: 50, y: 5 }, // moved exactly ONCE despite two selected referents
      pV: { x: 70, y: 25 },
      pE: { x: 90, y: 5 }
    })
    // Unselected entities are untouched — same references out of the mapper.
    expect(h.design.entities.find((e) => e.id === 'r1')).toBe(RECT)
    expect(h.design.entities.find((e) => e.id === 'c1')).toBe(CIRCLE)
    // The whole drag is ONE undoable step on top of the four draw steps.
    expect(h.history.undoDepth()).toBe(5)

    // undo → value-equal to the pre-move model; redo → forward again.
    expect(h.undo()).toBe(true)
    expect(h.design).toEqual(preMove)
    expect(h.redo()).toBe(true)
    expect(pointsOf(h.design)['pB']).toEqual({ x: 50, y: 5 })
  })

  it('a sub-threshold wiggle emits NO move (no history step, geometry untouched)', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    selectLineAndArc(h)
    const before = cloneDesign(h.design)
    // 0.4 mm at 2.5 px/mm = 1 px of travel — under the 3 px threshold.
    h.dragAt([20, 0], [20.4, 0])
    expect(h.design).toEqual(before)
    expect(h.history.undoDepth()).toBe(4)
  })

  it('moving ONLY the arc drags the SHARED endpoint, towing the unselected polyline (connected-sketch)', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    h.clickAt([60, 20.5]) // plain pick → selection {a1} only
    expect([...h.selection]).toEqual(['a1'])

    h.moveSelected(5, 0) // the canvas would emit exactly this after a snapped drag

    expect(pointsOf(h.design)).toEqual({
      pA: { x: 0, y: 0 }, // pl1's far end stays
      pB: { x: 45, y: 0 }, // shared endpoint follows the arc — pl1's geometry tows
      pV: { x: 65, y: 20 },
      pE: { x: 85, y: 0 }
    })
    // pl1's entity record itself is unchanged (point-backed kind): same reference.
    expect(h.design.entities.find((e) => e.id === 'pl1')).toBe(POLYLINE)
  })
})

describe('Sketch S1 e2e — delete with orphan pruning + undo/redo round-trip', () => {
  it('deleting the arc prunes ITS points but keeps the endpoint the polyline still shares', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    h.clickAt([60, 20.5])
    const preDelete = cloneDesign(h.design)

    const result = h.deleteSelected()
    expect(result.removedEntityIds).toEqual(['a1'])
    expect([...result.removedPointIds].sort()).toEqual(['pE', 'pV'])
    expect(h.design.entities.map((e) => e.id)).toEqual(['r1', 'c1', 'pl1'])
    expect(Object.keys(h.design.points).sort()).toEqual(['pA', 'pB']) // pB survives via pl1
    expect(h.selection.size).toBe(0) // pruned
    expect(h.history.undoDepth()).toBe(5) // 4 draws + 1 delete

    // The hit test agrees the arc is gone: its apex now picks nothing.
    expect(h.clickAt([60, 20.5])).toBeNull()

    // undo → the arc AND its points come back verbatim; redo → gone again.
    expect(h.undo()).toBe(true)
    expect(h.design).toEqual(preDelete)
    expect(h.clickAt([60, 20.5])).toBe('a1')
    h.pick(null, false)
    expect(h.redo()).toBe(true)
    expect(h.design.entities.map((e) => e.id)).toEqual(['r1', 'c1', 'pl1'])
    expect(Object.keys(h.design.points).sort()).toEqual(['pA', 'pB'])
  })

  it('the FULL journey unwinds to the empty design and replays forward identically', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    h.clickAt([20, 0.5])
    h.clickAt([60, 20.5], true)
    h.dragAt([20, 0], [32.4, 6.2]) // move both (+10, +5)
    h.pick('a1', false) // select just the arc (replaces)
    h.deleteSelected()
    const final = cloneDesign(h.design)
    const steps = h.history.undoDepth()
    expect(steps).toBe(6) // 4 draws + 1 move + 1 delete

    let undone = 0
    while (h.undo()) undone++
    expect(undone).toBe(steps)
    expect(h.design).toEqual(emptyDesign())
    expect(h.history.canUndo()).toBe(false)

    let redone = 0
    while (h.redo()) redone++
    expect(redone).toBe(steps)
    expect(h.design).toEqual(final)
    expect(h.history.canRedo()).toBe(false)
  })

  it('a stale selection (its draw step undone) is inert: no move, no history step, dialogs see []', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    h.clickAt([60, 20.5]) // {a1}
    h.undo() // un-draw the arc — the selection id is now stale
    expect([...h.selection]).toEqual(['a1'])
    expect(h.liveSelectedIds()).toEqual([]) // the dialogs' narrowed view
    const before = cloneDesign(h.design)
    h.moveSelected(10, 0)
    expect(h.design).toEqual(before)
    expect(h.history.undoDepth()).toBe(3)
    expect(h.deleteSelected().removedEntityIds).toEqual([])
  })
})

describe('Sketch S1 e2e — drag coalescing per selection (injected clock)', () => {
  it('rapid same-selection moves collapse into one step; window expiry or a selection change splits', () => {
    let clock = 0
    const h = createSurfaceHarness({ now: () => clock, coalesceWindowMs: 1500 })
    drawFixture(h)
    h.clickAt([110, 50]) // {r1}

    clock = 1000
    h.moveSelected(5, 0) // step 5 (new coalesce run)
    clock = 1500
    h.moveSelected(5, 0) // Δ500 ≤ window → same step
    expect(h.history.undoDepth()).toBe(5)
    expect((h.design.entities.find((e) => e.id === 'r1') as { cx: number }).cx).toBe(110)

    clock = 3200
    h.moveSelected(5, 0) // Δ1700 > window → NEW step
    expect(h.history.undoDepth()).toBe(6)

    clock = 3300
    h.pick('c1', true) // selection {r1, c1} → different tag
    h.moveSelected(0, 5) // → NEW step despite being inside the window
    expect(h.history.undoDepth()).toBe(7)

    // One undo removes only the last (two-entity) move.
    h.undo()
    expect((h.design.entities.find((e) => e.id === 'c1') as { cy: number }).cy).toBe(50)
    expect((h.design.entities.find((e) => e.id === 'r1') as { cx: number }).cx).toBe(115)
    // Next undo removes the post-expiry single move…
    h.undo()
    expect((h.design.entities.find((e) => e.id === 'r1') as { cx: number }).cx).toBe(110)
    // …and the next removes BOTH rapid moves at once (they were one gesture).
    h.undo()
    expect((h.design.entities.find((e) => e.id === 'r1') as { cx: number }).cx).toBe(100)
  })
})

describe('Sketch S1 e2e — the canvas-picked selection feeds the Offset/Boolean/Array dialogs', () => {
  it('the harness mirror: picked ids narrowed to live entities IS the dialog input array', () => {
    const h = createSurfaceHarness()
    drawFixture(h)
    h.clickAt([110, 50]) // r1 via the canvas hit test
    h.clickAt([160, 50], true) // c1 outline (x = cx + r = 160), additive
    expect(h.liveSelectedIds()).toEqual(['r1', 'c1'])
  })

  it('SOURCE: SketchSurface hands the SAME derived selectedIds to all three dialogs', () => {
    // The derivation narrows the lifted canvas-pick state to live entity ids …
    expect(SURFACE_SRC).toMatch(
      /const selectedIds = useMemo\(\(\) => \{\s*const live = new Set\(design\.entities\.map\(\(e\) => e\.id\)\)\s*return \[\.\.\.selectedEntityIds\]\.filter\(\(id\) => live\.has\(id\)\)/
    )
    // … and each dialog receives exactly that array.
    expect(SURFACE_SRC.match(/selectedIds=\{selectedIds\}/g)).toHaveLength(3)
    // The canvas pick callback writes the SAME lifted state the dialogs read.
    expect(SURFACE_SRC).toMatch(
      /function handleEntityPick\(id: string \| null, additive: boolean\): void \{\s*setSelectedEntityIds/
    )
    // And the bridge hands that callback to the canvas (spread is pinned elsewhere).
    expect(SURFACE_SRC).toMatch(/onEntityPick: handleEntityPick/)
  })
})
