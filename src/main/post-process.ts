import Handlebars from 'handlebars'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fitArcsToLinearPath } from '../shared/arc-fitting'
import type { GCodeSegment, Point3D } from '../shared/arc-fitting'
import type { MachineProfile } from '../shared/machine-schema'
import { validateDialectCompliance } from '../shared/gcode-dialect-compliance'
import {
  headerInvariantModeForMachine,
  validateGcodeHeaderInvariants
} from '../shared/gcode-header-invariants'
import {
  endProgramInvariantModeForMachine,
  validateGcodeEndProgramInvariants
} from '../shared/gcode-end-program-invariants'
import {
  resolveSafeZClearanceMm,
  safeZInvariantModeForMachine,
  validateGcodeSafeZRetractInvariants
} from '../shared/gcode-safe-z-retract-invariants'
import { resolveDialectSnippets, resolveWorkOffsetLine } from './post-process-dialects'
import { wrapLagunaToolpathWithVacuumBlocks } from '../shared/laguna-vacuum-postlude'
import type { LagunaVacuumPostludeOptions } from '../shared/laguna-vacuum-postlude'
import type { LagunaVacuumZoneAllocation } from '../shared/laguna-vacuum-allocator'

/** Configuration for G-code line numbering (N-words). */
export type LineNumberingConfig = {
  enabled: boolean
  /** Starting line number (e.g. 10). */
  start: number
  /** Increment between line numbers (e.g. 10 for N10, N20, N30...). */
  increment: number
}

/**
 * Subroutine dialect describes how subroutines are called and defined
 * on a given controller.
 */
export type SubroutineDialect = 'fanuc' | 'siemens' | 'mach3'

export type PostContext = {
  machine: MachineProfile
  /** One G-code block per line, no header/footer */
  toolpathLines: string[]
  spindleOn: string
  spindleOff: string
  units: 'G21' | 'G20'
  /**
   * Dialect-correct program-end terminator (`M2` or `M30`) for templates that
   * support more than one controller family (e.g. the generic `cnc_generic_mm.hbs`
   * post). Smoothieware/GRBL families MUST use `M2` because `M30` can delete the
   * running file from the Carvera SD card; Mach3/RichAuto + Fanuc use `M30`
   * (program end + rewind). Resolved by `resolveGenericProgramEnd(dialect)`.
   * Templates that hard-code their own terminator (the Carvera/Laguna posts)
   * ignore this field and stay byte-identical.
   */
  programEnd: 'M2' | 'M30'
  /** e.g. G54…G59 when workCoordinateIndex 1–6 was supplied to the post. */
  wcsLine?: string
  /** Optional human-readable operation label injected as a comment near the top of the file. */
  operationLabel?: string
  /** Warning message when spindle RPM was clamped to machine limits. */
  spindleWarning?: string
  /** ATC tool number (1–6) for M6 T<n> and G43 H<n> commands in templates. */
  toolNumber?: number
  /**
   * Height offset register for G43 H<n>.
   * When set, templates can emit `G43 H{{toolWearOffsetH}}` for wear-adjusted
   * tool length compensation instead of using the tool slot number.
   */
  toolWearOffsetH?: number
  /**
   * Diameter offset register for G41/G42 D<n>.
   * When set, templates can emit `G41 D{{toolWearOffsetD}}` for wear-adjusted
   * cutter compensation.
   */
  toolWearOffsetD?: number
  /**
   * When true, G93 inverse-time feed mode is active.
   * Templates should emit G93 before toolpath and G94 after (to restore normal feed mode).
   * In G93 mode, the F-word specifies 1/time (inverse minutes) rather than units/minute.
   * Typically used for continuous 4-axis/5-axis operations where the rotary axis is moving.
   */
  inverseTimeFeed?: boolean
  /**
   * When true, detect repeated patterns in toolpath lines and wrap them
   * in subroutines. Requires `subroutineDialect` to determine call syntax.
   */
  enableSubroutines?: boolean
  /** Controller dialect for subroutine syntax. Required when enableSubroutines is true. */
  subroutineDialect?: SubroutineDialect
  /**
   * Optional line numbering configuration.
   * When enabled, N-words are prepended to every non-blank, non-comment line
   * in the final G-code output.
   */
  lineNumbering?: LineNumberingConfig
  /**
   * When true, run arc fitting on the toolpath lines to convert sequences of
   * G1 moves into G2/G3 circular arcs where possible. Reduces file size and
   * improves surface finish on controllers with arc look-ahead.
   */
  enableArcFitting?: boolean
  /**
   * Maximum deviation (mm) from a fitted circle for a point to be included
   * in an arc segment. Default: 0.005 mm. Only used when enableArcFitting is true.
   */
  arcTolerance?: number
  /**
   * Cutter compensation mode. When 'left' or 'right', G41/G42 is emitted
   * before contour moves and G40 (cancel) is emitted after.
   *   'none'  — no cutter compensation (default)
   *   'left'  — G41 (tool left of programmed path, climb milling)
   *   'right' — G42 (tool right of programmed path, conventional milling)
   */
  cutterCompensation?: 'none' | 'left' | 'right'
  /**
   * D-register number for cutter compensation (G41 D<n> / G42 D<n>).
   * When omitted, the D-word is not emitted (controller uses active tool's
   * stored diameter). Typical range: 1–99.
   */
  cutterCompDRegister?: number
  /**
   * When true, emit dust-collection M-codes in templates that wire them
   * behind a flag (e.g. the Laguna VCarve Pro / RichAuto A-series post
   * `vcarve_mach3.hbs` emits `M7` after the spindle warm-up dwell and
   * `M9` before spindle-off). When false or undefined, dust-collection
   * lines stay commented out so manually-wired bench controllers aren't
   * surprised by stray M7/M9 commands on program start.
   *
   * Roadmap: [ID-0004]. Laguna Swift 5×10 RichAuto A-series controllers
   * commonly route M7/M8/M9 to dust-collection relays; this flag is the
   * safe opt-in.
   */
  dustCollection?: boolean
  /**
   * When true, the Makera Carvera 4-axis post (`carvera_4axis.hbs`) emits a
   * prominent UNVERIFIED-SIMULTANEOUS-MOVES warning header acknowledging
   * that the operator has opted in to community-firmware-dependent
   * simultaneous 4-axis behaviour (X/Y/Z and A all moving in one block).
   *
   * Why this is a separate flag from the strategy choice:
   * `cnc_4axis_continuous` (the strategy that emits blended X/Y/Z+A moves)
   * is already in production -- the flag does NOT change which strategy
   * runs, NOR what toolpath geometry the engine emits. It ONLY adds a
   * post-level warning banner that makes the opt-in operator-visible in
   * the G-code header. Templates that don't reference the field
   * (FDM, Laguna VCarve, Carvera 3-axis, generic CNC) are byte-identical
   * regardless of the value.
   *
   * Roadmap [ID-0015]. Strict-true gate so `false` / undefined / non-bool
   * params behave identically to pre-flag output.
   */
  enableSimultaneous4Axis?: boolean
  /**
   * When true, the post template suppresses the automatic-tool-change
   * sequence (M6 T<n>, G43 H<n>) and emits an operator-visible manual-
   * change reminder comment instead. Default off (undefined / false) =
   * existing behaviour where ATC-capable templates emit M6 + G43
   * unconditionally.
   *
   * Used by the Makera Carvera 3-axis post template (carvera_3axis.hbs)
   * to let users opt OUT of ATC for diagnostic / single-tool jobs where
   * the tool is already loaded and a mid-program M6 would be
   * counterproductive (or where the operator wants to verify the tool
   * by hand). The Carvera 4-axis post does not emit M6 at all (rotary
   * attachment occupies the table) so this flag is a no-op there.
   *
   * Roadmap [ID-0013-integration]. Strict-true gate via the runner-shims
   * extractor so non-bool / falsy values behave identically to omitted.
   * Safety Rule 2 byte-identity: pre-existing projects with no field set
   * see no output difference.
   */
  manualToolChange?: boolean
  /**
   * Pre-rendered Carvera WCS-setup probing block. When set, the bundled
   * `carvera_3axis.hbs` and `carvera_4axis.hbs` templates emit it via
   * `{{{carveraProbingBlock}}}` AFTER the WCS line and BEFORE the first
   * tool-change M6. Honors the `carvera-3axis.md` reference contract:
   * `M6 T<probeSlot>` -> `G38.2` cycle -> `G10 L20 P<wcs> ...` -> `M6 T<stowSlot>`.
   * Set ONLY by `renderPost` when `opts.carveraProbing` is supplied; helper-built
   * via `buildCarveraProbingBlock`. Templates that do not reference this field
   * (FDM, Laguna, generic CNC) are byte-identical regardless of the value.
   *
   * Roadmap: [ID-0019].
   */
  carveraProbingBlock?: string
}

