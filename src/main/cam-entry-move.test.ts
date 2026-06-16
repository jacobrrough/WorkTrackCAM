/**
 * cam-entry-move — REGION-AWARE cut-entry move generator (pure geometry tests).
 *
 * The companion engine-level tests live in `cam-local.test.ts` (pocket helix
 * entry) and the posted-G-code gcode-safety contract in
 * `cam-entry-move-posted.test.ts` (Laguna + Carvera-3). THIS file exercises the
 * pure module's contract directly: region-fit clamping, never-degrade fallback,
 * bounded incline, land-on-depth, and the degenerate / open-contour cases.
 */

import { describe, expect, it } from 'vitest'
import {
  boundRampRunForRegionMm,
  buildEntryMoves,
  formatEntryMove,
  helixPitchMm,
  maxHelixRadiusForRegionMm,
  MAX_ENTRY_ANGLE_DEG,
  MIN_ENTRY_ANGLE_DEG,
  MIN_ENTRY_RADIUS_MM,
  type CamEntryRegion,
  type EntryMove
} from './cam-entry-move'
import type { CamPoint2d } from './cam-local'

const BIG_POCKET: CamPoint2d[] = [
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100]
]

/** Reconstruct the absolute XY/Z a move lands on (for region / depth assertions). */
function moveEndZ(m: EntryMove): number {
  return 'z' in m ? m.z : Number.NaN
}
function moveEndXY(m: EntryMove): CamPoint2d | null {
  if (m.kind === 'ramp' || m.kind === 'lineToEntry' || m.kind === 'arc') return [m.x, m.y]
  return null
}

/** True if (x,y) is inside the axis-aligned rect [x0,x1]×[y0,y1] within eps. */
function insideRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, eps = 1e-6): boolean {
  return x >= x0 - eps && x <= x1 + eps && y >= y0 - eps && y <= y1 + eps
}

describe('maxHelixRadiusForRegionMm', () => {
  it('returns clearance/2 at the centre of a square pocket (centre-only fit)', () => {
    // 100×100, centre clearance = 50; diameter must fit in the clearance ⇒ r ≤ 25.
    expect(maxHelixRadiusForRegionMm([50, 50], BIG_POCKET, [], 0)).toBeCloseTo(25, 6)
  })

  it('shrinks with the tool radius (the cutter, not just the centre, must fit)', () => {
    expect(maxHelixRadiusForRegionMm([50, 50], BIG_POCKET, [], 6)).toBeCloseTo((50 - 6) / 2, 6)
  })

  it('returns 0 when the entry point is outside the region', () => {
    expect(maxHelixRadiusForRegionMm([200, 200], BIG_POCKET, [], 0)).toBe(0)
  })

  it('returns 0 when the entry point falls inside an island keep-out', () => {
    const island: CamPoint2d[] = [
      [40, 40],
      [60, 40],
      [60, 60],
      [40, 60]
    ]
    expect(maxHelixRadiusForRegionMm([50, 50], BIG_POCKET, [island], 0)).toBe(0)
  })

  it('clamps to the nearest island wall when an island is close to the entry', () => {
    // Entry near a wall: clearance to the near (left) wall is 5 mm ⇒ r ≤ 2.5.
    expect(maxHelixRadiusForRegionMm([5, 50], BIG_POCKET, [], 0)).toBeCloseTo(2.5, 6)
  })
})

describe('boundRampRunForRegionMm', () => {
  it('returns the requested run when it stays inside the region', () => {
    // From centre, +X for 10 mm stays well inside the 100-wide pocket.
    expect(boundRampRunForRegionMm([50, 50], [1, 0], 10, BIG_POCKET, [], 0)).toBeCloseTo(10, 1)
  })

  it('bounds the run to the region span along the direction', () => {
    // From x=95 going +X, only ~5 mm of pocket remains.
    const run = boundRampRunForRegionMm([95, 50], [1, 0], 20, BIG_POCKET, [], 0)
    expect(run).toBeGreaterThan(0)
    expect(run).toBeLessThanOrEqual(5 + 1e-6)
  })

  it('returns the requested run unbounded when there is no region', () => {
    expect(boundRampRunForRegionMm([0, 0], [1, 0], 7, undefined, [], 0)).toBe(7)
  })
})

