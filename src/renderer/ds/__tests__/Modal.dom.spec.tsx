/**
 * INTERACTIVE test (happy-dom) for the DS Modal port — the one primitive with
 * behaviour a static render pin can't reach (portal to document.body, Esc-close,
 * overlay-click-close, and stopPropagation on the dialog surface). Run with
 * `npm run test:dom`.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '../Modal'

describe('DS Modal — interactive (happy-dom)', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        <p>hi</p>
      </Modal>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('portals a .ds-scoped dialog to document.body when open', () => {
    render(
      <Modal open onClose={() => {}}>
        <p>body copy</p>
      </Modal>
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(dialog.className).toContain('ds-card')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // re-establishes the .ds scope outside the app subtree
    expect(document.body.querySelector('.ds .ds-modal-backdrop')).toBeTruthy()
  })

  it('closes on Escape by default', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose}>
        <p>x</p>
      </Modal>
    )
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closeOnEsc={false} ignores Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} closeOnEsc={false}>
        <p>x</p>
      </Modal>
    )
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on backdrop click but not on dialog-body click', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} labelledBy="t">
        <p data-testid="inner">x</p>
      </Modal>
    )
    await user.click(screen.getByTestId('inner'))
    expect(onClose).not.toHaveBeenCalled()

    const backdrop = document.body.querySelector('.ds-modal-backdrop') as HTMLElement
    await user.click(backdrop)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
