/**
 * Assembly **parts persistence + load-hydrate seam** tests (pure node-env).
 *
 * Proves the data layer that takes Assembly from write-only/degenerate to a
 * real end-to-end round-trip (no React, no DOM, no IPC — plain objects):
 *
 *   (A) SCHEMA back-compat: a legacy `assembly.json` whose rows have NO
 *       `geometrySource` still parses (Safety Rule 2); a row CAN carry its own
 *       source; an empty source is rejected.
 *   (B) persistParts FOLD: parts become `components` with stable ids, each
 *       carrying its OWN geometry (#11); an in-place update preserves fields the
 *       view does not model; removed parts drop; mate refs resolve afterward (#8).
 *   (C) hydrateAssembly ROUND-TRIP: persist parts + a mate → save→load→parse →
 *       hydrate yields equal parts + mates; legacy file → empty arrays; stable
 *       ids preserved; dangling mate refs are filtered + reported (#9).
 */

import { describe, expect, it } from 'vitest'
import {
  assemblyFileSchema,
  parseAssemblyFile,
  type AssemblyFile
} from './assembly-schema'
import { persistMate, type SolvedMateInput } from './assembly-mate-persist'
import { solveMateConstraints } from './assembly-solver-core'
import {
  hydrateAssembly,
  persistParts,
  syntheticPartPath,
  type AssemblyPartView
} from './assembly-hydrate'
import { stepImportSourceIsDangling } from './assembly-step-import'

// ── helpers ──────────────────────────────────────────────────────────────────

/** The exact save→load→parse round-trip the assembly IPC performs. */
function saveLoadRoundTrip(asm: AssemblyFile): AssemblyFile {
  const onSave = assemblyFileSchema.parse(asm)
  const onDisk = JSON.stringify(onSave, null, 2)
  const reread = JSON.parse(onDisk) as unknown
  return parseAssemblyFile(reread)
}

/** A fresh, empty assembly (what the renderer starts a brand-new assembly from). */
function emptyAsm(): AssemblyFile {
  return parseAssemblyFile({ version: 2, name: 'Assy', components: [] })
}

/** Two parts, each with a DISTINCT geometry handle (the #11 fix in view shape). */
const TWO_DISTINCT_PARTS: readonly AssemblyPartView[] = [
  { id: 'part-a', name: 'Base', geometry: { handle: 'h-base' } },
  {
    id: 'part-b',
    name: 'Arm',
    geometry: { handle: 'h-arm' },
    transform: { position: [12, 0, 0] }
  }
]

// ── (A) SCHEMA back-compat ───────────────────────────────────────────────────

describe('schema — geometrySource back-compat', () => {
  it('a legacy component with NO geometrySource still parses', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Legacy',
      components: [{ id: 'c1', name: 'Foot', partPath: 'design/sketch.json', transform: {} }]
    })
    expect(a.components[0]!.geometrySource).toBeUndefined()
    // and round-trips through the canonical save schema
    expect(assemblyFileSchema.parse(a).components[0]!.geometrySource).toBeUndefined()
  })

  it('a component CAN carry its own geometrySource (handle / designModelId / relPath)', () => {
    const a = parseAssemblyFile({
      version: 2,
      name: 'Src',
      components: [
        {
          id: 'c1',
          name: 'Body',
          partPath: 'design/sketch.json',
          transform: {},
          geometrySource: { handle: 'h-1', designModelId: 'dm-9', relPath: 'assets/designs/dm-9/body.stl' }
        }
      ]
    })
    expect(a.components[0]!.geometrySource).toEqual({
      handle: 'h-1',
      designModelId: 'dm-9',
      relPath: 'assets/designs/dm-9/body.stl'
    })
    expect(assemblyFileSchema.parse(a).components[0]!.geometrySource?.handle).toBe('h-1')
  })

  it('rejects an EMPTY geometrySource (must carry at least one ref)', () => {
    expect(() =>
      parseAssemblyFile({
        version: 2,
        name: 'Bad',
        components: [
          { id: 'c1', name: 'X', partPath: 'p', transform: {}, geometrySource: {} }
        ]
      })
    ).toThrow()
  })
})

