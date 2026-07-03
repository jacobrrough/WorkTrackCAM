/**
 * assembly-part-bridge — renderer-adapter pins over the shared hydrate/persist
 * core (`src/shared/assembly-hydrate.ts`).
 *
 * The bridge is the thin `AssemblyPart ⇄ AssemblyPartView` translation layer; the
 * durable fold/hydrate LOGIC is unit-tested exhaustively in
 * `src/shared/assembly-hydrate.test.ts`. These tests pin the ADAPTER contract
 * the renderer relies on:
 *   - #8  — parts fold into schema-valid components with stable ids;
 *   - #9  — a parsed AssemblyFile hydrates into renderer rows + durable mates,
 *           with blank handles (geometry-not-loaded honesty);
 *   - #11 — two added parts produce DISTINCT geometry refs (never one body
 *           aliased twice).
 *
 * Pure module → plain-object tests, no React / no IPC / no jsdom. Produced
 * components are re-validated through `assemblyComponentSchema` to prove they are
 * schema-valid by construction.
 */

import { describe, expect, it } from 'vitest'
import {
  FALLBACK_PART_PATH_PREFIX,
  hydrateAssembly,
  partHasLiveGeometry,
  partPathForRow,
  partsToComponents,
  partToComponent,
  partToView,
  summarizeViewTransform,
  viewToPart
} from '../assembly-part-bridge'
import type { AssemblyPart } from '../AssemblyView'
import {
  assemblyComponentSchema,
  parseAssemblyFile
} from '../../../shared/assembly-schema'

const part = (overrides: Partial<AssemblyPart> = {}): AssemblyPart => ({
  id: 'p1',
  name: 'Bracket',
  handle: 'script:abc',
  ...overrides
})

// ── (A) partPathForRow — durable token for the solve input (never the live handle) ─

describe('assembly-part-bridge — partPathForRow', () => {
  it('prefers an explicit geometrySource', () => {
    expect(partPathForRow(part({ geometrySource: 'design/bracket.json' }))).toBe(
      'design/bracket.json'
    )
  })

  it('falls back to a stable token derived from the row id (NOT the handle)', () => {
    const pth = partPathForRow(part({ id: 'inst-7', handle: 'script:live', geometrySource: undefined }))
    expect(pth).toBe(`${FALLBACK_PART_PATH_PREFIX}inst-7`)
    expect(pth).not.toContain('script:live')
  })
})

// ── (B) partToView — renderer row → shared persistence shape ──────────────────

describe('assembly-part-bridge — partToView', () => {
  it('maps the live handle into the structured geometry ref', () => {
    const v = partToView(part({ handle: 'script:live' }))
    expect(v.id).toBe('p1')
    expect(v.geometry).toEqual({ handle: 'script:live' })
  })

  it('falls back to geometrySource for the geometry ref when the handle is blank', () => {
    const v = partToView(part({ handle: '', geometrySource: 'design/x.json' }))
    expect(v.geometry).toEqual({ handle: 'design/x.json' })
  })

  it('omits geometry entirely when neither handle nor source is present', () => {
    const v = partToView(part({ handle: '', geometrySource: undefined }))
    expect(v.geometry).toBeUndefined()
  })

  it('copies the position/rotation tuples through', () => {
    const v = partToView(part({ transform: { position: [10, -5, 2], rotation: [0, 90, 0] } }))
    expect(v.transform).toEqual({ position: [10, -5, 2], rotation: [0, 90, 0] })
  })
})

// ── (C) partToComponent — schema-valid, id-preserving (via the shared core) ───

describe('assembly-part-bridge — partToComponent', () => {
  it('maps row id → component id (so mate part refs resolve)', () => {
    const c = partToComponent(part({ id: 'arm', name: 'Arm' }))
    expect(c).not.toBeNull()
    expect(c?.id).toBe('arm')
    expect(c?.name).toBe('Arm')
  })

  it('records the live handle as the component geometrySource (#11)', () => {
    const c = partToComponent(part({ handle: 'script:body1' }))
    expect(c?.geometrySource).toEqual({ handle: 'script:body1' })
  })

  it('produces a schema-valid component (round-trips through assemblyComponentSchema)', () => {
    const c = partToComponent(part({ geometrySource: 'design/x.json' }))
    expect(() => assemblyComponentSchema.parse(c)).not.toThrow()
  })

  it('returns null for a blank-id row (a component must have a non-empty id)', () => {
    expect(partToComponent(part({ id: '   ' }))).toBeNull()
  })
})

// ── (D) #11 — distinct geometry refs across rows ─────────────────────────────

