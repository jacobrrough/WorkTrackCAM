/**
 * Bridge test for the `moonrakerPreview` preload function added by
 * Cycle 50 ui-polish [ID-0072-followup]. Validates two contract pins:
 *
 *   1. The bridge round-trips a non-empty `GcodeTempSample[]` payload
 *      through `ipcRenderer.invoke('moonraker:preview', ...)`.
 *   2. An absent / empty payload short-circuits in the renderer
 *      WITHOUT invoking the IPC channel -- preserving the
 *      "no banner = no telemetry noise" invariant from the daily plan.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { GcodeTempSample } from '../../shared/gcode-temp-validator'

// Mock `electron` BEFORE importing the preload. `contextBridge.
// exposeInMainWorld` writes the api onto the captured target so we
// can introspect it from the test body.
const exposed = new Map<string, unknown>()
const ipcInvoke = vi.fn(async (..._args: unknown[]) => ({ ok: true }))

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
  moonrakerPreview: (
    samples: readonly GcodeTempSample[]
  ) => Promise<{ ok: true } | { ok: false; reason: string }>
}

const fab = exposed.get('fab') as FabApi
const noz = (targetC: number): GcodeTempSample => ({
  lineNumber: 1,
  command: 'M104',
  kind: 'nozzle',
  targetC,
  raw: `M104 S${targetC}`
})

describe('preload moonrakerPreview bridge -- [ID-0072-followup]', () => {
  beforeEach(() => {
    ipcInvoke.mockClear()
  })

  it('round-trips a 3-sample payload through ipcRenderer.invoke("moonraker:preview", ...)', async () => {
    ipcInvoke.mockResolvedValueOnce({ ok: true })
    const samples: readonly GcodeTempSample[] = [noz(240), noz(245), noz(250)]
    const result = await fab.moonrakerPreview(samples)

    expect(result).toEqual({ ok: true })
    expect(ipcInvoke).toHaveBeenCalledTimes(1)
    expect(ipcInvoke).toHaveBeenCalledWith('moonraker:preview', samples)
  })

  it('short-circuits an empty samples payload without invoking ipcRenderer.invoke', async () => {
    const result = await fab.moonrakerPreview([])

    expect(result).toEqual({ ok: false, reason: 'no-samples' })
    expect(ipcInvoke).not.toHaveBeenCalled()
  })
})
