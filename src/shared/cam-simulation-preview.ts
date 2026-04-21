export type CamSimulationCue = {
  progressPct: number
  message: string
}

export type CamSimulationPreview = {
  totalLines: number
  motionLines: number
  cuttingMoves: number
  xyBounds: { minX: number; maxX: number; minY: number; maxY: number } | null
  zRange: { topZ: number; bottomZ: number } | null
  cues: CamSimulationCue[]
  disclaimer: string
  /**
   * Naive motion-time lower bound from G0/G1 polyline length ÷ F (or defaults).
   * Not cycle time — see `heuristicMotionNote`.
   */
  heuristicMotionMinutes: number | null
  /** Sum of 3D segment lengths for G0+G1 (mm). */
  heuristicMotionPathMm: number | null
  heuristicMotionNote: string
}

type AxisState = {
  x: number
  y: number
  z: number
}

const PREVIEW_DISCLAIMER =
  'Text-only G-code stats (not stock removal, collisions, or machine motion). Not safe-for-machine verification — confirm post, units, work offsets, and clearances before running hardware.'

const HEURISTIC_MOTION_NOTE =
  'Rough motion-time estimate from G0/G1 segment lengths and inline F words (1200 mm/min default when F is missing on a feed move). Uses 6000 mm/min for G0. Ignores acceleration, dwell, tool change, spindle, and rotary/sync axes. Not shop-floor cycle time.'

const DEFAULT_HEURISTIC_FEED_MM_MIN = 1200
const DEFAULT_HEURISTIC_RAPID_MM_MIN = 6000

function readFeedF(line: string): number | null {
  const clean = line.replace(/\([^)]*\)/g, '')
  const m = clean.match(/\bF([+-]?\d+(?:\.\d+)?)\b/i)
  if (!m) return null
  const n = Number.parseFloat(m[1] ?? '')
  return Number.isFinite(n) && n > 0 ? n : null
}

function readAxis(line: string, axis: 'X' | 'Y' | 'Z'): number | null {
  // Strip inline parenthetical comments before matching (same fix as cam-gcode-toolpath.ts)
  // to avoid false hits like "G1 X10 (Y-5 ref) Y20" returning Y=-5 from inside the comment.
  const clean = line.replace(/\([^)]*\)/g, '')
  // Allow an explicit leading '+' in addition to '-' — Fanuc/Heidenhain posts often emit X+10.5.
  const m = clean.match(new RegExp(`${axis}([+-]?\\d+(?:\\.\\d+)?)`))
  if (!m) return null
  const n = Number.parseFloat(m[1] ?? '')
  return Number.isFinite(n) ? n : null
}

export function buildCamSimulationPreview(gcode: string, cueCount = 5): CamSimulationPreview {
  const lines = gcode
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith(';'))

  const state: AxisState = { x: 0, y: 0, z: 0 }
  let motionLines = 0
  let cuttingMoves = 0
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let topZ = Number.NEGATIVE_INFINITY
  let bottomZ = Number.POSITIVE_INFINITY
  const cuttingMoveIndices: number[] = []
  let heuristicPathMm = 0
  let heuristicTimeMin = 0
  let lastFeedMmMin = DEFAULT_HEURISTIC_FEED_MM_MIN

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!/^(G0|G1)\b/.test(line)) continue
    motionLines += 1
    const fHere = readFeedF(line)
    if (fHere != null) lastFeedMmMin = fHere
    const prevX = state.x
    const prevY = state.y
    const prevZ = state.z
    const x = readAxis(line, 'X')
    const y = readAxis(line, 'Y')
    const z = readAxis(line, 'Z')
    if (x != null) state.x = x
    if (y != null) state.y = y
    if (z != null) state.z = z
    const dx = state.x - prevX
    const dy = state.y - prevY
    const dz = state.z - prevZ
    const dist = Math.hypot(dx, dy, dz)
    if (dist > 0) {
      heuristicPathMm += dist
      const rapid = line.startsWith('G0')
      const fUse = rapid ? DEFAULT_HEURISTIC_RAPID_MM_MIN : lastFeedMmMin
      if (fUse > 0) {
        heuristicTimeMin += dist / fUse
      }
    }
    minX = Math.min(minX, state.x)
    maxX = Math.max(maxX, state.x)
    minY = Math.min(minY, state.y)
    maxY = Math.max(maxY, state.y)
    topZ = Math.max(topZ, state.z)
    bottomZ = Math.min(bottomZ, state.z)
    if (line.startsWith('G1') && state.z < 0) {
      cuttingMoves += 1
      cuttingMoveIndices.push(i)
    }
  }

  const cues: CamSimulationCue[] = []
  if (cuttingMoveIndices.length > 0) {
    const lastIndex = Math.max(1, cuttingMoveIndices.length - 1)
    const samples = Math.max(1, Math.min(cueCount, cuttingMoveIndices.length))
    for (let i = 0; i < samples; i++) {
      const idx = Math.round((i / Math.max(1, samples - 1)) * lastIndex)
      const moveIdx = cuttingMoveIndices[idx]!
      const progressPct = Math.round(((idx + 1) / cuttingMoveIndices.length) * 100)
      if (i === 0) {
        cues.push({ progressPct, message: 'Tool enters stock (first detected G1 move below Z0).' })
      } else if (i === samples - 1) {
        cues.push({ progressPct, message: 'Final sampled cutting pass in preview timeline.' })
      } else {
        cues.push({
          progressPct,
          message: `Cutting pass sample near line ${moveIdx + 1}, showing evolving path coverage.`
        })
      }
    }
  } else if (motionLines > 0) {
    cues.push({
      progressPct: 100,
      message: 'No below-Z0 cutting moves detected; preview reflects rapid/traverse motion only.'
    })
  }

  const hasHeuristic = motionLines > 0 && heuristicPathMm > 0

  return {
    totalLines: lines.length,
    motionLines,
    cuttingMoves,
    xyBounds:
      Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY)
        ? { minX, maxX, minY, maxY }
        : null,
    zRange: Number.isFinite(topZ) && Number.isFinite(bottomZ) ? { topZ, bottomZ } : null,
    cues,
    disclaimer: PREVIEW_DISCLAIMER,
    heuristicMotionMinutes: hasHeuristic ? heuristicTimeMin : null,
    heuristicMotionPathMm: hasHeuristic ? heuristicPathMm : null,
    heuristicMotionNote: HEURISTIC_MOTION_NOTE
  }
}
