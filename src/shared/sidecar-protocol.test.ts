import { describe, it, expect } from 'vitest'
import { isSidecarResponse } from './sidecar-protocol'

describe('isSidecarResponse', () => {
  it('accepts a valid success envelope', () => {
    expect(
      isSidecarResponse({
        id: 'req-1',
        ok: true,
        result: { pong: true, version: '0.1.0' },
      }),
    ).toBe(true)
  })

  it('accepts a valid error envelope (no detail)', () => {
    expect(
      isSidecarResponse({
        id: 'req-1',
        ok: false,
        error: { code: 'unknown_method', message: 'Unknown method: foo' },
      }),
    ).toBe(true)
  })

  it('accepts a valid error envelope (with detail)', () => {
    expect(
      isSidecarResponse({
        id: 'req-1',
        ok: false,
        error: { code: 'handler_error', message: 'kaboom', detail: 'traceback...' },
      }),
    ).toBe(true)
  })

  it('rejects non-object values', () => {
    expect(isSidecarResponse(null)).toBe(false)
    expect(isSidecarResponse(undefined)).toBe(false)
    expect(isSidecarResponse('string')).toBe(false)
    expect(isSidecarResponse(42)).toBe(false)
    expect(isSidecarResponse([])).toBe(false)
  })

  it('rejects missing or empty id', () => {
    expect(isSidecarResponse({ ok: true, result: {} })).toBe(false)
    expect(isSidecarResponse({ id: '', ok: true, result: {} })).toBe(false)
    expect(isSidecarResponse({ id: 42, ok: true, result: {} })).toBe(false)
  })

  it('rejects missing ok discriminant', () => {
    expect(isSidecarResponse({ id: 'x', result: {} })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: 'true', result: {} })).toBe(false)
  })

  it('rejects success envelope with non-object result', () => {
    expect(isSidecarResponse({ id: 'x', ok: true, result: 'bad' })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: true, result: null })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: true })).toBe(false)
  })

  it('rejects error envelope with missing or wrong-shape error', () => {
    expect(isSidecarResponse({ id: 'x', ok: false })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: false, error: {} })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: false, error: { code: 'c' } })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: false, error: { message: 'm' } })).toBe(false)
    expect(isSidecarResponse({ id: 'x', ok: false, error: { code: 42, message: 'm' } })).toBe(false)
  })
})
