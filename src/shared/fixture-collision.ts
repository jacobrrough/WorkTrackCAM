/**
 * Fixture Collision Detection
 *
 * Checks toolpath segments against fixture geometry (axis-aligned bounding boxes)
 * for collision or near-miss detection. Uses a simple AABB approach for
 * performance — suitable for real-time checking during toolpath generation.
 *
 * The tool is modeled as a vertical cylinder (diameter × height extending upward
 * from the tool tip) around each toolpath point. Collision is detected when
 * the cylinder's AABB intersects any fixture AABB.
 */

import type { AABB, FixtureRecord, Point3D } from './fixture-schema'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single collision event detected on the toolpath. */
export interface FixtureCollision {
  /** 1-based line number in the toolpath (matches G-code line ordering). */
  line: number
  /** The toolpath point where the collision occurs. */
  point: Point3D
  /** Signed clearance (mm): negative = penetration depth, positive = near-miss distance. */
  clearance: number
}

/** Result of a fixture collision check. */
export interface FixtureCollisionResult {
  /** True if no collisions were detected. */
  safe: boolean
  /** List of collision events (empty when safe). */
  collisions: FixtureCollision[]
}

/** A toolpath point with line metadata for collision checking. */
export interface ToolpathPoint {
  /** 1-based line number. */
  line: number
  /** Tool tip X position (mm). */
  x: number
  /** Tool tip Y position (mm). */
  y: number
  /** Tool tip Z position (mm). */
  z: number
}

// ---------------------------------------------------------------------------
// AABB Helpers
// ---------------------------------------------------------------------------

/**
 * Test whether two AABBs overlap on all three axes.
 */
function aabbsOverlap(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
         a.minY <= b.maxY && a.maxY >= b.minY &&
         a.minZ <= b.maxZ && a.maxZ >= b.minZ
}

/**
 * Compute the minimum signed distance between a point and an AABB on one axis.
 * Returns negative if the point is inside the AABB on that axis.
 */
function axisDistance(p: number, min: number, max: number): number {
  if (p < min) return min - p
  if (p > max) return p - max
  return -Math.min(p - min, max - p) // inside: negative distance to nearest face
}

/**
 * Compute the minimum signed clearance from a tool cylinder AABB to a fixture AABB.
 * Negative values mean penetration; positive means safe clearance.
 */
function computeClearance(toolAABB: AABB, fixtureAABB: AABB): number {
  // If they don't overlap, find the minimum gap distance across all axes
  if (!aabbsOverlap(toolAABB, fixtureAABB)) {
    const gapX = toolAABB.maxX < fixtureAABB.minX
      ? fixtureAABB.minX - toolAABB.maxX
      : toolAABB.minX > fixtureAABB.maxX
        ? toolAABB.minX - fixtureAABB.maxX
        : 0
    const gapY = toolAABB.maxY < fixtureAABB.minY
      ? fixtureAABB.minY - toolAABB.maxY
      : toolAABB.minY > fixtureAABB.maxY
        ? toolAABB.minY - fixtureAABB.maxY
        : 0
    const gapZ = toolAABB.maxZ < fixtureAABB.minZ
      ? fixtureAABB.minZ - toolAABB.maxZ
      : toolAABB.minZ > fixtureAABB.maxZ
        ? toolAABB.minZ - fixtureAABB.maxZ
        : 0
    // Return the smallest non-zero gap (they separate on at least one axis)
    const gaps = [gapX, gapY, gapZ].filter((g) => g > 0)
    return gaps.length > 0 ? Math.min(...gaps) : 0
  }

  // Overlapping: compute maximum penetration depth (most negative)
  const overlapX = Math.min(toolAABB.maxX - fixtureAABB.minX, fixtureAABB.maxX - toolAABB.minX)
  const overlapY = Math.min(toolAABB.maxY - fixtureAABB.minY, fixtureAABB.maxY - toolAABB.minY)
  const overlapZ = Math.min(toolAABB.maxZ - fixtureAABB.minZ, fixtureAABB.maxZ - toolAABB.minZ)
  // Penetration is the minimum overlap (shallowest axis of intersection)
  return -Math.min(overlapX, overlapY, overlapZ)
}

// ---------------------------------------------------------------------------
// Tool Cylinder AABB
// ---------------------------------------------------------------------------

/**
 * Build an AABB for a vertical tool cylinder at a given point.
 *
 * The tool tip is at (x, y, z). The cylinder extends upward by `toolLengthMm`
 * (default: 50mm from the tip — sufficient for most collision scenarios).
 * The cylinder radius is `toolDiameterMm / 2`.
 */
function toolCylinderAABB(
  x: number,
  y: number,
  z: number,
  toolDiameterMm: number,
  toolLengthMm: number = 50
): AABB {
  const r = toolDiameterMm / 2
  return {
    minX: x - r,
    maxX: x + r,
    minY: y - r,
    maxY: y + r,
    minZ: z,
    maxZ: z + toolLengthMm
  }
}

// ---------------------------------------------------------------------------
// Main Collision Check
// ---------------------------------------------------------------------------

/**
 * Check a toolpath against fixture geometry for collisions.
 *
 * Each toolpath point is modeled as a vertical cylinder (tool diameter × tool length)
 * and tested against every AABB in the fixture's geometry list.
 *
 * @param toolpath - Ordered list of toolpath points with line numbers
 * @param fixture - Fixture record containing geometry AABBs
 * @param toolDiameterMm - Tool diameter (mm)
 * @param toolLengthMm - Tool stick-out length above the tip (mm, default 50)
 * @returns Collision result with safety status and collision details
 */
export function checkFixtureCollision(
  toolpath: readonly ToolpathPoint[],
  fixture: FixtureRecord,
  toolDiameterMm: number,
  toolLengthMm: number = 50
): FixtureCollisionResult {
  if (toolpath.length === 0 || fixture.geometry.length === 0) {
    return { safe: true, collisions: [] }
  }

  const collisions: FixtureCollision[] = []

  for (const pt of toolpath) {
    const toolBB = toolCylinderAABB(pt.x, pt.y, pt.z, toolDiameterMm, toolLengthMm)

    let worstClearance = Infinity

    for (const fixtureBox of fixture.geometry) {
      if (aabbsOverlap(toolBB, fixtureBox)) {
        const clearance = computeClearance(toolBB, fixtureBox)
        if (clearance < worstClearance) {
          worstClearance = clearance
        }
      }
    }

    if (worstClearance < Infinity) {
      collisions.push({
        line: pt.line,
        point: { x: pt.x, y: pt.y, z: pt.z },
        clearance: worstClearance
      })
    }
  }

  return {
    safe: collisions.length === 0,
    collisions
  }
}

/**
 * Quick check: does any point in the toolpath collide with the fixture?
 * Returns true immediately on first collision — faster than full check
 * when you only need a boolean answer.
 */
export function hasFixtureCollision(
  toolpath: readonly ToolpathPoint[],
  fixture: FixtureRecord,
  toolDiameterMm: number,
  toolLengthMm: number = 50
): boolean {
  if (toolpath.length === 0 || fixture.geometry.length === 0) return false

  for (const pt of toolpath) {
    const toolBB = toolCylinderAABB(pt.x, pt.y, pt.z, toolDiameterMm, toolLengthMm)
    for (const fixtureBox of fixture.geometry) {
      if (aabbsOverlap(toolBB, fixtureBox)) return true
    }
  }

  return false
}
