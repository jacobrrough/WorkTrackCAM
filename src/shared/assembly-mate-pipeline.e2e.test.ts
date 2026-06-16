/**
 * Assembly mate **end-to-end pipeline** test (pure node-env).
 *
 * This is the SEAM test for the Assembly enhancement: every other
 * `assembly-*.test.ts` file proves one module in isolation (the fold, the
 * solver, the hydrate round-trip, interference, BOM). This file proves they
 * compose — that a mate authored at one end survives the *whole* data pipeline
 * and the analysis surfaces read the positioned result. It chains, in one flow,
 * the five shared cores the renderer wires together:
 *
 *   `assembly-mate-persist`  → fold a solved Model-B mate into a Model-C constraint
 *   `assembly-schema`        → the save→load→parse disk round-trip the IPC performs
 *   `assembly-hydrate`       → re-read the file into the renderer view shape
 *   `assembly-solver-core`   → position the parts from the durable constraints
 *   `assembly-interference`  → flag a clash on the POSITIONED parts
 *   `assembly-bom`           → roll the parts up into a bill of materials
 *
 * The headline scenario (mirrors the integration brief):
 *   add 2 parts → distance-mate them → solve (distance held) → persist →
 *   hydrate (mate kind survives) → move one to overlap → interference flags the
 *   pair → BOM lists both.
 *
 * Plus the backward-compat guard: a legacy `assembly.json` (point/axis/plane
 * mates only, no `distance`) still loads + hydrates + solves (Safety Rule 2).
 *
 * No React, no DOM, no IPC — plain objects exercise the real cores, matching the
 * sibling `assembly-mate-persist.test.ts` posture.
 */

import { describe, expect, it } from 'vitest'
import {
  assemblyFileSchema,
  parseAssemblyFile,
  type AssemblyComponent,
  type AssemblyFile
} from './assembly-schema'
import { persistMate, type SolvedMateInput } from './assembly-mate-persist'
import { hydrateAssembly } from './assembly-hydrate'
import { solveMateConstraints } from './assembly-solver-core'
import {
  detectInterferences,
  type InterferencePart,
  type LocalAabb
} from './assembly-interference'
import { deriveBom } from './assembly-bom'

// ── helpers ──────────────────────────────────────────────────────────────────

/** The exact save→load→parse round-trip the assembly:save / assembly:load IPC performs. */
function saveLoadRoundTrip(asm: AssemblyFile): AssemblyFile {
  const onSave = assemblyFileSchema.parse(asm) // assembly:save validation (v2-only)
  const onDisk = JSON.stringify(onSave, null, 2) // bytes written to assembly.json
  const reread = JSON.parse(onDisk) as unknown // assembly:load read
  return parseAssemblyFile(reread) // assembly:load normalize
}

/** A small cube body, in a part's own local frame, centred at its origin. */
const UNIT_CUBE: LocalAabb = { min: [-5, -5, -5], max: [5, 5, 5] }

/**
 * Map a SOLVED component transform back onto an interference part, using each
 * part's positioned `{x,y,z}` from the solver — the data-level analogue of what
 * the renderer does when it feeds the positioned `parts` into the seam.
 */
function positionedPart(
  id: string,
  solved: Map<string, { x: number; y: number; z: number; rxDeg: number; ryDeg: number; rzDeg: number }>,
  box: LocalAabb = UNIT_CUBE
): InterferencePart {
  const t = solved.get(id)!
  return {
    id,
    localBox: box,
    transform: { x: t.x, y: t.y, z: t.z, rxDeg: t.rxDeg, ryDeg: t.ryDeg, rzDeg: t.rzDeg }
  }
}

// ── (1) headline pipeline: distance-mate → solve → persist → hydrate → clash → BOM ──

