import { describe, expect, it } from 'vitest'
import { formatFdmLayerSummaryHuman, summarizeFdmGcodeLayers } from './fdm-gcode-layer-summary'

describe('summarizeFdmGcodeLayers', () => {
  it('returns nulls for empty input', () => {
    expect(summarizeFdmGcodeLayers('')).toEqual({
      inferredLayerCount: null,
      declaredLayerCount: null,
      linesScanned: 0
    })
  })

  it('infers count from ;LAYER comments', () => {
    const g = [';FLAVOR:Marlin', ';LAYER:0', 'G1 X1', ';LAYER:1', ';LAYER:12'].join('\n')
    const s = summarizeFdmGcodeLayers(g)
    expect(s.inferredLayerCount).toBe(13)
    expect(s.declaredLayerCount).toBeNull()
  })

  it('reads ;LAYER_COUNT', () => {
    const g = ';LAYER_COUNT:42\n;LAYER:0\n'
    const s = summarizeFdmGcodeLayers(g)
    expect(s.declaredLayerCount).toBe(42)
    expect(s.inferredLayerCount).toBe(1)
  })

  it('formats human line', () => {
    expect(formatFdmLayerSummaryHuman(summarizeFdmGcodeLayers(''))).toBe('')
    const line = formatFdmLayerSummaryHuman(summarizeFdmGcodeLayers(';LAYER:0\n;LAYER:2\n'))
    expect(line).toMatch(/inferred 3/)
  })
})