/**
 * Clamp a spindle RPM to the machine's min/max limits.
 * Returns the (possibly clamped) RPM and an optional warning string
 * describing any adjustment that was made.
 */
/**
 * Dialect-correct program-end terminator for multi-dialect templates.
 *
 * - `grbl` / `grbl_4axis` / `smoothieware` (Makera Carvera family) -> `M2`.
 *   Smoothieware community firmware can read `M30` as "program end AND delete
 *   the file from the SD card", silently destroying the program the operator
 *   is about to re-run. Use `M2`.
 * - `mach3` / `mach3_4axis` (RichAuto A-series, Laguna Swift) and `fanuc` ->
 *   `M30` (program end + rewind; Mach3 relies on the rewind side-effect).
 * - Everything else defaults to `M30`, the RS274NGC program-end+rewind
 *   terminator accepted by the broadest set of controllers.
 *
 * Mirrors `preferredProgramEndForDialect` in
 * `src/shared/gcode-end-program-invariants.ts` so the generic template emits
 * exactly the terminator the post-pipeline end-program validator prefers (no
 * self-inflicted END_DIALECT_MISMATCH warning).
 */
export function resolveGenericProgramEnd(
  dialect: MachineProfile['dialect']
): 'M2' | 'M30' {
  switch (dialect) {
    case 'grbl':
    case 'grbl_4axis':
    case 'smoothieware':
      return 'M2'
    default:
      // mach3 / mach3_4axis / fanuc / siemens / heidenhain / generic_mm
      return 'M30'
  }
}

export function clampSpindleRpm(
  rpm: number,
  machine: MachineProfile
): { rpm: number; warning?: string } {
  if (machine.maxSpindleRpm != null && rpm > machine.maxSpindleRpm) {
    return {
      rpm: machine.maxSpindleRpm,
      warning: `Spindle RPM ${rpm} exceeds machine maximum ${machine.maxSpindleRpm}; clamped to ${machine.maxSpindleRpm}`
    }
  }
  if (machine.minSpindleRpm != null && rpm < machine.minSpindleRpm) {
    return {
      rpm: machine.minSpindleRpm,
      warning: `Spindle RPM ${rpm} is below machine minimum ${machine.minSpindleRpm}; clamped to ${machine.minSpindleRpm}`
    }
  }
  return { rpm }
}

/**
 * Apply a custom spindle RPM to the dialect's default `on` string.
 * - If the string contains an S-word (e.g. `M3 S12000`), replace its value.
 * - If no S-word is present (e.g. Mach3's bare `M3`), append it.
 */
function applySpindleRpm(onString: string, rpm: number): string {
  const sWordPattern = /S\d+/
  if (sWordPattern.test(onString)) {
    return onString.replace(sWordPattern, `S${rpm}`)
  }
  return `${onString} S${rpm}`
}

export type RenderPostResult = { gcode: string; warnings: string[] }

/**
 * A single operation's posted G-code along with its tool slot.
 * Used by `sequenceMultiToolJob` to merge multiple operations
 * with automatic M6 tool change insertions between them.
 */
export type ToolOperationBlock = {
  /** ATC tool slot number (1–6). */
  toolSlot: number
  /** Already-posted G-code for this operation (complete with header/footer). */
  gcode: string
  /** Optional human-readable label for the operation. */
  label?: string
}

/**
 * Merge multiple posted G-code operations into a single program with
 * M6 tool change commands inserted between operations when the tool slot changes.
 *
 * Each operation block's G-code is emitted as-is (it already has its own
 * safety header/footer from `renderPost`). Between operations with different
 * tool slots, this function inserts:
 *   1. Spindle stop (M5)
 *   2. Safe Z retract (G0 Z<max>)
 *   3. Tool change (T<n> M6) -- omitted when supportsToolChange === false
 *   4. Tool length compensation re-apply (G43 H<n>) -- ONLY when
 *      `opts.emitToolLengthComp === true` AND supportsToolChange (ATC path).
 *      Mirrors the carvera_3axis.hbs preamble contract for mid-job changes.
 *      [ID-0013-followup] -- Safety Rule 1: without G43 H<n> after M6, the
 *      controller still uses the previous tool's length offset and the next
 *      feed move can drive Z below the programmed depth. Default false so
 *      pre-existing callers stay byte-identical (Safety Rule 2).
 *   5. A comment indicating the new operation
 *
 * When consecutive operations use the same tool slot, no tool change is
 * inserted -- the spindle Z reference is already correct, so G43 H<n> is
 * also omitted (no length offset has changed).
 *
 * @param blocks  Ordered array of tool operation blocks.
 * @param safeZMm  Safe Z retract height for tool changes.
 * @param commentPrefix  Comment prefix for the machine dialect (default "; ").
 * @param opts  `supportsToolChange` (default true) gates the M6 line;
 *   `emitToolLengthComp` (default false) gates the G43 H<n> follow-up.
 */
