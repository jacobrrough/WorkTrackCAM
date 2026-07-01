/**
 * Drawings **fold ⇄ hydrate** round-trip tests (pure node-env).
 *
 * Proves the data layer that takes Drawings from write-only-to-memory to a real
 * end-to-end round-trip (no React, no DOM, no IPC — plain objects):
 *
 *   (A) FOLD shape: `foldDrawingState` writes the renderer state into ONE primary
 *       sheet, re-validates through `drawingFileSchema`, and preserves foreign
 *       sheets a loaded file carried.
 *   (B) ROUND-TRIP: fold → save→load→parse (the exact `drawing:save`/`drawing:load`
 *       JSON cycle) → hydrate yields the ORIGINAL renderer state (the property the
 *       persistence end-to-end fix turns on).
 *   (C) HYDRATE back-compat: a legacy / empty `drawing.json` (no sheets / a sheet
 *       with no annotations / no title block) hydrates to clean empty state
 *       (Safety Rule 2 — legacy files load unchanged).
 *   (D) Purity: fold does not mutate its inputs; deterministic output.
 */

import { describe, expect, it } from 'vitest'
import {
  drawingFileSchema,
  emptyDrawingTitleBlock,
  parseDrawingFile,
  type DrawingFile,
  type DrawingTitleBlock
} from './drawing-sheet-schema'
import {
  emptyDrawingViewState,
  emptyDrawingWorkspaceState,
  foldDrawingState,
  foldDrawingWorkspace,
  hydrateActiveSheet,
  hydrateDrawingFile,
  hydrateDrawingWorkspace,
  PRIMARY_DRAWING_SHEET_ID,
  type DrawingViewState
} from './drawing-hydrate'
import { addSectionView, addSheet, setActiveSheet } from './drawing-sheet-ops'
import type { DrawingSectionView } from './drawing-sheet-schema'
import type {
  DrawingCenterline,
  DrawingCenterMark,
  DrawingDimension,
  GdtFeatureControlFrame,
  SurfaceFinishSymbol,
  DrawingNote,
  DrawingRevision,
  DrawingBomRow
} from './drawing-annotation-schema'

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** The exact save→load→parse round-trip the drawing IPC performs. */
function saveLoadRoundTrip(file: DrawingFile): DrawingFile {
  const onSave = drawingFileSchema.parse(file)
  const onDisk = JSON.stringify(onSave, null, 2)
  const reread = JSON.parse(onDisk) as unknown
  return parseDrawingFile(reread)
}

const ANCHOR = (refId: string, x: number, y: number) => ({ refId, cachedPoint: { x, y } })

const LINEAR_DIM: DrawingDimension = {
  kind: 'linear',
  id: 'dim-1',
  orientation: 'horizontal',
  start: ANCHOR('v1', 0, 0),
  end: ANCHOR('v2', 30, 0),
  value: 30,
  placement: { x: 15, y: -8 }
}

const RADIAL_DIM: DrawingDimension = {
  kind: 'radial',
  id: 'dim-2',
  center: ANCHOR('c1', 10, 10),
  on: ANCHOR('e1', 15, 10),
  value: 5,
  placement: { x: 18, y: 12 }
}

const GDT_FRAME: GdtFeatureControlFrame = {
  id: 'gdt-1',
  characteristic: 'position',
  toleranceMm: 0.1,
  datums: ['A', 'B'],
  anchor: ANCHOR('f1', 5, 5),
  placement: { x: 8, y: 8 }
}

const SURFACE_FINISH: SurfaceFinishSymbol = {
  id: 'sf-1',
  material: 'required',
  ra: 1.6,
  machiningAllowanceMm: 0.5,
  lay: 'perpendicular',
  anchor: ANCHOR('e1', 20, 8),
  placement: { x: 20, y: 8 }
}

const TITLE_BLOCK: DrawingTitleBlock = {
  name: 'Bracket',
  scale: '1:1',
  author: 'Jacob',
  date: '2026-06-15',
  sheet: '1 of 1'
}

const NOTE: DrawingNote = {
  id: 'note-1',
  text: 'Break all sharp edges 0.5 mm',
  placement: { x: 40, y: 40 }
}

