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

/** Discriminator for the calibration cards rendered by this panel. */
export type CalibrationCardKind =
  | 'temperature-tower'
  | 'flow-rate'
  | 'pressure-advance'
  | 'retraction-tower'
  | 'max-volumetric-flow'
  | 'tolerance'
  | 'cornering'
  | 'vfa'

const CALIBRATION_FILENAMES: Record<CalibrationCardKind, string> = {
  'temperature-tower': 'k2-temp-tower.gcode',
  'flow-rate': 'k2-flow-rate.gcode',
  'pressure-advance': 'k2-pressure-advance.gcode',
  'retraction-tower': 'k2-retraction-tower.gcode',
  'max-volumetric-flow': 'k2-max-vol-flow.gcode',
  tolerance: 'k2-tolerance.gcode',
  cornering: 'k2-cornering.gcode',
  vfa: 'k2-vfa.gcode'
}

/** Pure helper: compose the output gcode path for a calibration test. */
export function calibrationOutputPath(projectDir: string, kind: CalibrationCardKind): string {
  const sep = projectDir.includes('\\') ? '\\' : '/'
  return `${projectDir}${sep}output${sep}calibration${sep}${CALIBRATION_FILENAMES[kind]}`
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

  // Retraction tower
  const [retStart, setRetStart] = useState<string>('0.0')
  const [retEnd, setRetEnd] = useState<string>('2.0')
  const [retStep, setRetStep] = useState<string>('0.2')
  const [retSpeed, setRetSpeed] = useState<string>('40')
  const [retNozzle, setRetNozzle] = useState<string>('215')

  // Max volumetric flow
  const [flowStart, setFlowStart] = useState<string>('5')
  const [flowEnd, setFlowEnd] = useState<string>('30')
  const [flowStep, setFlowStep] = useState<string>('2')
  const [flowNozzleTemp, setFlowNozzleTemp] = useState<string>('215')
  const [flowDensity, setFlowDensity] = useState<string>('1.24')

  // Tolerance
  const [tolCubeSize, setTolCubeSize] = useState<string>('20')
  const [tolPegCount, setTolPegCount] = useState<string>('4')
  const [tolHoleBase, setTolHoleBase] = useState<string>('4')
  const [tolClearance, setTolClearance] = useState<string>('0.1')
  const [tolNozzle, setTolNozzle] = useState<string>('215')

  // Cornering / SCV
  const [scvStart, setScvStart] = useState<string>('4')
  const [scvEnd, setScvEnd] = useState<string>('9')
  const [scvStep, setScvStep] = useState<string>('1')
  const [scvSquare, setScvSquare] = useState<string>('40')
  const [scvSpeed, setScvSpeed] = useState<string>('150')
  const [scvNozzle, setScvNozzle] = useState<string>('215')

  // VFA
  const [vfaDia, setVfaDia] = useState<string>('30')
  const [vfaHeight, setVfaHeight] = useState<string>('50')
  const [vfaSpeed, setVfaSpeed] = useState<string>('60')
  const [vfaNozzle, setVfaNozzle] = useState<string>('215')

  const [towerState, setTowerState] = useState<CardState>(EMPTY_CARD_STATE)
  const [flowState, setFlowState] = useState<CardState>(EMPTY_CARD_STATE)
  const [paState, setPaState] = useState<CardState>(EMPTY_CARD_STATE)
  const [retState, setRetState] = useState<CardState>(EMPTY_CARD_STATE)
  const [maxFlowState, setMaxFlowState] = useState<CardState>(EMPTY_CARD_STATE)
  const [tolState, setTolState] = useState<CardState>(EMPTY_CARD_STATE)
  const [scvState, setScvState] = useState<CardState>(EMPTY_CARD_STATE)
  const [vfaState, setVfaState] = useState<CardState>(EMPTY_CARD_STATE)

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

  async function generateRet(): Promise<void> {
    setRetState((s) => ({ ...s, generating: true, lastError: null }))
    try {
      const r = await window.fab.calibrationGenerate({
        kind: 'retraction-tower',
        params: {
          outputGcodePath: calibrationOutputPath(projectDir, 'retraction-tower'),
          startRetractMm: num(retStart),
          endRetractMm: num(retEnd),
          stepRetractMm: num(retStep),
          retractSpeedMmPerSec: num(retSpeed),
          nozzleTempC: num(retNozzle)
        }
      })
      if (r.ok) {
        setRetState({
          generating: false,
          sending: false,
          lastGeneratedPath: r.outputGcodePath,
          lastDescription: r.description,
          lastError: null
        })
        props.onStatus?.(`Generated retraction tower → ${r.outputGcodePath}`)
      } else {
        setRetState({ ...EMPTY_CARD_STATE, lastError: `${r.error}${r.hint ? `: ${r.hint}` : ''}` })
      }
    } catch (e) {
      setRetState({ ...EMPTY_CARD_STATE, lastError: e instanceof Error ? e.message : String(e) })
    }
  }

  async function generateMaxFlow(): Promise<void> {
    setMaxFlowState((s) => ({ ...s, generating: true, lastError: null }))
    try {
      const r = await window.fab.calibrationGenerate({
        kind: 'max-volumetric-flow',
        params: {
          outputGcodePath: calibrationOutputPath(projectDir, 'max-volumetric-flow'),
          startFlowMmCubePerSec: num(flowStart),
          endFlowMmCubePerSec: num(flowEnd),
          stepFlowMmCubePerSec: num(flowStep),
          nozzleTempC: num(flowNozzleTemp),
          filamentDensity: num(flowDensity)
        }
      })
      if (r.ok) {
        setMaxFlowState({
          generating: false,
          sending: false,
          lastGeneratedPath: r.outputGcodePath,
          lastDescription: r.description,
          lastError: null
        })
        props.onStatus?.(`Generated max volumetric flow → ${r.outputGcodePath}`)
      } else {
        setMaxFlowState({ ...EMPTY_CARD_STATE, lastError: `${r.error}${r.hint ? `: ${r.hint}` : ''}` })
      }
    } catch (e) {
      setMaxFlowState({ ...EMPTY_CARD_STATE, lastError: e instanceof Error ? e.message : String(e) })
    }
  }

  async function generateTol(): Promise<void> {
    setTolState((s) => ({ ...s, generating: true, lastError: null }))
    try {
      const r = await window.fab.calibrationGenerate({
        kind: 'tolerance',
        params: {
          outputGcodePath: calibrationOutputPath(projectDir, 'tolerance'),
          cubeSizeMm: num(tolCubeSize),
          pegHoleCount: num(tolPegCount),
          holeBaseDiameterMm: num(tolHoleBase),
          clearanceStepMm: num(tolClearance),
          nozzleTempC: num(tolNozzle)
        }
      })
      if (r.ok) {
        setTolState({
          generating: false,
          sending: false,
          lastGeneratedPath: r.outputGcodePath,
          lastDescription: r.description,
          lastError: null
        })
        props.onStatus?.(`Generated tolerance test → ${r.outputGcodePath}`)
      } else {
        setTolState({ ...EMPTY_CARD_STATE, lastError: `${r.error}${r.hint ? `: ${r.hint}` : ''}` })
      }
    } catch (e) {
      setTolState({ ...EMPTY_CARD_STATE, lastError: e instanceof Error ? e.message : String(e) })
    }
  }

  async function generateScv(): Promise<void> {
    setScvState((s) => ({ ...s, generating: true, lastError: null }))
    try {
      const r = await window.fab.calibrationGenerate({
        kind: 'cornering',
        params: {
          outputGcodePath: calibrationOutputPath(projectDir, 'cornering'),
          startScvMmPerSec: num(scvStart),
          endScvMmPerSec: num(scvEnd),
          stepScvMmPerSec: num(scvStep),
          squareSizeMm: num(scvSquare),
          printSpeedMmPerSec: num(scvSpeed),
          nozzleTempC: num(scvNozzle)
        }
      })
      if (r.ok) {
        setScvState({
          generating: false,
          sending: false,
          lastGeneratedPath: r.outputGcodePath,
          lastDescription: r.description,
          lastError: null
        })
        props.onStatus?.(`Generated cornering test → ${r.outputGcodePath}`)
      } else {
        setScvState({ ...EMPTY_CARD_STATE, lastError: `${r.error}${r.hint ? `: ${r.hint}` : ''}` })
      }
    } catch (e) {
      setScvState({ ...EMPTY_CARD_STATE, lastError: e instanceof Error ? e.message : String(e) })
    }
  }

  async function generateVfa(): Promise<void> {
    setVfaState((s) => ({ ...s, generating: true, lastError: null }))
    try {
      const r = await window.fab.calibrationGenerate({
        kind: 'vfa',
        params: {
          outputGcodePath: calibrationOutputPath(projectDir, 'vfa'),
          tubeDiameterMm: num(vfaDia),
          tubeHeightMm: num(vfaHeight),
          wallSpeedMmPerSec: num(vfaSpeed),
          nozzleTempC: num(vfaNozzle)
        }
      })
      if (r.ok) {
        setVfaState({
          generating: false,
          sending: false,
          lastGeneratedPath: r.outputGcodePath,
          lastDescription: r.description,
          lastError: null
        })
        props.onStatus?.(`Generated VFA test → ${r.outputGcodePath}`)
      } else {
        setVfaState({ ...EMPTY_CARD_STATE, lastError: `${r.error}${r.hint ? `: ${r.hint}` : ''}` })
      }
    } catch (e) {
      setVfaState({ ...EMPTY_CARD_STATE, lastError: e instanceof Error ? e.message : String(e) })
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

      {/* ── 4. Retraction tower ──────────────────────────────────────────── */}
      <section
        className="calibration-card"
        data-testid="calibration-card-retraction-tower"
        aria-labelledby="cal-ret-heading"
      >
        <h3 id="cal-ret-heading">Retraction tower</h3>
        <p className="msg">
          Two pillars separated by a gap. Sweeps Klipper <code>SET_RETRACTION</code> distance per
          band; pick the SHORTEST distance that leaves a clean inter-pillar field.
        </p>
        <div className="row util-panel-control-row">
          <label className="util-panel-control">
            <span>Start (mm)</span>
            <input type="number" step={0.1} data-testid="cal-ret-start" value={retStart} min={0} max={5}
              onChange={(e) => setRetStart(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>End (mm)</span>
            <input type="number" step={0.1} data-testid="cal-ret-end" value={retEnd} min={0} max={5}
              onChange={(e) => setRetEnd(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Step (mm)</span>
            <input type="number" step={0.05} data-testid="cal-ret-step" value={retStep} min={0.05} max={1}
              onChange={(e) => setRetStep(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Retract speed (mm/s)</span>
            <input type="number" data-testid="cal-ret-speed" value={retSpeed} min={1} max={100}
              onChange={(e) => setRetSpeed(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Nozzle (°C)</span>
            <input type="number" data-testid="cal-ret-nozzle" value={retNozzle} min={150} max={350}
              onChange={(e) => setRetNozzle(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button type="button" className="primary" data-testid="cal-ret-generate"
            disabled={retState.generating} onClick={() => void generateRet()}>
            {retState.generating ? 'Generating…' : 'Generate G-code'}
          </button>
          <button type="button" data-testid="cal-ret-send"
            disabled={!retState.lastGeneratedPath || !canSend || retState.sending}
            onClick={() => void sendCard(retState, setRetState, 'retraction tower')}>
            {retState.sending ? 'Uploading…' : 'Send to K2 Plus'}
          </button>
        </div>
        {retState.lastDescription ? (
          <p className="msg msg--muted msg--xs" data-testid="cal-ret-desc">
            <strong>Last generated:</strong> {retState.lastDescription}
          </p>
        ) : null}
        {retState.lastError ? (
          <p className="msg msg--err" data-testid="cal-ret-error">{retState.lastError}</p>
        ) : null}
      </section>

      {/* ── 5. Max volumetric flow ──────────────────────────────────────── */}
      <section
        className="calibration-card"
        data-testid="calibration-card-max-volumetric-flow"
        aria-labelledby="cal-mvf-heading"
      >
        <h3 id="cal-mvf-heading">Max volumetric flow</h3>
        <p className="msg">
          Single-wall tube at progressively-higher mm³/s. Pick the highest flow that still
          gives a clean wall — feeds <code>filament_max_volumetric_speed</code> per filament.
        </p>
        <div className="row util-panel-control-row">
          <label className="util-panel-control">
            <span>Start (mm³/s)</span>
            <input type="number" step={0.5} data-testid="cal-mvf-start" value={flowStart} min={1} max={60}
              onChange={(e) => setFlowStart(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>End (mm³/s)</span>
            <input type="number" step={0.5} data-testid="cal-mvf-end" value={flowEnd} min={1} max={60}
              onChange={(e) => setFlowEnd(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Step (mm³/s)</span>
            <input type="number" step={0.5} data-testid="cal-mvf-step" value={flowStep} min={0.5} max={10}
              onChange={(e) => setFlowStep(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Nozzle (°C)</span>
            <input type="number" data-testid="cal-mvf-nozzle" value={flowNozzleTemp} min={150} max={350}
              onChange={(e) => setFlowNozzleTemp(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Filament density (g/cm³)</span>
            <input type="number" step={0.01} data-testid="cal-mvf-density" value={flowDensity} min={0.1} max={5}
              onChange={(e) => setFlowDensity(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button type="button" className="primary" data-testid="cal-mvf-generate"
            disabled={maxFlowState.generating} onClick={() => void generateMaxFlow()}>
            {maxFlowState.generating ? 'Generating…' : 'Generate G-code'}
          </button>
          <button type="button" data-testid="cal-mvf-send"
            disabled={!maxFlowState.lastGeneratedPath || !canSend || maxFlowState.sending}
            onClick={() => void sendCard(maxFlowState, setMaxFlowState, 'max volumetric flow')}>
            {maxFlowState.sending ? 'Uploading…' : 'Send to K2 Plus'}
          </button>
        </div>
        {maxFlowState.lastDescription ? (
          <p className="msg msg--muted msg--xs" data-testid="cal-mvf-desc">
            <strong>Last generated:</strong> {maxFlowState.lastDescription}
          </p>
        ) : null}
        {maxFlowState.lastError ? (
          <p className="msg msg--err" data-testid="cal-mvf-error">{maxFlowState.lastError}</p>
        ) : null}
      </section>

      {/* ── 6. Tolerance / dimensional accuracy ─────────────────────────── */}
      <section
        className="calibration-card"
        data-testid="calibration-card-tolerance"
        aria-labelledby="cal-tol-heading"
      >
        <h3 id="cal-tol-heading">Tolerance / dimensional accuracy</h3>
        <p className="msg">
          Calibration cube + a row of peg/hole pairs at known clearances. Measure with calipers,
          slip-fit the pegs to dial in your printer's effective XY hole compensation.
        </p>
        <div className="row util-panel-control-row">
          <label className="util-panel-control">
            <span>Cube edge (mm)</span>
            <input type="number" data-testid="cal-tol-cube" value={tolCubeSize} min={10} max={60}
              onChange={(e) => setTolCubeSize(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Pairs</span>
            <input type="number" data-testid="cal-tol-pairs" value={tolPegCount} min={2} max={8}
              onChange={(e) => setTolPegCount(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Hole base Ø (mm)</span>
            <input type="number" step={0.1} data-testid="cal-tol-hole" value={tolHoleBase} min={2} max={10}
              onChange={(e) => setTolHoleBase(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Clearance step (mm)</span>
            <input type="number" step={0.05} data-testid="cal-tol-clearance" value={tolClearance} min={0.05} max={0.5}
              onChange={(e) => setTolClearance(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Nozzle (°C)</span>
            <input type="number" data-testid="cal-tol-nozzle" value={tolNozzle} min={150} max={350}
              onChange={(e) => setTolNozzle(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button type="button" className="primary" data-testid="cal-tol-generate"
            disabled={tolState.generating} onClick={() => void generateTol()}>
            {tolState.generating ? 'Generating…' : 'Generate G-code'}
          </button>
          <button type="button" data-testid="cal-tol-send"
            disabled={!tolState.lastGeneratedPath || !canSend || tolState.sending}
            onClick={() => void sendCard(tolState, setTolState, 'tolerance test')}>
            {tolState.sending ? 'Uploading…' : 'Send to K2 Plus'}
          </button>
        </div>
        {tolState.lastDescription ? (
          <p className="msg msg--muted msg--xs" data-testid="cal-tol-desc">
            <strong>Last generated:</strong> {tolState.lastDescription}
          </p>
        ) : null}
        {tolState.lastError ? (
          <p className="msg msg--err" data-testid="cal-tol-error">{tolState.lastError}</p>
        ) : null}
      </section>

      {/* ── 7. Cornering / SCV (square_corner_velocity) ─────────────────── */}
      <section
        className="calibration-card"
        data-testid="calibration-card-cornering"
        aria-labelledby="cal-scv-heading"
      >
        <h3 id="cal-scv-heading">Cornering / square_corner_velocity</h3>
        <p className="msg">
          Sweeps Klipper <code>SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY</code>. Pick the highest
          SCV with no visible ghosting. Capped at 9 mm/s (K2 ceiling); reset to 5 mm/s on end.
        </p>
        <div className="row util-panel-control-row">
          <label className="util-panel-control">
            <span>Start SCV (mm/s)</span>
            <input type="number" data-testid="cal-scv-start" value={scvStart} min={1} max={9}
              onChange={(e) => setScvStart(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>End SCV (mm/s)</span>
            <input type="number" data-testid="cal-scv-end" value={scvEnd} min={1} max={9}
              onChange={(e) => setScvEnd(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Step (mm/s)</span>
            <input type="number" data-testid="cal-scv-step" value={scvStep} min={1} max={5}
              onChange={(e) => setScvStep(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Square edge (mm)</span>
            <input type="number" data-testid="cal-scv-square" value={scvSquare} min={20} max={100}
              onChange={(e) => setScvSquare(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Print speed (mm/s)</span>
            <input type="number" data-testid="cal-scv-speed" value={scvSpeed} min={20} max={600}
              onChange={(e) => setScvSpeed(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Nozzle (°C)</span>
            <input type="number" data-testid="cal-scv-nozzle" value={scvNozzle} min={150} max={350}
              onChange={(e) => setScvNozzle(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button type="button" className="primary" data-testid="cal-scv-generate"
            disabled={scvState.generating} onClick={() => void generateScv()}>
            {scvState.generating ? 'Generating…' : 'Generate G-code'}
          </button>
          <button type="button" data-testid="cal-scv-send"
            disabled={!scvState.lastGeneratedPath || !canSend || scvState.sending}
            onClick={() => void sendCard(scvState, setScvState, 'cornering test')}>
            {scvState.sending ? 'Uploading…' : 'Send to K2 Plus'}
          </button>
        </div>
        {scvState.lastDescription ? (
          <p className="msg msg--muted msg--xs" data-testid="cal-scv-desc">
            <strong>Last generated:</strong> {scvState.lastDescription}
          </p>
        ) : null}
        {scvState.lastError ? (
          <p className="msg msg--err" data-testid="cal-scv-error">{scvState.lastError}</p>
        ) : null}
      </section>

      {/* ── 8. VFA (vertical fine artifacts) ─────────────────────────── */}
      <section
        className="calibration-card"
        data-testid="calibration-card-vfa"
        aria-labelledby="cal-vfa-heading"
      >
        <h3 id="cal-vfa-heading">VFA (vertical fine artifacts)</h3>
        <p className="msg">
          Tall single-walled tube at constant speed. Inspect the wall for Z-banding, belt
          resonance ripples, or microstep artifacts — purely structural diagnostics.
        </p>
        <div className="row util-panel-control-row">
          <label className="util-panel-control">
            <span>Tube Ø (mm)</span>
            <input type="number" data-testid="cal-vfa-dia" value={vfaDia} min={15} max={80}
              onChange={(e) => setVfaDia(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Tube height (mm)</span>
            <input type="number" data-testid="cal-vfa-height" value={vfaHeight} min={20} max={100}
              onChange={(e) => setVfaHeight(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Wall speed (mm/s)</span>
            <input type="number" data-testid="cal-vfa-speed" value={vfaSpeed} min={10} max={600}
              onChange={(e) => setVfaSpeed(e.target.value)} />
          </label>
          <label className="util-panel-control">
            <span>Nozzle (°C)</span>
            <input type="number" data-testid="cal-vfa-nozzle" value={vfaNozzle} min={150} max={350}
              onChange={(e) => setVfaNozzle(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <button type="button" className="primary" data-testid="cal-vfa-generate"
            disabled={vfaState.generating} onClick={() => void generateVfa()}>
            {vfaState.generating ? 'Generating…' : 'Generate G-code'}
          </button>
          <button type="button" data-testid="cal-vfa-send"
            disabled={!vfaState.lastGeneratedPath || !canSend || vfaState.sending}
            onClick={() => void sendCard(vfaState, setVfaState, 'VFA test')}>
            {vfaState.sending ? 'Uploading…' : 'Send to K2 Plus'}
          </button>
        </div>
        {vfaState.lastDescription ? (
          <p className="msg msg--muted msg--xs" data-testid="cal-vfa-desc">
            <strong>Last generated:</strong> {vfaState.lastDescription}
          </p>
        ) : null}
        {vfaState.lastError ? (
          <p className="msg msg--err" data-testid="cal-vfa-error">{vfaState.lastError}</p>
        ) : null}
      </section>
    </section>
  )
}
