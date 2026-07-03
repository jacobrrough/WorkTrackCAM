/**
 * USER PARAMETER → SKETCH DIMENSION consumption (Phase-3 parity).
 *
 * Proves the load-bearing claim: a sketch driving dimension bound to a USER
 * PARAMETER's name is driven by that parameter's expression. Editing the user
 * parameter re-resolves it into `parameters[name]` AND re-solves the sketch, so
 * the dependent geometry lands on the new value — the exact pipeline the session
 * runs via `resolveUserParametersAndSolve`.
 *
 * Node env, no React/DOM/IPC. Builds a real two-point segment + a `distance`
 * constraint reading `parameters.width`, exactly the shape
 * `createDrivingDimension` persists, then drives it purely through the schema
 * ops + the resolve-and-solve seam.
 */

import { describe, expect, it } from 'vitest'
import {
  designFileSchemaV2,
  editUserParameterExpression,
  emptyDesign,
  resolveUserParameters,
  type DesignFileV2
} from '../../../shared/design-schema'
import {
  measureDimensionValue,
  resolveUserParametersAndSolve
} from '../sketch-dimension-drive'

/**
 * Two points `pa`→`pb` on an open segment, with a `distance` driving constraint
 * + a `linear` dimension both reading `parameters[key]` — i.e. the persisted
 * shape of a driving dimension whose parameter key is a USER-PARAMETER name.
 */
function boundSegment(key: string, startLenMm: number): DesignFileV2 {
  const d = emptyDesign()
  d.points = { pa: { x: 0, y: 0 }, pb: { x: startLenMm, y: 0 } }
  d.entities = [{ id: 'seg', kind: 'polyline', pointIds: ['pa', 'pb'], closed: false }]
  d.parameters = { [key]: startLenMm }
  d.constraints = [
    { id: 'c1', type: 'distance', a: { pointId: 'pa' }, b: { pointId: 'pb' }, parameterKey: key }
  ]
  d.dimensions = [{ id: 'dim1', kind: 'linear', aId: 'pa', bId: 'pb', parameterKey: key }]
  return d
}

function segLen(d: DesignFileV2): number {
  return measureDimensionValue(d, { kind: 'aligned', aId: 'pa', bId: 'pb' })!
}

describe('user parameter drives a bound sketch dimension', () => {
  it('editing the user parameter re-solves the dependent dimension onto the new value', () => {
    // A segment 50 mm long, its distance constraint bound to `parameters.width`.
    let d = boundSegment('width', 50)
    // Promote `width` to a user parameter defined by an expression.
    d.userParameters = [{ name: 'width', expression: '50' }]
    d = resolveUserParametersAndSolve(d)
    expect(segLen(d)).toBeCloseTo(50, 6)
    expect(d.parameters.width).toBeCloseTo(50, 9)

    // EDIT the user parameter to 80 → resolve + re-solve.
    const edited = editUserParameterExpression(d, 'width', '80')
    expect(edited.ok).toBe(true)
    if (edited.ok) {
      const solved = resolveUserParametersAndSolve(edited.design)
      // The numeric cache updated…
      expect(solved.parameters.width).toBeCloseTo(80, 6)
      // …and the GEOMETRY re-solved onto the new distance.
      expect(Math.abs(segLen(solved) - 80)).toBeLessThan(0.5)
      // The user parameter's resolvedValue cache reflects it too.
      expect(solved.userParameters.find((p) => p.name === 'width')!.resolvedValue).toBeCloseTo(80, 6)
    }
  })

  it('an EXPRESSION referencing another parameter drives the dimension', () => {
    // width = base * 2; a segment bound to `width`.
    let d = boundSegment('width', 40)
    d.userParameters = [
      { name: 'base', expression: '20' },
      { name: 'width', expression: 'base * 2' }
    ]
    d = resolveUserParametersAndSolve(d)
    expect(d.parameters.width).toBeCloseTo(40, 9)
    expect(Math.abs(segLen(d) - 40)).toBeLessThan(0.5)

    // Change the BASE → width follows (base*2) → geometry follows.
    const edited = editUserParameterExpression(d, 'base', '35')
    expect(edited.ok).toBe(true)
    if (edited.ok) {
      const solved = resolveUserParametersAndSolve(edited.design)
      expect(solved.parameters.base).toBeCloseTo(35, 9)
      expect(solved.parameters.width).toBeCloseTo(70, 6)
      expect(Math.abs(segLen(solved) - 70)).toBeLessThan(0.5)
    }
  })

  it('numeric-only entry is unaffected: resolveUserParameters is a no-op with no user params', () => {
    // No user parameters — the dimension keeps its raw numeric driver.
    const d = boundSegment('d1', 50)
    const resolved = resolveUserParameters(d)
    // parameters untouched, no geometry move.
    expect(resolved.parameters.d1).toBe(50)
    expect(resolved.userParameters).toEqual([])
    expect(segLen(resolved)).toBeCloseTo(50, 9)
  })

  it('a failing user-parameter expression keeps the last-good numeric cache (no zeroing)', () => {
    let d = boundSegment('width', 50)
    d.userParameters = [{ name: 'width', expression: '50' }]
    d = resolveUserParametersAndSolve(d)
    expect(d.parameters.width).toBeCloseTo(50, 9)

    // Break the expression — the cache must NOT be zeroed (geometry stays put).
    const edited = editUserParameterExpression(d, 'width', 'nonsense +')
    expect(edited.ok).toBe(true)
    if (edited.ok) {
      const solved = resolveUserParametersAndSolve(edited.design)
      // width keeps its prior 50 (a transient typo can't collapse the sketch).
      expect(solved.parameters.width).toBeCloseTo(50, 9)
      // The parameter row is flagged (resolvedValue dropped) so the panel shows the error.
      expect(solved.userParameters.find((p) => p.name === 'width')!.resolvedValue).toBeUndefined()
    }
  })

  it('the whole bound design round-trips through the v2 Zod schema', () => {
    let d = boundSegment('width', 50)
    d.userParameters = [{ name: 'width', expression: '80' }]
    d = resolveUserParametersAndSolve(d)
    const again = designFileSchemaV2.parse(JSON.parse(JSON.stringify(d)))
    expect(again.userParameters[0]!.name).toBe('width')
    expect(again.userParameters[0]!.expression).toBe('80')
    expect(again.parameters.width).toBeCloseTo(80, 6)
    // The bound constraint + dimension survive save+reload.
    expect(again.constraints.some((c) => 'parameterKey' in c && c.parameterKey === 'width')).toBe(true)
    expect(again.dimensions[0]!.parameterKey).toBe('width')
  })
})
