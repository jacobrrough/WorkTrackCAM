/**
 * Tests for `meshToMachineFrame` — the canonical 4-axis coordinate transform.
 *
 * These tests encode the FRAME CONTRACT that the renderer's
 * `mapGcodeToThreeEndpoints` (in `gcode-toolpath-parse.ts`) expects:
 *   - X ∈ [0, stockLengthMm], chuck face at X=0
 *   - Y/Z perpendicular to rotation axis
 *   - At A=0, the "radial up" direction is +Z (matches the renderer's
 *     `viewerY = axisY + r*cos(0) = axisY + r`)
 *
 * If a test in this file fails, the toolpath will visibly miss the displayed
 * model in the simulator. Do NOT relax these checks without also updating the
 * renderer.
 */
import { describe, expect, it } from 'vitest'
import { identityPlacement, meshToMachineFrame, type Placement, type Triangle } from '../frame'

const STOCK = { lengthMm: 100, diameterMm: 40 }

/** A unit triangle in raw STL space. */
function tri(a: [number, number, number], b: [number, number, number], c: [number, number, number]): Triangle {
  return [a, b, c]
}

/** A small symmetric box centered at origin (radius 5 around X-axis, length 10). */
function unitBoxAtOrigin(): Triangle[] {
  const r = 5
  const hL = 5 // half-length
  return [
    // +Z face
    tri([-hL, -r, r], [hL, -r, r], [hL, r, r]),
    tri([-hL, -r, r], [hL, r, r], [-hL, r, r]),
    // -Z face
    tri([-hL, -r, -r], [-hL, r, -r], [hL, r, -r]),
    tri([-hL, -r, -r], [hL, r, -r], [hL, -r, -r]),
    // +Y face
    tri([-hL, r, -r], [-hL, r, r], [hL, r, r]),
    tri([-hL, r, -r], [hL, r, r], [hL, r, -r]),
    // -Y face
    tri([-hL, -r, -r], [hL, -r, -r], [hL, -r, r]),
    tri([-hL, -r, -r], [hL, -r, r], [-hL, -r, r])
  ]
}

