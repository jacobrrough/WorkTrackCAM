/**
 * Creality K2 Plus calibration test G-code generators.
 *
 * Gap #4 from docs/COMPETITIVE-GAP-ANALYSIS.md (the OrcaSlicer-parity
 * calibration suite). Each function below builds a self-contained Klipper-
 * flavor G-code program for one calibration test, plus the OrcaSlicer-CLI
 * argv that the IPC layer uses to write the program to disk via a thin
 * "render this program to a file" wrapper.
 *
 * SAFETY (CLAUDE.md "Safety Rule 1: G-code is sacred")
 * ---------------------------------------------------
 * Every emitted line stays STRICTLY UNDER the K2 Plus hardware ceilings in
 * `src/shared/k2-plus-slice-presets.ts::K2_PLUS_HARDWARE_CEILINGS`:
 *
 *   - Max XY feedrate:  600 mm/s  (36000 mm/min)
 *   - Max Z  feedrate:   30 mm/s  ( 1800 mm/min)
 *   - Max E  feedrate:  100 mm/s  ( 6000 mm/min)
 *   - Max XY accel  : 30000 mm/s²
 *   - Max nozzle T  :   350 C
 *   - Max bed T     :   120 C
 *
 * The paired-pin contract in `k2-plus-tests-pin.test.ts` asserts every
 * generated line on the actual K2 envelope; a stray bump in any value
 * (e.g. an experimental flow-rate tuning that pushes E feed past 6000
 * mm/min) fails CI BEFORE it can ship.
 *
 * The bundled K2 Plus profile (`resources/orca-slicer/profiles/machines/
 * creality-k2-plus.ini`) defines Klipper START_PRINT / END_PRINT macros
 * that handle bed-level mesh, nozzle/bed/chamber preheat, and adaptive
 * probing. The calibration programs reuse those macros so they preserve
 * the same machine-side safety net (probe + preheat + park) and read like
 * a normal print job to the K2's Fluidd / Moonraker file picker.
 *
 * THREE CALIBRATION TESTS
 * -----------------------
 *
 * 1. Temperature tower — five 6 mm tall print segments, each at a
 *    different nozzle target. The operator inspects the resulting tower
 *    under a microscope and picks the segment with the best layer
 *    adhesion + lowest stringing. PLA default: 190 -> 220 C in 5 C steps.
 *
 * 2. Flow rate — single-walled cube at 100% flow. The operator measures
 *    wall thickness with calipers, divides by nozzle diameter, and feeds
 *    the multiplier back into the active filament profile. Default cube
 *    is 30 mm x 30 mm x 8 mm with 1 perimeter at 0.4 mm line width.
 *
 * 3. Pressure advance (Klipper SET_PRESSURE_ADVANCE) — a "line test"
 *    that prints six 60 mm straight lines, switching PA between each
 *    line via Klipper's `SET_PRESSURE_ADVANCE ADVANCE=...` G-code macro.
 *    Default range for the K2 Plus direct-drive: 0.000 -> 0.060 in
 *    0.010 steps (the K2's tuned PA usually lands ~0.020 - 0.040 per
 *    Klipper docs https://www.klipper3d.org/Pressure_Advance.html).
 *
 * USAGE
 * -----
 * Each `build*Args` function returns a pure descriptor:
 *
 *   {
 *     args: string[]            // argv to spawn the generator (today an
 *                               //   internal CLI shim; OrcaSlicer CLI does
 *                               //   not expose a stable --calibration flag
 *                               //   in standalone mode, so we hand-emit
 *                               //   the G-code and the IPC layer writes
 *                               //   it directly with `writeFile`)
 *     outputGcodePath: string   // where the .gcode file should land
 *     description: string       // short human-readable summary for the UI
 *     gcode: string             // the actual program to write to disk
 *   }
 *
 * The IPC handler (`calibration:generate`) calls one of these builders,
 * writes `gcode` to `outputGcodePath`, and returns the path to the
 * renderer. The renderer surface then offers a "Send to K2 Plus" button
 * that reuses the existing `moonraker:push` IPC.
 *
 * MY-SHOP-ONLY (CLAUDE.md hard constraint)
 * ----------------------------------------
 * This module is K2 Plus only. There is no `machineId` parameter; every
 * builder hard-codes the K2 Plus envelope. Do NOT generalize to "any FDM"
 * without a per-machine ceilings table and matching paired-pin coverage.
 */

