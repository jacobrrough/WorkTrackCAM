/**
 * expression-eval — torture suite for the pure user-parameter engine.
 *
 * Covers precedence, associativity, parens, unary ±, number literals (incl.
 * exponent form), the full errors-as-values surface (empty / syntax / unknown
 * identifier / division-by-zero / non-finite), identifier collection, and the
 * topological multi-parameter resolver with cycle detection (A→B→A, self, deep
 * chains). Nothing here may throw — a failure is always a tagged result.
 */

import { describe, expect, it } from 'vitest'
import {
  collectIdentifiers,
  evaluateExpression,
  isValidIdentifier,
  resolveParameters,
  type NamedExpression
} from './expression-eval'

/** Assert a successful evaluation lands (approximately) on `expected`. */
function evalOk(expr: string, scope: Record<string, number> = {}): number {
  const r = evaluateExpression(expr, scope)
  if (!r.ok) throw new Error(`expected ok for "${expr}", got ${r.error}: ${r.message}`)
  return r.value
}

describe('evaluateExpression — arithmetic + precedence', () => {
  it('adds and subtracts left-to-right', () => {
    expect(evalOk('1 + 2 + 3')).toBe(6)
    expect(evalOk('10 - 3 - 2')).toBe(5) // left-assoc, not 10-(3-2)=9
  })

  it('multiplies / divides before adding', () => {
    expect(evalOk('2 + 3 * 4')).toBe(14)
    expect(evalOk('2 * 3 + 4')).toBe(10)
    expect(evalOk('20 / 4 - 1')).toBe(4)
  })

  it('honors parentheses over precedence', () => {
    expect(evalOk('(2 + 3) * 4')).toBe(20)
    expect(evalOk('2 * (3 + 4)')).toBe(14)
    expect(evalOk('((1 + 2) * (3 + 4))')).toBe(21)
  })

  it('applies unary minus and plus', () => {
    expect(evalOk('-5')).toBe(-5)
    expect(evalOk('+5')).toBe(5)
    expect(evalOk('-(2 + 3)')).toBe(-5)
    expect(evalOk('3 - -2')).toBe(5)
    expect(evalOk('- -4')).toBe(4)
    expect(evalOk('2 * -3')).toBe(-6)
  })

  it('exponentiation is right-associative and binds tighter than unary on the left', () => {
    expect(evalOk('2 ^ 3')).toBe(8)
    expect(evalOk('2 ^ 3 ^ 2')).toBe(512) // 2^(3^2) = 2^9
    expect(evalOk('2 ** 10')).toBe(1024) // ** synonym
    // Unary in the exponent binds: 2 ^ -1 == 0.5
    expect(evalOk('2 ^ -1')).toBe(0.5)
  })

  it('unary minus outside a power negates the whole power', () => {
    // -2^2 parses as -(2^2) via unary→power (base is a primary), so = -4.
    expect(evalOk('-2 ^ 2')).toBe(-4)
    expect(evalOk('(-2) ^ 2')).toBe(4)
  })

  it('reads decimal and exponent number literals', () => {
    expect(evalOk('3.14')).toBeCloseTo(3.14, 10)
    expect(evalOk('.5 + .5')).toBe(1)
    expect(evalOk('1e3')).toBe(1000)
    expect(evalOk('2.5e-2')).toBeCloseTo(0.025, 10)
  })

  it('resolves identifier references from scope', () => {
    expect(evalOk('d1 * 2', { d1: 10 })).toBe(20)
    expect(evalOk('width / 2 + 5', { width: 30 })).toBe(20)
    expect(evalOk('a + b * c', { a: 1, b: 2, c: 3 })).toBe(7)
  })

  it('ignores insignificant whitespace including tabs/newlines', () => {
    expect(evalOk('  1\t+\n2 ')).toBe(3)
  })
})

