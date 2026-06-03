import React from 'react'
import ReactDOM from 'react-dom/client'
import ShopApp from './ShopApp'
import { fab } from './shop-types'
import { applyTheme } from '../theme/useTheme'
import '../styles/index.css'

// Apply the operator's persisted theme to <html data-theme> as early as possible.
// themes.css :root already defaults to the brand theme (Titanium), so there is no
// unstyled flash — this only swaps to a non-default saved theme once settings
// resolve. Live changes from the Settings picker are applied imperatively there.
try {
  void fab()
    .settingsGet()
    .then((s) => applyTheme(s?.theme))
    .catch(() => {
      /* settings unavailable — keep the default theme */
    })
} catch {
  /* IPC bridge not present (non-Electron context) — keep the default theme */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ShopApp />
  </React.StrictMode>
)
