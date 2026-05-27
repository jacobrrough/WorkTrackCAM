/**
 * SettingsView -- Real, structured Settings panel for WorkTrackCAM.
 *
 * Rebuilt as the "Real Settings view" pass (replaces the legacy two-field engine-
 * path form). Organized into four semantic subsections, each in its own
 * `<fieldset><legend>` so screen readers announce the section name when focus
 * enters any control:
 *
 *   1. General             — theme, units, default machine
 *   2. Network & Printers  — Moonraker URL + API key + Test connection
 *   3. Paths               — Python executable, OrcaSlicer bundle status
 *   4. Slicing defaults    — K2 Plus quality preset, default filament
 *
 * Every new field added to `appSettingsSchema` is `.optional()` so existing
 * stored settings continue to parse unchanged (CLAUDE.md schema gate).
 *
 * Out of scope for this view: machine creation / management (lives in the
 * Library drawer), G-code post-processor edits (Safety Rule 1), cloud /
 * profile sync (out of scope per the gap-analysis report).
 */
import React, { useEffect, useMemo, useState } from 'react'
import type { Toast } from './shop-types'
import { fab } from './shop-types'
import type { MachineProfile } from '../../shared/machine-schema'
import type { FilamentRecord } from '../../shared/filament-schema'

export interface SettingsViewProps {
  onToast: (k: Toast['kind'], m: string) => void
}

type OrcaStatus = { bundled: boolean; expectedPath: string; platform: string }
type MoonrakerProbe =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'ok'; rawState: string }
  | { kind: 'err'; message: string }

