/**
 * Interactive proof (happy-dom) that Phase-3 named user parameters are live
 * END-TO-END in the running Design workspace: mounts the REAL
 * `DesignSessionProvider` (no hand-built session value) around
 * `DesignWorkspaceHost`, types a parameter into the FeatureTree add row, and
 * asserts the row appears with its RESOLVED value — the loop
 * (FeatureTree gesture → session method → design-schema op → expression-eval
 * resolve → deriveUserParameterViews → re-render) that the node-env render
 * pins can never exercise. Run with `npm run test:dom`.
 *
 * `projectDir={null}` keeps the provider inert on the IPC side (nothing loads
 * from disk, and the parameter gestures are pure in-memory design edits). The
 * workspace itself needs two shims to reach its cockpit in happy-dom:
 *   - a non-empty `initialScript` (an empty script renders the "Start a
 *     parametric design" EmptyState, not the cockpit that hosts the
 *     FeatureTree), which arms the debounced `cad.listOperations` refresh —
 *     stubbed on `window.fab` to return an empty operations list;
 *   - Monaco stubbed out — happy-dom has a `window`, so CadQueryEditor would
 *     otherwise mount the real editor, whose loader never settles outside a
 *     browser.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DesignSessionProvider } from '../../design/DesignSessionContext'
import DesignWorkspaceHost from '../DesignWorkspaceHost'

vi.mock('@monaco-editor/react', () => ({
  default: () => <div data-testid="monaco-editor-stub" />
}))

const fabStub = {
  cad: {
    listOperations: async () => ({
      ok: true,
      result: { operations: [], parameters: [], parseError: null }
    })
  }
}

beforeEach(() => {
  ;(window as unknown as { fab: unknown }).fab = fabStub
})

function mountHost(): void {
  render(
    <DesignSessionProvider projectDir={null}>
      <DesignWorkspaceHost
        initialScript={'result = cq.Workplane("XY").box(10, 10, 10)'}
        onSave={() => {}}
        onSendToCam={() => {}}
        onToast={() => {}}
      />
    </DesignSessionProvider>
  )
}

/** The row for `name`, or throw (rows carry data-param-name). */
function paramRow(name: string): HTMLElement {
  const row = screen
    .getAllByTestId('cad-user-param-row')
    .find((r) => r.getAttribute('data-param-name') === name)
  if (!row) throw new Error(`no user-parameter row named '${name}'`)
  return row
}

async function addParameter(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  expression: string
): Promise<void> {
  await user.type(screen.getByTestId('cad-user-param-new-name'), name)
  await user.type(screen.getByTestId('cad-user-param-new-expr'), expression)
  await user.click(screen.getByTestId('cad-user-param-add'))
}

describe('DesignWorkspaceHost — named user parameters (interactive, real provider)', () => {
  it('shows the Parameters section with the add row even when empty', () => {
    mountHost()
    expect(screen.getByTestId('cad-user-params')).toBeInTheDocument()
    expect(screen.getByTestId('cad-user-param-new-name')).toBeInTheDocument()
    expect(screen.getByTestId('cad-user-param-new-expr')).toBeInTheDocument()
    expect(screen.queryAllByTestId('cad-user-param-row')).toHaveLength(0)
  })

  it('typing a new parameter into the add row creates a row with the resolved value', async () => {
    const user = userEvent.setup()
    mountHost()

    await addParameter(user, 'plateW', '25 + 5')

    const row = paramRow('plateW')
    expect(within(row).getByTestId('cad-user-param-value')).toHaveTextContent('= 30')
    // The add row cleared, ready for the next entry.
    expect(screen.getByTestId('cad-user-param-new-name')).toHaveValue('')
    expect(screen.getByTestId('cad-user-param-new-expr')).toHaveValue('')
  })

  it('a second parameter can reference the first by name and resolves through it', async () => {
    const user = userEvent.setup()
    mountHost()

    await addParameter(user, 'plateW', '30')
    await addParameter(user, 'half', 'plateW / 2')

    expect(within(paramRow('half')).getByTestId('cad-user-param-value')).toHaveTextContent('= 15')
  })

  it('an unresolvable expression surfaces the per-row error instead of a value', async () => {
    const user = userEvent.setup()
    mountHost()

    await addParameter(user, 'broken', 'missing + 1')

    const row = paramRow('broken')
    expect(row).toHaveAttribute('data-param-error', 'true')
    expect(within(row).getByTestId('cad-user-param-error')).toHaveTextContent(
      "Unknown parameter 'missing'"
    )
    expect(within(row).queryByTestId('cad-user-param-value')).toBeNull()
  })

  it('editing a row expression on blur re-resolves the value', async () => {
    const user = userEvent.setup()
    mountHost()

    await addParameter(user, 'plateW', '30')
    const expr = within(paramRow('plateW')).getByTestId('cad-user-param-expr')
    await user.clear(expr)
    await user.type(expr, '40 + 2')
    await user.tab() // blur commits

    expect(within(paramRow('plateW')).getByTestId('cad-user-param-value')).toHaveTextContent(
      '= 42'
    )
  })

  it('deleting a row removes it', async () => {
    const user = userEvent.setup()
    mountHost()

    await addParameter(user, 'plateW', '30')
    await user.click(within(paramRow('plateW')).getByTestId('cad-user-param-delete'))

    expect(screen.queryAllByTestId('cad-user-param-row')).toHaveLength(0)
  })
})
