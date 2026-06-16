/**
 * Drawings **renderer-state ⇄ `DrawingFile`** persistence seam (pure).
 *
 * This module is the data-layer half of the Drawings end-to-end fix. The
 * Drawings BACKEND (the `drawing:load` / `drawing:save` IPC + `drawing-file-store`
 * + `drawingFileSchema`) was fully built, but the renderer never called it: a
 * placed dimension, a GD&T frame, and the title block lived only in React state
 * and were lost on reload / route-switch (the assembly-#9 / disappearing-data
 * bug class). This module closes that gap at the data layer with two pure
 * helpers the renderer drives:
 *
 *   - {@link foldDrawingState} — fold the renderer's editable drawing state
 *     (dimensions + GD&T frames + title block + the remaining annotation arrays)
 *     into a {@link DrawingFile} ready for `drawing:save`. Writes everything into
 *     ONE logical sheet (the renderer treats the active part as a single sheet),
 *     preserving any other sheets a loaded file carried.
 *   - {@link hydrateDrawingFile} — the inverse: parse a loaded {@link DrawingFile}
 *     back into the renderer's view shape, read-time-defaulting every additive
 *     `.optional()` field so a legacy / empty `drawing.json` hydrates to clean
 *     empty state.
 *
 * Symmetry with `assembly-hydrate.ts`: that module folds/hydrates the assembly
 * parts + mates; this one folds/hydrates the drawing sheet. Both are **pure** (no
 * React, no DOM, no IPC, no `Date.now` / `crypto` — the caller supplies any ids)
 * and unit-tested with plain objects.
 *
 * ## Safety Rule 2 — additive, never break a saved project
 * {@link foldDrawingState} only writes fields that are `.optional()` on
 * `drawingSheetSchema` (`annotations`, `titleBlock`); {@link hydrateDrawingFile}
 * tolerates a legacy file with no sheets / a sheet with no annotations / no
 * title block (→ empty view state). No field is removed or repurposed, no schema
 * version is bumped.
 *
 * ## Safety Rule 1 — no G-code, no STL
 * A drawing sheet is documentation. Nothing here is ever read by the CAM
 * toolpath or post-processor pipeline. This file touches NO machine profile,
 * post template, or G-code emitter.
 */