export function sequenceMultiToolJob(
  blocks: ToolOperationBlock[],
  safeZMm: number,
  commentPrefix = '; ',
  opts?: { supportsToolChange?: boolean; emitToolLengthComp?: boolean }
): string {
  if (blocks.length === 0) return ''
  if (blocks.length === 1) return blocks[0]!.gcode

  const parts: string[] = []
  let lastToolSlot: number | undefined
  const supportsToolChange = opts?.supportsToolChange !== false
  // [ID-0013-followup] Cycle 60: G43 H<n> tool-length compensation re-apply
  // after every mid-job M6 tool change. Defaults to false so callers that
  // pre-date this flag continue to emit byte-identical sequences (Safety
  // Rule 2). Carvera integration wires it true; the carvera_3axis.hbs
  // preamble already emits G43 H<n> after the initial M6 (see the template
  // at resources/posts/carvera_3axis.hbs:48-49) -- this option mirrors that
  // contract for every mid-job tool change so the spindle Z reference is
  // re-established each time the tool length changes. Without it, a longer
  // T2 inserted after T1 leaves the controller using T1's length and the
  // first feed move drives Z lower than commanded -- a Safety-Rule-1 crash.
  const emitToolLengthComp = opts?.emitToolLengthComp === true

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!
    if (i > 0 && block.toolSlot !== lastToolSlot) {
      // Insert tool change sequence between operations
      parts.push('')
      parts.push(`${commentPrefix}--- TOOL CHANGE: T${block.toolSlot}${block.label ? ` — ${block.label}` : ''} ---`)
      parts.push('M5')
      parts.push(`G0 Z${safeZMm}`)
      if (supportsToolChange) {
        parts.push(`T${block.toolSlot} M6`)
        if (emitToolLengthComp) {
          parts.push(`G43 H${block.toolSlot}`)
        }
      } else {
        parts.push(`${commentPrefix}Manual tool change required: load T${block.toolSlot} before continuing`)
      }
      parts.push('')
    } else if (i > 0) {
      // Same tool, just add a separator comment
      parts.push('')
      parts.push(`${commentPrefix}--- NEXT OPERATION${block.label ? `: ${block.label}` : ''} (same tool T${block.toolSlot}) ---`)
      parts.push('')
    }
    parts.push(block.gcode)
    lastToolSlot = block.toolSlot
  }

  return parts.join('\n')
}

/**
 * Default arc fitting tolerance in mm.
 * Typical CNC machines can handle 0.005 mm deviation without visible artifacts.
 */
/**
 * Configuration for the Carvera WCS-setup probing block ([ID-0019]).
 *
 * Drives the `M6 T<probeSlot>` -> `G38.2` -> `G10 L20 P<wcsRegister>` ->
 * `M6 T<stowSlot>` sequence emitted by `carvera_3axis.hbs` and
 * `carvera_4axis.hbs` when supplied via `renderPost`'s `carveraProbing` option.
 * Honors the `.claude/skills/gcode-safety/references/carvera-3axis.md`
 * "Air-probe vs wireless probe" contract:
 *
 *   "Use T0 for the wireless probe; include an explicit
 *    `M6 T0` -> probe cycle -> `M6 T-1` sequence; do not use T0
 *    as a cutting tool by mistake."
 *
 * Behavior split by axis count:
 *
 *   - **3-axis** (`carvera_3axis.hbs`): full XYZ corner probe. Probes
 *     -X edge, sets WCS X=0; probes -Y edge, sets WCS Y=0; probes -Z
 *     surface, sets WCS Z=0. `xProbeTargetMm` and `yProbeTargetMm`
 *     are REQUIRED.
 *   - **4-axis** (`carvera_4axis.hbs`): Z-only probe (rotary stock has
 *     no flat XY edge to touch). `xProbeTargetMm` / `yProbeTargetMm`
 *     are ignored when present.
 *
 * Safety contract:
 *
 *   - `approachZMm` MUST be at or above the machine's safe clearance.
 *     The block emits `G0 X<approach> Y<approach> Z<approach>` as the
 *     FIRST motion; if Z is below safe, the safe-Z retract validator
 *     ([ID-0110]) flags `RETRACT_NO_PRE_CUT_RETRACT` on the first
 *     subsequent cut. Callers should pass `machine.workAreaMm.z` (or
 *     `machine.safeRetractZMm` when set).
 *   - `feedMmPerMin` is conservatively capped at 300 -- Carvera firmware
 *     does not document a hard probe-feed limit; faster than 300 risks
 *     probe deflection error and false contact.
 *   - The block ends with `G0 Z<approach>` BEFORE `M6 T<stowSlot>` so
 *     subsequent XY rapids cannot transit at probe depth.
 */
export type CarveraProbingContext = {
  /** Probe slot for `M6 T<n>` to load the wireless probe. Carvera convention = 0. */
  probeSlot: number
  /** Slot to return the probe to via `M6 T<n>` after the cycle. Carvera convention = -1. */
  stowSlot: number
  /** Approach feed for the G38.2 probing moves (mm/min). Conservative ceiling: 300. */
  feedMmPerMin: number
  /** Approach X position above the probe target (mm, machine coords). */
  approachXMm: number
  /** Approach Y position above the probe target (mm, machine coords). */
  approachYMm: number
  /** Approach Z position above the probe target (mm, machine coords). MUST be >= safe Z. */
  approachZMm: number
  /** Maximum descent (absolute Z) for the Z probe. Probe surface should sit above this value. */
  zProbeTargetMm: number
  /** 3-axis only: signed X target for the corner edge probe. Required when axisCount===3. */
  xProbeTargetMm?: number
  /** 3-axis only: signed Y target for the corner edge probe. Required when axisCount===3. */
  yProbeTargetMm?: number
  /** WCS register (1..6 -> G54..G59) the G10 L20 set targets. */
  wcsRegister: 1 | 2 | 3 | 4 | 5 | 6
}

/**
 * Build the Carvera WCS-setup probing block for `carvera_3axis.hbs` / `carvera_4axis.hbs`
 * ([ID-0019]). Returns a multi-line string ready to drop into the post template via
 * `{{{carveraProbingBlock}}}`. See `CarveraProbingContext` for the safety contract.
 *
 * Throws an `Error` (not a warning) on invalid input -- the caller should be a
 * job-prep step that surfaces the error in the UI before any G-code is staged.
 *
 * @param probing    Probing fixture configuration.
 * @param axisCount  3 or 4 -- gates the corner-probe vs Z-only sequence.
 * @returns          Multi-line G-code block, no trailing newline.
 */
