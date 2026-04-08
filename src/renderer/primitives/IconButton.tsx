import { type ButtonHTMLAttributes, forwardRef } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  tooltip?: string
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ active, tooltip, className, children, ...rest }, ref) => {
    const cls = ['tb-btn', active && 'tb-btn--active', className].filter(Boolean).join(' ')
    return (
      <button ref={ref} className={cls} title={tooltip} {...rest}>
        {children}
        {tooltip && <span className="tb-tooltip">{tooltip}</span>}
      </button>
    )
  }
)
IconButton.displayName = 'IconButton'