import {
  drawingFileSchema,
  emptyDrawingFile,
  emptyDrawingTitleBlock,
  type DrawingFile,
  type DrawingSheet,
  type DrawingTitleBlock
} from './drawing-sheet-schema'
import {
  emptyDrawingSheetAnnotations,
  type DrawingBomRow,
  type DrawingDimension,
  type DrawingNote,
  type DrawingRevision,
  type GdtFeatureControlFrame
} from './drawing-annotation-schema'

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Stable id for the single logical sheet the renderer persists into. The
 * Drawings workspace edits one sheet (the active part's drawing), so the fold
 * always writes the renderer state into the sheet with THIS id — creating it if
 * a loaded file did not have one, updating it in place otherwise. Deterministic
 * (no clock / random) so re-folding the same state produces a byte-identical
 * file (the round-trip pin depends on this).
 */
export const PRIMARY_DRAWING_SHEET_ID = 'sheet-primary'

/** Default display name for the primary sheet when one is freshly created. */
export const PRIMARY_DRAWING_SHEET_NAME = 'Drawing'

// ── Renderer view shape (declared HERE so the renderer imports it, not vice-versa) ─

/**
 * The renderer's editable drawing state as the persistence layer sees it. The
 * DesignWorkspace owns these four pieces (dimensions + GD&T frames are already
 * controlled state; the title block gains its persist path in this cycle; notes
 * / revisions / bom are carried through faithfully even though no UI authors
 * them yet, so a loaded file never silently drops them on the next save).
 *
 *   - `dimensions`          — associative 2D dimensions (`sheet.annotations.dimensions`).
 *   - `featureControlFrames`— GD&T feature control frames (`sheet.annotations.featureControlFrames`).
 *   - `titleBlock`          — title-block metadata (`sheet.titleBlock`).
 *   - `notes` / `revisions` / `bom` — the remaining annotation arrays, preserved
 *     verbatim so a round-trip is lossless even before the UI edits them.
 */
export type DrawingViewState = {
  readonly dimensions: readonly DrawingDimension[]
  readonly featureControlFrames: readonly GdtFeatureControlFrame[]
  readonly titleBlock: DrawingTitleBlock
  readonly notes: readonly DrawingNote[]
  readonly revisions: readonly DrawingRevision[]
  readonly bom: readonly DrawingBomRow[]
}

/** A fully-empty renderer drawing state (the load fallback + new-sheet seed). */
export function emptyDrawingViewState(): DrawingViewState {
  return {
    dimensions: [],
    featureControlFrames: [],
    titleBlock: emptyDrawingTitleBlock(),
    notes: [],
    revisions: [],
    bom: []
  }
}

// ── FOLD — renderer view state → DrawingFile (ready for drawing:save) ──────────

/**
 * Fold the renderer's {@link DrawingViewState} into a {@link DrawingFile},
 * returning a NEW file (no mutation of `base`). The fold targets the single
 * {@link PRIMARY_DRAWING_SHEET_ID} sheet:
 *
 *   - If `base` already has that sheet, it is **updated in place** — its
 *     `annotations` (dimensions / GD&T / notes / revisions / bom) and
 *     `titleBlock` are refreshed from the view state, while every other
 *     persisted field on that sheet (name, scale, view placeholders, mesh
 *     projection tier, …) is **preserved**. This makes re-folding after an edit
 *     idempotent and non-destructive to fields the renderer's view does not
 *     model.
 *   - If `base` does not have it, a fresh primary sheet is appended (with a
 *     sane default name) carrying the view state.
 *   - Any OTHER sheets in `base` are passed through untouched (a file authored
 *     elsewhere with extra sheets keeps them).
 *
 * The result is re-parsed through `drawingFileSchema` so it is guaranteed valid
 * (and so absent annotation sub-arrays gain their schema defaults) before it
 * reaches `drawing:save`.
 *
 * Pure: no clock, no random. `base` defaults to an empty file so the first save
 * of a brand-new project produces a one-sheet file deterministically.
 */
export function foldDrawingState(
  state: DrawingViewState,
  base: DrawingFile = emptyDrawingFile()
): DrawingFile {
  const annotations = {
    dimensions: [...state.dimensions],
    featureControlFrames: [...state.featureControlFrames],
    notes: [...state.notes],
    revisions: [...state.revisions],
    bom: [...state.bom]
  }
  const titleBlock: DrawingTitleBlock = { ...state.titleBlock }

  let found = false
  const nextSheets = base.sheets.map((sheet) => {
    if (sheet.id !== PRIMARY_DRAWING_SHEET_ID) return sheet
    found = true
    // Update in place: refresh annotations + titleBlock, keep the rest.
    return { ...sheet, annotations, titleBlock }
  })

  if (!found) {
    const fresh: DrawingSheet = {
      id: PRIMARY_DRAWING_SHEET_ID,
      name: PRIMARY_DRAWING_SHEET_NAME,
      annotations,
      titleBlock
    }
    nextSheets.push(fresh)
  }

  // Re-validate so the saved file is canonical (and defaults are filled).
  return drawingFileSchema.parse({ version: 1, sheets: nextSheets })
}

// ── HYDRATE — DrawingFile → renderer view state ───────────────────────────────

/**
 * Parse a loaded {@link DrawingFile} into the renderer's {@link DrawingViewState}
 * — the inverse of {@link foldDrawingState}. Reads the {@link PRIMARY_DRAWING_SHEET_ID}
 * sheet when present, else the FIRST sheet (so a file authored before this seam
 * existed, with a differently-named sole sheet, still hydrates its annotations),
 * else empty state. Tolerant of every additive `.optional()` field:
 *
 *   - A legacy file with NO sheets → {@link emptyDrawingViewState}.
 *   - A sheet with NO `annotations` → empty dimension / GD&T / notes / revision /
 *     bom arrays.
 *   - A sheet with NO `titleBlock` → {@link emptyDrawingTitleBlock}.
 *
 * The caller is expected to have already normalised the on-disk JSON through
 * `parseDrawingFile` (the `drawing:load` IPC does). Passing a parsed
 * `DrawingFile` keeps this function pure + synchronous.
 */
export function hydrateDrawingFile(file: DrawingFile): DrawingViewState {
  const sheet =
    file.sheets.find((s) => s.id === PRIMARY_DRAWING_SHEET_ID) ?? file.sheets[0]
  if (sheet === undefined) return emptyDrawingViewState()

  const annotations = sheet.annotations ?? emptyDrawingSheetAnnotations()
  const titleBlock = sheet.titleBlock ?? emptyDrawingTitleBlock()

  return {
    dimensions: annotations.dimensions,
    featureControlFrames: annotations.featureControlFrames,
    titleBlock,
    notes: annotations.notes,
    revisions: annotations.revisions,
    bom: annotations.bom
  }
}
