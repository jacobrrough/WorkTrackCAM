/**
 * User-parameter schema + ops — legacy-parse guarantee, reference integrity
 * (add / rename cascade / delete blocking), and resolution into the numeric
 * `parameters` cache the solver reads.
 */

import { describe, expect, it } from 'vitest'
import {
  addUserParameter,
  deleteUserParameter,
  deriveUserParameterViews,
  designFileSchemaV2,
  editUserParameterExpression,
  emptyDesign,
  normalizeDesign,
  renameUserParameter,
  resolveUserParameters,
  userParameterReferences,
  type DesignFileV2
} from './design-schema'

describe('userParameters — additive schema / legacy parse', () => {
  it('emptyDesign carries an empty userParameters array', () => {
    expect(emptyDesign().userParameters).toEqual([])
  })

  it('a legacy design JSON with NO userParameters block parses unchanged', () => {
    // Exactly the pre-feature v2 shape (no `userParameters` key at all).
    const legacy = {
      version: 2,
      extrudeDepthMm: 10,
      solidKind: 'extrude',
      loftSeparationMm: 20,
      revolve: { angleDeg: 360, axisX: 0 },
      parameters: { d1: 25 },
      points: {},
      entities: [],
      constraints: [],
      dimensions: []
    }
    const parsed = designFileSchemaV2.parse(legacy)
    expect(parsed.userParameters).toEqual([]) // filled by .default([])
    expect(parsed.parameters).toEqual({ d1: 25 }) // untouched
    // normalizeDesign path (the app's real loader) also fills it.
    const norm = normalizeDesign(JSON.parse(JSON.stringify(legacy)))
    expect(norm.userParameters).toEqual([])
  })

  it('rejects an invalid parameter name at the schema level', () => {
    const raw = { ...emptyDesign(), userParameters: [{ name: '1bad', expression: '5' }] }
    expect(() => designFileSchemaV2.parse(JSON.parse(JSON.stringify(raw)))).toThrow()
  })

  it('round-trips a valid userParameters block', () => {
    const d = emptyDesign()
    d.userParameters = [{ name: 'thickness', expression: '6', resolvedValue: 6 }]
    const again = designFileSchemaV2.parse(JSON.parse(JSON.stringify(d)))
    expect(again.userParameters[0]).toEqual({ name: 'thickness', expression: '6', resolvedValue: 6 })
  })
})

describe('resolveUserParameters — folds resolved values into the numeric cache', () => {
  it('writes resolved values into parameters[name] and caches resolvedValue', () => {
    let d = emptyDesign()
    d.userParameters = [
      { name: 'd1', expression: '10' },
      { name: 'width', expression: 'd1 * 2 + 5' }
    ]
    d = resolveUserParameters(d)
    expect(d.parameters.d1).toBe(10)
    expect(d.parameters.width).toBe(25)
    expect(d.userParameters.find((p) => p.name === 'width')!.resolvedValue).toBe(25)
  })

  it('drops resolvedValue and skips the cache for a failing expression', () => {
    let d = emptyDesign()
    d.userParameters = [{ name: 'bad', expression: '1 / 0' }]
    d = resolveUserParameters(d)
    expect(d.userParameters[0]!.resolvedValue).toBeUndefined()
    expect(d.parameters.bad).toBeUndefined()
  })

  it('leaves non-user-parameter dimension keys alone', () => {
    let d = emptyDesign()
    d.parameters = { dimKey: 42 } // a raw dimension driver, not a user param
    d.userParameters = [{ name: 'a', expression: '3' }]
    d = resolveUserParameters(d)
    expect(d.parameters.dimKey).toBe(42)
    expect(d.parameters.a).toBe(3)
  })
})

