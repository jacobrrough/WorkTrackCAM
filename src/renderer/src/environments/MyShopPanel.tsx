/**
 * MyShopPanel — "My Shop" tab/drawer surface called out in CLAUDE.md
 * §"UI Requirements":
 *
 *   > Add a "My Shop" tab or quick-select that ONLY shows these three
 *   > machines plus their real-world presets (full-sheet routing,
 *   > high-speed FDM, 4-axis rotary parts).
 *
 * Renders exactly three machine cards (one per target machine in
 * `MY_SHOP_MACHINE_IDS`), themed via the env accent, with the preset
 * buttons from `my-shop-presets.ts`. Presentation-only: the parent wires
 * `onLaunchPreset` to `resolveQuickSwitchMachine(env, machines, …)` so
 * presets do NOT bypass the quick-switch resolver's variant-memory and
 * missing-machine rules.
 *
 * The card for a machine that is NOT installed is rendered in a disabled
 * state with an "Install machine" affordance, rather than hidden — that
 * way Jacob always sees all three bays and knows what's still to set up.
 */
import React from 'react'
import type { MachineProfile } from '../../../shared/machine-schema'
import { ENVIRONMENTS, type EnvironmentId } from './registry'
import {
  MY_SHOP_MACHINE_IDS,
  MY_SHOP_PRESETS,
  getMyShopPresetsForMachine,
  type MyShopMachineId,
  type MyShopPreset
} from './my-shop-presets'

export interface MyShopPanelProps {
  /** All installed machine profiles (bundled + user). */
  machines: readonly MachineProfile[]
  /** Active session machine ID — card is highlighted when it matches. */
  currentMachineId: string | null
  /**
   * Called when the user clicks a preset button. Parent is responsible
   * for calling `resolveQuickSwitchMachine(env, machines, …)` to honour
   * variant memory + missing-machine rules, then activating the matched
   * machine and optionally pre-selecting the preset's `primaryOpKind`.
   */
  onLaunchPreset: (preset: MyShopPreset) => void
  /**
   * Called when the user clicks the "Install machine" affordance for a
   * card whose machine is not yet in `machines`. Parent routes this to
   * the Library drawer.
   */
  onInstallMachine: (machineId: MyShopMachineId) => void
}

/**
 * Display-only specs summary for a machine card. Keeps the card compact
 * by deriving a short line from the `MachineProfile` work area and kind.
 */
function formatSpecsLine(machine: MachineProfile | null): string {
  if (!machine) return 'Not installed'
  const { x, y, z } = machine.workAreaMm
  const kindLabel = machine.kind === 'fdm' ? 'FDM' : 'CNC'
  return `${kindLabel} \u00B7 ${x} \u00D7 ${y} \u00D7 ${z} mm`
}

/**
 * One machine card in the tab surface — header (name + env accent),
 * specs line, and the preset button list. Disabled when the machine is
 * not installed.
 */
interface MyShopCardProps {
  machineId: MyShopMachineId
  machine: MachineProfile | null
  envId: EnvironmentId
  isCurrent: boolean
  presets: readonly MyShopPreset[]
  onLaunchPreset: (preset: MyShopPreset) => void
  onInstallMachine: (machineId: MyShopMachineId) => void
}

function MyShopCard({
  machineId,
  machine,
  envId,
  isCurrent,
  presets,
  onLaunchPreset,
  onInstallMachine
}: MyShopCardProps): React.ReactElement {
  const env = ENVIRONMENTS[envId]
  const installed = machine !== null
  return (
    <section
      className={`my-shop-card${isCurrent ? ' my-shop-card--current' : ''}${
        installed ? '' : ' my-shop-card--uninstalled'
      }`}
      data-machine-id={machineId}
      data-environment={envId}
      aria-label={machine?.name ?? machineId}
    >
      <header className="my-shop-card__header">
        <span className="my-shop-card__glyph" aria-hidden="true">
          {env.iconGlyph}
        </span>
        <div className="my-shop-card__titleblock">
          <h3 className="my-shop-card__name">{machine?.name ?? machineId}</h3>
          <div className="my-shop-card__env">{env.name}</div>
        </div>
        {isCurrent && (
          <span className="my-shop-card__badge" aria-label="Active session machine">
            Active
          </span>
        )}
      </header>

      <div className="my-shop-card__specs">{formatSpecsLine(machine)}</div>

      <ul className="my-shop-card__presets" aria-label={`${env.name} real-world presets`}>
        {presets.map((preset) => (
          <li key={preset.id} className="my-shop-card__preset">
            <button
              type="button"
              className="my-shop-card__preset-btn"
              disabled={!installed}
              onClick={() => onLaunchPreset(preset)}
              title={preset.description}
              data-preset-id={preset.id}
            >
              <span className="my-shop-card__preset-label">{preset.label}</span>
              <span className="my-shop-card__preset-desc">{preset.description}</span>
            </button>
          </li>
        ))}
      </ul>

      {!installed && (
        <button
          type="button"
          className="my-shop-card__install-btn"
          onClick={() => onInstallMachine(machineId)}
        >
          + Install {machineId}
        </button>
      )}
    </section>
  )
}

/**
 * Resolve the env that owns a given target-machine ID. Hard-coded against
 * the registry so TypeScript can narrow the return type. The pinning test
 * (`my-shop-presets.test.ts`) enforces that every preset's env matches
 * its machine — this helper mirrors that invariant for the card header.
 */
function envIdForMachine(machineId: MyShopMachineId): EnvironmentId {
  switch (machineId) {
    case 'laguna-swift-5x10':
      return 'vcarve_pro'
    case 'creality-k2-plus':
      return 'creality_print'
    case 'makera-carvera-4axis':
      return 'makera_cam'
  }
}

export function MyShopPanel({
  machines,
  currentMachineId,
  onLaunchPreset,
  onInstallMachine
}: MyShopPanelProps): React.ReactElement {
  return (
    <div className="my-shop-panel" role="region" aria-label="My Shop">
      <header className="my-shop-panel__header">
        <h2 className="my-shop-panel__title">My Shop</h2>
        <p className="my-shop-panel__sub">
          Your three machines and the workflows you run most.
        </p>
      </header>
      <div className="my-shop-panel__grid" role="list">
        {MY_SHOP_MACHINE_IDS.map((machineId) => {
          const machine = machines.find((m) => m.id === machineId) ?? null
          const isCurrent = currentMachineId !== null && currentMachineId === machineId
          const presets = getMyShopPresetsForMachine(machineId)
          return (
            <MyShopCard
              key={machineId}
              machineId={machineId}
              machine={machine}
              envId={envIdForMachine(machineId)}
              isCurrent={isCurrent}
              presets={presets}
              onLaunchPreset={onLaunchPreset}
              onInstallMachine={onInstallMachine}
            />
          )
        })}
      </div>
      <footer className="my-shop-panel__footer">
        <span className="my-shop-panel__preset-count">
          {MY_SHOP_PRESETS.length} real-world presets across {MY_SHOP_MACHINE_IDS.length} machines.
        </span>
      </footer>
    </div>
  )
}
