/**
 * IPC contract: preload is the source of truth for which channels the renderer uses.
 * Every `ipcRenderer.invoke('…')` in `src/preload/index.ts` must have exactly one
 * matching `ipcMain.handle('…')` in a non-test file under `src/main/` (recursive).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Channels used by preload `ipcRenderer.invoke(...)`. */
function extractPreloadInvokeChannels(src: string): Set<string> {
  const set = new Set<string>()
  const re = /ipcRenderer\.invoke\s*\(\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    set.add(m[1]!)
  }
  return set
}

/** All `ipcMain.handle('channel', …)` channel names in a source file. */
function extractMainHandleChannels(src: string): string[] {
  const list: string[] = []
  const re = /ipcMain\.handle\s*\(\s*[\s\n\r]*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    list.push(m[1]!)
  }
  return list
}

/** Non-test `.ts` files under `src/main` (recursive). */
function listMainProductionTsFiles(mainDir: string): string[] {
  const out: string[] = []
  for (const ent of readdirSync(mainDir, { withFileTypes: true })) {
    const p = join(mainDir, ent.name)
    if (ent.isDirectory()) {
      out.push(...listMainProductionTsFiles(p))
    } else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.test.ts')) {
      out.push(p)
    }
  }
  return out
}

describe('IPC contract (preload → main)', () => {
  it('every preload invoke has a matching ipcMain.handle channel', () => {
    const root = process.cwd()
    const preloadSrc = readFileSync(join(root, 'src/preload/index.ts'), 'utf-8')
    const mainDir = join(root, 'src/main')
    const fromPreload = extractPreloadInvokeChannels(preloadSrc)
    const fromMain = new Set<string>()
    for (const filePath of listMainProductionTsFiles(mainDir)) {
      const src = readFileSync(filePath, 'utf-8')
      for (const ch of extractMainHandleChannels(src)) {
        fromMain.add(ch)
      }
    }
    const missing = [...fromPreload].filter((ch) => !fromMain.has(ch))
    expect(missing, `Missing ipcMain.handle for: ${missing.join(', ')}`).toEqual([])
  })

  it('no duplicate ipcMain.handle channel names across src/main', () => {
    const root = process.cwd()
    const mainDir = join(root, 'src/main')
    const channelToFiles = new Map<string, string[]>()
    for (const filePath of listMainProductionTsFiles(mainDir)) {
      const src = readFileSync(filePath, 'utf-8')
      const rel = filePath.slice(root.length + 1).replace(/\\/g, '/')
      for (const ch of extractMainHandleChannels(src)) {
        const arr = channelToFiles.get(ch) ?? []
        arr.push(rel)
        channelToFiles.set(ch, arr)
      }
    }
    const duplicates = [...channelToFiles.entries()].filter(([, files]) => files.length > 1)
    expect(
      duplicates,
      duplicates.length
        ? `Duplicate ipcMain.handle channels: ${duplicates.map(([c, f]) => `${c} → ${f.join(', ')}`).join('; ')}`
        : ''
    ).toEqual([])
  })
})
