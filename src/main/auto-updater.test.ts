import { describe, expect, it } from 'vitest'
import type { UpdateStatus } from './auto-updater'
import { resolveUpdateServerUrl } from './auto-updater'

describe('UpdateStatus type', () => {
  it('represents idle state', () => {
    const status: UpdateStatus = { state: 'idle' }
    expect(status.state).toBe('idle')
  })

  it('represents checking state', () => {
    const status: UpdateStatus = { state: 'checking' }
    expect(status.state).toBe('checking')
  })

  it('represents available state with version', () => {
    const status: UpdateStatus = { state: 'available', version: '1.2.0', releaseNotes: 'Bug fixes' }
    expect(status.state).toBe('available')
    expect(status.version).toBe('1.2.0')
    expect(status.releaseNotes).toBe('Bug fixes')
  })

  it('represents not-available state', () => {
    const status: UpdateStatus = { state: 'not-available', version: '0.1.0' }
    expect(status.state).toBe('not-available')
    expect(status.version).toBe('0.1.0')
  })

  it('represents downloading state with percent', () => {
    const status: UpdateStatus = { state: 'downloading', percent: 42 }
    expect(status.state).toBe('downloading')
    expect(status.percent).toBe(42)
  })

  it('represents downloaded state', () => {
    const status: UpdateStatus = { state: 'downloaded', version: '1.2.0' }
    expect(status.state).toBe('downloaded')
    expect(status.version).toBe('1.2.0')
  })

  it('represents error state', () => {
    const status: UpdateStatus = { state: 'error', message: 'Network timeout' }
    expect(status.state).toBe('error')
    expect(status.message).toBe('Network timeout')
  })
})

describe('resolveUpdateServerUrl', () => {
  const origEnv = process.env['WORKTRACK_UPDATE_URL']
  function restoreEnv(): void {
    if (origEnv === undefined) delete process.env['WORKTRACK_UPDATE_URL']
    else process.env['WORKTRACK_UPDATE_URL'] = origEnv
  }

  it('returns env var when set', () => {
    process.env['WORKTRACK_UPDATE_URL'] = 'https://updates.example.com'
    try {
      expect(resolveUpdateServerUrl()).toBe('https://updates.example.com')
      // env takes priority over settings
      expect(resolveUpdateServerUrl('https://other.example.com')).toBe('https://updates.example.com')
    } finally {
      restoreEnv()
    }
  })

  it('returns settings URL when env is not set', () => {
    delete process.env['WORKTRACK_UPDATE_URL']
    try {
      expect(resolveUpdateServerUrl('https://settings.example.com')).toBe('https://settings.example.com')
    } finally {
      restoreEnv()
    }
  })

  it('returns undefined when neither is set', () => {
    delete process.env['WORKTRACK_UPDATE_URL']
    try {
      expect(resolveUpdateServerUrl()).toBeUndefined()
      expect(resolveUpdateServerUrl(undefined)).toBeUndefined()
    } finally {
      restoreEnv()
    }
  })

  it('ignores blank or whitespace-only values', () => {
    process.env['WORKTRACK_UPDATE_URL'] = '   '
    try {
      expect(resolveUpdateServerUrl()).toBeUndefined()
      expect(resolveUpdateServerUrl('  ')).toBeUndefined()
    } finally {
      restoreEnv()
    }
  })

  it('trims whitespace from values', () => {
    process.env['WORKTRACK_UPDATE_URL'] = '  https://trimmed.example.com  '
    try {
      expect(resolveUpdateServerUrl()).toBe('https://trimmed.example.com')
    } finally {
      restoreEnv()
    }
  })
})
