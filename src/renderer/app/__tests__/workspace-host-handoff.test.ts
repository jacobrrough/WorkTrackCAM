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
import { describe, expect, it, vi } from 'vitest'
import {
  deriveSourceNameFromStlPath,
  runPersistMate,
  runSendToCam,
  solvedMateToInput,
  type QueuedCamImport
} from '../workspace-host-handoff'
import type { SolvedMate } from '../../design/AssemblyMatePanel'
import type { MateFormDraft } from '../../design/assembly-mate-form'
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
    normal2: ['0', '0', '1']
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
