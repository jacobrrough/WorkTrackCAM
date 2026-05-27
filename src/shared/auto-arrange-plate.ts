/**
 * Auto-arrange on plate (FDM, Creality K2 Plus): take N loaded meshes' AABBs
 * and pack them efficiently onto a rectangular print bed using a
 * shelf-pack-with-rotation algorithm.
 *
 * Pure math — no FS, no IPC, no React. Browser- and Node-safe.
 *
 * Algorithm (shelf-pack / next-fit-decreasing-height with 90° rotation):
 *  1. Sort meshes by largest AABB *area* descending so big parts seed the
 *     plate first (classic shelf-pack heuristic — strict "tallest first"
 *     leaves more compaction wins on the table when one big part has a
 *     short footprint).
 *  2. For each mesh, in each candidate rotation (0° and 90°):
 *       - Compute footprint = (width, depth) + 2× clearance.
 *       - Find the lowest shelf (= row, packed in +Y) where the footprint
 *         fits in the remaining shelf width.
 *       - If no existing shelf accepts it, start a new shelf at the
 *         current Y cursor.
 *       - If the resulting placement clips the plate (X or Y), reject
 *         that rotation. Try the other rotation. If neither fits, the
 *         mesh is unplaced.
 *  3. Of the legal rotations, pick the one that leaves the *most*
 *     room on the current shelf (greedy — keeps later parts options open).
 *  4. The placement's `xMm / yMm` is the AABB-min corner of the part
 *     (not the centre) so the caller can convert directly to a transform
 *     position offset relative to the plate origin.
 *
 * Bounded runtime: O(N * S * R) where N = mesh count, S = number of shelves
 * opened (≤ N), R = rotations tried (2). For typical plates with ≤ 30
 * meshes this is well under a millisecond.
 *
 * Determinism: stable for the same inputs. Ties broken by input order
 * after the size sort (Array.prototype.sort is stable in modern JS).
 *
 * Safety: PRODUCES PLACEMENTS ONLY. No G-code is emitted by this module.
 * The caller writes the resulting (xMm, yMm) to each mesh's
 * `transform.position` so the renderer can re-draw — same shape as
 * Agent N's auto-orient pattern. Safety Rule 1: G-code is sacred.
 */

// ── Public types ────────────────────────────────────────────────────────────

/** A single mesh to arrange. The caller must precompute the AABB. */
export interface AutoArrangeMesh {
  /** Stable identifier — typically the job id. */
  id: string
  /**
   * Mesh axis-aligned bounding box dimensions in millimetres. The plate
   * sits in the XY plane; `width` is along X, `depth` is along Y, and
   * `height` (along Z) is ignored for shelf packing — bed contact is
   * what matters for FDM plate arrangement.
   */
  aabbMm: { width: number; depth: number; height: number }
}

/** Plate specification (K2 Plus default: 350 × 350 mm). */
export interface AutoArrangePlate {
  /** Plate X extent (mm). */
  x: number
  /** Plate Y extent (mm). */
  y: number
  /**
   * Inter-part + plate-edge clearance (mm). Applied to each part's
   * footprint as +clearance on all four sides. Typical FDM value is
   * 3 mm (matches OrcaSlicer's default skirt + brim clearance).
   */
  clearance: number
}

/** Final placement for a single mesh. */
export interface AutoArrangePlacement {
  /** Mesh id from the input. */
  id: string
  /** Origin-X (mm) of the AABB-min corner on the plate. */
  xMm: number
  /** Origin-Y (mm) of the AABB-min corner on the plate. */
  yMm: number
  /** Rotation applied to the mesh around the +Z axis. Only 0° or 90°. */
  rotationDeg: 0 | 90
}

/** Result of an arrangement run. */
export interface ArrangedPlate {
  /** Placements in the order matching the input scan order. */
  placements: AutoArrangePlacement[]
  /**
   * Mesh ids that did not fit on the plate under any rotation. Returned
   * in input order; the UI can surface these so the operator knows to
   * split the job across two plates.
   */
  unplaced: string[]
  /**
   * Material utilization (0..100): placed-mesh-footprint-area / plate-area × 100.
   * Footprint area = AABB-width × AABB-depth (NO clearance), so this is the
   * useful pack density excluding margins.
   */
  utilizationPct: number
}

