/**
 * WorkTrack design-system primitives — native TypeScript port of
 * @worktrack/design-system's component kit.
 *
 * These are thin, strictly-typed `forwardRef` wrappers that apply the `.ds-*`
 * recipe classes from `styles/ds/ds-components.css`. They carry the LOOK
 * (radius, spacing rhythm, borders, focus rings, accent behaviour) via those
 * recipes; layout is the caller's to set. Every recipe reads the `--c-*` token
 * bridge, so a primitive re-themes across all 10 WorkTrack themes automatically
 * — but only inside a `.ds` scope (see {@link DsScope}). Rendered outside `.ds`
 * the recipes don't apply, matching upstream behaviour.
 *
 * Ported verbatim from the compiled bundle's component bodies; class strings and
 * prop defaults match upstream exactly so markup is identical.
 */
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes
} from 'react'
import { cx } from './cx'

/* ── Button ────────────────────────────────────────────────────────────────
 * The primary action control. One accent per screen: use `variant="primary"`
 * for the single main action and keep the rest `secondary`. `danger` is the
 * destructive fill (identical red in every theme). */
export type ButtonVariant = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Stretch to the full width of the parent. */
  block?: boolean
}

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: 'ds-btn--sm',
  md: '',
  lg: 'ds-btn--lg'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', block, className, type, style, ...rest },
  ref
) {
  const onFill = variant === 'primary' || variant === 'danger'
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cx(
        'ds-btn',
        `ds-btn-${variant}`,
        BTN_SIZE[size],
        onFill && 'ds-focus-on-accent',
        className
      )}
      style={block ? { width: '100%', ...style } : style}
      {...rest}
    />
  )
})

/* ── Card ──────────────────────────────────────────────────────────────────
 * Base surface container (14px radius). Set `interactive` for clickable tiles.
 * Padding is yours to set via `style`. */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive, className, ...rest },
  ref
) {
  return (
    <div
      ref={ref}
      className={cx('ds-card', interactive && 'ds-card-interactive', className)}
      {...rest}
    />
  )
})

/* ── PrimaryCard ───────────────────────────────────────────────────────────
 * The ONE accent-carrying surface per view (resume work, active shift, …). */
export type PrimaryCardProps = HTMLAttributes<HTMLDivElement>

export const PrimaryCard = forwardRef<HTMLDivElement, PrimaryCardProps>(
  function PrimaryCard({ className, ...rest }, ref) {
    return <div ref={ref} className={cx('ds-primary-card', className)} {...rest} />
  }
)

/* ── ListRow ───────────────────────────────────────────────────────────────
 * The repeated bordered surface behind list/detail items (12px radius). */
export type ListRowProps = HTMLAttributes<HTMLDivElement>

export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { className, ...rest },
  ref
) {
  return <div ref={ref} className={cx('ds-list-row', className)} {...rest} />
})

/* ── Input ─────────────────────────────────────────────────────────────────
 * Text input on the .ds-input recipe — accent focus border, themed placeholder. */
export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref
) {
  return <input ref={ref} className={cx('ds-input', className)} {...rest} />
})

/* ── IconButton ────────────────────────────────────────────────────────────
 * Square icon button (back arrows, header actions, close). Put an icon inside. */
export type IconButtonSize = 'sm' | 'md'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ size = 'md', className, type, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cx('ds-icon-btn', size === 'sm' && 'ds-icon-btn--sm', className)}
        {...rest}
      />
    )
  }
)

/* ── IconBadge ─────────────────────────────────────────────────────────────
 * Rounded icon container (12px). Neutral by default; `accent` tints it. */
export interface IconBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  accent?: boolean
}

export const IconBadge = forwardRef<HTMLSpanElement, IconBadgeProps>(
  function IconBadge({ accent, className, ...rest }, ref) {
    return (
      <span
        ref={ref}
        className={cx('ds-icon-badge', accent && 'ds-icon-badge--accent', className)}
        {...rest}
      />
    )
  }
)

/* ── AppHeader ─────────────────────────────────────────────────────────────
 * Sticky, translucent, blurred page header bar. */
export type AppHeaderProps = HTMLAttributes<HTMLElement>

export const AppHeader = forwardRef<HTMLElement, AppHeaderProps>(function AppHeader(
  { className, ...rest },
  ref
) {
  return <header ref={ref} className={cx('ds-header', className)} {...rest} />
})

/* ── Brand ─────────────────────────────────────────────────────────────────
 * Brand mark — a monochrome logo masked and tinted to the live accent. Point
 * `src` at your own logo (any mask-able image URL) to rebrand. */
export interface BrandProps extends HTMLAttributes<HTMLSpanElement> {
  /** Image URL used as the CSS mask; defaults to the bundled DS mark. */
  src?: string
  /** Square edge length in px. */
  size?: number
}

export const Brand = forwardRef<HTMLSpanElement, BrandProps>(function Brand(
  { src, size = 36, className, style, ...rest },
  ref
) {
  return (
    <span
      ref={ref}
      role="img"
      aria-label="Brand"
      className={cx('ds-brand-mark', className)}
      style={{
        width: size,
        height: size,
        ...(src ? ({ ['--ds-brand-src' as string]: src } as React.CSSProperties) : null),
        ...style
      }}
      {...rest}
    />
  )
})

/* ── Type set ──────────────────────────────────────────────────────────────
 * Display (big Schibsted Grotesk headings/numbers), SectionTitle (section
 * headings — pick the level via `as`), Eyebrow (accent uppercase kicker). */
type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'

export interface DisplayProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: HeadingTag
}

export const Display = forwardRef<HTMLHeadingElement, DisplayProps>(function Display(
  { as = 'h1', className, ...rest },
  ref
) {
  const Tag = as
  return <Tag ref={ref} className={cx('ds-display', className)} {...rest} />
})

export interface SectionTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: HeadingTag
}

export const SectionTitle = forwardRef<HTMLHeadingElement, SectionTitleProps>(
  function SectionTitle({ as = 'h2', className, ...rest }, ref) {
    const Tag = as
    return <Tag ref={ref} className={cx('ds-section-title', className)} {...rest} />
  }
)

export type EyebrowProps = HTMLAttributes<HTMLSpanElement>

export const Eyebrow = forwardRef<HTMLSpanElement, EyebrowProps>(function Eyebrow(
  { className, ...rest },
  ref
) {
  return <span ref={ref} className={cx('ds-eyebrow', className)} {...rest} />
})