const CENTER_MARK: DrawingCenterMark = {
  id: 'cm-1',
  anchor: ANCHOR('hole-1', 12, 8),
  sizeMm: 3
}

const CENTERLINE: DrawingCenterline = {
  id: 'cl-1',
  start: ANCHOR('hole-1', 12, 8),
  end: ANCHOR('hole-2', 42, 8)
}

const REVISION: DrawingRevision = {
  rev: 'A',
  date: '2026-06-15',
  desc: 'Initial release',
  author: 'Jacob'
}

const BOM_ROW: DrawingBomRow = {
  item: 1,
  qty: 2,
  partNumber: 'PN-001',
  description: 'Aluminium plate'
}

/** A fully-populated renderer drawing state (every piece non-empty). */
function fullViewState(): DrawingViewState {
  return {
    dimensions: [LINEAR_DIM, RADIAL_DIM],
    featureControlFrames: [GDT_FRAME],
    surfaceFinishes: [SURFACE_FINISH],
    titleBlock: TITLE_BLOCK,
    notes: [NOTE],
    centerMarks: [CENTER_MARK],
    centerlines: [CENTERLINE],
    revisions: [REVISION],
    bom: [BOM_ROW]
  }
}

// ── (A) FOLD shape ────────────────────────────────────────────────────────────

describe('foldDrawingState — shape', () => {
  it('writes the renderer state into a single primary sheet', () => {
    const file = foldDrawingState(fullViewState())
    expect(file.version).toBe(1)
    expect(file.sheets).toHaveLength(1)
    const sheet = file.sheets[0]!
    expect(sheet.id).toBe(PRIMARY_DRAWING_SHEET_ID)
    expect(sheet.annotations?.dimensions).toHaveLength(2)
    expect(sheet.annotations?.featureControlFrames).toHaveLength(1)
    expect(sheet.annotations?.surfaceFinishes).toHaveLength(1)
    expect(sheet.annotations?.notes).toHaveLength(1)
    expect(sheet.annotations?.centerMarks).toHaveLength(1)
    expect(sheet.annotations?.centerlines).toHaveLength(1)
    expect(sheet.annotations?.revisions).toHaveLength(1)
    expect(sheet.annotations?.bom).toHaveLength(1)
    expect(sheet.titleBlock).toEqual(TITLE_BLOCK)
  })

  it('result validates against drawingFileSchema (canonical, save-ready)', () => {
    const file = foldDrawingState(fullViewState())
    expect(() => drawingFileSchema.parse(file)).not.toThrow()
  })

  it('updates the primary sheet IN PLACE, preserving its non-modelled fields', () => {
    // A loaded file whose primary sheet carries fields the renderer view does NOT
    // model (scale, viewPlaceholders, meshProjectionTier).
    const base = parseDrawingFile({
      version: 1,
      sheets: [
        {
          id: PRIMARY_DRAWING_SHEET_ID,
          name: 'My Sheet',
          scale: '1:2',
          meshProjectionTier: 'B',
          viewPlaceholders: [{ id: 'vp', kind: 'base', label: 'front', viewFrom: 'front' }]
        }
      ]
    })
    const file = foldDrawingState(fullViewState(), base)
    expect(file.sheets).toHaveLength(1)
    const sheet = file.sheets[0]!
    // Preserved:
    expect(sheet.name).toBe('My Sheet')
    expect(sheet.scale).toBe('1:2')
    expect(sheet.meshProjectionTier).toBe('B')
    expect(sheet.viewPlaceholders).toHaveLength(1)
    // Refreshed:
    expect(sheet.annotations?.dimensions).toHaveLength(2)
    expect(sheet.titleBlock).toEqual(TITLE_BLOCK)
  })

  it('preserves OTHER sheets the loaded file carried (foreign-sheet passthrough)', () => {
    const base = parseDrawingFile({
      version: 1,
      sheets: [{ id: 'other-sheet', name: 'Detail B', scale: '2:1' }]
    })
    const file = foldDrawingState(fullViewState(), base)
    expect(file.sheets).toHaveLength(2)
    expect(file.sheets.some((s) => s.id === 'other-sheet')).toBe(true)
    expect(file.sheets.some((s) => s.id === PRIMARY_DRAWING_SHEET_ID)).toBe(true)
  })
})

