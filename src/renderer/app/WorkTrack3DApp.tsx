import { useCallback, useState } from 'react'
import type { ReactElement } from 'react'
import { AppProviders } from '../contexts/AppProviders'
import { AppShell } from './AppShell'
import { HomeShell } from '../home/HomeShell'

/**
 * Root of the WorkTrack3D app. Two surfaces share one provider tree:
 *
 *  - **Home** (`HomeShell`) — the DS-native outer dashboard (Home / Files /
 *    Templates / Machine / Jobs / Settings). The app boots here.
 *  - **Workspace** (`AppShell`) — the inner CAD-first modeling shell (Design /
 *    Assemble / Manufacture / Drawings / Workshop / Utilities).
 *
 * "New design" / a recent file / a template enters the workspace; the
 * workspace's brand logo returns to Home. The workspace is lazily mounted on
 * first entry and then kept alive (hidden) behind Home, so returning to Home and
 * back never resets in-progress editor state.
 */
type AppSurface = 'home' | 'workspace'

export default function WorkTrack3DApp(): ReactElement {
  return (
    <AppProviders>
      <AppRootSurface />
    </AppProviders>
  )
}

function AppRootSurface(): ReactElement {
  const [surface, setSurface] = useState<AppSurface>('home')
  const [workspaceMounted, setWorkspaceMounted] = useState(false)

  const enterWorkspace = useCallback((): void => {
    setWorkspaceMounted(true)
    setSurface('workspace')
  }, [])

  const goHome = useCallback((): void => setSurface('home'), [])

  return (
    <>
      <div style={{ display: surface === 'home' ? 'contents' : 'none' }}>
        <HomeShell onEnterWorkspace={enterWorkspace} />
      </div>
      {workspaceMounted ? (
        <div style={{ display: surface === 'workspace' ? 'contents' : 'none' }}>
          <AppShell onGoHome={goHome} />
        </div>
      ) : null}
    </>
  )
}
