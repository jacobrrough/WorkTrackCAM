/**
 * WorkspaceErrorBoundary — unit tests.
 *
 * Verifies the class-component catch→fallback path in the repo's Node test
 * environment (no DOM — see vitest.config.ts `environment: 'node'`). React
 * error boundaries only commit their fallback in a real DOM, so — exactly like
 * the sibling `ErrorBoundary.test.ts` — we exercise the boundary's logic
 * directly: instantiate it, drive `getDerivedStateFromError` / `componentDidCatch`,
 * and statically render the fallback to lock the recovery UI.
 *
 * This is the reachability proof for the boundary now wired into
 * `WorkspaceHost` (it formerly white-screened the whole shell on any uncaught
 * workspace render error).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ErrorInfo } from 'react'
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary'

describe('WorkspaceErrorBoundary', () => {
  function createInstance(label = 'Manufacture'): WorkspaceErrorBoundary {
    return new WorkspaceErrorBoundary({ label, children: null })
  }

  it('initializes with null error state (renders children when healthy)', () => {
    const boundary = createInstance()
    expect(boundary.state.error).toBeNull()
    // With no error, render() returns this.props.children (null in this instance).
    expect(boundary.render()).toBeNull()
  })

  it('getDerivedStateFromError captures the thrown error into state', () => {
    const error = new Error('workspace blew up')
    const derived = WorkspaceErrorBoundary.getDerivedStateFromError(error)
    expect(derived.error).toBe(error)
  })

  it('componentDidCatch logs the panel label without throwing', () => {
    const boundary = createInstance('Design')
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('boom')
    const info = { componentStack: '\n  at Broken\n  at WorkspaceErrorBoundary' } as ErrorInfo

    expect(() => boundary.componentDidCatch(error, info)).not.toThrow()
    expect(consoleSpy).toHaveBeenCalledOnce()
    expect(consoleSpy.mock.calls[0]?.[0]).toContain('[WorkspaceErrorBoundary]')
    expect(consoleSpy.mock.calls[0]?.[0]).toContain('Design')

    consoleSpy.mockRestore()
  })

  it('renders the recoverable fallback (not a blank screen) once an error is caught', () => {
    // Mirror what React does on a caught error: getDerivedStateFromError feeds
    // the new state, then render() produces the fallback. renderToStaticMarkup
    // does NOT invoke an error boundary's catch in SSR, so we prime the instance
    // with the derived state and statically render the element render() returns.
    const boundary = createInstance('Manufacture')
    const error = new Error('viewport crashed')
    boundary.state = WorkspaceErrorBoundary.getDerivedStateFromError(error)

    const fallback = boundary.render()
    const html = renderToStaticMarkup(createElement(Fragment, null, fallback))

    expect(html).toContain('role="alert"')
    expect(html).toContain('Something went wrong')
    expect(html).toContain('The Manufacture panel encountered an unexpected error.')
    // The thrown message is surfaced in the details block.
    expect(html).toContain('viewport crashed')
    // Both recovery affordances are present.
    expect(html).toContain('Try again')
    expect(html).toContain('Reload app')
  })

  it('Try again clears the error so the next render shows children again', () => {
    const boundary = createInstance()
    // Simulate a caught error landing in state.
    Object.assign(boundary.state, { error: new Error('transient') })
    expect(boundary.render()).not.toBeNull()

    // handleRetry is a private field; drive it through setState like React would.
    const setStateSpy = vi.fn((patch: { error: Error | null }) => {
      Object.assign(boundary.state, patch)
    })
    boundary.setState = setStateSpy as unknown as typeof boundary.setState

    // Click the "Try again" button's handler.
    ;(boundary as unknown as { handleRetry: () => void }).handleRetry()
    expect(setStateSpy).toHaveBeenCalledWith({ error: null })
    // After the retry, the boundary is healthy again and renders children.
    expect(boundary.render()).toBeNull()
  })
})
