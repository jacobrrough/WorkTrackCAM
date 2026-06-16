/**
 * Drawings **multi-sheet operations** (pure).
 *
 * The data-layer half of the multi-sheet Drawings workspace (the renderer owns
 * the sheet-tab strip in `DrawingView.tsx`). A {@link DrawingFile} carries an
 * array of {@link DrawingSheet}s plus an optional `activeSheetId`; this module
 * is the pure, framework-agnostic algebra over that file:
 *
 *   - {@link addSheet}        — append a fresh empty sheet (and make it active).
 *   - {@link renameSheet}     — rename a sheet (refuses a blank name).
 *   - {@link deleteSheet}     — delete a sheet, **keeping a minimum of one**.
 *   - {@link reorderSheet}    — move a sheet from one index to another.
 *   - {@link setActiveSheet}  — set `activeSheetId` (only to an existing sheet).
 *   - {@link resolveActiveSheetId} — the active id, defaulting to the first sheet.
 *   - section-view helpers: {@link addSectionView} / {@link removeSectionView} /
 *     {@link updateSectionView} — add / drop / patch a cut-plane spec on a sheet.
 *
 * ## Contract
 * Every op is **pure**: it returns a NEW {@link DrawingFile} (never mutates its
 * input — verified by tests) and re-parses the result through
 * `drawingFileSchema` so the output is always canonical and save-ready. There is
 * NO clock and NO randomness here — the caller supplies every new sheet/section
 * id, exactly like `drawing-hydrate.ts` and `assembly-hydrate.ts`. This keeps the
 * functions deterministic and the round-trip pins byte-stable.
 *
 * ## Safety
 *   - {@link deleteSheet} **never empties** the file. A Drawings file always has
 *     at least one sheet; deleting the last sheet is a no-op (returns the file
 *     unchanged) so the renderer's tab strip can't reach a zero-tab state.
 *   - `activeSheetId` is kept consistent: deleting the active sheet re-points it
 *     at a surviving neighbour; adding a sheet activates it.
 *   - Safety Rule 1 — a drawing sheet is documentation. NOTHING here is ever read
 *     by the CAM toolpath or post-processor pipeline.
 *   - Safety Rule 2 — additive only. These ops read/write the additive
 *     `.optional()` `sectionViews` + `activeSheetId` fields; they never bump a
 *     schema version or remove a field, so a legacy `drawing.json` round-trips.
 */

import {
  drawingFileSchema,
  type DrawingFile,
  type DrawingSectionView,
  type DrawingSheet
} from './drawing-sheet-schema'

// ── Internal helpers ────────────────────────────────────────────────────────

/** Re-parse so the returned file is canonical (and additive defaults fill). */
function canonical(file: { version: 1; sheets: DrawingSheet[]; activeSheetId?: string }): DrawingFile {
  return drawingFileSchema.parse(file)
}

/** Drop `activeSheetId` entirely when undefined so the file stays byte-minimal. */
function withActive(
  version: 1,
  sheets: DrawingSheet[],
  activeSheetId: string | undefined
): DrawingFile {
  return canonical(activeSheetId === undefined ? { version, sheets } : { version, sheets, activeSheetId })
}

// ── Active-sheet resolution ─────────────────────────────────────────────────

/**
 * The id of the sheet a consumer should treat as active. Returns
 * `file.activeSheetId` when it names a real sheet; otherwise falls back to the
 * FIRST sheet's id (the renderer always has a tab to show as long as a sheet
 * exists); `undefined` only when the file has no sheets at all. This is the
 * referential-integrity check the schema deliberately does NOT enforce (so a
 * legacy / hand-edited file with a dangling id never fails to parse).
 */
export function resolveActiveSheetId(file: DrawingFile): string | undefined {
  if (file.sheets.length === 0) return undefined
  const active = file.activeSheetId
  if (active !== undefined && file.sheets.some((s) => s.id === active)) return active
  return file.sheets[0]!.id
}

/** The active {@link DrawingSheet} (per {@link resolveActiveSheetId}), or undefined. */
export function resolveActiveSheet(file: DrawingFile): DrawingSheet | undefined {
  const id = resolveActiveSheetId(file)
  if (id === undefined) return undefined
  return file.sheets.find((s) => s.id === id)
}

// ── Sheet construction ──────────────────────────────────────────────────────

/**
 * A fresh, empty {@link DrawingSheet} with the given id + name. Carries no
 * annotations / section views / title block (all additive `.optional()` → absent
 * means "clean"), so a newly-added sheet round-trips byte-minimally until the
 * operator authors something on it. The caller supplies the id (pure layer).
 */
export function makeEmptySheet(id: string, name: string): DrawingSheet {
  return { id, name }
}

// ── Sheet ops (all pure over DrawingFile) ───────────────────────────────────

/**
 * Append a fresh empty sheet (id + name supplied by the caller) and make it the
 * active sheet. If a sheet with `id` already exists the file is returned
 * unchanged (ids are unique; the caller mints a new one). `name` is trimmed; a
 * blank name falls back to a numbered default so the schema's `name.min(1)`
 * always holds.
 */
export function addSheet(file: DrawingFile, id: string, name: string): DrawingFile {
  if (file.sheets.some((s) => s.id === id)) return file
  const trimmed = name.trim()
  const finalName = trimmed.length > 0 ? trimmed : `Sheet ${file.sheets.length + 1}`
  const sheets = [...file.sheets, makeEmptySheet(id, finalName)]
  return withActive(file.version, sheets, id)
}

/**
 * Rename the sheet with `id`. No-op (file returned unchanged) when the id is
 * absent OR the new name is blank/whitespace (the schema requires a non-empty
 * `name`, and a silent rename to "" would be a worse UX than refusing). The new
 * name is trimmed.
 */
