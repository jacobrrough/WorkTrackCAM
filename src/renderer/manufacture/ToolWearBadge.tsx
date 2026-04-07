/**
 * ToolWearBadge — Displays a color-coded wear status indicator for a tool
 * in the ToolLibraryPanel tool list.
 *
 * - Green dot for "ok" tools with life tracking enabled
 * - Yellow badge with remaining-life percentage for "warn" tools
 * - Red badge with "EXPIRED" text for expired tools
 * - No badge when life tracking is not configured
 *
 * Shows `formatWearStatus()` text in a tooltip on hover.
 */

import { memo, useMemo } from 'react'
import type { ToolRecord } from '../../shared/tool-schema'
import { checkToolLife, formatWearStatus, type ToolLifeStatus } from '../../shared/tool-wear-utils'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ToolWearBadge = memo(function ToolWearBadge({
  tool
}: {
  tool: ToolRecord
}) {
  const lifeCheck = useMemo(() => checkToolLife(tool), [tool])
  const tooltip = useMemo(() => formatWearStatus(tool), [tool])

  // No badge when life tracking is not configured
  if (lifeCheck.remainingPercent === -1) return null

  return (
    <span
      className={`tool-wear-badge tool-wear-badge--${lifeCheck.status}`}
      title={tooltip}
      role="status"
      aria-label={tooltip}
    >
      {badgeContent(lifeCheck.status, lifeCheck.remainingPercent)}
    </span>
  )
})

function badgeContent(status: ToolLifeStatus, remainingPercent: number): string {
  switch (status) {
    case 'ok':
      return '' // Green dot only — no text
    case 'warn':
      return `${remainingPercent}% life`
    case 'expired':
      return 'EXPIRED'
  }
}
