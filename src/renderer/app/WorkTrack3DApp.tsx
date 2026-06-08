import type { ReactElement } from 'react'
import { AppProviders } from '../contexts/AppProviders'
import { AppShell } from './AppShell'

/**
 * Root of the WorkTrack3D CAD-first shell. `main.tsx` renders this as the sole
 * application shell — the legacy ShopApp was retired at the P5 cutover (the
 * `__APP_SHELL__` dark-launch flag is gone).
 */
export default function WorkTrack3DApp(): ReactElement {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  )
}
