/**
 * Unit tests for the `machine:estop` IPC surface.
 *
 * Safety-critical surface — these tests pin:
 *   - Payload validation (unknown machineId, malformed payload).
 *   - K2 Plus happy path (POST hits /printer/emergency_stop).
 *   - K2 Plus timeout (AbortSignal.timeout fires inside fetch).
 *   - K2 Plus missing moonrakerUrl (no_moonraker_url error).
 *   - K2 Plus invalid URL (invalid_moonraker_url error).
 *   - Carvera 3-axis & 4-axis fallback (no_cli_abort).
 *   - Laguna no-remote-abort path.
 *   - registerMachineIpc registers the channel.
 *
 * Errors NEVER throw — the handler must always return a structured
 * envelope so the renderer can toast the operator.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest'
import {
  KNOWN_MACHINE_IDS,
  carveraAbortFallback,
  dispatchEstop,
  isKnownMachineId,
  lagunaNoRemoteAbort,
  postMoonrakerEmergencyStop,
  registerMachineIpc,
  validateEstopPayload
} from './ipc-machine'
import type { MainIpcWindowContext } from './ipc-context'

// ── Track registered IPC channels ───────────────────────────────────────────

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('./settings-store', () => ({
  loadSettings: vi.fn().mockResolvedValue({ theme: 'dark', recentProjectPaths: [] })
}))

function makeCtx(): MainIpcWindowContext {
  return { getMainWindow: () => null }
}

// ── isKnownMachineId / KNOWN_MACHINE_IDS ────────────────────────────────────

describe('KNOWN_MACHINE_IDS', () => {
  it('covers all four three-machine-cohort ids (K2 + Laguna + Carvera 3/4)', () => {
    expect(new Set(KNOWN_MACHINE_IDS)).toEqual(
      new Set([
        'creality-k2-plus',
        'laguna-swift-5x10',
        'makera-carvera-3axis',
        'makera-carvera-4axis'
      ])
    )
  })

  it('isKnownMachineId returns true for known ids', () => {
    for (const id of KNOWN_MACHINE_IDS) {
      expect(isKnownMachineId(id)).toBe(true)
    }
  })

  it('isKnownMachineId returns false for an unknown id', () => {
    expect(isKnownMachineId('not-a-machine')).toBe(false)
    expect(isKnownMachineId('')).toBe(false)
    expect(isKnownMachineId('CREALITY-K2-PLUS')).toBe(false) // case sensitive
  })
})

// ── validateEstopPayload ────────────────────────────────────────────────────

describe('validateEstopPayload', () => {
  it('accepts a well-formed payload for each known machineId', () => {
    for (const id of KNOWN_MACHINE_IDS) {
      const v = validateEstopPayload({ machineId: id })
      expect(v.ok).toBe(true)
      if (v.ok) expect(v.payload.machineId).toBe(id)
    }
  })

  it('rejects non-object payloads with invalid_payload', () => {
    for (const raw of [null, undefined, 42, 'a-string', false]) {
      const v = validateEstopPayload(raw)
      expect(v.ok).toBe(false)
      if (!v.ok) expect(v.error).toBe('invalid_payload')
    }
  })

  it('rejects missing or non-string machineId with invalid_payload', () => {
    expect(validateEstopPayload({}).ok).toBe(false)
    expect(validateEstopPayload({ machineId: 42 }).ok).toBe(false)
    expect(validateEstopPayload({ machineId: '' }).ok).toBe(false)
  })

  it('rejects unknown machineId with unknown_machine', () => {
    const v = validateEstopPayload({ machineId: 'random-printer' })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.error).toBe('unknown_machine')
  })
})

// ── postMoonrakerEmergencyStop ─────────────────────────────────────────────

describe('postMoonrakerEmergencyStop', () => {
  let originalFetch: typeof globalThis.fetch | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    if (originalFetch !== undefined) {
      globalThis.fetch = originalFetch
    }
    vi.restoreAllMocks()
  })

  it('K2 happy path: POSTs /printer/emergency_stop and returns ok', async () => {
    const fetchMock: Mock = vi.fn(async () =>
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const result = await postMoonrakerEmergencyStop('http://192.168.1.50:7125', 1_000)
    expect(result.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://192.168.1.50:7125/printer/emergency_stop')
    expect(opts.method).toBe('POST')
    // AbortSignal.timeout returns an AbortSignal — verify it is plumbed.
    expect(opts.signal).toBeDefined()
  })

  it('K2 strips trailing slashes from the printer URL before POST', async () => {
    const fetchMock: Mock = vi.fn(async () =>
      new Response('{}', { status: 200 })
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const result = await postMoonrakerEmergencyStop('http://k2plus.local/', 1_000)
    expect(result.ok).toBe(true)
    const [url] = fetchMock.mock.calls[0] as [string]
    expect(url).toBe('http://k2plus.local/printer/emergency_stop')
  })

  it('K2 timeout: AbortError folds into moonraker_timeout with operator hint', async () => {
    const fetchMock: Mock = vi.fn(async () => {
      const err = new Error('The operation was aborted.') as Error & {
        name: string
      }
      err.name = 'AbortError'
      throw err
    })
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const result = await postMoonrakerEmergencyStop('http://192.168.1.50:7125', 50)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('moonraker_timeout')
    expect(result.hint).toMatch(/physical power switch/i)
  })

  it('K2 network error: ECONNREFUSED-shaped failure folds into moonraker_network_error', async () => {
    const fetchMock: Mock = vi.fn(async () => {
      throw new Error('fetch failed: ECONNREFUSED')
    })
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const result = await postMoonrakerEmergencyStop('http://192.0.2.1:7125', 200)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('moonraker_network_error')
    expect(result.hint).toMatch(/physical power switch/i)
  })

  it('K2 HTTP 500 from Moonraker folds into moonraker_http_500', async () => {
    const fetchMock: Mock = vi.fn(async () =>
      new Response('boom', { status: 500 })
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const result = await postMoonrakerEmergencyStop('http://192.168.1.50:7125', 1_000)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('moonraker_http_500')
  })

  it('K2 invalid URL (parse failure) returns invalid_moonraker_url', async () => {
    const fetchMock: Mock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const result = await postMoonrakerEmergencyStop('not a url', 1_000)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('invalid_moonraker_url')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('K2 invalid protocol (file://) returns invalid_moonraker_url and skips fetch', async () => {
    const fetchMock: Mock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const result = await postMoonrakerEmergencyStop('file:///etc/passwd', 1_000)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('invalid_moonraker_url')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── carveraAbortFallback / lagunaNoRemoteAbort ──────────────────────────────

describe('carveraAbortFallback', () => {
  it('returns ok=false with no_cli_abort and an operator hint', () => {
    const r = carveraAbortFallback()
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_cli_abort')
    expect(r.hint).toMatch(/physically e-stop/i)
  })
})

describe('lagunaNoRemoteAbort', () => {
  it('returns ok=false with no_remote_abort and points operator to the RichAuto pendant', () => {
    const r = lagunaNoRemoteAbort()
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_remote_abort')
    expect(r.hint).toMatch(/RichAuto pendant E-stop/i)
  })
})

// ── dispatchEstop ───────────────────────────────────────────────────────────

describe('dispatchEstop', () => {
  let originalFetch: typeof globalThis.fetch | undefined

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    if (originalFetch !== undefined) {
      globalThis.fetch = originalFetch
    }
  })

  it('K2: missing moonrakerUrl returns no_moonraker_url with Settings hint', async () => {
    const r = await dispatchEstop('creality-k2-plus', {
      loadSettingsFn: async () => ({})
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_moonraker_url')
    expect(r.hint).toMatch(/Settings/i)
  })

  it('K2: empty-string moonrakerUrl is treated as missing', async () => {
    const r = await dispatchEstop('creality-k2-plus', {
      loadSettingsFn: async () => ({ moonrakerUrl: '   ' })
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_moonraker_url')
  })

  it('K2: valid moonrakerUrl + happy fetch returns ok', async () => {
    const fetchMock: Mock = vi.fn(async () =>
      new Response('{}', { status: 200 })
    )
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch

    const r = await dispatchEstop('creality-k2-plus', {
      loadSettingsFn: async () => ({ moonrakerUrl: 'http://192.168.1.50:7125' }),
      timeoutMs: 500
    })
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('Carvera 3-axis: returns no_cli_abort fallback', async () => {
    const r = await dispatchEstop('makera-carvera-3axis', {
      loadSettingsFn: async () => ({})
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_cli_abort')
  })

  it('Carvera 4-axis: returns no_cli_abort fallback', async () => {
    const r = await dispatchEstop('makera-carvera-4axis', {
      loadSettingsFn: async () => ({})
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_cli_abort')
  })

  it('Laguna: returns no_remote_abort', async () => {
    const r = await dispatchEstop('laguna-swift-5x10', {
      loadSettingsFn: async () => ({})
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_remote_abort')
  })
})

// ── registerMachineIpc + end-to-end handler ────────────────────────────────

describe('registerMachineIpc', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('registers the machine:estop channel', () => {
    registerMachineIpc(makeCtx())
    expect(handlers.has('machine:estop')).toBe(true)
  })

  it('handler rejects malformed payloads with invalid_payload (never throws)', async () => {
    registerMachineIpc(makeCtx())
    const handler = handlers.get('machine:estop')!
    const r = (await handler({}, null)) as { ok: boolean; error?: string }
    expect(r.ok).toBe(false)
    expect(r.error).toBe('invalid_payload')
  })

  it('handler rejects unknown machineId with unknown_machine', async () => {
    registerMachineIpc(makeCtx())
    const handler = handlers.get('machine:estop')!
    const r = (await handler({}, { machineId: 'unknown-machine' })) as {
      ok: boolean
      error?: string
    }
    expect(r.ok).toBe(false)
    expect(r.error).toBe('unknown_machine')
  })

  it('handler returns Laguna no_remote_abort end-to-end', async () => {
    registerMachineIpc(makeCtx())
    const handler = handlers.get('machine:estop')!
    const r = (await handler({}, { machineId: 'laguna-swift-5x10' })) as {
      ok: boolean
      error?: string
    }
    expect(r.ok).toBe(false)
    expect(r.error).toBe('no_remote_abort')
  })
})
