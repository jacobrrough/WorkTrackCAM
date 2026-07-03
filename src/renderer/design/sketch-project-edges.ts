/**
 * sketch-project-edges — PROJECT MODEL EDGES INTO SKETCH (Fusion's Project / P).
 *
 * The last Phase-3 parity item (docs/PARITY-ROADMAP.md): bring the existing 3D
 * model's edges into the ACTIVE sketch as snappable, dimensionable REFERENCE
 * geometry, so a new sketch can constrain / dimension against the solid built so
 * far (~25% faster complex sketches).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * WHAT THIS DOES
 * ──────────────────────────────────────────────────────────────────────────
 * Given
 *   - the model's per-edge 3D polylines (the wave-3 tessellation
 *     {@link CadEdgePolyline} — stable `e:<hash>` ids + ordered `[x,y,z]`
 *     samples), and
 *   - the sketch's active plane ({@link SketchPlane} — a datum or a picked face),
 * each edge is ORTHOGONALLY projected onto the plane (along the plane normal) and
 * mapped into 2D sketch mm using EXACTLY the same world→sketch math the
 * face-sketch placement uses ({@link worldPointToSketchMm}, the inverse of
 * {@link sketchPreviewPlacementMatrix}). Dropping the local-z of the inverse-
 * transformed point IS the orthogonal projection along the normal — no separate
 * projection math to drift out of sync with the placement matrix.
 *
 * The result is emitted as CONSTRUCTION sketch entities (the wave-1 `construction`
 * flag): a 2-point `polyline` line for a straight edge, an N-point `polyline` for
 * a curved edge. Construction geometry renders dashed, participates in
 * constraints / dimensions / snapping, and is EXCLUDED from profile derivation
 * (`extractKernelProfiles` / `cam-2d-derive`) — so a projected edge never becomes
 * part of the built solid or a CAM contour. All emitted polylines are `closed:
 * false`, so even the profile path that ignores construction never sees a loop.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * OPTIONS + FILTERS (documented contract)
 * ──────────────────────────────────────────────────────────────────────────
 *   - PERPENDICULAR / DEGENERATE SKIP: an edge (nearly) perpendicular to the
 *     plane projects to a (nearly) zero-length segment. Any projected polyline
 *     whose total 2D length is below `toleranceMm` is skipped (counted as
 *     `skipped`), never emitted as a degenerate entity.
 *   - CONSECUTIVE DEDUPE: projected points closer than `toleranceMm` to the
 *     previous kept point are collapsed (a curve tessellated fine in 3D can
 *     project to near-coincident 2D samples).
 *   - SEGMENT DEDUPE: two source edges that project to the SAME 2D segment
 *     (endpoints coincident within `toleranceMm`, either orientation) emit ONCE.
 *     The FIRST edge (source order) wins the id; later duplicates are counted as
 *     `deduped`.
 *   - STRAIGHTNESS COLLAPSE: a projected polyline whose interior points all lie
 *     within `toleranceMm` of the chord between its endpoints collapses to a
 *     2-point line (a straight 3D edge, or a curved edge seen edge-on).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * IDEMPOTENT RE-PROJECTION (the design decision)
 * ──────────────────────────────────────────────────────────────────────────
 * Every emitted entity gets a DETERMINISTIC id derived from its source edge id:
 * `proj_<edgeId>` (and its points `proj_<edgeId>_pN`). Re-projecting REPLACES any
 * prior entities/points minted from the same source edge rather than duplicating
 * them — so pressing Project twice is idempotent, and re-projecting after the
 * model changed refreshes the reference geometry in place. {@link projectEdgesOntoSketch}
 * strips every entity/point whose id starts with `proj_<edgeId>_`/`proj_<edgeId>`
 * for the edges being projected before merging the fresh ones in.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * HONEST LIMITATION — NO LIVE ASSOCIATIVITY
 * ──────────────────────────────────────────────────────────────────────────
 * These are STATIC copies. Fusion updates projected geometry when the source
 * model changes; WorkTrack3D does NOT (yet) — a projected edge is a frozen
 * snapshot of the model at projection time. Re-running Project refreshes it (the
 * idempotent replace above is exactly that manual refresh). The deterministic
 * `proj_<edgeId>` id IS the forward hook a future live-re-projection pass would
 * key on, but no such live link exists today.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * PURE — no React, no DOM, no IPC. (Imports three via the shared placement
 * helper for the plane math only.) Never mutates the input design.
 */

import type { Vector3 } from 'three'
import { Vector3 as ThreeVector3 } from 'three'
import type { DesignFileV2, SketchEntity, SketchPlane, SketchPoint } from '../../shared/design-schema'
import { worldPointToSketchMm } from './sketch-preview-placement'

