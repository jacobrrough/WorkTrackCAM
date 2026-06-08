import { describe, expect, it } from 'vitest'
import { normalizeMoonrakerUrl } from './moonraker-url'

describe('normalizeMoonrakerUrl', () => {
  it('returns empty string for empty / whitespace / nullish input', () => {
    expect(normalizeMoonrakerUrl('')).toBe('')
    expect(normalizeMoonrakerUrl('   ')).toBe('')
    expect(normalizeMoonrakerUrl(null)).toBe('')
    expect(normalizeMoonrakerUrl(undefined)).toBe('')
  })

  it('prepends http:// to a bare IP, hostname, or host:port (the reported bug)', () => {
    expect(normalizeMoonrakerUrl('192.168.1.50')).toBe('http://192.168.1.50')
    expect(normalizeMoonrakerUrl('k2plus.local')).toBe('http://k2plus.local')
    expect(normalizeMoonrakerUrl('192.168.1.50:7125')).toBe('http://192.168.1.50:7125')
    expect(normalizeMoonrakerUrl('k2plus.local:7125')).toBe('http://k2plus.local:7125')
  })

  it('leaves an existing scheme untouched (https, and even a wrong scheme)', () => {
    expect(normalizeMoonrakerUrl('http://192.168.1.50')).toBe('http://192.168.1.50')
    expect(normalizeMoonrakerUrl('https://printer.example')).toBe('https://printer.example')
    // A genuinely wrong scheme is preserved so the downstream protocol check
    // still rejects it (rather than us silently turning it into http://).
    expect(normalizeMoonrakerUrl('file:///etc/passwd')).toBe('file:///etc/passwd')
  })

  it('trims surrounding whitespace before normalizing', () => {
    expect(normalizeMoonrakerUrl('  192.168.1.50  ')).toBe('http://192.168.1.50')
    expect(normalizeMoonrakerUrl('  http://k2.local  ')).toBe('http://k2.local')
  })

  it('strips trailing slashes so callers can append /printer/... cleanly', () => {
    expect(normalizeMoonrakerUrl('http://192.168.1.50/')).toBe('http://192.168.1.50')
    expect(normalizeMoonrakerUrl('192.168.1.50:7125/')).toBe('http://192.168.1.50:7125')
    expect(normalizeMoonrakerUrl('http://192.168.1.50///')).toBe('http://192.168.1.50')
  })

  it('output for a bare IP:port is parseable by new URL() (root cause of "invalid")', () => {
    const u = new URL(normalizeMoonrakerUrl('192.168.1.50:7125'))
    expect(u.hostname).toBe('192.168.1.50')
    expect(u.port).toBe('7125')
    expect(u.protocol).toBe('http:')
  })
})
