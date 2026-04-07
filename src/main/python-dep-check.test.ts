import { describe, expect, it } from 'vitest'
import { buildDepCheckWarning, type PythonDepCheckOutcome } from './python-dep-check'

describe('buildDepCheckWarning', () => {
  it('returns null when outcome is checked and ok', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: true,
      result: {
        ok: true,
        pythonOk: true,
        pythonVersion: '3.11.4',
        pythonMin: '3.9',
        required: [{ name: 'numpy', available: true, version: '1.26.0', note: '' }],
        optional: [{ name: 'structlog', available: true, version: '23.1.0', note: '' }],
        missingRequired: []
      }
    }
    expect(buildDepCheckWarning(outcome)).toBeNull()
  })

  it('returns error string when not checked', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: false,
      error: 'Python not found'
    }
    expect(buildDepCheckWarning(outcome)).toBe('Python not found')
  })

  it('returns Python version warning when python_ok is false', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: true,
      result: {
        ok: false,
        pythonOk: false,
        pythonVersion: '3.7.2',
        pythonMin: '3.9',
        required: [{ name: 'numpy', available: true, version: '1.21.0', note: '' }],
        optional: [],
        missingRequired: []
      }
    }
    const msg = buildDepCheckWarning(outcome)
    expect(msg).toContain('3.9+')
    expect(msg).toContain('3.7.2')
  })

  it('returns missing required packages warning', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: true,
      result: {
        ok: false,
        pythonOk: true,
        pythonVersion: '3.11.4',
        pythonMin: '3.9',
        required: [{ name: 'numpy', available: false, version: null, note: '' }],
        optional: [],
        missingRequired: ['numpy']
      }
    }
    const msg = buildDepCheckWarning(outcome)
    expect(msg).toContain('numpy')
    expect(msg).toContain('pip install')
  })

  it('combines Python version and missing packages warnings', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: true,
      result: {
        ok: false,
        pythonOk: false,
        pythonVersion: '3.8.0',
        pythonMin: '3.9',
        required: [{ name: 'numpy', available: false, version: null, note: '' }],
        optional: [],
        missingRequired: ['numpy']
      }
    }
    const msg = buildDepCheckWarning(outcome)
    expect(msg).toContain('3.9+')
    expect(msg).toContain('3.8.0')
    expect(msg).toContain('numpy')
    expect(msg).toContain('pip install')
  })

  it('does not warn about optional packages', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: true,
      result: {
        ok: true,
        pythonOk: true,
        pythonVersion: '3.11.4',
        pythonMin: '3.9',
        required: [{ name: 'numpy', available: true, version: '1.26.0', note: '' }],
        optional: [{ name: 'structlog', available: false, version: null, note: '' }],
        missingRequired: []
      }
    }
    expect(buildDepCheckWarning(outcome)).toBeNull()
  })
})
