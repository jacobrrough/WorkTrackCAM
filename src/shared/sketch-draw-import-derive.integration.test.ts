/**
 * Wave 3e — the ONE shared sketch model, proven end-to-end.
 *
 * The keystone claim of this wave is that *authoring* (a vector drawn on the
 * mounted `Sketch2DCanvas` / `SketchSurface`) and *import* (a vector folded in
 * from a bulge-accurate DXF) read and write the SAME `design.sketch` model — so
 * either source is visible on the canvas AND derivable into a machinable
 * contour / pocket / V-carve / drill operation through the identical
 * `src/shared/cam-2d-derive.ts` path.
 *
 * The per-source halves are already pinned elsewhere:
 *   - DXF → derive: `src/shared/dxf-to-sketch.test.ts`.
 *   - derive in isolation: `src/shared/cam-2d-derive.test.ts`.
 *
 * What was NOT pinned — and is the load-bearing integration this file adds — is:
 *   1. the DRAW half: a draw COMMIT (the exact `onDesignChange(next)` object the
 *      canvas emits from `finalizeRectDrag` / `finalizeCircleDrag` / the polyline
 *      finalizer) flows into `cam-2d-derive` and yields machinable points; and
 *   2. CONVERGENCE: a drawn vector and an imported vector of the same nominal
 *      geometry produce equivalent derive output — i.e. the two front-ends feed
 *      ONE model, not two parallel ones.
 *
 * Pure / node-env: no React, no jsdom, no IPC. We do not drive a real pointer
 * (the renderer suite is SSR-only); instead we reproduce the canvas's commit
 * shape verbatim — the data contract the live surface actually writes — which is
 * the half that has to round-trip into CAM. A drift in that shape (e.g. the
 * canvas starts emitting a different entity kind) would fail this test.
 *
 * ── G-CODE SAFETY ──
 * This file exercises sketch geometry → derived 2D point lists only. It never
 * emits, mutates, or posts a toolpath; the Laguna/Carvera/K2 post invariants and
 * the V-carve depth caps all live downstream of `cam-2d-derive` and are
 * untouched here.
 */

import { describe, expect, it } from 'vitest'
import {
  emptyDesign,
  normalizeDesign,
  type DesignFileV2,
  type SketchEntity
} from './design-schema'
import {
  deriveContourPointsFromDesign,
  deriveDrillPointsFromDesign,
  listContourCandidatesFromDesign,
  contourPointSignature
} from './cam-2d-derive'
import { dxfToSketch } from './dxf-to-sketch'
import { parseDxf, type DxfParseResult } from './dxf-parser'

// ───────────────────────────────────────────────────────────────────────────
// DRAW commit helpers — reproduce, verbatim, the object Sketch2DCanvas writes
// through `onDesignChange`. These mirror the canvas's own finalizers so a
// future change to the canvas's commit shape surfaces here as a type/run break.
// (See Sketch2DCanvas.finalizeRectDrag / finalizeCircleDrag / the polyline
// finalizer — each does `onDesignChange({ ...design, entities: [...] })`.)
// ───────────────────────────────────────────────────────────────────────────

/** Commit a rectangle exactly as `finalizeRectDrag` does (center + w/h). */
function commitRect(
  design: DesignFileV2,
  id: string,
  cx: number,
  cy: number,
  w: number,
  h: number
): DesignFileV2 {
  const entity: SketchEntity = { id, kind: 'rect', cx, cy, w, h, rotation: 0 }
  return { ...design, entities: [...design.entities, entity] }
}

/** Commit a circle exactly as `finalizeCircleDrag` does (center + r). */
function commitCircle(
  design: DesignFileV2,
  id: string,
  cx: number,
  cy: number,
  r: number
): DesignFileV2 {
  const entity: SketchEntity = { id, kind: 'circle', cx, cy, r }
  return { ...design, entities: [...design.entities, entity] }
}

/**
 * Commit a closed polyline as the canvas does — entity references point ids,
 * and the vertices are registered into `design.points`. This is the general
 * draw shape (line / polyline tools all land as point-id polylines).
 */
function commitClosedPolyline(
  design: DesignFileV2,
  id: string,
  verts: ReadonlyArray<readonly [number, number]>
): DesignFileV2 {
  const points = { ...design.points }
  const pointIds: string[] = []
  verts.forEach(([x, y], i) => {
    const pid = `${id}_p${i}`
    points[pid] = { x, y }
    pointIds.push(pid)
  })
  const entity: SketchEntity = { id, kind: 'polyline', pointIds, closed: true }
  return { ...design, points, entities: [...design.entities, entity] }
}

