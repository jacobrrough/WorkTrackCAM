/**
 * FG-5b · Pure op-builder + parse-helper tests.
 *
 * The single most important contract this whole feature carries: a dialog must
 * NEVER emit a kernel op that the schema would reject, because that op gets
 * persisted into `part/features.json` `kernelOps[]` and replayed by a Build STEP
 * (CLAUDE.md Safety Rule 1 — bad kernel/G-code ruins parts). So every builder's
 * output is round-tripped through the REAL `kernelPostSolidOpSchema` here.
 *
 * These are pure functions (no React, no DOM), so they run in the existing
 * `node` vitest env with zero rendering.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildFilletOp } from '../FilletDialog'
import { buildChamferOp } from '../ChamferDialog'
import { buildShellOp } from '../ShellDialog'
import { buildHoleOp } from '../HoleDialog'
import {
  EDGE_DIRECTION_OPTIONS,
  parseClampedInt,
  parseFiniteMm,
  parsePositiveMm
} from '../feature-dialog-types'

describe('FG-5b op builders emit schema-valid kernel ops', () => {
  describe('buildFilletOp', () => {
    it('builds fillet_all when mode is "all" (ignores the direction)', () => {
      const op = buildFilletOp(2.5, 'all', '+Z')
      expect(op).toEqual({ kind: 'fillet_all', radiusMm: 2.5 })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('builds fillet_select carrying the axis bucket when mode is "select"', () => {
      for (const dir of EDGE_DIRECTION_OPTIONS) {
        const op = buildFilletOp(1, 'select', dir)
        expect(op).toEqual({ kind: 'fillet_select', radiusMm: 1, edgeDirection: dir })
        expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
      }
    })
  })

  describe('buildChamferOp', () => {
    it('builds chamfer_all when mode is "all"', () => {
      const op = buildChamferOp(1.2, 'all', '-X')
      expect(op).toEqual({ kind: 'chamfer_all', lengthMm: 1.2 })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('builds chamfer_select with the axis bucket when mode is "select"', () => {
      const op = buildChamferOp(0.8, 'select', '+Y')
      expect(op).toEqual({ kind: 'chamfer_select', lengthMm: 0.8, edgeDirection: '+Y' })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })
  })

  describe('buildShellOp', () => {
    it('builds shell_inward with thickness + open direction', () => {
      const op = buildShellOp(2, '+Z')
      expect(op).toEqual({ kind: 'shell_inward', thicknessMm: 2, openDirection: '+Z' })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('accepts every axis bucket as the open direction', () => {
      for (const dir of EDGE_DIRECTION_OPTIONS) {
        const op = buildShellOp(1.5, dir)
        expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
      }
    })
  })

  describe('buildHoleOp', () => {
    it('builds a through-all hole WITHOUT a depthMm field', () => {
      const op = buildHoleOp(0, 'through_all', 10, 0)
      expect(op).toEqual({
        kind: 'hole_from_profile',
        profileIndex: 0,
        mode: 'through_all',
        zStartMm: 0
      })
      // The schema's refine only requires depthMm for depth mode; through-all
      // must NOT carry it (keeps the persisted op canonical).
      expect(op).not.toHaveProperty('depthMm')
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('builds a depth hole WITH a positive depthMm field', () => {
      const op = buildHoleOp(3, 'depth', 12, 1)
      expect(op).toEqual({
        kind: 'hole_from_profile',
        profileIndex: 3,
        mode: 'depth',
        depthMm: 12,
        zStartMm: 1
      })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })
  })
})

describe('FG-5b parse helpers', () => {
  describe('parsePositiveMm', () => {
    it('parses a positive number', () => {
      expect(parsePositiveMm('2.5')).toBe(2.5)
    })
    it('rejects empty / zero / negative / NaN', () => {
      expect(parsePositiveMm('')).toBeNull()
      expect(parsePositiveMm('   ')).toBeNull()
      expect(parsePositiveMm('0')).toBeNull()
      expect(parsePositiveMm('-3')).toBeNull()
      expect(parsePositiveMm('abc')).toBeNull()
    })
  })

  describe('parseFiniteMm', () => {
    it('parses any finite signed number, including zero and negatives', () => {
      expect(parseFiniteMm('0')).toBe(0)
      expect(parseFiniteMm('-4.2')).toBe(-4.2)
      expect(parseFiniteMm('7')).toBe(7)
    })
    it('rejects empty / NaN / Infinity', () => {
      expect(parseFiniteMm('')).toBeNull()
      expect(parseFiniteMm('xyz')).toBeNull()
      expect(parseFiniteMm('Infinity')).toBeNull()
    })
  })

  describe('parseClampedInt', () => {
    it('clamps into [min, max]', () => {
      expect(parseClampedInt('5', 0, 255)).toBe(5)
      expect(parseClampedInt('-1', 0, 255)).toBe(0)
      expect(parseClampedInt('999', 0, 255)).toBe(255)
    })
    it('rejects empty / non-numeric', () => {
      expect(parseClampedInt('', 0, 255)).toBeNull()
      expect(parseClampedInt('abc', 0, 255)).toBeNull()
    })
  })
})