// ── (B) persistParts FOLD ────────────────────────────────────────────────────

describe('persistParts — fold renderer parts into components', () => {
  it('folds parts into components with stable ids and DISTINCT geometry (#8/#11)', () => {
    const out = persistParts(emptyAsm(), TWO_DISTINCT_PARTS)
    expect(out.components.map((c) => c.id)).toEqual(['part-a', 'part-b'])
    expect(out.components[0]!.geometrySource).toEqual({ handle: 'h-base' })
    expect(out.components[1]!.geometrySource).toEqual({ handle: 'h-arm' })
    // distinct bodies — not N copies of one handle
    expect(out.components[0]!.geometrySource).not.toEqual(out.components[1]!.geometrySource)
    // transform mapped from the view tuple
    expect(out.components[1]!.transform).toMatchObject({ x: 12, y: 0, z: 0 })
  })

  it('synthesizes a stable non-empty partPath when the part has none', () => {
    const out = persistParts(emptyAsm(), [{ id: 'part-a', name: 'Base', geometry: { handle: 'h' } }])
    expect(out.components[0]!.partPath).toBe(syntheticPartPath('part-a'))
    expect(out.components[0]!.partPath.length).toBeGreaterThan(0)
    // round-trips (schema requires non-empty partPath)
    expect(() => assemblyFileSchema.parse(out)).not.toThrow()
  })

  it('honors an explicit partPath when the part supplies one', () => {
    const out = persistParts(emptyAsm(), [
      { id: 'p', name: 'P', partPath: 'design/p.json', geometry: { designModelId: 'dm-1' } }
    ])
    expect(out.components[0]!.partPath).toBe('design/p.json')
  })

  it('does not mutate the input assembly (new identity, original untouched)', () => {
    const asm = emptyAsm()
    const out = persistParts(asm, TWO_DISTINCT_PARTS)
    expect(out).not.toBe(asm)
    expect(asm.components).toEqual([])
  })

  it('updates an existing component in place and PRESERVES fields the view does not model', () => {
    // Seed an assembly whose component carries grounded + joint + BOM metadata.
    const seeded = parseAssemblyFile({
      version: 2,
      name: 'Seed',
      components: [
        {
          id: 'part-a',
          name: 'Old name',
          partPath: 'design/a.json',
          transform: {},
          grounded: true,
          joint: 'revolute',
          partNumber: 'PN-1',
          bomQuantity: 3,
          geometrySource: { handle: 'h-old' }
        }
      ]
    })
    const out = persistParts(seeded, [
      { id: 'part-a', name: 'New name', geometry: { handle: 'h-new' }, transform: { position: [5, 0, 0] } }
    ])
    const c = out.components[0]!
    // refreshed view-owned fields
    expect(c.name).toBe('New name')
    expect(c.geometrySource).toEqual({ handle: 'h-new' })
    expect(c.transform).toMatchObject({ x: 5 })
    // preserved non-view fields
    expect(c.grounded).toBe(true)
    expect(c.joint).toBe('revolute')
    expect(c.partNumber).toBe('PN-1')
    expect(c.bomQuantity).toBe(3)
    expect(c.partPath).toBe('design/a.json')
  })

  it('preserves a prior geometrySource when the updated part omits geometry', () => {
    const seeded = parseAssemblyFile({
      version: 2,
      name: 'Seed',
      components: [
        { id: 'p', name: 'P', partPath: 'design/p.json', transform: {}, geometrySource: { handle: 'keep' } }
      ]
    })
    const out = persistParts(seeded, [{ id: 'p', name: 'P2' }])
    expect(out.components[0]!.geometrySource).toEqual({ handle: 'keep' })
  })

  it('drops components whose id is no longer in the parts list (UI is source of truth)', () => {
    const both = persistParts(emptyAsm(), TWO_DISTINCT_PARTS)
    const afterRemove = persistParts(both, [TWO_DISTINCT_PARTS[0]!])
    expect(afterRemove.components.map((c) => c.id)).toEqual(['part-a'])
  })

  it('a folded part makes a persisted mate ref resolve (closes #8 end-to-end)', () => {
    // Fold parts FIRST, then persist a mate referencing those part ids.
    const withParts = persistParts(emptyAsm(), TWO_DISTINCT_PARTS)
    const mate: SolvedMateInput = {
      id: 'm1',
      draft: { kind: 'point', part1Id: 'part-a', part2Id: 'part-b', point1: [0, 0, 0], point2: [0, 0, 0] }
    }
    const r = persistMate(withParts, mate)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // After save→load→hydrate, the mate is NOT dangling (both refs resolve).
    const reloaded = saveLoadRoundTrip(r.assembly)
    const hydrated = hydrateAssembly(reloaded)
    expect(hydrated.danglingMateIds).toEqual([])
    expect(hydrated.mateConstraints.map((c) => c.id)).toEqual(['m1'])
  })
})

