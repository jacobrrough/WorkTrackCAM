import { describe, expect, it } from 'vitest'
import { convertDxfToMm, parseDxf, type DxfArc, type DxfCircle, type DxfLine, type DxfPolyline } from './dxf-parser'

// ---------------------------------------------------------------------------
// Helpers — build minimal DXF ASCII content for testing
// ---------------------------------------------------------------------------

/** Build a bare-minimum DXF with just an ENTITIES section. */
function wrapEntities(entityContent: string): string {
  return [
    '  0', 'SECTION',
    '  2', 'ENTITIES',
    entityContent,
    '  0', 'ENDSEC',
    '  0', 'EOF'
  ].join('\n')
}

/** Build a DXF with HEADER + ENTITIES sections. */
function wrapWithHeader(headerContent: string, entityContent: string): string {
  return [
    '  0', 'SECTION',
    '  2', 'HEADER',
    headerContent,
    '  0', 'ENDSEC',
    '  0', 'SECTION',
    '  2', 'ENTITIES',
    entityContent,
    '  0', 'ENDSEC',
    '  0', 'EOF'
  ].join('\n')
}

function makeLine(x1: number, y1: number, x2: number, y2: number, layer = '0'): string {
  return [
    '  0', 'LINE',
    '  8', layer,
    ' 10', String(x1),
    ' 20', String(y1),
    ' 11', String(x2),
    ' 21', String(y2)
  ].join('\n')
}

function makeCircle(cx: number, cy: number, r: number, layer = '0'): string {
  return [
    '  0', 'CIRCLE',
    '  8', layer,
    ' 10', String(cx),
    ' 20', String(cy),
    ' 40', String(r)
  ].join('\n')
}

function makeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number, layer = '0'): string {
  return [
    '  0', 'ARC',
    '  8', layer,
    ' 10', String(cx),
    ' 20', String(cy),
    ' 40', String(r),
    ' 50', String(startDeg),
    ' 51', String(endDeg)
  ].join('\n')
}

