import type { ReactNode } from 'react'
import { ToastProvider } from './ToastContext'
import { UIProvider } from './UIContext'
import { MachineSessionProvider } from './MachineSessionContext'
import { CamHandoffProvider } from '../app/CamHandoffContext'

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
           */}
          <CamHandoffProvider>{children}</CamHandoffProvider>
        </MachineSessionProvider>
      </UIProvider>
    </ToastProvider>
  )
}
