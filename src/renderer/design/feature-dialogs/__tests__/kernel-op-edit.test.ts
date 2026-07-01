/**
 * FEATURE RE-EDIT · Node-suite proof for the edit-in-place plumbing:
 *
 *   1. `featureDialogSpecForOp` — the op→dialog pre-fill mapper. Every mapped
 *      kind opens its bespoke dialog seeded with the op's CURRENT values, and
 *      every honest-null case (picked ids, labeled datums, live-picker
 *      profile/path ops, dialog-less kinds) falls back to the generic editor.
 *   2. `genericFieldsForOp` / `buildGenericOpCandidate` — the generic editor's
 *      pure core: primitive fields editable, structured fields preserved
 *      verbatim, every candidate re-validated through the REAL
 *      `kernelPostSolidOpSchema` (the kernel is sacred, Safety Rule 1).
 *   3. EVERY op kind in `kernelPostSolidOpSchema` is editable through one of
 *      the two paths — the Fusion re-edit parity guarantee.
 */

import { describe, expect, it } from 'vitest'
import {
  kernelPostSolidOpSchema,
  type KernelPostSolidOp
} from '../../../../shared/part-features-schema'
import { featureDialogSpecForOp } from '../kernel-op-edit'
import { buildGenericOpCandidate, genericFieldsForOp } from '../GenericOpEditor'

/**
 * One schema-valid fixture per op kind in the union. The `Record` type makes
 * the coverage EXHAUSTIVE at compile time — adding a kind to the schema
 * without a fixture here fails `npm run typecheck`.
 */
