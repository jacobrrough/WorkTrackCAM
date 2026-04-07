import type { SketchConstraint } from '../../shared/design-schema'
import type { SketchTool } from './Sketch2DCanvas'

/** Palette / command IDs → sketch drawing tool (command palette + design-command-bridge). */
export const DESIGN_SKETCH_COMMAND_TO_TOOL: Record<string, SketchTool> = {
  sk_rect: 'rect',
  sk_rect_3pt: 'rect_3pt',
  sk_slot_center: 'slot_center',
  sk_slot_overall: 'slot_overall',
  sk_circle_center: 'circle',
  sk_circle_2pt: 'circle_2pt',
  sk_circle_3pt: 'circle_3pt',
  sk_polyline: 'polyline',
  sk_polygon: 'polygon',
  sk_point: 'point',
  sk_line: 'line',
  sk_arc_3pt: 'arc',
  sk_arc_center: 'arc_center',
  sk_ellipse: 'ellipse',
  sk_spline_fit: 'spline_fit',
  sk_spline_cp: 'spline_cp',
  sk_trim: 'trim',
  sk_split: 'split',
  sk_break: 'break',
  sk_extend: 'extend',
  sk_fillet_sk: 'fillet',
  sk_chamfer_sk: 'chamfer',
  sk_move_sk: 'move_sk',
  sk_rotate_sk: 'rotate_sk',
  sk_scale_sk: 'scale_sk',
  sk_mirror_sk: 'mirror_sk'
}

/** Palette / command IDs → constraint type. */
export const DESIGN_CONSTRAINT_COMMAND_TO_TYPE: Record<string, SketchConstraint['type']> = {
  co_horizontal: 'horizontal',
  co_vertical: 'vertical',
  co_coincident: 'coincident',
  co_distance: 'distance',
  co_fix: 'fix',
  co_perpendicular: 'perpendicular',
  co_parallel: 'parallel',
  co_equal: 'equal',
  co_collinear: 'collinear',
  co_midpoint: 'midpoint',
  co_angle: 'angle',
  co_tangent: 'tangent',
  co_symmetric: 'symmetric',
  co_concentric: 'concentric',
  co_radius: 'radius',
  co_diameter: 'diameter'
}

export function sketchToolForDesignCommand(commandId: string): SketchTool | undefined {
  return DESIGN_SKETCH_COMMAND_TO_TOOL[commandId]
}

export function constraintTypeForDesignCommand(commandId: string): SketchConstraint['type'] | undefined {
  return DESIGN_CONSTRAINT_COMMAND_TO_TYPE[commandId]
}
