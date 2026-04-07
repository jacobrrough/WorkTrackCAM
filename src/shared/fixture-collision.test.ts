import { describe, expect, it } from 'vitest'
import type { FixtureRecord } from './fixture-schema'
import { VISE_4IN } from './fixture-schema'
import {
  checkFixtureCollision,
  hasFixtureCollision,
  type ToolpathPoint
} from './fixture-collision'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple fixture: a single box from (10,10,0) to (30,30,40). */
const SIMPLE_BOX_FIXTURE: FixtureRecord = {
  id: 'test-box',
  name: 'Test Box',
  type: 'clamp',
  geometry: [{ minX: 10, maxX: 30, minY: 10, maxY: 30, minZ: 0, maxZ: 40 }],
  clampingPositions: []
}

/** Fixture with two separated boxes (L-shape). */
const L_FIXTURE: FixtureRecord = {
  id: 'test-l',
  name: 'L Shape',
  type: 'custom',
  geometry: [
    { minX: 0, maxX: 10, minY: 0, maxY: 50, minZ: 0, maxZ: 30 },
    { minX: 0, maxX: 50, minY: 0, maxY: 10, minZ: 0, maxZ: 30 }
  ],
  clampingPositions: []
}

function pt(line: number, x: number, y: number, z: number): ToolpathPoint {
  return { line, x, y, z }
}

// ---------------------------------------------------------------------------
// checkFixtureCollision
// ---------------------------------------------------------------------------

describe('checkFixtureCollision', () => {
  it('returns safe for empty toolpath', () => {
    const result = checkFixtureCollision([], SIMPLE_BOX_FIXTURE, 6)
    expect(result.safe).toBe(true)
    expect(result.collisions).toHaveLength(0)
  })

  it('returns safe for empty fixture geometry', () => {
    const emptyFixture: FixtureRecord = {
      id: 'empty',
      name: 'Empty',
      type: 'custom',
      geometry: [],
      clampingPositions: []
    }
    // Use parse to avoid Zod min(1) validation — test the runtime function
    const result = checkFixtureCollision([pt(1, 20, 20, 10)], { ...emptyFixture, geometry: [] }, 6)
    expect(result.safe).toBe(true)
  })

  it('detects collision when tool is inside fixture AABB', () => {
    // Point at (20,20,20) — right in the middle of the box (10-30, 10-30, 0-40)
    // Tool diameter 6mm → radius 3mm → tool AABB (17-23, 17-23, 20-70) overlaps fixture
    const toolpath = [pt(1, 20, 20, 20)]
    const result = checkFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6)
    expect(result.safe).toBe(false)
    expect(result.collisions).toHaveLength(1)
    expect(result.collisions[0]!.line).toBe(1)
    expect(result.collisions[0]!.clearance).toBeLessThan(0)
  })

  it('detects collision when tool cylinder overlaps fixture edge', () => {
    // Point at (8, 20, 20) with tool diameter 6mm → tool AABB minX=5, maxX=11
    // Fixture starts at minX=10 → overlap on X axis
    const toolpath = [pt(5, 8, 20, 20)]
    const result = checkFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6)
    expect(result.safe).toBe(false)
    expect(result.collisions).toHaveLength(1)
  })

  it('returns safe when tool is far from fixture', () => {
    // Point at (100, 100, 100) — well outside the fixture box
    const toolpath = [pt(1, 100, 100, 100)]
    const result = checkFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6)
    expect(result.safe).toBe(true)
    expect(result.collisions).toHaveLength(0)
  })

  it('returns safe when tool is above fixture', () => {
    // Point at (20, 20, 50) — above the fixture (maxZ=40), tool extends upward
    // Tool AABB z: 50–100, fixture z: 0–40 → no overlap
    const toolpath = [pt(1, 20, 20, 50)]
    const result = checkFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6)
    expect(result.safe).toBe(true)
  })

  it('detects collision at fixture top surface', () => {
    // Point at (20, 20, 35) — tool tip at z=35, fixture top at z=40
    // Tool AABB z: 35–85, fixture z: 0–40 → overlap on Z
    const toolpath = [pt(1, 20, 20, 35)]
    const result = checkFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6)
    expect(result.safe).toBe(false)
  })

  it('checks multiple toolpath points', () => {
    const toolpath = [
      pt(1, 100, 100, 100), // safe
      pt(2, 20, 20, 20),    // collision
      pt(3, -50, -50, 100), // safe
      pt(4, 15, 15, 10)     // collision
    ]
    const result = checkFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6)
    expect(result.safe).toBe(false)
    expect(result.collisions).toHaveLength(2)
    expect(result.collisions[0]!.line).toBe(2)
    expect(result.collisions[1]!.line).toBe(4)
  })

  it('reports correct point coordinates in collisions', () => {
    const toolpath = [pt(7, 20, 20, 20)]
    const result = checkFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6)
    expect(result.collisions[0]!.point).toEqual({ x: 20, y: 20, z: 20 })
  })

  it('detects collision with L-shaped fixture (multiple AABBs)', () => {
    // Point at (5, 25, 15) — inside the vertical arm of the L
    const toolpath = [pt(1, 5, 25, 15)]
    const result = checkFixtureCollision(toolpath, L_FIXTURE, 4)
    expect(result.safe).toBe(false)
  })

  it('safe path through L-fixture gap', () => {
    // Point at (25, 25, 15) — in the open area of the L (not in either box)
    // Vertical arm: x=0–10, y=0–50. Horizontal arm: x=0–50, y=0–10.
    // Point is at x=25 (outside vertical arm), y=25 (outside horizontal arm)
    // Tool diameter 2mm → radius 1mm → AABB (24–26, 24–26, 15–65) — no overlap with either box
    const toolpath = [pt(1, 25, 25, 15)]
    const result = checkFixtureCollision(toolpath, L_FIXTURE, 2)
    expect(result.safe).toBe(true)
  })

  it('respects custom tool length', () => {
    // Point at (20, 20, 50) — above fixture top (z=40)
    // Default tool length 50mm → tool AABB z: 50–100 → no overlap → safe
    // With tool length 0 → tool AABB z: 50–50 → still no overlap → safe
    // But point at (20, 20, 39) with tool length 5 → z: 39–44 → overlaps 0–40 → collision
    const toolpath = [pt(1, 20, 20, 39)]
    const resultShortTool = checkFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6, 5)
    expect(resultShortTool.safe).toBe(false)
  })

  it('clearance is negative for penetrating collisions', () => {
    // Point deep inside the fixture
    const toolpath = [pt(1, 20, 20, 20)]
    const result = checkFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6)
    expect(result.collisions[0]!.clearance).toBeLessThan(0)
  })
})

