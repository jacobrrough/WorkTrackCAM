import type { MachineProfile } from '../shared/machine-schema'

export type PostDialectSnippets = {
  on: string
  off: string
  units: 'G21' | 'G20'
}

/**
 * Dialect-specific spindle and units defaults.
 * Extracted from post-process to keep dialect policy isolated.
 */
export function resolveDialectSnippets(dialect: MachineProfile['dialect']): PostDialectSnippets {
  switch (dialect) {
    case 'grbl':
      return { on: 'M3 S12000', off: 'M5', units: 'G21' }
    case 'grbl_4axis':
      return { on: 'M3 S12000', off: 'M5', units: 'G21' }
    case 'smoothieware':
      // [ID-0160] Cycle 68 — Smoothieware-family (Makera Carvera 3-axis)
      // shares the GRBL-flavored M3/M5 spindle convention. NOTE (Cycle 245,
      // task_feef69e0): this raw S12000 constant is a DIALECT default, not the
      // emitted value — renderPost resolves it against the machine profile's
      // [minSpindleRpm, maxSpindleRpm] window when no explicit RPM is given
      // (the bundled Carvera 3-axis floor is 13,000 RPM, so its posted
      // default is S13000; the 4-axis profile's 6,000 floor leaves S12000).
      return { on: 'M3 S12000', off: 'M5', units: 'G21' }
    case 'fanuc_4axis':
      return { on: 'M3 S10000', off: 'M5', units: 'G21' }
    case 'mach3_4axis':
      return { on: 'M3 S12000', off: 'M5', units: 'G21' }
    case 'linuxcnc_4axis':
      return { on: 'M3 S12000', off: 'M5', units: 'G21' }
    case 'siemens_4axis':
      return { on: 'M3 S10000', off: 'M5', units: 'G21' }
    case 'heidenhain_4axis':
      return { on: 'M3 S10000', off: 'M5', units: 'G21' }
    case 'mach3':
      return { on: 'M3', off: 'M5', units: 'G21' }
    case 'fanuc':
      return { on: 'M3 S10000', off: 'M5', units: 'G21' }
    case 'siemens':
      return { on: 'M3 S10000', off: 'M5', units: 'G21' }
    case 'heidenhain':
      return { on: 'M3 S10000', off: 'M5', units: 'G21' }
    default:
      return { on: 'M3 S10000', off: 'M5', units: 'G21' }
  }
}

export function resolveWorkOffsetLine(index: number | undefined): string | undefined {
  if (index == null) return undefined
  if (!Number.isInteger(index) || index < 1 || index > 6) return undefined
  return `G${53 + index}`
}
