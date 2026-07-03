/**
 * [P2-K2-PUSH]/Cycle 358 + [P2-CARVERA-PUSH-MOCK]/Cycle 360 -- IPC
 * progress-forwarding coverage.
 *
 * Proves that the `moonraker:push` and `carvera:upload` IPC handlers each
 * inject an `onProgress` shim that forwards ticks to the invoking
 * renderer's WebContents over a NEW event channel:
 *
 *   moonraker:push   -> 'moonraker:push:progress'   { sentBytes, totalBytes, percent }
 *   carvera:upload   -> 'carvera:upload:progress'   { phase }
 *
 * The underlying push helpers are mocked so their `onProgress` callback can
 * be driven synthetically; the assertion is purely that the handler wired
 * the shim onto the call AND that the shim calls `sender.send` on the right
 * channel with the right payload shape. A destroyed sender must NOT be sent
 * to (guards against a window closed mid-upload).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, Function>()

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/mock/app'),
    getPath: vi.fn().mockReturnValue('/mock/userData')
  },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler)
    })
  }
}))

// moonrakerPush mock invokes payload.onProgress a few times, then resolves.
const moonrakerPushMock = vi.fn(async (payload: { onProgress?: (s: number, t: number) => void }) => {
  payload.onProgress?.(0, 200)
  payload.onProgress?.(100, 200)
  payload.onProgress?.(200, 200)
  return { ok: true as const, filename: 'x.gcode', uploadedPath: 'x.gcode', printStarted: false, printerUrl: 'http://k2' }
})

vi.mock('./moonraker-push', () => ({
  moonrakerCancel: vi.fn(),
  moonrakerPause: vi.fn(),
  moonrakerPush: (payload: { onProgress?: (s: number, t: number) => void }) => moonrakerPushMock(payload),
  moonrakerResume: vi.fn(),
  moonrakerStatus: vi.fn()
}))

vi.mock('./moonraker-info', () => ({ moonrakerInfo: vi.fn() }))

// carveraUpload mock invokes payload.onProgress with each phase, then resolves.
const carveraUploadMock = vi.fn(
  async (_settings: unknown, payload: { onProgress?: (phase: string) => void }) => {
    payload.onProgress?.('connecting')
    payload.onProgress?.('transferring')
    payload.onProgress?.('verifying')
    return { ok: true as const, stdout: 'Upload complete.', stderr: '' }
  }
)

vi.mock('./carvera-cli-run', () => ({
  carveraUpload: (settings: unknown, payload: { onProgress?: (phase: string) => void }) =>
    carveraUploadMock(settings, payload)
}))

vi.mock('./settings-store', () => ({
  loadSettings: vi.fn().mockResolvedValue({ theme: 'dark', recentProjectPaths: [] })
}))

vi.mock('./machines', () => ({
  deleteUserMachine: vi.fn(),
  getMachineById: vi.fn(),
  importMachineProfileFromFile: vi.fn(),
  loadAllMachines: vi.fn().mockResolvedValue([]),
  loadMachineCatalog: vi.fn().mockResolvedValue({ machines: [], diagnostics: [] }),
  parseMachineProfileText: vi.fn(),
  saveUserMachine: vi.fn()
}))

import { registerFabricationIpc } from './ipc-fabrication'
import type { MainIpcWindowContext } from './ipc-context'

function createMockContext(): MainIpcWindowContext {
  return { getMainWindow: () => null }
}

type SenderSpy = {
  send: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
}

function makeEvent(destroyed = false): { sender: SenderSpy } {
  return {
    sender: {
      send: vi.fn(),
      isDestroyed: () => destroyed
    }
  }
}

describe('ipc-fabrication progress forwarding', () => {
  beforeEach(() => {
    handlers.clear()
    moonrakerPushMock.mockClear()
    carveraUploadMock.mockClear()
    registerFabricationIpc(createMockContext())
  })

  describe("moonraker:push -> 'moonraker:push:progress'", () => {
    it('forwards each onProgress tick with { sentBytes, totalBytes, percent }', async () => {
      const handler = handlers.get('moonraker:push')!
      const event = makeEvent()
      await handler(event, { gcodePath: '/tmp/x.gcode', printerUrl: 'http://k2' })

      // moonrakerPush received an onProgress shim.
      const passed = moonrakerPushMock.mock.calls[0]![0]
      expect(typeof passed.onProgress).toBe('function')

      // The three synthetic ticks were forwarded to the sender.
      const progressCalls = event.sender.send.mock.calls.filter(
        (c) => c[0] === 'moonraker:push:progress'
      )
      expect(progressCalls).toHaveLength(3)
      expect(progressCalls[0]![1]).toEqual({ sentBytes: 0, totalBytes: 200, percent: 0 })
      expect(progressCalls[1]![1]).toEqual({ sentBytes: 100, totalBytes: 200, percent: 50 })
      expect(progressCalls[2]![1]).toEqual({ sentBytes: 200, totalBytes: 200, percent: 100 })
    })

    it('does NOT send to a destroyed sender', async () => {
      const handler = handlers.get('moonraker:push')!
      const event = makeEvent(true)
      await handler(event, { gcodePath: '/tmp/x.gcode', printerUrl: 'http://k2' })
      const progressCalls = event.sender.send.mock.calls.filter(
        (c) => c[0] === 'moonraker:push:progress'
      )
      expect(progressCalls).toHaveLength(0)
    })
  })

  describe("carvera:upload -> 'carvera:upload:progress'", () => {
    it('forwards each phase tick with { phase }', async () => {
      const handler = handlers.get('carvera:upload')!
      const event = makeEvent()
      await handler(event, { gcodePath: '/tmp/cam.nc', connection: 'auto' })

      // carveraUpload received an onProgress shim.
      const passed = carveraUploadMock.mock.calls[0]![1]
      expect(typeof passed.onProgress).toBe('function')

      const progressCalls = event.sender.send.mock.calls.filter(
        (c) => c[0] === 'carvera:upload:progress'
      )
      expect(progressCalls).toHaveLength(3)
      expect(progressCalls[0]![1]).toEqual({ phase: 'connecting' })
      expect(progressCalls[1]![1]).toEqual({ phase: 'transferring' })
      expect(progressCalls[2]![1]).toEqual({ phase: 'verifying' })
    })

    it('does NOT send to a destroyed sender', async () => {
      const handler = handlers.get('carvera:upload')!
      const event = makeEvent(true)
      await handler(event, { gcodePath: '/tmp/cam.nc', connection: 'auto' })
      const progressCalls = event.sender.send.mock.calls.filter(
        (c) => c[0] === 'carvera:upload:progress'
      )
      expect(progressCalls).toHaveLength(0)
    })
  })
})
