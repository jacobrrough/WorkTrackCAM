/**
 * Nested-ring grouping for 2.5D CAM derivation (Wave 3i).
 *
 * `listContourCandidatesFromDesign` (cam-2d-derive.ts) returns every closed
 * loop in a sketch as a FLAT list. For pocket and V-carve ops that is not
 * enough: a sign letter 'O', a washer, or a panel with cut-outs is an OUTER
 * loop plus interior HOLE loops, and the toolpath must machine AROUND the
 * holes (pocket raster rows split into segments either side; the V-carve
 * ridge runs between the outer wall and the hole wall instead of ploughing
 * across the hole).
 *
 * This module groups the flat candidate list into `{ outer, holes[] }` sets by
 * EVEN-ODD containment — the same fill rule the downstream engines use
 * (`generateVCarve2dLines` rings, `generatePocket2dLines` islandRings, and
 * Clipper `pftEvenOdd` in `solveVCarveFlatRegion`):
 *
 *   - a loop contained by an EVEN number of other loops is an OUTER boundary
 *     (depth 0 = a top-level shape; depth 2 = an island standing inside a
 *     hole, which starts its own region group);
 *   - a loop contained by an ODD number of other loops is a HOLE of its
 *     innermost container (the containing loop one nesting level up).
 *
 * Containment is decided by ray-casting ONE representative vertex of the inner
 * loop against the candidate container — exact whenever the loops are disjoint
 * (the sketch-derive contract: closed profiles do not cross each other).
 * Crossing/duplicated loops are operator error and degrade to a stable
 * best-effort grouping rather than throwing.
 *
 * Lives in its OWN module (not cam-2d-derive.ts) because the derive module's
 * export surface is pinned to exactly 4 runtime symbols by
 * `cam-2d-derive-pin.test.ts` — this is the additive sibling.
 */
import type { DesignFileV2 } from './design-schema'
import { listContourCandidatesFromDesign, type DerivedContourCandidate } from './cam-2d-derive'

/** One carve/pocket region: an outer boundary plus the holes directly inside it. */
export type ContourRingGroup = {
  /** Even-depth loop: the outer boundary of one carve/pocket region. */
  outer: DerivedContourCandidate
  /**
   * Odd-depth loops whose innermost container is `outer` (interior holes /
   * islands). Order follows the candidate list (sketch entity order).
   */
  holes: DerivedContourCandidate[]
}

/** Ray-cast even-odd point-in-polygon (vertices implicitly closed; on-edge unspecified). */
function pointInLoop(loop: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
  let inside = false
  const n = loop.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = loop[i]!
    const [xj, yj] = loop[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Absolute shoelace area (mm²) — tie-break for the "innermost container" pick. */
function loopAreaAbs(points: ReadonlyArray<readonly [number, number]>): number {
  let s = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]!
    const b = points[(i + 1) % n]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(s) / 2
}

/**
 * Group closed-loop candidates into `{ outer, holes[] }` regions by even-odd
 * containment. A loop inside an ODD number of other loops is a hole of its
 * innermost container; every EVEN-depth loop starts its own group (so an
 * island standing inside a hole is its own carveable region, matching the
 * engines' even-odd fill rule). Group order preserves candidate order of the
 * outer loops; degenerate candidates (<3 points) never contain anything.
 */
export function groupContourCandidatesByContainment(
  candidates: ReadonlyArray<DerivedContourCandidate>
): ContourRingGroup[] {
  const n = candidates.length
  // containers[i] = indices of candidates whose loop contains candidate i's
  // first vertex (ray-cast even-odd). With disjoint loops this is exactly
  // "loop j encloses loop i".
  const containers: number[][] = []
  for (let i = 0; i < n; i++) {
    const rep = candidates[i]!.points[0]
    const mine: number[] = []
    if (rep) {
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const other = candidates[j]!.points
        if (other.length >= 3 && pointInLoop(other, rep[0], rep[1])) mine.push(j)
      }
    }
    containers.push(mine)
  }
  const depth = containers.map((c) => c.length)

  const groupByOuterIndex = new Map<number, ContourRingGroup>()
  for (let i = 0; i < n; i++) {
    if (depth[i]! % 2 === 0) groupByOuterIndex.set(i, { outer: candidates[i]!, holes: [] })
  }
  for (let i = 0; i < n; i++) {
    if (depth[i]! % 2 !== 1) continue
    // Innermost container = the containing loop with the greatest depth
    // (ties broken by smallest area, i.e. the tightest enclosure).
    let best = -1
    for (const j of containers[i]!) {
      if (best === -1) {
        best = j
        continue
      }
      const dj = depth[j]!
      const db = depth[best]!
      if (dj > db || (dj === db && loopAreaAbs(candidates[j]!.points) < loopAreaAbs(candidates[best]!.points))) {
        best = j
      }
    }
    // With proper nesting the innermost container of an odd-depth loop has
    // even depth and therefore owns a group; crossing-loop garbage that lands
    // on an odd-depth "container" is dropped (best-effort, never throws).
    const g = best !== -1 ? groupByOuterIndex.get(best) : undefined
    if (g) g.holes.push(candidates[i]!)
  }
  return [...groupByOuterIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g)
}

/**
 * Derive the full nested-ring set for a pocket / V-carve op: the picked outer
 * loop plus every hole whose innermost container it is. Selection rules mirror
 * `deriveContourPointsFromDesign` exactly (matching `sourceId` wins, else the
 * first candidate), so `group.outer.points` equals what that helper returns
 * for the same arguments. When the picked loop is itself a hole of some other
 * loop, it is returned with NO holes (today's single-ring behaviour — the
 * operator explicitly chose to machine inside it). Returns null when the
 * design has no closed profiles.
 */
export function deriveContourRingGroupFromDesign(design: DesignFileV2, sourceId?: string): ContourRingGroup | null {
  const candidates = listContourCandidatesFromDesign(design)
  if (candidates.length === 0) return null
  const picked = (sourceId ? candidates.find((c) => c.sourceId === sourceId) : undefined) ?? candidates[0]!
  const groups = groupContourCandidatesByContainment(candidates)
  return groups.find((g) => g.outer.sourceId === picked.sourceId) ?? { outer: picked, holes: [] }
}