describe('assembly mate pipeline — distance mate end-to-end', () => {
  it('positions parts to the distance, survives the disk round-trip with the kind intact, then flags a clash and lists both in the BOM', () => {
    // Two instances of the SAME body (one designModel) so the BOM rolls them into
    // ONE line of qty 2. base is grounded at origin; arm starts offset.
    const built: AssemblyFile = parseAssemblyFile({
      version: 2,
      name: 'Pipeline assy',
      components: [
        {
          id: 'base',
          name: 'Plate',
          partPath: 'design/plate.json',
          transform: { x: 0, y: 0, z: 0 },
          grounded: true,
          geometrySource: { designModelId: 'dm-plate' },
          bomQuantity: 1
        },
        {
          id: 'arm',
          name: 'Plate',
          partPath: 'design/plate.json',
          transform: { x: 2, y: 3, z: 40 },
          geometrySource: { designModelId: 'dm-plate' },
          bomQuantity: 1
        }
      ]
    })

    // ── author the mates (the persist FOLD) ──────────────────────────────────
    // Two flush planes pin X and Y to 0; a distance mate holds the origins 8 mm
    // apart. With X/Y pinned that forces |arm.z| == 8 — a fully-constrained,
    // solver-positioned distance mate.
    let acc = persistMate(built, {
      id: 'flush-x',
      draft: { kind: 'plane', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], normal1: [1, 0, 0], point2: [0, 0, 0], normal2: [1, 0, 0] }
    })
    expect(acc.ok).toBe(true)
    if (!acc.ok) return
    acc = persistMate(acc.assembly, {
      id: 'flush-y',
      draft: { kind: 'plane', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], normal1: [0, 1, 0], point2: [0, 0, 0], normal2: [0, 1, 0] }
    })
    expect(acc.ok).toBe(true)
    if (!acc.ok) return
    const distanceMate: SolvedMateInput = {
      id: 'gap-8',
      draft: { kind: 'distance', part1Id: 'base', part2Id: 'arm', point1: [0, 0, 0], point2: [0, 0, 0], value: 8 }
    }
    acc = persistMate(acc.assembly, distanceMate)
    expect(acc.ok).toBe(true)
    if (!acc.ok) return
    // The fold mapped distance → a Model-C `distance` constraint carrying the target.
    const folded = acc.assembly.mateConstraints.find((c) => c.id === 'gap-8')!
    expect(folded.kind).toBe('distance')
    expect(folded.value).toBe(8)

    // ── DISK round-trip, then HYDRATE (the reload surface) ───────────────────
    const reloaded = saveLoadRoundTrip(acc.assembly)
    // The distance kind + value survive the round-trip verbatim (no lossy fold).
    const reloadedDistance = reloaded.mateConstraints.find((c) => c.id === 'gap-8')!
    expect(reloadedDistance.kind).toBe('distance')
    expect(reloadedDistance.value).toBe(8)

    const hydrated = hydrateAssembly(reloaded)
    // Both parts hydrate; no mate dangles (both refs resolve).
    expect(hydrated.parts.map((p) => p.id).sort()).toEqual(['arm', 'base'])
    expect(hydrated.danglingMateIds).toEqual([])
    expect(hydrated.mateConstraints.map((c) => c.id).sort()).toEqual(['flush-x', 'flush-y', 'gap-8'])
    // The distance mate is intact AFTER hydrate (the headline "kind survives" claim).
    const hydratedDistance = hydrated.mateConstraints.find((c) => c.id === 'gap-8')!
    expect(hydratedDistance.kind).toBe('distance')
    expect(hydratedDistance.value).toBe(8)

    // ── SOLVE from the reloaded constraints (distance held) ──────────────────
    const solve = solveMateConstraints(reloaded.components, reloaded.mateConstraints)
    expect(solve.report.status).toBe('converged')
    const armSolved = solve.transforms.get('arm')!
    expect(armSolved.x).toBeCloseTo(0, 3)
    expect(armSolved.y).toBeCloseTo(0, 3)
    expect(Math.abs(armSolved.z)).toBeCloseTo(8, 3) // distance HELD at 8 mm

    // At the solved pose the two 10mm cubes overlap on Z (centres 8 mm apart,
    // each spans ±5), so interference must flag the pair on the POSITIONED parts.
    const clashAtSolve = detectInterferences([
      positionedPart('base', solve.transforms),
      positionedPart('arm', solve.transforms)
    ])
    expect(clashAtSolve.fidelity).toBe('bbox')
    expect(clashAtSolve.clashingPairs).toEqual([{ aId: 'arm', bId: 'base' }])

    // ── MOVE one part to a clearly-separated pose: clash clears ──────────────
    // (Sanity that the clash is real geometry, not always-on: shove arm far on Z.)
    const separated = new Map(solve.transforms)
    separated.set('arm', { ...armSolved, z: 1000 })
    const clearReport = detectInterferences([
      positionedPart('base', separated),
      positionedPart('arm', separated)
    ])
    expect(clearReport.clashingPairs).toEqual([])

    // ── MOVE one part to fully overlap the other: clash flagged ──────────────
    const overlapping = new Map(solve.transforms)
    overlapping.set('arm', { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }) // coincident with base
    const overlapReport = detectInterferences([
      positionedPart('base', overlapping),
      positionedPart('arm', overlapping)
    ])
    expect(overlapReport.clashingPairs).toEqual([{ aId: 'arm', bId: 'base' }])

    // ── BOM lists both instances (rolled into one line, qty 2) ───────────────
    const bom = deriveBom(reloaded)
    expect(bom.contributingComponentCount).toBe(2)
    expect(bom.totalQuantity).toBe(2)
    // Same body (designModelId dm-plate) → one line aggregating both ids.
    expect(bom.rows).toHaveLength(1)
    expect(bom.rows[0]!.qty).toBe(2)
    expect(bom.rows[0]!.instanceIds.sort()).toEqual(['arm', 'base'])
    expect(bom.rows[0]!.source.kind).toBe('designModel')
  })

  it('a BOM with two distinct bodies lists both parts as separate lines', () => {
    // Distinct geometry sources → two BOM lines (the "BOM lists both" claim for
    // the common heterogeneous assembly).
    const asm: AssemblyFile = parseAssemblyFile({
      version: 2,
      name: 'Two-body assy',
      components: [
        { id: 'base', name: 'Base', partPath: 'p', transform: { x: 0, y: 0, z: 0 }, geometrySource: { designModelId: 'dm-base' } },
        { id: 'arm', name: 'Arm', partPath: 'q', transform: { x: 0, y: 0, z: 0 }, geometrySource: { designModelId: 'dm-arm' } }
      ]
    })
    const bom = deriveBom(asm)
    expect(bom.rows).toHaveLength(2)
    expect(bom.rows.map((r) => r.name).sort()).toEqual(['Arm', 'Base'])
    expect(bom.totalQuantity).toBe(2)
  })
})

