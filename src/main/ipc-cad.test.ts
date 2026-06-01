/**
 * Unit tests for `src/main/ipc-cad.ts` -- the TS IPC layer for the new
 * parametric CAD Design workspace (BUILD 2). Covers:
 *
 *   A. Handler-shape pin -- the three documented channels
 *      (`cad:execute`, `cad:export`, `cad:listOperations`) MUST be
 *      registered. Mirrors the pin in `ipc-modeling.test.ts`.
 *   B. Validator coverage -- pure-function units for the three
 *      `validate*Payload` helpers exercise the documented error paths
 *      (missing fields, null-byte in outPath, oversized scripts, bad
 *      `buildParameters` shapes, unknown format).
 *   C. Bridge-error mapping -- `mapBridgeError` translates every
 *      `PythonBridgeError` code into a deterministic `{ error, hint }`
 *      envelope. The renderer keys off `error`, so drift here is a
 *      contract break.
 *   D. Result coercion -- malformed sidecar responses are scrubbed
 *      (defense-in-depth) instead of being passed through to the
 *      renderer as `undefined`.
 *
 * NOT covered here:
 *   - End-to-end sidecar round-trip. That lives in `cad-import-step.test.ts`
 *     style sidecar tests and will be added by the BUILD 3 follow-up that
 *     wires the Python handlers.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Track ipcMain registrations so we can pin the channel list.
const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn().mockReturnValue('/mock/app')
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('./settings-store', () => ({
  loadSettings: vi.fn().mockResolvedValue({ theme: 'dark', recentProjectPaths: [], pythonPath: 'python' })
}))

// Mock the PythonBridge so unit tests never spawn a real sidecar. The
// `vi.mock` factory is hoisted ABOVE module imports, so we cannot capture
// `vi.fn()` instances in module-scope `const`s -- they would not exist yet.
// Instead the factory creates fresh mocks every test run, and we recover
// the handles via `vi.mocked(...)` inside `beforeEach`.
vi.mock('./sidecar/python-bridge', () => {
  const bridgeCall = vi.fn()
  const bridgeStop = vi.fn().mockResolvedValue(undefined)
  const bridgeStart = vi.fn(() => ({ call: bridgeCall, stop: bridgeStop }))
  return {
    PythonBridge: { start: bridgeStart },
    // Test-only exports so the test file can grab the same mock instances
    // the production code is actually calling.
    __mocks: { bridgeCall, bridgeStop, bridgeStart }
  }
})

import {
  CAD_EXPORT_FORMATS,
  CAD_SCRIPT_MAX_BYTES,
  coerceExecuteResult,
  coerceListOperationsResult,
  mapBridgeError,
  registerCadIpc,
  validateExecutePayload,
  validateExportPayload,
  validateListOperationsPayload,
  type CadExecuteResponse,
  type CadExportResponse,
  type CadListOperationsResponse
} from './ipc-cad'
import type { MainIpcWindowContext } from './ipc-context'
import * as pythonBridgeModule from './sidecar/python-bridge'

// Re-expose the mocked PythonBridge handles for per-test scripting. The
// `__mocks` field is injected by the `vi.mock` factory above.
const bridgeMocks = (
  pythonBridgeModule as unknown as {
    __mocks: { bridgeCall: ReturnType<typeof vi.fn>; bridgeStop: ReturnType<typeof vi.fn>; bridgeStart: ReturnType<typeof vi.fn> }
  }
).__mocks
const bridgeCallMock = bridgeMocks.bridgeCall
const bridgeStopMock = bridgeMocks.bridgeStop
const bridgeStartMock = bridgeMocks.bridgeStart

function createMockContext(): MainIpcWindowContext {
  return { getMainWindow: () => null }
}

beforeEach(() => {
  handlers.clear()
  bridgeCallMock.mockReset()
  bridgeStopMock.mockReset().mockResolvedValue(undefined)
  bridgeStartMock.mockClear()
})

// ── A. Handler-shape pin ────────────────────────────────────────────────────

describe('registerCadIpc', () => {
  it('registers the three documented CAD channels', () => {
    registerCadIpc(createMockContext())
    for (const ch of ['cad:execute', 'cad:export', 'cad:listOperations']) {
      expect(handlers.has(ch), `missing handler for channel "${ch}"`).toBe(true)
    }
  })

  it('exports the canonical format whitelist', () => {
    // Pin: the format whitelist drives the renderer's "Export" dropdown.
    // If a format is added without UI work, the dropdown desyncs.
    expect([...CAD_EXPORT_FORMATS].sort()).toEqual(['dxf', 'step', 'stl'])
  })

  it('exposes a 100 KB script length cap', () => {
    expect(CAD_SCRIPT_MAX_BYTES).toBe(100 * 1024)
  })
})

// ── B. Validator coverage ───────────────────────────────────────────────────

describe('validateExecutePayload', () => {
  it('rejects null / non-object payloads', () => {
    const r = validateExecutePayload(null) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })

  it('rejects missing script', () => {
    const r = validateExecutePayload({}) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_script')
  })

  it('rejects empty-string script', () => {
    const r = validateExecutePayload({ script: '' }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_script')
  })

  it('rejects oversized scripts', () => {
    const big = 'x'.repeat(CAD_SCRIPT_MAX_BYTES + 1)
    const r = validateExecutePayload({ script: big }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('script_too_large')
  })

  it('accepts a minimal valid script', () => {
    const r = validateExecutePayload({ script: 'import cadquery as cq' })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.script).toBe('import cadquery as cq')
      expect(r.payload.buildParameters).toBeUndefined()
    }
  })

  it('passes through scalar buildParameters values', () => {
    const r = validateExecutePayload({
      script: 'pass',
      buildParameters: { width: 10, debug: true, label: 'top' }
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) {
      expect(r.payload.buildParameters).toEqual({ width: 10, debug: true, label: 'top' })
    }
  })

  it('rejects non-finite numeric buildParameters', () => {
    const r = validateExecutePayload({
      script: 'pass',
      buildParameters: { width: Number.POSITIVE_INFINITY }
    }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_build_parameters')
  })

  it('rejects nested objects in buildParameters', () => {
    const r = validateExecutePayload({
      script: 'pass',
      buildParameters: { box: { x: 1 } }
    }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_build_parameters')
  })

  it('rejects array buildParameters', () => {
    const r = validateExecutePayload({
      script: 'pass',
      buildParameters: [1, 2, 3]
    }) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_build_parameters')
  })
})

describe('validateExportPayload', () => {
  it('rejects missing fields', () => {
    const noHandle = validateExportPayload({ outPath: '/a/b.stl', format: 'stl' }) as CadExportResponse
    expect(noHandle.ok).toBe(false)
    if (!noHandle.ok) expect(noHandle.error).toBe('missing_handle')

    const noOut = validateExportPayload({ handle: 'h1', format: 'stl' }) as CadExportResponse
    expect(noOut.ok).toBe(false)
    if (!noOut.ok) expect(noOut.error).toBe('missing_out_path')

    const noFormat = validateExportPayload({ handle: 'h1', outPath: '/a/b.stl' }) as CadExportResponse
    expect(noFormat.ok).toBe(false)
    if (!noFormat.ok) expect(noFormat.error).toBe('invalid_format')
  })

  it('rejects null-byte in outPath', () => {
    const r = validateExportPayload({
      handle: 'h1',
      outPath: '/a/b\0.stl',
      format: 'stl'
    }) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_path')
  })

  it('rejects unknown format', () => {
    const r = validateExportPayload({
      handle: 'h1',
      outPath: '/a/b.iges',
      format: 'iges'
    }) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_format')
  })

  it('rejects non-positive toleranceMm', () => {
    const r = validateExportPayload({
      handle: 'h1',
      outPath: '/a/b.stl',
      format: 'stl',
      toleranceMm: 0
    }) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_tolerance')
  })

  it('accepts each whitelisted format', () => {
    for (const fmt of CAD_EXPORT_FORMATS) {
      const r = validateExportPayload({ handle: 'h1', outPath: `/a/b.${fmt}`, format: fmt })
      expect('payload' in r, `expected ok for format=${fmt}`).toBe(true)
      if ('payload' in r) expect(r.payload.format).toBe(fmt)
    }
  })

  it('round-trips an explicit toleranceMm', () => {
    const r = validateExportPayload({
      handle: 'h1',
      outPath: '/a/b.stl',
      format: 'stl',
      toleranceMm: 0.05
    })
    expect('payload' in r).toBe(true)
    if ('payload' in r) expect(r.payload.toleranceMm).toBe(0.05)
  })
})

describe('validateListOperationsPayload', () => {
  it('rejects null / non-object payloads', () => {
    const r = validateListOperationsPayload(null) as CadListOperationsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
  })

  it('rejects missing script', () => {
    const r = validateListOperationsPayload({}) as CadListOperationsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('missing_script')
  })

  it('rejects oversized script', () => {
    const big = 'x'.repeat(CAD_SCRIPT_MAX_BYTES + 1)
    const r = validateListOperationsPayload({ script: big }) as CadListOperationsResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('script_too_large')
  })

  it('accepts a minimal valid payload', () => {
    const r = validateListOperationsPayload({ script: 'pass' })
    expect('payload' in r).toBe(true)
    if ('payload' in r) expect(r.payload.script).toBe('pass')
  })
})

// ── C. Bridge-error mapping pin ─────────────────────────────────────────────

describe('mapBridgeError', () => {
  it('maps python_spawn_failed to a Settings-Paths hint', () => {
    const r = mapBridgeError({ code: 'python_spawn_failed', message: 'ENOENT' })
    expect(r.error).toBe('python_spawn_failed')
    expect(r.hint.length).toBeGreaterThan(0)
  })

  it('maps bridge_closed to sidecar_closed', () => {
    const r = mapBridgeError({ code: 'bridge_closed', message: 'child exited' })
    expect(r.error).toBe('sidecar_closed')
  })

  it('maps bridge_timeout to sidecar_timeout', () => {
    const r = mapBridgeError({ code: 'bridge_timeout', message: 'after 5000ms' })
    expect(r.error).toBe('sidecar_timeout')
  })

  it('passes through structured sidecar error codes', () => {
    const r = mapBridgeError({
      code: 'sidecar_error',
      message: 'unsafe import',
      sidecarCode: 'unsafe_script'
    })
    expect(r.error).toBe('unsafe_script')
    expect(r.hint).toBe('unsafe import')
  })

  it('maps bad_response to sidecar_protocol_error', () => {
    const r = mapBridgeError({ code: 'bad_response', message: 'invalid json' })
    expect(r.error).toBe('sidecar_protocol_error')
  })
})

// ── D. Result coercion ──────────────────────────────────────────────────────

describe('coerceExecuteResult', () => {
  it('drops malformed mesh entries', () => {
    const r = coerceExecuteResult({
      meshes: [
        { handle: 'h1', stlPath: '/a/b.stl', triangleCount: 12, bbox: { min: [0, 0, 0], max: [1, 1, 1] } },
        { handle: 'missing-fields' },
        null,
        42
      ],
      faceCount: 6,
      log: ['line one', 'line two', 99]
    })
    expect(r.meshes).toHaveLength(1)
    expect(r.meshes[0]?.handle).toBe('h1')
    expect(r.faceCount).toBe(6)
    expect(r.log).toEqual(['line one', 'line two'])
    expect(r.error).toBeUndefined()
  })

  it('preserves a structured error envelope', () => {
    const r = coerceExecuteResult({
      meshes: [],
      faceCount: 0,
      log: [],
      error: { code: 'unsafe_script', message: 'banned token: __import__' }
    })
    expect(r.error?.code).toBe('unsafe_script')
  })

  it('defaults non-finite faceCount to 0', () => {
    const r = coerceExecuteResult({ meshes: [], faceCount: Number.NaN, log: [] })
    expect(r.faceCount).toBe(0)
  })
})

describe('coerceListOperationsResult', () => {
  it('drops malformed parameter / operation entries', () => {
    const r = coerceListOperationsResult({
      parameters: [
        { name: 'width', value: 10, kind: 'number' },
        { name: 'enabled', value: true, kind: 'boolean' },
        { name: 'bad', value: { nested: 1 }, kind: 'number' },
        null
      ],
      operations: [
        { index: 0, kind: 'workplane', line: 3, summary: 'XY' },
        { index: 1, kind: 'extrude', line: 7, summary: '10 mm', extra: 'ignored' },
        { kind: 'missing-index' }
      ]
    })
    expect(r.parameters.map((p) => p.name)).toEqual(['width', 'enabled'])
    expect(r.operations.map((o) => o.kind)).toEqual(['workplane', 'extrude'])
    expect(r.parseError).toBeUndefined()
  })

  it('passes through a parse error', () => {
    const r = coerceListOperationsResult({
      parameters: [],
      operations: [],
      parseError: { line: 4, message: 'unexpected EOF' }
    })
    expect(r.parseError?.line).toBe(4)
  })
})

// ── E. End-to-end IPC handler behavior with mocked sidecar ──────────────────

describe('cad:execute handler', () => {
  it('short-circuits on invalid payload BEFORE spawning the bridge', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:execute')!
    const r = (await handler({}, null)) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_payload')
    // No bridge spawned -- pure validation.
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('reports python_spawn_failed cleanly when the bridge cannot start', async () => {
    bridgeCallMock.mockRejectedValueOnce({ code: 'python_spawn_failed', message: 'ENOENT: python' })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:execute')!
    const r = (await handler({}, { script: 'pass' })) as CadExecuteResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('python_spawn_failed')
    expect(bridgeStopMock).toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.execute_script with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      meshes: [
        { handle: 'h1', stlPath: '/tmp/m.stl', triangleCount: 4, bbox: { min: [0, 0, 0], max: [1, 1, 1] } }
      ],
      faceCount: 6,
      log: ['ok']
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:execute')!
    const r = (await handler(
      {},
      { script: 'cq.Workplane()', buildParameters: { w: 10 } }
    )) as CadExecuteResponse
    expect(r.ok).toBe(true)
    expect(bridgeCallMock).toHaveBeenCalledTimes(1)
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.execute_script')
    expect(paramsArg).toEqual({ script: 'cq.Workplane()', buildParameters: { w: 10 } })
  })

  it('omits buildParameters from the wire payload when not supplied', async () => {
    bridgeCallMock.mockResolvedValueOnce({ meshes: [], faceCount: 0, log: [] })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:execute')!
    await handler({}, { script: 'pass' })
    const [, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(paramsArg).toEqual({ script: 'pass' })
  })
})

describe('cad:export handler', () => {
  it('short-circuits on null-byte outPath', async () => {
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:export')!
    const r = (await handler({}, {
      handle: 'h1',
      outPath: '/a/b\0.stl',
      format: 'stl'
    })) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_path')
    expect(bridgeStartMock).not.toHaveBeenCalled()
  })

  it('dispatches valid payload to cad.export with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({ outPath: '/a/b.stl', bytesWritten: 1234 })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:export')!
    const r = (await handler({}, {
      handle: 'h1',
      outPath: '/a/b.stl',
      format: 'stl',
      toleranceMm: 0.1
    })) as CadExportResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.outPath).toBe('/a/b.stl')
      expect(r.result.bytesWritten).toBe(1234)
    }
    const [methodArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.export')
  })

  it('translates sidecar invalid_handle error envelopes', async () => {
    bridgeCallMock.mockRejectedValueOnce({
      code: 'sidecar_error',
      message: 'not found',
      sidecarCode: 'invalid_handle'
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:export')!
    const r = (await handler({}, {
      handle: 'stale',
      outPath: '/a/b.stl',
      format: 'stl'
    })) as CadExportResponse
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('invalid_handle')
  })
})

describe('cad:listOperations handler', () => {
  it('dispatches valid payload to cad.list_operations with the right method name', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      parameters: [{ name: 'w', value: 10, kind: 'number' }],
      operations: [{ index: 0, kind: 'workplane', line: 1, summary: 'XY' }]
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:listOperations')!
    const r = (await handler({}, { script: 'cq.Workplane()' })) as CadListOperationsResponse
    expect(r.ok).toBe(true)
    const [methodArg, paramsArg] = bridgeCallMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(methodArg).toBe('cad.list_operations')
    expect(paramsArg).toEqual({ script: 'cq.Workplane()' })
  })

  it('preserves a parseError from the sidecar', async () => {
    bridgeCallMock.mockResolvedValueOnce({
      parameters: [],
      operations: [],
      parseError: { line: 3, message: 'invalid syntax' }
    })
    registerCadIpc(createMockContext())
    const handler = handlers.get('cad:listOperations')!
    const r = (await handler({}, { script: 'broken script' })) as CadListOperationsResponse
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.parseError?.line).toBe(3)
      expect(r.result.parameters).toEqual([])
    }
  })
})
