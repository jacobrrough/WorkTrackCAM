import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastKind = 'ok' | 'err' | 'warn'

/**
 * Toast row shape.
 *
 * `detail` (added in [ID-0088]) is the optional second-line body for
 * long-form messages -- typically the Moonraker push validator's
 * violation summary or the [ID-0072] "will heat" preview. When set, the
 * toast renders `msg` on the first line and `detail` on a wrap-friendly
 * second line, plus a "Copy" button that puts `${msg}: ${detail}` on
 * the clipboard so the operator can paste it into a bug report. When
 * `detail` is absent the toast renders the legacy single-line shape
 * (Safety Rule 2 pin: byte-identical to pre-[ID-0088] for the existing
 * 30+ `pushToast` call-sites that pass two arguments).
 */
type Toast = { id: number; kind: ToastKind; msg: string; detail?: string }

/**
 * Toast TTL in ms. [ID-0088] doubles the lifetime when a `detail` is
 * present so the operator has time to read the long-form body and
 * click Copy before the toast auto-dismisses. Plain toasts keep the
 * historic 4000 ms window so legacy call-sites are unchanged.
 */
const TOAST_TTL_MS = 4000
const TOAST_TTL_WITH_DETAIL_MS = 8000

type ToastContextValue = {
  toasts: Toast[]
  /**
   * Push a toast notification.
   *
   * `kind` -- visual category: `ok` | `err` | `warn`.
   * `msg` -- short title shown on the first line.
   * `detail` -- optional long-form body shown on a second line with a
   * Copy button. Pass `undefined` (or omit) for the legacy single-line
   * toast.
   */
  pushToast: (kind: ToastKind, msg: string, detail?: string) => void
}

const Ctx = createContext<ToastContextValue | null>(null)

let seq = 0

/**
 * [ID-0088] Write the toast's combined text to the clipboard via the
 * navigator Clipboard API.
 *
 * Defensive checks:
 *   - `navigator.clipboard` is not available in non-secure contexts
 *     (HTTP origins in Electron's renderer would normally have it, but
 *     a future packaging change could break this).
 *   - `writeText` returns a promise that may reject if the DOM is not
 *     focused; we swallow the rejection so a copy failure never throws
 *     into the React render tree (the toast is best-effort UX, not a
 *     correctness gate).
 *
 * Exported for testability; the React onClick handler calls this.
 */
export function copyToastTextToClipboard(text: string): void {
  if (typeof navigator === 'undefined') return
  const clip = (navigator as unknown as { clipboard?: { writeText?: (s: string) => Promise<void> } }).clipboard
  if (!clip || typeof clip.writeText !== 'function') return
  void clip.writeText(text).catch(() => {
    /* best-effort copy; ignore secure-context / focus rejections */
  })
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const pushToast = useCallback((kind: ToastKind, msg: string, detail?: string) => {
    const id = ++seq
    const hasDetail = typeof detail === 'string' && detail.length > 0
    const next: Toast = hasDetail ? { id, kind, msg, detail } : { id, kind, msg }
    setToasts((t) => [...t, next])
    const ttl = hasDetail ? TOAST_TTL_WITH_DETAIL_MS : TOAST_TTL_MS
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ttl)
  }, [])

  return (
    <Ctx.Provider value={{ toasts, pushToast }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => {
          const icon = t.kind === 'ok' ? '\u2713' : t.kind === 'err' ? '\u2715' : '\u26A0'
          if (typeof t.detail !== 'string' || t.detail.length === 0) {
            return (
              <div key={t.id} className={`toast-item toast-item--${t.kind}`}>
                {icon} {t.msg}
              </div>
            )
          }
          const clipboardText = `${t.msg}: ${t.detail}`
          return (
            <div
              key={t.id}
              className={`toast-item toast-item--${t.kind} toast-item--with-detail`}
            >
              <div className="toast-item__msg">
                {icon} {t.msg}
              </div>
              <div className="toast-item__detail">{t.detail}</div>
              <button
                type="button"
                className="toast-item__copy"
                aria-label="Copy full message to clipboard"
                onClick={() => copyToastTextToClipboard(clipboardText)}
              >
                Copy
              </button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
