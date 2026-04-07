/**
 * WorkspaceErrorBoundary — catches render/lifecycle errors in a workspace panel
 * and shows a recovery UI instead of crashing the whole app.
 *
 * Usage:
 *   <WorkspaceErrorBoundary label="3D Viewport">
 *     <ShopModelViewer ... />
 *   </WorkspaceErrorBoundary>
 */
import React from 'react'

interface Props {
  /** Human-readable name for the panel — shown in the error message */
  label: string
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export class WorkspaceErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[WorkspaceErrorBoundary] Panel "${this.props.label}" threw:`, error, info.componentStack)
  }

  private handleRetry = (): void => {
    this.setState({ error: null })
  }

  render(): React.ReactNode {
    if (this.state.error === null) {
      return this.props.children
    }

    const msg = this.state.error.message ?? String(this.state.error)

    return (
      <div className="workspace-error" role="alert">
        <span className="workspace-error__icon" aria-hidden="true">⚠</span>
        <p className="workspace-error__title">Something went wrong</p>
        <p className="workspace-error__subtitle">The {this.props.label} panel encountered an unexpected error.</p>
        <details className="workspace-error__details">
          <summary className="workspace-error__summary">Show error details</summary>
          <pre className="workspace-error__msg">{msg}</pre>
        </details>
        <div className="workspace-error__actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={this.handleRetry}>
            Try again
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => window.location.reload()}
          >
            Reload app
          </button>
        </div>
      </div>
    )
  }
}
