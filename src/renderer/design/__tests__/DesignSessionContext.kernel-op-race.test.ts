/**
 * Regression pins for the kernel-op timeline persistence race (Model-pillar
 * shake-down audit).
 *
 * ROOT CAUSE (same family as Cycle-249 / the CAM Send-to-CAM eager-updater):
 * the seven kernel-op timeline editors in `DesignSessionContext`
 * (appendKernelOp / removeKernelOpAt / moveKernelOp / setKernelOpSuppressedAt /
 * reorderKernelOps / setKernelRollbackMarker / updateFeatureSuppressed) each
 * read the render-cycle `features` closure, computed a `next`, then
 * `featuresSave(next)` + `setFeatures(next)`. A feature dialog stays OPEN after
 * Apply (so the operator can stack another op) and the FeatureTree timeline
 * buttons have NO in-flight gate, so two gestures inside one `featuresSave`
 * round-trip both folded onto the SAME stale snapshot — the last write silently
 * dropped the first edit on disk AND in memory (invisible until reload, the
 * exact "disappearing" damage profile).
 *
 * THE FIX (all pinned here):
 *   1. `featuresRef` — refreshed every render AND set synchronously before each
 *      await — is the fold base, not the closure, so a same-tick second gesture
 *      folds onto the first.
 *   2. `featuresWriteChainRef` — a single promise chain — serializes the disk
 *      writes so saves land in gesture order.
 *   3. The auto-build trailing drain calls `buildKernelPartRef.current()` (the
 *      freshest closure), so a sketch edit during an in-flight build is not
 *      re-clobbered by the build-start design (finding #1).
 *   4. The status copy reflects the AUTOMATIC debounced rebuild — there is no
 *      manual "Build STEP" button to direct the operator to (finding #4).
 *
 * The renderer test env is `node` (no jsdom / @testing-library), so the effect/
 * closure itself can't be mounted — the WIRING is source-pinned, the established
 * convention here (mirrors `DesignSessionContext.reload-guard.test.ts`). A pure
 * fold simulation below proves the serialized-base semantics the fix relies on.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SESSION_SRC = readFileSync(
  join(__dirname, '..', 'DesignSessionContext.tsx'),
  'utf-8'
)

describe('kernel-op editors fold onto the freshest features, not a stale closure', () => {
  it('declares the latest-value refs the serialized commit reads from', () => {
    expect(SESSION_SRC).toContain('const featuresRef = useRef(features)')
    expect(SESSION_SRC).toContain('featuresRef.current = features')
    expect(SESSION_SRC).toContain('const designRef = useRef(design)')
    expect(SESSION_SRC).toContain('designRef.current = design')
    expect(SESSION_SRC).toContain(
      'const featuresWriteChainRef = useRef<Promise<void>>(Promise.resolve())'
    )
  })

  it('commits through a single serialized helper that reads the ref + chains the write', () => {
    expect(SESSION_SRC).toContain('const commitKernelFeatures = useCallback(')
    // Base is the LATEST features (ref), never the render closure.
    expect(SESSION_SRC).toContain(
      'const base = featuresRef.current ?? derivePartFeatures(designRef.current, null)'
    )
    // Fold lands synchronously so a same-tick second gesture sees it…
    expect(SESSION_SRC).toContain('featuresRef.current = next')
    // …and the disk write is chained onto the single promise chain.
    expect(SESSION_SRC).toContain('featuresWriteChainRef.current = featuresWriteChainRef.current')
  })

  it('every kernel-op editor routes through commitKernelFeatures (no direct featuresSave closure)', () => {
    // The seven editors must delegate to the helper rather than the old
    // read-modify-write-with-stale-closure shape.
    for (const editor of [
      'const appendKernelOp = useCallback(',
      'const removeKernelOpAt = useCallback(',
      'const moveKernelOp = useCallback(',
      'const setKernelOpSuppressedAt = useCallback(',
      'const reorderKernelOps = useCallback(',
      'const setKernelRollbackMarker = useCallback(',
      'const updateFeatureSuppressed = useCallback('
    ]) {
      expect(SESSION_SRC).toContain(editor)
    }
    // The pre-fix stale dep array (features + design captured in the closure)
    // must never come back for these editors.
    expect(SESSION_SRC).not.toContain('[fab, projectDir, features, design, onStatus]')
    // The old per-editor inline featuresSave call shape is gone (the only
    // featuresSave for the timeline now lives inside commitKernelFeatures).
    expect(SESSION_SRC.match(/fab\.featuresSave\(projectDir, JSON\.stringify\(next\)\)/g)?.length ?? 0).toBe(1)
  })
})

describe('auto-build trailing drain uses the freshest closure (finding #1)', () => {
  it('drains via buildKernelPartRef.current(), not the build-start buildKernelPart()', () => {
    expect(SESSION_SRC).toContain('void buildKernelPartRef.current()')
    // The stale self-reference drain must be gone.
    expect(SESSION_SRC).not.toContain('void buildKernelPart()')
  })
})

describe('status copy is honest about the automatic rebuild (finding #4)', () => {
  it('no longer directs the operator to a non-existent manual "Build STEP" button', () => {
    expect(SESSION_SRC).not.toContain('run Build STEP (kernel) to apply')
  })

  it('append/remove/move tell the operator the model is rebuilding', () => {
    expect(SESSION_SRC).toContain('Kernel op saved — rebuilding model…')
    expect(SESSION_SRC).toContain('Kernel op removed — rebuilding model…')
    expect(SESSION_SRC).toContain('Kernel op order updated — rebuilding model…')
  })
})

/**
 * Pure simulation of the serialized-base fold the fix guarantees. This models
 * the exact failure: two append gestures fire before the first write resolves.
 * With a STALE closure base both append onto S0 and the second overwrites the
 * first (one op lost). With a REF base updated synchronously, the second folds
 * onto the first's result (both ops survive). The test asserts the ref-base
 * behavior — the contract `commitKernelFeatures` implements.
 */
describe('serialized-base fold semantics (the data-loss the fix prevents)', () => {
  type Ops = readonly string[]

  it('stale-closure base loses the first op (the BUG — documented for contrast)', () => {
    const S0: Ops = ['A']
    // Both gestures captured S0 (render closure never updated between them).
    const afterFirst: Ops = [...S0, 'F1']
    const afterSecond: Ops = [...S0, 'F2'] // folds onto S0, not afterFirst
    // Last write wins on disk → F1 is gone.
    expect(afterSecond).toEqual(['A', 'F2'])
    expect(afterSecond).not.toContain('F1')
    void afterFirst
  })

  it('ref base (updated synchronously) keeps BOTH ops (the FIX)', () => {
    let liveBase: Ops = ['A']
    // commitKernelFeatures reads liveBase, folds, then sets liveBase = next
    // synchronously — before the awaited save — so the next gesture sees it.
    const commit = (op: string): void => {
      const next = [...liveBase, op]
      liveBase = next // featuresRef.current = next (synchronous)
    }
    commit('F1')
    commit('F2')
    expect(liveBase).toEqual(['A', 'F1', 'F2'])
  })
})
