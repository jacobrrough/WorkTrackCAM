/**
 * Pure op-builder contract test for the Thread (`thread_wizard`) dialog.
 *
 * The load-bearing invariant (CLAUDE.md Safety Rule 1 — a bad kernel op ruins
 * parts): `buildThreadOp(...)` must NEVER emit an op the REAL
 * `kernelPostSolidOpSchema` would reject, because it is persisted into
 * `part/features.json` `kernelOps[]` and replayed by a Build STEP. So every
 * builder output is round-tripped through the real schema here. Pure functions —
 * no React, no DOM — so this runs in the default `node` vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import {
  buildThreadOp,
  matchThreadPreset,
  THREAD_CLASS_OPTIONS,
  THREAD_DESIGNATION_OPTIONS,
  THREAD_PRESETS,
  THREAD_PRESET_CUSTOM,
  THREAD_STANDARD_OPTIONS,
  THREAD_STARTS_MAX,
  THREAD_STARTS_MIN
} from '../ThreadDialog'

/** Canonical fully-specified builder input. */
const FULL = {
  centerXMm: 2,
  centerYMm: -3,
  majorRadiusMm: 10,
  pitchMm: 1.5,
  lengthMm: 25,
  depthMm: 0.9,
  zStartMm: 4,
  hand: 'left',
  mode: 'cosmetic',
  standard: 'UTS',
  designation: 'UNF',
  class: '2A',
  starts: 2
} as const

describe('buildThreadOp emits a schema-valid thread_wizard op', () => {
  it('maps every field through to the typed op', () => {
    const op = buildThreadOp(FULL)
    expect(op).toEqual({
      kind: 'thread_wizard',
      centerXMm: 2,
      centerYMm: -3,
      majorRadiusMm: 10,
      pitchMm: 1.5,
      lengthMm: 25,
      depthMm: 0.9,
      zStartMm: 4,
      hand: 'left',
      mode: 'cosmetic',
      standard: 'UTS',
      designation: 'UNF',
      class: '2A',
      starts: 2
    })
  })

  it('round-trips through the REAL kernelPostSolidOpSchema', () => {
    const op = buildThreadOp(FULL)
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    // The schema must preserve the op verbatim (no field dropped / coerced).
    expect(kernelPostSolidOpSchema.parse(op)).toEqual(op)
  })

  it('accepts the schema defaults (right-hand modeled ISO/M/6g, 1 start)', () => {
    const op = buildThreadOp({
      centerXMm: 0,
      centerYMm: 0,
      majorRadiusMm: 8,
      pitchMm: 1.25,
      lengthMm: 20,
      depthMm: 0.8,
      zStartMm: 0,
      hand: 'right',
      mode: 'modeled',
      standard: 'ISO',
      designation: 'M',
      class: '6g',
      starts: 1
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('every offered categorical option produces a schema-valid op', () => {
    for (const standard of THREAD_STANDARD_OPTIONS) {
      for (const designation of THREAD_DESIGNATION_OPTIONS) {
        for (const cls of THREAD_CLASS_OPTIONS) {
          const op = buildThreadOp({ ...FULL, standard, designation, class: cls })
          expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
        }
      }
    }
  })

  it('accepts both starts bounds and rejects nothing inside the integer range', () => {
    for (const starts of [THREAD_STARTS_MIN, THREAD_STARTS_MAX]) {
      const op = buildThreadOp({ ...FULL, starts })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    }
  })

  it('accepts both hands and both modes', () => {
    for (const hand of ['right', 'left'] as const) {
      for (const mode of ['modeled', 'cosmetic'] as const) {
        const op = buildThreadOp({ ...FULL, hand, mode })
        expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
      }
    }
  })
})

describe('THREAD_PRESETS + matchThreadPreset', () => {
  it('every preset has positive geometry and builds a schema-valid op', () => {
    for (const p of THREAD_PRESETS) {
      expect(p.majorRadiusMm).toBeGreaterThan(0)
      expect(p.pitchMm).toBeGreaterThan(0)
      expect(p.depthMm).toBeGreaterThan(0)
      const op = buildThreadOp({
        ...FULL,
        majorRadiusMm: p.majorRadiusMm,
        pitchMm: p.pitchMm,
        depthMm: p.depthMm,
        standard: p.standard,
        designation: p.designation,
        class: p.class
      })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    }
  })

  it('carries the canonical standard sizes', () => {
    const m6 = THREAD_PRESETS.find((p) => p.id === 'm6')
    expect(m6).toMatchObject({ majorRadiusMm: 3, pitchMm: 1, standard: 'ISO', designation: 'M' })
    const quarter20 = THREAD_PRESETS.find((p) => p.label.startsWith('1/4"-20'))
    expect(quarter20).toMatchObject({ majorRadiusMm: 3.175, pitchMm: 1.27, designation: 'UNC' })
  })

  it('matchThreadPreset round-trips each preset and falls back to Custom', () => {
    for (const p of THREAD_PRESETS) {
      expect(matchThreadPreset(p.majorRadiusMm, p.pitchMm)).toBe(p.id)
    }
    expect(matchThreadPreset(999, 999)).toBe(THREAD_PRESET_CUSTOM)
    expect(matchThreadPreset(null, 1)).toBe(THREAD_PRESET_CUSTOM)
    expect(matchThreadPreset(8, 1.25)).toBe(THREAD_PRESET_CUSTOM) // r8+p1.25 is no standard size
  })
})
