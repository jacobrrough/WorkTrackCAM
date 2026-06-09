import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as opentype from 'opentype.js'
import type { Font } from 'opentype.js'
import {
  DEFAULT_CHORD_TOLERANCE_MM,
  mergeTextVectorsIntoDesign,
  textToSketchVectors,
  type TextContour
} from './text-to-vectors'
import { emptyDesign } from './design-schema'
import { listContourCandidatesFromDesign } from './cam-2d-derive'

/**
 * Loads the BUNDLED OFL/Apache font from resources/fonts and validates the pure
 * Text → machinable-vector engine. No network is touched — the font is read off
 * disk (the same buffer the main process would pass to the renderer). The whole
 * engine is pure, so these run in the `node` vitest env.
 */
const FONT_PATH = join(process.cwd(), 'resources', 'fonts', 'Roboto-Regular.ttf')

let font: Font
let fontBuffer: ArrayBuffer

beforeAll(() => {
  const buf = readFileSync(FONT_PATH)
  fontBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  font = opentype.parse(fontBuffer)
})

/** Shoelace signed area (×2): >0 CCW, <0 CW. */
function signedArea2(points: ReadonlyArray<readonly [number, number]>): number {
  let s = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s
}

/** Tight bbox of a single contour's points. */
function contourBbox(c: TextContour): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of c.points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

describe('text-to-vectors — bundled font sanity', () => {
  it('the bundled Roboto TTF parses and has the expected em square', () => {
    expect(font).toBeTruthy()
    expect(font.unitsPerEm).toBe(2048)
    // Ascender positive, descender negative (Y-up font space).
    expect(font.ascender).toBeGreaterThan(0)
    expect(font.descender).toBeLessThan(0)
  })
})

describe('text-to-vectors — contour counts + holes', () => {
  it("a single 'O' yields TWO closed contours (outer + one hole)", () => {
    const r = textToSketchVectors({ text: 'O', font, sizeMm: 20 })
    expect(r.contours).toHaveLength(2)
    // Exactly one outer (solid) and one hole.
    const holes = r.contours.filter((c) => c.isHole)
    const solids = r.contours.filter((c) => !c.isHole)
    expect(solids).toHaveLength(1)
    expect(holes).toHaveLength(1)
    // Every contour is emitted as a CLOSED polyline entity.
    expect(r.entities).toHaveLength(2)
    expect(r.entities.every((e) => e.kind === 'polyline' && e.closed)).toBe(true)
  })

  it("a single 'V' yields ONE closed contour and NO hole", () => {
    const r = textToSketchVectors({ text: 'V', font, sizeMm: 20 })
    expect(r.contours).toHaveLength(1)
    expect(r.contours[0]!.isHole).toBe(false)
    expect(r.emptyGlyphCount).toBe(0)
  })

  it("a single 'A' yields an outer triangle + one counter (hole)", () => {
    const r = textToSketchVectors({ text: 'A', font, sizeMm: 20 })
    expect(r.contours).toHaveLength(2)
    expect(r.contours.filter((c) => c.isHole)).toHaveLength(1)
  })

  it("a single 'e' yields an outer body + one counter (hole)", () => {
    const r = textToSketchVectors({ text: 'e', font, sizeMm: 20 })
    expect(r.contours).toHaveLength(2)
    expect(r.contours.filter((c) => c.isHole)).toHaveLength(1)
  })

  it("a single 'B' yields an outer body + TWO counters (two holes)", () => {
    const r = textToSketchVectors({ text: 'B', font, sizeMm: 20 })
    // B has two stacked counters.
    expect(r.contours.filter((c) => c.isHole)).toHaveLength(2)
    expect(r.contours.filter((c) => !c.isHole)).toHaveLength(1)
  })

  it('a space produces no contours and counts as an empty glyph', () => {
    const r = textToSketchVectors({ text: ' ', font, sizeMm: 20 })
    expect(r.contours).toHaveLength(0)
    expect(r.entities).toHaveLength(0)
    expect(r.emptyGlyphCount).toBe(1)
    // ...but the pen still advanced (space has an advance width).
    expect(r.advanceWidthMm).toBeGreaterThan(0)
  })
})

