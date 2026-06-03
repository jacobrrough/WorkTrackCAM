/**
 * Pure parser for the Klipper / Slic3r / OrcaSlicer / PrusaSlicer "header
 * health" surface that Mainsail and Fluidd render in the K2 Plus file
 * picker (estimated time, filament use, layer count) and the embedded
 * PNG thumbnail block that lets the picker show a preview instead of a
 * raw filename.
 *
 * Why this is a separate module
 * -----------------------------
 * `src/main/gcode-header-read.ts` is pinned down to exactly two exports
 * (the `readGcodeHeaderText` reader + the `DEFAULT_GCODE_HEADER_BYTES`
 * constant) by `gcode-header-read-pin.test.ts`. To keep that pin intact
 * (and to keep the bounded-read helper a true pure-leaf module), the
 * parsing surface lives here, in `src/shared/`, side-by-side with the
 * temperature validator -- both are pure functions that consume the
 * same bounded header text.
 *
 * Safety
 * ------
 * Safety Rule 1 (G-code is sacred): this module is READ-ONLY. It never
 * emits, never mutates, never modifies post-processor templates or
 * machine profiles. The only outputs are advisory `GcodeHeaderHealth`
 * results that the renderer surfaces as a badge before the user clicks
 * Send.
 *
 * Three-machine scope
 * -------------------
 *   - Creality K2 Plus (FDM, Klipper/Moonraker): DIRECT consumer. The
 *     thumbnail block is what makes Mainsail/Fluidd render previews in
 *     the printer file list; the time / filament / layer fields drive
 *     the file-picker metadata column.
 *   - Laguna Swift 5x10 (RichAuto A-series): NOT a consumer. CNC posts
 *     don't carry slicer thumbnails or filament metadata.
 *   - Makera Carvera + 4-axis: NOT a consumer. Same rationale.
 */

export type GcodeHeaderField =
  | 'time'
  | 'filament'
  | 'layerCount'
  | 'thumbnail'

export interface GcodeHeaderHealth {
  /**
   * True when EVERY advisory field is present. The upload is still
   * allowed when this is false -- these are quality hints, not blockers.
   */
  ok: boolean
  /**
   * The list of advisory fields that the parser could not find in the
   * header. Empty when `ok` is true.
   */
  missingFields: GcodeHeaderField[]
  /**
   * Parsed values, when present. `undefined` when the corresponding
   * field is missing.
   */
  fields: {
    /** Estimated print time in seconds, parsed from `;TIME:` or `;PRINT_TIME:`. */
    timeSeconds?: number
    /** Filament used in millimetres OR grams, depending on which comment the slicer emitted. */
    filament?: { mm?: number; grams?: number }
    /** Total layer count, parsed from common layer-count comments. */
    layerCount?: number
    /** Thumbnail metadata, present when any `; thumbnail begin` block is found. */
    thumbnail?: {
      widthPx: number
      heightPx: number
      bytes: number
    }
    /**
     * Power-loss recovery sentinel presence (Klipper SAVE_VARIABLE or
     * Marlin M413). K2 Plus runs Klipper, so the canonical positive
     * sentinel is `SAVE_VARIABLE VARIABLE=was_interrupted`. Pure
     * presence flag; absent means the slicer did NOT emit a PLR hook
     * in the start gcode and a power-blip mid-print will NOT be
     * resumable.
     */
    hasPowerLossRecovery?: boolean
    /**
     * Adaptive-probing sentinel presence. K2 Plus's WorkTrack3D
     * OrcaSlicer profile emits the K2-style "; MINX = ... ; MAXX = ..."
     * print-area annotation that triggers adaptive probing inside the
     * START_PRINT Klipper macro; users who roll their own start gcode
     * may instead call `BED_MESH_CALIBRATE` or `BED_MESH_PROFILE LOAD`
     * directly. Either pattern satisfies this flag.
     */
    hasAdaptiveProbing?: boolean
  }
  /**
   * Human-readable summary suitable for a renderer badge tooltip. Empty
   * string when `ok` is true.
   */
  summary: string
}

