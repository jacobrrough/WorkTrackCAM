/**
 * G-code → Three.js toolpath segments for Shop preview (3-axis mill + 4-axis rotary).
 */
import * as THREE from 'three'

/** Must match rotation-axis height in buildFourAxisRig (mm). */
export const AXIS_Y_VIEW = 55

export const MAX_TOOLPATH_SEGS = 200_000

const LINEAR_EPS = 1e-6
const ANGLE_EPS = 1e-4

const MARK_TOOLPATH_START = '; --- 4-axis toolpath moves begin'
const MARK_TOOLPATH_END = '; --- end toolpath ---'

export interface ToolpathGeometry {
  rapids: THREE.BufferGeometry
  plunges: THREE.BufferGeometry
  cuts: THREE.BufferGeometry
  stats: { rapids: number; cuts: number; plunges: number; totalLines: number }
}

export type ParseGcodeToolpathOpts = {
  fourAxis?: boolean
  /** When true (default), treat files that contain A-axis words as rotary even if UI mode is 3-axis. */
  autoDetectRotaryFromGcode?: boolean
  stockLenMm?: number
  /** Override rotation-axis Y position in Three.js space (default: AXIS_Y_VIEW = 55). */
  axisYMm?: number
  /** Override rotation-axis Z position in Three.js space (default: 0). */
  axisZMm?: number
}

/** Slice posted 4-axis file to the toolpath block (drops header/footer rapids). */
export function extractFourAxisToolpathSection(text: string): string {
  const start = text.indexOf(MARK_TOOLPATH_START)
  const end = text.indexOf(MARK_TOOLPATH_END)
  if (start >= 0 && end > start) {
    return text.slice(start, end)
  }
  return text
}

/**
 * Grbl / compact posts sometimes emit `G0A45` (no space before A). Insert a space so
 * `\bA` word detection and A-word parsing match reliably.
 */
export function normalizeCompactAxisAWords(text: string): string {
  return text.replace(/(\d)(?=A\s*[-+]?\d)/gi, '$1 ')
}

/** Strip leading N#### line numbers (LinuxCNC / some posts) so G0/G1 detection works. */
export function stripLeadingLineNumber(line: string): string {
  let s = line.trim()
  for (;;) {
    const m = s.match(/^N\d+\s+/i)
    if (!m) break
    s = s.slice(m[0].length).trimStart()
  }
  return s
}

/** True if the text looks like a 4-axis (A-word) program. Prefer passing normalizeCompactAxisAWords(text) first. */
export function gcodeLooksLikeRotaryFourAxis(text: string): boolean {
  // 4-axis TS engine comments use "A=30.00°"; motion uses "G0 A30.000"
  if (/\bA\s*=\s*[-+]?\d/i.test(text)) return true
  if (/\bA\s*[-+]?\d/i.test(text)) return true
  if (/4-AXIS\s*\(\s*A-ROTARY\s*\)/i.test(text)) return true
  if (/grbl_4axis/i.test(text)) return true
  return false
}

function motionChanged(
  px: number,
  py: number,
  pz: number,
  pa: number,
  x: number,
  y: number,
  z: number,
  a: number
): boolean {
  return (
    Math.abs(px - x) > LINEAR_EPS ||
    Math.abs(py - y) > LINEAR_EPS ||
    Math.abs(pz - z) > LINEAR_EPS ||
    Math.abs(pa - a) > ANGLE_EPS
  )
}

/** Map G-code to Three.js line endpoints (3-axis swap or 4-axis cylinder about X). */
export function mapGcodeToThreeEndpoints(
  fourAxis: boolean,
  rotaryMap: boolean,
  stockLenMm: number,
  px: number,
  py: number,
  pz: number,
  pa: number,
  x: number,
  y: number,
  z: number,
  a: number,
  axisY = AXIS_Y_VIEW,
  axisZ = 0
): { a: THREE.Vector3; b: THREE.Vector3 } {
  const halfLen = Math.max(stockLenMm, 1) * 0.5
  if (fourAxis && rotaryMap) {
    const ar = (pa * Math.PI) / 180
    const br = (a * Math.PI) / 180
    const r0 = pz
    const r1 = z
    return {
      a: new THREE.Vector3(px - halfLen, axisY + r0 * Math.cos(ar), axisZ + py + r0 * Math.sin(ar)),
      b: new THREE.Vector3(x - halfLen, axisY + r1 * Math.cos(br), axisZ + y + r1 * Math.sin(br))
    }
  }
  if (fourAxis) {
    return {
      a: new THREE.Vector3(px - halfLen, axisY + pz, py),
      b: new THREE.Vector3(x - halfLen, axisY + z, y)
    }
  }
  return {
    a: new THREE.Vector3(px, pz, py),
    b: new THREE.Vector3(x, z, y)
  }
}

