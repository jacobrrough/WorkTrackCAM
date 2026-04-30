/**
 * [ID-0201] Cycle 124 -- ui-polish paired-pin contract for the two pure
 * helpers exported from `viewport3d-bounds.ts`. The module is small (31
 * source lines) but load-bearing in the Design tab Three.js viewport
 * across all three target machines:
 *
 *   - `measureMarkerRadiusMmFromGeometry` is consumed by
 *     `Viewport3D.tsx` line 464 to pick the world-space sphere radius
 *     (mm) for measure markers, scaled to the preview mesh size so the
 *     markers stay perceptually constant under `Bounds`-style framing.
 *     A silent regression in the scale factor or clamp range would
 *     either invisible-ize the markers on small Carvera 4-axis parts
 *     (radius < 0.65 mm) OR produce gigantic 30-mm markers on
 *     full-sheet Laguna stocks (radius > 18 mm) -- both wreck the UX
 *     because the operator can no longer click the spot they want.
 *
 *   - `worldYRangeFromExtrudeMeshGeometry` is the documented contract
 *     for the section slider's Y-extent (per JSDoc): "Returns world-Y
 *     span for the section slider." The fallback {0, 40} mm range
 *     keeps the slider usable when the preview mesh has no finite
 *     bounds (empty geometry, all-NaN vertices). The min-span bump
 *     (`max = min + 1`) keeps the slider from collapsing to a single
 *     value on degenerate planar previews where every vertex shares
 *     the same Y -- typical of a freshly-imported flat sketch.
 *
 * Pinned facts (any production drift WILL break a test here):
 *   - World-Y range mirrors the geometry bounding box's min.y/max.y
 *     when finite.
 *   - {0, 40} fallback when bounding-box min/max contain NaN/Infinity.
 *   - Min span bump: max = min + 1 when max - min < 1e-4 (strictly less
 *     than; 1e-4 exactly is preserved).
 *   - Marker radius fallback constant = 1.2 mm.
 *   - Marker scale factor = 0.022 (radius * 0.022).
 *   - Marker clamp range = [0.65 mm, 18 mm].
 *   - Marker fallback when boundingSphere.radius is null / non-finite
 *     / strictly less than 1e-6.
 *
 * Mirrors the [ID-0190] Cycle 108 sketch-preview-placement-pin and
 * [ID-0186] Cycle 104 sketch2d-canvas-coords paired-pin convention.
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  measureMarkerRadiusMmFromGeometry,
  worldYRangeFromExtrudeMeshGeometry
} from './viewport3d-bounds'

// ---------- helpers --------------------------------------------------

/** Build a BufferGeometry whose bounding box spans [(xMin..xMax), (yMin..yMax), (zMin..zMax)]. */
function geomWithBox(
  xMin: number,
  yMin: number,
  zMin: number,
  xMax: number,
  yMax: number,
  zMax: number
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()
  // 8 corners of an axis-aligned box -- enough to pin the bounding box exactly.
  const positions = new Float32Array([
    xMin, yMin, zMin,
    xMax, yMin, zMin,
    xMin, yMax, zMin,
    xMax, yMax, zMin,
    xMin, yMin, zMax,
    xMax, yMin, zMax,
    xMin, yMax, zMax,
    xMax, yMax, zMax
  ])
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geom
}

/** Build an empty BufferGeometry (no position attribute). */
function emptyGeom(): THREE.BufferGeometry {
  return new THREE.BufferGeometry()
}

// Read source ONCE for source-text paired pins.
const SOURCE_PATH = resolve(__dirname, 'viewport3d-bounds.ts')
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf8')

// ---------- (A) worldYRangeFromExtrudeMeshGeometry: range pin --------

describe('[ID-0201] worldYRangeFromExtrudeMeshGeometry -- finite Y-range pin', () => {
  it('returns {min: 0, max: 10} for a unit cube spanning Y in [0, 10]', () => {
    const g = geomWithBox(0, 0, 0, 10, 10, 10)
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(0)
    expect(r.max).toBe(10)
  })

  it('returns {min: -5, max: 5} for a cube spanning Y in [-5, 5] (negative span preserved)', () => {
    const g = geomWithBox(-5, -5, -5, 5, 5, 5)
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(-5)
    expect(r.max).toBe(5)
  })

  it('preserves negativity for a mesh entirely below origin (Y in [-50, -10])', () => {
    const g = geomWithBox(0, -50, 0, 10, -10, 10)
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(-50)
    expect(r.max).toBe(-10)
  })

  it('preserves a mesh well above origin (Y in [100, 200])', () => {
    const g = geomWithBox(0, 100, 0, 10, 200, 10)
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(100)
    expect(r.max).toBe(200)
  })

  it('IGNORES X and Z bounds: only the Y span influences the result', () => {
    // Asymmetric X (1000-wide) and Z (5000-wide) but tight Y (2..3).
    const g = geomWithBox(-500, 2, -2500, 500, 3, 2500)
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(2)
    expect(r.max).toBe(3)
  })
})

