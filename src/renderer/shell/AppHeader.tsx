import { memo, type ReactNode } from 'react'
import { WorkspaceBar, type Workspace } from './WorkspaceBar'

type Props = {
  docTitle: string
  appSubtitle: string
  workspace: Workspace
  onWorkspaceChange: (w: Workspace) => void
  allowedWorkspaces?: Workspace[] | null
  onSearchClick: () => void
  onLibraryClick: () => void
  onSettingsClick: () => void
  headerActions?: ReactNode
}

export const AppHeader = memo(function AppHeader({
  docTitle,
  appSubtitle,
  workspace,
  onWorkspaceChange,
  allowedWorkspaces,
  onSearchClick,
  onLibraryClick,
  onSettingsClick,
  headerActions,
}: Props) {
  return (
    <header className="app-shell-header">
      <div className="app-shell-header-brand">
        <div className="app-shell-doc-block">
          <span className="app-doc-name app-doc-name--primary">{docTitle}</span>
          <span className="app-title-sub">{appSubtitle}</span>
        </div>
      </div>

      <WorkspaceBar
        workspace={workspace}
        onChange={onWorkspaceChange}
        allowedWorkspaces={allowedWorkspaces}
      />

      <div className="app-shell-header-right">
        {headerActions}
        <button
          type="button"
          className="tb-btn"
          title="Search commands (Ctrl+K)"
          aria-label="Search commands"
          onClick={onSearchClick}
        >
          {'\u2318'}
        </button>
        <button
          type="button"
          className="tb-btn"
          title="Tool & Material Library"
          aria-label="Open library"
          onClick={onLibraryClick}
        >
          {'\u{1F4DA}'}
        </button>
        <button
          type="button"
          className="tb-btn"
          title="Settings"
          aria-label="Open settings"
          onClick={onSettingsClick}
        >
          {'\u2699'}
        </button>
      </div>
    </header>
  )
})