/**
 * A model edge to project: the stable id + its ordered 3D samples. Structurally
 * a subset of the wave-3 {@link import('../../shared/sidecar-protocol').CadEdgePolyline},
 * so `firstMesh.edges` drops straight in (the surface passes them through as
 * `projectableEdges`). Kept as a local interface so this pure module has no
 * dependency on the sidecar wire types.
 */
export interface ProjectableEdge {
  /** Stable source edge id (`e:<hex>`), the basis of the deterministic output ids. */
  readonly id: string
  /** Ordered `[x, y, z]` world-mm samples along the edge; length >= 2. */
  readonly points: ReadonlyArray<readonly [number, number, number]>
}

/** Options controlling the projection filters. All lengths in sketch mm. */
export interface ProjectEdgesOptions {
  /**
   * Tolerance (mm) for every length-based decision: the degenerate/perpendicular
   * skip threshold, the consecutive-dedupe distance, the segment-dedupe endpoint
   * match, and the straightness-collapse chord deviation. Default 0.05 mm.
   */
  readonly toleranceMm?: number
}

/** The default projection tolerance (mm) — sub-tessellation-noise, above float drift. */
export const PROJECT_EDGES_DEFAULT_TOLERANCE_MM = 0.05

/** Id prefix every projected entity/point carries (the idempotency key root). */
export const PROJECTED_ID_PREFIX = 'proj_'

/** A 2D sketch-plane point (mm). */
type Pt2 = readonly [number, number]

/** The outcome of a projection: the new design + honest counts for the toast. */
export interface ProjectEdgesResult {
  /** The design with projected construction entities merged in (idempotent replace). */
  readonly design: DesignFileV2
  /** Number of edges that emitted a construction entity. */
  readonly projected: number
  /** Number of edges skipped as degenerate (project ~perpendicular / zero-length). */
  readonly skipped: number
  /** Number of edges dropped because they projected onto an already-emitted segment. */
  readonly deduped: number
}

/** Squared 2D distance. */
function distSq2(a: Pt2, b: Pt2): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

/** Total polyline length (mm) over an ordered 2D point list. */
function polylineLength(pts: ReadonlyArray<Pt2>): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.sqrt(distSq2(pts[i - 1]!, pts[i]!))
  return total
}

/** Collapse consecutive points closer than `tol` to the previous KEPT point. */
function dedupeConsecutive(pts: ReadonlyArray<Pt2>, tol: number): Pt2[] {
  const tolSq = tol * tol
  const out: Pt2[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && distSq2(last, p) <= tolSq) continue
    out.push(p)
  }
  return out
}

/**
 * Perpendicular distance (mm) from point `p` to the infinite line through a→b.
 * Returns the raw distance to `a` when a→b is degenerate (handled by the caller).
 */
function distToChord(p: Pt2, a: Pt2, b: Pt2): number {
  const vx = b[0] - a[0]
  const vy = b[1] - a[1]
  const len = Math.hypot(vx, vy)
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  // |cross((p-a),(b-a))| / |b-a|
  const cross = (p[0] - a[0]) * vy - (p[1] - a[1]) * vx
  return Math.abs(cross) / len
}

/**
 * True when every interior point of `pts` lies within `tol` of the chord between
 * the first and last point — i.e. the projected polyline is effectively straight
 * and can collapse to a 2-point line. Requires >= 2 points.
 */
function isEffectivelyStraight(pts: ReadonlyArray<Pt2>, tol: number): boolean {
  if (pts.length <= 2) return true
  const a = pts[0]!
  const b = pts[pts.length - 1]!
  for (let i = 1; i < pts.length - 1; i++) {
    if (distToChord(pts[i]!, a, b) > tol) return false
  }
  return true
}

/** Project one edge's 3D samples to deduped 2D sketch-plane mm points. */
function projectEdgePoints(edge: ProjectableEdge, plane: SketchPlane, tol: number): Pt2[] {
  const world: Vector3 = new ThreeVector3()
  const raw: Pt2[] = []
  for (const [x, y, z] of edge.points) {
    world.set(x, y, z)
    const { x: sx, y: sy } = worldPointToSketchMm(plane, world)
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue
    raw.push([sx, sy])
  }
  return dedupeConsecutive(raw, tol)
}

/** Canonical endpoint key for segment dedupe (orientation-independent, `tol`-quantized). */
function segmentKey(a: Pt2, b: Pt2, tol: number): string {
  const q = (v: number): number => Math.round(v / tol)
  const ka = `${q(a[0])},${q(a[1])}`
  const kb = `${q(b[0])},${q(b[1])}`
  // Order-independent so a→b and b→a collide.
  return ka <= kb ? `${ka}|${kb}` : `${kb}|${ka}`
}