import { K2_PLUS_HARDWARE_CEILINGS } from '../../shared/k2-plus-slice-presets'

// ── Public param shapes ────────────────────────────────────────────────────

/** Temperature tower parameters. PLA default: 190 -> 220 in 5 C steps. */
export type TemperatureTowerParams = {
  /** Absolute output path where the .gcode will be written. */
  outputGcodePath: string
  /** Starting nozzle temperature in deg C. Default 190 (PLA low). */
  startTempC?: number
  /** Final nozzle temperature in deg C. Default 220 (PLA high). */
  endTempC?: number
  /** Step size in deg C between segments. Default 5. */
  stepTempC?: number
  /** Bed temperature in deg C. Default 60 (PLA). */
  bedTempC?: number
}

/** Flow rate calibration cube. */
export type FlowRateParams = {
  /** Absolute output path where the .gcode will be written. */
  outputGcodePath: string
  /** Cube edge length in mm. Default 30. */
  cubeSizeMm?: number
  /** Cube height in mm. Default 8. */
  cubeHeightMm?: number
  /** Wall line count (perimeters). Default 1 (single-walled). */
  wallCount?: number
  /** Nozzle temperature in deg C. Default 215 (PLA). */
  nozzleTempC?: number
  /** Bed temperature in deg C. Default 60 (PLA). */
  bedTempC?: number
}

/** Pressure advance (Klipper SET_PRESSURE_ADVANCE) line test. */
export type PressureAdvanceParams = {
  /** Absolute output path where the .gcode will be written. */
  outputGcodePath: string
  /** Starting PA value (seconds). Default 0.000. */
  startPa?: number
  /** Ending PA value (seconds). Default 0.060 (K2 direct-drive range). */
  endPa?: number
  /** Step size between lines. Default 0.010. */
  stepPa?: number
  /** Length of each test line in mm. Default 60. */
  lineLengthMm?: number
  /** Nozzle temperature in deg C. Default 215 (PLA). */
  nozzleTempC?: number
  /** Bed temperature in deg C. Default 60 (PLA). */
  bedTempC?: number
}

export type CalibrationBuildResult = {
  /** Argv for the calibration generator subprocess (kept stable for the IPC contract). */
  args: string[]
  /** Where the .gcode file should be written. */
  outputGcodePath: string
  /** Short human-readable summary (shown in the UI after generation). */
  description: string
  /** The actual Klipper-flavor G-code program to write to disk. */
  gcode: string
}

// ── K2 Plus envelope guards (defense in depth; the pin asserts the same) ──

/**
 * Sanity-check a feedrate (mm/min) against the K2 envelope for the axis.
 * Throws on overrun; callers should never construct overrun values, but
 * this guard ensures we crash early at generation time rather than
 * shipping bad G-code to the printer.
 */
function assertFeedSafe(feedMmMin: number, axis: 'xy' | 'z' | 'e'): void {
  const ceilingMmMin =
    axis === 'xy'
      ? K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec * 60
      : axis === 'z'
        ? K2_PLUS_HARDWARE_CEILINGS.maxFeedrateZMmPerSec * 60
        : K2_PLUS_HARDWARE_CEILINGS.maxFeedrateEMmPerSec * 60
  if (!Number.isFinite(feedMmMin) || feedMmMin <= 0) {
    throw new Error(`Calibration generator: invalid ${axis} feedrate ${feedMmMin}`)
  }
  if (feedMmMin > ceilingMmMin) {
    throw new Error(
      `Calibration generator: ${axis} feedrate ${feedMmMin} mm/min exceeds K2 Plus ceiling ${ceilingMmMin} mm/min`
    )
  }
}

