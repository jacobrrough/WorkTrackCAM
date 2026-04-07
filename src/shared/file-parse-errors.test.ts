import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { formatLoadRejection, formatZodError, friendlyError, isENOENT, parseJsonText } from './file-parse-errors'

describe('file-parse-errors', () => {
  it('parseJsonText returns parsed value', () => {
    expect(parseJsonText('{"a":1}', 'x.json')).toEqual({ a: 1 })
  })

  it('parseJsonText throws with label on bad JSON', () => {
    expect(() => parseJsonText('{', 'design/sketch.json')).toThrow(/design\/sketch\.json/)
    expect(() => parseJsonText('{', 'design/sketch.json')).toThrow(/invalid JSON/)
  })

  it('isENOENT recognizes ENOENT', () => {
    expect(isENOENT(Object.assign(new Error('nope'), { code: 'ENOENT' }))).toBe(true)
    expect(isENOENT(new Error('other'))).toBe(false)
  })

  it('formatZodError summarizes issues', () => {
    const r = z.object({ version: z.literal(2) }).safeParse({ version: 1 })
    expect(r.success).toBe(false)
    if (r.success) return
    const msg = formatZodError(r.error, 'part/features.json')
    expect(msg).toContain('part/features.json')
    expect(msg).toMatch(/version/i)
  })

  it('formatZodError adds expected/got for invalid_type', () => {
    const r = z.object({ name: z.string() }).safeParse({})
    expect(r.success).toBe(false)
    if (r.success) return
    const msg = formatZodError(r.error, 'design/sketch.json')
    expect(msg).toContain('design/sketch.json')
    expect(msg).toMatch(/expected string|expected.*string/i)
  })

  it('formatLoadRejection prefixes unknown messages with file label', () => {
    expect(formatLoadRejection('assembly.json', new Error('boom'))).toBe('assembly.json — boom')
  })

  it('formatLoadRejection does not duplicate file label', () => {
    const r = z.object({ v: z.number() }).safeParse({})
    expect(r.success).toBe(false)
    if (r.success) return
    const m = formatZodError(r.error, 'part/features.json')
    expect(formatLoadRejection('part/features.json', new Error(m))).toBe(m)
  })

  it('formatLoadRejection handles empty message and non-Error reasons', () => {
    expect(formatLoadRejection('job.json', new Error('   '))).toBe('job.json: load failed')
    expect(formatLoadRejection('job.json', 'timeout')).toBe('job.json — timeout')
  })

  it('formatZodError includes enum received for invalid_enum_value', () => {
    const r = z.enum(['a', 'b']).safeParse('c')
    expect(r.success).toBe(false)
    if (r.success) return
    const msg = formatZodError(r.error, 'settings.json')
    expect(msg).toContain('settings.json')
    expect(msg).toMatch(/c/)
  })

  it('formatZodError passes through too_small messages', () => {
    const r = z.string().min(3).safeParse('ab')
    expect(r.success).toBe(false)
    if (r.success) return
    const msg = formatZodError(r.error, 'name.txt')
    expect(msg).toContain('name.txt')
    expect(msg.length).toBeGreaterThan(10)
  })

  it('formatZodError truncates long issue lists', () => {
    const schema = z.object({
      a: z.string(),
      b: z.string(),
      c: z.string(),
      d: z.string(),
      e: z.string(),
      f: z.string(),
      g: z.string(),
      h: z.string(),
      i: z.string(),
      j: z.string()
    })
    const r = schema.safeParse({})
    expect(r.success).toBe(false)
    if (r.success) return
    const msg = formatZodError(r.error, 'wide.json')
    expect(msg).toContain('wide.json')
    expect(msg).toMatch(/\+2 more/)
  })

  it('formatZodError falls back for non-Zod errors', () => {
    expect(formatZodError(new Error('nope'), 'x.json')).toBe('x.json: nope')
    expect(formatZodError(404, 'x.json')).toBe('x.json: 404')
  })
})

describe('friendlyError', () => {
  it('returns Error.message with label prefix', () => {
    expect(friendlyError(new Error('disk full'), 'Tool import failed')).toBe('Tool import failed: disk full')
  })

  it('returns message without label when label is omitted', () => {
    expect(friendlyError(new Error('timeout'))).toBe('timeout')
  })

  it('truncates Error.message longer than 200 chars', () => {
    const long = 'x'.repeat(300)
    const result = friendlyError(new Error(long), 'Label')
    expect(result).toContain('Label')
    expect(result.endsWith('…')).toBe(true)
    // message part is 200 chars + '…' + 'Label: ' prefix
    expect(result.length).toBeLessThan(220)
  })

  it('converts non-Error thrown string with label', () => {
    expect(friendlyError('EACCES: permission denied', 'Machine import')).toBe('Machine import: EACCES: permission denied')
  })

  it('truncates non-Error thrown string longer than 200 chars', () => {
    const long = 'z'.repeat(250)
    const result = friendlyError(long)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(201)
  })

  it('formats ZodError with label as the file context', () => {
    const r = z.object({ tools: z.array(z.object({ diameterMm: z.number() })) })
      .safeParse({ tools: [{ diameterMm: 'big' }] })
    expect(r.success).toBe(false)
    if (r.success) return
    const msg = friendlyError(r.error, 'Tool import failed')
    expect(msg).toContain('Tool import failed')
    expect(msg).toMatch(/diameterMm/)
  })

  it('formats ZodError with default label when none provided', () => {
    const r = z.string().safeParse(42)
    expect(r.success).toBe(false)
    if (r.success) return
    const msg = friendlyError(r.error)
    expect(msg).toContain('Validation error')
  })

  it('handles null and undefined thrown values', () => {
    expect(friendlyError(null, 'Op')).toBe('Op: null')
    expect(friendlyError(undefined, 'Op')).toBe('Op: undefined')
  })
})
