/**
 * Common `postTemplate` filenames (under `resources/posts/`) for in-app hints.
 * Not exhaustive — users may use custom .hbs files.
 *
 * The first entries are the production posts used by the three supported
 * environments (VCarve Pro / Creality Print / Makera CAM); the rest remain
 * available for CPS imports and custom user machines.
 */
export const COMMON_POST_TEMPLATE_FILENAMES = [
  // Production environment posts
  'vcarve_mach3.hbs',
  'fdm_passthrough.hbs',
  'carvera_3axis.hbs',
  'carvera_4axis.hbs',
  // Generic / fallback infrastructure (kept for CPS import + custom machines)
  'cnc_generic_mm.hbs',
  'cnc_4axis_grbl.hbs',
  'cnc_4axis_fanuc.hbs',
  'cnc_4axis_mach3.hbs',
  'cnc_4axis_linuxcnc.hbs',
  'cnc_4axis_siemens.hbs',
  'cnc_4axis_heidenhain.hbs',
  'cnc_5axis_fanuc.hbs',
  'cnc_5axis_siemens.hbs'
] as const
