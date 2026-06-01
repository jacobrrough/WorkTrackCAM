/**
 * ProfileStack — right-side device/profile/send stack for the Manufacture
 * workspace (UX overhaul move #5 in the deep-dive synthesis).
 *
 * One vertical column, top→bottom:
 *   1. Mode toggle pill row (Recommended ⇆ Pro). Recommended hides the deep
 *      knobs; Pro reveals them. Same functionality either way — content
 *      density only.
 *   2. Per-machine content rows:
 *        - FDM (Creality K2 Plus):
 *            • Filament chip row (delegates to the existing FilamentPicker
 *              so the picker stays one component).
 *            • K2 Plus quality preset dropdown (Standard / High-Speed).
 *            • Fan / temp summary mini key-value (Pro only).
 *        - CNC (Laguna Swift 5x10, Makera Carvera 3-axis / 4-axis):
 *            • Tool chip row (count + first tool preview).
 *            • Stock summary key-value row.
 *            • Setup-sheet status pill.
 *   3. Sticky bottom primary action — Send button. Label is machine-specific
 *      ("Send to K2 Plus" / "Send to Carvera" / "Export for Laguna" because
 *      Laguna has no in-app send — Export drops a file for USB transfer).
 *      Disabled when `onSend` is `null` (parent says: not ready).
 *
 * This component is presentation-only. ALL state lives in the parent
 * (ManufactureWorkspace). `onSend` is the single point through which
 * the actual K2 Moonraker push / Carvera upload / Laguna export fires —
 * the ProfileStack never owns the upload payload or G-code path.
 *
 * Strict typing per CLAUDE.md:
 *   • All props `readonly`.
 *   • No `any` — Filament / Machine / Settings types come from the shared
 *     schemas.
 *   • Sub-component prop interfaces are local (not exported) because they
 *     are purely an internal layout helper.
 *
 * My-Shop-Only: every per-machine branch is gated on the three target
 * machines from CLAUDE.md (Creality K2 Plus / Laguna Swift 5x10 / Makera
 * Carvera 3+4 axis). The fallback render is a friendly EmptyState so the
 * stack never produces a silently empty column.
 *
 * Safety Rule 1 (G-code is sacred): nothing in this file touches G-code
 * bytes — the Send button delegates to the parent-supplied onSend, and the
 * "Export for Laguna" path is a no-op visual relabel until the parent
 * wires the export handler.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import type { AppSettings } from '../../shared/project-schema'
import type { ManufactureFile } from '../../shared/manufacture-schema'
import type { ToolLibraryFile } from '../../shared/tool-schema'
import type { FilamentRecord } from '../../shared/filament-schema'
import {
  K2_PLUS_QUALITY_PRESET_IDS,
  K2_PLUS_SLICE_PRESETS,
  type K2PlusQualityPresetId
} from '../../shared/k2-plus-slice-presets'
import { FilamentPicker } from './FilamentPicker'
import { EmptyState } from '../src/EmptyState'

// ─── Public props ────────────────────────────────────────────────────────────

export type ProfileStackDisplayMode = 'recommended' | 'pro'

export interface ProfileStackProps {
  /** Dispatch root — picks the FDM stack vs CNC stack content. */
  readonly machineMode: 'fdm' | 'cnc'
  /** Active machine profile (drives the Send-button label + per-machine rows). */
  readonly machine: MachineProfile | null
  /**
   * Hint of the current job/run. Today only `null` vs non-null is meaningful
   * (used to decide whether to show an "active job" pill). The full Job
   * type lives in the shop-types module and is renderer-scoped — keeping
   * this opaque for now so the ProfileStack can be lifted into any host.
   */
  readonly activeJob: { readonly id: string; readonly name: string } | null
  /** App settings (drives K2 quality preset persistence + moonraker URL hint). */
  readonly settings: AppSettings | null
  /** Manufacture plan (drives tool count / setup-sheet status for CNC). */
  readonly manufacture?: ManufactureFile | null
  /** Active tool library (drives tool chip row). */
  readonly tools?: ToolLibraryFile | null
  /** Controlled by parent; defaults to `'recommended'`. */
  readonly displayMode?: ProfileStackDisplayMode
  /** Optional mode-change callback. */
  readonly onModeChange?: (mode: ProfileStackDisplayMode) => void
  /**
   * Primary Send action. `null` means "not ready" — the button renders
   * disabled. Parent owns the actual upload/export logic.
   */
  readonly onSend?: (() => void) | null
  /** Delegate for FDM filament + K2 preset persistence. */
  readonly onSaveSettingsField?: (field: string, value: unknown) => void
}