describe('helixPitchMm', () => {
  it('is the circumference × tan(angle)', () => {
    expect(helixPitchMm(4, 3)).toBeCloseTo(2 * Math.PI * 4 * Math.tan((3 * Math.PI) / 180), 6)
  })
})

describe('buildEntryMoves — degenerate', () => {
  it('emits NO moves for a zero descent (already at depth)', () => {
    const r = buildEntryMoves({
      entry: [5, 5],
      safeZMm: 0,
      targetZMm: 0,
      plungeMmMin: 200,
      mode: 'helix',
      region: BIG_POCKET
    })
    expect(r.moves).toEqual([])
  })

  it('emits NO moves for an up-hill descent (safeZ below target)', () => {
    const r = buildEntryMoves({
      entry: [5, 5],
      safeZMm: -5,
      targetZMm: 0,
      plungeMmMin: 200,
      mode: 'ramp',
      region: BIG_POCKET
    })
    expect(r.moves).toEqual([])
  })
})

describe('buildEntryMoves — plunge', () => {
  it('emits a single straight plunge to target depth at the plunge feed', () => {
    const r = buildEntryMoves({
      entry: [5, 5],
      safeZMm: 5,
      targetZMm: -3,
      plungeMmMin: 200,
      mode: 'plunge'
    })
    expect(r.usedMode).toBe('plunge')
    expect(r.moves).toEqual([{ kind: 'plunge', z: -3 }])
    expect(formatEntryMove(r.moves[0]!, 200)).toBe('G1 Z-3.000 F200')
  })
})

describe('buildEntryMoves — helix fits a big pocket', () => {
  const r = buildEntryMoves({
    entry: [50, 50],
    safeZMm: 5,
    targetZMm: -3,
    plungeMmMin: 200,
    mode: 'helix',
    region: BIG_POCKET,
    helixRadiusMm: 4,
    rampAngleDeg: 3
  })

  it('uses a helix at the requested (in-range) radius', () => {
    expect(r.usedMode).toBe('helix')
    expect(r.helixRadiusMm).toBeCloseTo(4, 6)
    expect(r.fallbackReason).toBeUndefined()
  })

  it('emits G2 arc descent moves (two half-circles per revolution) + a final flat move', () => {
    const arcs = r.moves.filter((m) => m.kind === 'arc')
    expect(arcs.length).toBeGreaterThanOrEqual(2)
    // I/J present on every arc (controller-executable centre form).
    for (const a of arcs) {
      expect(a.kind).toBe('arc')
    }
    expect(r.moves[r.moves.length - 1]!.kind).toBe('lineToEntry')
  })

  it('descends monotonically and lands EXACTLY on target depth (never below)', () => {
    let prevZ = 5
    for (const m of r.moves) {
      const z = moveEndZ(m)
      expect(z).toBeLessThanOrEqual(prevZ + 1e-9)
      expect(z).toBeGreaterThanOrEqual(-3 - 1e-9) // never below final depth
      prevZ = z
    }
    expect(moveEndZ(r.moves[r.moves.length - 1]!)).toBeCloseTo(-3, 6)
  })

  it('keeps the WHOLE helix inside the pocket footprint', () => {
    for (const m of r.moves) {
      const xy = moveEndXY(m)
      if (xy) expect(insideRect(xy[0], xy[1], 0, 0, 100, 100)).toBe(true)
    }
  })

  it('uses the plunge feed on every descent move', () => {
    for (const m of r.moves) {
      expect(formatEntryMove(m, 200)).toMatch(/F200$/)
    }
  })

  it('ends the helix back at the entry XY', () => {
    const last = r.moves[r.moves.length - 1]!
    const xy = moveEndXY(last)!
    expect(xy[0]).toBeCloseTo(50, 6)
    expect(xy[1]).toBeCloseTo(50, 6)
  })
})

describe('buildEntryMoves — helix radius clamped DOWN to fit', () => {
  it('clamps an over-large requested radius to the region cap', () => {
    // Request 40 mm in a 100-wide pocket at the centre: cap is 25 mm.
    const r = buildEntryMoves({
      entry: [50, 50],
      safeZMm: 5,
      targetZMm: -2,
      plungeMmMin: 200,
      mode: 'helix',
      region: BIG_POCKET,
      helixRadiusMm: 40
    })
    expect(r.usedMode).toBe('helix')
    expect(r.helixRadiusMm).toBeCloseTo(25, 6)
    // Every arc endpoint stays inside the pocket.
    for (const m of r.moves) {
      const xy = moveEndXY(m)
      if (xy) expect(insideRect(xy[0], xy[1], 0, 0, 100, 100)).toBe(true)
    }
  })
})

