import type { CSSProperties, ReactElement } from 'react'
import { useDesignSessionOptional } from './DesignSessionContext'

/**
 * AUTOSAVE + CRASH RECOVERY - the restore-offer banner (Phase 1,
 * docs/PARITY-ROADMAP.md).
 *
 * Non-blocking, Fusion-style: when the session finds a recovery snapshot that
 * is NEWER than the persisted sketch, this banner offers Restore / Discard.
 * It NEVER auto-applies (Cycle-249 contract: replacing in-memory design state
 * is an explicit user action only). Restore dispatches the snapshot as an
 * ordinary edit (so Ctrl+Z undoes it); Discard deletes the snapshot file.
 *
 * Split into a pure presentational component (DOM-spec tested: renders, and
 * Restore/Discard fire their callbacks) and a thin session-connected host
 * mounted by DesignWorkspaceHost. Inline styles keep the banner self-contained
 * (no shared-CSS edits while sibling agents own the stylesheet-heavy files).
 */

export function formatRecoverySavedAt(savedAtMs: number, nowMs: number = Date.now()): string {
  const ageMs = Math.max(0, nowMs - savedAtMs)
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 1) return 'moments ago'
  if (minutes === 1) return '1 minute ago'
  if (minutes < 60) return minutes + ' minutes ago'
  const hours = Math.floor(minutes / 60)
  if (hours === 1) return '1 hour ago'
  if (hours < 48) return hours + ' hours ago'
  return new Date(savedAtMs).toLocaleString()
}

const bannerStyle: CSSProperties = {
  position: 'fixed',
  top: 56,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 60,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid var(--accent, #4f8cff)',
  background: 'var(--panel-bg, #1e2126)',
  color: 'var(--text, #e6e8eb)',
  boxShadow: '0 6px 24px rgba(0, 0, 0, 0.45)',
  fontSize: 13,
  maxWidth: 560
}

const buttonBase: CSSProperties = {
  fontSize: 12,
  padding: '5px 12px',
  borderRadius: 6,
  cursor: 'pointer'
}

const restoreButtonStyle: CSSProperties = {
  ...buttonBase,
  border: '1px solid var(--accent, #4f8cff)',
  background: 'var(--accent, #4f8cff)',
  color: '#fff',
  fontWeight: 600
}

const discardButtonStyle: CSSProperties = {
  ...buttonBase,
  border: '1px solid var(--border, #3a3f46)',
  background: 'transparent',
  color: 'var(--text-dim, #9aa0a8)'
}

export type DesignRecoveryBannerProps = {
  /** Epoch ms when the offered snapshot was captured. */
  readonly savedAtMs: number
  /** Sketch entity count in the snapshot (honest "what you get back" hint). */
  readonly entityCount: number
  readonly onRestore: () => void
  readonly onDiscard: () => void
}

/** Pure presentational banner - all state lives in the caller. */
export function DesignRecoveryBanner({
  savedAtMs,
  entityCount,
  onRestore,
  onDiscard
}: DesignRecoveryBannerProps): ReactElement {
  const entityBit = entityCount === 1 ? '1 sketch entity' : entityCount + ' sketch entities'
  return (
    <div role="status" aria-live="polite" data-testid="design-recovery-banner" style={bannerStyle}>
      <span>
        <strong>Unsaved design changes recovered</strong> ({entityBit}, autosaved{' '}
        {formatRecoverySavedAt(savedAtMs)}). Restore them?
      </span>
      <button
        type="button"
        data-testid="design-recovery-restore"
        style={restoreButtonStyle}
        onClick={onRestore}
      >
        Restore
      </button>
      <button
        type="button"
        data-testid="design-recovery-discard"
        style={discardButtonStyle}
        onClick={onDiscard}
      >
        Discard
      </button>
    </div>
  )
}

/**
 * Session-connected host: renders the banner only while the session holds a
 * pending recovery offer. Provider-tolerant (returns null without a session)
 * so SSR render-pins that mount DesignWorkspaceHost with a hand-built session
 * value keep working unchanged - the new session fields are optional.
 */
export function DesignRecoveryBannerHost(): ReactElement | null {
  const session = useDesignSessionOptional()
  const offer = session?.recoveryOffer
  if (!session || offer === null || offer === undefined) return null
  return (
    <DesignRecoveryBanner
      savedAtMs={offer.savedAtMs}
      entityCount={offer.entityCount}
      onRestore={() => session.restoreRecoveredDesign?.()}
      onDiscard={() => session.discardRecoveredDesign?.()}
    />
  )
}

export default DesignRecoveryBanner
