/**
 * Assembly mate **persistence fold** tests (pure node-env).
 *
 * Proves the durable persistence path for solved assembly mates:
 *   (A) a solved Model-B mate (point / axis / plane) folds into a Model-C
 *       `AssemblyMateConstraint` and **round-trips through save → load → parse**
 *       (the exact `assemblyFileSchema.parse` → JSON → `parseAssemblyFile`
 *       sequence the `assembly:save` / `assembly:load` IPC performs).
 *   (B) an OLD project (assembly.json with NO `mateConstraints` key, written
 *       before mates existed) still loads — Safety Rule 2 (never break a saved
 *       project) — and persisting a mate onto it produces a one-entry array.
 *   (C) the cardinal-axis snap + the validation rejections (zero axis, same
 *       part, non-finite vectors) + idempotent re-persist.
 *
 * No React, no DOM, no IPC: plain objects exercise every branch, mirroring
 * `assembly-mate-form.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import {
  assemblyFileSchema,
  emptyAssembly,
  parseAssemblyFile,
  type AssemblyComponent,
  type AssemblyFile
} from './assembly-schema'
import { solveMateConstraints } from './assembly-solver-core'
import {
  MATE_CONSTRAINT_KIND_LABELS,
  buildMateConstraintFromSolved,
  danglingMateIds,
  dominantCardinalAxis,
  formatMateScalar,
  mateKindHasScalar,
  persistMate,
  removeMateConstraint,
  setMateConstraintScalar,
  setMateSuppress,
  solvedKindToMateKind,
  withMateConstraint,
  type SolvedMateInput
} from './assembly-mate-persist'
import type { AssemblyMateConstraint } from './assembly-mate-schema'

// ── helpers ──────────────────────────────────────────────────────────────────

/** A minimal two-component assembly the mates reference. */
function twoPartAssembly(): AssemblyFile {
  const base: AssemblyComponent['transform'] = { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }
  return parseAssemblyFile({
    version: 2,
    name: 'Bracket assy',
    components: [
      { id: 'base', name: 'Base', partPath: 'design/sketch.json', transform: base, grounded: true },
      { id: 'arm', name: 'Arm', partPath: 'design/arm.json', transform: base }
    ]
  })
}

/**
 * The exact save→load→parse round-trip the IPC performs:
 *   save: `assemblyFileSchema.parse(data)` → `JSON.stringify` → file
 *   load: file text → `JSON.parse` → `parseAssemblyFile`
 * Returns the reloaded `AssemblyFile`.
 */
function saveLoadRoundTrip(asm: AssemblyFile): AssemblyFile {
  const onSave = assemblyFileSchema.parse(asm) // assembly:save validation (v2-only)
  const onDisk = JSON.stringify(onSave, null, 2) // bytes written to assembly.json
  const reread = JSON.parse(onDisk) as unknown // assembly:load read
  return parseAssemblyFile(reread) // assembly:load normalize
}

const POINT_MATE: SolvedMateInput = {
  id: 'mate-point-1',
  draft: {
    kind: 'point',
    part1Id: 'base',
    part2Id: 'arm',
    point1: [10, 0, 0],
    point2: [0, 5, -3]
  }
}

// ── (A) fold + round-trip ────────────────────────────────────────────────────

describe('solvedKindToMateKind', () => {
  it('maps point→coincident, axis→concentric, plane→flush, distance→distance', () => {
    expect(solvedKindToMateKind('point')).toBe('coincident')
    expect(solvedKindToMateKind('axis')).toBe('concentric')
    expect(solvedKindToMateKind('plane')).toBe('flush')
    expect(solvedKindToMateKind('distance')).toBe('distance')
  })

  it('maps the rotational kinds 1:1 — angle→angle, tangent→tangent', () => {
    expect(solvedKindToMateKind('angle')).toBe('angle')
    expect(solvedKindToMateKind('tangent')).toBe('tangent')
  })
})

describe('buildMateConstraintFromSolved — point mate', () => {
  it('folds a point mate into a coincident constraint carrying both feature points', () => {
    const r = buildMateConstraintFromSolved(POINT_MATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.constraint).toMatchObject({
      id: 'mate-point-1',
      kind: 'coincident',
      part1Id: 'base',
      feature1: { x: 10, y: 0, z: 0 },
      part2Id: 'arm',
      feature2: { x: 0, y: 5, z: -3 }
    })
  })
})

