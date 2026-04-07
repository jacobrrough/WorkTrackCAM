import { useEffect, useState, type ReactNode } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import { ROUND_TRIP_HELP, ROUND_TRIP_SHORT } from '../../shared/import-history-display'
import type { AppSettings, ProjectFile } from '../../shared/project-schema'
import type { DrawingFile, DrawingViewPlaceholder } from '../../shared/drawing-sheet-schema'
import { DrawingExportRibbon } from '../shell/DrawingExportRibbon'
import { DrawingManifestPanel } from './DrawingManifestPanel'
import { MachineManagerPanel } from './MachineManagerPanel'
import type { UtilityTab } from '../shell/AppShell'
import { getAppDisplayName, getAppProductFromBuild } from '../../shared/app-product'

const UTIL_SETTINGS_APP_NAME = getAppDisplayName(getAppProductFromBuild())

type SettingsDisclosureProps = {
  id: string
  title: string
  /** Initial expanded state; user can still collapse/expand. */
  defaultOpen?: boolean
  children: ReactNode
}

/** Collapsible section for File → Settings. */
function SettingsDisclosure({ id, title, defaultOpen = false, children }: SettingsDisclosureProps) {
  const summaryId = `${id}-summary`
  const [open, setOpen] = useState(defaultOpen)
  return (
    <details className="util-settings-disclosure" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="util-settings-disclosure__summary" id={summaryId}>
        {title}
      </summary>
      <div className="util-settings-disclosure__body" role="group" aria-labelledby={summaryId}>
        {children}
      </div>
    </details>
  )
}

export type UtilitiesWorkspacePanelsProps = {
  tab: UtilityTab
  machines: MachineProfile[]
  settings: AppSettings | null
  project: ProjectFile | null
  projectDir: string | null
  /** Parent folder for automatic New project subfolders (settings). */
  projectsRoot: string | undefined
  recentProjectPaths: string[]
  drawingExportBusy: boolean
  onOpenProjectFolder: () => void
  onCreateProject: () => void
  /** Create project folder and import chosen mesh/STL/STEP into assets/. */
  onCreateProjectFromImport: () => void
  onSaveProject: () => void
  onProjectChange: (next: ProjectFile) => void
  onSaveSettingsField: (partial: Partial<AppSettings>) => void
  onChooseProjectsRoot: () => void | Promise<void>
  onClearProjectsRoot: () => void | Promise<void>
  onOpenRecentProject: (path: string) => void | Promise<void>
  onRemoveRecentProject: (path: string) => void | Promise<void>
  onImportMesh: () => void
  onExportDrawing: (kind: 'pdf' | 'dxf') => void
  drawingFile: DrawingFile
  onPatchDrawingFirstSheet: (partial: {
    name?: string
    scale?: string
    sheetTemplateHint?: string
    meshProjectionTier?: 'A' | 'B' | 'C'
    viewPlaceholders?: DrawingViewPlaceholder[]
  }) => void
  onSaveDrawingManifest: () => void | Promise<void>
  onExportDesignParameters: () => void | Promise<void>
  onImportDesignParameters: () => void | Promise<void>
}

