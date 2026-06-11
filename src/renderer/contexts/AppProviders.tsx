import type { ReactNode } from 'react'
import { ToastProvider } from './ToastContext'
import { UIProvider } from './UIContext'
import { MachineSessionProvider } from './MachineSessionContext'
import { CamHandoffProvider } from '../app/CamHandoffContext'
import { CursorCoordsProvider } from '../app/CursorCoordsContext'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <UIProvider>
        <MachineSessionProvider>
          {/*
           * CamHandoffProvider holds the cross-workspace "pending CAM import"
           * slot for the Design → Manufacture STL hand-off. It must sit ABOVE
           * WorkspaceHost (which mounts exactly one workspace at a time) so the
           * queued STL survives the route switch that unmounts Design and
           * mounts Manufacture. Data-only: no IPC, no G-code.
           *
           * CursorCoordsProvider (Wave 3n) carries the live cursor/last-pick
           * world coordinates from the Design surfaces to the shell StatusBar.
           * Split value/setter contexts keep mouse-move-frequency updates from
           * re-rendering anything but the StatusBar read-out. Data-only.
           */}
          <CamHandoffProvider>
            <CursorCoordsProvider>{children}</CursorCoordsProvider>
          </CamHandoffProvider>
        </MachineSessionProvider>
      </UIProvider>
    </ToastProvider>
  )
}
