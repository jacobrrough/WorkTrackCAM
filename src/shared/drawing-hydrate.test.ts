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
  foldDrawingState,
  hydrateDrawingFile,
  PRIMARY_DRAWING_SHEET_ID,
  type DrawingViewState
} from './drawing-hydrate'
import type {
  DrawingDimension,
  GdtFeatureControlFrame,
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

/** A fully-populated renderer drawing state (all six pieces non-empty). */
function fullViewState(): DrawingViewState {
  return {
    dimensions: [LINEAR_DIM, RADIAL_DIM],
    featureControlFrames: [GDT_FRAME],
    titleBlock: TITLE_BLOCK,
    notes: [NOTE],
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
    expect(sheet.annotations?.notes).toHaveLength(1)
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
    expect(hydrated.notes).toEqual([])
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
