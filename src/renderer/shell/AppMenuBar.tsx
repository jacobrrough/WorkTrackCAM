import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Workspace } from './WorkspaceBar'
import type { UiShellLayout } from './workspaceMemory'

export type AppMenuBarProps = {
  canSave: boolean
  onOpenProject: () => void | Promise<void>
  onNewProject: () => void | Promise<void>
  onNewFrom3D: () => void | Promise<void>
  onSave: () => void | Promise<void>
  onGoProjectTab: () => void
  onGoSettingsTab: () => void
  onCommandPalette: () => void
  onWorkspaceChange: (w: Workspace) => void
  showProperties: boolean
  onToggleProperties: () => void
  onOpenShortcuts: () => void
  uiShell: UiShellLayout
  onUiShellChange: (s: UiShellLayout) => void
  /** When set and non-empty, View → workbench items are limited to these workspaces. */
  allowedWorkspaces?: Workspace[] | null
}

type MenuId = 'file' | 'edit' | 'view' | 'help' | null

export function AppMenuBar({
  canSave,
  onOpenProject,
  onNewProject,
  onNewFrom3D,
  onSave,
  onGoProjectTab,
  onGoSettingsTab,
  onCommandPalette,
  onWorkspaceChange,
  showProperties,
  onToggleProperties,
  onOpenShortcuts,
  uiShell,
  onUiShellChange,
  allowedWorkspaces
}: AppMenuBarProps) {
  const workspaceMenuAllowed =
    allowedWorkspaces != null && allowedWorkspaces.length > 0 ? allowedWorkspaces : null
  const baseId = useId()
  const [open, setOpen] = useState<MenuId>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    if (open == null) return
    const onDocDown = (e: MouseEvent) => {
      const el = wrapRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKey as unknown as EventListener)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKey as unknown as EventListener)
    }
  }, [open, close])

  const run = useCallback(
    (fn: () => void | Promise<void>) => {
      close()
      void fn()
    },
    [close]
  )

  const onMenubarKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    },
    [close]
  )

  const fileBtnId = `${baseId}-file-btn`
  const editBtnId = `${baseId}-edit-btn`
  const viewBtnId = `${baseId}-view-btn`
  const helpBtnId = `${baseId}-help-btn`

  return (
    <div
      ref={wrapRef}
      className="app-menubar"
      role="menubar"
      aria-label="Application menu"
      onKeyDown={onMenubarKeyDown}
    >
      <div className="app-menubar__top">
        <div className="app-menubar__cell">
          <button
            id={fileBtnId}
            type="button"
            className={`app-menubar__trigger ${open === 'file' ? 'app-menubar__trigger--open' : ''}`}
            aria-haspopup="true"
            aria-expanded={open === 'file'}
            aria-controls={`${baseId}-file-menu`}
            onClick={() => setOpen((o) => (o === 'file' ? null : 'file'))}
          >
            File
          </button>
          {open === 'file' && (
            <div
              id={`${baseId}-file-menu`}
              className="app-menubar__dropdown"
              role="menu"
              aria-labelledby={fileBtnId}
            >
              <button type="button" role="menuitem" className="app-menubar__item" onClick={() => run(onOpenProject)}>
                Open project folder…
              </button>
              <button type="button" role="menuitem" className="app-menubar__item" onClick={() => run(onNewProject)}>
                New project…
              </button>
              <button type="button" role="menuitem" className="app-menubar__item" onClick={() => run(onNewFrom3D)}>
                New from 3D…
              </button>
              <button
                type="button"
                role="menuitem"
                className="app-menubar__item"
                disabled={!canSave}
                onClick={() => run(onSave)}
              >
                Save
              </button>
              <div className="app-menubar__sep" role="separator" />
              <button type="button" role="menuitem" className="app-menubar__item" onClick={() => run(onGoProjectTab)}>
                Project…
              </button>
              <button type="button" role="menuitem" className="app-menubar__item" onClick={() => run(onGoSettingsTab)}>
                Settings…
              </button>
            </div>
          )}
        </div>

        <div className="app-menubar__cell">
          <button
            id={editBtnId}
            type="button"
            className={`app-menubar__trigger ${open === 'edit' ? 'app-menubar__trigger--open' : ''}`}
            aria-haspopup="true"
            aria-expanded={open === 'edit'}
            aria-controls={`${baseId}-edit-menu`}
            onClick={() => setOpen((o) => (o === 'edit' ? null : 'edit'))}
          >
            Edit
          </button>
          {open === 'edit' && (
            <div
              id={`${baseId}-edit-menu`}
              className="app-menubar__dropdown"
              role="menu"
              aria-labelledby={editBtnId}
            >
              <button type="button" role="menuitem" className="app-menubar__item" onClick={() => run(onCommandPalette)}>
                Command palette…
              </button>
            </div>
          )}
        </div>

        <div className="app-menubar__cell">
          <button
            id={viewBtnId}
            type="button"
            className={`app-menubar__trigger ${open === 'view' ? 'app-menubar__trigger--open' : ''}`}
            aria-haspopup="true"
            aria-expanded={open === 'view'}
            aria-controls={`${baseId}-view-menu`}
            onClick={() => setOpen((o) => (o === 'view' ? null : 'view'))}
          >
            View
          </button>
          {open === 'view' && (
            <div
              id={`${baseId}-view-menu`}
              className="app-menubar__dropdown"
              role="menu"
              aria-labelledby={viewBtnId}
            >
            <button
              type="button"
              role="menuitem"
              className="app-menubar__item app-menubar__item--check"
              aria-checked={showProperties}
              onClick={() => run(onToggleProperties)}
            >
              {showProperties ? '✓ ' : ''}Properties panel
            </button>
            <div className="app-menubar__sep" role="separator" />
            {(!workspaceMenuAllowed || workspaceMenuAllowed.includes('design')) && (
              <button
                type="button"
                role="menuitem"
                className="app-menubar__item"
                onClick={() => {
                  close()
                  onWorkspaceChange('design')
                }}
              >
                Design workbench
              </button>
            )}
            {(!workspaceMenuAllowed || workspaceMenuAllowed.includes('assemble')) && (
              <button
                type="button"
                role="menuitem"
                className="app-menubar__item"
                onClick={() => {
                  close()
                  onWorkspaceChange('assemble')
                }}
              >
                Assemble workbench
              </button>
            )}
            {(!workspaceMenuAllowed || workspaceMenuAllowed.includes('manufacture')) && (
              <button
                type="button"
                role="menuitem"
                className="app-menubar__item"
                onClick={() => {
                  close()
                  onWorkspaceChange('manufacture')
                }}
              >
                Manufacture workbench
              </button>
            )}
            {(!workspaceMenuAllowed || workspaceMenuAllowed.includes('utilities')) && (
              <button
                type="button"
                role="menuitem"
                className="app-menubar__item"
                onClick={() => {
                  close()
                  onWorkspaceChange('utilities')
                }}
              >
                File workbench
              </button>
            )}
            <div className="app-menubar__sep" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="app-menubar__item app-menubar__item--check"
              aria-checked={uiShell === 'fusion'}
              onClick={() => {
                close()
                onUiShellChange(uiShell === 'freecad' ? 'fusion' : 'freecad')
              }}
            >
              {uiShell === 'fusion' ? '✓ ' : ''}Classic workspace bar layout
            </button>
            </div>
          )}
        </div>

        <div className="app-menubar__cell">
          <button
            id={helpBtnId}
            type="button"
            className={`app-menubar__trigger ${open === 'help' ? 'app-menubar__trigger--open' : ''}`}
            aria-haspopup="true"
            aria-expanded={open === 'help'}
            aria-controls={`${baseId}-help-menu`}
            onClick={() => setOpen((o) => (o === 'help' ? null : 'help'))}
          >
            Help
          </button>
          {open === 'help' && (
            <div
              id={`${baseId}-help-menu`}
              className="app-menubar__dropdown"
              role="menu"
              aria-labelledby={helpBtnId}
            >
              <button type="button" role="menuitem" className="app-menubar__item" onClick={() => run(onOpenShortcuts)}>
                Keyboard shortcuts…
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
