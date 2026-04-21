import { useState, type ReactNode } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import {
  CURA_SLICE_PRESETS,
  CURA_SLICE_PRESET_IDS,
  mergeCuraSliceInvocationSettings,
  parseCuraSliceProfilesJson,
  resolveCuraSliceParams,
  type CuraSlicePresetId
} from '../../shared/cura-slice-defaults'
import type { AppSettings, ProjectFile } from '../../shared/project-schema'
import type { ToolLibraryFile } from '../../shared/tool-schema'
import { buildCamSimulationPreview } from '../../shared/cam-simulation-preview'
import { formatFdmLayerSummaryHuman, summarizeFdmGcodeLayers } from '../../shared/fdm-gcode-layer-summary'
import { CamLastRunHint } from '../utilities/CamLastRunHint'
import { evaluateManufactureReadiness } from '../../shared/manufacture-readiness'
import type { ManufactureFile } from '../../shared/manufacture-schema'
import { CarveraSetupPanel } from './CarveraSetupPanel'

const SLICE_PREVIEW = 8000
const CAM_PREVIEW = 8000
const countVisibleLines = (text: string): number => text.split(/\r?\n/).length

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
}

export function SliceManufacturePanel(p: ManufactureAuxPanelsProps): ReactNode {
  const readiness = evaluateManufactureReadiness({
    project: p.project,
    settings: p.settings,
    machines: p.machines,
    manufacture: p.manufacture
  })
  const preset = (p.settings?.curaSlicePreset ?? 'balanced') as CuraSlicePresetId
  const active = resolveCuraSliceParams(preset)
  const namedProfiles = parseCuraSliceProfilesJson(p.settings?.curaSliceProfilesJson)
  const mergedMap = mergeCuraSliceInvocationSettings(p.settings ?? null)
  const mergedPreview = [...mergedMap.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .slice(0, 24)
    .join(', ')
  const activeProfileId = p.settings?.curaActiveSliceProfileId ?? ''
  return (
    <section className="panel workspace-util-panel" aria-labelledby="mfg-slice-heading">
      <h2 id="mfg-slice-heading">FDM slice (K2 Plus profile)</h2>
      <p className="msg util-panel-intro">
        Uses CuraEngine with the bundled <code>resources/slicer/creality_k2_plus.def.json</code> unless you set{' '}
        <strong>machine definition (-j)</strong> under <strong>File → Settings → External tool paths</strong>. Paths also come
        from that section. Pick a <strong>preset</strong> below (maps to{' '}
        <code>buildCuraSliceArgs</code> <code>-s</code> values in <code>cura-slice-defaults.ts</code>). Optional{' '}
        <strong>named profiles</strong> and extra JSON are configured under <strong>File → Settings → CuraEngine advanced</strong>.
      </p>
      <div className="row">
        <label htmlFor="mfg-slice-preset">
          Slice preset
          <select
            id="mfg-slice-preset"
            value={preset}
            onChange={(e) => void p.onSaveSettingsField({ curaSlicePreset: e.target.value as CuraSlicePresetId })}
          >
            {CURA_SLICE_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
                {id === 'balanced' ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="mfg-slice-named-profile">
          Named profile
          <select
            id="mfg-slice-named-profile"
            value={activeProfileId}
            onChange={(e) =>
              void p.onSaveSettingsField({
                curaActiveSliceProfileId: e.target.value.trim() ? e.target.value : undefined
              })
            }
          >
            <option value="">— none —</option>
            {namedProfiles.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.label} ({pr.id})
              </option>
            ))}
          </select>
        </label>
        <p className="msg msg-row-flex">
          Base preset (when no profile): layer <strong>{active.layerHeightMm}</strong> mm, line{' '}
          <strong>{active.lineWidthMm}</strong> mm, <strong>{active.wallLineCount}</strong> walls,{' '}
          <strong>{active.infillSparseDensity}%</strong> sparse infill. Raw bundles:{' '}
          <code>{JSON.stringify(CURA_SLICE_PRESETS.balanced)}</code> (balanced),{' '}
          <code>{JSON.stringify(CURA_SLICE_PRESETS.draft)}</code> (draft),{' '}
          <code>{JSON.stringify(CURA_SLICE_PRESETS.fine)}</code> (fine).
        </p>
      </div>
      <p className="msg util-panel-intro">
        <strong>Effective CuraEngine `-s` preview</strong> (first keys, sorted):{' '}
        <code className="code-break-all">{mergedPreview || '(preset only)'}</code>
        {mergedMap.size > 24 ? ` … +${mergedMap.size - 24} more` : null}
      </p>
      <p className="msg">
        G-code is <strong>unverified</strong> for your printer until you confirm profiles, temperatures, and limits —{' '}
        see <code>docs/MACHINES.md</code>.
      </p>
      <h3 className="subh util-section-heading" id="mfg-slice-run-heading">
        Run slice
      </h3>
      <button type="button" className="primary" onClick={() => void p.onRunSlice()} aria-describedby="mfg-slice-run-heading">
        Slice STL…
      </button>
      {!readiness.canSlice ? (
        <div className="msg manufacture-op-hint">
          <p>{readiness.issues.find((i) => i.id === 'settings_cura_missing')?.message ?? 'Slice preflight not ready.'}</p>
          <div className="row">
            <button type="button" className="secondary" onClick={() => p.onGoSettings()}>
              Open Settings
            </button>
            <button type="button" className="secondary" onClick={() => p.onGoProject()}>
              Open Project tab
            </button>
          </div>
        </div>
      ) : null}
      {!p.sliceOut?.trim() ? (
        <p className="msg util-output-placeholder" role="status">
          No Cura output yet. Add an STL on the <strong>File → Project</strong> tab, then run <strong>Slice STL…</strong>.
        </p>
      ) : null}
      {p.sliceOut?.trim() ? (
        <>
          <h3 className="subh util-section-heading" id="mfg-slice-output-heading">
            Output
          </h3>
          {(() => {
            const fdmLayerSummary = summarizeFdmGcodeLayers(p.sliceOut ?? '')
            const line = formatFdmLayerSummaryHuman(fdmLayerSummary)
            return line ? (
              <p className="msg util-panel-intro" role="status">
                {line}
              </p>
            ) : null
          })()}
          <p className="sr-only" role="status" aria-live="polite">
            Slice output updated, showing {countVisibleLines(p.sliceOut.slice(0, SLICE_PREVIEW))} lines.
          </p>
          <pre className="code" tabIndex={0} aria-labelledby="mfg-slice-output-heading">
            {p.sliceOut.slice(0, SLICE_PREVIEW)}
            {p.sliceOut.length > SLICE_PREVIEW ? '\n…' : ''}
          </pre>
        </>
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
