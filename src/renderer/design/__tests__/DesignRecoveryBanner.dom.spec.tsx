/**
 * AUTOSAVE + CRASH RECOVERY - interactive banner spec (happy-dom).
 *
 * Proves the behavioural half the node suite can't reach: the restore banner
 * actually RENDERS when a recovery snapshot is on offer, stays absent when
 * there is none, and Restore / Discard really fire their callbacks on click
 * (both on the pure component and through the session-connected host).
 * Run with: npx vitest run --config vitest.dom.config.ts <this file>.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DesignRecoveryBanner,
  DesignRecoveryBannerHost,
  formatRecoverySavedAt
} from '../DesignRecoveryBanner'
import {
  DesignSessionContext,
  type DesignSessionValue
} from '../DesignSessionContext'
import { emptyDesign } from '../../../shared/design-schema'

/**
 * Hand-built session value (the exported raw context exists exactly for this;
 * mirrors fakeSession in DesignWorkspaceHost.test.tsx). Only the recovery
 * fields matter here - everything else is an inert stub.
 */
function fakeSession(overrides: Partial<DesignSessionValue>): DesignSessionValue {
  const asyncNoop = async (): Promise<void> => {}
  return {
    projectDir: 'C:/proj/bracket',
    design: emptyDesign(),
    pastLength: 0,
    features: null,
    loaded: true,
    geometry: null,
    viewportGeometry: null,
    inspectMeshSourceLabel: '-',
    kernelManifest: null,
    kernelInspectStaleReason: null,
    kernelBuilding: false,
    refreshKernelInspectGeometry: asyncNoop,
    buildKernelPart: asyncNoop,
    selection: null,
    setSelection: () => {},
    dispatch: () => {},
    onDesignChange: () => {},
    saveDesign: asyncNoop,
    exportStl: asyncNoop,
    removeEntity: () => {},
    addPresetRect: () => {},
    addConstraint: () => {},
    runSolve: () => {},
    setParameter: () => {},
    addUserParameter: () => {},
    editUserParameter: () => {},
    renameUserParameter: () => {},
    deleteUserParameter: () => {},
    mirrorX: () => {},
    pattern40X: () => {},
    undo: () => {},
    setFeatures: () => {},
    appendKernelOp: asyncNoop,
    updateKernelOpAt: asyncNoop,
    removeKernelOpAt: asyncNoop,
    moveKernelOp: asyncNoop,
    reorderKernelOps: asyncNoop,
    setKernelOpSuppressedAt: asyncNoop,
    setKernelRollbackMarker: asyncNoop,
    updateFeatureSuppressed: () => {},
    solveReport: '',
    drawing: null,
    onDrawingChange: () => {},
    drawingWorkspace: null,
    onDrawingSelectSheet: () => {},
    onDrawingAddSheet: () => {},
    onDrawingRenameSheet: () => {},
    onDrawingDeleteSheet: () => {},
    ...overrides
  }
}

describe('DesignRecoveryBanner - pure component (happy-dom)', () => {
  it('renders the offer with entity count and both actions', () => {
    render(
      <DesignRecoveryBanner
        savedAtMs={Date.now() - 5 * 60_000}
        entityCount={3}
        onRestore={vi.fn()}
        onDiscard={vi.fn()}
      />
    )
    const banner = screen.getByTestId('design-recovery-banner')
    expect(banner.textContent).toContain('Unsaved design changes recovered')
    expect(banner.textContent).toContain('3 sketch entities')
    expect(banner.textContent).toContain('5 minutes ago')
    expect(screen.getByTestId('design-recovery-restore')).toBeTruthy()
    expect(screen.getByTestId('design-recovery-discard')).toBeTruthy()
  })

  it('clicking Restore fires onRestore (and not onDiscard)', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    const onDiscard = vi.fn()
    render(
      <DesignRecoveryBanner
        savedAtMs={Date.now()}
        entityCount={1}
        onRestore={onRestore}
        onDiscard={onDiscard}
      />
    )
    await user.click(screen.getByTestId('design-recovery-restore'))
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it('clicking Discard fires onDiscard (and not onRestore)', async () => {
    const user = userEvent.setup()
    const onRestore = vi.fn()
    const onDiscard = vi.fn()
    render(
      <DesignRecoveryBanner
        savedAtMs={Date.now()}
        entityCount={1}
        onRestore={onRestore}
        onDiscard={onDiscard}
      />
    )
    await user.click(screen.getByTestId('design-recovery-discard'))
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onRestore).not.toHaveBeenCalled()
  })
})

describe('DesignRecoveryBannerHost - session-connected (happy-dom)', () => {
  it('renders NOTHING when the session has no pending offer', () => {
    render(
      <DesignSessionContext.Provider value={fakeSession({ recoveryOffer: null })}>
        <DesignRecoveryBannerHost />
      </DesignSessionContext.Provider>
    )
    expect(screen.queryByTestId('design-recovery-banner')).toBeNull()
  })

  it('renders NOTHING outside a provider (SSR-pin tolerance)', () => {
    render(<DesignRecoveryBannerHost />)
    expect(screen.queryByTestId('design-recovery-banner')).toBeNull()
  })

  it('renders the banner when a recovery snapshot is offered and routes clicks to the session', async () => {
    const user = userEvent.setup()
    const restoreRecoveredDesign = vi.fn()
    const discardRecoveredDesign = vi.fn()
    render(
      <DesignSessionContext.Provider
        value={fakeSession({
          recoveryOffer: { savedAtMs: Date.now() - 60_000, entityCount: 2 },
          restoreRecoveredDesign,
          discardRecoveredDesign
        })}
      >
        <DesignRecoveryBannerHost />
      </DesignSessionContext.Provider>
    )
    const banner = screen.getByTestId('design-recovery-banner')
    expect(banner.textContent).toContain('2 sketch entities')

    await user.click(screen.getByTestId('design-recovery-restore'))
    expect(restoreRecoveredDesign).toHaveBeenCalledTimes(1)
    expect(discardRecoveredDesign).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('design-recovery-discard'))
    expect(discardRecoveredDesign).toHaveBeenCalledTimes(1)
  })
})

describe('formatRecoverySavedAt', () => {
  it('formats fresh, minute, and hour ages', () => {
    const now = 10_000_000
    expect(formatRecoverySavedAt(now - 10_000, now)).toBe('moments ago')
    expect(formatRecoverySavedAt(now - 60_000, now)).toBe('1 minute ago')
    expect(formatRecoverySavedAt(now - 7 * 60_000, now)).toBe('7 minutes ago')
    expect(formatRecoverySavedAt(now - 3 * 3_600_000, now)).toBe('3 hours ago')
  })

  it('never reports a negative age (clock skew folds to moments ago)', () => {
    expect(formatRecoverySavedAt(2_000, 1_000)).toBe('moments ago')
  })
})
