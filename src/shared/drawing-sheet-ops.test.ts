/**
 * Drawings **multi-sheet ops** unit tests (pure node-env).
 *
 * Pins the sheet algebra the renderer's tab strip drives:
 *   - add / rename / delete / reorder / setActive behave correctly + purely;
 *   - deleting the LAST sheet is refused (min-1 invariant);
 *   - `activeSheetId` stays consistent across add / delete;
 *   - `resolveActiveSheetId` falls back to the first sheet when the id is
 *     absent / dangling;
 *   - section-view add / remove / update on a sheet;
 *   - every op returns a canonical file and never mutates its input.
 */

import { describe, expect, it } from 'vitest'
import {
  drawingFileSchema,
  parseDrawingFile,
  type DrawingFile,
  type DrawingSectionView
} from './drawing-sheet-schema'
import {
  addSectionView,
  addSheet,
  deleteSheet,
  makeEmptySheet,
  removeSectionView,
  renameSheet,
  reorderSheet,
  resolveActiveSheet,
  resolveActiveSheetId,
  setActiveSheet,
  updateSectionView
} from './drawing-sheet-ops'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function fileWith(...sheets: { id: string; name: string }[]): DrawingFile {
  return parseDrawingFile({ version: 1, sheets })
}

const SECTION: DrawingSectionView = {
  id: 'sec-1',
  name: 'A-A',
  viewFrom: 'front',
  cutPlane: { axis: 'z', offset: 0, keepSide: 'positive' }
}

// ── resolveActiveSheetId ───────────────────────────────────────────────────────

describe('resolveActiveSheetId', () => {
  it('returns undefined for an empty file', () => {
    expect(resolveActiveSheetId(fileWith())).toBeUndefined()
  })

  it('falls back to the first sheet when activeSheetId is absent', () => {
    const file = fileWith({ id: 's1', name: 'One' }, { id: 's2', name: 'Two' })
    expect(resolveActiveSheetId(file)).toBe('s1')
  })

  it('falls back to the first sheet when activeSheetId is dangling', () => {
    const file = parseDrawingFile({
      version: 1,
      sheets: [{ id: 's1', name: 'One' }],
      activeSheetId: 'gone'
    })
    expect(resolveActiveSheetId(file)).toBe('s1')
  })

  it('returns the active id when it names a real sheet', () => {
    const file = parseDrawingFile({
      version: 1,
      sheets: [{ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }],
      activeSheetId: 's2'
    })
    expect(resolveActiveSheetId(file)).toBe('s2')
    expect(resolveActiveSheet(file)?.name).toBe('Two')
  })
})

// ── addSheet ───────────────────────────────────────────────────────────────────

describe('addSheet', () => {
  it('appends a fresh empty sheet and makes it active', () => {
    const file = addSheet(fileWith({ id: 's1', name: 'One' }), 's2', 'Detail B')
    expect(file.sheets.map((s) => s.id)).toEqual(['s1', 's2'])
    expect(file.sheets[1]).toEqual({ id: 's2', name: 'Detail B' })
    expect(file.activeSheetId).toBe('s2')
  })

  it('falls back to a numbered name when the given name is blank', () => {
    const file = addSheet(fileWith({ id: 's1', name: 'One' }), 's2', '   ')
    expect(file.sheets[1]!.name).toBe('Sheet 2')
  })

  it('is a no-op when the id already exists', () => {
    const base = fileWith({ id: 's1', name: 'One' })
    expect(addSheet(base, 's1', 'Dup')).toBe(base)
  })

  it('makes a one-sheet file from empty', () => {
    const file = addSheet(fileWith(), 's1', 'First')
    expect(file.sheets).toHaveLength(1)
    expect(resolveActiveSheetId(file)).toBe('s1')
  })
})

// ── renameSheet ────────────────────────────────────────────────────────────────