export function buildCarveraProbingBlock(
  probing: CarveraProbingContext,
  axisCount: 3 | 4
): string {
  if (probing.feedMmPerMin <= 0) {
    throw new Error(
      `[ID-0019] Carvera probing feed must be positive (got ${probing.feedMmPerMin} mm/min)`
    )
  }
  if (probing.feedMmPerMin > 300) {
    // ASSUMPTION: 300 mm/min is a defensive ceiling derived from common Smoothieware
    // probe macros; Carvera firmware does not publish a hard limit. Faster than
    // 300 risks probe deflection error / false contact -- Safety Rule 1 territory.
    throw new Error(
      `[ID-0019] Carvera probing feed ${probing.feedMmPerMin} mm/min exceeds the safe ` +
      '300 mm/min ceiling. Reduce feedMmPerMin and re-render.'
    )
  }
  if (probing.wcsRegister < 1 || probing.wcsRegister > 6) {
    throw new Error(
      `[ID-0019] Carvera probing wcsRegister must be 1..6 (got ${probing.wcsRegister})`
    )
  }
  if (probing.zProbeTargetMm >= probing.approachZMm) {
    throw new Error(
      `[ID-0019] Carvera probing zProbeTargetMm (${probing.zProbeTargetMm}) must be ` +
      `strictly less than approachZMm (${probing.approachZMm}) -- the probe descends.`
    )
  }
  if (axisCount === 3) {
    if (probing.xProbeTargetMm === undefined || probing.yProbeTargetMm === undefined) {
      throw new Error(
        '[ID-0019] Carvera 3-axis probing requires xProbeTargetMm and yProbeTargetMm ' +
        '(corner probe). Use 4-axis probing for Z-only rotary jobs.'
      )
    }
  }

  // The 1-based register index maps to G54..G59 (offset 53). Used in the comment
  // string only; the G10 L20 P<n> form takes the 1..6 index directly.
  const wcsLabel = `G5${probing.wcsRegister + 3}`

  const lines: string[] = [
    '; --- Carvera WCS-setup probing (UNVERIFIED -- verify against Carvera firmware docs) ---',
    `; Loads wireless probe (T${probing.probeSlot}), probes ${axisCount === 3 ? 'X/Y/Z corner' : 'Z surface'}, sets ${wcsLabel}, stows probe (T${probing.stowSlot}).`,
    '; Honors carvera-3axis.md "Use T0 for the wireless probe" contract.',
    `M6 T${probing.probeSlot}            ; load wireless probe`,
    `G0 X${gFmt(probing.approachXMm)} Y${gFmt(probing.approachYMm)} Z${gFmt(probing.approachZMm)} ; approach probe target at safe Z`
  ]
  if (axisCount === 3) {
    lines.push(
      `G38.2 X${gFmt(probing.xProbeTargetMm!)} F${gFmt(probing.feedMmPerMin)} ; probe X edge`,
      `G10 L20 P${probing.wcsRegister} X0 ; set ${wcsLabel} X=0 at probe contact`,
      `G0 X${gFmt(probing.approachXMm)} ; back off X to approach`,
      `G38.2 Y${gFmt(probing.yProbeTargetMm!)} F${gFmt(probing.feedMmPerMin)} ; probe Y edge`,
      `G10 L20 P${probing.wcsRegister} Y0 ; set ${wcsLabel} Y=0 at probe contact`,
      `G0 Y${gFmt(probing.approachYMm)} ; back off Y to approach`
    )
  }
  // Z probe runs in BOTH 3-axis (top of stock corner) and 4-axis (top of rotary stock at center).
  lines.push(
    `G38.2 Z${gFmt(probing.zProbeTargetMm)} F${gFmt(probing.feedMmPerMin)} ; probe Z surface`,
    `G10 L20 P${probing.wcsRegister} Z0 ; set ${wcsLabel} Z=0 at probe contact`,
    `G0 Z${gFmt(probing.approachZMm)} ; retract Z to safe approach BEFORE stowing probe`,
    `M6 T${probing.stowSlot}            ; stow wireless probe (T${probing.stowSlot} = no tool)`,
    '; --- end probing block ---'
  )
  return lines.join('\n')
}

const DEFAULT_ARC_TOLERANCE_MM = 0.005

/**
 * [ID-0173] Detect a rotary-axis word (A / B / C) followed by a numeric value
 * preceded by start-of-string or whitespace. Used by `applyArcFitting` to
 * bypass arc fitting on any 4-axis (or future B/C-axis) toolpath. The leading
 * `(?:^|\s)` anchor avoids false positives on letters embedded inside other
 * tokens (e.g. ``HAB1`` would not match; ``G1 X10 A1`` matches via the space).
 * Over-conservative by design: a comment line such as ``; A1 mode`` will
 * trigger the bypass, which only inhibits arc fitting (safe direction). False
 * negatives -- silently stripping a rotary word from a fitted arc -- are not
 * allowed (Safety Rule 1).
 */
const HAS_ROTARY_AXIS_WORD = /(?:^|\s)[ABC][+-]?\d/

/**
 * Parse a G1 toolpath line into a 3D point (X, Y, Z).
 * Returns null if the line is not a G1 move or doesn't have coordinates.
 */
function parseG1Point(line: string): Point3D | null {
  const trimmed = line.trim()
  if (!/^G0?1(?:\s|[A-Z]|$)/i.test(trimmed)) return null

  const xm = trimmed.match(/X([+-]?\d+(?:\.\d+)?)/)
  const ym = trimmed.match(/Y([+-]?\d+(?:\.\d+)?)/)
  const zm = trimmed.match(/Z([+-]?\d+(?:\.\d+)?)/)

  // Need at least one coordinate
  if (!xm && !ym && !zm) return null

  return {
    x: xm ? Number.parseFloat(xm[1]!) : 0,
    y: ym ? Number.parseFloat(ym[1]!) : 0,
    z: zm ? Number.parseFloat(zm[1]!) : 0
  }
}

/**
 * Extract feed rate from a G1 line, if present.
 */
function extractFeedRate(line: string): string | null {
  const m = line.match(/F(\d+(?:\.\d+)?)/)
  return m ? `F${m[1]}` : null
}

/**
 * Format a number for G-code output: up to 4 decimal places, no trailing zeros.
 */
function gFmt(n: number): string {
  return Number.parseFloat(n.toFixed(4)).toString()
}

/**
 * Convert a GCodeSegment to a G-code line string.
 */