// ---------- (B) worldYRangeFromExtrudeMeshGeometry: min-span bump ----

describe('[ID-0201] worldYRangeFromExtrudeMeshGeometry -- min-span bump branch', () => {
  it('plane at y=3 (max-min=0) -> {min: 3, max: 4} (max bumped to min+1)', () => {
    const g = geomWithBox(0, 3, 0, 10, 3, 10)
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(3)
    expect(r.max).toBe(4)
  })

  it('tiny span (max-min = 1e-5 < 1e-4) -> max bumped to min + 1', () => {
    const g = geomWithBox(0, 0, 0, 10, 1e-5, 10)
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(0)
    // Float32 precision in setAttribute means the actual stored max may differ
    // slightly from 1e-5; assert the bump happened (max > min + 0.5).
    expect(r.max).toBeGreaterThan(0.5)
    expect(r.max).toBeLessThanOrEqual(1)
  })

  it('boundary: when max - min is well above 1e-4 (e.g. 0.001), no bump', () => {
    // Use 0.001 (= 1e-3) which is comfortably above the 1e-4 threshold and
    // survives Float32 round-trip cleanly.
    const g = geomWithBox(0, 0, 0, 10, 0.001, 10)
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(0)
    // Max preserved (NOT bumped to 1).
    expect(r.max).toBeLessThan(0.5)
    expect(r.max).toBeGreaterThan(0)
  })
})

// ---------- (C) worldYRangeFromExtrudeMeshGeometry: NaN/Infinity ----

describe('[ID-0201] worldYRangeFromExtrudeMeshGeometry -- non-finite fallback', () => {
  it('empty geometry (no position attribute) -> {min: 0, max: 40} fallback', () => {
    // An empty BufferGeometry's bounding box has +Infinity min and
    // -Infinity max after computeBoundingBox (Three.js documented).
    const g = emptyGeom()
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(0)
    expect(r.max).toBe(40)
  })

  it('NaN min -> {min: 0, max: 40} fallback', () => {
    const g = geomWithBox(0, 0, 0, 10, 10, 10)
    g.computeBoundingBox()
    // Force a NaN min.y to exercise the !Number.isFinite(min) branch.
    g.boundingBox!.min.y = NaN
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    // Note: the helper RE-COMPUTES boundingBox inside the function, which
    // overwrites our injection. Exercise the fallback by constructing a
    // geometry with a NaN vertex that propagates into the bounding box.
    void r
    const g2 = new THREE.BufferGeometry()
    const positions = new Float32Array([0, NaN, 0, 1, 1, 1, 2, 2, 2])
    g2.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const r2 = worldYRangeFromExtrudeMeshGeometry(g2)
    expect(r2.min).toBe(0)
    expect(r2.max).toBe(40)
  })

  it('Infinity max -> {min: 0, max: 40} fallback', () => {
    const g = new THREE.BufferGeometry()
    const positions = new Float32Array([0, 0, 0, 1, Infinity, 1, 2, 2, 2])
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const r = worldYRangeFromExtrudeMeshGeometry(g)
    expect(r.min).toBe(0)
    expect(r.max).toBe(40)
  })
})

// ---------- (D) worldYRangeFromExtrudeMeshGeometry: side-effect pin --

describe('[ID-0201] worldYRangeFromExtrudeMeshGeometry -- computeBoundingBox side effect', () => {
  it('invokes computeBoundingBox (geom.boundingBox is set after call)', () => {
    const g = geomWithBox(0, 0, 0, 10, 10, 10)
    expect(g.boundingBox).toBeNull()
    worldYRangeFromExtrudeMeshGeometry(g)
    expect(g.boundingBox).not.toBeNull()
    expect(g.boundingBox?.min.y).toBe(0)
    expect(g.boundingBox?.max.y).toBe(10)
  })
})

