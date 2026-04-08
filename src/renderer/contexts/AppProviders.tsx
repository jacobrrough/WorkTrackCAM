import type { ReactNode } from 'react'
import { ToastProvider } from './ToastContext'
import { UIProvider } from './UIContext'
import { MachineSessionProvider } from './MachineSessionContext'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <UIProvider>
        <MachineSessionProvider>
          {children}
        </MachineSessionProvider>
      </UIProvider>
    </ToastProvider>
  )
}
