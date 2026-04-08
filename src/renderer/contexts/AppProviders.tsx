import type { ReactNode } from 'react'
import { ToastProvider } from './ToastContext'
import { UIProvider } from './UIContext'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <UIProvider>
        {children}
      </UIProvider>
    </ToastProvider>
  )
}
