import { type ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ok'
type Size = 'sm' | 'md' | 'lg'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  iconOnly?: boolean
}

const SIZE_CLS: Record<Size, string> = {
  sm: 'btn-sm',
  md: '',
  lg: '',
}

const VARIANT_CLS: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  ok: 'btn-ok',
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'secondary', size = 'md', iconOnly, className, ...rest }, ref) => {
    const cls = ['btn', VARIANT_CLS[variant], SIZE_CLS[size], iconOnly && 'btn-icon', className]
      .filter(Boolean)
      .join(' ')
    return <button ref={ref} className={cls} {...rest} />
  }
)
Button.displayName = 'Button'