// ── (C) hydrateAssembly ROUND-TRIP + legacy + dangling ───────────────────────

describe('hydrateAssembly — round-trip', () => {
  it('persist parts + mate → save→load→parse → hydrate yields EQUAL parts + mates', () => {
    const withParts = persistParts(emptyAsm(), TWO_DISTINCT_PARTS)
    const mate: SolvedMateInput = {
      id: 'm-coincident',
      draft: { kind: 'point', part1Id: 'part-a', part2Id: 'part-b', point1: [5, 0, 0], point2: [0, 0, 0] }
    }
    const persisted = persistMate(withParts, mate)
    expect(persisted.ok).toBe(true)
    if (!persisted.ok) return

    const reloaded = saveLoadRoundTrip(persisted.assembly)
    const hydrated = hydrateAssembly(reloaded)

    // parts (id, name, geometry, transform) survive the trip
    expect(hydrated.parts).toEqual([
      {
        id: 'part-a',
        name: 'Base',
        partPath: syntheticPartPath('part-a'),
        geometry: { handle: 'h-base' },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] }
      },
      {
        id: 'part-b',
        name: 'Arm',
        partPath: syntheticPartPath('part-b'),
        geometry: { handle: 'h-arm' },
        transform: { position: [12, 0, 0], rotation: [0, 0, 0] }
      }
    ])
    // mates survive and are non-dangling
    expect(hydrated.danglingMateIds).toEqual([])
    expect(hydrated.mateConstraints).toHaveLength(1)
    expect(hydrated.mateConstraints[0]).toMatchObject({
      id: 'm-coincident',
      kind: 'coincident',
      part1Id: 'part-a',
      part2Id: 'part-b'
    })
  })

  it('the hydrated parts + mates feed the solver (end-to-end GOAL)', () => {
    // base grounded at origin; arm at x=12. Point mate welds base.point[5,0,0]
    // to arm origin → arm must move to [5,0,0] after the solve.
    const parts: readonly AssemblyPartView[] = [
      { id: 'base', name: 'Base', geometry: { handle: 'h-base' } },
      { id: 'arm', name: 'Arm', geometry: { handle: 'h-arm' }, transform: { position: [12, 0, 0] } }
    ]
    let asm = persistParts(emptyAsm(), parts)
    // ground the base so the solver has a fixed frame (set the persisted flag)
    asm = {
      ...asm,
      components: asm.components.map((c) => (c.id === 'base' ? { ...c, grounded: true } : c))
    }
    const r = persistMate(asm, {
      id: 'm',
      draft: { kind: 'point', part1Id: 'base', part2Id: 'arm', point1: [5, 0, 0], point2: [0, 0, 0] }
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return

    const reloaded = saveLoadRoundTrip(r.assembly)
    const hydrated = hydrateAssembly(reloaded)
    const solve = solveMateConstraints(reloaded.components, hydrated.mateConstraints)
    expect(solve.report.status).toBe('converged')
    const arm = solve.transforms.get('arm')
    expect(arm).toBeDefined()
    expect(arm!.x).toBeCloseTo(5, 4)
    expect(arm!.y).toBeCloseTo(0, 4)
    expect(arm!.z).toBeCloseTo(0, 4)
  })

  it('preserves stable ids verbatim through hydrate', () => {
    const withParts = persistParts(emptyAsm(), [
      { id: 'weird id-123', name: 'W', geometry: { relPath: 'a/b.stl' } }
    ])
    const hydrated = hydrateAssembly(saveLoadRoundTrip(withParts))
    expect(hydrated.parts[0]!.id).toBe('weird id-123')
  })

  it('carries joint + grounded through persist → save→load → hydrate (rotational-mate gate)', () => {
    // A revolute, non-grounded hinge is the EXACT case the angle/tangent mate gate
    // depends on. Before this fix the view shape dropped joint/grounded, so a
    // disk-loaded assembly lost the gating until the operator re-set the joint.
    const parts: readonly AssemblyPartView[] = [
      { id: 'base', name: 'Base', geometry: { handle: 'h-base' }, grounded: true },
      { id: 'hinge', name: 'Hinge', geometry: { handle: 'h-hinge' }, joint: 'revolute' }
    ]
    const withParts = persistParts(emptyAsm(), parts)
    // Written onto the components…
    expect(withParts.components.find((c) => c.id === 'base')!.grounded).toBe(true)
    expect(withParts.components.find((c) => c.id === 'hinge')!.joint).toBe('revolute')

    const hydrated = hydrateAssembly(saveLoadRoundTrip(withParts))
    const base = hydrated.parts.find((p) => p.id === 'base')!
    const hinge = hydrated.parts.find((p) => p.id === 'hinge')!
    // …and survive the full round-trip back into the renderer view shape.
    expect(base.grounded).toBe(true)
    expect(hinge.joint).toBe('revolute')
    // The hinge is the gate-eligible part: revolute AND not grounded.
    expect(hinge.joint === 'revolute' && hinge.grounded !== true).toBe(true)
  })

  it('omits joint/grounded for a free-floating row (no default === false key churn)', () => {
    // A plain part (no joint, not grounded) must hydrate to the SAME shape as
    // before — the gating fields are emitted only when meaningful (joint present,
    // grounded === true), so legacy rows keep their exact view shape.
    const withParts = persistParts(emptyAsm(), [{ id: 'p', name: 'P', geometry: { handle: 'h' } }])
    const view = hydrateAssembly(saveLoadRoundTrip(withParts)).parts[0]!
    expect(view).not.toHaveProperty('joint')
    expect(view).not.toHaveProperty('grounded')
  })

  it('a view carrying joint refreshes a prior persisted joint in place', () => {
    // The in-place update path must honor a CHANGED joint from the renderer view
    // (the operator switched a part from rigid → revolute in-session and re-saved).
    const seeded = parseAssemblyFile({
      version: 2,
      name: 'Seed',
      components: [
        { id: 'p', name: 'P', partPath: 'design/p.json', transform: {}, joint: 'rigid', geometrySource: { handle: 'h' } }
      ]
    })
    const out = persistParts(seeded, [{ id: 'p', name: 'P', joint: 'revolute', grounded: false }])
    expect(out.components[0]!.joint).toBe('revolute')
    expect(out.components[0]!.grounded).toBe(false)
  })
})

