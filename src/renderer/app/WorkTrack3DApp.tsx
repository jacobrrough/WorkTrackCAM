import type { ReactElement } from 'react'
import { AppProviders } from '../contexts/AppProviders'
import { AppShell } from './AppShell'

/**
 * Root of the ground-up WorkTrack3D shell (P3), dark-launched behind the
 * `__APP_SHELL__` build flag. `main.tsx` renders this instead of `ShopApp`
 * when WT_SHELL=next; the default build still boots the legacy shell until
 * the P5 cutover. Reuses the same provider stack as the legacy app.
 */
export default function WorkTrack3DApp(): ReactElement {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  )
}
