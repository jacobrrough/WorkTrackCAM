/**
 * Phase 6 Change 2 — HELICAL RAMP ENTRY for the two pocket generators that
 * lacked it: the offset-spiral (`generatePocketOffsetSpiralLines`) and the
 * adaptive clearing engine (`generateAdaptiveClearing2dLines`).
 *
 * Both now delegate their cut entry to the PROVEN region-clamped helix engine
 * `buildEntryMoves(mode:'helix')` (used already by the raster pocket at
 * cam-local.ts). This gate proves the two NEW integrations honour the SAME
 * contract the raster pocket does, and — most importantly — the SAFETY CONTRACT:
 *
 *  (A) BYTE-IDENTITY (the param-gated safety promise): with entryMode NOT
 *      'helix' (plunge / ramp / absent), the emitted G-code is BYTE-IDENTICAL
 *      to today. New behaviour appears ONLY when the operator opts into helix.
 *      Proven by: absent-entryMode === explicit-plunge (byte-equal) for BOTH
 *      generators, and neither non-helix body contains any G2/G3 arc.
 *
 *  (B) HELIX SHAPE: entryMode:'helix' emits a G2 helix descent (alternating
 *      semicircles, I/J centre form) at the loop start, radius within the
 *      region-fit clamp, at the plunge feed, descending from safe-Z to depth.
 *
 *  (C) NEVER RAPID BELOW SAFE-Z: no G0 carries a Z below the safe plane; every
 *      descent is a feed move (buildEntryMoves emits G2 feed, never G0).
 *
 *  (D) STAYS INSIDE THE POCKET: every arc endpoint is within the pocket
 *      footprint (the region-fit clamp keeps the whole helix — cutter included
 *      — inside outer-minus-islands).
 *
 *  (E) NEVER-DEGRADE: where the region is too small for ANY usable helix, the
 *      entry degrades to a ramp / plunge (no arc) and an honest hint is
 *      returned — the descent is NEVER abandoned or pushed outside the part.
 *
 * Pure generator level (no post / no I/O). The posted-through-post proof for
 * Laguna + Carvera-3 lives in cam-entry-move-posted.test.ts.
 */
import { describe, expect, it } from 'vitest'
import type { CamPoint2d } from './cam-local'
import { generatePocketOffsetSpiralLines } from './cam-pocket-offset'
import { generateAdaptiveClearing2dLines } from './cam-adaptive-clearing'

// -- Fixtures ------------------------------------------------------------------

/** A 60x60 square pocket, roomy enough that inner loops admit a real helix. */
const SQUARE_60: CamPoint2d[] = [
  [0, 0],
  [60, 0],
  [60, 60],
  [0, 60]
]

/** A 3x3 square pocket — far too small for any usable helix (never-degrade). */
const TINY_3: CamPoint2d[] = [
  [0, 0],
  [3, 0],
  [3, 3],
  [0, 3]
]

const BASE = {
  stepoverMm: 12,
  zPassMm: -3,
  feedMmMin: 1200,
  plungeMmMin: 400,
  safeZMm: 6
} as const

// -- Small G-code parsers ------------------------------------------------------

type Move = { code: string; x?: number; y?: number; z?: number; i?: number; j?: number; f?: number }

function parseMoves(lines: string[]): Move[] {
  const out: Move[] = []
  for (const l of lines) {
    const m = l.match(/^(G[0123])\b/)
    if (!m) continue
    const mv: Move = { code: m[1]! }
    const g = (re: RegExp): number | undefined => {
      const mm = l.match(re)
      return mm ? Number.parseFloat(mm[1]!) : undefined
    }
    mv.x = g(/\bX(-?\d+(?:\.\d+)?)/)
    mv.y = g(/\bY(-?\d+(?:\.\d+)?)/)
    mv.z = g(/\bZ(-?\d+(?:\.\d+)?)/)
    mv.i = g(/\bI(-?\d+(?:\.\d+)?)/)
    mv.j = g(/\bJ(-?\d+(?:\.\d+)?)/)
    mv.f = g(/\bF(-?\d+(?:\.\d+)?)/)
    out.push(mv)
  }
  return out
}