// ── (B) ROUND-TRIP — the persistence property ─────────────────────────────────

describe('fold → save/load → hydrate round-trip', () => {
  it('a fully-populated state round-trips to an EQUAL state', () => {
    const state = fullViewState()
    const reread = saveLoadRoundTrip(foldDrawingState(state))
    const hydrated = hydrateDrawingFile(reread)
    expect(hydrated).toEqual(state)
  })

  it('every dimension kind survives the round-trip', () => {
    const dims: DrawingDimension[] = [
      LINEAR_DIM,
      RADIAL_DIM,
      { kind: 'diameter', id: 'd', center: ANCHOR('c', 0, 0), on: ANCHOR('o', 5, 0), value: 10, placement: { x: 6, y: 0 } },
      { kind: 'angular', id: 'a', vertex: ANCHOR('v', 0, 0), arm1: ANCHOR('a1', 10, 0), arm2: ANCHOR('a2', 0, 10), value: 90, placement: { x: 5, y: 5 } },
      { kind: 'ordinate', id: 'o1', origin: ANCHOR('og', 0, 0), feature: ANCHOR('ft', 20, 0), axis: 'x', value: 20, placement: { x: 20, y: -5 } },
      { kind: 'baseline', id: 'b1', origin: ANCHOR('og', 0, 0), feature: ANCHOR('ft', 30, 0), setId: 'set-1', value: 30, placement: { x: 30, y: -5 } },
      { kind: 'chain', id: 'ch1', start: ANCHOR('s', 0, 0), end: ANCHOR('e', 12, 0), setId: 'run-1', value: 12, placement: { x: 6, y: -5 } }
    ]
    const state: DrawingViewState = { ...emptyDrawingViewState(), dimensions: dims }
    const hydrated = hydrateDrawingFile(saveLoadRoundTrip(foldDrawingState(state)))
    expect(hydrated.dimensions).toEqual(dims)
  })

  it('a dimension label override survives the round-trip', () => {
    const labelled: DrawingDimension = { ...LINEAR_DIM, label: '30 ±0.05' }
    const state: DrawingViewState = { ...emptyDrawingViewState(), dimensions: [labelled] }
    const hydrated = hydrateDrawingFile(saveLoadRoundTrip(foldDrawingState(state)))
    expect(hydrated.dimensions[0]?.label).toBe('30 ±0.05')
  })

  it('the title block survives the round-trip byte-faithfully', () => {
    const state: DrawingViewState = { ...emptyDrawingViewState(), titleBlock: TITLE_BLOCK }
    const hydrated = hydrateDrawingFile(saveLoadRoundTrip(foldDrawingState(state)))
    expect(hydrated.titleBlock).toEqual(TITLE_BLOCK)
  })

  it('surface-finish symbols survive the round-trip (anchor refId intact)', () => {
    const bare: SurfaceFinishSymbol = {
      id: 'sf-bare',
      material: 'any',
      anchor: ANCHOR('', 1, 2),
      placement: { x: 1, y: 2 }
    }
    const state: DrawingViewState = {
      ...emptyDrawingViewState(),
      surfaceFinishes: [SURFACE_FINISH, bare]
    }
    const hydrated = hydrateDrawingFile(saveLoadRoundTrip(foldDrawingState(state)))
    expect(hydrated.surfaceFinishes).toEqual([SURFACE_FINISH, bare])
    expect(hydrated.surfaceFinishes[0]?.anchor.refId).toBe('e1')
  })

  it('center marks + centerlines survive the round-trip (anchor refIds intact)', () => {
    const state: DrawingViewState = {
      ...emptyDrawingViewState(),
      centerMarks: [CENTER_MARK],
      centerlines: [CENTERLINE]
    }
    const hydrated = hydrateDrawingFile(saveLoadRoundTrip(foldDrawingState(state)))
    expect(hydrated.centerMarks).toEqual([CENTER_MARK])
    expect(hydrated.centerlines).toEqual([CENTERLINE])
    expect(hydrated.centerMarks[0]?.anchor.refId).toBe('hole-1')
    expect(hydrated.centerlines[0]?.end.refId).toBe('hole-2')
  })

  it('re-folding the hydrated state is a fixed point (idempotent normalization)', () => {
    const state = fullViewState()
    const file1 = saveLoadRoundTrip(foldDrawingState(state))
    const hydrated1 = hydrateDrawingFile(file1)
    const file2 = saveLoadRoundTrip(foldDrawingState(hydrated1, file1))
    const hydrated2 = hydrateDrawingFile(file2)
    expect(hydrated2).toEqual(hydrated1)
  })
})

