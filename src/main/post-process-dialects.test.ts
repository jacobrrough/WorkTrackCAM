import { describe, expect, it } from 'vitest'
import { resolveDialectSnippets, resolveWorkOffsetLine } from './post-process-dialects'

describe('post-process-dialects', () => {
  it('returns expected snippets for known dialects', () => {
    expect(resolveDialectSnippets('grbl')).toEqual({
      on: 'M3 S12000',
      off: 'M5',
      units: 'G21'
    })
    expect(resolveDialectSnippets('mach3')).toEqual({
      on: 'M3',
      off: 'M5',
      units: 'G21'
    })
  })

  it('falls back to safe defaults for unknown dialects', () => {
    expect(resolveDialectSnippets('generic_mm')).toEqual({
      on: 'M3 S10000',
      off: 'M5',
      units: 'G21'
    })
  })

  it('maps valid work offsets and rejects invalid indices', () => {
    expect(resolveWorkOffsetLine(1)).toBe('G54')
    expect(resolveWorkOffsetLine(6)).toBe('G59')
    expect(resolveWorkOffsetLine(0)).toBeUndefined()
    expect(resolveWorkOffsetLine(7)).toBeUndefined()
  })
})
