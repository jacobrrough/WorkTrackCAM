import { useEffect } from 'react'

/**
 * Lets the app shell (e.g. command palette) activate Design ribbon modes without prop drilling.
 */
const EVT = 'ufs-design-command'

export type DesignCommandDetail = { commandId: string }

export function dispatchDesignCommand(commandId: string): void {
  window.dispatchEvent(new CustomEvent(EVT, { detail: { commandId } satisfies DesignCommandDetail }))
}

export function useDesignCommandListener(handler: (commandId: string) => void): void {
  useEffect(() => {
    const fn = (e: Event): void => {
      const d = (e as CustomEvent<DesignCommandDetail>).detail
      if (d?.commandId) handler(d.commandId)
    }
    window.addEventListener(EVT, fn)
    return () => window.removeEventListener(EVT, fn)
  }, [handler])
}