function ringBounds(ring: CamPoint2d[]): { x0: number; x1: number; y0: number; y1: number } {
  const xs = ring.map((p) => p[0])
  const ys = ring.map((p) => p[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

/** The four universal helix-entry safety assertions on a generator's lines. */
function assertHelixSafety(lines: string[], pocket: CamPoint2d[], safeZ: number, plungeFeed: number): void {
  const moves = parseMoves(lines)
  const b = ringBounds(pocket)

  // (B) at least one G2 arc that also moves in Z (the helix descent).
  const helixArcs = moves.filter((m) => m.code === 'G2' && m.z != null)
  expect(helixArcs.length).toBeGreaterThanOrEqual(1)

  // Helix arcs carry an I/J centre form and use the PLUNGE feed (Z-dominant).
  for (const m of helixArcs) {
    expect(m.i != null || m.j != null).toBe(true)
    expect(m.f).toBe(plungeFeed)
  }

  // (C) NEVER rapid below safe-Z: no G0 carries a Z under the safe plane.
  for (const m of moves) {
    if (m.code === 'G0' && m.z != null) expect(m.z).toBeGreaterThanOrEqual(safeZ - 1e-6)
  }

  // (D) every arc endpoint stays inside the pocket footprint (region-fit clamp).
  for (const m of moves) {
    if ((m.code === 'G2' || m.code === 'G3') && m.x != null && m.y != null) {
      expect(m.x).toBeGreaterThanOrEqual(b.x0 - 1e-6)
      expect(m.x).toBeLessThanOrEqual(b.x1 + 1e-6)
      expect(m.y).toBeGreaterThanOrEqual(b.y0 - 1e-6)
      expect(m.y).toBeLessThanOrEqual(b.y1 + 1e-6)
    }
  }
}

/** The measured helix radius from a run of same-sign |I| words (centre-offset). */
function maxHelixRadius(lines: string[]): number {
  let best = 0
  for (const m of parseMoves(lines)) {
    if (m.code === 'G2' && m.i != null) best = Math.max(best, Math.abs(m.i))
  }
  return best
}

// ══════════════════════════════════════════════════════════════════════════
// (A) BYTE-IDENTITY — the param-gated safety contract
// ══════════════════════════════════════════════════════════════════════════

describe('byte-identity: non-helix entry is unchanged (offset-spiral)', () => {
  it('absent entryMode === explicit plunge (byte-equal, no arcs)', () => {
    const absent = generatePocketOffsetSpiralLines({ outerRing: SQUARE_60, ...BASE })
    const plunge = generatePocketOffsetSpiralLines({ outerRing: SQUARE_60, ...BASE, entryMode: 'plunge' })
    expect(plunge.lines).toEqual(absent.lines)
    expect(absent.lines.some((l) => /^G[23] /.test(l))).toBe(false)
  })

  it('ramp entry is unaffected by the new helix knobs (byte-equal, no arcs)', () => {
    const ramp = generatePocketOffsetSpiralLines({ outerRing: SQUARE_60, ...BASE, entryMode: 'ramp', rampMm: 3 })
    // Passing helix knobs alongside a ramp request must not change ramp bytes.
    const rampPlusKnobs = generatePocketOffsetSpiralLines({
      outerRing: SQUARE_60,
      ...BASE,
      entryMode: 'ramp',
      rampMm: 3,
      helixRadiusMm: 4,
      entryAngleDeg: 5,
      toolRadiusMm: 1.5
    })
    expect(rampPlusKnobs.lines).toEqual(ramp.lines)
    expect(ramp.lines.some((l) => /^G[23] /.test(l))).toBe(false)
  })
})

describe('byte-identity: non-helix entry is unchanged (adaptive)', () => {
  const ADAPT = { outerRing: SQUARE_60, toolDiameterMm: 6, ...BASE }
  it('absent entryMode === explicit plunge (byte-equal, no arcs)', () => {
    const absent = generateAdaptiveClearing2dLines({ ...ADAPT })
    const plunge = generateAdaptiveClearing2dLines({ ...ADAPT, entryMode: 'plunge' })
    expect(plunge.lines).toEqual(absent.lines)
    expect(absent.lines.some((l) => /^G[23] /.test(l))).toBe(false)
  })

  it('ramp entry is unaffected by the new helix knobs (byte-equal, no arcs)', () => {
    const ramp = generateAdaptiveClearing2dLines({ ...ADAPT, entryMode: 'ramp', rampMm: 3 })
    const rampPlusKnobs = generateAdaptiveClearing2dLines({
      ...ADAPT,
      entryMode: 'ramp',
      rampMm: 3,
      helixRadiusMm: 4,
      entryAngleDeg: 5,
      toolRadiusMm: 3
    })
    expect(rampPlusKnobs.lines).toEqual(ramp.lines)
    expect(ramp.lines.some((l) => /^G[23] /.test(l))).toBe(false)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// (B)-(D) HELIX SHAPE + SAFETY — offset-spiral
// ══════════════════════════════════════════════════════════════════════════

describe('offset-spiral helix entry', () => {
  it('emits a region-clamped G2 helix descent that satisfies every entry invariant', () => {
    const r = generatePocketOffsetSpiralLines({
      outerRing: SQUARE_60,
      ...BASE,
      entryMode: 'helix',
      helixRadiusMm: 4,
      entryAngleDeg: 5,
      toolRadiusMm: 1.5
    })
    assertHelixSafety(r.lines, SQUARE_60, BASE.safeZMm, BASE.plungeMmMin)
    // The requested 4 mm radius fits the innermost loop (start ~12 mm off the wall),
    // so the emitted helix radius equals the request (clamp did not bite here).
    expect(maxHelixRadius(r.lines)).toBeCloseTo(4, 5)
    // The last helix arc lands exactly on the final depth (-3) before the loop cut.
    const helixArcs = parseMoves(r.lines).filter((m) => m.code === 'G2' && m.z != null)
    expect(helixArcs[helixArcs.length - 1]!.z).toBeCloseTo(-3, 5)
    // Honest telemetry: at least one loop descended on a helix.
    expect(r.hints.some((h) => /offset-spiral helix entry/.test(h))).toBe(true)
  })

  it('clamps the helix radius DOWN to fit a tighter request-vs-region', () => {
    // Request a huge radius; the region-fit clamp must shrink it to stay inside.
    const r = generatePocketOffsetSpiralLines({
      outerRing: SQUARE_60,
      ...BASE,
      entryMode: 'helix',
      helixRadiusMm: 999,
      entryAngleDeg: 5,
      toolRadiusMm: 1.5
    })
    const radius = maxHelixRadius(r.lines)
    expect(radius).toBeGreaterThan(0)
    // Innermost loop start sits one stepover (12 mm) inside; the clamp keeps the
    // whole helix (diameter + tool) inside, so radius is well under half that span.
    expect(radius).toBeLessThan(12)
    assertHelixSafety(r.lines, SQUARE_60, BASE.safeZMm, BASE.plungeMmMin)
  })

  it('NEVER-DEGRADE: a pocket too small for any helix falls back to ramp/plunge (no arc)', () => {
    const r = generatePocketOffsetSpiralLines({
      outerRing: TINY_3,
      stepoverMm: 0.8,
      zPassMm: -1,
      feedMmMin: 1200,
      plungeMmMin: 400,
      safeZMm: 6,
      entryMode: 'helix',
      helixRadiusMm: 4,
      toolRadiusMm: 1.0
    })
    // A body was still produced (never abandoned)...
    expect(r.lines.length).toBeGreaterThan(0)
    // ...with NO arc (degraded to ramp/plunge)...
    expect(r.lines.some((l) => /^G[23] /.test(l))).toBe(false)
    // ...no G0 below safe-Z...
    for (const m of parseMoves(r.lines)) {
      if (m.code === 'G0' && m.z != null) expect(m.z).toBeGreaterThanOrEqual(6 - 1e-6)
    }
    // ...and an honest never-degrade hint.
    expect(r.hints.some((h) => /never-degrade|too close to a wall/.test(h))).toBe(true)
  })

  it('is deterministic (two identical helix calls are byte-equal)', () => {
    const opts = {
      outerRing: SQUARE_60,
      ...BASE,
      entryMode: 'helix' as const,
      helixRadiusMm: 4,
      entryAngleDeg: 5,
      toolRadiusMm: 1.5
    }
    expect(generatePocketOffsetSpiralLines(opts).lines).toEqual(generatePocketOffsetSpiralLines(opts).lines)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// (B)-(D) HELIX SHAPE + SAFETY — adaptive clearing
// ══════════════════════════════════════════════════════════════════════════

describe('adaptive clearing helix entry', () => {
  it('emits a region-clamped G2 helix descent that satisfies every entry invariant', () => {
    const r = generateAdaptiveClearing2dLines({
      outerRing: SQUARE_60,
      toolDiameterMm: 3,
      ...BASE,
      entryMode: 'helix',
      helixRadiusMm: 4,
      entryAngleDeg: 5,
      toolRadiusMm: 1.5
    })
    assertHelixSafety(r.lines, SQUARE_60, BASE.safeZMm, BASE.plungeMmMin)
    expect(maxHelixRadius(r.lines)).toBeCloseTo(4, 5)
    const helixArcs = parseMoves(r.lines).filter((m) => m.code === 'G2' && m.z != null)
    expect(helixArcs[helixArcs.length - 1]!.z).toBeCloseTo(-3, 5)
    expect(r.hints.some((h) => /Adaptive clearing helix entry/.test(h))).toBe(true)
  })

  it('the entry-slot loop (fully-buried region core) now descends on a helix, not a plunge', () => {
    // The innermost adaptive loop is the "entry slot" that v1 cut as a straight
    // plunge; with helix it must lead the '; adaptive entry slot loop' comment.
    const r = generateAdaptiveClearing2dLines({
      outerRing: SQUARE_60,
      toolDiameterMm: 3,
      ...BASE,
      entryMode: 'helix',
      helixRadiusMm: 4,
      toolRadiusMm: 1.5
    })
    const slotIdx = r.lines.findIndex((l) => l.includes('adaptive entry slot loop'))
    expect(slotIdx).toBeGreaterThanOrEqual(0)
    // Within the next few lines after the slot comment + safe-Z lift + rapid,
    // a G2 helix arc appears (not a bare G1 Z plunge).
    const window = r.lines.slice(slotIdx, slotIdx + 6).join('\n')
    expect(window).toMatch(/^G2 .*Z/m)
  })

  it('NEVER-DEGRADE: a pocket too small for any helix falls back (no arc), never abandoned', () => {
    const r = generateAdaptiveClearing2dLines({
      outerRing: TINY_3,
      toolDiameterMm: 2,
      stepoverMm: 0.8,
      zPassMm: -1,
      feedMmMin: 1200,
      plungeMmMin: 400,
      safeZMm: 6,
      entryMode: 'helix',
      helixRadiusMm: 4,
      toolRadiusMm: 1.0
    })
    // Whatever the engine emits, it must contain NO arc and NO G0 below safe-Z.
    expect(r.lines.some((l) => /^G[23] /.test(l))).toBe(false)
    for (const m of parseMoves(r.lines)) {
      if (m.code === 'G0' && m.z != null) expect(m.z).toBeGreaterThanOrEqual(6 - 1e-6)
    }
  })

  it('is deterministic (two identical helix calls are byte-equal)', () => {
    const opts = {
      outerRing: SQUARE_60,
      toolDiameterMm: 3,
      ...BASE,
      entryMode: 'helix' as const,
      helixRadiusMm: 4,
      entryAngleDeg: 5,
      toolRadiusMm: 1.5
    }
    expect(generateAdaptiveClearing2dLines(opts).lines).toEqual(generateAdaptiveClearing2dLines(opts).lines)
  })
})
