import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toolLibraryFileSchema, type ToolLibraryFile } from '../shared/tool-schema'

export function sanitizeMachineIdForToolLibrary(machineId: string): string {
  const s = machineId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase()
  if (!s) throw new Error('Machine id is required for tool library path.')
  return s
}

function toolLibrariesRoot(): string {
  return join(app.getPath('userData'), 'tool-libraries')
}

export function machineToolLibraryPath(machineId: string): string {
  const safe = sanitizeMachineIdForToolLibrary(machineId)
  return join(toolLibrariesRoot(), `${safe}.json`)
}

export async function loadMachineToolLibrary(machineId: string): Promise<ToolLibraryFile> {
  const p = machineToolLibraryPath(machineId)
  try {
    const raw = await readFile(p, 'utf-8')
    return toolLibraryFileSchema.parse(JSON.parse(raw) as unknown)
  } catch {
    const empty: ToolLibraryFile = { version: 1, tools: [] }
    return empty
  }
}

export async function saveMachineToolLibrary(machineId: string, lib: ToolLibraryFile): Promise<ToolLibraryFile> {
  const parsed = toolLibraryFileSchema.parse(lib)
  const dir = toolLibrariesRoot()
  await mkdir(dir, { recursive: true })
  const p = machineToolLibraryPath(machineId)
  await writeFile(p, JSON.stringify(parsed, null, 2), 'utf-8')
  return parsed
}
