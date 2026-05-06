import React from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import type { MachineUIMode, Job } from './shop-types'
import { MODE_ICONS } from './shop-types'
import { ENVIRONMENT_LIST, type EnvironmentId } from './environments/registry'
import type { ShopEnvironment } from './environments/registry'

interface AppHeaderProps {
  sessionMachine: MachineProfile | null
  activeEnv: ShopEnvironment | null
  mode: MachineUIMode
  activeJob: Job | null
  running: boolean
  isFdm: boolean
  savedIndicator: boolean

  onSwitchEnv: (envId: EnvironmentId) => void
  onChangeMachine: () => void
  onCmdOpen: () => void
  onShortcuts: () => void
  onHelp: () => void
  onGenerate: () => void
  onSendToPrinter: () => void
  onGcodeView: () => void
  onGcodeExport: () => void
  onGcodeOpenFile: () => void
  onImportModel: () => void
  onNewProject: () => void
  onOpenProject: () => void
  onSaveProject: () => void
  onSetupSheet: () => void
}

export function AppHeader({
  sessionMachine, activeEnv, mode, activeJob, running, isFdm, savedIndicator,
  onSwitchEnv, onChangeMachine, onCmdOpen, onShortcuts, onHelp,
  onGenerate, onSendToPrinter, onGcodeView, onGcodeExport, onGcodeOpenFile,
  onImportModel, onNewProject, onOpenProject, onSaveProject, onSetupSheet
}: AppHeaderProps): React.ReactElement {
  return (
    <header className="cc-header" role="banner">
      {/* Left: Brand + machine selector */}
      <div className="cc-header__left">
        <span className="cc-header__logo" aria-hidden="true">
          {activeEnv?.iconGlyph ?? '◆'}
        </span>
        <span className="cc-header__brand">WorkTrackCAM</span>
        <button
          type="button"
          className="cc-header__machine-btn"
          onClick={onChangeMachine}
          title={sessionMachine ? `${sessionMachine.name} — click to change` : 'Select machine'}
        >
          <span className="cc-header__machine-icon" aria-hidden="true">{MODE_ICONS[mode]}</span>
          <span className="cc-header__machine-name">
            {sessionMachine?.name ?? 'No machine'}
          </span>
          <span className="cc-header__machine-chevron" aria-hidden="true">▾</span>
        </button>
      </div>

      {/* Center: Env quick-switch */}
      <div className="cc-header__center">
        <div className="cc-header__env-switch" role="group" aria-label="Environment quick-switch">
          {ENVIRONMENT_LIST.map(env => {
            const isActive = activeEnv?.id === env.id
            return (
              <button
                key={env.id}
                type="button"
                data-environment={env.id}
                className={`cc-header__env-btn${isActive ? ' cc-header__env-btn--active' : ''}`}
                aria-pressed={isActive}
                title={`Switch to ${env.name}`}
                onClick={() => onSwitchEnv(env.id)}
              >
                <span aria-hidden="true">{env.iconGlyph}</span>
                <span>{env.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="cc-header__right">
        {/* Generate / Slice */}
        <button
          type="button"
          className="cc-header__generate-btn"
          disabled={running || !activeJob}
          onClick={onGenerate}
          title={isFdm ? 'Slice (Ctrl+Enter)' : 'Generate G-code (Ctrl+Enter)'}
        >
          {running
            ? <><span className="spinner spinner--sm" /> Running{'…'}</>
            : isFdm ? '▶ Slice' : '▶ Generate'}
        </button>

        {/* Send */}
        {isFdm && (
          <button
            type="button"
            className="cc-header__action-btn"
            disabled={!activeJob?.gcodeOut}
            onClick={onSendToPrinter}
            title="Send G-code to printer via Moonraker"
          >
            {'→'} Send
          </button>
        )}

        {/* G-code actions */}
        {activeJob?.gcodeOut && (
          <div className="cc-header__gcode-group">
            <button type="button" className="cc-header__sm-btn" onClick={onGcodeView} title="View G-code">
              G-code
            </button>
            <button type="button" className="cc-header__sm-btn" onClick={onGcodeExport} title="Export G-code copy">
              Export{'…'}
            </button>
            <button type="button" className="cc-header__sm-btn" onClick={onGcodeOpenFile} title="Open in default app">
              Open
            </button>
          </div>
        )}

        <span className="cc-header__sep" />

        {/* File actions */}
        <button type="button" className="cc-header__icon-btn" onClick={onImportModel} disabled={!activeJob} title="Import model" aria-label="Import model">
          {'\u{1F4E5}'}
        </button>
        {!isFdm && activeJob && (
          <button type="button" className="cc-header__icon-btn" onClick={onSetupSheet} title="Setup sheet" aria-label="Setup sheet">
            {'\u{1F4CB}'}
          </button>
        )}
        <button type="button" className="cc-header__icon-btn" onClick={onNewProject} title="New project (Ctrl+N)" aria-label="New project">
          {'\u{1F4C4}'}
        </button>
        <button type="button" className="cc-header__icon-btn" onClick={onOpenProject} title="Open project (Ctrl+O)" aria-label="Open project">
          {'\u{1F4C2}'}
        </button>
        <button
          type="button"
          className={`cc-header__icon-btn${savedIndicator ? ' cc-header__icon-btn--saved' : ''}`}
          onClick={onSaveProject}
          title="Save (Ctrl+S)"
          aria-label="Save"
        >
          {savedIndicator ? '✓' : '\u{1F4BE}'}
        </button>

        <span className="cc-header__sep" />

        <button type="button" className="cc-header__icon-btn" onClick={onCmdOpen} title="Command palette (Ctrl+K)" aria-label="Command palette">
          {'⌘'}
        </button>
        <button type="button" className="cc-header__icon-btn" onClick={onShortcuts} title="Shortcuts (Ctrl+Shift+?)" aria-label="Keyboard shortcuts">
          ?
        </button>
      </div>
    </header>
  )
}
