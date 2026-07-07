/**
 * Home-shell screen registry — the shop-relevant subset of the handoff's
 * 9-screen app. Team / Billing / Activity are intentionally omitted: they are
 * multi-user SaaS surfaces that don't fit the single-operator "My Shop" scope.
 * (See the design-system-unification plan.)
 */
import type { HomeIconName } from './icons'

export type HomeScreenId = 'home' | 'files' | 'templates' | 'machine' | 'jobs' | 'settings'

export interface HomeNavItem {
  readonly id: HomeScreenId
  readonly label: string
  readonly icon: HomeIconName
  /** Accent count pill (e.g. queued jobs). Omitted when there's nothing to show. */
  readonly badge?: string
}

export const HOME_NAV: readonly HomeNavItem[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'templates', label: 'Templates', icon: 'grid' },
  { id: 'machine', label: 'Machine', icon: 'machine' },
  { id: 'jobs', label: 'Jobs', icon: 'jobs', badge: '1' },
  { id: 'settings', label: 'Settings', icon: 'gear' }
]

export const HOME_SCREEN_TITLES: Record<HomeScreenId, string> = {
  home: 'Home',
  files: 'Files',
  templates: 'Templates',
  machine: 'Machine',
  jobs: 'Jobs',
  settings: 'Settings'
}
