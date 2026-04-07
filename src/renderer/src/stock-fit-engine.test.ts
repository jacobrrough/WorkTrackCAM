import { describe, expect, it } from 'vitest'
import { fitCylindrical, fitFlat, fitSquareBar } from './stock-fit-engine'

describe('stock-fit-engine', () => {
  // ── Cylindrical fitting ───────────────────────────────────────────

  describe('fitCylindrical', () => {
    it('returns a positive uniform scale', () => {
      const r = fitCylindrical({ x: 40, y: 30, z: 50 }, 100, 50)
      expect(r.fitScale).toBeGreaterThan(0)
      expect(r.scale.x).toBe(r.fitScale)
      expect(r.scale.y).toBe(r.fitScale)
      expect(r.scale.z).toBe(r.fitScale)
    })

    it('aligns long axis with cylinder axis for elongated model', () => {
      const r = fitCylindrical({ x: 200, y: 10, z: 10 }, 250, 40)
      expect(r.fitScale).toBeCloseTo(1.25, 1)
    })

    it('respects chuck depth by reducing usable length', () => {
      const withoutChuck = fitCylindrical({ x: 80, y: 20, z: 20 }, 100, 40)
      const withChuck = fitCylindrical({ x: 80, y: 20, z: 20 }, 100, 40, 20)
      expect(withChuck.fitScale).toBeLessThan(withoutChuck.fitScale)
    })

    it('respects clamp offset', () => {
      const base = fitCylindrical({ x: 80, y: 20, z: 20 }, 100, 40)
      const withClamp = fitCylindrical({ x: 80, y: 20, z: 20 }, 100, 40, 0, 10)
      expect(withClamp.fitScale).toBeLessThan(base.fitScale)
    })

    it('centers position.x by half the unusable length', () => {
      const r = fitCylindrical({ x: 50, y: 20, z: 20 }, 100, 40, 10, 5)
      expect(r.position.x).toBeCloseTo((10 + 5) / 2)
      expect(r.position.y).toBe(0)
      expect(r.position.z).toBe(0)
    })

    it('finds a better fit than axis-aligned for a flat rectangular cross-section', () => {
      const r = fitCylindrical({ x: 50, y: 2, z: 30 }, 100, 32)
      expect(r.fitScale).toBeGreaterThan(0.5)
      const axisAlignedScale = Math.min(100 / 50, 16 / Math.sqrt(1 + 225))
      expect(r.fitScale).toBeGreaterThanOrEqual(axisAlignedScale - 0.01)
    })

    it('handles a cube model (all orientations equivalent)', () => {
      const r = fitCylindrical({ x: 20, y: 20, z: 20 }, 100, 30)
      expect(r.fitScale).toBeCloseTo(15 / Math.sqrt(200), 1)
    })

    it('uses diameter (stock.y) not radius for radial constraint', () => {
      const r = fitCylindrical({ x: 10, y: 10, z: 10 }, 100, 20)
      expect(r.fitScale).toBeCloseTo(10 / Math.sqrt(50), 1)
    })
  })

  // ── Square-bar fitting ────────────────────────────────────────────

  describe('fitSquareBar', () => {
    it('returns a positive uniform scale', () => {
      const r = fitSquareBar({ x: 40, y: 30, z: 50 }, 100, 50)
      expect(r.fitScale).toBeGreaterThan(0)
      expect(r.scale.x).toBe(r.fitScale)
      expect(r.scale.y).toBe(r.fitScale)
      expect(r.scale.z).toBe(r.fitScale)
    })

    it('fits a larger model than cylindrical for the same stock dimension', () => {
      // Square bar: constraint is ±side/2 per axis (AABB), not radial
      // For a cube model 20×20×20 in 30mm stock:
      //   Cylinder: R=15, maxRadius=sqrt(10²+10²)=14.14 → scale=15/14.14=1.061
      //   Square:   halfSide=15, max|Y|=max|Z|=10 → scale=15/10=1.5
      // Square gives a bigger fit because corners aren't wasted.
      const cyl = fitCylindrical({ x: 20, y: 20, z: 20 }, 100, 30)
      const sq = fitSquareBar({ x: 20, y: 20, z: 20 }, 100, 30)
      expect(sq.fitScale).toBeGreaterThan(cyl.fitScale)
    })

    it('respects chuck depth', () => {
      const base = fitSquareBar({ x: 80, y: 20, z: 20 }, 100, 40)
      const withChuck = fitSquareBar({ x: 80, y: 20, z: 20 }, 100, 40, 20)
      expect(withChuck.fitScale).toBeLessThan(base.fitScale)
    })

    it('positions at origin with xCenter offset', () => {
      const r = fitSquareBar({ x: 50, y: 20, z: 20 }, 100, 40, 10, 5)
      expect(r.position.x).toBeCloseTo(7.5)
      expect(r.position.y).toBe(0)
      expect(r.position.z).toBe(0)
    })

    it('square fits a rectangular cross-section model better than cylinder', () => {
      // Model 10×20×20 — cross-section 20×20 needs cylinder Ø28.3 but only 20×20 square
      // In a 25mm stock:
      //   Cylinder: R=12.5, maxRadius=sqrt(10²+10²)=14.14 → scale=12.5/14.14=0.884
      //   Square: halfSide=12.5, max|Y|=max|Z|=10 → scale=12.5/10=1.25
      const cyl = fitCylindrical({ x: 10, y: 20, z: 20 }, 100, 25)
      const sq = fitSquareBar({ x: 10, y: 20, z: 20 }, 100, 25)
      expect(sq.fitScale).toBeGreaterThan(cyl.fitScale)
    })

    it('uses independent Y and Z constraints (not radial)', () => {
      // A tall thin model should exploit the full square height
      // Model 10×5×25 in a 30mm square bar:
      //   maxAbsY comes from the 5mm dim → small
      //   maxAbsZ comes from the 25mm dim → 12.5 < 15 halfSide → fits!
      //   Cylinder: maxRadius ≈ sqrt(2.5²+12.5²) = 12.75 → scale=15/12.75=1.176
      //   Square: min(15/2.5, 15/12.5) = min(6, 1.2) = 1.2
      const cyl = fitCylindrical({ x: 10, y: 5, z: 25 }, 100, 30)
      const sq = fitSquareBar({ x: 10, y: 5, z: 25 }, 100, 30)
      expect(sq.fitScale).toBeGreaterThanOrEqual(cyl.fitScale - 0.01)
    })

    it('aligns long axis with bar axis for elongated model', () => {
      // Model 200×10×10 in a 250mm long 40mm square bar
      const r = fitSquareBar({ x: 200, y: 10, z: 10 }, 250, 40)
      // Long axis along X: scale = min(250/200, 20/5) = min(1.25, 4) = 1.25
      expect(r.fitScale).toBeCloseTo(1.25, 1)
    })
  })

  // ── Flat fitting ──────────────────────────────────────────────────

  describe('fitFlat', () => {
    it('returns a positive uniform scale', () => {
      const r = fitFlat({ x: 80, y: 60, z: 12 }, { x: 100, y: 100, z: 20 })
      expect(r.fitScale).toBeGreaterThan(0)
      expect(r.scale.x).toBe(r.fitScale)
      expect(r.scale.y).toBe(r.fitScale)
      expect(r.scale.z).toBe(r.fitScale)
    })

    it('scales to 1.0 when model exactly fits stock', () => {
      const r = fitFlat({ x: 100, y: 100, z: 20 }, { x: 100, y: 100, z: 20 })
      expect(r.fitScale).toBeCloseTo(1.0, 1)
    })

    it('scales down when model is larger than stock', () => {
      const r = fitFlat({ x: 200, y: 100, z: 20 }, { x: 100, y: 100, z: 20 })
      expect(r.fitScale).toBeLessThan(1.0)
    })

    it('scales up when model is smaller than stock', () => {
      const r = fitFlat({ x: 10, y: 10, z: 5 }, { x: 100, y: 100, z: 20 })
      expect(r.fitScale).toBeGreaterThan(1.0)
    })

    it('positions model at half stock height in z (Three.js Y)', () => {
      const r = fitFlat({ x: 50, y: 50, z: 10 }, { x: 100, y: 100, z: 30 })
      expect(r.position.z).toBeCloseTo(15) // stock.z / 2
      expect(r.position.x).toBe(0)
      expect(r.position.y).toBe(0)
    })

    it('finds the best orientation for a thin plate', () => {
      const r = fitFlat({ x: 100, y: 80, z: 5 }, { x: 90, y: 90, z: 90 })
      expect(r.fitScale).toBeGreaterThanOrEqual(0.89)
    })

    it('a tall model should be rotated to lie on its side', () => {
      const r = fitFlat({ x: 10, y: 10, z: 100 }, { x: 100, y: 100, z: 20 })
      expect(r.fitScale).toBeGreaterThan(0.9)
    })
  })
})
