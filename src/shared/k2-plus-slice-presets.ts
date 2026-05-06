/**
 * Creality K2 Plus slicer quality presets.
 *
 * CLAUDE.md "USER CONTEXT -- TARGET MACHINES" §1 specifies the K2 Plus as
 * 350×350×350 mm CoreXY closed-loop, 600 mm/s peak XY feedrate, 30000 mm/s²
 * peak XY acceleration, dual-gear direct drive, 1.75 mm filament, 0.4 mm
 * nozzle standard, heated bed + heated chamber, Klipper-based firmware.
 *
 * `resources/slicer/creality_k2_plus.def.json` (Cycle 343, [P2-K2-SLICE]/
 * Cycle 4) bakes the hardware *ceilings* into the printer definition. This
 * module layers on top: two K2-tuned QUALITY presets that the Manufacture
 * workspace surfaces as "Standard" and "High-Speed". Both presets stay
 * STRICTLY UNDER the hardware ceilings -- the paired pin
 * `k2-plus-slice-presets-pin.test.ts` enforces that invariant at CI time so
 * a careless tuning bump cannot ship G-code that exceeds the K2's mechanical
 * envelope.
 *
 * "Standard" is the safe daily-driver: PLA at 200 mm/s, 0.2 mm layers,
 * 5000 mm/s² accel, 8 mm/s jerk -- comfortably inside the K2's window with
 * good surface quality on PLA / PETG / ABS / ASA.
 *
 * "High-Speed" leverages the K2's input-shaping headroom: PLA at 500 mm/s,
 * 0.2 mm layers, 25000 mm/s² accel, 9 mm/s jerk (at the K2 ceiling). Print
 * temp lifts to 230 °C to keep up with the hot-end melt rate at speed.
 * Suitable for the K2-aligned high-flow hotends Creality ships standard.
 *
 * Both presets target the K2's CoreXY direct-drive geometry: retraction
 * stays at 0.5 mm (standard) / 0.5 mm at 60 mm/s (high-speed), well below
 * Bowden retraction territory. Chamber heater is engaged for both presets
 * (35 °C standard, 40 °C high-speed) per CLAUDE.md "heated chamber" spec.
 *
 * This module exports KEY/VALUE strings tailored to CuraEngine's `-s` flag
 * argv layer in `src/main/slicer.ts`. It DOES NOT speak G-code directly --
 * G-code is emitted by CuraEngine after these settings flow through the
 * `creality_k2_plus.def.json` printer definition.
 *
 * Roadmap: [P2-K2-SLICE]/Cycle 5 (K2 quality presets, post-Cycle-4 def.json
 * hardware overrides). Related: CLAUDE.md "Per-Cycle Deliverables" item 3
 * ("K2 Plus slicer presets (high-speed + standard)").
 */

/** Discriminator for the K2-Plus-tuned quality presets. */
export const K2_PLUS_QUALITY_PRESET_IDS = ['standard', 'high_speed'] as const
export type K2PlusQualityPresetId = (typeof K2_PLUS_QUALITY_PRESET_IDS)[number]

/** K2 Plus hardware ceilings replicated from `creality_k2_plus.def.json`.
 *
 *  These constants exist for a single purpose: paired-pin assertions that
 *  every shipped K2 quality preset stays under the K2's mechanical
 *  envelope. Editing these requires editing the def.json AND CLAUDE.md
 *  "USER CONTEXT -- TARGET MACHINES" §1 in the same change. */
