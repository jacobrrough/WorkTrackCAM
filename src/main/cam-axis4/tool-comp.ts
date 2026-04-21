/**
 * Tool radius compensation for the cylindrical heightmap.
 *
 * For each (X, A) cell, find the MAXIMUM radial distance within the tool's
 * footprint (a kernel that scales with toolRadius / dx and toolRadius / arc-step).
 * The compensated value is the highest point any part of the tool would touch
 * if its center were at this cell — preventing the tool from gouging adjacent
 * higher features.
 */
import { NO_HIT, type CylindricalHeightmap } from './heightmap'

/**
 * Compute the max-envelope tool-radius compensation of a heightmap.
 * Returns a Float32Array of the same shape as `hm.radii`.
 *
 * `stockRadius` is needed to convert angular cell distance to mm: at the OD,
 * one degree corresponds to `(π/180) × stockRadius` mm of arc.
 */
export function applyToolRadiusCompensation(
  hm: CylindricalHeightmap,
  toolRadius: number,
  stockRadius: number
): Float32Array {
  const nx = hm.nx
  const na = hm.na
  const dxMm = hm.dx
  const daDeg = hm.daDeg
  const radii = hm.radii
  const compensated = new Float32Array(nx * na).fill(NO_HIT)
  const kernelIx = Math.max(1, Math.ceil(toolRadius / Math.max(0.01, dxMm)))
  const angularSpanDeg = (toolRadius / Math.max(0.01, stockRadius)) * (180 / Math.PI)
  const kernelIa = Math.max(1, Math.ceil(angularSpanDeg / daDeg))

  // Work in squared distance to skip Math.hypot in the hot inner loop.
  const toolR2 = toolRadius * toolRadius
  const arcMmPerCell = daDeg * (Math.PI / 180) * stockRadius

  for (let ix = 0; ix < nx; ix++) {
    for (let ia = 0; ia < na; ia++) {
      let maxR = NO_HIT
      let hasAnyHit = false

      for (let dix = -kernelIx; dix <= kernelIx; dix++) {
        const nix = ix + dix
        if (nix < 0 || nix >= nx) continue
        const distX = dix * dxMm
        const distX2 = distX * distX
        const rowBase = nix * na

        for (let dia = -kernelIa; dia <= kernelIa; dia++) {
          const distA = dia * arcMmPerCell
          if (distX2 + distA * distA > toolR2) continue

          let nia = ia + dia
          if (nia < 0) nia += na
          else if (nia >= na) nia -= na

          const r = radii[rowBase + nia]!
          if (r > 0) {
            hasAnyHit = true
            if (r > maxR) maxR = r
          }
        }
      }

      if (hasAnyHit) {
        compensated[ix * na + ia] = maxR
      }
    }
  }

  return compensated
}