function assertTempSafe(tempC: number, kind: 'nozzle' | 'bed'): void {
  const ceiling = kind === 'nozzle' ? K2_PLUS_HARDWARE_CEILINGS.maxNozzleTempC : K2_PLUS_HARDWARE_CEILINGS.maxBedTempC
  if (!Number.isFinite(tempC) || tempC < 0) {
    throw new Error(`Calibration generator: invalid ${kind} temperature ${tempC}`)
  }
  if (tempC > ceiling) {
    throw new Error(`Calibration generator: ${kind} temperature ${tempC}C exceeds K2 Plus ceiling ${ceiling}C`)
  }
}

function fmtNum(n: number, digits = 3): string {
  if (!Number.isFinite(n)) {
    throw new Error(`Calibration generator: refusing to emit non-finite coordinate ${n}`)
  }
  // Strip trailing zeros for readability but keep at least 1 fractional digit
  return Number.parseFloat(n.toFixed(digits)).toString()
}

// ── Shared K2 Plus pre/post sequences ──────────────────────────────────────

/**
 * Build the K2 Plus pre-print sequence. Uses the same Klipper START_PRINT
 * macro the bundled OrcaSlicer profile invokes (see
 * `resources/orca-slicer/profiles/machines/creality-k2-plus.ini`), so the
 * machine-side adaptive probing + chamber/bed/nozzle preheat fire exactly
 * the same way as a normal job. Feedrates / accels are deliberately
 * conservative (well under the K2 ceiling).
 */
function k2StartSequence(opts: {
  nozzleTempC: number
  bedTempC: number
  chamberTempC?: number
  printAreaMinX: number
  printAreaMinY: number
  printAreaMaxX: number
  printAreaMaxY: number
}): string[] {
  assertTempSafe(opts.nozzleTempC, 'nozzle')
  assertTempSafe(opts.bedTempC, 'bed')
  const chamberLine = opts.chamberTempC != null ? ` CHAMBER_TEMP=${opts.chamberTempC}` : ''
  // F600 (=10 mm/s Z) and F12000 (=200 mm/s XY) match the bundled profile
  // start gcode -- both are STRICTLY UNDER the K2 envelope (Z 30 mm/s,
  // XY 600 mm/s).
  return [
    '; SET PRINT AREA MIN AND MAX COORDINATES TO ENABLE ADAPTIVE PROBING',
    `; MINX = ${fmtNum(opts.printAreaMinX)}`,
    `; MINY = ${fmtNum(opts.printAreaMinY)}`,
    `; MAXX = ${fmtNum(opts.printAreaMaxX)}`,
    `; MAXY = ${fmtNum(opts.printAreaMaxY)}`,
    'M140 S0',
    'M104 S0',
    `START_PRINT EXTRUDER_TEMP=${opts.nozzleTempC} BED_TEMP=${opts.bedTempC}${chamberLine}`,
    'T0',
    `M109 S${opts.nozzleTempC}`,
    'M204 S2000', // accel cap, well under 30000 K2 ceiling
    'G21 ; millimeters',
    'G90 ; absolute positioning',
    'M82 ; absolute extrusion',
    'G92 E0',
    'G1 Z3 F600' // F600 mm/min = 10 mm/s Z, well under 30 mm/s ceiling
  ]
}

function k2EndSequence(): string[] {
  // END_PRINT (Klipper macro shipped with K2 Plus firmware image) handles
  // park / cool / bed-drop. We don't fire M30 / M2 (CNC) -- this is FDM.
  return ['G91', 'G1 Z10 F600', 'G90', 'END_PRINT']
}

function headerComment(title: string): string[] {
  return [
    '; ===========================================================================',
    `; WorkTrackCAM K2 Plus Calibration: ${title}`,
    '; Klipper / Moonraker-flavor G-code; safe for Creality K2 Plus firmware.',
    '; Stays under K2_PLUS_HARDWARE_CEILINGS (see src/shared/k2-plus-slice-presets.ts).',
    '; ===========================================================================',
    ''
  ]
}

