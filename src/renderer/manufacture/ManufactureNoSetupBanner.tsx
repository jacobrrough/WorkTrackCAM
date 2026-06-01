import type { ReactElement } from 'react'

/**
 * BROKEN PATH #5 fix -- prominent "Add a Setup first" banner.
 *
 * Renders at the top of the Plan tab body when no Setup exists on the
 * active manufacture plate. The previous "Add a setup so work offset and
 * stock context are defined" hint lived buried at the bottom of the Plan
 * sidebar and was only emitted when both `setups.length === 0` AND
 * `!camResolvedSetup`. Users could create operations on the Plan tab
 * without ever seeing it and only discover the missing Setup once CAM
 * generation failed with a confusing error.
 *
 * Extracted to a tiny presentational component so it can be unit-tested
 * via `renderToStaticMarkup` without instantiating the full
 * `ManufactureWorkspace` (which loads disk state in a `useEffect`).
 *
 * Disappears once at least one Setup exists. The CTA calls the parent's
 * `onAddSetup` handler, wired to the existing `addSetup()` mutation in
 * `ManufactureWorkspace.tsx` -- identical to the toolbar "Add Setup"
 * button so behaviour stays consistent across entry points.
 */
export type ManufactureNoSetupBannerProps = {
  /** Number of setups on the active plate. Banner hides when > 0. */
  setupCount: number
  /** Wired to the workspace's existing `addSetup()` mutation. */
  onAddSetup: () => void
}

export function ManufactureNoSetupBanner({
  setupCount,
  onAddSetup
}: ManufactureNoSetupBannerProps): ReactElement | null {
  if (setupCount > 0) return null
  return (
    <div
      className="manufacture-plan-no-setup-banner"
      role="alert"
      data-testid="manufacture-plan-no-setup-banner"
    >
      <span className="manufacture-plan-no-setup-banner__icon" aria-hidden="true">⚠</span>
      <div className="manufacture-plan-no-setup-banner__body">
        <p className="manufacture-plan-no-setup-banner__heading">Add a Setup first</p>
        <p className="manufacture-plan-no-setup-banner__subtitle">
          Operations need a Setup to define work offset (WCS), stock, and tool reference.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        data-testid="manufacture-plan-no-setup-cta"
        onClick={onAddSetup}
      >
        Add Setup
      </button>
    </div>
  )
}