// ── Internal shapes ─────────────────────────────────────────────────────────

interface Shelf {
  /** Y origin of the shelf (bottom edge in +Y, lowest first). */
  yMin: number
  /** Tallest part placed on this shelf so far (controls shelf height). */
  shelfHeight: number
  /** Next free X cursor on this shelf. Starts at plate origin (0). */
  xCursor: number
}

interface SortedMesh {
  id: string
  width: number
  depth: number
  /** Footprint area = width × depth, used as the BLF sort key. */
  area: number
  /** Input index, preserved as a tiebreaker for deterministic order. */
  inputIndex: number
}

// ── Public entry ────────────────────────────────────────────────────────────

/**
 * Pack `meshes` onto a rectangular plate using shelf-pack with 90° rotation.
 *
 * @param meshes List of meshes with AABB dimensions in mm.
 * @param plateMm Plate dimensions + clearance in mm.
 * @returns ArrangedPlate with placements, unplaced ids, and utilization.
 */
export function autoArrangePlate(
  meshes: ReadonlyArray<AutoArrangeMesh>,
  plateMm: AutoArrangePlate
): ArrangedPlate {
  if (plateMm.x <= 0 || plateMm.y <= 0) {
    throw new Error(
      `Plate dimensions must be positive; got ${plateMm.x} × ${plateMm.y}`
    )
  }
  if (plateMm.clearance < 0) {
    throw new Error(`Plate clearance must be non-negative; got ${plateMm.clearance}`)
  }

  // Filter out degenerate meshes (zero or negative width/depth) and
  // record them as unplaced — never crash the run on bad input.
  const earlyUnplaced: string[] = []
  const candidates: SortedMesh[] = []
  meshes.forEach((m, i) => {
    const w = m.aabbMm.width
    const d = m.aabbMm.depth
    if (!Number.isFinite(w) || !Number.isFinite(d) || w <= 0 || d <= 0) {
      earlyUnplaced.push(m.id)
      return
    }
    candidates.push({
      id: m.id,
      width: w,
      depth: d,
      area: w * d,
      inputIndex: i
    })
  })

  // Sort by AABB area descending. Stable sort (V8/SpiderMonkey both stable
  // since 2019) preserves inputIndex as the tiebreaker.
  candidates.sort((a, b) => b.area - a.area)

  const placements: AutoArrangePlacement[] = []
  const unplaced: string[] = [...earlyUnplaced]
  const shelves: Shelf[] = []
  /** Y cursor for "where would the next NEW shelf start". */
  let yNextShelf = 0
  let totalFootprintMm2 = 0

  for (const c of candidates) {
    const placed = tryPlace(c, plateMm, shelves, yNextShelf)
    if (placed === null) {
      unplaced.push(c.id)
      continue
    }
    placements.push({
      id: c.id,
      xMm: round3(placed.xMm),
      yMm: round3(placed.yMm),
      rotationDeg: placed.rotationDeg
    })
    // Update the matched shelf in place. tryPlace already mutated it via
    // the returned reference but new shelves still need pushing.
    if (placed.newShelf) {
      shelves.push(placed.newShelf)
      // Track the highest top edge of any shelf so the next NEW shelf
      // can start above the tallest existing one.
      const top = placed.newShelf.yMin + placed.newShelf.shelfHeight
      if (top > yNextShelf) yNextShelf = top
    } else if (placed.usedShelf) {
      const top = placed.usedShelf.yMin + placed.usedShelf.shelfHeight
      if (top > yNextShelf) yNextShelf = top
    }
    totalFootprintMm2 += c.area
  }

  // Re-order placements to match the original input order. The caller
  // typically iterates them in lockstep with their own mesh list.
  placements.sort((a, b) => {
    const ai = meshes.findIndex((m) => m.id === a.id)
    const bi = meshes.findIndex((m) => m.id === b.id)
    return ai - bi
  })

  const plateArea = plateMm.x * plateMm.y
  const utilizationPct = plateArea > 0
    ? round3((totalFootprintMm2 / plateArea) * 100)
    : 0

  return {
    placements,
    unplaced,
    utilizationPct
  }
}

