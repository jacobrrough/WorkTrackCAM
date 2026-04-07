import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { ShellInfoBanner } from './ShellInfoBanner'
import { ShellResizeHandle } from './ShellResizeHandle'
import { ShellStatusFooter } from './ShellStatusFooter'
import { useShellResizableColumns } from './useShellResizableColumns'
import { WorkspaceBar, type Workspace } from './WorkspaceBar'
import { WorkbenchSelector } from './WorkbenchSelector'
import type { UiShellLayout } from './workspaceMemory'

export type { Workspace }
export type { UiShellLayout } from './workspaceMemory'

export type UtilityTab = 'project' | 'settings'

type Props = {
  docTitle: string
  /** Product name under the document title (e.g. WorkTrackCAD). */
  appSubtitle: string
  /** When set and non-empty, limits workbench picker / bar to these workspaces. */
  allowedWorkspaces?: Workspace[] | null
  headerActions?: ReactNode
  workspace: Workspace
  onWorkspaceChange: (w: Workspace) => void
  utilityTab: UtilityTab
  onUtilityTabChange: (t: UtilityTab) => void
  browser: ReactNode
  timeline: ReactNode | null
  properties: ReactNode
  showProperties: boolean
  onToggleProperties?: () => void
  statusText?: string
  children: ReactNode
  /** `freecad` = menu bar + workbench dropdown; `fusion` = pill workspace bar only. */
  uiShell?: UiShellLayout
  /** Rendered above the main header when `uiShell` is `freecad` (e.g. `AppMenuBar`). */
  menuBar?: ReactNode
  onUiShellChange?: (s: UiShellLayout) => void
  /** e.g. WorkTrackCAM G-code safety reminder (non-dismissible; rendered below header). */
  complianceBanner?: ReactNode
}

const UTIL_TABS: { id: UtilityTab; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'settings', label: 'Settings' }
]

function utilityTabA11yLabel(tab: { label: string }, index: number): string {
  return `${tab.label} tab (${index + 1} of ${UTIL_TABS.length})`
}