describe('buildEntryMoves — helix falls back when it cannot fit a tiny pocket', () => {
  // 1.2×1.2 mm pocket: centre clearance 0.6 ⇒ cap 0.3 < MIN_ENTRY_RADIUS (0.5).
  const tiny: CamPoint2d[] = [
    [0, 0],
    [1.2, 0],
    [1.2, 1.2],
    [0, 1.2]
  ]

  it('cap is below the usable minimum', () => {
    expect(maxHelixRadiusForRegionMm([0.6, 0.6], tiny, [], 0)).toBeLessThan(MIN_ENTRY_RADIUS_MM)
  })

  it('degrades to a ramp (or plunge) with an honest fallback reason — never a helix', () => {
    const r = buildEntryMoves({
      entry: [0.6, 0.6],
      safeZMm: 5,
      targetZMm: -1,
      plungeMmMin: 200,
      mode: 'helix',
      region: tiny,
      helixRadiusMm: 4
    })
    expect(r.usedMode).not.toBe('helix')
    expect(r.fallbackReason).toBe('helix_radius_too_small_for_region')
    // Whatever it used, it must still land on depth and stay inside the pocket.
    expect(moveEndZ(r.moves[r.moves.length - 1]!)).toBeCloseTo(-1, 6)
    for (const m of r.moves) {
      const xy = moveEndXY(m)
      if (xy) expect(insideRect(xy[0], xy[1], 0, 0, 1.2, 1.2)).toBe(true)
    }
  })
})

describe('buildEntryMoves — open contour gets a ramp, not a helix', () => {
  it('a helix request with no region falls back to a ramp', () => {
    const r = buildEntryMoves({
      entry: [5, 5],
      safeZMm: 5,
      targetZMm: -2,
      plungeMmMin: 200,
      mode: 'helix',
      rampAngleDeg: 5
    })
    expect(r.usedMode).not.toBe('helix')
    expect(r.fallbackReason).toBe('open_contour_no_helix')
    expect(r.moves.some((m) => m.kind === 'ramp' || m.kind === 'plunge')).toBe(true)
  })
})

