/**
 * Profile / path picker option builders — pure unit pins (node-env).
 * Proves the sketch -> dropdown-option bridge: closed profiles become indexed options, OPEN polylines
 * become path options with resolved points, and labels read cleanly.
 */

import { describe, expect, it } from 'vitest'
import { emptyDesign, type DesignFileV2 } from '../../../../shared/design-schema'
import { describeProfile, profileOptions, pathOptions } from '../profile-path-options'

describe('profile-path-options', () => {
  it('describeProfile labels a circle by diameter + center', () => {
    expect(describeProfile({ type: 'circle', cx: 5, cy: 5, r: 10 }, 0)).toBe(
      '0 · Circle ⌀20 @ (5, 5)'
    )
  })

  it('describeProfile labels a loop by point count', () => {
    expect(
      describeProfile({ type: 'loop', points: [[0, 0], [10, 0], [10, 10], [0, 10]] }, 2)
    ).toBe('2 · Loop · 4 pts')
  })

  it('profileOptions lists detected closed profiles with their kernel index', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'sq', kind: 'polyline', pointIds: ['a', 'b', 'c', 'd'], closed: true }],
      points: {
        a: { x: 0, y: 0 },
        b: { x: 10, y: 0 },
        c: { x: 10, y: 10 },
        d: { x: 0, y: 10 }
      }
    }
    const out = profileOptions(d)
    expect(out).toHaveLength(1)
    expect(out[0]!.index).toBe(0)
    expect(out[0]!.profile.type).toBe('loop')
  })

  it('profileOptions is empty for a missing design', () => {
    expect(profileOptions(undefined)).toEqual([])
    expect(profileOptions(null)).toEqual([])
  })

  it('pathOptions lists OPEN polylines with resolved [x,y] points (skips closed)', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [
        { id: 'open1', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: false },
        { id: 'closed1', kind: 'polyline', pointIds: ['a', 'b', 'c'], closed: true }
      ],
      points: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, c: { x: 10, y: 5 } }
    }
    const out = pathOptions(d)
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('open1')
    expect(out[0]!.points).toEqual([[0, 0], [10, 0], [10, 5]])
  })

  it('pathOptions skips a polyline with fewer than 2 resolvable points', () => {
    const d: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'short', kind: 'polyline', pointIds: ['a'], closed: false }],
      points: { a: { x: 0, y: 0 } }
    }
    expect(pathOptions(d)).toEqual([])
  })
})