describe('text-to-vectors — winding contract (machinable holes)', () => {
  it("'O' outer contour is CCW and the hole is CW", () => {
    const r = textToSketchVectors({ text: 'O', font, sizeMm: 30 })
    const outer = r.contours.find((c) => !c.isHole)!
    const hole = r.contours.find((c) => c.isHole)!
    expect(signedArea2(outer.points)).toBeGreaterThan(0) // CCW
    expect(signedArea2(hole.points)).toBeLessThan(0) // CW
  })

  it('the hole is geometrically inside the outer contour bbox', () => {
    const r = textToSketchVectors({ text: 'O', font, sizeMm: 30 })
    const outer = contourBbox(r.contours.find((c) => !c.isHole)!)
    const hole = contourBbox(r.contours.find((c) => c.isHole)!)
    expect(hole.minX).toBeGreaterThanOrEqual(outer.minX - 1e-6)
    expect(hole.maxX).toBeLessThanOrEqual(outer.maxX + 1e-6)
    expect(hole.minY).toBeGreaterThanOrEqual(outer.minY - 1e-6)
    expect(hole.maxY).toBeLessThanOrEqual(outer.maxY + 1e-6)
  })

  it('hole nesting depth is odd (1) and outer is even (0)', () => {
    const r = textToSketchVectors({ text: 'O', font, sizeMm: 30 })
    expect(r.contours.find((c) => !c.isHole)!.depth).toBe(0)
    expect(r.contours.find((c) => c.isHole)!.depth).toBe(1)
  })
})

describe('text-to-vectors — linear scaling with sizeMm', () => {
  it('total advance width scales linearly with sizeMm', () => {
    const a = textToSketchVectors({ text: 'HELLO', font, sizeMm: 10 })
    const b = textToSketchVectors({ text: 'HELLO', font, sizeMm: 20 })
    expect(a.advanceWidthMm).toBeGreaterThan(0)
    expect(b.advanceWidthMm / a.advanceWidthMm).toBeCloseTo(2, 4)
  })

  it("'O' bbox width + height scale linearly with sizeMm", () => {
    const a = textToSketchVectors({ text: 'O', font, sizeMm: 10 })
    const b = textToSketchVectors({ text: 'O', font, sizeMm: 40 })
    const wA = a.bbox.maxX - a.bbox.minX
    const hA = a.bbox.maxY - a.bbox.minY
    const wB = b.bbox.maxX - b.bbox.minX
    const hB = b.bbox.maxY - b.bbox.minY
    expect(wB / wA).toBeCloseTo(4, 3)
    expect(hB / hA).toBeCloseTo(4, 3)
  })
})

describe('text-to-vectors — glyph bbox matches font metrics within tolerance', () => {
  it("the cap-height letter 'H' has the expected scaled bbox", () => {
    const sizeMm = 25
    const r = textToSketchVectors({ text: 'H', font, sizeMm })
    const scale = sizeMm / font.unitsPerEm

    // Independent ground truth straight from the parsed font glyph metrics.
    const glyph = font.charToGlyph('H')
    const bb = glyph.getBoundingBox()
    const expectedW = (bb.x2 - bb.x1) * scale
    const expectedH = (bb.y2 - bb.y1) * scale

    const gotW = r.bbox.maxX - r.bbox.minX
    const gotH = r.bbox.maxY - r.bbox.minY

    // Chord flattening + dedupe keeps us well under 0.1 mm of the true extent.
    expect(gotW).toBeCloseTo(expectedW, 1)
    expect(gotH).toBeCloseTo(expectedH, 1)

    // Baseline at y=0 → the cap rises into +Y; descender-free 'H' sits on 0.
    expect(r.bbox.minY).toBeCloseTo(bb.y1 * scale, 1) // bb.y1 ≈ 0 for H
    expect(r.bbox.maxY).toBeCloseTo(bb.y2 * scale, 1) // cap height, in +Y
  })

  it("'O' cap height ≈ the font's O glyph height for the given sizeMm", () => {
    const sizeMm = 18
    const r = textToSketchVectors({ text: 'O', font, sizeMm })
    const scale = sizeMm / font.unitsPerEm
    const bb = font.charToGlyph('O').getBoundingBox()
    const expectedH = (bb.y2 - bb.y1) * scale
    const gotH = r.bbox.maxY - r.bbox.minY
    expect(gotH).toBeCloseTo(expectedH, 1)
  })
})