// ── (2) backward-compat: a LEGACY assembly (no distance) still flows ───────────

describe('assembly mate pipeline — legacy backward compatibility', () => {
  it('a legacy assembly.json with only point/axis/plane mates loads, hydrates, and solves', () => {
    // A pre-distance project: point + plane mates only, written as the IPC would
    // have. No `distance` kind anywhere. base grounded; a coincident point mate
    // welds base.point[5,0,0] to arm origin → arm must move to [5,0,0].
    const legacyOnDisk = {
      version: 2,
      name: 'Legacy assy',
      components: [
        { id: 'base', name: 'Base', partPath: 'design/base.json', transform: { x: 0, y: 0, z: 0 }, grounded: true },
        { id: 'arm', name: 'Arm', partPath: 'design/arm.json', transform: { x: 12, y: 0, z: 0 } }
      ],
      mateConstraints: [
        {
          id: 'weld',
          kind: 'coincident',
          part1Id: 'base',
          feature1: { x: 5, y: 0, z: 0 },
          part2Id: 'arm',
          feature2: { x: 0, y: 0, z: 0 }
        }
      ]
    }

    const loaded = parseAssemblyFile(legacyOnDisk)
    // No distance mate in a legacy file.
    expect(loaded.mateConstraints.some((c) => c.kind === 'distance')).toBe(false)

    const hydrated = hydrateAssembly(loaded)
    expect(hydrated.parts.map((p) => p.id).sort()).toEqual(['arm', 'base'])
    expect(hydrated.danglingMateIds).toEqual([])
    expect(hydrated.mateConstraints.map((c) => c.kind)).toEqual(['coincident'])

    const solve = solveMateConstraints(loaded.components, loaded.mateConstraints)
    expect(solve.report.status).toBe('converged')
    const arm = solve.transforms.get('arm')!
    expect(arm.x).toBeCloseTo(5, 4)
    expect(arm.y).toBeCloseTo(0, 4)
    expect(arm.z).toBeCloseTo(0, 4)
  })

  it('a pre-mate assembly.json (NO mateConstraints key at all) loads + hydrates to empty mates', () => {
    // The oldest shape — written before mates existed (Safety Rule 2).
    const ancient = {
      version: 2,
      name: 'Ancient assy',
      components: [
        { id: 'c1', name: 'Foot', partPath: 'design/foot.json', transform: { x: 0, y: 0, z: 0 } }
      ]
    }
    const loaded = parseAssemblyFile(ancient as unknown)
    expect(loaded.mateConstraints).toEqual([])
    const hydrated = hydrateAssembly(loaded)
    expect(hydrated.parts.map((p) => p.id)).toEqual(['c1'])
    expect(hydrated.mateConstraints).toEqual([])
    expect(hydrated.danglingMateIds).toEqual([])
  })
})
