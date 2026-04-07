import { app } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Root containing `resources/` (machines, posts, slicer defs). */
export function getResourcesRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources')
  }
  return join(app.getAppPath(), 'resources')
}

export function getEnginesRoot(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'engines')
  }
  return join(app.getAppPath(), 'engines')
}

/** Directory of this main bundle (for resolving relative test fixtures). */
export function getMainDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}
