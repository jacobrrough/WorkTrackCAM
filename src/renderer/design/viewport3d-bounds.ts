import * as THREE from 'three'

/**
 * Preview mesh vertices are already in world mm (`sketchPreviewPlacementMatrix` in `DesignSessionContext`).
 * Returns world-Y span for the section slider.
 */
export function worldYRangeFromExtrudeMeshGeometry(geom: THREE.BufferGeometry): { min: number; max: number } {
  geom.computeBoundingBox()
  const b = geom.boundingBox!
  let min = b.min.y
  let max = b.max.y
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 40 }
  }
  if (max - min < 1e-4) {
    max = min + 1
  }
  return { min, max }
}

const MEASURE_MARKER_RADIUS_FALLBACK_MM = 1.2

/** World-space sphere radius (mm) for measure markers, scaled to preview mesh size (fits `Bounds`-style framing). */
export function measureMarkerRadiusMmFromGeometry(geom: THREE.BufferGeometry | null): number {
  if (!geom) return MEASURE_MARKER_RADIUS_FALLBACK_MM
  geom.computeBoundingSphere()
  const r = geom.boundingSphere?.radius
  if (r == null || !Number.isFinite(r) || r < 1e-6) return MEASURE_MARKER_RADIUS_FALLBACK_MM
  const scaled = r * 0.022
  return Math.min(18, Math.max(0.65, scaled))
}