describe('mate persistence round-trip (save → load → parse)', () => {
  it('a solved point mate persists and survives the disk round-trip', () => {
    const r = persistMate(twoPartAssembly(), POINT_MATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.assembly.mateConstraints).toHaveLength(1)

    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints).toHaveLength(1)
    expect(reloaded.mateConstraints[0]).toMatchObject({
      id: 'mate-point-1',
      kind: 'coincident',
      part1Id: 'base',
      part2Id: 'arm',
      feature1: { x: 10, y: 0, z: 0 },
      feature2: { x: 0, y: 5, z: -3 }
    })
  })

  it('a solved axis mate persists as concentric with snapped cardinal axes', () => {
    const axisMate: SolvedMateInput = {
      id: 'mate-axis-1',
      draft: {
        kind: 'axis',
        part1Id: 'base',
        part2Id: 'arm',
        // dominant component is Z and X respectively
        axis1: [0, 0, 1],
        axis2: [0.9, 0.1, 0.2]
      }
    }
    const r = persistMate(twoPartAssembly(), axisMate)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints[0]).toMatchObject({
      id: 'mate-axis-1',
      kind: 'concentric',
      feature1: { axis: 'z' },
      feature2: { axis: 'x' }
    })
  })

  it('a solved plane mate persists as flush with point + snapped normal axis', () => {
    const planeMate: SolvedMateInput = {
      id: 'mate-plane-1',
      draft: {
        kind: 'plane',
        part1Id: 'base',
        part2Id: 'arm',
        point1: [1, 2, 3],
        normal1: [0, 1, 0],
        point2: [4, 5, 6],
        normal2: [0, -0.95, 0.1]
      }
    }
    const r = persistMate(twoPartAssembly(), planeMate)
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints[0]).toMatchObject({
      id: 'mate-plane-1',
      kind: 'flush',
      feature1: { x: 1, y: 2, z: 3, axis: 'y' },
      feature2: { x: 4, y: 5, z: 6, axis: 'y' }
    })
  })

  it('two solved mates persist as a two-entry array that round-trips', () => {
    const r1 = persistMate(twoPartAssembly(), POINT_MATE)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    const r2 = persistMate(r1.assembly, {
      id: 'mate-point-2',
      draft: { kind: 'point', part1Id: 'arm', part2Id: 'base', point1: [1, 1, 1], point2: [2, 2, 2] }
    })
    expect(r2.ok).toBe(true)
    if (!r2.ok) return

    const reloaded = saveLoadRoundTrip(r2.assembly)
    expect(reloaded.mateConstraints.map((c) => c.id)).toEqual(['mate-point-1', 'mate-point-2'])
  })
})

// ── (A1b) distance mate fold + round-trip ────────────────────────────────────

describe('buildMateConstraintFromSolved — distance mate', () => {
  const DISTANCE_MATE: SolvedMateInput = {
    id: 'mate-distance-1',
    draft: {
      kind: 'distance',
      part1Id: 'base',
      part2Id: 'arm',
      point1: [0, 0, 0],
      point2: [0, 0, 0],
      value: 25
    }
  }

  it('folds a distance mate into a distance constraint carrying both points + value', () => {
    const r = buildMateConstraintFromSolved(DISTANCE_MATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.constraint).toMatchObject({
      id: 'mate-distance-1',
      kind: 'distance',
      part1Id: 'base',
      feature1: { x: 0, y: 0, z: 0 },
      part2Id: 'arm',
      feature2: { x: 0, y: 0, z: 0 },
      value: 25
    })
  })

  it('a distance mate persists with its value and survives the disk round-trip', () => {
    const r = persistMate(twoPartAssembly(), DISTANCE_MATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints).toHaveLength(1)
    expect(reloaded.mateConstraints[0]).toMatchObject({
      id: 'mate-distance-1',
      kind: 'distance',
      value: 25
    })
  })

  it('rejects a missing / non-finite distance value', () => {
    const noValue = buildMateConstraintFromSolved({
      id: 'd-noval',
      draft: { kind: 'distance', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], point2: [0, 0, 0] }
    })
    expect(noValue.ok).toBe(false)
    if (noValue.ok) return
    expect(noValue.reason).toMatch(/finite number/i)

    const nan = buildMateConstraintFromSolved({
      id: 'd-nan',
      draft: { kind: 'distance', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], point2: [0, 0, 0], value: Number.NaN }
    })
    expect(nan.ok).toBe(false)
  })

  it('rejects a negative distance value (a separation cannot be negative)', () => {
    const neg = buildMateConstraintFromSolved({
      id: 'd-neg',
      draft: { kind: 'distance', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], point2: [0, 0, 0], value: -3 }
    })
    expect(neg.ok).toBe(false)
    if (neg.ok) return
    expect(neg.reason).toMatch(/zero or positive/i)
  })

  it('canonicalizes a -0 distance value to 0', () => {
    const r = buildMateConstraintFromSolved({
      id: 'd-negzero',
      draft: { kind: 'distance', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], point2: [0, 0, 0], value: -0 }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.is(r.constraint.value, -0)).toBe(false)
    expect(r.constraint.value).toBe(0)
  })
})

