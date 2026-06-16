/**
 * Pin: the two CAD↔CAM bridges `WorkspaceHost` wires in Wave 3h, exercised
 * through their pure, React-free seam (`workspace-host-handoff`). The renderer
 * test env is node (no DOM renderer / no real click — see the sibling
 * `DesignWorkspaceHost.dxf-import.test.tsx`), so the load-bearing behavior of the
 * two formerly-stub handlers is pinned here directly, the same way
 * `cam-handoff-store` / `assembly-mate-persist` pin their cores.
 *
 * (1) Send-to-CAM hand-off (`runSendToCam`):
 *     - SETS the pending CAM import (mailbox) with the STL path + a derived
 *       source name, THEN navigates to Manufacture — in that ORDER (mailbox must
 *       be populated before the route switch that mounts ManufactureHost);
 *     - returns an honest toast naming the part + the target machine;
 *     - a blank stlPath is rejected: no queue, no navigation, error toast.
 *
 * (2) Assembly mate persistence (`runPersistMate` + `solvedMateToInput`):
 *     - adapts the renderer SolvedMate (string vector cells) → the shared
 *       SolvedMateInput (number 3-vectors);
 *     - LOADS the assembly, folds the solved mate into `mateConstraints`, and
 *       SAVES the updated assembly (the save payload round-trips through the
 *       schema the `assembly:save` IPC re-validates);
 *     - no open project ⇒ warn toast, NO load + NO save;
 *     - a malformed draft ⇒ error toast, load may run but NO save.
 *
 * SAFETY: data-only seam — no G-code is produced anywhere in this path.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  deriveSourceNameFromStlPath,
  runHydrateAssembly,
  runPersistAssemblyParts,
  runPersistMate,
  runSendToCam,
  solvedMateToInput,
  type QueuedCamImport
} from '../workspace-host-handoff'
import type { SolvedMate } from '../../design/AssemblyMatePanel'
import type { MateFormDraft } from '../../design/assembly-mate-form'
import type { AssemblyPart } from '../../design/AssemblyView'
import {
  assemblyFileSchema,
  parseAssemblyFile,
  type AssemblyFile
} from '../../../shared/assembly-schema'

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A solved point-mate as the AssemblyMatePanel hands it back (string cells). */
function solvedPointMate(): SolvedMate {
  const draft: MateFormDraft = {
    kind: 'point',
    part1Id: 'base',
    part2Id: 'arm',
    point1: ['10', '0', '0'],
    point2: ['0', '5', '-3'],
    axis1: ['0', '0', '1'],
    axis2: ['0', '0', '1'],
    normal1: ['0', '0', '1'],
    normal2: ['0', '0', '1'],
    value: '0'
  }
  return { id: 'mate-point-1', draft }
}

/** A two-component assembly the mate references (v2, canonical). */
function twoPartAssembly(): AssemblyFile {
  return parseAssemblyFile({
    version: 2,
    name: 'Bracket assy',
    components: [
      { id: 'base', name: 'Base', partPath: 'design/sketch.json', transform: { x: 0, y: 0, z: 0 }, grounded: true },
      { id: 'arm', name: 'Arm', partPath: 'design/arm.json', transform: { x: 0, y: 0, z: 0 } }
    ]
  })
}

// ── (1) Send-to-CAM ──────────────────────────────────────────────────────────

describe('deriveSourceNameFromStlPath', () => {
  it('takes the file stem from a windows or posix path', () => {
    expect(deriveSourceNameFromStlPath('C:/proj/output/design-123.stl')).toBe('design-123')
    expect(deriveSourceNameFromStlPath('C:\\proj\\output\\widget.stl')).toBe('widget')
    expect(deriveSourceNameFromStlPath('/tmp/bracket.STL')).toBe('bracket')
  })

  it('returns null when no usable stem remains', () => {
    expect(deriveSourceNameFromStlPath('')).toBeNull()
    expect(deriveSourceNameFromStlPath('/tmp/.stl')).toBeNull()
  })
})

