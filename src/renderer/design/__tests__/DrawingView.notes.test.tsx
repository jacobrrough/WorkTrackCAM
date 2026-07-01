/**
 * DrawingView free-text-note model + render pins (node-env).
 *
 * Sibling of `DrawingView.surface-finish.test.tsx`. The renderer test
 * environment is `node` (no jsdom, no @testing-library), so the interactive
 * click→persist→re-resolve path in `DrawingView.tsx` cannot be driven through a
 * rendered component. All of that logic lives in the pure note section of
 * `drawing-annotation-model.ts` (the orchestration target), which IS
 * unit-testable. The component's static surface is pinned with
 * `renderToStaticMarkup` exactly like the existing DrawingView pins. This suite
 * covers:
 *
 *   1. Snap-resolved PERSISTENCE — a one-click placement that lands on a snap
 *      point mints a `DrawingNote` whose LEADER anchor `refId` is the snapped
 *      feature's `sourceId` and whose text-block `placement` is offset from the
 *      target; a free click mints a leaderless floating note. The result parses
 *      against the persistence schema (`sheet.annotations.notes`).
 *   2. The CLIENT-SIDE ESCAPING BOUNDARY (Safety Rule 4) — unlike GD&T datums
 *      (escaped by the sidecar), note text is composed into SVG markup by the
 *      renderer itself, so `noteToSvg` / `escapeSvgText` ARE the trust boundary:
 *      a markup-bearing note must reach the emitted SVG entity-escaped, never
 *      raw. Multi-line text renders one `<text>` per line; a leader note draws
 *      the leader line + target dot; the layer composes before `</svg>`.
 *   3. The DANGLING flag — on re-projection, a note whose leader `refId` is gone
 *      flags `dangling`; a resolved leader refreshes its cachedPoint AND
 *      translates the text block by the same delta (the operator's offset is
 *      preserved); a free / absent leader never dangles.
 *   4. EDIT + DELETE — the pure `updateNoteText` / `removeNote` helpers the
 *      per-note affordances call.
 *   5. The DrawingView AFFORDANCE — the populated state renders the note
 *      toolbar (textarea + place button), a supplied `persistedNotes` list
 *      composes the note SVG into the canvas and renders the per-note edit /
 *      delete rows. A drawing WITHOUT the prop still renders (back-compat).
 *
 * Safety Rule 1: documentation overlays only — no G-code / STL touched.
 * Safety Rule 3: no `any`.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildDrawingNote,
  buildSnapIndex,
  composeNotesIntoSvg,
  escapeSvgText,
  isAssociativeNote,
  notesLayerSvg,
  noteTextLines,
  noteToSvg,
  reanchorNote,
  reanchorNotes,
  removeNote,
  updateNoteText,
  FREE_ANCHOR_REF_ID,
  NOTE_LEADER_OFFSET,
  type FreshSnapPoint,
  type ResolvedClick,
} from '../drawing-annotation-model'
import { DrawingView } from '../DrawingView'
import {
  drawingNoteSchema,
  drawingSheetAnnotationsSchema,
  type DrawingNote,
} from '../../../shared/drawing-annotation-schema'

// ── window.fab shim (see DrawingView.test.tsx for rationale) ──────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function snapClick(sourceId: string, x: number, y: number): ResolvedClick {
  return { sourceId, point: { x, y } }
}
function freeClick(x: number, y: number): ResolvedClick {
  return { sourceId: null, point: { x, y } }
}
function snapPoint(id: string, sourceId: string, x: number, y: number): FreshSnapPoint {
  return { id, sourceId, x, y }
}

/** A note payload carrying SVG markup — the stored-XSS shape Safety Rule 4 guards. */
const MARKUP_NOTE = '</text><script>alert(1)</script>'

// ── (A) Anchored-note build → persistence ─────────────────────────────────────

