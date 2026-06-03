import React from 'react'
import ReactDOM from 'react-dom/client'
import ShopApp from './ShopApp'
import WorkTrack3DApp from '../app/WorkTrack3DApp'
import { fab } from './shop-types'
import { applyTheme } from '../theme/useTheme'
import '../styles/index.css'

declare const __APP_SHELL__: string

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

// Dark-launch the ground-up WorkTrack3D shell behind the __APP_SHELL__ build
// flag. The default build ('legacy') keeps booting the proven ShopApp;
// `WT_SHELL=next npm run dev` boots the new shell. The default flips to 'next'
// at the P5 cutover, after which ShopApp is retired.
const Root =
  typeof __APP_SHELL__ !== 'undefined' && __APP_SHELL__ === 'next' ? WorkTrack3DApp : ShopApp

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