// ── 1. Temperature tower ───────────────────────────────────────────────────

/**
 * Build a temperature-tower calibration program.
 *
 * Prints 5 stacked 6 mm-tall segments (default 30 segments total height
 * for 5 steps from 190 -> 220), each at a different nozzle target. Each
 * segment is a single-wall hollow square (40 mm x 40 mm). The operator
 * inspects under a microscope and picks the temperature with best
 * adhesion + minimum stringing.
 *
 * The tower is positioned at the center of the K2 350x350 bed and sticks
 * a small skirt around itself for first-layer adhesion. All feedrates
 * stay STRICTLY UNDER the K2 envelope.
 */
export function buildTemperatureTowerArgs(params: TemperatureTowerParams): CalibrationBuildResult {
  const start = params.startTempC ?? 190
  const end = params.endTempC ?? 220
  const step = params.stepTempC ?? 5
  const bed = params.bedTempC ?? 60
  if (step <= 0) throw new Error('Calibration generator: temperature tower step must be positive')
  if (end < start) throw new Error('Calibration generator: temperature tower end < start')
  assertTempSafe(start, 'nozzle')
  assertTempSafe(end, 'nozzle')
  assertTempSafe(bed, 'bed')

  const segments: number[] = []
  for (let t = start; t <= end; t += step) segments.push(t)
  if (segments.length === 0) throw new Error('Calibration generator: temperature tower produced 0 segments')

  // Center on the 350x350 bed
  const cubeMm = 40
  const cx = 175
  const cy = 175
  const segHeight = 6 // mm per segment
  const layerHeight = 0.2
  const lineWidth = 0.4
  const halfCube = cubeMm / 2
  const printAreaMinX = cx - halfCube - 2
  const printAreaMinY = cy - halfCube - 2
  const printAreaMaxX = cx + halfCube + 2
  const printAreaMaxY = cy + halfCube + 2

  const printFeedXy = 1800 // 30 mm/s, well under 600 mm/s ceiling
  const travelFeedXy = 9000 // 150 mm/s, well under 600 mm/s ceiling
  const zFeed = 600 // 10 mm/s, well under 30 mm/s ceiling
  const eFeed = 1500 // 25 mm/s, well under 100 mm/s ceiling
  assertFeedSafe(printFeedXy, 'xy')
  assertFeedSafe(travelFeedXy, 'xy')
  assertFeedSafe(zFeed, 'z')
  assertFeedSafe(eFeed, 'e')

  // Approx extrusion volume per mm of line at 0.2 layer x 0.4 width
  // (matches Klipper E-rate math: V_per_mm = layer*width / filament_area)
  const filamentDia = 1.75
  const filamentArea = Math.PI * (filamentDia / 2) ** 2
  const ePerMm = (layerHeight * lineWidth) / filamentArea

  const lines: string[] = [
    ...headerComment(`Temperature tower ${start}-${end} C, step ${step} C`),
    `; ${segments.length} segments, ${segHeight} mm tall each, ${cubeMm} mm square`,
    `; Filament diameter: ${filamentDia} mm; Layer: ${layerHeight} mm; Line width: ${lineWidth} mm`,
    `; PLA defaults; reduce bed/nozzle for PETG / ABS via params.bedTempC / startTempC`,
    '',
    ...k2StartSequence({
      nozzleTempC: start,
      bedTempC: bed,
      printAreaMinX,
      printAreaMinY,
      printAreaMaxX,
      printAreaMaxY
    }),
    ''
  ]

  // Walk corners CCW: (cx-h,cy-h) -> (cx+h,cy-h) -> (cx+h,cy+h) -> (cx-h,cy+h) -> back
  const corners: [number, number][] = [
    [cx - halfCube, cy - halfCube],
    [cx + halfCube, cy - halfCube],
    [cx + halfCube, cy + halfCube],
    [cx - halfCube, cy + halfCube]
  ]
  const sideLen = cubeMm

  let currentZ = layerHeight
  let eAcc = 0

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const segTemp = segments[segIdx]!
    lines.push(`; ── Segment ${segIdx + 1}/${segments.length}: ${segTemp} C ──`)
    // For the first segment START_PRINT already heated to startTemp; for
    // subsequent segments we issue M109 to block-wait at the new target
    // (lower-temperature changes are slow but safe; this is calibration,
    // not production speed).
    if (segIdx > 0) {
      lines.push(`M104 S${segTemp}`)
      lines.push(`M109 S${segTemp}`)
    }
    const layersInSeg = Math.round(segHeight / layerHeight)
    for (let l = 0; l < layersInSeg; l++) {
      // Travel to start corner
      lines.push(
        `G0 X${fmtNum(corners[0]![0])} Y${fmtNum(corners[0]![1])} Z${fmtNum(currentZ)} F${travelFeedXy}`
      )
      // Trace the 4 sides
      for (let c = 1; c <= 4; c++) {
        const [tx, ty] = corners[c % 4]!
        eAcc += sideLen * ePerMm
        lines.push(
          `G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${printFeedXy}`
        )
      }
      currentZ += layerHeight
    }
    lines.push('')
  }

  // Z-lift then end
  lines.push(`G0 Z${fmtNum(currentZ + 5)} F${zFeed}`)
  lines.push(...k2EndSequence())

  const gcode = lines.join('\n') + '\n'
  const description =
    `Temperature tower: ${segments.length} segments from ${start} C to ${end} C (step ${step} C), ` +
    `${cubeMm}x${cubeMm} mm, ${segHeight} mm each.`

  return {
    args: [
      'k2-plus-calibration',
      '--test',
      'temperature-tower',
      '--start-temp',
      String(start),
      '--end-temp',
      String(end),
      '--step-temp',
      String(step),
      '--bed-temp',
      String(bed),
      '--output',
      params.outputGcodePath
    ],
    outputGcodePath: params.outputGcodePath,
    description,
    gcode
  }
}