// ─── Machine helpers (local) ─────────────────────────────────────────────────

function isK2Plus(machine: MachineProfile | null): boolean {
  return machine?.id === 'creality-k2-plus'
}

function isLaguna(machine: MachineProfile | null): boolean {
  if (!machine || machine.kind !== 'cnc') return false
  return /laguna/i.test(`${machine.id} ${machine.name}`)
}

function isCarvera(machine: MachineProfile | null): boolean {
  if (!machine || machine.kind !== 'cnc') return false
  return /carvera/i.test(`${machine.id} ${machine.name}`)
}

/**
 * Machine-specific Send button label. Laguna has no in-app send — the post
 * drops a `.tap`/`.nc` file for USB transfer to the RichAuto pendant — so
 * the label becomes "Export for Laguna" (parent's onSend should open the
 * native save dialog, not push a TCP payload).
 */
function sendLabelFor(machine: MachineProfile | null): string {
  if (isK2Plus(machine)) return 'Send to K2 Plus'
  if (isCarvera(machine)) return 'Send to Carvera'
  if (isLaguna(machine)) return 'Export for Laguna'
  if (machine?.kind === 'fdm') return 'Send to printer'
  return 'Send to machine'
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface ModeTogglePillProps {
  readonly mode: ProfileStackDisplayMode
  readonly onChange: (mode: ProfileStackDisplayMode) => void
}

function ModeTogglePill({ mode, onChange }: ModeTogglePillProps): ReactNode {
  return (
    <div
      className="profile-stack__mode-toggle"
      role="group"
      aria-label="Display mode"
      data-testid="profile-stack-mode-toggle"
    >
      <button
        type="button"
        className={mode === 'recommended' ? 'primary' : 'secondary'}
        data-testid="profile-stack-mode-recommended"
        data-active={mode === 'recommended' ? 'true' : 'false'}
        aria-pressed={mode === 'recommended'}
        onClick={() => onChange('recommended')}
      >
        Recommended
      </button>
      <button
        type="button"
        className={mode === 'pro' ? 'primary' : 'secondary'}
        data-testid="profile-stack-mode-pro"
        data-active={mode === 'pro' ? 'true' : 'false'}
        aria-pressed={mode === 'pro'}
        onClick={() => onChange('pro')}
      >
        Pro
      </button>
    </div>
  )
}

interface FilamentRowProps {
  readonly machine: MachineProfile | null
  readonly activeFilamentId: string | undefined
  readonly onSelect: (id: string) => void
}

function FilamentRow({ machine, activeFilamentId, onSelect }: FilamentRowProps): ReactNode {
  // `loaded` flips to `true` only after the IPC list call resolves so the
  // empty-state surface does NOT fire on the first synchronous render
  // (renderToStaticMarkup never runs effects, so empty + loaded=false is
  // the "we just mounted" branch).
  const [filaments, setFilaments] = useState<FilamentRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (machine?.kind !== 'fdm') return
    void window.fab
      .filamentsList()
      .then((rows) => {
        setFilaments(rows)
        setLoaded(true)
      })
      .catch(() => {
        setFilaments([])
        setLoaded(true)
      })
  }, [machine])

  if (loaded && filaments.length === 0) {
    return (
      <EmptyState
        testId="profile-stack-filament-empty"
        title="No filaments yet"
        body="Import a filament profile from File → Settings to enable Send."
      />
    )
  }
  return (
    <div data-testid="profile-stack-filament-row">
      <FilamentPicker
        filaments={filaments}
        activeFilamentId={activeFilamentId}
        onSelect={onSelect}
        machineMaxNozzleTempC={machine?.maxNozzleTempC}
        machineMaxBedTempC={machine?.maxBedTempC}
      />
    </div>
  )
}