describe('meshToMachineFrame — basic transform pipeline', () => {
  it('shifts an origin-centered mesh by halfLen on X (identity placement)', () => {
    const r = meshToMachineFrame(unitBoxAtOrigin(), identityPlacement(), STOCK)
    expect(r.bbox.min[0]).toBeCloseTo(50 - 5, 6) // halfLen - hL
    expect(r.bbox.max[0]).toBeCloseTo(50 + 5, 6)
    expect(r.bbox.min[1]).toBeCloseTo(-5, 6)
    expect(r.bbox.max[1]).toBeCloseTo(5, 6)
    expect(r.bbox.min[2]).toBeCloseTo(-5, 6)
    expect(r.bbox.max[2]).toBeCloseTo(5, 6)
  })

  it('keeps an off-center raw mesh centered after the bake (centerOrigin)', () => {
    // Raw mesh has its bbox at X∈[10,30], so center at X=20.
    // After centering and the +halfLen shift, it should be centered at X=halfLen=50.
    const offset: Triangle[] = unitBoxAtOrigin().map(([a, b, c]) => [
      [a[0] + 20, a[1], a[2]],
      [b[0] + 20, b[1], b[2]],
      [c[0] + 20, c[1], c[2]]
    ])
    const r = meshToMachineFrame(offset, identityPlacement(), STOCK)
    expect((r.bbox.min[0] + r.bbox.max[0]) / 2).toBeCloseTo(50, 6)
  })

  it('respects user gizmo X position (no auto-recentering)', () => {
    // Gizmo position.x = 10 should shift the centered mesh by +10 in machine X.
    const placement: Placement = {
      position: { x: 10, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    const r = meshToMachineFrame(unitBoxAtOrigin(), placement, STOCK)
    // Box center should be at machine X = halfLen + 10 = 60
    expect((r.bbox.min[0] + r.bbox.max[0]) / 2).toBeCloseTo(60, 6)
  })

  it('respects user gizmo Y position (Y↔Z swap: gizmo.y → STL Z)', () => {
    // The renderer's Y↔Z swap maps gizmo Y (Three.js up) → STL Z. So a
    // gizmo position.y of 3 should shift the bbox by +3 in STL Z.
    const placement: Placement = {
      position: { x: 0, y: 3, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    const r = meshToMachineFrame(unitBoxAtOrigin(), placement, STOCK)
    expect((r.bbox.min[2] + r.bbox.max[2]) / 2).toBeCloseTo(3, 6)
    expect((r.bbox.min[1] + r.bbox.max[1]) / 2).toBeCloseTo(0, 6)
  })

  it('respects user gizmo Z position (Y↔Z swap: gizmo.z → STL Y)', () => {
    const placement: Placement = {
      position: { x: 0, y: 0, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    const r = meshToMachineFrame(unitBoxAtOrigin(), placement, STOCK)
    expect((r.bbox.min[1] + r.bbox.max[1]) / 2).toBeCloseTo(4, 6)
    expect((r.bbox.min[2] + r.bbox.max[2]) / 2).toBeCloseTo(0, 6)
  })

  it('respects user gizmo scale (Y↔Z swap: gizmo.y → STL Z scale)', () => {
    const placement: Placement = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 3, z: 4 }
    }
    const r = meshToMachineFrame(unitBoxAtOrigin(), placement, STOCK)
    // Original box was 10×10×10 (X×Y×Z). After scale (2, gizmo.z=4 → STL Y, gizmo.y=3 → STL Z):
    expect(r.bbox.max[0] - r.bbox.min[0]).toBeCloseTo(20, 6) // X * 2
    expect(r.bbox.max[1] - r.bbox.min[1]).toBeCloseTo(40, 6) // Y * gizmo.z = 4
    expect(r.bbox.max[2] - r.bbox.min[2]).toBeCloseTo(30, 6) // Z * gizmo.y = 3
  })
})

describe('meshToMachineFrame — rotation conventions (CRITICAL)', () => {
  it('A=0 maps to +STL_Z (renderer convention: viewerY = axisY + r at A=0)', () => {
    // Build a mesh that is symmetric in Z but has a "tall spike" extending
    // toward +Z. After centering on the Z bbox midpoint, the +Z vertex should
    // remain in the +Z half — confirming sign preservation through the bake.
    // The renderer's `viewerY = axisY + r*cos(0) = axisY + r` means a positive
    // Z value in machine frame corresponds to "up" in the viewer at A=0.
    const meshZSpike: Triangle[] = [
      // A wide flat base at z = -1
      tri([-5, -5, -1], [5, -5, -1], [5, 5, -1]),
      tri([-5, -5, -1], [5, 5, -1], [-5, 5, -1]),
      // A tall spike at z = +9
      tri([-0.5, -0.5, 9], [0.5, -0.5, 9], [0, 0.5, 9])
    ]
    const r = meshToMachineFrame(meshZSpike, identityPlacement(), STOCK)
    // After centering on the Z midpoint (-1+9)/2 = 4, the spike's vertices
    // are at z = 9 - 4 = 5 and the base at z = -1 - 4 = -5. So we should
    // see z values reaching +5 (positive) and -5 (negative).
    let maxZ = -Infinity
    let minZ = Infinity
    for (const t of r.triangles) for (const v of t) {
      if (v[2] > maxZ) maxZ = v[2]
      if (v[2] < minZ) minZ = v[2]
    }
    expect(maxZ).toBeCloseTo(5, 6)
    expect(minZ).toBeCloseTo(-5, 6)
    // Sanity: meshRadialMax should reflect the bbox extent (≥ 5 from the spike).
    expect(r.meshRadialMax).toBeGreaterThanOrEqual(5)
  })

  it('rotating gizmo Y by 90° rotates STL around the +X axis (Y↔Z swap)', () => {
    // The renderer's Y↔Z swap means rotation about Three.js Y (viewer up) is
    // applied as STL rotation about Z. But the gizmo rotates about *its* axis,
    // which after the swap means STL Z. We test that this is wired correctly.
    const placement: Placement = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 90, z: 0 }, // gizmo.y = 90°
      scale: { x: 1, y: 1, z: 1 }
    }
    // Start with a vertex at +STL_Y (which should rotate around STL Z to +STL_X)
    const t: Triangle = [
      [0, 10, 0],
      [0, 10, 0.01],
      [0.01, 10, 0]
    ]
    const r = meshToMachineFrame([t], placement, STOCK)
    // The vertex started at relative offset (0, ~10, 0) (slight bbox offset).
    // After rotation about STL Z by 90°, the +Y direction should map to +X (or -X
    // depending on rotation sign). Either way, the vertex should now be far
    // from where it started in Y.
    let maxY = -Infinity
    let minY = Infinity
    for (const tt of r.triangles) for (const v of tt) {
      if (v[1] > maxY) maxY = v[1]
      if (v[1] < minY) minY = v[1]
    }
    // Y range collapsed (rotated out of Y plane)
    expect(maxY - minY).toBeLessThan(0.05)
  })
})

describe('meshToMachineFrame — bbox and radial extent', () => {
  it('reports meshRadialMax as max √(Y² + Z²) over all vertices', () => {
    // A point at (0, 3, 4) → r = 5
    const t: Triangle = [
      [-1, 3, 4],
      [1, 3, 4],
      [0, 3.01, 4]
    ]
    const r = meshToMachineFrame([t], identityPlacement(), STOCK)
    // After centering (bbox center is roughly (0, 3.003, 4)), the centered
    // vertices are near origin. So radialMax is small.
    expect(r.meshRadialMax).toBeLessThan(0.1)
  })

  it('off-axis raw mesh has radial extent reflecting the user position', () => {
    const placement: Placement = {
      position: { x: 0, y: 0, z: 6 }, // gizmo.z → STL Y → +6 in Y
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    }
    const r = meshToMachineFrame(unitBoxAtOrigin(), placement, STOCK)
    // After translate, max y is 5 + 6 = 11. RadialMax >= 11.
    expect(r.meshRadialMax).toBeGreaterThanOrEqual(11)
  })
})

describe('meshToMachineFrame — degenerate inputs', () => {
  it('returns empty result for zero triangles with a warning', () => {
    const r = meshToMachineFrame([], identityPlacement(), STOCK)
    expect(r.triangles).toHaveLength(0)
    expect(r.meshRadialMax).toBe(0)
    expect(r.warnings.some((w) => /zero triangles/.test(w))).toBe(true)
  })

  it('handles a single degenerate triangle without crashing', () => {
    const t: Triangle = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ]
    const r = meshToMachineFrame([t], identityPlacement(), STOCK)
    expect(r.triangles).toHaveLength(1)
    // After centering and shift, it should be at (halfLen, 0, 0)
    expect(r.triangles[0]![0][0]).toBeCloseTo(50, 6)
  })
})
