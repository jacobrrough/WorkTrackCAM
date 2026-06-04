/**
 * Pure-mapping tests for the assembly mate-creation form.
 *
 * Two contracts, both required by the V1 mate-creation task:
 *   (A) form draft → `cad.add_assembly_mate` request (`buildAddMateRequest`):
 *       the Model-B 3-vector envelope, per-kind field selection, and the
 *       precise field-pointer on every malformed input.
 *   (B) IPC outcome → solver badge (`mateOutcomeToBadge` + `narrowAddMateResponse`):
 *       solved (with bbox extent), over-constrained (`mate_solve_failed`), and
 *       generic structured errors — all mapped onto the
 *       `design-assembly__solver-badge` wording family.
 *
 * Pure node-env suite: no React, no DOM, no bridge. Plain objects exercise
 * every branch, mirroring `sketch-solve-status.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import {
  buildAddMateRequest,
  bboxExtentSummary,
  makeMateFormDraft,
  mateOutcomeToBadge,
  narrowAddMateResponse,
  EMPTY_VECTOR,
  IDLE_MATE_BADGE,
  SOLVING_MATE_BADGE,
  type MateFormDraft,
} from './assembly-mate-form'

const HANDLE = 'asm:abc123'

// ── (A) form → request mapping ───────────────────────────────────────────────

describe('makeMateFormDraft', () => {
  it('seeds a point-mate draft with the two part ids', () => {
    const d = makeMateFormDraft('p1', 'p2')
    expect(d.kind).toBe('point')
    expect(d.part1Id).toBe('p1')
    expect(d.part2Id).toBe('p2')
  })

  it('defaults axis/normal vectors to the +Z unit (never zero-length)', () => {
    const d = makeMateFormDraft('p1', 'p2')
    expect(d.axis1).toEqual(['0', '0', '1'])
    expect(d.axis2).toEqual(['0', '0', '1'])
    expect(d.normal1).toEqual(['0', '0', '1'])
    expect(d.normal2).toEqual(['0', '0', '1'])
  })

  it('exports a blank EMPTY_VECTOR triple', () => {
    expect(EMPTY_VECTOR).toEqual(['', '', ''])
  })
})

describe('buildAddMateRequest — point mate', () => {
  const base: MateFormDraft = {
    ...makeMateFormDraft('p1', 'p2'),
    kind: 'point',
    point1: ['1', '2', '3'],
    point2: ['4', '5', '6'],
  }

  it('maps a valid point draft onto the { handle, mate } wire envelope', () => {
    const r = buildAddMateRequest(HANDLE, base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.handle).toBe(HANDLE)
    expect(r.request.mate).toEqual({
      kind: 'point',
      part1Id: 'p1',
      point1: [1, 2, 3],
      part2Id: 'p2',
      point2: [4, 5, 6],
    })
  })

  it('parses numeric strings (including negatives + decimals) into finite numbers', () => {
    const r = buildAddMateRequest(HANDLE, {
      ...base,
      point1: ['-1.5', '0', '2.25'],
      point2: ['10', '-3', '0'],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.mate.kind).toBe('point')
    if (r.request.mate.kind !== 'point') return
    expect(r.request.mate.point1).toEqual([-1.5, 0, 2.25])
    expect(r.request.mate.point2).toEqual([10, -3, 0])
  })

  it('does NOT carry axis / normal slots onto a point mate', () => {
    const r = buildAddMateRequest(HANDLE, base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.mate).not.toHaveProperty('axis1')
    expect(r.request.mate).not.toHaveProperty('normal1')
  })
})

describe('buildAddMateRequest — axis mate', () => {
  const base: MateFormDraft = {
    ...makeMateFormDraft('p1', 'p2'),
    kind: 'axis',
    axis1: ['1', '0', '0'],
    axis2: ['0', '1', '0'],
  }

  it('maps a valid axis draft onto the wire envelope', () => {
    const r = buildAddMateRequest(HANDLE, base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.mate).toEqual({
      kind: 'axis',
      part1Id: 'p1',
      axis1: [1, 0, 0],
      part2Id: 'p2',
      axis2: [0, 1, 0],
    })
  })

  it('rejects a zero-length axis1 with a field pointer', () => {
    const r = buildAddMateRequest(HANDLE, { ...base, axis1: ['0', '0', '0'] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('axis1')
    expect(r.message).toMatch(/non-zero/i)
  })

  it('rejects a zero-length axis2 with a field pointer', () => {
    const r = buildAddMateRequest(HANDLE, { ...base, axis2: ['0', '0', '0'] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('axis2')
  })
})

describe('buildAddMateRequest — plane mate', () => {
  const base: MateFormDraft = {
    ...makeMateFormDraft('p1', 'p2'),
    kind: 'plane',
    point1: ['0', '0', '0'],
    normal1: ['0', '0', '1'],
    point2: ['0', '0', '10'],
    normal2: ['0', '0', '-1'],
  }

  it('maps a valid plane draft onto the wire envelope with both points + normals', () => {
    const r = buildAddMateRequest(HANDLE, base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.request.mate).toEqual({
      kind: 'plane',
      part1Id: 'p1',
      point1: [0, 0, 0],
      normal1: [0, 0, 1],
      part2Id: 'p2',
      point2: [0, 0, 10],
      normal2: [0, 0, -1],
    })
  })

  it('rejects a zero-length plane normal1', () => {
    const r = buildAddMateRequest(HANDLE, { ...base, normal1: ['0', '0', '0'] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('normal1')
  })

  it('rejects a zero-length plane normal2', () => {
    const r = buildAddMateRequest(HANDLE, { ...base, normal2: ['0', '0', '0'] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('normal2')
  })

  it('allows a zero plane ORIGIN (only the normal must be non-zero)', () => {
    const r = buildAddMateRequest(HANDLE, { ...base, point1: ['0', '0', '0'] })
    expect(r.ok).toBe(true)
  })
})

describe('buildAddMateRequest — structural validation', () => {
  const valid = makeMateFormDraft('p1', 'p2')

  it('rejects an empty handle (assembly not built yet)', () => {
    const r = buildAddMateRequest('', valid)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('handle')
  })

  it('rejects a whitespace-only handle', () => {
    const r = buildAddMateRequest('   ', valid)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('handle')
  })

  it('rejects an empty part1Id', () => {
    const r = buildAddMateRequest(HANDLE, { ...valid, part1Id: '' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('part1Id')
  })

  it('rejects identical part ids (a mate joins two DIFFERENT parts)', () => {
    const r = buildAddMateRequest(HANDLE, { ...valid, part1Id: 'p1', part2Id: 'p1' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('part2Id')
    expect(r.message).toMatch(/different parts/i)
  })

  it('rejects a non-numeric point cell with a field pointer', () => {
    const r = buildAddMateRequest(HANDLE, {
      ...valid,
      kind: 'point',
      point1: ['x', '0', '0'],
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('point1')
  })

  it('rejects an empty point cell', () => {
    const r = buildAddMateRequest(HANDLE, {
      ...valid,
      kind: 'point',
      point2: ['1', '', '3'],
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('point2')
  })

  it('rejects a non-finite (Infinity) cell', () => {
    const r = buildAddMateRequest(HANDLE, {
      ...valid,
      kind: 'point',
      point1: ['Infinity', '0', '0'],
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.field).toBe('point1')
  })
})

// ── (B) outcome → badge mapping ──────────────────────────────────────────────

describe('mateOutcomeToBadge — success', () => {
  it('maps a bare success onto a green "Mate solved" badge', () => {
    const v = mateOutcomeToBadge({ ok: true })
    expect(v.status).toBe('solved')
    expect(v.label).toBe('Mate solved')
    expect(v.detail).toBeUndefined()
  })

  it('appends the post-solve bbox extent when present', () => {
    const v = mateOutcomeToBadge({
      ok: true,
      result: { bbox: { min: [0, 0, 0], max: [10, 20, 5] } },
    })
    expect(v.status).toBe('solved')
    expect(v.label).toBe('Mate solved (10 × 20 × 5 mm)')
  })

  it('rounds the bbox extent to two decimals', () => {
    const v = mateOutcomeToBadge({
      ok: true,
      result: { bbox: { min: [0, 0, 0], max: [1.236, 2.5, 0.333] } },
    })
    // 1.236 -> 1.24 (round half up at the 3rd decimal); 0.333 -> 0.33;
    // 2.5 stays 2.5 (trailing zero dropped). Avoids the 1.005 IEEE-754
    // half-even quirk (1.005*100 === 100.4999…) which would round DOWN.
    expect(v.label).toContain('1.24 × 2.5 × 0.33 mm')
  })

  it('degrades to the bare label when the bbox is malformed', () => {
    const v = mateOutcomeToBadge({
      ok: true,
      result: { bbox: { min: [0, 0, 0] } }, // missing max
    })
    expect(v.label).toBe('Mate solved')
  })
})

describe('mateOutcomeToBadge — over-constrained', () => {
  it('maps mate_solve_failed onto a red Over-constrained badge', () => {
    const v = mateOutcomeToBadge({ ok: false, error: 'mate_solve_failed' })
    expect(v.status).toBe('over-constrained')
    expect(v.label).toBe('Over-constrained')
    // Falls back to an actionable "loosen a constraint" hint.
    expect(v.detail).toMatch(/loosen|remove/i)
  })

  it('carries the sidecar hint through when provided', () => {
    const v = mateOutcomeToBadge({
      ok: false,
      error: 'mate_solve_failed',
      hint: 'OCCT: solver did not converge',
    })
    expect(v.status).toBe('over-constrained')
    expect(v.detail).toBe('OCCT: solver did not converge')
  })
})

describe('mateOutcomeToBadge — generic errors', () => {
  it('maps bad_params onto a red error badge carrying the error code', () => {
    const v = mateOutcomeToBadge({
      ok: false,
      error: 'bad_params',
      hint: 'mate.part1Id is not a child of this assembly',
    })
    expect(v.status).toBe('error')
    expect(v.label).toBe('Mate failed: bad_params')
    expect(v.detail).toBe('mate.part1Id is not a child of this assembly')
  })

  it('maps invalid_handle onto a red error badge', () => {
    const v = mateOutcomeToBadge({ ok: false, error: 'invalid_handle' })
    expect(v.status).toBe('error')
    expect(v.label).toContain('invalid_handle')
    expect(v.detail).toBeUndefined()
  })
})

describe('badge constants', () => {
  it('IDLE badge is gray "No mate solved"', () => {
    expect(IDLE_MATE_BADGE).toEqual({ label: 'No mate solved', status: 'idle' })
  })
  it('SOLVING badge is the in-flight state', () => {
    expect(SOLVING_MATE_BADGE.status).toBe('solving')
  })
})

// ── narrowAddMateResponse (opaque IPC payload → typed outcome) ────────────────

describe('narrowAddMateResponse', () => {
  it('narrows a well-formed success with bbox', () => {
    const o = narrowAddMateResponse({
      ok: true,
      result: { handle: 'asm:1', kind: 'point', part1Id: 'a', part2Id: 'b', bbox: { min: [0, 0, 0], max: [1, 1, 1] } },
    })
    expect(o.ok).toBe(true)
    if (!o.ok) return
    expect(o.result?.bbox?.max).toEqual([1, 1, 1])
  })

  it('narrows a success whose result lacks a usable bbox to a bare success', () => {
    const o = narrowAddMateResponse({ ok: true, result: { handle: 'asm:1' } })
    expect(o.ok).toBe(true)
    if (!o.ok) return
    expect(o.result).toBeUndefined()
  })

  it('narrows a structured failure preserving error + hint', () => {
    const o = narrowAddMateResponse({ ok: false, error: 'mate_solve_failed', hint: 'h' })
    expect(o.ok).toBe(false)
    if (o.ok) return
    expect(o.error).toBe('mate_solve_failed')
    expect(o.hint).toBe('h')
  })

  it('folds a non-object response onto sidecar_protocol_error', () => {
    expect(narrowAddMateResponse(null)).toEqual({
      ok: false,
      error: 'sidecar_protocol_error',
      hint: 'Empty response from addAssemblyMate.',
    })
  })

  it('folds an unrecognised shape onto sidecar_protocol_error', () => {
    const o = narrowAddMateResponse({ foo: 'bar' })
    expect(o.ok).toBe(false)
    if (o.ok) return
    expect(o.error).toBe('sidecar_protocol_error')
  })

  it('round-trips: a narrowed over-constrained failure maps to the over-constrained badge', () => {
    const o = narrowAddMateResponse({ ok: false, error: 'mate_solve_failed' })
    const v = mateOutcomeToBadge(o)
    expect(v.status).toBe('over-constrained')
  })
})

// ── bboxExtentSummary (direct) ───────────────────────────────────────────────

describe('bboxExtentSummary', () => {
  it('formats a full bbox as Δx × Δy × Δz mm', () => {
    expect(bboxExtentSummary({ min: [-5, 0, 1], max: [5, 10, 4] })).toBe('10 × 10 × 3 mm')
  })
  it('returns null for an undefined bbox', () => {
    expect(bboxExtentSummary(undefined)).toBeNull()
  })
  it('returns null when min is missing', () => {
    expect(bboxExtentSummary({ max: [1, 1, 1] })).toBeNull()
  })
})