const FIXTURES: Record<KernelPostSolidOp['kind'], KernelPostSolidOp> = {
  fillet_all: { kind: 'fillet_all', radiusMm: 2 },
  chamfer_all: { kind: 'chamfer_all', lengthMm: 1 },
  fillet_select: { kind: 'fillet_select', radiusMm: 2, edgeDirection: '+Z' },
  chamfer_select: { kind: 'chamfer_select', lengthMm: 1, edgeDirection: '-X' },
  shell_inward: { kind: 'shell_inward', thicknessMm: 2, openDirection: '+Z' },
  pattern_rectangular: {
    kind: 'pattern_rectangular',
    countX: 2,
    countY: 1,
    spacingXMm: 20,
    spacingYMm: 0
  },
  pattern_circular: {
    kind: 'pattern_circular',
    count: 4,
    centerXMm: 0,
    centerYMm: 0,
    startAngleDeg: 0,
    totalAngleDeg: 360
  },
  pattern_linear_3d: { kind: 'pattern_linear_3d', count: 3, dxMm: 10, dyMm: 0, dzMm: 0 },
  pattern_path: {
    kind: 'pattern_path',
    count: 2,
    pathPoints: [
      [0, 0],
      [10, 0]
    ]
  },
  boolean_subtract_cylinder: {
    kind: 'boolean_subtract_cylinder',
    centerXMm: 0,
    centerYMm: 0,
    radiusMm: 5,
    zMinMm: 0,
    zMaxMm: 10
  },
  boolean_union_box: {
    kind: 'boolean_union_box',
    xMinMm: 0,
    xMaxMm: 10,
    yMinMm: 0,
    yMaxMm: 10,
    zMinMm: 0,
    zMaxMm: 10
  },
  boolean_subtract_box: {
    kind: 'boolean_subtract_box',
    xMinMm: 1,
    xMaxMm: 4,
    yMinMm: 1,
    yMaxMm: 4,
    zMinMm: 0,
    zMaxMm: 3
  },
  boolean_intersect_box: {
    kind: 'boolean_intersect_box',
    xMinMm: -10,
    xMaxMm: 10,
    yMinMm: -10,
    yMaxMm: 10,
    zMinMm: 0,
    zMaxMm: 20
  },
  boolean_combine_profile: {
    kind: 'boolean_combine_profile',
    mode: 'union',
    profileIndex: 0,
    extrudeDepthMm: 5,
    zStartMm: 0
  },
  split_keep_halfspace: {
    kind: 'split_keep_halfspace',
    axis: 'Z',
    offsetMm: 0,
    keep: 'positive'
  },
  hole_from_profile: {
    kind: 'hole_from_profile',
    profileIndex: 0,
    mode: 'through_all',
    zStartMm: 0
  },
  thread_cosmetic: {
    kind: 'thread_cosmetic',
    centerXMm: 0,
    centerYMm: 0,
    majorRadiusMm: 8,
    pitchMm: 1.25,
    lengthMm: 20,
    depthMm: 0.8,
    zStartMm: 0
  },
  transform_translate: {
    kind: 'transform_translate',
    dxMm: 5,
    dyMm: 0,
    dzMm: 0,
    keepOriginal: false
  },
  press_pull_profile: { kind: 'press_pull_profile', profileIndex: 0, deltaMm: 5, zStartMm: 0 },
  sweep_profile_path: {
    kind: 'sweep_profile_path',
    profileIndex: 0,
    pathPoints: [
      [0, 0],
      [10, 0]
    ],
    zStartMm: 0
  },
  sweep_profile_path_true: {
    kind: 'sweep_profile_path_true',
    profileIndex: 0,
    pathPoints: [
      [0, 0],
      [10, 0]
    ],
    zStartMm: 0,
    orientationMode: 'frenet'
  },
  pipe_path: {
    kind: 'pipe_path',
    pathPoints: [
      [0, 0],
      [10, 0]
    ],
    outerRadiusMm: 5,
    zStartMm: 0,
    orientationMode: 'frenet'
  },
  thread_wizard: {
    kind: 'thread_wizard',
    centerXMm: 0,
    centerYMm: 0,
    majorRadiusMm: 8,
    pitchMm: 1.25,
    lengthMm: 20,
    depthMm: 0.8,
    zStartMm: 0,
    hand: 'right',
    mode: 'modeled',
    standard: 'ISO',
    designation: 'M',
    class: '6g',
    starts: 1
  },
  thicken_offset: { kind: 'thicken_offset', distanceMm: 2, side: 'outward' },
  thicken_scale: { kind: 'thicken_scale', deltaMm: 1 },
  coil_cut: {
    kind: 'coil_cut',
    centerXMm: 0,
    centerYMm: 0,
    majorRadiusMm: 10,
    pitchMm: 2,
    turns: 5,
    depthMm: 1,
    zStartMm: 0
  },
  mirror_union_plane: {
    kind: 'mirror_union_plane',
    plane: 'YZ',
    originXMm: 0,
    originYMm: 0,
    originZMm: 0
  },
  sheet_tab_union: {
    kind: 'sheet_tab_union',
    centerXMm: 0,
    centerYMm: 0,
    zBaseMm: 0,
    lengthMm: 10,
    widthMm: 5,
    heightMm: 3
  },
  sheet_fold: {
    kind: 'sheet_fold',
    bendLineYMm: 0,
    bendRadiusMm: 2,
    bendAngleDeg: 90,
    kFactor: 0.44,
    bendAllowanceMode: 'k_factor'
  },
  sheet_flat_pattern: { kind: 'sheet_flat_pattern', includeBendLines: true },
  loft_guide_rails: {
    kind: 'loft_guide_rails',
    rails: [
      [
        [0, 0],
        [10, 0]
      ]
    ]
  },
  plastic_rule_fillet: { kind: 'plastic_rule_fillet', radiusMm: 2 },
  plastic_boss: {
    kind: 'plastic_boss',
    centerXMm: 0,
    centerYMm: 0,
    zBaseMm: 0,
    outerRadiusMm: 5,
    heightMm: 8,
    draftDeg: 1
  },
  plastic_lip_groove: {
    kind: 'plastic_lip_groove',
    mode: 'lip',
    xMinMm: 0,
    xMaxMm: 50,
    yMinMm: 0,
    yMaxMm: 30,
    zBaseMm: 10,
    depthMm: 2
  },
  datum_plane: { kind: 'datum_plane', basePlane: 'XY', offsetMm: 0 },
  datum_axis: { kind: 'datum_axis', axis: 'Z', originXMm: 0, originYMm: 0, originZMm: 0 },
  datum_point: { kind: 'datum_point', xMm: 0, yMm: 0, zMm: 0 }
}

