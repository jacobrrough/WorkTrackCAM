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
  /** Replaced in post: grbl, mach3, generic_mm, grbl_4axis, fanuc_4axis, mach3_4axis, linuxcnc_4axis, siemens_4axis, heidenhain_4axis, fanuc, siemens, heidenhain */
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
      'heidenhain'
    ])
    .describe('G-code dialect: grbl, mach3, fanuc, siemens, heidenhain, linuxcnc_4axis, siemens_4axis, etc.'),
  /**
   * Number of controlled axes. 3 = standard XYZ, 4 = XYZ + A rotary axis.
   * Defaults to 3 when absent. Required for 4-axis ops (cnc_4axis_roughing,
   * cnc_4axis_finishing, cnc_4axis_contour, cnc_4axis_indexed) to be offered in the UI.
   */
  axisCount: z
    .number()
    .int()
    .min(3)
    .max(5)
    .optional()
    .describe('Number of controlled axes: 3=XYZ, 4=+A rotary, 5=+A+B'),
  /**
   * For 4-axis machines: rotation range of the A axis in degrees.
   * Typical values: 360 (continuous), 270, 180. Defaults to 360 when absent.
   */
  aAxisRangeDeg: z
    .number()
    .positive()
    .optional()
    .describe('A-axis rotation range in degrees (e.g. 360 for continuous)'),
  /**
   * For 4-axis machines: axis of rotation in the part coordinate system.
   * 'x' = A rotates around X, 'y' = A rotates around Y. Defaults to 'x'.
   */
  aAxisOrientation: z
    .enum(['x', 'y'])
    .optional()
    .describe('Axis of A rotation: x or y'),
  /**
   * Maximum rotary table speed in RPM. Used to validate A-axis angular
   * velocity in posted G-code. Typical values: 10-30 RPM for worm-gear
   * tables, 50-100 RPM for direct-drive spindles. Defaults to 20 RPM.
   */
  maxRotaryRpm: z
    .number()
    .positive()
    .optional()
    .describe('Max rotary table speed in RPM (default 20). Used for A-axis feed rate validation.'),
  /** Maximum spindle speed in RPM. Used for spindle speed validation and defaults. */
  maxSpindleRpm: z
    .number()
    .positive()
    .optional()
    .describe('Maximum spindle speed in RPM'),
  /** Minimum spindle speed in RPM. Used for spindle speed validation and defaults. */
  minSpindleRpm: z
    .number()
    .positive()
    .optional()
    .describe('Minimum spindle speed in RPM'),
  /**
   * For 5-axis machines: tilt axis orientation.
   * 'y' = B rotates around Y (table-table or head-head), 'z' = C rotates around Z.
   */
  bAxisOrientation: z
    .enum(['y', 'z'])
    .optional()
    .describe('B/C tilt axis orientation: y or z'),
  /** B/C axis tilt range in degrees. Typical: 120 (±60°). */
  bAxisRangeDeg: z
    .number()
    .positive()
    .optional()
    .describe('B/C axis tilt range in degrees (e.g. 120 for +/-60)'),
  /**
   * 5-axis kinematic chain type. Affects RTCP/TCP compensation.
   * 'table-table' = both rotations in table, 'head-head' = both in spindle head,
   * 'table-head' = A in table, B in head (most common).
   */
  fiveAxisType: z
    .enum(['table-table', 'head-head', 'table-head'])
    .optional()
    .describe('5-axis kinematic type: table-table, head-head, or table-head'),
  /** Maximum simultaneous tilt from vertical (degrees). Default 60. */
  maxTiltDeg: z
    .number()
    .positive()
    .optional()
    .describe('Max simultaneous tilt from vertical in degrees'),
  /** Extra metadata for UI / validation */
  meta: z
    .object({
      manufacturer: z.string().optional().describe('Machine manufacturer name'),
      model: z.string().optional().describe('Machine model name'),
      source: z
        .enum(['bundled', 'user'])
        .optional()
        .describe('Profile origin: bundled with app or user-created'),
      /** Stub profile created from a Fusion / HSM `.cps` post file (app does not execute CPS). */
      importedFromCps: z
        .boolean()
        .optional()
        .describe('True if profile was imported from a .cps post file'),
      /** Original `.cps` file basename when `importedFromCps` is true. */
      cpsOriginalBasename: z
        .string()
        .optional()
        .describe('Original .cps filename when importedFromCps is true'),
      /**
       * For CNC machines with axisCount <= 3: distinguishes VCarve-style 2D/2.5D
       * routing ('2d') from full 3D surfacing CAM ('3d'). Defaults to '2d' when absent.
       * Has no effect on FDM machines or machines with axisCount >= 4.
       */
      cncProfile: z
        .enum(['2d', '3d'])
        .optional()
        .describe('CNC profile type: 2d (routing) or 3d (surfacing)')
    })
    .optional()
    .describe('Extra metadata for UI and validation')
})

export type MachineProfile = z.infer<typeof machineProfileSchema>
