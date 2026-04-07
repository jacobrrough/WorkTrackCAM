const KEY = 'ufs_shell_discoverability_hint_v1'

/** User dismissed the “command palette shortcut” tip in the status footer. */
export function readDiscoverabilityHintDismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function writeDiscoverabilityHintDismissed(): void {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* private mode / quota */
  }
}
