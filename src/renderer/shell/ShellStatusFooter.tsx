import { useCallback, useState } from 'react'
import { commandPaletteShortcutLabel } from '../../shared/app-keyboard-shortcuts'
import { USER_VISIBLE } from './userVisibleStrings'
import {
  readDiscoverabilityHintDismissed,
  writeDiscoverabilityHintDismissed
} from './discoverabilityHintStorage'

type Props = {
  statusText?: string
}

/** Status line + optional one-time discoverability hint (dismiss persists in localStorage). */
export function ShellStatusFooter({ statusText }: Props) {
  const [hintDismissed, setHintDismissed] = useState(readDiscoverabilityHintDismissed)
  const dismissHint = useCallback(() => {
    writeDiscoverabilityHintDismissed()
    setHintDismissed(true)
  }, [])

  if (!statusText && hintDismissed) return null

  const keys = commandPaletteShortcutLabel()

  return (
    <footer className="app-status-bar app-status-bar--split" aria-label="Application status">
      {!hintDismissed ? (
        <div className="shell-discoverability-hint" role="note">
          <span>
            {USER_VISIBLE.commandPaletteHint} <kbd className="shell-kbd">{keys}</kbd>{' '}
            {USER_VISIBLE.commandPaletteHintTail}
          </span>
          <button
            type="button"
            className="secondary shell-discoverability-dismiss"
            onClick={dismissHint}
            aria-label="Dismiss command palette tip"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {statusText ? (
        <div className="app-status-live" role="status" aria-live="polite" aria-atomic="true">
          <span className="app-status-text">{statusText}</span>
        </div>
      ) : null}
    </footer>
  )
}