describe('assembly-part-bridge — #11 distinct geometry refs', () => {
  it('two rows with distinct sources fold to two distinct geometry refs', () => {
    const comps = partsToComponents([
      part({ id: 'p1', handle: 'script:body1' }),
      part({ id: 'p2', handle: 'script:body2' })
    ])
    expect(comps).toHaveLength(2)
    expect(comps[0]!.geometrySource).toEqual({ handle: 'script:body1' })
    expect(comps[1]!.geometrySource).toEqual({ handle: 'script:body2' })
    expect(comps[0]!.geometrySource).not.toEqual(comps[1]!.geometrySource)
  })

  it('two instances of ONE body stay distinct ROWS (distinct ids) with a shared source', () => {
    const comps = partsToComponents([
      part({ id: 'inst-a', handle: 'script:body1', geometrySource: 'script:body1' }),
      part({ id: 'inst-b', handle: 'script:body1', geometrySource: 'script:body1' })
    ])
    expect(comps[0]!.id).not.toBe(comps[1]!.id)
    expect(comps[0]!.geometrySource).toEqual(comps[1]!.geometrySource)
  })

  it('drops blank-id rows when folding the list', () => {
    const comps = partsToComponents([part({ id: 'ok' }), part({ id: '' })])
    expect(comps).toHaveLength(1)
    expect(comps[0]!.id).toBe('ok')
  })
})

// ── (E) summarizeViewTransform ────────────────────────────────────────────────

describe('assembly-part-bridge — summarizeViewTransform', () => {
  it('identity at the origin', () => {
    expect(summarizeViewTransform({ position: [0, 0, 0], rotation: [0, 0, 0] })).toBe('identity')
  })
  it('@(x, y, z) when translated', () => {
    expect(summarizeViewTransform({ position: [60, 0, 0], rotation: [0, 0, 0] })).toBe('@(60, 0, 0)')
  })
  it('identity when transform is absent', () => {
    expect(summarizeViewTransform(undefined)).toBe('identity')
  })
})

// ── (F) viewToPart — shared view → renderer row, blank handle (geometry not loaded) ─

describe('assembly-part-bridge — viewToPart', () => {
  it('rides the geometry handle back as geometrySource + blanks the live handle', () => {
    const row = viewToPart({
      id: 'arm',
      name: 'Arm',
      geometry: { handle: 'design/arm.json' },
      transform: { position: [5, 0, 0], rotation: [0, 0, 0] }
    })
    expect(row.id).toBe('arm')
    expect(row.geometrySource).toBe('design/arm.json')
    // Hydrated rows carry NO live handle — the view shows an honest placeholder.
    expect(row.handle).toBe('')
    expect(partHasLiveGeometry(row)).toBe(false)
    expect(row.transformSummary).toBe('@(5, 0, 0)')
  })

  it('row → component → hydrate → row preserves id + transform', () => {
    const original = part({
      id: 'p3',
      name: 'Plate',
      handle: 'script:body9',
      transform: { position: [1, 2, 3], rotation: [0, 0, 0] }
    })
    const file = parseAssemblyFile({
      version: 2,
      name: 'RT',
      components: partsToComponents([original]),
      mateConstraints: []
    })
    const back = hydrateAssembly(file).parts[0]!
    expect(back.id).toBe('p3')
    expect(back.name).toBe('Plate')
    expect(back.transform?.position).toEqual([1, 2, 3])
  })

  it('row → component → hydrate → row preserves joint + grounded (rotational-mate gate)', () => {
    // The angle/tangent mate gate reads `joint === 'revolute' && !grounded` off the
    // row. Threading joint/grounded through the bridge keeps that gate correct
    // immediately after a reload (no operator re-set needed).
    const hinge = part({ id: 'hinge', name: 'Hinge', handle: 'script:h', joint: 'revolute' })
    const base = part({ id: 'base', name: 'Base', handle: 'script:b', grounded: true })
    const file = parseAssemblyFile({
      version: 2,
      name: 'RT-joint',
      components: partsToComponents([hinge, base]),
      mateConstraints: []
    })
    const rows = hydrateAssembly(file).parts
    const hingeBack = rows.find((p) => p.id === 'hinge')!
    const baseBack = rows.find((p) => p.id === 'base')!
    expect(hingeBack.joint).toBe('revolute')
    expect(hingeBack.grounded).not.toBe(true)
    expect(baseBack.grounded).toBe(true)
    // The hinge is gate-eligible; the grounded base is not.
    expect(hingeBack.joint === 'revolute' && hingeBack.grounded !== true).toBe(true)
    expect(baseBack.joint === 'revolute' && baseBack.grounded !== true).toBe(false)
  })

  it('partToView carries joint/grounded; a free-floating row stays clean', () => {
    expect(partToView(part({ joint: 'revolute' })).joint).toBe('revolute')
    expect(partToView(part({ grounded: true })).grounded).toBe(true)
    // A plain row forwards neither (so persistParts preserves prior/default).
    const plain = partToView(part({ joint: undefined, grounded: undefined }))
    expect(plain).not.toHaveProperty('joint')
    expect(plain).not.toHaveProperty('grounded')
  })

  it('row → component → hydrate → row preserves authored jointLimits', () => {
    // The Limits editor writes AssemblyComponent.jointLimits; the solver clamps
    // + motion sweep read them back. Threading limits through the bridge keeps a
    // reloaded assembly bounded without an operator re-set.
    const hinge = part({
      id: 'hinge',
      name: 'Hinge',
      handle: 'script:h',
      joint: 'revolute',
      jointLimits: { scalarMinDeg: -90, scalarMaxDeg: 90 }
    })
    const file = parseAssemblyFile({
      version: 2,
      name: 'RT-limits',
      components: partsToComponents([hinge]),
      mateConstraints: []
    })
    const back = hydrateAssembly(file).parts.find((p) => p.id === 'hinge')!
    expect(back.jointLimits).toEqual({ scalarMinDeg: -90, scalarMaxDeg: 90 })
  })

  it('partToView carries jointLimits, including the explicit empty-object clear', () => {
    expect(partToView(part({ jointLimits: { scalarMinDeg: -45, scalarMaxDeg: 45 } })).jointLimits)
      .toEqual({ scalarMinDeg: -45, scalarMaxDeg: 45 })
    // The EMPTY object is the "cleared to unlimited" write — it must be
    // forwarded (not dropped) so persistParts REPLACES prior on-disk limits
    // instead of silently preserving them.
    expect(partToView(part({ jointLimits: {} })).jointLimits).toEqual({})
    // A row with no jointLimits forwards nothing (persistParts preserves prior).
    expect(partToView(part({ jointLimits: undefined }))).not.toHaveProperty('jointLimits')
  })

  it('viewToPart carries jointLimits back so the editor sees persisted bounds', () => {
    const back = viewToPart({
      id: 'p1',
      name: 'Bracket',
      partPath: 'design/bracket.json',
      transform: { position: [0, 0, 0] },
      joint: 'slider',
      jointLimits: { scalarMinMm: 0, scalarMaxMm: 50 }
    })
    expect(back.jointLimits).toEqual({ scalarMinMm: 0, scalarMaxMm: 50 })
  })
})