describe('runSendToCam — queue then navigate', () => {
  it('sets the pending import (path + derived name) BEFORE navigating', () => {
    const calls: string[] = []
    let queued: QueuedCamImport | null = null
    const result = runSendToCam({
      stlPath: 'C:/proj/output/design-42.stl',
      machineLabel: 'K2 Plus',
      setPendingCamImport: (req) => {
        queued = req
        calls.push('queue')
      },
      navigateToManufacture: () => calls.push('navigate')
    })

    expect(result.ok).toBe(true)
    // Order is load-bearing: the mailbox must be populated before the route
    // switch mounts ManufactureHost (whose consume effect reads the slot).
    expect(calls).toEqual(['queue', 'navigate'])
    expect(queued).toEqual({ stlPath: 'C:/proj/output/design-42.stl', sourceName: 'design-42' })
  })

  it('toasts an honest "sending <part> to <machine>" message naming both', () => {
    const result = runSendToCam({
      stlPath: '/tmp/gizmo.stl',
      machineLabel: 'Carvera',
      setPendingCamImport: () => {},
      navigateToManufacture: () => {}
    })
    expect(result.ok).toBe(true)
    expect(result.toast.kind).toBe('ok')
    expect(result.toast.message).toContain('gizmo')
    expect(result.toast.message).toContain('Carvera')
  })

  it('honors an explicit sourceName over the derived stem', () => {
    let queued: QueuedCamImport | null = null
    runSendToCam({
      stlPath: '/tmp/design-99.stl',
      sourceName: 'Front Panel',
      machineLabel: 'Laguna Swift',
      setPendingCamImport: (req) => {
        queued = req
      },
      navigateToManufacture: () => {}
    })
    expect(queued).toEqual({ stlPath: '/tmp/design-99.stl', sourceName: 'Front Panel' })
  })

  it('falls back to a generic "CAM" target when no machine is active', () => {
    const result = runSendToCam({
      stlPath: '/tmp/part.stl',
      machineLabel: null,
      setPendingCamImport: () => {},
      navigateToManufacture: () => {}
    })
    expect(result.ok).toBe(true)
    expect(result.toast.message).toContain('CAM')
  })

  it('rejects a blank stlPath: no queue, no navigation, error toast', () => {
    const setPendingCamImport = vi.fn()
    const navigateToManufacture = vi.fn()
    const result = runSendToCam({
      stlPath: '   ',
      machineLabel: 'K2 Plus',
      setPendingCamImport,
      navigateToManufacture
    })
    expect(result.ok).toBe(false)
    expect(result.toast.kind).toBe('err')
    expect(setPendingCamImport).not.toHaveBeenCalled()
    expect(navigateToManufacture).not.toHaveBeenCalled()
  })
})

// ── (2) mate persistence: adapter ────────────────────────────────────────────

describe('solvedMateToInput — string draft → number input', () => {
  it('parses point vectors into finite number tuples', () => {
    const input = solvedMateToInput(solvedPointMate())
    expect(input).not.toBeNull()
    expect(input).toEqual({
      id: 'mate-point-1',
      draft: { kind: 'point', part1Id: 'base', part2Id: 'arm', point1: [10, 0, 0], point2: [0, 5, -3] }
    })
  })

  it('parses axis vectors for an axis mate', () => {
    const mate: SolvedMate = {
      id: 'mate-axis-1',
      draft: { ...solvedPointMate().draft, kind: 'axis', axis1: ['0', '0', '1'], axis2: ['1', '0', '0'] }
    }
    const input = solvedMateToInput(mate)
    expect(input?.draft).toMatchObject({ kind: 'axis', axis1: [0, 0, 1], axis2: [1, 0, 0] })
  })

  it('parses origin + normal for a plane mate', () => {
    const mate: SolvedMate = {
      id: 'mate-plane-1',
      draft: {
        ...solvedPointMate().draft,
        kind: 'plane',
        point1: ['1', '2', '3'],
        normal1: ['0', '1', '0'],
        point2: ['4', '5', '6'],
        normal2: ['0', '1', '0']
      }
    }
    const input = solvedMateToInput(mate)
    expect(input?.draft).toMatchObject({
      kind: 'plane',
      point1: [1, 2, 3],
      normal1: [0, 1, 0],
      point2: [4, 5, 6],
      normal2: [0, 1, 0]
    })
  })

  it('returns null when a required cell is blank / non-numeric', () => {
    const mate: SolvedMate = {
      id: 'm',
      draft: { ...solvedPointMate().draft, point1: ['10', '', '0'] }
    }
    expect(solvedMateToInput(mate)).toBeNull()
  })
})