describe('renameSheet', () => {
  it('renames a sheet (trimmed)', () => {
    const file = renameSheet(fileWith({ id: 's1', name: 'One' }), 's1', '  Front view  ')
    expect(file.sheets[0]!.name).toBe('Front view')
  })

  it('refuses a blank name (no-op)', () => {
    const base = fileWith({ id: 's1', name: 'One' })
    expect(renameSheet(base, 's1', '   ')).toBe(base)
  })

  it('is a no-op when the id is absent', () => {
    const base = fileWith({ id: 's1', name: 'One' })
    expect(renameSheet(base, 'nope', 'X')).toBe(base)
  })

  it('preserves the active id', () => {
    const base = setActiveSheet(
      fileWith({ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }),
      's2'
    )
    const file = renameSheet(base, 's1', 'Renamed')
    expect(file.activeSheetId).toBe('s2')
  })
})

// ── deleteSheet ────────────────────────────────────────────────────────────────

describe('deleteSheet', () => {
  it('deletes a sheet when more than one remains', () => {
    const file = deleteSheet(fileWith({ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }), 's1')
    expect(file.sheets.map((s) => s.id)).toEqual(['s2'])
  })

  it('REFUSES to delete the last sheet (min-1 invariant)', () => {
    const base = fileWith({ id: 's1', name: 'Only' })
    expect(deleteSheet(base, 's1')).toBe(base)
    expect(deleteSheet(base, 's1').sheets).toHaveLength(1)
  })

  it('is a no-op when the id is absent', () => {
    const base = fileWith({ id: 's1', name: 'One' }, { id: 's2', name: 'Two' })
    expect(deleteSheet(base, 'nope')).toBe(base)
  })

  it('re-points the active id to a neighbour when the active sheet is deleted', () => {
    const base = setActiveSheet(
      fileWith({ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }, { id: 's3', name: 'Three' }),
      's2'
    )
    const file = deleteSheet(base, 's2')
    // s2 was at index 1; after delete index 1 holds s3.
    expect(file.activeSheetId).toBe('s3')
  })

  it('re-points the active id to the new last sheet when the deleted one was last + active', () => {
    const base = setActiveSheet(
      fileWith({ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }),
      's2'
    )
    const file = deleteSheet(base, 's2')
    expect(file.activeSheetId).toBe('s1')
  })

  it('leaves the active id untouched when a non-active sheet is deleted', () => {
    const base = setActiveSheet(
      fileWith({ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }),
      's1'
    )
    const file = deleteSheet(base, 's2')
    expect(file.activeSheetId).toBe('s1')
  })
})

// ── reorderSheet ───────────────────────────────────────────────────────────────

