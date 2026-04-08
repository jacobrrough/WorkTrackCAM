import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import { COMMON_POST_TEMPLATE_FILENAMES } from '../../shared/machine-post-template-hints'
import { ConfirmDialog } from '../src/ConfirmDialog'

function machineSourceLabel(m: MachineProfile): string {
  if (m.meta?.importedFromCps) return 'From .cps'
  return 'Your machine'
}

function isUserProfile(m: MachineProfile | null): boolean {
  return m != null && m.meta?.source === 'user'
}

function userMachinesFromCatalog(machines: MachineProfile[]): MachineProfile[] {
  return machines.filter((m) => m.meta?.source === 'user')
}

type CatalogState = {
  machines: MachineProfile[]
  diagnostics: Array<{ source: string; file: string; error: string }>
}

export function MachineManagerPanel(): ReactNode {
  const [machineCatalog, setMachineCatalog] = useState<CatalogState>({ machines: [], diagnostics: [] })
  const [machineDraft, setMachineDraft] = useState<MachineProfile | null>(null)
  const [machineJsonImport, setMachineJsonImport] = useState('')
  const [machineStatus, setMachineStatus] = useState('')
  const [importPasteOpen, setImportPasteOpen] = useState(false)
  const [diagOpen, setDiagOpen] = useState(false)

  const userMachines = useMemo(() => userMachinesFromCatalog(machineCatalog.machines), [machineCatalog.machines])
  const userDiagnostics = useMemo(
    () => machineCatalog.diagnostics.filter((d) => d.source === 'user'),
    [machineCatalog.diagnostics]
  )

  const reloadCatalog = useCallback(async () => {
    try {
      const c = await window.fab.machinesCatalog()
      setMachineCatalog(c)
      const userOnly = userMachinesFromCatalog(c.machines)
      setMachineDraft((prev) => {
        if (!prev) return userOnly[0] ?? null
        const hitUser = userOnly.find((m) => m.id === prev.id)
        if (hitUser) return { ...hitUser }
        const inFull = c.machines.some((m) => m.id === prev.id)
        if (!inFull && prev.meta?.source === 'user') return prev
        return userOnly[0] ?? null
      })
    } catch (e) {
      setMachineStatus(`Failed to load machine catalog: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  useEffect(() => {
    void reloadCatalog()
  }, [reloadCatalog])

  const user = isUserProfile(machineDraft)
  const catalogIds = new Set(userMachines.map((m) => m.id))
  const draftNotYetInCatalog = Boolean(machineDraft && !catalogIds.has(machineDraft.id))

  const onSave = useCallback(() => {
    if (!machineDraft || !user) return
    setMachineStatus('')
    void window.fab
      .machinesSaveUser({ ...machineDraft, meta: { ...(machineDraft.meta ?? {}), source: 'user' } })
      .then(async () => {
        await reloadCatalog()
        setMachineStatus('Saved user machine profile.')
      })
      .catch((e) => setMachineStatus(e instanceof Error ? e.message : String(e)))
  }, [machineDraft, user, reloadCatalog])

  const onExport = useCallback(() => {
    if (!machineDraft) return
    setMachineStatus('')
    void window.fab.machinesExportUser(machineDraft.id).then((r) => {
      setMachineStatus(r.ok ? `Exported machine profile to ${r.path}` : `Export canceled (${r.error}).`)
    })
  }, [machineDraft])

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const onDelete = useCallback(() => {
    if (!machineDraft || !user) return
    setShowDeleteConfirm(true)
  }, [machineDraft, user])

  const doDelete = useCallback(() => {
    if (!machineDraft) return
    setShowDeleteConfirm(false)
    setMachineStatus('')
    void (async () => {
      await window.fab.machinesDeleteUser(machineDraft.id)
      await reloadCatalog()
      setMachineStatus('Deleted user machine profile.')
    })()
  }, [machineDraft, reloadCatalog])

  const onImportFile = useCallback(async () => {
    setMachineStatus('')
    const path = await window.fab.dialogOpenFile(
      [
        {
          name: 'Machine profile',
          extensions: ['json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'cps', 'txt']
        },
        { name: 'All files', extensions: ['*'] }
      ],
      undefined
    )
    if (!path) return
    try {
      const imported = await window.fab.machinesImportFile(path)
      await reloadCatalog()
      setMachineDraft({ ...imported })
      let msg = `Imported machine profile from ${path}.`
      if (imported.meta?.importedFromCps) {
        msg +=
          ' Stub from a Fusion .cps post: Unified Fab does not run .cps files. Review work area, feeds, and post template (Handlebars under resources/posts) before generating G-code.'
      }
      setMachineStatus(msg)
    } catch (e) {
      setMachineStatus(e instanceof Error ? e.message : String(e))
    }
  }, [reloadCatalog])

  const onImportText = useCallback(async () => {
    setMachineStatus('')
    if (!machineJsonImport.trim()) return
    try {
      await window.fab.machinesImportJson(machineJsonImport)
      await reloadCatalog()
      setMachineJsonImport('')
      setMachineStatus('Imported machine profile.')
    } catch (e) {
      setMachineStatus(e instanceof Error ? e.message : String(e))
    }
  }, [machineJsonImport, reloadCatalog])

  return (
    <div className="machine-manager">
      <div className="machine-manager__picker row">
        <label className="machine-manager__picker-label">
          Machine
          <select
            value={machineDraft?.id ?? ''}
            onChange={(e) => {
              const next = userMachines.find((m) => m.id === e.target.value) ?? null
              setMachineDraft(next ? { ...next } : null)
              setMachineStatus('')
            }}
          >
            <option value="">— Select —</option>
            {draftNotYetInCatalog && machineDraft ? (
              <option value={machineDraft.id}>
                {machineDraft.name} (unsaved draft)
              </option>
            ) : null}
            {userMachines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {machineSourceLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {machineDraft ? (
        <>
          <div className="machine-manager__section">
            <h3 className="machine-manager__section-title">Basics</h3>
            <div className="row">
              <label>
                Display name
                <input
                  value={machineDraft.name}
                  onChange={(e) => setMachineDraft({ ...machineDraft, name: e.target.value })}
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="row">
              <label>
                Machine ID
                <input
                  value={machineDraft.id}
                  onChange={(e) => setMachineDraft({ ...machineDraft, id: e.target.value })}
                  autoComplete="off"
                />
              </label>
              <label>
                Kind
                <select
                  value={machineDraft.kind}
                  onChange={(e) => setMachineDraft({ ...machineDraft, kind: e.target.value as 'cnc' | 'fdm' })}
                >
                  <option value="cnc">CNC (milling / CAM)</option>
                  <option value="fdm">FDM (printer / slice)</option>
                </select>
              </label>
            </div>
            <p className="msg msg--compact machine-manager__hint">
              CNC profiles drive CAM posts and envelopes; FDM profiles are used with slicing and machine selection.
            </p>
          </div>

          <div className="machine-manager__section">
            <h3 className="machine-manager__section-title">Work area and feeds</h3>
            <div className="row">
              <label>
                Work X (mm)
                <input
                  type="number"
                  value={machineDraft.workAreaMm.x}
                  onChange={(e) =>
                    setMachineDraft({
                      ...machineDraft,
                      workAreaMm: { ...machineDraft.workAreaMm, x: Number(e.target.value) || 1 }
                    })
                  }
                />
              </label>
              <label>
                Work Y (mm)
                <input
                  type="number"
                  value={machineDraft.workAreaMm.y}
                  onChange={(e) =>
                    setMachineDraft({
                      ...machineDraft,
                      workAreaMm: { ...machineDraft.workAreaMm, y: Number(e.target.value) || 1 }
                    })
                  }
                />
              </label>
              <label>
                Work Z (mm)
                <input
                  type="number"
                  value={machineDraft.workAreaMm.z}
                  onChange={(e) =>
                    setMachineDraft({
                      ...machineDraft,
                      workAreaMm: { ...machineDraft.workAreaMm, z: Number(e.target.value) || 1 }
                    })
                  }
                />
              </label>
            </div>
            <div className="row">
              <label>
                Max feed (mm/min)
                <input
                  type="number"
                  value={machineDraft.maxFeedMmMin}
                  onChange={(e) =>
                    setMachineDraft({
                      ...machineDraft,
                      maxFeedMmMin: Math.max(1, Number(e.target.value) || 1)
                    })
                  }
                />
              </label>
            </div>
          </div>

          <div className="machine-manager__section">
            <h3 className="machine-manager__section-title">Post and dialect</h3>
            <p className="msg msg--compact">
              G-code from CAM is <strong>unverified</strong> until you match the post, units, and clearances to your machine (
              <code>docs/MACHINES.md</code>).
            </p>
            <div className="row">
              <label>
                Post template (filename in <code>resources/posts</code>)
                <input
                  value={machineDraft.postTemplate}
                  onChange={(e) => setMachineDraft({ ...machineDraft, postTemplate: e.target.value })}
                  autoComplete="off"
                  placeholder="cnc_generic_mm.hbs"
                />
              </label>
            </div>
            <p className="msg msg--compact machine-manager__hint">
              Common files: {COMMON_POST_TEMPLATE_FILENAMES.join(', ')} — add your own <code>.hbs</code> beside bundled posts.
            </p>
            <div className="row">
              <label>
                Dialect
                <select
                  value={machineDraft.dialect}
                  onChange={(e) =>
                    setMachineDraft({
                      ...machineDraft,
                      dialect: e.target.value as MachineProfile['dialect']
                    })
                  }
                >
                  <option value="grbl">Grbl</option>
                  <option value="grbl_4axis">Grbl 4-axis</option>
                  <option value="fanuc_4axis">Fanuc 4-axis</option>
                  <option value="mach3_4axis">Mach3 4-axis</option>
                  <option value="linuxcnc_4axis">LinuxCNC 4-axis</option>
                  <option value="siemens_4axis">Siemens Sinumerik 4-axis</option>
                  <option value="heidenhain_4axis">Heidenhain TNC 4-axis</option>
                  <option value="mach3">Mach3</option>
                  <option value="generic_mm">Generic (mm)</option>
                  <option value="fanuc">Fanuc</option>
                  <option value="siemens">Siemens Sinumerik</option>
                  <option value="heidenhain">Heidenhain</option>
                </select>
              </label>
            </div>
          </div>

          {machineDraft.kind === 'cnc' ? (
            <div className="machine-manager__section">
              <h3 className="machine-manager__section-title">Axis configuration</h3>
              <div className="row">
                <label>
                  Axis count
                  <select
                    value={machineDraft.axisCount ?? 3}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setMachineDraft({ ...machineDraft, axisCount: v === 3 ? undefined : v })
                    }}
                  >
                    <option value={3}>3-axis (XYZ)</option>
                    <option value={4}>4-axis (XYZ + A rotary)</option>
                    <option value={5}>5-axis (XYZ + A + B)</option>
                  </select>
                </label>
              </div>
              {(machineDraft.axisCount ?? 3) >= 4 ? (
                <>
                  <div className="row">
                    <label>
                      A-axis range (°)
                      <input
                        type="number"
                        min={1}
                        max={720}
                        step={1}
                        value={machineDraft.aAxisRangeDeg ?? 360}
                        onChange={(e) =>
                          setMachineDraft({ ...machineDraft, aAxisRangeDeg: Number(e.target.value) || 360 })
                        }
                      />
                    </label>
                    <label>
                      A-axis orientation
                      <select
                        value={machineDraft.aAxisOrientation ?? 'x'}
                        onChange={(e) =>
                          setMachineDraft({ ...machineDraft, aAxisOrientation: e.target.value as 'x' | 'y' })
                        }
                      >
                        <option value="x">Rotates around X</option>
                        <option value="y">Rotates around Y</option>
                      </select>
                    </label>
                  </div>
                  <div className="row">
                    <label>
                      Max rotary RPM
                      <input
                        type="number"
                        min={1}
                        max={200}
                        step={1}
                        value={machineDraft.maxRotaryRpm ?? 20}
                        onChange={(e) =>
                          setMachineDraft({ ...machineDraft, maxRotaryRpm: Number(e.target.value) || 20 })
                        }
                      />
                    </label>
                  </div>
                  <p className="msg msg--compact machine-manager__hint">
                    Max rotary RPM limits A-axis angular velocity in posted G-code. Typical: 10-30 RPM
                    for worm-gear tables, 50-100 RPM for direct-drive.
                  </p>
                </>
              ) : null}
              {(machineDraft.axisCount ?? 3) >= 5 ? (
                <>
                  <div className="row">
                    <label>
                      B-axis range (°)
                      <input
                        type="number"
                        min={1}
                        max={720}
                        step={1}
                        value={machineDraft.bAxisRangeDeg ?? 120}
                        onChange={(e) =>
                          setMachineDraft({ ...machineDraft, bAxisRangeDeg: Number(e.target.value) || 120 })
                        }
                      />
                    </label>
                    <label>
                      Max tilt (°)
                      <input
                        type="number"
                        min={1}
                        max={180}
                        step={1}
                        value={machineDraft.maxTiltDeg ?? 60}
                        onChange={(e) =>
                          setMachineDraft({ ...machineDraft, maxTiltDeg: Number(e.target.value) || 60 })
                        }
                      />
                    </label>
                  </div>
                  <div className="row">
                    <label>
                      Kinematic chain
                      <select
                        value={machineDraft.fiveAxisType ?? 'table-head'}
                        onChange={(e) =>
                          setMachineDraft({
                            ...machineDraft,
                            fiveAxisType: e.target.value as 'table-table' | 'head-head' | 'table-head'
                          })
                        }
                      >
                        <option value="table-table">Table-Table (A+B in table)</option>
                        <option value="table-head">Table-Head (A in table, B in head)</option>
                        <option value="head-head">Head-Head (A+B in spindle head)</option>
                      </select>
                    </label>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="machine-manager__section machine-manager__actions">
            <h3 className="machine-manager__section-title">Actions</h3>
            <div className="row machine-manager__action-row">
              <button type="button" className="primary" onClick={onSave} disabled={!user}>
                Save profile
              </button>
              <button type="button" className="secondary" onClick={onExport} disabled={!machineDraft || draftNotYetInCatalog}>
                Export JSON…
              </button>
              <button
                type="button"
                className="secondary machine-manager__delete-btn"
                onClick={onDelete}
                disabled={!user || draftNotYetInCatalog}
              >
                Delete profile
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="msg util-output-placeholder" role="status">
          No imported profile yet. Use <strong>Import from file</strong> or paste JSON below — only machines you import appear
          in this list (app-bundled machines are hidden here).
        </p>
      )}

      <div className="machine-manager__section">
        <h3 className="machine-manager__section-title">Import</h3>
        <div className="row machine-manager__action-row">
          <button type="button" className="primary" onClick={() => void onImportFile()}>
            Import from file…
          </button>
        </div>
        <details
          className="machine-manager__paste-import"
          open={importPasteOpen}
          onToggle={(e) => setImportPasteOpen(e.currentTarget.open)}
        >
          <summary className="machine-manager__paste-summary">Paste profile text (JSON, YAML, TOML…)</summary>
          <label className="machine-manager__paste-label">
            <textarea
              rows={4}
              className="textarea--code"
              value={machineJsonImport}
              onChange={(e) => setMachineJsonImport(e.target.value)}
              placeholder="JSON / JSON5 / YAML / TOML — same fields as a saved profile"
              spellCheck={false}
            />
          </label>
          <button type="button" className="secondary" onClick={() => void onImportText()}>
            Import from text
          </button>
        </details>
      </div>

      {machineStatus ? (
        <p className="msg" role="status" aria-live="polite">
          {machineStatus}
        </p>
      ) : null}

      {userDiagnostics.length > 0 ? (
        <details
          className="machine-manager__diagnostics"
          open={diagOpen}
          onToggle={(e) => setDiagOpen(e.currentTarget.open)}
        >
          <summary className="machine-manager__diagnostics-summary">
            Load warnings ({userDiagnostics.length})
          </summary>
          <ul className="tools machine-manager__diagnostics-list">
            {userDiagnostics.map((d, i) => (
              <li key={`${d.file}-${i}`}>
                [{d.source}] {d.file}: {d.error}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete Machine"
        message={`Delete user machine "${machineDraft?.name ?? ''}"?\n\nThis cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={doDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
