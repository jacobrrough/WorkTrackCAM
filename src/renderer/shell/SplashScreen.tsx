import type { ReactNode } from 'react'

export type SplashScreenProps = {
  /** Window / product name (e.g. WorkTrackCAD). */
  brandName?: string
  /** Welcome card lead paragraph. */
  splashLead?: string
  recentProjectPaths: string[]
  lastProjectPath: string | undefined
  statusMessage: string
  onOpenCommands: () => void
  onOpenSettings: () => void
  onOpenProject: () => void | Promise<void>
  onOpenRecent: (path: string) => void | Promise<void>
  onRemoveRecent: (path: string) => void | Promise<void>
  onNewProject: () => void | Promise<void>
  /** Pick 3D files, placement dialog, then create a new project and import into assets/. */
  onImport3DNewProject: () => void | Promise<void>
  /** When last project exists: pick files and import into that project, then open it. */
  onImport3DIntoLastProject?: () => void | Promise<void>
  onResumeLast: () => void | Promise<void>
}

export function SplashScreen({
  brandName = 'Unified Fab Studio',
  splashLead = 'Open a project, start fresh, or import STL / STEP / mesh files — everything stays on your machine.',
  recentProjectPaths,
  lastProjectPath,
  statusMessage,
  onOpenCommands,
  onOpenSettings,
  onOpenProject,
  onOpenRecent,
  onRemoveRecent,
  onNewProject,
  onImport3DNewProject,
  onImport3DIntoLastProject,
  onResumeLast
}: SplashScreenProps): ReactNode {
  const showResume = Boolean(lastProjectPath?.trim())

  return (
    <div className="splash-screen">
      <header className="splash-screen-top" aria-label="Splash toolbar">
        <span className="splash-screen-brand">{brandName}</span>
        <div className="splash-screen-top-actions">
          <button type="button" className="secondary" onClick={onOpenCommands}>
            Commands
          </button>
          <button type="button" className="secondary" onClick={onOpenSettings}>
            Settings
          </button>
        </div>
      </header>
      <main className="splash-screen-main" aria-labelledby="splash-welcome-heading">
        <div className="splash-card">
          <h1 id="splash-welcome-heading" className="splash-card-title">
            Welcome
          </h1>
          <p className="splash-card-lead">{splashLead}</p>

          {showResume ? (
            <div className="splash-actions splash-actions--primary">
              <button type="button" className="primary splash-btn-large" onClick={() => void onResumeLast()}>
                Open last project
              </button>
              <p className="msg msg--compact splash-last-path" title={lastProjectPath}>
                {lastProjectPath}
              </p>
            </div>
          ) : null}

          <h2 className="splash-section-label" id="splash-import-heading">
            Import 3D
          </h2>
          <div
            className="splash-actions splash-import-actions"
            role="group"
            aria-labelledby="splash-import-heading"
          >
            <button
              type="button"
              className="primary splash-btn-large"
              title="Create a project folder and import STL / STEP / mesh into assets/"
              onClick={() => void onImport3DNewProject()}
            >
              Import 3D files (new project)…
            </button>
            {onImport3DIntoLastProject ? (
              <button
                type="button"
                className="secondary splash-btn-large"
                title="Add files to your last-opened project folder"
                onClick={() => void onImport3DIntoLastProject()}
              >
                Import 3D files into last project…
              </button>
            ) : null}
          </div>

          <h2 className="splash-section-label" id="splash-project-heading">
            Project
          </h2>
          <div className="splash-actions splash-actions--secondary" role="group" aria-labelledby="splash-project-heading">
            <button type="button" className="secondary splash-btn-large" onClick={() => void onOpenProject()}>
              Open project folder…
            </button>
            <button type="button" className="secondary splash-btn-large" onClick={() => void onNewProject()}>
              New project
            </button>
          </div>

          <h2 className="splash-recent-heading" id="splash-recent-heading">
            Recent projects
          </h2>
          {recentProjectPaths.length === 0 ? (
            <p className="msg util-output-placeholder" role="status" aria-labelledby="splash-recent-heading">
              No recent projects yet — use the buttons above.
            </p>
          ) : (
            <ul className="util-recent-list splash-recent-list" aria-labelledby="splash-recent-heading">
              {recentProjectPaths.map((path) => (
                <li key={path} className="util-recent-row">
                  <button
                    type="button"
                    className="secondary util-recent-path"
                    onClick={() => void onOpenRecent(path)}
                    title={path}
                  >
                    {path}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void onRemoveRecent(path)}
                    aria-label={`Remove ${path} from recent projects`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {statusMessage ? (
            <p className="msg splash-status" role="status" aria-live="polite">
              {statusMessage}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  )
}
