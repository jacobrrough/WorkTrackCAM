import type { PointerEvent } from 'react'

type Props = {
  ariaLabel: string
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void
}

/**
 * Vertical splitter between shell columns (browser / main / properties).
 */
export function ShellResizeHandle({ ariaLabel, onPointerDown }: Props) {
  return (
    <button
      type="button"
      className="shell-resize-handle"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
    />
  )
}