describe('buildDrawingNote — snap-resolved anchored placement', () => {
  it('records a snapped click as the LEADER anchor and offsets the text block', () => {
    const note = buildDrawingNote(snapClick('e:edge-7', 42, 18), 'DEBURR ALL EDGES')
    expect(note.text).toBe('DEBURR ALL EDGES')
    expect(note.leader).toBeDefined()
    expect(note.leader?.refId).toBe('e:edge-7')
    expect(note.leader?.cachedPoint).toEqual({ x: 42, y: 18 })
    // The text block sits offset from the target so the leader has length.
    expect(note.placement).toEqual({
      x: 42 + NOTE_LEADER_OFFSET.x,
      y: 18 + NOTE_LEADER_OFFSET.y,
    })
    expect(isAssociativeNote(note)).toBe(true)
    expect(typeof note.id).toBe('string')
    expect(note.id.length).toBeGreaterThan(0)
  })

  it('a free click mints a leaderless floating note at the click point', () => {
    const note = buildDrawingNote(freeClick(5, 6), 'GENERAL NOTE')
    expect(note.leader).toBeUndefined()
    expect(note.placement).toEqual({ x: 5, y: 6 })
    expect(isAssociativeNote(note)).toBe(false)
  })

  it('preserves multi-line text verbatim (escaping happens at the emitter)', () => {
    const text = 'LINE ONE\nLINE TWO\nLINE THREE'
    const note = buildDrawingNote(freeClick(0, 0), text)
    expect(note.text).toBe(text)
  })

  it('a placed note parses into the sheet annotations schema (notes)', () => {
    const note = buildDrawingNote(snapClick('v:face-1', 12, 34), 'BREAK SHARP CORNERS')
    const parsed = drawingSheetAnnotationsSchema.parse({ notes: [note] })
    expect(parsed.notes).toHaveLength(1)
    expect(parsed.notes[0]).toEqual(note)
    expect(parsed.notes[0].leader?.refId).toBe('v:face-1')
  })

  it('a markup-bearing note persists VERBATIM (never pre-mangled in the model)', () => {
    const note = buildDrawingNote(freeClick(0, 0), MARKUP_NOTE)
    expect(() => drawingNoteSchema.parse(note)).not.toThrow()
    expect(note.text).toBe(MARKUP_NOTE)
  })
})

// ── (B) Client-side SVG emitter — the escaping trust boundary ─────────────────