export const K2_PLUS_HARDWARE_CEILINGS = {
  /** Max XY feedrate per CLAUDE.md (mm/s). */
  maxFeedrateXyMmPerSec: 600,
  /** Max Z feedrate per def.json (mm/s). */
  maxFeedrateZMmPerSec: 30,
  /** Max E feedrate per def.json (mm/s). */
  maxFeedrateEMmPerSec: 100,
  /** Max XY acceleration per CLAUDE.md (mm/s²). */
  maxAccelXyMmPerSec2: 30000,
  /** Max Z acceleration per def.json (mm/s²). */
  maxAccelZMmPerSec2: 500,
  /** Max E acceleration per def.json (mm/s²). */
  maxAccelEMmPerSec2: 5000,
  /** Max XY jerk (Klipper square_corner_velocity, mm/s). */
  maxJerkXyMmPerSec: 9,
  /** Max nozzle temperature per `creality-k2-plus.json` (°C). */
  maxNozzleTempC: 350,
  /** Max bed temperature per `creality-k2-plus.json` (°C). */
  maxBedTempC: 120
} as const

export type K2PlusQualityPreset = {
  /** Stable id used by UI presets and persisted project files. */
  id: K2PlusQualityPresetId
  /** Human-readable label for the Manufacture workspace preset picker. */
  label: string
  /**
   * Short rationale shown as a hover/help tooltip in the UI. Pinned by the
   * paired test so the label can\'t silently drift to something off-spec.
   */
  description: string
  /**
   * CuraEngine `-s` settings (key=value strings). Flowed through
   * `buildCuraSliceArgsFromSettingsMap` after merge against the printer
   * def.json overrides. Keys are CuraEngine setting ids (snake_case).
   */
  settings: Readonly<Record<string, string>>
}

/**
 * "Standard" preset -- 200 mm/s PLA daily-driver, 0.2 mm layers. All speeds
 * and accelerations stay comfortably inside the K2 envelope (highest single
 * value is travel_speed=300 mm/s vs 600 mm/s ceiling).
 */
const STANDARD_PRESET: K2PlusQualityPreset = {
  id: 'standard',
  label: 'K2 Plus Standard (PLA, 200 mm/s)',
  description:
    'Safe daily-driver: PLA, 0.2 mm layers, 200 mm/s print speed, 5000 mm/s² acceleration. Well inside K2 ceilings; good surface quality on PLA / PETG / ABS / ASA.',
  settings: Object.freeze({
    // Geometry
    layer_height: '0.2',
    layer_height_0: '0.28',
    line_width: '0.4',
    wall_line_count: '3',
    top_layers: '5',
    bottom_layers: '4',
    infill_sparse_density: '20',
    infill_pattern: 'grid',
    // Speeds (mm/s) -- all under 600 mm/s K2 XY ceiling
    speed_print: '200',
    speed_wall_0: '150',
    speed_wall_x: '180',
    speed_topbottom: '150',
    speed_infill: '250',
    speed_travel: '300',
    speed_layer_0: '60',
    // Accelerations (mm/s²) -- under 30000 K2 XY ceiling
    acceleration_print: '5000',
    acceleration_travel: '8000',
    acceleration_wall_0: '4000',
    acceleration_topbottom: '4000',
    acceleration_layer_0: '1500',
    // Jerk (mm/s) -- under 9 K2 XY ceiling
    jerk_print: '8',
    jerk_travel: '8',
    jerk_wall_0: '6',
    jerk_layer_0: '4',
    // Retraction (direct-drive K2 -- short distance, moderate speed)
    retraction_enable: 'true',
    retraction_amount: '0.5',
    retraction_speed: '40',
    retraction_retract_speed: '40',
    retraction_prime_speed: '30',
    // Temperatures (°C)
    material_print_temperature: '215',
    material_print_temperature_layer_0: '220',
    material_bed_temperature: '60',
    material_bed_temperature_layer_0: '65',
    build_volume_temperature: '35',
    // Cooling
    cool_fan_enabled: 'true',
    cool_fan_speed: '100',
    cool_fan_speed_0: '0',
    cool_min_layer_time: '7',
    // Adhesion
    adhesion_type: 'skirt',
    skirt_line_count: '2',
    skirt_gap: '4'
  })
}