// ── (C) HYDRATE back-compat (Safety Rule 2) ───────────────────────────────────

describe('hydrateDrawingFile — legacy / empty back-compat', () => {
  it('an empty drawing file hydrates to empty view state', () => {
    const hydrated = hydrateDrawingFile(parseDrawingFile({ version: 1, sheets: [] }))
    expect(hydrated).toEqual(emptyDrawingViewState())
  })

  it('a legacy sheet with NO annotations / NO title block hydrates to empty arrays + empty title block', () => {
    // The EXACT shape an old drawing.json had before annotations/titleBlock existed.
    const legacy = parseDrawingFile({
      version: 1,
      sheets: [{ id: 'legacy-sheet', name: 'Old Sheet', scale: '1:1' }]
    })
    const hydrated = hydrateDrawingFile(legacy)
    expect(hydrated.dimensions).toEqual([])
    expect(hydrated.featureControlFrames).toEqual([])
    expect(hydrated.surfaceFinishes).toEqual([])
    expect(hydrated.notes).toEqual([])
    expect(hydrated.centerMarks).toEqual([])
    expect(hydrated.centerlines).toEqual([])
    expect(hydrated.revisions).toEqual([])
    expect(hydrated.bom).toEqual([])
    expect(hydrated.titleBlock).toEqual(emptyDrawingTitleBlock())
  })

  it('hydrates the FIRST sheet when the primary id is absent (pre-seam file)', () => {
    const file = parseDrawingFile({
      version: 1,
      sheets: [
        {
          id: 'some-other-id',
          name: 'Sole Sheet',
          annotations: { dimensions: [LINEAR_DIM] },
          titleBlock: { name: 'X', scale: '1:1', author: '', date: '', sheet: '' }
        }
      ]
    })
    const hydrated = hydrateDrawingFile(file)
    expect(hydrated.dimensions).toEqual([LINEAR_DIM])
    expect(hydrated.titleBlock.name).toBe('X')
  })

  it('prefers the PRIMARY sheet over a preceding foreign sheet', () => {
    const file = parseDrawingFile({
      version: 1,
      sheets: [
        { id: 'foreign', name: 'Foreign', annotations: { dimensions: [RADIAL_DIM] } },
        { id: PRIMARY_DRAWING_SHEET_ID, name: 'Primary', annotations: { dimensions: [LINEAR_DIM] } }
      ]
    })
    const hydrated = hydrateDrawingFile(file)
    // The primary sheet's single linear dim, NOT the foreign sheet's radial dim.
    expect(hydrated.dimensions).toEqual([LINEAR_DIM])
  })

  it('an empty view state round-trips through an empty file', () => {
    const hydrated = hydrateDrawingFile(saveLoadRoundTrip(foldDrawingState(emptyDrawingViewState())))
    expect(hydrated).toEqual(emptyDrawingViewState())
  })
})

// ── (C2) Multi-sheet: foldDrawingState preserves activeSheetId ─────────────────

