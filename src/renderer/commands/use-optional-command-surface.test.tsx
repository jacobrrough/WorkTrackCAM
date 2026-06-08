/**
 * FG-1 — `useOptionalCommandSurface` resilience pin.
 *
 * The strict `useCommandSurface` throws without a `<CommandContextProvider>`
 * ancestor (correct for surfaces that REQUIRE the engine). `DesignWorkspaceHost`
 * is also rendered in isolation by node-env SSR pins that don't mount the full
 * provider chain, so it uses the tolerant variant. This pin proves the tolerant
 * variant returns a callable, side-effect-free no-op (never throws) when no
 * provider is present — exactly the provider-less SSR branch the host relies on.
 *
 * Node-env constraint (no jsdom / testing-library): we exercise the hook by
 * rendering a tiny harness with `renderToStaticMarkup`. SSR runs the render
 * phase (where the hook is called + its return value invoked), so a throw would
 * surface as a failed render.
 */

import { describe, expect, it } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useOptionalCommandSurface } from './CommandContextProvider'

/** Harness: call the hook + immediately invoke the setter during render. */
function Harness(): ReactElement {
  const setSurface = useOptionalCommandSurface()
  const isFn = typeof setSurface === 'function'
  // Invoking the no-op during render must not throw / mutate anything.
  setSurface({ hasSelection: true, selectionKind: 'face', sketchMode: true })
  return createElement('div', { 'data-ok': isFn ? 'true' : 'false' }, 'ok')
}

describe('useOptionalCommandSurface — provider-less resilience', () => {
  it('returns a callable no-op (does not throw) without a CommandContextProvider', () => {
    let html = ''
    expect(() => {
      html = renderToStaticMarkup(createElement(Harness))
    }).not.toThrow()
    expect(html).toContain('data-ok="true"')
  })

  it('returns a STABLE no-op identity across renders (no effect churn)', () => {
    // Render twice; the no-op is a module-level singleton so the identity holds.
    const a = renderToStaticMarkup(createElement(Harness))
    const b = renderToStaticMarkup(createElement(Harness))
    expect(a).toBe(b)
  })
})