function pushLineBuffer(
  arr: number[],
  fourAxis: boolean,
  rotaryMap: boolean,
  stockLenMm: number,
  px: number,
  py: number,
  pz: number,
  pa: number,
  x: number,
  y: number,
  z: number,
  a: number,
  axisY = AXIS_Y_VIEW,
  axisZ = 0
): void {
  const { a: v0, b: v1 } = mapGcodeToThreeEndpoints(
    fourAxis,
    rotaryMap,
    stockLenMm,
    px,
    py,
    pz,
    pa,
    x,
    y,
    z,
    a,
    axisY,
    axisZ
  )
  arr.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z)
}

export function parseGcodeToolpath(text: string, opts?: ParseGcodeToolpathOpts): ToolpathGeometry {
  const stockLenMm = Math.max(20, opts?.stockLenMm ?? 100)
  const auto = opts?.autoDetectRotaryFromGcode !== false
  const normalizedFull = normalizeCompactAxisAWords(text)
  const looksRotary =
    gcodeLooksLikeRotaryFourAxis(normalizedFull)
  const fourAxisMode =
    opts?.fourAxis === true || (auto && looksRotary)
  let sliced = extractFourAxisToolpathSection(text)
  sliced = normalizeCompactAxisAWords(sliced)
  // Always use cylindrical (X, Y, Z, A) → Three.js when in 4-axis mode; at A=0° this matches the legacy flat rig map.
  const rotaryMap = fourAxisMode

  // ── Rotation-axis position in Three.js space ─────────────────────────
  // The 4th-axis rig (headstock, tailstock, stock cylinder) is rendered at
  // Y = AXIS_Y_VIEW (55 mm) in Three.js space.  The toolpath MUST be
  // visualised at the same position so it wraps around the rig.
  //
  // NOTE: The G-code comment "; Auto-centered mesh: offset Y=... Z=..."
  // contains the mesh centering *shift* (how far the mesh centroid was
  // from the rotation axis in raw STL space).  These are small values
  // (sub-mm to a few mm) and must NOT be used as the axis position —
  // doing so places the entire toolpath near the ground plane instead of
  // at the rig height, making it look flat/wrong.
  const axisY = opts?.axisYMm ?? AXIS_Y_VIEW
  const axisZ = opts?.axisZMm ?? 0

  const lines = sliced.split(/\r?\n/)
  let x = 0,
    y = 0,
    z = 0,
    a = 0
  let isAbsolute = true

  const rapidPts: number[] = []
  const plungePts: number[] = []
  const cutPts: number[] = []
  let totalSegs = 0

  for (const raw of lines) {
    if (totalSegs >= MAX_TOOLPATH_SEGS) break
    const line = stripLeadingLineNumber(raw.replace(/;.*$/, '').trim().toUpperCase())
    if (!line) continue

    if (/^G90\b/.test(line)) {
      isAbsolute = true
      continue
    }
    if (/^G91\b/.test(line)) {
      isAbsolute = false
      continue
    }

    const isG0 = /^G00\b/.test(line) || /^G0\b/.test(line)
    const isG1 = /^G01\b/.test(line) || /^G1\b/.test(line)
    if (!isG0 && !isG1) continue

    const px = x,
      py = y,
      pz = z,
      pa = a
    const xm = line.match(/\bX\s*(-?\d+(?:\.\d+)?)/)
    const ym = line.match(/\bY\s*(-?\d+(?:\.\d+)?)/)
    const zm = line.match(/\bZ\s*(-?\d+(?:\.\d+)?)/)
    const am =
      line.match(/\bA\s*([-+]?\d+(?:\.\d+)?)/) ?? line.match(/\bA\s*=\s*([-+]?\d+(?:\.\d+)?)/)
    if (xm) x = isAbsolute ? +xm[1]! : px + +xm[1]!
    if (ym) y = isAbsolute ? +ym[1]! : py + +ym[1]!
    if (zm) z = isAbsolute ? +zm[1]! : pz + +zm[1]!
    if (am && fourAxisMode) a = isAbsolute ? +am[1]! : pa + +am[1]!

    if (!motionChanged(px, py, pz, pa, x, y, z, a)) continue

    totalSegs++
    if (isG0) {
      // Interpolate large A rapids into arc segments so they follow the cylinder, not chord through it
      if (fourAxisMode && rotaryMap && Math.abs(a - pa) > 10) {
        const da = a - pa
        const arcSteps = Math.max(2, Math.ceil(Math.abs(da) / 10))
        for (let s = 0; s < arcSteps; s++) {
          const t0 = s / arcSteps
          const t1 = (s + 1) / arcSteps
          pushLineBuffer(rapidPts, fourAxisMode, rotaryMap, stockLenMm,
            px + (x - px) * t0, py + (y - py) * t0, pz + (z - pz) * t0, pa + da * t0,
            px + (x - px) * t1, py + (y - py) * t1, pz + (z - pz) * t1, pa + da * t1, axisY, axisZ)
          totalSegs++
        }
      } else {
        pushLineBuffer(rapidPts, fourAxisMode, rotaryMap, stockLenMm, px, py, pz, pa, x, y, z, a, axisY, axisZ)
      }
    } else if (fourAxisMode) {
      const dz = z - pz
      const horiz = Math.hypot(x - px, y - py)
      const da = a - pa
      const plungeDominant =
        Math.abs(dz) > horiz + 1e-4 && Math.abs(dz) > 1e-4 && Math.abs(da) <= ANGLE_EPS
      if (plungeDominant) {
        pushLineBuffer(plungePts, fourAxisMode, rotaryMap, stockLenMm, px, py, pz, pa, x, y, z, a, axisY, axisZ)
      } else if (Math.abs(da) > ANGLE_EPS || Math.abs(dz) > 1e-6 || horiz > 1e-6) {
        // Any A-axis rotation on G1 is a cutting move (angular stepover).
        // Interpolate large A moves into arc segments for correct cylindrical visualization.
        if (rotaryMap && Math.abs(da) > 5) {
          const arcSteps = Math.max(2, Math.ceil(Math.abs(da) / 5))
          for (let s = 0; s < arcSteps; s++) {
            const t0 = s / arcSteps
            const t1 = (s + 1) / arcSteps
            pushLineBuffer(cutPts, fourAxisMode, rotaryMap, stockLenMm,
              px + (x - px) * t0, py + (y - py) * t0, pz + (z - pz) * t0, pa + da * t0,
              px + (x - px) * t1, py + (y - py) * t1, pz + (z - pz) * t1, pa + da * t1, axisY, axisZ)
            totalSegs++
          }
        } else {
          pushLineBuffer(cutPts, fourAxisMode, rotaryMap, stockLenMm, px, py, pz, pa, x, y, z, a, axisY, axisZ)
        }
      } else {
        pushLineBuffer(rapidPts, fourAxisMode, rotaryMap, stockLenMm, px, py, pz, pa, x, y, z, a, axisY, axisZ)
      }
    } else {
      if (z < 0 && pz >= z) {
        pushLineBuffer(plungePts, fourAxisMode, rotaryMap, stockLenMm, px, py, pz, pa, x, y, z, a, axisY, axisZ)
      } else if (z < 0) {
        pushLineBuffer(cutPts, fourAxisMode, rotaryMap, stockLenMm, px, py, pz, pa, x, y, z, a, axisY, axisZ)
      } else {
        pushLineBuffer(rapidPts, fourAxisMode, rotaryMap, stockLenMm, px, py, pz, pa, x, y, z, a, axisY, axisZ)
      }
    }
  }

  function makeGeo(pts: number[]): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(pts), 3))
    return g
  }

  return {
    rapids: makeGeo(rapidPts),
    plunges: makeGeo(plungePts),
    cuts: makeGeo(cutPts),
    stats: {
      rapids: rapidPts.length / 6,
      plunges: plungePts.length / 6,
      cuts: cutPts.length / 6,
      totalLines: lines.length
    }
  }
}