export function AppShell({
  docTitle,
  appSubtitle,
  allowedWorkspaces,
  headerActions,
  workspace,
  onWorkspaceChange,
  utilityTab,
  onUtilityTabChange,
  browser,
  timeline,
  properties,
  showProperties,
  onToggleProperties,
  statusText,
  children,
  uiShell = 'freecad',
  menuBar = null,
  onUiShellChange,
  complianceBanner = null
}: Props) {
  const {
    browserPx,
    propertiesPx,
    onBrowserResizePointerDown,
    onPropertiesResizePointerDown
  } = useShellResizableColumns(showProperties)

  const prevWorkspaceRef = useRef<Workspace | null>(null)
  useEffect(() => {
    const was = prevWorkspaceRef.current
    prevWorkspaceRef.current = workspace
    if (workspace === 'utilities' && was != null && was !== 'utilities') {
      queueMicrotask(() => document.getElementById(`util-tab-${utilityTab}`)?.focus())
    }
  }, [workspace, utilityTab])

  const onUtilityTabButtonKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, tabId: UtilityTab) => {
      const idx = UTIL_TABS.findIndex((x) => x.id === tabId)
      if (idx < 0) return
      let nextIdx = -1
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        nextIdx = (idx + 1) % UTIL_TABS.length
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        nextIdx = (idx - 1 + UTIL_TABS.length) % UTIL_TABS.length
      } else if (e.key === 'Home') {
        e.preventDefault()
        nextIdx = 0
      } else if (e.key === 'End') {
        e.preventDefault()
        nextIdx = UTIL_TABS.length - 1
      }
      if (nextIdx < 0) return
      const next = UTIL_TABS[nextIdx]!
      onUtilityTabChange(next.id)
      queueMicrotask(() => document.getElementById(`util-tab-${next.id}`)?.focus())
    },
    [onUtilityTabChange]
  )

  const browserAsideLabel = uiShell === 'freecad' ? 'Combo view' : 'Model browser'

  return (
    <div className="app-shell" data-workspace={workspace} data-ui-shell={uiShell}>
      {uiShell === 'freecad' && menuBar != null ? (
        <div className="app-shell-menubar-outer">{menuBar}</div>
      ) : null}
      <header className="app-shell-header">
        <div className="app-shell-header-brand">
          <div className="app-shell-doc-block">
            <span className="app-doc-name app-doc-name--primary" title={docTitle}>
              {docTitle}
            </span>
            <span className="app-title-sub">{appSubtitle}</span>
          </div>
          {uiShell === 'freecad' ? (
            <WorkbenchSelector
              id="workbench-selector"
              workspace={workspace}
              onChange={onWorkspaceChange}
              allowedWorkspaces={allowedWorkspaces}
            />
          ) : (
            <>
              {onUiShellChange ? (
                <button
                  type="button"
                  className="secondary app-shell-layout-switch"
                  title="Restore menu bar and combo view layout"
                  onClick={() => onUiShellChange('freecad')}
                >
                  Menu bar layout
                </button>
              ) : null}
              <WorkspaceBar workspace={workspace} onChange={onWorkspaceChange} allowedWorkspaces={allowedWorkspaces} />
            </>
          )}
        </div>
        <div className="app-shell-header-right">
          {headerActions}
          <button
            type="button"
            className={`secondary properties-toggle ${showProperties ? 'active' : ''}`}
            onClick={onToggleProperties}
            aria-pressed={showProperties}
            aria-expanded={showProperties}
          >
            Properties
          </button>
        </div>
      </header>

      {complianceBanner}
      <ShellInfoBanner />

      {workspace === 'utilities' && (
        <div className="utility-strip-outer">
          <div
            className="utility-strip"
            role="tablist"
            aria-label="File workspace tabs"
            aria-orientation="horizontal"
            aria-describedby="utility-tablist-kbd-hint utility-tablist-visible-hint"
          >
            {UTIL_TABS.map((t, index) => (
              <button
                key={t.id}
                id={`util-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={utilityTab === t.id}
                aria-controls="utility-workspace-panel"
                aria-label={utilityTabA11yLabel(t, index)}
                aria-posinset={index + 1}
                aria-setsize={UTIL_TABS.length}
                tabIndex={utilityTab === t.id ? 0 : -1}
                className={utilityTab === t.id ? 'active' : ''}
                onClick={() => onUtilityTabChange(t.id)}
                onKeyDown={(e) => onUtilityTabButtonKeyDown(e, t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p id="utility-tablist-visible-hint" className="utility-strip-hint msg" aria-live="polite">
            File tabs: arrow keys move focus and selection, Home/End jump, and tabs scroll horizontally on small screens.
          </p>
          <p id="utility-tablist-kbd-hint" className="sr-only">
            With a tab focused, use Left/Right or Up/Down arrows to move between tabs. Home and End jump to the first or last
            tab.
          </p>
        </div>
      )}

      <div className="app-shell-body">
        <aside className="app-browser" aria-label={browserAsideLabel} style={{ width: browserPx }}>
          {browser}
        </aside>
        <ShellResizeHandle ariaLabel="Resize browser column" onPointerDown={onBrowserResizePointerDown} />
        <div className="app-content-col">
          <main className="app-content-main" id="app-main" aria-label="Workspace canvas">
            {children}
          </main>
          {timeline != null && <div className="app-timeline">{timeline}</div>}
        </div>
        {showProperties ? (
          <>
            <ShellResizeHandle
              ariaLabel="Resize properties column"
              onPointerDown={onPropertiesResizePointerDown}
            />
            <aside className="app-properties" aria-label="Properties" style={{ width: propertiesPx }}>
              {properties}
            </aside>
          </>
        ) : null}
      </div>

      <ShellStatusFooter statusText={statusText} />
    </div>
  )
}