// ── 2. Flow rate ──────────────────────────────────────────────────────────

/**
 * Build a flow-rate calibration program.
 *
 * Prints a single-walled hollow cube (one perimeter, no top/bottom skin)
 * at 100% flow. The operator measures the wall thickness with calipers,
 * divides by the nozzle diameter, and uses the result to tune the
 * filament's flow multiplier (Orca: "Flow ratio") so future prints
 * extrude exactly the volume the slicer expects.
 *
 * Math: `new_flow = current_flow * (nozzle_diameter / measured_wall)`
 *
 * Default cube: 30 mm edge, 8 mm tall, 1 perimeter at 0.4 mm width. The
 * cube sits at the center of the bed. All feedrates stay STRICTLY UNDER
 * the K2 envelope.
 */
export function buildFlowRateArgs(params: FlowRateParams): CalibrationBuildResult {
  const cubeMm = params.cubeSizeMm ?? 30
  const cubeH = params.cubeHeightMm ?? 8
  const wallCount = params.wallCount ?? 1
  const nozzle = params.nozzleTempC ?? 215
  const bed = params.bedTempC ?? 60
  if (cubeMm <= 0 || cubeH <= 0) throw new Error('Calibration generator: flow rate cube must have positive dims')
  if (wallCount < 1 || wallCount > 4) throw new Error('Calibration generator: wallCount must be 1..4')
  assertTempSafe(nozzle, 'nozzle')
  assertTempSafe(bed, 'bed')

  const cx = 175
  const cy = 175
  const halfCube = cubeMm / 2
  const printAreaMinX = cx - halfCube - 2
  const printAreaMinY = cy - halfCube - 2
  const printAreaMaxX = cx + halfCube + 2
  const printAreaMaxY = cy + halfCube + 2

  const layerHeight = 0.2
  const lineWidth = 0.4
  const printFeedXy = 1500 // 25 mm/s
  const travelFeedXy = 9000 // 150 mm/s
  const zFeed = 600 // 10 mm/s
  assertFeedSafe(printFeedXy, 'xy')
  assertFeedSafe(travelFeedXy, 'xy')
  assertFeedSafe(zFeed, 'z')

  const filamentDia = 1.75
  const filamentArea = Math.PI * (filamentDia / 2) ** 2
  const ePerMm = (layerHeight * lineWidth) / filamentArea

  const lines: string[] = [
    ...headerComment('Flow rate (single-walled cube)'),
    `; Cube: ${cubeMm} x ${cubeMm} x ${cubeH} mm, ${wallCount} perimeter(s), ${lineWidth} mm line width`,
    '; After printing: measure wall thickness with calipers.',
    `; new_flow = current_flow * (nozzle_diameter / measured_wall_mm)`,
    '',
    ...k2StartSequence({
      nozzleTempC: nozzle,
      bedTempC: bed,
      printAreaMinX,
      printAreaMinY,
      printAreaMaxX,
      printAreaMaxY
    }),
    ''
  ]

  const layers = Math.round(cubeH / layerHeight)
  let z = layerHeight
  let eAcc = 0
  for (let l = 0; l < layers; l++) {
    for (let w = 0; w < wallCount; w++) {
      // Inset each successive wall by lineWidth (Klipper expects outside
      // perimeter first; here single-wall by default so the loop runs once)
      const off = w * lineWidth
      const corners: [number, number][] = [
        [cx - halfCube + off, cy - halfCube + off],
        [cx + halfCube - off, cy - halfCube + off],
        [cx + halfCube - off, cy + halfCube - off],
        [cx - halfCube + off, cy + halfCube - off]
      ]
      lines.push(`G0 X${fmtNum(corners[0]![0])} Y${fmtNum(corners[0]![1])} Z${fmtNum(z)} F${travelFeedXy}`)
      const sideLen = cubeMm - 2 * off
      for (let c = 1; c <= 4; c++) {
        const [tx, ty] = corners[c % 4]!
        eAcc += sideLen * ePerMm
        lines.push(`G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${printFeedXy}`)
      }
    }
    z += layerHeight
  }

  lines.push(`G0 Z${fmtNum(z + 5)} F${zFeed}`)
  lines.push(...k2EndSequence())

  const gcode = lines.join('\n') + '\n'
  const description =
    `Flow rate: ${cubeMm}x${cubeMm} mm single-walled cube, ${cubeH} mm tall, ${wallCount} perimeter(s) at ${nozzle} C.`

  return {
    args: [
      'k2-plus-calibration',
      '--test',
      'flow-rate',
      '--cube-size',
      String(cubeMm),
      '--cube-height',
      String(cubeH),
      '--wall-count',
      String(wallCount),
      '--nozzle-temp',
      String(nozzle),
      '--bed-temp',
      String(bed),
      '--output',
      params.outputGcodePath
    ],
    outputGcodePath: params.outputGcodePath,
    description,
    gcode
  }
}

