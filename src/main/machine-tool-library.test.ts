import { describe, expect, it } from 'vitest'
import { sanitizeMachineIdForToolLibrary } from './machine-tool-library'

describe('sanitizeMachineIdForToolLibrary', () => {
  it('normalizes ids', () => {
    expect(sanitizeMachineIdForToolLibrary('  My-Machine_1  ')).toBe('my-machine_1')
  })

  it('throws on empty', () => {
    expect(() => sanitizeMachineIdForToolLibrary('   ')).toThrow()
  })

  it('replaces special characters with underscore', () => {
    expect(sanitizeMachineIdForToolLibrary('my@machine!v2')).toBe('my_machine_v2')
  })

  it('collapses consecutive special chars to single underscore', () => {
    expect(sanitizeMachineIdForToolLibrary('a...b///c')).toBe('a_b_c')
  })

  it('strips leading and trailing underscores from result', () => {
    // Special chars become _ which are then stripped at boundaries
    expect(sanitizeMachineIdForToolLibrary('@grbl@')).toBe('grbl')
  })

  it('lowercases the result', () => {
    expect(sanitizeMachineIdForToolLibrary('HAAS_VF2')).toBe('haas_vf2')
  })

  it('passes through already-normalized ids unchanged', () => {
    expect(sanitizeMachineIdForToolLibrary('generic-cnc')).toBe('generic-cnc')
    expect(sanitizeMachineIdForToolLibrary('mill_6040')).toBe('mill_6040')
  })

  it('throws when result is empty after normalization (all-special-char input)', () => {
    expect(() => sanitizeMachineIdForToolLibrary('@@@')).toThrow()
    expect(() => sanitizeMachineIdForToolLibrary('...')).toThrow()
  })
})
