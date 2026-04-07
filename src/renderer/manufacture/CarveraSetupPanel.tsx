import { useState, type ReactNode } from 'react'
import {
  getCarveraPreflightChecklist,
  type CarveraPreflightItem,
  type CarveraZeroingMode,
} from '../../shared/carvera-zeroing'

// ── Types ──────────────────────────────────────────────────────────────────────

export type CarveraSetupPanelProps = {
  projectDir: string | null
  is4Axis: boolean
  onStatus?: (msg: string) => void
  carveraConn: 'auto' | 'wifi' | 'usb'
  carveraDevice: string
}

type ZeroingMode = Exclude<CarveraZeroingMode, 'preflight_check'>

const ZEROING_MODES: { value: ZeroingMode; label: string; description: string }[] = [
  { value: 'a_axis_zero', label: 'Zero A-Axis', description: 'Set current A position as 0' },
  { value: 'wcs_zero', label: 'Zero WCS', description: 'Set current XYZ/A position as WCS origin' },
  { value: 'z_probe', label: 'Z Probe', description: 'Probe Z with wireless probe (T0)' },
  { value: 'full_4axis_setup', label: 'Full 4-Axis Setup', description: 'Combined A-zero + Z-probe' },
]

const WCS_AXES = ['x', 'y', 'z', 'a'] as const

// ── Component ──────────────────────────────────────────────────────────────────

