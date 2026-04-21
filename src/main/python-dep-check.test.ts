import { describe, expect, it } from 'vitest'
import {
  buildDepCheckWarning,
  buildOptionalPythonDepsHint,
  buildPythonDepsUserMessage,
  type PythonDepCheckOutcome
} from './python-dep-check'

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

describe('buildOptionalPythonDepsHint', () => {
  it('suggests trimesh and STEP deps when optional imports are missing', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: true,
      result: {
        ok: true,
        pythonOk: true,
        pythonVersion: '3.11.4',
        pythonMin: '3.9',
        required: [{ name: 'numpy', available: true, version: '1.26.0', note: '' }],
        optional: [
          { name: 'trimesh', available: false, version: null, note: '' },
          { name: 'cadquery', available: false, version: null, note: '' },
          { name: 'OCP', available: false, version: null, note: '' }
        ],
        missingRequired: []
      }
    }
    const msg = buildOptionalPythonDepsHint(outcome)
    expect(msg).toMatch(/trimesh/)
    expect(msg).toMatch(/cadquery/)
    expect(msg).toMatch(/OCP/)
  })

  it('returns null when trimesh and STEP-related optionals are present', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: true,
      result: {
        ok: true,
        pythonOk: true,
        pythonVersion: '3.11.4',
        pythonMin: '3.9',
        required: [{ name: 'numpy', available: true, version: '1.26.0', note: '' }],
        optional: [
          { name: 'trimesh', available: true, version: '4.0.0', note: '' },
          { name: 'cadquery', available: true, version: '2.0.0', note: '' },
          { name: 'OCP', available: true, version: 'installed', note: '' }
        ],
        missingRequired: []
      }
    }
    expect(buildOptionalPythonDepsHint(outcome)).toBeNull()
  })
})

describe('buildPythonDepsUserMessage', () => {
  it('returns only critical warning when required deps are missing', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: true,
      result: {
        ok: false,
        pythonOk: true,
        pythonVersion: '3.11.4',
        pythonMin: '3.9',
        required: [{ name: 'numpy', available: false, version: null, note: '' }],
        optional: [{ name: 'trimesh', available: false, version: null, note: '' }],
        missingRequired: ['numpy']
      }
    }
    const msg = buildPythonDepsUserMessage(outcome)
    expect(msg).toContain('numpy')
    expect(msg).not.toMatch(/Mesh import/)
  })

  it('returns optional hints alone when core deps are OK', () => {
    const outcome: PythonDepCheckOutcome = {
      checked: true,
      result: {
        ok: true,
        pythonOk: true,
        pythonVersion: '3.11.4',
        pythonMin: '3.9',
        required: [{ name: 'numpy', available: true, version: '1.26.0', note: '' }],
        optional: [{ name: 'trimesh', available: false, version: null, note: '' }],
        missingRequired: []
      }
    }
    const msg = buildPythonDepsUserMessage(outcome)
    expect(msg).toMatch(/trimesh/)
  })
})
