/**
 * [ID-0206] Cycle 129 -- ui-polish paired-pin contract for the pure
 * helpers exported from `design-viewport-interaction.ts`. The module
 * (155 source lines) centralises the 3D viewport's interaction-mode
 * state machine so measure / project-sketch / section / face-pick
 * never silently fight each other across the Design tab. The same
 * reducer is used for every target machine -- Creality K2 Plus FDM,
 * Laguna Swift 5x10 router, Makera Carvera + 4-axis -- so any drift
 * here would corrupt the Design tab UX uniformly across the fleet.
 *
 * Pinned facts (any production drift WILL break a test here):
 *   - `initialViewportInteractionState` is the all-off zero state:
 *     measureMode=false, measurePts=[], sectionEnabled=false,
 *     projectSketchMode=false, projectSketchDraftMm=[],
 *     facePickMode=false. All array fields start empty (length 0).
 *   - `appendMeasureSample` rotates: 0 -> 1 (first prompt), 1 -> 2
 *     (computes Math.hypot distance to 3 decimal places + appends
 *     the operator-visible status with the source-mesh label),
 *     >=2 -> 1 (re-anchors to the new click). Distance is reported
 *     in mm via `toFixed(3)`.
 *   - Reducer action surface has EXACTLY 19 distinct action types
 *     (see source-text pins below for the canonical list).
 *   - Conflict-clearing invariants are the load-bearing guarantees
 *     of this module:
 *       * `measure_start` clears project + face-pick (but not section).
 *       * `palette_section_start` clears measure + project + face-pick.
 *       * `project_start` clears measure + face-pick (but not section).
 *       * `face_pick_toggle` (entering) clears measure + section
 *         + project; (exiting) only flips facePickMode.
 *       * `enter_sketch_phase` is a hard reset (returns a fresh
 *         initialViewportInteractionState, NOT a partial merge).
 *       * `reset_all` is a hard reset to a fresh initial state.
 *       * `esc_overlay` clears measure + section but PRESERVES
 *         project + face-pick (escape only kills overlay measure
 *         tools, not in-flight sketch projection or face-pick).
 *   - Default branch (unknown action) returns the SAME reference
 *     (referential identity, not just deep-equal) -- this is how
 *     React's `useReducer` short-circuits re-renders.
 *
 * Mirrors the [ID-0196] Cycle 119 derive-features-pin and
 * [ID-0201] Cycle 124 viewport3d-bounds-pin convention: a paired
 * pin contract test added with ZERO production-code edits.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  initialViewportInteractionState,
  appendMeasureSample,
  viewportInteractionReducer
} from './design-viewport-interaction'
import type {
  ViewportInteractionState,
  ViewportInteractionAction
} from './design-viewport-interaction'

// Read source ONCE for source-text paired pins.
const SOURCE_PATH = resolve(__dirname, 'design-viewport-interaction.ts')
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf8')

// ---------- helpers ---------------------------------------------------

function makeState(over: Partial<ViewportInteractionState> = {}): ViewportInteractionState {
  return { ...initialViewportInteractionState, ...over }
}

const PT_A = { x: 1, y: 2, z: 3 }
const PT_B = { x: 4, y: 6, z: 3 } // distance to PT_A: sqrt(9+16+0) = 5
const PT_C = { x: 10, y: 10, z: 10 }

// ---------- (A) module shape -----------------------------------------

describe('[ID-0206] design-viewport-interaction module exports', () => {
  it('exports initialViewportInteractionState as a frozen-style object literal', () => {
    expect(initialViewportInteractionState).toBeDefined()
    expect(typeof initialViewportInteractionState).toBe('object')
    expect(initialViewportInteractionState).not.toBeNull()
  })

  it('exports appendMeasureSample as a function', () => {
    expect(typeof appendMeasureSample).toBe('function')
  })

  it('exports viewportInteractionReducer as a function', () => {
    expect(typeof viewportInteractionReducer).toBe('function')
  })
})

// ---------- (B) initialViewportInteractionState contract -------------

describe('[ID-0206] initialViewportInteractionState all-off zero state pin', () => {
  it('measureMode is false', () => {
    expect(initialViewportInteractionState.measureMode).toBe(false)
  })

  it('measurePts is an empty array', () => {
    expect(Array.isArray(initialViewportInteractionState.measurePts)).toBe(true)
    expect(initialViewportInteractionState.measurePts.length).toBe(0)
  })

  it('sectionEnabled is false', () => {
    expect(initialViewportInteractionState.sectionEnabled).toBe(false)
  })

  it('projectSketchMode is false', () => {
    expect(initialViewportInteractionState.projectSketchMode).toBe(false)
  })

  it('projectSketchDraftMm is an empty array', () => {
    expect(Array.isArray(initialViewportInteractionState.projectSketchDraftMm)).toBe(true)
    expect(initialViewportInteractionState.projectSketchDraftMm.length).toBe(0)
  })

  it('facePickMode is false', () => {
    expect(initialViewportInteractionState.facePickMode).toBe(false)
  })

  it('exposes EXACTLY the 6 documented keys (no surprise fields)', () => {
    expect(Object.keys(initialViewportInteractionState).sort()).toEqual([
      'facePickMode',
      'measureMode',
      'measurePts',
      'projectSketchDraftMm',
      'projectSketchMode',
      'sectionEnabled'
    ])
  })
})

// ---------- (C) appendMeasureSample contract -------------------------

describe('[ID-0206] appendMeasureSample -- 0 -> 1 (first point prompt)', () => {
  it('empty prev -> next is [v]; status prompts for second point', () => {
    const r = appendMeasureSample([], PT_A, 'preview-mesh')
    expect(r.next).toEqual([PT_A])
    expect(r.status).toContain('second point')
    expect(r.status).toContain('Shift+click')
  })

  it('does NOT include the source-mesh label in the first-point prompt', () => {
    // Source-mesh label only appears on the distance message (second click).
    const r = appendMeasureSample([], PT_A, 'unique-mesh-label-XYZ')
    expect(r.status).not.toContain('unique-mesh-label-XYZ')
  })
})

describe('[ID-0206] appendMeasureSample -- 1 -> 2 (distance computed)', () => {
  it('one-point prev -> next is [a, b]; status reports Math.hypot distance to 3 decimals', () => {
    const r = appendMeasureSample([PT_A], PT_B, 'preview-mesh')
    expect(r.next).toEqual([PT_A, PT_B])
    expect(r.status).toContain('5.000') // exact toFixed(3) of 5
    expect(r.status).toContain('mm')
    expect(r.status).toContain('preview-mesh')
  })

  it('preserves the FIRST point reference when extending [a] -> [a, b]', () => {
    const a = PT_A
    const r = appendMeasureSample([a], PT_B, 'preview-mesh')
    expect(r.next[0]).toBe(a) // same reference
  })

  it('handles 3D distances (not just XY-plane)', () => {
    // (0,0,0) -> (3,4,12): Pythagorean triple, hypot = 13.
    const r = appendMeasureSample([{ x: 0, y: 0, z: 0 }], { x: 3, y: 4, z: 12 }, 'mesh')
    expect(r.status).toContain('13.000')
  })
})

describe('[ID-0206] appendMeasureSample -- 2 (or more) -> 1 (re-anchor)', () => {
  it('two-point prev -> next is [v]; re-anchors and prompts for second point', () => {
    const r = appendMeasureSample([PT_A, PT_B], PT_C, 'preview-mesh')
    expect(r.next).toEqual([PT_C])
    expect(r.status).toContain('first point')
    expect(r.status).toContain('Shift+click again')
  })

  it('three-point prev (defensive) -> next is [v]; same re-anchor prompt', () => {
    // The reducer normally keeps measurePts at <=2, but the helper must be
    // robust to a >=2 case by contract.
    const r = appendMeasureSample([PT_A, PT_B, PT_C], { x: 99, y: 0, z: 0 }, 'mesh')
    expect(r.next).toEqual([{ x: 99, y: 0, z: 0 }])
    expect(r.status).toContain('first point')
  })
})

// ---------- (D) reducer per-action transitions ------------------------

describe('[ID-0206] reducer action: reset_all', () => {
  it('returns a state structurally equal to initialViewportInteractionState', () => {
    const dirty: ViewportInteractionState = {
      measureMode: true,
      measurePts: [PT_A],
      sectionEnabled: true,
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 1, y: 2 }],
      facePickMode: true
    }
    const next = viewportInteractionReducer(dirty, { type: 'reset_all' })
    expect(next).toEqual(initialViewportInteractionState)
  })

  it('returns a FRESH object (not the singleton initial reference)', () => {
    const next = viewportInteractionReducer(makeState(), { type: 'reset_all' })
    expect(next).not.toBe(initialViewportInteractionState) // fresh spread
  })
})

describe('[ID-0206] reducer action: esc_overlay', () => {
  it('clears measureMode + measurePts + sectionEnabled', () => {
    const s = makeState({ measureMode: true, measurePts: [PT_A], sectionEnabled: true })
    const next = viewportInteractionReducer(s, { type: 'esc_overlay' })
    expect(next.measureMode).toBe(false)
    expect(next.measurePts).toEqual([])
    expect(next.sectionEnabled).toBe(false)
  })

  it('PRESERVES projectSketchMode + projectSketchDraftMm + facePickMode', () => {
    const s = makeState({
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 5, y: 6 }],
      facePickMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'esc_overlay' })
    expect(next.projectSketchMode).toBe(true)
    expect(next.projectSketchDraftMm).toEqual([{ x: 5, y: 6 }])
    expect(next.facePickMode).toBe(true)
  })
})

describe('[ID-0206] reducer action: enter_sketch_phase', () => {
  it('hard-resets to a fresh initialViewportInteractionState (NOT a partial merge)', () => {
    const dirty = makeState({
      measureMode: true,
      measurePts: [PT_A, PT_B],
      sectionEnabled: true,
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 1, y: 2 }],
      facePickMode: true
    })
    const next = viewportInteractionReducer(dirty, { type: 'enter_sketch_phase' })
    expect(next).toEqual(initialViewportInteractionState)
  })
})

describe('[ID-0206] reducer action: choose_plane_flow', () => {
  it('clears facePickMode + measureMode + measurePts + sectionEnabled', () => {
    const s = makeState({
      facePickMode: true,
      measureMode: true,
      measurePts: [PT_A],
      sectionEnabled: true
    })
    const next = viewportInteractionReducer(s, { type: 'choose_plane_flow' })
    expect(next.facePickMode).toBe(false)
    expect(next.measureMode).toBe(false)
    expect(next.measurePts).toEqual([])
    expect(next.sectionEnabled).toBe(false)
  })

  it('PRESERVES projectSketchMode + projectSketchDraftMm', () => {
    const s = makeState({
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 9, y: 9 }]
    })
    const next = viewportInteractionReducer(s, { type: 'choose_plane_flow' })
    expect(next.projectSketchMode).toBe(true)
    expect(next.projectSketchDraftMm).toEqual([{ x: 9, y: 9 }])
  })
})

describe('[ID-0206] reducer action: clear_measure', () => {
  it('clears measureMode + measurePts; preserves everything else', () => {
    const s = makeState({
      measureMode: true,
      measurePts: [PT_A, PT_B],
      sectionEnabled: true,
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 1, y: 1 }],
      facePickMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'clear_measure' })
    expect(next.measureMode).toBe(false)
    expect(next.measurePts).toEqual([])
    expect(next.sectionEnabled).toBe(true)
    expect(next.projectSketchMode).toBe(true)
    expect(next.projectSketchDraftMm).toEqual([{ x: 1, y: 1 }])
    expect(next.facePickMode).toBe(true)
  })
})

describe('[ID-0206] reducer action: measure_clear_pts', () => {
  it('clears measurePts but PRESERVES measureMode (mode stays armed)', () => {
    const s = makeState({ measureMode: true, measurePts: [PT_A, PT_B] })
    const next = viewportInteractionReducer(s, { type: 'measure_clear_pts' })
    expect(next.measureMode).toBe(true) // mode stays on
    expect(next.measurePts).toEqual([])
  })
})

describe('[ID-0206] reducer action: clear_section', () => {
  it('clears sectionEnabled; preserves everything else', () => {
    const s = makeState({
      sectionEnabled: true,
      measureMode: true,
      projectSketchMode: true,
      facePickMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'clear_section' })
    expect(next.sectionEnabled).toBe(false)
    expect(next.measureMode).toBe(true)
    expect(next.projectSketchMode).toBe(true)
    expect(next.facePickMode).toBe(true)
  })
})

describe('[ID-0206] reducer action: clear_project', () => {
  it('clears projectSketchMode + projectSketchDraftMm; preserves rest', () => {
    const s = makeState({
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      measureMode: true,
      facePickMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'clear_project' })
    expect(next.projectSketchMode).toBe(false)
    expect(next.projectSketchDraftMm).toEqual([])
    expect(next.measureMode).toBe(true)
    expect(next.facePickMode).toBe(true)
  })
})

describe('[ID-0206] reducer action: measure_start', () => {
  it('arms measure mode (true) and clears measurePts', () => {
    const next = viewportInteractionReducer(
      makeState({ measurePts: [PT_A] }),
      { type: 'measure_start' }
    )
    expect(next.measureMode).toBe(true)
    expect(next.measurePts).toEqual([])
  })

  it('CLEARS conflicting modes: project + face-pick', () => {
    const s = makeState({
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 1, y: 1 }],
      facePickMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'measure_start' })
    expect(next.projectSketchMode).toBe(false)
    expect(next.projectSketchDraftMm).toEqual([])
    expect(next.facePickMode).toBe(false)
  })

  it('does NOT clear sectionEnabled (section is orthogonal to measure)', () => {
    const s = makeState({ sectionEnabled: true })
    const next = viewportInteractionReducer(s, { type: 'measure_start' })
    expect(next.sectionEnabled).toBe(true)
  })
})

describe('[ID-0206] reducer action: measure_set', () => {
  it('measure_set { enabled: true } arms measure mode and clears measurePts + conflicts', () => {
    const s = makeState({
      measurePts: [PT_A, PT_B],
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 1, y: 2 }],
      facePickMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'measure_set', enabled: true })
    expect(next.measureMode).toBe(true)
    expect(next.measurePts).toEqual([])
    expect(next.projectSketchMode).toBe(false)
    expect(next.projectSketchDraftMm).toEqual([])
    expect(next.facePickMode).toBe(false)
  })

  it('measure_set { enabled: false } disarms measure mode and clears measurePts only', () => {
    const s = makeState({
      measureMode: true,
      measurePts: [PT_A],
      projectSketchMode: true,
      facePickMode: true,
      sectionEnabled: true
    })
    const next = viewportInteractionReducer(s, { type: 'measure_set', enabled: false })
    expect(next.measureMode).toBe(false)
    expect(next.measurePts).toEqual([])
    // The disable path is "soft": it does NOT clear other modes (asymmetric to enable=true).
    expect(next.projectSketchMode).toBe(true)
    expect(next.facePickMode).toBe(true)
    expect(next.sectionEnabled).toBe(true)
  })
})

describe('[ID-0206] reducer action: measure_set_pts', () => {
  it('replaces measurePts wholesale (not a merge)', () => {
    const s = makeState({ measureMode: true, measurePts: [PT_A] })
    const next = viewportInteractionReducer(s, { type: 'measure_set_pts', pts: [PT_B, PT_C] })
    expect(next.measurePts).toEqual([PT_B, PT_C])
    expect(next.measureMode).toBe(true) // mode preserved
  })

  it('accepts an empty pts array', () => {
    const next = viewportInteractionReducer(
      makeState({ measurePts: [PT_A, PT_B] }),
      { type: 'measure_set_pts', pts: [] }
    )
    expect(next.measurePts).toEqual([])
  })
})

describe('[ID-0206] reducer action: palette_section_start', () => {
  it('arms sectionEnabled and clears measure + project + face-pick', () => {
    const s = makeState({
      measureMode: true,
      measurePts: [PT_A],
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 1, y: 2 }],
      facePickMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'palette_section_start' })
    expect(next.sectionEnabled).toBe(true)
    expect(next.measureMode).toBe(false)
    expect(next.measurePts).toEqual([])
    expect(next.projectSketchMode).toBe(false)
    expect(next.projectSketchDraftMm).toEqual([])
    expect(next.facePickMode).toBe(false)
  })
})

describe('[ID-0206] reducer action: section_set', () => {
  it('section_set { enabled: true } turns sectionEnabled on', () => {
    const next = viewportInteractionReducer(
      makeState(),
      { type: 'section_set', enabled: true }
    )
    expect(next.sectionEnabled).toBe(true)
  })

  it('section_set { enabled: false } turns sectionEnabled off', () => {
    const next = viewportInteractionReducer(
      makeState({ sectionEnabled: true }),
      { type: 'section_set', enabled: false }
    )
    expect(next.sectionEnabled).toBe(false)
  })

  it('does NOT clear other modes (section_set is the orthogonal slider toggle)', () => {
    const s = makeState({ measureMode: true, projectSketchMode: true, facePickMode: true })
    const next = viewportInteractionReducer(s, { type: 'section_set', enabled: true })
    expect(next.measureMode).toBe(true)
    expect(next.projectSketchMode).toBe(true)
    expect(next.facePickMode).toBe(true)
  })
})

describe('[ID-0206] reducer action: project_start', () => {
  it('arms project mode and clears measure + face-pick + draft', () => {
    const s = makeState({
      measureMode: true,
      measurePts: [PT_A],
      facePickMode: true,
      projectSketchDraftMm: [{ x: 9, y: 9 }]
    })
    const next = viewportInteractionReducer(s, { type: 'project_start' })
    expect(next.projectSketchMode).toBe(true)
    expect(next.projectSketchDraftMm).toEqual([])
    expect(next.measureMode).toBe(false)
    expect(next.measurePts).toEqual([])
    expect(next.facePickMode).toBe(false)
  })

  it('does NOT clear sectionEnabled (section is orthogonal to project)', () => {
    const s = makeState({ sectionEnabled: true })
    const next = viewportInteractionReducer(s, { type: 'project_start' })
    expect(next.sectionEnabled).toBe(true)
  })
})

describe('[ID-0206] reducer action: project_set_draft', () => {
  it('replaces projectSketchDraftMm wholesale', () => {
    const s = makeState({ projectSketchDraftMm: [{ x: 1, y: 1 }] })
    const next = viewportInteractionReducer(s, {
      type: 'project_set_draft',
      draft: [{ x: 5, y: 5 }, { x: 6, y: 6 }]
    })
    expect(next.projectSketchDraftMm).toEqual([{ x: 5, y: 5 }, { x: 6, y: 6 }])
  })
})

describe('[ID-0206] reducer action: project_append', () => {
  it('appends ONE point to projectSketchDraftMm', () => {
    const s = makeState({ projectSketchDraftMm: [{ x: 1, y: 1 }] })
    const next = viewportInteractionReducer(s, {
      type: 'project_append',
      pt: { x: 2, y: 2 }
    })
    expect(next.projectSketchDraftMm).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }])
  })

  it('does NOT mutate the previous draft array (immutable spread)', () => {
    const draft = [{ x: 1, y: 1 }]
    const s = makeState({ projectSketchDraftMm: draft })
    viewportInteractionReducer(s, { type: 'project_append', pt: { x: 2, y: 2 } })
    expect(draft.length).toBe(1) // original untouched
  })

  it('appending to an empty draft yields a one-element array', () => {
    const next = viewportInteractionReducer(
      makeState(),
      { type: 'project_append', pt: { x: 7, y: 8 } }
    )
    expect(next.projectSketchDraftMm).toEqual([{ x: 7, y: 8 }])
  })
})

describe('[ID-0206] reducer action: project_cancel', () => {
  it('clears projectSketchMode + projectSketchDraftMm; preserves the rest', () => {
    const s = makeState({
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 5, y: 6 }],
      measureMode: true,
      sectionEnabled: true,
      facePickMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'project_cancel' })
    expect(next.projectSketchMode).toBe(false)
    expect(next.projectSketchDraftMm).toEqual([])
    expect(next.measureMode).toBe(true)
    expect(next.sectionEnabled).toBe(true)
    expect(next.facePickMode).toBe(true)
  })
})

describe('[ID-0206] reducer action: face_pick_off', () => {
  it('clears facePickMode; preserves the rest', () => {
    const s = makeState({
      facePickMode: true,
      measureMode: true,
      sectionEnabled: true,
      projectSketchMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'face_pick_off' })
    expect(next.facePickMode).toBe(false)
    expect(next.measureMode).toBe(true)
    expect(next.sectionEnabled).toBe(true)
    expect(next.projectSketchMode).toBe(true)
  })
})

describe('[ID-0206] reducer action: face_pick_toggle', () => {
  it('toggle from OFF -> ON arms face-pick AND clears measure + section + project', () => {
    const s = makeState({
      facePickMode: false,
      measureMode: true,
      measurePts: [PT_A],
      sectionEnabled: true,
      projectSketchMode: true,
      projectSketchDraftMm: [{ x: 1, y: 1 }]
    })
    const next = viewportInteractionReducer(s, { type: 'face_pick_toggle' })
    expect(next.facePickMode).toBe(true)
    expect(next.measureMode).toBe(false)
    expect(next.measurePts).toEqual([])
    expect(next.sectionEnabled).toBe(false)
    expect(next.projectSketchMode).toBe(false)
    expect(next.projectSketchDraftMm).toEqual([])
  })

  it('toggle from ON -> OFF only flips facePickMode and PRESERVES other modes', () => {
    const s = makeState({
      facePickMode: true,
      measureMode: true,
      measurePts: [PT_A],
      sectionEnabled: true,
      projectSketchMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'face_pick_toggle' })
    expect(next.facePickMode).toBe(false)
    // The off-path is asymmetric: turning face-pick OFF does not punish
    // pre-existing modes that were already running concurrently.
    expect(next.measureMode).toBe(true)
    expect(next.measurePts).toEqual([PT_A])
    expect(next.sectionEnabled).toBe(true)
    expect(next.projectSketchMode).toBe(true)
  })
})

// ---------- (E) cross-cutting invariants -----------------------------

describe('[ID-0206] reducer default branch (unknown action) -- referential identity', () => {
  it('returns the SAME state reference on a fabricated unknown action', () => {
    // Cast through `as never` so TS lets us pass an action variant the
    // discriminated union does not include -- this exercises the default:
    // branch which is the React useReducer short-circuit contract.
    const s = makeState({ measureMode: true })
    const unknown = { type: '__no_such_action__' } as unknown as ViewportInteractionAction
    const next = viewportInteractionReducer(s, unknown)
    expect(next).toBe(s) // referential identity, not just deep-equal
  })
})

describe('[ID-0206] reducer immutability invariants', () => {
  it('reset_all returns a fresh object (does not return the singleton initial)', () => {
    const next = viewportInteractionReducer(makeState({ measureMode: true }), { type: 'reset_all' })
    expect(next).not.toBe(initialViewportInteractionState)
  })

  it('measure_start does NOT mutate the previous state object', () => {
    const s = makeState({ projectSketchMode: true, facePickMode: true })
    const snap = { ...s }
    viewportInteractionReducer(s, { type: 'measure_start' })
    expect(s).toEqual(snap)
  })

  it('project_append does NOT mutate the previous draft array', () => {
    const draft: Array<{ x: number; y: number }> = [{ x: 1, y: 2 }]
    const s = makeState({ projectSketchDraftMm: draft })
    viewportInteractionReducer(s, { type: 'project_append', pt: { x: 3, y: 4 } })
    expect(draft).toEqual([{ x: 1, y: 2 }])
  })
})

describe('[ID-0206] reducer conflict-clearing matrix (cross-action invariants)', () => {
  // The four "start" actions enforce mutually-exclusive interaction modes
  // EXCEPT section, which is orthogonal to measure/project/face-pick.
  it('measure_start does NOT clear sectionEnabled', () => {
    const next = viewportInteractionReducer(
      makeState({ sectionEnabled: true }),
      { type: 'measure_start' }
    )
    expect(next.sectionEnabled).toBe(true)
  })

  it('project_start does NOT clear sectionEnabled', () => {
    const next = viewportInteractionReducer(
      makeState({ sectionEnabled: true }),
      { type: 'project_start' }
    )
    expect(next.sectionEnabled).toBe(true)
  })

  it('palette_section_start DOES clear measure + project + face-pick (asymmetric)', () => {
    // Section is "loud": entering section explicitly kills overlay tools.
    const s = makeState({
      measureMode: true,
      projectSketchMode: true,
      facePickMode: true
    })
    const next = viewportInteractionReducer(s, { type: 'palette_section_start' })
    expect(next.measureMode).toBe(false)
    expect(next.projectSketchMode).toBe(false)
    expect(next.facePickMode).toBe(false)
  })

  it('face_pick_toggle ON DOES clear sectionEnabled (face-pick is exclusive)', () => {
    const next = viewportInteractionReducer(
      makeState({ sectionEnabled: true, facePickMode: false }),
      { type: 'face_pick_toggle' }
    )
    expect(next.sectionEnabled).toBe(false)
    expect(next.facePickMode).toBe(true)
  })
})

// ---------- (F) source-text paired pins ------------------------------

describe('[ID-0206] design-viewport-interaction source-text paired pins', () => {
  it('source documents centralisation ("do not fight" intent)', () => {
    expect(SOURCE_TEXT.toLowerCase()).toContain('do not fight')
  })

  it('source declares ViewportInteractionState with EXACTLY 6 keys', () => {
    // Match the exported type body and count the field declarations.
    const m = SOURCE_TEXT.match(/export type ViewportInteractionState = \{([\s\S]*?)\n\}/)
    expect(m).not.toBeNull()
    const body = m![1]
    // Each line of the form "name: type" -- count colons that introduce a field type.
    const fieldCount = body
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => /^[a-zA-Z_]+\??:\s/.test(l)).length
    expect(fieldCount).toBe(6)
  })

  it('source declares the ViewportInteractionAction discriminated-union with 19 distinct types', () => {
    const m = SOURCE_TEXT.match(/export type ViewportInteractionAction =([\s\S]*?)export function/)
    expect(m).not.toBeNull()
    const body = m![1]
    const variants = body
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('|'))
    expect(variants.length).toBe(19)
  })

  it('source action union literally names every action this pin file covers', () => {
    const expected = [
      "type: 'reset_all'",
      "type: 'esc_overlay'",
      "type: 'enter_sketch_phase'",
      "type: 'choose_plane_flow'",
      "type: 'clear_measure'",
      "type: 'measure_clear_pts'",
      "type: 'clear_section'",
      "type: 'clear_project'",
      "type: 'measure_start'",
      "type: 'measure_set'",
      "type: 'measure_set_pts'",
      "type: 'palette_section_start'",
      "type: 'section_set'",
      "type: 'project_start'",
      "type: 'project_set_draft'",
      "type: 'project_append'",
      "type: 'project_cancel'",
      "type: 'face_pick_off'",
      "type: 'face_pick_toggle'"
    ]
    for (const literal of expected) {
      expect(SOURCE_TEXT).toContain(literal)
    }
  })

  it('source declares appendMeasureSample as a Shift+click sample helper (per JSDoc)', () => {
    expect(SOURCE_TEXT).toContain('Shift+click measure samples')
  })

  it('source uses Math.hypot for the 3D distance computation', () => {
    expect(SOURCE_TEXT).toContain('Math.hypot')
  })

  it('source uses toFixed(3) for the operator-visible distance string', () => {
    expect(SOURCE_TEXT).toContain('toFixed(3)')
  })

  it('source declares "world mm" as the coordinate frame for measure samples', () => {
    expect(SOURCE_TEXT).toContain('world mm')
  })

  it('source declares the default branch returning the same state reference', () => {
    // The `default:` clause returns plain `s` (no spread). This is what
    // the cross-cutting referential-identity test depends on.
    expect(SOURCE_TEXT).toMatch(/default:\s*return s/)
  })
})
