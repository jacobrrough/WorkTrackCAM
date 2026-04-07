import { describe, expect, it } from 'vitest'
import { DESIGN_RIBBON_COMMAND_IDS, FUSION_STYLE_COMMAND_CATALOG } from './fusion-style-command-catalog'

/**
 * Palette commands handled by DesignWorkspace.applyCommandFromPalette (tools + constraints + branches).
 * Update when adding a new `sk_*` / `co_*` / `dim_*` path or ut_* inspect branch.
 */
const DESIGN_PALETTE_HANDLED_IDS: readonly string[] = [
  // tools map
  'sk_rect',
  'sk_rect_3pt',
  'sk_slot_center',
  'sk_slot_overall',
  'sk_circle_center',
  'sk_circle_2pt',
  'sk_circle_3pt',
  'sk_polyline',
  'sk_polygon',
  'sk_point',
  'sk_line',
  'sk_arc_3pt',
  'sk_arc_center',
  'sk_ellipse',
  'sk_spline_fit',
  'sk_spline_cp',
  'sk_trim',
  'sk_split',
  'sk_break',
  'sk_extend',
  'sk_fillet_sk',
  'sk_chamfer_sk',
  'sk_move_sk',
  'sk_rotate_sk',
  'sk_scale_sk',
  'sk_mirror_sk',
  // constraints map
  'co_horizontal',
  'co_vertical',
  'co_coincident',
  'co_distance',
  'co_fix',
  'co_perpendicular',
  'co_parallel',
  'co_equal',
  'co_collinear',
  'co_midpoint',
  'co_angle',
  'co_tangent',
  'co_symmetric',
  'co_concentric',
  'co_radius',
  'co_diameter',
  // special branches
  'ut_measure',
  'ut_section',
  'ut_parameters',
  'sk_choose_plane',
  'dim_linear',
  'dim_aligned',
  'dim_angular',
  'dim_radial',
  'dim_diameter',
  'sk_offset',
  'sk_project',
  'sk_pattern_sk'
]

describe('fusion-style-command-catalog', () => {
  it('has unique command ids', () => {
    const ids = FUSION_STYLE_COMMAND_CATALOG.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has a non-empty label and valid workspace', () => {
    for (const c of FUSION_STYLE_COMMAND_CATALOG) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(['design', 'assemble', 'manufacture', 'utilities']).toContain(c.workspace)
      expect(['implemented', 'partial', 'planned']).toContain(c.status)
    }
  })

  it('DESIGN_RIBBON_COMMAND_IDS includes every palette-handled design command (drift guard)', () => {
    for (const id of DESIGN_PALETTE_HANDLED_IDS) {
      expect(DESIGN_RIBBON_COMMAND_IDS.has(id), `missing from DESIGN_RIBBON_COMMAND_IDS: ${id}`).toBe(true)
    }
  })
})
