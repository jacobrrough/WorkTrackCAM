/**
 * Pure op-builder test for the Lip / Groove dialog.
 *
 * The contract that matters: `buildPlasticLipGrooveOp(...)` must emit an op the
 * REAL `kernelPostSolidOpSchema` accepts, because that op is persisted into
 * `part/features.json` `kernelOps[]` and replayed by a Build STEP (CLAUDE.md
 * Safety Rule 1 — a kernel op the schema would reject corrupts the timeline).
 * Pure function, no React/DOM → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import {
  buildPlasticLipGrooveOp,
  type PlasticLipGrooveDialogParams
} from '../PlasticLipGrooveDialog'

const validParams: PlasticLipGrooveDialogParams = {
  mode: 'lip',
  xMinMm: 0,
  xMaxMm: 50,
  yMinMm: 0,
  yMaxMm: 30,
  zBaseMm: 10,
  depthMm: 2
}

describe('buildPlasticLipGrooveOp emits a schema-valid kernel op', () => {
  it('builds the exact plastic_lip_groove op for a lip footprint', () => {
    const op = buildPlasticLipGrooveOp(validParams)
    expect(op).toEqual({
      kind: 'plastic_lip_groove',
      mode: 'lip',
      xMinMm: 0,
      xMaxMm: 50,
      yMinMm: 0,
      yMaxMm: 30,
      zBaseMm: 10,
      depthMm: 2
    })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('carries the groove mode through unchanged', () => {
    const op = buildPlasticLipGrooveOp({ ...validParams, mode: 'groove' })
    expect(op).toMatchObject({ kind: 'plastic_lip_groove', mode: 'groove' })
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toMatchObject({ kind: 'plastic_lip_groove', mode: 'groove' })
  })

  it('round-trips negative/zero footprint coordinates and a signed Z base', () => {
    const op = buildPlasticLipGrooveOp({
      mode: 'groove',
      xMinMm: -20,
      xMaxMm: 20,
      yMinMm: -15,
      yMaxMm: 0,
      zBaseMm: -3.5,
      depthMm: 1.25
    })
    const parsed = kernelPostSolidOpSchema.parse(op)
    expect(parsed).toMatchObject({
      kind: 'plastic_lip_groove',
      mode: 'groove',
      xMinMm: -20,
      xMaxMm: 20,
      yMinMm: -15,
      yMaxMm: 0,
      zBaseMm: -3.5,
      depthMm: 1.25
    })
  })

  it('carries no suppressed flag by default (timeline concern, not an opening default)', () => {
    expect(buildPlasticLipGrooveOp(validParams)).not.toHaveProperty('suppressed')
  })

  it('the schema rejects an unknown mode (the dialog enum is real)', () => {
    expect(() =>
      kernelPostSolidOpSchema.parse({
        ...validParams,
        kind: 'plastic_lip_groove',
        mode: 'flange'
      })
    ).toThrow()
  })

  it('the schema rejects a non-positive depth (the dialog gate is real)', () => {
    // depthMm is mmPos (finite + strictly positive); prove the schema would
    // reject what the dialog's parsePositiveMm gate already blocks before build.
    expect(() =>
      kernelPostSolidOpSchema.parse({
        kind: 'plastic_lip_groove',
        mode: 'lip',
        xMinMm: 0,
        xMaxMm: 50,
        yMinMm: 0,
        yMaxMm: 30,
        zBaseMm: 10,
        depthMm: 0
      })
    ).toThrow()
    expect(() =>
      kernelPostSolidOpSchema.parse({
        kind: 'plastic_lip_groove',
        mode: 'lip',
        xMinMm: 0,
        xMaxMm: 50,
        yMinMm: 0,
        yMaxMm: 30,
        zBaseMm: 10,
        depthMm: -2
      })
    ).toThrow()
  })
})
