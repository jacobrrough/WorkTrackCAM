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
type MoonrakerHeaterPanel = { presentC?: number; targetC?: number }
type MoonrakerProbe =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | {
      kind: 'ok'
      rawState: string
      hostname?: string
      firmwareVersion?: string
      bed?: MoonrakerHeaterPanel
      nozzle?: MoonrakerHeaterPanel
    }
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
  const carveraCliPath = typeof settings.carveraCliPath === 'string' ? settings.carveraCliPath : ''
  const carveraCliExtraArgsJson = typeof settings.carveraCliExtraArgsJson === 'string' ? settings.carveraCliExtraArgsJson : ''
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
        carveraCliPath: carveraCliPath || undefined,
        carveraCliExtraArgsJson: carveraCliExtraArgsJson || undefined,
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

  /**
   * Test connection: first verifies the Moonraker server speaks JSON via the
   * fast `moonrakerStatus` probe (gives us print state), then fetches the
   * richer `moonrakerInfo` (hostname, firmware version, live bed + nozzle
   * temperatures). Surfaces the real error message on failure instead of
   * just a red dot, so the operator can diagnose timeout vs 4xx vs network.
   */
  const handleTestMoonraker = async (): Promise<void> => {
    const trimmed = moonrakerUrl.trim()
    if (!trimmed) {
      setMoonrakerProbe({ kind: 'err', message: 'Enter a Moonraker URL first.' })
      return
    }
    setMoonrakerProbe({ kind: 'busy' })
    try {
      const status = await fab().moonrakerStatus(trimmed)
      if (!status.ok) {
        const err = (status as { error?: string; detail?: string }).error ?? 'Could not reach printer.'
        const detail = (status as { detail?: string }).detail
        setMoonrakerProbe({
          kind: 'err',
          message: detail ? `${err} ${detail}` : err
        })
        return
      }
      const raw = (status as { rawState?: string; state?: string }).rawState
        ?? (status as { state?: string }).state
        ?? 'unknown'
      const info = await fab().moonrakerInfo(trimmed)
      if (!info.ok) {
        // Status worked but info failed — surface that the printer is
        // up but didn't honour /printer/info (rare but possible if the
        // user has a custom Moonraker auth scheme).
        const err = info.error
        const detail = info.detail
        setMoonrakerProbe({
          kind: 'err',
          message: detail ? `${err} ${detail}` : err
        })
        return
      }
      setMoonrakerProbe({
        kind: 'ok',
        rawState: raw,
        ...(info.hostname !== undefined ? { hostname: info.hostname } : {}),
        ...(info.firmwareVersion !== undefined ? { firmwareVersion: info.firmwareVersion } : {}),
        ...(info.bed !== undefined ? { bed: info.bed } : {}),
        ...(info.nozzle !== undefined ? { nozzle: info.nozzle } : {})
      })
    } catch (e) {
      setMoonrakerProbe({ kind: 'err', message: e instanceof Error ? e.message : String(e) })
    }
  }

  // Pure formatter — keeps the JSX tidy + lets the unit tests assert the copy.
  const formatHeaterLine = (label: string, h: MoonrakerHeaterPanel | undefined): string | null => {
    if (h === undefined) return null
    const present = h.presentC !== undefined ? `${h.presentC.toFixed(1)}°C` : '—'
    const target = h.targetC !== undefined ? `${h.targetC.toFixed(1)}°C` : '—'
    return `${label}: ${present} / Target ${target}`
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
            <span className="settings-hint">
              Find your K2 Plus IP from the router DHCP table, the K2 touchscreen Settings, or try the mDNS name k2plus.local. Default Moonraker port is 7125.
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
                      {moonrakerProbe.hostname !== undefined
                        ? `Connected to ${moonrakerProbe.hostname}`
                        : 'Connected'}
                      {moonrakerProbe.firmwareVersion !== undefined
                        ? ` (Klipper ${moonrakerProbe.firmwareVersion})`
                        : ''}
                      {' · '}rawState: {moonrakerProbe.rawState}
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
            {moonrakerProbe.kind === 'ok' &&
              (moonrakerProbe.bed !== undefined || moonrakerProbe.nozzle !== undefined) && (
                <div
                  className="settings-probe-temps"
                  role="group"
                  aria-label="Moonraker live temperatures"
                >
                  {formatHeaterLine('Bed', moonrakerProbe.bed) !== null && (
                    <div className="settings-probe-temps__row">
                      {formatHeaterLine('Bed', moonrakerProbe.bed)}
                    </div>
                  )}
                  {formatHeaterLine('Nozzle', moonrakerProbe.nozzle) !== null && (
                    <div className="settings-probe-temps__row">
                      {formatHeaterLine('Nozzle', moonrakerProbe.nozzle)}
                    </div>
                  )}
                </div>
              )}
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

      {/* ── 4. External tool paths ─────────────────────────────────────── */}
      <fieldset className="settings-section card">
        <legend className="settings-section__legend">External tool paths</legend>
        <div className="card-body section-gap">
          <div className="form-group">
            <label htmlFor="settings-carvera-cli-path">carvera-cli executable (Makera Carvera upload)</label>
            <input
              id="settings-carvera-cli-path"
              data-testid="carvera-cli-path-input"
              type="text"
              placeholder="C:\\Tools\\carvera-cli.exe  or  /usr/local/bin/carvera-cli"
              value={carveraCliPath}
              onChange={e => setField('carveraCliPath', e.target.value)}
              aria-describedby="settings-carvera-cli-path-hint"
            />
            <span id="settings-carvera-cli-path-hint" className="settings-hint">
              Absolute path to the community carvera-cli executable used to upload G-code to the Carvera. Leave empty to fall back to <code>carvera-cli</code> on PATH.
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="settings-carvera-cli-extra-args">carvera-cli extra args (JSON array)</label>
            <textarea
              id="settings-carvera-cli-extra-args"
              data-testid="carvera-cli-extra-args-input"
              rows={2}
              spellCheck={false}
              placeholder='["-m","carvera_cli"]'
              value={carveraCliExtraArgsJson}
              onChange={e => setField('carveraCliExtraArgsJson', e.target.value)}
              aria-describedby="settings-carvera-cli-extra-args-hint"
            />
            <span id="settings-carvera-cli-extra-args-hint" className="settings-hint">
              Optional JSON array of extra argv inserted after the executable, e.g. <code>[&quot;-m&quot;,&quot;carvera_cli&quot;]</code> when running carvera-cli as a Python module.
            </span>
          </div>
        </div>
      </fieldset>

      {/* ── 5. Slicing defaults (K2 Plus) ──────────────────────────────── */}
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
