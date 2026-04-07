import { describe, expect, it } from 'vitest'
import { isOclToolpathFile } from './cam-runner'

describe('isOclToolpathFile', () => {
  it('accepts a valid complete payload', () => {
    expect(isOclToolpathFile({ ok: true, toolpathLines: ['G1 X0'], strategy: 'waterline' })).toBe(true)
  })

  it('accepts a payload with all optional fields absent', () => {
    expect(isOclToolpathFile({})).toBe(true)
  })

  it('accepts ok: false with empty toolpathLines', () => {
    expect(isOclToolpathFile({ ok: false, toolpathLines: [] })).toBe(true)
  })

  it('rejects null', () => {
    expect(isOclToolpathFile(null)).toBe(false)
  })

  it('rejects a string', () => {
    expect(isOclToolpathFile('{"ok":true}')).toBe(false)
  })

  it('rejects an array', () => {
    expect(isOclToolpathFile([])).toBe(false)
  })

  it('rejects when ok is a non-boolean', () => {
    expect(isOclToolpathFile({ ok: 1 })).toBe(false)
    expect(isOclToolpathFile({ ok: 'true' })).toBe(false)
  })

  it('rejects when toolpathLines is not an array', () => {
    expect(isOclToolpathFile({ toolpathLines: 'G1 X0' })).toBe(false)
    expect(isOclToolpathFile({ toolpathLines: 42 })).toBe(false)
  })

  it('rejects when strategy is not a string', () => {
    expect(isOclToolpathFile({ strategy: 99 })).toBe(false)
    expect(isOclToolpathFile({ strategy: null })).toBe(false)
  })

  it('accepts when strategy is a valid string', () => {
    expect(isOclToolpathFile({ ok: true, strategy: 'raster' })).toBe(true)
  })

  it('accepts extra unknown fields (forward-compatible)', () => {
    expect(isOclToolpathFile({ ok: true, toolpathLines: [], unknownFuture: 42 })).toBe(true)
  })
})
