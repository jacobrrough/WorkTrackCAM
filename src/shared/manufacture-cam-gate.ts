/**
 * Manufacture operation kinds that must not run through `cam:run` / Generate CAM.
 * Single source of truth for main (`describeCamOperationKind`) and renderer (early exit).
 */
export type ManufactureCamBlockedKind = 'fdm_slice' | 'export_stl'

/** cnc_laser / cnc_lathe_turn / cnc_probe: blocked from built-in CAM runner — separate IPC or dedicated posts. */
const BLOCKED = new Set<string>(['fdm_slice', 'export_stl', 'cnc_laser', 'cnc_lathe_turn', 'cnc_probe'])

export function isManufactureKindBlockedFromCam(kind: string | undefined): boolean {
  if (kind == null || kind === '') return false
  return BLOCKED.has(kind)
}

/** When non-null, `cam:run` should reject this kind (same copy as IPC policy). */
export function getManufactureCamRunBlock(kind: string | undefined): { error: string; hint: string } | null {
  if (kind === 'fdm_slice') {
    return {
      error: 'FDM slicing is not available through Generate CAM.',
      hint:
        'Use Utilities → Slice (CuraEngine) or Manufacture → Slice with CuraEngine on an fdm_slice row (source mesh + merged Cura settings from Settings). fdm_slice is not sent through cam:run / Generate CAM.'
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
  return null
}
