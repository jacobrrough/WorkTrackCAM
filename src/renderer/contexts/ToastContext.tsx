import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastKind = 'ok' | 'err' | 'warn'
type Toast = { id: number; kind: ToastKind; msg: string }

type ToastContextValue = {
  toasts: Toast[]
  pushToast: (kind: ToastKind, msg: string) => void
}

const Ctx = createContext<ToastContextValue | null>(null)

let seq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const pushToast = useCallback((kind: ToastKind, msg: string) => {
    const id = ++seq
    setToasts((t) => [...t, { id, kind, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  return (
    <Ctx.Provider value={{ toasts, pushToast }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item toast-item--${t.kind}`}>
            {t.kind === 'ok' ? '\u2713' : t.kind === 'err' ? '\u2715' : '\u26A0'} {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
