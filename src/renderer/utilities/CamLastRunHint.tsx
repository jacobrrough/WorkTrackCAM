import type { ReactNode } from 'react'

/** Shows the last successful `cam:run` hint above G-code (status line alone is easy to miss). */
export function CamLastRunHint({ hint }: { hint: string }): ReactNode {
  const t = hint.trim()
  if (!t) return null
  const fallbackish = /\bfallback\b/i.test(t) || /\busedEngine\b/i.test(t) || /\bOCL\b/i.test(t) || /\bbuiltin\b/i.test(t)
  return (
    <p
      className={`msg util-cam-last-hint${fallbackish ? ' util-cam-last-hint--engine' : ''}`}
      role="status"
      aria-live="polite"
      id="util-cam-last-hint"
    >
      <strong>Last run</strong> — {t}
    </p>
  )
}
