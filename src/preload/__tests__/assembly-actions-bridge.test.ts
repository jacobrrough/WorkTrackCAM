/**
 * Bridge test for the assembly IPC actions wired this cycle: the six
 * `assembly*` preload methods that expose the previously-stranded
 * `assembly:interferenceCheck` / `assembly:interferenceCheckSimulated` /
 * `assembly:exportBom` / `assembly:exportBomHierarchical` /
 * `assembly:exportBomHierarchyJson` / `assembly:summary` handlers.
 *
 * Each pin proves the preload method round-trips its argument(s) through
 * `ipcRenderer.invoke(<channel>, ...)` on the correct channel — the contract
 * the renderer's AssemblyView controls rely on. Mirrors the existing
 * `moonraker-preview-bridge.test.ts` shim convention: `contextBridge.
 * exposeInMainWorld` captures the api onto `exposed` so we can introspect it.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'

const exposed = new Map<string, unknown>()
const ipcInvoke = vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve({ ok: true }))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((key: string, value: unknown) => {
      exposed.set(key, value)
    })
  },
  ipcRenderer: {
    invoke: (...args: unknown[]) => ipcInvoke(...args)
  }
}))

// Import for side-effects (registers the api on `exposed`).
await import('../index')

type FabApi = {
  assemblyInterferenceCheck: (projectDir: string) => Promise<unknown>
  assemblyInterferenceCheckSimulated: (projectDir: string, assemblyInput: unknown) => Promise<unknown>
  assemblyExportBom: (projectDir: string) => Promise<string>
  assemblyExportBomHierarchical: (projectDir: string) => Promise<string>
  assemblyExportBomHierarchyJson: (projectDir: string) => Promise<string>
  assemblySummary: (projectDir: string) => Promise<unknown>
}

const fab = exposed.get('fab') as FabApi

describe('preload assembly-action bridges', () => {
  beforeEach(() => {
    ipcInvoke.mockClear()
  })

  it('exposes all six assembly-action methods', () => {
    expect(typeof fab.assemblyInterferenceCheck).toBe('function')
    expect(typeof fab.assemblyInterferenceCheckSimulated).toBe('function')
    expect(typeof fab.assemblyExportBom).toBe('function')
    expect(typeof fab.assemblyExportBomHierarchical).toBe('function')
    expect(typeof fab.assemblyExportBomHierarchyJson).toBe('function')
    expect(typeof fab.assemblySummary).toBe('function')
  })

  it('assemblyInterferenceCheck invokes assembly:interferenceCheck with the project dir', async () => {
    ipcInvoke.mockResolvedValueOnce({ ok: true, message: 'm', conflictingPairs: [] })
    await fab.assemblyInterferenceCheck('C:/proj')
    expect(ipcInvoke).toHaveBeenCalledTimes(1)
    expect(ipcInvoke).toHaveBeenCalledWith('assembly:interferenceCheck', 'C:/proj')
  })

  it('assemblyInterferenceCheckSimulated invokes the simulated channel with dir + assembly input', async () => {
    ipcInvoke.mockResolvedValueOnce({ ok: true, message: 'm', conflictingPairs: [] })
    const input = { version: 2, name: '', components: [] }
    await fab.assemblyInterferenceCheckSimulated('C:/proj', input)
    expect(ipcInvoke).toHaveBeenCalledTimes(1)
    expect(ipcInvoke).toHaveBeenCalledWith('assembly:interferenceCheckSimulated', 'C:/proj', input)
  })

  it('assemblyExportBom invokes assembly:exportBom and returns the path', async () => {
    ipcInvoke.mockResolvedValueOnce('C:/proj/output/bom.csv')
    const out = await fab.assemblyExportBom('C:/proj')
    expect(out).toBe('C:/proj/output/bom.csv')
    expect(ipcInvoke).toHaveBeenCalledWith('assembly:exportBom', 'C:/proj')
  })

  it('assemblyExportBomHierarchical invokes assembly:exportBomHierarchical', async () => {
    ipcInvoke.mockResolvedValueOnce('C:/proj/output/bom-hierarchical.txt')
    await fab.assemblyExportBomHierarchical('C:/proj')
    expect(ipcInvoke).toHaveBeenCalledWith('assembly:exportBomHierarchical', 'C:/proj')
  })

  it('assemblyExportBomHierarchyJson invokes assembly:exportBomHierarchyJson', async () => {
    ipcInvoke.mockResolvedValueOnce('C:/proj/output/bom-hierarchy.json')
    await fab.assemblyExportBomHierarchyJson('C:/proj')
    expect(ipcInvoke).toHaveBeenCalledWith('assembly:exportBomHierarchyJson', 'C:/proj')
  })

  it('assemblySummary invokes assembly:summary with the project dir', async () => {
    ipcInvoke.mockResolvedValueOnce({ name: 'a', componentCount: 0, activeComponentCount: 0 })
    await fab.assemblySummary('C:/proj')
    expect(ipcInvoke).toHaveBeenCalledWith('assembly:summary', 'C:/proj')
  })
})