interface QualityRowProps {
  readonly presetId: K2PlusQualityPresetId
  readonly onChange: (id: K2PlusQualityPresetId) => void
}

function QualityRow({ presetId, onChange }: QualityRowProps): ReactNode {
  return (
    <label
      htmlFor="profile-stack-quality"
      className="profile-stack__row"
      data-testid="profile-stack-quality-row"
    >
      <span>Quality</span>
      <select
        id="profile-stack-quality"
        data-testid="profile-stack-quality-select"
        value={presetId}
        onChange={(e) => onChange(e.target.value as K2PlusQualityPresetId)}
      >
        {K2_PLUS_QUALITY_PRESET_IDS.map((id) => (
          <option key={id} value={id} title={K2_PLUS_SLICE_PRESETS[id].description}>
            {K2_PLUS_SLICE_PRESETS[id].label}
          </option>
        ))}
      </select>
    </label>
  )
}

interface TempsRowProps {
  readonly nozzleC: number | undefined
  readonly bedC: number | undefined
  readonly chamberC: number | undefined
}

function TempsRow({ nozzleC, bedC, chamberC }: TempsRowProps): ReactNode {
  return (
    <dl className="profile-stack__kv" data-testid="profile-stack-temps-row">
      <div className="profile-stack__kv-item">
        <dt>Nozzle (max)</dt>
        <dd>{nozzleC != null ? `${nozzleC} °C` : '—'}</dd>
      </div>
      <div className="profile-stack__kv-item">
        <dt>Bed (max)</dt>
        <dd>{bedC != null ? `${bedC} °C` : '—'}</dd>
      </div>
      <div className="profile-stack__kv-item">
        <dt>Chamber (target)</dt>
        <dd>{chamberC != null ? `${chamberC} °C` : '—'}</dd>
      </div>
    </dl>
  )
}

interface ToolChipRowProps {
  readonly tools: ToolLibraryFile | null | undefined
}

function ToolChipRow({ tools }: ToolChipRowProps): ReactNode {
  const list = tools?.tools ?? []
  if (list.length === 0) {
    return (
      <EmptyState
        testId="profile-stack-tools-empty"
        title="No tools yet"
        body="Import a tool library from the Tools panel to populate this stack."
      />
    )
  }
  // Show up to 4 tool chips so the row never blows past a single line on
  // the workspace's right column.
  const preview = list.slice(0, 4)
  return (
    <div
      className="profile-stack__chips"
      role="group"
      aria-label="Tools available for this job"
      data-testid="profile-stack-tool-row"
    >
      {preview.map((t) => (
        <span
          key={t.id}
          className="profile-stack__chip"
          data-testid={`profile-stack-tool-chip-${t.id}`}
          title={`${t.name} — Ø${t.diameterMm ?? '?'} mm`}
        >
          {t.name}
        </span>
      ))}
      {list.length > preview.length ? (
        <span
          className="profile-stack__chip profile-stack__chip--muted"
          data-testid="profile-stack-tool-chip-overflow"
        >
          {`+${list.length - preview.length} more`}
        </span>
      ) : null}
    </div>
  )
}

interface StockRowProps {
  readonly machine: MachineProfile | null
}

function StockRow({ machine }: StockRowProps): ReactNode {
  if (machine == null) return null
  const w = machine.workAreaMm
  return (
    <dl className="profile-stack__kv" data-testid="profile-stack-stock-row">
      <div className="profile-stack__kv-item">
        <dt>Work envelope</dt>
        <dd>{`${w.x} × ${w.y} × ${w.z} mm`}</dd>
      </div>
      {machine.colletType ? (
        <div className="profile-stack__kv-item">
          <dt>Collet</dt>
          <dd>{machine.colletType}</dd>
        </div>
      ) : null}
      {machine.maxSpindleRpm != null ? (
        <div className="profile-stack__kv-item">
          <dt>Spindle (max)</dt>
          <dd>{`${machine.maxSpindleRpm} RPM`}</dd>
        </div>
      ) : null}
    </dl>
  )
}