/**
 * Pure regex against the bounded header text. Reads-only; never throws.
 *
 * Recognised slicer dialects (all share the K2 Plus / Klipper-on-Moonraker
 * happy path):
 *   - OrcaSlicer / PrusaSlicer / SuperSlicer: `; estimated printing time
 *     (normal mode) = ...`, `; filament used [mm] = ...`,
 *     `; total layer number: <N>`, `; thumbnail begin <W>x<H> <bytes>`
 *   - Cura: `;TIME:<seconds>`, `;Filament used: <m>m`, `;LAYER_COUNT:<N>`
 *   - Creality Print: `;TIME:<seconds>`, `;Filament used: <m>m`,
 *     `;LAYER_COUNT:<N>`
 *   - Klipper-flavoured Slic3r: `;PRINT_TIME:<s>`, `;Filament length:<m>`
 *
 * Multi-thumbnail blocks (Orca emits 300x300 + 96x96 for the K2 profile)
 * count as one positive hit -- the renderer only needs to know whether
 * Mainsail/Fluidd will have ANY thumbnail to render.
 */
export function checkGcodeHeaderHealth(headerText: string): GcodeHeaderHealth {
  const fields: GcodeHeaderHealth['fields'] = {}

  // ── Time ────────────────────────────────────────────────────────────────
  // Cura / Creality Print: `;TIME:<seconds>` (integer seconds).
  const curaTime = headerText.match(/^;\s*TIME:\s*(\d+)\s*$/m)
  if (curaTime) {
    fields.timeSeconds = Number.parseInt(curaTime[1], 10)
  } else {
    // OrcaSlicer / PrusaSlicer: `; estimated printing time (normal mode) = 1h 23m 45s`
    const orcaTime = headerText.match(
      /^;\s*estimated printing time[^=]*=\s*(?:(\d+)\s*d\s*)?(?:(\d+)\s*h\s*)?(?:(\d+)\s*m\s*)?(?:(\d+)\s*s)?/im,
    )
    if (orcaTime) {
      const days = orcaTime[1] ? Number.parseInt(orcaTime[1], 10) : 0
      const hours = orcaTime[2] ? Number.parseInt(orcaTime[2], 10) : 0
      const minutes = orcaTime[3] ? Number.parseInt(orcaTime[3], 10) : 0
      const seconds = orcaTime[4] ? Number.parseInt(orcaTime[4], 10) : 0
      const total = days * 86400 + hours * 3600 + minutes * 60 + seconds
      if (total > 0) fields.timeSeconds = total
    } else {
      // Slic3r legacy: `;PRINT_TIME:<seconds>`
      const slic3rTime = headerText.match(/^;\s*PRINT_TIME:\s*(\d+)/m)
      if (slic3rTime) fields.timeSeconds = Number.parseInt(slic3rTime[1], 10)
    }
  }

  // ── Filament ────────────────────────────────────────────────────────────
  // OrcaSlicer / PrusaSlicer: `; filament used [mm] = 1234.56`
  const filamentMm = headerText.match(/^;\s*filament used\s*\[mm\]\s*=\s*([\d.]+)/im)
  if (filamentMm) {
    fields.filament = { ...(fields.filament ?? {}), mm: Number.parseFloat(filamentMm[1]) }
  }
  // OrcaSlicer / PrusaSlicer: `; filament used [g] = 12.34`
  const filamentG = headerText.match(/^;\s*filament used\s*\[g\]\s*=\s*([\d.]+)/im)
  if (filamentG) {
    fields.filament = { ...(fields.filament ?? {}), grams: Number.parseFloat(filamentG[1]) }
  }
  // Cura: `;Filament used: <m>m`
  if (!fields.filament) {
    const cura = headerText.match(/^;\s*Filament used:\s*([\d.]+)\s*m/m)
    if (cura) fields.filament = { mm: Number.parseFloat(cura[1]) * 1000 }
  }
  // Slic3r legacy: `;Filament length:<m>`
  if (!fields.filament) {
    const slic3r = headerText.match(/^;\s*Filament length:\s*([\d.]+)/m)
    if (slic3r) fields.filament = { mm: Number.parseFloat(slic3r[1]) }
  }

  // ── Layer count ─────────────────────────────────────────────────────────
  // Cura / Creality Print: `;LAYER_COUNT:<N>`
  const curaLayers = headerText.match(/^;\s*LAYER_COUNT:\s*(\d+)/m)
  if (curaLayers) {
    fields.layerCount = Number.parseInt(curaLayers[1], 10)
  } else {
    // OrcaSlicer / PrusaSlicer: `; total layer number: <N>`
    const orcaLayers = headerText.match(/^;\s*total layer number:\s*(\d+)/im)
    if (orcaLayers) fields.layerCount = Number.parseInt(orcaLayers[1], 10)
  }

  // ── Thumbnail block ─────────────────────────────────────────────────────
  // `; thumbnail begin <W>x<H> <byteCount>` ... `; thumbnail end`.
  // Width / height are pixels; byte count is the size of the base64 payload.
  const thumb = headerText.match(
    /^;\s*thumbnail\s+begin\s+(\d+)\s*x\s*(\d+)\s+(\d+)/im,
  )
  if (thumb) {
    const widthPx = Number.parseInt(thumb[1], 10)
    const heightPx = Number.parseInt(thumb[2], 10)
    const bytes = Number.parseInt(thumb[3], 10)
    if (Number.isFinite(widthPx) && Number.isFinite(heightPx) && Number.isFinite(bytes)) {
      fields.thumbnail = { widthPx, heightPx, bytes }
    }
  }

  // ── Power-loss recovery + adaptive probing ──────────────────────────────
  // Advisory ONLY -- these flags surface as `fields.has*` so the renderer
  // can warn (e.g. "your slicer profile is missing PLR; a power blip will
  // not be resumable") without blocking the upload. They DO NOT count
  // against `missingFields` / `ok` because they may legitimately be absent
  // (a stock K2 Plus profile without CFS, or a 3rd-party slicer that does
  // not emit Klipper macros). The `hasPowerLossRecoveryHeader` /
  // `hasAdaptiveProbingHeader` predicates below are exported separately so
  // callers that only care about one of the two checks can skip the full
  // health summary.
  if (hasPowerLossRecoveryHeader(headerText)) {
    fields.hasPowerLossRecovery = true
  }
  if (hasAdaptiveProbingHeader(headerText)) {
    fields.hasAdaptiveProbing = true
  }

  // ── Aggregate ───────────────────────────────────────────────────────────
  // `missingFields` / `ok` only consider the original four advisory fields
  // (time / filament / layerCount / thumbnail). PLR + adaptive probing are
  // intentionally NOT part of this aggregate -- they are informational
  // flags surfaced via `fields.hasPowerLossRecovery` / `.hasAdaptiveProbing`
  // and do NOT block uploads or change the existing `ok` semantics.
  const missing: GcodeHeaderField[] = []
  if (fields.timeSeconds == null) missing.push('time')
  if (fields.filament == null) missing.push('filament')
  if (fields.layerCount == null) missing.push('layerCount')
  if (fields.thumbnail == null) missing.push('thumbnail')

  const ok = missing.length === 0
  const summary = ok
    ? ''
    : `Missing slicer header field(s): ${missing.join(', ')}. ` +
      'Upload will still work but Mainsail/Fluidd will show less info in the file picker.'

  return { ok, missingFields: missing, fields, summary }
}

