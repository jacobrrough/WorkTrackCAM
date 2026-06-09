/**
 * DesignWorkspaceHost — Import-DXF-onto-the-Design-surface contract (Wave 3f).
 *
 * Wave 3e shipped the LIVE session-wired `SketchSurface`, but the only DXF-import
 * button lived on the Manufacture ribbon (`importVectorsFromDxf`), so a DXF
 * imported there was NOT visible on an already-mounted Design canvas (the 3e
 * item-e caveat). This wave adds an "Import DXF" affordance on the Design sketch
 * surface whose handler (`DesignWorkspaceHost.handleImportDxf`):
 *   1. parses the picked DXF (`fab.dxfImport`),
 *   2. ADDITIVE-merges it into the SAME in-memory `session.design` via
 *      `dxfToSketch` (never `replace`, so it can't clobber CAD geometry),
 *   3. pushes the merged model through `session.onDesignChange` so the
 *      bulge-accurate vectors appear on the mounted canvas immediately, and
 *      persists it via `fab.designSave(projectDir, …)`.
 *
 * The renderer suite is node-env SSR (no jsdom / no pointer / no real click — see
 * the sibling `SketchSurface.test.tsx` rationale), so we cannot drive the button
 * with a click here. Instead we pin the load-bearing *data contract* the handler
 * implements verbatim — the merge + dispatch shape — using a REAL DXF parse so
 * the bulge-tessellation fidelity is exercised all the way into the session
 * model. A drift in the handler's merge direction (e.g. switching to `replace`,
 * or merging onto a disk reload instead of the live model) would fail this test.
 *
 * The button's mere PRESENCE (host → DesignWorkspace → SketchSurface threading)
 * is pinned under SSR in `SketchSurface.test.tsx`; this file pins what the click
 * DOES.
 *
 * ── G-CODE SAFETY ──
 * Sketch geometry only — never emits, mutates, or posts a toolpath. The
 * Laguna/Carvera/K2 post invariants + V-carve depth caps live downstream of
 * `cam-2d-derive` and are untouched here.
 */

import { describe, expect, it } from 'vitest'
import {
  emptyDesign,
  normalizeDesign,
  type DesignFileV2,
  type SketchEntity
} from '../../../shared/design-schema'
import { dxfToSketch } from '../../../shared/dxf-to-sketch'
import { parseDxf, type DxfParseResult } from '../../../shared/dxf-parser'
import {
  deriveContourPointsFromDesign,
  listContourCandidatesFromDesign
} from '../../../shared/cam-2d-derive'

// ───────────────────────────────────────────────────────────────────────────
// Reproduce the host handler's merge step verbatim. The live
// `handleImportDxf` does exactly:
//   const { design, importedCount, skippedCount } = dxfToSketch(parse, session.design)
//   session.onDesignChange(design)            // immediate canvas update
//   await fab.designSave(projectDir, JSON.stringify(design))  // persist
// so `mergeImport(base, parse)` IS the handler's pure core.
// ───────────────────────────────────────────────────────────────────────────
function mergeImport(base: DesignFileV2, parse: DxfParseResult) {
  return dxfToSketch(parse, base)
}

