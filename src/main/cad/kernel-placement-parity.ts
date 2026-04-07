import type { StlBounds } from '../stl'

export type PlacementParity = {
  parity: 'ok' | 'mismatch'
  detail: string
  maxDeltaMm: number
}

function extent(b: StlBounds): [number, number, number] {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]]
}

function center(b: StlBounds): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
}

/**
 * Compare placed preview STL vs kernel STL using AABB extents + centers.
 * This is lightweight parity (orientation/translation smoke test), not topology identity.
 */
export function comparePlacementParityFromBounds(
  preview: StlBounds,
  kernel: StlBounds,
  toleranceMm = 0.2
): PlacementParity {
  const pe = extent(preview)
  const ke = extent(kernel)
  const pc = center(preview)
  const kc = center(kernel)
  const diffs = [
    Math.abs(pe[0] - ke[0]),
    Math.abs(pe[1] - ke[1]),
    Math.abs(pe[2] - ke[2]),
    Math.abs(pc[0] - kc[0]),
    Math.abs(pc[1] - kc[1]),
    Math.abs(pc[2] - kc[2])
  ]
  const maxDeltaMm = diffs.reduce((m, d) => Math.max(m, d), 0)
  if (maxDeltaMm <= toleranceMm) {
    return { parity: 'ok', detail: `max delta ${maxDeltaMm.toFixed(3)} mm`, maxDeltaMm }
  }
  return {
    parity: 'mismatch',
    detail: `max delta ${maxDeltaMm.toFixed(3)} mm (tol ${toleranceMm.toFixed(3)} mm)`,
    maxDeltaMm
  }
}

