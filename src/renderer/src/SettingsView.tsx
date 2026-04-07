/**
 * SettingsView -- Settings/preferences view for engine paths.
 * Extracted from ShopApp.tsx (pure refactoring).
 */
import React, { useState, useEffect } from 'react'
import type { Toast } from './shop-types'
import { fab } from './shop-types'

export interface SettingsViewProps {
  onToast: (k: Toast['kind'], m: string) => void
}

export function SettingsView({ onToast }: SettingsViewProps): React.ReactElement {
  const [settings, setSettings] = useState<Record<string, unknown>>({})
  useEffect(() => { fab().settingsGet().then(setSettings).catch(e => { console.error(e); onToast('err', 'Failed to load settings') }) }, [])
  return (
    <div className="settings-view">
      <h2 className="settings-view__title">Settings</h2>
      <div className="card">
        <div className="card-header"><span className="card-title">Engine Paths</span></div>
        <div className="card-body section-gap">
          {[
            { key: 'pythonPath', label: 'Python Executable', placeholder: 'python3' },
            { key: 'curaEnginePath', label: 'CuraEngine Path', placeholder: '/usr/bin/CuraEngine' }
          ].map(({ key, label, placeholder }) => (
            <div className="form-group" key={key}><label>{label}</label>
              <div className="input-row">
                <input placeholder={placeholder} value={String(settings[key] ?? '')}
                  onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))} />
                <button className="btn btn-ghost btn-sm" onClick={async () => {
                  const p = await fab().dialogOpenFile([{ name: 'Executable', extensions: ['*'] }])
                  if (p) setSettings(s => ({ ...s, [key]: p }))
                }}>Browse{'\u2026'}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="settings-view__save-row">
        <button className="btn btn-generate" onClick={async () => {
          await fab().settingsSet(settings); onToast('ok', 'Settings saved')
        }}>Save Settings</button>
      </div>
    </div>
  )
}
