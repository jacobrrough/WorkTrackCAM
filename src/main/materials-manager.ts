/**
 * Material library manager.
 *
 * Bundled materials: `resources/materials/default-materials.json`
 * User materials: `{userData}/materials/user-materials.json`
 * User records override bundled ones with the same id.
 */
import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { materialLibrarySchema, type MaterialRecord } from '../shared/material-schema'
import { getResourcesRoot } from './paths'

function getBundledMaterialsPath(): string {
  return join(getResourcesRoot(), 'materials', 'default-materials.json')
}

function getUserMaterialsDir(): string {
  return join(app.getPath('userData'), 'materials')
}

function getUserMaterialsPath(): string {
  return join(getUserMaterialsDir(), 'user-materials.json')
}

async function readBundledMaterials(): Promise<MaterialRecord[]> {
  try {
    const raw = await readFile(getBundledMaterialsPath(), 'utf-8')
    const lib = materialLibrarySchema.parse(JSON.parse(raw))
    return lib.materials.map(m => ({ ...m, source: 'bundled' as const }))
  } catch {
    return []
  }
}

async function readUserMaterials(): Promise<MaterialRecord[]> {
  const p = getUserMaterialsPath()
  if (!existsSync(p)) return []
  try {
    const raw = await readFile(p, 'utf-8')
    const lib = materialLibrarySchema.parse(JSON.parse(raw))
    return lib.materials.map(m => ({ ...m, source: 'user' as const }))
  } catch {
    return []
  }
}

async function writeUserMaterials(materials: MaterialRecord[]): Promise<void> {
  await mkdir(getUserMaterialsDir(), { recursive: true })
  await writeFile(getUserMaterialsPath(), JSON.stringify({ version: 1, materials }, null, 2), 'utf-8')
}

/** List all materials (user overrides bundled on same id). */
export async function listAllMaterials(): Promise<MaterialRecord[]> {
  const [bundled, user] = await Promise.all([readBundledMaterials(), readUserMaterials()])
  const map = new Map<string, MaterialRecord>()
  for (const m of bundled) map.set(m.id, m)
  for (const m of user) map.set(m.id, { ...m, source: 'user' })
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Save or update a user material record. */
export async function saveMaterial(record: MaterialRecord): Promise<MaterialRecord> {
  const existing = await readUserMaterials()
  const idx = existing.findIndex(m => m.id === record.id)
  const updated = { ...record, source: 'user' as const }
  if (idx >= 0) existing[idx] = updated
  else existing.push(updated)
  await writeUserMaterials(existing)
  return updated
}

/** Delete a user material by id. Cannot delete bundled materials. */
export async function deleteMaterial(id: string): Promise<boolean> {
  const existing = await readUserMaterials()
  const next = existing.filter(m => m.id !== id)
  if (next.length === existing.length) return false
  await writeUserMaterials(next)
  return true
}

/** Import a full materials JSON file, merging into user library. */
export async function importMaterialsJson(jsonText: string): Promise<MaterialRecord[]> {
  const lib = materialLibrarySchema.parse(JSON.parse(jsonText))
  const existing = await readUserMaterials()
  const map = new Map<string, MaterialRecord>()
  for (const m of existing) map.set(m.id, m)
  for (const m of lib.materials) map.set(m.id, { ...m, source: 'user' as const })
  const merged = Array.from(map.values())
  await writeUserMaterials(merged)
  return merged
}

/** Import materials from a file path. */
export async function importMaterialsFile(filePath: string): Promise<MaterialRecord[]> {
  const text = await readFile(filePath, 'utf-8')
  return importMaterialsJson(text)
}