// ── (G) partHasLiveGeometry — honesty guard ──────────────────────────────────

describe('assembly-part-bridge — partHasLiveGeometry', () => {
  it('true for a freshly-added row with a live handle', () => {
    expect(partHasLiveGeometry(part({ handle: 'script:live' }))).toBe(true)
  })
  it('false for a hydrated row (blank handle)', () => {
    expect(partHasLiveGeometry(part({ handle: '' }))).toBe(false)
    expect(partHasLiveGeometry(part({ handle: '   ' }))).toBe(false)
  })
})

// ── (H) #9 — hydrateAssembly: parts + durable mates from a parsed file ────────

describe('assembly-part-bridge — #9 hydrateAssembly', () => {
  it('hydrates components → rows and carries resolving mateConstraints through', () => {
    const file = parseAssemblyFile({
      version: 2,
      name: 'Bracket assy',
      components: [
        { id: 'base', name: 'Base', partPath: 'design/base.json', transform: { x: 0, y: 0, z: 0 }, grounded: true },
        { id: 'arm', name: 'Arm', partPath: 'design/arm.json', transform: { x: 60, y: 0, z: 0 } }
      ],
      mateConstraints: [
        {
          id: 'm1',
          kind: 'coincident',
          part1Id: 'base',
          feature1: { x: 0, y: 0, z: 0 },
          part2Id: 'arm',
          feature2: { x: 0, y: 0, z: 0 }
        }
      ]
    })
    const h = hydrateAssembly(file)
    expect(h.name).toBe('Bracket assy')
    expect(h.parts.map((p) => p.id)).toEqual(['base', 'arm'])
    expect(h.mateConstraints).toHaveLength(1)
    expect(h.danglingMateIds).toEqual([])
    // Mate refs resolve against the hydrated rows.
    const ids = new Set(h.parts.map((p) => p.id))
    expect(ids.has(h.mateConstraints[0]!.part1Id)).toBe(true)
    expect(ids.has(h.mateConstraints[0]!.part2Id)).toBe(true)
    // Hydrated rows have no live handle (geometry-not-loaded honesty).
    expect(h.parts.every((p) => !partHasLiveGeometry(p))).toBe(true)
  })

  it('filters + reports a dangling mate (a part ref that is not present)', () => {
    const file = parseAssemblyFile({
      version: 2,
      name: 'A',
      components: [
        { id: 'base', name: 'Base', partPath: 'design/base.json', transform: { x: 0, y: 0, z: 0 } }
      ],
      mateConstraints: [
        {
          id: 'stale',
          kind: 'coincident',
          part1Id: 'base',
          feature1: { x: 0, y: 0, z: 0 },
          part2Id: 'ghost',
          feature2: { x: 0, y: 0, z: 0 }
        }
      ]
    })
    const h = hydrateAssembly(file)
    expect(h.mateConstraints).toHaveLength(0)
    expect(h.danglingMateIds).toEqual(['stale'])
  })

  it('backward-compatible: a legacy file with no components/mates hydrates to empty', () => {
    const file = parseAssemblyFile({ name: 'Legacy' })
    const h = hydrateAssembly(file)
    expect(h.parts).toEqual([])
    expect(h.mateConstraints).toEqual([])
    expect(h.danglingMateIds).toEqual([])
  })
})
