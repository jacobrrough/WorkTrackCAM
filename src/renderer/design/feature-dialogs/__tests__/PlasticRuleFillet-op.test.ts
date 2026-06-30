/**
 * Pure op-builder test for the Rule Fillet dialog.
 *
 * The contract that matters: `buildPlasticRuleFilletOp(...)` must emit an op the
 * REAL `kernelPostSolidOpSchema` accepts, because that op is persisted into
 * `part/features.json` `kernelOps[]` and replayed by a Build STEP (CLAUDE.md
 * Safety Rule 1 — a kernel op the schema would reject corrupts the timeline).
 * Pure function, no React/DOM → runs in the node vitest env.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildPlasticRuleFilletOp } from '../PlasticRuleFilletDialog'

describe('buildPlasticRuleFilletOp emits a schema-valid kernel op', () => {
  it('builds the exact plastic_rule_fillet op for a positive radius', () => {
    const op = buildPlasticRuleFilletOp(2.5)
    expect(op).toEqual({ kind: 'plastic_rule_fillet', radiusMm: 2.5 })
    expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
  })

  it('round-trips through the real schema across a range of radii', () => {
    for (const r of [0.1, 1, 3.75, 12, 250]) {
      const op = buildPlasticRuleFilletOp(r)
      expect(op).toEqual({ kind: 'plastic_rule_fillet', radiusMm: r })
      const parsed = kernelPostSolidOpSchema.parse(op)
      expect(parsed).toMatchObject({ kind: 'plastic_rule_fillet', radiusMm: r })
    }
  })

  it('carries no suppressed flag by default (timeline concern, not an opening default)', () => {
    expect(buildPlasticRuleFilletOp(1)).not.toHaveProperty('suppressed')
  })

  it('the schema rejects a non-positive radius (the dialog gate is real)', () => {
    // mmPos is finite + strictly positive; prove the schema would reject what the
    // dialog's parsePositiveMm gate already blocks before any build call.
    expect(() =>
      kernelPostSolidOpSchema.parse({ kind: 'plastic_rule_fillet', radiusMm: 0 })
    ).toThrow()
    expect(() =>
      kernelPostSolidOpSchema.parse({ kind: 'plastic_rule_fillet', radiusMm: -3 })
    ).toThrow()
  })
})