describe('text-to-vectors — spacing + layout', () => {
  it('positive letterSpacing widens the run; negative narrows it', () => {
    const base = textToSketchVectors({ text: 'AB', font, sizeMm: 12 })
    const wide = textToSketchVectors({ text: 'AB', font, sizeMm: 12, letterSpacingMm: 5 })
    const tight = textToSketchVectors({ text: 'AB', font, sizeMm: 12, letterSpacingMm: -1 })
    expect(wide.advanceWidthMm).toBeGreaterThan(base.advanceWidthMm)
    expect(tight.advanceWidthMm).toBeLessThan(base.advanceWidthMm)
    // One inter-glyph gap of 5 mm between the two letters.
    expect(wide.advanceWidthMm - base.advanceWidthMm).toBeCloseTo(5, 6)
  })

  it('a second line steps the baseline DOWN by lineSpacing (−Y)', () => {
    const r = textToSketchVectors({ text: 'H\nH', font, sizeMm: 20, lineSpacingMm: 30 })
    // Line 1 cap top is near +ascender*scale; line 2 sits 30 mm lower, so the
    // overall geometry must extend below y = 0 by roughly (30 − capHeight).
    expect(r.bbox.minY).toBeLessThan(0)
    // Both H's → two glyphs, each one contour (no holes).
    expect(r.contours.filter((c) => !c.isHole)).toHaveLength(2)
    expect(r.contours.filter((c) => c.isHole)).toHaveLength(0)
  })

  it('glyphIndex is assigned per glyph across the whole run', () => {
    const r = textToSketchVectors({ text: 'OO', font, sizeMm: 14 })
    // Two O's → glyphIndex 0 and 1, each contributing an outer + a hole.
    const indices = new Set(r.contours.map((c) => c.glyphIndex))
    expect(indices).toEqual(new Set([0, 1]))
    for (const gi of indices) {
      const forGlyph = r.contours.filter((c) => c.glyphIndex === gi)
      expect(forGlyph.filter((c) => c.isHole)).toHaveLength(1)
    }
  })
})

describe('text-to-vectors — fontBuffer path (in-process parse)', () => {
  it('accepts a raw font buffer and produces identical contour counts', () => {
    const viaFont = textToSketchVectors({ text: 'O', font, sizeMm: 16 })
    const viaBuffer = textToSketchVectors({ text: 'O', fontBuffer, sizeMm: 16 })
    expect(viaBuffer.contours).toHaveLength(viaFont.contours.length)
    expect(viaBuffer.contours.filter((c) => c.isHole)).toHaveLength(1)
  })

  it('throws when neither font nor fontBuffer is supplied', () => {
    expect(() => textToSketchVectors({ text: 'X', sizeMm: 10 })).toThrow(/font/i)
  })

  it('throws on a non-positive sizeMm', () => {
    expect(() => textToSketchVectors({ text: 'X', font, sizeMm: 0 })).toThrow(/sizeMm/)
    expect(() => textToSketchVectors({ text: 'X', font, sizeMm: -5 })).toThrow(/sizeMm/)
  })
})

describe('text-to-vectors — chord tolerance', () => {
  it('a finer chord tolerance yields more points on a curved glyph', () => {
    const coarse = textToSketchVectors({ text: 'O', font, sizeMm: 40, chordToleranceMm: 0.5 })
    const fine = textToSketchVectors({ text: 'O', font, sizeMm: 40, chordToleranceMm: 0.01 })
    const coarsePts = Object.keys(coarse.points).length
    const finePts = Object.keys(fine.points).length
    expect(finePts).toBeGreaterThan(coarsePts)
  })

  it('the default chord tolerance constant is the documented 0.05 mm', () => {
    expect(DEFAULT_CHORD_TOLERANCE_MM).toBe(0.05)
  })
})

