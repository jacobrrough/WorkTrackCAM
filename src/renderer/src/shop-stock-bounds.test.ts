import { describe, expect, it } from 'vitest'
import type { ModelTransform } from './ShopModelViewer'
import {
  computeModelBoundsInThreeJS,
  fitModelToStock,
  modelFitsInStock
} from './shop-stock-bounds'

function defaultTransform(): ModelTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
}

describe('shop-stock-bounds', () => {
  it('flat CNC: after fitModelToStock, modelFitsInStock is true', () => {
    const modelSz = { x: 80, y: 60, z: 12 }
    const stock = { x: 100, y: 100, z: 20 }
    const fit = fitModelToStock(modelSz, stock, 'cnc_3d')
    const t = { ...defaultTransform(), ...fit }
    expect(modelFitsInStock(modelSz, t, stock, 'cnc_3d')).toBe(true)
  })

  it('rotary 4/5-axis cylinder: after fitModelToStock, modelFitsInStock is true', () => {
    const modelSz = { x: 40, y: 30, z: 50 }
    const stock = { x: 100, y: 50, z: 20 }
    const fit = fitModelToStock(modelSz, stock, 'cnc_4axis', {
      chuckDepthMm: 5,
      clampOffsetMm: 0
    })
    const t = { ...defaultTransform(), ...fit }
    expect(
      modelFitsInStock(modelSz, t, stock, 'cnc_4axis', {
        chuckDepthMm: 5,
        clampOffsetMm: 0
      })
    ).toBe(true)
    // Origin-centered: model extends below Y=0 (impossible in flat stock
    // where Y starts at 0). Proves rotary fit is different from flat.
    const { loY } = computeModelBoundsInThreeJS(modelSz, t)
    expect(loY).toBeLessThan(-1)
  })

  it('rotary 4/5-axis square bar: after fitModelToStock, modelFitsInStock is true', () => {
    const modelSz = { x: 40, y: 30, z: 50 }
    const stock = { x: 100, y: 50, z: 20 }
    const fit = fitModelToStock(modelSz, stock, 'cnc_4axis', {
      chuckDepthMm: 5,
      clampOffsetMm: 0,
      stockProfile: 'square'
    })
    const t = { ...defaultTransform(), ...fit }
    expect(
      modelFitsInStock(modelSz, t, stock, 'cnc_4axis', {
        chuckDepthMm: 5,
        clampOffsetMm: 0,
        stockProfile: 'square'
      })
    ).toBe(true)
  })

  it('square bar gives a larger fit scale than cylinder for same stock side/diameter', () => {
    // Square bar has ±side/2 per-axis constraint (less restrictive than radial)
    const modelSz = { x: 20, y: 20, z: 20 }
    const stock = { x: 100, y: 30, z: 0 }
    const cylFit = fitModelToStock(modelSz, stock, 'cnc_4axis', {
      chuckDepthMm: 0,
      clampOffsetMm: 0
    })
    const sqFit = fitModelToStock(modelSz, stock, 'cnc_4axis', {
      chuckDepthMm: 0,
      clampOffsetMm: 0,
      stockProfile: 'square'
    })
    expect(sqFit.scale.x).toBeGreaterThan(cylFit.scale.x)
  })

  it('square bar model that fits square does NOT fit cylinder for same dimension', () => {
    // A model that fills a 30mm square exactly (side = 30, half = 15)
    // has diagonal = sqrt(15²+15²) = 21.2 > radius 15 → would fail cylinder check
    const modelSz = { x: 10, y: 28, z: 28 }
    const stock = { x: 100, y: 30, z: 0 }
    const sqFit = fitModelToStock(modelSz, stock, 'cnc_4axis', {
      stockProfile: 'square'
    })
    const t = { ...defaultTransform(), ...sqFit }
    // Passes square check
    expect(modelFitsInStock(modelSz, t, stock, 'cnc_4axis', { stockProfile: 'square' })).toBe(true)
    // Fails cylinder check (diagonal exceeds radius)
    expect(modelFitsInStock(modelSz, t, stock, 'cnc_4axis')).toBe(false)
  })
})