export function renameSheet(file: DrawingFile, id: string, name: string): DrawingFile {
  const trimmed = name.trim()
  if (trimmed.length === 0) return file
  if (!file.sheets.some((s) => s.id === id)) return file
  const sheets = file.sheets.map((s) => (s.id === id ? { ...s, name: trimmed } : s))
  return withActive(file.version, sheets, file.activeSheetId)
}

/**
 * Delete the sheet with `id`, **keeping a minimum of one sheet**. Deleting the
 * last remaining sheet is refused (the file is returned unchanged) so a Drawings
 * file is never empty. When the deleted sheet was the active one, the active id
 * re-points at the neighbour that now occupies its slot (or the new last sheet),
 * so the renderer always has a valid tab selected. No-op when `id` is absent.
 */
export function deleteSheet(file: DrawingFile, id: string): DrawingFile {
  const idx = file.sheets.findIndex((s) => s.id === id)
  if (idx < 0) return file
  if (file.sheets.length <= 1) return file // keep a minimum of 1
  const sheets = file.sheets.filter((s) => s.id !== id)
  // Re-point the active id if it was the deleted sheet.
  let activeSheetId = file.activeSheetId
  if (activeSheetId === id) {
    const neighbour = sheets[Math.min(idx, sheets.length - 1)]
    activeSheetId = neighbour?.id
  }
  return withActive(file.version, sheets, activeSheetId)
}

/**
 * Move the sheet at index `from` so it lands at index `to` (array-splice
 * semantics: remove then insert). Indices are clamped into range; an out-of-range
 * `from`, or a `from === to` that produces no change, returns the file
 * unchanged. The active id is preserved (it tracks the sheet, not the slot).
 */
export function reorderSheet(file: DrawingFile, from: number, to: number): DrawingFile {
  const n = file.sheets.length
  if (from < 0 || from >= n) return file
  const target = Math.max(0, Math.min(to, n - 1))
  if (target === from) return file
  const sheets = [...file.sheets]
  const [moved] = sheets.splice(from, 1)
  sheets.splice(target, 0, moved!)
  return withActive(file.version, sheets, file.activeSheetId)
}

/**
 * Set the active sheet to `id`. No-op when `id` does not name an existing sheet
 * (so the active id can never go dangling through this path). Returns the file
 * unchanged when `id` is already active.
 */
export function setActiveSheet(file: DrawingFile, id: string): DrawingFile {
  if (!file.sheets.some((s) => s.id === id)) return file
  if (file.activeSheetId === id) return file
  return withActive(file.version, file.sheets, id)
}

// ── Section-view ops (pure; operate on one sheet within the file) ────────────

/**
 * Map the sheet with `sheetId` through `fn`, re-validating the file. Returns the
 * ORIGINAL file reference unchanged when the sheet is absent OR when `fn`
 * returns the same sheet reference (a true no-op) — so a no-op section-view edit
 * is referentially identical to its input, matching the rest of this module.
 */
function mapSheet(
  file: DrawingFile,
  sheetId: string,
  fn: (sheet: DrawingSheet) => DrawingSheet
): DrawingFile {
  const idx = file.sheets.findIndex((s) => s.id === sheetId)
  if (idx < 0) return file
  const current = file.sheets[idx]!
  const next = fn(current)
  if (next === current) return file
  const sheets = file.sheets.map((s, i) => (i === idx ? next : s))
  return withActive(file.version, sheets, file.activeSheetId)
}

/**
 * Append a {@link DrawingSectionView} to the sheet with `sheetId`. The caller
 * supplies the fully-formed section view (id + cut-plane). No-op when the sheet
 * is absent or a section view with the same id already exists on it.
 */
export function addSectionView(
  file: DrawingFile,
  sheetId: string,
  section: DrawingSectionView
): DrawingFile {
  return mapSheet(file, sheetId, (sheet) => {
    const existing = sheet.sectionViews ?? []
    if (existing.some((sv) => sv.id === section.id)) return sheet
    return { ...sheet, sectionViews: [...existing, section] }
  })
}

/**
 * Remove the section view `sectionId` from the sheet with `sheetId`. Drops the
 * `sectionViews` field entirely when the last section view is removed (so the
 * sheet stays byte-minimal — absent rather than `[]`). No-op when absent.
 */
export function removeSectionView(
  file: DrawingFile,
  sheetId: string,
  sectionId: string
): DrawingFile {
  return mapSheet(file, sheetId, (sheet) => {
    const existing = sheet.sectionViews ?? []
    const next = existing.filter((sv) => sv.id !== sectionId)
    if (next.length === existing.length) return sheet
    if (next.length === 0) {
      const { sectionViews: _drop, ...rest } = sheet
      return rest
    }
    return { ...sheet, sectionViews: next }
  })
}

/**
 * Patch the section view `sectionId` on the sheet with `sheetId` (shallow merge
 * of `patch` over the existing entry; the id is never changed). No-op when the
 * sheet or section view is absent.
 */
export function updateSectionView(
  file: DrawingFile,
  sheetId: string,
  sectionId: string,
  patch: Partial<Omit<DrawingSectionView, 'id'>>
): DrawingFile {
  return mapSheet(file, sheetId, (sheet) => {
    const existing = sheet.sectionViews ?? []
    if (!existing.some((sv) => sv.id === sectionId)) return sheet
    const sectionViews = existing.map((sv) => (sv.id === sectionId ? { ...sv, ...patch, id: sv.id } : sv))
    return { ...sheet, sectionViews }
  })
}
