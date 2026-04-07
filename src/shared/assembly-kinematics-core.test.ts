import { describe, expect, it } from 'vitest'
import type { AssemblyComponent } from './assembly-schema'
import { solveAssemblyKinematics } from './assembly-kinematics-core'

describe('solveAssemblyKinematics', () => {
  it('returns transforms and clamp diagnostics for out-of-range revolute state', () => {
    const active = [
      {
        id: 'a',
        name: 'A',
        partPath: 'a.json',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        joint: 'revolute',
        jointState: { scalarDeg: 120 },
        jointLimits: { scalarMinDeg: -20, scalarMaxDeg: 45 },
        grounded: true,
        bomQuantity: 1
      }
    ] as AssemblyComponent[]
    const out = solveAssemblyKinematics(active)
    expect(out.transforms.has('a')).toBe(true)
    expect(out.diagnostics.violations).toHaveLength(1)
    expect(out.diagnostics.violations[0]!.joint).toBe('revolute')
    expect(out.diagnostics.clampedDofs).toContain('a:scalarDeg')
  })
})