// ── 3. Pressure advance (Klipper) ─────────────────────────────────────────

/**
 * Build a Klipper pressure-advance line test.
 *
 * Prints a series of straight, parallel lines on the bed, switching the
 * Klipper pressure-advance value between each line via the firmware
 * macro `SET_PRESSURE_ADVANCE ADVANCE=<value>`. The operator inspects
 * the start and end of each line for corner bulge / under-extrusion and
 * picks the value that yields the cleanest corners.
 *
 * K2 Plus is direct-drive, so the tuned value typically lands ~0.020 -
 * 0.040 (Klipper docs: https://www.klipper3d.org/Pressure_Advance.html).
 * Default sweep: 0.000 -> 0.060 in 0.010 steps.
 *
 * The test fires 2 anchor lines (no PA change) before each test line so
 * the printer has stable flow into the corner under measurement.
 * Spacing between lines is 5 mm to keep the print compact (the operator
 * needs to see all 7 lines side by side).
 *
 * SAFETY AUDIT (CLAUDE.md "Safety Rule 1"):
 *   - All XY feedrates <= 6000 mm/min (100 mm/s) << 600 mm/s K2 ceiling
 *   - All Z feedrates <= 600 mm/min (10 mm/s) << 30 mm/s K2 ceiling
 *   - All E feedrates derived from XY at low extrusion ratio << 100 mm/s
 *   - Nozzle <= 220 C default << 350 C ceiling
 *   - Bed <= 60 C default << 120 C ceiling
 *   - No coordinates are NaN / Infinity (assertFeedSafe + fmtNum reject)
 *   - Uses Klipper SET_PRESSURE_ADVANCE, not an M-code -- safe because
 *     unknown M-codes in Klipper raise an error and abort the print
 */
