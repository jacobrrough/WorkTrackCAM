/**
 * Paired-pin contract set for `src/main/cam-axis4/tool-comp.ts` -- pins
 * both the doc-string contract and the runtime behavior of
 * `applyToolRadiusCompensation`, the cylindrical-heightmap max-envelope
 * tool-radius compensator that prevents the rotary tool from gouging
 * adjacent higher features.
 *
 * Roadmap: [ID-0171] (test-coverage, Cycle 83). Cross-cuts:
 *   - Makera Carvera + 4th Axis Rotary -- the only 4-axis target in
 *     CLAUDE.md "USER CONTEXT -- TARGET MACHINES"; the compensator runs
 *     on every cam-axis4 roughing/finishing job and dictates whether the
 *     rotary tool eats stock cleanly or drags through a neighbouring
 *     boss.
 *
 * Pure helper-level unit tests: NO machine profile, NO mesh raycast, NO
 * post-template invocation, NO production-code edits this cycle. Fixtures
 * are direct CylindricalHeightmap literals so the kernel geometry is the
 * only thing under test.
 */
import { describe, expect, it } from 'vitest'
import { applyToolRadiusCompensation } from '../tool-comp'
import { NO_HIT, type CylindricalHeightmap } from '../heightmap'

/**
 * Build a CylindricalHeightmap with all cells set to NO_HIT. Caller may
 * then poke individual hit cells via `setHit`. Keeps fixtures pure --
 * no triangle raycasting in the test path.
 */
function emptyHm(opts: {
  nx: number
  na: number
  dx?: number
  daDeg?: number
  xStart?: number
}): CylindricalHeightmap {
  const dx = opts.dx ?? 1
  const daDeg = opts.daDeg ?? 360 / opts.na
  return {
    radii: new Float32Array(opts.nx * opts.na).fill(NO_HIT),
    nx: opts.nx,
    na: opts.na,
    xStart: opts.xStart ?? 0,
    dx,
    daDeg
  }
}

function setHit(hm: CylindricalHeightmap, ix: number, ia: number, r: number): void {
  hm.radii[ix * hm.na + ia] = r
}

function getCell(arr: Float32Array, na: number, ix: number, ia: number): number {
  return arr[ix * na + ia]!
}

describe('applyToolRadiusCompensation -- shape, type, and NO_HIT preservation', () => {
  it('returns a Float32Array of length nx*na with NO_HIT everywhere when the input has zero hits', () => {
    const hm = emptyHm({ nx: 8, na: 36, dx: 1, daDeg: 10 })
    const out = applyToolRadiusCompensation(hm, /* toolRadius */ 2, /* stockRadius */ 20)

    expect(out).toBeInstanceOf(Float32Array)
    expect(out.length).toBe(hm.nx * hm.na)
    // Every cell stays NO_HIT because no input cell had material in its kernel.
    for (let i = 0; i < out.length; i++) {
      expect(out[i]).toBe(NO_HIT)
    }
  })

  it('preserves NO_HIT in cells whose entire kernel is empty (sparse single-hit fixture)', () => {
    // 41 axial cells, 36 angular cells (10° steps), 1 mm axial step. Place a
    // single hit at the X=0 / A=0 corner. With toolRadius=2 / stockRadius=20,
    // kernelIx=ceil(2/1)=2 (axial reach 2 cells) and angularSpanDeg=
    // (2/20)*(180/pi)~=5.73°, so kernelIa=ceil(5.73/10)=1 (angular reach 1
    // cell). A cell at (ix=10, ia=10) is well outside both reaches and MUST
    // stay NO_HIT.
    const hm = emptyHm({ nx: 41, na: 36, dx: 1, daDeg: 10 })
    setHit(hm, 0, 0, 9.5)
    const out = applyToolRadiusCompensation(hm, 2, 20)

    expect(getCell(out, hm.na, 10, 10)).toBe(NO_HIT)
    // And the hit cell itself receives the max-envelope value.
    expect(getCell(out, hm.na, 0, 0)).toBeCloseTo(9.5, 6)
  })
})