// ---------------------------------------------------------------------------
// hasFixtureCollision (quick boolean check)
// ---------------------------------------------------------------------------

describe('hasFixtureCollision', () => {
  it('returns false for empty toolpath', () => {
    expect(hasFixtureCollision([], SIMPLE_BOX_FIXTURE, 6)).toBe(false)
  })

  it('returns true on collision', () => {
    expect(hasFixtureCollision([pt(1, 20, 20, 20)], SIMPLE_BOX_FIXTURE, 6)).toBe(true)
  })

  it('returns false when safe', () => {
    expect(hasFixtureCollision([pt(1, 100, 100, 100)], SIMPLE_BOX_FIXTURE, 6)).toBe(false)
  })

  it('short-circuits on first collision', () => {
    // First point collides — should return immediately without checking rest
    const toolpath = [
      pt(1, 20, 20, 20),    // collision
      pt(2, 100, 100, 100),  // safe
      pt(3, 15, 15, 10)      // collision
    ]
    expect(hasFixtureCollision(toolpath, SIMPLE_BOX_FIXTURE, 6)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Collision with real preset fixtures
// ---------------------------------------------------------------------------

describe('collision with VISE_4IN preset', () => {
  it('detects collision with vise body', () => {
    // Point at (0, 0, 30) — inside the vise body (x: -100–100, y: -50–50, z: 0–60)
    const toolpath = [pt(1, 0, 0, 30)]
    const result = checkFixtureCollision(toolpath, VISE_4IN, 10)
    expect(result.safe).toBe(false)
  })

  it('safe above vise jaws', () => {
    // Point at (0, 0, 100) — well above vise body (maxZ=60) and jaws (maxZ=90)
    // Tool AABB z: 100–150 → no overlap with any fixture box
    const toolpath = [pt(1, 0, 0, 100)]
    const result = checkFixtureCollision(toolpath, VISE_4IN, 10)
    expect(result.safe).toBe(true)
  })

  it('detects collision with fixed jaw', () => {
    // Fixed jaw: x: -100 to -90, y: -50 to 50, z: 60 to 90
    // Point at (-95, 0, 75) — inside the fixed jaw block
    const toolpath = [pt(1, -95, 0, 75)]
    const result = checkFixtureCollision(toolpath, VISE_4IN, 6)
    expect(result.safe).toBe(false)
  })

  it('safe in the jaw opening area', () => {
    // Between jaws: x roughly -90 to 90, above body z=60, below jaw top z=90
    // Point at (0, 0, 95) — above jaw top (90), tool AABB z: 95–145
    // No fixture box reaches z=95
    const toolpath = [pt(1, 0, 0, 95)]
    const result = checkFixtureCollision(toolpath, VISE_4IN, 10)
    expect(result.safe).toBe(true)
  })
})
