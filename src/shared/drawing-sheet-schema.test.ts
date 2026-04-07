import { describe, expect, it } from 'vitest'
import {
  drawingFileSchema,
  emptyDrawingFile,
  parseDrawingFile,
  replaceViewPlaceholderLabel,
  resolveExportViewRows
} from './drawing-sheet-schema'

describe('drawing-sheet-schema', () => {
  it('parses empty sheets', () => {
    const f = drawingFileSchema.parse({ version: 1, sheets: [] })
    expect(f.sheets).toEqual([])
  })

  it('parses sheet with scale', () => {
    const f = parseDrawingFile({
      version: 1,
      sheets: [{ id: 'a', name: 'General', scale: '1:2' }]
    })
    expect(f.sheets[0]).toEqual({ id: 'a', name: 'General', scale: '1:2' })
  })

  it('parses sheet with sheetTemplateHint', () => {
    const f = parseDrawingFile({
      version: 1,
      sheets: [{ id: 'b', name: 'S', scale: '1:1', sheetTemplateHint: 'A4 landscape' }]
    })
    expect(f.sheets[0]?.sheetTemplateHint).toBe('A4 landscape')
  })

  it('parses meshProjectionTier A and B on first sheet', () => {
    const a = parseDrawingFile({
      version: 1,
      sheets: [{ id: 's', name: 'S', scale: '1:1', meshProjectionTier: 'A' }]
    })
    expect(a.sheets[0]?.meshProjectionTier).toBe('A')
    const b = parseDrawingFile({
      version: 1,
      sheets: [{ id: 's2', name: 'S2', scale: '1:1', meshProjectionTier: 'B' }]
    })
    expect(b.sheets[0]?.meshProjectionTier).toBe('B')
    const c = parseDrawingFile({
      version: 1,
      sheets: [{ id: 's3', name: 'S3', scale: '1:1', meshProjectionTier: 'C' }]
    })
    expect(c.sheets[0]?.meshProjectionTier).toBe('C')
  })

  it('parses view placeholders on a sheet', () => {
    const f = parseDrawingFile({
      version: 1,
      sheets: [
        {
          id: 's1',
          name: 'S1',
          viewPlaceholders: [
            { id: 'v1', kind: 'base', label: 'Front' },
            { id: 'v2', kind: 'projected', label: '' }
          ]
        }
      ]
    })
    expect(f.sheets[0]!.viewPlaceholders).toHaveLength(2)
    expect(f.sheets[0]!.viewPlaceholders![1]!.label).toBe('')
  })

  it('emptyDrawingFile is valid', () => {
    expect(drawingFileSchema.parse(emptyDrawingFile()).sheets).toEqual([])
  })

  it('replaceViewPlaceholderLabel updates one slot', () => {
    const rows = [
      { id: 'a', kind: 'base' as const, label: 'Old' },
      { id: 'b', kind: 'projected' as const, label: 'P' }
    ]
    const next = replaceViewPlaceholderLabel(rows, 'a', 'Front')
    expect(next).toEqual([
      { id: 'a', kind: 'base', label: 'Front' },
      { id: 'b', kind: 'projected', label: 'P' }
    ])
  })

  it('resolveExportViewRows includes axis and parent metadata', () => {
    const rows = resolveExportViewRows([
      { id: 'b1', kind: 'base', label: 'A', viewFrom: 'top' },
      {
        id: 'p1',
        kind: 'projected',
        label: 'B',
        parentPlaceholderId: 'b1',
        projectionDirection: 'right'
      }
    ])
    expect(rows[0]!.detailLine).toContain('top')
    expect(rows[1]!.detailLine).toContain('A')
    expect(rows[1]!.detailLine).toContain('right')
  })
})