// ── Internal placement helpers ──────────────────────────────────────────────

interface PlacementAttempt {
  xMm: number
  yMm: number
  rotationDeg: 0 | 90
  /** If a new shelf was opened, the caller pushes it onto the list. */
  newShelf?: Shelf
  /** If an existing shelf was used, the caller updates yNextShelf accordingly. */
  usedShelf?: Shelf
}

/**
 * Attempt to place a single mesh onto the plate. Returns the placement
 * details on success or null if neither rotation fits.
 *
 * Mutates the matched shelf's `xCursor` + `shelfHeight` on success so
 * subsequent parts on that shelf pack tightly to the right.
 */
function tryPlace(
  mesh: SortedMesh,
  plate: AutoArrangePlate,
  shelves: ReadonlyArray<Shelf>,
  yNextShelf: number
): PlacementAttempt | null {
  // Try both rotations; pick whichever leaves the most room on the
  // chosen shelf. If only one rotation is legal, take it.
  const rotations: ReadonlyArray<0 | 90> = [0, 90]
  let best: { att: PlacementAttempt; leftover: number } | null = null

  for (const rot of rotations) {
    // 0°: width along X, depth along Y. 90°: depth along X, width along Y.
    const wFootprint = rot === 0 ? mesh.width : mesh.depth
    const hFootprint = rot === 0 ? mesh.depth : mesh.width
    const wWithClearance = wFootprint + plate.clearance * 2
    const hWithClearance = hFootprint + plate.clearance * 2

    // Hard reject if the footprint alone exceeds the plate.
    if (wWithClearance > plate.x || hWithClearance > plate.y) continue

    // Find an existing shelf that has room AND whose height is enough
    // for our footprint (we never shrink a shelf — its height grows
    // monotonically with the tallest part placed on it).
    const matched = pickMatchingShelf(shelves, wWithClearance, hWithClearance, plate.x)
    if (matched !== null) {
      const leftover = plate.x - matched.xCursor - wWithClearance
      const candidateAttempt: PlacementAttempt = {
        // The AABB-min corner of the part is shifted inward by `clearance`
        // so the visual gap on the left/bottom of each part is honoured.
        xMm: matched.xCursor + plate.clearance,
        yMm: matched.yMin + plate.clearance,
        rotationDeg: rot,
        usedShelf: matched
      }
      if (best === null || leftover > best.leftover) {
        best = { att: candidateAttempt, leftover }
      }
      continue
    }

    // No existing shelf fits — open a new one. The new shelf would sit
    // at yNextShelf; reject if that pushes off the plate.
    if (yNextShelf + hWithClearance > plate.y) continue

    const newShelf: Shelf = {
      yMin: yNextShelf,
      shelfHeight: hWithClearance,
      xCursor: wWithClearance
    }
    const leftover = plate.x - wWithClearance
    const candidateAttempt: PlacementAttempt = {
      xMm: 0 + plate.clearance,
      yMm: yNextShelf + plate.clearance,
      rotationDeg: rot,
      newShelf
    }
    if (best === null || leftover > best.leftover) {
      best = { att: candidateAttempt, leftover }
    }
  }

  if (best === null) return null

  // Commit the chosen placement: mutate the shelf cursor / shelfHeight
  // if we reused an existing shelf.
  if (best.att.usedShelf) {
    const wFootprint = best.att.rotationDeg === 0 ? mesh.width : mesh.depth
    const hFootprint = best.att.rotationDeg === 0 ? mesh.depth : mesh.width
    const wWithClearance = wFootprint + plate.clearance * 2
    const hWithClearance = hFootprint + plate.clearance * 2
    best.att.usedShelf.xCursor += wWithClearance
    if (hWithClearance > best.att.usedShelf.shelfHeight) {
      best.att.usedShelf.shelfHeight = hWithClearance
    }
  }

  return best.att
}

