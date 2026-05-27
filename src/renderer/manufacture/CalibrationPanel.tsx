/**
 * CalibrationPanel — K2 Plus calibration suite UI (Gap #4).
 *
 * Three cards (one per test) feed the `calibration:generate` IPC and
 * surface a per-card "Send to K2 Plus" button that reuses the existing
 * `moonraker:push` IPC. The panel only renders when the active machine
 * is the Creality K2 Plus -- My-Shop-Only mode hard-rejects any other
 * machine (CLAUDE.md).
 *
 * Cards:
 *   - Temperature tower (param: low / high / step C)
 *   - Flow rate cube    (param: cube edge mm / height mm / walls)
 *   - Pressure advance  (param: start / end / step PA; line length)
 *
 * Each card disables Generate when no project is open (we need a folder
 * to write output/calibration/*.gcode into) and disables Send until a
 * Moonraker URL is set AND a successful generation produced a file path.
 */
import { useState, type ReactNode } from 'react'
import type { AppSettings } from '../../shared/project-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import {
  buildMoonrakerPushPayload,
  formatMoonrakerPushFailure
} from '../src/moonraker-push-payload'

export type CalibrationPanelProps = {
  /** Active machine profile (used to gate on K2 Plus only). */
  activeMachine: MachineProfile | undefined
  /** Current app settings (for Moonraker URL + machine id). */
  settings: AppSettings | null
  /** Open project directory; calibration G-code is written under <projectDir>/output/calibration/. */
  projectDir: string | null
  /** Toast / status line hook. */
  onStatus?: (msg: string) => void
  /** Navigate to settings (for setting the Moonraker URL). */
  onGoSettings?: () => void
}

/** Per-card generated state. Tracked separately so cards do not interfere. */
type CardState = {
  generating: boolean
  sending: boolean
  /** Absolute path to the last successfully generated gcode file (or null). */
  lastGeneratedPath: string | null
  /** Human-readable summary from the builder (description field). */
  lastDescription: string | null
  /** Last error message, if any. */
  lastError: string | null
}

const EMPTY_CARD_STATE: CardState = {
  generating: false,
  sending: false,
  lastGeneratedPath: null,
  lastDescription: null,
  lastError: null
}

/** Pure helper: compose the output gcode path for a calibration test. */
export function calibrationOutputPath(
  projectDir: string,
  kind: 'temperature-tower' | 'flow-rate' | 'pressure-advance'
): string {
  const sep = projectDir.includes('\\') ? '\\' : '/'
  const filename =
    kind === 'temperature-tower'
      ? 'k2-temp-tower.gcode'
      : kind === 'flow-rate'
        ? 'k2-flow-rate.gcode'
        : 'k2-pressure-advance.gcode'
  return `${projectDir}${sep}output${sep}calibration${sep}${filename}`
}