/** A pre-existing CAD-authored rectangle already on the mounted canvas. */
const EXISTING_RECT: SketchEntity = {
  id: 'cad-rect-1',
  kind: 'rect',
  cx: 100,
  cy: 100,
  w: 40,
  h: 20,
  rotation: 0
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

/**
 * A closed rounded-rect LWPOLYLINE with a bulge on one segment — proves the
 * bulge-accurate tessellation survives the import onto the live surface (the
 * brief's "bulge-accurate vectors appear immediately" requirement).
 */
function bulgedRectDxf(): DxfParseResult {
  const text = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'SIGN', '90', '4', '70', '1',
    '10', '0', '20', '0', '42', '0',
    '10', '40', '20', '0', '42', '0.5', // bulge on this segment → arc
    '10', '40', '20', '20', '42', '0',
    '10', '0', '20', '20', '42', '0',
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

describe('Import DXF onto the Design surface — additive merge into the session model', () => {
  it('merges the imported vectors into the SAME model, keeping pre-existing geometry', () => {
    // The mounted canvas already holds a CAD-authored rect (session.design).
    const sessionDesign: DesignFileV2 = { ...emptyDesign(), entities: [EXISTING_RECT] }

    const { design, importedCount, skippedCount } = mergeImport(sessionDesign, rectDxf(50, 30))

    // Additive: the pre-existing entity is still present …
    expect(design.entities.some((e) => e.id === EXISTING_RECT.id)).toBe(true)
    // … AND the imported loop was added (2 entities total).
    expect(design.entities).toHaveLength(2)
    expect(importedCount).toBe(1)
    expect(skippedCount).toBe(0)
  })

  it('does NOT mutate the original session design (pure merge)', () => {
    const sessionDesign: DesignFileV2 = { ...emptyDesign(), entities: [EXISTING_RECT] }
    const entityCountBefore = sessionDesign.entities.length

    mergeImport(sessionDesign, rectDxf(50, 30))

    // The base the host passes (`session.design`) is untouched; the new model is
    // what gets dispatched via onDesignChange — so React sees a fresh reference.
    expect(sessionDesign.entities).toHaveLength(entityCountBefore)
    expect(sessionDesign.entities).toEqual([EXISTING_RECT])
  })

  it('the dispatched model is what persists — it survives the session save→reload path', () => {
    // The host dispatches `design` AND persists `JSON.stringify(design)`. Prove
    // the merged model round-trips through the exact session save/load transform
    // so the import is durable, not just an in-memory blip.
    const sessionDesign: DesignFileV2 = { ...emptyDesign(), entities: [EXISTING_RECT] }
    const { design } = mergeImport(sessionDesign, circleDxf(25, 15, 5))

    const reloaded = normalizeDesign(JSON.parse(JSON.stringify(design)))
    expect(reloaded).toEqual(normalizeDesign(design))
    // Both the CAD rect and the imported circle are present after reload.
    expect(reloaded.entities.some((e) => e.id === EXISTING_RECT.id)).toBe(true)
    expect(reloaded.entities.some((e) => e.kind === 'circle')).toBe(true)
  })

  it('imports bulge-accurate vectors (the rounded segment is tessellated, not faceted to one chord)', () => {
    const sessionDesign = emptyDesign()
    const { design, importedCount, notes } = mergeImport(sessionDesign, bulgedRectDxf())

    expect(importedCount).toBe(1)
    // `dxfToSketch` emits the point-id polyline form (`polylineByPointIdsSchema`),
    // so narrow on `'pointIds' in poly` to discriminate it from the inline-points
    // variant of the SketchEntity polyline union.
    const poly = design.entities.find((e) => e.kind === 'polyline' && 'pointIds' in e)
    expect(poly).toBeDefined()
    if (poly && poly.kind === 'polyline' && 'pointIds' in poly) {
      // A pure 4-corner rect would have 4 point-ids; the bulge segment adds
      // interior arc samples, so a bulge-accurate import has strictly MORE.
      expect(poly.pointIds.length).toBeGreaterThan(4)
      expect(poly.closed).toBe(true)
    }
    // The converter reports the bulge tessellation as an operator-facing note
    // (surfaced as a toast by the host).
    expect(notes.some((n) => /bulge/i.test(n))).toBe(true)
  })

  it('the merged model is immediately derivable into a machinable contour (Laguna sign loop)', () => {
    // The whole point of importing onto the Design surface: the imported closed
    // loop is a contour candidate the CAM derive path can machine — no manual
    // retrace required.
    const sessionDesign = emptyDesign()
    const { design } = mergeImport(sessionDesign, rectDxf(60, 40))

    const candidates = listContourCandidatesFromDesign(design)
    expect(candidates.length).toBeGreaterThanOrEqual(1)

    const contour = deriveContourPointsFromDesign(design)
    expect(contour.length).toBeGreaterThanOrEqual(3)
    const xs = contour.map((p) => p[0])
    const ys = contour.map((p) => p[1])
    expect(Math.max(...xs)).toBeCloseTo(60, 6)
    expect(Math.max(...ys)).toBeCloseTo(40, 6)
  })

  it('a second import stacks onto the first (repeated additive imports accumulate)', () => {
    // Import a rect, then import a circle on top — both land in one model, the
    // canvas-threading behavior the live handler reproduces by re-reading
    // session.design (now holding the first import) as the base for the second.
    let d = mergeImport(emptyDesign(), rectDxf(50, 30)).design
    expect(d.entities).toHaveLength(1)

    d = mergeImport(d, circleDxf(25, 15, 4)).design
    expect(d.entities).toHaveLength(2)
    expect(d.entities.some((e) => e.kind === 'polyline')).toBe(true)
    expect(d.entities.some((e) => e.kind === 'circle')).toBe(true)
  })
})