describe('foldDrawingState — multi-sheet preservation', () => {
  it('preserves the loaded activeSheetId across a single-sheet fold', () => {
    const base = parseDrawingFile({
      version: 1,
      sheets: [
        { id: PRIMARY_DRAWING_SHEET_ID, name: 'Primary' },
        { id: 'detail-b', name: 'Detail B' }
      ],
      activeSheetId: 'detail-b'
    })
    const file = foldDrawingState(fullViewState(), base)
    // The renderer's single-sheet state edits the PRIMARY sheet, but folding it
    // must NOT drop which tab the operator had active.
    expect(file.activeSheetId).toBe('detail-b')
    expect(file.sheets.some((s) => s.id === 'detail-b')).toBe(true)
  })

  it('does not invent an activeSheetId when the base had none', () => {
    const file = foldDrawingState(fullViewState())
    expect(file.activeSheetId).toBeUndefined()
  })

  it('preserves a foreign sheet AND the active id through the disk round-trip', () => {
    const base = parseDrawingFile({
      version: 1,
      sheets: [{ id: 'detail-b', name: 'Detail B', scale: '2:1' }],
      activeSheetId: 'detail-b'
    })
    const reread = saveLoadRoundTrip(foldDrawingState(fullViewState(), base))
    expect(reread.activeSheetId).toBe('detail-b')
    expect(reread.sheets.map((s) => s.id).sort()).toEqual(
      [PRIMARY_DRAWING_SHEET_ID, 'detail-b'].sort()
    )
    // The primary sheet still hydrates the renderer's annotations.
    expect(hydrateDrawingFile(reread)).toEqual(fullViewState())
  })
})

// ── (C2b) foldDrawingState — explicit target sheet id (active-sheet routing) ───

describe('foldDrawingState — explicit target sheet id', () => {
  it('folds the view state into the NAMED sheet, not the primary, leaving the primary untouched', () => {
    const base = parseDrawingFile({
      version: 1,
      sheets: [
        {
          id: PRIMARY_DRAWING_SHEET_ID,
          name: 'Drawing',
          annotations: { dimensions: [LINEAR_DIM] }
        },
        { id: 'detail-b', name: 'Detail B' }
      ],
      activeSheetId: 'detail-b'
    })
    // Edit the SECONDARY (active) sheet: a radial dim goes onto detail-b.
    const secondaryState: DrawingViewState = { ...emptyDrawingViewState(), dimensions: [RADIAL_DIM] }
    const file = foldDrawingState(secondaryState, base, 'detail-b')
    const primary = file.sheets.find((s) => s.id === PRIMARY_DRAWING_SHEET_ID)!
    const detail = file.sheets.find((s) => s.id === 'detail-b')!
    // The primary sheet's linear dim is preserved (NOT clobbered by the secondary edit).
    expect(primary.annotations?.dimensions).toEqual([LINEAR_DIM])
    // The secondary sheet now carries the radial dim.
    expect(detail.annotations?.dimensions).toEqual([RADIAL_DIM])
    // The active id is preserved.
    expect(file.activeSheetId).toBe('detail-b')
  })

  it('creates a fresh sheet with the given id when it is absent, keeping a distinct name', () => {
    const base = parseDrawingFile({
      version: 1,
      sheets: [{ id: PRIMARY_DRAWING_SHEET_ID, name: 'Drawing' }]
    })
    const file = foldDrawingState(fullViewState(), base, 'detail-c')
    expect(file.sheets).toHaveLength(2)
    const fresh = file.sheets.find((s) => s.id === 'detail-c')!
    expect(fresh.name).toBe('detail-c')
    expect(fresh.annotations?.dimensions).toHaveLength(2)
  })

  it('omitting sheetId is byte-identical to passing the primary id (back-compat)', () => {
    const state = fullViewState()
    const a = JSON.stringify(foldDrawingState(state), null, 2)
    const b = JSON.stringify(foldDrawingState(state, undefined, PRIMARY_DRAWING_SHEET_ID), null, 2)
    expect(a).toBe(b)
  })
})

// ── (C3) Multi-sheet workspace fold ⇄ hydrate round-trip ───────────────────────