function segmentToGcodeLine(seg: GCodeSegment, feedRate: string | null): string {
  if (seg.type === 'G1') {
    const parts = [`G1 X${gFmt(seg.x)} Y${gFmt(seg.y)} Z${gFmt(seg.z)}`]
    if (feedRate) parts.push(feedRate)
    return parts.join(' ')
  }
  // G2/G3 arc
  const planePart = seg.plane !== 'G17' ? `${seg.plane} ` : ''
  const parts = [
    `${planePart}${seg.type} X${gFmt(seg.x)} Y${gFmt(seg.y)} Z${gFmt(seg.z)}`,
    `I${gFmt(seg.i)} J${gFmt(seg.j)}`
  ]
  // Only include K for non-G17 planes where K is meaningful
  if (seg.plane === 'G18' || seg.plane === 'G19') {
    parts.push(`K${gFmt(seg.k)}`)
  }
  if (feedRate) parts.push(feedRate)
  return parts.join(' ')
}

/**
 * Run arc fitting on toolpath lines, converting consecutive G1 moves that lie
 * on a circular arc into G2/G3 commands. Non-G1 lines (G0 rapids, comments,
 * M-codes, etc.) are passed through unchanged.
 *
 * **Safety [ID-0173]: 4-axis rotary bypass.** Arc fitting is XY-plane-only --
 * `parseG1Point` only extracts X / Y / Z words and `segmentToGcodeLine` only
 * emits X / Y / Z (plus optional I / J / K). If the input toolpath contains
 * any rotary axis word (A / B / C), buffering those lines into a G1-arc fit
 * would silently strip the rotary word from the emitted G2/G3 segment -- a
 * CLAUDE.md "Safety Rule 1: G-code is sacred" violation for the **Makera
 * Carvera + 4th Axis Rotary** target machine (and any future B / C-axis
 * configuration). When ANY input line references a rotary word, this
 * function returns the input lines verbatim (in a fresh array) without
 * attempting arc fitting. Callers that want arc fitting on a 3-axis subset
 * of a 4-axis program must filter the rotary lines out before calling.
 *
 * @param lines     Raw toolpath lines (G0/G1 mix).
 * @param tolerance Maximum deviation (mm) for arc fitting.
 * @returns New array of toolpath lines with arcs inserted where applicable,
 *          or a fresh copy of the input array unchanged when any rotary
 *          axis word (A / B / C) is detected.
 */
export function applyArcFitting(lines: string[], tolerance: number): string[] {
  // Safety [ID-0173] -- 4-axis rotary bypass. See JSDoc above.
  for (const line of lines) {
    if (HAS_ROTARY_AXIS_WORD.test(line)) {
      return lines.slice()
    }
  }
  const result: string[] = []
  let g1Buffer: { point: Point3D; feedRate: string | null; originalLine: string }[] = []

  function flushG1Buffer(): void {
    if (g1Buffer.length === 0) return

    if (g1Buffer.length < 3) {
      // Not enough points for arc fitting — emit as-is
      for (const entry of g1Buffer) {
        result.push(entry.originalLine)
      }
      g1Buffer = []
      return
    }

    // Build point array (first point is the implicit start from previous move)
    // For arc fitting we need the points including the starting position.
    // Since we only have G1 endpoints, the first point is the destination of the
    // move before this buffer. We use the first G1 point as a segment starting
    // "from" somewhere — the arc fitter works on vertices, not segments.
    const points: Point3D[] = g1Buffer.map(e => e.point)

    // Use the feed rate from the last G1 in the buffer (most recently seen F-word)
    let lastFeed: string | null = null
    for (const entry of g1Buffer) {
      if (entry.feedRate) lastFeed = entry.feedRate
    }

    const segments = fitArcsToLinearPath(points, tolerance)

    for (const seg of segments) {
      result.push(segmentToGcodeLine(seg, lastFeed))
    }

    g1Buffer = []
  }

  for (const line of lines) {
    const pt = parseG1Point(line)
    if (pt) {
      g1Buffer.push({ point: pt, feedRate: extractFeedRate(line), originalLine: line })
    } else {
      // Non-G1 line: flush any accumulated G1 buffer first, then pass through
      flushG1Buffer()
      result.push(line)
    }
  }

  // Flush any remaining G1 buffer at the end
  flushG1Buffer()

  return result
}

/**
 * Build cutter compensation G-code lines.
 *
 * @param mode  'left' for G41 (climb), 'right' for G42 (conventional), 'none' for no compensation.
 * @param dRegister  Optional D-register number for wear offset selection.
 * @returns Object with `engage` line (G41/G42) and `cancel` line (G40), or null if mode is 'none'.
 */
export function buildCutterCompLines(
  mode: 'none' | 'left' | 'right',
  dRegister?: number
): { engage: string; cancel: string } | null {
  if (mode === 'none') return null

  const gCode = mode === 'left' ? 'G41' : 'G42'
  const dPart = dRegister != null ? ` D${dRegister}` : ''
  return {
    engage: `${gCode}${dPart}`,
    cancel: 'G40'
  }
}

/**
 * Apply cutter compensation to toolpath lines by inserting G41/G42 before
 * the first feed move and G40 after the last feed move.
 *
 * **Safety [ID-0176]: 4-axis rotary bypass.** Cutter compensation (G41/G42)
 * is XY-plane-only on every controller in CLAUDE.md "USER CONTEXT --
 * TARGET MACHINES" scope (Mach3 / RichAuto A-series / Smoothieware /
 * Klipper). Inserting G41 / G42 around a 4-axis toolpath that contains
 * any rotary axis word (A / B / C) yields controller rejection or
 * unpredictable diameter compensation while the rotary axis is moving --
 * a CLAUDE.md "Safety Rule 1: G-code is sacred" violation for the
 * **Makera Carvera + 4th Axis Rotary** target machine (and any future
 * B / C-axis configuration).
 *
 * When ANY input line references a rotary axis word, this function returns
 * the input lines verbatim (in a fresh array) without inserting G41 / G42 /
 * G40. Mirrors the [ID-0173] bypass on `applyArcFitting`. Over-conservative
 * by design: a comment line such as ``; A1 calibration`` will trigger the
 * bypass, which only inhibits compensation insertion (safe direction).
 * False negatives -- silently bracketing a rotary toolpath with G41 / G42 --
 * are not allowed (Safety Rule 1). Callers that want compensation on a
 * 3-axis subset of a 4-axis program must filter the rotary lines out
 * before calling.
 *
 * @param lines  Toolpath lines (G0/G1/G2/G3 mix).
 * @param mode   Compensation mode.
 * @param dRegister  Optional D-register number.
 * @returns New array of toolpath lines with compensation commands inserted,
 *          or a fresh copy of the input array unchanged when any rotary
 *          axis word (A / B / C) is detected.
 */
