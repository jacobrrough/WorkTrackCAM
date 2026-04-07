import { describe, expect, it } from 'vitest'
import type { AssemblyComponent } from './assembly-schema'
import {
  collectDescendantIds,
  computeAssemblyKinematicPreviewTransforms,
  explodeOffsetMm,
  lerpMotionRzDeg,
  parseAssemblyMotionRzKeyframes,
  planarPreviewBasisFromNormalUnit,
  rotatePointWorldAxis,
  rotatePointWorldZ,
  worldAxisUnitFromParentEuler
} from './assembly-viewport-math'

describe('assembly-viewport-math', () => {
  it('explodeOffsetMm scales by index and factor', () => {
    expect(explodeOffsetMm('z', 10, 0, 1)).toEqual([0, 0, 0])
    expect(explodeOffsetMm('z', 10, 2, 0.5)).toEqual([0, 0, 10])
    expect(explodeOffsetMm('x', 4, 1, 1)).toEqual([4, 0, 0])
    expect(explodeOffsetMm('y', 3, 3, 1)).toEqual([0, 9, 0])
  })

  it('parseAssemblyMotionRzKeyframes accepts rzDeg or deg', () => {
    const s = parseAssemblyMotionRzKeyframes('[{"t":0,"rzDeg":0},{"t":1,"deg":90}]')
    expect(s).not.toBeNull()
    expect(s!.map((x) => x.rzDeg)).toEqual([0, 90])
  })

  it('lerpMotionRzDeg interpolates', () => {
    const s = [
      { t: 0, rzDeg: 0 },
      { t: 1, rzDeg: 100 }
    ]
    expect(lerpMotionRzDeg(s, 0)).toBeCloseTo(0, 5)
    expect(lerpMotionRzDeg(s, 1)).toBeCloseTo(100, 5)
    expect(lerpMotionRzDeg(s, 0.5)).toBeCloseTo(50, 5)
  })

  it('rotatePointWorldZ rotates in XY about pivot', () => {
    const [x, y, z] = rotatePointWorldZ(10, 0, 0, 0, 0, 0, 90)
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(10, 5)
    expect(z).toBeCloseTo(0, 5)
  })

  it('rotatePointWorldAxis X rotates in YZ', () => {
    const [x, y, z] = rotatePointWorldAxis('x', 0, 10, 0, 0, 0, 0, 90)
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(0, 5)
    expect(z).toBeCloseTo(10, 5)
  })

  it('rotatePointWorldAxis Y rotates in ZX', () => {
    const [x, y, z] = rotatePointWorldAxis('y', 10, 0, 0, 0, 0, 0, 90)
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(0, 5)
    expect(z).toBeCloseTo(-10, 5)
  })

  it('collectDescendantIds walks parentId children', () => {
    const active = [
      { id: 'a', name: 'A', partPath: 'p', transform: {}, grounded: true, bomQuantity: 1 },
      { id: 'b', name: 'B', partPath: 'p', transform: {}, grounded: false, parentId: 'a', bomQuantity: 1 }
    ] as AssemblyComponent[]
    expect([...collectDescendantIds('a', active)].sort()).toEqual(['a', 'b'])
  })

  it('planarPreviewBasisFromNormalUnit yields orthonormal U,V in XY when normal is +Z', () => {
    const [u, v] = planarPreviewBasisFromNormalUnit(0, 0, 1)
    expect(u[0]).toBeCloseTo(1, 6)
    expect(u[1]).toBeCloseTo(0, 6)
    expect(u[2]).toBeCloseTo(0, 6)
    expect(v[0]).toBeCloseTo(0, 6)
    expect(v[1]).toBeCloseTo(1, 6)
    expect(v[2]).toBeCloseTo(0, 6)
  })

  it('computeAssemblyKinematicPreviewTransforms planar translates subtree along in-plane U from plane normal', () => {
    const active = [
      {
        id: 'pl',
        name: 'Pl',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: true,
        bomQuantity: 1,
        joint: 'planar',
        planarPreviewNormalAxis: 'z' as const,
        planarPreviewUMm: 5,
        planarPreviewVMm: 0
      },
      {
        id: 'b',
        name: 'B',
        partPath: 'p',
        transform: { x: 10, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: false,
        parentId: 'pl',
        bomQuantity: 1
      }
    ] as AssemblyComponent[]
    const m = computeAssemblyKinematicPreviewTransforms(active)
    const tb = m.get('b')!
    expect(tb.x).toBeCloseTo(15, 5)
    expect(tb.y).toBeCloseTo(0, 5)
    expect(tb.z).toBeCloseTo(0, 5)
  })

  it('computeAssemblyKinematicPreviewTransforms rotates revolute subtree around world Z', () => {
    const active = [
      {
        id: 'a',
        name: 'A',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: true,
        bomQuantity: 1,
        joint: 'revolute',
        revolutePreviewAngleDeg: 90
      },
      {
        id: 'b',
        name: 'B',
        partPath: 'p',
        transform: { x: 10, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: false,
        parentId: 'a',
        bomQuantity: 1
      }
    ] as AssemblyComponent[]
    const m = computeAssemblyKinematicPreviewTransforms(active)
    const ta = m.get('a')!
    expect(ta.x).toBeCloseTo(0, 5)
    expect(ta.y).toBeCloseTo(0, 5)
    expect(ta.rzDeg).toBeCloseTo(90, 5)
    const tb = m.get('b')!
    expect(tb.x).toBeCloseTo(0, 5)
    expect(tb.y).toBeCloseTo(10, 5)
    expect(tb.rzDeg).toBeCloseTo(90, 5)
  })

  it('prefers jointState/jointLimits over legacy preview fields when present', () => {
    const active = [
      {
        id: 'a',
        name: 'A',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: true,
        bomQuantity: 1,
        joint: 'revolute',
        revolutePreviewAngleDeg: 10,
        revolutePreviewMinDeg: -180,
        revolutePreviewMaxDeg: 180,
        jointState: { scalarDeg: 999 },
        jointLimits: { scalarMinDeg: -20, scalarMaxDeg: 20 }
      }
    ] as AssemblyComponent[]
    const m = computeAssemblyKinematicPreviewTransforms(active)
    expect(m.get('a')!.rzDeg).toBeCloseTo(20, 5)
  })

  it('computeAssemblyKinematicPreviewTransforms uses revolutePreviewAxis X for euler rxDeg', () => {
    const active = [
      {
        id: 'a',
        name: 'A',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: true,
        bomQuantity: 1,
        joint: 'revolute',
        revolutePreviewAngleDeg: 90,
        revolutePreviewAxis: 'x' as const
      },
      {
        id: 'b',
        name: 'B',
        partPath: 'p',
        transform: { x: 0, y: 10, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: false,
        parentId: 'a',
        bomQuantity: 1
      }
    ] as AssemblyComponent[]
    const m = computeAssemblyKinematicPreviewTransforms(active)
    expect(m.get('a')!.rxDeg).toBeCloseTo(90, 5)
    const tb = m.get('b')!
    expect(tb.y).toBeCloseTo(0, 5)
    expect(tb.z).toBeCloseTo(10, 5)
    expect(tb.rxDeg).toBeCloseTo(90, 5)
  })

  it('worldAxisUnitFromParentEuler maps parent local +X to world +Y when parent rz=90°', () => {
    const [x, y, z] = worldAxisUnitFromParentEuler(0, 0, 90, 'x')
    expect(x).toBeCloseTo(0, 5)
    expect(y).toBeCloseTo(1, 5)
    expect(z).toBeCloseTo(0, 5)
  })

  it('computeAssemblyKinematicPreviewTransforms slider parent frame translates along parent local axis', () => {
    const active = [
      {
        id: 'p',
        name: 'P',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 90 },
        grounded: true,
        bomQuantity: 1
      },
      {
        id: 'c',
        name: 'C',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: false,
        parentId: 'p',
        bomQuantity: 1,
        joint: 'slider',
        sliderPreviewMm: 10,
        sliderPreviewAxis: 'x' as const,
        sliderPreviewAxisFrame: 'parent' as const
      }
    ] as AssemblyComponent[]
    const m = computeAssemblyKinematicPreviewTransforms(active)
    expect(m.get('c')!.x).toBeCloseTo(0, 5)
    expect(m.get('c')!.y).toBeCloseTo(10, 5)
    expect(m.get('c')!.z).toBeCloseTo(0, 5)
  })

  it('computeAssemblyKinematicPreviewTransforms applies slider before revolute at same depth order', () => {
    const active = [
      {
        id: 's',
        name: 'S',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: true,
        bomQuantity: 1,
        joint: 'slider',
        sliderPreviewMm: 5,
        sliderPreviewAxis: 'x' as const
      },
      {
        id: 'c',
        name: 'C',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: false,
        parentId: 's',
        bomQuantity: 1
      }
    ] as AssemblyComponent[]
    const m = computeAssemblyKinematicPreviewTransforms(active)
    expect(m.get('s')!.x).toBeCloseTo(5, 5)
    expect(m.get('c')!.x).toBeCloseTo(5, 5)
  })

  it('computeAssemblyKinematicPreviewTransforms universal rotates subtree twice about world axes', () => {
    const active = [
      {
        id: 'u',
        name: 'U',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: true,
        bomQuantity: 1,
        joint: 'universal',
        universalPreviewAxis1: 'z' as const,
        universalPreviewAngle1Deg: 90,
        universalPreviewAxis2: 'x' as const,
        universalPreviewAngle2Deg: 0
      },
      {
        id: 'b',
        name: 'B',
        partPath: 'p',
        transform: { x: 10, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: false,
        parentId: 'u',
        bomQuantity: 1
      }
    ] as AssemblyComponent[]
    const m = computeAssemblyKinematicPreviewTransforms(active)
    const tb = m.get('b')!
    expect(tb.x).toBeCloseTo(0, 5)
    expect(tb.y).toBeCloseTo(10, 5)
    expect(tb.z).toBeCloseTo(0, 5)
  })

  it('computeAssemblyKinematicPreviewTransforms cylindrical slides along axis then spins about same axis', () => {
    const active = [
      {
        id: 'cy',
        name: 'Cy',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: true,
        bomQuantity: 1,
        joint: 'cylindrical',
        cylindricalPreviewAxis: 'z' as const,
        cylindricalPreviewSlideMm: 10,
        cylindricalPreviewSpinDeg: 90
      },
      {
        id: 'b',
        name: 'B',
        partPath: 'p',
        transform: { x: 0, y: 10, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: false,
        parentId: 'cy',
        bomQuantity: 1
      }
    ] as AssemblyComponent[]
    const m = computeAssemblyKinematicPreviewTransforms(active)
    const tb = m.get('b')!
    expect(tb.x).toBeCloseTo(-10, 5)
    expect(tb.y).toBeCloseTo(0, 5)
    expect(tb.z).toBeCloseTo(10, 5)
  })

  it('computeAssemblyKinematicPreviewTransforms ball rotates subtree X then Y then Z about world axes', () => {
    const active = [
      {
        id: 's',
        name: 'Socket',
        partPath: 'p',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: true,
        bomQuantity: 1,
        joint: 'ball',
        ballPreviewRxDeg: 90,
        ballPreviewRyDeg: 0,
        ballPreviewRzDeg: 0
      },
      {
        id: 'b',
        name: 'B',
        partPath: 'p',
        transform: { x: 0, y: 10, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        grounded: false,
        parentId: 's',
        bomQuantity: 1
      }
    ] as AssemblyComponent[]
    const m = computeAssemblyKinematicPreviewTransforms(active)
    const tb = m.get('b')!
    expect(tb.x).toBeCloseTo(0, 5)
    expect(tb.y).toBeCloseTo(0, 5)
    expect(tb.z).toBeCloseTo(10, 5)
  })
})
