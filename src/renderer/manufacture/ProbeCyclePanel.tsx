import { useCallback, useState, type ReactNode } from 'react'
import type { ProbeCycleType } from '../../shared/probing-cycles'

// ── Constants ────────────────────────────────────────────────────────────────

const PROBE_TYPE_LABELS: Record<ProbeCycleType, string> = {
  singleSurface: 'Single Surface',
  boreCenter: 'Bore Center',
  bossCenter: 'Boss Center',
  cornerFind: 'Corner Find',
  toolLength: 'Tool Length',
}

const PROBE_TYPE_DESCRIPTIONS: Record<ProbeCycleType, string> = {
  singleSurface: 'Probe toward a surface along one axis to set a WCS offset.',
  boreCenter: 'Probe 4 walls of a bore to find center and set WCS XY.',
  bossCenter: 'Probe 4 faces of a boss to find center and set WCS XY.',
  cornerFind: 'Probe an X face and Y face to locate a corner for WCS XY origin.',
  toolLength: 'Probe Z downward onto a tool setter for tool length offset.',
}

const PROBE_TYPES: ProbeCycleType[] = [
  'singleSurface',
  'boreCenter',
  'bossCenter',
  'cornerFind',
  'toolLength',
]

const AXIS_OPTIONS = ['x', 'y', 'z'] as const
const DIRECTION_OPTIONS = [1, -1] as const

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a numeric input value, returning undefined for empty/invalid. */
function parseNum(val: string): number | undefined {
  const n = parseFloat(val)
  return Number.isFinite(n) ? n : undefined
}

// ── Component ────────────────────────────────────────────────────────────────

