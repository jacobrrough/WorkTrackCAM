/**
 * EmptyState — shared "nothing here yet" surface for high-traffic panels.
 *
 * UX Overhaul #8 (component portion). The companion CSS classes are added
 * by Agent G under `.empty-state*` (BEM):
 *
 *   .empty-state
 *     .empty-state__icon    (optional)
 *     .empty-state__title   (always)
 *     .empty-state__body    (optional)
 *     .empty-state__cta     (optional, wraps the CTA button)
 *
 * Design tokens are pulled in via CSS only — this component never sets
 * inline styles (CLAUDE.md design-token rule). The CTA button reuses the
 * existing `.btn` + variant classes from `src/renderer/styles/primitives.css`
 * so the empty-state action looks identical to every other button in the
 * app.
 *
 * No `any` types, props are `readonly`, and the CTA `onClick` signature is
 * fixed at `() => void` (zero-arg) — empty-state actions are always
 * affordances that the parent already has wired up.
 */
import type { ReactNode } from 'react'

export type EmptyStateCtaVariant = 'primary' | 'secondary' | 'ghost'

export interface EmptyStateCta {
  readonly label: string
  readonly onClick: () => void
  readonly variant?: EmptyStateCtaVariant
}

export interface EmptyStateProps {
  /** Optional glyph or SVG rendered above the title. */
  readonly icon?: ReactNode
  /** Required short headline ("No jobs yet"). */
  readonly title: string
  /** Optional body copy explaining the state + next step. */
  readonly body?: string
  /** Optional call-to-action button. Omit when there is no obvious next step. */
  readonly cta?: EmptyStateCta
  /**
   * Optional `data-testid` on the root container so callers can pin the
   * empty-state per panel without having to inspect class strings.
   */
  readonly testId?: string
}

/**
 * Map the public `variant` prop to the `.btn-*` modifier from
 * `primitives.css`. Defaults to `secondary` to match `Button` primitive.
 */
const CTA_VARIANT_CLASS: Record<EmptyStateCtaVariant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost'
}

export function EmptyState({
  icon,
  title,
  body,
  cta,
  testId
}: EmptyStateProps): React.ReactElement {
  const ctaClass = cta
    ? `btn ${CTA_VARIANT_CLASS[cta.variant ?? 'secondary']}`
    : ''
  return (
    <div
      className="empty-state"
      role="status"
      aria-live="polite"
      data-testid={testId}
    >
      {icon != null ? (
        <div className="empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <div className="empty-state__title">{title}</div>
      {body ? <div className="empty-state__body">{body}</div> : null}
      {cta ? (
        <div className="empty-state__cta">
          <button type="button" className={ctaClass} onClick={cta.onClick}>
            {cta.label}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default EmptyState
