import { useEffect, useState, type ReactNode } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import {
  K2_PLUS_QUALITY_PRESET_IDS,
  K2_PLUS_SLICE_PRESETS,
  type K2PlusQualityPresetId
} from '../../shared/k2-plus-slice-presets'
import {
  buildMoonrakerPushPayload,
  formatMoonrakerPushFailure
} from '../src/moonraker-push-payload'
import type { AppSettings, ProjectFile } from '../../shared/project-schema'
import type { ToolLibraryFile } from '../../shared/tool-schema'
import { buildCamSimulationPreview } from '../../shared/cam-simulation-preview'
import { CamLastRunHint } from '../utilities/CamLastRunHint'
import { evaluateManufactureReadiness } from '../../shared/manufacture-readiness'
import type { ManufactureFile } from '../../shared/manufacture-schema'
import { CarveraSetupPanel } from './CarveraSetupPanel'
import { FilamentPicker } from './FilamentPicker'
import type { FilamentRecord } from '../../shared/filament-schema'
import { EmptyState } from '../src/EmptyState'
import { ProfileStack, type ProfileStackDisplayMode } from './ProfileStack'

const CAM_PREVIEW = 8000
const countVisibleLines = (text: string): number => text.split(/\r?\n/).length

/**
 * Phase 2 [P2-LAGUNA-FULLSHEET]/Cycle 350 pure helper consumed by the
 * Laguna 6-zone vacuum picker in `CamManufacturePanel`. Computes the
 * next sorted set of active zones after the operator clicks the chip
 * for `zone`. Pulled out as a module-level export so the renderer
 * interaction test can verify toggle semantics without spinning up a
 * jsdom or React render lifecycle (the panel uses hooks, which forbid
 * direct invocation from tests). Pure: no side-effects, no React deps.
 */
export function computeNextLagunaActiveZones(
  currentZones: readonly number[],
  zone: number
): number[] {
  const set = new Set(currentZones)
  if (set.has(zone)) {
    set.delete(zone)
  } else {
    set.add(zone)
  }
  return [...set].sort((a, b) => a - b)
}

export type ManufactureAuxPanelsProps = {
  machines: MachineProfile[]
  settings: AppSettings | null
  project: ProjectFile | null
  projectDir: string | null
  tools: ToolLibraryFile | null
  projectTools: ToolLibraryFile | null
  machineTools: ToolLibraryFile | null
  activeMachine: MachineProfile | undefined
  sliceOut: string
  camOut: string
  camLastHint: string
  importText: string
  onImportTextChange: (value: string) => void
  onSaveSettingsField: (partial: Partial<AppSettings>) => void
  onRunSlice: () => void
  onRunCam: () => void
  onImportTools: (kind: 'csv' | 'json' | 'fusion' | 'fusion_csv', target?: 'project' | 'machine') => void
  onImportToolLibraryFromFile: (target?: 'project' | 'machine') => void | Promise<void>
  onMigrateProjectToolsToMachine?: () => void | Promise<void>
  manufacture: ManufactureFile | null
  onGoSettings: () => void
  onGoProject: () => void
  /** Status line / toast text from Manufacture (e.g. Carvera upload result). */
  onStatus?: (msg: string) => void
  /** Optional: export HTML setup sheet from current manufacture plan + output/cam.nc. */
  onExportSetupSheet?: () => void | Promise<void>
  /** Project-relative mesh paths newer than `output/cam.nc` (mtime) — from main process. */
  camStaleMeshRelativePaths?: string[]
  /**
   * Phase 2 [P2-K2-PUSH]/Cycle 349: absolute path to the most recent
   * successfully-sliced FDM G-code on disk. Set by
   * `ManufactureWorkspace.runFdmSliceFromOp` and consumed by the
   * "Send to K2 Plus" button in `SliceManufacturePanel`. `null` (or
   * absent) means there is no candidate file to push, so the button
   * is disabled. The K2 Plus "Send" surface NEVER fabricates a path
   * from `sliceOut` text — only the on-disk write path is pushed
   * because Moonraker requires a real file payload upstream of the
   * upload boundary.
   */
  lastSliceGcodePath?: string | null
}

/**
 * FDM slicing + printer push surface for the K2 Plus.
 *
 * 2026-05-27 OrcaSlicer pivot (task #9): the legacy CuraEngine flow was
 * deleted; this panel is rebuilt on top of the new `slice:orca` IPC and
 * keeps the [P2-K2-PUSH]/Cycle 349 Send-to-K2 button + the [P2-K2-SLICE]/
 * Cycle 6 K2 Plus quality preset picker on disk.
 *
 * Surfaces (gated on the active machine):
 *   - Filament picker (FDM machines): chooses the active filament for the
 *     next slice. The picker is purely visual today — the slice IPC reads
 *     `settings.activeFilamentId` directly. Selecting here updates local
 *     state for immediate visual feedback.
 *   - K2 Plus quality preset picker (K2 Plus only): `standard` or
 *     `high_speed`, persisted via `onSaveSettingsField`. Drives the
 *     `qualityPresetId` field of the `slice:orca` payload.
 *   - Send to K2 Plus button (K2 Plus only): uploads the most recent
 *     successfully-sliced G-code (`lastSliceGcodePath`) to the printer
 *     via the existing `moonraker:push` handler. NEVER fabricates a path
 *     from `sliceOut` text — only the on-disk write path is pushed
 *     because Moonraker requires a real file payload upstream of the
 *     upload boundary.
 */