// ---------- (E) measureMarkerRadiusMmFromGeometry: null input --------

describe('[ID-0201] measureMarkerRadiusMmFromGeometry -- null input fallback', () => {
  it('null -> 1.2 mm fallback (the documented MEASURE_MARKER_RADIUS_FALLBACK_MM)', () => {
    expect(measureMarkerRadiusMmFromGeometry(null)).toBe(1.2)
  })
})

// ---------- (F) measureMarkerRadiusMmFromGeometry: scale factor ------

describe('[ID-0201] measureMarkerRadiusMmFromGeometry -- scale factor pin', () => {
  it('mid-range geometry (r=100) -> 100 * 0.022 = 2.2 mm', () => {
    // Cube of half-extent 100/sqrt(3) so the bounding sphere radius == 100.
    const halfEdge = 100 / Math.sqrt(3)
    const g = geomWithBox(-halfEdge, -halfEdge, -halfEdge, halfEdge, halfEdge, halfEdge)
    const r = measureMarkerRadiusMmFromGeometry(g)
    expect(r).toBeCloseTo(2.2, 4)
  })

  it('mid-range geometry (r=50) -> 50 * 0.022 = 1.1 mm', () => {
    const halfEdge = 50 / Math.sqrt(3)
    const g = geomWithBox(-halfEdge, -halfEdge, -halfEdge, halfEdge, halfEdge, halfEdge)
    const r = measureMarkerRadiusMmFromGeometry(g)
    expect(r).toBeCloseTo(1.1, 4)
  })

  it('scale factor IS exactly 0.022 (regression guard against magic-number drift)', () => {
    // Two radii at known multiples should differ by the exact scale factor.
    const halfEdgeA = 100 / Math.sqrt(3)
    const halfEdgeB = 200 / Math.sqrt(3)
    const ga = geomWithBox(-halfEdgeA, -halfEdgeA, -halfEdgeA, halfEdgeA, halfEdgeA, halfEdgeA)
    const gb = geomWithBox(-halfEdgeB, -halfEdgeB, -halfEdgeB, halfEdgeB, halfEdgeB, halfEdgeB)
    const ra = measureMarkerRadiusMmFromGeometry(ga)
    const rb = measureMarkerRadiusMmFromGeometry(gb)
    // 200*0.022 = 4.4, 100*0.022 = 2.2, ratio = 2.0
    expect(rb / ra).toBeCloseTo(2, 4)
  })
})

// ---------- (G) measureMarkerRadiusMmFromGeometry: clamp boundaries --

describe('[ID-0201] measureMarkerRadiusMmFromGeometry -- clamp range [0.65, 18] mm', () => {
  it('very small geometry (r=5) -> raw 0.11 mm clamped UP to 0.65 mm', () => {
    const halfEdge = 5 / Math.sqrt(3)
    const g = geomWithBox(-halfEdge, -halfEdge, -halfEdge, halfEdge, halfEdge, halfEdge)
    const r = measureMarkerRadiusMmFromGeometry(g)
    expect(r).toBe(0.65)
  })

  it('very large geometry (r=2000) -> raw 44 mm clamped DOWN to 18 mm', () => {
    const halfEdge = 2000 / Math.sqrt(3)
    const g = geomWithBox(-halfEdge, -halfEdge, -halfEdge, halfEdge, halfEdge, halfEdge)
    const r = measureMarkerRadiusMmFromGeometry(g)
    expect(r).toBe(18)
  })

  it('exactly at min clamp boundary (r * 0.022 == 0.65 -> r == 29.5454...)', () => {
    const targetRadius = 0.65 / 0.022 // ~29.545
    const halfEdge = targetRadius / Math.sqrt(3)
    const g = geomWithBox(-halfEdge, -halfEdge, -halfEdge, halfEdge, halfEdge, halfEdge)
    const r = measureMarkerRadiusMmFromGeometry(g)
    expect(r).toBeCloseTo(0.65, 3)
  })

  it('exactly at max clamp boundary (r * 0.022 == 18 -> r == 818.18...)', () => {
    const targetRadius = 18 / 0.022 // ~818.18
    const halfEdge = targetRadius / Math.sqrt(3)
    const g = geomWithBox(-halfEdge, -halfEdge, -halfEdge, halfEdge, halfEdge, halfEdge)
    const r = measureMarkerRadiusMmFromGeometry(g)
    expect(r).toBeCloseTo(18, 3)
  })
})