describe('text-to-vectors — sketch-model integration', () => {
  it('emits closed polylines whose pointIds resolve into the points record', () => {
    const r = textToSketchVectors({ text: 'O', font, sizeMm: 20, idPrefix: 'fixt' })
    for (const e of r.entities) {
      expect(e.kind).toBe('polyline')
      if (e.kind === 'polyline' && 'pointIds' in e) {
        expect(e.pointIds.length).toBeGreaterThanOrEqual(3)
        for (const id of e.pointIds) {
          expect(r.points[id]).toBeDefined()
        }
      }
    }
  })

  it('a stable idPrefix produces deterministic, collision-free ids', () => {
    const a = textToSketchVectors({ text: 'AV', font, sizeMm: 12, idPrefix: 'seed' })
    const b = textToSketchVectors({ text: 'AV', font, sizeMm: 12, idPrefix: 'seed' })
    expect(Object.keys(a.points)).toEqual(Object.keys(b.points))
    expect(a.entities.map((e) => e.id)).toEqual(b.entities.map((e) => e.id))
    // No id collides between points and entities.
    const ids = new Set<string>()
    for (const k of Object.keys(a.points)) ids.add(k)
    for (const e of a.entities) {
      expect(ids.has(e.id)).toBe(false)
      ids.add(e.id)
    }
  })

  it('the emitted closed contours are picked up by listContourCandidatesFromDesign', () => {
    const { design } = mergeTextVectorsIntoDesign({ text: 'OV', font, sizeMm: 20, idPrefix: 'cand' })
    const candidates = listContourCandidatesFromDesign(design)
    // O (outer + hole) + V (outer) = 3 closed loops, all ≥3 pts.
    expect(candidates.length).toBe(3)
    for (const c of candidates) {
      expect(c.points.length).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('text-to-vectors — mergeTextVectorsIntoDesign', () => {
  it('additively folds text geometry into a base design without mutating it', () => {
    const base = emptyDesign()
    base.entities.push({
      id: 'pre',
      kind: 'circle',
      cx: 100,
      cy: 100,
      r: 5
    })
    const baseEntityCount = base.entities.length
    const { design, result } = mergeTextVectorsIntoDesign(
      { text: 'O', font, sizeMm: 15, idPrefix: 'm1' },
      base
    )
    // Base untouched.
    expect(base.entities).toHaveLength(baseEntityCount)
    // Merged design keeps the pre-existing entity AND the new text entities.
    expect(design.entities).toHaveLength(baseEntityCount + result.entities.length)
    expect(design.entities.some((e) => e.id === 'pre')).toBe(true)
    // Other design fields preserved.
    expect(design.version).toBe(2)
    expect(design.extrudeDepthMm).toBe(base.extrudeDepthMm)
  })

  it('replace mode drops the base geometry and keeps only the text', () => {
    const base = emptyDesign()
    base.entities.push({ id: 'pre', kind: 'circle', cx: 0, cy: 0, r: 5 })
    const { design, result } = mergeTextVectorsIntoDesign(
      { text: 'V', font, sizeMm: 15, replace: true, idPrefix: 'm2' },
      base
    )
    expect(design.entities.some((e) => e.id === 'pre')).toBe(false)
    expect(design.entities).toHaveLength(result.entities.length)
  })

  it('the merged design validates against the v2 sketch schema (round-trippable)', async () => {
    const { designFileSchemaV2 } = await import('./design-schema')
    const { design } = mergeTextVectorsIntoDesign({ text: 'Hi', font, sizeMm: 12, idPrefix: 'val' })
    expect(() => designFileSchemaV2.parse(design)).not.toThrow()
  })
})

describe('text-to-vectors — multi-glyph word', () => {
  it("'CAM' produces three glyphs' worth of contours laid left-to-right", () => {
    const r = textToSketchVectors({ text: 'CAM', font, sizeMm: 20, idPrefix: 'cam' })
    // C (1 outer, open-ish but font outline is closed) + A (outer+hole) + M (1 outer).
    const byGlyph = new Map<number, TextContour[]>()
    for (const c of r.contours) {
      const list = byGlyph.get(c.glyphIndex) ?? []
      list.push(c)
      byGlyph.set(c.glyphIndex, list)
    }
    expect(byGlyph.size).toBe(3)
    // A (glyphIndex 1) must contribute exactly one hole.
    expect((byGlyph.get(1) ?? []).filter((c) => c.isHole)).toHaveLength(1)
    // Glyphs march in +X: each glyph's min-X is ≥ the previous glyph's min-X.
    const minXById = [...byGlyph.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, cs]) => Math.min(...cs.flatMap((c) => c.points.map((p) => p[0]))))
    for (let i = 1; i < minXById.length; i++) {
      expect(minXById[i]!).toBeGreaterThan(minXById[i - 1]!)
    }
  })
})