describe('hydrateAssembly — legacy + tolerance', () => {
  it('a legacy file with NO components and NO mateConstraints hydrates to empty arrays', () => {
    const legacy = parseAssemblyFile({ name: 'V1', components: [] })
    const hydrated = hydrateAssembly(legacy)
    expect(hydrated.parts).toEqual([])
    expect(hydrated.mateConstraints).toEqual([])
    expect(hydrated.danglingMateIds).toEqual([])
  })

  it('hydrates legacy components that have no geometrySource (geometry omitted)', () => {
    const legacy = parseAssemblyFile({
      version: 2,
      name: 'Legacy',
      components: [{ id: 'c1', name: 'Foot', partPath: 'design/sketch.json', transform: { x: 1, y: 2, z: 3 } }]
    })
    const hydrated = hydrateAssembly(legacy)
    expect(hydrated.parts).toEqual([
      {
        id: 'c1',
        name: 'Foot',
        partPath: 'design/sketch.json',
        transform: { position: [1, 2, 3], rotation: [0, 0, 0] }
      }
    ])
    expect(hydrated.parts[0]!.geometry).toBeUndefined()
  })
})

describe('hydrateAssembly — dangling mate refs', () => {
  it('filters out a mate whose ref is not among the parts and reports its id', () => {
    // Hand-build an assembly file with a component AND a mate that references a
    // MISSING part id (simulates a part deleted after the mate was saved).
    const file = parseAssemblyFile({
      version: 2,
      name: 'Dangle',
      components: [
        { id: 'base', name: 'Base', partPath: 'p', transform: {} },
        { id: 'arm', name: 'Arm', partPath: 'q', transform: {} }
      ],
      mateConstraints: [
        {
          id: 'm-ok',
          kind: 'coincident',
          part1Id: 'base',
          feature1: { x: 0, y: 0, z: 0 },
          part2Id: 'arm',
          feature2: { x: 0, y: 0, z: 0 }
        },
        {
          id: 'm-dangling',
          kind: 'coincident',
          part1Id: 'base',
          feature1: { x: 0, y: 0, z: 0 },
          part2Id: 'ghost',
          feature2: { x: 0, y: 0, z: 0 }
        }
      ]
    })
    const hydrated = hydrateAssembly(file)
    expect(hydrated.mateConstraints.map((c) => c.id)).toEqual(['m-ok'])
    expect(hydrated.danglingMateIds).toEqual(['m-dangling'])
    // does not crash; the kept mate is solver-consumable
    expect(() => solveMateConstraints(file.components, hydrated.mateConstraints)).not.toThrow()
  })

  it('reports BOTH-missing-ref mates once (deterministic order)', () => {
    const file = parseAssemblyFile({
      version: 2,
      name: 'AllDangle',
      components: [{ id: 'lone', name: 'Lone', partPath: 'p', transform: {} }],
      mateConstraints: [
        {
          id: 'm1',
          kind: 'coincident',
          part1Id: 'ghost1',
          feature1: { x: 0, y: 0, z: 0 },
          part2Id: 'ghost2',
          feature2: { x: 0, y: 0, z: 0 }
        }
      ]
    })
    const hydrated = hydrateAssembly(file)
    expect(hydrated.mateConstraints).toEqual([])
    expect(hydrated.danglingMateIds).toEqual(['m1'])
  })
})

