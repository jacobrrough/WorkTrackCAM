/**
 * Pure coordinate helpers for the 2D sketch canvas (world ↔ screen, snapping, hit-test geometry).
 * Shared by `Sketch2DCanvas` render and pointer handlers.
 */

export function screenToWorld(
  sx: number,
  sy: number,
  w: number,
  h: number,
  scale: number,
  ox: number,
  oy: number
): [number, number] {
  const cx = w / 2
  const cy = h / 2
  const wx = (sx - cx) / scale + ox
  const wy = -(sy - cy) / scale + oy
  return [wx, wy]
}

/**
 * Map viewport coordinates to canvas bitmap space. Required when CSS layout size ≠ canvas.width/height
 * (flex stretch, high-DPR, or toolbars shrinking the drawable area vs parent-measured dimensions).
 *
 * Defense-in-depth: when the canvas's bitmap size (`canvas.width`/`canvas.height`) differs from its
 * displayed CSS size (`rect.width`/`rect.height`) — the exact case that made the cursor stop lining up
 * with the grid when an 800×600 bitmap was CSS-stretched to fill the cockpit pane — the raw
 * `clientX - rect.left` offset is in CSS pixels and must be rescaled into bitmap pixels by
 * `canvas.width / rect.width` (and likewise for Y). The scale is only applied when both dimensions are
 * finite, positive, and actually differ, so a 1:1 canvas (and the unit-test fakes that expose no
 * `.width`/`.height`) pass straight through unchanged.
 */
export function clientToCanvasLocal(clientX: number, clientY: number, canvas: HTMLCanvasElement): [number, number] {
  const rect = canvas.getBoundingClientRect()
  const offX = clientX - rect.left
  const offY = clientY - rect.top
  const bw = canvas.width
  const bh = canvas.height
  const rw = rect.width
  const rh = rect.height
  const sx =
    Number.isFinite(bw) && bw > 0 && Number.isFinite(rw) && rw > 0 && bw !== rw ? bw / rw : 1
  const sy =
    Number.isFinite(bh) && bh > 0 && Number.isFinite(rh) && rh > 0 && bh !== rh ? bh / rh : 1
  return [offX * sx, offY * sy]
}

export function snap(v: number, step: number): number {
  if (step <= 0) return v
  return Math.round(v / step) * step
}

export function niceStepMm(stepMm: number): number {
  if (!(stepMm > 0) || !Number.isFinite(stepMm)) return 1
  const p = Math.pow(10, Math.floor(Math.log10(stepMm)))
  const n = stepMm / p
  const base = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return base * p
}

/** Squared distance from P to segment AB (clamped). */
export function distSqPointSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const ab2 = abx * abx + aby * aby
  if (ab2 < 1e-18) return apx * apx + apy * apy
  let t = (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))
  const qx = ax + t * abx
  const qy = ay + t * aby
  const dx = px - qx
  const dy = py - qy
  return dx * dx + dy * dy
}
