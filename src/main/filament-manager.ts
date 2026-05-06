import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { filamentLibrarySchema, type FilamentRecord } from '../shared/filament-schema'
import { getResourcesRoot } from './paths'

function getBundledFilamentsPath(): string {
  return join(getResourcesRoot(), 'materials', 'default-filaments.json')
}

function getUserFilamentsDir(): string {
  return join(app.getPath('userData'), 'materials')
}

function getUserFilamentsPath(): string {
  return join(getUserFilamentsDir(), 'user-filaments.json')
}

async function readBundledFilaments(): Promise<FilamentRecord[]> {
  try {
    const raw = await readFile(getBundledFilamentsPath(), 'utf-8')
    const lib = filamentLibrarySchema.parse(JSON.parse(raw))
    return lib.filaments.map(f => ({ ...f, source: 'bundled' as const }))
  } catch {
    return []
  }
}

async function readUserFilaments(): Promise<FilamentRecord[]> {
  const p = getUserFilamentsPath()
  if (!existsSync(p)) return []
  try {
    const raw = await readFile(p, 'utf-8')
    const lib = filamentLibrarySchema.parse(JSON.parse(raw))
    return lib.filaments.map(f => ({ ...f, source: 'user' as const }))
  } catch {
    return []
  }
}

async function writeUserFilaments(filaments: FilamentRecord[]): Promise<void> {
  await mkdir(getUserFilamentsDir(), { recursive: true })
  await writeFile(getUserFilamentsPath(), JSON.stringify({ version: 1, filaments }, null, 2), 'utf-8')
}

export async function listAllFilaments(): Promise<FilamentRecord[]> {
  const [bundled, user] = await Promise.all([readBundledFilaments(), readUserFilaments()])
  const map = new Map<string, FilamentRecord>()
  for (const f of bundled) map.set(f.id, f)
  for (const f of user) map.set(f.id, { ...f, source: 'user' })
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveFilament(record: FilamentRecord): Promise<FilamentRecord> {
  const existing = await readUserFilaments()
  const idx = existing.findIndex(f => f.id === record.id)
  const updated = { ...record, source: 'user' as const }
  if (idx >= 0) existing[idx] = updated
  else existing.push(updated)
  await writeUserFilaments(existing)
  return updated
}

export async function deleteFilament(id: string): Promise<boolean> {
  const existing = await readUserFilaments()
  const next = existing.filter(f => f.id !== id)
  if (next.length === existing.length) return false
  await writeUserFilaments(next)
  return true
}
