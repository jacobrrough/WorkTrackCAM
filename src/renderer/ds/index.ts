/**
 * @worktrack/design-system — native in-app port.
 *
 * A strictly-typed React kit of themed primitives, reimplemented from the
 * upstream @worktrack/design-system bundle so it lives natively in the
 * electron-vite build (no `window.WorkTrackDS` global, full TS types). The look
 * comes from the `.ds-*` recipes in `styles/ds/ds-components.css`, driven by the
 * `--c-*` token bridge in `styles/ds/ds-tokens.css`.
 *
 * Usage — wrap a subtree once in {@link DsScope}, then compose primitives:
 *
 *   <DsScope>
 *     <SectionTitle>Material & Stock</SectionTitle>
 *     <Card style={{ padding: 12 }}>…</Card>
 *     <Button variant="primary">Send to Carvera</Button>
 *   </DsScope>
 *
 * The active theme is the app's own (`<html data-theme>`); DS components follow
 * it automatically across all 10 WorkTrack themes.
 */
export { cx } from './cx'
export { DsScope, type DsScopeProps } from './DsScope'
export { Modal, type ModalProps } from './Modal'
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  Card,
  type CardProps,
  PrimaryCard,
  type PrimaryCardProps,
  ListRow,
  type ListRowProps,
  Input,
  type InputProps,
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  IconBadge,
  type IconBadgeProps,
  AppHeader,
  type AppHeaderProps,
  Brand,
  type BrandProps,
  Display,
  type DisplayProps,
  SectionTitle,
  type SectionTitleProps,
  Eyebrow,
  type EyebrowProps
} from './primitives'
