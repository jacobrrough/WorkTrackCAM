import type { ToolLibraryFile } from './tool-schema'

/**
 * Machine-scoped tools first; project tools fill in without duplicating `id`.
 */
export function mergeMachineFirstProjectTools(
  machineLib: ToolLibraryFile,
  projectLib: ToolLibraryFile
): ToolLibraryFile {
  const ids = new Set(machineLib.tools.map((t) => t.id))
  const extra = projectLib.tools.filter((t) => !ids.has(t.id))
  return { version: 1, tools: [...machineLib.tools, ...extra] }
}
