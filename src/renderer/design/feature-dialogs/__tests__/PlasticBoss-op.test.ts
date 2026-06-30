/**
 * Pure op-builder test for the Plastic Boss dialog. The one contract that
 * matters: `buildPlasticBossOp(...)` must NEVER produce a `plastic_boss` op the
 * REAL `kernelPostSolidOpSchema` would reject — the op is persisted into
 * `part/features.json` `kernelOps[]` and replayed by a Build STEP (CLAUDE.md
 * Safety Rule 1). Pure function, no React/DOM → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { bossIsValid, buildPlasticBossOp, clampDraftDeg } from '../PlasticBossDialog'

const solidBoss = {
  centerXMm: 12,
  centerYMm: -3,
  zBaseMm: 0,
  outerRadiusMm: 6,
  heightMm: 10,
  holeRadiusMm: null,
  draftDeg: 1
} as const

describe('buildPlasticBossOp', () => {
  it('builds the exact plastic_boss op for a solid boss (no bore key)', () => {
    const op = buildPlasticBossOp(solidBoss)
    expect(op).toEqual({
      kind: 'plastic_boss',
      centerXMm: 12,
      centerYMm: -3,
      zBaseMm: 0,
      outerRadiusMm: 6,
      heightMm: 10,
      draftDeg: 1
    })
    // A solid boss omits holeRadiusMm entirely (schema `mmPos.optional()`).
    expect(op).not.toHaveProperty('holeRadiusMm')
    // `suppressed` is owned by the timeline, never the dialog.
    expect(op).not.toHaveProperty('suppressed')
  })

  it('includes holeRadiusMm when a concentric bore is requested', () => {
    const op = buildPlasticBossOp({ ...solidBoss, holeRadiusMm: 2.5 })
    expect(op).toEqual({
      kind: 'plastic_boss',
      centerXMm: 12,
      centerYMm: -3,
      zBaseMm: 0,
      outerRadiusMm: 6,
      heightMm: 10,
      holeRadiusMm: 2.5,
      draftDeg: 1
    })
  })

  it('emits an op the real kernelPostSolidOpSchema accepts (solid + bored)', () => {
    const solid = buildPlasticBossOp(solidBoss)
    expect(() => kernelPostSolidOpSchema.parse(solid)).not.toThrow()
    expect(kernelPostSolidOpSchema.parse(solid)).toEqual(solid)

    const bored = buildPlasticBossOp({ ...solidBoss, holeRadiusMm: 3 })
    expect(() => kernelPostSolidOpSchema.parse(bored)).not.toThrow()
    expect(kernelPostSolidOpSchema.parse(bored)).toEqual(bored)
  })

  it('round-trips through the real schema across a range of inputs', () => {
    const cases = [
      { ...solidBoss, outerRadiusMm: 0.5, heightMm: 0.5, draftDeg: 0 },
      { ...solidBoss, holeRadiusMm: 1, draftDeg: 8 },
      { ...solidBoss, centerXMm: -250, centerYMm: 250, zBaseMm: -10, draftDeg: 4.5 }
    ] as const
    for (const c of cases) {
      const op = buildPlasticBossOp(c)
      const parsed = kernelPostSolidOpSchema.parse(op)
      expect(parsed).toEqual(op)
    }
  })

  it('clampDraftDeg pins the angle into the schema [0, 8] band', () => {
    expect(clampDraftDeg(-5)).toBe(0)
    expect(clampDraftDeg(0)).toBe(0)
    expect(clampDraftDeg(3.5)).toBe(3.5)
    expect(clampDraftDeg(8)).toBe(8)
    expect(clampDraftDeg(20)).toBe(8)
  })

  it('the schema rejects an over-range draft the clamp prevents', () => {
    // draftDeg is finite + capped at 8; prove the schema would reject what the
    // dialog's clampDraftDeg gate already prevents from ever being built.
    expect(() =>
      kernelPostSolidOpSchema.parse({ ...buildPlasticBossOp(solidBoss), draftDeg: 12 })
    ).toThrow()
  })

  it('the schema rejects a non-positive outer radius (the dialog gate is real)', () => {
    // outerRadiusMm is mmPos (finite, strictly positive); prove the schema would
    // reject what parsePositiveMm + bossIsValid block before any build call.
    expect(() =>
      kernelPostSolidOpSchema.parse({ ...buildPlasticBossOp(solidBoss), outerRadiusMm: 0 })
    ).toThrow()
  })

  it('bossIsValid mirrors the kernel rule (positive dims; bore strictly inside)', () => {
    expect(bossIsValid(solidBoss)).toBe(true)
    expect(bossIsValid({ ...solidBoss, outerRadiusMm: 0 })).toBe(false)
    expect(bossIsValid({ ...solidBoss, heightMm: -1 })).toBe(false)
    // A bore == outer or > outer is silently dropped by the kernel ⇒ invalid here.
    expect(bossIsValid({ ...solidBoss, holeRadiusMm: solidBoss.outerRadiusMm })).toBe(false)
    expect(bossIsValid({ ...solidBoss, holeRadiusMm: solidBoss.outerRadiusMm + 1 })).toBe(false)
    expect(bossIsValid({ ...solidBoss, holeRadiusMm: 0 })).toBe(false)
    // A valid bore strictly inside the boss passes.
    expect(bossIsValid({ ...solidBoss, holeRadiusMm: 2 })).toBe(true)
  })
})
