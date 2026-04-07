import { useCallback, useState } from 'react'

const STORAGE_KEY = 'ufs_shell_info_banner_v1_dismissed'

const DEFAULT_MESSAGE =
  'Tip: Ctrl+K opens commands. Generated G-code and toolpaths are unverified until you check posts, units, and clearances.'

type Props = {
  /** Override default copy (e.g. maintenance notice). */
  message?: string
}

export function ShellInfoBanner({ message = DEFAULT_MESSAGE }: Props) {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '1'
    } catch {
      return true
    }
  })

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
    setVisible(false)
  }, [])

  if (!visible) return null

  return (
    <div className="app-shell-banner" role="status">
      <p className="app-shell-banner__text">{message}</p>
      <button type="button" className="app-shell-banner__dismiss" onClick={dismiss} aria-label="Dismiss banner">
        ×
      </button>
    </div>
  )
}
