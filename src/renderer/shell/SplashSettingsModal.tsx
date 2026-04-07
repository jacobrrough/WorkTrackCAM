import { useEffect } from 'react'
import { getAppDisplayName, getAppProductFromBuild } from '../../shared/app-product'
import type { AppSettings } from '../../shared/project-schema'

const SPLASH_APP_DISPLAY_NAME = getAppDisplayName(getAppProductFromBuild())

type Props = {
  open: boolean
  onClose: () => void
  settings: AppSettings | null
  projectsRoot: string | undefined
  onSaveSettingsField: (partial: Partial<AppSettings>) => void | Promise<void>
  onChooseProjectsRoot: () => void | Promise<void>
  onClearProjectsRoot: () => void | Promise<void>
  appVersion: string | null
}

/**
 * Minimal settings for paths needed before a project is open (splash).
 * Full options remain under File → Settings.
 */
export function SplashSettingsModal({
  open,
  onClose,
  settings,
  projectsRoot,
  onSaveSettingsField,
  onChooseProjectsRoot,
  onClearProjectsRoot,
  appVersion
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="splash-settings-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="splash-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="splash-settings-heading"
      >
        <div className="splash-settings-head">
          <h2 id="splash-settings-heading" className="splash-settings-title">
            Settings
          </h2>
          <button type="button" className="secondary" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <div className="splash-settings-body">
          {appVersion ? (
            <p className="msg util-panel-intro" role="status">
              {SPLASH_APP_DISPLAY_NAME} v{appVersion}
            </p>
          ) : (
            <p className="msg util-panel-intro" role="status" aria-busy="true">
              …
            </p>
          )}
          {!settings ? (
            <p className="msg" role="status" aria-live="polite">
              Loading settings…
            </p>
          ) : (
            <>
              <fieldset
                className="util-tools-actions util-settings-paths splash-settings-fieldset"
                aria-describedby="splash-settings-hint"
              >
                <legend className="util-fieldset-legend">External tool paths</legend>
                <p id="splash-settings-hint" className="msg util-panel-intro">
                  CuraEngine, definitions, and Python (CadQuery / OpenCAMLib / mesh). Values save as you type.
                </p>
                <div className="row">
                  <label htmlFor="splash-cura-engine">
                    CuraEngine executable
                    <input
                      id="splash-cura-engine"
                      value={settings.curaEnginePath ?? ''}
                      onChange={(e) => void onSaveSettingsField({ curaEnginePath: e.target.value })}
                      placeholder="C:\\Program Files\\Ultimaker Cura 5.x.x\\CuraEngine.exe"
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="row">
                  <label htmlFor="splash-cura-defs">
                    Cura definitions folder (contains fdmprinter.def.json)
                    <input
                      id="splash-cura-defs"
                      value={settings.curaDefinitionsPath ?? ''}
                      onChange={(e) => void onSaveSettingsField({ curaDefinitionsPath: e.target.value })}
                      placeholder="…\\share\\cura\\resources\\definitions"
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="row">
                  <label htmlFor="splash-python">
                    Python (OpenCAMLib / CadQuery)
                    <input
                      id="splash-python"
                      value={settings.pythonPath ?? ''}
                      onChange={(e) => void onSaveSettingsField({ pythonPath: e.target.value })}
                      placeholder="python"
                      autoComplete="off"
                    />
                  </label>
                </div>
                <div className="row">
                  <label htmlFor="splash-carvera-cli">
                    Carvera CLI (optional)
                    <input
                      id="splash-carvera-cli"
                      value={settings.carveraCliPath ?? ''}
                      onChange={(e) =>
                        void onSaveSettingsField({
                          carveraCliPath: e.target.value.trim() ? e.target.value : undefined
                        })
                      }
                      placeholder="carvera-cli"
                      autoComplete="off"
                    />
                  </label>
                </div>
              </fieldset>
              <h3 className="subh util-section-heading" id="splash-projects-root-heading">
                Default projects folder
              </h3>
              <p className="msg util-panel-intro" id="splash-projects-root-hint">
                Where <strong>New project</strong> creates dated subfolders. <strong>Open project</strong> can still pick any
                folder.
              </p>
              <div
                className="row util-project-actions"
                role="group"
                aria-labelledby="splash-projects-root-heading"
                aria-describedby="splash-projects-root-hint"
              >
                <button type="button" className="secondary" onClick={() => void onChooseProjectsRoot()}>
                  Choose default folder…
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void onClearProjectsRoot()}
                  disabled={!projectsRoot}
                >
                  Clear default
                </button>
              </div>
              {projectsRoot ? (
                <p className="msg util-path-block">
                  <code>{projectsRoot}</code>
                </p>
              ) : (
                <p className="msg util-output-placeholder" role="status">
                  No default folder — <strong>New project</strong> will ask for a folder each time.
                </p>
              )}
              <p className="msg msg--compact">
                More options (Cura advanced JSON, theme, recent projects) in <strong>File → Settings</strong> after you open a
                project.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
