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
 * creality-k2-plus.json`) defines Klipper START_PRINT / END_PRINT macros
 * that handle bed-level mesh, nozzle/bed/chamber preheat, and adaptive
 * probing. The calibration programs reuse those macros so they preserve
 * the same machine-side safety net (probe + preheat + park) and read like
 * a normal print job to the K2's Fluidd / Moonraker file picker.
 *
 * EIGHT CALIBRATION TESTS
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
 * 4. Retraction tower — two square pillars separated by ~30 mm with the
 *    slicer filling the gap with travel moves. Sweep retraction distance
 *    0.0 -> 2.0 mm in 0.2 mm steps via Klipper's runtime firmware
 *    retract macro `SET_RETRACTION RETRACT_LENGTH=...`. Operator looks
 *    at stringing in the gap and picks the shortest distance that gives
 *    a clean inter-pillar field.
 *
 * 5. Max volumetric flow — single-wall tube extruded at progressively
 *    increasing volumetric flow rate (mm³/s). Operator looks for the
 *    onset of under-extrusion / poor surface to set the per-filament
 *    `filament_max_volumetric_speed`. Default sweep 5 -> 30 mm³/s in
 *    2 mm³/s steps.
 *
 * 6. Tolerance / dimensional accuracy — calibration cube (known X/Y/Z)
 *    plus a row of peg + matching hole pairs at known +0.0 / +0.1 / +0.2
 *    / +0.3 mm clearance. Operator measures cube dims with calipers,
 *    nominates an XY scaling factor, and uses the tightest peg/hole pair
 *    that slips together to dial in printer-specific hole compensation.
 *
 * 7. Cornering / jerk — square traced at varying Klipper
 *    `SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=...` settings. Sweep
 *    SCV 4 -> 9 mm/s in 1 mm/s steps (9 mm/s is the K2 ceiling). Operator
 *    looks for ringing artifacts; picks the highest SCV with no visible
 *    ghosting. RESETS SCV to a safe default on END so the test does not
 *    pollute the next job.
 *
 * 8. VFA (vertical fine artifacts) — tall single-walled tube at modest
 *    constant speed (default 60 mm/s, 50 mm tall) used to diagnose
 *    Z-banding, XY-belt resonance, and microstep issues. Operator looks
 *    for visible ribs / waves on the wall.
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

/** Retraction tower (Klipper SET_RETRACTION) two-pillar stringing test. */
export type RetractionTowerParams = {
  /** Absolute output path where the .gcode will be written. */
  outputGcodePath: string
  /** Starting retraction distance (mm). Default 0.0. */
  startRetractMm?: number
  /** Ending retraction distance (mm). Default 2.0. */
  endRetractMm?: number
  /** Step size (mm). Default 0.2 (=> 11 segments at default range). */
  stepRetractMm?: number
  /** Per-band stack height (mm). Default 5 mm (each retraction value gets 5 mm Z). */
  bandHeightMm?: number
  /** Gap between the two pillars (mm). Default 30. */
  pillarGapMm?: number
  /** Pillar edge length (mm). Default 10. */
  pillarSizeMm?: number
  /** Retraction speed (mm/s). Default 40 (K2 direct-drive standard). */
  retractSpeedMmPerSec?: number
  /** Nozzle temperature in deg C. Default 215 (PLA). */
  nozzleTempC?: number
  /** Bed temperature in deg C. Default 60 (PLA). */
  bedTempC?: number
}

/** Max volumetric flow tube test. */
export type MaxVolumetricFlowParams = {
  /** Absolute output path where the .gcode will be written. */
  outputGcodePath: string
  /** Starting volumetric flow rate (mm^3/s). Default 5. */
  startFlowMmCubePerSec?: number
  /** Ending volumetric flow rate (mm^3/s). Default 30. */
  endFlowMmCubePerSec?: number
  /** Step size (mm^3/s). Default 2 (=> 13 bands at default range). */
  stepFlowMmCubePerSec?: number
  /** Per-band stack height (mm). Default 5 mm. */
  bandHeightMm?: number
  /** Tube outer diameter (mm). Default 30. */
  tubeDiameterMm?: number
  /** Nozzle temperature in deg C. Default 215 (PLA). */
  nozzleTempC?: number
  /** Bed temperature in deg C. Default 60 (PLA). */
  bedTempC?: number
  /**
   * Filament density (g/cm^3). Default 1.24 (PLA). Carried for documentation
   * and the header comment only -- the volumetric calculation uses filament
   * cross-section area so density does not enter the speed math.
   */
  filamentDensity?: number
}

/** Tolerance / dimensional accuracy cube + peg-hole pairs. */
export type ToleranceTestParams = {
  /** Absolute output path where the .gcode will be written. */
  outputGcodePath: string
  /** Reference cube edge length (mm). Default 20. */
  cubeSizeMm?: number
  /** Number of peg/hole pairs in the comb. Default 4. */
  pegHoleCount?: number
  /**
   * Base hole diameter (mm). The first hole matches a peg of this exact
   * diameter; subsequent holes step up by +0.1 mm each. Default 4.0 mm.
   */
  holeBaseDiameterMm?: number
  /** Per-pair clearance step (mm). Default 0.1. */
  clearanceStepMm?: number
  /** Nozzle temperature in deg C. Default 215 (PLA). */
  nozzleTempC?: number
  /** Bed temperature in deg C. Default 60 (PLA). */
  bedTempC?: number
}

/** Cornering / square-corner-velocity (input shaping headroom) sweep. */
export type CorneringTestParams = {
  /** Absolute output path where the .gcode will be written. */
  outputGcodePath: string
  /** Starting SCV in mm/s. Default 4. */
  startScvMmPerSec?: number
  /** Ending SCV in mm/s. Default 9 (K2 ceiling -- maxJerkXyMmPerSec). */
  endScvMmPerSec?: number
  /** Step size (mm/s). Default 1 (=> 6 bands at default range). */
  stepScvMmPerSec?: number
  /** Per-band stack height (mm). Default 5 mm. */
  bandHeightMm?: number
  /** Square edge length (mm). Default 40. */
  squareSizeMm?: number
  /** Print speed for the square sides (mm/s). Default 150. */
  printSpeedMmPerSec?: number
  /** Nozzle temperature in deg C. Default 215 (PLA). */
  nozzleTempC?: number
  /** Bed temperature in deg C. Default 60 (PLA). */
  bedTempC?: number
}

/** Vertical fine artifacts (Z-banding / belt-resonance) tall tube. */
export type VfaTestParams = {
  /** Absolute output path where the .gcode will be written. */
  outputGcodePath: string
  /** Tube outer diameter (mm). Default 30. */
  tubeDiameterMm?: number
  /** Tube height (mm). Default 50. */
  tubeHeightMm?: number
  /** Wall print speed (mm/s). Default 60. */
  wallSpeedMmPerSec?: number
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
 * `resources/orca-slicer/profiles/machines/creality-k2-plus.json`), so the
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

// ── 4. Retraction tower (Klipper SET_RETRACTION) ─────────────────────────

/**
 * Build a retraction-tower calibration program.
 *
 * Prints two small square pillars separated by a configurable gap. The
 * print head travels back and forth between the pillars between every
 * trace -- if the retraction distance is too low, the head drools
 * filament across the gap (visible stringing). The Klipper firmware
 * retraction macro `SET_RETRACTION RETRACT_LENGTH=<mm>` is issued at the
 * start of each band so each Z-stack samples a different retraction
 * value. Operator picks the SHORTEST distance that produces a clean
 * inter-pillar field (over-retraction slows the print and risks heat
 * creep on direct-drive K2 hotends).
 *
 * Default sweep: 0.0 -> 2.0 mm in 0.2 mm steps (11 bands × 5 mm = 55 mm
 * tall tower). Retraction speed default 40 mm/s (K2 direct-drive); the
 * builder asserts it stays under the K2 E-feedrate ceiling.
 *
 * SAFETY AUDIT (CLAUDE.md "Safety Rule 1"):
 *   - All XY feedrates <= 9000 mm/min (150 mm/s) << 600 mm/s K2 ceiling
 *   - All Z feedrates  <= 600  mm/min (10 mm/s)  << 30  mm/s K2 ceiling
 *   - Retraction E-feed asserted via assertFeedSafe('e')
 *   - Nozzle / bed via assertTempSafe (PLA defaults)
 *   - SET_RETRACTION is reset to 0 at the END so the test does not
 *     pollute the operator's next print
 *   - E values are monotonically non-decreasing (positive extrusion +
 *     negative retraction tracked as separate state, never NaN/Inf)
 */
export function buildRetractionTowerArgs(params: RetractionTowerParams): CalibrationBuildResult {
  const start = params.startRetractMm ?? 0.0
  const end = params.endRetractMm ?? 2.0
  const step = params.stepRetractMm ?? 0.2
  const bandH = params.bandHeightMm ?? 5
  const gap = params.pillarGapMm ?? 30
  const pillarSize = params.pillarSizeMm ?? 10
  const retractSpeedMmPerSec = params.retractSpeedMmPerSec ?? 40
  const nozzle = params.nozzleTempC ?? 215
  const bed = params.bedTempC ?? 60
  if (step <= 0) throw new Error('Calibration generator: retraction-tower step must be positive')
  if (end < start) throw new Error('Calibration generator: retraction-tower end < start')
  if (start < 0 || end > 5) {
    // 5 mm hard ceiling -- on a K2 direct-drive nothing past ~2 mm is
    // useful, and longer retracts risk grinding the filament path.
    throw new Error('Calibration generator: retraction values out of safe range (0..5 mm)')
  }
  if (bandH <= 0 || bandH > 20) throw new Error('Calibration generator: band height out of safe range (1..20 mm)')
  if (gap < 10 || gap > 200) throw new Error('Calibration generator: pillar gap out of safe range (10..200 mm)')
  if (pillarSize < 5 || pillarSize > 30) {
    throw new Error('Calibration generator: pillar size out of safe range (5..30 mm)')
  }
  if (retractSpeedMmPerSec <= 0 || retractSpeedMmPerSec > K2_PLUS_HARDWARE_CEILINGS.maxFeedrateEMmPerSec) {
    throw new Error(`Calibration generator: retraction speed must be > 0 and <= ${K2_PLUS_HARDWARE_CEILINGS.maxFeedrateEMmPerSec} mm/s`)
  }
  assertTempSafe(nozzle, 'nozzle')
  assertTempSafe(bed, 'bed')

  const bands: number[] = []
  for (let r = start; r <= end + 1e-9; r += step) bands.push(Math.round(r * 100) / 100)
  if (bands.length === 0 || bands.length > 30) {
    throw new Error('Calibration generator: retraction sweep produced 0 or > 30 bands')
  }

  const cx = 175
  const cy = 175
  const halfGap = gap / 2
  const halfPillar = pillarSize / 2
  // Two pillars sit on the +X / -X side of bed-center
  const pillar1Cx = cx - halfGap - halfPillar
  const pillar2Cx = cx + halfGap + halfPillar
  const printAreaMinX = pillar1Cx - halfPillar - 4
  const printAreaMinY = cy - halfPillar - 4
  const printAreaMaxX = pillar2Cx + halfPillar + 4
  const printAreaMaxY = cy + halfPillar + 4

  const layerHeight = 0.2
  const lineWidth = 0.4
  const printFeedXy = 1800 // 30 mm/s
  const travelFeedXy = 9000 // 150 mm/s
  const zFeed = 600 // 10 mm/s
  const eFeedMmMin = retractSpeedMmPerSec * 60
  assertFeedSafe(printFeedXy, 'xy')
  assertFeedSafe(travelFeedXy, 'xy')
  assertFeedSafe(zFeed, 'z')
  assertFeedSafe(eFeedMmMin, 'e')

  const filamentDia = 1.75
  const filamentArea = Math.PI * (filamentDia / 2) ** 2
  const ePerMm = (layerHeight * lineWidth) / filamentArea

  const lines: string[] = [
    ...headerComment(`Retraction tower ${fmtNum(start, 2)}-${fmtNum(end, 2)} mm, step ${fmtNum(step, 2)} mm`),
    `; ${bands.length} bands, ${bandH} mm tall each, two ${pillarSize} mm pillars at ${gap} mm gap`,
    `; Klipper SET_RETRACTION RETRACT_LENGTH=<mm> issued per band; reset to 0 on END`,
    `; Inspect stringing in the gap; pick the SHORTEST retraction with a clean field.`,
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

  function pillarCorners(centerX: number): [number, number][] {
    return [
      [centerX - halfPillar, cy - halfPillar],
      [centerX + halfPillar, cy - halfPillar],
      [centerX + halfPillar, cy + halfPillar],
      [centerX - halfPillar, cy + halfPillar]
    ]
  }

  let currentZ = layerHeight
  let eAcc = 0
  for (let b = 0; b < bands.length; b++) {
    const rDist = bands[b]!
    lines.push(`; ── Band ${b + 1}/${bands.length}: RETRACT_LENGTH = ${fmtNum(rDist, 2)} mm ──`)
    lines.push(`SET_RETRACTION RETRACT_LENGTH=${fmtNum(rDist, 2)} RETRACT_SPEED=${fmtNum(retractSpeedMmPerSec, 1)} UNRETRACT_SPEED=${fmtNum(retractSpeedMmPerSec, 1)}`)
    const layersInBand = Math.round(bandH / layerHeight)
    for (let l = 0; l < layersInBand; l++) {
      for (const center of [pillar1Cx, pillar2Cx]) {
        const corners = pillarCorners(center)
        lines.push(`G0 X${fmtNum(corners[0]![0])} Y${fmtNum(corners[0]![1])} Z${fmtNum(currentZ)} F${travelFeedXy}`)
        // Klipper firmware-retract on travel: emit G10 before travel, G11 on arrival.
        // The Klipper retract macro applies the SET_RETRACTION distance.
        for (let c = 1; c <= 4; c++) {
          const [tx, ty] = corners[c % 4]!
          eAcc += pillarSize * ePerMm
          lines.push(`G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${printFeedXy}`)
        }
        // Retract + travel away (the next iteration's G0 acts as the bridge over the gap)
        lines.push('G10') // firmware retract -- honors SET_RETRACTION
      }
      // Un-retract on return to the first pillar for the next layer
      lines.push('G11')
      currentZ += layerHeight
    }
    lines.push('')
  }

  // Reset SET_RETRACTION so the test doesn't pollute later prints
  lines.push('SET_RETRACTION RETRACT_LENGTH=0 RETRACT_SPEED=40 UNRETRACT_SPEED=40')
  lines.push(`G0 Z${fmtNum(currentZ + 5)} F${zFeed}`)
  lines.push(...k2EndSequence())

  const gcode = lines.join('\n') + '\n'
  const description =
    `Retraction tower: ${bands.length} bands from ${fmtNum(start, 2)} to ${fmtNum(end, 2)} mm ` +
    `(step ${fmtNum(step, 2)} mm), two ${pillarSize} mm pillars at ${gap} mm gap, ${bandH} mm per band.`

  return {
    args: [
      'k2-plus-calibration',
      '--test',
      'retraction-tower',
      '--start-retract',
      String(start),
      '--end-retract',
      String(end),
      '--step-retract',
      String(step),
      '--band-height',
      String(bandH),
      '--pillar-gap',
      String(gap),
      '--pillar-size',
      String(pillarSize),
      '--retract-speed',
      String(retractSpeedMmPerSec),
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

// ── 5. Max volumetric flow ────────────────────────────────────────────────

/**
 * Build a max-volumetric-flow calibration program.
 *
 * Prints a tall single-walled tube where each Z-band extrudes at a
 * progressively-higher volumetric flow rate (mm^3/s). Operator inspects
 * the wall for the onset of under-extrusion (rough surface, gaps) and
 * picks the highest flow rate the hot-end can sustain. The result feeds
 * `filament_max_volumetric_speed` per filament profile.
 *
 * Default sweep: 5 -> 30 mm^3/s in 2 mm^3/s steps (13 bands × 5 mm =
 * 65 mm tall tube). The builder converts volumetric flow to a print
 * feedrate via `f_mmpermin = (Q_mm3s / extrusion_area) * 60` where
 * extrusion_area = layer_height * line_width. The resulting XY feedrate
 * is then asserted against the K2 ceiling -- a 30 mm^3/s top-end at
 * 0.2 x 0.4 mm extrusion is 375 mm/s, well under the 600 mm/s K2 ceiling.
 *
 * SAFETY AUDIT (CLAUDE.md "Safety Rule 1"):
 *   - Every per-band XY feed run through assertFeedSafe('xy') -- the
 *     builder THROWS at generation time if any computed feed exceeds
 *     the K2 ceiling (e.g. someone bumps endFlow past 47 mm^3/s, the
 *     resulting >600 mm/s XY rate is rejected here)
 *   - Z, E feeds checked too
 *   - Nozzle / bed via assertTempSafe (PLA defaults)
 *   - filamentDensity is purely documentary -- it never enters the
 *     feedrate math, so a misparameter cannot ship unsafe G-code
 */
export function buildMaxVolumetricFlowArgs(params: MaxVolumetricFlowParams): CalibrationBuildResult {
  const startQ = params.startFlowMmCubePerSec ?? 5
  const endQ = params.endFlowMmCubePerSec ?? 30
  const stepQ = params.stepFlowMmCubePerSec ?? 2
  const bandH = params.bandHeightMm ?? 5
  const tubeDia = params.tubeDiameterMm ?? 30
  const nozzle = params.nozzleTempC ?? 215
  const bed = params.bedTempC ?? 60
  const density = params.filamentDensity ?? 1.24
  if (stepQ <= 0) throw new Error('Calibration generator: max-vol-flow step must be positive')
  if (endQ < startQ) throw new Error('Calibration generator: max-vol-flow end < start')
  if (startQ <= 0 || endQ > 60) {
    // 60 mm^3/s is more than any commercial hot-end can sustain; well past
    // anything sensible for a K2 with stock or high-flow hotend.
    throw new Error('Calibration generator: max-vol-flow values out of safe range (0..60 mm^3/s)')
  }
  if (bandH <= 0 || bandH > 20) throw new Error('Calibration generator: band height out of safe range (1..20 mm)')
  if (tubeDia < 15 || tubeDia > 80) throw new Error('Calibration generator: tube diameter out of safe range (15..80 mm)')
  if (density <= 0 || density > 5) throw new Error('Calibration generator: filament density out of safe range (0..5 g/cm^3)')
  assertTempSafe(nozzle, 'nozzle')
  assertTempSafe(bed, 'bed')

  const bands: number[] = []
  for (let q = startQ; q <= endQ + 1e-9; q += stepQ) bands.push(Math.round(q * 10) / 10)
  if (bands.length === 0 || bands.length > 40) {
    throw new Error('Calibration generator: max-vol-flow sweep produced 0 or > 40 bands')
  }

  const cx = 175
  const cy = 175
  const radius = tubeDia / 2
  const printAreaMinX = cx - radius - 4
  const printAreaMinY = cy - radius - 4
  const printAreaMaxX = cx + radius + 4
  const printAreaMaxY = cy + radius + 4

  const layerHeight = 0.2
  const lineWidth = 0.4
  const extrusionAreaMm2 = layerHeight * lineWidth // mm^2 per mm of travel
  const travelFeedXy = 9000 // 150 mm/s
  const zFeed = 600 // 10 mm/s
  assertFeedSafe(travelFeedXy, 'xy')
  assertFeedSafe(zFeed, 'z')

  const filamentDia = 1.75
  const filamentArea = Math.PI * (filamentDia / 2) ** 2
  const ePerMm = extrusionAreaMm2 / filamentArea

  // Approximate the circle as a regular polygon (60 sides @ 30 mm dia => ~1.5 mm chord)
  const segments = Math.max(36, Math.min(120, Math.round(tubeDia * 2)))
  function tubePoint(i: number): [number, number] {
    const theta = (i / segments) * Math.PI * 2
    return [cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)]
  }

  const lines: string[] = [
    ...headerComment(`Max volumetric flow ${fmtNum(startQ, 1)}-${fmtNum(endQ, 1)} mm^3/s, step ${fmtNum(stepQ, 1)}`),
    `; ${bands.length} bands, ${bandH} mm tall each, tube OD ${tubeDia} mm`,
    `; Filament: density ${fmtNum(density, 2)} g/cm^3 (documentary)`,
    `; Operator: inspect the wall for the onset of under-extrusion;`,
    `; pick the highest flow with a clean surface for filament_max_volumetric_speed.`,
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

  let currentZ = layerHeight
  let eAcc = 0
  for (let b = 0; b < bands.length; b++) {
    const Q = bands[b]!
    // Compute the XY feedrate that achieves this volumetric flow at the
    // current extrusion area. v_mmps = Q / area.
    const vMmps = Q / extrusionAreaMm2
    const fXyMmMin = vMmps * 60
    // The wall MUST stay under the K2 XY ceiling. If it doesn't, the
    // builder throws and CI catches it before shipping.
    assertFeedSafe(fXyMmMin, 'xy')
    // And the implied E-feedrate at that speed must stay under the E ceiling too.
    const eFeedMmMin = vMmps * ePerMm * 60
    if (eFeedMmMin > K2_PLUS_HARDWARE_CEILINGS.maxFeedrateEMmPerSec * 60) {
      throw new Error(`Calibration generator: max-vol-flow band ${Q} mm^3/s requires E-feed ${fmtNum(eFeedMmMin, 1)} > K2 ceiling`)
    }

    lines.push(`; ── Band ${b + 1}/${bands.length}: Q = ${fmtNum(Q, 1)} mm^3/s (XY feed ${fmtNum(fXyMmMin, 0)} mm/min) ──`)
    const layersInBand = Math.round(bandH / layerHeight)
    for (let l = 0; l < layersInBand; l++) {
      // Travel to seam start
      const [sx, sy] = tubePoint(0)
      lines.push(`G0 X${fmtNum(sx)} Y${fmtNum(sy)} Z${fmtNum(currentZ)} F${travelFeedXy}`)
      // Trace the polygon as one Z-layer
      for (let s = 1; s <= segments; s++) {
        const [tx, ty] = tubePoint(s % segments)
        const chord = Math.hypot(tx - sx, ty - sy)
        eAcc += chord * ePerMm
        lines.push(`G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${fmtNum(fXyMmMin, 0)}`)
      }
      currentZ += layerHeight
    }
    lines.push('')
  }

  lines.push(`G0 Z${fmtNum(currentZ + 5)} F${zFeed}`)
  lines.push(...k2EndSequence())

  const gcode = lines.join('\n') + '\n'
  const description =
    `Max volumetric flow: ${bands.length} bands from ${fmtNum(startQ, 1)} to ${fmtNum(endQ, 1)} mm^3/s ` +
    `(step ${fmtNum(stepQ, 1)}), ${tubeDia} mm tube, ${bandH} mm per band at ${nozzle} C.`

  return {
    args: [
      'k2-plus-calibration',
      '--test',
      'max-volumetric-flow',
      '--start-flow',
      String(startQ),
      '--end-flow',
      String(endQ),
      '--step-flow',
      String(stepQ),
      '--band-height',
      String(bandH),
      '--tube-diameter',
      String(tubeDia),
      '--nozzle-temp',
      String(nozzle),
      '--bed-temp',
      String(bed),
      '--filament-density',
      String(density),
      '--output',
      params.outputGcodePath
    ],
    outputGcodePath: params.outputGcodePath,
    description,
    gcode
  }
}

// ── 6. Tolerance / dimensional accuracy ───────────────────────────────────

/**
 * Build a tolerance (dimensional accuracy) calibration program.
 *
 * Prints a calibration cube of known edge length plus a row of peg +
 * matching hole pairs at known clearances (e.g. +0.0, +0.1, +0.2, +0.3
 * mm). Operator measures the cube dims with calipers (target = nominal)
 * and slips each peg into its mating hole; the smallest clearance that
 * still slip-fits is the printer's effective XY hole compensation.
 *
 * The cube is a 4-walled hollow box (no top/bottom skin -- the operator
 * just needs the outer shell for caliper measurement). The peg + hole
 * comb prints alongside the cube in the same Z-band so a single print
 * yields all data.
 *
 * SAFETY AUDIT (CLAUDE.md "Safety Rule 1"):
 *   - All XY feedrates fixed at 1800 mm/min (30 mm/s) -- well under K2 600 mm/s
 *   - Z feed at 600 mm/min (10 mm/s) << 30 mm/s K2 ceiling
 *   - assertFeedSafe / assertTempSafe applied
 *   - Peg + hole counts bounded so no run-away pattern can flood the bed
 */
export function buildToleranceTestArgs(params: ToleranceTestParams): CalibrationBuildResult {
  const cubeMm = params.cubeSizeMm ?? 20
  const pegCount = params.pegHoleCount ?? 4
  const holeBaseDia = params.holeBaseDiameterMm ?? 4.0
  const clearanceStep = params.clearanceStepMm ?? 0.1
  const nozzle = params.nozzleTempC ?? 215
  const bed = params.bedTempC ?? 60
  if (cubeMm < 10 || cubeMm > 60) throw new Error('Calibration generator: cube size out of safe range (10..60 mm)')
  if (pegCount < 2 || pegCount > 8) throw new Error('Calibration generator: peg/hole count out of safe range (2..8)')
  if (holeBaseDia < 2 || holeBaseDia > 10) {
    throw new Error('Calibration generator: hole base diameter out of safe range (2..10 mm)')
  }
  if (clearanceStep <= 0 || clearanceStep > 0.5) {
    throw new Error('Calibration generator: clearance step out of safe range (0..0.5 mm)')
  }
  assertTempSafe(nozzle, 'nozzle')
  assertTempSafe(bed, 'bed')

  const cubeHeight = Math.min(cubeMm, 10) // cap so the print stays short
  const layerHeight = 0.2
  const lineWidth = 0.4
  const cubeWalls = 2 // double-wall for accurate caliper measurement
  const pegHeight = Math.min(6, cubeHeight)
  const pegPitch = holeBaseDia + 4 // mm center-to-center
  const combLength = pegCount * pegPitch
  // Cube on the left, peg/hole comb to the right
  const cubeCx = 130
  const cubeCy = 175
  const halfCube = cubeMm / 2
  const combStartX = 180
  const combY = 175
  const printAreaMinX = cubeCx - halfCube - 4
  const printAreaMinY = combY - holeBaseDia - 4
  const printAreaMaxX = combStartX + combLength + 4
  const printAreaMaxY = combY + holeBaseDia + 4

  const printFeedXy = 1800 // 30 mm/s
  const travelFeedXy = 9000 // 150 mm/s
  const zFeed = 600 // 10 mm/s
  assertFeedSafe(printFeedXy, 'xy')
  assertFeedSafe(travelFeedXy, 'xy')
  assertFeedSafe(zFeed, 'z')

  const filamentDia = 1.75
  const filamentArea = Math.PI * (filamentDia / 2) ** 2
  const ePerMm = (layerHeight * lineWidth) / filamentArea

  const lines: string[] = [
    ...headerComment(`Tolerance: ${cubeMm} mm cube + ${pegCount} peg/hole pairs`),
    `; Cube: ${cubeMm} x ${cubeMm} x ${cubeHeight} mm, ${cubeWalls} walls; measure X/Y/Z with calipers.`,
    `; Peg/hole comb: base diameter ${fmtNum(holeBaseDia, 2)} mm, +${fmtNum(clearanceStep, 2)} mm per pair (${pegCount} pairs)`,
    `; Operator: slip each peg into its mating hole; smallest slip-fit clearance = your XY hole compensation.`,
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

  function cubeCorners(wallOffset: number): [number, number][] {
    const off = wallOffset * lineWidth
    return [
      [cubeCx - halfCube + off, cubeCy - halfCube + off],
      [cubeCx + halfCube - off, cubeCy - halfCube + off],
      [cubeCx + halfCube - off, cubeCy + halfCube - off],
      [cubeCx - halfCube + off, cubeCy + halfCube - off]
    ]
  }

  // ── Cube ───────────────────────────────────────────────────────────
  const cubeLayers = Math.round(cubeHeight / layerHeight)
  let z = layerHeight
  let eAcc = 0
  for (let l = 0; l < cubeLayers; l++) {
    for (let w = 0; w < cubeWalls; w++) {
      const corners = cubeCorners(w)
      lines.push(`G0 X${fmtNum(corners[0]![0])} Y${fmtNum(corners[0]![1])} Z${fmtNum(z)} F${travelFeedXy}`)
      const side = cubeMm - 2 * w * lineWidth
      for (let c = 1; c <= 4; c++) {
        const [tx, ty] = corners[c % 4]!
        eAcc += side * ePerMm
        lines.push(`G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${printFeedXy}`)
      }
    }
    z += layerHeight
  }

  // ── Peg + hole comb ────────────────────────────────────────────────
  // Each pair: a solid peg (small concentric circle, infill-traced) and
  // a hole-bearing block (a ring around the hole). We approximate
  // circles as 24-side polygons for compact output.
  const pegLayers = Math.round(pegHeight / layerHeight)
  function ringPoints(centerX: number, centerY: number, dia: number, segments: number = 24): [number, number][] {
    const r = dia / 2
    const out: [number, number][] = []
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2
      out.push([centerX + r * Math.cos(theta), centerY + r * Math.sin(theta)])
    }
    return out
  }

  let zPeg = layerHeight
  for (let l = 0; l < pegLayers; l++) {
    for (let p = 0; p < pegCount; p++) {
      const clearance = p * clearanceStep
      const pegDia = holeBaseDia
      const holeDia = holeBaseDia + clearance
      const holeBlockDia = holeBaseDia + 4 // outer wall of the hole's block
      // Pegs along combY-3, hole blocks along combY+3 for separation
      const pegX = combStartX + p * pegPitch
      const holeX = combStartX + p * pegPitch
      // Peg outline (single perimeter)
      const pegRing = ringPoints(pegX, combY - 5, pegDia, 24)
      lines.push(`G0 X${fmtNum(pegRing[0]![0])} Y${fmtNum(pegRing[0]![1])} Z${fmtNum(zPeg)} F${travelFeedXy}`)
      for (let s = 1; s < pegRing.length; s++) {
        const [tx, ty] = pegRing[s]!
        const chord = Math.hypot(tx - pegRing[s - 1]![0], ty - pegRing[s - 1]![1])
        eAcc += chord * ePerMm
        lines.push(`G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${printFeedXy}`)
      }
      // Hole-block: outer ring + inner ring (the hole)
      const outerRing = ringPoints(holeX, combY + 5, holeBlockDia, 24)
      const innerRing = ringPoints(holeX, combY + 5, holeDia, 24)
      lines.push(`G0 X${fmtNum(outerRing[0]![0])} Y${fmtNum(outerRing[0]![1])} Z${fmtNum(zPeg)} F${travelFeedXy}`)
      for (let s = 1; s < outerRing.length; s++) {
        const [tx, ty] = outerRing[s]!
        const chord = Math.hypot(tx - outerRing[s - 1]![0], ty - outerRing[s - 1]![1])
        eAcc += chord * ePerMm
        lines.push(`G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${printFeedXy}`)
      }
      lines.push(`G0 X${fmtNum(innerRing[0]![0])} Y${fmtNum(innerRing[0]![1])} Z${fmtNum(zPeg)} F${travelFeedXy}`)
      for (let s = 1; s < innerRing.length; s++) {
        const [tx, ty] = innerRing[s]!
        const chord = Math.hypot(tx - innerRing[s - 1]![0], ty - innerRing[s - 1]![1])
        eAcc += chord * ePerMm
        lines.push(`G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${printFeedXy}`)
      }
    }
    zPeg += layerHeight
  }

  lines.push(`G0 Z${fmtNum(Math.max(z, zPeg) + 5)} F${zFeed}`)
  lines.push(...k2EndSequence())

  const gcode = lines.join('\n') + '\n'
  const description =
    `Tolerance: ${cubeMm}x${cubeMm}x${cubeHeight} mm cube + ${pegCount} peg/hole pairs ` +
    `(base ${fmtNum(holeBaseDia, 2)} mm, step ${fmtNum(clearanceStep, 2)} mm) at ${nozzle} C.`

  return {
    args: [
      'k2-plus-calibration',
      '--test',
      'tolerance',
      '--cube-size',
      String(cubeMm),
      '--peg-hole-count',
      String(pegCount),
      '--hole-base-diameter',
      String(holeBaseDia),
      '--clearance-step',
      String(clearanceStep),
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

// ── 7. Cornering / SCV (square_corner_velocity) ──────────────────────────

/**
 * Build a Klipper square-corner-velocity (cornering / "jerk") test.
 *
 * Prints a square at multiple Z-bands, switching the Klipper
 * `SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=<mm/s>` setting between
 * bands. Operator inspects the corners of each band for ghosting /
 * ringing artifacts and picks the highest SCV where the corners stay
 * clean. SCV is the K2 Plus's input-shaping headroom dial: higher = less
 * acceleration penalty at corners, but risks ringing if pushed past the
 * carriage's resonance budget.
 *
 * Default sweep: SCV 4 -> 9 mm/s in 1 mm/s steps. 9 mm/s is the K2
 * ceiling per `K2_PLUS_HARDWARE_CEILINGS.maxJerkXyMmPerSec`. The print
 * speed during the square trace defaults to 150 mm/s.
 *
 * SAFETY AUDIT (CLAUDE.md "Safety Rule 1"):
 *   - All XY feedrates <= 9000 mm/min (150 mm/s) << 600 mm/s K2 ceiling
 *   - Z feed <= 600 mm/min << 30 mm/s ceiling
 *   - Every SCV value asserted <= K2_PLUS_HARDWARE_CEILINGS.maxJerkXyMmPerSec (9 mm/s)
 *   - SCV is RESET to a safe default (5 mm/s, Klipper standard) on END
 *     so the test does NOT pollute the operator's next job
 *   - Nozzle / bed via assertTempSafe (PLA defaults)
 */
export function buildCorneringTestArgs(params: CorneringTestParams): CalibrationBuildResult {
  const startScv = params.startScvMmPerSec ?? 4
  const endScv = params.endScvMmPerSec ?? K2_PLUS_HARDWARE_CEILINGS.maxJerkXyMmPerSec
  const stepScv = params.stepScvMmPerSec ?? 1
  const bandH = params.bandHeightMm ?? 5
  const squareMm = params.squareSizeMm ?? 40
  const printSpeedMmPerSec = params.printSpeedMmPerSec ?? 150
  const nozzle = params.nozzleTempC ?? 215
  const bed = params.bedTempC ?? 60
  if (stepScv <= 0) throw new Error('Calibration generator: cornering step must be positive')
  if (endScv < startScv) throw new Error('Calibration generator: cornering end < start')
  if (startScv <= 0 || endScv > K2_PLUS_HARDWARE_CEILINGS.maxJerkXyMmPerSec) {
    throw new Error(`Calibration generator: SCV values out of safe range (0..${K2_PLUS_HARDWARE_CEILINGS.maxJerkXyMmPerSec} mm/s, K2 ceiling)`)
  }
  if (bandH <= 0 || bandH > 20) throw new Error('Calibration generator: band height out of safe range (1..20 mm)')
  if (squareMm < 20 || squareMm > 100) throw new Error('Calibration generator: square size out of safe range (20..100 mm)')
  if (printSpeedMmPerSec <= 0 || printSpeedMmPerSec > K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec) {
    throw new Error(`Calibration generator: print speed out of safe range (0..${K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec} mm/s)`)
  }
  assertTempSafe(nozzle, 'nozzle')
  assertTempSafe(bed, 'bed')

  const bands: number[] = []
  for (let v = startScv; v <= endScv + 1e-9; v += stepScv) bands.push(Math.round(v * 100) / 100)
  if (bands.length === 0 || bands.length > 20) {
    throw new Error('Calibration generator: cornering sweep produced 0 or > 20 bands')
  }
  // Defense-in-depth: every emitted band must be <= the K2 SCV ceiling.
  for (const b of bands) {
    if (b > K2_PLUS_HARDWARE_CEILINGS.maxJerkXyMmPerSec) {
      throw new Error(`Calibration generator: SCV band ${b} mm/s exceeds K2 ceiling`)
    }
  }

  const cx = 175
  const cy = 175
  const halfSquare = squareMm / 2
  const printAreaMinX = cx - halfSquare - 4
  const printAreaMinY = cy - halfSquare - 4
  const printAreaMaxX = cx + halfSquare + 4
  const printAreaMaxY = cy + halfSquare + 4

  const layerHeight = 0.2
  const lineWidth = 0.4
  const printFeedXy = printSpeedMmPerSec * 60
  const travelFeedXy = 9000 // 150 mm/s
  const zFeed = 600 // 10 mm/s
  assertFeedSafe(printFeedXy, 'xy')
  assertFeedSafe(travelFeedXy, 'xy')
  assertFeedSafe(zFeed, 'z')

  const filamentDia = 1.75
  const filamentArea = Math.PI * (filamentDia / 2) ** 2
  const ePerMm = (layerHeight * lineWidth) / filamentArea

  const lines: string[] = [
    ...headerComment(`Cornering / SCV ${fmtNum(startScv, 1)}-${fmtNum(endScv, 1)} mm/s, step ${fmtNum(stepScv, 1)} mm/s`),
    `; ${bands.length} bands, ${bandH} mm tall each, ${squareMm} mm square at ${printSpeedMmPerSec} mm/s`,
    `; Klipper SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=<mm/s> issued per band`,
    `; SCV reset to 5 mm/s (Klipper default) on END so this test does not pollute later jobs`,
    `; Operator: inspect corners under raking light; pick the highest SCV with NO visible ghosting.`,
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

  const corners: [number, number][] = [
    [cx - halfSquare, cy - halfSquare],
    [cx + halfSquare, cy - halfSquare],
    [cx + halfSquare, cy + halfSquare],
    [cx - halfSquare, cy + halfSquare]
  ]

  let currentZ = layerHeight
  let eAcc = 0
  for (let b = 0; b < bands.length; b++) {
    const scv = bands[b]!
    lines.push(`; ── Band ${b + 1}/${bands.length}: SCV = ${fmtNum(scv, 2)} mm/s ──`)
    lines.push(`SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=${fmtNum(scv, 2)}`)
    const layersInBand = Math.round(bandH / layerHeight)
    for (let l = 0; l < layersInBand; l++) {
      lines.push(`G0 X${fmtNum(corners[0]![0])} Y${fmtNum(corners[0]![1])} Z${fmtNum(currentZ)} F${travelFeedXy}`)
      for (let c = 1; c <= 4; c++) {
        const [tx, ty] = corners[c % 4]!
        eAcc += squareMm * ePerMm
        lines.push(`G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${fmtNum(printFeedXy, 0)}`)
      }
      currentZ += layerHeight
    }
    lines.push('')
  }

  // CRITICAL: reset SCV to Klipper standard (5 mm/s) so the operator's
  // next print isn't running with whatever the last band set. This is
  // the same "reset before END" pattern the PA test uses.
  lines.push('SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=5.00')
  lines.push(`G0 Z${fmtNum(currentZ + 5)} F${zFeed}`)
  lines.push(...k2EndSequence())

  const gcode = lines.join('\n') + '\n'
  const description =
    `Cornering: ${bands.length} bands from ${fmtNum(startScv, 1)} to ${fmtNum(endScv, 1)} mm/s ` +
    `(step ${fmtNum(stepScv, 1)}), ${squareMm} mm square at ${printSpeedMmPerSec} mm/s.`

  return {
    args: [
      'k2-plus-calibration',
      '--test',
      'cornering',
      '--start-scv',
      String(startScv),
      '--end-scv',
      String(endScv),
      '--step-scv',
      String(stepScv),
      '--band-height',
      String(bandH),
      '--square-size',
      String(squareMm),
      '--print-speed',
      String(printSpeedMmPerSec),
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

// ── 8. VFA (vertical fine artifacts) ──────────────────────────────────────

/**
 * Build a vertical-fine-artifacts (VFA) calibration program.
 *
 * Prints a tall single-walled tube at a modest constant speed. The
 * operator inspects the wall for Z-banding, XY-belt resonance ripples,
 * or microstep artifacts. Useful as a diagnostic when surface quality
 * degrades after a belt swap, motor change, or firmware retune.
 *
 * Defaults: 30 mm OD tube, 50 mm tall, 60 mm/s wall speed. The single
 * constant speed deliberately avoids any acceleration or speed change
 * artifacts -- whatever shows on the wall is structural (mechanical or
 * electrical), not toolpath-induced.
 *
 * SAFETY AUDIT (CLAUDE.md "Safety Rule 1"):
 *   - XY feed = wallSpeed * 60, asserted <= K2 600 mm/s ceiling
 *   - Z feed at 600 mm/min (10 mm/s) << 30 mm/s K2 ceiling
 *   - assertFeedSafe / assertTempSafe applied
 *   - Tube height capped at 100 mm; tube diameter at 80 mm; wall speed
 *     at the K2 XY ceiling
 */
export function buildVfaTestArgs(params: VfaTestParams): CalibrationBuildResult {
  const tubeDia = params.tubeDiameterMm ?? 30
  const tubeH = params.tubeHeightMm ?? 50
  const wallSpeedMmPerSec = params.wallSpeedMmPerSec ?? 60
  const nozzle = params.nozzleTempC ?? 215
  const bed = params.bedTempC ?? 60
  if (tubeDia < 15 || tubeDia > 80) throw new Error('Calibration generator: tube diameter out of safe range (15..80 mm)')
  if (tubeH < 20 || tubeH > 100) throw new Error('Calibration generator: tube height out of safe range (20..100 mm)')
  if (wallSpeedMmPerSec <= 0 || wallSpeedMmPerSec > K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec) {
    throw new Error(`Calibration generator: wall speed out of safe range (0..${K2_PLUS_HARDWARE_CEILINGS.maxFeedrateXyMmPerSec} mm/s)`)
  }
  assertTempSafe(nozzle, 'nozzle')
  assertTempSafe(bed, 'bed')

  const cx = 175
  const cy = 175
  const radius = tubeDia / 2
  const printAreaMinX = cx - radius - 4
  const printAreaMinY = cy - radius - 4
  const printAreaMaxX = cx + radius + 4
  const printAreaMaxY = cy + radius + 4

  const layerHeight = 0.2
  const lineWidth = 0.4
  const printFeedXy = wallSpeedMmPerSec * 60
  const travelFeedXy = 9000 // 150 mm/s
  const zFeed = 600 // 10 mm/s
  assertFeedSafe(printFeedXy, 'xy')
  assertFeedSafe(travelFeedXy, 'xy')
  assertFeedSafe(zFeed, 'z')

  const filamentDia = 1.75
  const filamentArea = Math.PI * (filamentDia / 2) ** 2
  const ePerMm = (layerHeight * lineWidth) / filamentArea

  // Approximate the tube as a regular polygon. Use enough segments that
  // chord-length artifacts don't masquerade as VFA on the wall.
  const segments = Math.max(60, Math.min(180, Math.round(tubeDia * 3)))
  function tubePoint(i: number): [number, number] {
    const theta = (i / segments) * Math.PI * 2
    return [cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)]
  }

  const lines: string[] = [
    ...headerComment(`VFA tall tube: OD ${tubeDia} mm, ${tubeH} mm tall, ${wallSpeedMmPerSec} mm/s wall`),
    `; Constant-speed single wall; any wall artifact is structural (mechanical / electrical), not toolpath.`,
    `; Operator: inspect for Z-banding, belt resonance ripples, microstep artifacts.`,
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

  const layers = Math.round(tubeH / layerHeight)
  let z = layerHeight
  let eAcc = 0
  for (let l = 0; l < layers; l++) {
    const [sx, sy] = tubePoint(0)
    lines.push(`G0 X${fmtNum(sx)} Y${fmtNum(sy)} Z${fmtNum(z)} F${travelFeedXy}`)
    let prev: [number, number] = [sx, sy]
    for (let s = 1; s <= segments; s++) {
      const [tx, ty] = tubePoint(s % segments)
      const chord = Math.hypot(tx - prev[0], ty - prev[1])
      eAcc += chord * ePerMm
      lines.push(`G1 X${fmtNum(tx)} Y${fmtNum(ty)} E${fmtNum(eAcc, 4)} F${fmtNum(printFeedXy, 0)}`)
      prev = [tx, ty]
    }
    z += layerHeight
  }

  lines.push(`G0 Z${fmtNum(z + 5)} F${zFeed}`)
  lines.push(...k2EndSequence())

  const gcode = lines.join('\n') + '\n'
  const description =
    `VFA tall tube: ${tubeDia} mm OD x ${tubeH} mm tall at ${wallSpeedMmPerSec} mm/s, ${nozzle} C.`

  return {
    args: [
      'k2-plus-calibration',
      '--test',
      'vfa',
      '--tube-diameter',
      String(tubeDia),
      '--tube-height',
      String(tubeH),
      '--wall-speed',
      String(wallSpeedMmPerSec),
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

export type CalibrationTestKind =
  | 'temperature-tower'
  | 'flow-rate'
  | 'pressure-advance'
  | 'retraction-tower'
  | 'max-volumetric-flow'
  | 'tolerance'
  | 'cornering'
  | 'vfa'

export type CalibrationGeneratePayload =
  | { kind: 'temperature-tower'; params: TemperatureTowerParams }
  | { kind: 'flow-rate'; params: FlowRateParams }
  | { kind: 'pressure-advance'; params: PressureAdvanceParams }
  | { kind: 'retraction-tower'; params: RetractionTowerParams }
  | { kind: 'max-volumetric-flow'; params: MaxVolumetricFlowParams }
  | { kind: 'tolerance'; params: ToleranceTestParams }
  | { kind: 'cornering'; params: CorneringTestParams }
  | { kind: 'vfa'; params: VfaTestParams }

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
    case 'retraction-tower':
      return buildRetractionTowerArgs(payload.params)
    case 'max-volumetric-flow':
      return buildMaxVolumetricFlowArgs(payload.params)
    case 'tolerance':
      return buildToleranceTestArgs(payload.params)
    case 'cornering':
      return buildCorneringTestArgs(payload.params)
    case 'vfa':
      return buildVfaTestArgs(payload.params)
    default: {
      // Exhaustiveness check
      const _exhaustive: never = payload
      throw new Error(`Calibration generator: unknown test kind ${JSON.stringify(_exhaustive)}`)
    }
  }
}
