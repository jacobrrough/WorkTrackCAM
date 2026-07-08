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

/* ── Files ──────────────────────────────────────────────────────────────── */
export interface FolderEntry {
  readonly id: string
  readonly label: string
  readonly icon: HomeIconName
  readonly count: string
}

export const FILE_FOLDERS: readonly FolderEntry[] = [
  { id: 'all', label: 'All files', icon: 'folder', count: '48' },
  { id: 'prod', label: 'Production', icon: 'folder', count: '12' },
  { id: 'proto', label: 'Prototypes', icon: 'folder', count: '7' },
  { id: 'shared', label: 'Shared with me', icon: 'users', count: '5' },
  { id: 'trash', label: 'Trash', icon: 'file', count: '' }
]

export type FileKind = 'folder' | 'design' | 'toolpath' | 'assembly' | 'drawing'

export interface FileRow {
  readonly name: string
  readonly type: string
  readonly mod: string
  readonly size: string
  readonly owner: string
  readonly kind: FileKind
}

export const FILE_BREADCRUMB = ['WorkTrack', 'Projects', 'bracket-mount'] as const

export const FILES: readonly FileRow[] = [
  { name: 'Production', type: 'Folder', mod: 'Today, 14:22', size: '—', owner: 'You', kind: 'folder' },
  { name: 'Prototypes', type: 'Folder', mod: 'Yesterday', size: '—', owner: 'You', kind: 'folder' },
  { name: 'bracket-mount.wtc', type: 'Design', mod: '2m ago', size: '4.2 MB', owner: 'You', kind: 'design' },
  { name: 'bracket-mount.nc', type: 'Toolpath', mod: '5m ago', size: '182 KB', owner: 'You', kind: 'toolpath' },
  { name: 'enclosure-lid.wtc', type: 'Design', mod: 'yesterday', size: '6.1 MB', owner: 'A. Cole', kind: 'design' },
  { name: 'fixture-plate.wta', type: 'Assembly', mod: '3d ago', size: '9.7 MB', owner: 'You', kind: 'assembly' },
  { name: 'drawing-v2.pdf', type: 'Drawing', mod: 'last week', size: '820 KB', owner: 'M. Diaz', kind: 'drawing' }
]

export const FILE_ICON_BY_KIND: Record<FileKind, HomeIconName> = {
  folder: 'folder',
  design: 'cube',
  toolpath: 'jobs',
  assembly: 'cube',
  drawing: 'file'
}

/* ── Templates ──────────────────────────────────────────────────────────── */
export const TEMPLATE_CATS = ['All', 'Enclosures', 'Brackets', 'Gears', 'Panels', 'Fixtures', 'Knobs'] as const

export interface TemplateCard {
  readonly title: string
  readonly cat: string
  readonly desc: string
}

export const TEMPLATES: readonly TemplateCard[] = [
  { title: 'Parametric Enclosure', cat: 'Enclosures', desc: 'Snap-fit, adjustable walls' },
  { title: 'L-Bracket', cat: 'Brackets', desc: 'Gusseted, hole pattern' },
  { title: 'Spur Gear', cat: 'Gears', desc: 'Module & teeth driven' },
  { title: 'Vented Panel', cat: 'Panels', desc: 'Parametric louvers' },
  { title: 'Soft Jaws', cat: 'Fixtures', desc: 'Carvera vise profile' },
  { title: 'Control Knob', cat: 'Knobs', desc: 'Knurled, D-shaft bore' },
  { title: 'Hinged Box', cat: 'Enclosures', desc: 'Living-hinge lid' },
  { title: 'Motor Mount', cat: 'Brackets', desc: 'NEMA 17 / 23' }
]

/* ── Machine ────────────────────────────────────────────────────────────── */
export interface TelemetryTile {
  readonly k: string
  readonly v: string
  readonly u: string
}

export const MACHINE_HEADER = {
  name: 'Carvera',
  firmware: 'Firmware 1.4.1 · USB · SN CV-2381',
  status: 'Online · Cutting'
} as const

