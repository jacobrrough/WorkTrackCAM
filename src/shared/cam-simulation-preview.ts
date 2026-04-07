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
}

type AxisState = {
  x: number
  y: number
  z: number
}

const PREVIEW_DISCLAIMER =
  'Text-only G-code stats (not stock removal, collisions, or machine motion). Not safe-for-machine verification — confirm post, units, work offsets, and clearances before running hardware.'

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!/^(G0|G1)\b/.test(line)) continue
    motionLines += 1
    const x = readAxis(line, 'X')
    const y = readAxis(line, 'Y')
    const z = readAxis(line, 'Z')
    if (x != null) state.x = x
    if (y != null) state.y = y
    if (z != null) state.z = z
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
    disclaimer: PREVIEW_DISCLAIMER
  }
}
