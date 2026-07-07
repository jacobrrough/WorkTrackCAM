/**
 * Home-screen sample content.
 *
 * These are DESIGN PLACEHOLDERS taken verbatim from the `WorkTrack CAD - App`
 * handoff prototype so the Home dashboard matches the spec pixel-for-pixel while
 * the live data sources are wired in later cycles. Per the handoff's State
 * Management notes, the real feeds — recent files, machine telemetry + running
 * job (live/websocket), and the activity stream — are separate wiring tasks.
 * Keep this module the single swap point: when the live sources land, replace
 * these constants with selectors and the Home components stay unchanged.
 */
import type { HomeIconName } from './icons'

export interface QuickStartItem {
  readonly key: string
  readonly label: string
  readonly icon: HomeIconName
  /** True for the single accent-filled tile (one accent per screen). */
  readonly accent: boolean
  /** Navigates into the modeling workspace (Canvas) when true. */
  readonly entersWorkspace: boolean
}

export interface RecentItem {
  readonly name: string
  readonly kind: string
  readonly edited: string
  readonly size: string
}

export interface ActivityItem {
  readonly icon: HomeIconName
  readonly text: string
  readonly time: string
}

export interface OnMachine {
  readonly machineName: string
  readonly file: string
  readonly status: string
  readonly operation: string
  readonly eta: string
  readonly progressPct: number
}

export const QUICK_START: readonly QuickStartItem[] = [
  { key: 'new-design', label: 'New design', icon: 'plus', accent: true, entersWorkspace: true },
  { key: 'new-template', label: 'New from template', icon: 'grid', accent: false, entersWorkspace: false },
  { key: 'import', label: 'Import STEP / STL', icon: 'importI', accent: false, entersWorkspace: false },
  { key: 'send-carvera', label: 'Send to Carvera', icon: 'machine', accent: false, entersWorkspace: false }
]

export const RECENTS: readonly RecentItem[] = [
  { name: 'bracket-mount', kind: 'Design', edited: '2m ago', size: '4.2 MB' },
  { name: 'spindle-mount', kind: 'Design', edited: '1h ago', size: '2.8 MB' },
  { name: 'enclosure-lid', kind: 'Design', edited: 'yesterday', size: '6.1 MB' },
  { name: 'gear-24t', kind: 'Design', edited: '2d ago', size: '1.4 MB' },
  { name: 'fixture-plate', kind: 'Assembly', edited: '3d ago', size: '9.7 MB' },
  { name: 'vise-jaws', kind: 'Design', edited: 'last week', size: '3.3 MB' }
]

export const HOME_ACTIVITY: readonly ActivityItem[] = [
  { icon: 'check', text: 'Carvera finished gear-24t.nc', time: '18 minutes ago' },
  { icon: 'chat', text: 'Alex Cole commented on bracket-mount', time: '1 hour ago' },
  { icon: 'share', text: 'Maria Diaz shared fixture-plate', time: '2 hours ago' },
  { icon: 'bolt', text: 'Firmware 1.4.2 available for Carvera', time: 'Yesterday' }
]

export const ON_MACHINE: OnMachine = {
  machineName: 'Carvera',
  file: 'bracket-mount.nc',
  status: 'Cutting',
  operation: '2D Adaptive clear',
  eta: 'ETA 12:31',
  progressPct: 46
}

export const GREETING = 'Good afternoon, Jacob'
export const GREETING_SUB = 'You have 1 job cutting and 2 queued on Carvera.'
