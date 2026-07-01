/**
 * ViewportContextMenu — INTERACTIVE behaviour spec (happy-dom).
 *
 * The node suite proves the pure halves (drag threshold, entry derivation,
 * source-pinned wiring); this spec proves the parts only a real DOM can:
 *   - a `contextmenu` event with negligible pointer travel RENDERS the menu
 *     with the expected entries for a FACE selection (and a right-drag pan
 *     release does NOT),
 *   - focus moves into the menu on open and arrow keys rove it,
 *   - ESC closes without dispatching,
 *   - activating an entry fires the REAL dispatch path (`CommandRegistry.run`
 *     → the registered `DesignCommandActions`, exactly like the ribbon) and
 *     closes the menu.
 *
 * The harness mirrors `DesignWorkspace`'s wiring 1:1 (recorded right-button
 * pointerdown + threshold-gated contextmenu + snapshot-derived entries +
 * registry dispatch on activate) around a plain div standing in for the
 * WebGL viewport, which happy-dom cannot mount. Run with `npm run test:dom`
 * or `npx vitest run --config vitest.dom.config.ts <this file>`.
 */

import { useRef, useState } from 'react'
import type { JSX } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViewportContextMenu } from '../ViewportContextMenu'
import {
  deriveViewportContextMenuItems,
  shouldOpenViewportContextMenu,
  type RightPointerDownSample,
  type ViewportContextMenuEntry
} from '../viewport-context-menu-items'
import {
  CommandRegistry,
  DEFAULT_COMMAND_CONTEXT,
  type CommandContext
} from '../../commands/command-engine'
import {
  registerDesignCommands,
  type DesignCommandActions
} from '../../commands/design-commands'
import type { SelectionSurface } from '../selection-state'

const FACE_SURFACE: SelectionSurface = { hasSelection: true, selectionKind: 'face' }
const DESIGN_CTX: CommandContext = { ...DEFAULT_COMMAND_CONTEXT, workspace: 'design' }

/**
 * Mirrors DesignWorkspace's seam: record right-button pointerdown, gate the
 * contextmenu event on the travel threshold, snapshot entries at open, and
 * dispatch activations through the registry (the ribbon's path).
 */
function Harness({
  registry,
  onClearSelection
}: {
  registry: CommandRegistry
  onClearSelection: () => void
}): JSX.Element {
  const downRef = useRef<RightPointerDownSample | null>(null)
  const [menu, setMenu] = useState<{
    readonly x: number
    readonly y: number
    readonly entries: readonly ViewportContextMenuEntry[]
  } | null>(null)

  return (
    <div style={{ position: 'relative' }}>
      <div
        data-testid="fake-viewport"
        onPointerDown={(e) => {
          if (e.button === 2) downRef.current = { x: e.clientX, y: e.clientY }
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          const down = downRef.current
          downRef.current = null
          if (!shouldOpenViewportContextMenu(down, { x: e.clientX, y: e.clientY })) return
          setMenu({
            x: e.clientX,
            y: e.clientY,
            entries: deriveViewportContextMenuItems({
              surface: FACE_SURFACE,
              projection: 'perspective',
              registry,
              ctx: DESIGN_CTX
            })
          })
        }}
      >
        viewport
      </div>
      {menu !== null && (
        <ViewportContextMenu
          anchor={{ x: menu.x, y: menu.y }}
          entries={menu.entries}
          onActivate={(entry) => {
            setMenu(null)
            if (entry.type === 'command') {
              registry.run(entry.commandId, DESIGN_CTX)
              return
            }
            if (entry.type === 'clear_selection') onClearSelection()
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

function setup(): {
  actions: DesignCommandActions
  onClearSelection: ReturnType<typeof vi.fn>
} {
  const actions: DesignCommandActions = {
    armSketchMode: vi.fn(),
    armSketchPlane: vi.fn(),
    disarmSketchMode: vi.fn(),
    armSketchTool: vi.fn(),
    openFeatureDialog: vi.fn(),
    runInspect: vi.fn()
  }
  const registry = new CommandRegistry()
  registerDesignCommands(actions, registry)
  const onClearSelection = vi.fn()
  render(<Harness registry={registry} onClearSelection={onClearSelection} />)
  return { actions, onClearSelection }
}

/** Right-click: pointerdown at (downX, downY), contextmenu release at (upX, upY). */
function rightClick(downX: number, downY: number, upX: number, upY: number): void {
  const viewport = screen.getByTestId('fake-viewport')
  fireEvent.pointerDown(viewport, { button: 2, clientX: downX, clientY: downY })
  fireEvent.contextMenu(viewport, { clientX: upX, clientY: upY })
}

describe('ViewportContextMenu — interactive (happy-dom)', () => {
  it('opens on a low-travel right-click with the face-selection entries', () => {
    setup()
    rightClick(120, 90, 121, 91)

    const menu = screen.getByRole('menu', { name: 'Viewport context menu' })
    expect(menu).toBeInTheDocument()
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(labels).toEqual([
      'Sketch on face',
      'Shell',
      'Press pull',
      'Clear selection',
      'Fit view',
      'Isometric view',
      'Top view',
      'Front view',
      'Right view',
      'Orthographic view'
    ])
  })

  it('does NOT open after a right-drag pan (travel beyond the threshold)', () => {
    setup()
    rightClick(120, 90, 190, 160)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves focus into the menu on open and roves it with arrow keys', async () => {
    const user = userEvent.setup()
    setup()
    rightClick(120, 90, 120, 90)

    expect(screen.getByTestId('viewport-context-menu-item-sk_choose_plane')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('viewport-context-menu-item-so_shell')).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByTestId('viewport-context-menu-item-so_press_pull')).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(screen.getByTestId('viewport-context-menu-item-sk_choose_plane')).toHaveFocus()
    // Wraps upward to the last entry.
    await user.keyboard('{ArrowUp}')
    expect(screen.getByTestId('viewport-context-menu-item-toggle_projection')).toHaveFocus()
  })

  it('ESC closes the menu without dispatching anything', async () => {
    const user = userEvent.setup()
    const { actions, onClearSelection } = setup()
    rightClick(120, 90, 120, 90)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(actions.openFeatureDialog).not.toHaveBeenCalled()
    expect(actions.armSketchPlane).not.toHaveBeenCalled()
    expect(onClearSelection).not.toHaveBeenCalled()
  })

  it('activating Shell dispatches through the registry (ribbon path) and closes', async () => {
    const user = userEvent.setup()
    const { actions } = setup()
    rightClick(120, 90, 120, 90)

    await user.click(screen.getByTestId('viewport-context-menu-item-so_shell'))
    expect(actions.openFeatureDialog).toHaveBeenCalledWith('so_shell')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('activating Sketch on face arms the sketch-plane pick (sk_choose_plane)', async () => {
    const user = userEvent.setup()
    const { actions } = setup()
    rightClick(120, 90, 120, 90)

    await user.click(screen.getByTestId('viewport-context-menu-item-sk_choose_plane'))
    expect(actions.armSketchPlane).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('activating Clear selection fires the workspace-local action and closes', async () => {
    const user = userEvent.setup()
    const { onClearSelection } = setup()
    rightClick(120, 90, 120, 90)

    await user.click(screen.getByTestId('viewport-context-menu-item-clear_selection'))
    expect(onClearSelection).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('click-away (pointerdown outside the menu) dismisses it', () => {
    setup()
    rightClick(120, 90, 120, 90)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
