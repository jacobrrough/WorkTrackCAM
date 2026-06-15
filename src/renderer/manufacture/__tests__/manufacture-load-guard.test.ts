/**
 * Regression pins for the Manufacture-side "disappearing-sketch"-class bugs
 * (the Cycle-249 clobber shape, hunted in the CAM runtime).
 *
 * TWO destructive paths could wipe the operator's UNSAVED in-memory manufacture
 * plan (`mfg` lives in a `useState`; setups/ops/plates are not written to disk
 * until an explicit Save):
 *
 *   1. The workspace's disk-load effect calls `setMfg(loaded)`, REPLACING the
 *      in-memory plan with the on-disk copy. It is keyed on
 *      `[fab, projectDir, reloadNonce]`; a spurious re-fire would re-read disk
 *      over unsaved edits. FIX: `manufactureLoadKey(projectDir, reloadNonce)` +
 *      a `lastManufactureLoadKeyRef` guard skip a redundant reload (mirrors
 *      DesignSessionContext's `designLoadKey` + `lastDesignLoadKeyRef`).
 *
 *   2. The Design→Manufacture "Send to CAM" hand-off USED to run entirely in
 *      `ManufactureHost`: it loaded the plan FROM DISK, merged the imported STL,
 *      saved, then bumped `reloadNonce` to force a disk re-read. That disk read
 *      happened WITHOUT the operator's unsaved edits, so the merge+save+reload
 *      silently discarded them (the DXF-import persistence-race). FIX: the host
 *      now hands the imported mesh to the workspace via the one-shot
 *      `requestedMeshImport` prop; the workspace folds it into the LIVE plan via
 *      `mergeMeshImportIntoLivePlan` and persists — unsaved edits survive.
 *
 * The renderer test env is `node` (no jsdom / @testing-library), so the effects
 * themselves can't be mounted — the load-key + live-merge SEMANTICS are
 * unit-tested and the effect/mount-site WIRING is source-pinned (the same
 * convention DesignSessionContext.reload-guard.test.ts uses).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  manufactureLoadKey,
  mergeMeshImportIntoLivePlan,
  type PendingMeshImport
} from '../manufacture-load-guard'
import {
  emptyManufacture,
  manufactureFileSchema,
  type ManufactureFile,
  type ManufactureOperation,
  type Plate
} from '../../../shared/manufacture-schema'

const WORKSPACE_SRC = readFileSync(
  join(__dirname, '..', 'ManufactureWorkspace.tsx'),
  'utf-8'
)
const HOST_SRC = readFileSync(
  join(__dirname, '..', '..', 'app', 'ManufactureHost.tsx'),
  'utf-8'
)

function op(over: Partial<ManufactureOperation> = {}): ManufactureOperation {
  return { id: 'op-1', kind: 'cnc_pocket', label: 'Pocket 1', ...over }
}
function plate(over: Partial<Plate> = {}): Plate {
  return { id: 'plate-1', label: 'Plate 1', setups: [], operations: [], ...over }
}

describe('manufactureLoadKey — the anti-clobber identity', () => {
  it('no project open → null (nothing to load, nothing to clobber)', () => {
    expect(manufactureLoadKey(null, 0)).toBeNull()
    expect(manufactureLoadKey(null, undefined)).toBeNull()
    expect(manufactureLoadKey(null, 5)).toBeNull()
  })

  it('same (projectDir, reloadNonce) → identical key (a re-render must NOT reload)', () => {
    const a = manufactureLoadKey('/proj/alpha', 0)
    const b = manufactureLoadKey('/proj/alpha', 0)
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it('undefined reloadNonce is treated as 0 (stable across renders before any bump)', () => {
    expect(manufactureLoadKey('/proj/alpha', undefined)).toBe(manufactureLoadKey('/proj/alpha', 0))
  })

  it('a different project → different key (a genuine reload)', () => {
    expect(manufactureLoadKey('/proj/alpha', 0)).not.toBe(manufactureLoadKey('/proj/beta', 0))
  })

  it('a bumped reloadNonce → different key (a genuine host-driven reload)', () => {
    expect(manufactureLoadKey('/proj/alpha', 0)).not.toBe(manufactureLoadKey('/proj/alpha', 1))
  })

  it('Windows-style paths with backslashes key cleanly (no escape collisions)', () => {
    const a = manufactureLoadKey('C:\\Users\\jacob\\proj', 2)
    const b = manufactureLoadKey('C:\\Users\\jacob\\proj', 2)
    expect(a).toBe(b)
    expect(a).not.toBe(manufactureLoadKey('C:\\Users\\jacob\\proj2', 2))
  })
})

describe('mergeMeshImportIntoLivePlan — folds the import into the LIVE plan', () => {
  it('binds the mesh onto the live first op WITHOUT discarding the operator\'s other ops', () => {
    // The "live" plan carries an unsaved second op the operator just added. The
    // import must land on the first op and leave the unsaved op intact — the
    // whole point of merging into the live plan instead of stale disk.
    const live: ManufactureFile = {
      version: 2,
      setups: [],
      operations: [],
      plates: [
        plate({
          operations: [
            op({ id: 'a', kind: 'cnc_pocket', label: 'Pocket A' }),
            op({ id: 'unsaved', kind: 'cnc_contour', label: 'Just-added contour' })
          ]
        })
      ]
    }
    const req: PendingMeshImport = { relPath: 'assets/new.stl', env: 'cnc' }
    const next = mergeMeshImportIntoLivePlan(live, req)
    const ops = next.plates![0]!.operations
    expect(ops[0]).toEqual({ id: 'a', kind: 'cnc_pocket', label: 'Pocket A', sourceMesh: 'assets/new.stl' })
    // The operator's unsaved op is STILL THERE (this is the bug-class assertion).
    expect(ops[1]).toEqual({ id: 'unsaved', kind: 'cnc_contour', label: 'Just-added contour' })
    expect(ops).toHaveLength(2)
  })

  it('seeds an env-appropriate op when the live first plate is empty', () => {
    const fdm = mergeMeshImportIntoLivePlan(emptyManufacture(), {
      relPath: 'assets/widget.stl',
      env: 'fdm'
    })
    expect(fdm.plates![0]!.operations[0]!.kind).toBe('fdm_slice')
    expect(fdm.plates![0]!.operations[0]!.sourceMesh).toBe('assets/widget.stl')

    const cnc = mergeMeshImportIntoLivePlan(emptyManufacture(), {
      relPath: 'assets/part.stl',
      env: 'cnc',
      opLabel: 'Bracket'
    })
    expect(cnc.plates![0]!.operations[0]!.kind).toBe('cnc_parallel')
    expect(cnc.plates![0]!.operations[0]!.label).toBe('Bracket')
  })

  it('is idempotent on the existing-op path (a StrictMode double-invoke can\'t double-bind)', () => {
    // Applying twice via the functional-updater chain (run2 sees run1\'s output)
    // must produce the SAME plan — no duplicate ops, no lost ops.
    const live = emptyManufacture()
    const req: PendingMeshImport = { relPath: 'assets/part.stl', env: 'cnc', opLabel: 'P' }
    const once = mergeMeshImportIntoLivePlan(live, req)
    const twice = mergeMeshImportIntoLivePlan(once, req)
    // Second application binds onto the now-existing op (does NOT seed a 2nd op).
    expect(twice.plates![0]!.operations).toHaveLength(1)
    expect(twice.plates![0]!.operations[0]!.sourceMesh).toBe('assets/part.stl')
  })

  it('never mutates the input plan and produces a schema-valid file', () => {
    const live = emptyManufacture()
    const snapshot = JSON.stringify(live)
    const next = mergeMeshImportIntoLivePlan(live, { relPath: 'assets/part.stl', env: 'fdm' })
    expect(JSON.stringify(live)).toBe(snapshot)
    expect(manufactureFileSchema.safeParse(next).success).toBe(true)
  })

  it('normalizes a Windows-style / root-anchored mesh path into the op', () => {
    const next = mergeMeshImportIntoLivePlan(emptyManufacture(), {
      relPath: '\\assets\\sub\\p.stl',
      env: 'cnc'
    })
    expect(next.plates![0]!.operations[0]!.sourceMesh).toBe('assets/sub/p.stl')
  })
})

describe('ManufactureWorkspace load effect carries the anti-clobber guard', () => {
  it('the load effect deps are exactly [fab, projectDir, reloadNonce]', () => {
    expect(WORKSPACE_SRC).toContain('}, [fab, projectDir, reloadNonce])')
  })

  it('uses a (projectDir, reloadNonce) load-key remembered in a ref to skip redundant reloads', () => {
    expect(WORKSPACE_SRC).toContain('const lastManufactureLoadKeyRef = useRef<string | null>(null)')
    expect(WORKSPACE_SRC).toContain('const loadKey = manufactureLoadKey(projectDir, reloadNonce)')
    expect(WORKSPACE_SRC).toContain(
      'if (loadKey !== null && lastManufactureLoadKeyRef.current === loadKey) return'
    )
    // …and resets the key when the project closes so reopening the SAME project reloads.
    expect(WORKSPACE_SRC).toContain('lastManufactureLoadKeyRef.current = null')
  })
})

describe('ManufactureWorkspace merges the Send-to-CAM import into the LIVE plan', () => {
  it('the one-shot merge effect keys ONLY on requestedMeshImport', () => {
    expect(WORKSPACE_SRC).toContain('}, [requestedMeshImport])')
  })

  it('folds the import into the live mfg via the functional setMfg updater (not a disk read)', () => {
    expect(WORKSPACE_SRC).toContain('merged = mergeMeshImportIntoLivePlan(prev, req)')
    // The merge effect must NOT re-read the plan from disk before merging.
    expect(WORKSPACE_SRC).not.toContain('await fab.manufactureLoad(projectDir)\n      merged')
  })
})

describe('ManufactureHost no longer clobbers unsaved edits via a stale-disk merge', () => {
  it('the consume effect does NOT load+merge+save from disk anymore', () => {
    // The old race: read disk, importStlIntoFirstPlate(mfg, ...), save, bump nonce.
    expect(HOST_SRC).not.toContain('importStlIntoFirstPlate(mfg')
    expect(HOST_SRC).not.toContain('setReloadNonce(')
    // reloadNonce is no longer bumped, so the host drops the setter entirely.
    expect(HOST_SRC).not.toContain('const [reloadNonce, setReloadNonce]')
  })

  it('the consume effect hands the imported mesh to the workspace as requestedMeshImport', () => {
    expect(HOST_SRC).toContain('setRequestedMeshImport({')
    expect(HOST_SRC).toContain('relPath: imp.relativePath')
  })

  it('mounts the workspace with the live-merge props + a MEMOIZED handled callback', () => {
    expect(HOST_SRC).toContain('requestedMeshImport={requestedMeshImport}')
    expect(HOST_SRC).toContain('onRequestedMeshImportHandled={handleRequestedMeshImportHandled}')
    expect(HOST_SRC).toContain('const handleRequestedMeshImportHandled = useCallback((): void => {')
    // The clear must be stable (no churning inline arrow feeding the destructive
    // merge effect) — the Cycle-249 inline-arrow-prop lesson.
    expect(HOST_SRC).not.toContain('onRequestedMeshImportHandled={() =>')
  })
})