export function SettingsView({ onToast }: SettingsViewProps): React.ReactElement {
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  const [machines, setMachines] = useState<MachineProfile[]>([])
  const [filaments, setFilaments] = useState<FilamentRecord[]>([])
  const [orcaStatus, setOrcaStatus] = useState<OrcaStatus | null>(null)
  const [moonrakerProbe, setMoonrakerProbe] = useState<MoonrakerProbe>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)

  // ── Initial load ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [s, ms] = await Promise.all([
          fab().settingsGet(),
          fab().machinesList()
        ])
        if (cancelled) return
        setSettings(s as Record<string, unknown>)
        setMachines(ms)
      } catch (e) {
        console.error(e)
        if (!cancelled) onToast('err', 'Failed to load settings')
      }
      // Filaments + Orca status are non-fatal — render the panel even if these fail.
      try {
        const f = await window.fab.filamentsList()
        if (!cancelled) setFilaments(f)
      } catch { /* leave filaments empty */ }
      try {
        const status = await window.fab.slicerOrcaStatus()
        if (!cancelled) setOrcaStatus(status)
      } catch { /* leave orcaStatus null */ }
    })()
    return () => { cancelled = true }
  }, [onToast])

  // ── Reads ───────────────────────────────────────────────────────────────
  const theme = useMemo<'dark' | 'light' | 'system'>(() => {
    const v = settings.theme
    if (v === 'light' || v === 'system') return v
    return 'dark'
  }, [settings.theme])

  const units = useMemo<'mm' | 'inch'>(() => {
    return settings.units === 'inch' ? 'inch' : 'mm'
  }, [settings.units])

  const defaultMachineId = typeof settings.defaultMachineId === 'string' ? settings.defaultMachineId : ''
  const moonrakerUrl = typeof settings.moonrakerUrl === 'string' ? settings.moonrakerUrl : ''
  const moonrakerApiKey = typeof settings.moonrakerApiKey === 'string' ? settings.moonrakerApiKey : ''
  const pythonPath = typeof settings.pythonPath === 'string' ? settings.pythonPath : ''
  const k2QualityPresetId = useMemo<'standard' | 'high_speed'>(() => {
    return settings.k2QualityPresetId === 'high_speed' ? 'high_speed' : 'standard'
  }, [settings.k2QualityPresetId])
  const activeFilamentId = typeof settings.activeFilamentId === 'string' ? settings.activeFilamentId : ''

  // ── Mutations ───────────────────────────────────────────────────────────
  const setField = (key: string, value: unknown): void => {
    setSettings(s => ({ ...s, [key]: value }))
  }

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    try {
      // Send only the keys this panel owns so concurrent updates from other
      // surfaces (e.g. recent-projects MRU on EnvironmentSplash) are not
      // clobbered by the stale snapshot we loaded at mount.
      const patch: Record<string, unknown> = {
        theme,
        units,
        defaultMachineId: defaultMachineId || undefined,
        moonrakerUrl: moonrakerUrl || undefined,
        moonrakerApiKey: moonrakerApiKey || undefined,
        pythonPath: pythonPath || undefined,
        k2QualityPresetId,
        activeFilamentId: activeFilamentId || undefined
      }
      await fab().settingsSet(patch)
      onToast('ok', 'Settings saved')
    } catch (e) {
      onToast('err', `Failed to save settings: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  const handleBrowsePython = async (): Promise<void> => {
    const p = await fab().dialogOpenFile([{ name: 'Python Executable', extensions: ['*'] }])
    if (p) setField('pythonPath', p)
  }

  const handleTestMoonraker = async (): Promise<void> => {
    if (!moonrakerUrl.trim()) {
      setMoonrakerProbe({ kind: 'err', message: 'Enter a Moonraker URL first.' })
      return
    }
    setMoonrakerProbe({ kind: 'busy' })
    try {
      const r = await fab().moonrakerStatus(moonrakerUrl.trim())
      if (r.ok) {
        const raw = (r as { rawState?: string; state?: string }).rawState
          ?? (r as { state?: string }).state
          ?? 'unknown'
        setMoonrakerProbe({ kind: 'ok', rawState: raw })
      } else {
        const err = (r as { error?: string }).error ?? 'Could not reach printer.'
        setMoonrakerProbe({ kind: 'err', message: err })
      }
    } catch (e) {
      setMoonrakerProbe({ kind: 'err', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="settings-view settings-view--structured">
      <h2 className="settings-view__title">Settings</h2>

      {/* ── 1. General ─────────────────────────────────────────────────── */}
      <fieldset className="settings-section card">
        <legend className="settings-section__legend">General</legend>
        <div className="card-body section-gap">
          <div className="form-group">
            <label htmlFor="settings-theme">Theme</label>
            <select
              id="settings-theme"
              value={theme}
              onChange={e => setField('theme', e.target.value)}
              aria-describedby="settings-theme-hint"
            >
              <option value="system">System (follow OS)</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
            <span id="settings-theme-hint" className="settings-hint">
              Persists immediately; a future cycle wires the OS prefers-color-scheme flip.
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="settings-units">Units</label>
            <select
              id="settings-units"
              value={units}
              onChange={e => setField('units', e.target.value)}
              aria-describedby="settings-units-hint"
            >
              <option value="mm">Millimeters (mm)</option>
              <option value="inch">Inches (in)</option>
            </select>
            <span id="settings-units-hint" className="settings-hint">
              Display unit. Machine G-code dialects own their own units (K2 Plus = mm).
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="settings-default-machine">Default machine</label>
            <select
              id="settings-default-machine"
              value={defaultMachineId}
              onChange={e => setField('defaultMachineId', e.target.value || undefined)}
              aria-describedby="settings-default-machine-hint"
            >
              <option value="">— None (use last selected) —</option>
              {machines.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <span id="settings-default-machine-hint" className="settings-hint">
              New projects pre-select this machine. Unknown ids fall through to the last-used.
            </span>
          </div>
        </div>
      </fieldset>

      {/* ── 2. Network & Printers ──────────────────────────────────────── */}
      <fieldset className="settings-section card">
        <legend className="settings-section__legend">Network & Printers</legend>
        <div className="card-body section-gap">
          <div className="form-group">
            <label htmlFor="settings-moonraker-url">Moonraker URL (K2 Plus)</label>
            <input
              id="settings-moonraker-url"
              type="text"
              placeholder="http://k2plus.local  or  http://192.168.1.50"
              value={moonrakerUrl}
              onChange={e => setField('moonrakerUrl', e.target.value)}
              aria-describedby="settings-moonraker-url-hint"
            />
            <span id="settings-moonraker-url-hint" className="settings-hint">
              Base URL of the K2 Plus Moonraker API. Used by the Manufacture &quot;Send to K2 Plus&quot; button.
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="settings-moonraker-key">Moonraker API Key (optional)</label>
            <input
              id="settings-moonraker-key"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Leave empty for default K2 Plus (anonymous access)"
              value={moonrakerApiKey}
              onChange={e => setField('moonrakerApiKey', e.target.value)}
              aria-describedby="settings-moonraker-key-hint"
            />
            <span id="settings-moonraker-key-hint" className="settings-hint">
              Sent as X-Api-Key header when set. Required only if Moonraker [authorization] is enabled.
            </span>
          </div>

          <div className="form-group">
            <div className="input-row">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => { void handleTestMoonraker() }}
                disabled={moonrakerProbe.kind === 'busy' || moonrakerUrl.trim() === ''}
                aria-describedby="settings-moonraker-probe-status"
              >
                {moonrakerProbe.kind === 'busy' ? 'Testing…' : 'Test connection'}
              </button>
              <span
                id="settings-moonraker-probe-status"
                className="settings-probe-status"
                role="status"
                aria-live="polite"
              >
                {moonrakerProbe.kind === 'idle' && (
                  <span className="settings-probe-dot settings-probe-dot--idle" aria-hidden="true" />
                )}
                {moonrakerProbe.kind === 'busy' && (
                  <span className="settings-probe-dot settings-probe-dot--busy" aria-hidden="true" />
                )}
                {moonrakerProbe.kind === 'ok' && (
                  <>
                    <span className="settings-probe-dot settings-probe-dot--ok" aria-hidden="true" />
                    <span className="settings-probe-label settings-probe-label--ok">
                      Connected{' · '}rawState: {moonrakerProbe.rawState}
                    </span>
                  </>
                )}
                {moonrakerProbe.kind === 'err' && (
                  <>
                    <span className="settings-probe-dot settings-probe-dot--err" aria-hidden="true" />
                    <span className="settings-probe-label settings-probe-label--err">
                      {moonrakerProbe.message}
                    </span>
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </fieldset>

      {/* ── 3. Paths ───────────────────────────────────────────────────── */}
      <fieldset className="settings-section card">
        <legend className="settings-section__legend">Paths</legend>
        <div className="card-body section-gap">
          <div className="form-group">
            <label htmlFor="settings-python-path">Python executable</label>
            <div className="input-row">
              <input
                id="settings-python-path"
                type="text"
                placeholder="python3"
                value={pythonPath}
                onChange={e => setField('pythonPath', e.target.value)}
                aria-describedby="settings-python-path-hint"
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { void handleBrowsePython() }}
              >
                Browse{'…'}
              </button>
            </div>
            <span id="settings-python-path-hint" className="settings-hint">
              Python runtime for CAM (OpenCAMLib) and CAD (CadQuery) sidecars. Leave empty to use system &quot;python&quot;.
            </span>
          </div>

          <div className="form-group">
            <label>OrcaSlicer (bundled)</label>
            <div className="settings-bundle-row" role="status" aria-live="polite">
              {orcaStatus === null && (
                <span className="settings-bundle-status settings-bundle-status--unknown">
                  Checking{'…'}
                </span>
              )}
              {orcaStatus?.bundled === true && (
                <>
                  <span className="settings-probe-dot settings-probe-dot--ok" aria-hidden="true" />
                  <span className="settings-bundle-status settings-bundle-status--ok">
                    Bundled
                  </span>
                  <code className="settings-bundle-path">{orcaStatus.expectedPath}</code>
                </>
              )}
              {orcaStatus?.bundled === false && (
                <>
                  <span className="settings-probe-dot settings-probe-dot--err" aria-hidden="true" />
                  <span className="settings-bundle-status settings-bundle-status--err">
                    Not bundled
                  </span>
                  <span className="settings-hint">
                    Run <code>scripts/bundle-orca-slicer.ps1</code> to install the CLI at <code>{orcaStatus.expectedPath}</code>.
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </fieldset>

      {/* ── 4. Slicing defaults (K2 Plus) ──────────────────────────────── */}
      <fieldset className="settings-section card">
        <legend className="settings-section__legend">Slicing defaults (K2 Plus)</legend>
        <div className="card-body section-gap">
          <div className="form-group">
            <label htmlFor="settings-k2-quality">Default K2 quality preset</label>
            <select
              id="settings-k2-quality"
              value={k2QualityPresetId}
              onChange={e => setField('k2QualityPresetId', e.target.value)}
              aria-describedby="settings-k2-quality-hint"
            >
              <option value="standard">Standard</option>
              <option value="high_speed">High-speed</option>
            </select>
            <span id="settings-k2-quality-hint" className="settings-hint">
              Applied to new FDM slice operations. The Manufacture panel can override per-job.
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="settings-default-filament">Default filament</label>
            <select
              id="settings-default-filament"
              value={activeFilamentId}
              onChange={e => setField('activeFilamentId', e.target.value || undefined)}
              aria-describedby="settings-default-filament-hint"
              disabled={filaments.length === 0}
            >
              <option value="">— None —</option>
              {filaments.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name}{f.brand ? ` · ${f.brand}` : ''}{f.type ? ` (${f.type})` : ''}
                </option>
              ))}
            </select>
            <span id="settings-default-filament-hint" className="settings-hint">
              {filaments.length === 0
                ? 'No filaments installed. Add one in the Library drawer.'
                : 'Pre-selected for new FDM slice operations.'}
            </span>
          </div>
        </div>
      </fieldset>

      <div className="settings-view__save-row">
        <button
          type="button"
          className="btn btn-generate"
          onClick={() => { void handleSave() }}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
