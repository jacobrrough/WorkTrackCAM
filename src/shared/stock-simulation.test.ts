import { describe, expect, it } from 'vitest'
import type { ToolpathSegment3 } from './cam-gcode-toolpath'
import { StockSimulator } from './stock-simulation'

describe('StockSimulator', () => {
  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  describe('initializeStock', () => {
    it('creates a grid with correct dimensions', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 10, heightMm: 10, depthMm: 5, resolutionMm: 1 })
      expect(sim.initialized).toBe(true)
      const d = sim.dimensions
      expect(d.cols).toBe(10)
      expect(d.rows).toBe(10)
      expect(d.layers).toBe(5)
      expect(d.cellMm).toBe(1)
    })

    it('rounds up fractional voxel counts', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 10.5, heightMm: 7.3, depthMm: 3.1, resolutionMm: 2 })
      const d = sim.dimensions
      expect(d.cols).toBe(6) // ceil(10.5/2) = 6
      expect(d.rows).toBe(4) // ceil(7.3/2) = 4
      expect(d.layers).toBe(2) // ceil(3.1/2) = 2
    })

    it('throws on zero or negative dimensions', () => {
      const sim = new StockSimulator()
      expect(() => sim.initializeStock({ widthMm: 0, heightMm: 10, depthMm: 5, resolutionMm: 1 })).toThrow()
      expect(() => sim.initializeStock({ widthMm: 10, heightMm: -1, depthMm: 5, resolutionMm: 1 })).toThrow()
      expect(() => sim.initializeStock({ widthMm: 10, heightMm: 10, depthMm: 0, resolutionMm: 1 })).toThrow()
      expect(() => sim.initializeStock({ widthMm: 10, heightMm: 10, depthMm: 5, resolutionMm: 0 })).toThrow()
    })

    it('throws when voxel grid exceeds 16M cells', () => {
      const sim = new StockSimulator()
      // 300^3 = 27M > 16M
      expect(() => sim.initializeStock({ widthMm: 300, heightMm: 300, depthMm: 300, resolutionMm: 1 })).toThrow(
        /too large/i
      )
    })

    it('starts fully solid (all voxels = 1)', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 4, heightMm: 4, depthMm: 4, resolutionMm: 2 })
      const stats = sim.getStats()
      expect(stats.voxelCount).toBe(8) // 2x2x2
      expect(stats.remainingCount).toBe(8)
      expect(stats.carvedCount).toBe(0)
      expect(stats.materialRemovedFraction).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Toolpath application — straight line cut
  // -----------------------------------------------------------------------

  describe('applyToolpath — straight cut', () => {
    it('removes material along a horizontal feed move', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 20, heightMm: 20, depthMm: 10, resolutionMm: 2 })
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 0, y0: 10, z0: -2, x1: 20, y1: 10, z1: -2 }
      ]
      sim.applyToolpath(segs, 6) // 3mm radius
      const stats = sim.getStats()
      expect(stats.carvedCount).toBeGreaterThan(0)
      expect(stats.materialRemovedFraction).toBeGreaterThan(0)
      expect(stats.materialRemovedFraction).toBeLessThan(1)
    })

    it('material removed increases with larger tool diameter', () => {
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 2, y0: 5, z0: -3, x1: 18, y1: 5, z1: -3 }
      ]
      const config = { widthMm: 20, heightMm: 10, depthMm: 10, resolutionMm: 1 }

      const simSmall = new StockSimulator()
      simSmall.initializeStock(config)
      simSmall.applyToolpath(segs, 2)

      const simLarge = new StockSimulator()
      simLarge.initializeStock(config)
      simLarge.applyToolpath(segs, 6)

      expect(simLarge.getStats().carvedCount).toBeGreaterThan(simSmall.getStats().carvedCount)
    })

    it('rapids do not affect voxel carving (tool still carves)', () => {
      // Note: rapids still carve — the tool is still in contact. The difference
      // is in cycle time estimation (rapids are not counted as feed time).
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 20, heightMm: 10, depthMm: 10, resolutionMm: 2 })
      const segs: ToolpathSegment3[] = [
        { kind: 'rapid', x0: 0, y0: 5, z0: -2, x1: 20, y1: 5, z1: -2 }
      ]
      sim.applyToolpath(segs, 4)
      // Rapids carve too (the tool physically passes through stock)
      expect(sim.getStats().carvedCount).toBeGreaterThan(0)
    })
  })

  // -----------------------------------------------------------------------
  // Gouge detection
  // -----------------------------------------------------------------------

  describe('gouge detection', () => {
    it('detects gouge when tool goes below floor Z', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 20, heightMm: 20, depthMm: 20, resolutionMm: 2 })
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 5, y0: 10, z0: -5, x1: 15, y1: 10, z1: -5 },
        { kind: 'feed', x0: 5, y0: 10, z0: -15, x1: 15, y1: 10, z1: -15 } // way too deep
      ]
      sim.applyToolpath(segs, 4, { gougeFloorZ: -10 })
      const gouges = sim.getGouges()
      expect(gouges.length).toBe(1) // only the second segment gouges
      expect(gouges[0]!.depthMm).toBeGreaterThan(0)
      expect(gouges[0]!.z).toBe(-15)
      expect(gouges[0]!.segmentIndex).toBe(1)
    })

    it('no gouges when all cuts are above floor', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 20, heightMm: 20, depthMm: 20, resolutionMm: 2 })
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 5, y0: 10, z0: -3, x1: 15, y1: 10, z1: -3 }
      ]
      sim.applyToolpath(segs, 4, { gougeFloorZ: -10 })
      expect(sim.getGouges()).toHaveLength(0)
    })

    it('detects gouge on angled plunge that goes below floor', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 20, heightMm: 20, depthMm: 20, resolutionMm: 2 })
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 10, y0: 10, z0: 0, x1: 10, y1: 10, z1: -12 } // plunges through floor
      ]
      sim.applyToolpath(segs, 4, { gougeFloorZ: -8 })
      const gouges = sim.getGouges()
      expect(gouges.length).toBe(1)
      expect(gouges[0]!.depthMm).toBeCloseTo(4, 0) // 12 - 8 = 4mm below floor
    })
  })

  // -----------------------------------------------------------------------
  // Cycle time estimation
  // -----------------------------------------------------------------------

  describe('cycle time calculation', () => {
    it('estimates nonzero cycle time for feed moves', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 50, heightMm: 50, depthMm: 20, resolutionMm: 5 })
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 0, y0: 0, z0: -5, x1: 50, y1: 0, z1: -5 },
        { kind: 'feed', x0: 50, y0: 0, z0: -5, x1: 50, y1: 50, z1: -5 }
      ]
      sim.applyToolpath(segs, 6)
      const stats = sim.getStats()
      expect(stats.estimatedCycleTimeSeconds).toBeGreaterThan(0)
    })

    it('rapids do not contribute to cycle time', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 50, heightMm: 50, depthMm: 20, resolutionMm: 5 })
      const feedOnly: ToolpathSegment3[] = [
        { kind: 'feed', x0: 0, y0: 0, z0: -5, x1: 50, y1: 0, z1: -5 }
      ]
      const withRapid: ToolpathSegment3[] = [
        { kind: 'rapid', x0: 0, y0: 0, z0: 10, x1: 0, y1: 0, z1: 0 },
        { kind: 'feed', x0: 0, y0: 0, z0: -5, x1: 50, y1: 0, z1: -5 }
      ]

      const simFeed = new StockSimulator()
      simFeed.initializeStock({ widthMm: 50, heightMm: 50, depthMm: 20, resolutionMm: 5 })
      simFeed.applyToolpath(feedOnly, 6)

      const simBoth = new StockSimulator()
      simBoth.initializeStock({ widthMm: 50, heightMm: 50, depthMm: 20, resolutionMm: 5 })
      simBoth.applyToolpath(withRapid, 6)

      // Same feed distance → same cycle time (rapids not counted)
      expect(simBoth.getStats().estimatedCycleTimeSeconds).toBeCloseTo(
        simFeed.getStats().estimatedCycleTimeSeconds, 3
      )
    })

    it('cycle time is zero for empty toolpath', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 20, heightMm: 20, depthMm: 10, resolutionMm: 2 })
      sim.applyToolpath([], 4)
      expect(sim.getStats().estimatedCycleTimeSeconds).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('empty toolpath removes nothing', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 10, heightMm: 10, depthMm: 5, resolutionMm: 1 })
      sim.applyToolpath([], 4)
      expect(sim.getStats().carvedCount).toBe(0)
      expect(sim.getStats().materialRemovedFraction).toBe(0)
    })

    it('toolpath entirely outside stock removes nothing', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 10, heightMm: 10, depthMm: 5, resolutionMm: 1 })
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 100, y0: 100, z0: -2, x1: 200, y1: 100, z1: -2 }
      ]
      sim.applyToolpath(segs, 4)
      expect(sim.getStats().carvedCount).toBe(0)
    })

    it('throws if applyToolpath called before initializeStock', () => {
      const sim = new StockSimulator()
      expect(() => sim.applyToolpath([], 4)).toThrow(/initializeStock/)
    })

    it('zero-length segment (point) still carves at that position', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 10, heightMm: 10, depthMm: 10, resolutionMm: 1 })
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 5, y0: 5, z0: -5, x1: 5, y1: 5, z1: -5 }
      ]
      sim.applyToolpath(segs, 4)
      expect(sim.getStats().carvedCount).toBeGreaterThan(0)
    })

    it('origin offset shifts the carving region', () => {
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 50, y0: 50, z0: -2, x1: 55, y1: 50, z1: -2 }
      ]

      const sim1 = new StockSimulator()
      sim1.initializeStock({ widthMm: 10, heightMm: 10, depthMm: 5, resolutionMm: 1 })
      sim1.applyToolpath(segs, 4)
      // Default origin (0,0,0) — toolpath at x=50 is outside
      expect(sim1.getStats().carvedCount).toBe(0)

      const sim2 = new StockSimulator()
      sim2.initializeStock({
        widthMm: 10, heightMm: 10, depthMm: 5, resolutionMm: 1,
        originX: 48, originY: 48
      })
      sim2.applyToolpath(segs, 4)
      // Origin shifted — toolpath at x=50 is now inside stock
      expect(sim2.getStats().carvedCount).toBeGreaterThan(0)
    })
  })

  // -----------------------------------------------------------------------
  // Mesh generation
  // -----------------------------------------------------------------------

  describe('getRemovalMesh', () => {
    it('returns empty mesh for uninitialized simulator', () => {
      const sim = new StockSimulator()
      const mesh = sim.getRemovalMesh()
      expect(mesh.triangleCount).toBe(0)
      expect(mesh.positions.length).toBe(0)
      expect(mesh.normals.length).toBe(0)
    })

    it('produces a mesh with correct buffer sizes', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 4, heightMm: 4, depthMm: 4, resolutionMm: 2 })
      // No carving — full stock (2x2x2 = 8 voxels, cube shape)
      const mesh = sim.getRemovalMesh()
      expect(mesh.triangleCount).toBeGreaterThan(0)
      // Each triangle = 3 vertices × 3 floats
      expect(mesh.positions.length).toBe(mesh.triangleCount * 9)
      expect(mesh.normals.length).toBe(mesh.triangleCount * 9)
    })

    it('full stock box has only boundary faces (no internal faces)', () => {
      const sim = new StockSimulator()
      // 3x3x3 = 27 voxels
      sim.initializeStock({ widthMm: 3, heightMm: 3, depthMm: 3, resolutionMm: 1 })
      const mesh = sim.getRemovalMesh()
      // A 3x3x3 box has 6 faces × 9 voxel faces = 54 exposed faces
      // (3×3 = 9 face-facing voxels per box face, ×6 sides)
      // Each face = 2 triangles → 108 triangles
      expect(mesh.triangleCount).toBe(108)
    })

    it('carving a hole increases triangle count (exposes internal faces)', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 6, heightMm: 6, depthMm: 6, resolutionMm: 2 })
      const meshBefore = sim.getRemovalMesh()

      // Carve through the center
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 3, y0: 3, z0: -1, x1: 3, y1: 3, z1: -5 }
      ]
      sim.applyToolpath(segs, 3)
      const meshAfter = sim.getRemovalMesh()

      // Removing voxels from a solid block exposes internal faces,
      // potentially increasing total triangle count even though there are fewer voxels
      expect(meshAfter.triangleCount).not.toBe(meshBefore.triangleCount)
    })

    it('completely carved stock produces empty mesh', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 4, heightMm: 4, depthMm: 4, resolutionMm: 2 })
      // Ball end mill with huge radius, centered in stock — carves everything via 3D distance
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 2, y0: 2, z0: -2, x1: 2, y1: 2, z1: -2 }
      ]
      sim.applyToolpath(segs, 20, { toolShape: 'ball' })
      const mesh = sim.getRemovalMesh()
      expect(mesh.triangleCount).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // Tool shape: flat vs ball
  // -----------------------------------------------------------------------

  describe('tool shape: flat vs ball', () => {
    it('flat tool carves more than ball on angled cuts', () => {
      const config = { widthMm: 20, heightMm: 20, depthMm: 20, resolutionMm: 1 }
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 5, y0: 10, z0: -2, x1: 15, y1: 10, z1: -10 }
      ]

      const simFlat = new StockSimulator()
      simFlat.initializeStock(config)
      simFlat.applyToolpath(segs, 6, { toolShape: 'flat' })

      const simBall = new StockSimulator()
      simBall.initializeStock(config)
      simBall.applyToolpath(segs, 6, { toolShape: 'ball' })

      expect(simFlat.getStats().carvedCount).toBeGreaterThanOrEqual(simBall.getStats().carvedCount)
    })

    it('default tool shape is flat', () => {
      const config = { widthMm: 20, heightMm: 20, depthMm: 10, resolutionMm: 2 }
      const segs: ToolpathSegment3[] = [
        { kind: 'feed', x0: 5, y0: 10, z0: -3, x1: 15, y1: 10, z1: -3 }
      ]

      const simDefault = new StockSimulator()
      simDefault.initializeStock(config)
      simDefault.applyToolpath(segs, 4)

      const simFlat = new StockSimulator()
      simFlat.initializeStock(config)
      simFlat.applyToolpath(segs, 4, { toolShape: 'flat' })

      expect(simDefault.getStats().carvedCount).toBe(simFlat.getStats().carvedCount)
    })
  })

  // -----------------------------------------------------------------------
  // Progress scrubbing
  // -----------------------------------------------------------------------

  describe('progress scrubbing', () => {
    const config = { widthMm: 20, heightMm: 20, depthMm: 10, resolutionMm: 2 }
    const segs: ToolpathSegment3[] = [
      { kind: 'feed', x0: 2, y0: 10, z0: -3, x1: 18, y1: 10, z1: -3 },
      { kind: 'feed', x0: 2, y0: 8, z0: -3, x1: 18, y1: 8, z1: -3 },
      { kind: 'feed', x0: 2, y0: 6, z0: -3, x1: 18, y1: 6, z1: -3 },
      { kind: 'feed', x0: 2, y0: 4, z0: -3, x1: 18, y1: 4, z1: -3 }
    ]

    it('progressFraction=0 removes nothing', () => {
      const sim = new StockSimulator()
      sim.initializeStock(config)
      sim.applyToolpath(segs, 4, { progressFraction: 0 })
      expect(sim.getStats().carvedCount).toBe(0)
    })

    it('progressFraction=0.5 removes less than full toolpath', () => {
      const simHalf = new StockSimulator()
      simHalf.initializeStock(config)
      simHalf.applyToolpath(segs, 4, { progressFraction: 0.5 })

      const simFull = new StockSimulator()
      simFull.initializeStock(config)
      simFull.applyToolpath(segs, 4, { progressFraction: 1 })

      expect(simHalf.getStats().carvedCount).toBeGreaterThan(0)
      expect(simHalf.getStats().carvedCount).toBeLessThan(simFull.getStats().carvedCount)
    })

    it('getProgressSnapshot returns mesh and gouges', () => {
      const sim = new StockSimulator()
      sim.initializeStock(config)
      const snapshot = sim.getProgressSnapshot(segs, 4, 0.5)
      expect(snapshot.mesh.triangleCount).toBeGreaterThan(0)
      expect(snapshot.mesh.positions.length).toBe(snapshot.mesh.triangleCount * 9)
      expect(Array.isArray(snapshot.gouges)).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // Normals correctness
  // -----------------------------------------------------------------------

  describe('mesh normals', () => {
    it('all normals are unit vectors', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 4, heightMm: 4, depthMm: 4, resolutionMm: 2 })
      const mesh = sim.getRemovalMesh()
      for (let i = 0; i < mesh.normals.length; i += 3) {
        const nx = mesh.normals[i]!
        const ny = mesh.normals[i + 1]!
        const nz = mesh.normals[i + 2]!
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz)
        expect(len).toBeCloseTo(1, 5)
      }
    })

    it('normals are axis-aligned (box face mesh)', () => {
      const sim = new StockSimulator()
      sim.initializeStock({ widthMm: 2, heightMm: 2, depthMm: 2, resolutionMm: 2 })
      const mesh = sim.getRemovalMesh()
      // Single voxel: all normals should be axis-aligned
      for (let i = 0; i < mesh.normals.length; i += 3) {
        const nx = Math.abs(mesh.normals[i]!)
        const ny = Math.abs(mesh.normals[i + 1]!)
        const nz = Math.abs(mesh.normals[i + 2]!)
        // Exactly one component should be 1, others 0
        expect(nx + ny + nz).toBeCloseTo(1, 5)
      }
    })
  })
})