/**
 * Convenience predicate -- true when the bounded header text contains at
 * least one `; thumbnail begin` block (any size). The thumbnail block is
 * the most user-visible of the four advisory fields, so callers that only
 * care about the K2 Plus file-picker preview (e.g. `moonrakerPush`) can
 * skip the full health summary and surface a focused warning.
 */
export function hasThumbnailBlock(headerText: string): boolean {
  return /^;\s*thumbnail\s+begin\s+\d+\s*x\s*\d+\s+\d+/im.test(headerText)
}

/**
 * Convenience predicate -- true when the bounded header text contains a
 * power-loss recovery sentinel that the K2 Plus firmware recognizes.
 *
 * K2 Plus runs Creality OS (Klipper-based) where PLR is handled via
 * Klipper macros that write to `save_variables.cfg` -- the canonical
 * positive sentinel (per the Klipper Discourse PLR thread + The--Captain/
 * plr-klipper) is:
 *
 *   SAVE_VARIABLE VARIABLE=was_interrupted VALUE=True
 *
 * This is typically emitted in the START_PRINT macro on the printer or
 * inlined at the top of the slicer's start gcode. Marlin firmware (NOT
 * what the K2 uses, but accepted for completeness) uses the M413 G-code
 * instead -- recognized as a fallback so a user importing a Marlin
 * preset is not falsely flagged.
 *
 * Recognised patterns (case-insensitive, anchored to start-of-line so a
 * comment-prefixed `; SAVE_VARIABLE ...` annotation is the canonical
 * slicer-emitted shape and a bare line-start invocation also matches):
 *
 *   - `SAVE_VARIABLE VARIABLE=was_interrupted ...` (Klipper, plr-klipper)
 *   - `;SAVE_VARIABLE VARIABLE=was_interrupted ...` (slicer comment form)
 *   - `PRINT_STATS_SAVE ...` (alternative Klipper macro convention)
 *   - `M413 S1` (Marlin -- accepted only for completeness)
 *
 * Reads-only; never throws. Used by `checkGcodeHeaderHealth` to populate
 * `fields.hasPowerLossRecovery` AND exposed separately so a caller that
 * only cares about PLR can skip the full health summary.
 */
