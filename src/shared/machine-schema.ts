import { z } from 'zod'

export const machineProfileSchema = z.object({
  id: z.string().trim().min(1).describe('Unique machine profile identifier'),
  name: z.string().trim().min(1).describe('Human-readable machine name'),
  kind: z.enum(['fdm', 'cnc']).describe('Machine type: fdm (3D printer) or cnc (milling)'),
  /** Millimeters */
  workAreaMm: z
    .object({
      x: z.number().positive().describe('Work area X dimension in mm'),
      y: z.number().positive().describe('Work area Y dimension in mm'),
      z: z.number().positive().describe('Work area Z dimension in mm')
    })
    .describe('Machine work area dimensions in millimeters'),
  maxFeedMmMin: z.number().positive().describe('Maximum feed rate in mm/min'),
  /** Post template filename under resources/posts */
  postTemplate: z
    .string()
    .trim()
    .min(1)
    .describe('Post-processor template filename under resources/posts/'),
  /** Replaced in post: grbl, mach3, generic_mm, grbl_4axis, fanuc_4axis, mach3_4axis, linuxcnc_4axis, siemens_4axis, heidenhain_4axis, fanuc, siemens, heidenhain, smoothieware */
  dialect: z
    .enum([
      'grbl',
      'mach3',
      'generic_mm',
      'grbl_4axis',
      'fanuc_4axis',
      'mach3_4axis',
      'linuxcnc_4axis',
      'siemens_4axis',
      'heidenhain_4axis',
      'fanuc',
      'siemens',
      'heidenhain',
      // [ID-0160] Cycle 68 — Smoothieware-family controllers (Makera Carvera
      // 3-axis, BeagleBoneBlack-Smoothie, etc.). GRBL-flavored but extends
      // GRBL by supporting tool-length compensation (G43/G49), canned cycles,
      // and richer feed/coolant control. Distinct from 'grbl' so the
      // dialect-compliance validator stops emitting GRBL_NO_TLC false-
      // positives on Carvera ATC G-code that legitimately uses G43/G49.
      // Additive enum entry — existing 'grbl' values still parse unchanged
      // (Safety Rule 2: no migration needed for saved projects).
      'smoothieware'
    ])
    .describe('G-code dialect: grbl, mach3, fanuc, siemens, heidenhain, linuxcnc_4axis, siemens_4axis, smoothieware, etc.'),
  axisCount: z
    .number()
    .int()
    .min(3)
    .max(5)
    .optional()
    .describe('Number of controlled axes: 3=XYZ, 4=+A rotary, 5=+A+B'),
  aAxisRangeDeg: z
    .number()
    .positive()
    .optional()
    .describe('A-axis rotation range in degrees (e.g. 360 for continuous)'),
  aAxisOrientation: z
    .enum(['x', 'y'])
    .optional()
    .describe('Axis of A rotation: x or y'),
  maxRotaryRpm: z
    .number()
    .positive()
    .optional()
    .describe('Max rotary table speed in RPM (default 20). Used for A-axis feed rate validation.'),
  /**
   * For 4-axis machines with a fixed chuck (e.g. the Makera Carvera 4th-Axis
   * HD harmonic-drive module): outer radius of the chuck/module body in
   * millimeters, measured from the rotation axis. Used as the conservative
   * radial clearance floor by the on-by-default checkRotaryFixtureCollision
   * sweep in src/main/cam-axis4/index.ts when the caller does not supply an
   * explicit rotaryFixture. Absent means "sweep stays opt-in as before" --
   * a missing value will never surface a false-positive chuck warning.
   * Additive/optional per Safety Rule 2 (no migration needed). See roadmap
   * [ID-0008]; CLAUDE.md USER CONTEXT for the 92 mm Carvera rotary module
   * diameter (radius = 46 mm).
   */
  rotaryChuckOuterRadiusMm: z
    .number()
    .positive()
    .optional()
    .describe(
      'Outer radius (mm) of the fixed rotary chuck/module body. Used as the default chuck radius by the 4-axis collision sweep.'
    ),
  /**
   * CNC -- number of slots in the machine's automatic tool changer (ATC),
   * counting *cutting* tool slots only (the wireless probe slot is tracked
   * separately by `atcProbeSlot`). Absent or zero means "no ATC; tool
   * changes must be operator-initiated and the post-processor must NOT
   * emit M6 macros". Examples per CLAUDE.md USER CONTEXT (Carvera):
   *   - Makera Carvera (3-axis): 6 (T1-T6)
   *   - Makera Carvera (4-axis HD): undefined -- the rotary attachment
   *     occupies the ATC bay so ATC is unavailable in 4-axis mode
   *   - Laguna Swift 5x10:        undefined -- no ATC (manual ER-20 collet)
   *   - Creality K2 Plus:         undefined -- FDM, no ATC concept
   *
   * Safety Rule 2: additive/optional. Absent means "no ATC enforced at the
   * machine-profile layer"; existing saved projects are unaffected.
   * Roadmap [ID-0093]: this field is the scaffolding for the M6 tool-change
   * macro behind a job flag; the M-code emission lands in a follow-up
   * post-processing cycle once profile coverage is complete.
   */
  atcSlotCount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Number of cutting-tool slots in the machine ATC (CNC). Carvera 3-axis: 6. Absent means no ATC.'
    ),
  /**
   * CNC -- ATC slot index reserved for the wireless tool-length probe. On
   * the Makera Carvera, slot 0 ("T0") is the wireless probe (it does not
   * cut). When set, the post-processor knows that an `M6 T<probeSlot>`
   * sequence is a probing operation rather than a tool change. Absent
   * means "no probe slot reserved" -- callers should not emit a probe-
   * driven tool-length compensation step.
   *
   * Safety Rule 2: additive/optional. The probe slot is conventionally
   * reachable as slot 0 (`T0`) on the Carvera; non-negative integer is
   * required because slot 0 is a valid value.
   * Roadmap [ID-0093].
   */
  atcProbeSlot: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      'ATC slot reserved for the wireless tool-length probe (CNC). Carvera: 0 (T0). Absent means no probe slot.'
    ),
  maxSpindleRpm: z
    .number()
    .positive()
    .optional()
    .describe('Maximum spindle speed in RPM'),
  minSpindleRpm: z
    .number()
    .positive()
    .optional()
    .describe('Minimum spindle speed in RPM'),
  spindleVariantHp: z
    .union([z.literal(3), z.literal(6)])
    .optional()
    .describe('Spindle HP variant (Laguna Swift: 3 or 6 HP liquid-cooled)'),
  vacuumZoneCount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Vacuum zone count for zoned vacuum tables (e.g. Laguna Swift: 6)'),
  safeRetractZMm: z
    .number()
    .positive()
    .optional()
    .describe('Safe Z retract height in mm (post rapids here before lateral moves / tool-change / program end)'),
  /**
   * FDM — machine's maximum hotend temperature ceiling in degrees Celsius.
   * Used by the slicer profile loader and by any pre-flight validator that
   * checks whether a requested nozzle temperature (per-material, per-layer)
   * fits within the machine's envelope. CLAUDE.md USER CONTEXT (Creality
   * K2 Plus) specifies "Nozzle <=350 C".
   *
   * Safety Rule 2: additive/optional -- absent means "no ceiling enforced
   * at the machine-profile layer" (falls back to slicer-definition limits,
   * which historically were the only source of truth). See roadmap [ID-0012].
   */
  maxNozzleTempC: z
    .number()
    .positive()
    .optional()
    .describe(
      'Maximum hotend temperature ceiling in C (FDM). K2 Plus: 350. Enforced by validators only when set.'
    ),
  /**
   * FDM -- machine's maximum bed temperature ceiling in degrees Celsius.
   * CLAUDE.md USER CONTEXT (Creality K2 Plus) specifies "Bed <=120 C".
   * Safety Rule 2: additive/optional. See roadmap [ID-0012].
   */
  maxBedTempC: z
    .number()
    .positive()
    .optional()
    .describe(
      'Maximum heated bed temperature ceiling in C (FDM). K2 Plus: 120. Enforced by validators only when set.'
    ),
  /**
   * FDM -- default/target heated-chamber temperature in degrees Celsius for
   * machines that ship with an enclosed, actively heated chamber (e.g. the
   * Creality K2 Plus). Consumed by slicer-profile generation and pre-flight
   * validation when the active material profile requests a chamber target.
   * Absent means "no heated chamber" (the machine prints at ambient).
   * Safety Rule 2: additive/optional. See roadmap [ID-0012].
   */
  chamberTempC: z
    .number()
    .positive()
    .optional()
    .describe(
      'Default heated-chamber target temperature in C (FDM). Absent means machine has no heated chamber.'
    ),
  /**
   * FDM -- list of input-shaping preset names supported by the machine
   * firmware. Klipper-family firmwares (K2 Plus ships Creality Klipper +
   * Moonraker + Fluidd) expose presets such as ZV, ZVD, MZV, EI, 2HUMP_EI,
   * 3HUMP_EI. Consumed by the slicer UI to let the operator pick a preset
   * without guessing what the controller accepts. Must be a list of
   * non-empty strings when present. Safety Rule 2: additive/optional.
   * Absent means "no input-shaping UI surface on this machine".
   * See roadmap [ID-0012].
   */
  inputShapingPresets: z
    .array(z.string().trim().min(1))
    .optional()
    .describe(
      'Input-shaping preset names supported by the machine firmware (Klipper: ZV, MZV, EI, ...). FDM.'
    ),
  /**
   * FDM -- true if the machine supports RFID-tagged filament (auto-detects
   * material type / color / remaining length from a spool tag). K2 Plus
   * ships with RFID support per CLAUDE.md USER CONTEXT. Safety Rule 2:
   * additive/optional; absent is equivalent to false for UI surfacing.
   * See roadmap [ID-0012].
   */
  rfidFilamentSupport: z
    .boolean()
    .optional()
    .describe('True if machine auto-detects filament via RFID spool tags (FDM).'),
  /**
   * FDM -- true if the machine has an active CFS (Creality Filament System)
   * multi-color/multi-material upstream of the toolhead. K2 Plus is CFS-ready
   * per CLAUDE.md USER CONTEXT. Safety Rule 2: additive/optional; absent is
   * equivalent to false for multi-extruder-assignment UI. See roadmap
   * [ID-0012].
   */
  cfsMultiColorEnabled: z
    .boolean()
    .optional()
    .describe('True if machine has an active multi-color filament system (Creality CFS). FDM.'),
  /**
   * FDM -- true if the machine firmware supports power-loss recovery (the
   * print resumes from the last-saved G-code line after a power interruption).
   * K2 Plus ships with this capability per CLAUDE.md USER CONTEXT.
   * Safety Rule 2: additive/optional; absent is equivalent to false for
   * slicer-generated resume metadata. See roadmap [ID-0012].
   */
  powerLossRecovery: z
    .boolean()
    .optional()
    .describe('True if firmware supports print resume after power loss (FDM).'),
  bAxisOrientation: z
    .enum(['y', 'z'])
    .optional()
    .describe('B/C tilt axis orientation: y or z'),
  bAxisRangeDeg: z
    .number()
    .positive()
    .optional()
    .describe('B/C axis tilt range in degrees (e.g. 120 for +/-60)'),
  fiveAxisType: z
    .enum(['table-table', 'head-head', 'table-head'])
    .optional()
    .describe('5-axis kinematic type: table-table, head-head, or table-head'),
  maxTiltDeg: z
    .number()
    .positive()
    .optional()
    .describe('Max simultaneous tilt from vertical in degrees'),
  meta: z
    .object({
      manufacturer: z.string().optional().describe('Machine manufacturer name'),
      model: z.string().optional().describe('Machine model name'),
      source: z
        .enum(['bundled', 'user'])
        .optional()
        .describe('Profile origin: bundled with app or user-created'),
      importedFromCps: z
        .boolean()
        .optional()
        .describe('True if profile was imported from a .cps post file'),
      cpsOriginalBasename: z
        .string()
        .optional()
        .describe('Original .cps filename when importedFromCps is true'),
      cncProfile: z
        .enum(['2d', '3d'])
        .optional()
        .describe('CNC profile type: 2d (routing) or 3d (surfacing)')
    })
    .optional()
    .describe('Extra metadata for UI and validation')
})

export type MachineProfile = z.infer<typeof machineProfileSchema>
