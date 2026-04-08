import { useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  content: string
  children: ReactNode
}

export function Tooltip({ content, children }: Props): React.ReactElement {
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const show = (): void => {
    if (!ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.top - 4 })
  }
  const hide = (): void => setPos(null)

  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            className="tb-tooltip"
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              transform: 'translate(-50%, -100%)',
              opacity: 1,
              pointerEvents: 'none',
              zIndex: 10000,
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  )
}
