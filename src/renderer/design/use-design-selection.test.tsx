/**
 * FG-5a · `useDesignSelection` hook contract pin.
 *
 * Environment note (mirrors DesignWorkspace.selection.test.tsx): the vitest
 * pool is `node` with no jsdom and no test renderer, so we exercise the hook
 * via `renderToStaticMarkup` (one-shot SSR). SSR runs the RENDER phase — so
 * `useState` seeding, `useMemo` derivations, the returned API shape, and
 * correct composition under the real provider chain are all validated — but it
 * does NOT run effects. The effect-driven push into the command surface is
 * covered separately by:
 *   - `selection-state.test.ts` → `selectionToSurface` (the exact payload the
 *     hook's effect dispatches), and
 *   - `commands/command-engine.test.ts` → the provider's `setSurface` de-dup.
 *
 * Pinned contracts:
 *   1. The hook composes under the real Toast → MachineSession → Command
 *      provider chain without throwing (it reads `useCommandSurface`).
 *   2. A `null` seed yields `hasSelection=false` and no `selectionKind`.
 *   3. A face/edge seed flows through to `selection` / `hasSelection` /
 *      `selectionKind` synchronously (no click, no effect needed).
 *   4. A typical render logs no errors or warnings.
 */

import { describe, expect, it } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ToastProvider } from '../contexts/ToastContext'
import { MachineSessionProvider } from '../contexts/MachineSessionContext'
import { CommandContextProvider } from '../commands'
import { useDesignSelection } from './use-design-selection'
import { makeEdgeSelection, makeFaceSelection, type Selection } from './selection-state'

/**
 * Render-prop probe: calls the hook and renders its derived state into the DOM
 * so the SSR string can be asserted. Each field gets a stable test id.
 */
function HookProbe({ seed }: { seed: Selection | null }): ReactElement {
  const api = useDesignSelection(seed)
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'has' }, String(api.hasSelection)),
    createElement('span', { 'data-testid': 'kind' }, api.selectionKind ?? 'none'),
    createElement('span', { 'data-testid': 'id' }, api.selection ? String(api.selection.faceId) : 'null'),
    // Callback identities exist (smoke): render their typeof.
    createElement('span', { 'data-testid': 'fns' }, [
      typeof api.select,
      typeof api.toggle,
      typeof api.clear
    ].join(','))
  )
}

/** Mount the probe under the real provider chain the running shell uses. */
function renderProbe(seed: Selection | null): string {
  return renderToStaticMarkup(
    createElement(
      ToastProvider,
      null,
      createElement(
        MachineSessionProvider,
        null,
        createElement(CommandContextProvider, {
          workspace: 'design',
          onNavigate: () => {},
          children: createElement(HookProbe, { seed })
        })
      )
    )
  )
}

describe('useDesignSelection — composition + synchronous contract', () => {
  it('renders under the real provider chain without throwing', () => {
    expect(() => renderProbe(null)).not.toThrow()
  })

  it('a null seed yields hasSelection=false and no selectionKind', () => {
    const html = renderProbe(null)
    expect(html).toContain('data-testid="has">false<')
    expect(html).toContain('data-testid="kind">none<')
    expect(html).toContain('data-testid="id">null<')
  })

  it('a face seed flows through to selection / hasSelection / selectionKind', () => {
    const html = renderProbe(makeFaceSelection(4))
    expect(html).toContain('data-testid="has">true<')
    expect(html).toContain('data-testid="kind">face<')
    expect(html).toContain('data-testid="id">4<')
  })

  it('an edge seed carries the edge discriminator (hook drives all kinds)', () => {
    const html = renderProbe(makeEdgeSelection(9))
    expect(html).toContain('data-testid="has">true<')
    expect(html).toContain('data-testid="kind">edge<')
    expect(html).toContain('data-testid="id">9<')
  })

  it('exposes select / toggle / clear as callable functions', () => {
    const html = renderProbe(null)
    expect(html).toContain('data-testid="fns">function,function,function<')
  })

  it('does NOT throw or log warnings/errors on a typical render', () => {
    const errs: unknown[] = []
    const warns: unknown[] = []
    const origErr = console.error
    const origWarn = console.warn
    console.error = ((...args: unknown[]) => { errs.push(args) }) as typeof console.error
    console.warn = ((...args: unknown[]) => { warns.push(args) }) as typeof console.warn
    try {
      renderProbe(makeFaceSelection(1))
      expect(errs).toEqual([])
      expect(warns).toEqual([])
    } finally {
      console.error = origErr
      console.warn = origWarn
    }
  })
})
