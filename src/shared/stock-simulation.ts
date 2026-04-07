/**
 * Voxel-based stock removal simulation engine.
 *
 * Converts stock into a 3D boolean voxel grid, carves material along G-code
 * toolpath segments, and produces a triangle mesh of the remaining stock for
 * 3D visualization. Also provides gouge detection and cycle time estimation.
 *
 * Design: pure TypeScript with zero React/Three.js dependencies so the engine
 * is fully testable in isolation. The renderer component consumes the mesh output.
 */

import type { ToolpathSegment3 } from './cam-gcode-toolpath'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StockSimulationConfig = {
  /** Stock width in mm (X axis). */
  widthMm: number
  /** Stock height in mm (Y axis). */
  heightMm: number
  /** Stock depth in mm (Z axis). */
  depthMm: number
  /** Voxel cell size in mm. Smaller = higher fidelity, more memory. */
  resolutionMm: number
  /** Origin offset in X (mm). Default 0. */
  originX?: number
  /** Origin offset in Y (mm). Default 0. */
  originY?: number
  /** Origin offset in Z (mm). Default 0 = stock top. */
  originZ?: number
}

export type GougeFinding = {
  /** X position of gouge (mm). */
  x: number
  /** Y position of gouge (mm). */
  y: number
  /** Z position of gouge (mm). */
  z: number
  /** How far below the intended minimum surface the tool went (mm, positive). */
  depthMm: number
  /** Index of the toolpath segment that caused the gouge. */
  segmentIndex: number
}

export type StockSimulationStats = {
  /** Fraction of original stock material removed (0..1). */
  materialRemovedFraction: number
  /** Estimated machining cycle time in seconds (from feed lengths and rates). */
  estimatedCycleTimeSeconds: number
  /** Total number of voxels in the grid. */
  voxelCount: number
  /** Number of voxels that were carved away. */
  carvedCount: number
  /** Number of voxels remaining as solid stock. */
  remainingCount: number
}

export type StockMeshData = {
  /** Flat Float32Array of triangle vertex positions (x, y, z, x, y, z, ...). */
  positions: Float32Array
  /** Flat Float32Array of per-vertex normals. */
  normals: Float32Array
  /** Number of triangles. */
  triangleCount: number
}

