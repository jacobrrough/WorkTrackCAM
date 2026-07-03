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
  runPersistMateConstraints,
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
    value: '0',
    axis1Cardinal: 'x',
    axis2Cardinal: 'x',
    angleDeg: '90'
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

  it('maps an ANGLE mate to a cardinal-axis + degrees input (NOT the plane fall-through)', () => {
    const mate: SolvedMate = {
      id: 'mate-angle-1',
      draft: { ...solvedPointMate().draft, kind: 'angle', axis1Cardinal: 'x', axis2Cardinal: 'x', angleDeg: '90' }
    }
    const input = solvedMateToInput(mate)
    expect(input).not.toBeNull()
    expect(input?.draft).toEqual({
      kind: 'angle',
      part1Id: 'base',
      part2Id: 'arm',
      axis1Cardinal: 'x',
      axis2Cardinal: 'x',
      angleDeg: 90
    })
    // Crucially NOT folded as a plane (no point/normal vectors leaked through).
    expect(input?.draft).not.toHaveProperty('normal1')
  })

  it('maps a TANGENT mate to cardinal axes with NO angle value (NOT the plane fall-through)', () => {
    const mate: SolvedMate = {
      id: 'mate-tangent-1',
      draft: { ...solvedPointMate().draft, kind: 'tangent', axis1Cardinal: 'y', axis2Cardinal: 'z' }
    }
    const input = solvedMateToInput(mate)
    expect(input?.draft).toEqual({
      kind: 'tangent',
      part1Id: 'base',
      part2Id: 'arm',
      axis1Cardinal: 'y',
      axis2Cardinal: 'z'
    })
    expect(input?.draft).not.toHaveProperty('angleDeg')
    expect(input?.draft).not.toHaveProperty('normal1')
  })

  it('returns null for an angle mate with a non-numeric degrees cell', () => {
    const mate: SolvedMate = {
      id: 'm',
      draft: { ...solvedPointMate().draft, kind: 'angle', angleDeg: 'abc' }
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

  it('persists an ANGLE mate through the full load → fold → save seam (round-trip shape)', async () => {
    // Revolute-hinge assembly so a reload+solve would converge; here we pin that
    // the host writes the correct persisted angle shape (the solver round-trip is
    // pinned exhaustively in assembly-mate-persist.test.ts).
    const loaded = parseAssemblyFile({
      version: 2,
      name: 'Hinge assy',
      components: [
        { id: 'base', name: 'Base', partPath: 'p', transform: { x: 0, y: 0, z: 0 }, grounded: true },
        { id: 'arm', name: 'Arm', partPath: 'q', transform: { x: 0, y: 0, z: 0 }, joint: 'revolute', revolutePreviewAxis: 'z' }
      ]
    })
    const loadAssembly = vi.fn(async () => loaded)
    const saveAssembly = vi.fn(async (_dir: string, _json: string) => {})
    const angleMate: SolvedMate = {
      id: 'mate-angle-1',
      draft: { ...solvedPointMate().draft, kind: 'angle', axis1Cardinal: 'x', axis2Cardinal: 'x', angleDeg: '90' }
    }

    const outcome = await runPersistMate({ mate: angleMate, projectDir: 'C:/proj', loadAssembly, saveAssembly })
    expect(outcome.ok).toBe(true)
    expect(saveAssembly).toHaveBeenCalledTimes(1)
    const [, jsonArg] = saveAssembly.mock.calls[0]!
    const reparsed = assemblyFileSchema.parse(JSON.parse(jsonArg as string))
    expect(reparsed.mateConstraints[0]).toMatchObject({
      id: 'mate-angle-1',
      kind: 'angle',
      part1Id: 'base',
      part2Id: 'arm',
      feature1: { axis: 'x' },
      feature2: { axis: 'x' },
      value: 90
    })
  })

  it('persists a TANGENT mate (no value) through the full seam', async () => {
    const loaded = twoPartAssembly()
    const saveAssembly = vi.fn(async (_dir: string, _json: string) => {})
    const tangentMate: SolvedMate = {
      id: 'mate-tangent-1',
      draft: { ...solvedPointMate().draft, kind: 'tangent', axis1Cardinal: 'y', axis2Cardinal: 'z' }
    }
    const outcome = await runPersistMate({
      mate: tangentMate,
      projectDir: 'C:/proj',
      loadAssembly: async () => loaded,
      saveAssembly
    })
    expect(outcome.ok).toBe(true)
    const [, jsonArg] = saveAssembly.mock.calls[0]!
    const reparsed = assemblyFileSchema.parse(JSON.parse(jsonArg as string))
    expect(reparsed.mateConstraints[0]).toMatchObject({
      id: 'mate-tangent-1',
      kind: 'tangent',
      feature1: { axis: 'y' },
      feature2: { axis: 'z' }
    })
    expect(reparsed.mateConstraints[0]!.value).toBeUndefined()
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

// ── (7) GAP 2 — a freshly-added mate refreshes the in-memory set (no route hop) ─
//
// BUG: adding a mate persisted it to assembly.json but did NOT update the
// in-memory `assemblyMates` fed to the solver, so a "Solve" right after adding a
// mate solved the OLD constraint set; the new mate only took effect after leaving
// and returning to the `assemble` route (which re-ran the hydrate effect).
//
// FIX (Option A): after a SUCCESSFUL `runPersistMate`, `handleMateAdded` re-runs
// `runHydrateAssembly` (re-reads assembly.json through the proven hydrate path),
// then `setAssemblyMates(...)` + bumps `hydrateToken` so DesignWorkspaceHost
// remounts with the fresh `initialAssemblyMates` seed → DesignWorkspace state →
// AssemblyView's `mateConstraints` (the `assembly:solve` input). The re-read runs
// inside the SAME matePersistChainRef link, i.e. strictly AFTER the save commits,
// so it never reads a stale base and never clobbers a concurrent save.
//
// These tests reproduce the host's persist→re-hydrate sequence over a single
// in-memory async store (load + save both yield a tick, as a real IPC would), so
// they prove the NEW mate reaches the refreshed mate set the host would push into
// `setAssemblyMates` — WITHOUT any route change.

describe('GAP 2 — handleMateAdded refreshes the in-memory mate set in-session', () => {
  /** A two-component assembly store; load + save both yield to the microtask queue. */
  function asyncAssemblyStore() {
    let onDisk = twoPartAssembly()
    return {
      get onDisk() {
        return onDisk
      },
      loadAssembly: async (): Promise<AssemblyFile> => {
        await Promise.resolve()
        return onDisk
      },
      saveAssembly: async (_dir: string, json: string): Promise<void> => {
        await Promise.resolve()
        onDisk = assemblyFileSchema.parse(JSON.parse(json))
      }
    }
  }

  /**
   * Faithful re-creation of `WorkspaceHost.handleMateAdded`'s chained body: persist
   * the mate, then on success re-hydrate and capture what the host would push into
   * `setAssemblyMates` / `setHydrateToken`. Returns the captured in-memory state so
   * a test can assert the new mate is visible to the solver WITHOUT a route hop.
   */
  async function addMateLikeHost(
    store: ReturnType<typeof asyncAssemblyStore>,
    mate: SolvedMate,
    projectDir: string | null
  ): Promise<{
    persistOk: boolean
    inMemoryMateIds: readonly string[]
    hydrateTokenBumps: number
  }> {
    let inMemoryMateIds: readonly string[] = []
    let hydrateTokenBumps = 0
    const outcome = await runPersistMate({
      mate,
      projectDir,
      loadAssembly: store.loadAssembly,
      saveAssembly: store.saveAssembly
    })
    if (!outcome.ok) {
      return { persistOk: false, inMemoryMateIds, hydrateTokenBumps }
    }
    const refreshed = await runHydrateAssembly({ projectDir, loadAssembly: store.loadAssembly })
    if (refreshed.ok) {
      // setAssemblyMates(refreshed.hydrated.mateConstraints) + setHydrateToken(t => t + 1)
      inMemoryMateIds = refreshed.hydrated.mateConstraints.map((m) => m.id)
      hydrateTokenBumps += 1
    }
    return { persistOk: true, inMemoryMateIds, hydrateTokenBumps }
  }

  it('a freshly-added mate appears in the re-hydrated in-memory mate set + bumps the token', async () => {
    const store = asyncAssemblyStore()
    expect(store.onDisk.mateConstraints).toHaveLength(0)

    const res = await addMateLikeHost(store, solvedPointMate(), 'C:/proj')

    expect(res.persistOk).toBe(true)
    // The NEW mate is now in the in-memory set the host pushes into setAssemblyMates
    // (→ AssemblyView mateConstraints → assembly:solve) — no route change needed.
    expect(res.inMemoryMateIds).toEqual(['mate-point-1'])
    // The remount-driving token bumped so initialAssemblyMates re-reads the seed.
    expect(res.hydrateTokenBumps).toBe(1)
  })

  it('two mates added back-to-back both reach the in-memory set (serialized, no lost update)', async () => {
    const store = asyncAssemblyStore()
    const mateA: SolvedMate = { id: 'mate-A', draft: { ...solvedPointMate().draft, point1: ['1', '0', '0'] } }
    const mateB: SolvedMate = { id: 'mate-B', draft: { ...solvedPointMate().draft, point1: ['2', '0', '0'] } }

    await addMateLikeHost(store, mateA, 'C:/proj')
    const res = await addMateLikeHost(store, mateB, 'C:/proj')

    // After the second add, the in-memory set the host pushes carries BOTH mates.
    expect([...res.inMemoryMateIds].sort()).toEqual(['mate-A', 'mate-B'])
    expect(store.onDisk.mateConstraints.map((m) => m.id).sort()).toEqual(['mate-A', 'mate-B'])
  })

  it('a FAILED persist (no project) does not refresh or bump the token', async () => {
    const store = asyncAssemblyStore()
    const res = await addMateLikeHost(store, solvedPointMate(), null)
    // runPersistMate returned ok:false (warn) — the host returns early, so the
    // in-memory set is untouched and no remount is forced.
    expect(res.persistOk).toBe(false)
    expect(res.inMemoryMateIds).toEqual([])
    expect(res.hydrateTokenBumps).toBe(0)
  })
})

// ── (8) GAP 2 — source pin: handleMateAdded re-hydrates after a successful persist
//
// Beyond the behavioral seam above, pin the WIRING in WorkspaceHost so a future
// refactor cannot drop the in-session refresh (which would silently regress GAP 2
// back to "Solve uses the old mate set until you leave and re-enter the route").

describe('WorkspaceHost.handleMateAdded refreshes mates in-session (source pin)', () => {
  const HOST_SRC = readFileSync(join(__dirname, '..', 'WorkspaceHost.tsx'), 'utf-8')

  /** The chained body of handleMateAdded (persist → toast → in-session refresh). */
  function handleMateAddedBody(): string {
    const start = HOST_SRC.indexOf('const handleMateAdded = useCallback(')
    expect(start).toBeGreaterThanOrEqual(0)
    const end = HOST_SRC.indexOf('const handleAssemblyPartsChange = useCallback(', start)
    expect(end).toBeGreaterThan(start)
    return HOST_SRC.slice(start, end)
  }

  it('re-runs runHydrateAssembly inside handleMateAdded (not only the hydrate effect)', () => {
    const body = handleMateAddedBody()
    expect(body).toContain('await runPersistMate(')
    expect(body).toContain('await runHydrateAssembly(')
  })

  it('pushes the refreshed mates into state and bumps hydrateToken (forces the remount)', () => {
    const body = handleMateAddedBody()
    expect(body).toContain('setAssemblyMates(')
    expect(body).toContain('setHydrateToken((t) => t + 1)')
    // The refresh is GATED on a successful persist (so a warn/error never forces a
    // pointless remount, and a null projectDir — which makes runPersistMate fail —
    // never reaches runHydrateAssembly).
    expect(body).toContain('if (!outcome.ok) return')
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

// ── (5) runPersistMateConstraints — mate LIST edit persistence ────────────────
//
// The Mates-panel delete / edit-scalar / suppress round-trip. The renderer applies
// the pure fold and hands the FULL desired list here; this runner reloads the REAL
// assembly, swaps ONLY `mateConstraints` (preserving `components`), and re-saves.

describe('runPersistMateConstraints — load → replace mateConstraints → save', () => {
  const A_MATE = {
    id: 'm1',
    kind: 'coincident' as const,
    part1Id: 'base',
    feature1: { x: 0, y: 0, z: 0 },
    part2Id: 'arm',
    feature2: { x: 0, y: 0, z: 0 }
  }

  it('replaces the on-disk mate list while PRESERVING components', async () => {
    // On disk: two components + one mate. The renderer deletes it → empty list.
    const loaded = parseAssemblyFile({
      version: 2,
      name: 'A',
      components: [
        { id: 'base', name: 'Base', partPath: 'p', transform: { x: 0, y: 0, z: 0 } },
        { id: 'arm', name: 'Arm', partPath: 'q', transform: { x: 0, y: 0, z: 0 } }
      ],
      mateConstraints: [A_MATE]
    })
    const loadAssembly = vi.fn(async () => loaded)
    const saveAssembly = vi.fn(async (_dir: string, _json: string) => {})

    const outcome = await runPersistMateConstraints({
      mateConstraints: [], // deleted the only mate
      projectDir: 'C:/proj',
      loadAssembly,
      saveAssembly
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.mateCount).toBe(0)
    expect(saveAssembly).toHaveBeenCalledTimes(1)
    const [, jsonArg] = saveAssembly.mock.calls[0]!
    const reparsed = assemblyFileSchema.parse(JSON.parse(jsonArg as string))
    expect(reparsed.mateConstraints).toHaveLength(0)
    // components untouched by a mate-only edit.
    expect(reparsed.components.map((c) => c.id)).toEqual(['base', 'arm'])
  })

  it('persists an edited scalar + a suppress flag together', async () => {
    const loaded = parseAssemblyFile({
      version: 2,
      name: 'A',
      components: [
        { id: 'base', name: 'Base', partPath: 'p', transform: { x: 0, y: 0, z: 0 } },
        { id: 'arm', name: 'Arm', partPath: 'q', transform: { x: 0, y: 0, z: 0 } }
      ],
      mateConstraints: []
    })
    const saveAssembly = vi.fn(async (_dir: string, _json: string) => {})
    const outcome = await runPersistMateConstraints({
      mateConstraints: [
        { id: 'd', kind: 'distance', part1Id: 'base', feature1: { x: 0, y: 0, z: 0 }, part2Id: 'arm', feature2: { x: 0, y: 0, z: 0 }, value: 42 },
        { id: 'a', kind: 'angle', part1Id: 'base', feature1: { axis: 'x' }, part2Id: 'arm', feature2: { axis: 'x' }, value: 30, suppress: true }
      ],
      projectDir: 'C:/proj',
      loadAssembly: async () => loaded,
      saveAssembly
    })
    expect(outcome.ok).toBe(true)
    const [, jsonArg] = saveAssembly.mock.calls[0]!
    const reparsed = assemblyFileSchema.parse(JSON.parse(jsonArg as string))
    expect(reparsed.mateConstraints.find((c) => c.id === 'd')!.value).toBe(42)
    expect(reparsed.mateConstraints.find((c) => c.id === 'a')!.suppress).toBe(true)
  })

  it('no open project → clean no-op success, NO load/save', async () => {
    const loadAssembly = vi.fn(async () => twoPartAssembly())
    const saveAssembly = vi.fn(async () => {})
    const outcome = await runPersistMateConstraints({
      mateConstraints: [A_MATE],
      projectDir: null,
      loadAssembly,
      saveAssembly
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.mateCount).toBe(0)
    expect(loadAssembly).not.toHaveBeenCalled()
    expect(saveAssembly).not.toHaveBeenCalled()
  })

  it('surfaces a save failure as a reason (no throw)', async () => {
    const outcome = await runPersistMateConstraints({
      mateConstraints: [],
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
