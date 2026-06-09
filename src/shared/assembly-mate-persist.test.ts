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
  buildMateConstraintFromSolved,
  dominantCardinalAxis,
  persistMate,
  solvedKindToMateKind,
  withMateConstraint,
  type SolvedMateInput
} from './assembly-mate-persist'

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
  it('maps point→coincident, axis→concentric, plane→flush', () => {
    expect(solvedKindToMateKind('point')).toBe('coincident')
    expect(solvedKindToMateKind('axis')).toBe('concentric')
    expect(solvedKindToMateKind('plane')).toBe('flush')
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
