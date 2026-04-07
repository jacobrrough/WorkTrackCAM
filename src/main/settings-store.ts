import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appSettingsSchema, type AppSettings } from '../shared/project-schema'

const defaults: AppSettings = {
  theme: 'dark',
  recentProjectPaths: []
}

export async function loadSettings(): Promise<AppSettings> {
  const p = join(app.getPath('userData'), 'settings.json')
  try {
    const raw = await readFile(p, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    const patch =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    return appSettingsSchema.parse({ ...defaults, ...patch })
  } catch {
    return defaults
  }
}

export async function saveSettings(s: AppSettings): Promise<void> {
  const p = join(app.getPath('userData'), 'settings.json')
  const merged = appSettingsSchema.parse({ ...defaults, ...s })
  await writeFile(p, JSON.stringify(merged, null, 2), 'utf-8')
}