// ── (E) Persisted visibility (`hidden`) survives the round-trip (wave-8) ──────

describe('persisted visibility — hidden survives save→load→hydrate', () => {
  it('persistParts writes hidden onto the component (true and explicit false)', () => {
    const out = persistParts(emptyAsm(), [
      { id: 'h', name: 'H', geometry: { handle: 'h' }, hidden: true },
      { id: 'v', name: 'V', geometry: { handle: 'v' }, hidden: false }
    ])
    expect(out.components.find((c) => c.id === 'h')!.hidden).toBe(true)
    expect(out.components.find((c) => c.id === 'v')!.hidden).toBe(false)
  })

  it('a hidden part round-trips (hydrated view keeps hidden: true)', () => {
    const withParts = persistParts(emptyAsm(), [{ id: 'h', name: 'H', geometry: { handle: 'h' }, hidden: true }])
    const hydrated = hydrateAssembly(saveLoadRoundTrip(withParts))
    expect(hydrated.parts[0]!.hidden).toBe(true)
  })

  it('LEGACY DEFAULT VISIBLE: a row with no hidden field hydrates WITHOUT the key', () => {
    // A part that never toggled visibility (or a pre-wave-8 file) must hydrate to
    // the same shape as before — no spurious hidden key — so it defaults visible.
    const withParts = persistParts(emptyAsm(), [{ id: 'p', name: 'P', geometry: { handle: 'h' } }])
    const view = hydrateAssembly(saveLoadRoundTrip(withParts)).parts[0]!
    expect(view).not.toHaveProperty('hidden')
  })

  it('a VISIBLE (hidden:false) row hydrates WITHOUT the key (only true rides back)', () => {
    // The hydrate emits hidden only when the row is actually hidden, mirroring the
    // grounded === true rule — so a false persists on disk but hydrates clean.
    const withParts = persistParts(emptyAsm(), [{ id: 'p', name: 'P', geometry: { handle: 'h' }, hidden: false }])
    expect(withParts.components[0]!.hidden).toBe(false)
    const view = hydrateAssembly(saveLoadRoundTrip(withParts)).parts[0]!
    expect(view).not.toHaveProperty('hidden')
  })

  it('an omitted hidden on an in-place update PRESERVES the prior persisted value', () => {
    const seeded = parseAssemblyFile({
      version: 2,
      name: 'Seed',
      components: [{ id: 'p', name: 'P', partPath: 'design/p.json', transform: {}, hidden: true, geometrySource: { handle: 'h' } }]
    })
    // Re-persist with a view that does NOT carry hidden → prior true survives.
    const out = persistParts(seeded, [{ id: 'p', name: 'P2' }])
    expect(out.components[0]!.hidden).toBe(true)
  })
})