const ALL_OPS: KernelPostSolidOp[] = Object.values(FIXTURES)

describe('fixtures are schema-faithful', () => {
  it('every fixture parses through the REAL kernelPostSolidOpSchema', () => {
    for (const op of ALL_OPS) {
      const parsed = kernelPostSolidOpSchema.safeParse(op)
      expect(parsed.success, `${op.kind} fixture must be schema-valid`).toBe(true)
    }
  })
})

describe('featureDialogSpecForOp — pre-fill mappings', () => {
  it('fillet_all opens the Fillet dialog pre-filled with the current radius', () => {
    expect(featureDialogSpecForOp({ kind: 'fillet_all', radiusMm: 3.5 })).toEqual({
      kind: 'fillet',
      params: { radiusMm: 3.5, mode: 'all' }
    })
  })

  it('fillet_select pre-fills mode + axis bucket', () => {
    expect(
      featureDialogSpecForOp({ kind: 'fillet_select', radiusMm: 2, edgeDirection: '-Y' })
    ).toEqual({
      kind: 'fillet',
      params: { radiusMm: 2, mode: 'select', edgeDirection: '-Y' }
    })
  })

  it('chamfer_select pre-fills length + axis bucket', () => {
    expect(
      featureDialogSpecForOp({ kind: 'chamfer_select', lengthMm: 1.2, edgeDirection: '+X' })
    ).toEqual({
      kind: 'chamfer',
      params: { lengthMm: 1.2, mode: 'select', edgeDirection: '+X' }
    })
  })

  it('shell_inward pre-fills thickness + open direction', () => {
    expect(
      featureDialogSpecForOp({ kind: 'shell_inward', thicknessMm: 2, openDirection: '-Z' })
    ).toEqual({
      kind: 'shell',
      params: { thicknessMm: 2, openDirection: '-Z' }
    })
  })

  it('transform_translate maps keepOriginal onto the dialog mode', () => {
    expect(
      featureDialogSpecForOp({
        kind: 'transform_translate',
        dxMm: 5,
        dyMm: 0,
        dzMm: 0,
        keepOriginal: true
      })
    ).toEqual({
      kind: 'transform_translate',
      params: { dxMm: 5, dyMm: 0, dzMm: 0, mode: 'copy' }
    })
    expect(
      featureDialogSpecForOp({
        kind: 'transform_translate',
        dxMm: 5,
        dyMm: 0,
        dzMm: 0,
        keepOriginal: false
      })
    ).toMatchObject({ params: { mode: 'move' } })
  })

  it('thread_wizard pre-fills every wizard field', () => {
    const spec = featureDialogSpecForOp(FIXTURES.thread_wizard)
    expect(spec).toMatchObject({
      kind: 'thread_wizard',
      params: { majorRadiusMm: 8, pitchMm: 1.25, hand: 'right', class: '6g', starts: 1 }
    })
  })

  it('honest null: fillet/chamfer with picked edge ids (dialog would drop them)', () => {
    expect(
      featureDialogSpecForOp({
        kind: 'fillet_select',
        radiusMm: 2,
        edgeDirection: '+Z',
        pickedEdgeIds: ['e:abc']
      })
    ).toBeNull()
    expect(
      featureDialogSpecForOp({
        kind: 'chamfer_select',
        lengthMm: 1,
        edgeDirection: '+Z',
        pickedEdgeIds: ['e:abc']
      })
    ).toBeNull()
    expect(
      featureDialogSpecForOp({
        kind: 'shell_inward',
        thicknessMm: 2,
        pickedFaceIds: ['f:abc']
      })
    ).toBeNull()
  })

  it('honest null: labeled datums (dialog seeds the label empty)', () => {
    expect(
      featureDialogSpecForOp({ kind: 'datum_plane', basePlane: 'XY', offsetMm: 5, label: 'top' })
    ).toBeNull()
    // …but an unlabeled datum maps.
    expect(featureDialogSpecForOp(FIXTURES.datum_plane)).toMatchObject({ kind: 'datum_plane' })
  })

  it('honest null: profile/path ops + dialog-less kinds fall back to the generic editor', () => {
    for (const kind of [
      'press_pull_profile',
      'boolean_combine_profile',
      'pipe_path',
      'pattern_path',
      'sweep_profile_path_true',
      'sweep_profile_path',
      'thread_cosmetic',
      'thicken_scale',
      'sheet_tab_union',
      'sheet_fold',
      'sheet_flat_pattern',
      'loft_guide_rails'
    ] as const) {
      expect(featureDialogSpecForOp(FIXTURES[kind]), kind).toBeNull()
    }
  })
})