describe('applyToolRadiusCompensation -- max-envelope semantics (the core contract)', () => {
  it('compensated[ix*na+ia] >= radii[ix*na+ia] at every cell where radii[ix*na+ia] > 0', () => {
    // Sprinkle a varied terrain of hits so multiple cells participate and
    // the max-of-kernel picks up neighbours, not just self.
    const hm = emptyHm({ nx: 12, na: 36, dx: 1, daDeg: 10 })
    setHit(hm, 5, 5, 7.0)
    setHit(hm, 5, 6, 8.5)
    setHit(hm, 6, 6, 6.2)
    setHit(hm, 7, 7, 9.1)
    setHit(hm, 11, 35, 4.0)
    const out = applyToolRadiusCompensation(hm, 1.5, 20)

    for (let ix = 0; ix < hm.nx; ix++) {
      for (let ia = 0; ia < hm.na; ia++) {
        const raw = hm.radii[ix * hm.na + ia]!
        if (raw > 0) {
          expect(getCell(out, hm.na, ix, ia)).toBeGreaterThanOrEqual(raw)
        }
      }
    }
  })

  it('the compensated value at a hit cell equals the maximum hit within the kernel footprint', () => {
    // Two adjacent angular hits: a 6.0 at (5, 10) and a TALLER 9.0 at
    // (5, 11). To make sure the angular neighbour actually survives the
    // inner-loop circular gate distX^2 + distA^2 <= toolR^2, the
    // arcMmPerCell at the chosen stockRadius MUST be smaller than
    // toolRadius. Choose toolRadius=2 / stockRadius=2 / daDeg=10:
    //   kernelIx = ceil(2/1) = 2
    //   angularSpanDeg = (2/2)*(180/pi) ~= 57.3°, kernelIa = ceil(57.3/10) = 6
    //   arcMmPerCell = 10*(pi/180)*2 ~= 0.349 mm
    //   At dia=1, distA^2 = 0.122 < toolR^2=4 -- PASSES. So (5, 10)'s
    //   kernel sees (5, 11) and the compensated value is lifted from
    //   6.0 to 9.0.
    const hm = emptyHm({ nx: 11, na: 36, dx: 1, daDeg: 10 })
    setHit(hm, 5, 10, 6.0)
    setHit(hm, 5, 11, 9.0)
    const out = applyToolRadiusCompensation(hm, 2, 2)

    expect(getCell(out, hm.na, 5, 10)).toBeCloseTo(9.0, 6)
    expect(getCell(out, hm.na, 5, 11)).toBeCloseTo(9.0, 6)
  })
})

describe('applyToolRadiusCompensation -- kernel size scales with toolRadius/dx and toolRadius/(daDeg*stockRadius)', () => {
  it('axial kernel size scales with toolRadius / dx -- a larger tool extends compensation farther in X', () => {
    // Single hit at ix=10. With toolRadius=2 / dx=1, kernelIx=ceil(2/1)=2,
    // so the hit reaches ix=8 / 9 / 10 / 11 / 12 (axial). With toolRadius=
    // 5, kernelIx=ceil(5/1)=5, so the hit reaches ix=5..15. The angular
    // kernel is held to a 1-cell reach by setting daDeg=10 and choosing
    // stockRadius large enough that angularSpanDeg < daDeg (so kernelIa
    // is clamped to its floor of 1).
    const hm = emptyHm({ nx: 21, na: 36, dx: 1, daDeg: 10 })
    setHit(hm, 10, 0, 5.0)

    const small = applyToolRadiusCompensation(hm, 2, 200)
    const big = applyToolRadiusCompensation(hm, 5, 200)

    // Small tool: ix=8 reached, ix=7 NOT reached.
    expect(getCell(small, hm.na, 8, 0)).toBeCloseTo(5.0, 6)
    expect(getCell(small, hm.na, 7, 0)).toBe(NO_HIT)
    // Big tool: ix=5 reached, ix=4 NOT reached.
    expect(getCell(big, hm.na, 5, 0)).toBeCloseTo(5.0, 6)
    expect(getCell(big, hm.na, 4, 0)).toBe(NO_HIT)
  })

  it('angular kernel size scales with toolRadius / (daDeg * stockRadius) -- smaller stockRadius means larger angular kernel', () => {
    // Single hit at ia=18. Hold the axial kernel at minimum (kernelIx=1)
    // by setting toolRadius=0.5 and dx=1 -- ceil(0.5/1)=1, so axial reach
    // is one cell. Then vary stockRadius so the angular kernel changes:
    //   stockRadius=200 -> angularSpanDeg=(0.5/200)*(180/pi)~=0.143°,
    //                       kernelIa=ceil(0.143/10)=1 (one cell).
    //   stockRadius=2   -> angularSpanDeg=(0.5/2)*(180/pi)~=14.3°,
    //                       kernelIa=ceil(14.3/10)=2 (two cells).
    // With kernelIa=1, ia=16 is NOT reached. With kernelIa=2, ia=16 IS
    // reached (the 2-cell ring still passes the toolR^2 circular gate at
    // dia=2 since (2*arcMmPerCell)^2 = (2*0.349)^2~=0.488 < 0.25 when
    // stockRadius=2 ... wait let's recompute carefully and pick a cell
    // that survives the circular gate).
    //
    // arcMmPerCell = daDeg * (pi/180) * stockRadius
    //   stockRadius=2 -> arcMmPerCell = 10*(pi/180)*2 ~= 0.349 mm.
    //   At dia=2, distA = 0.698 mm. distA^2 = 0.488. toolR^2=0.25.
    //   distA^2 > toolR^2, so dia=2 FAILS the circular gate.
    //   At dia=1, distA = 0.349 mm. distA^2 = 0.122 < 0.25 -> passes.
    // So the angular kernel for stockRadius=2 / toolRadius=0.5 still only
    // reaches dia=+/-1 in practice (kernelIa=2 expands the loop bounds but
    // the circular gate inside the loop still rejects dia=2).
    //
    // To make the angular reach genuinely differ, scale toolRadius up
    // while keeping the axial floor minimal via large dx. Use:
    //   dx = 100 (very wide axial cells, kernelIx=1 always since toolRadius
    //             stays < dx in both cases)
    //   stockRadius=200, toolRadius=2: angularSpanDeg ~= 0.573°, kernelIa=
    //     ceil(0.573/10)=1. arcMmPerCell=10*(pi/180)*200~=34.9 mm.
    //     At dia=1, distA=34.9 mm, distA^2=1218, toolR^2=4 -> FAILS, so
    //     no neighbour cells -- only self pixel survives. ia=17 NOT
    //     reached.
    //   stockRadius=1, toolRadius=2: angularSpanDeg=(2/1)*(180/pi)~=
    //     114.6°, kernelIa=ceil(114.6/10)=12. arcMmPerCell=10*(pi/180)*1
    //     ~=0.1745 mm. At dia=1, distA=0.1745, distA^2=0.0305 < 4
    //     -> PASSES. ia=17 IS reached.
    //
    // This is the cleanest demonstration: the kernel-size formula is
    // sensitive to BOTH toolRadius and stockRadius.
    const hm = emptyHm({ nx: 3, na: 36, dx: 100, daDeg: 10 })
    setHit(hm, 1, 18, 0.6)

    const bigStock = applyToolRadiusCompensation(hm, 2, 200)
    const smallStock = applyToolRadiusCompensation(hm, 2, 1)

    // Big stock radius: angular kernel collapses, only ia=18 lights up.
    expect(getCell(bigStock, hm.na, 1, 18)).toBeCloseTo(0.6, 6)
    expect(getCell(bigStock, hm.na, 1, 17)).toBe(NO_HIT)
    expect(getCell(bigStock, hm.na, 1, 19)).toBe(NO_HIT)
    // Small stock radius: angular kernel reaches neighbours, both ia=17
    // and ia=19 receive the max-envelope value.
    expect(getCell(smallStock, hm.na, 1, 17)).toBeCloseTo(0.6, 6)
    expect(getCell(smallStock, hm.na, 1, 19)).toBeCloseTo(0.6, 6)
  })

  it('angular index wraps modulo na (rotational continuity at ia=0 and ia=na-1)', () => {
    // Hit at ia=0. With a generous angular kernel, the compensation must
    // wrap around to ia=na-1 (and to ia=1) -- the rotary axis is
    // continuous, not bounded.
    const hm = emptyHm({ nx: 3, na: 36, dx: 100, daDeg: 10 })
    setHit(hm, 1, 0, 4.5)

    // Same parameters as the small-stock case above: kernelIa is large
    // enough that dia=+/-1 survives the circular gate.
    const out = applyToolRadiusCompensation(hm, 2, 1)

    expect(getCell(out, hm.na, 1, 0)).toBeCloseTo(4.5, 6)
    expect(getCell(out, hm.na, 1, 1)).toBeCloseTo(4.5, 6) // forward neighbour
    expect(getCell(out, hm.na, 1, hm.na - 1)).toBeCloseTo(4.5, 6) // wrap-around back neighbour
  })
})

