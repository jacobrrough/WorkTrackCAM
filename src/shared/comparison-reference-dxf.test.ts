import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDxf } from './dxf-parser'
import { dxfToSketch } from './dxf-to-sketch'
import { emptyDesign } from './design-schema'

describe('comparison reference-part.dxf imports cleanly', () => {
  const dxf = readFileSync(
    join(process.cwd(), 'resources', 'test-fixtures', 'comparison', 'reference-part.dxf'),
    'utf-8'
  )
  it('parses to 3 supported entities (rect polyline, circle, triangle polyline)', () => {
    const parsed = parseDxf(dxf)
    expect(parsed.entities.length).toBe(3)
    const kinds = parsed.entities.map((e) => e.type).sort()
    expect(kinds).toEqual(['circle', 'polyline', 'polyline'])
    const circle = parsed.entities.find((e) => e.type === 'circle') as {
      center: { x: number; y: number }
      radius: number
    }
    expect([circle.center.x, circle.center.y, circle.radius]).toEqual([35, 40, 18])
  })
  it('converts to a sketch with importable machinable geometry', () => {
    const parsed = parseDxf(dxf)
    const res = dxfToSketch(parsed, emptyDesign())
    expect(res.importedCount).toBe(3)
    expect(res.design.entities.length).toBeGreaterThanOrEqual(3)
  })
})
