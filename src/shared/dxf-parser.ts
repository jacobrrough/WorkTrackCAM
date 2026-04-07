/**
 * Lightweight DXF ASCII parser for 2D geometry extraction.
 *
 * Supports: LINE, CIRCLE, ARC, POLYLINE, LWPOLYLINE, SPLINE (linearized).
 * Extracts layers, units (HEADER $INSUNITS / $MEASUREMENT), and geometry
 * suitable for pocket / contour / drill operations.
 *
 * Does NOT handle binary DXF — only ASCII format.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Point2D {
  x: number
  y: number
}

export interface DxfLine {
  type: 'line'
  points: [Point2D, Point2D]
  layer: string
}

export interface DxfCircle {
  type: 'circle'
  center: Point2D
  radius: number
  layer: string
}

export interface DxfArc {
  type: 'arc'
  center: Point2D
  radius: number
  startAngleDeg: number
  endAngleDeg: number
  layer: string
}

export interface DxfPolyline {
  type: 'polyline'
  points: Point2D[]
  closed: boolean
  /** Bulge values per segment (0 = straight, nonzero = arc). Index i → segment from point i to i+1. */
  bulges: number[]
  layer: string
}

export type DxfEntity = DxfLine | DxfCircle | DxfArc | DxfPolyline

export type DxfUnits = 'mm' | 'inches' | 'unknown'

export interface DxfParseWarning {
  message: string
  /** Entity index or line number where the warning originated. */
  location?: number
}

