/**
 * Manufacture operation kinds that must not run through `cam:run` / Generate CAM.
 * Single source of truth for main (`describeCamOperationKind`) and renderer (early exit).
 */
export type ManufactureCamBlockedKind = 'fdm_slice' | 'export_stl'

/**
 * Dead-engine CAM kinds — capability-honesty gate (CAM ENHANCE).
 *
 * These op kinds were authored against the `engines/cam/toolpath_engine/` (and
 * the `engines/cam/advanced/`) Python engines that were DELETED in the
 * 2026-05-27 open-source pivot, OR target a 5-axis machine class that is NOT in
 * the My-Shop-Only scope (K2 / Laguna / Carvera-3 / Carvera-4). With the engine
 * gone they route through `tryToolpathEngine`, which is now a permanent no-op
 * shim (`ok: false`), and—because they have no OpenCAMLib or built-in 2D/4-axis
 * fallback—`runCamPipeline` ALWAYS returns a hard "Toolpath engine failed"
 * error. `cnc_thread_mill` is the one exception that does NOT hard-fail: with no
 * dedicated thread engine it falls all the way through to the built-in parallel
 * finish, silently emitting a meaningless flat raster instead of a thread — an
 * even worse kind of dishonesty. Offering any of these in the picker advertises
 * a capability the app does not have, so they are blocked here and removed from
 * the op-kind picker (see `OFFERED_CAM_OP_KINDS`).
 *
 * NOTE — kinds that are intentionally NOT in this list because they have a REAL
 * path:
 *   - `cnc_trochoidal_hsm`  → 2D contour engine when `contourPoints` is set
 *                             (mesh mode falls back to parallel finish — honest).
 *   - `cnc_4axis_continuous`→ the TypeScript 4-axis engine (`src/main/cam-axis4`).
 *   - `cnc_3d_rough` / `cnc_3d_finish` → OpenCAMLib + built-in fallback chain.
 */
export const DEAD_ENGINE_CAM_KINDS = [
  'cnc_spiral_finish',
  'cnc_morphing_finish',
  'cnc_steep_shallow',
  'cnc_scallop_finish',
  'cnc_auto_select',
  'cnc_thread_mill',
  'cnc_5axis_contour',
  'cnc_5axis_swarf',
  'cnc_5axis_flowline'
] as const

export type DeadEngineCamKind = (typeof DEAD_ENGINE_CAM_KINDS)[number]

/**
 * cnc_laser / cnc_lathe_turn / cnc_probe: blocked from built-in CAM runner —
 * separate IPC or dedicated posts. The dead-engine kinds above are folded in so
 * the picker and `cam:run` agree on a single blocked set.
 */
const BLOCKED = new Set<string>([
  'fdm_slice',
  'export_stl',
  'cnc_laser',
  'cnc_lathe_turn',
  'cnc_probe',
  ...DEAD_ENGINE_CAM_KINDS
])

export function isManufactureKindBlockedFromCam(kind: string | undefined): boolean {
  if (kind == null || kind === '') return false
  return BLOCKED.has(kind)
}

/**
 * Op kinds the Manufacture operation picker (`ManufactureOperationList`) offers
 * in its kind `<select>`, paired with their human labels. **Single source of
 * truth** for the dropdown so a dead/blocked kind can never drift back into the
 * picker: every entry here MUST be runnable (no `getManufactureCamRunBlock`
 * block), and the picker derives its options from this list. Order is the
 * operator-facing order (FDM first, then 3-axis surface/2D, then 4-axis rotary,
 * then export).
 *
 * Pins (`cam-operation-policy-pin.test.ts`): every offered `kind` is
 * `runnable: true`; no offered `kind` is in `DEAD_ENGINE_CAM_KINDS`/`BLOCKED`.
 */