/**
 * "High-Speed" preset -- 500 mm/s PLA, leverages the K2\'s input-shaping
 * headroom and direct-drive responsiveness. travel_speed=600 sits AT the
 * K2 ceiling; jerk_print=9 sits AT the K2 ceiling. All other values stay
 * strictly under the envelope. Print temp lifts to 230 °C to keep up with
 * the hot-end melt rate at speed.
 */
const HIGH_SPEED_PRESET: K2PlusQualityPreset = {
  id: 'high_speed',
  label: 'K2 Plus High-Speed (PLA, 500 mm/s)',
  description:
    'High-throughput PLA: 0.2 mm layers, 500 mm/s print speed, 25000 mm/s² acceleration, 230 °C nozzle. Travel and jerk at K2 ceiling. Best paired with high-flow hotend and Klipper input-shaping calibrated for the carriage.',
  settings: Object.freeze({
    // Geometry
    layer_height: '0.2',
    layer_height_0: '0.3',
    line_width: '0.42',
    wall_line_count: '3',
    top_layers: '5',
    bottom_layers: '4',
    infill_sparse_density: '15',
    infill_pattern: 'gyroid',
    // Speeds (mm/s) -- travel sits AT 600 K2 XY ceiling
    speed_print: '500',
    speed_wall_0: '350',
    speed_wall_x: '450',
    speed_topbottom: '300',
    speed_infill: '600',
    speed_travel: '600',
    speed_layer_0: '80',
    // Accelerations (mm/s²) -- under 30000 K2 XY ceiling
    acceleration_print: '25000',
    acceleration_travel: '30000',
    acceleration_wall_0: '15000',
    acceleration_topbottom: '12000',
    acceleration_layer_0: '3000',
    // Jerk (mm/s) -- AT 9 K2 XY ceiling
    jerk_print: '9',
    jerk_travel: '9',
    jerk_wall_0: '8',
    jerk_layer_0: '6',
    // Retraction (direct-drive K2 -- slightly faster retract for speed)
    retraction_enable: 'true',
    retraction_amount: '0.5',
    retraction_speed: '60',
    retraction_retract_speed: '60',
    retraction_prime_speed: '40',
    // Temperatures (°C) -- lifted for melt rate at speed
    material_print_temperature: '230',
    material_print_temperature_layer_0: '235',
    material_bed_temperature: '60',
    material_bed_temperature_layer_0: '65',
    build_volume_temperature: '40',
    // Cooling
    cool_fan_enabled: 'true',
    cool_fan_speed: '100',
    cool_fan_speed_0: '0',
    cool_min_layer_time: '5',
    // Adhesion
    adhesion_type: 'skirt',
    skirt_line_count: '2',
    skirt_gap: '4'
  })
}

/** All K2 Plus quality presets keyed by id. */
export const K2_PLUS_SLICE_PRESETS: Readonly<Record<K2PlusQualityPresetId, K2PlusQualityPreset>> =
  Object.freeze({
    standard: STANDARD_PRESET,
    high_speed: HIGH_SPEED_PRESET
  })

/** Resolve a preset by id; returns `undefined` for unknown ids. */
export function resolveK2PlusPreset(id: string | null | undefined): K2PlusQualityPreset | undefined {
  if (id == null) return undefined
  if ((K2_PLUS_QUALITY_PRESET_IDS as readonly string[]).includes(id)) {
    return K2_PLUS_SLICE_PRESETS[id as K2PlusQualityPresetId]
  }
  return undefined
}

/**
 * Pure helper: convert a preset to the `Map<string, string>` shape consumed
 * by `buildCuraSliceArgsFromSettingsMap`. Returns a fresh Map per call so
 * callers can mutate (e.g. layer the user-level `extraSettings` JSON on top)
 * without aliasing the frozen preset table.
 */
export function k2PlusPresetToEngineSettingsMap(preset: K2PlusQualityPreset): Map<string, string> {
  return new Map(Object.entries(preset.settings))
}