export function hasPowerLossRecoveryHeader(headerText: string): boolean {
  // Klipper canonical sentinel: SAVE_VARIABLE VARIABLE=was_interrupted ...
  // Allow optional leading `;` comment and arbitrary whitespace; the
  // VARIABLE= ... was_interrupted token is what makes the line a PLR
  // hook (vs a generic SAVE_VARIABLE used for arbitrary persisted state).
  if (
    /^\s*;?\s*SAVE_VARIABLE\s+VARIABLE\s*=\s*was_interrupted\b/im.test(headerText)
  ) {
    return true
  }
  // Alternative Klipper macro name used by some K2 community profiles.
  if (/^\s*;?\s*PRINT_STATS_SAVE\b/im.test(headerText)) {
    return true
  }
  // Marlin firmware fallback. `M413 S0` disables PLR -- only `S1` (or no
  // S param, which defaults to "report state") counts as a positive
  // signal. Use a conservative match: `M413` followed by either end of
  // line or whitespace + `S1`.
  if (/^\s*M413(?:\s+S1\b|\s*$|\s*;)/im.test(headerText)) {
    return true
  }
  return false
}

/**
 * Convenience predicate -- true when the bounded header text contains an
 * adaptive-probing sentinel that the K2 Plus firmware recognizes.
 *
 * The K2 Plus WorkTrack3D OrcaSlicer profile at
 * `resources/orca-slicer/profiles/machines/creality-k2-plus.ini` emits
 * this K2-specific annotation as the FIRST line of `machine_start_gcode`:
 *
 *   ;SET PRINT AREA MIN AND MAX COORDINATES TO ENABLE ADAPTIVE PROBING
 *   ; MINX = ...
 *   ; MINY = ...
 *   ; MAXX = ...
 *   ; MAXY = ...
 *
 * The K2's START_PRINT Klipper macro then reads MINX/MAXX/MINY/MAXY and
 * triggers a localised bed mesh on only the print area. Users who roll
 * their own start gcode may instead call `BED_MESH_CALIBRATE` (live
 * probe) or `BED_MESH_PROFILE LOAD=...` (load a stored mesh) directly
 * -- either pattern satisfies this predicate.
 *
 * Recognised patterns (case-insensitive):
 *
 *   - `; MINX = ...` / `; MAXX = ...` annotation block (K2 Plus
 *     WorkTrack3D OrcaSlicer profile convention)
 *   - `BED_MESH_CALIBRATE` (live Klipper probe -- the substantive call)
 *   - `BED_MESH_PROFILE LOAD=...` (load a saved mesh; counts because
 *     the slicer is actively asking the firmware to apply mesh-leveling
 *     compensation for the upcoming print)
 *
 * Reads-only; never throws. Used by `checkGcodeHeaderHealth` to populate
 * `fields.hasAdaptiveProbing` AND exposed separately so a caller that
 * only cares about the probing surface can skip the full health summary.
 */
export function hasAdaptiveProbingHeader(headerText: string): boolean {
  // K2 Plus profile convention: `; MINX = <number>` + `; MAXX = <number>`
  // (the slicer-emitted annotation that triggers the macro). Allow
  // optional whitespace and any numeric value. We require BOTH MINX and
  // MAXX to avoid false positives from a bare "MINX" mention in a code
  // comment.
  const hasMinx = /^;\s*MINX\s*=\s*-?\d/im.test(headerText)
  const hasMaxx = /^;\s*MAXX\s*=\s*-?\d/im.test(headerText)
  if (hasMinx && hasMaxx) return true
  // Direct Klipper macro invocations (case-insensitive). Optional `;`
  // prefix supports both bare invocations and slicer-comment annotations.
  if (/^\s*;?\s*BED_MESH_CALIBRATE\b/im.test(headerText)) return true
  if (/^\s*;?\s*BED_MESH_PROFILE\s+LOAD\b/im.test(headerText)) return true
  return false
}
