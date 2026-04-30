/**
 * My Shop preset fixtures — Jacob's three-machine shop, mapped to the
 * real-world workflows called out in `CLAUDE.md` §"UI Requirements":
 *
 *   > Add a "My Shop" tab or quick-select that ONLY shows these three
 *   > machines plus their real-world presets (full-sheet routing,
 *   > high-speed FDM, 4-axis rotary parts).
 *
 * This module is PURE DATA — no React imports, no localStorage I/O, no
 * network. It is consumed by `MyShopPanel.tsx` (renderer UI) and pinned by
 * `my-shop-presets.test.ts` so any future drift from the three-machine
 * scope fails a fast vitest run before it can ship.
 *
 * The three target machine IDs are FROZEN to the CLAUDE.md target list:
 *   1. `laguna-swift-5x10`       — Laguna Swift 5×10, CNC router (3-axis)
 *   2. `creality-k2-plus`        — Creality K2 Plus, FDM (Klipper/Moonraker)
 *   3. `makera-carvera-4axis`    — Makera Carvera + 4th Axis rotary
 *
 * `makera-carvera-3axis` is a registered variant of the Makera CAM env
 * (see `environments/registry.ts`), but the "My Shop" surface focuses on
 * the 4th-Axis HD workflow because rotary parts is the specific preset
 * CLAUDE.md singles out. Users can still switch to the 3-axis variant via
 * the brand-bar env switcher or the Library drawer.
 */
import type { MachineProfile } from '../../../shared/machine-schema'
import type { ManufactureOperationKind } from '../../../shared/manufacture-schema'
import type { EnvironmentId } from './registry'

/**
 * The three machine IDs the "My Shop" surface recognizes, in display order
 * (wood router first, then FDM, then desktop 4-axis — matches the brand-bar
 * env-switcher order: VCarve Pro → Creality Print → Makera CAM).
 */
export const MY_SHOP_MACHINE_IDS = [
  'laguna-swift-5x10',
  'creality-k2-plus',
  'makera-carvera-4axis'
] as const

/** String literal union over the three target machine IDs. */
export type MyShopMachineId = (typeof MY_SHOP_MACHINE_IDS)[number]

/** Type guard for machine IDs at runtime boundaries (JSON imports, IPC). */
export function isMyShopMachineId(value: unknown): value is MyShopMachineId {
  return (
    value === 'laguna-swift-5x10' ||
    value === 'creality-k2-plus' ||
    value === 'makera-carvera-4axis'
  )
}

/**
 * One real-world workflow the operator runs often. Mirrors the three
 * scenarios explicitly named in CLAUDE.md. Each preset:
 *   - lives under exactly one target machine,
 *   - routes to exactly one environment (matches the env registry),
 *   - optionally recommends a primary op kind so the sidebar can
 *     pre-scroll/pre-expand when the preset is launched.
 *
 * The shape is intentionally narrow — the renderer wires `onSelectPreset`
 * to `resolveQuickSwitchMachine(env, machines, …)` so presets do NOT
 * bypass the quick-switch resolver's variant-memory / missing-machine
 * rules. See `MyShopPanel.tsx` for the wiring.
 */
export interface MyShopPreset {
  /** Stable ID for the preset — used as the button `key` and telemetry tag. */
  readonly id: string
  /** Target machine for this workflow. */
  readonly machineId: MyShopMachineId
  /** Environment this preset activates on launch. */
  readonly environmentId: EnvironmentId
  /** Short display label shown on the preset button. */
  readonly label: string
  /** One-line description shown under the label on the card. */
  readonly description: string
  /**
   * Optional primary op kind to pre-select in the sidebar when the preset
   * is launched. Must be a member of the target env's `availableOpKinds`
   * — enforced by the pinning test.
   */
  readonly primaryOpKind?: ManufactureOperationKind
}

/**
 * The real-world preset list. Ordered the same way the cards render
 * (per-machine block, then preset order within the block).
 *
 * Preset labels deliberately echo the three CLAUDE.md phrases verbatim
 * ("Full-sheet", "High-speed FDM", "4-axis rotary") so a future drift
 * from the spec is caught by the regex assertions in the pinning test.
 */
export const MY_SHOP_PRESETS: readonly MyShopPreset[] = [
  // ── Laguna Swift 5×10 — wood routing, full-sheet stock ──────────────────
  {
    id: 'laguna-full-sheet-plywood',
    machineId: 'laguna-swift-5x10',
    environmentId: 'vcarve_pro',
    label: 'Full-sheet plywood routing',
    description:
      '48 × 96 in plywood on the 6-zone vacuum table — pocket + contour passes with dust collection.',
    primaryOpKind: 'cnc_pocket'
  },
  {
    id: 'laguna-sign-vcarve',
    machineId: 'laguna-swift-5x10',
    environmentId: 'vcarve_pro',
    label: 'Sign / lettering V-carve',
    description:
      'V-bit chamfer + contour on dimensional lumber — smaller stock, T-slot clamped.',
    primaryOpKind: 'cnc_chamfer'
  },
  // ── Creality K2 Plus — high-speed FDM, Klipper/Moonraker ────────────────
  {
    id: 'k2-high-speed-fdm',
    machineId: 'creality-k2-plus',
    environmentId: 'creality_print',
    label: 'High-speed FDM print',
    description:
      '0.4 mm nozzle, 600 mm/s cap, input shaping — push via Moonraker to the K2 Plus.',
    primaryOpKind: 'fdm_slice'
  },
  {
    id: 'k2-export-stl',
    machineId: 'creality-k2-plus',
    environmentId: 'creality_print',
    label: 'Export STL for slicer hand-off',
    description:
      'Export the design-mode mesh as STL when you want to slice in an external tool.',
    primaryOpKind: 'export_stl'
  },
  // ── Makera Carvera 4th-Axis — rotary parts, simultaneous/indexed ────────
  {
    id: 'carvera-4axis-rotary-parts',
    machineId: 'makera-carvera-4axis',
    environmentId: 'makera_cam',
    label: '4-axis rotary parts',
    description:
      'Cylindrical stock on the harmonic-drive rotary — roughing + finishing around the A-axis.',
    primaryOpKind: 'cnc_4axis_roughing'
  },
  {
    id: 'carvera-4axis-indexed-engrave',
    machineId: 'makera-carvera-4axis',
    environmentId: 'makera_cam',
    label: 'Indexed engraving',
    description:
      'Index the rotary to a fixed angle and run a 3-axis engrave pass — auto-probe first.',
    primaryOpKind: 'cnc_4axis_indexed'
  }
] as const

/**
 * Return the subset of `machines` that belong to Jacob's three-machine
 * shop, in the canonical display order (`MY_SHOP_MACHINE_IDS`). Machines
 * present in the input but NOT in the target list are dropped. Target
 * machines missing from the input are silently omitted — the renderer
 * shows a "not installed" placeholder for those IDs.
 */
export function listMyShopMachines(
  machines: readonly MachineProfile[]
): MachineProfile[] {
  const result: MachineProfile[] = []
  for (const id of MY_SHOP_MACHINE_IDS) {
    const m = machines.find((candidate) => candidate.id === id)
    if (m) result.push(m)
  }
  return result
}

/**
 * Return the presets that target the given machine ID, in declaration
 * order. Unknown machine IDs return an empty array (the UI should then
 * render the card header but no preset buttons).
 */
export function getMyShopPresetsForMachine(
  machineId: string
): MyShopPreset[] {
  return MY_SHOP_PRESETS.filter((preset) => preset.machineId === machineId)
}