// ── (A1c) angle / tangent mate fold + round-trip ─────────────────────────────

describe('buildMateConstraintFromSolved — angle mate', () => {
  const ANGLE_MATE: SolvedMateInput = {
    id: 'mate-angle-1',
    draft: {
      kind: 'angle',
      part1Id: 'base',
      part2Id: 'arm',
      axis1Cardinal: 'x',
      axis2Cardinal: 'x',
      angleDeg: 90
    }
  }

  it('folds an angle mate into an angle constraint carrying cardinal axes + degrees', () => {
    const r = buildMateConstraintFromSolved(ANGLE_MATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.constraint).toEqual({
      id: 'mate-angle-1',
      kind: 'angle',
      part1Id: 'base',
      feature1: { axis: 'x' },
      part2Id: 'arm',
      feature2: { axis: 'x' },
      value: 90
    })
    // Directional-only: the feature carries NO point (the solver reads only axis).
    expect(r.constraint.feature1).not.toHaveProperty('x')
  })

  it('an angle mate persists with its degrees value and survives the disk round-trip', () => {
    const r = persistMate(twoPartAssembly(), ANGLE_MATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints).toHaveLength(1)
    expect(reloaded.mateConstraints[0]).toMatchObject({
      id: 'mate-angle-1',
      kind: 'angle',
      feature1: { axis: 'x' },
      feature2: { axis: 'x' },
      value: 90
    })
  })

  it('rejects a missing / non-finite angle value', () => {
    const noVal = buildMateConstraintFromSolved({
      id: 'a-noval',
      draft: { kind: 'angle', part1Id: 'base', part2Id: 'arm', axis1Cardinal: 'x', axis2Cardinal: 'x' }
    })
    expect(noVal.ok).toBe(false)
    if (noVal.ok) return
    expect(noVal.reason).toMatch(/finite number/i)
  })

  it('rejects a missing cardinal axis', () => {
    const r = buildMateConstraintFromSolved({
      id: 'a-noaxis',
      draft: { kind: 'angle', part1Id: 'base', part2Id: 'arm', axis2Cardinal: 'x', angleDeg: 45 }
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/cardinal axis/i)
  })

  it('canonicalizes a -0 angle value to 0', () => {
    const r = buildMateConstraintFromSolved({
      id: 'a-negzero',
      draft: { kind: 'angle', part1Id: 'base', part2Id: 'arm', axis1Cardinal: 'x', axis2Cardinal: 'x', angleDeg: -0 }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(Object.is(r.constraint.value, -0)).toBe(false)
    expect(r.constraint.value).toBe(0)
  })
})

describe('buildMateConstraintFromSolved — tangent mate', () => {
  const TANGENT_MATE: SolvedMateInput = {
    id: 'mate-tangent-1',
    draft: {
      kind: 'tangent',
      part1Id: 'base',
      part2Id: 'arm',
      axis1Cardinal: 'y',
      axis2Cardinal: 'z'
    }
  }

  it('folds a tangent mate into a tangent constraint carrying cardinal axes and NO value', () => {
    const r = buildMateConstraintFromSolved(TANGENT_MATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.constraint).toEqual({
      id: 'mate-tangent-1',
      kind: 'tangent',
      part1Id: 'base',
      feature1: { axis: 'y' },
      part2Id: 'arm',
      feature2: { axis: 'z' }
    })
    // Perpendicular contact has no numeric target.
    expect(r.constraint.value).toBeUndefined()
  })

  it('a tangent mate persists (no value) and survives the disk round-trip', () => {
    const r = persistMate(twoPartAssembly(), TANGENT_MATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints).toHaveLength(1)
    expect(reloaded.mateConstraints[0]).toMatchObject({
      id: 'mate-tangent-1',
      kind: 'tangent',
      feature1: { axis: 'y' },
      feature2: { axis: 'z' }
    })
    expect(reloaded.mateConstraints[0]!.value).toBeUndefined()
  })

  it('rejects a missing cardinal axis', () => {
    const r = buildMateConstraintFromSolved({
      id: 't-noaxis',
      draft: { kind: 'tangent', part1Id: 'base', part2Id: 'arm', axis1Cardinal: 'x' }
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/cardinal axis/i)
  })
})

// ── (A2) reloaded constraints are solver-consumable (end-to-end GOAL) ────────

describe('reloaded mate is solver-consumable', () => {
  it('a persisted+reloaded coincident mate drives the solver to satisfy it', () => {
    // base grounded at origin; arm offset at x=12. A point mate welds
    // base.point[5,0,0] (world [5,0,0]) to arm.point[0,0,0] (arm origin) → after
    // the solve the arm must move to [5,0,0].
    const asm = parseAssemblyFile({
      version: 2,
      name: 'Solver assy',
      components: [
        {
          id: 'base',
          name: 'Base',
          partPath: 'p',
          transform: { x: 0, y: 0, z: 0 },
          grounded: true
        },
        { id: 'arm', name: 'Arm', partPath: 'q', transform: { x: 12, y: 0, z: 0 } }
      ]
    })
    const r = persistMate(asm, {
      id: 'm-coincident',
      draft: { kind: 'point', part1Id: 'base', part2Id: 'arm', point1: [5, 0, 0], point2: [0, 0, 0] }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    // Round-trip through disk, THEN solve with the reloaded constraints.
    const reloaded = saveLoadRoundTrip(r.assembly)
    const solve = solveMateConstraints(reloaded.components, reloaded.mateConstraints)
    expect(solve.report.status).toBe('converged')
    const arm = solve.transforms.get('arm')
    expect(arm).toBeDefined()
    expect(arm!.x).toBeCloseTo(5, 4)
    expect(arm!.y).toBeCloseTo(0, 4)
    expect(arm!.z).toBeCloseTo(0, 4)
  })

  it('a persisted+reloaded distance mate (fully constrained) drives the solver to its target', () => {
    // base grounded; arm offset; two flush mates pin X/Y, a distance mate holds
    // 8mm between origins → after the solve |arm.z| must equal 8 (X,Y pinned to 0).
    const asm = parseAssemblyFile({
      version: 2,
      name: 'Distance assy',
      components: [
        { id: 'base', name: 'Base', partPath: 'p', transform: { x: 0, y: 0, z: 0 }, grounded: true },
        { id: 'arm', name: 'Arm', partPath: 'q', transform: { x: 2, y: 3, z: 4 } }
      ]
    })
    // Persist the two flush mates + the distance mate (each via the fold).
    let acc = persistMate(asm, {
      id: 'fx',
      draft: { kind: 'plane', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], normal1: [1, 0, 0], point2: [0, 0, 0], normal2: [1, 0, 0] }
    })
    expect(acc.ok).toBe(true)
    if (!acc.ok) return
    acc = persistMate(acc.assembly, {
      id: 'fy',
      draft: { kind: 'plane', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], normal1: [0, 1, 0], point2: [0, 0, 0], normal2: [0, 1, 0] }
    })
    expect(acc.ok).toBe(true)
    if (!acc.ok) return
    acc = persistMate(acc.assembly, {
      id: 'd1',
      draft: { kind: 'distance', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], point2: [0, 0, 0], value: 8 }
    })
    expect(acc.ok).toBe(true)
    if (!acc.ok) return

    const reloaded = saveLoadRoundTrip(acc.assembly)
    expect(reloaded.mateConstraints.map((c) => c.id).sort()).toEqual(['d1', 'fx', 'fy'])
    const solve = solveMateConstraints(reloaded.components, reloaded.mateConstraints)
    expect(solve.report.status).toBe('converged')
    const arm = solve.transforms.get('arm')!
    expect(arm.x).toBeCloseTo(0, 3)
    expect(arm.y).toBeCloseTo(0, 3)
    expect(Math.abs(arm.z)).toBeCloseTo(8, 3)
  })

  it('a persisted+reloaded ANGLE mate drives a revolute hinge to its target (the GOAL)', () => {
    // base grounded (Part 1, reference); arm is a non-grounded REVOLUTE hinge about
    // its +Z axis (Part 2, driven) — exactly the case the foundation solver wires
    // (E === F === 1). A 90° angle mate between the two parts' +X axes must rotate
    // the arm about Z until its +X is perpendicular to base's +X (|cos rz| ≈ 0).
    const asm = parseAssemblyFile({
      version: 2,
      name: 'Angle hinge assy',
      components: [
        { id: 'base', name: 'Base', partPath: 'p', transform: { x: 0, y: 0, z: 0 }, grounded: true },
        {
          id: 'arm',
          name: 'Arm',
          partPath: 'q',
          transform: { x: 0, y: 0, z: 0 },
          joint: 'revolute',
          revolutePreviewAxis: 'z'
        }
      ]
    })
    const r = persistMate(asm, {
      id: 'm-angle',
      draft: { kind: 'angle', part1Id: 'base', part2Id: 'arm', axis1Cardinal: 'x', axis2Cardinal: 'x', angleDeg: 90 }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints[0]).toMatchObject({ kind: 'angle', value: 90 })
    const solve = solveMateConstraints(reloaded.components, reloaded.mateConstraints)
    expect(solve.report.status).toBe('converged')
    const arm = solve.transforms.get('arm')!
    // The revolute Euler angle moved to make the axes perpendicular; |cos rz| ≈ 0.
    expect(Math.abs(Math.cos((arm.rzDeg * Math.PI) / 180))).toBeLessThan(1e-3)
    // Only the hinge rotation moved — translation untouched.
    expect(arm.x).toBe(0)
    expect(arm.y).toBe(0)
    expect(arm.z).toBe(0)
  })

  it('a persisted+reloaded TANGENT mate drives a revolute hinge perpendicular (the GOAL)', () => {
    // Same revolute-hinge setup; a tangent mate holds the two +X axes perpendicular
    // (no angle target). After the solve |cos rz| ≈ 0.
    const asm = parseAssemblyFile({
      version: 2,
      name: 'Tangent hinge assy',
      components: [
        { id: 'base', name: 'Base', partPath: 'p', transform: { x: 0, y: 0, z: 0 }, grounded: true },
        {
          id: 'arm',
          name: 'Arm',
          partPath: 'q',
          transform: { x: 0, y: 0, z: 0 },
          joint: 'revolute',
          revolutePreviewAxis: 'z'
        }
      ]
    })
    const r = persistMate(asm, {
      id: 'm-tangent',
      draft: { kind: 'tangent', part1Id: 'base', part2Id: 'arm', axis1Cardinal: 'x', axis2Cardinal: 'x' }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints[0]).toMatchObject({ kind: 'tangent' })
    expect(reloaded.mateConstraints[0]!.value).toBeUndefined()
    const solve = solveMateConstraints(reloaded.components, reloaded.mateConstraints)
    expect(solve.report.status).toBe('converged')
    const arm = solve.transforms.get('arm')!
    expect(Math.abs(Math.cos((arm.rzDeg * Math.PI) / 180))).toBeLessThan(1e-3)
  })
})

// ── (B) Safety Rule 2 — old project still loads ──────────────────────────────

describe('Safety Rule 2 — backward compatibility', () => {
  it('an OLD assembly.json with NO mateConstraints key still parses (and gains [])', () => {
    // Exactly what a pre-mate assembly.json looked like — no `mateConstraints`.
    const legacyOnDisk = {
      version: 2,
      name: 'Legacy assy',
      components: [
        { id: 'c1', name: 'Foot', partPath: 'design/sketch.json', transform: { x: 0, y: 0, z: 0 } }
      ]
    }
    const loaded = parseAssemblyFile(legacyOnDisk)
    expect(loaded.mateConstraints).toEqual([])
  })

  it('a legacy v1 assembly (no version, no mateConstraints) loads with an empty array', () => {
    const loaded = parseAssemblyFile({
      name: 'V1 assy',
      components: [{ id: 'c1', name: 'Foot', partPath: 'p' }]
    })
    expect(loaded.version).toBe(2)
    expect(loaded.mateConstraints).toEqual([])
  })

  it('persisting onto a freshly-loaded legacy project yields a one-entry array that round-trips', () => {
    const legacy = parseAssemblyFile({
      version: 2,
      name: 'Legacy assy',
      components: [
        { id: 'base', name: 'Base', partPath: 'p', transform: { x: 0, y: 0, z: 0 } },
        { id: 'arm', name: 'Arm', partPath: 'q', transform: { x: 0, y: 0, z: 0 } }
      ]
    })
    expect(legacy.mateConstraints).toEqual([])

    const r = persistMate(legacy, POINT_MATE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints).toHaveLength(1)
    expect(reloaded.mateConstraints[0]!.id).toBe('mate-point-1')
  })

  it('emptyAssembly() carries an empty mateConstraints array', () => {
    expect(emptyAssembly().mateConstraints).toEqual([])
  })
})

// ── (C) snapping + validation + idempotency ──────────────────────────────────

describe('dominantCardinalAxis', () => {
  it('snaps to the dominant absolute component (sign-agnostic)', () => {
    expect(dominantCardinalAxis([1, 0, 0])).toBe('x')
    expect(dominantCardinalAxis([0, -1, 0])).toBe('y')
    expect(dominantCardinalAxis([0.1, 0.2, -0.9])).toBe('z')
  })

  it('resolves ties deterministically x > y > z', () => {
    expect(dominantCardinalAxis([1, 1, 1])).toBe('x')
    expect(dominantCardinalAxis([0, 1, 1])).toBe('y')
  })

  it('returns null for a zero / non-finite vector', () => {
    expect(dominantCardinalAxis([0, 0, 0])).toBeNull()
    expect(dominantCardinalAxis([Number.NaN, 0, 0])).toBeNull()
  })
})

describe('buildMateConstraintFromSolved — rejections', () => {
  it('rejects an empty / blank id', () => {
    const r = buildMateConstraintFromSolved({ ...POINT_MATE, id: '   ' })
    expect(r).toEqual({ ok: false, reason: 'Mate id is required.' })
  })

  it('rejects a mate connecting a part to itself', () => {
    const r = buildMateConstraintFromSolved({
      id: 'm',
      draft: { kind: 'point', part1Id: 'base', part2Id: 'base', point1: [0, 0, 0], point2: [0, 0, 0] }
    })
    expect(r).toEqual({ ok: false, reason: 'A mate must connect two different parts.' })
  })

  it('rejects a non-finite point vector', () => {
    const r = buildMateConstraintFromSolved({
      id: 'm',
      draft: { kind: 'point', part1Id: 'a', part2Id: 'b', point1: [0, 0, Number.NaN], point2: [0, 0, 0] }
    })
    expect(r.ok).toBe(false)
  })

  it('rejects a zero-length axis (no cardinal direction to snap to)', () => {
    const r = buildMateConstraintFromSolved({
      id: 'm',
      draft: { kind: 'axis', part1Id: 'a', part2Id: 'b', axis1: [0, 0, 0], axis2: [0, 0, 1] }
    })
    expect(r).toEqual({ ok: false, reason: 'Axis 1 must be a non-zero direction.' })
  })

  it('persistMate returns the assembly UNCHANGED on a rejected draft', () => {
    const asm = twoPartAssembly()
    const r = persistMate(asm, {
      id: 'm',
      draft: { kind: 'point', part1Id: 'x', part2Id: 'x', point1: [0, 0, 0], point2: [0, 0, 0] }
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.assembly).toBe(asm) // same reference — no mutation
    expect(r.assembly.mateConstraints).toEqual([])
  })
})

describe('withMateConstraint — idempotent re-persist', () => {
  it('replaces an existing constraint with the same id in place (no duplicate)', () => {
    const first = persistMate(twoPartAssembly(), POINT_MATE)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    // Re-solve the SAME mate id with moved points → should REPLACE, not append.
    const second = persistMate(first.assembly, {
      id: 'mate-point-1',
      draft: { kind: 'point', part1Id: 'base', part2Id: 'arm', point1: [99, 0, 0], point2: [0, 0, 0] }
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.assembly.mateConstraints).toHaveLength(1)
    expect(second.assembly.mateConstraints[0]!.feature1).toMatchObject({ x: 99 })
  })

  it('does not mutate the input assembly (returns a new identity)', () => {
    const asm = twoPartAssembly()
    const built = buildMateConstraintFromSolved(POINT_MATE)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const next = withMateConstraint(asm, built.constraint)
    expect(next).not.toBe(asm)
    expect(asm.mateConstraints).toEqual([]) // original untouched
    expect(next.mateConstraints).toHaveLength(1)
  })
})

// ── (D) Phase-4 mate LIST edit folds (delete / edit-scalar / suppress) ────────
//
// The Mates-panel row actions each reduce to a pure, id-keyed rewrite of the
// durable list. These prove the folds + their save→load→parse round-trip (the
// exact IPC path), mirroring the authoring-fold suite above.

/** A two-part assembly carrying a distance + an angle mate for the edit folds. */
function assemblyWithScalarMates(): AssemblyFile {
  const base = persistMate(twoPartAssembly(), {
    id: 'm-dist',
    draft: { kind: 'distance', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], point2: [0, 0, 0], value: 8 }
  })
  if (!base.ok) throw new Error('fixture: distance persist failed')
  const withAngle = persistMate(base.assembly, {
    id: 'm-ang',
    draft: { kind: 'angle', part1Id: 'base', part2Id: 'arm', axis1Cardinal: 'x', axis2Cardinal: 'x', angleDeg: 90 }
  })
  if (!withAngle.ok) throw new Error('fixture: angle persist failed')
  return withAngle.assembly
}

describe('MATE_CONSTRAINT_KIND_LABELS + mateKindHasScalar', () => {
  it('labels every durable kind (solver vocabulary, not the Model-B labels)', () => {
    expect(MATE_CONSTRAINT_KIND_LABELS.coincident).toBe('Coincident')
    expect(MATE_CONSTRAINT_KIND_LABELS.concentric).toBe('Concentric')
    expect(MATE_CONSTRAINT_KIND_LABELS.distance).toBe('Distance')
    expect(MATE_CONSTRAINT_KIND_LABELS.angle).toBe('Angle')
    expect(MATE_CONSTRAINT_KIND_LABELS.flush).toBe('Flush')
    expect(MATE_CONSTRAINT_KIND_LABELS.tangent).toBe('Tangent')
  })

  it('only distance / angle carry an editable scalar', () => {
    expect(mateKindHasScalar('distance')).toBe(true)
    expect(mateKindHasScalar('angle')).toBe(true)
    expect(mateKindHasScalar('coincident')).toBe(false)
    expect(mateKindHasScalar('concentric')).toBe(false)
    expect(mateKindHasScalar('flush')).toBe(false)
    expect(mateKindHasScalar('tangent')).toBe(false)
  })
})

describe('formatMateScalar', () => {
  const mk = (over: Partial<AssemblyMateConstraint>): AssemblyMateConstraint => ({
    id: 'x', kind: 'distance', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 }, ...over
  })
  it('formats a distance in mm and an angle in degrees', () => {
    expect(formatMateScalar(mk({ kind: 'distance', value: 12 }))).toBe('12 mm')
    expect(formatMateScalar(mk({ kind: 'angle', value: 90 }))).toBe('90°')
    expect(formatMateScalar(mk({ kind: 'distance', value: 12.5 }))).toBe('12.5 mm')
  })
  it('returns null for a kind with no scalar', () => {
    expect(formatMateScalar(mk({ kind: 'coincident', value: undefined }))).toBeNull()
    expect(formatMateScalar(mk({ kind: 'tangent', value: undefined }))).toBeNull()
  })
  it('reads "—" for a scalar kind whose value is missing (never prints undefined)', () => {
    expect(formatMateScalar(mk({ kind: 'distance', value: undefined }))).toBe('— mm')
    expect(formatMateScalar(mk({ kind: 'angle', value: undefined }))).toBe('—°')
  })
})

describe('removeMateConstraint', () => {
  it('drops the mate by id and survives the disk round-trip', () => {
    const asm = assemblyWithScalarMates()
    expect(asm.mateConstraints).toHaveLength(2)
    const next = removeMateConstraint(asm, 'm-dist')
    expect(next).not.toBe(asm) // new identity
    expect(next.mateConstraints.map((c) => c.id)).toEqual(['m-ang'])
    // the ONE round-trip contract: the reloaded file reflects the delete.
    const reloaded = saveLoadRoundTrip(next)
    expect(reloaded.mateConstraints.map((c) => c.id)).toEqual(['m-ang'])
  })
  it('is idempotent — deleting a missing id is a clean no-op', () => {
    const asm = assemblyWithScalarMates()
    const next = removeMateConstraint(asm, 'nope')
    expect(next.mateConstraints).toHaveLength(2)
  })
  it('does not mutate the input list', () => {
    const asm = assemblyWithScalarMates()
    removeMateConstraint(asm, 'm-dist')
    expect(asm.mateConstraints).toHaveLength(2)
  })
})

describe('setMateConstraintScalar', () => {
  it('edits a distance value, canonicalises -0, and round-trips', () => {
    const asm = assemblyWithScalarMates()
    const r = setMateConstraintScalar(asm, 'm-dist', 25)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.constraint).toMatchObject({ id: 'm-dist', kind: 'distance', value: 25 })
    const reloaded = saveLoadRoundTrip(r.assembly)
    expect(reloaded.mateConstraints.find((c) => c.id === 'm-dist')!.value).toBe(25)

    const neg0 = setMateConstraintScalar(asm, 'm-dist', -0)
    expect(neg0.ok).toBe(true)
    if (!neg0.ok) return
    expect(Object.is(neg0.constraint.value, -0)).toBe(false)
    expect(neg0.constraint.value).toBe(0)
  })
  it('edits an angle value (negative allowed)', () => {
    const r = setMateConstraintScalar(assemblyWithScalarMates(), 'm-ang', -45)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.constraint).toMatchObject({ kind: 'angle', value: -45 })
  })
  it('rejects a negative distance target (assembly unchanged)', () => {
    const asm = assemblyWithScalarMates()
    const r = setMateConstraintScalar(asm, 'm-dist', -5)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/zero or positive/i)
    expect(r.assembly).toBe(asm) // unchanged reference
  })
  it('rejects a non-finite value', () => {
    const r = setMateConstraintScalar(assemblyWithScalarMates(), 'm-dist', Number.NaN)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/finite number/i)
  })
  it('rejects editing a non-scalar kind', () => {
    const withPoint = persistMate(twoPartAssembly(), POINT_MATE)
    expect(withPoint.ok).toBe(true)
    if (!withPoint.ok) return
    const r = setMateConstraintScalar(withPoint.assembly, 'mate-point-1', 3)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/no editable value/i)
  })
  it('rejects a missing id', () => {
    const r = setMateConstraintScalar(assemblyWithScalarMates(), 'ghost', 1)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/not found/i)
  })
})

