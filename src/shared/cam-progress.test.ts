import { describe, expect, it } from 'vitest'
import {
  camProgressEventSchema,
  CAM_PROGRESS_LINE_PREFIX,
  parseCamProgressLine,
  type CamProgressEvent
} from './cam-progress'

describe('camProgressEventSchema', () => {
  it('parses a minimal progress event', () => {
    const event = camProgressEventSchema.parse({
      phase: 'toolpath',
      percent: 45
    })
    expect(event.phase).toBe('toolpath')
    expect(event.percent).toBe(45)
    expect(event.message).toBeUndefined()
    expect(event.detail).toBeUndefined()
  })

  it('parses a full progress event with message and detail', () => {
    const event = camProgressEventSchema.parse({
      phase: 'heightfield',
      percent: 30,
      message: 'Building 2.5D height field from mesh',
      detail: {
        pointCount: 1500,
        estimatedLengthMm: 2400.5,
        currentZMm: -3.2,
        strategy: 'raster'
      }
    })
    expect(event.phase).toBe('heightfield')
    expect(event.percent).toBe(30)
    expect(event.message).toBe('Building 2.5D height field from mesh')
    expect(event.detail?.pointCount).toBe(1500)
    expect(event.detail?.estimatedLengthMm).toBe(2400.5)
    expect(event.detail?.currentZMm).toBe(-3.2)
    expect(event.detail?.strategy).toBe('raster')
  })

  it('accepts all valid phase values', () => {
    const phases = ['init', 'mesh_load', 'heightfield', 'toolpath', 'post_process', 'write', 'complete', 'error'] as const
    for (const phase of phases) {
      const event = camProgressEventSchema.parse({ phase, percent: 0 })
      expect(event.phase).toBe(phase)
    }
  })

  it('rejects invalid phase', () => {
    expect(() => camProgressEventSchema.parse({ phase: 'bogus', percent: 50 })).toThrow()
  })

  it('rejects percent below 0', () => {
    expect(() => camProgressEventSchema.parse({ phase: 'init', percent: -1 })).toThrow()
  })

  it('rejects percent above 100', () => {
    expect(() => camProgressEventSchema.parse({ phase: 'init', percent: 101 })).toThrow()
  })

  it('rejects missing percent', () => {
    expect(() => camProgressEventSchema.parse({ phase: 'init' })).toThrow()
  })

  it('accepts 0% and 100%', () => {
    expect(camProgressEventSchema.parse({ phase: 'init', percent: 0 }).percent).toBe(0)
    expect(camProgressEventSchema.parse({ phase: 'complete', percent: 100 }).percent).toBe(100)
  })

  it('accepts detail with only some fields', () => {
    const event = camProgressEventSchema.parse({
      phase: 'toolpath',
      percent: 50,
      detail: { pointCount: 500 }
    })
    expect(event.detail?.pointCount).toBe(500)
    expect(event.detail?.estimatedLengthMm).toBeUndefined()
  })
})

describe('CAM_PROGRESS_LINE_PREFIX', () => {
  it('is the correct prefix string', () => {
    expect(CAM_PROGRESS_LINE_PREFIX).toBe('PROGRESS:')
  })
})

describe('parseCamProgressLine', () => {
  it('parses a valid progress line', () => {
    const line = 'PROGRESS:{"phase":"toolpath","percent":45,"message":"Generating raster passes"}'
    const event = parseCamProgressLine(line)
    expect(event).not.toBeNull()
    expect(event!.phase).toBe('toolpath')
    expect(event!.percent).toBe(45)
    expect(event!.message).toBe('Generating raster passes')
  })

  it('returns null for non-progress lines', () => {
    expect(parseCamProgressLine('Some regular output')).toBeNull()
    expect(parseCamProgressLine('ERROR: something broke')).toBeNull()
    expect(parseCamProgressLine('')).toBeNull()
    expect(parseCamProgressLine('   ')).toBeNull()
  })

  it('returns null for progress prefix with invalid JSON', () => {
    expect(parseCamProgressLine('PROGRESS:{not json}')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:')).toBeNull()
  })

  it('returns null for progress prefix with valid JSON but wrong schema', () => {
    expect(parseCamProgressLine('PROGRESS:{"phase":"bogus","percent":50}')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:{"phase":"init"}')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:42')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:"hello"')).toBeNull()
  })

  it('handles whitespace around the line', () => {
    const line = '  PROGRESS:{"phase":"init","percent":0}  '
    const event = parseCamProgressLine(line)
    expect(event).not.toBeNull()
    expect(event!.phase).toBe('init')
  })

  it('parses complete event with detail', () => {
    const json = JSON.stringify({
      phase: 'complete',
      percent: 100,
      message: 'Done',
      detail: { pointCount: 5000, estimatedLengthMm: 12000 }
    })
    const event = parseCamProgressLine(`PROGRESS:${json}`)
    expect(event).not.toBeNull()
    expect(event!.phase).toBe('complete')
    expect(event!.detail?.pointCount).toBe(5000)
  })

  it('parses error phase event', () => {
    const json = JSON.stringify({ phase: 'error', percent: 0, message: 'STL file not found' })
    const event = parseCamProgressLine(`PROGRESS:${json}`)
    expect(event).not.toBeNull()
    expect(event!.phase).toBe('error')
    expect(event!.message).toBe('STL file not found')
  })
})