export function SliceManufacturePanel(p: ManufactureAuxPanelsProps): ReactNode {
  const isFdm = p.activeMachine?.kind === 'fdm'
  const isK2Plus = p.activeMachine?.id === 'creality-k2-plus'
  const k2QualityPresetId = p.settings?.k2QualityPresetId ?? 'standard'
  const moonrakerUrl = p.settings?.moonrakerUrl?.trim() ?? ''
  const sendCandidatePath = p.lastSliceGcodePath?.trim() ?? ''
  const canSendToK2 = isK2Plus && sendCandidatePath.length > 0 && moonrakerUrl.length > 0
  // K2 Plus CFS (Creality Filament System) slot id (0..3). Defaults to
  // slot 0 -- matches the K2 wiki guide's "load first spool in slot 0"
  // default and OrcaSlicer's zero-indexed extruder/filament convention.
  // Persisted per-project via `onSaveSettingsField` so the operator's
  // pick survives a reload. Safety Rule 1: this value rides on the
  // upload URL only -- never mutates the G-code bytes.
  const cfsSlotId: number =
    typeof p.settings?.cfsSlotId === 'number' &&
    Number.isInteger(p.settings.cfsSlotId) &&
    p.settings.cfsSlotId >= 0 &&
    p.settings.cfsSlotId <= 3
      ? p.settings.cfsSlotId
      : 0

  const [k2SendBusy, setK2SendBusy] = useState(false)
  const [filaments, setFilaments] = useState<FilamentRecord[]>([])
  const [activeFilamentId, setActiveFilamentId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (!isFdm) return
    void window.fab
      .filamentsList()
      .then(setFilaments)
      .catch(() => setFilaments([]))
  }, [isFdm])

  async function sendToK2Plus(): Promise<void> {
    if (!canSendToK2 || k2SendBusy) return
    setK2SendBusy(true)
    try {
      const payload = buildMoonrakerPushPayload(
        {
          gcodeOut: sendCandidatePath,
          printerUrl: moonrakerUrl,
          machineId: p.activeMachine?.id ?? null,
          cfsSlotId
        },
        { startAfterUpload: true }
      )
      const r = await window.fab.moonrakerPush(payload)
      if (r.ok) {
        p.onStatus?.(`Started on K2 Plus: ${r.filename ?? sendCandidatePath}`)
      } else {
        p.onStatus?.(formatMoonrakerPushFailure(r))
      }
    } finally {
      setK2SendBusy(false)
    }
  }

  return (
    <section className="panel workspace-util-panel" aria-labelledby="mfg-slice-heading">
      <h2 id="mfg-slice-heading">FDM slice (K2 Plus profile)</h2>
      {isFdm ? (
        <FilamentPicker
          filaments={filaments}
          activeFilamentId={activeFilamentId}
          onSelect={setActiveFilamentId}
          machineMaxNozzleTempC={p.activeMachine?.maxNozzleTempC}
          machineMaxBedTempC={p.activeMachine?.maxBedTempC}
        />
      ) : null}
      {isK2Plus ? (
        <label htmlFor="mfg-k2-quality-preset" className="util-panel-control">
          <span>K2 Plus quality preset</span>
          <select
            id="mfg-k2-quality-preset"
            data-testid="k2-quality-preset-picker"
            value={k2QualityPresetId}
            onChange={(e) =>
              p.onSaveSettingsField({
                k2QualityPresetId: e.target.value as K2PlusQualityPresetId
              })
            }
          >
            {K2_PLUS_QUALITY_PRESET_IDS.map((id) => (
              <option key={id} value={id} title={K2_PLUS_SLICE_PRESETS[id].description}>
                {K2_PLUS_SLICE_PRESETS[id].label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {isK2Plus ? (
        <section
          className="k2-send-section"
          data-testid="k2-send-to-printer-section"
          aria-labelledby="k2-send-heading"
        >
          <h3 id="k2-send-heading">Send to K2 Plus</h3>
          {/*
           * UX Overhaul #8 — shared `EmptyState` slot. Surfaces when the
           * K2 Plus is reachable (Moonraker URL configured) but no slice
           * has produced an on-disk G-code yet. The existing slice
           * button in the panel header IS the CTA; the empty state
           * intentionally omits a button to avoid duplicating the
           * action surface. The legacy inline hint(s) below stay
           * intact so existing render-pin tests keep passing.
           */}
          {moonrakerUrl.length > 0 && sendCandidatePath.length === 0 ? (
            <EmptyState
              testId="slice-empty-state"
              title="Ready to slice"
              body="Select an STL and click Slice to begin."
            />
          ) : null}
          {sendCandidatePath.length === 0 ? (
            <p className="msg">Slice an FDM operation to enable Send.</p>
          ) : null}
          {moonrakerUrl.length === 0 ? (
            <p className="msg">Add a Moonraker URL in File → Settings to enable Send.</p>
          ) : null}
          {/*
           * K2 Plus CFS (Creality Filament System) slot picker. The K2
           * Plus Combo ships with one CFS unit holding four spools
           * (slots 0..3 zero-indexed, matching the Creality wiki guide
           * and OrcaSlicer's extruder convention). Selecting a slot
           * persists per-project via `onSaveSettingsField` and rides
           * on the next Send-to-K2 upload as a `?cfs_slot=N` query
           * param on the Moonraker /server/files/upload URL. The K2
           * firmware's CFS automatic-mapping macro can read it (or
           * stock Moonraker harmlessly ignores it on pre-CFS firmware).
           *
           * Safety Rule 1: the slot id never mutates G-code bytes --
           * it only travels on the upload URL. My-Shop-Only: K2 Plus
           * only; Laguna / Carvera CNC profiles have no CFS concept
           * and this picker is gated inside the `isK2Plus` branch.
           */}
          <fieldset
            className="k2-cfs-slot-picker"
            data-testid="k2-cfs-slot-picker"
            aria-labelledby="k2-cfs-slot-legend"
          >
            <legend id="k2-cfs-slot-legend">CFS slot</legend>
            <div className="row" role="group" aria-labelledby="k2-cfs-slot-legend">
              {[0, 1, 2, 3].map((slot) => {
                const active = cfsSlotId === slot
                return (
                  <button
                    key={slot}
                    type="button"
                    className={active ? 'primary' : 'secondary'}
                    data-testid={`k2-cfs-slot-${slot}`}
                    data-active={active ? 'true' : 'false'}
                    aria-pressed={active}
                    onClick={() => p.onSaveSettingsField({ cfsSlotId: slot })}
                  >
                    Slot {slot}
                  </button>
                )
              })}
            </div>
            <p className="msg msg--muted" role="status">
              {`Using CFS slot ${cfsSlotId} for the next Send (override via the buttons above).`}
            </p>
          </fieldset>
          <button
            type="button"
            data-testid="k2-send-to-printer-button"
            disabled={!canSendToK2 || k2SendBusy}
            onClick={() => void sendToK2Plus()}
          >
            {k2SendBusy ? 'Uploading…' : 'Send to K2 Plus'}
          </button>
        </section>
      ) : null}
      {p.sliceOut.trim().length > 0 ? (
        <div className="msg util-panel-intro">
          <small>
            Last slice ({countVisibleLines(p.sliceOut)} log lines):{' '}
            <code>{p.sliceOut.split(/\r?\n/).slice(-1)[0] ?? ''}</code>
          </small>
        </div>
      ) : null}
    </section>
  )
}


export function CamManufacturePanel(p: ManufactureAuxPanelsProps): ReactNode {
  const readiness = evaluateManufactureReadiness({
    project: p.project,
    settings: p.settings,
    machines: p.machines,
    manufacture: p.manufacture
  })
  const [camPreviewTick, setCamPreviewTick] = useState(0)
  const [camPreview, setCamPreview] = useState(() => buildCamSimulationPreview(''))
  const [carveraConn, setCarveraConn] = useState<'auto' | 'wifi' | 'usb'>('auto')
  const [carveraDevice, setCarveraDevice] = useState('')
  const [carveraBusy, setCarveraBusy] = useState(false)

  // Detect if the active machine is a Carvera (show zeroing/setup panel)
  const activeCnc = p.activeMachine?.kind === 'cnc' ? p.activeMachine : undefined
  const isCarvera = activeCnc != null && /carvera/i.test(activeCnc.id + ' ' + activeCnc.name)
  const is4Axis = (activeCnc?.axisCount ?? 3) >= 4
  // Phase 2 [P2-LAGUNA-FULLSHEET]/Cycle 350: detect the Laguna Swift 5x10
  // so the 6-zone vacuum table picker only appears for that machine.
  // Laguna uses a 2x3 grid of T-slot vacuum zones (1..6) for full-sheet
  // jobs; the operator picks which zones to engage based on stock
  // placement. Selection persists in `appSettings.lagunaActiveZones`.
  const isLaguna = activeCnc != null && /laguna/i.test(activeCnc.id + ' ' + activeCnc.name)
  const lagunaActiveZones = p.settings?.lagunaActiveZones ?? [1, 2, 3, 4, 5, 6]
  function toggleLagunaZone(zone: number): void {
    p.onSaveSettingsField({
      lagunaActiveZones: computeNextLagunaActiveZones(lagunaActiveZones, zone)
    })
  }

  function runCamPreview(): void {
    setCamPreview(buildCamSimulationPreview(p.camOut))
    setCamPreviewTick((v) => v + 1)
  }

  async function uploadToCarvera(): Promise<void> {
    if (!p.projectDir || !p.camOut?.trim()) return
    const sep = p.projectDir.includes('\\') ? '\\' : '/'
    const gcodePath = `${p.projectDir}${sep}output${sep}cam.nc`
    setCarveraBusy(true)
    try {
      const r = await window.fab.carveraUpload({
        gcodePath,
        connection: carveraConn,
        device: carveraDevice.trim() || undefined,
        timeoutMs: 120_000
      })
      if (r.ok) {
        p.onStatus?.('Carvera: file uploaded (start the job on the machine if needed).')
      } else {
        p.onStatus?.(`Carvera upload failed: ${r.error}${r.detail ? ` — ${r.detail}` : ''}`)
      }
    } catch (e) {
      p.onStatus?.(e instanceof Error ? e.message : String(e))
    } finally {
      setCarveraBusy(false)
    }
  }

  return (
    <section className="panel workspace-util-panel" aria-labelledby="mfg-cam-heading">
      <h2 id="mfg-cam-heading">CNC CAM (Laguna / Makera)</h2>
      <p className="msg util-panel-intro">
        <strong>Two entry points:</strong> this <strong>Manufacture → CAM</strong> tab runs the project plan in <code>manufacture.json</code>; the
        environment <strong>Shop</strong> screen is for fast single-job sessions. Both call the same <code>cam:run</code> pipeline.
      </p>
      <p className="msg util-panel-intro">
        <strong>Engines (in order when applicable):</strong> OpenCAMLib waterline/raster when Python + <code>opencamlib</code> succeed; some ops use the
        Python <code>toolpath_engine</code> strategies; otherwise built-in TypeScript paths (parallel finish / mesh raster). Set <strong>Python</strong> under
        File → Settings. After each run, <strong>Last run</strong> below the G-code states <code>usedEngine</code> and any fallback reason.
      </p>
      <p className="msg">
        G-code is <strong>not verified</strong> for any CNC until you confirm post, units, work offset, and clearances —{' '}
        see <code>docs/MACHINES.md</code>.
      </p>
      <p className="msg msg--muted">
        On the <strong>Plan</strong> tab, picking a <strong>library tool</strong> fills diameter and suggests a rough feed (mm/min)
        when the tool has surface speed and chipload set — always verify before running on hardware.
      </p>
      <h3 className="subh util-section-heading" id="mfg-cam-run-heading">
        Generate toolpath
      </h3>
      {p.camStaleMeshRelativePaths && p.camStaleMeshRelativePaths.length > 0 && p.camOut?.trim() ? (
        <p className="msg msg--warn manufacture-cam-stale-banner" role="status">
          <strong>Source mesh newer than posted G-code:</strong> {p.camStaleMeshRelativePaths.join(', ')} — run{' '}
          <strong>Generate toolpath…</strong> again so <code>output/cam.nc</code> matches the assets on disk.
        </p>
      ) : null}
      <div
        className="row util-cam-actions"
        role="group"
        aria-label="CAM generation and preview"
        aria-describedby="mfg-cam-run-heading"
      >
        <button type="button" className="primary" onClick={() => void p.onRunCam()}>
          Generate toolpath…
        </button>
        <button
          type="button"
          className="secondary"
          onClick={runCamPreview}
          disabled={!p.camOut?.trim()}
          aria-label="Analyze generated G-code for motion and bounds cues (non-physical)"
          title={!p.camOut?.trim() ? 'Generate a toolpath first' : undefined}
        >
          Preview G-code analysis
        </button>
        {p.onExportSetupSheet ? (
          <button type="button" className="secondary" onClick={() => void p.onExportSetupSheet?.()}>
            Export setup sheet (HTML)…
          </button>
        ) : null}
      </div>
      {/*
       * Phase 2 [P2-LAGUNA-FULLSHEET]/Cycle 350: Laguna Swift 6-zone
       * vacuum table picker. Visible only when the active machine is a
       * Laguna Swift 5x10. Six toggle chips (Zone 1..6) select which
       * T-slot vacuum zones are engaged for the current job; selection
       * persists in `appSettings.lagunaActiveZones` via
       * `onSaveSettingsField`. Pairs the C346 backend integration test
       * (post-process-laguna-fullsheet-integration.test.ts) per the
       * UI/UX equality directive — backend capability + clickable
       * surface in the same workspace tab. 3-clicks-from-launch:
       * My Shop -> Laguna preset -> Manufacture/CAM (picker visible).
       */}
      {isLaguna ? (
        <section
          className="panel workspace-util-panel"
          aria-labelledby="mfg-laguna-vacuum-heading"
          data-testid="laguna-vacuum-zone-picker"
        >
          <h3
            id="mfg-laguna-vacuum-heading"
            className="subh util-section-heading"
          >
            Laguna 6-Zone Vacuum Table
          </h3>
          <p className="msg msg--muted util-panel-intro">
            Toggle which T-slot vacuum zones to engage for this job
            (2x3 grid; Zone 1 is front-left). Engaged zones emit{' '}
            <code>M8 P&lt;n&gt;</code> at job start and{' '}
            <code>M9 P&lt;n&gt;</code> at job end. Defaults to all six
            engaged (full-sheet workflow).
          </p>
          <div
            className="row util-laguna-vacuum-row"
            role="group"
            aria-labelledby="mfg-laguna-vacuum-heading"
          >
            {[1, 2, 3, 4, 5, 6].map((zone) => {
              const active = lagunaActiveZones.includes(zone)
              return (
                <button
                  key={zone}
                  type="button"
                  className={active ? 'primary' : 'secondary'}
                  data-testid={`laguna-vacuum-zone-${zone}`}
                  data-active={active ? 'true' : 'false'}
                  aria-pressed={active}
                  onClick={() => toggleLagunaZone(zone)}
                >
                  Zone {zone}
                </button>
              )
            })}
          </div>
          <p className="msg msg--muted" role="status">
            {lagunaActiveZones.length === 0
              ? 'No zones engaged — at least one zone is recommended for hold-down.'
              : `${lagunaActiveZones.length} of 6 zones engaged: ${lagunaActiveZones.join(', ')}.`}
          </p>
        </section>
      ) : null}
      {/*
       * Phase 2 Cycle 351 -- Laguna Swift 5x10 spec card. Read-only surface
       * for the operator-relevant profile fields the post-processor depends
       * on: full-sheet work envelope (1524 x 3048 x 203 mm), vacuum zone
       * count + currently-engaged subset, ER-20 collet identifier, and the
       * spindle warm-up / cool-down dwells emitted by vcarve_mach3.hbs as
       * G4 P<sec>. Pairs the schema-pin extension (machine-schema-laguna-
       * meta.test.ts) per the UI/UX equality directive: every Phase 2 backend
       * capability must land a paired renderer surface in the same workspace
       * tab. Visible only when the active machine matches /laguna/i so the
       * card never bleeds into K2 or Carvera renders.
       *
       * 3-clicks-from-launch: My Shop -> Laguna preset -> Manufacture/CAM
       * (spec card visible directly under the vacuum-zone picker).
       */}
      {isLaguna ? (
        <section
          className="panel workspace-util-panel"
          aria-labelledby="mfg-laguna-spec-heading"
          data-testid="laguna-spec-card"
        >
          <h3
            id="mfg-laguna-spec-heading"
            className="subh util-section-heading"
          >
            Laguna Swift 5x10 Spec
          </h3>
          <p className="msg msg--muted util-panel-intro">
            Read-only summary of the machine profile fields the
            post-processor honors. Edits to envelope, collet, or
            spindle-dwell values must land in
            {' '}
            <code>resources/machines/laguna-swift-5x10.json</code>
            {' '}
            so the bundled profile and the emitted G-code stay in sync.
          </p>
          <dl className="util-laguna-spec-list" data-testid="laguna-spec-list">
            <div className="util-laguna-spec-row" data-testid="laguna-spec-envelope">
              <dt>Work envelope</dt>
              <dd>
                {`${activeCnc?.workAreaMm.x ?? '—'} × ${activeCnc?.workAreaMm.y ?? '—'} × ${activeCnc?.workAreaMm.z ?? '—'} mm`}
              </dd>
            </div>
            <div className="util-laguna-spec-row" data-testid="laguna-spec-vacuum">
              <dt>Vacuum zones</dt>
              <dd>
                {`${lagunaActiveZones.length} of ${activeCnc?.vacuumZoneCount ?? 6} engaged`}
              </dd>
            </div>
            <div className="util-laguna-spec-row" data-testid="laguna-spec-collet">
              <dt>Collet</dt>
              <dd>{activeCnc?.colletType ?? 'Not declared'}</dd>
            </div>
            <div className="util-laguna-spec-row" data-testid="laguna-spec-warmup">
              <dt>Spindle warm-up</dt>
              <dd>
                {activeCnc?.spindleWarmupDwellSec != null
                  ? `${activeCnc.spindleWarmupDwellSec.toFixed(1)} s (G4 P${activeCnc.spindleWarmupDwellSec.toFixed(1)} after M3)`
                  : 'Not declared'}
              </dd>
            </div>
            <div className="util-laguna-spec-row" data-testid="laguna-spec-cooldown">
              <dt>Spindle cool-down</dt>
              <dd>
                {activeCnc?.spindleCooldownDwellSec != null
                  ? `${activeCnc.spindleCooldownDwellSec.toFixed(1)} s (G4 P${activeCnc.spindleCooldownDwellSec.toFixed(1)} after M5)`
                  : 'Not declared'}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
      <h3 className="subh util-section-heading" id="mfg-carvera-heading">
        Makera Carvera
      </h3>
      <p className="msg msg--muted util-panel-intro" id="mfg-carvera-hint">
        Upload <code>output/cam.nc</code> to the machine using community{' '}
        <a href="https://github.com/hagmonk/carvera-cli" target="_blank" rel="noreferrer">
          carvera-cli
        </a>{' '}
        (install separately). Set the CLI under <strong>File → Settings → External tool paths</strong>. See{' '}
        <code>docs/MACHINES.md</code>.
      </p>
      <div
        className="row util-cam-actions manufacture-carvera-row"
        role="group"
        aria-label="Carvera upload"
        aria-describedby="mfg-carvera-hint"
      >
        <label htmlFor="mfg-carvera-conn">
          Connection
          <select
            id="mfg-carvera-conn"
            value={carveraConn}
            onChange={(e) => setCarveraConn(e.target.value as 'auto' | 'wifi' | 'usb')}
          >
            <option value="auto">Auto</option>
            <option value="wifi">WiFi</option>
            <option value="usb">USB</option>
          </select>
        </label>
        <label htmlFor="mfg-carvera-device">
          Device (optional)
          <input
            id="mfg-carvera-device"
            value={carveraDevice}
            onChange={(e) => setCarveraDevice(e.target.value)}
            placeholder="192.168.x.x or COM3"
            autoComplete="off"
            aria-describedby="mfg-carvera-hint"
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={!p.projectDir || !p.camOut?.trim() || carveraBusy}
          onClick={() => void uploadToCarvera()}
        >
          {carveraBusy ? 'Uploading…' : 'Upload to Carvera'}
        </button>
      </div>
      {isCarvera ? (
        <CarveraSetupPanel
          projectDir={p.projectDir}
          is4Axis={is4Axis}
          onStatus={p.onStatus}
          carveraConn={carveraConn}
          carveraDevice={carveraDevice}
        />
      ) : null}
      {/*
       * Phase 2 [P2-CARVERA-ATC]/Cycle 347: Carvera ATC Tool Table panel.
       * Visible only when the active machine is a Makera Carvera (3-axis or
       * 4-axis). For 3-axis Carvera (atcSlotCount=6, atcProbeSlot=0): renders
       * one row per ATC position — slot 0 (T0) is the wireless probe and is
       * read-only; slots 1..atcSlotCount are cutting tools whose name /
       * diameter / length / G43 H register are read from the active tool
       * library by `toolSlot`. For 4-axis Carvera: ATC is physically blocked
       * by the rotary attachment, so the panel renders an explanatory banner
       * (no slot rows). Pure read-only display in this cycle; editing tool ↔
       * slot assignments still happens on the Tools tab via tool-library
       * imports. The paired backend integration test
       * (post-process-multi-tool.test.ts > "3-distinct-tool Carvera 3-axis
       * fixture") landed C346.
       */}
      {isCarvera ? (
        <section
          className="panel workspace-util-panel"
          aria-labelledby="mfg-carvera-tool-table-heading"
          data-testid="carvera-tool-table"
        >
          <h3
            id="mfg-carvera-tool-table-heading"
            className="subh util-section-heading"
          >
            Tool Table (Makera Carvera ATC)
          </h3>
          {is4Axis ? (
            <>
              <p className="msg msg--warn" role="status">
                ATC unavailable in 4-axis mode — the rotary harmonic-drive
                attachment occupies the ATC bay. Tool changes are operator-driven
                and the post-processor emits no <code>M6</code>.
              </p>
              {/*
               * Phase 2 [P2-CARVERA-4AXIS-SIM]/Cycle 351 paired UI: the
               * "Rotary fixture" read-only info card. Surfaces the rotary
               * geometry pinned in `resources/machines/makera-carvera-4axis.json`
               * so Jacob can cross-check the values against the physical
               * fixture before posting. The directive paired this with the
               * carvera_4axis.hbs rotation-direction audit (sign is NOT
               * configurable — emit always writes absolute A; the audit
               * confirmed no drift vs. the contract pin file).
               *
               * Read-only on purpose: machine geometry is owned by the
               * machine profile JSON, not by per-session UI state. The
               * chuck outer radius is a chuck-body property; the chuck
               * depth + clamp offset are job-level and live on the CAM
               * setup form (cam-4axis-params), so they are intentionally
               * NOT shown here.
               */}
              <h4
                className="subh util-section-heading"
                id="mfg-carvera-rotary-fixture-heading"
                style={{ marginTop: '0.75rem' }}
              >
                Rotary fixture
              </h4>
              <table
                className="util-tool-table"
                role="table"
                aria-labelledby="mfg-carvera-rotary-fixture-heading"
                data-testid="carvera-rotary-fixture"
              >
                <tbody>
                  <tr data-testid="carvera-rotary-fixture-row-axis">
                    <th scope="row">A-axis orientation</th>
                    <td>
                      A around{' '}
                      <strong>
                        {(activeCnc?.aAxisOrientation ?? 'x').toUpperCase()}
                      </strong>
                    </td>
                  </tr>
                  <tr data-testid="carvera-rotary-fixture-row-range">
                    <th scope="row">A-axis range</th>
                    <td>
                      {activeCnc?.aAxisRangeDeg != null
                        ? activeCnc.aAxisRangeDeg >= 9999
                          ? 'Continuous'
                          : `${activeCnc.aAxisRangeDeg.toFixed(1)}°`
                        : '—'}
                    </td>
                  </tr>
                  <tr data-testid="carvera-rotary-fixture-row-rpm">
                    <th scope="row">Max rotary speed</th>
                    <td>
                      {activeCnc?.maxRotaryRpm != null
                        ? `${activeCnc.maxRotaryRpm} RPM`
                        : '—'}
                    </td>
                  </tr>
                  <tr data-testid="carvera-rotary-fixture-row-chuck">
                    <th scope="row">Chuck outer radius</th>
                    <td>
                      {activeCnc?.rotaryChuckOuterRadiusMm != null
                        ? `${activeCnc.rotaryChuckOuterRadiusMm.toFixed(1)} mm`
                        : '—'}
                    </td>
                  </tr>
                  <tr data-testid="carvera-rotary-fixture-row-xspan">
                    <th scope="row">Machinable X envelope</th>
                    <td>
                      {activeCnc?.workAreaMm.x != null
                        ? `${activeCnc.workAreaMm.x.toFixed(0)} mm (machine origin → tailstock)`
                        : '—'}
                    </td>
                  </tr>
                  <tr data-testid="carvera-rotary-fixture-row-y-mandate">
                    <th scope="row">Y mandate</th>
                    <td>
                      <strong>Y = 0</strong> on rotation axis (post enforces)
                    </td>
                  </tr>
                  <tr data-testid="carvera-rotary-fixture-row-z-mandate">
                    <th scope="row">Z = 0 convention</th>
                    <td>Stock <strong>center</strong> (rotation axis), NOT surface</td>
                  </tr>
                </tbody>
              </table>
              <p className="msg msg--muted">
                Verify these values against your physical Carvera 4th-Axis HD
                attachment before running. The chuck depth and clamp offset
                are job-level fields on the CAM setup form (used for the
                rotary collision sweep) and intentionally not shown here.
              </p>
            </>
          ) : (
            <>
              <p className="msg msg--muted util-panel-intro">
                ATC slot map for the Makera Carvera. Slot <strong>T0</strong>{' '}
                is the wireless tool-length probe and is reserved. Cutting
                slots <strong>T1–T{activeCnc?.atcSlotCount ?? 6}</strong> list
                the tool currently assigned in the active library
                (<code>toolSlot</code> field). Edit assignments from the{' '}
                <strong>Tools</strong> tab.
              </p>
              <table
                className="util-tool-table"
                role="table"
                aria-label="Carvera ATC slot assignments"
              >
                <thead>
                  <tr>
                    <th scope="col">Slot</th>
                    <th scope="col">Tool</th>
                    <th scope="col">Ø (mm)</th>
                    <th scope="col">Length (mm)</th>
                    <th scope="col">H register</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const slotCount = activeCnc?.atcSlotCount ?? 6
                    const probeSlot = activeCnc?.atcProbeSlot
                    const tools = p.tools?.tools ?? []
                    const slotToTool = new Map<number, (typeof tools)[number]>()
                    for (const t of tools) {
                      if (typeof t.toolSlot === 'number') {
                        slotToTool.set(t.toolSlot, t)
                      }
                    }
                    type Row = {
                      key: string
                      slot: number
                      isProbe: boolean
                      tool?: (typeof tools)[number]
                    }
                    const rows: Row[] = []
                    if (typeof probeSlot === 'number') {
                      rows.push({
                        key: `slot-${probeSlot}-probe`,
                        slot: probeSlot,
                        isProbe: true
                      })
                    }
                    for (let i = 1; i <= slotCount; i++) {
                      rows.push({
                        key: `slot-${i}`,
                        slot: i,
                        isProbe: false,
                        tool: slotToTool.get(i)
                      })
                    }
                    return rows.map((row) => (
                      <tr key={row.key} data-testid={`carvera-slot-${row.slot}`}>
                        <td>
                          <strong>T{row.slot}</strong>
                        </td>
                        <td>
                          {row.isProbe ? (
                            <em>Wireless probe (reserved)</em>
                          ) : row.tool ? (
                            row.tool.name
                          ) : (
                            <span className="msg msg--muted">— unassigned —</span>
                          )}
                        </td>
                        <td>
                          {row.isProbe
                            ? '—'
                            : row.tool?.diameterMm != null
                              ? row.tool.diameterMm.toFixed(2)
                              : '—'}
                        </td>
                        <td>
                          {row.isProbe
                            ? '—'
                            : row.tool?.lengthMm != null
                              ? row.tool.lengthMm.toFixed(2)
                              : '—'}
                        </td>
                        <td>
                          {row.isProbe
                            ? '—'
                            : (row.tool?.wearOffsetH ??
                                row.tool?.toolSlot ??
                                '—')}
                        </td>
                      </tr>
                    ))
                  })()}
                </tbody>
              </table>
            </>
          )}
        </section>
      ) : null}
      {!readiness.canCam ? (
        <div className="msg manufacture-op-hint">
          <p>
            {readiness.issues
              .filter((i) => i.id === 'cam_non_cnc_first_op' || i.id === 'cam_cnc_machine_missing')
              .map((i) => i.message)
              .join(' ') || 'CAM preflight not ready.'}
          </p>
          <div className="row">
            <button type="button" className="secondary" onClick={() => p.onGoProject()}>
              Fix machine in Project tab
            </button>
          </div>
        </div>
      ) : null}
      {!p.camOut?.trim() ? (
        <p className="msg util-output-placeholder" role="status">
          No G-code yet. On the <strong>Plan</strong> tab, bind an STL from <code>assets/</code> to each operation, then return here and run{' '}
          <strong>Generate toolpath…</strong>. Use <strong>Simulate</strong> for a 3D backplot (optional stock-removal preview); this tab’s{' '}
          <strong>Preview G-code analysis</strong> is text-only motion stats.
        </p>
      ) : null}
      {camPreviewTick > 0 ? (
        <div className="msg mfg-cam-preview-wrap" role="status" aria-live="polite" aria-labelledby="mfg-cam-preview-heading">
          <h3 className="subh util-section-heading mfg-cam-preview-h3" id="mfg-cam-preview-heading">
            G-code analysis
          </h3>
          <strong>Text-only summary</strong> (Tier 0 — not machine simulation): {camPreview.disclaimer}
          <br />
          Lines: {camPreview.totalLines}, motion: {camPreview.motionLines}, cutting moves: {camPreview.cuttingMoves}
          {camPreview.heuristicMotionMinutes != null && camPreview.heuristicMotionPathMm != null ? (
            <>
              <br />
              Heuristic motion time (see note): ~{camPreview.heuristicMotionMinutes.toFixed(2)} min over{' '}
              {camPreview.heuristicMotionPathMm.toFixed(1)} mm of G0/G1 length — {camPreview.heuristicMotionNote}
            </>
          ) : null}
          {camPreview.xyBounds ? (
            <>
              <br />
              XY envelope (mm): X {camPreview.xyBounds.minX.toFixed(2)} → {camPreview.xyBounds.maxX.toFixed(2)}, Y{' '}
              {camPreview.xyBounds.minY.toFixed(2)} → {camPreview.xyBounds.maxY.toFixed(2)}
            </>
          ) : null}
          {camPreview.zRange ? (
            <>
              <br />
              Z span (mm): {camPreview.zRange.bottomZ.toFixed(2)} → {camPreview.zRange.topZ.toFixed(2)}
            </>
          ) : null}
          {camPreview.cues.length > 0 ? (
            <>
              <br />
              Evolution cues:
              <ul>
                {camPreview.cues.map((cue, idx) => (
                  <li key={`${cue.progressPct}-${idx}`}>
                    {cue.progressPct}% — {cue.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
      {p.camOut?.trim() ? (
        <>
          <h3 className="subh util-section-heading" id="mfg-cam-output-heading">
            G-code output
          </h3>
          <CamLastRunHint hint={p.camLastHint} />
          <p className="sr-only" role="status" aria-live="polite">
            CAM output updated, showing {countVisibleLines(p.camOut.slice(0, CAM_PREVIEW))} lines.
          </p>
          <pre className="code" tabIndex={0} aria-labelledby="mfg-cam-output-heading">
            {p.camOut.slice(0, CAM_PREVIEW)}
            {p.camOut.length > CAM_PREVIEW ? '\n…' : ''}
          </pre>
        </>
      ) : null}
    </section>
  )
}

export function ToolsManufacturePanel(p: ManufactureAuxPanelsProps): ReactNode {
  const mid = p.project?.activeMachineId?.trim()
  const hasMachineTarget = Boolean(mid)
  return (
    <section className="panel workspace-util-panel" aria-labelledby="mfg-tools-heading">
      <h2 id="mfg-tools-heading">Tool libraries</h2>
      <p className="msg util-panel-intro">
        <strong>Merged view</strong> below lists tools available to CAM (machine library first, then project-only). Import into
        the <strong>machine library</strong> to reuse tools across all projects for this machine, or into <strong>project</strong>{' '}
        (<code>tools.json</code>) for project-specific tools.
      </p>
      <p className="msg">
        Paste CSV or JSON below, or pick <strong>Import library file…</strong> for <code>.csv</code>, <code>.json</code>,{' '}
        <code>.hsmlib</code> / <code>.tpgz</code> (gzipped XML, best-effort HSM-style). Simple paste CSV:{' '}
        <code>name</code>, <code>diameterMm</code>, <code>fluteCount</code>, <code>type</code>. Use <strong>Import Fusion
        CSV</strong> for wide Fusion Manufacture exports.
      </p>
      <label htmlFor="mfg-tools-import">
        Import data (same paste box for both targets)
        <textarea
          id="mfg-tools-import"
          value={p.importText}
          onChange={(e) => p.onImportTextChange(e.target.value)}
          placeholder="Paste CSV or JSON"
          spellCheck={false}
          aria-describedby="mfg-tools-import-hint"
        />
      </label>
      <p id="mfg-tools-import-hint" className="msg">
        Open a project first. Machine imports require an <strong>active machine</strong> on File → Project.
      </p>
      <fieldset className="util-tools-actions" aria-describedby="mfg-tools-import-hint">
        <legend className="util-fieldset-legend">Import into machine library (app storage)</legend>
        <div className="row row--wrap">
          <button
            type="button"
            onClick={() => void p.onImportToolLibraryFromFile('machine')}
            disabled={!p.projectDir || !hasMachineTarget}
          >
            Import file → machine…
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void p.onImportTools('csv', 'machine')}
            disabled={!p.projectDir || !hasMachineTarget}
          >
            Paste CSV → machine
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void p.onImportTools('json', 'machine')}
            disabled={!p.projectDir || !hasMachineTarget}
          >
            Paste JSON → machine
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void p.onImportTools('fusion', 'machine')}
            disabled={!p.projectDir || !hasMachineTarget}
          >
            Fusion JSON → machine
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void p.onImportTools('fusion_csv', 'machine')}
            disabled={!p.projectDir || !hasMachineTarget}
          >
            Fusion CSV → machine
          </button>
        </div>
      </fieldset>
      <fieldset className="util-tools-actions">
        <legend className="util-fieldset-legend">Import into project tools.json</legend>
        <div className="row row--wrap">
          <button type="button" onClick={() => void p.onImportToolLibraryFromFile('project')} disabled={!p.projectDir}>
            Import file → project…
          </button>
          <button type="button" className="secondary" onClick={() => void p.onImportTools('csv', 'project')} disabled={!p.projectDir}>
            Paste CSV → project
          </button>
          <button type="button" className="secondary" onClick={() => void p.onImportTools('json', 'project')} disabled={!p.projectDir}>
            Paste JSON → project
          </button>
          <button type="button" className="secondary" onClick={() => void p.onImportTools('fusion', 'project')} disabled={!p.projectDir}>
            Fusion JSON → project
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void p.onImportTools('fusion_csv', 'project')}
            disabled={!p.projectDir}
          >
            Fusion CSV → project
          </button>
        </div>
      </fieldset>
      {p.onMigrateProjectToolsToMachine && hasMachineTarget ? (
        <p className="msg">
          <button type="button" className="secondary" onClick={() => void p.onMigrateProjectToolsToMachine?.()} disabled={!p.projectDir}>
            Merge project tools.json into machine library
          </button>{' '}
          (dedupes by name + diameter like other imports)
        </p>
      ) : null}
      {p.tools && p.tools.tools.length > 0 ? (
        <ul className="tools" aria-label="Merged tools for CAM">
          {p.tools.tools.map((t) => (
            <li key={t.id}>
              {t.name} — Ø{t.diameterMm} mm {t.type} {t.fluteCount != null ? `(${t.fluteCount} fl)` : ''}{' '}
              <span className="msg msg--muted">({t.id})</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.projectDir && p.tools && p.tools.tools.length === 0 ? (
        <p className="msg util-output-placeholder" role="status">
          No tools yet. Import into the machine or project library above, or add tools from the <strong>Plan</strong> tab.
        </p>
      ) : null}
      {!p.projectDir ? (
        <p className="msg util-output-placeholder" role="status">
          Open or create a project on the <strong>File → Project</strong> tab so imports can run.
        </p>
      ) : null}
    </section>
  )
}

// ─── Device / Send stack wrapper ─────────────────────────────────────────────
//
// UX deep-dive synthesis move #5: the right-side profile stack. The standalone
// `ProfileStack` component owns the layout; this wrapper bridges the existing
// `ManufactureAuxPanelsProps` surface (so `ManufactureWorkspace.tsx` can drop
// it in next to `SliceManufacturePanel` / `CamManufacturePanel`) into the new
// `ProfileStackProps` shape.
//
// Important: the wrapper does NOT touch G-code bytes or own the Send payload.
// It accepts an `onSend` callback from the parent (typically a thin closure
// around the existing K2 Moonraker push / Carvera upload / Laguna export
// handler) and delegates the click through. Disabled when `onSend` is null.

export type ProfileStackPanelProps = ManufactureAuxPanelsProps & {
  /** Controlled Recommended ⇆ Pro toggle. Defaults to 'recommended'. */
  readonly displayMode?: ProfileStackDisplayMode
  /** Optional callback when the operator toggles the mode pill. */
  readonly onDisplayModeChange?: (mode: ProfileStackDisplayMode) => void
  /**
   * Primary Send-to-machine action. Pass `null` to render the button
   * disabled (e.g. when the slice hasn't produced an on-disk file yet).
   */
  readonly onSend?: (() => void) | null
  /** Lightweight active-job hint (id + display name only). Null = idle. */
  readonly activeJob?: { readonly id: string; readonly name: string } | null
}

/**
 * Renders the ProfileStack from the existing ManufactureAuxPanelsProps
 * surface. Exposed as an additional surface so the new "Device" / "Send"
 * workspace stage can mount it without rewriting the sibling panels.
 *
 * Backward compat: the legacy `SliceManufacturePanel` / `CamManufacturePanel`
 * / `ToolsManufacturePanel` exports stay in place. This wrapper is purely
 * additive.
 */
export function ProfileStackPanel(p: ProfileStackPanelProps): ReactNode {
  const machine = p.activeMachine ?? null
  const machineMode: 'fdm' | 'cnc' = machine?.kind === 'fdm' ? 'fdm' : 'cnc'
  return (
    <ProfileStack
      machineMode={machineMode}
      machine={machine}
      activeJob={p.activeJob ?? null}
      settings={p.settings}
      manufacture={p.manufacture}
      tools={p.tools}
      displayMode={p.displayMode}
      onModeChange={p.onDisplayModeChange}
      onSend={p.onSend}
      onSaveSettingsField={(field, value) => {
        // Map the (field, value) signature back onto the existing
        // Partial<AppSettings> shape so callers wired up to the legacy
        // panels do not need a second IPC path.
        p.onSaveSettingsField({ [field]: value } as Parameters<typeof p.onSaveSettingsField>[0])
      }}
    />
  )
}