export function CarveraSetupPanel(p: CarveraSetupPanelProps): ReactNode {
  // ── Zeroing state ──
  const [mode, setMode] = useState<ZeroingMode>('z_probe')
  const [wcsAxes, setWcsAxes] = useState<Set<'x' | 'y' | 'z' | 'a'>>(new Set(['x', 'y', 'z']))
  const [wcsIndex, setWcsIndex] = useState(1)
  const [probeDistMm, setProbeDistMm] = useState(50)
  const [probeFeedMmMin, setProbeFeedMmMin] = useState(100)
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [previewGcode, setPreviewGcode] = useState('')

  // ── Checklist state ──
  const [checklistState, setChecklistState] = useState<Record<string, boolean>>({})
  const checklist = getCarveraPreflightChecklist({ is4Axis: p.is4Axis })
  const checkedCount = checklist.filter((item) => checklistState[item.id] === true).length
  const criticalItems = checklist.filter((item) => item.critical)
  const allCriticalChecked = criticalItems.every((item) => checklistState[item.id] === true)

  // ── Handlers ──

  function toggleWcsAxis(axis: 'x' | 'y' | 'z' | 'a'): void {
    setWcsAxes((prev) => {
      const next = new Set(prev)
      if (next.has(axis)) {
        next.delete(axis)
      } else {
        next.add(axis)
      }
      return next
    })
  }

  function toggleCheckItem(id: string): void {
    setChecklistState((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  function buildPayload(): Parameters<typeof window.fab.carveraGenerateSetup>[0] | null {
    if (!p.projectDir) return null
    const base = { mode, projectDir: p.projectDir }
    switch (mode) {
      case 'a_axis_zero':
        return base
      case 'wcs_zero':
        return { ...base, axes: [...wcsAxes], wcsIndex }
      case 'z_probe':
        return { ...base, probeDistMm, probeFeedMmMin }
      case 'full_4axis_setup':
        return { ...base, probeDistMm, probeFeedMmMin }
      default:
        return base
    }
  }

  async function generateSetup(): Promise<string | null> {
    const payload = buildPayload()
    if (!payload) {
      setStatusMsg('No project directory open.')
      p.onStatus?.('No project directory open.')
      return null
    }
    setBusy(true)
    setStatusMsg('')
    setPreviewGcode('')
    try {
      const r = await window.fab.carveraGenerateSetup(payload)
      if (r.ok) {
        const lines = r.gcode.split(/\r?\n/).slice(0, 20).join('\n')
        setPreviewGcode(lines)
        setStatusMsg(`Setup G-code saved to ${r.filePath}`)
        p.onStatus?.(`Setup G-code saved to ${r.filePath}`)
        return r.gcode
      } else {
        setStatusMsg(`Error: ${r.error}`)
        p.onStatus?.(`Setup generation failed: ${r.error}`)
        return null
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatusMsg(msg)
      p.onStatus?.(msg)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function generateAndUpload(): Promise<void> {
    const gcode = await generateSetup()
    if (!gcode || !p.projectDir) return
    setBusy(true)
    try {
      const sep = p.projectDir.includes('\\') ? '\\' : '/'
      const gcodePath = `${p.projectDir}${sep}output${sep}setup.nc`
      const r = await window.fab.carveraUpload({
        gcodePath,
        connection: p.carveraConn,
        device: p.carveraDevice.trim() || undefined,
        timeoutMs: 120_000,
      })
      if (r.ok) {
        setStatusMsg('Setup G-code generated and uploaded to Carvera.')
        p.onStatus?.('Carvera: setup G-code uploaded.')
      } else {
        setStatusMsg(`Upload failed: ${r.error}${r.detail ? ` — ${r.detail}` : ''}`)
        p.onStatus?.(`Upload failed: ${r.error}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatusMsg(msg)
      p.onStatus?.(msg)
    } finally {
      setBusy(false)
    }
  }

  // ── Render ──

  return (
    <div className="carvera-setup" role="region" aria-label="Carvera machine setup">
      {/* ── Section 1: Machine Zeroing ── */}
      <fieldset className="carvera-setup__section">
        <legend className="carvera-setup__heading" id="carvera-zeroing-heading">
          Machine Setup &amp; Zeroing
        </legend>

        <div className="carvera-setup__mode-select" role="radiogroup" aria-labelledby="carvera-zeroing-heading">
          {ZEROING_MODES.map((m) => (
            <label key={m.value} className="carvera-setup__mode-option" title={m.description}>
              <input
                type="radio"
                name="carvera-zeroing-mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
                aria-label={`${m.label}: ${m.description}`}
              />
              <span>{m.label}</span>
            </label>
          ))}
        </div>

        {/* WCS mode: axis checkboxes + WCS index */}
        {mode === 'wcs_zero' ? (
          <div className="carvera-setup__params">
            <fieldset className="carvera-setup__axis-checkboxes">
              <legend>Axes to zero</legend>
              {WCS_AXES.map((axis) => (
                <label key={axis} className="carvera-setup__axis-label">
                  <input
                    type="checkbox"
                    checked={wcsAxes.has(axis)}
                    onChange={() => toggleWcsAxis(axis)}
                    aria-label={`Zero ${axis.toUpperCase()} axis`}
                  />
                  {axis.toUpperCase()}
                </label>
              ))}
            </fieldset>
            <div className="carvera-setup__param-field">
              <label htmlFor="carvera-wcs-index">
                WCS index (1=G54, 2=G55, ...)
                <select
                  id="carvera-wcs-index"
                  value={wcsIndex}
                  onChange={(e) => setWcsIndex(Number(e.target.value))}
                  aria-label="Work coordinate system index"
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      P{n} (G5{3 + n})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}

        {/* Z Probe / Full 4-Axis: probe parameters */}
        {mode === 'z_probe' || mode === 'full_4axis_setup' ? (
          <div className="carvera-setup__params">
            <div className="carvera-setup__param-field">
              <label htmlFor="carvera-probe-dist">
                Probe distance (mm)
                <input
                  id="carvera-probe-dist"
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={probeDistMm}
                  onChange={(e) => setProbeDistMm(Number(e.target.value))}
                  aria-label="Maximum probe distance in millimeters"
                />
              </label>
            </div>
            <div className="carvera-setup__param-field">
              <label htmlFor="carvera-probe-feed">
                Probe feed (mm/min)
                <input
                  id="carvera-probe-feed"
                  type="number"
                  min={10}
                  max={500}
                  step={10}
                  value={probeFeedMmMin}
                  onChange={(e) => setProbeFeedMmMin(Number(e.target.value))}
                  aria-label="Probe feed rate in millimeters per minute"
                />
              </label>
            </div>
          </div>
        ) : null}

        {/* Action buttons */}
        <div className="carvera-setup__actions">
          <button
            type="button"
            className="secondary"
            disabled={!p.projectDir || busy}
            onClick={() => void generateSetup()}
            aria-label="Generate setup G-code for the selected zeroing mode"
          >
            {busy ? 'Generating...' : 'Generate Setup G-code'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!p.projectDir || busy}
            onClick={() => void generateAndUpload()}
            aria-label="Generate setup G-code and upload to Carvera"
          >
            {busy ? 'Working...' : 'Generate & Upload'}
          </button>
        </div>

        {/* Status message */}
        {statusMsg ? (
          <p className="msg carvera-setup__status" role="status" aria-live="polite">
            {statusMsg}
          </p>
        ) : null}

        {/* G-code preview */}
        {previewGcode ? (
          <div className="carvera-setup__preview" aria-label="Generated G-code preview">
            <h4 className="carvera-setup__preview-heading">G-code preview (first 20 lines)</h4>
            <pre className="carvera-setup__preview-code" tabIndex={0}>
              {previewGcode}
            </pre>
          </div>
        ) : null}
      </fieldset>

      {/* ── Section 2: Preflight Checklist ── */}
      <fieldset className="carvera-setup__section">
        <legend className="carvera-setup__heading" id="carvera-preflight-heading">
          Pre-Job Checklist
        </legend>

        <ul className="carvera-setup__checklist" aria-labelledby="carvera-preflight-heading">
          {checklist.map((item: CarveraPreflightItem) => (
            <li
              key={item.id}
              className={`carvera-setup__check-item${item.critical ? ' carvera-setup__check-item--critical' : ''}`}
            >
              <label className="carvera-setup__check-label" title={item.description}>
                <input
                  type="checkbox"
                  checked={checklistState[item.id] === true}
                  onChange={() => toggleCheckItem(item.id)}
                  aria-label={`${item.label}${item.critical ? ' (critical)' : ''}`}
                />
                <span>
                  {item.label}
                  {item.critical ? <span className="carvera-setup__critical-marker" aria-label="critical"> *</span> : null}
                </span>
              </label>
              <span className="carvera-setup__check-desc">{item.description}</span>
            </li>
          ))}
        </ul>

        <div className="carvera-setup__check-summary">
          <span>
            {checkedCount} of {checklist.length} checks complete
          </span>
          {allCriticalChecked ? (
            <span className="carvera-setup__check-ready" role="status" aria-live="polite">
              Ready to run
            </span>
          ) : (
            <span className="carvera-setup__check-incomplete" role="status" aria-live="polite">
              Checklist incomplete
            </span>
          )}
        </div>
      </fieldset>
    </div>
  )
}