// ── (D) External STEP source survives the round-trip (Phase-4) ───────────────

describe('external STEP geometrySource — save→load→hydrate round-trip', () => {
  it('preserves the full {kind, stepPath, cachedBounds, cachedDims} object', () => {
    // A part row carrying a Phase-4 external-STEP source (as buildStepImportPart
    // produces). The renderer folds it via persistParts; the file is saved,
    // reloaded, and hydrated — the durable source must ride through intact so a
    // moved-file row can still render its schematic box + dangling badge.
    const view: AssemblyPartView = {
      id: 'bolt',
      name: 'M6 bolt',
      geometry: {
        kind: 'step',
        stepPath: 'C:/vendor/M6-bolt.step',
        handle: 'step:live',
        cachedBounds: { min: [-3, -3, 0], max: [3, 3, 30] },
        cachedDims: [6, 6, 30]
      }
    }
    const folded = persistParts(emptyAsm(), [view])
    // Persisted onto the component verbatim.
    const comp = folded.components[0]!
    expect(comp.geometrySource?.kind).toBe('step')
    expect(comp.geometrySource?.stepPath).toBe('C:/vendor/M6-bolt.step')
    expect(comp.geometrySource?.cachedBounds).toEqual({ min: [-3, -3, 0], max: [3, 3, 30] })

    // Full disk round-trip → hydrate. The hydrated view keeps the whole source
    // object (NOT flattened), so the renderer can read stepPath + cachedBounds.
    const reloaded = saveLoadRoundTrip(folded)
    const hydrated = hydrateAssembly(reloaded)
    expect(hydrated.parts).toHaveLength(1)
    const g = hydrated.parts[0]!.geometry
    expect(g?.kind).toBe('step')
    expect(g?.stepPath).toBe('C:/vendor/M6-bolt.step')
    expect(g?.cachedBounds).toEqual({ min: [-3, -3, 0], max: [3, 3, 30] })
    expect(g?.cachedDims).toEqual([6, 6, 30])
  })

  it('a reloaded STEP row whose file is MISSING reads as dangling (fixture)', () => {
    // Simulate the hydrate/load path: a saved external-STEP row, reloaded, then
    // the file-exists probe reports FALSE (moved / deleted). The hydrated source
    // drives the pure dangling predicate → the renderer paints an honest badge.
    const folded = persistParts(emptyAsm(), [
      {
        id: 'motor',
        name: 'Stepper',
        geometry: {
          kind: 'step',
          stepPath: 'D:/vendor/moved/stepper.step',
          cachedBounds: { min: [0, 0, 0], max: [42, 42, 60] },
          cachedDims: [42, 42, 60]
        }
      }
    ])
    const g = hydrateAssembly(saveLoadRoundTrip(folded)).parts[0]!.geometry
    // File exists → NOT dangling; file missing → dangling. cachedBounds still
    // present in BOTH cases so the row can draw its schematic either way.
    expect(stepImportSourceIsDangling(g, true)).toBe(false)
    expect(stepImportSourceIsDangling(g, false)).toBe(true)
    expect(g?.cachedBounds).toEqual({ min: [0, 0, 0], max: [42, 42, 60] })
  })

  it('a STEP source with kind but NO stepPath is dangling regardless of the probe', () => {
    // An unresolvable STEP source (kind:'step', no stepPath — the source carries
    // designModelId instead, but is marked external) is always dangling.
    const source = { kind: 'step' as const, designModelId: 'dm-1' }
    expect(stepImportSourceIsDangling(source, true)).toBe(true)
    expect(stepImportSourceIsDangling(source, false)).toBe(true)
  })
})