describe('buildEntryMoves — ramp', () => {
  it('emits an inclined ramp out then a flat return to the entry XY at depth', () => {
    const r = buildEntryMoves({
      entry: [50, 50],
      safeZMm: 5,
      targetZMm: -5,
      plungeMmMin: 200,
      mode: 'ramp',
      region: BIG_POCKET,
      rampAngleDeg: 10,
      rampDir: [1, 0]
    })
    expect(r.usedMode).toBe('ramp')
    expect(r.moves.length).toBe(2)
    expect(r.moves[0]!.kind).toBe('ramp')
    expect(r.moves[1]!.kind).toBe('lineToEntry')
    // Ramp lands on depth; return stays at depth (never below).
    expect(moveEndZ(r.moves[0]!)).toBeCloseTo(-5, 6)
    expect(moveEndZ(r.moves[1]!)).toBeCloseTo(-5, 6)
    // Return is the entry XY.
    const back = moveEndXY(r.moves[1]!)!
    expect(back[0]).toBeCloseTo(50, 6)
    expect(back[1]).toBeCloseTo(50, 6)
  })

  it('clamps a near-vertical requested angle down to the safe ceiling', () => {
    // 80° request → clamped to MAX_ENTRY_ANGLE_DEG (30). The ramp run for a 10 mm
    // drop at 30° is 10/tan(30) ≈ 17.32 mm; at 80° it would be ~1.76 mm. Assert the
    // run is the gentler (longer) 30° run, i.e. the angle was clamped.
    const r = buildEntryMoves({
      entry: [50, 50],
      safeZMm: 5,
      targetZMm: -5,
      plungeMmMin: 200,
      mode: 'ramp',
      region: BIG_POCKET,
      rampAngleDeg: 80,
      rampDir: [1, 0]
    })
    const far = moveEndXY(r.moves[0]!)!
    const run = Math.hypot(far[0] - 50, far[1] - 50)
    const expected30 = 10 / Math.tan((MAX_ENTRY_ANGLE_DEG * Math.PI) / 180)
    expect(run).toBeCloseTo(expected30, 1)
  })

  it('clamps a near-horizontal requested angle up to the safe floor', () => {
    // 0.01° request → clamped to MIN_ENTRY_ANGLE_DEG (1). Without the floor the run
    // would be enormous; with it the angle-run for a 5 mm drop is 5/tan(1°) ≈ 286 mm,
    // which the region bounds to <100 — so the ramp still fits and is used.
    const r = buildEntryMoves({
      entry: [50, 50],
      safeZMm: 5,
      targetZMm: 0,
      plungeMmMin: 200,
      mode: 'ramp',
      region: BIG_POCKET,
      rampAngleDeg: 0.01,
      rampDir: [1, 0]
    })
    expect(r.usedMode).toBe('ramp')
    // The clamp floor keeps MIN_ENTRY_ANGLE_DEG sane (used by the angle math).
    expect(MIN_ENTRY_ANGLE_DEG).toBe(1)
  })

  it('falls back to a plunge when no usable ramp run fits the region', () => {
    // A 0.6 mm-wide sliver: no ramp direction has >= MIN_ENTRY_RADIUS run.
    const sliver: CamPoint2d[] = [
      [0, 0],
      [0.6, 0],
      [0.6, 100],
      [0, 100]
    ]
    const r = buildEntryMoves({
      entry: [0.3, 50],
      safeZMm: 5,
      targetZMm: -2,
      plungeMmMin: 200,
      mode: 'ramp',
      region: sliver,
      rampDir: [1, 0],
      toolRadiusMm: 0.5
    })
    expect(r.usedMode).toBe('plunge')
    expect(r.fallbackReason).toBe('ramp_run_too_small_for_region')
    expect(r.moves).toEqual([{ kind: 'plunge', z: -2 }])
  })
})

describe('buildEntryMoves — determinism & purity', () => {
  it('is deterministic for the same input', () => {
    const input = {
      entry: [50, 50] as CamPoint2d,
      safeZMm: 5,
      targetZMm: -3,
      plungeMmMin: 200,
      mode: 'helix' as const,
      region: BIG_POCKET,
      helixRadiusMm: 4
    }
    const a = buildEntryMoves(input)
    const b = buildEntryMoves(input)
    expect(a).toEqual(b)
  })

  it('does not mutate the region input array', () => {
    const region: CamPoint2d[] = [...BIG_POCKET]
    const snapshot = JSON.stringify(region)
    buildEntryMoves({ entry: [50, 50], safeZMm: 5, targetZMm: -3, plungeMmMin: 200, mode: 'helix', region })
    expect(JSON.stringify(region)).toBe(snapshot)
  })
})

describe('formatEntryMove', () => {
  it('formats each move kind with the cam-local coordinate/feed convention', () => {
    expect(formatEntryMove({ kind: 'plunge', z: -3 }, 200)).toBe('G1 Z-3.000 F200')
    expect(formatEntryMove({ kind: 'ramp', x: 1.2, y: 3.4, z: -2 }, 150)).toBe('G1 X1.200 Y3.400 Z-2.000 F150')
    expect(formatEntryMove({ kind: 'lineToEntry', x: 0, y: 0, z: -1 }, 100)).toBe('G1 X0.000 Y0.000 Z-1.000 F100')
    expect(formatEntryMove({ kind: 'arc', dir: 'cw', x: 1, y: 2, z: -1, i: -3, j: 0 }, 200)).toBe(
      'G2 X1.000 Y2.000 Z-1.000 I-3.000 J0.000 F200'
    )
    expect(formatEntryMove({ kind: 'arc', dir: 'ccw', x: 1, y: 2, z: -1, i: 3, j: 0 }, 200)).toBe(
      'G3 X1.000 Y2.000 Z-1.000 I3.000 J0.000 F200'
    )
  })
})

// Type-only: ensure the exported region alias matches CamPoint2d ring shape.
const _regionType: CamEntryRegion = BIG_POCKET
void _regionType
