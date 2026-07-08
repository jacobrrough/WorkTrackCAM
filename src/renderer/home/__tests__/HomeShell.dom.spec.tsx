/**
 * INTERACTIVE test (happy-dom) for the Home shell — real clicks the static
 * render pins can't reach: sidebar nav switches the content screen, and the
 * accent entry points (top-bar "New design", the Home quick-start tile, a
 * recent card, the sidebar machine card) enter the modeling workspace.
 * Run with `npm run test:dom`.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeShell } from '../HomeShell'

describe('HomeShell — interactive (happy-dom)', () => {
  it('lands on Home with the greeting visible', () => {
    render(<HomeShell onEnterWorkspace={() => {}} />)
    expect(screen.getByText('Good afternoon, Jacob')).toBeTruthy()
  })

  it('switches the content screen when a sidebar nav item is clicked', async () => {
    const user = userEvent.setup()
    render(<HomeShell onEnterWorkspace={() => {}} />)

    // Home → Files: greeting gone, Files screen shown, nav marks Files active.
    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.queryByText('Good afternoon, Jacob')).toBeNull()
    expect(screen.getByRole('button', { name: 'Files' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByText('bracket-mount.wtc')).toBeTruthy()

    // Files → Home again.
    await user.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.getByText('Good afternoon, Jacob')).toBeTruthy()
  })

  it('enters the workspace from the top-bar New design button', async () => {
    const user = userEvent.setup()
    const onEnter = vi.fn()
    render(<HomeShell onEnterWorkspace={onEnter} />)
    // Two "New design" entry points exist (top-bar action + quick-start tile);
    // the top-bar button is first in DOM order.
    const newDesign = screen.getAllByRole('button', { name: /New design/i })
    await user.click(newDesign[0])
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('enters the workspace from the Home quick-start "New design" tile', async () => {
    const user = userEvent.setup()
    const onEnter = vi.fn()
    render(<HomeShell onEnterWorkspace={onEnter} />)
    // The quick-start tile lives in the page body (distinct from the top-bar button).
    const tiles = screen.getAllByRole('button', { name: /New design/i })
    // Click the last match (the quick-start tile) — both entry points must work.
    await user.click(tiles[tiles.length - 1])
    expect(onEnter).toHaveBeenCalled()
  })

  it('enters the workspace from a recent-file card', async () => {
    const user = userEvent.setup()
    const onEnter = vi.fn()
    render(<HomeShell onEnterWorkspace={onEnter} />)
    await user.click(screen.getByText('bracket-mount'))
    expect(onEnter).toHaveBeenCalled()
  })

  it('routes "Open in Jobs" to the Jobs screen', async () => {
    const user = userEvent.setup()
    render(<HomeShell onEnterWorkspace={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Open in Jobs' }))
    expect(screen.getByText('Running now')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Jobs/ }).getAttribute('aria-current')).toBe('page')
  })

  it('enters the workspace from the sidebar machine card', async () => {
    const user = userEvent.setup()
    const onEnter = vi.fn()
    render(<HomeShell onEnterWorkspace={onEnter} />)
    await user.click(screen.getByTitle('Open the modeling workspace'))
    expect(onEnter).toHaveBeenCalledTimes(1)
  })

  it('keeps exactly one primary (accent) action in the shell chrome', () => {
    const { container } = render(<HomeShell onEnterWorkspace={() => {}} />)
    // One accent per screen: the New design button is the only ds-btn-primary,
    // and the On-the-machine PrimaryCard is the only accent surface.
    expect(container.querySelectorAll('.ds-btn-primary').length).toBe(1)
    expect(container.querySelectorAll('.ds-primary-card').length).toBe(1)
  })
})