interface SetupSheetRowProps {
  readonly manufacture: ManufactureFile | null | undefined
}

function SetupSheetRow({ manufacture }: SetupSheetRowProps): ReactNode {
  const opCount = manufacture?.operations?.length ?? 0
  const ready = opCount > 0
  return (
    <div
      className="profile-stack__row profile-stack__row--status"
      data-testid="profile-stack-setup-sheet-row"
      data-status={ready ? 'ready' : 'pending'}
    >
      <span>Setup sheet</span>
      <strong>{ready ? `${opCount} op${opCount === 1 ? '' : 's'} ready` : 'No operations yet'}</strong>
    </div>
  )
}

interface SendButtonProps {
  readonly label: string
  readonly onSend: (() => void) | null | undefined
}

function SendButton({ label, onSend }: SendButtonProps): ReactNode {
  const enabled = typeof onSend === 'function'
  return (
    <div className="profile-stack__send">
      <button
        type="button"
        className="primary"
        data-testid="profile-stack-send-button"
        disabled={!enabled}
        aria-disabled={!enabled}
        onClick={() => {
          if (enabled) onSend()
        }}
      >
        {label}
      </button>
    </div>
  )
}

// ─── Composed component ──────────────────────────────────────────────────────

export function ProfileStack(props: ProfileStackProps): ReactNode {
  const {
    machineMode,
    machine,
    activeJob,
    settings,
    manufacture,
    tools,
    displayMode,
    onModeChange,
    onSend,
    onSaveSettingsField
  } = props
  const mode: ProfileStackDisplayMode = displayMode ?? 'recommended'

  const k2QualityPresetId: K2PlusQualityPresetId = settings?.k2QualityPresetId ?? 'standard'

  function setQualityPreset(id: K2PlusQualityPresetId): void {
    onSaveSettingsField?.('k2QualityPresetId', id)
  }

  function setActiveFilamentId(id: string): void {
    onSaveSettingsField?.('activeFilamentId', id)
  }

  const label = sendLabelFor(machine)
  const stageEnv = machineMode === 'fdm' ? 'fdm' : 'cnc'

  return (
    <aside
      className="profile-stack"
      data-testid="profile-stack"
      data-machine-mode={stageEnv}
      data-display-mode={mode}
      aria-label="Device and send"
    >
      <ModeTogglePill
        mode={mode}
        onChange={(next) => onModeChange?.(next)}
      />
      {activeJob != null ? (
        <p
          className="msg msg--muted profile-stack__active-job"
          data-testid="profile-stack-active-job"
        >
          {`Active job: ${activeJob.name}`}
        </p>
      ) : null}
      {machine == null ? (
        <EmptyState
          testId="profile-stack-empty"
          title="No machine selected"
          body="Pick a machine on the Project tab to populate the device stack."
        />
      ) : machineMode === 'fdm' ? (
        <>
          <FilamentRow
            machine={machine}
            activeFilamentId={settings?.activeFilamentId ?? undefined}
            onSelect={setActiveFilamentId}
          />
          {isK2Plus(machine) ? (
            <QualityRow presetId={k2QualityPresetId} onChange={setQualityPreset} />
          ) : null}
          {mode === 'pro' ? (
            <TempsRow
              nozzleC={machine.maxNozzleTempC}
              bedC={machine.maxBedTempC}
              chamberC={machine.chamberTempC}
            />
          ) : null}
        </>
      ) : (
        <>
          <ToolChipRow tools={tools ?? null} />
          <StockRow machine={machine} />
          {mode === 'pro' ? (
            <SetupSheetRow manufacture={manufacture ?? null} />
          ) : null}
        </>
      )}
      <SendButton label={label} onSend={onSend} />
    </aside>
  )
}

export default ProfileStack
