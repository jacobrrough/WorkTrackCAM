import React from 'react'
import ReactDOM from 'react-dom/client'
import WorkTrack3DApp from '../app/WorkTrack3DApp'
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

// WorkTrack3D ships the ground-up CAD-first shell. The legacy ShopApp was
// retired at the P5 cutover (the `__APP_SHELL__` dark-launch flag is gone).
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkTrack3DApp />
  </React.StrictMode>
)
