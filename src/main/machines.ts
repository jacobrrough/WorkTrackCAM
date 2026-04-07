import { app } from 'electron'
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import JSON5 from 'json5'
import { parse as parseToml } from 'smol-toml'
import { parse as parseYaml } from 'yaml'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import { machineProfileFromCpsContent } from './machine-cps-import'
import { getResourcesRoot } from './paths'

export type MachineCatalogDiagnostic = {
  source: 'bundled' | 'user'
  file: string
  error: string
}

export type MachineCatalog = {
  machines: MachineProfile[]
  diagnostics: MachineCatalogDiagnostic[]
}

function stripBom(text: string): string {
  if (text.charCodeAt(0) === 0xfeff) return text.slice(1)
  return text
}

function ensureObject(data: unknown, label: string): Record<string, unknown> {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${label} must parse to a single object (not an array or scalar).`)
  }
  return data as Record<string, unknown>
}

/**
 * Parse a machine profile from JSON, JSON5/JSONC, YAML, or TOML text.
 * File extension hints which parser to use; otherwise JSON, then JSON5, then YAML, then TOML.
 * For TOML, list root keys (`id`, `maxFeedMmMin`, …) before a `[workAreaMm]` table, or use an inline table for `workAreaMm`.
 */
export function parseMachineProfileText(text: string, hintFileName = 'profile'): MachineProfile {
  const t = stripBom(text).trim()
  if (!t) throw new Error('Machine profile is empty.')

  const lower = hintFileName.toLowerCase()
  const isYaml = lower.endsWith('.yml') || lower.endsWith('.yaml')
  const isToml = lower.endsWith('.toml')
  const isJson5Ext = lower.endsWith('.jsonc') || lower.endsWith('.json5')
  const isJsonStrict = lower.endsWith('.json')

  if (isYaml) {
    const data = ensureObject(parseYaml(t), 'YAML')
    return machineProfileSchema.parse(data)
  }
  if (isToml) {
    const data = ensureObject(parseToml(t), 'TOML')
    return machineProfileSchema.parse(data)
  }
  if (isJson5Ext) {
    const data = ensureObject(JSON5.parse(t), 'JSON5')
    return machineProfileSchema.parse(data)
  }
  if (isJsonStrict) {
    const data = JSON.parse(t) as unknown
    return machineProfileSchema.parse(data)
  }

  const errs: string[] = []
  try {
    const data = JSON.parse(t) as unknown
    return machineProfileSchema.parse(data)
  } catch (e) {
    errs.push(`JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    const data = ensureObject(JSON5.parse(t), 'JSON5')
    return machineProfileSchema.parse(data)
  } catch (e) {
    errs.push(`JSON5: ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    const data = ensureObject(parseYaml(t), 'YAML')
    return machineProfileSchema.parse(data)
  } catch (e) {
    errs.push(`YAML: ${e instanceof Error ? e.message : String(e)}`)
  }
  try {
    const data = ensureObject(parseToml(t), 'TOML')
    return machineProfileSchema.parse(data)
  } catch (e) {
    errs.push(`TOML: ${e instanceof Error ? e.message : String(e)}`)
  }
  throw new Error(`Could not parse machine profile. ${errs.join('; ')}`)
}

export async function importMachineProfileFromFile(filePath: string): Promise<MachineProfile> {
  const fileName = basename(filePath)
  const raw = await readFile(filePath, 'utf-8')
  if (fileName.toLowerCase().endsWith('.cps')) {
    return saveUserMachine(machineProfileFromCpsContent(fileName, raw))
  }
  const parsed = parseMachineProfileText(raw, fileName)
  return saveUserMachine(parsed)
}

function userMachinesDir(): string {
  return join(app.getPath('userData'), 'machines')
}

async function readMachineDir(dir: string, source: 'bundled' | 'user'): Promise<MachineCatalog> {
  const diagnostics: MachineCatalogDiagnostic[] = []
  const out: MachineProfile[] = []
  let names: string[] = []
  try {
    names = await readdir(dir)
  } catch (e) {
    diagnostics.push({ source, file: dir, error: e instanceof Error ? e.message : String(e) })
    return { machines: out, diagnostics }
  }
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    try {
      const raw = await readFile(join(dir, n), 'utf-8')
      const data = JSON.parse(raw) as unknown
      const parsed = machineProfileSchema.parse(data)
      out.push({
        ...parsed,
        meta: { ...(parsed.meta ?? {}), source }
      })
    } catch (e) {
      diagnostics.push({ source, file: n, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return { machines: out, diagnostics }
}

export async function loadMachineCatalog(): Promise<MachineCatalog> {
  const bundledDir = join(getResourcesRoot(), 'machines')
  const userDir = userMachinesDir()
  await mkdir(userDir, { recursive: true })
  const [bundled, user] = await Promise.all([readMachineDir(bundledDir, 'bundled'), readMachineDir(userDir, 'user')])
  const dedup = new Map<string, MachineProfile>()
  for (const m of bundled.machines) dedup.set(m.id, m)
  for (const m of user.machines) dedup.set(m.id, m)
  return {
    machines: [...dedup.values()].sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics: [...bundled.diagnostics, ...user.diagnostics]
  }
}

export async function loadAllMachines(): Promise<MachineProfile[]> {
  const c = await loadMachineCatalog()
  return c.machines
}

export async function getMachineById(id: string): Promise<MachineProfile | null> {
  const all = await loadAllMachines()
  return all.find((m) => m.id === id) ?? null
}

export async function saveUserMachine(profile: MachineProfile): Promise<MachineProfile> {
  const parsed = machineProfileSchema.parse(profile)
  const userDir = userMachinesDir()
  await mkdir(userDir, { recursive: true })
  const safeName = `${parsed.id.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase()}.json`
  const next: MachineProfile = {
    ...parsed,
    meta: { ...(parsed.meta ?? {}), source: 'user' }
  }
  await writeFile(join(userDir, safeName), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export async function deleteUserMachine(machineId: string): Promise<boolean> {
  const userDir = userMachinesDir()
  const names = await readdir(userDir).catch(() => [])
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    try {
      const raw = await readFile(join(userDir, n), 'utf-8')
      const parsed = machineProfileSchema.parse(JSON.parse(raw) as unknown)
      if (parsed.id === machineId) {
        await unlink(join(userDir, n))
        return true
      }
    } catch {
      // ignore malformed entries while scanning for target id
    }
  }
  return false
}