/**
 * Find the shelf with the best fit for the given footprint, or null if
 * no existing shelf accommodates the mesh. "Best fit" = shelf with the
 * smallest leftover room (to keep wide shelves available for wider
 * parts later).
 */
function pickMatchingShelf(
  shelves: ReadonlyArray<Shelf>,
  wWithClearance: number,
  hWithClearance: number,
  plateX: number
): Shelf | null {
  let best: Shelf | null = null
  let bestLeftover = Infinity
  for (const s of shelves) {
    // Fit along X (must have enough room past the cursor).
    if (s.xCursor + wWithClearance > plateX) continue
    // Fit along Y: the part must not need more vertical room than the
    // shelf has reserved. (If it's shorter, that's fine — wasted Y
    // space is the cost of shelf-pack.)
    if (hWithClearance > s.shelfHeight) continue
    const leftover = plateX - s.xCursor - wWithClearance
    if (leftover < bestLeftover) {
      best = s
      bestLeftover = leftover
    }
  }
  return best
}

/** Round to 3 decimal places — sub-micron tolerance for reporting. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

// ── Placement → transform helpers ───────────────────────────────────────────

/**
 * Convert a single placement into an X/Y position offset that the caller can
 * write onto a Job's `transform.position`. The placement carries the
 * AABB-min corner of the part; this helper returns the offset needed to
 * shift the part so its AABB-min sits at (xMm, yMm) on the plate,
 * **relative to the plate origin** (i.e., the renderer is responsible for
 * any final origin convention — see `centerOnPlate` below for the most
 * common K2 Plus mapping).
 *
 * Returned shape matches what the K2 Plus renderer expects:
 *   transform.position.x ← shifted such that the part's local-X-min aligns
 *                          with the placement's xMm on the plate (mm).
 *   transform.position.y ← same for Y.
 *
 * `localAabbMin` is the AABB-min corner of the mesh in its own local space
 * BEFORE any transform — typically (-w/2, -d/2) for a centred mesh or
 * whatever `computeBinaryStlBoundingBox` reports. The auto-arrange button
 * passes the centered-mesh case ((-w/2, -d/2)) so the math reduces to
 * (placement.xMm + w/2, placement.yMm + d/2).
 */
export function placementToPositionOffset(
  placement: AutoArrangePlacement,
  meshWidthMm: number,
  meshDepthMm: number
): { x: number; y: number } {
  // The placement's (xMm, yMm) is the AABB-min corner on the plate.
  // For a mesh whose local origin is its centroid, the renderer translates
  // by (xMm + w/2, yMm + d/2) so the centroid lands at the centre of the
  // placed footprint. We respect the rotation too: when rotated 90°, the
  // footprint along X is the mesh's depth and vice versa.
  const isRotated = placement.rotationDeg === 90
  const footprintX = isRotated ? meshDepthMm : meshWidthMm
  const footprintY = isRotated ? meshWidthMm : meshDepthMm
  return {
    x: placement.xMm + footprintX / 2,
    y: placement.yMm + footprintY / 2
  }
}

/**
 * Convert a plate-relative placement (origin at plate (0, 0)) into a
 * centred-plate offset (origin at the plate centre). K2 Plus operators
 * typically model parts with the plate centre at world (0, 0) so the
 * renderer needs the *centred* offset to draw them in the right spot.
 *
 * If `centerOrigin` is true, the returned offset is shifted by
 * (-plateX/2, -plateY/2) so a placement at plate (175, 175) on a 350×350
 * plate maps to world (0, 0).
 */
export function placementToCenteredOffset(
  placement: AutoArrangePlacement,
  meshWidthMm: number,
  meshDepthMm: number,
  plateX: number,
  plateY: number
): { x: number; y: number } {
  const base = placementToPositionOffset(placement, meshWidthMm, meshDepthMm)
  return {
    x: base.x - plateX / 2,
    y: base.y - plateY / 2
  }
}

// ── Internal exports for unit tests only ────────────────────────────────────

/** @internal — exposed so tests can validate sub-piece behaviour. */
export const __internals = {
  pickMatchingShelf,
  tryPlace
}