describe('hydrateDrawingWorkspace / foldDrawingWorkspace round-trip', () => {
  it('an empty file hydrates to an empty workspace', () => {
    expect(hydrateDrawingWorkspace(parseDrawingFile({ version: 1, sheets: [] }))).toEqual(
      emptyDrawingWorkspaceState()
    )
  })

  it('round-trips N sheets + the active id (fold → save/load → hydrate == input)', () => {
    // Build a 3-sheet file via the pure sheet ops, with annotations on two sheets.
    let file = parseDrawingFile({
      version: 1,
      sheets: [
        {
          id: PRIMARY_DRAWING_SHEET_ID,
          name: 'Drawing',
          annotations: {
            dimensions: [LINEAR_DIM],
            featureControlFrames: [GDT_FRAME],
            notes: [NOTE],
            revisions: [REVISION],
            bom: [BOM_ROW]
          },
          titleBlock: TITLE_BLOCK,
          sectionViews: [
            { id: 'sec-1', name: 'A-A', viewFrom: 'front', cutPlane: { axis: 'z', offset: 0, keepSide: 'positive' } }
          ]
        }
      ]
    })
    file = addSheet(file, 'detail-b', 'Detail B')
    file = addSheet(file, 'detail-c', 'Detail C')
    file = setActiveSheet(file, 'detail-b')

    const ws = hydrateDrawingWorkspace(file)
    expect(ws.sheets).toHaveLength(3)
    expect(ws.activeSheetId).toBe('detail-b')

    // fold → exact disk round-trip → hydrate must equal the hydrated input.
    const reread = saveLoadRoundTrip(foldDrawingWorkspace(ws))
    expect(hydrateDrawingWorkspace(reread)).toEqual(ws)
    // And the underlying file is byte-identical (sheets + active id all survive).
    expect(reread).toEqual(file)
  })

  it('drops a dangling/null active id on fold (reopen resolves to the first sheet)', () => {
    const ws = {
      sheets: parseDrawingFile({ version: 1, sheets: [{ id: 's1', name: 'One' }] }).sheets,
      activeSheetId: 'gone'
    }
    const file = foldDrawingWorkspace(ws)
    expect(file.activeSheetId).toBeUndefined()
    // Hydrate resolves the active id back to the surviving first sheet.
    expect(hydrateDrawingWorkspace(file).activeSheetId).toBe('s1')
  })

  it('a legacy single-sheet file becomes a one-sheet workspace', () => {
    const file = parseDrawingFile({
      version: 1,
      sheets: [{ id: 'legacy', name: 'Old Sheet', scale: '1:1' }]
    })
    const ws = hydrateDrawingWorkspace(file)
    expect(ws.sheets).toHaveLength(1)
    expect(ws.activeSheetId).toBe('legacy')
  })

  it('section views survive the workspace round-trip', () => {
    const file = parseDrawingFile({
      version: 1,
      sheets: [
        {
          id: 's1',
          name: 'One',
          sectionViews: [
            { id: 'sec-1', name: 'A-A', viewFrom: 'top', cutPlane: { axis: 'y', offset: 12.5, keepSide: 'negative' } }
          ]
        }
      ],
      activeSheetId: 's1'
    })
    const reread = saveLoadRoundTrip(foldDrawingWorkspace(hydrateDrawingWorkspace(file)))
    expect(reread.sheets[0]!.sectionViews).toEqual([
      { id: 'sec-1', name: 'A-A', viewFrom: 'top', cutPlane: { axis: 'y', offset: 12.5, keepSide: 'negative' } }
    ])
  })
})

// ── (C4) END-TO-END production flow: the session's multi-sheet round-trip ──────
//
// Replays EXACTLY what DesignSessionContext does at the data layer when the
// operator works across sheets, then proves a save→load→parse→hydrate cycle
// preserves BOTH sheets + their per-sheet content + which tab was active:
//   1. hydrate an opened file (the active-sheet view + the workspace),
//   2. add a 2nd sheet (engine op) and switch the active tab to it,
//   3. put a SECTION VIEW on the 2nd sheet (engine op),
//   4. place a DIM on the ACTIVE (2nd) sheet — folded via the active-sheet
//      `foldDrawingState(state, base, activeId)` path (NOT the primary!),
//   5. save→load→parse, then hydrate the workspace + the active sheet.
// The primary sheet's own content must be untouched the whole time.