describe('addUserParameter — validation', () => {
  it('adds a valid parameter and resolves it', () => {
    const r = addUserParameter(emptyDesign(), 'thickness', '6')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.design.userParameters).toHaveLength(1)
      expect(r.design.parameters.thickness).toBe(6)
    }
  })

  it('rejects an invalid identifier', () => {
    const r = addUserParameter(emptyDesign(), '2d', '6')
    expect(r.ok).toBe(false)
  })

  it('rejects a duplicate user-parameter name', () => {
    const first = addUserParameter(emptyDesign(), 'w', '1')
    expect(first.ok).toBe(true)
    if (first.ok) {
      const dup = addUserParameter(first.design, 'w', '2')
      expect(dup.ok).toBe(false)
    }
  })

  it('rejects a name that collides with an existing dimension key', () => {
    const d = emptyDesign()
    d.parameters = { d1: 20 }
    const r = addUserParameter(d, 'd1', '5')
    expect(r.ok).toBe(false)
  })
})

describe('editUserParameterExpression — re-resolves dependents', () => {
  it('editing a base parameter re-resolves everything downstream', () => {
    // Build a base → dependent chain.
    const withBase = addUserParameter(emptyDesign(), 'd1', '10')
    expect(withBase.ok).toBe(true)
    const withDep = withBase.ok ? addUserParameter(withBase.design, 'width', 'd1 * 2') : withBase
    expect(withDep.ok).toBe(true)
    if (withDep.ok) {
      expect(withDep.design.parameters.width).toBe(20)
      const edited = editUserParameterExpression(withDep.design, 'd1', '50')
      expect(edited.ok).toBe(true)
      if (edited.ok) {
        expect(edited.design.parameters.d1).toBe(50)
        expect(edited.design.parameters.width).toBe(100) // downstream re-resolved
      }
    }
  })

  it('rejects editing an unknown parameter', () => {
    expect(editUserParameterExpression(emptyDesign(), 'nope', '1').ok).toBe(false)
  })
})

describe('renameUserParameter — cascade + integrity', () => {
  function seed(): DesignFileV2 {
    let d = emptyDesign()
    d = (addUserParameter(d, 'd1', '10') as { design: DesignFileV2 }).design
    d = (addUserParameter(d, 'width', 'd1 * 2') as { design: DesignFileV2 }).design
    return d
  }

  it('renames the parameter and rewrites referencing expressions', () => {
    const r = renameUserParameter(seed(), 'd1', 'base')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.design.userParameters.some((p) => p.name === 'base')).toBe(true)
      expect(r.design.userParameters.some((p) => p.name === 'd1')).toBe(false)
      // The dependent expression was rewritten d1 -> base and still resolves.
      expect(r.design.userParameters.find((p) => p.name === 'width')!.expression).toBe('base * 2')
      expect(r.design.parameters.width).toBe(20)
      expect(r.design.parameters.base).toBe(10)
      expect(r.design.parameters.d1).toBeUndefined()
    }
  })

  it('does NOT rewrite a longer identifier that merely contains the old name', () => {
    let d = emptyDesign()
    d = (addUserParameter(d, 'd1', '10') as { design: DesignFileV2 }).design
    d = (addUserParameter(d, 'd10', '5') as { design: DesignFileV2 }).design
    d = (addUserParameter(d, 'sum', 'd1 + d10') as { design: DesignFileV2 }).design
    const r = renameUserParameter(d, 'd1', 'x')
    expect(r.ok).toBe(true)
    if (r.ok) {
      // `d10` must survive; only the standalone `d1` becomes `x`.
      expect(r.design.userParameters.find((p) => p.name === 'sum')!.expression).toBe('x + d10')
    }
  })

  it('cascades the rename onto a bound dimension parameterKey', () => {
    let d = seed()
    d.dimensions = [{ id: 'dim1', kind: 'linear', aId: 'p0', bId: 'p1', parameterKey: 'd1' }]
    d.constraints = [
      { id: 'c1', type: 'distance', a: { pointId: 'p0' }, b: { pointId: 'p1' }, parameterKey: 'd1' }
    ]
    const r = renameUserParameter(d, 'd1', 'len')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.design.dimensions[0]!.parameterKey).toBe('len')
      const con = r.design.constraints[0]!
      expect('parameterKey' in con && con.parameterKey).toBe('len')
    }
  })

  it('rejects a rename that collides with an existing name', () => {
    expect(renameUserParameter(seed(), 'd1', 'width').ok).toBe(false)
  })

  it('rejects a rename to an invalid identifier', () => {
    expect(renameUserParameter(seed(), 'd1', '3bad').ok).toBe(false)
  })

  it('a no-op rename (same name) succeeds unchanged', () => {
    const r = renameUserParameter(seed(), 'd1', 'd1')
    expect(r.ok).toBe(true)
  })
})