describe('applyToolRadiusCompensation -- single-peak fixture footprint', () => {
  it('a single-peak hit produces a circular-ish footprint with the expected axial reach (toolRadius / dx)', () => {
    // Single peak at the centre of an axial-only fixture (collapse the
    // angular dimension to na=1 / daDeg=360 so the angular geometry is
    // trivial -- the inner loop runs over dia=0 only). The resulting
    // 1-D footprint should reach exactly +/- ceil(toolRadius / dx) cells
    // and no farther, with all reached cells lifted to the peak value.
    //
    // With na=1 the angular kernel is irrelevant (kernelIa=1 by floor,
    // but the dia=+/-1 wrap returns to the same cell -- the inner loop's
    // circular-gate dia*arcMmPerCell^2 with arcMmPerCell~=very-large
    // means non-zero dia rejects anyway). What matters is the axial
    // reach.
    const hm = emptyHm({ nx: 21, na: 1, dx: 1, daDeg: 360 })
    setHit(hm, 10, 0, 7.5)

    const out = applyToolRadiusCompensation(hm, 3, 20)

    // ceil(3/1)=3, so cells ix=7..13 light up; ix=6 and ix=14 stay NO_HIT.
    for (let ix = 7; ix <= 13; ix++) {
      expect(getCell(out, hm.na, ix, 0)).toBeCloseTo(7.5, 6)
    }
    expect(getCell(out, hm.na, 6, 0)).toBe(NO_HIT)
    expect(getCell(out, hm.na, 14, 0)).toBe(NO_HIT)
    // Sanity: total number of lit cells matches the closed-form
    // 2*kernelIx + 1 = 7.
    let lit = 0
    for (let ix = 0; ix < hm.nx; ix++) {
      if (out[ix * hm.na + 0]! > 0) lit++
    }
    expect(lit).toBe(7)
  })
})
