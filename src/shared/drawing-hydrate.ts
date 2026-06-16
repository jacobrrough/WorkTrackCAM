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
import { resolveActiveSheetId } from './drawing-sheet-ops'

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
 * returning a NEW file (no mutation of `base`). The fold targets ONE sheet —
 * `sheetId` (defaults to {@link PRIMARY_DRAWING_SHEET_ID}):
 *
 *   - If `base` already has that sheet, it is **updated in place** — its
 *     `annotations` (dimensions / GD&T / notes / revisions / bom) and
 *     `titleBlock` are refreshed from the view state, while every other
 *     persisted field on that sheet (name, scale, view placeholders, mesh
 *     projection tier, section views, …) is **preserved**. This makes re-folding
 *     after an edit idempotent and non-destructive to fields the renderer's view
 *     does not model.
 *   - If `base` does not have it, a fresh sheet with that id is appended (with a
 *     sane default name) carrying the view state.
 *   - Any OTHER sheets in `base` are passed through untouched (a file authored
 *     elsewhere with extra sheets — or a multi-sheet workspace where the operator
 *     is editing a DIFFERENT tab — keeps them).
 *
 * The optional `sheetId` is what makes the single-sheet renderer state correct
 * in a MULTI-SHEET workspace: the session passes the ACTIVE sheet's id, so a
 * dimension placed while a secondary sheet is selected folds into THAT sheet,
 * not always the primary. Omitting it preserves the legacy single-sheet
 * behaviour (fold into the primary sheet) byte-for-byte.
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
  base: DrawingFile = emptyDrawingFile(),
  sheetId: string = PRIMARY_DRAWING_SHEET_ID
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
    if (sheet.id !== sheetId) return sheet
    found = true
    // Update in place: refresh annotations + titleBlock, keep the rest.
    return { ...sheet, annotations, titleBlock }
  })

  if (!found) {
    const fresh: DrawingSheet = {
      id: sheetId,
      // A freshly-minted PRIMARY sheet uses the canonical default name; any other
      // newly-created target keeps a distinct, schema-valid (`min(1)`) name.
      name: sheetId === PRIMARY_DRAWING_SHEET_ID ? PRIMARY_DRAWING_SHEET_NAME : sheetId,
      annotations,
      titleBlock
    }
    nextSheets.push(fresh)
  }

  // Re-validate so the saved file is canonical (and defaults are filled).
  // Preserve the loaded `activeSheetId` (multi-sheet selection) — the
  // single-sheet renderer state does not model it, so a fold over a multi-sheet
  // base must NOT drop which tab was active (additive round-trip, Safety Rule 2).
  return drawingFileSchema.parse({
    version: 1,
    sheets: nextSheets,
    ...(base.activeSheetId === undefined ? {} : { activeSheetId: base.activeSheetId })
  })
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
  return sheetToViewState(sheet)
}

/**
 * Hydrate the view state of ONE sheet (its `annotations` + `titleBlock`),
 * read-time-defaulting every additive `.optional()` field. An `undefined` sheet
 * (the file had none, or a dangling id) hydrates to {@link emptyDrawingViewState}.
 * Shared by {@link hydrateDrawingFile} (primary sheet) and
 * {@link hydrateActiveSheet} (the multi-sheet workspace's active sheet).
 */
function sheetToViewState(sheet: DrawingSheet | undefined): DrawingViewState {
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

/**
 * Hydrate the {@link DrawingViewState} of the file's ACTIVE sheet — the sheet the
 * tab strip currently has selected (resolved via {@link resolveActiveSheetId},
 * falling back to the first sheet when the active id is absent / dangling). This
 * is what feeds the per-sheet annotation props in a MULTI-SHEET workspace, so
 * switching tabs re-points the rendered dimensions / GD&T / title block at the
 * newly-active sheet. For a legacy single-sheet file the active sheet IS that
 * sole sheet, so this matches {@link hydrateDrawingFile}. Empty state when the
 * file has no sheets.
 */
export function hydrateActiveSheet(file: DrawingFile): DrawingViewState {
  const activeId = resolveActiveSheetId(file)
  const sheet = activeId === undefined ? undefined : file.sheets.find((s) => s.id === activeId)
  return sheetToViewState(sheet)
}

// ── MULTI-SHEET fold ⇄ hydrate (the sheet-tab strip's round-trip) ─────────────
//
// The single-sheet {@link DrawingViewState} above models ONE sheet's annotations
// (the renderer's per-sheet editing seam). The multi-sheet workspace ALSO needs
// to round-trip the FULL sheet set + which tab is active. These helpers carry the
// raw {@link DrawingSheet}[] verbatim, so a fold→parse→hydrate cycle is lossless
// over any number of sheets (every additive field on each sheet survives because
// the sheet object itself is preserved, not re-projected through the single-sheet
// view shape). The renderer drives sheet structure through `drawing-sheet-ops.ts`
// (add/rename/delete/reorder/setActive) and these for load/save.

/**
 * The multi-sheet workspace state the renderer's tab strip drives: the full
 * ordered sheet set plus the RESOLVED active sheet id. `activeSheetId` is always
 * a real sheet id when `sheets` is non-empty (resolved via
 * {@link resolveActiveSheetId}, falling back to the first sheet), and `null` only
 * when there are no sheets at all.
 */
export type DrawingWorkspaceState = {
  readonly sheets: readonly DrawingSheet[]
  readonly activeSheetId: string | null
}

/** Empty multi-sheet workspace (no sheets, no active id). */
export function emptyDrawingWorkspaceState(): DrawingWorkspaceState {
  return { sheets: [], activeSheetId: null }
}

/**
 * Hydrate a parsed {@link DrawingFile} into the full {@link DrawingWorkspaceState}
 * — every sheet, in order, plus the resolved active id. The inverse of
 * {@link foldDrawingWorkspace}. Tolerant of a legacy file with no `activeSheetId`
 * (resolves to the first sheet) and of an empty file (→ empty workspace).
 */
export function hydrateDrawingWorkspace(file: DrawingFile): DrawingWorkspaceState {
  return {
    sheets: file.sheets,
    activeSheetId: resolveActiveSheetId(file) ?? null
  }
}

/**
 * Fold a {@link DrawingWorkspaceState} back into a canonical {@link DrawingFile}
 * (re-parsed through `drawingFileSchema`). The active id is persisted only when
 * it names one of the sheets (a dangling / null id is dropped, so the file stays
 * byte-minimal and a reopen resolves to the first sheet). Pure: no clock, no
 * random.
 */
export function foldDrawingWorkspace(state: DrawingWorkspaceState): DrawingFile {
  const sheets = [...state.sheets]
  const keepActive =
    state.activeSheetId !== null && sheets.some((s) => s.id === state.activeSheetId)
  return drawingFileSchema.parse({
    version: 1,
    sheets,
    ...(keepActive ? { activeSheetId: state.activeSheetId } : {})
  })
}