describe('genericFieldsForOp — the fallback field model', () => {
  it('excludes kind and suppressed; classifies primitives as editable', () => {
    const fields = genericFieldsForOp({ ...FIXTURES.sheet_fold, suppressed: true })
    const names = fields.map((f) => f.name)
    expect(names).not.toContain('kind')
    expect(names).not.toContain('suppressed')
    expect(fields.find((f) => f.name === 'bendAngleDeg')).toMatchObject({
      kind: 'number',
      value: 90
    })
    expect(fields.find((f) => f.name === 'bendAllowanceMode')).toMatchObject({
      kind: 'string',
      value: 'k_factor'
    })
  })

  it('marks structured values (pathPoints, rails, picked ids) read-only', () => {
    const fields = genericFieldsForOp(FIXTURES.pattern_path)
    expect(fields.find((f) => f.name === 'pathPoints')).toMatchObject({ kind: 'readonly' })
    const railFields = genericFieldsForOp(FIXTURES.loft_guide_rails)
    expect(railFields.find((f) => f.name === 'rails')).toMatchObject({ kind: 'readonly' })
  })
})

describe('buildGenericOpCandidate — schema-gated rebuild', () => {
  it('applies a numeric draft and re-validates through the schema', () => {
    const r = buildGenericOpCandidate(FIXTURES.sheet_fold, { bendAngleDeg: '45' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.op).toMatchObject({ kind: 'sheet_fold', bendAngleDeg: 45 })
  })

  it('rejects a non-numeric draft for a number field', () => {
    const r = buildGenericOpCandidate(FIXTURES.sheet_fold, { bendAngleDeg: 'abc' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/finite number/i)
  })

  it('rejects a schema violation (malformed op never escapes)', () => {
    // plastic_rule_fillet radiusMm is strictly positive in the schema.
    const r = buildGenericOpCandidate(FIXTURES.plastic_rule_fillet, { radiusMm: '-5' })
    expect(r.ok).toBe(false)
  })

  it('preserves structured fields + suppressed verbatim', () => {
    const op: KernelPostSolidOp = {
      kind: 'fillet_select',
      radiusMm: 2,
      edgeDirection: '+Z',
      pickedEdgeIds: ['e:abc'],
      suppressed: true
    }
    const r = buildGenericOpCandidate(op, { radiusMm: '5' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.op).toEqual({
        kind: 'fillet_select',
        radiusMm: 5,
        edgeDirection: '+Z',
        pickedEdgeIds: ['e:abc'],
        suppressed: true
      })
    }
  })
})

describe('EVERY op kind is editable (Fusion re-edit parity guarantee)', () => {
  it('each kind either maps to a pre-filled dialog or identity-round-trips the generic editor', () => {
    for (const op of ALL_OPS) {
      const spec = featureDialogSpecForOp(op)
      if (spec !== null) continue // bespoke dialog path
      // Generic path: rebuilding with NO drafts must re-validate — proving the
      // editor can at minimum open + re-apply every unmapped kind losslessly.
      const r = buildGenericOpCandidate(op, {})
      expect(r.ok, `${op.kind} must identity-round-trip the generic editor`).toBe(true)
      if (r.ok) expect(r.op).toEqual(op)
    }
  })
})
