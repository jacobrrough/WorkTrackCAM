/**
 * ErrorBoundary -- reusable React error boundary with recovery UI.
 *
 * Features:
 *   - Catches render/lifecycle errors in children
 *   - Shows a friendly error panel with error summary, "Try Again" and "Copy Error" buttons
 *   - Two severity modes: 'panel' (inline, contained) and 'page' (full-page fallback)
 *   - Logs errors to console with component stack
 *   - Optional `onError` callback prop
 *
 * Usage:
 *   <ErrorBoundary label="3D Viewport" severity="panel">
 *     <ShopModelViewer ... />
 *   </ErrorBoundary>
 *
 *   <ErrorBoundary label="Application" severity="page">
 *     <App />
 *   </ErrorBoundary>
 */
import React from 'react'

/** Severity controls the visual treatment of the error fallback. */
export type ErrorBoundarySeverity = 'panel' | 'page'

export interface ErrorBoundaryProps {
  /** Human-readable name for the panel -- shown in the error message */
  label: string
  /** Visual treatment: 'panel' = inline contained, 'page' = full-page fallback */
  severity?: ErrorBoundarySeverity
  /** Optional callback when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { error: null, componentStack: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const stack = info.componentStack ?? null
    this.setState({ componentStack: stack })

    console.error(
      `[ErrorBoundary] "${this.props.label}" threw:`,
      error,
      stack ? `\nComponent stack:${stack}` : ''
    )

    this.props.onError?.(error, info)
  }

  private handleRetry = (): void => {
    this.setState({ error: null, componentStack: null })
  }

  private handleCopyError = (): void => {
    const { error, componentStack } = this.state
    if (!error) return

    const parts: string[] = [
      `Error in "${this.props.label}":`,
      error.message ?? String(error),
    ]
    if (error.stack) {
      parts.push('', 'Stack trace:', error.stack)
    }
    if (componentStack) {
      parts.push('', 'Component stack:', componentStack)
    }

    const text = parts.join('\n')
    void navigator.clipboard.writeText(text).catch(() => {
      // Clipboard API may be unavailable in some contexts; swallow silently.
    })
  }

  render(): React.ReactNode {
    if (this.state.error === null) {
      return this.props.children
    }

    const severity = this.props.severity ?? 'panel'
    const msg = this.state.error.message ?? String(this.state.error)
    const rootClass = severity === 'page'
      ? 'error-boundary error-boundary--page'
      : 'error-boundary error-boundary--panel'

    return (
      <div className={rootClass} role="alert">
        <span className="error-boundary__icon" aria-hidden="true">
          {severity === 'page' ? '\u26A0' : '\u26A0'}
        </span>
        <p className="error-boundary__title">
          {severity === 'page' ? 'Something went wrong' : 'Panel error'}
        </p>
        <p className="error-boundary__subtitle">
          {severity === 'page'
            ? `The application encountered an unexpected error in "${this.props.label}".`
            : `The ${this.props.label} panel encountered an error.`}
        </p>
        <details className="error-boundary__details">
          <summary className="error-boundary__summary">Show error details</summary>
          <pre className="error-boundary__msg">{msg}</pre>
        </details>
        <div className="error-boundary__actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={this.handleRetry}
          >
            Try Again
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={this.handleCopyError}
          >
            Copy Error
          </button>
          {severity === 'page' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => window.location.reload()}
            >
              Reload App
            </button>
          )}
        </div>
      </div>
    )
  }
}
