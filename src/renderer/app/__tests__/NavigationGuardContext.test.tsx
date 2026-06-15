/**
 * NavigationGuardContext — render + registry-semantics pins.
 *
 * The renderer test env is `node` (no jsdom / @testing-library), so effects do
 * NOT run under `renderToStaticMarkup`. We capture the live API synchronously
 * during a render (a render-phase grab into a closure) and exercise the ref-Map
 * registry imperatively — the registry is plain ref mutation + synchronous reads,
 * so it is fully testable without committing/mounting.
 *
 * Pins:
 *   - the provider-less default is a SAFE no-op (`hasUnsavedChanges()` → false,
 *     register/unregister are inert) — the convention that keeps the many bare
 *     workspace render-pins passing (mirrors useOptionalCommandSurface);
 *   - with a provider, a registered dirty-probe is reflected by
 *     `hasUnsavedChanges()`, multiple probes OR together, unregister removes a
 *     probe, and a throwing probe is swallowed (never wedges navigation).
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  NavigationGuardProvider,
  useNavigationGuard,
  type NavigationGuardApi
} from '../NavigationGuardContext'

/** Grab the live API by rendering a probe component under the provider. */
function captureApi(withProvider: boolean): NavigationGuardApi {
  let captured: NavigationGuardApi | null = null
  function Probe(): null {
    captured = useNavigationGuard()
    return null
  }
  const tree = withProvider
    ? createElement(NavigationGuardProvider, null, createElement(Probe))
    : createElement(Probe)
  renderToStaticMarkup(tree)
  if (!captured) throw new Error('API not captured')
  return captured
}

describe('useNavigationGuard — provider-less default (no-op, provider-tolerant)', () => {
  it('hasUnsavedChanges() is false with no provider', () => {
    const api = captureApi(false)
    expect(api.hasUnsavedChanges()).toBe(false)
  })

  it('register / unregister are inert no-ops with no provider (never throw)', () => {
    const api = captureApi(false)
    expect(() => api.register('x', () => true)).not.toThrow()
    // Even after a "register", the no-op registry stays clean.
    expect(api.hasUnsavedChanges()).toBe(false)
    expect(() => api.unregister('x')).not.toThrow()
  })
})

describe('NavigationGuardProvider — ref-Map registry semantics', () => {
  it('a registered dirty probe is reflected by hasUnsavedChanges()', () => {
    const api = captureApi(true)
    expect(api.hasUnsavedChanges()).toBe(false)
    api.register('mfg', () => true)
    expect(api.hasUnsavedChanges()).toBe(true)
  })

  it('a registered CLEAN probe keeps hasUnsavedChanges() false', () => {
    const api = captureApi(true)
    api.register('mfg', () => false)
    expect(api.hasUnsavedChanges()).toBe(false)
  })

  it('reads the probe LIVE each call (a probe flipping to dirty is picked up)', () => {
    const api = captureApi(true)
    let dirty = false
    api.register('mfg', () => dirty)
    expect(api.hasUnsavedChanges()).toBe(false)
    dirty = true
    expect(api.hasUnsavedChanges()).toBe(true)
  })

  it('multiple probes OR together (any dirty → dirty)', () => {
    const api = captureApi(true)
    api.register('a', () => false)
    api.register('b', () => true)
    expect(api.hasUnsavedChanges()).toBe(true)
  })

  it('unregister removes a probe (back to clean)', () => {
    const api = captureApi(true)
    api.register('mfg', () => true)
    expect(api.hasUnsavedChanges()).toBe(true)
    api.unregister('mfg')
    expect(api.hasUnsavedChanges()).toBe(false)
  })

  it('re-registering the same id REPLACES the prior probe', () => {
    const api = captureApi(true)
    api.register('mfg', () => true)
    api.register('mfg', () => false)
    expect(api.hasUnsavedChanges()).toBe(false)
  })

  it('a throwing probe is swallowed and treated as clean (never wedges nav)', () => {
    const api = captureApi(true)
    api.register('boom', () => {
      throw new Error('probe blew up')
    })
    expect(() => api.hasUnsavedChanges()).not.toThrow()
    expect(api.hasUnsavedChanges()).toBe(false)
  })

  it('a throwing probe does not mask a sibling dirty probe', () => {
    const api = captureApi(true)
    api.register('boom', () => {
      throw new Error('nope')
    })
    api.register('mfg', () => true)
    expect(api.hasUnsavedChanges()).toBe(true)
  })
})
