/**
 * Common `postTemplate` filenames (under `resources/posts/`) for in-app hints.
 * Not exhaustive — users may use custom .hbs files.
 */
export const COMMON_POST_TEMPLATE_FILENAMES = [
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
