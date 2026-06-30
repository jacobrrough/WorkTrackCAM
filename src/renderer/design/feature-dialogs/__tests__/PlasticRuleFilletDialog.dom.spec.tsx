/**
 * INTERACTIVE test (happy-dom) for the Rule Fillet dialog (`plastic_rule_fillet`):
 * renders the real dialog, types a radius, clicks Apply, and asserts the EXACT
 * emitted kernel-op payload — the behavioural check source pins can never prove.
 * Mirrors `ExtrudeDialog.dom.spec.tsx`; see the `wire-feature-dialog` skill.
 * Run with `npx vitest run -c vitest.dom.config.ts <this file>`.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlasticRuleFilletDialog } from '../PlasticRuleFilletDialog'

const baseProps = {
  selectionInfo: { selection: null, label: null },
  busy: false,
  disabled: false
} as const

describe('PlasticRuleFilletDialog — interactive (happy-dom)', () => {
  it('emits the EXACT plastic_rule_fillet kernel op for the typed radius', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PlasticRuleFilletDialog params={{ radiusMm: 2 }} onApply={onApply} {...baseProps} />)

    const radius = screen.getByTestId('fd-plastic_rule_fillet-radius')
    await user.clear(radius)
    await user.type(radius, '3.5')
    await user.click(screen.getByTestId('fd-plastic_rule_fillet-apply'))

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'plastic_rule_fillet', radiusMm: 3.5 }
    })
  })

  it('carries the opening radius unchanged when Apply is clicked without edits', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PlasticRuleFilletDialog params={{ radiusMm: 1.25 }} onApply={onApply} {...baseProps} />)

    await user.click(screen.getByTestId('fd-plastic_rule_fillet-apply'))

    expect(onApply).toHaveBeenCalledWith({
      target: 'kernelOp',
      op: { kind: 'plastic_rule_fillet', radiusMm: 1.25 }
    })
  })

  it('gates Apply on a non-positive radius (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PlasticRuleFilletDialog params={{ radiusMm: 2 }} onApply={onApply} {...baseProps} />)

    const radius = screen.getByTestId('fd-plastic_rule_fillet-radius')
    await user.clear(radius)
    await user.type(radius, '0')
    await user.click(screen.getByTestId('fd-plastic_rule_fillet-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })

  it('gates Apply when the radius field is cleared (no emit)', async () => {
    const user = userEvent.setup()
    const onApply = vi.fn()
    render(<PlasticRuleFilletDialog params={{ radiusMm: 2 }} onApply={onApply} {...baseProps} />)

    const radius = screen.getByTestId('fd-plastic_rule_fillet-radius')
    await user.clear(radius)
    await user.click(screen.getByTestId('fd-plastic_rule_fillet-apply'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