// ── (2) mate persistence: full seam ──────────────────────────────────────────

describe('runPersistMate — load → fold → save', () => {
  it('loads the assembly, folds the mate in, and saves the updated assembly', async () => {
    const loaded = twoPartAssembly()
    const loadAssembly = vi.fn(async () => loaded)
    const saveAssembly = vi.fn(async (_dir: string, _json: string) => {})

    const outcome = await runPersistMate({
      mate: solvedPointMate(),
      projectDir: 'C:/proj',
      loadAssembly,
      saveAssembly
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.toast.kind).toBe('ok')
    expect(loadAssembly).toHaveBeenCalledWith('C:/proj')
    expect(saveAssembly).toHaveBeenCalledTimes(1)

    // The persisted JSON parses + carries the new coincident constraint, and it
    // survives the exact schema validation the `assembly:save` IPC performs.
    const [dirArg, jsonArg] = saveAssembly.mock.calls[0]!
    expect(dirArg).toBe('C:/proj')
    const reparsed = assemblyFileSchema.parse(JSON.parse(jsonArg as string))
    expect(reparsed.mateConstraints).toHaveLength(1)
    expect(reparsed.mateConstraints[0]).toMatchObject({
      id: 'mate-point-1',
      kind: 'coincident',
      part1Id: 'base',
      part2Id: 'arm',
      feature1: { x: 10, y: 0, z: 0 },
      feature2: { x: 0, y: 5, z: -3 }
    })
  })

  it('with no open project: warns and never loads or saves', async () => {
    const loadAssembly = vi.fn(async () => twoPartAssembly())
    const saveAssembly = vi.fn(async () => {})

    const outcome = await runPersistMate({
      mate: solvedPointMate(),
      projectDir: null,
      loadAssembly,
      saveAssembly
    })

    expect(outcome.ok).toBe(false)
    expect(outcome.toast.kind).toBe('warn')
    expect(loadAssembly).not.toHaveBeenCalled()
    expect(saveAssembly).not.toHaveBeenCalled()
  })

  it('rejects a self-mate (same part twice): error toast, NO save', async () => {
    const saveAssembly = vi.fn(async () => {})
    const selfMate: SolvedMate = {
      id: 'm',
      draft: { ...solvedPointMate().draft, part2Id: 'base' } // base ↔ base
    }
    const outcome = await runPersistMate({
      mate: selfMate,
      projectDir: 'C:/proj',
      loadAssembly: async () => twoPartAssembly(),
      saveAssembly
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.toast.kind).toBe('err')
    expect(saveAssembly).not.toHaveBeenCalled()
  })

  it('surfaces a load failure as an error toast (no save)', async () => {
    const saveAssembly = vi.fn(async () => {})
    const outcome = await runPersistMate({
      mate: solvedPointMate(),
      projectDir: 'C:/proj',
      loadAssembly: async () => {
        throw new Error('assembly.json — boom')
      },
      saveAssembly
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.toast.kind).toBe('err')
    expect(outcome.toast.message).toContain('boom')
    expect(saveAssembly).not.toHaveBeenCalled()
  })

  it('surfaces a save failure honestly (solved but not saved)', async () => {
    const outcome = await runPersistMate({
      mate: solvedPointMate(),
      projectDir: 'C:/proj',
      loadAssembly: async () => twoPartAssembly(),
      saveAssembly: async () => {
        throw new Error('disk full')
      }
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.toast.kind).toBe('err')
    expect(outcome.toast.message).toContain('disk full')
  })

  it('re-persisting the same mate id replaces in place (idempotent, no duplicate)', async () => {
    let onDisk = twoPartAssembly()
    const loadAssembly = vi.fn(async () => onDisk)
    const saveAssembly = vi.fn(async (_dir: string, json: string) => {
      onDisk = assemblyFileSchema.parse(JSON.parse(json))
    })

    await runPersistMate({ mate: solvedPointMate(), projectDir: 'C:/proj', loadAssembly, saveAssembly })
    // Re-solve the SAME id with moved points.
    const moved: SolvedMate = {
      id: 'mate-point-1',
      draft: { ...solvedPointMate().draft, point1: ['99', '0', '0'] }
    }
    await runPersistMate({ mate: moved, projectDir: 'C:/proj', loadAssembly, saveAssembly })

    expect(onDisk.mateConstraints).toHaveLength(1)
    expect(onDisk.mateConstraints[0]!.feature1).toMatchObject({ x: 99 })
  })
})

// ── (3) concurrent mate persistence — the lost-update race + the serialized fix ─
//
// `WorkspaceHost.handleMateAdded` fires `runPersistMate` (a load→fold→save over
// assembly.json) per solved mate, and the AssemblyMatePanel re-enables its Solve
// button the instant the solve IPC resolves — BEFORE this persist's save lands.
// Two mates solved in quick succession therefore overlap. These tests drive that
// overlap against a single in-memory store with ASYNC load + save (a real IPC
// round-trip is async), so two un-chained persists read the same stale base.

describe('concurrent mate persistence (the WorkspaceHost.handleMateAdded race)', () => {
  /** A two-component assembly store; load + save both yield to the microtask queue. */
  function asyncAssemblyStore() {
    let onDisk = twoPartAssembly()
    return {
      get onDisk() {
        return onDisk
      },
      // Async load: yields a tick before returning the current snapshot, so two
      // overlapping persists both read the SAME base (the lost-update window).
      loadAssembly: async (): Promise<AssemblyFile> => {
        await Promise.resolve()
        return onDisk
      },
      // Async save: yields a tick, then commits (re-parsed exactly as the IPC does).
      saveAssembly: async (_dir: string, json: string): Promise<void> => {
        await Promise.resolve()
        onDisk = assemblyFileSchema.parse(JSON.parse(json))
      }
    }
  }

  function mateA(): SolvedMate {
    return { id: 'mate-A', draft: { ...solvedPointMate().draft, point1: ['1', '0', '0'] } }
  }
  function mateB(): SolvedMate {
    return {
      id: 'mate-B',
      draft: { ...solvedPointMate().draft, part1Id: 'base', part2Id: 'arm', point1: ['2', '0', '0'] }
    }
  }

  it('UNSERIALIZED persists stale-base each other → one mate is silently dropped (the BUG)', async () => {
    const store = asyncAssemblyStore()
    // Both persists start NOW (no chaining). Each awaits loadAssembly (one tick),
    // both observe the empty base, each folds its own mate and saves — the second
    // save overwrites the first because it never saw the first's mate.
    const pA = runPersistMate({
      mate: mateA(),
      projectDir: 'C:/proj',
      loadAssembly: store.loadAssembly,
      saveAssembly: store.saveAssembly
    })
    const pB = runPersistMate({
      mate: mateB(),
      projectDir: 'C:/proj',
      loadAssembly: store.loadAssembly,
      saveAssembly: store.saveAssembly
    })
    await Promise.all([pA, pB])
    // Last writer wins on a stale base → only ONE constraint survives.
    expect(store.onDisk.mateConstraints).toHaveLength(1)
  })

  it('SERIALIZED via a promise chain (the WorkspaceHost fix) → BOTH mates survive', async () => {
    const store = asyncAssemblyStore()
    // Mirror handleMateAdded: chain each persist onto the previous one. Each
    // link's loadAssembly runs only after the prior link's save committed, so the
    // second fold sees the first mate already on disk.
    let chain: Promise<void> = Promise.resolve()
    const enqueue = (mate: SolvedMate): void => {
      chain = chain.catch(() => {}).then(async () => {
        await runPersistMate({
          mate,
          projectDir: 'C:/proj',
          loadAssembly: store.loadAssembly,
          saveAssembly: store.saveAssembly
        })
      })
    }
    enqueue(mateA())
    enqueue(mateB())
    await chain
    const ids = store.onDisk.mateConstraints.map((c) => c.id).sort()
    expect(ids).toEqual(['mate-A', 'mate-B'])
  })
})

// ── (4) source pin — WorkspaceHost serializes the persist ─────────────────────

describe('WorkspaceHost serializes mate persistence (source pin)', () => {
  const HOST_SRC = readFileSync(join(__dirname, '..', 'WorkspaceHost.tsx'), 'utf-8')

  it('holds a promise-chain ref and chains each persist onto the previous', () => {
    expect(HOST_SRC).toContain(
      'const matePersistChainRef = useRef<Promise<void>>(Promise.resolve())'
    )
    expect(HOST_SRC).toContain('matePersistChainRef.current = matePersistChainRef.current')
    // The pre-fix fire-and-forget shape (an un-chained IIFE) must be gone.
    expect(HOST_SRC).not.toContain('void (async () => {\n        const outcome = await runPersistMate(')
  })

  it('routes assembly parts persistence through the SAME chain (no parts/mate stale-base)', () => {
    // The #8 parts-persist write must serialize against the mate-persist write,
    // else a parts-save + a mate-save could load the same stale base and one
    // would drop the other. Pin that handleAssemblyPartsChange reuses the chain.
    expect(HOST_SRC).toContain('runPersistAssemblyParts')
    expect(HOST_SRC).toContain('const handleAssemblyPartsChange = useCallback(')
    // Both handlers advance the SAME ref (so they cannot interleave).
    const chainAdvances = HOST_SRC.split(
      'matePersistChainRef.current = matePersistChainRef.current'
    ).length - 1
    expect(chainAdvances).toBeGreaterThanOrEqual(2)
  })

  it('hydrates the assembly on the assemble route and threads the seed down', () => {
    expect(HOST_SRC).toContain('runHydrateAssembly')
    // The hydrate result seeds the inner DesignWorkspaceHost (mount-only props).
    expect(HOST_SRC).toContain('initialAssemblyParts={assemblyParts}')
    expect(HOST_SRC).toContain('initialAssemblyMates={assemblyMates}')
    expect(HOST_SRC).toContain('onAssemblyPartsChange={handleAssemblyPartsChange}')
  })
})

// ── (5) runHydrateAssembly — load → hydrate (the #9 reload surface seam) ───────

describe('runHydrateAssembly — load → hydrate', () => {
  it('loads assembly.json and hydrates components → parts + mates', async () => {
    const loaded = parseAssemblyFile({
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
    const loadAssembly = vi.fn(async () => loaded)
    const outcome = await runHydrateAssembly({ projectDir: 'C:/proj', loadAssembly })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(loadAssembly).toHaveBeenCalledWith('C:/proj')
    expect(outcome.hydrated.parts.map((p) => p.id)).toEqual(['base', 'arm'])
    expect(outcome.hydrated.mateConstraints).toHaveLength(1)
    // Mate refs resolve against the hydrated rows (no dangling).
    const ids = new Set(outcome.hydrated.parts.map((p) => p.id))
    expect(ids.has(outcome.hydrated.mateConstraints[0]!.part1Id)).toBe(true)
  })

  it('no open project → clean empty hydrate, NO load', async () => {
    const loadAssembly = vi.fn(async () => twoPartAssembly())
    const outcome = await runHydrateAssembly({ projectDir: null, loadAssembly })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(loadAssembly).not.toHaveBeenCalled()
    expect(outcome.hydrated.parts).toEqual([])
    expect(outcome.hydrated.mateConstraints).toEqual([])
  })

  it('surfaces a load failure as a reason (no throw)', async () => {
    const outcome = await runHydrateAssembly({
      projectDir: 'C:/proj',
      loadAssembly: async () => {
        throw new Error('assembly.json — boom')
      }
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('boom')
  })
})

// ── (6) runPersistAssemblyParts — parts → components (#8) ──────────────────────

describe('runPersistAssemblyParts — fold rows into components, preserve mates', () => {
  const ROWS: readonly AssemblyPart[] = [
    { id: 'base', name: 'Base', handle: 'script:1', geometrySource: 'design/base.json' },
    {
      id: 'arm',
      name: 'Arm',
      handle: 'script:1',
      geometrySource: 'design/arm.json',
      transform: { position: [60, 0, 0] }
    }
  ]

  it('loads, replaces components from rows, and saves a schema-valid assembly', async () => {
    const loaded = parseAssemblyFile({ version: 2, name: 'A', components: [], mateConstraints: [] })
    const loadAssembly = vi.fn(async () => loaded)
    const saveAssembly = vi.fn(async (_dir: string, _json: string) => {})

    const outcome = await runPersistAssemblyParts({
      parts: ROWS,
      projectDir: 'C:/proj',
      loadAssembly,
      saveAssembly
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.componentCount).toBe(2)
    expect(saveAssembly).toHaveBeenCalledTimes(1)
    const [, jsonArg] = saveAssembly.mock.calls[0]!
    const reparsed = assemblyFileSchema.parse(JSON.parse(jsonArg as string))
    expect(reparsed.components.map((c) => c.id)).toEqual(['base', 'arm'])
    // Each component carries its OWN durable geometry source (#11) — the renderer
    // row's geometrySource rides through as the structured `geometrySource.handle`.
    expect(reparsed.components.map((c) => c.geometrySource?.handle)).toEqual([
      'design/base.json',
      'design/arm.json'
    ])
    // Every component has a non-empty partPath (schema requirement) — synthesized
    // from the id when the row carried no explicit path.
    expect(reparsed.components.every((c) => c.partPath.length > 0)).toBe(true)
  })

  it('PRESERVES existing mateConstraints whose refs still resolve', async () => {
    const loaded = parseAssemblyFile({
      version: 2,
      name: 'A',
      components: [],
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
    let onDisk = loaded
    const outcome = await runPersistAssemblyParts({
      parts: ROWS,
      projectDir: 'C:/proj',
      loadAssembly: async () => onDisk,
      saveAssembly: async (_dir, json) => {
        onDisk = assemblyFileSchema.parse(JSON.parse(json))
      }
    })
    expect(outcome.ok).toBe(true)
    // The mate referencing base↔arm survives because both rows persisted.
    expect(onDisk.mateConstraints).toHaveLength(1)
  })

  it('PRUNES a mate whose part ref no longer exists among the rows', async () => {
    const loaded = parseAssemblyFile({
      version: 2,
      name: 'A',
      components: [],
      mateConstraints: [
        {
          id: 'stale',
          kind: 'coincident',
          part1Id: 'base',
          feature1: { x: 0, y: 0, z: 0 },
          part2Id: 'ghost', // 'ghost' is NOT in ROWS
          feature2: { x: 0, y: 0, z: 0 }
        }
      ]
    })
    let onDisk = loaded
    await runPersistAssemblyParts({
      parts: ROWS,
      projectDir: 'C:/proj',
      loadAssembly: async () => onDisk,
      saveAssembly: async (_dir, json) => {
        onDisk = assemblyFileSchema.parse(JSON.parse(json))
      }
    })
    // The dangling constraint is dropped so the persisted file stays consistent.
    expect(onDisk.mateConstraints).toHaveLength(0)
  })

  it('no open project → clean no-op success, NO load/save', async () => {
    const loadAssembly = vi.fn(async () => twoPartAssembly())
    const saveAssembly = vi.fn(async () => {})
    const outcome = await runPersistAssemblyParts({
      parts: ROWS,
      projectDir: null,
      loadAssembly,
      saveAssembly
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.componentCount).toBe(0)
    expect(loadAssembly).not.toHaveBeenCalled()
    expect(saveAssembly).not.toHaveBeenCalled()
  })

  it('surfaces a save failure as a reason (no throw)', async () => {
    const outcome = await runPersistAssemblyParts({
      parts: ROWS,
      projectDir: 'C:/proj',
      loadAssembly: async () => parseAssemblyFile({ version: 2, name: 'A', components: [], mateConstraints: [] }),
      saveAssembly: async () => {
        throw new Error('disk full')
      }
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('disk full')
  })
})
