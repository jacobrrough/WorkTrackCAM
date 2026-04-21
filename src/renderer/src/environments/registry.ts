/**
 * Shop environment registry — the user-facing concept that groups one or more
 * machine profiles into a focused workflow ("VCarve Pro", "Creality Print",
 * "Makera CAM"). Layered ON TOP of the existing CAM dispatch path: the
 * environment decides which op kinds appear in the UI, but `getMachineMode()`
 * + `OPS_BY_MODE` continue to drive the CAM runner / strategy validation.
 *
 * Pure data only — no React component refs. The sidebar uses
 * `availableOpKinds` (intersected with `OPS_BY_MODE[mode]` in `LeftPanel.tsx`)
 * and `EnvActionStrip.tsx` renders environment-specific quick controls.
 */
import type { ManufactureOperationKind } from '../../../shared/manufacture-schema'

/** Stable identifier for one of the three supported environments. */
export type EnvironmentId = 'vcarve_pro' | 'creality_print' | 'makera_cam'

/**
 * A shop environment groups machines into a purpose-built workflow.
 * The environment is the user-facing concept (visible on splash, brand bar,
 * and per-environment job lists); machine profiles remain the source of
 * truth for post template, dialect, work envelope, and CAM dispatch.
 */
export interface ShopEnvironment {
  /** Stable identifier used by routing, theming selectors, and storage keys. */
  readonly id: EnvironmentId
  /** Display name shown on splash, brand bar, and toolbar badge. */
  readonly name: string
  /** Short marketing line on the splash card. */
  readonly tagline: string
  /** Single Unicode glyph used on the splash card and brand bar. */
  readonly iconGlyph: string
  /** CSS color used by the `[data-environment="…"]` accent override. */
  readonly accentColor: string
  /** Machine profile IDs that route to this environment. */
  readonly machineIds: readonly string[]
  /** Default machine profile ID picked when entering the environment from splash. */
  readonly defaultMachineId: string
  /** Operation kinds offered in this environment's sidebar. Layered on top of `OPS_BY_MODE`. */
  readonly availableOpKinds: readonly ManufactureOperationKind[]
  /** localStorage key for the per-environment job list. */
  readonly jobsStorageKey: string
  /** True when the Python toolpath kernel is required for the env's primary workflow. */
  readonly requiresPython: boolean
  /** True when CuraEngine is required for the env's primary workflow. */
  readonly requiresCuraEngine: boolean
}

// ── Per-environment op kinds ────────────────────────────────────────────────
// `LeftPanel.tsx` intersects these with `OPS_BY_MODE[mode]` so each
// environment surfaces only the relevant subset of the global op catalog.

/** Wood-routing & 2D/2.5D toolpaths for the Laguna Swift 5×10. */
export const VCARVE_PRO_OPS: readonly ManufactureOperationKind[] = [
  'cnc_pocket',
  'cnc_contour',
  'cnc_drill',
  'cnc_chamfer'
] as const

/** FDM slicing + STL export for the Creality K2 Plus. */
export const CREALITY_PRINT_OPS: readonly ManufactureOperationKind[] = [
  'fdm_slice',
  'export_stl'
] as const

/** 3-axis precision milling op kinds — base set for Makera Carvera (3-Axis). */
export const MAKERA_3AXIS_OPS: readonly ManufactureOperationKind[] = [
  'cnc_pocket',
  'cnc_contour',
  'cnc_drill',
  'cnc_chamfer',
  'cnc_adaptive',
  'cnc_3d_rough',
  'cnc_3d_finish',
  'cnc_waterline',
  'cnc_raster',
  'cnc_pencil',
  'cnc_spiral_finish',
  'cnc_morphing_finish',
  'cnc_scallop_finish'
] as const

/** Full Makera CAM op set including 4-axis HD ops for the Makera Carvera (4th-Axis HD). */
export const MAKERA_CAM_OPS: readonly ManufactureOperationKind[] = [
  ...MAKERA_3AXIS_OPS,
  'cnc_4axis_roughing',
  'cnc_4axis_finishing',
  'cnc_4axis_contour',
  'cnc_4axis_indexed'
] as const

// ── Environment definitions ─────────────────────────────────────────────────

const VCARVE_PRO_ENV: ShopEnvironment = {
  id: 'vcarve_pro',
  name: 'VCarve Pro',
  tagline: 'Wood routing and 2D/2.5D toolpaths for the Laguna Swift 5×10.',
  iconGlyph: '\u{1FAB5}', // 🪵 wood
  accentColor: '#c47a2c',
  machineIds: ['laguna-swift-5x10'],
  defaultMachineId: 'laguna-swift-5x10',
  availableOpKinds: VCARVE_PRO_OPS,
  jobsStorageKey: 'fab-jobs-vcarve-v1',
  requiresPython: true,
  requiresCuraEngine: false
}

const CREALITY_PRINT_ENV: ShopEnvironment = {
  id: 'creality_print',
  name: 'Creality Print',
  tagline: 'FDM slicing and layer preview for the Creality K2 Plus.',
  iconGlyph: '\u{1F5A8}', // 🖨 printer
  accentColor: '#ff6a3d',
  machineIds: ['creality-k2-plus'],
  defaultMachineId: 'creality-k2-plus',
  availableOpKinds: CREALITY_PRINT_OPS,
  jobsStorageKey: 'fab-jobs-creality-v1',
  requiresPython: false,
  requiresCuraEngine: true
}

const MAKERA_CAM_ENV: ShopEnvironment = {
  id: 'makera_cam',
  name: 'Makera CAM',
  tagline: 'Precision desktop milling, ATC tool changer, and 3↔4-axis HD for the Makera Carvera.',
  iconGlyph: '\u2726', // ✦ four-pointed star
  accentColor: '#5cb3ff',
  machineIds: ['makera-carvera-3axis', 'makera-carvera-4axis'],
  defaultMachineId: 'makera-carvera-3axis',
  availableOpKinds: MAKERA_CAM_OPS,
  jobsStorageKey: 'fab-jobs-makera-v1',
  requiresPython: true,
  requiresCuraEngine: false
}

/** Lookup map keyed by environment ID. */
export const ENVIRONMENTS: Readonly<Record<EnvironmentId, ShopEnvironment>> = {
  vcarve_pro: VCARVE_PRO_ENV,
  creality_print: CREALITY_PRINT_ENV,
  makera_cam: MAKERA_CAM_ENV
}

/** Ordered list of environments — drives splash card layout. */
export const ENVIRONMENT_LIST: readonly ShopEnvironment[] = [
  VCARVE_PRO_ENV,
  CREALITY_PRINT_ENV,
  MAKERA_CAM_ENV
] as const

/** Type guard for environment IDs at runtime boundaries (e.g. parsed JSON). */
export function isEnvironmentId(value: unknown): value is EnvironmentId {
  return value === 'vcarve_pro' || value === 'creality_print' || value === 'makera_cam'
}
