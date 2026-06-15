/**
 * Regression pin for task_4a3ff375 — the Send-to-CAM merge effect's eager-updater
 * persistence gap.
 *
 * THE BUG: the merge effect captured the merged plan inside the `setMfg((prev) =>
 * { merged = mergeMeshImportIntoLivePlan(prev, req); return merged })` functional
 * updater, then read `merged` synchronously in an async IIFE. React 19 only runs a
 * setState updater EAGERLY when the fiber has no pending lanes
 * (dispatchSetStateInternal). Under a concurrent update the updater is DEFERRED, so
 * `merged` was still null when `if (merged)` ran → the in-memory apply landed but
 * `fab.manufactureSave` + the "Part landed in CAM" toast were silently skipped (the
 * imported part stayed unsaved until the next manual Save).
 *
 * THE FIX (deterministic, option b): keep the functional `setMfg` updater for the
 * live-plan merge (the persistence-race fix stays), but move the persist into a
 * FOLLOW-UP effect keyed on a pending-save token. That effect runs AFTER the merge
 * commits to `mfg`, so it reads the COMMITTED merged plan (`const mergedNow = mfg`)
 * regardless of eager-vs-deferred updater timing, and consumes the token
 * synchronously so a mid-save edit can't re-fire it.
 *
 * Renderer test env is node-only (no jsdom), so — like manufacture-load-guard /
 * DesignSessionContext.reload-guard — this pins the wiring via source assertions
 * that fail if the fragile eager-capture shape returns.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(
  join(__dirname, '..', 'ManufactureWorkspace.tsx'),
  'utf-8'
)

describe('Send-to-CAM merge persist is deterministic (task_4a3ff375)', () => {
  it('the fragile in-updater capture is GONE', () => {
    // No `let merged` captured inside the functional updater, and the updater is
    // now a direct return (no side-effecting assignment).
    expect(SRC).not.toMatch(/let merged\s*:/)
    expect(SRC).not.toMatch(/merged = mergeMeshImportIntoLivePlan/)
    expect(SRC).toContain('setMfg((prev) => mergeMeshImportIntoLivePlan(prev, req))')
  })

  it('the merge effect hands off to the persist effect via a token', () => {
    expect(SRC).toContain(
      'const [pendingMeshPersist, setPendingMeshPersist] = useState<PendingMeshImport | null>(null)'
    )
    expect(SRC).toContain('setPendingMeshPersist(req)')
  })

  it('the persist effect reads the COMMITTED merged plan and consumes the token synchronously', () => {
    // Reads mfg (the committed merged plan), not an eager capture; clears the
    // token before the async save so a mid-save mfg edit can't re-fire it.
    expect(SRC).toContain('const mergedNow = mfg')
    expect(SRC).toMatch(/const mergedNow = mfg\s*\n\s*setPendingMeshPersist\(null\)/)
    expect(SRC).toContain('await fab.manufactureSave(projectDir, JSON.stringify(mergedNow))')
    // The persist effect re-runs once the merge commits to mfg.
    expect(SRC).toContain('}, [pendingMeshPersist, mfg])')
  })

  it('still merges into the LIVE plan and still rebaselines the dirty flag (no regressions)', () => {
    // The persistence-race fix (merge into the live plan) is preserved.
    expect(SRC).toContain('mergeMeshImportIntoLivePlan(prev, req)')
    // The nav-guard rebaseline (Cycle 255) still runs after the import save.
    expect(SRC).toContain('lastSavedFingerprintRef.current = manufacturePlanFingerprint(mergedNow)')
    expect(SRC).toContain('setSavedBaselineVersion((v) => v + 1)')
  })
})