describe('escapeSvgText — Safety Rule 4 boundary', () => {
  it('entity-escapes every markup-significant character', () => {
    expect(escapeSvgText('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('escapes ampersands first (no double-breaking)', () => {
    expect(escapeSvgText('a & b < c')).toBe('a &amp; b &lt; c')
  })
})

describe('noteToSvg — note glyph emitter', () => {
  it('emits the backing box, the text, the class and the data-note-id', () => {
    const note = buildDrawingNote(freeClick(10, 20), 'DEBURR')
    const svg = noteToSvg(note)
    expect(svg).toContain('<rect')
    expect(svg).toContain('<text')
    expect(svg).toContain('>DEBURR</text>')
    expect(svg).toContain('class="drawing-note"')
    expect(svg).toContain('data-note-id="' + note.id + '"')
  })

  it('escapes a markup-bearing note (the payload NEVER reaches the SVG raw)', () => {
    const note = buildDrawingNote(freeClick(0, 0), MARKUP_NOTE)
    const svg = noteToSvg(note)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('</text><script>')
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('renders one <text> element per line for multi-line notes', () => {
    const note = buildDrawingNote(freeClick(0, 0), 'LINE ONE\nLINE TWO')
    const svg = noteToSvg(note)
    expect((svg.match(/<text /g) ?? [])).toHaveLength(2)
    expect(svg).toContain('>LINE ONE</text>')
    expect(svg).toContain('>LINE TWO</text>')
  })

  it('draws a leader line + target dot for a leader note', () => {
    const note = buildDrawingNote(snapClick('e:1', 30, 40), 'SEE DETAIL')
    const svg = noteToSvg(note)
    expect(svg).toContain('<line')
    expect(svg).toContain('<circle')
  })

  it('omits the leader line for a floating note', () => {
    const note = buildDrawingNote(freeClick(30, 40), 'FLOATING')
    const svg = noteToSvg(note)
    expect(svg).not.toContain('<line')
    expect(svg).not.toContain('<circle')
  })

  it('flags dangling with the modifier class + data attr + dashed leader', () => {
    const note = buildDrawingNote(snapClick('e:1', 0, 0), 'ORPHANED')
    const svg = noteToSvg(note, { dangling: true })
    expect(svg).toContain('drawing-note--dangling')
    expect(svg).toContain('data-note-dangling="true"')
    expect(svg).toContain('stroke-dasharray')
  })
})

describe('noteTextLines', () => {
  it('splits on \\n, \\r\\n and \\r', () => {
    expect(noteTextLines('a\nb')).toEqual(['a', 'b'])
    expect(noteTextLines('a\r\nb')).toEqual(['a', 'b'])
    expect(noteTextLines('a\rb')).toEqual(['a', 'b'])
  })

  it('yields one empty line for the empty string (box never collapses)', () => {
    expect(noteTextLines('')).toEqual([''])
  })
})

describe('notesLayerSvg / composeNotesIntoSvg', () => {
  it('wraps the notes in a testable layer group', () => {
    const notes = [
      buildDrawingNote(freeClick(0, 0), 'ONE'),
      buildDrawingNote(freeClick(5, 5), 'TWO'),
    ]
    const layer = notesLayerSvg(notes)
    expect(layer).toContain('class="drawing-note-layer"')
    expect(layer).toContain('data-testid="design-drawing-note-layer"')
    expect((layer.match(/data-note-id=/g) ?? [])).toHaveLength(2)
  })

  it('returns the empty string for no notes', () => {
    expect(notesLayerSvg([])).toBe('')
  })

  it('splices the layer in just before </svg>', () => {
    const base = '<svg width="800" height="600"><rect/></svg>'
    const notes = [buildDrawingNote(freeClick(0, 0), 'SPLICED')]
    const composed = composeNotesIntoSvg(base, notes)
    expect(composed.indexOf('drawing-note-layer')).toBeGreaterThan(composed.indexOf('<rect/>'))
    expect(composed.indexOf('drawing-note-layer')).toBeLessThan(composed.indexOf('</svg>'))
    expect(composed).toContain('<rect/>')
  })

  it('returns the input SVG unchanged when there are no notes', () => {
    const base = '<svg></svg>'
    expect(composeNotesIntoSvg(base, [])).toBe(base)
  })
})

// ── (C) updateNoteText / removeNote — the edit + delete affordances ───────────

describe('updateNoteText / removeNote — pure edit + delete', () => {
  it('replaces the text of exactly the matching note (inputs untouched)', () => {
    const a = buildDrawingNote(freeClick(0, 0), 'OLD')
    const b = buildDrawingNote(freeClick(1, 1), 'OTHER')
    const next = updateNoteText([a, b], a.id, 'NEW')
    expect(next).toHaveLength(2)
    expect(next[0].text).toBe('NEW')
    expect(next[1].text).toBe('OTHER')
    // Purity: the source note is never mutated.
    expect(a.text).toBe('OLD')
  })

  it('removes exactly the matching note', () => {
    const a = buildDrawingNote(freeClick(0, 0), 'KEEP')
    const b = buildDrawingNote(freeClick(1, 1), 'DROP')
    const next = removeNote([a, b], b.id)
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(a.id)
  })

  it('is a no-op for an unknown id', () => {
    const a = buildDrawingNote(freeClick(0, 0), 'KEEP')
    expect(updateNoteText([a], 'nope', 'X')[0].text).toBe('KEEP')
    expect(removeNote([a], 'nope')).toHaveLength(1)
  })
})

// ── (D) reanchorNote / reanchorNotes — the dangling flag ──────────────────────

describe('reanchorNote — per-note leader re-resolution', () => {
  it('refreshes a resolved leader AND translates the text block by the same delta', () => {
    const note = buildDrawingNote(snapClick('v:a', 10, 10), 'RIDES ALONG')
    // The feature moved +5/+3 on rebuild.
    const index = buildSnapIndex([snapPoint('s:1', 'v:a', 15, 13)])
    const { note: next, dangling } = reanchorNote(note, index)
    expect(dangling).toBe(false)
    expect(next.leader?.cachedPoint).toEqual({ x: 15, y: 13 })
    // Text block keeps the operator's offset: original placement + (5, 3).
    expect(next.placement).toEqual({
      x: note.placement.x + 5,
      y: note.placement.y + 3,
    })
    // Input is never mutated.
    expect(note.leader?.cachedPoint).toEqual({ x: 10, y: 10 })
  })

  it('flags dangling and KEEPS the stale leader + placement when the refId is gone', () => {
    const note = buildDrawingNote(snapClick('v:GONE', 7, 9), 'ORPHAN')
    const index = buildSnapIndex([snapPoint('s:1', 'v:a', 1, 1)])
    const { note: next, dangling } = reanchorNote(note, index)
    expect(dangling).toBe(true)
    expect(next.leader?.cachedPoint).toEqual({ x: 7, y: 9 })
    expect(next.placement).toEqual(note.placement)
  })

  it('a leaderless note passes through untouched and never dangles', () => {
    const note = buildDrawingNote(freeClick(3, 4), 'FLOATING')
    const { note: next, dangling } = reanchorNote(note, buildSnapIndex([]))
    expect(dangling).toBe(false)
    expect(next).toEqual(note)
  })

  it('a free-anchored leader (empty refId) never dangles', () => {
    const note: DrawingNote = {
      id: 'n-free-leader',
      text: 'FREE LEADER',
      placement: { x: 10, y: 10 },
      leader: { refId: FREE_ANCHOR_REF_ID, cachedPoint: { x: 0, y: 0 } },
    }
    const { dangling } = reanchorNote(note, buildSnapIndex([]))
    expect(dangling).toBe(false)
  })
})

describe('reanchorNotes — list-level dangling set', () => {
  it('collects the ids of every note that lost its leader anchor', () => {
    const kept = buildDrawingNote(snapClick('v:a', 0, 0), 'KEPT')
    const lost = buildDrawingNote(snapClick('v:GONE', 5, 5), 'LOST')
    const floating = buildDrawingNote(freeClick(9, 9), 'FLOATING')
    const fresh = [snapPoint('s:1', 'v:a', 0, 0)]
    const { notes, danglingIds } = reanchorNotes([kept, lost, floating], fresh)
    expect(notes).toHaveLength(3)
    expect(danglingIds.has(lost.id)).toBe(true)
    expect(danglingIds.has(kept.id)).toBe(false)
    expect(danglingIds.has(floating.id)).toBe(false)
    expect(danglingIds.size).toBe(1)
  })

  it('re-resolved notes still parse into the persistence schema', () => {
    const note = buildDrawingNote(snapClick('v:a', 0, 0), 'PARSES')
    const { notes } = reanchorNotes([note], [snapPoint('s:1', 'v:a', 2, 2)])
    const parsed = drawingSheetAnnotationsSchema.parse({ notes })
    expect(parsed.notes[0].text).toBe('PARSES')
  })
})

// ── (E) DrawingView affordance + note render ──────────────────────────────────

describe('DrawingView — note affordance render contract', () => {
  it('renders the note toolbar with the textarea + the place button', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-note-toolbar"')
    expect(html).toContain('data-testid="design-drawing-note-text"')
    expect(html).toContain('data-testid="design-drawing-note-place"')
    expect(html).toContain('Place note')
  })

  it('reports an empty note count by default + hides Clear and the note list', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
      }),
    )
    expect(html).toContain('data-testid="design-drawing-note-count"')
    expect(html).toContain('No notes')
    expect(html).not.toContain('data-testid="design-drawing-note-clear"')
    expect(html).not.toContain('data-testid="design-drawing-note-list"')
  })

  it('omits the note toolbar in the empty-state branch', () => {
    const html = renderToStaticMarkup(createElement(DrawingView, { partHandle: null }))
    expect(html).not.toContain('data-testid="design-drawing-note-toolbar"')
  })

  it('composes a persisted note into the canvas SVG (escaped text reaches the markup)', () => {
    const note: DrawingNote = {
      id: 'n-1',
      text: 'DEBURR ALL EDGES',
      placement: { x: 20, y: 8 },
      leader: { refId: 'e1', cachedPoint: { x: 4, y: 30 } },
    }
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg width="800" height="600"><rect/></svg>',
        persistedNotes: [note],
      }),
    )
    // The note layer + its text are spliced into the inline SVG host.
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).toContain('drawing-note-layer')
    expect(html).toContain('DEBURR ALL EDGES')
    // The count reflects the supplied note (controlled mode) + the edit/delete rows.
    expect(html).toContain('1 note')
    expect(html).toContain('data-testid="design-drawing-note-clear"')
    expect(html).toContain('data-testid="design-drawing-note-list"')
    expect(html).toContain('data-testid="design-drawing-note-edit-n-1"')
    expect(html).toContain('data-testid="design-drawing-note-delete-n-1"')
  })

  it('a markup-bearing persisted note NEVER reaches the html as live markup', () => {
    const note: DrawingNote = {
      id: 'n-xss',
      text: MARKUP_NOTE,
      placement: { x: 0, y: 0 },
    }
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
        persistedNotes: [note],
      }),
    )
    expect(html).not.toContain('<script')
    // The SVG layer carries the entity-escaped payload instead.
    expect(html).toContain('&lt;script&gt;')
  })

  it('reports the plural count when multiple notes are supplied', () => {
    const mk = (id: string): DrawingNote => ({
      id,
      text: 'NOTE ' + id,
      placement: { x: 0, y: 0 },
    })
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg></svg>',
        persistedNotes: [mk('a'), mk('b')],
      }),
    )
    expect(html).toContain('2 notes')
    expect(html).toContain('data-testid="design-drawing-note-edit-a"')
    expect(html).toContain('data-testid="design-drawing-note-edit-b"')
  })

  it('renders fine for a drawing WITHOUT the notes prop (back-compat)', () => {
    const html = renderToStaticMarkup(
      createElement(DrawingView, {
        partHandle: 'script:abc',
        previewSvg: '<svg><circle/></svg>',
      }),
    )
    // The base drawing still renders, and the toolbar is present but inert.
    expect(html).toContain('data-testid="design-drawing-svg"')
    expect(html).toContain('<circle')
    expect(html).toContain('data-testid="design-drawing-note-toolbar"')
    // No note layer when none are supplied.
    expect(html).not.toContain('drawing-note-layer')
  })
})