describe('deleteUserParameter — blocked when referenced', () => {
  function seed(): DesignFileV2 {
    let d = emptyDesign()
    d = (addUserParameter(d, 'd1', '10') as { design: DesignFileV2 }).design
    d = (addUserParameter(d, 'width', 'd1 * 2') as { design: DesignFileV2 }).design
    return d
  }

  it('deletes an unreferenced parameter and clears its cache entry', () => {
    const r = deleteUserParameter(seed(), 'width')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.design.userParameters.some((p) => p.name === 'width')).toBe(false)
      expect(r.design.parameters.width).toBeUndefined()
      expect(r.design.parameters.d1).toBe(10) // sibling intact
    }
  })

  it('blocks deleting a parameter referenced by another expression', () => {
    const r = deleteUserParameter(seed(), 'd1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('width')
  })

  it('blocks deleting a parameter referenced by a sketch dimension', () => {
    let d = emptyDesign()
    d = (addUserParameter(d, 'len', '30') as { design: DesignFileV2 }).design
    d.dimensions = [{ id: 'dim1', kind: 'linear', aId: 'p0', bId: 'p1', parameterKey: 'len' }]
    const r = deleteUserParameter(d, 'len')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('dimension')
  })

  it('userParameterReferences reports the blocking references', () => {
    expect(userParameterReferences(seed(), 'd1')).toContain('width')
    expect(userParameterReferences(seed(), 'width')).toHaveLength(0)
  })
})

describe('deriveUserParameterViews — panel rows with live value / error', () => {
  it('reports resolved values for healthy parameters', () => {
    let d = emptyDesign()
    d = (addUserParameter(d, 'd1', '10') as { design: DesignFileV2 }).design
    d = (addUserParameter(d, 'width', 'd1 * 2') as { design: DesignFileV2 }).design
    const views = deriveUserParameterViews(d)
    expect(views).toEqual([
      { name: 'd1', expression: '10', resolvedValue: 10 },
      { name: 'width', expression: 'd1 * 2', resolvedValue: 20 }
    ])
  })

  it('reports null value + an error message for a failing expression', () => {
    let d = emptyDesign()
    d = (addUserParameter(d, 'bad', '1 / 0') as { design: DesignFileV2 }).design
    const view = deriveUserParameterViews(d)[0]!
    expect(view.resolvedValue).toBeNull()
    expect(view.errorMessage).toContain('Division by zero')
  })

  it('names the cycle chain in the error message', () => {
    let d = emptyDesign()
    // Build a cycle directly (add would resolve, but references are allowed to
    // form a cycle once both exist — edit the second to close it).
    d = (addUserParameter(d, 'a', '1') as { design: DesignFileV2 }).design
    d = (addUserParameter(d, 'b', 'a') as { design: DesignFileV2 }).design
    d = (editUserParameterExpression(d, 'a', 'b') as { design: DesignFileV2 }).design
    const views = deriveUserParameterViews(d)
    const va = views.find((v) => v.name === 'a')!
    expect(va.resolvedValue).toBeNull()
    expect(va.errorMessage?.toLowerCase()).toContain('cyclic')
  })
})