describe('reorderSheet', () => {
  it('moves a sheet from one index to another', () => {
    const file = reorderSheet(
      fileWith({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }),
      0,
      2
    )
    expect(file.sheets.map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })

  it('moves a sheet backwards', () => {
    const file = reorderSheet(
      fileWith({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }),
      2,
      0
    )
    expect(file.sheets.map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('clamps an out-of-range target', () => {
    const file = reorderSheet(fileWith({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }), 0, 99)
    expect(file.sheets.map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('is a no-op for an out-of-range source or a no-move', () => {
    const base = fileWith({ id: 'a', name: 'A' }, { id: 'b', name: 'B' })
    expect(reorderSheet(base, 5, 0)).toBe(base)
    expect(reorderSheet(base, 0, 0)).toBe(base)
  })

  it('preserves the active id (tracks the sheet, not the slot)', () => {
    const base = setActiveSheet(
      fileWith({ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }),
      'a'
    )
    const file = reorderSheet(base, 0, 2)
    expect(file.activeSheetId).toBe('a')
    expect(file.sheets.map((s) => s.id)).toEqual(['b', 'c', 'a'])
  })
})

// ── setActiveSheet ─────────────────────────────────────────────────────────────

describe('setActiveSheet', () => {
  it('sets the active id to an existing sheet', () => {
    const file = setActiveSheet(fileWith({ id: 's1', name: 'One' }, { id: 's2', name: 'Two' }), 's2')
    expect(file.activeSheetId).toBe('s2')
  })

  it('is a no-op for an unknown id (never goes dangling)', () => {
    const base = fileWith({ id: 's1', name: 'One' })
    expect(setActiveSheet(base, 'nope')).toBe(base)
  })

  it('is a no-op when the id is already active', () => {
    const base = setActiveSheet(fileWith({ id: 's1', name: 'One' }), 's1')
    expect(setActiveSheet(base, 's1')).toBe(base)
  })
})

// ── Section-view ops ───────────────────────────────────────────────────────────

describe('section-view ops', () => {
  it('adds a section view to a sheet', () => {
    const file = addSectionView(fileWith({ id: 's1', name: 'One' }), 's1', SECTION)
    expect(file.sheets[0]!.sectionViews).toEqual([SECTION])
  })

  it('is a no-op when the sheet is absent', () => {
    const base = fileWith({ id: 's1', name: 'One' })
    expect(addSectionView(base, 'nope', SECTION)).toBe(base)
  })

  it('is a no-op when a section view with the same id already exists', () => {
    const once = addSectionView(fileWith({ id: 's1', name: 'One' }), 's1', SECTION)
    const twice = addSectionView(once, 's1', { ...SECTION, name: 'B-B' })
    expect(twice.sheets[0]!.sectionViews).toHaveLength(1)
    expect(twice.sheets[0]!.sectionViews![0]!.name).toBe('A-A')
  })

  it('removes a section view (dropping the field when the last one goes)', () => {
    const added = addSectionView(fileWith({ id: 's1', name: 'One' }), 's1', SECTION)
    const removed = removeSectionView(added, 's1', 'sec-1')
    expect(removed.sheets[0]!.sectionViews).toBeUndefined()
    expect(Object.keys(removed.sheets[0]!)).not.toContain('sectionViews')
  })

  it('keeps remaining section views when one of several is removed', () => {
    let file = addSectionView(fileWith({ id: 's1', name: 'One' }), 's1', SECTION)
    file = addSectionView(file, 's1', { ...SECTION, id: 'sec-2', name: 'B-B' })
    const removed = removeSectionView(file, 's1', 'sec-1')
    expect(removed.sheets[0]!.sectionViews!.map((sv) => sv.id)).toEqual(['sec-2'])
  })

  it('updates a section view (shallow merge, id immutable)', () => {
    const added = addSectionView(fileWith({ id: 's1', name: 'One' }), 's1', SECTION)
    const updated = updateSectionView(added, 's1', 'sec-1', {
      cutPlane: { axis: 'y', offset: 12.5, keepSide: 'negative' }
    })
    const sv = updated.sheets[0]!.sectionViews![0]!
    expect(sv.id).toBe('sec-1')
    expect(sv.name).toBe('A-A') // untouched
    expect(sv.cutPlane).toEqual({ axis: 'y', offset: 12.5, keepSide: 'negative' })
  })

  it('update is a no-op when the section id is absent', () => {
    const base = addSectionView(fileWith({ id: 's1', name: 'One' }), 's1', SECTION)
    expect(updateSectionView(base, 's1', 'nope', { name: 'X' })).toBe(base)
  })
})

// ── Purity + canonical output ──────────────────────────────────────────────────

describe('purity + canonical output', () => {
  it('every mutating op returns a schema-valid file', () => {
    const f1 = addSheet(fileWith({ id: 's1', name: 'One' }), 's2', 'Two')
    const f2 = renameSheet(f1, 's2', 'Two-prime')
    const f3 = reorderSheet(f2, 0, 1)
    const f4 = addSectionView(f3, 's1', SECTION)
    const f5 = setActiveSheet(f4, 's1')
    const f6 = deleteSheet(f5, 's2')
    for (const f of [f1, f2, f3, f4, f5, f6]) {
      expect(() => drawingFileSchema.parse(f)).not.toThrow()
    }
  })

  it('does NOT mutate its input file', () => {
    const base = fileWith({ id: 's1', name: 'One' }, { id: 's2', name: 'Two' })
    const before = JSON.stringify(base)
    addSheet(base, 's3', 'Three')
    renameSheet(base, 's1', 'X')
    deleteSheet(base, 's2')
    reorderSheet(base, 0, 1)
    setActiveSheet(base, 's2')
    addSectionView(base, 's1', SECTION)
    expect(JSON.stringify(base)).toBe(before)
  })

  it('makeEmptySheet has no annotations / section views / title block', () => {
    expect(makeEmptySheet('x', 'X')).toEqual({ id: 'x', name: 'X' })
  })
})
