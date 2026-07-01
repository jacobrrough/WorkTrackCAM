/**
 * AUTOSAVE + CRASH RECOVERY - session-wiring pins (node env; the effect
 * machinery can't be mounted here, so per the established convention the
 * SEMANTICS are unit-tested in src/shared/design-recovery.test.ts and the
 * WIRING is source-pinned here).
 *
 * The load-bearing contracts pinned:
 *   1. Cycle-249 anti-clobber: NO effect applies a recovery snapshot; the only
 *      dispatch of recovered state lives inside the explicit
 *      `restoreRecoveredDesign` user action, as an UNDOABLE 'edit' (never
 *      'replace').
 *   2. The offer effect depends only on stable primitives [fab, projectDir,
 *      loaded] - never callback identities - and is keyed once per project.
 *   3. Snapshot writes are fire-and-forget (writeDesignRecoveryNow never
 *      dispatches / never sets design state).
 *   4. Delete-on-clean-save: saveDesign and buildKernelPart both drop the
 *      snapshot after a successful designSave.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(__dirname, '..', 'DesignSessionContext.tsx'), 'utf-8')

/** Slice SRC between two unique markers (asserts both exist exactly once). */
function between(startMarker: string, endMarker: string): string {
  const start = SRC.indexOf(startMarker)
  const end = SRC.indexOf(endMarker, start + startMarker.length)
  expect(start, startMarker).toBeGreaterThan(-1)
  expect(end, endMarker).toBeGreaterThan(start)
  return SRC.slice(start, end)
}

describe('restore is an explicit user action (Cycle-249 contract)', () => {
  it('restoreRecoveredDesign dispatches the snapshot as an UNDOABLE edit', () => {
    const body = between('const restoreRecoveredDesign = useCallback', 'const discardRecoveredDesign')
    expect(body).toContain("dispatch({ type: 'edit', design: cloneDesign(snap.design) })")
    expect(body).not.toContain("type: 'replace'")
  })

  it('the offer effect NEVER dispatches into the design reducer', () => {
    const body = between('// Restore-offer check:', '// Debounced-after-edit snapshot:')
    expect(body).not.toContain('dispatch(')
    expect(body).toContain('recoverySnapshotRef.current = decision.snapshot')
    expect(body).toContain('setRecoveryOffer({')
  })

  it('the offer effect depends only on stable primitives (no callback identities)', () => {
    const body = between('// Restore-offer check:', '// Debounced-after-edit snapshot:')
    expect(body).toContain('}, [fab, projectDir, loaded])')
  })

  it('the offer check is keyed once per project (anti-clobber key pattern)', () => {
    const body = between('// Restore-offer check:', '// Debounced-after-edit snapshot:')
    expect(body).toContain('if (lastRecoveryOfferKeyRef.current === projectDir) return')
    expect(body).toContain('lastRecoveryOfferKeyRef.current = projectDir')
  })
})

describe('snapshot writes never replace state', () => {
  it('writeDesignRecoveryNow is fire-and-forget (no dispatch, no setState on design)', () => {
    const body = between('const writeDesignRecoveryNow = useCallback', 'const writeDesignRecoveryNowRef')
    expect(body).not.toContain('dispatch(')
    expect(body).not.toContain('setRecoveryOffer')
    expect(body).toContain('void fab.designRecoveryWrite(JSON.stringify(snapshot)).catch(() => {})')
  })

  it('the debounce effect depends on [projectDir, loaded, design] only', () => {
    const body = between('// Debounced-after-edit snapshot:', '// Periodic floor:')
    expect(body).toContain('}, [projectDir, loaded, design])')
    expect(body).toContain('DESIGN_RECOVERY_DEBOUNCE_MS')
  })

  it('the periodic floor bounds worst-case loss while dirty', () => {
    const body = between('// Periodic floor:', '// Teardown flush:')
    expect(body).toContain('DESIGN_RECOVERY_PERIODIC_FLOOR_MS')
    expect(body).toContain('}, [projectDir, loaded])')
  })
})

describe('delete on clean save', () => {
  it('saveDesign moves the baseline and deletes the snapshot after designSave', () => {
    const body = between('const saveDesign = useCallback', 'const exportStl = useCallback')
    expect(body).toContain('lastPersistedDesignJsonRef.current = designJson')
    expect(body).toContain('void fab.designRecoveryDelete(projectDir).catch(() => {})')
  })

  it('buildKernelPart drops the snapshot only when the LIVE design matches the save', () => {
    const body = between('const buildKernelPart = useCallback', 'const buildKernelPartRef')
    expect(body).toContain('JSON.stringify(designRef.current) === designJson')
    expect(body).toContain('void fab.designRecoveryDelete(projectDir).catch(() => {})')
  })

  it('a FAILED sketch load nulls the baseline so the empty fallback is never snapshotted', () => {
    expect(SRC).toContain('lastPersistedDesignJsonRef.current = null')
    const body = between("errs.push(formatLoadRejection('design/sketch.json', dr.reason))", '}')
    expect(body).toContain('lastPersistedDesignJsonRef.current = null')
  })
})

describe('teardown behaviour', () => {
  it('flushes a final snapshot when dirty, deletes when clean', () => {
    const body = between('// Teardown flush:', '// EXPLICIT user action')
    expect(body).toContain('writeDesignRecoveryNowRef.current()')
    expect(body).toContain('designRecoveryDelete')
  })
})

describe('session value exposes the recovery surface (additively)', () => {
  it('DesignSessionValue gained optional recoveryOffer/restore/discard fields', () => {
    expect(SRC).toContain('recoveryOffer?: DesignRecoveryOffer | null')
    expect(SRC).toContain('restoreRecoveredDesign?: () => void')
    expect(SRC).toContain('discardRecoveredDesign?: () => void')
  })
})
