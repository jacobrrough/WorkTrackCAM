import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  content: string
  children: ReactNode
  /** Delay in ms before the tooltip appears. Defaults to 400ms. */
  delay?: number
}

export function Tooltip({ content, children, delay = 400 }: Props): React.ReactElement {
  const ref = useRef<HTMLSpanElement>(null)
  const timerRef = useRef<number | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const show = (): void => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      if (!ref.current) return
      const r = ref.current.getBoundingClientRect()
      setPos({ x: r.left + r.width / 2, y: r.top - 4 })
    }, delay)
  }
  const hide = (): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setPos(null)
  }

  // Cleanup pending timer on unmount.
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            className="tb-tooltip"
            role="tooltip"
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  )
}
