/**
 * Centralizes 3D viewport interaction flags so measure / project / face-pick do not fight.
 * Section clipping is mostly orthogonal; palette shortcuts may clear conflicting pick modes.
 */

export type ViewportInteractionState = {
  measureMode: boolean
  measurePts: Array<{ x: number; y: number; z: number }>
  sectionEnabled: boolean
  projectSketchMode: boolean
  projectSketchDraftMm: Array<{ x: number; y: number }>
  facePickMode: boolean
}

export const initialViewportInteractionState: ViewportInteractionState = {
  measureMode: false,
  measurePts: [],
  sectionEnabled: false,
  projectSketchMode: false,
  projectSketchDraftMm: [],
  facePickMode: false
}

/** Pure transition for Shift+click measure samples (world mm). */
export function appendMeasureSample(
  prev: Array<{ x: number; y: number; z: number }>,
  v: { x: number; y: number; z: number },
  meshSourceLabel: string
): { next: Array<{ x: number; y: number; z: number }>; status: string } {
  if (prev.length >= 2) {
    return { next: [v], status: 'Measure: first point — Shift+click again.' }
  }
  if (prev.length === 0) {
    return { next: [v], status: 'Measure: Shift+click second point on the solid.' }
  }
  const d = Math.hypot(v.x - prev[0]!.x, v.y - prev[0]!.y, v.z - prev[0]!.z)
  return {
    next: [prev[0]!, v],
    status: `Distance: ${d.toFixed(3)} mm (${meshSourceLabel}).`
  }
}

export type ViewportInteractionAction =
  | { type: 'reset_all' }
  | { type: 'esc_overlay' }
  | { type: 'enter_sketch_phase' }
  | { type: 'choose_plane_flow' }
  | { type: 'clear_measure' }
  | { type: 'measure_clear_pts' }
  | { type: 'clear_section' }
  | { type: 'clear_project' }
  | { type: 'measure_start' }
  | { type: 'measure_set'; enabled: boolean }
  | { type: 'measure_set_pts'; pts: Array<{ x: number; y: number; z: number }> }
  | { type: 'palette_section_start' }
  | { type: 'section_set'; enabled: boolean }
  | { type: 'project_start' }
  | { type: 'project_set_draft'; draft: Array<{ x: number; y: number }> }
  | { type: 'project_append'; pt: { x: number; y: number } }
  | { type: 'project_cancel' }
  | { type: 'face_pick_off' }
  | { type: 'face_pick_toggle' }

export function viewportInteractionReducer(
  s: ViewportInteractionState,
  a: ViewportInteractionAction
): ViewportInteractionState {
  switch (a.type) {
    case 'reset_all':
      return { ...initialViewportInteractionState }
    case 'esc_overlay':
      return { ...s, measureMode: false, measurePts: [], sectionEnabled: false }
    case 'enter_sketch_phase':
      return { ...initialViewportInteractionState }
    case 'choose_plane_flow':
      return {
        ...s,
        facePickMode: false,
        measureMode: false,
        measurePts: [],
        sectionEnabled: false
      }
    case 'clear_measure':
      return { ...s, measureMode: false, measurePts: [] }
    case 'measure_clear_pts':
      return { ...s, measurePts: [] }
    case 'clear_section':
      return { ...s, sectionEnabled: false }
    case 'clear_project':
      return { ...s, projectSketchMode: false, projectSketchDraftMm: [] }
    case 'measure_start':
      return {
        ...s,
        measureMode: true,
        measurePts: [],
        projectSketchMode: false,
        projectSketchDraftMm: [],
        facePickMode: false
      }
    case 'measure_set':
      if (!a.enabled) return { ...s, measureMode: false, measurePts: [] }
      return {
        ...s,
        measureMode: true,
        measurePts: [],
        projectSketchMode: false,
        projectSketchDraftMm: [],
        facePickMode: false
      }
    case 'measure_set_pts':
      return { ...s, measurePts: a.pts }
    case 'palette_section_start':
      return {
        ...s,
        sectionEnabled: true,
        measureMode: false,
        measurePts: [],
        projectSketchMode: false,
        projectSketchDraftMm: [],
        facePickMode: false
      }
    case 'section_set':
      return { ...s, sectionEnabled: a.enabled }
    case 'project_start':
      return {
        ...s,
        projectSketchMode: true,
        projectSketchDraftMm: [],
        facePickMode: false,
        measureMode: false,
        measurePts: []
      }
    case 'project_set_draft':
      return { ...s, projectSketchDraftMm: a.draft }
    case 'project_append':
      return { ...s, projectSketchDraftMm: [...s.projectSketchDraftMm, a.pt] }
    case 'project_cancel':
      return { ...s, projectSketchMode: false, projectSketchDraftMm: [] }
    case 'face_pick_off':
      return { ...s, facePickMode: false }
    case 'face_pick_toggle':
      if (s.facePickMode) return { ...s, facePickMode: false }
      return {
        ...s,
        facePickMode: true,
        measureMode: false,
        measurePts: [],
        sectionEnabled: false,
        projectSketchMode: false,
        projectSketchDraftMm: []
      }
    default:
      return s
  }
}