describe('end-to-end multi-sheet round-trip (the session data flow)', () => {
  const SECTION: DrawingSectionView = {
    id: 'sec-A',
    name: 'A-A',
    viewFrom: 'front',
    cutPlane: { axis: 'z', offset: 4, keepSide: 'positive' }
  }

  it('a 2nd sheet with a section view + a dim survives save/load/hydrate, primary intact, active preserved', () => {
    // (1) Opened file: a primary sheet carrying the renderer's single-sheet state.
    let file = foldDrawingState(fullViewState())
    expect(file.sheets).toHaveLength(1)

    // (2) Add a 2nd sheet (engine op makes it active) — and (3) put a section on it.
    file = addSheet(file, 'detail-b', 'Detail B')
    expect(resolveActiveSheetIdViaHydrate(file)).toBe('detail-b')
    file = addSectionView(file, 'detail-b', SECTION)

    // (4) Place a dim on the ACTIVE (2nd) sheet via the active-sheet fold. This is
    // the session's `flushDrawingSave` path: fold the committed view into the
    // ACTIVE sheet id, over the current file as the base.
    const secondSheetEdit: DrawingViewState = {
      ...emptyDrawingViewState(),
      dimensions: [RADIAL_DIM],
      titleBlock: { name: 'Detail', scale: '2:1', author: 'Jacob', date: '2026-06-16', sheet: '2 of 2' }
    }
    file = foldDrawingState(secondSheetEdit, file, 'detail-b')

    // (5) Exact disk round-trip.
    const reread = saveLoadRoundTrip(file)

    // BOTH sheets survive.
    expect(reread.sheets.map((s) => s.id).sort()).toEqual([PRIMARY_DRAWING_SHEET_ID, 'detail-b'].sort())
    // The active id survived.
    expect(reread.activeSheetId).toBe('detail-b')

    // The PRIMARY sheet's content is UNTOUCHED (the secondary edits never bled in).
    const primary = reread.sheets.find((s) => s.id === PRIMARY_DRAWING_SHEET_ID)!
    expect(primary.annotations?.dimensions).toEqual(fullViewState().dimensions)
    expect(primary.titleBlock).toEqual(TITLE_BLOCK)
    expect(primary.sectionViews).toBeUndefined()

    // The 2nd sheet carries its section view AND its dim + title block.
    const detail = reread.sheets.find((s) => s.id === 'detail-b')!
    expect(detail.sectionViews).toEqual([SECTION])
    expect(detail.annotations?.dimensions).toEqual([RADIAL_DIM])
    expect(detail.titleBlock?.scale).toBe('2:1')

    // Hydrating the ACTIVE sheet yields the 2nd sheet's view (per-sheet content
    // swap), and the workspace hydrate carries both sheets + the active id.
    expect(hydrateActiveSheet(reread).dimensions).toEqual([RADIAL_DIM])
    const ws = hydrateDrawingWorkspace(reread)
    expect(ws.sheets).toHaveLength(2)
    expect(ws.activeSheetId).toBe('detail-b')
  })

  it('a legacy single-sheet drawing.json still loads (back-compat through the same path)', () => {
    const legacy = parseDrawingFile({
      version: 1,
      sheets: [{ id: 'legacy', name: 'Old Sheet', scale: '1:1' }]
    })
    const reread = saveLoadRoundTrip(legacy)
    // One sheet, resolves active to it, hydrates to clean empty view state.
    const ws = hydrateDrawingWorkspace(reread)
    expect(ws.sheets).toHaveLength(1)
    expect(ws.activeSheetId).toBe('legacy')
    expect(hydrateActiveSheet(reread)).toEqual(emptyDrawingViewState())
  })

  // Helper: the session resolves the active id via `hydrateDrawingWorkspace`.
  function resolveActiveSheetIdViaHydrate(f: DrawingFile): string | null {
    return hydrateDrawingWorkspace(f).activeSheetId
  }
})

// ── (D) Purity ────────────────────────────────────────────────────────────────

describe('foldDrawingState — purity', () => {
  it('does NOT mutate its view-state input', () => {
    const state = fullViewState()
    const before = JSON.stringify(state)
    foldDrawingState(state)
    expect(JSON.stringify(state)).toBe(before)
  })

  it('does NOT mutate its base-file input', () => {
    const base = parseDrawingFile({
      version: 1,
      sheets: [{ id: 'other-sheet', name: 'Detail B' }]
    })
    const before = JSON.stringify(base)
    foldDrawingState(fullViewState(), base)
    expect(JSON.stringify(base)).toBe(before)
  })

  it('two folds of the same input produce byte-identical JSON', () => {
    const state = fullViewState()
    const a = JSON.stringify(foldDrawingState(state), null, 2)
    const b = JSON.stringify(foldDrawingState(state), null, 2)
    expect(a).toBe(b)
  })
})