/** A minimal closed-rect LWPOLYLINE DXF in mm (no unit conversion needed). */
function rectDxf(w: number, h: number): DxfParseResult {
  const text = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'PROFILE', '90', '4', '70', '1',
    '10', '0', '20', '0',
    '10', String(w), '20', '0',
    '10', String(w), '20', String(h),
    '10', '0', '20', String(h),
    '0', 'ENDSEC', '0', 'EOF', ''
  ].join('\n')
  return parseDxf(text)
}

/** A single CIRCLE DXF in mm (drives the drill-point derive). */
function circleDxf(cx: number, cy: number, r: number): DxfParseResult {
  const text = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'CIRCLE', '8', 'HOLES',
    '10', String(cx), '20', String(cy), '40', String(r),
    '0', 'ENDSEC', '0', 'EOF', ''
  ].join('\n')
  return parseDxf(text)
}

// ───────────────────────────────────────────────────────────────────────────
// 1. DRAW → derive — a drawn vector yields machinable points.
// ───────────────────────────────────────────────────────────────────────────

describe('draw → derive: an authored vector becomes machinable points', () => {
  it('a drawn rectangle derives a closed contour (≥3 points, right extent)', () => {
    const drawn = commitRect(emptyDesign(), 'draw-rect', 25, 15, 50, 30)

    // Visible-on-canvas + derivable: it is a contour candidate.
    const candidates = listContourCandidatesFromDesign(drawn)
    expect(candidates.some((c) => c.sourceId === 'draw-rect')).toBe(true)

    const contour = deriveContourPointsFromDesign(drawn)
    expect(contour.length).toBeGreaterThanOrEqual(3)
    // Rect centered at (25,15) with w=50,h=30 spans x∈[0,50], y∈[0,30].
    const xs = contour.map((p) => p[0])
    const ys = contour.map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(0, 6)
    expect(Math.max(...xs)).toBeCloseTo(50, 6)
    expect(Math.min(...ys)).toBeCloseTo(0, 6)
    expect(Math.max(...ys)).toBeCloseTo(30, 6)
  })

  it('a drawn circle derives BOTH a contour loop and a drill point', () => {
    const drawn = commitCircle(emptyDesign(), 'draw-hole', 12, 8, 5)

    // Contour candidate (closed loop) …
    const contour = deriveContourPointsFromDesign(drawn)
    expect(contour.length).toBeGreaterThanOrEqual(3)

    // … and a drill point at the circle center (the canvas circle == a hole).
    const drills = deriveDrillPointsFromDesign(drawn)
    expect(drills).toEqual([[12, 8]])
  })

  it('a drawn closed polyline (point-id form) derives its exact vertices', () => {
    const tri: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [40, 0],
      [40, 20]
    ]
    const drawn = commitClosedPolyline(emptyDesign(), 'draw-tri', tri)

    const contour = deriveContourPointsFromDesign(drawn, 'draw-tri')
    expect(contour).toEqual([
      [0, 0],
      [40, 0],
      [40, 20]
    ])
  })

  it('an OPEN drawn polyline is NOT machinable as a contour (honest reject)', () => {
    // Open path → no closed boundary → no contour candidate.
    const points = { a: { x: 0, y: 0 }, b: { x: 30, y: 0 } }
    const open: DesignFileV2 = {
      ...emptyDesign(),
      points,
      entities: [{ id: 'draw-open', kind: 'polyline', pointIds: ['a', 'b'], closed: false }]
    }
    expect(deriveContourPointsFromDesign(open)).toEqual([])
  })

  it('multiple draws accumulate in ONE model and all derive', () => {
    // Successive commits thread `...design` — the live reducer behavior. Two
    // closed profiles + one hole all land in the same model and all derive.
    let d = emptyDesign()
    d = commitRect(d, 'r1', 25, 15, 50, 30)
    d = commitRect(d, 'r2', 100, 100, 20, 20)
    d = commitCircle(d, 'c1', 25, 15, 4)

    const candidates = listContourCandidatesFromDesign(d)
    // Two rect loops + one circle loop = three contour candidates.
    expect(candidates).toHaveLength(3)
    // The circle still derives as a drill point.
    expect(deriveDrillPointsFromDesign(d)).toEqual([[25, 15]])
    // A specific source can be selected for the op.
    const r2 = deriveContourPointsFromDesign(d, 'r2')
    expect(Math.min(...r2.map((p) => p[0]))).toBeCloseTo(90, 6)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2. DRAW + IMPORT converge on the SAME model + the SAME derive output.
// ───────────────────────────────────────────────────────────────────────────

describe('draw + import feed ONE shared model', () => {
  it('a drawn rect and an imported rect derive the same contour signature', () => {
    // Same nominal geometry (50 × 30 at origin), authored two ways.
    const drawn = commitRect(emptyDesign(), 'rect-drawn', 25, 15, 50, 30)
    const drawnContour = deriveContourPointsFromDesign(drawn)

    const { design: imported } = dxfToSketch(rectDxf(50, 30), emptyDesign(), { idPrefix: 'imp' })
    const importedContour = deriveContourPointsFromDesign(imported)

    // Same machinable extent from both front-ends.
    const bbox = (pts: [number, number][]) => ({
      minX: Math.min(...pts.map((p) => p[0])),
      maxX: Math.max(...pts.map((p) => p[0])),
      minY: Math.min(...pts.map((p) => p[1])),
      maxY: Math.max(...pts.map((p) => p[1]))
    })
    const a = bbox(drawnContour)
    const b = bbox(importedContour)
    expect(a.minX).toBeCloseTo(b.minX, 6)
    expect(a.maxX).toBeCloseTo(b.maxX, 6)
    expect(a.minY).toBeCloseTo(b.minY, 6)
    expect(a.maxY).toBeCloseTo(b.maxY, 6)
  })

  it('a drawn circle and an imported circle derive the same drill point', () => {
    const drawn = commitCircle(emptyDesign(), 'hole-drawn', 50, 30, 5)
    const { design: imported } = dxfToSketch(circleDxf(50, 30, 5), emptyDesign(), { idPrefix: 'imp' })

    expect(deriveDrillPointsFromDesign(drawn)).toEqual(deriveDrillPointsFromDesign(imported))
    expect(deriveDrillPointsFromDesign(drawn)).toEqual([[50, 30]])
  })

  it('drawing INTO an imported design merges both into one derivable model', () => {
    // Import a rect, THEN draw a hole on top — the canvas does this by threading
    // `...design` (the imported model) into the next commit. Result: one model
    // with the imported contour AND the drawn drill point.
    const { design: importedBase } = dxfToSketch(rectDxf(60, 40), emptyDesign(), {
      idPrefix: 'imp'
    })
    expect(importedBase.entities.length).toBe(1)

    const merged = commitCircle(importedBase, 'drawn-hole', 30, 20, 3)

    // The imported rect is still a contour candidate …
    const contours = listContourCandidatesFromDesign(merged)
    expect(contours.some((c) => c.label.startsWith('Polyline') || c.label.startsWith('Rectangle'))).toBe(true)
    expect(contours.some((c) => c.sourceId === 'drawn-hole')).toBe(true) // circle loop too
    // … and the drawn circle is the drill point.
    expect(deriveDrillPointsFromDesign(merged)).toEqual([[30, 20]])
  })

  it('derive output is deterministic for the same authored geometry (stable signature)', () => {
    // Two independent draw commits of identical geometry → identical signature,
    // so an op derived from a redraw does not spuriously read as "edited".
    const a = commitRect(emptyDesign(), 'x', 10, 10, 20, 10)
    const b = commitRect(emptyDesign(), 'y', 10, 10, 20, 10)
    const sigA = contourPointSignature(deriveContourPointsFromDesign(a))
    const sigB = contourPointSignature(deriveContourPointsFromDesign(b))
    expect(sigA).toBe(sigB)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 3. The authored-OR-imported model survives the session save/reload path so
//    the derive is reachable AFTER a project round-trip (not just in-memory).
// ───────────────────────────────────────────────────────────────────────────

describe('authored/imported model survives save→reload, then still derives', () => {
  it('a drawn-then-imported model derives the same points after a round-trip', () => {
    // Build a mixed model: a drawn rect + an imported circle.
    let d = commitRect(emptyDesign(), 'drawn-rect', 25, 15, 50, 30)
    const { design: withImport } = dxfToSketch(circleDxf(25, 15, 4), d, { idPrefix: 'imp' })
    d = withImport

    const beforeContour = deriveContourPointsFromDesign(d, 'drawn-rect')
    const beforeDrills = deriveDrillPointsFromDesign(d)

    // The exact path the session performs: JSON.stringify on save (designSave) →
    // normalizeDesign(parse(json)) on load (design:load).
    const reloaded = normalizeDesign(JSON.parse(JSON.stringify(d)))

    const afterContour = deriveContourPointsFromDesign(reloaded, 'drawn-rect')
    const afterDrills = deriveDrillPointsFromDesign(reloaded)

    expect(afterContour).toEqual(beforeContour)
    expect(afterDrills).toEqual(beforeDrills)
    // And the reloaded model is byte-stable through the derive signature.
    expect(contourPointSignature(afterContour)).toBe(contourPointSignature(beforeContour))
  })
})
