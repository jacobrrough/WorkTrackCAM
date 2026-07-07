/**
 * DsScope — the `.ds` styling boundary for design-system primitives.
 *
 * Replaces the upstream `ThemeProvider`'s *wrapper* role. Upstream owned its own
 * theme state; here the WorkTrack app is the single source of truth — the active
 * theme already lives on `<html data-theme>` (see theme/useTheme.ts) and the
 * `--c-*` token bridge is keyed off it. So DsScope needs no theme state at all:
 * it just renders the `.ds` element that scopes the `.ds-*` recipes, and the
 * tokens inherit from the document root automatically.
 *
 * Wrap any subtree that renders DS primitives in exactly one DsScope. Nesting is
 * harmless but unnecessary.
 */
import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export interface DsScopeProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  /** Paint the DS page background (`--c-bg`) on the scope element. */
  appBg?: boolean
}

export function DsScope({
  children,
  appBg,
  className,
  ...rest
}: DsScopeProps): React.ReactElement {
  return (
    <div className={cx('ds', appBg && 'ds-app-bg', className)} {...rest}>
      {children}
    </div>
  )
}

export default DsScope