export function ProbeCyclePanel(): ReactNode {
  // Probe type selection
  const [probeType, setProbeType] = useState<ProbeCycleType>('singleSurface')

  // Common params
  const [probeFeedMmMin, setProbeFeedMmMin] = useState('100')
  const [retractMm, setRetractMm] = useState('3')
  const [wcsIndex, setWcsIndex] = useState('1')

  // singleSurface params
  const [axis, setAxis] = useState<'x' | 'y' | 'z'>('z')
  const [direction, setDirection] = useState<1 | -1>(-1)
  const [maxTravelMm, setMaxTravelMm] = useState('25')
  const [expectedPositionMm, setExpectedPositionMm] = useState('')

  // boreCenter params
  const [approxDiameterMm, setApproxDiameterMm] = useState('25')
  const [probeDepthMm, setProbeDepthMm] = useState('10')

  // bossCenter params
  const [approxWidthMm, setApproxWidthMm] = useState('25')
  const [probeHeightMm, setProbeHeightMm] = useState('10')

  // cornerFind params
  const [maxTravelXMm, setMaxTravelXMm] = useState('25')
  const [maxTravelYMm, setMaxTravelYMm] = useState('25')

  // toolLength params
  const [toolMaxTravelMm, setToolMaxTravelMm] = useState('50')
  const [toolSetterHeightMm, setToolSetterHeightMm] = useState('')

  // Output state
  const [gcode, setGcode] = useState('')
  const [error, setError] = useState('')
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const buildParams = useCallback((): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      probeFeedMmMin: parseNum(probeFeedMmMin) ?? 100,
      retractMm: parseNum(retractMm) ?? 3,
      wcsIndex: parseNum(wcsIndex) ?? 1,
    }

    switch (probeType) {
      case 'singleSurface':
        base.axis = axis
        base.direction = direction
        base.maxTravelMm = parseNum(maxTravelMm) ?? 25
        if (expectedPositionMm.trim()) {
          base.expectedPositionMm = parseNum(expectedPositionMm)
        }
        break
      case 'boreCenter':
        base.approxDiameterMm = parseNum(approxDiameterMm) ?? 25
        base.probeDepthMm = parseNum(probeDepthMm) ?? 10
        break
      case 'bossCenter':
        base.approxWidthMm = parseNum(approxWidthMm) ?? 25
        base.probeHeightMm = parseNum(probeHeightMm) ?? 10
        break
      case 'cornerFind':
        base.maxTravelXMm = parseNum(maxTravelXMm) ?? 25
        base.maxTravelYMm = parseNum(maxTravelYMm) ?? 25
        break
      case 'toolLength':
        base.maxTravelMm = parseNum(toolMaxTravelMm) ?? 50
        if (toolSetterHeightMm.trim()) {
          base.toolSetterHeightMm = parseNum(toolSetterHeightMm)
        }
        break
    }

    return base
  }, [
    probeType, probeFeedMmMin, retractMm, wcsIndex,
    axis, direction, maxTravelMm, expectedPositionMm,
    approxDiameterMm, probeDepthMm,
    approxWidthMm, probeHeightMm,
    maxTravelXMm, maxTravelYMm,
    toolMaxTravelMm, toolSetterHeightMm,
  ])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setError('')
    setGcode('')
    setCopied(false)
    try {
      const result = await window.fab.probeGenerate({
        type: probeType,
        params: buildParams() as Parameters<typeof window.fab.probeGenerate>[0]['params'],
      })
      if (result.ok) {
        setGcode(result.gcode)
      } else {
        setError(result.error)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setGenerating(false)
    }
  }, [probeType, buildParams])

  const handleCopy = useCallback(async () => {
    if (!gcode) return
    try {
      await navigator.clipboard.writeText(gcode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select the textarea content
      const ta = document.querySelector('.probe-panel__gcode') as HTMLTextAreaElement | null
      if (ta) {
        ta.select()
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    }
  }, [gcode])

  return (
    <div className="probe-panel">
      <div className="probe-panel__header">
        <span className="probe-panel__icon">&#x2316;</span>
        <span className="probe-panel__title">Probing Cycle</span>
      </div>
      <p className="probe-panel__description">
        Generate safe touch-probe G-code for WCS zeroing. Verify on your controller before running on real hardware.
      </p>

      {/* ── Probe type selector ── */}
      <label className="probe-panel__field">
        Probe type
        <select
          className="probe-panel__select"
          value={probeType}
          onChange={(e) => {
            setProbeType(e.target.value as ProbeCycleType)
            setGcode('')
            setError('')
          }}
        >
          {PROBE_TYPES.map((t) => (
            <option key={t} value={t}>{PROBE_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </label>
      <p className="probe-panel__hint">{PROBE_TYPE_DESCRIPTIONS[probeType]}</p>

      {/* ── Common params ── */}
      <div className="probe-panel__section-label">Common Parameters</div>
      <div className="probe-panel__row">
        <label className="probe-panel__field">
          Probe feed (mm/min)
          <input
            type="number"
            min={1}
            step={10}
            value={probeFeedMmMin}
            onChange={(e) => setProbeFeedMmMin(e.target.value)}
            placeholder="100"
          />
        </label>
        <label className="probe-panel__field">
          Retract (mm)
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={retractMm}
            onChange={(e) => setRetractMm(e.target.value)}
            placeholder="3"
          />
        </label>
        <label className="probe-panel__field">
          WCS (1-6)
          <select
            value={wcsIndex}
            onChange={(e) => setWcsIndex(e.target.value)}
          >
            <option value="1">1 (G54)</option>
            <option value="2">2 (G55)</option>
            <option value="3">3 (G56)</option>
            <option value="4">4 (G57)</option>
            <option value="5">5 (G58)</option>
            <option value="6">6 (G59)</option>
          </select>
        </label>
      </div>

      {/* ── Type-specific params ── */}
      <div className="probe-panel__section-label">
        {PROBE_TYPE_LABELS[probeType]} Parameters
      </div>

      {probeType === 'singleSurface' && (
        <div className="probe-panel__row">
          <label className="probe-panel__field">
            Axis
            <select value={axis} onChange={(e) => setAxis(e.target.value as 'x' | 'y' | 'z')}>
              {AXIS_OPTIONS.map((a) => (
                <option key={a} value={a}>{a.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <label className="probe-panel__field">
            Direction
            <select
              value={String(direction)}
              onChange={(e) => setDirection(Number(e.target.value) as 1 | -1)}
            >
              {DIRECTION_OPTIONS.map((d) => (
                <option key={d} value={String(d)}>{d > 0 ? '+' : '-'} ({d > 0 ? 'positive' : 'negative'})</option>
              ))}
            </select>
          </label>
          <label className="probe-panel__field">
            Max travel (mm)
            <input
              type="number"
              min={0.1}
              step={1}
              value={maxTravelMm}
              onChange={(e) => setMaxTravelMm(e.target.value)}
              placeholder="25"
            />
          </label>
          <label className="probe-panel__field">
            Expected pos (mm)
            <input
              type="number"
              step={0.1}
              value={expectedPositionMm}
              onChange={(e) => setExpectedPositionMm(e.target.value)}
              placeholder="optional"
            />
          </label>
        </div>
      )}

      {probeType === 'boreCenter' && (
        <div className="probe-panel__row">
          <label className="probe-panel__field">
            Approx. diameter (mm)
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={approxDiameterMm}
              onChange={(e) => setApproxDiameterMm(e.target.value)}
              placeholder="25"
            />
          </label>
          <label className="probe-panel__field">
            Probe depth (mm)
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={probeDepthMm}
              onChange={(e) => setProbeDepthMm(e.target.value)}
              placeholder="10"
            />
          </label>
        </div>
      )}

      {probeType === 'bossCenter' && (
        <div className="probe-panel__row">
          <label className="probe-panel__field">
            Approx. width (mm)
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={approxWidthMm}
              onChange={(e) => setApproxWidthMm(e.target.value)}
              placeholder="25"
            />
          </label>
          <label className="probe-panel__field">
            Probe height (mm)
            <input
              type="number"
              min={0.1}
              step={0.5}
              value={probeHeightMm}
              onChange={(e) => setProbeHeightMm(e.target.value)}
              placeholder="10"
            />
          </label>
        </div>
      )}

      {probeType === 'cornerFind' && (
        <div className="probe-panel__row">
          <label className="probe-panel__field">
            Max X travel (mm)
            <input
              type="number"
              min={0.1}
              step={1}
              value={maxTravelXMm}
              onChange={(e) => setMaxTravelXMm(e.target.value)}
              placeholder="25"
            />
          </label>
          <label className="probe-panel__field">
            Max Y travel (mm)
            <input
              type="number"
              min={0.1}
              step={1}
              value={maxTravelYMm}
              onChange={(e) => setMaxTravelYMm(e.target.value)}
              placeholder="25"
            />
          </label>
        </div>
      )}

      {probeType === 'toolLength' && (
        <div className="probe-panel__row">
          <label className="probe-panel__field">
            Max Z travel (mm)
            <input
              type="number"
              min={0.1}
              step={1}
              value={toolMaxTravelMm}
              onChange={(e) => setToolMaxTravelMm(e.target.value)}
              placeholder="50"
            />
          </label>
          <label className="probe-panel__field">
            Tool setter height (mm)
            <input
              type="number"
              step={0.1}
              value={toolSetterHeightMm}
              onChange={(e) => setToolSetterHeightMm(e.target.value)}
              placeholder="optional"
            />
          </label>
        </div>
      )}

      {/* ── Generate button ── */}
      <div className="probe-panel__actions">
        <button
          type="button"
          className="primary"
          onClick={() => void handleGenerate()}
          disabled={generating}
          aria-label="Generate probe G-code"
        >
          {generating ? 'Generating...' : 'Generate Probe G-code'}
        </button>
      </div>

      {/* ── Error display ── */}
      {error && (
        <p className="probe-panel__error" role="alert">{error}</p>
      )}

      {/* ── G-code output ── */}
      {gcode && (
        <div className="probe-panel__output">
          <div className="probe-panel__output-header">
            <span className="probe-panel__output-title">Generated G-code</span>
            <button
              type="button"
              className="secondary probe-panel__copy-btn"
              onClick={() => void handleCopy()}
              aria-label="Copy G-code to clipboard"
            >
              {copied ? 'Copied' : 'Copy to Clipboard'}
            </button>
          </div>
          <textarea
            className="probe-panel__gcode"
            readOnly
            value={gcode}
            rows={Math.min(20, gcode.split('\n').length + 1)}
            aria-label="Generated probe G-code"
          />
        </div>
      )}
    </div>
  )
}