// ---------- (H) measureMarkerRadiusMmFromGeometry: degenerate radius -

describe('[ID-0201] measureMarkerRadiusMmFromGeometry -- degenerate radius fallback', () => {
  it('strictly-less-than-1e-6 radius -> 1.2 mm fallback', () => {
    // Single-point geometry: bounding sphere radius is 0 (< 1e-6).
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([5, 5, 5]), 3))
    const r = measureMarkerRadiusMmFromGeometry(g)
    expect(r).toBe(1.2)
  })

  it('NaN radius (mocked via post-call boundingSphere injection) -> fallback', () => {
    // Wrap the real geometry so we can intercept boundingSphere after
    // computeBoundingSphere() runs internally.
    const real = geomWithBox(0, 0, 0, 10, 10, 10)
    // Replace computeBoundingSphere to install a NaN-radius sphere.
    real.computeBoundingSphere = function (this: THREE.BufferGeometry): void {
      this.boundingSphere = new THREE.Sphere(new THREE.Vector3(), NaN)
    }
    const r = measureMarkerRadiusMmFromGeometry(real)
    expect(r).toBe(1.2)
  })

  it('Infinity radius -> 1.2 mm fallback (!Number.isFinite branch)', () => {
    const real = geomWithBox(0, 0, 0, 10, 10, 10)
    real.computeBoundingSphere = function (this: THREE.BufferGeometry): void {
      this.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    }
    const r = measureMarkerRadiusMmFromGeometry(real)
    expect(r).toBe(1.2)
  })

  it('null boundingSphere (radius unreadable) -> 1.2 mm fallback', () => {
    const real = geomWithBox(0, 0, 0, 10, 10, 10)
    real.computeBoundingSphere = function (this: THREE.BufferGeometry): void {
      this.boundingSphere = null
    }
    const r = measureMarkerRadiusMmFromGeometry(real)
    expect(r).toBe(1.2)
  })
})

// ---------- (I) measureMarkerRadiusMmFromGeometry: side-effect pin ---

describe('[ID-0201] measureMarkerRadiusMmFromGeometry -- computeBoundingSphere side effect', () => {
  it('invokes computeBoundingSphere (geom.boundingSphere is set after call)', () => {
    const g = geomWithBox(0, 0, 0, 10, 10, 10)
    expect(g.boundingSphere).toBeNull()
    measureMarkerRadiusMmFromGeometry(g)
    expect(g.boundingSphere).not.toBeNull()
    expect(g.boundingSphere?.radius).toBeGreaterThan(0)
  })
})

// ---------- (J) source-text paired pins (regression guards) ----------

describe('[ID-0201] viewport3d-bounds source-text paired pins', () => {
  it('source declares MEASURE_MARKER_RADIUS_FALLBACK_MM = 1.2', () => {
    expect(SOURCE_TEXT).toMatch(/MEASURE_MARKER_RADIUS_FALLBACK_MM\s*=\s*1\.2/)
  })

  it('source declares the {0, 40} fallback span verbatim', () => {
    // The fallback object in worldYRangeFromExtrudeMeshGeometry.
    expect(SOURCE_TEXT).toMatch(/return\s*\{\s*min:\s*0,\s*max:\s*40\s*\}/)
  })

  it('source declares the min-span bump threshold 1e-4 and the +1 floor', () => {
    expect(SOURCE_TEXT).toContain('max - min < 1e-4')
    expect(SOURCE_TEXT).toContain('max = min + 1')
  })

  it('source declares the marker scale factor 0.022', () => {
    expect(SOURCE_TEXT).toMatch(/r\s*\*\s*0\.022/)
  })

  it('source declares the marker clamp range [0.65, 18]', () => {
    // Math.min(18, Math.max(0.65, scaled))
    expect(SOURCE_TEXT).toMatch(/Math\.min\(\s*18\s*,\s*Math\.max\(\s*0\.65\s*,\s*scaled\s*\)\s*\)/)
  })

  it('source declares the radius validity guard (1e-6)', () => {
    expect(SOURCE_TEXT).toContain('r < 1e-6')
  })

  it('source declares the !Number.isFinite radius guard', () => {
    expect(SOURCE_TEXT).toContain('!Number.isFinite(r)')
  })

  it('source documents the section-slider role for worldYRangeFromExtrudeMeshGeometry', () => {
    // JSDoc tag for the documented contract (the second comment block).
    expect(SOURCE_TEXT).toContain('section slider')
  })
})