describe('setMateSuppress', () => {
  it('sets the suppress flag and the reloaded solve EXCLUDES it', () => {
    const asm = assemblyWithScalarMates()
    const next = setMateSuppress(asm, 'm-dist', true)
    expect(next.mateConstraints.find((c) => c.id === 'm-dist')!.suppress).toBe(true)
    const reloaded = saveLoadRoundTrip(next)
    expect(reloaded.mateConstraints.find((c) => c.id === 'm-dist')!.suppress).toBe(true)
    // The solver drops `suppress !== true` — a suppressed mate is parked.
    const solve = solveMateConstraints(reloaded.components, reloaded.mateConstraints)
    expect(solve.report.perConstraintResiduals.some((r) => r.constraintId === 'm-dist')).toBe(false)
  })
  it('enabling DROPS the flag entirely (omitted === active), keeping JSON minimal', () => {
    const asm = setMateSuppress(assemblyWithScalarMates(), 'm-ang', true)
    const enabled = setMateSuppress(asm, 'm-ang', false)
    const row = enabled.mateConstraints.find((c) => c.id === 'm-ang')!
    expect(row).not.toHaveProperty('suppress')
    // Round-trips clean (no residual suppress:false on disk).
    const reloaded = saveLoadRoundTrip(enabled)
    expect(reloaded.mateConstraints.find((c) => c.id === 'm-ang')!).not.toHaveProperty('suppress')
  })
  it('is a no-op for a missing id', () => {
    const asm = assemblyWithScalarMates()
    const next = setMateSuppress(asm, 'ghost', true)
    expect(next.mateConstraints.every((c) => c.suppress === undefined)).toBe(true)
  })
})

describe('danglingMateIds', () => {
  const mates: AssemblyMateConstraint[] = [
    { id: 'ok', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } },
    { id: 'gone1', kind: 'coincident', part1Id: 'a', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'zzz', feature2: { x: 0, y: 0, z: 0 } },
    { id: 'gone2', kind: 'coincident', part1Id: 'yyy', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'b', feature2: { x: 0, y: 0, z: 0 } }
  ]
  it('flags mates whose part ref is absent (deterministic source order)', () => {
    expect(danglingMateIds(mates, new Set(['a', 'b']))).toEqual(['gone1', 'gone2'])
  })
  it('returns [] when every ref resolves', () => {
    expect(danglingMateIds(mates, new Set(['a', 'b', 'zzz', 'yyy']))).toEqual([])
  })
})
