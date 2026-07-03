/**
 * assembly-joint-limits — pure-logic pins for the AssemblyView "Limits" row
 * editor's authoring core.
 *
 * The schema (`AssemblyComponent.jointLimits`) + the solver clamps are DONE
 * elsewhere; this module is the framework-free bridge the editor uses to decide
 * WHICH joint kinds have limitable DOF, parse/validate raw input-string drafts,
 * seed a draft from persisted limits, and render the compact summary chip. No
 * React / DOM / IPC — every branch is pinned here with plain strings/objects.
 */
import { describe, expect, it } from 'vitest'
import {
  LIMIT_MAX_ABS_DEG,
  LIMIT_MAX_ABS_MM,
  formatJointLimitsSummary,
  hasAuthoredLimits,
  jointKindHasLimits,
  jointLimitsToDraft,
  limitFieldsForJointKind,
  limitUnitSuffix,
  parseJointLimitsDraft,
} from './assembly-joint-limits'

describe('limitFieldsForJointKind — which DOF each joint kind can bound', () => {
  it('revolute has one degree DOF on the scalar-deg keys', () => {
    const fields = limitFieldsForJointKind('revolute')
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ unit: 'deg', minKey: 'scalarMinDeg', maxKey: 'scalarMaxDeg' })
  })

  it('slider has one mm DOF on the scalar-mm keys', () => {
    const fields = limitFieldsForJointKind('slider')
    expect(fields).toHaveLength(1)
    expect(fields[0]).toMatchObject({ unit: 'mm', minKey: 'scalarMinMm', maxKey: 'scalarMaxMm' })
  })

  it('cylindrical has both a slide (mm) and a spin (deg) DOF', () => {
    const fields = limitFieldsForJointKind('cylindrical')
    expect(fields.map((f) => [f.minKey, f.unit])).toEqual([
      ['slideMinMm', 'mm'],
      ['spinMinDeg', 'deg'],
    ])
  })

  it('planar bounds U + V (both mm)', () => {
    expect(limitFieldsForJointKind('planar').map((f) => f.minKey)).toEqual(['uMinMm', 'vMinMm'])
  })

  it('universal bounds two angles (deg)', () => {
    expect(limitFieldsForJointKind('universal').map((f) => f.minKey)).toEqual([
      'angle1MinDeg',
      'angle2MinDeg',
    ])
  })

  it('ball bounds three rotations (deg)', () => {
    expect(limitFieldsForJointKind('ball').map((f) => f.minKey)).toEqual([
      'rxMinDeg',
      'ryMinDeg',
      'rzMinDeg',
    ])
  })

  it('rigid and no-joint have no limitable DOF (editor hidden)', () => {
    expect(limitFieldsForJointKind('rigid')).toEqual([])
    expect(limitFieldsForJointKind(undefined)).toEqual([])
  })
})

describe('jointKindHasLimits — drives the row affordance visibility', () => {
  it('is true only for kinds with a free DOF to bound', () => {
    expect(jointKindHasLimits('revolute')).toBe(true)
    expect(jointKindHasLimits('slider')).toBe(true)
    expect(jointKindHasLimits('cylindrical')).toBe(true)
    expect(jointKindHasLimits('planar')).toBe(true)
    expect(jointKindHasLimits('universal')).toBe(true)
    expect(jointKindHasLimits('ball')).toBe(true)
  })

  it('is false for rigid and for a row with no joint', () => {
    expect(jointKindHasLimits('rigid')).toBe(false)
    expect(jointKindHasLimits(undefined)).toBe(false)
  })
})

describe('limitUnitSuffix — reads as the operator sees the field', () => {
  it('renders ° for degrees and mm for millimetres', () => {
    expect(limitUnitSuffix('deg')).toBe('°')
    expect(limitUnitSuffix('mm')).toBe('mm')
  })
})

