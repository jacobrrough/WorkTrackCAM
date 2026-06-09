/**
 * Wave 3f — Text → machinable sketch vectors dialog.
 *
 * Two halves, matching the repo's node-env (`renderToStaticMarkup`, no jsdom)
 * renderer-test convention:
 *   1. RENDER — the dialog mounts a text field, a font picker (bundled faces),
 *      cap-height + letter-spacing numeric fields, and an Insert button. Every
 *      interactive element is a `<button type="button">` / native control.
 *   2. INSERT CONTRACT — the load-bearing behavior is the exact merge the Apply
 *      handler performs: `mergeTextVectorsIntoDesign({ text, fontBuffer, sizeMm,
 *      letterSpacingMm }, design)` folds CLOSED text contours additively into the
 *      live design model (the same model the sketch surface edits and
 *      cam-2d-derive reads). SSR can't dispatch the click, so we pin the pure
 *      merge the handler calls — the load-bearing half — directly.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import opentype, { type Font } from 'opentype.js'
import { TextDialog, DEFAULT_TEXT_SIZE_MM } from '../TextDialog'
import { mergeTextVectorsIntoDesign } from '../../../../shared/text-to-vectors'
import { listContourCandidatesFromDesign } from '../../../../shared/cam-2d-derive'
import { emptyDesign, type DesignFileV2 } from '../../../../shared/design-schema'

let font: Font
let fontBuffer: ArrayBuffer
beforeAll(() => {
  const buf = readFileSync(join(process.cwd(), 'resources', 'fonts', 'Roboto-Regular.ttf'))
  fontBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  font = opentype.parse(fontBuffer)
})

const noop = (): void => undefined
/** A loader matching the injected-loader prop shape (returns the on-disk buffer). */
const bufferLoader = async (): Promise<ArrayBuffer> => fontBuffer

describe('TextDialog — render contract', () => {
  it('renders the dialog shell with text / font / size / spacing fields', () => {
    const html = renderToStaticMarkup(
      createElement(TextDialog, {
        design: emptyDesign(),
        onInsert: noop,
        loadFontBuffer: bufferLoader
      })
    )
    expect(html).toContain('data-testid="fd-text"')
    expect(html).toContain('data-testid="fd-text-string"')
    expect(html).toContain('data-testid="fd-text-font"')
    expect(html).toContain('data-testid="fd-text-size"')
    expect(html).toContain('data-testid="fd-text-spacing"')
    expect(html).toContain('data-testid="fd-text-apply"')
  })

  it('seeds the default cap-height (mm) into the size field', () => {
    const html = renderToStaticMarkup(
      createElement(TextDialog, {
        design: emptyDesign(),
        onInsert: noop,
        loadFontBuffer: bufferLoader
      })
    )
    expect(html).toContain(`value="${DEFAULT_TEXT_SIZE_MM}"`)
  })

  it('offers the bundled font in the picker', () => {
    const html = renderToStaticMarkup(
      createElement(TextDialog, {
        design: emptyDesign(),
        onInsert: noop,
        loadFontBuffer: bufferLoader
      })
    )
    expect(html).toContain('Roboto Regular')
  })

  it('renders a Cancel button only when onClose is wired', () => {
    const withClose = renderToStaticMarkup(
      createElement(TextDialog, {
        design: emptyDesign(),
        onInsert: noop,
        onClose: noop,
        loadFontBuffer: bufferLoader
      })
    )
    expect(withClose).toContain('data-testid="fd-text-cancel"')

    const withoutClose = renderToStaticMarkup(
      createElement(TextDialog, {
        design: emptyDesign(),
        onInsert: noop,
        loadFontBuffer: bufferLoader
      })
    )
    expect(withoutClose).not.toContain('data-testid="fd-text-cancel"')
  })

  it('every interactive button is type="button" (CLAUDE.md rule)', () => {
    const html = renderToStaticMarkup(
      createElement(TextDialog, {
        design: emptyDesign(),
        onInsert: noop,
        onClose: noop,
        loadFontBuffer: bufferLoader
      })
    )
    const openTags = html.match(/<button[^>]*>/g) ?? []
    expect(openTags.length).toBeGreaterThan(0)
    for (const tag of openTags) {
      expect(tag).toContain('type="button"')
    }
  })
})

describe('TextDialog — insert contract (the merge the Apply handler performs)', () => {
  it("inserting 'O' folds 2 closed rings into the live design (additive)", () => {
    // Pre-existing CAD-authored geometry the insert must NOT clobber.
    const base: DesignFileV2 = {
      ...emptyDesign(),
      entities: [{ id: 'cad-circle', kind: 'circle', cx: 100, cy: 100, r: 5 }]
    }
    const baseCount = base.entities.length

    // The exact call TextDialog.handleApply makes (text + fontBuffer + sizeMm).
    const { design, result } = mergeTextVectorsIntoDesign(
      { text: 'O', fontBuffer, sizeMm: DEFAULT_TEXT_SIZE_MM, letterSpacingMm: 0, idPrefix: 'dlgO' },
      base
    )

    // Base untouched (pure merge).
    expect(base.entities).toHaveLength(baseCount)
    // Two text rings (outer + counter) appended.
    expect(result.contours.filter((c) => !c.isHole)).toHaveLength(1)
    expect(result.contours.filter((c) => c.isHole)).toHaveLength(1)
    expect(design.entities).toHaveLength(baseCount + result.entities.length)
    expect(design.entities.some((e) => e.id === 'cad-circle')).toBe(true)

    // And the inserted contours are immediately cam-derivable (sign/V-carve).
    const candidates = listContourCandidatesFromDesign(design)
    // 1 pre-existing circle loop + 2 text rings = 3 candidates.
    expect(candidates).toHaveLength(3)
  })

  it('the parsed-font path and the raw-buffer path agree (loader returns bytes)', async () => {
    // The dialog parses the bytes its loader returns; assert that path matches a
    // pre-parsed Font for the same input, so the injected loader is equivalent.
    const viaFont = mergeTextVectorsIntoDesign({ text: 'A', font, sizeMm: 14, idPrefix: 'f' })
    const buf = await bufferLoader()
    const viaBuffer = mergeTextVectorsIntoDesign({ text: 'A', fontBuffer: buf, sizeMm: 14, idPrefix: 'b' })
    expect(viaBuffer.result.entities).toHaveLength(viaFont.result.entities.length)
  })
})