export interface DxfParseResult {
  entities: DxfEntity[]
  layers: string[]
  units: DxfUnits
  warnings: DxfParseWarning[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Group code + value pair from a DXF file. */
interface DxfPair {
  code: number
  value: string
}

/**
 * Tokenize DXF text into (code, value) pairs.
 * DXF ASCII format: alternating lines of integer group code and its value.
 */
function tokenize(text: string): DxfPair[] {
  const lines = text.split(/\r?\n/)
  const pairs: DxfPair[] = []
  let i = 0
  while (i + 1 < lines.length) {
    const codeLine = lines[i].trim()
    const valueLine = lines[i + 1].trim()
    const code = parseInt(codeLine, 10)
    if (Number.isNaN(code)) {
      i += 1
      continue
    }
    pairs.push({ code, value: valueLine })
    i += 2
  }
  return pairs
}

/** Safe float parse — returns 0 for bad data. */
function pf(s: string): number {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

/** Safe int parse — returns 0 for bad data. */
function pi(s: string): number {
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : 0
}

// ---------------------------------------------------------------------------
// HEADER parsing
// ---------------------------------------------------------------------------

function parseUnitsFromHeader(pairs: DxfPair[]): DxfUnits {
  // Look for $INSUNITS variable in HEADER section.
  // Group 70 after $INSUNITS: 1 = inches, 4 = mm, 5 = cm (treated as mm with warning)
  // Also check $MEASUREMENT: 0 = Imperial, 1 = Metric.
  let inHeader = false
  let foundInsunits = false
  let foundMeasurement = false

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]
    // Track HEADER section
    if (p.code === 0 && p.value === 'SECTION') {
      const next = pairs[i + 1]
      if (next?.code === 2 && next.value === 'HEADER') {
        inHeader = true
        continue
      }
    }
    if (p.code === 0 && p.value === 'ENDSEC' && inHeader) {
      break
    }
    if (!inHeader) continue

    // $INSUNITS
    if (p.code === 9 && p.value === '$INSUNITS') {
      foundInsunits = true
      continue
    }
    if (foundInsunits && p.code === 70) {
      const val = pi(p.value)
      foundInsunits = false
      if (val === 1) return 'inches'
      if (val === 4) return 'mm'
      if (val === 5) return 'mm' // cm — close enough for unit detection
      // Other values: keep looking for $MEASUREMENT
    }

    // $MEASUREMENT
    if (p.code === 9 && p.value === '$MEASUREMENT') {
      foundMeasurement = true
      continue
    }
    if (foundMeasurement && p.code === 70) {
      const val = pi(p.value)
      foundMeasurement = false
      return val === 0 ? 'inches' : 'mm'
    }
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// ENTITIES parsing
// ---------------------------------------------------------------------------

interface EntityBlock {
  type: string
  pairs: DxfPair[]
}

/**
 * Extract entity blocks from the ENTITIES section.
 * Each entity starts with group 0 and runs until the next group 0.
 */
function extractEntityBlocks(pairs: DxfPair[]): EntityBlock[] {
  let inEntities = false
  const blocks: EntityBlock[] = []
  let current: EntityBlock | null = null

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i]

    // Track ENTITIES section
    if (p.code === 0 && p.value === 'SECTION') {
      const next = pairs[i + 1]
      if (next?.code === 2 && next.value === 'ENTITIES') {
        inEntities = true
        i++ // skip the "2 ENTITIES" pair
        continue
      }
    }
    if (p.code === 0 && p.value === 'ENDSEC' && inEntities) {
      if (current) blocks.push(current)
      break
    }
    if (!inEntities) continue

    // New entity boundary
    if (p.code === 0) {
      if (current) blocks.push(current)
      current = { type: p.value, pairs: [] }
    } else if (current) {
      current.pairs.push(p)
    }
  }
  return blocks
}

/** Read a layer name from entity pairs (group code 8). Default: "0". */
function readLayer(pairs: DxfPair[]): string {
  for (const p of pairs) {
    if (p.code === 8) return p.value
  }
  return '0'
}

/** Read first occurrence of a group code. */
function readCode(pairs: DxfPair[], code: number): string | undefined {
  for (const p of pairs) {
    if (p.code === code) return p.value
  }
  return undefined
}

function parseLine(block: EntityBlock): DxfLine {
  const layer = readLayer(block.pairs)
  const x1 = pf(readCode(block.pairs, 10) ?? '0')
  const y1 = pf(readCode(block.pairs, 20) ?? '0')
  const x2 = pf(readCode(block.pairs, 11) ?? '0')
  const y2 = pf(readCode(block.pairs, 21) ?? '0')
  return { type: 'line', points: [{ x: x1, y: y1 }, { x: x2, y: y2 }], layer }
}

function parseCircle(block: EntityBlock): DxfCircle {
  const layer = readLayer(block.pairs)
  const cx = pf(readCode(block.pairs, 10) ?? '0')
  const cy = pf(readCode(block.pairs, 20) ?? '0')
  const r = pf(readCode(block.pairs, 40) ?? '0')
  return { type: 'circle', center: { x: cx, y: cy }, radius: r, layer }
}

function parseArc(block: EntityBlock): DxfArc {
  const layer = readLayer(block.pairs)
  const cx = pf(readCode(block.pairs, 10) ?? '0')
  const cy = pf(readCode(block.pairs, 20) ?? '0')
  const r = pf(readCode(block.pairs, 40) ?? '0')
  const startAngle = pf(readCode(block.pairs, 50) ?? '0')
  const endAngle = pf(readCode(block.pairs, 51) ?? '360')
  return { type: 'arc', center: { x: cx, y: cy }, radius: r, startAngleDeg: startAngle, endAngleDeg: endAngle, layer }
}

/**
 * Parse LWPOLYLINE — lightweight polyline with vertices as repeated group codes.
 * Group 10/20 = vertex X/Y, group 42 = bulge (optional, 0 = straight).
 * Group 70: flags — bit 1 = closed.
 */
function parseLwPolyline(block: EntityBlock): DxfPolyline {
  const layer = readLayer(block.pairs)
  const flags = pi(readCode(block.pairs, 70) ?? '0')
  const closed = (flags & 1) !== 0

  const points: Point2D[] = []
  const bulges: number[] = []
  let currentX: number | null = null
  let currentBulge = 0

  for (const p of block.pairs) {
    if (p.code === 10) {
      // When we see a new X, flush the previous vertex if we had one
      if (currentX !== null) {
        // This means we missed the Y for the previous vertex — shouldn't happen in valid DXF
        points.push({ x: currentX, y: 0 })
        bulges.push(currentBulge)
        currentBulge = 0
      }
      currentX = pf(p.value)
    } else if (p.code === 20 && currentX !== null) {
      points.push({ x: currentX, y: pf(p.value) })
      bulges.push(currentBulge)
      currentX = null
      currentBulge = 0
    } else if (p.code === 42) {
      currentBulge = pf(p.value)
    }
  }
  // Flush trailing X without Y
  if (currentX !== null) {
    points.push({ x: currentX, y: 0 })
    bulges.push(currentBulge)
  }

  return { type: 'polyline', points, closed, bulges, layer }
}

/**
 * Parse classic POLYLINE entity (followed by VERTEX + SEQEND entities).
 * We handle this by collecting vertices from subsequent VERTEX blocks.
 */
function parsePolylineClassic(block: EntityBlock, allBlocks: EntityBlock[], startIndex: number): {
  entity: DxfPolyline
  consumedCount: number
} {
  const layer = readLayer(block.pairs)
  const flags = pi(readCode(block.pairs, 70) ?? '0')
  const closed = (flags & 1) !== 0

  const points: Point2D[] = []
  const bulges: number[] = []
  let consumed = 0

  for (let i = startIndex + 1; i < allBlocks.length; i++) {
    const vb = allBlocks[i]
    if (vb.type === 'SEQEND') {
      consumed = i - startIndex
      break
    }
    if (vb.type === 'VERTEX') {
      const vx = pf(readCode(vb.pairs, 10) ?? '0')
      const vy = pf(readCode(vb.pairs, 20) ?? '0')
      const bulge = pf(readCode(vb.pairs, 42) ?? '0')
      points.push({ x: vx, y: vy })
      bulges.push(bulge)
      consumed = i - startIndex
    }
  }

  return {
    entity: { type: 'polyline', points, closed, bulges, layer },
    consumedCount: consumed
  }
}

/**
 * Parse SPLINE entity by linearizing control points.
 *
 * Full B-spline evaluation is complex; for CAM purposes we linearize
 * by extracting fit points (group 11/21) if present, otherwise control
 * points (group 10/20). This is a pragmatic approximation — real
 * spline evaluation would require de Boor's algorithm.
 */
function parseSpline(block: EntityBlock): DxfPolyline {
  const layer = readLayer(block.pairs)
  const flags = pi(readCode(block.pairs, 70) ?? '0')
  const closed = (flags & 1) !== 0

  // Collect fit points (11/21) and control points (10/20)
  const fitPoints: Point2D[] = []
  const controlPoints: Point2D[] = []

  let curFitX: number | null = null
  let curCtrlX: number | null = null

  for (const p of block.pairs) {
    if (p.code === 11) {
      if (curFitX !== null) {
        fitPoints.push({ x: curFitX, y: 0 })
      }
      curFitX = pf(p.value)
    } else if (p.code === 21 && curFitX !== null) {
      fitPoints.push({ x: curFitX, y: pf(p.value) })
      curFitX = null
    } else if (p.code === 10) {
      if (curCtrlX !== null) {
        controlPoints.push({ x: curCtrlX, y: 0 })
      }
      curCtrlX = pf(p.value)
    } else if (p.code === 20 && curCtrlX !== null) {
      controlPoints.push({ x: curCtrlX, y: pf(p.value) })
      curCtrlX = null
    }
  }
  if (curFitX !== null) fitPoints.push({ x: curFitX, y: 0 })
  if (curCtrlX !== null) controlPoints.push({ x: curCtrlX, y: 0 })

  // Prefer fit points (closer to actual curve) over control points
  const points = fitPoints.length >= 2 ? fitPoints : controlPoints
  const bulges = points.map(() => 0) // linearized — no arc segments

  return { type: 'polyline', points, closed, bulges, layer }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a DXF ASCII string and extract 2D geometry entities.
 *
 * Unsupported entity types are silently skipped with a warning in the result.
 *
 * @param text  Raw DXF file content (ASCII format).
 * @returns Parsed geometry, layers, units, and warnings.
 */
export function parseDxf(text: string): DxfParseResult {
  const warnings: DxfParseWarning[] = []
  const entities: DxfEntity[] = []
  const layerSet = new Set<string>()

  if (!text.trim()) {
    warnings.push({ message: 'Empty DXF content' })
    return { entities, layers: [], units: 'unknown', warnings }
  }

  const pairs = tokenize(text)
  if (pairs.length === 0) {
    warnings.push({ message: 'No valid DXF group code pairs found' })
    return { entities, layers: [], units: 'unknown', warnings }
  }

  const units = parseUnitsFromHeader(pairs)
  const blocks = extractEntityBlocks(pairs)

  if (blocks.length === 0) {
    warnings.push({ message: 'No ENTITIES section found or section is empty' })
    return { entities, layers: [], units, warnings }
  }

  const supportedTypes = new Set(['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'SPLINE'])
  const skippedTypes = new Set<string>()

  let i = 0
  while (i < blocks.length) {
    const block = blocks[i]
    if (!supportedTypes.has(block.type)) {
      skippedTypes.add(block.type)
      i++
      continue
    }

    let entity: DxfEntity | null = null

    switch (block.type) {
      case 'LINE':
        entity = parseLine(block)
        break
      case 'CIRCLE':
        entity = parseCircle(block)
        break
      case 'ARC':
        entity = parseArc(block)
        break
      case 'LWPOLYLINE':
        entity = parseLwPolyline(block)
        break
      case 'POLYLINE': {
        const result = parsePolylineClassic(block, blocks, i)
        entity = result.entity
        i += result.consumedCount // skip consumed VERTEX/SEQEND blocks
        break
      }
      case 'SPLINE':
        entity = parseSpline(block)
        warnings.push({ message: 'SPLINE linearized to polyline (approximation)', location: i })
        break
    }

    if (entity) {
      entities.push(entity)
      layerSet.add(entity.layer)
    }
    i++
  }

  for (const skipped of skippedTypes) {
    warnings.push({ message: `Unsupported entity type skipped: ${skipped}` })
  }

  return {
    entities,
    layers: Array.from(layerSet).sort(),
    units,
    warnings
  }
}

/**
 * Convert all geometry from inches to mm (multiply coordinates and radii by 25.4).
 * Mutates the result in place for efficiency.
 */
export function convertDxfToMm(result: DxfParseResult): void {
  if (result.units !== 'inches') return
  const factor = 25.4
  for (const e of result.entities) {
    switch (e.type) {
      case 'line':
        for (const p of e.points) {
          p.x *= factor
          p.y *= factor
        }
        break
      case 'circle':
        e.center.x *= factor
        e.center.y *= factor
        e.radius *= factor
        break
      case 'arc':
        e.center.x *= factor
        e.center.y *= factor
        e.radius *= factor
        break
      case 'polyline':
        for (const p of e.points) {
          p.x *= factor
          p.y *= factor
        }
        break
    }
  }
  result.units = 'mm'
}