describe('evaluateExpression — errors are values, never throws', () => {
  it('flags an empty or whitespace-only expression', () => {
    for (const s of ['', '   ', '\t\n']) {
      const r = evaluateExpression(s, {})
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('empty')
    }
  })

  it('flags a syntax error (dangling operator, bad char, unbalanced parens)', () => {
    for (const s of ['1 +', '* 3', '(1 + 2', '1 + 2)', '1 @ 2', '3 4', '()']) {
      const r = evaluateExpression(s, {})
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('syntax')
    }
  })

  it('flags an unknown identifier', () => {
    const r = evaluateExpression('missing + 1', { present: 2 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('unknown_identifier')
      expect(r.message).toContain('missing')
    }
  })

  it('flags division by zero', () => {
    const r = evaluateExpression('5 / 0', {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('division_by_zero')
    // Also via an identifier that resolves to 0.
    const r2 = evaluateExpression('5 / z', { z: 0 })
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error).toBe('division_by_zero')
  })

  it('flags a non-finite result (overflow)', () => {
    const r = evaluateExpression('1e308 * 1e308', {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('non_finite')
  })

  it('flags a non-finite scope value', () => {
    const r = evaluateExpression('x + 1', { x: Number.POSITIVE_INFINITY })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('non_finite')
  })

  it('never throws for any random-ish garbage input', () => {
    const junk = ['???', '((((', '1//2', '+-*/', 'a b c', '1.2.3', 'e', '^^', '5%2']
    for (const s of junk) {
      expect(() => evaluateExpression(s, {})).not.toThrow()
      expect(evaluateExpression(s, {}).ok).toBe(false)
    }
  })
})

describe('isValidIdentifier + collectIdentifiers', () => {
  it('accepts valid identifiers and rejects invalid ones', () => {
    for (const good of ['a', '_x', 'thickness', 'd1', 'wall_2', '_']) {
      expect(isValidIdentifier(good)).toBe(true)
    }
    for (const bad of ['', '1d', 'a-b', 'a b', 'a+b', 'a.b', '2', '']) {
      expect(isValidIdentifier(bad)).toBe(false)
    }
  })

  it('collects the referenced identifiers from an expression', () => {
    expect([...collectIdentifiers('d1 * 2 + width / 2')].sort()).toEqual(['d1', 'width'])
    expect([...collectIdentifiers('42')].length).toBe(0)
    // Best-effort even when the RHS has a trailing syntax error.
    expect([...collectIdentifiers('a + b +')].sort()).toEqual(['a', 'b'])
  })
})

describe('resolveParameters — topological resolution + cycle detection', () => {
  it('resolves independent parameters', () => {
    const params: NamedExpression[] = [
      { name: 'a', expression: '5' },
      { name: 'b', expression: '3 + 4' }
    ]
    const { values } = resolveParameters(params)
    expect(values).toEqual({ a: 5, b: 7 })
  })

  it('resolves a dependency chain regardless of declaration order', () => {
    // c depends on b depends on a — declared out of order on purpose.
    const params: NamedExpression[] = [
      { name: 'c', expression: 'b * 2' },
      { name: 'b', expression: 'a + 1' },
      { name: 'a', expression: '10' }
    ]
    const { values, resolutions } = resolveParameters(params)
    expect(values).toEqual({ a: 10, b: 11, c: 22 })
    expect(resolutions.get('c')).toEqual({ ok: true, value: 22 })
  })

  it('resolves a deep chain (10 levels)', () => {
    const params: NamedExpression[] = [{ name: 'p0', expression: '1' }]
    for (let i = 1; i < 10; i++) {
      params.push({ name: `p${i}`, expression: `p${i - 1} + 1` })
    }
    const { values } = resolveParameters(params)
    expect(values.p9).toBe(10)
  })

  it('detects a direct two-node cycle A→B→A and names the chain', () => {
    const params: NamedExpression[] = [
      { name: 'a', expression: 'b + 1' },
      { name: 'b', expression: 'a + 1' }
    ]
    const { resolutions } = resolveParameters(params)
    const ra = resolutions.get('a')!
    expect(ra.ok).toBe(false)
    if (!ra.ok) {
      expect(ra.error).toBe('cycle')
      expect(ra.cycle).toBeDefined()
      // Chain names both members and closes back on the start.
      expect(ra.cycle).toContain('a')
      expect(ra.cycle).toContain('b')
    }
  })

  it('detects a self-reference A→A as a cycle', () => {
    const { resolutions } = resolveParameters([{ name: 'x', expression: 'x + 1' }])
    const r = resolutions.get('x')!
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('cycle')
      expect(r.cycle).toEqual(['x', 'x'])
    }
  })

  it('detects a three-node cycle A→B→C→A', () => {
    const params: NamedExpression[] = [
      { name: 'a', expression: 'b' },
      { name: 'b', expression: 'c' },
      { name: 'c', expression: 'a' }
    ]
    const { resolutions } = resolveParameters(params)
    for (const name of ['a', 'b', 'c']) {
      const r = resolutions.get(name)!
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('cycle')
    }
  })

  it('resolves the healthy params even when one has a cycle', () => {
    const params: NamedExpression[] = [
      { name: 'good', expression: '2 * 3' },
      { name: 'a', expression: 'b' },
      { name: 'b', expression: 'a' }
    ]
    const { values, resolutions } = resolveParameters(params)
    expect(values.good).toBe(6)
    expect(resolutions.get('a')!.ok).toBe(false)
    expect(values.a).toBeUndefined()
  })

  it('reports unknown_identifier for a reference outside the set', () => {
    const { resolutions } = resolveParameters([{ name: 'a', expression: 'nope + 1' }])
    const r = resolutions.get('a')!
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('unknown_identifier')
  })

  it('honors extraScope constants without treating them as cycles', () => {
    const { values } = resolveParameters([{ name: 'a', expression: 'base * 2' }], { base: 7 })
    expect(values.a).toBe(14)
  })

  it('propagates a non-cycle dependency failure honestly', () => {
    // a references b, b divides by zero. a should NOT resolve (b is unset in a's
    // scope → unknown_identifier when a uses it).
    const params: NamedExpression[] = [
      { name: 'a', expression: 'b + 1' },
      { name: 'b', expression: '1 / 0' }
    ]
    const { resolutions } = resolveParameters(params)
    expect(resolutions.get('b')!.ok).toBe(false)
    if (!resolutions.get('b')!.ok) {
      expect((resolutions.get('b') as { error: string }).error).toBe('division_by_zero')
    }
    expect(resolutions.get('a')!.ok).toBe(false)
  })

  it('is deterministic across repeated runs', () => {
    const params: NamedExpression[] = [
      { name: 'w', expression: '30' },
      { name: 'h', expression: 'w / 2' },
      { name: 'area', expression: 'w * h' }
    ]
    const first = resolveParameters(params).values
    const second = resolveParameters(params).values
    expect(first).toEqual(second)
    expect(first).toEqual({ w: 30, h: 15, area: 450 })
  })
})
