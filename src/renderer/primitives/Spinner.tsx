type Size = 'sm' | 'md' | 'lg'
type Props = { size?: Size; label?: string; className?: string }

const SIZE_CLS: Record<Size, string> = { sm: 'spinner--sm', md: '', lg: 'spinner--lg' }

export function Spinner({ size = 'md', label, className }: Props): React.ReactElement {
  const cls = ['spinner', SIZE_CLS[size], className].filter(Boolean).join(' ')
  return <span className={cls} role="status" aria-label={label ?? 'Loading'} />
}
