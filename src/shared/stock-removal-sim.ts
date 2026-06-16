/**
 * stock-removal-sim — pure, deterministic stock-removal simulation for the CAM
 * "Simulate" workflow stage.
 *
 * Given posted G-code text and a rectangular stock box, this module parses the
 * toolpath, carves a voxel grid with the existing {@link StockSimulator} engine,
 * and returns a compact, renderable summary: removal statistics plus a top-down
 * remaining-stock height grid (a 2.5D heatmap). The renderer draws the heatmap
 * with a flat <canvas> — no Three.js, no GL context — so this is the cheap
 * "simulate before you cut" preview that complements the heavier 3D voxel panel.
 *
 * STRICT scope (CLAUDE.md):
 *   - Safety Rule 1: pure READ of posted G-code. Nothing here emits, re-posts,
 *     or mutates a toolpath. The same code serves all three shop machines
 *     (Laguna Swift 5x10, Makera Carvera 3/4-axis) equally — it is geometry-only.
 *   - VOXEL APPROXIMATION: this is a boolean-voxel sweep of the tool envelope.
 *     It carries no cutter-shape fidelity beyond flat/ball, models no undercuts,
 *     and is NOT a substitute for verifying G-code on the controller.
 *   - No DOM, no Three.js, no React — fully unit-testable in isolation.
 */

import { extractToolpathSegmentsFromGcode } from './cam-gcode-toolpath'
import {
  StockSimulator,
  type StockHeightGrid,
  type StockSimulationStats
} from './stock-simulation'

/** Rectangular stock box in mm (matches `setup.stock` box dimensions). */
export type StockRemovalBox = {
  /** Stock length along X (mm). */
  x: number
  /** Stock width along Y (mm). */
  y: number
  /** Stock height along Z (mm). */
  z: number
}

/** Tunable knobs for {@link simulateStockRemovalFromGcode}. */
export type StockRemovalSimOptions = {
  /** Cutting-tool diameter (mm). Defaults to {@link DEFAULT_TOOL_DIAMETER_MM}. */
  toolDiameterMm?: number
  /** Tool shape — `'flat'` (cylinder) or `'ball'` (hemisphere). Default `'flat'`. */
  toolShape?: 'flat' | 'ball'
  /**
   * Voxel cell size (mm). Smaller = sharper heatmap but more memory/CPU. When
   * omitted the resolution is auto-chosen from the stock footprint so the grid
   * stays well inside the engine's voxel ceiling (see {@link resolveResolutionMm}).
   */
  resolutionMm?: number
}

/**
 * Why a simulation produced no carved result. Lets the renderer show a precise
 * empty/skipped reason instead of a generic blank panel.
 */
export type StockRemovalSkipReason =
  | 'no-toolpath' // G-code contained no parseable G0/G1/G2/G3 motion
  | 'invalid-stock' // stock box had a non-positive / non-finite dimension

/** Discriminated result of a stock-removal simulation. */
export type StockRemovalSimResult =
  | {
      ok: true
      /** Removal statistics from the voxel engine. */
      stats: StockSimulationStats
      /** Top-down remaining-stock height field for the flat heatmap. */
      heightGrid: StockHeightGrid
      /** Number of parsed toolpath segments (G0/G1 + interpolated arcs). */
      segmentCount: number
      /** Voxel cell size actually used (mm) — useful for labelling the preview. */
      resolutionMm: number
      /** Tool diameter actually used (mm). */
      toolDiameterMm: number
    }
  | {
      ok: false
      reason: StockRemovalSkipReason
    }

/** Default cutter diameter when the caller cannot resolve one (mm). */
export const DEFAULT_TOOL_DIAMETER_MM = 6

/**
 * Voxel budget for the auto-resolution heuristic. Deliberately well below the
 * engine's hard 16M ceiling so a coarse default never throws and leaves CPU
 * headroom for the synchronous renderer path.
 */
const TARGET_VOXEL_BUDGET = 1_500_000

/** Never go finer than this — keeps tiny parts from exploding the grid. */
const MIN_RESOLUTION_MM = 0.5

/** Never go coarser than this — keeps the heatmap legible on big sheets. */
const MAX_RESOLUTION_MM = 8

function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/**
 * Choose a voxel cell size so the grid lands near {@link TARGET_VOXEL_BUDGET},
 * clamped to [{@link MIN_RESOLUTION_MM}, {@link MAX_RESOLUTION_MM}]. Deterministic
 * for a given stock box. Exported for unit coverage.
 */
export function resolveResolutionMm(stock: StockRemovalBox): number {
  const volume = stock.x * stock.y * stock.z
  if (!isPositiveFinite(volume)) return MAX_RESOLUTION_MM
  // cells ≈ volume / cell^3  →  cell ≈ cbrt(volume / budget)
  const ideal = Math.cbrt(volume / TARGET_VOXEL_BUDGET)
  if (!Number.isFinite(ideal) || ideal <= 0) return MIN_RESOLUTION_MM
  return Math.min(MAX_RESOLUTION_MM, Math.max(MIN_RESOLUTION_MM, ideal))
}

/**
 * Run a voxel stock-removal simulation for posted G-code against a stock box.
 *
 * Pure + deterministic: identical inputs always yield identical output. Carves
 * where the tool passed (feed AND rapids — the tool is physically present on
 * both) and leaves stock everywhere else.
 *
 * The stock is positioned in the standard mill WCS the posts emit: the box
 * spans X:[0,x], Y:[0,y], with Z=0 at the TOP and cuts going negative — exactly
 * the {@link StockSimulator} default origin. This matches `extractToolpath…`'s
 * coordinate space so a posted toolpath lines up with the stock without any
 * caller-side offset.
 */
export function simulateStockRemovalFromGcode(
  gcode: string,
  stock: StockRemovalBox,
  options?: StockRemovalSimOptions
): StockRemovalSimResult {
  if (
    !isPositiveFinite(stock.x) ||
    !isPositiveFinite(stock.y) ||
    !isPositiveFinite(stock.z)
  ) {
    return { ok: false, reason: 'invalid-stock' }
  }

  const segments = extractToolpathSegmentsFromGcode(gcode)
  if (segments.length === 0) {
    return { ok: false, reason: 'no-toolpath' }
  }

  const resolutionMm = options?.resolutionMm ?? resolveResolutionMm(stock)
  const toolDiameterMm =
    options?.toolDiameterMm != null && isPositiveFinite(options.toolDiameterMm)
      ? options.toolDiameterMm
      : DEFAULT_TOOL_DIAMETER_MM
  const toolShape = options?.toolShape ?? 'flat'

  const sim = new StockSimulator()
  // originZ defaults to 0 (stock top); box spans Z:[-z, 0] — matches posted WCS.
  sim.initializeStock({
    widthMm: stock.x,
    heightMm: stock.y,
    depthMm: stock.z,
    resolutionMm
  })
  sim.applyToolpath(segments, toolDiameterMm, { toolShape })

  return {
    ok: true,
    stats: sim.getStats(),
    heightGrid: sim.getColumnHeightGrid(),
    segmentCount: segments.length,
    resolutionMm,
    toolDiameterMm
  }
}

/**
 * Format the material-removed fraction as a whole-number percent string
 * (e.g. `0.4213 → "42%"`). Small convenience for the Simulate stat row.
 */
export function formatRemovedPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return '0%'
  const clamped = Math.min(1, Math.max(0, fraction))
  return `${Math.round(clamped * 100)}%`
}
