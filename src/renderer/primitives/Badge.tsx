type Kind = 'ok' | 'warn' | 'err' | 'info' | 'neutral'

type Props = {
  kind?: Kind
  className?: string
  children: React.ReactNode
}

const KIND_CLS: Record<Kind, string> = {
  ok: 'mat-audit-badge--ok',
  warn: 'mat-audit-badge--warn',
  err: 'mat-audit-badge--danger',
  info: 'mat-audit-badge--ok',
  neutral: '',
}

export function Badge({ kind = 'neutral', className, children }: Props): React.ReactElement {
  const cls = ['mat-audit-badge', KIND_CLS[kind], className].filter(Boolean).join(' ')
  return <span className={cls}>{children}</span>
}