/** All ids (entities + points) previously minted from this source edge. */
function isProjectionOf(id: string, edgeId: string): boolean {
  const base = `${PROJECTED_ID_PREFIX}${edgeId}`
  return id === base || id.startsWith(`${base}_`)
}

/**
 * The set of source-edge ids whose prior projections should be stripped before
 * merging fresh ones (idempotent re-projection). Exposed for the surface's
 * "replace prior projections" bookkeeping + tests.
 */
export function projectedEdgeIdSet(edges: ReadonlyArray<ProjectableEdge>): Set<string> {
  return new Set(edges.map((e) => e.id))
}

/**
 * PROJECT model edges into the sketch — the pure entry point.
 *
 * @param design  The live sketch design (never mutated).
 * @param edges   Model edge polylines to project (`firstMesh.edges`).
 * @param plane   The active sketch plane (defaults to `design.sketchPlane`).
 * @param options Filter tolerances (see {@link ProjectEdgesOptions}).
 * @returns The merged design + projected/skipped/deduped counts.
 *
 * IDEMPOTENT: any entity/point previously minted from one of `edges` (id under
 * `proj_<edgeId>`) is removed first, so re-projecting replaces rather than
 * duplicates. Non-projection entities/points are untouched.
 */
export function projectEdgesOntoSketch(
  design: DesignFileV2,
  edges: ReadonlyArray<ProjectableEdge>,
  plane: SketchPlane = design.sketchPlane,
  options: ProjectEdgesOptions = {}
): ProjectEdgesResult {
  const tol = options.toleranceMm ?? PROJECT_EDGES_DEFAULT_TOLERANCE_MM
  const safeTol = Number.isFinite(tol) && tol > 0 ? tol : PROJECT_EDGES_DEFAULT_TOLERANCE_MM

  // Strip prior projections from exactly the edges being (re)projected, so a
  // re-projection replaces in place. Other projected edges + all authored
  // geometry survive.
  const reprojecting = projectedEdgeIdSet(edges)
  const isStalePrior = (id: string): boolean =>
    [...reprojecting].some((edgeId) => isProjectionOf(id, edgeId))

  const keptEntities = design.entities.filter((e) => !isStalePrior(e.id))
  const keptPoints: Record<string, SketchPoint> = {}
  for (const [pid, pt] of Object.entries(design.points)) {
    if (!isStalePrior(pid)) keptPoints[pid] = pt
  }

  const newEntities: SketchEntity[] = []
  const newPoints: Record<string, SketchPoint> = {}
  const seenSegments = new Set<string>()

  let projected = 0
  let skipped = 0
  let deduped = 0

  for (const edge of edges) {
    if (!edge.points || edge.points.length < 2) {
      skipped++
      continue
    }
    const pts = projectEdgePoints(edge, plane, safeTol)
    // Degenerate / perpendicular: fewer than 2 distinct points, or total length
    // below tolerance (an edge seen end-on collapses to a dot).
    if (pts.length < 2 || polylineLength(pts) < safeTol) {
      skipped++
      continue
    }

    // Straightness collapse: a straight edge (or a curve seen edge-on) → 2-pt line.
    const emitPts: Pt2[] = isEffectivelyStraight(pts, safeTol)
      ? [pts[0]!, pts[pts.length - 1]!]
      : pts

    // Segment dedupe only applies to the 2-point straight case (a curved
    // polyline is identified by its full run, which we approximate by its
    // endpoints for the straight case only — curves rarely coincide and keeping
    // them is safe reference geometry).
    if (emitPts.length === 2) {
      const key = segmentKey(emitPts[0]!, emitPts[1]!, safeTol)
      if (seenSegments.has(key)) {
        deduped++
        continue
      }
      seenSegments.add(key)
    }

    const base = `${PROJECTED_ID_PREFIX}${edge.id}`
    const pointIds: string[] = []
    emitPts.forEach((p, i) => {
      const pid = `${base}_p${i}`
      newPoints[pid] = { x: p[0], y: p[1] }
      pointIds.push(pid)
    })
    newEntities.push({
      id: base,
      kind: 'polyline',
      pointIds,
      closed: false,
      construction: true
    })
    projected++
  }

  const merged: DesignFileV2 = {
    ...design,
    entities: [...keptEntities, ...newEntities],
    points: { ...keptPoints, ...newPoints }
  }
  return { design: merged, projected, skipped, deduped }
}
