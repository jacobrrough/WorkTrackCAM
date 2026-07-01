/**
 * FEATURE RE-EDIT · Wiring pins for `DesignSessionContext.updateKernelOpAt`.
 *
 * The renderer test env is `node` (no jsdom / @testing-library), so the
 * provider can't be mounted here — the WIRING is source-pinned, the
 * established convention for this file's siblings
 * (`DesignSessionContext.kernel-op-race.test.ts`,
 * `DesignSessionContext.reload-guard.test.ts`). The BEHAVIOUR of the update
 * itself (in-place replace, suppressed preservation, out-of-range safety,
 * finishing-op rule, roll-back retention) is proven by the pure `update`
 * action suite in `feature-timeline-actions.test.ts`; the full click→dialog→
 * apply interaction is proven by the DOM suite
 * (`feature-dialogs/__tests__/FeatureTimelineEdit.dom.spec.tsx`).
 *
 * What these pins guarantee:
 *   1. The editor exists, is exposed on the session value (memo + deps), and
 *      is typed `(index, op) => Promise<void>` like its timeline siblings.
 *   2. It routes through `commitKernelFeatures` — the serialized
 *      read-modify-write that prevents the Cycle-race data loss — NOT a
 *      bespoke `featuresSave` closure.
 *   3. It validates the replacement through the REAL `kernelPostSolidOpSchema`
 *      BEFORE the timeline is touched (a malformed op is rejected with the
 *      schema's reason — the kernel is sacred, Safety Rule 1).
 *   4. It folds through the pure `update` timeline action, so the reducer's
 *      suppressed-preservation + finishing-op + roll-back semantics are the
 *      ones that actually persist.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SESSION_SRC = readFileSync(join(__dirname, '..', 'DesignSessionContext.tsx'), 'utf-8')

describe('updateKernelOpAt — session wiring', () => {
  it('is declared on the DesignSessionValue contract', () => {
    expect(SESSION_SRC).toContain(
      'updateKernelOpAt: (index: number, op: KernelPostSolidOp) => Promise<void>'
    )
  })

  it('is implemented as a serialized commit (no bespoke save path)', () => {
    expect(SESSION_SRC).toContain('const updateKernelOpAt = useCallback(')
    // Routes through the single serialized commit helper…
    const impl = SESSION_SRC.slice(
      SESSION_SRC.indexOf('const updateKernelOpAt = useCallback('),
      SESSION_SRC.indexOf('const setKernelRollbackMarker = useCallback(')
    )
    expect(impl).toContain('commitKernelFeatures((base) => {')
    // …and never calls featuresSave directly (the race-test pin also asserts
    // the global count stays 1, inside commitKernelFeatures).
    expect(impl).not.toContain('featuresSave')
  })

  it('validates the replacement through the REAL schema before accepting', () => {
    expect(SESSION_SRC).toContain('kernelPostSolidOpSchema.safeParse(op)')
    expect(SESSION_SRC).toContain('Edited op failed validation')
  })

  it('folds through the pure update timeline action (reducer semantics persist)', () => {
    expect(SESSION_SRC).toContain(
      "applyTimelineAction(state, { type: 'update', index, op: parsed.data })"
    )
    expect(SESSION_SRC).toContain('foldTimelineState(base, result.state)')
  })

  it('is exposed on the session value memo AND its dependency list', () => {
    const occurrences = SESSION_SRC.match(/^ {6}updateKernelOpAt,$/gm) ?? []
    expect(occurrences).toHaveLength(2)
  })

  it('tells the operator the model is rebuilding (auto-build follows the edit)', () => {
    expect(SESSION_SRC).toContain('Kernel op updated — rebuilding model…')
  })
})
