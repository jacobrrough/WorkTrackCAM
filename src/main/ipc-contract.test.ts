/**
 * IPC contract: preload is the source of truth for which channels the renderer uses.
 * Every `ipcRenderer.invoke('…')` in `src/preload/index.ts` must have exactly one
 * matching `ipcMain.handle('…')` in a non-test file under `src/main/` (recursive).
 *
 * Perf history:
 *   [ID-0181] -- Cycle 94 (perf): hoisted the recursive `listMainProductionTsFiles
 *   + readFileSync + extractMainHandleChannels` sweep AND the `src/preload/index.ts`
 *   invoke-channel extraction into a single module-level `beforeAll`. Pre-hoist the
 *   two tests each ran the full sweep independently, costing a 3-run-median 104.7 ms /
 *   2 tests / ~52 ms-per-test (top-10 src/main perf hotspot in the cycle 94 inventory).
 *   The cached `cachedMainHandles: MainFileSnapshot[]` preserves the original
 *   `(filePath, rel, channels[])` shape both tests need; the cached
 *   `cachedPreloadInvokeChannels: Set<string>` replaces the per-test preload read.
 *   Same pattern as Cycle 86 [ID-0169] (carvera-pipeline.test.ts machine profile
 *   read+parse hoist).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

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

interface MainFileSnapshot {
  filePath: string
  /** Forward-slashed path relative to project root, used in diagnostic messages. */
  rel: string
  channels: string[]
}

// Module-level perf caches; populated once in `beforeAll` per [ID-0181].
let cachedPreloadInvokeChannels!: Set<string>
let cachedMainHandles!: readonly MainFileSnapshot[]

beforeAll(() => {
  const root = process.cwd()
  const preloadSrc = readFileSync(join(root, 'src/preload/index.ts'), 'utf-8')
  cachedPreloadInvokeChannels = extractPreloadInvokeChannels(preloadSrc)

  const mainDir = join(root, 'src/main')
  const snapshots: MainFileSnapshot[] = []
  for (const filePath of listMainProductionTsFiles(mainDir)) {
    const src = readFileSync(filePath, 'utf-8')
    snapshots.push({
      filePath,
      rel: filePath.slice(root.length + 1).replace(/\\/g, '/'),
      channels: extractMainHandleChannels(src)
    })
  }
  cachedMainHandles = snapshots
})

describe('IPC contract (preload → main)', () => {
  it('every preload invoke has a matching ipcMain.handle channel', () => {
    const fromMain = new Set<string>()
    for (const snap of cachedMainHandles) {
      for (const ch of snap.channels) fromMain.add(ch)
    }
    const missing = [...cachedPreloadInvokeChannels].filter((ch) => !fromMain.has(ch))
    expect(missing, `Missing ipcMain.handle for: ${missing.join(', ')}`).toEqual([])
  })

  it('no duplicate ipcMain.handle channel names across src/main', () => {
    const channelToFiles = new Map<string, string[]>()
    for (const snap of cachedMainHandles) {
      for (const ch of snap.channels) {
        const arr = channelToFiles.get(ch) ?? []
        arr.push(snap.rel)
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
