import { describe, expect, it } from 'vitest'
import {
  addUserParameter,
  deleteUserParameter,
  deriveUserParameterViews,
  editUserParameterExpression,
  emptyDesign,
  normalizeDesign,
  renameUserParameter,
  resolveUserParameters
} from './design-schema'

describe('userParameters schema (additive)', () => {
  it('defaults to [] for legacy v2 files without the block', () => {
    const legacy = {
      version: 2,
      entities: []
    }
    const d = normalizeDesign(legacy)
    expect(d.userParameters).toEqual([])
  })

  it('round-trips a stored parameter list', () => {
    const d = addUserParameter(emptyDesign(), 'plateW', '30')
    const reparsed = normalizeDesign(JSON.parse(JSON.stringify(d)))
    expect(reparsed.userParameters).toEqual([{ name: 'plateW', expression: '30' }])
  })
})

describe('addUserParameter', () => {
  it('appends a trimmed, valid name', () => {
    const d = addUserParameter(emptyDesign(), '  plateW ', '25 + 5')
    expect(d.userParameters).toEqual([{ name: 'plateW', expression: '25 + 5' }])
  })

  it('returns the design unchanged for an invalid name', () => {
    const base = emptyDesign()
    expect(addUserParameter(base, '2bad', '1')).toBe(base)
    expect(addUserParameter(base, 'a b', '1')).toBe(base)
    expect(addUserParameter(base, '', '1')).toBe(base)
  })

  it('returns the design unchanged for a duplicate name', () => {
    const d = addUserParameter(emptyDesign(), 'w', '1')
    expect(addUserParameter(d, 'w', '2')).toBe(d)
  })
})

describe('editUserParameterExpression', () => {
  it('replaces the expression of the named row', () => {
    const d = addUserParameter(emptyDesign(), 'w', '1')
    const e = editUserParameterExpression(d, 'w', '2 * 3')
    expect(e.userParameters).toEqual([{ name: 'w', expression: '2 * 3' }])
  })

  it('is a no-op for an unknown name', () => {
    const d = addUserParameter(emptyDesign(), 'w', '1')
    expect(editUserParameterExpression(d, 'missing', '2')).toBe(d)
  })
})

describe('renameUserParameter', () => {
  it('renames the row AND rewrites references in other expressions', () => {
    let d = addUserParameter(emptyDesign(), 'w', '30')
    d = addUserParameter(d, 'half', 'w / 2')
    d = addUserParameter(d, 'wide', 'w + wDelta', )
    const r = renameUserParameter(d, 'w', 'width')
    expect(r.userParameters).toEqual([
      { name: 'width', expression: '30' },
      { name: 'half', expression: 'width / 2' },
      // `wDelta` must NOT be rewritten — identifier-boundary match only.
      { name: 'wide', expression: 'width + wDelta' }
    ])
  })

  it('is a no-op for unknown source, invalid target, or collision', () => {
    let d = addUserParameter(emptyDesign(), 'a', '1')
    d = addUserParameter(d, 'b', '2')
    expect(renameUserParameter(d, 'missing', 'c')).toBe(d)
    expect(renameUserParameter(d, 'a', '2bad')).toBe(d)
    expect(renameUserParameter(d, 'a', 'b')).toBe(d)
  })
})

describe('deleteUserParameter', () => {
  it('removes the named row', () => {
    let d = addUserParameter(emptyDesign(), 'a', '1')
    d = addUserParameter(d, 'b', '2')
    const r = deleteUserParameter(d, 'a')
    expect(r.userParameters).toEqual([{ name: 'b', expression: '2' }])
  })

  it('is a no-op for an unknown name', () => {
    const d = addUserParameter(emptyDesign(), 'a', '1')
    expect(deleteUserParameter(d, 'missing')).toBe(d)
  })
})

describe('resolveUserParameters / deriveUserParameterViews', () => {
  it('resolves cross-referencing parameters into values', () => {
    let d = addUserParameter(emptyDesign(), 'w', '30')
    d = addUserParameter(d, 'half', 'w / 2')
    expect(resolveUserParameters(d).values).toEqual({ w: 30, half: 15 })
  })

  it('derives render-ready rows with resolved values in stored order', () => {
    let d = addUserParameter(emptyDesign(), 'w', '25 + 5')
    d = addUserParameter(d, 'half', 'w / 2')
    expect(deriveUserParameterViews(d)).toEqual([
      { name: 'w', expression: '25 + 5', resolvedValue: 30 },
      { name: 'half', expression: 'w / 2', resolvedValue: 15 }
    ])
  })

  it('carries per-row errors (null value + message) without poisoning good rows', () => {
    let d = addUserParameter(emptyDesign(), 'ok', '7')
    d = addUserParameter(d, 'broken', '2 +')
    const views = deriveUserParameterViews(d)
    expect(views[0]).toEqual({ name: 'ok', expression: '7', resolvedValue: 7 })
    expect(views[1]?.resolvedValue).toBeNull()
    expect(views[1]?.errorMessage).toBeTruthy()
  })
})