function makeLwPolyline(
  vertices: Array<{ x: number; y: number; bulge?: number }>,
  closed = false,
  layer = '0'
): string {
  const lines = [
    '  0', 'LWPOLYLINE',
    '  8', layer,
    ' 90', String(vertices.length),
    ' 70', closed ? '1' : '0'
  ]
  for (const v of vertices) {
    if (v.bulge !== undefined && v.bulge !== 0) {
      lines.push(' 42', String(v.bulge))
    }
    lines.push(' 10', String(v.x))
    lines.push(' 20', String(v.y))
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// LINE entity tests
// ---------------------------------------------------------------------------

describe('DXF parser: LINE entities', () => {
  it('parses a single LINE entity', () => {
    const dxf = wrapEntities(makeLine(0, 0, 10, 20))
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(1)
    const line = result.entities[0] as DxfLine
    expect(line.type).toBe('line')
    expect(line.points[0]).toEqual({ x: 0, y: 0 })
    expect(line.points[1]).toEqual({ x: 10, y: 20 })
    expect(line.layer).toBe('0')
  })

  it('parses multiple LINE entities', () => {
    const dxf = wrapEntities(
      makeLine(0, 0, 5, 5) + '\n' + makeLine(5, 5, 10, 0)
    )
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(2)
    expect(result.entities[0].type).toBe('line')
    expect(result.entities[1].type).toBe('line')
  })

  it('reads layer from LINE entity', () => {
    const dxf = wrapEntities(makeLine(0, 0, 1, 1, 'CUT_PROFILE'))
    const result = parseDxf(dxf)
    expect(result.entities[0].layer).toBe('CUT_PROFILE')
    expect(result.layers).toContain('CUT_PROFILE')
  })
})

// ---------------------------------------------------------------------------
// CIRCLE entity tests
// ---------------------------------------------------------------------------

describe('DXF parser: CIRCLE entities', () => {
  it('parses a CIRCLE with center and radius', () => {
    const dxf = wrapEntities(makeCircle(50, 50, 25))
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(1)
    const circle = result.entities[0] as DxfCircle
    expect(circle.type).toBe('circle')
    expect(circle.center).toEqual({ x: 50, y: 50 })
    expect(circle.radius).toBe(25)
  })

  it('reads layer from CIRCLE entity', () => {
    const dxf = wrapEntities(makeCircle(0, 0, 10, 'DRILL_HOLES'))
    const result = parseDxf(dxf)
    expect(result.entities[0].layer).toBe('DRILL_HOLES')
  })
})

// ---------------------------------------------------------------------------
// ARC entity tests
// ---------------------------------------------------------------------------

describe('DXF parser: ARC entities', () => {
  it('parses an ARC with center, radius, start/end angle', () => {
    const dxf = wrapEntities(makeArc(10, 20, 15, 45, 135))
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(1)
    const arc = result.entities[0] as DxfArc
    expect(arc.type).toBe('arc')
    expect(arc.center).toEqual({ x: 10, y: 20 })
    expect(arc.radius).toBe(15)
    expect(arc.startAngleDeg).toBe(45)
    expect(arc.endAngleDeg).toBe(135)
  })

  it('handles 0-360 arc angles', () => {
    const dxf = wrapEntities(makeArc(0, 0, 5, 0, 360))
    const result = parseDxf(dxf)
    const arc = result.entities[0] as DxfArc
    expect(arc.startAngleDeg).toBe(0)
    expect(arc.endAngleDeg).toBe(360)
  })
})

// ---------------------------------------------------------------------------
// LWPOLYLINE entity tests
// ---------------------------------------------------------------------------

describe('DXF parser: LWPOLYLINE entities', () => {
  it('parses an open LWPOLYLINE with straight segments', () => {
    const dxf = wrapEntities(makeLwPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ], false))
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(1)
    const poly = result.entities[0] as DxfPolyline
    expect(poly.type).toBe('polyline')
    expect(poly.points).toHaveLength(4)
    expect(poly.closed).toBe(false)
    expect(poly.bulges.every((b) => b === 0)).toBe(true)
  })

  it('parses a closed LWPOLYLINE', () => {
    const dxf = wrapEntities(makeLwPolyline([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 }
    ], true))
    const result = parseDxf(dxf)
    const poly = result.entities[0] as DxfPolyline
    expect(poly.closed).toBe(true)
  })

  it('preserves bulge values for arc segments', () => {
    const dxf = wrapEntities(makeLwPolyline([
      { x: 0, y: 0, bulge: 0.5 },
      { x: 10, y: 0 },
      { x: 10, y: 10, bulge: -0.3 },
      { x: 0, y: 10 }
    ], true))
    const result = parseDxf(dxf)
    const poly = result.entities[0] as DxfPolyline
    expect(poly.bulges[0]).toBe(0.5)
    expect(poly.bulges[1]).toBe(0)
    expect(poly.bulges[2]).toBe(-0.3)
    expect(poly.bulges[3]).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Classic POLYLINE entity tests
// ---------------------------------------------------------------------------

describe('DXF parser: classic POLYLINE entities', () => {
  it('parses POLYLINE with VERTEX/SEQEND', () => {
    const entities = [
      '  0', 'POLYLINE',
      '  8', 'Layer1',
      ' 70', '1',
      '  0', 'VERTEX',
      ' 10', '0',
      ' 20', '0',
      '  0', 'VERTEX',
      ' 10', '10',
      ' 20', '0',
      '  0', 'VERTEX',
      ' 10', '10',
      ' 20', '10',
      '  0', 'SEQEND'
    ].join('\n')
    const dxf = wrapEntities(entities)
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(1)
    const poly = result.entities[0] as DxfPolyline
    expect(poly.type).toBe('polyline')
    expect(poly.points).toHaveLength(3)
    expect(poly.closed).toBe(true)
    expect(poly.layer).toBe('Layer1')
  })
})

// ---------------------------------------------------------------------------
// SPLINE entity tests
// ---------------------------------------------------------------------------

describe('DXF parser: SPLINE entities', () => {
  it('linearizes SPLINE fit points to polyline', () => {
    const entities = [
      '  0', 'SPLINE',
      '  8', '0',
      ' 70', '0',
      // Control points (group 10/20)
      ' 10', '0',
      ' 20', '0',
      ' 10', '5',
      ' 20', '10',
      ' 10', '10',
      ' 20', '0',
      // Fit points (group 11/21) — preferred over control points
      ' 11', '0',
      ' 21', '0',
      ' 11', '3',
      ' 21', '8',
      ' 11', '7',
      ' 21', '8',
      ' 11', '10',
      ' 21', '0'
    ].join('\n')
    const dxf = wrapEntities(entities)
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(1)
    const poly = result.entities[0] as DxfPolyline
    expect(poly.type).toBe('polyline')
    // Should use fit points (4) not control points (3)
    expect(poly.points).toHaveLength(4)
    expect(poly.points[1]).toEqual({ x: 3, y: 8 })
    // All bulges 0 (linearized)
    expect(poly.bulges.every((b) => b === 0)).toBe(true)
    // Should produce a warning about linearization
    expect(result.warnings.some((w) => w.message.includes('SPLINE linearized'))).toBe(true)
  })

  it('falls back to control points when no fit points', () => {
    const entities = [
      '  0', 'SPLINE',
      '  8', '0',
      ' 70', '0',
      ' 10', '0',
      ' 20', '0',
      ' 10', '5',
      ' 20', '10',
      ' 10', '10',
      ' 20', '0'
    ].join('\n')
    const dxf = wrapEntities(entities)
    const result = parseDxf(dxf)
    const poly = result.entities[0] as DxfPolyline
    expect(poly.points).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Edge cases: empty, malformed, missing ENTITIES
// ---------------------------------------------------------------------------

describe('DXF parser: edge cases', () => {
  it('handles empty DXF content', () => {
    const result = parseDxf('')
    expect(result.entities).toHaveLength(0)
    expect(result.warnings.some((w) => w.message.includes('Empty'))).toBe(true)
    expect(result.units).toBe('unknown')
  })

  it('handles DXF with no ENTITIES section', () => {
    const dxf = [
      '  0', 'SECTION',
      '  2', 'HEADER',
      '  0', 'ENDSEC',
      '  0', 'EOF'
    ].join('\n')
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(0)
    expect(result.warnings.some((w) => w.message.includes('No ENTITIES'))).toBe(true)
  })

  it('handles malformed DXF with unparseable codes', () => {
    const dxf = 'this is not a real dxf file\njust some random text\n'
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(0)
  })

  it('skips unsupported entity types with a warning', () => {
    const entities = [
      '  0', 'POINT',
      ' 10', '5',
      ' 20', '5',
      '  0', 'LINE',
      '  8', '0',
      ' 10', '0',
      ' 20', '0',
      ' 11', '10',
      ' 21', '10'
    ].join('\n')
    const dxf = wrapEntities(entities)
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(1)
    expect(result.entities[0].type).toBe('line')
    expect(result.warnings.some((w) => w.message.includes('POINT'))).toBe(true)
  })

  it('handles empty ENTITIES section', () => {
    const dxf = wrapEntities('')
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(0)
    expect(result.warnings.some((w) => w.message.includes('No ENTITIES'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Layer extraction
// ---------------------------------------------------------------------------

describe('DXF parser: layer extraction', () => {
  it('extracts unique sorted layer names from entities', () => {
    const dxf = wrapEntities(
      makeLine(0, 0, 1, 1, 'CUT') + '\n' +
      makeLine(0, 0, 1, 1, 'DRILL') + '\n' +
      makeCircle(0, 0, 5, 'CUT') + '\n' +
      makeCircle(0, 0, 3, 'ENGRAVE')
    )
    const result = parseDxf(dxf)
    expect(result.layers).toEqual(['CUT', 'DRILL', 'ENGRAVE'])
  })

  it('defaults layer to "0" when not specified', () => {
    // Build a LINE without group code 8 (no layer)
    const entities = [
      '  0', 'LINE',
      ' 10', '0',
      ' 20', '0',
      ' 11', '10',
      ' 21', '10'
    ].join('\n')
    const dxf = wrapEntities(entities)
    const result = parseDxf(dxf)
    expect(result.entities[0].layer).toBe('0')
    expect(result.layers).toContain('0')
  })
})

// ---------------------------------------------------------------------------
// Unit detection (HEADER parsing)
// ---------------------------------------------------------------------------

describe('DXF parser: unit detection', () => {
  it('detects millimeters from $INSUNITS = 4', () => {
    const header = [
      '  9', '$INSUNITS',
      ' 70', '4'
    ].join('\n')
    const dxf = wrapWithHeader(header, makeLine(0, 0, 10, 10))
    const result = parseDxf(dxf)
    expect(result.units).toBe('mm')
  })

  it('detects inches from $INSUNITS = 1', () => {
    const header = [
      '  9', '$INSUNITS',
      ' 70', '1'
    ].join('\n')
    const dxf = wrapWithHeader(header, makeLine(0, 0, 1, 1))
    const result = parseDxf(dxf)
    expect(result.units).toBe('inches')
  })

  it('detects metric from $MEASUREMENT = 1', () => {
    const header = [
      '  9', '$MEASUREMENT',
      ' 70', '1'
    ].join('\n')
    const dxf = wrapWithHeader(header, makeLine(0, 0, 5, 5))
    const result = parseDxf(dxf)
    expect(result.units).toBe('mm')
  })

  it('detects imperial from $MEASUREMENT = 0', () => {
    const header = [
      '  9', '$MEASUREMENT',
      ' 70', '0'
    ].join('\n')
    const dxf = wrapWithHeader(header, makeLine(0, 0, 5, 5))
    const result = parseDxf(dxf)
    expect(result.units).toBe('inches')
  })

  it('returns "unknown" when no unit info in header', () => {
    const dxf = wrapEntities(makeLine(0, 0, 1, 1))
    const result = parseDxf(dxf)
    expect(result.units).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// Unit conversion (inches → mm)
// ---------------------------------------------------------------------------

describe('convertDxfToMm', () => {
  it('converts LINE coordinates from inches to mm', () => {
    const header = [
      '  9', '$INSUNITS',
      ' 70', '1'
    ].join('\n')
    const dxf = wrapWithHeader(header, makeLine(1, 2, 3, 4))
    const result = parseDxf(dxf)
    expect(result.units).toBe('inches')
    convertDxfToMm(result)
    expect(result.units).toBe('mm')
    const line = result.entities[0] as DxfLine
    expect(line.points[0].x).toBeCloseTo(25.4, 5)
    expect(line.points[0].y).toBeCloseTo(50.8, 5)
    expect(line.points[1].x).toBeCloseTo(76.2, 5)
    expect(line.points[1].y).toBeCloseTo(101.6, 5)
  })

  it('converts CIRCLE center and radius from inches to mm', () => {
    const header = [
      '  9', '$INSUNITS',
      ' 70', '1'
    ].join('\n')
    const dxf = wrapWithHeader(header, makeCircle(2, 3, 0.5))
    const result = parseDxf(dxf)
    convertDxfToMm(result)
    const circle = result.entities[0] as DxfCircle
    expect(circle.center.x).toBeCloseTo(50.8, 5)
    expect(circle.center.y).toBeCloseTo(76.2, 5)
    expect(circle.radius).toBeCloseTo(12.7, 5)
  })

  it('converts ARC center and radius from inches to mm', () => {
    const header = [
      '  9', '$INSUNITS',
      ' 70', '1'
    ].join('\n')
    const dxf = wrapWithHeader(header, makeArc(1, 1, 0.5, 0, 90))
    const result = parseDxf(dxf)
    convertDxfToMm(result)
    const arc = result.entities[0] as DxfArc
    expect(arc.center.x).toBeCloseTo(25.4, 5)
    expect(arc.radius).toBeCloseTo(12.7, 5)
    // Angles should NOT be converted
    expect(arc.startAngleDeg).toBe(0)
    expect(arc.endAngleDeg).toBe(90)
  })

  it('does nothing when units are already mm', () => {
    const header = [
      '  9', '$INSUNITS',
      ' 70', '4'
    ].join('\n')
    const dxf = wrapWithHeader(header, makeLine(100, 200, 300, 400))
    const result = parseDxf(dxf)
    convertDxfToMm(result)
    const line = result.entities[0] as DxfLine
    expect(line.points[0].x).toBe(100)
    expect(line.points[0].y).toBe(200)
  })

  it('does nothing when units are unknown', () => {
    const dxf = wrapEntities(makeLine(5, 10, 15, 20))
    const result = parseDxf(dxf)
    expect(result.units).toBe('unknown')
    convertDxfToMm(result)
    // Should not modify
    const line = result.entities[0] as DxfLine
    expect(line.points[0].x).toBe(5)
    expect(result.units).toBe('unknown')
  })
})

// ---------------------------------------------------------------------------
// Mixed entity types
// ---------------------------------------------------------------------------

describe('DXF parser: mixed entity types', () => {
  it('parses a DXF with multiple entity types', () => {
    const dxf = wrapEntities(
      makeLine(0, 0, 10, 10, 'CUT') + '\n' +
      makeCircle(50, 50, 5, 'DRILL') + '\n' +
      makeArc(20, 20, 8, 0, 90, 'CUT') + '\n' +
      makeLwPolyline([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }], true, 'POCKET')
    )
    const result = parseDxf(dxf)
    expect(result.entities).toHaveLength(4)
    expect(result.entities[0].type).toBe('line')
    expect(result.entities[1].type).toBe('circle')
    expect(result.entities[2].type).toBe('arc')
    expect(result.entities[3].type).toBe('polyline')
    expect(result.layers).toEqual(['CUT', 'DRILL', 'POCKET'])
    expect(result.warnings).toHaveLength(0)
  })
})