export function CalibrationPanel(props: CalibrationPanelProps): ReactNode {
  const isK2Plus = props.activeMachine?.id === 'creality-k2-plus'
  const moonrakerUrl = props.settings?.moonrakerUrl?.trim() ?? ''
  const machineId = props.activeMachine?.id ?? null

  // Per-card form state -- defaults match the builder defaults from
  // src/main/calibration/k2-plus-tests.ts so the UI mirrors the on-disk
  // contract one-to-one.
  const [towerStart, setTowerStart] = useState<string>('190')
  const [towerEnd, setTowerEnd] = useState<string>('220')
  const [towerStep, setTowerStep] = useState<string>('5')
  const [towerBed, setTowerBed] = useState<string>('60')

  const [flowCubeSize, setFlowCubeSize] = useState<string>('30')
  const [flowCubeHeight, setFlowCubeHeight] = useState<string>('8')
  const [flowWalls, setFlowWalls] = useState<string>('1')
  const [flowNozzle, setFlowNozzle] = useState<string>('215')

  const [paStart, setPaStart] = useState<string>('0.000')
  const [paEnd, setPaEnd] = useState<string>('0.060')
  const [paStep, setPaStep] = useState<string>('0.010')
  const [paLineLen, setPaLineLen] = useState<string>('60')
  const [paNozzle, setPaNozzle] = useState<string>('215')

  const [towerState, setTowerState] = useState<CardState>(EMPTY_CARD_STATE)
  const [flowState, setFlowState] = useState<CardState>(EMPTY_CARD_STATE)
  const [paState, setPaState] = useState<CardState>(EMPTY_CARD_STATE)

  // ── Early-return gates ───────────────────────────────────────────────────
  if (!isK2Plus) {
    return (
      <section className="panel workspace-util-panel" aria-labelledby="mfg-calibrate-heading">
        <h2 id="mfg-calibrate-heading">Calibrate</h2>
        <p className="msg">
          The calibration suite is K2 Plus only. Select the <strong>Creality K2 Plus</strong>{' '}
          machine to access temperature tower, flow rate, and pressure advance tests.
        </p>
      </section>
    )
  }

  if (!props.projectDir) {
    return (
      <section className="panel workspace-util-panel" aria-labelledby="mfg-calibrate-heading">
        <h2 id="mfg-calibrate-heading">Calibrate</h2>
        <p className="msg">
          Open a project (File → Open Project) before generating calibration G-code.
          Calibration files are written under <code>&lt;project&gt;/output/calibration/</code>.
        </p>
      </section>
    )
  }

  const projectDir: string = props.projectDir

  // ── Parse helpers ────────────────────────────────────────────────────────
  function num(raw: string): number | undefined {
    const n = Number.parseFloat(raw)
    return Number.isFinite(n) ? n : undefined
  }

  // ── Generate / send action handlers (one pair per card) ─────────────────
  async function generateTower(): Promise<void> {
    setTowerState((s) => ({ ...s, generating: true, lastError: null }))
    try {
      const r = await window.fab.calibrationGenerate({
        kind: 'temperature-tower',
        params: {
          outputGcodePath: calibrationOutputPath(projectDir, 'temperature-tower'),
          startTempC: num(towerStart),
          endTempC: num(towerEnd),
          stepTempC: num(towerStep),
          bedTempC: num(towerBed)
        }
      })
      if (r.ok) {
        setTowerState({
          generating: false,
          sending: false,
          lastGeneratedPath: r.outputGcodePath,
          lastDescription: r.description,
          lastError: null
        })
        props.onStatus?.(`Generated temperature tower → ${r.outputGcodePath}`)
      } else {
        setTowerState({ ...EMPTY_CARD_STATE, lastError: `${r.error}${r.hint ? `: ${r.hint}` : ''}` })
      }
    } catch (e) {
      setTowerState({
        ...EMPTY_CARD_STATE,
        lastError: e instanceof Error ? e.message : String(e)
      })
    }
  }

  async function generateFlow(): Promise<void> {
    setFlowState((s) => ({ ...s, generating: true, lastError: null }))
    try {
      const r = await window.fab.calibrationGenerate({
        kind: 'flow-rate',
        params: {
          outputGcodePath: calibrationOutputPath(projectDir, 'flow-rate'),
          cubeSizeMm: num(flowCubeSize),
          cubeHeightMm: num(flowCubeHeight),
          wallCount: num(flowWalls),
          nozzleTempC: num(flowNozzle)
        }
      })
      if (r.ok) {
        setFlowState({
          generating: false,
          sending: false,
          lastGeneratedPath: r.outputGcodePath,
          lastDescription: r.description,
          lastError: null
        })
        props.onStatus?.(`Generated flow rate → ${r.outputGcodePath}`)
      } else {
        setFlowState({ ...EMPTY_CARD_STATE, lastError: `${r.error}${r.hint ? `: ${r.hint}` : ''}` })
      }
    } catch (e) {
      setFlowState({
        ...EMPTY_CARD_STATE,
        lastError: e instanceof Error ? e.message : String(e)
      })
    }
  }

  async function generatePa(): Promise<void> {
    setPaState((s) => ({ ...s, generating: true, lastError: null }))
    try {
      const r = await window.fab.calibrationGenerate({
        kind: 'pressure-advance',
        params: {
          outputGcodePath: calibrationOutputPath(projectDir, 'pressure-advance'),
          startPa: num(paStart),
          endPa: num(paEnd),
          stepPa: num(paStep),
          lineLengthMm: num(paLineLen),
          nozzleTempC: num(paNozzle)
        }
      })
      if (r.ok) {
        setPaState({
          generating: false,
          sending: false,
          lastGeneratedPath: r.outputGcodePath,
          lastDescription: r.description,
          lastError: null
        })
        props.onStatus?.(`Generated pressure advance → ${r.outputGcodePath}`)
      } else {
        setPaState({ ...EMPTY_CARD_STATE, lastError: `${r.error}${r.hint ? `: ${r.hint}` : ''}` })
      }
    } catch (e) {
      setPaState({
        ...EMPTY_CARD_STATE,
        lastError: e instanceof Error ? e.message : String(e)
      })
    }
  }

  async function sendCard(
    state: CardState,
    setState: (s: CardState) => void,
    label: string
  ): Promise<void> {
    if (!state.lastGeneratedPath || !moonrakerUrl || state.sending) return
    setState({ ...state, sending: true })
    try {
      const payload = buildMoonrakerPushPayload(
        {
          gcodeOut: state.lastGeneratedPath,
          printerUrl: moonrakerUrl,
          machineId
        },
        { startAfterUpload: true }
      )
      const r = await window.fab.moonrakerPush(payload)
      if (r.ok) {
        props.onStatus?.(`Sent ${label} to K2 Plus: ${r.filename ?? state.lastGeneratedPath}`)
      } else {
        props.onStatus?.(formatMoonrakerPushFailure(r))
      }
    } finally {
      setState({ ...state, sending: false })
    }
  }

  const canSend = moonrakerUrl.length > 0
  const sendDisabledHint = !canSend ? 'Add a Moonraker URL in File → Settings to enable Send.' : null

  return (
    <section
      className="panel workspace-util-panel calibration-panel"
      aria-labelledby="mfg-calibrate-heading"
      data-testid="calibration-panel"
    >
      <h2 id="mfg-calibrate-heading">K2 Plus Calibration</h2>
      <p className="msg util-panel-intro">
        OrcaSlicer-parity calibration suite for the Creality K2 Plus. Each card emits a
        Klipper-flavor program that stays strictly under the K2 hardware envelope (350 °C
        nozzle / 120 °C bed / 600 mm/s XY). Generated files land under
        {' '}<code>output/calibration/</code> in the open project.
      </p>
      {sendDisabledHint ? (
        <p className="msg msg--warn">
          {sendDisabledHint}{' '}
          {props.onGoSettings ? (
            <button type="button" className="text-link" onClick={props.onGoSettings}>
              Open Settings
            </button>
          ) : null}
        </p>
      ) : null}

      {/* ── 1. Temperature tower ─────────────────────────────────────────── */}
      <section
        className="calibration-card"
        data-testid="calibration-card-temperature-tower"
        aria-labelledby="cal-tower-heading"
      >
        <h3 id="cal-tower-heading">Temperature tower</h3>
        <p className="msg">
          Five+ stacked segments at different nozzle temperatures. Inspect under a microscope:
          pick the segment with best layer adhesion and minimal stringing.
        </p>
        <div className="row util-panel-control-row">
          <label className="util-panel-control">
            <span>Start temp (°C)</span>
            <input
              type="number"
              data-testid="cal-tower-start"
              value={towerStart}
              min={150}
              max={350}
              onChange={(e) => setTowerStart(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>End temp (°C)</span>
            <input
              type="number"
              data-testid="cal-tower-end"
              value={towerEnd}
              min={150}
              max={350}
              onChange={(e) => setTowerEnd(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>Step (°C)</span>
            <input
              type="number"
              data-testid="cal-tower-step"
              value={towerStep}
              min={1}
              max={50}
              onChange={(e) => setTowerStep(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>Bed (°C)</span>
            <input
              type="number"
              data-testid="cal-tower-bed"
              value={towerBed}
              min={0}
              max={120}
              onChange={(e) => setTowerBed(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            className="primary"
            data-testid="cal-tower-generate"
            disabled={towerState.generating}
            onClick={() => void generateTower()}
          >
            {towerState.generating ? 'Generating…' : 'Generate G-code'}
          </button>
          <button
            type="button"
            data-testid="cal-tower-send"
            disabled={!towerState.lastGeneratedPath || !canSend || towerState.sending}
            onClick={() => void sendCard(towerState, setTowerState, 'temperature tower')}
          >
            {towerState.sending ? 'Uploading…' : 'Send to K2 Plus'}
          </button>
        </div>
        {towerState.lastDescription ? (
          <p className="msg msg--muted msg--xs" data-testid="cal-tower-desc">
            <strong>Last generated:</strong> {towerState.lastDescription}
          </p>
        ) : null}
        {towerState.lastError ? (
          <p className="msg msg--err" data-testid="cal-tower-error">{towerState.lastError}</p>
        ) : null}
      </section>

      {/* ── 2. Flow rate ─────────────────────────────────────────────────── */}
      <section
        className="calibration-card"
        data-testid="calibration-card-flow-rate"
        aria-labelledby="cal-flow-heading"
      >
        <h3 id="cal-flow-heading">Flow rate</h3>
        <p className="msg">
          Single-walled cube at 100% flow. Measure wall thickness with calipers; new flow =
          current × (nozzle Ø / measured wall).
        </p>
        <div className="row util-panel-control-row">
          <label className="util-panel-control">
            <span>Cube edge (mm)</span>
            <input
              type="number"
              data-testid="cal-flow-cube"
              value={flowCubeSize}
              min={10}
              max={100}
              onChange={(e) => setFlowCubeSize(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>Cube height (mm)</span>
            <input
              type="number"
              data-testid="cal-flow-height"
              value={flowCubeHeight}
              min={2}
              max={50}
              onChange={(e) => setFlowCubeHeight(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>Walls</span>
            <input
              type="number"
              data-testid="cal-flow-walls"
              value={flowWalls}
              min={1}
              max={4}
              onChange={(e) => setFlowWalls(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>Nozzle (°C)</span>
            <input
              type="number"
              data-testid="cal-flow-nozzle"
              value={flowNozzle}
              min={150}
              max={350}
              onChange={(e) => setFlowNozzle(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            className="primary"
            data-testid="cal-flow-generate"
            disabled={flowState.generating}
            onClick={() => void generateFlow()}
          >
            {flowState.generating ? 'Generating…' : 'Generate G-code'}
          </button>
          <button
            type="button"
            data-testid="cal-flow-send"
            disabled={!flowState.lastGeneratedPath || !canSend || flowState.sending}
            onClick={() => void sendCard(flowState, setFlowState, 'flow rate')}
          >
            {flowState.sending ? 'Uploading…' : 'Send to K2 Plus'}
          </button>
        </div>
        {flowState.lastDescription ? (
          <p className="msg msg--muted msg--xs" data-testid="cal-flow-desc">
            <strong>Last generated:</strong> {flowState.lastDescription}
          </p>
        ) : null}
        {flowState.lastError ? (
          <p className="msg msg--err" data-testid="cal-flow-error">{flowState.lastError}</p>
        ) : null}
      </section>

      {/* ── 3. Pressure advance ──────────────────────────────────────────── */}
      <section
        className="calibration-card"
        data-testid="calibration-card-pressure-advance"
        aria-labelledby="cal-pa-heading"
      >
        <h3 id="cal-pa-heading">Pressure advance (Klipper)</h3>
        <p className="msg">
          Direct-drive K2 typically lands ~0.020 – 0.040. Inspect lines under raking light;
          pick the value with the cleanest start / end corners.
        </p>
        <div className="row util-panel-control-row">
          <label className="util-panel-control">
            <span>Start PA (s)</span>
            <input
              type="number"
              step={0.005}
              data-testid="cal-pa-start"
              value={paStart}
              min={0}
              max={1}
              onChange={(e) => setPaStart(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>End PA (s)</span>
            <input
              type="number"
              step={0.005}
              data-testid="cal-pa-end"
              value={paEnd}
              min={0}
              max={1}
              onChange={(e) => setPaEnd(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>Step (s)</span>
            <input
              type="number"
              step={0.005}
              data-testid="cal-pa-step"
              value={paStep}
              min={0.001}
              max={0.1}
              onChange={(e) => setPaStep(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>Line length (mm)</span>
            <input
              type="number"
              data-testid="cal-pa-line-len"
              value={paLineLen}
              min={10}
              max={200}
              onChange={(e) => setPaLineLen(e.target.value)}
            />
          </label>
          <label className="util-panel-control">
            <span>Nozzle (°C)</span>
            <input
              type="number"
              data-testid="cal-pa-nozzle"
              value={paNozzle}
              min={150}
              max={350}
              onChange={(e) => setPaNozzle(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button
            type="button"
            className="primary"
            data-testid="cal-pa-generate"
            disabled={paState.generating}
            onClick={() => void generatePa()}
          >
            {paState.generating ? 'Generating…' : 'Generate G-code'}
          </button>
          <button
            type="button"
            data-testid="cal-pa-send"
            disabled={!paState.lastGeneratedPath || !canSend || paState.sending}
            onClick={() => void sendCard(paState, setPaState, 'pressure advance')}
          >
            {paState.sending ? 'Uploading…' : 'Send to K2 Plus'}
          </button>
        </div>
        {paState.lastDescription ? (
          <p className="msg msg--muted msg--xs" data-testid="cal-pa-desc">
            <strong>Last generated:</strong> {paState.lastDescription}
          </p>
        ) : null}
        {paState.lastError ? (
          <p className="msg msg--err" data-testid="cal-pa-error">{paState.lastError}</p>
        ) : null}
      </section>
    </section>
  )
}
