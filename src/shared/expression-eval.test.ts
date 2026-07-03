import { describe, expect, it } from 'vitest'
import {
  evaluateExpression,
  isValidParameterName,
  referencedNames,
  resolveParameters
} from './expression-eval'

describe('evaluateExpression', () => {
  it('evaluates plain numbers', () => {
    expect(evaluateExpression('42')).toEqual({ ok: true, value: 42 })
    expect(evaluateExpression(' 3.5 ')).toEqual({ ok: true, value: 3.5 })
  })

  it('applies arithmetic precedence (* / before + -)', () => {
    expect(evaluateExpression('2 + 3 * 4')).toEqual({ ok: true, value: 14 })
    expect(evaluateExpression('10 - 6 / 2')).toEqual({ ok: true, value: 7 })
  })

  it('honors parentheses and unary minus', () => {
    expect(evaluateExpression('(2 + 3) * 4')).toEqual({ ok: true, value: 20 })
    expect(evaluateExpression('-5 + 2')).toEqual({ ok: true, value: -3 })
    expect(evaluateExpression('-(2 + 3)')).toEqual({ ok: true, value: -5 })
  })

  it('resolves identifiers from the variable map', () => {
    expect(evaluateExpression('width / 2 + 1', { width: 30 })).toEqual({ ok: true, value: 16 })
  })

  it('reports unknown identifiers', () => {
    const r = evaluateExpression('height * 2', {})
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain("Unknown parameter 'height'")
  })

  it('reports syntax errors without throwing', () => {
    expect(evaluateExpression('2 +').ok).toBe(false)
    expect(evaluateExpression('(2 + 3').ok).toBe(false)
    expect(evaluateExpression('2 3').ok).toBe(false)
    expect(evaluateExpression('').ok).toBe(false)
    expect(evaluateExpression('2 $ 3').ok).toBe(false)
  })

  it('rejects non-finite results (division by zero)', () => {
    expect(evaluateExpression('1 / 0').ok).toBe(false)
  })
})

describe('referencedNames', () => {
  it('lists each identifier once', () => {
    expect([...referencedNames('a + b * a')].sort()).toEqual(['a', 'b'])
  })

  it('returns nothing for a broken expression', () => {
    expect(referencedNames('a + $')).toEqual([])
  })
})

describe('isValidParameterName', () => {
  it('accepts identifier-shaped names and rejects the rest', () => {
    expect(isValidParameterName('plateWidth')).toBe(true)
    expect(isValidParameterName('_x2')).toBe(true)
    expect(isValidParameterName('2x')).toBe(false)
    expect(isValidParameterName('a b')).toBe(false)
    expect(isValidParameterName('')).toBe(false)
  })
})

describe('resolveParameters', () => {
  it('resolves independent parameters', () => {
    const r = resolveParameters([
      { name: 'w', expression: '30' },
      { name: 'h', expression: '10 + 5' }
    ])
    expect(r.values).toEqual({ w: 30, h: 15 })
    expect(r.errors).toEqual({})
  })

  it('resolves cross-references in any declaration order', () => {
    const r = resolveParameters([
      { name: 'half', expression: 'whole / 2' },
      { name: 'whole', expression: '50' }
    ])
    expect(r.values).toEqual({ half: 25, whole: 50 })
    expect(r.errors).toEqual({})
  })

  it('detects direct and indirect cycles, sparing unrelated rows', () => {
    const r = resolveParameters([
      { name: 'a', expression: 'b + 1' },
      { name: 'b', expression: 'a + 1' },
      { name: 'ok', expression: '7' }
    ])
    expect(r.values).toEqual({ ok: 7 })
    expect(r.errors['a']).toContain('Circular reference')
    expect(r.errors['b']).toContain('Circular reference')
  })

  it('reports self-reference as a cycle', () => {
    const r = resolveParameters([{ name: 'x', expression: 'x + 1' }])
    expect(r.values).toEqual({})
    expect(r.errors['x']).toContain('Circular reference')
  })

  it('fails a row that references a broken row, independently', () => {
    const r = resolveParameters([
      { name: 'bad', expression: '2 +' },
      { name: 'dependent', expression: 'bad * 2' },
      { name: 'fine', expression: '1' }
    ])
    expect(r.values).toEqual({ fine: 1 })
    expect(r.errors['bad']).toBeTruthy()
    expect(r.errors['dependent']).toContain("Unknown parameter 'bad'")
  })

  it('flags duplicate names as ambiguous (neither definition resolves)', () => {
    const r = resolveParameters([
      { name: 'd', expression: '1' },
      { name: 'd', expression: '2' }
    ])
    expect(r.values).toEqual({})
    expect(r.errors['d']).toContain('Duplicate')
  })
})
