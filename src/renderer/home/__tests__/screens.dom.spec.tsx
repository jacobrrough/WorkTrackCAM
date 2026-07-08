/**
 * INTERACTIVE tests (happy-dom) for the five app screens, driven through the
 * real HomeShell sidebar routing — the runtime path a user takes. Covers screen
 * switching plus each screen's own interactions (chip filter, tab switch, row
 * select, segmented + toggle). Run with `npm run test:dom`.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HomeShell } from '../HomeShell'

const openShell = (onEnter: () => void = () => {}) => {
  const user = userEvent.setup()
  render(<HomeShell onEnterWorkspace={onEnter} />)
  return user
}

describe('HomeShell — sidebar routes to each screen', () => {
  it('navigates Home → Files/Templates/Machine/Jobs/Settings', async () => {
    const user = openShell()
    await user.click(screen.getByRole('button', { name: 'Files' }))
    expect(screen.getByText('bracket-mount.wtc')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Templates' }))
    expect(screen.getByText('Parametric Enclosure')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Machine' }))
    expect(screen.getByText('Run calibration')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /^Jobs/ }))
    expect(screen.getByText('Running now')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText('Coordinate readout')).toBeTruthy()
  })
})

describe('Files screen', () => {
  it('selects a row on click and highlights the active folder', async () => {
    const user = openShell()
    await user.click(screen.getByRole('button', { name: 'Files' }))

    const row = screen.getByText('enclosure-lid.wtc').closest('.wt-files__row') as HTMLElement
    expect(row.className).not.toContain('is-selected')
    await user.click(row)
    expect(row.className).toContain('is-selected')

    await user.click(screen.getByRole('button', { name: /All files/ }))
    expect(screen.getByRole('button', { name: /All files/ }).getAttribute('aria-current')).toBe('true')
  })
})

describe('Templates screen', () => {
  it('filters cards by category chip', async () => {
    const user = openShell()
    await user.click(screen.getByRole('button', { name: 'Templates' }))
    expect(screen.getByText('Spur Gear')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Brackets' }))
    expect(screen.getByText('L-Bracket')).toBeTruthy()
    expect(screen.queryByText('Spur Gear')).toBeNull() // filtered out
  })

  it('enters the workspace from "Use template"', async () => {
    const onEnter = vi.fn()
    const user = openShell(onEnter)
    await user.click(screen.getByRole('button', { name: 'Templates' }))
    await user.click(screen.getAllByRole('button', { name: 'Use template' })[0])
    expect(onEnter).toHaveBeenCalled()
  })
})

describe('Jobs screen', () => {
  it('toggles between Queue and History tabs', async () => {
    const user = openShell()
    await user.click(screen.getByRole('button', { name: /^Jobs/ }))
    expect(screen.getByText('enclosure-lid.nc')).toBeTruthy() // queue default

    await user.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByText('gear-24t.nc')).toBeTruthy()
    expect(screen.queryByText('enclosure-lid.nc')).toBeNull()
  })
})

describe('Settings screen', () => {
  it('switches the Units segmented control and flips the coordinate toggle', async () => {
    const user = openShell()
    await user.click(screen.getByRole('button', { name: 'Settings' }))

    const inches = screen.getByRole('radio', { name: 'Inches' })
    expect(inches.getAttribute('aria-checked')).toBe('false')
    await user.click(inches)
    expect(inches.getAttribute('aria-checked')).toBe('true')

    const toggle = screen.getByRole('switch', { name: 'Coordinate readout' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await user.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })

  it('applies a real theme to <html data-theme> when a theme swatch is clicked', async () => {
    const user = openShell()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Neon Shop' }))
    expect(document.documentElement.dataset.theme).toBe('neon')
    expect(screen.getByRole('button', { name: 'Neon Shop' }).getAttribute('aria-pressed')).toBe('true')
  })
})
