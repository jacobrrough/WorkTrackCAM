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
  // Generic / fallback infrastructure (kept for CPS import + custom machines).
  // The non-GRBL 4-axis templates were removed in the April 2026 4-axis rewrite;
  // CPS imports for those dialects are repointed at `carvera_4axis_grbl.hbs`
  // (renamed from `cnc_4axis_grbl.hbs` in the pre-launch punch-list rank-16
  // cleanup -- the file is Carvera-flavored Smoothieware, same family as
  // carvera_4axis.hbs, but the legacy `grbl_4axis` dialect enum string is
  // preserved). The speculative 5-axis post templates were removed in the
  // June 2026 My-Shop-Only cleanup -- none of the three target shops own a
  // 5-axis machine.
  'cnc_generic_mm.hbs',
  'carvera_4axis_grbl.hbs'
] as const
