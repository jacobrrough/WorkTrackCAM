import { describe, expect, it, vi, afterEach } from 'vitest'
import { copyToastTextToClipboard } from '../contexts/ToastContext'

/**
 * [ID-0088] Unit tests for `copyToastTextToClipboard`, the helper that
 * the multi-line toast Copy button calls when the operator clicks it.
 *
 * The Toast component itself is rendered inside `ToastProvider` and
 * exercised by the existing renderer suite indirectly. These tests
 * pin the pure helper behavior so we know:
 *   - It calls `navigator.clipboard.writeText` with the exact text.
 *   - It tolerates a missing `clipboard` API (secure-context fallback).
 *   - It tolerates a missing `clipboard.writeText` method.
 *   - It swallows promise rejections (focus / permission errors).
 *
 * No DOM rendering required -- the helper is pure-function plus one
 * `navigator.clipboard.writeText` call. We stub `navigator` via
 * `vi.stubGlobal` because the default Node test env exposes
 * `globalThis.navigator` as a read-only getter.
 */
describe('copyToastTextToClipboard -- [ID-0088]', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls navigator.clipboard.writeText with the exact text', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    copyToastTextToClipboard('hello world')
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('hello world')
  })

  it('preserves the full multi-line moonraker rejection text byte-for-byte', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const text = 'Upload blocked.: M109 targets 400 C, ceiling 350 C. (+2 more) -- will heat: Nozzle: 245 C'
    copyToastTextToClipboard(text)
    expect(writeText).toHaveBeenCalledWith(text)
  })

  it('does nothing (no throw) when navigator.clipboard is undefined', () => {
    vi.stubGlobal('navigator', {})
    expect(() => copyToastTextToClipboard('x')).not.toThrow()
  })

  it('does nothing (no throw) when navigator.clipboard.writeText is undefined', () => {
    vi.stubGlobal('navigator', { clipboard: {} })
    expect(() => copyToastTextToClipboard('x')).not.toThrow()
  })

  it('does nothing (no throw) when navigator.clipboard.writeText is not a function', () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: 42 } })
    expect(() => copyToastTextToClipboard('x')).not.toThrow()
  })

  it('swallows writeText rejection without throwing (focus / permission errors)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError: Document is not focused'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(() => copyToastTextToClipboard('x')).not.toThrow()
    // Allow the rejected promise to settle so the .catch() runs before
    // the test exits and Vitest does not flag an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('returns void (no Promise) so onClick handlers do not need to await', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const result = copyToastTextToClipboard('x')
    // Type contract: function returns void. Runtime sanity: undefined.
    expect(result).toBeUndefined()
  })
})
