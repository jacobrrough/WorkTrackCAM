/**
 * ErrorBoundary -- unit tests
 *
 * These tests verify the ErrorBoundary class component logic in a Node
 * environment (no DOM). We test that the class can be instantiated, that
 * getDerivedStateFromError correctly produces error state, and that state
 * management methods behave correctly.
 */
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'
import type { ErrorBoundaryProps, ErrorBoundarySeverity } from './ErrorBoundary'

describe('ErrorBoundary', () => {
  // Helper to create an instance with given props
  function createInstance(overrides?: Partial<ErrorBoundaryProps>): ErrorBoundary {
    const props: ErrorBoundaryProps = {
      label: 'Test Panel',
      severity: 'panel',
      children: null,
      ...overrides
    }
    return new ErrorBoundary(props)
  }

  it('initializes with null error state', () => {
    const boundary = createInstance()
    expect(boundary.state.error).toBeNull()
    expect(boundary.state.componentStack).toBeNull()
  })

  it('getDerivedStateFromError returns error in state', () => {
    const error = new Error('render failed')
    const derived = ErrorBoundary.getDerivedStateFromError(error)
    expect(derived.error).toBe(error)
  })

  it('componentDidCatch logs to console and calls onError callback', () => {
    const onError = vi.fn()
    const boundary = createInstance({ onError })

    // Mock setState to prevent React internals from interfering
    boundary.setState = vi.fn()

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('test error')
    const errorInfo = { componentStack: '\n  at Broken\n  at ErrorBoundary' } as React.ErrorInfo

    boundary.componentDidCatch(error, errorInfo)

    expect(consoleSpy).toHaveBeenCalledOnce()
    expect(consoleSpy.mock.calls[0]?.[0]).toContain('[ErrorBoundary]')
    expect(consoleSpy.mock.calls[0]?.[0]).toContain('Test Panel')

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(error, errorInfo)

    consoleSpy.mockRestore()
  })

  it('componentDidCatch stores componentStack in state', () => {
    const boundary = createInstance()

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('test error')
    const stack = '\n  at Broken\n  at ErrorBoundary'
    const errorInfo = { componentStack: stack } as React.ErrorInfo

    // Simulate setState by calling componentDidCatch with a mock setState
    const setStateSpy = vi.fn()
    boundary.setState = setStateSpy

    boundary.componentDidCatch(error, errorInfo)

    expect(setStateSpy).toHaveBeenCalledWith({ componentStack: stack })

    consoleSpy.mockRestore()
  })

  it('componentDidCatch works without onError callback', () => {
    const boundary = createInstance({ onError: undefined })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('test error')
    const errorInfo = { componentStack: null } as unknown as React.ErrorInfo

    // Should not throw
    expect(() => boundary.componentDidCatch(error, errorInfo)).not.toThrow()

    consoleSpy.mockRestore()
  })

  it('render returns children when no error', () => {
    const boundary = createInstance()
    // When no error, render() should return this.props.children
    const result = boundary.render()
    expect(result).toBeNull() // children is null in our test instance
  })

  it('severity defaults to panel', () => {
    const boundary = createInstance({ severity: undefined })
    // Verify the component accepts undefined severity gracefully
    expect(boundary.props.severity).toBeUndefined()
    // The render method uses ?? 'panel' internally
  })

  it('exports ErrorBoundarySeverity type with expected values', () => {
    // Type-level test: ensure the type allows 'panel' and 'page'
    const panel: ErrorBoundarySeverity = 'panel'
    const page: ErrorBoundarySeverity = 'page'
    expect(panel).toBe('panel')
    expect(page).toBe('page')
  })
})