describe('parseJointLimitsDraft — validation gate the Apply button uses', () => {
  it('parses a valid two-sided revolute draft into scalar-deg limits', () => {
    const res = parseJointLimitsDraft('revolute', { scalarMinDeg: '-90', scalarMaxDeg: '90' })
    expect(res).toEqual({ ok: true, limits: { scalarMinDeg: -90, scalarMaxDeg: 90 } })
  })

  it('accepts a one-sided bound (min-only) — the schema + solver model it', () => {
    const res = parseJointLimitsDraft('slider', { scalarMinMm: '5', scalarMaxMm: '' })
    expect(res).toEqual({ ok: true, limits: { scalarMinMm: 5 } })
  })

  it('accepts a one-sided bound (max-only)', () => {
    const res = parseJointLimitsDraft('revolute', { scalarMinDeg: '', scalarMaxDeg: '45' })
    expect(res).toEqual({ ok: true, limits: { scalarMaxDeg: 45 } })
  })

  it('an all-blank draft is a valid "unlimited" authoring (limits undefined)', () => {
    expect(parseJointLimitsDraft('revolute', {})).toEqual({ ok: true, limits: undefined })
    expect(parseJointLimitsDraft('revolute', { scalarMinDeg: '   ', scalarMaxDeg: '' })).toEqual({
      ok: true,
      limits: undefined,
    })
  })

  it('a kind with no limitable DOF always parses to unlimited', () => {
    expect(parseJointLimitsDraft('rigid', {})).toEqual({ ok: true, limits: undefined })
    expect(parseJointLimitsDraft(undefined, {})).toEqual({ ok: true, limits: undefined })
  })

  it('rejects a non-numeric cell, naming the DOF + side + unit', () => {
    const res = parseJointLimitsDraft('revolute', { scalarMinDeg: 'abc', scalarMaxDeg: '90' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Angle min must be a number (°).')
  })

  it('rejects a non-finite cell (Infinity)', () => {
    const res = parseJointLimitsDraft('slider', { scalarMinMm: 'Infinity' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('must be a number')
  })

  it('rejects min >= max (equal), naming the DOF and both bounds', () => {
    const res = parseJointLimitsDraft('revolute', { scalarMinDeg: '10', scalarMaxDeg: '10' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Angle: min (10°) must be below max (10°).')
  })

  it('rejects min > max', () => {
    const res = parseJointLimitsDraft('slider', { scalarMinMm: '50', scalarMaxMm: '10' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('must be below max')
  })

  it('rejects a degree value beyond ±3600 (unit-mistake guard)', () => {
    const res = parseJointLimitsDraft('revolute', { scalarMaxDeg: String(LIMIT_MAX_ABS_DEG + 1) })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe(`Angle max must be within ±${LIMIT_MAX_ABS_DEG}°.`)
  })

  it('rejects a mm value beyond ±10000', () => {
    const res = parseJointLimitsDraft('slider', { scalarMinMm: String(-(LIMIT_MAX_ABS_MM + 1)) })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe(`Travel min must be within ±${LIMIT_MAX_ABS_MM}mm.`)
  })

  it('accepts values exactly at the cap (boundary is inclusive)', () => {
    const res = parseJointLimitsDraft('revolute', {
      scalarMinDeg: String(-LIMIT_MAX_ABS_DEG),
      scalarMaxDeg: String(LIMIT_MAX_ABS_DEG),
    })
    expect(res).toEqual({
      ok: true,
      limits: { scalarMinDeg: -LIMIT_MAX_ABS_DEG, scalarMaxDeg: LIMIT_MAX_ABS_DEG },
    })
  })

  it('validates every DOF of a multi-DOF kind (cylindrical slide + spin)', () => {
    const res = parseJointLimitsDraft('cylindrical', {
      slideMinMm: '0',
      slideMaxMm: '50',
      spinMinDeg: '-180',
      spinMaxDeg: '180',
    })
    expect(res).toEqual({
      ok: true,
      limits: { slideMinMm: 0, slideMaxMm: 50, spinMinDeg: -180, spinMaxDeg: 180 },
    })
  })

  it('reports the FIRST failing DOF of a multi-DOF kind (spin here)', () => {
    const res = parseJointLimitsDraft('cylindrical', {
      slideMinMm: '0',
      slideMaxMm: '50',
      spinMinDeg: '90',
      spinMaxDeg: '10',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('Spin')
  })
})

describe('jointLimitsToDraft — seeds controlled inputs (never undefined)', () => {
  it('fills every key of the kind, blank for unset bounds', () => {
    const draft = jointLimitsToDraft('cylindrical', { slideMinMm: 0, spinMaxDeg: 180 })
    expect(draft).toEqual({
      slideMinMm: '0',
      slideMaxMm: '',
      spinMinDeg: '',
      spinMaxDeg: '180',
    })
  })

  it('is all-blank when the row has no authored limits', () => {
    expect(jointLimitsToDraft('revolute', undefined)).toEqual({ scalarMinDeg: '', scalarMaxDeg: '' })
  })

  it('round-trips through parse (draft → parse → same limits)', () => {
    const seed = { scalarMinDeg: -90, scalarMaxDeg: 90 }
    const draft = jointLimitsToDraft('revolute', seed)
    const parsed = parseJointLimitsDraft('revolute', draft)
    expect(parsed).toEqual({ ok: true, limits: seed })
  })

  it('is empty for a kind with no limitable DOF', () => {
    expect(jointLimitsToDraft('rigid', undefined)).toEqual({})
  })
})

describe('formatJointLimitsSummary — the compact row chip', () => {
  it('single-DOF kind omits the label (the unit says which DOF)', () => {
    expect(formatJointLimitsSummary('revolute', { scalarMinDeg: -90, scalarMaxDeg: 90 })).toBe(
      '-90..90°'
    )
  })

  it('multi-DOF kind labels each range and joins with a middle dot', () => {
    expect(
      formatJointLimitsSummary('cylindrical', {
        slideMinMm: 0,
        slideMaxMm: 50,
        spinMinDeg: -180,
        spinMaxDeg: 180,
      })
    ).toBe('Slide 0..50mm · Spin -180..180°')
  })

  it('renders an open side as ∞ for a one-sided bound', () => {
    expect(formatJointLimitsSummary('slider', { scalarMinMm: 10 })).toBe('10..∞mm')
    expect(formatJointLimitsSummary('revolute', { scalarMaxDeg: 45 })).toBe('-∞..45°')
  })

  it('reads "unlimited" when nothing is bounded', () => {
    expect(formatJointLimitsSummary('revolute', undefined)).toBe('unlimited')
    expect(formatJointLimitsSummary('revolute', {})).toBe('unlimited')
    expect(formatJointLimitsSummary('rigid', undefined)).toBe('unlimited')
  })

  it('only summarises DOF that are actually bounded (skips blank ones)', () => {
    // cylindrical with only the slide bounded → spin is omitted entirely.
    expect(formatJointLimitsSummary('cylindrical', { slideMinMm: 0, slideMaxMm: 50 })).toBe(
      'Slide 0..50mm'
    )
  })
})

describe('hasAuthoredLimits — drives the row summary-chip visibility', () => {
  it('is true when any bound of the kind is set', () => {
    expect(hasAuthoredLimits('revolute', { scalarMinDeg: -90 })).toBe(true)
    expect(hasAuthoredLimits('cylindrical', { spinMaxDeg: 180 })).toBe(true)
  })

  it('is false for undefined, empty, or a kind with no limitable DOF', () => {
    expect(hasAuthoredLimits('revolute', undefined)).toBe(false)
    expect(hasAuthoredLimits('revolute', {})).toBe(false)
    expect(hasAuthoredLimits('rigid', { scalarMinDeg: -90 })).toBe(false)
  })
})