export type StockSimulationProgressMesh = {
  /** Mesh of remaining stock at this progress point. */
  mesh: StockMeshData
  /** Gouge zones detected up to this progress point. */
  gouges: GougeFinding[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function idx3(i: number, j: number, k: number, cols: number, rows: number): number {
  return k * cols * rows + j * cols + i
}

// ---------------------------------------------------------------------------
// StockSimulator
// ---------------------------------------------------------------------------

/**
 * Voxel-based stock removal simulator.
 *
 * Usage:
 *   1. `initializeStock(...)` — create the voxel grid
 *   2. `applyToolpath(...)` — carve material (optionally up to a progress fraction)
 *   3. `getRemovalMesh()` — get triangle mesh of remaining stock
 *   4. `getStats()` — retrieve summary statistics
 */
export class StockSimulator {
  private cols = 0
  private rows = 0
  private layers = 0
  private cellMm = 1
  private originX = 0
  private originY = 0
  private originZ = 0 // top of stock in world Z
  private grid: Uint8Array = new Uint8Array(0)
  private initialSolidCount = 0
  private carvedCount = 0
  private cycleTimeSeconds = 0
  private gouges: GougeFinding[] = []
  private _initialized = false

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /**
   * Create the 3D voxel grid representing solid stock.
   *
   * The stock block spans:
   *   X: [originX, originX + width]
   *   Y: [originY, originY + height]
   *   Z: [originZ - depth, originZ]      (Z=originZ is the top surface)
   */
  initializeStock(config: StockSimulationConfig): void {
    const { widthMm, heightMm, depthMm, resolutionMm } = config
    if (widthMm <= 0 || heightMm <= 0 || depthMm <= 0 || resolutionMm <= 0) {
      throw new Error(
        `Invalid stock dimensions: width=${widthMm}, height=${heightMm}, depth=${depthMm}, resolution=${resolutionMm}`
      )
    }
    this.cellMm = resolutionMm
    this.originX = config.originX ?? 0
    this.originY = config.originY ?? 0
    this.originZ = config.originZ ?? 0

    this.cols = Math.max(1, Math.ceil(widthMm / resolutionMm))
    this.rows = Math.max(1, Math.ceil(heightMm / resolutionMm))
    this.layers = Math.max(1, Math.ceil(depthMm / resolutionMm))

    const total = this.cols * this.rows * this.layers
    // Safety limit: 16M voxels (~16 MB) to prevent runaway memory
    if (total > 16_000_000) {
      throw new Error(
        `Voxel grid too large: ${this.cols}x${this.rows}x${this.layers} = ${total} voxels (max 16M). Increase resolutionMm.`
      )
    }

    this.grid = new Uint8Array(total)
    this.grid.fill(1) // all solid
    this.initialSolidCount = total
    this.carvedCount = 0
    this.cycleTimeSeconds = 0
    this.gouges = []
    this._initialized = true
  }

  /** Whether `initializeStock` has been called. */
  get initialized(): boolean {
    return this._initialized
  }

  /** Grid dimensions for inspection/tests. */
  get dimensions(): { cols: number; rows: number; layers: number; cellMm: number } {
    return { cols: this.cols, rows: this.rows, layers: this.layers, cellMm: this.cellMm }
  }

  // -------------------------------------------------------------------------
  // Toolpath application
  // -------------------------------------------------------------------------

  /**
   * Apply a toolpath to the stock, carving voxels within the tool envelope.
   *
   * @param segments  Parsed G-code line segments (from `cam-gcode-toolpath.ts`).
   * @param toolDiameter  Tool diameter in mm.
   * @param options  Optional: `toolShape`, `progressFraction`, `gougeFloorZ`.
   */
  applyToolpath(
    segments: ReadonlyArray<ToolpathSegment3>,
    toolDiameter: number,
    options?: {
      /** Tool shape: 'flat' (cylinder) or 'ball' (hemisphere). Default 'flat'. */
      toolShape?: 'flat' | 'ball'
      /**
       * Apply only the first N% of the toolpath (0..1). Used for scrubbing.
       * Default 1.0 (entire path).
       */
      progressFraction?: number
      /**
       * Intended minimum Z surface (mm). Any tool position below this triggers
       * a gouge finding. Default: no gouge detection.
       */
      gougeFloorZ?: number
    }
  ): void {
    if (!this._initialized) {
      throw new Error('StockSimulator: call initializeStock() before applyToolpath()')
    }
    const toolR = Math.max(0.01, toolDiameter / 2)
    const shape = options?.toolShape ?? 'flat'
    const progress = clamp(options?.progressFraction ?? 1, 0, 1)
    const gougeFloor = options?.gougeFloorZ

    // Determine how many segments to process based on progress
    const segCount = Math.max(0, Math.round(segments.length * progress))
    const toProcess = segments.slice(0, segCount)

    // Reset state before each application (allows re-running at different progress)
    this.grid.fill(1)
    this.carvedCount = 0
    this.cycleTimeSeconds = 0
    this.gouges = []

    let totalFeedLengthMm = 0

    for (let si = 0; si < toProcess.length; si++) {
      const s = toProcess[si]!

      // Cycle time: accumulate feed move lengths (rapids are assumed instantaneous for estimation)
      if (s.kind === 'feed') {
        const segLen = Math.hypot(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0)
        totalFeedLengthMm += segLen
      }

      // Gouge detection
      if (gougeFloor != null) {
        const minSegZ = Math.min(s.z0, s.z1)
        if (minSegZ < gougeFloor - 1e-6) {
          const midX = (s.x0 + s.x1) / 2
          const midY = (s.y0 + s.y1) / 2
          this.gouges.push({
            x: midX,
            y: midY,
            z: minSegZ,
            depthMm: gougeFloor - minSegZ,
            segmentIndex: si
          })
        }
      }

      // Carve voxels along the segment
      this.carveSegment(s, toolR, shape)
    }

    // Estimate cycle time: assume average feed rate of 500 mm/min as default.
    // Real feed rates would come from F-words in G-code; this is a reasonable estimate.
    const avgFeedMmPerMin = 500
    this.cycleTimeSeconds = (totalFeedLengthMm / avgFeedMmPerMin) * 60
  }

  /**
   * Stamp-carve a single toolpath segment through the voxel grid.
   */
  private carveSegment(
    seg: ToolpathSegment3,
    toolR: number,
    shape: 'flat' | 'ball'
  ): void {
    const len = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0, seg.z1 - seg.z0)
    const step = Math.max(this.cellMm * 0.4, 0.05)
    const nSteps = Math.max(1, Math.ceil(len / step))

    for (let t = 0; t <= nSteps; t++) {
      const u = t / nSteps
      const cx = seg.x0 + u * (seg.x1 - seg.x0)
      const cy = seg.y0 + u * (seg.y1 - seg.y0)
      const cz = seg.z0 + u * (seg.z1 - seg.z0)
      this.stampTool(cx, cy, cz, toolR, shape)
    }
  }

  /**
   * Stamp the tool shape at a single position, carving intersecting voxels.
   */
  private stampTool(
    cx: number,
    cy: number,
    cz: number,
    toolR: number,
    shape: 'flat' | 'ball'
  ): void {
    const rCells = Math.ceil((toolR + this.cellMm * 0.5) / this.cellMm) + 1

    // Map tool center to grid indices
    const ic = Math.floor((cx - this.originX) / this.cellMm)
    const jc = Math.floor((cy - this.originY) / this.cellMm)
    // Z is inverted: originZ is top, grid layer 0 is bottom (originZ - depth)
    const stockBottom = this.originZ - this.layers * this.cellMm
    const kc = Math.floor((cz - stockBottom) / this.cellMm)

    for (let dk = -rCells; dk <= rCells; dk++) {
      for (let dj = -rCells; dj <= rCells; dj++) {
        for (let di = -rCells; di <= rCells; di++) {
          const i = ic + di
          const j = jc + dj
          const k = kc + dk
          if (i < 0 || j < 0 || k < 0 || i >= this.cols || j >= this.rows || k >= this.layers) continue

          const vx = this.originX + (i + 0.5) * this.cellMm
          const vy = this.originY + (j + 0.5) * this.cellMm
          const vz = stockBottom + (k + 0.5) * this.cellMm

          // Check if this voxel is within the tool envelope
          const inTool =
            shape === 'ball'
              ? Math.hypot(vx - cx, vy - cy, vz - cz) <= toolR + 1e-6
              : Math.hypot(vx - cx, vy - cy) <= toolR + 1e-6 && vz <= cz + 1e-6

          if (!inTool) continue

          const index = idx3(i, j, k, this.cols, this.rows)
          if (this.grid[index]) {
            this.grid[index] = 0
            this.carvedCount++
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Mesh generation (simple box faces)
  // -------------------------------------------------------------------------

  /**
   * Generate a triangle mesh of the remaining (solid) voxels.
   *
   * Uses simple box-face emission: for each solid voxel, emit a face only on
   * sides that are exposed (neighbor is empty or at grid boundary). This is
   * simpler than marching cubes but produces an accurate blocky mesh suitable
   * for translucent overlay rendering.
   */
  getRemovalMesh(): StockMeshData {
    if (!this._initialized) {
      return { positions: new Float32Array(0), normals: new Float32Array(0), triangleCount: 0 }
    }

    const stockBottom = this.originZ - this.layers * this.cellMm
    const halfCell = this.cellMm * 0.5

    // Pre-count exposed faces for buffer allocation
    let faceCount = 0
    for (let k = 0; k < this.layers; k++) {
      for (let j = 0; j < this.rows; j++) {
        for (let i = 0; i < this.cols; i++) {
          if (!this.grid[idx3(i, j, k, this.cols, this.rows)]) continue
          // Check 6 neighbors
          if (i === 0 || !this.grid[idx3(i - 1, j, k, this.cols, this.rows)]) faceCount++
          if (i === this.cols - 1 || !this.grid[idx3(i + 1, j, k, this.cols, this.rows)]) faceCount++
          if (j === 0 || !this.grid[idx3(i, j - 1, k, this.cols, this.rows)]) faceCount++
          if (j === this.rows - 1 || !this.grid[idx3(i, j + 1, k, this.cols, this.rows)]) faceCount++
          if (k === 0 || !this.grid[idx3(i, j, k - 1, this.cols, this.rows)]) faceCount++
          if (k === this.layers - 1 || !this.grid[idx3(i, j, k + 1, this.cols, this.rows)]) faceCount++
        }
      }
    }

    const triCount = faceCount * 2 // 2 triangles per quad face
    const positions = new Float32Array(triCount * 3 * 3) // 3 verts × 3 floats
    const normals = new Float32Array(triCount * 3 * 3)
    let offset = 0

    const emitQuad = (
      x0: number, y0: number, z0: number,
      x1: number, y1: number, z1: number,
      x2: number, y2: number, z2: number,
      x3: number, y3: number, z3: number,
      nx: number, ny: number, nz: number
    ): void => {
      // Triangle 1: v0, v1, v2
      positions[offset] = x0; normals[offset++] = nx
      positions[offset] = y0; normals[offset++] = ny
      positions[offset] = z0; normals[offset++] = nz
      positions[offset] = x1; normals[offset++] = nx
      positions[offset] = y1; normals[offset++] = ny
      positions[offset] = z1; normals[offset++] = nz
      positions[offset] = x2; normals[offset++] = nx
      positions[offset] = y2; normals[offset++] = ny
      positions[offset] = z2; normals[offset++] = nz
      // Triangle 2: v0, v2, v3
      positions[offset] = x0; normals[offset++] = nx
      positions[offset] = y0; normals[offset++] = ny
      positions[offset] = z0; normals[offset++] = nz
      positions[offset] = x2; normals[offset++] = nx
      positions[offset] = y2; normals[offset++] = ny
      positions[offset] = z2; normals[offset++] = nz
      positions[offset] = x3; normals[offset++] = nx
      positions[offset] = y3; normals[offset++] = ny
      positions[offset] = z3; normals[offset++] = nz
    }

    for (let k = 0; k < this.layers; k++) {
      for (let j = 0; j < this.rows; j++) {
        for (let i = 0; i < this.cols; i++) {
          if (!this.grid[idx3(i, j, k, this.cols, this.rows)]) continue

          const cx = this.originX + (i + 0.5) * this.cellMm
          const cy = this.originY + (j + 0.5) * this.cellMm
          const cz = stockBottom + (k + 0.5) * this.cellMm
          const x0 = cx - halfCell, x1 = cx + halfCell
          const y0 = cy - halfCell, y1 = cy + halfCell
          const z0 = cz - halfCell, z1 = cz + halfCell

          // -X face
          if (i === 0 || !this.grid[idx3(i - 1, j, k, this.cols, this.rows)]) {
            emitQuad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, -1, 0, 0)
          }
          // +X face
          if (i === this.cols - 1 || !this.grid[idx3(i + 1, j, k, this.cols, this.rows)]) {
            emitQuad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, 1, 0, 0)
          }
          // -Y face
          if (j === 0 || !this.grid[idx3(i, j - 1, k, this.cols, this.rows)]) {
            emitQuad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1, 0, -1, 0)
          }
          // +Y face
          if (j === this.rows - 1 || !this.grid[idx3(i, j + 1, k, this.cols, this.rows)]) {
            emitQuad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, 0, 1, 0)
          }
          // -Z face
          if (k === 0 || !this.grid[idx3(i, j, k - 1, this.cols, this.rows)]) {
            emitQuad(x0, y0, z0, x0, y1, z0, x1, y1, z0, x1, y0, z0, 0, 0, -1)
          }
          // +Z face
          if (k === this.layers - 1 || !this.grid[idx3(i, j, k + 1, this.cols, this.rows)]) {
            emitQuad(x1, y0, z1, x1, y1, z1, x0, y1, z1, x0, y0, z1, 0, 0, 1)
          }
        }
      }
    }

    return { positions, normals, triangleCount: triCount }
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  getStats(): StockSimulationStats {
    const remaining = this.initialSolidCount - this.carvedCount
    return {
      materialRemovedFraction:
        this.initialSolidCount > 0 ? this.carvedCount / this.initialSolidCount : 0,
      estimatedCycleTimeSeconds: this.cycleTimeSeconds,
      voxelCount: this.initialSolidCount,
      carvedCount: this.carvedCount,
      remainingCount: remaining
    }
  }

  /** Gouge findings from the last `applyToolpath` call. */
  getGouges(): ReadonlyArray<GougeFinding> {
    return this.gouges
  }

  // -------------------------------------------------------------------------
  // Snapshot for progress scrubbing
  // -------------------------------------------------------------------------

  /**
   * Convenience: re-apply toolpath at a specific progress fraction and return
   * the mesh + gouges at that point. Useful for scrubbing UI.
   */
  getProgressSnapshot(
    segments: ReadonlyArray<ToolpathSegment3>,
    toolDiameter: number,
    progressFraction: number,
    options?: { toolShape?: 'flat' | 'ball'; gougeFloorZ?: number }
  ): StockSimulationProgressMesh {
    this.applyToolpath(segments, toolDiameter, {
      ...options,
      progressFraction
    })
    return {
      mesh: this.getRemovalMesh(),
      gouges: [...this.gouges]
    }
  }
}