export function applyCutterCompensation(
  lines: string[],
  mode: 'none' | 'left' | 'right',
  dRegister?: number
): string[] {
  const comp = buildCutterCompLines(mode, dRegister)
  if (!comp) return lines

  // Safety [ID-0176] -- 4-axis rotary bypass. See JSDoc above.
  for (const line of lines) {
    if (HAS_ROTARY_AXIS_WORD.test(line)) {
      return lines.slice()
    }
  }

  // Find the first feed move (G1/G2/G3) and insert G41/G42 before it
  // Find the last feed move and insert G40 after it
  let firstFeedIdx = -1
  let lastFeedIdx = -1
  const feedPattern = /^G0?[123](?:\s|[A-Z]|$)/i

  for (let i = 0; i < lines.length; i++) {
    if (feedPattern.test(lines[i]!.trim())) {
      if (firstFeedIdx === -1) firstFeedIdx = i
      lastFeedIdx = i
    }
  }

  if (firstFeedIdx === -1) return lines // No feed moves found

  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i === firstFeedIdx) {
      result.push(comp.engage)
    }
    result.push(lines[i]!)
    if (i === lastFeedIdx) {
      result.push(comp.cancel)
    }
  }

  return result
}

// ── Subroutine Detection & Wrapping ─────────────────────────────────────────

/**
 * A detected repeating pattern in toolpath lines.
 * `lines` are the repeated block, `count` is how many consecutive times it repeats,
 * and `startIndex` is where the first occurrence begins in the original array.
 */
export type RepeatPattern = {
  lines: string[]
  count: number
  startIndex: number
}

/**
 * Detect consecutive repeated blocks of G-code lines.
 *
 * Scans the input for sequences of N lines (block) that repeat
 * consecutively >= `minRepeats` times. Tries block sizes from largest
 * feasible down to `minBlockSize`, and returns the first (longest) match
 * found at each position.
 *
 * Only examines exact textual repeats (after whitespace normalization).
 */
export function detectRepeatPatterns(
  lines: string[],
  minRepeats = 3,
  minBlockSize = 2
): RepeatPattern[] {
  const patterns: RepeatPattern[] = []
  const consumed = new Set<number>()

  // Normalize a line for comparison: trim whitespace, collapse multiple spaces
  const norm = (l: string): string => l.trim().replace(/\s+/g, ' ')

  for (let i = 0; i < lines.length; i++) {
    if (consumed.has(i)) continue

    // Try block sizes from largest feasible down to minimum
    const maxBlock = Math.floor((lines.length - i) / minRepeats)
    for (let blockSize = Math.min(maxBlock, 20); blockSize >= minBlockSize; blockSize--) {
      const block = lines.slice(i, i + blockSize)

      // Count how many consecutive times this block repeats
      let repeats = 1
      let j = i + blockSize
      while (j + blockSize <= lines.length) {
        let matches = true
        for (let k = 0; k < blockSize; k++) {
          if (norm(lines[j + k]!) !== norm(block[k]!)) {
            matches = false
            break
          }
        }
        if (!matches) break
        repeats++
        j += blockSize
      }

      if (repeats >= minRepeats) {
        patterns.push({ lines: block, count: repeats, startIndex: i })
        // Mark all repeated lines as consumed
        for (let idx = i; idx < i + blockSize * repeats; idx++) {
          consumed.add(idx)
        }
        break // Found a pattern at this position, move on
      }
    }
  }

  return patterns
}

/**
 * Wrap detected repeat patterns as subroutines in the appropriate dialect.
 *
 * - Fanuc: O<num> subroutine body M99, called via M98 P<num> L<count>
 * - Siemens: L<num>: subroutine body RET, called via CALL L<num> REP <count>
 * - Mach3: O<num> sub ... O<num> endsub, called via M98 P<num> L<count>
 *
 * Returns the transformed toolpath lines with inline repeat blocks replaced
 * by subroutine calls, plus the subroutine definitions to append at the end.
 */
export function wrapRepeatPatternsAsSubroutines(
  lines: string[],
  dialect: SubroutineDialect,
  startSubNumber = 1000
): { mainLines: string[]; subroutineDefs: string[] } {
  const patterns = detectRepeatPatterns(lines)

  if (patterns.length === 0) {
    return { mainLines: [...lines], subroutineDefs: [] }
  }

  // Sort patterns by startIndex descending so we can replace from the end
  // without shifting indices.
  const sorted = [...patterns].sort((a, b) => b.startIndex - a.startIndex)

  const mainLines = [...lines]
  const subroutineDefs: string[] = []
  let subNum = startSubNumber

  for (const pattern of sorted) {
    const { lines: block, count, startIndex } = pattern
    const totalLines = block.length * count
    const currentSubNum = subNum

    // Generate subroutine call based on dialect
    let callLine: string
    switch (dialect) {
      case 'fanuc':
        callLine = `M98 P${currentSubNum} L${count}`
        break
      case 'siemens':
        callLine = `CALL L${currentSubNum} REP ${count}`
        break
      case 'mach3':
        callLine = `M98 P${currentSubNum} L${count}`
        break
    }

    // Generate subroutine definition
    const defLines: string[] = []
    switch (dialect) {
      case 'fanuc':
        defLines.push(`O${currentSubNum} (SUBROUTINE ${currentSubNum})`)
        defLines.push(...block)
        defLines.push('M99')
        break
      case 'siemens':
        defLines.push(`; Subroutine L${currentSubNum}`)
        defLines.push(`L${currentSubNum}:`)
        defLines.push(...block)
        defLines.push('RET')
        break
      case 'mach3':
        defLines.push(`O${currentSubNum} sub`)
        defLines.push(...block)
        defLines.push(`O${currentSubNum} endsub`)
        break
    }

    subroutineDefs.push(...defLines, '')

    // Replace the repeated block in mainLines with the subroutine call
    mainLines.splice(startIndex, totalLines, `; --- Subroutine call (${count}x repeat) ---`, callLine)

    subNum += 1
  }

  return { mainLines, subroutineDefs }
}

// ── Line Numbering ──────────────────────────────────────────────────────────────

/**
 * Prepend N-word line numbers to every non-blank G-code line.
 * Comment lines (starting with ; or parenthesized comments) and blank lines
 * are left unnumbered to preserve readability.
 *
 * @param gcode  The complete G-code string.
 * @param config  Line numbering configuration (start, increment).
 * @returns The G-code string with N-words prepended.
 */
export function applyLineNumbering(gcode: string, config: LineNumberingConfig): string {
  if (!config.enabled) return gcode

  const lines = gcode.split('\n')
  let currentN = config.start
  const increment = config.increment

  const numbered = lines.map((line) => {
    const trimmed = line.trim()
    // Skip blank lines
    if (trimmed.length === 0) return line
    // Skip comment-only lines (semicolon or full parenthetical)
    if (trimmed.startsWith(';') || trimmed.startsWith('(')) return line
    // Skip Handlebars-style template lines (should not appear in final output, but safety)
    if (trimmed.startsWith('{{')) return line

    const n = currentN
    currentN += increment
    return `N${n} ${line}`
  })

  return numbered.join('\n')
}