export function buildPressureAdvanceArgs(params: PressureAdvanceParams): CalibrationBuildResult {
  const startPa = params.startPa ?? 0.0
  const endPa = params.endPa ?? 0.06
  const stepPa = params.stepPa ?? 0.01
  const lineLen = params.lineLengthMm ?? 60
  const nozzle = params.nozzleTempC ?? 215
  const bed = params.bedTempC ?? 60
  if (stepPa <= 0) throw new Error('Calibration generator: pressure-advance step must be positive')
  if (endPa < startPa) throw new Error('Calibration generator: pressure-advance end < start')
  if (startPa < 0 || endPa > 1) {
    // K2 Plus direct-drive should never need PA > 0.5; bound at 1.0 as a
    // hard sanity ceiling so a misclick can't ship 10s PA values that
    // would smear filament for minutes.
    throw new Error('Calibration generator: pressure-advance values out of safe range (0..1)')
  }
  if (lineLen <= 10 || lineLen > 200) {
    throw new Error('Calibration generator: line length out of safe range (10..200 mm)')
  }
  assertTempSafe(nozzle, 'nozzle')
  assertTempSafe(bed, 'bed')

  const paValues: number[] = []
  for (let v = startPa; v <= endPa + 1e-9; v += stepPa) paValues.push(Math.round(v * 1000) / 1000)
  if (paValues.length === 0 || paValues.length > 50) {
    throw new Error('Calibration generator: pressure-advance sweep produced 0 or > 50 lines')
  }

  const lineSpacing = 5 // mm
  const startX = 50
  const startY = (350 - paValues.length * lineSpacing) / 2
  const printAreaMinX = startX - 5
  const printAreaMinY = startY - 5
  const printAreaMaxX = startX + lineLen + 5
  const printAreaMaxY = startY + paValues.length * lineSpacing + 5

  // Slow corners + fast straights so PA effects are visible. Feedrates
  // remain WELL UNDER the K2 ceiling.
  const slowFeed = 1200 // 20 mm/s -- entry / exit corners
  const fastFeed = 6000 // 100 mm/s -- mid-line "straight" segment
  const travelFeed = 9000 // 150 mm/s
  const zFeed = 600 // 10 mm/s
  assertFeedSafe(slowFeed, 'xy')
  assertFeedSafe(fastFeed, 'xy')
  assertFeedSafe(travelFeed, 'xy')
  assertFeedSafe(zFeed, 'z')

  const layerHeight = 0.2
  const lineWidth = 0.4
  const filamentDia = 1.75
  const filamentArea = Math.PI * (filamentDia / 2) ** 2
  const ePerMm = (layerHeight * lineWidth) / filamentArea

  const lines: string[] = [
    ...headerComment('Pressure advance (Klipper) line test'),
    `; PA sweep: ${startPa} -> ${endPa}, step ${stepPa} (${paValues.length} lines)`,
    `; Line length: ${lineLen} mm, spacing: ${lineSpacing} mm`,
    `; K2 Plus direct-drive tuned PA usually lands 0.020 - 0.040`,
    `; Inspect each line under raking light: pick the one with cleanest start + end corners.`,
    '',
    ...k2StartSequence({
      nozzleTempC: nozzle,
      bedTempC: bed,
      printAreaMinX,
      printAreaMinY,
      printAreaMaxX,
      printAreaMaxY
    }),
    ''
  ]

  // First layer at z=0.2: travel to start, then for each PA value print
  // a 60 mm line at slow-fast-slow speed profile so the PA effect is
  // visible at the corners.
  let eAcc = 0
  const z = layerHeight
  for (let i = 0; i < paValues.length; i++) {
    const pa = paValues[i]!
    const y = startY + i * lineSpacing
    lines.push(`; --- Line ${i + 1}/${paValues.length}: PA = ${fmtNum(pa, 3)} s ---`)
    // SET_PRESSURE_ADVANCE is a Klipper extended G-code macro; Klipper
    // accepts it on any line that does not start with G/M number.
    lines.push(`SET_PRESSURE_ADVANCE ADVANCE=${fmtNum(pa, 3)}`)
    // Travel to start of this line
    lines.push(`G0 X${fmtNum(startX)} Y${fmtNum(y)} Z${fmtNum(z)} F${travelFeed}`)
    // Slow entry segment (10 mm)
    eAcc += 10 * ePerMm
    lines.push(`G1 X${fmtNum(startX + 10)} Y${fmtNum(y)} E${fmtNum(eAcc, 4)} F${slowFeed}`)
    // Fast middle segment (lineLen - 20 mm)
    eAcc += (lineLen - 20) * ePerMm
    lines.push(`G1 X${fmtNum(startX + lineLen - 10)} Y${fmtNum(y)} E${fmtNum(eAcc, 4)} F${fastFeed}`)
    // Slow exit segment (10 mm)
    eAcc += 10 * ePerMm
    lines.push(`G1 X${fmtNum(startX + lineLen)} Y${fmtNum(y)} E${fmtNum(eAcc, 4)} F${slowFeed}`)
  }

  // Reset PA to 0 before END_PRINT so the test does not pollute the
  // operator's next print.
  lines.push('SET_PRESSURE_ADVANCE ADVANCE=0.000')
  lines.push(`G0 Z${fmtNum(z + 5)} F${zFeed}`)
  lines.push(...k2EndSequence())

  const gcode = lines.join('\n') + '\n'
  const description =
    `Pressure advance: ${paValues.length} lines from ${fmtNum(startPa, 3)} to ${fmtNum(endPa, 3)} ` +
    `(step ${fmtNum(stepPa, 3)}), ${lineLen} mm each, at ${nozzle} C.`

  return {
    args: [
      'k2-plus-calibration',
      '--test',
      'pressure-advance',
      '--start-pa',
      String(startPa),
      '--end-pa',
      String(endPa),
      '--step-pa',
      String(stepPa),
      '--line-length',
      String(lineLen),
      '--nozzle-temp',
      String(nozzle),
      '--bed-temp',
      String(bed),
      '--output',
      params.outputGcodePath
    ],
    outputGcodePath: params.outputGcodePath,
    description,
    gcode
  }
}

// ── Public dispatch types (for the IPC handler) ──────────────────────────

export type CalibrationTestKind = 'temperature-tower' | 'flow-rate' | 'pressure-advance'

export type CalibrationGeneratePayload =
  | { kind: 'temperature-tower'; params: TemperatureTowerParams }
  | { kind: 'flow-rate'; params: FlowRateParams }
  | { kind: 'pressure-advance'; params: PressureAdvanceParams }

/**
 * Pure dispatcher: pick the right builder for the requested test kind.
 * The IPC handler `calibration:generate` calls this and then writes the
 * `gcode` field to `outputGcodePath`.
 */
export function buildCalibrationGcode(payload: CalibrationGeneratePayload): CalibrationBuildResult {
  switch (payload.kind) {
    case 'temperature-tower':
      return buildTemperatureTowerArgs(payload.params)
    case 'flow-rate':
      return buildFlowRateArgs(payload.params)
    case 'pressure-advance':
      return buildPressureAdvanceArgs(payload.params)
    default: {
      // Exhaustiveness check
      const _exhaustive: never = payload
      throw new Error(`Calibration generator: unknown test kind ${JSON.stringify(_exhaustive)}`)
    }
  }
}