export const OFFERED_CAM_OP_KINDS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: 'fdm_slice', label: 'FDM slice' },
  { kind: 'cnc_parallel', label: 'CNC parallel' },
  { kind: 'cnc_contour', label: 'CNC contour' },
  { kind: 'cnc_pocket', label: 'CNC pocket' },
  { kind: 'cnc_vcarve', label: 'CNC V-carve (medial-axis, variable depth)' },
  { kind: 'cnc_drill', label: 'CNC drill' },
  { kind: 'cnc_adaptive', label: 'CNC adaptive clearing (2D trochoidal-relief or OCL 3D)' },
  { kind: 'cnc_waterline', label: 'CNC waterline (OCL Z-level or fallback)' },
  { kind: 'cnc_raster', label: 'CNC raster (OCL or mesh / bounds)' },
  { kind: 'cnc_pencil', label: 'CNC pencil (tight OCL raster / rest cleanup)' },
  { kind: 'cnc_trochoidal_hsm', label: 'CNC trochoidal HSM (2D trochoid-heavy or fallback)' },
  { kind: 'cnc_4axis_roughing', label: '4-axis roughing (rotary)' },
  { kind: 'cnc_4axis_finishing', label: '4-axis finishing (rotary)' },
  { kind: 'cnc_4axis_contour', label: '4-axis contour (rotary)' },
  { kind: 'cnc_4axis_indexed', label: '4-axis indexed (rotary)' },
  { kind: 'cnc_4axis_continuous', label: '4-axis continuous (rotary)' },
  { kind: 'export_stl', label: 'Export STL' }
]

/** When non-null, `cam:run` should reject this kind (same copy as IPC policy). */
export function getManufactureCamRunBlock(kind: string | undefined): { error: string; hint: string } | null {
  if (kind === 'fdm_slice') {
    return {
      error: 'FDM slicing is not available through Generate CAM.',
      hint:
        'FDM slicing runs through OrcaSlicer, not cam:run. Use the Manufacture → Device / Send tab (ProfileStack → Send to K2 Plus), which slices via the bundled OrcaSlicer (resources/orca-slicer/, src/main/slicer/orca-wrapper.ts) and pushes to the printer over Moonraker. fdm_slice is a planning row, not a CNC toolpath.'
    }
  }
  if (kind === 'export_stl') {
    return {
      error: 'Export STL is not a CNC toolpath operation.',
      hint: 'Export meshes from Design or project assets/. The export_stl operation is for planning only and does not use cam:run.'
    }
  }
  if (kind === 'cnc_laser') {
    return {
      error: 'Laser operations are not posted by the built-in CAM runner.',
      hint: 'Use Makera CAM or dedicated laser software to generate laser G-code. The cnc_laser kind is for planning only.'
    }
  }
  if (kind === 'cnc_lathe_turn') {
    return {
      error: 'Lathe / turning is not posted by the built-in CAM runner yet.',
      hint:
        'Use CAM software with lathe posts for G-code. `cnc_lathe_turn` is reserved in manufacture.json for future axis + stock + cycle work (see docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_probe') {
    return {
      error: 'Probing cycles use the probe:generate IPC, not cam:run.',
      hint:
        'Use the probing cycle generator (probe:generate) with a ProbeCycleType and probe parameters. Supported cycles: singleSurface, boreCenter, bossCenter, cornerFind, toolLength.'
    }
  }
  if (kind === 'cnc_thread_mill') {
    return {
      error: 'Thread milling is not posted by the built-in CAM runner.',
      hint:
        'There is no thread-milling engine — the kind would silently fall through to a flat parallel finish, which is NOT a thread. Use CAM software with a thread-mill cycle, or a tapping/single-point op on your controller. (docs/MACHINES.md)'
    }
  }
  if (
    kind === 'cnc_5axis_contour' ||
    kind === 'cnc_5axis_swarf' ||
    kind === 'cnc_5axis_flowline'
  ) {
    return {
      error: 'Simultaneous 5-axis is not supported by the built-in CAM runner.',
      hint:
        'No machine in this shop is 5-axis (K2 Plus, Laguna Swift 5x10, Makera Carvera 3-axis + 4-axis rotary), and the 5-axis toolpath engine was removed in the 2026-05-27 pivot. Use dedicated 5-axis CAM if you add 5-axis hardware. (docs/MACHINES.md)'
    }
  }
  if (
    kind === 'cnc_spiral_finish' ||
    kind === 'cnc_morphing_finish' ||
    kind === 'cnc_steep_shallow' ||
    kind === 'cnc_scallop_finish' ||
    kind === 'cnc_auto_select'
  ) {
    return {
      error: 'This freeform finishing strategy is not available — its toolpath engine was removed.',
      hint:
        'The Python toolpath_engine that powered spiral / morphing / steep-and-shallow / scallop / auto-select was deleted in the 2026-05-27 open-source pivot, so these kinds always hard-fail. Use a runnable 3D finish instead: cnc_waterline, cnc_raster, cnc_pencil, or cnc_3d_finish. (docs/MACHINES.md)'
    }
  }
  return null
}