/**
 * [ID-0143] Compiled-post-template cache.
 *
 * `renderPost` is hot in tests (199+ calls in `post-process-safety.test.ts`)
 * and in production (every CAM job + every header-only spindle preflight).
 * Each call previously did:
 *   1. `await readFile(tplPath, 'utf-8')` -- ~3-12 KB sync I/O
 *   2. `Handlebars.compile(source)` -- non-trivial parse + AST build
 * Both are pure functions of `tplPath`. The bundled posts ship in
 * `resources/posts/*.hbs` and never mutate at runtime, so caching the
 * COMPILED delegate keyed on `tplPath` is byte-identical to the uncached
 * path while avoiding repeated disk + compile cost.
 *
 * Cache is module-scoped Map<string, Promise<HandlebarsTemplateDelegate>>:
 *   - Promise-keyed so concurrent first-callers race-share one read+compile.
 *   - Cleared via the exported `__resetPostTemplateCache` for test isolation
 *     and for hot-reload scenarios that rewrite a post template on disk.
 *
 * Safety: returns the SAME compiled delegate; output gcode is byte-identical
 * to the uncached path. Snapshot stability + warning-array isolation
 * (warnings are computed per-call from the rendered output, not from the
 * template) are preserved by construction.
 */
const compiledPostTemplateCache = new Map<string, Promise<HandlebarsTemplateDelegate<PostContext>>>()

async function getOrLoadCompiledTemplate(
  tplPath: string
): Promise<HandlebarsTemplateDelegate<PostContext>> {
  let cached = compiledPostTemplateCache.get(tplPath)
  if (cached === undefined) {
    cached = readFile(tplPath, 'utf-8').then((source) =>
      Handlebars.compile<PostContext>(source)
    )
    compiledPostTemplateCache.set(tplPath, cached)
  }
  return cached
}

/**
 * Test-only / hot-reload-only cache reset for the [ID-0143] compiled-post-
 * template cache. Production callers should not need this; the cache is
 * pure-functional w.r.t. the bundled `resources/posts/*.hbs` files.
 */
export function __resetPostTemplateCache(): void {
  compiledPostTemplateCache.clear()
}