export const MACHINE_TELEMETRY: readonly TelemetryTile[] = [
  { k: 'Spindle', v: '15000', u: 'rpm' },
  { k: 'Feed', v: '1600', u: 'mm/min' },
  { k: 'Load', v: '48', u: '%' },
  { k: 'Temp', v: '39', u: '°C' }
]

export const MACHINE_POSITION = { x: 'X 42.180', y: 'Y 18.640', z: 'Z −3.200' } as const

export interface MachineControl {
  readonly label: string
  readonly icon: HomeIconName
}

export const MACHINE_CONTROLS: readonly MachineControl[] = [
  { label: 'Home', icon: 'home' },
  { label: 'Jog', icon: 'target' },
  { label: 'Probe', icon: 'probe' },
  { label: 'Raise Z', icon: 'lift' },
  { label: 'Unlock', icon: 'lock' }
]

export interface MaintenanceRow {
  readonly label: string
  readonly sub: string
  readonly status: string
  readonly ok: boolean
}

export const MAINTENANCE: readonly MaintenanceRow[] = [
  { label: 'Spindle runout', sub: 'Within 0.01 mm', status: 'OK', ok: true },
  { label: 'Belt tension', sub: 'Checked this week', status: 'OK', ok: true },
  { label: 'Probe calibration', sub: 'Recommended every 30 days', status: 'Due', ok: false }
]

export const MACHINE_CONNECTION = { interface: 'USB-C', wifi: 'workshop-5G' } as const

/* ── Jobs ───────────────────────────────────────────────────────────────── */
export const JOB_RUNNING = {
  machine: 'Carvera',
  file: 'bracket-mount.nc',
  progressPct: 46,
  line1: '46% · 2D Adaptive clear',
  eta: 'ETA 12:31',
  stock: '6061 Aluminum · T3 ⌀6'
} as const

export interface QueueRow {
  readonly pos: string
  readonly name: string
  readonly material: string
  readonly dur: string
}

export const JOB_QUEUE: readonly QueueRow[] = [
  { pos: '1', name: 'enclosure-lid.nc', material: 'Delrin', dur: '~28 min' },
  { pos: '2', name: 'vise-jaws.nc', material: '6061 Aluminum', dur: '~41 min' }
]

export type JobStatus = 'Completed' | 'Failed'

export interface HistoryRow {
  readonly name: string
  readonly material: string
  readonly dur: string
  readonly when: string
  readonly status: JobStatus
}

export const JOB_HISTORY: readonly HistoryRow[] = [
  { name: 'gear-24t.nc', material: 'Brass', dur: '18:04', when: 'Today 09:12', status: 'Completed' },
  { name: 'panel-a.nc', material: 'MDF', dur: '06:37', when: 'Yesterday', status: 'Completed' },
  { name: 'spindle-mount.nc', material: '6061 Aluminum', dur: '—', when: 'Yesterday', status: 'Failed' },
  { name: 'enclosure-base.nc', material: 'Delrin', dur: '22:59', when: '2 days ago', status: 'Completed' }
]

/* ── Settings ───────────────────────────────────────────────────────────── */
export const SETTINGS_PANES = [
  { id: 'profile', label: 'Profile' },
  { id: 'units', label: 'Units & display' },
  { id: 'defaults', label: 'Machine defaults' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'notifs', label: 'Notifications' }
] as const

export const UNIT_OPTS = [
  { id: 'mm', label: 'Millimeters' },
  { id: 'in', label: 'Inches' }
] as const

export const MODE_OPTS = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
] as const

export interface AccentSwatch {
  readonly id: string
  readonly rgb: string
}

export const ACCENT_SWATCHES: readonly AccentSwatch[] = [
  { id: 'signal-red', rgb: '234 68 68' },
  { id: 'deep-ocean', rgb: '37 99 235' },
  { id: 'forest', rgb: '22 130 92' },
  { id: 'ember', rgb: '217 119 6' },
  { id: 'synthwave', rgb: '190 60 200' }
]