export function UtilitiesWorkspacePanels(p: UtilitiesWorkspacePanelsProps): ReactNode {
  const isCamProduct = getAppProductFromBuild() === 'cam'
  const [appVersion, setAppVersion] = useState<string | null>(null)

  useEffect(() => {
    if (p.tab !== 'settings') return
    void window.fab.appGetVersion().then(setAppVersion).catch(() => setAppVersion(null))
  }, [p.tab])

  switch (p.tab) {
    case 'project':
      return (
        <section className="panel workspace-util-panel" aria-labelledby="util-project-heading">
          <h2 id="util-project-heading">Project</h2>
          <p className="msg util-panel-intro">
            Project folder contents: <code>project.json</code>, sidecar files, and linked assets. Use the toolbar or{' '}
            <strong>Commands</strong> (Ctrl+K) for open / new / import. <strong>Manufacture</strong> holds slice, CAM, and tools.
          </p>

          <h3 className="subh util-section-heading" id="util-projects-root-heading">
            Default projects folder
          </h3>
          <p className="msg util-panel-intro" id="util-projects-root-hint">
            Pick a folder where <strong>New project</strong> creates a dated subfolder automatically.{' '}
            <strong>Open project folder</strong> still lets you open any location. Settings are stored in app data.
          </p>
          <div
            className="row util-project-actions"
            role="group"
            aria-labelledby="util-projects-root-heading"
            aria-describedby="util-projects-root-hint"
          >
            <button type="button" className="secondary" onClick={() => void p.onChooseProjectsRoot()}>
              Choose default folder…
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void p.onClearProjectsRoot()}
              disabled={!p.projectsRoot}
            >
              Clear default
            </button>
          </div>
          {p.projectsRoot ? (
            <p className="msg util-path-block">
              <code>{p.projectsRoot}</code>
            </p>
          ) : (
            <p className="msg util-output-placeholder" role="status">
              No default folder — <strong>New project</strong> will ask you to pick a folder each time.
            </p>
          )}

          <h3 className="subh util-section-heading" id="util-recent-projects-heading">
            Recent projects
          </h3>
          {p.recentProjectPaths.length === 0 ? (
            <p className="msg util-output-placeholder" role="status" aria-labelledby="util-recent-projects-heading">
              No recent projects yet. Open or create a project to build this list.
            </p>
          ) : (
            <ul className="util-recent-list" aria-labelledby="util-recent-projects-heading">
              {p.recentProjectPaths.map((path) => (
                <li key={path} className="util-recent-row">
                  <button
                    type="button"
                    className="secondary util-recent-path"
                    onClick={() => void p.onOpenRecentProject(path)}
                    title={path}
                  >
                    {path}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void p.onRemoveRecentProject(path)}
                    aria-label={`Remove ${path} from recent projects`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <DrawingExportRibbon
            projectName={p.project?.name}
            disabled={p.drawingExportBusy}
            onExportPdf={() => void p.onExportDrawing('pdf')}
            onExportDxf={() => void p.onExportDrawing('dxf')}
          />
          <div className="row util-project-actions" role="group" aria-label="Project folder actions">
            <button type="button" className="secondary" onClick={() => void p.onOpenProjectFolder()}>
              Open project folder
            </button>
            <button type="button" className="secondary" onClick={() => void p.onCreateProject()}>
              New project
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void p.onCreateProjectFromImport()}
              title="Pick STL, STEP, or mesh file(s); creates a new project and imports into assets/"
            >
              New project from 3D file…
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => void p.onSaveProject()}
              disabled={!p.project}
              title={!p.project ? 'Open or create a project before saving' : undefined}
            >
              Save
            </button>
          </div>
          {p.project ? (
            <div className="msg">
              <p>
                <strong>{p.project.name}</strong> — machine:{' '}
                {p.machines.find((m) => m.id === p.project!.activeMachineId)?.name ?? `${p.project!.activeMachineId} (not found)`}
              </p>
              <label htmlFor="util-active-machine-id">
                Active machine ID
                <select
                  id="util-active-machine-id"
                  value={p.project.activeMachineId}
                  onChange={(e) => p.onProjectChange({ ...p.project!, activeMachineId: e.target.value })}
                >
                  {p.machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.id})
                    </option>
                  ))}
                </select>
              </label>

              <h3 className="subh util-section-heading" id="util-physical-material-heading">
                Physical material
              </h3>
              <p className="msg msg--compact" id="util-physical-material-hint">
                Optional metadata stored in <code>project.json</code> for documentation or rough mass estimates (local only, no
                cloud).
              </p>
              <div
                className="util-project-material-fields"
                role="group"
                aria-labelledby="util-physical-material-heading"
                aria-describedby="util-physical-material-hint"
              >
                <label htmlFor="util-material-name">
                  Material name
                  <input
                    id="util-material-name"
                    type="text"
                    autoComplete="off"
                    placeholder="e.g. 6061-T6 aluminum"
                    value={p.project!.physicalMaterial?.name ?? ''}
                    onChange={(e) => {
                      const name = e.target.value.trim() ? e.target.value.trim() : undefined
                      const density = p.project!.physicalMaterial?.densityKgM3
                      const validD =
                        density != null && !Number.isNaN(density) && density > 0 ? density : undefined
                      const next =
                        name != null || validD != null
                          ? {
                              ...(name != null ? { name } : {}),
                              ...(validD != null ? { densityKgM3: validD } : {})
                            }
                          : undefined
                      p.onProjectChange({ ...p.project!, physicalMaterial: next })
                    }}
                  />
                </label>
                <label htmlFor="util-material-density">
                  Density (kg/m³)
                  <input
                    id="util-material-density"
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    placeholder="e.g. 2700"
                    value={
                      p.project!.physicalMaterial?.densityKgM3 != null
                        ? String(p.project!.physicalMaterial!.densityKgM3)
                        : ''
                    }
                    onChange={(e) => {
                      const raw = e.target.value.trim()
                      const parsed = raw.length === 0 ? NaN : Number.parseFloat(raw)
                      const validD =
                        !Number.isNaN(parsed) && parsed > 0 ? parsed : undefined
                      const name = p.project!.physicalMaterial?.name?.trim()
                      const next =
                        (name != null && name.length > 0) || validD != null
                          ? {
                              ...(name != null && name.length > 0 ? { name } : {}),
                              ...(validD != null ? { densityKgM3: validD } : {})
                            }
                          : undefined
                      p.onProjectChange({ ...p.project!, physicalMaterial: next })
                    }}
                  />
                </label>
              </div>

              <h3 className="subh util-section-heading" id="util-appearance-heading">
                Appearance
              </h3>
              <p className="msg msg--compact" id="util-appearance-hint">
                Free-text notes (finish, color, coating). Saved with the project.
              </p>
              <label htmlFor="util-appearance-notes" className="util-appearance-label">
                Appearance notes
                <textarea
                  id="util-appearance-notes"
                  className="util-appearance-textarea"
                  rows={3}
                  aria-describedby="util-appearance-hint"
                  placeholder="e.g. Powder coat RAL 9005"
                  value={p.project!.appearanceNotes ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    p.onProjectChange({
                      ...p.project!,
                      appearanceNotes: v.trim().length ? v : undefined
                    })
                  }}
                />
              </label>

              <div className="row util-project-import util-project-import--spaced" role="group" aria-label="Import 3D models">
                <button type="button" className="secondary" onClick={() => void p.onImportMesh()}>
                  Import 3D model…
                </button>
              </div>
              <p className="msg msg--compact">
                STL copies to <code>assets/</code>. STEP uses CadQuery. OBJ / PLY / GLTF / GLB / 3MF / OFF / DAE convert via Python{' '}
                <code>trimesh</code> (see <code>engines/mesh/README.md</code>). In the file dialog, use{' '}
                <strong>Ctrl+click</strong> or <strong>Shift+click</strong> to import multiple files. Duplicate names become{' '}
                <code>_2</code>, <code>_3</code>, … under <code>assets/</code>. <code>importHistory</code> in{' '}
                <code>project.json</code> updates when you save the project.
              </p>
              {p.project.meshes.length === 0 ? (
                <p className="msg util-output-placeholder stack-section--sm" role="status">
                  No meshes linked yet — use <strong>Import 3D model…</strong> to add geometry.
                </p>
              ) : null}
              <DrawingManifestPanel
                projectDir={p.projectDir}
                drawingFile={p.drawingFile}
                onPatchDrawingFirstSheet={p.onPatchDrawingFirstSheet}
                onSaveDrawingManifest={p.onSaveDrawingManifest}
              />
              <h3 className="subh util-section-heading">Design parameters (file I/O)</h3>
              <p className="msg">
                Export numeric <code>parameters</code> from <code>design/sketch.json</code> to{' '}
                <code>output/design-parameters.json</code>, or merge keys from a JSON file{' '}
                <code>{`{ "parameters": { "d1": 12 } }`}</code> (overwrites on key collision). Save the design in-app if
                you have unsolved edits before merging.
              </p>
              <div className="row util-project-params" role="group" aria-label="Design parameters file I/O">
                <button
                  type="button"
                  className="secondary"
                  disabled={!p.projectDir}
                  onClick={() => void p.onExportDesignParameters()}
                >
                  Export parameters to output/
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={!p.projectDir}
                  onClick={() => void p.onImportDesignParameters()}
                >
                  Merge parameters from JSON…
                </button>
              </div>
              {p.project.meshes.length > 0 ? (
                <>
                  <h3 className="subh util-section-heading" id="util-project-meshes-heading">
                    Meshes in project
                  </h3>
                  <ul className="tools" aria-labelledby="util-project-meshes-heading">
                    {p.project.meshes.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {(p.project.importHistory ?? []).length > 0 && (
                <>
                  <h3 className="subh util-section-heading" id="util-project-imports-heading">
                    Recent imports
                  </h3>
                  <p className="msg msg--compact" id="util-project-imports-hint">
                    <strong>Mesh only</strong> — STL or converted mesh. <strong>Partial</strong> — tessellated CAD (e.g. STEP).{' '}
                    <strong>Full</strong> — reserved. Warnings note units, tessellation, and similar importer details.
                  </p>
                  <ul
                    className="tools import-history-list"
                    aria-labelledby="util-project-imports-heading"
                    aria-describedby="util-project-imports-hint"
                  >
                    {(p.project.importHistory ?? []).slice(-12).map((e) => (
                      <li key={e.id}>
                        <div>
                          <strong>{e.sourceFileName}</strong> ({e.sourceFormat}) → {e.assetRelativePath}{' '}
                          <span
                            className="msg"
                            title={ROUND_TRIP_HELP[e.roundTripLevel]}
                            aria-label={ROUND_TRIP_HELP[e.roundTripLevel]}
                          >
                            [{ROUND_TRIP_SHORT[e.roundTripLevel]}]
                          </span>
                        </div>
                        {e.warnings && e.warnings.length > 0 ? (
                          <ul className="msg import-history-warnings" aria-label="Import warnings">
                            {e.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : (
            <p className="msg util-output-placeholder" role="status">
              No project open yet. Use <strong>Open project folder</strong> or <strong>New project</strong> above, then{' '}
              <strong>Save</strong> after changes.
            </p>
          )}
        </section>
      )
    case 'settings':
      return p.settings ? (
        <section className="panel workspace-util-panel" aria-labelledby="util-settings-heading">
          <h2 id="util-settings-heading">Settings</h2>
          <p className="msg util-panel-intro" role="status">
            {UTIL_SETTINGS_APP_NAME} {appVersion ? `v${appVersion}` : '…'}
          </p>
          {isCamProduct ? (
            <SettingsDisclosure id="util-cam-mfg" title="Manufacturing defaults" defaultOpen>
              <p className="msg util-panel-intro">
                Defaults apply when you click <strong>New machine draft</strong> below. Post templates live under{' '}
                <code>resources/posts</code> (see <code>docs/MACHINES.md</code>).
              </p>
              <div className="row">
                <label htmlFor="util-cam-default-post">
                  Default post template (filename)
                  <input
                    id="util-cam-default-post"
                    value={p.settings.camDefaultPostTemplate ?? ''}
                    onChange={(e) =>
                      void p.onSaveSettingsField({
                        camDefaultPostTemplate: e.target.value.trim() ? e.target.value : undefined
                      })
                    }
                    placeholder="grbl-mm.gcode.hbs"
                    autoComplete="off"
                    aria-describedby="util-cam-default-post-hint"
                  />
                </label>
              </div>
              <p id="util-cam-default-post-hint" className="msg msg--compact">
                Must match a Handlebars file under <code>resources/posts</code>. Empty uses <code>grbl-mm.gcode.hbs</code>.
              </p>
              <div className="row">
                <label htmlFor="util-cam-default-dialect">
                  Default machine dialect (new drafts)
                  <select
                    id="util-cam-default-dialect"
                    value={p.settings.camDefaultMachineDialect ?? 'grbl'}
                    onChange={(e) =>
                      void p.onSaveSettingsField({
                        camDefaultMachineDialect: e.target.value as 'grbl' | 'mach3' | 'generic_mm'
                      })
                    }
                  >
                    <option value="grbl">grbl</option>
                    <option value="mach3">mach3</option>
                    <option value="generic_mm">generic_mm</option>
                  </select>
                </label>
              </div>
              <label className="util-checkbox-row">
                <input
                  type="checkbox"
                  checked={p.settings.camGcodeSafetyAcknowledged === true}
                  onChange={(e) =>
                    void p.onSaveSettingsField({ camGcodeSafetyAcknowledged: e.target.checked })
                  }
                />
                <span>
                  I understand generated G-code is not verified for my machine until I check the post, units, and clearances
                  (see <code>docs/MACHINES.md</code>).
                </span>
              </label>
            </SettingsDisclosure>
          ) : null}
          <SettingsDisclosure id="util-external-paths" title="External tool paths" defaultOpen>
            <p className="msg util-panel-intro">
              {isCamProduct ? (
                <>
                  Paths to CuraEngine, Cura definitions, and Python (OpenCAMLib and mesh conversion). Used by the{' '}
                  <strong>Slice</strong> tab, mesh/STEP import, and CAM. Values save as you type.
                </>
              ) : (
                <>
                  Paths to CuraEngine, Cura definitions, and Python (CadQuery / OpenCAMLib). Used by{' '}
                  <strong>Manufacture → Slice</strong>, STEP import, and optional CAM. Values save as you type.
                </>
              )}
            </p>
            <div className="row">
              <label htmlFor="util-cura-engine">
                CuraEngine executable
                <input
                  id="util-cura-engine"
                  value={p.settings.curaEnginePath ?? ''}
                  onChange={(e) => void p.onSaveSettingsField({ curaEnginePath: e.target.value })}
                  placeholder="C:\\Program Files\\Ultimaker Cura 5.x.x\\CuraEngine.exe"
                  autoComplete="off"
                  aria-describedby="util-settings-more-info"
                />
              </label>
            </div>
            <div className="row">
              <label htmlFor="util-cura-defs">
                Cura definitions folder (contains fdmprinter.def.json)
                <input
                  id="util-cura-defs"
                  value={p.settings.curaDefinitionsPath ?? ''}
                  onChange={(e) => void p.onSaveSettingsField({ curaDefinitionsPath: e.target.value })}
                  placeholder="…\\share\\cura\\resources\\definitions"
                  autoComplete="off"
                  aria-describedby="util-settings-more-info"
                />
              </label>
            </div>
            <div className="row">
              <label htmlFor="util-cura-machine-def">
                Cura machine definition (-j), optional
                <input
                  id="util-cura-machine-def"
                  value={p.settings.curaMachineDefinitionPath ?? ''}
                  onChange={(e) =>
                    void p.onSaveSettingsField({
                      curaMachineDefinitionPath: e.target.value.trim() ? e.target.value : undefined
                    })
                  }
                  placeholder="…\\my_printer.def.json (overrides bundled K2 Plus stub)"
                  autoComplete="off"
                  aria-describedby="util-settings-more-info"
                />
              </label>
            </div>
            <div className="row">
              <label htmlFor="util-python">
                {isCamProduct ? 'Python (OpenCAMLib / mesh)' : 'Python (OpenCAMLib / CadQuery)'}
                <input
                  id="util-python"
                  value={p.settings.pythonPath ?? ''}
                  onChange={(e) => void p.onSaveSettingsField({ pythonPath: e.target.value })}
                  placeholder="python"
                  autoComplete="off"
                  aria-describedby="util-settings-more-info"
                />
              </label>
            </div>
            <div className="row">
              <label htmlFor="util-carvera-cli">
                Carvera CLI executable (optional)
                <input
                  id="util-carvera-cli"
                  value={p.settings.carveraCliPath ?? ''}
                  onChange={(e) =>
                    void p.onSaveSettingsField({
                      carveraCliPath: e.target.value.trim() ? e.target.value : undefined
                    })
                  }
                  placeholder="carvera-cli (PATH) or full path"
                  autoComplete="off"
                  aria-describedby="util-settings-more-info"
                />
              </label>
            </div>
            <label htmlFor="util-carvera-extra-args" className="row">
              Carvera CLI extra args (JSON array, optional)
              <textarea
                id="util-carvera-extra-args"
                className="textarea--code"
                rows={2}
                value={p.settings.carveraCliExtraArgsJson ?? ''}
                onChange={(e) =>
                  void p.onSaveSettingsField({
                    carveraCliExtraArgsJson: e.target.value.trim() ? e.target.value : undefined
                  })
                }
                placeholder='["-m","carvera_cli"]'
                spellCheck={false}
                aria-describedby="util-settings-more-info"
              />
            </label>
            <p id="util-settings-more-info" className="msg util-settings-disclosure__footer-msg">
              See <code>resources/slicer/README.md</code> for <code>CURA_ENGINE_SEARCH_PATH</code> and bundled profile notes.{' '}
              Carvera: <code>docs/MACHINES.md</code> (Makera Carvera upload).
            </p>
          </SettingsDisclosure>
          <SettingsDisclosure id="util-cura-advanced" title="CuraEngine advanced (optional)">
            <p className="msg util-panel-intro">
              Extra <code>-s</code> keys use Cura setting ids (underscore names). Merged after the numeric preset on the{' '}
              <strong>{isCamProduct ? 'Slice' : 'Manufacture → Slice'}</strong> tab. Named profiles JSON can set a per-material{' '}
              <code>basePreset</code> plus <code>settingsJson</code>.
            </p>
            <label htmlFor="util-cura-extra-json">
              Extra Cura settings JSON
              <textarea
                id="util-cura-extra-json"
                className="textarea--code"
                rows={4}
                value={p.settings.curaEngineExtraSettingsJson ?? ''}
                onChange={(e) =>
                  void p.onSaveSettingsField({
                    curaEngineExtraSettingsJson: e.target.value.trim() ? e.target.value : undefined
                  })
                }
                placeholder='{"infill_pattern":"grid"}'
                spellCheck={false}
              />
            </label>
            <label htmlFor="util-cura-profiles-json">
              Named profiles JSON
              <textarea
                id="util-cura-profiles-json"
                className="textarea--code"
                rows={6}
                value={p.settings.curaSliceProfilesJson ?? ''}
                onChange={(e) =>
                  void p.onSaveSettingsField({
                    curaSliceProfilesJson: e.target.value.trim() ? e.target.value : undefined
                  })
                }
                placeholder='[{"id":"pla","label":"PLA","basePreset":"balanced","settingsJson":"{}"}]'
                spellCheck={false}
              />
            </label>
          </SettingsDisclosure>
          <p className="msg util-panel-intro">Settings are auto-saved per field for quicker tab-to-tab workflows.</p>
          <SettingsDisclosure id="util-machine-manager" title="Machine Manager">
            <p className="msg util-panel-intro">
              Manage <strong>your</strong> machine profiles (imported JSON/YAML/TOML or .cps stubs). Bundled app machines stay
              available for projects elsewhere but do not appear in this list.
            </p>
            <MachineManagerPanel />
          </SettingsDisclosure>
        </section>
      ) : (
        <section
          className="panel workspace-util-panel"
          aria-labelledby="util-settings-heading"
          aria-busy="true"
        >
          <h2 id="util-settings-heading">Settings</h2>
          <p className="msg util-panel-intro" role="status" aria-live="polite">
            Loading settings…
          </p>
        </section>
      )
    default: {
      const _exhaustive: never = p.tab
      return _exhaustive
    }
  }
}