export async function renderPost(
  resourcesRoot: string,
  machine: MachineProfile,
  toolpathLines: string[],
  opts?: {
    workCoordinateIndex?: number
    operationLabel?: string
    spindleRpm?: number
    toolNumber?: number
    inverseTimeFeed?: boolean
    toolWearOffsetH?: number
    toolWearOffsetD?: number
    enableArcFitting?: boolean
    arcTolerance?: number
    cutterCompensation?: 'none' | 'left' | 'right'
    cutterCompDRegister?: number
    enableSubroutines?: boolean
    subroutineDialect?: SubroutineDialect
    lineNumbering?: LineNumberingConfig
    dustCollection?: boolean
    /**
     * When true, the Carvera 4-axis post emits the UNVERIFIED-SIMULTANEOUS
     * warning header. See PostContext.enableSimultaneous4Axis for the full
     * rationale ([ID-0015]). Strict-true gate; non-Carvera-4-axis templates
     * are byte-identical regardless.
     */
    enableSimultaneous4Axis?: boolean
    /**
     * When true, suppress ATC M6 + G43 emission in templates that gate on
     * `manualToolChange`. See PostContext.manualToolChange ([ID-0013-integration]).
     * Strict-true via the runner-shims extractor; default off preserves byte-identity.
     */
    manualToolChange?: boolean
    /**
     * Optional Laguna Swift 5x10 vacuum-zone allocation. When supplied,
     * `wrapLagunaToolpathWithVacuumBlocks` (from
     * `src/shared/laguna-vacuum-postlude.ts`) splices an operator-readable
     * preamble + release postamble around the toolpath BEFORE subroutine
     * wrapping runs (so the wrap markers stay top-level and never become
     * subroutine bodies). When omitted, the post pipeline is byte-identical
     * to the pre-Cycle-109 baseline. Roadmap [ID-0020-wire].
     */
    vacuumZoneAllocation?: LagunaVacuumZoneAllocation
    /**
     * Optional companion options for `vacuumZoneAllocation`. Currently
     * gates the off-by-default Mach3 M64/M65 immediate-digital-output
     * emission. Ignored when `vacuumZoneAllocation` is undefined.
     */
    vacuumOptions?: LagunaVacuumPostludeOptions
    /**
     * Carvera WCS-setup probing fixture. When supplied AND the post
     * template references `{{{carveraProbingBlock}}}` (the bundled
     * `carvera_3axis.hbs` and `carvera_4axis.hbs`), `renderPost` builds
     * the probing block via `buildCarveraProbingBlock` keyed on the
     * machine's `axisCount` and injects it into the template context.
     * When omitted, output is byte-identical to the pre-[ID-0019] baseline.
     *
     * Throws when probing config is invalid (negative feed, missing
     * corner targets for 3-axis, etc.) -- see `buildCarveraProbingBlock`
     * for the validation contract. Roadmap [ID-0019].
     */
    carveraProbing?: CarveraProbingContext
  }
): Promise<RenderPostResult> {
  const tplPath = join(resourcesRoot, 'posts', machine.postTemplate)
  const template = await getOrLoadCompiledTemplate(tplPath)
  const { on, off, units } = resolveDialectSnippets(machine.dialect)
  const wcsLine = resolveWorkOffsetLine(opts?.workCoordinateIndex)

  let spindleOn = on
  let spindleWarning: string | undefined
  if (opts?.spindleRpm != null) {
    const clamped = clampSpindleRpm(opts.spindleRpm, machine)
    spindleOn = applySpindleRpm(on, clamped.rpm)
    spindleWarning = clamped.warning
  } else {
    // task_feef69e0: the dialect's hard-coded default S-word used to bypass
    // clampSpindleRpm entirely -- the Smoothieware default `M3 S12000` ran the
    // Carvera 3-axis 200 W spindle BELOW its rated 13,000 RPM floor
    // (`minSpindleRpm`; sub-13k risks spindle damage per the gcode-safety
    // reference). When no explicit RPM is provided, resolve the dialect
    // default against the machine's rated window instead of emitting the raw
    // constant. SILENT by design: this is the system choosing a correct
    // default, not an operator input being adjusted -- a warning here would
    // fire on every legitimate program (the advisory-noise trap). Dialects
    // whose default has no S-word (Mach3's bare `M3` -- the Laguna pendant
    // owns RPM) and machines whose window already contains the default
    // (Carvera 4-axis, floor 6000) are byte-untouched.
    const defaultSWord = on.match(/S(\d+)/)
    if (defaultSWord) {
      const defaultRpm = Number.parseInt(defaultSWord[1]!, 10)
      const resolved = clampSpindleRpm(defaultRpm, machine)
      if (resolved.rpm !== defaultRpm) {
        spindleOn = applySpindleRpm(on, resolved.rpm)
      }
    }
  }

  // ── Arc fitting: convert G1 sequences to G2/G3 arcs where possible ──
  let processedLines = toolpathLines
  if (opts?.enableArcFitting) {
    const tol = opts.arcTolerance ?? DEFAULT_ARC_TOLERANCE_MM
    processedLines = applyArcFitting(processedLines, tol)
  }

  // ── Cutter compensation: insert G41/G42 and G40 around contour moves ──
  const compMode = opts?.cutterCompensation ?? 'none'
  if (compMode !== 'none') {
    processedLines = applyCutterCompensation(processedLines, compMode, opts?.cutterCompDRegister)
  }

  // ── Laguna Swift 5x10 vacuum-zone wrap (Cycle 109 [ID-0020-wire]) ──
  // Splice the operator-readable preamble + release postamble around the
  // toolpath BEFORE subroutine wrapping so the M64/M65 lines and the
  // semicolon-comment markers stay top-level (never become subroutine bodies)
  // and so any future arc-fitting / cutter-comp passes see the original
  // toolpath unchanged. Safety Rule 1: the helper never mutates toolpath
  // bytes -- it only adds wrapping lines around them.
  if (opts?.vacuumZoneAllocation) {
    processedLines = wrapLagunaToolpathWithVacuumBlocks(
      processedLines,
      opts.vacuumZoneAllocation,
      opts.vacuumOptions ?? {}
    )
  }

  // ── Subroutine wrapping: detect repeated patterns and wrap in subroutines ──
  let subroutineDefs: string[] = []
  if (opts?.enableSubroutines && opts.subroutineDialect) {
    const subResult = wrapRepeatPatternsAsSubroutines(processedLines, opts.subroutineDialect)
    processedLines = subResult.mainLines
    subroutineDefs = subResult.subroutineDefs
  }

  // Carvera WCS-setup probing block ([ID-0019]).
  // When supplied, build the block via the helper (with full validation)
  // and inject as `carveraProbingBlock` into the template context. Templates
  // that do not reference the field are byte-identical regardless.
  let carveraProbingBlock: string | undefined
  if (opts?.carveraProbing) {
    const ax: 3 | 4 = machine.axisCount === 4 ? 4 : 3
    carveraProbingBlock = buildCarveraProbingBlock(opts.carveraProbing, ax)
  }

  const programEnd = resolveGenericProgramEnd(machine.dialect)

  const ctx: PostContext = {
    machine,
    toolpathLines: processedLines,
    spindleOn,
    spindleOff: off,
    units,
    programEnd,
    ...(wcsLine ? { wcsLine } : {}),
    ...(opts?.operationLabel ? { operationLabel: opts.operationLabel } : {}),
    ...(spindleWarning ? { spindleWarning } : {}),
    ...(opts?.toolNumber != null ? { toolNumber: opts.toolNumber } : {}),
    ...(opts?.inverseTimeFeed ? { inverseTimeFeed: true } : {}),
    ...(opts?.toolWearOffsetH != null ? { toolWearOffsetH: opts.toolWearOffsetH } : {}),
    ...(opts?.toolWearOffsetD != null ? { toolWearOffsetD: opts.toolWearOffsetD } : {}),
    ...(opts?.enableArcFitting ? { enableArcFitting: true } : {}),
    ...(opts?.arcTolerance != null ? { arcTolerance: opts.arcTolerance } : {}),
    ...(compMode !== 'none' ? { cutterCompensation: compMode } : {}),
    ...(opts?.cutterCompDRegister != null ? { cutterCompDRegister: opts.cutterCompDRegister } : {}),
    ...(opts?.dustCollection ? { dustCollection: true } : {}),
    ...(opts?.enableSimultaneous4Axis === true ? { enableSimultaneous4Axis: true } : {}),
    ...(opts?.manualToolChange === true ? { manualToolChange: true } : {}),
    ...(carveraProbingBlock !== undefined ? { carveraProbingBlock } : {})
  }
  let gcode = template(ctx)

  // Append subroutine definitions at the end if any were generated
  if (subroutineDefs.length > 0) {
    gcode = gcode.trimEnd() + '\n\n; --- SUBROUTINE DEFINITIONS ---\n' + subroutineDefs.join('\n')
  }

  // Apply line numbering as the final step (after all other transformations)
  if (opts?.lineNumbering?.enabled) {
    gcode = applyLineNumbering(gcode, opts.lineNumbering)
  }

  const warnings: string[] = spindleWarning ? [spindleWarning] : []
  const compliance = validateDialectCompliance(gcode, machine.dialect)
  for (const issue of compliance) {
    warnings.push(`[${issue.code}] ${issue.message} (line ${issue.line})`)
  }
  // [ID-0018] Universal post-pipeline header invariants: every CNC post
  // must declare units, absolute mode, plane select, and (recommended)
  // WCS before the first motion word. Skipped for FDM machines -- see
  // gcode-header-invariants.ts for the rationale.
  const headerMode = headerInvariantModeForMachine(machine)
  const headerIssues = validateGcodeHeaderInvariants(gcode, headerMode)
  for (const issue of headerIssues) {
    warnings.push(
      `[${issue.code}] ${issue.message} (first motion line ${issue.firstMotionLine})`
    )
  }
  // [ID-0108] Universal post-pipeline end-of-program invariants: every CNC
  // post must emit a program-end terminator (M2 or M30), must leave the
  // spindle off before it, and the terminator must match the dialect
  // convention (mach3/mach3_4axis prefer M30; grbl/grbl_4axis prefer M2
  // because Smoothieware's M30 deletes the currently-running file).
  // Skipped for FDM machines -- see gcode-end-program-invariants.ts.
  const endMode = endProgramInvariantModeForMachine(machine)
  const endIssues = validateGcodeEndProgramInvariants(gcode, endMode, machine.dialect)
  for (const issue of endIssues) {
    warnings.push(`[${issue.code}] ${issue.message} (line ${issue.line})`)
  }
  // [ID-0110] Universal post-pipeline safe-Z retract invariants: every CNC
  // post must (a) emit a G0 Z>=safe before the first cut, (b) emit a G0
  // Z>=safe between the last cut and the program-end command, and (c)
  // never rapid in XY while modal Z is below the safe clearance. Skipped
  // for FDM machines -- see gcode-safe-z-retract-invariants.ts. Follow-up
  // to Cycle 36 [ID-0109] which landed the pure validator module.
  const safeZMode = safeZInvariantModeForMachine(machine)
  const safeZClearance = resolveSafeZClearanceMm(machine)
  const safeZIssues = validateGcodeSafeZRetractInvariants(
    gcode,
    safeZMode,
    safeZClearance
  )
  for (const issue of safeZIssues) {
    warnings.push(`[${issue.code}] ${issue.message} (line ${issue.line})`)
  }
  return { gcode, warnings }
}
