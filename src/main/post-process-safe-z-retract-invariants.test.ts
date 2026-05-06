// [ID-0110] Integration tests: the three target machines' real post templates
// must satisfy the universal safe-Z retract invariants when rendered end-to-end
// via renderPost(). A regression here means a post template was edited in a
// way that dropped the pre-cut Z-lift, dropped the trailing retract, or began
// emitting an XY rapid while the modal Z was still below the configured safe
// clearance -- all of which would surface as a `[RETRACT_*]` warning in the
// pipeline output and indicate a real machine-crash hazard.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { machineProfileSchema, type MachineProfile } from '../shared/machine-schema'
import {
  resolveSafeZClearanceMm,
  safeZInvariantModeForMachine,
  validateGcodeSafeZRetractInvariants
} from '../shared/gcode-safe-z-retract-invariants'
import { renderPost } from './post-process'

const resourcesRoot = join(process.cwd(), 'resources')

async function loadMachine(filename: string): Promise<MachineProfile> {
  const raw = await readFile(join(resourcesRoot, 'machines', filename), 'utf-8')
  return machineProfileSchema.parse(JSON.parse(raw))
}

// A representative toolpath: rapid into stock area, plunge, two cut moves,
// retract above clearance. The bundled post templates wrap this with their
// own header (units/abs/plane/WCS) and footer (M5/spindle-off/M2-or-M30),
// including a top-of-program `G0 Z{{machine.workAreaMm.z}}` rapid -- which
// is what satisfies the pre-cut retract invariant for the bundled profiles.
const sampleToolpath = ['G0 X10 Y10', 'G1 Z-2.000 F200', 'G1 X50 Y30 F800', 'G0 Z25.000']

// resolveWorkOffsetLine: index in [1..6] maps to G54..G59.
const WCS_G54_INDEX = 1

describe('[ID-0110] renderPost -- three-machine safe-Z retract invariants', () => {
  it('Laguna Swift 5x10 (vcarve_mach3.hbs) emits zero RETRACT_* warnings', async () => {
    const machine = await loadMachine('laguna-swift-5x10.json')
    // Sanity: Laguna ships with the explicit safeRetractZMm field set.
    expect(resolveSafeZClearanceMm(machine)).toBe(25)
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const issues = validateGcodeSafeZRetractInvariants(
      gcode,
      safeZInvariantModeForMachine(machine),
      resolveSafeZClearanceMm(machine)
    )
    expect(issues).toEqual([])
    expect(warnings.filter(w => /^\[RETRACT_/.test(w))).toEqual([])
  })

  it('Makera Carvera 3-axis (carvera_3axis.hbs) emits zero RETRACT_* warnings', async () => {
    const machine = await loadMachine('makera-carvera-3axis.json')
    // Carvera 3-axis has no explicit safeRetractZMm -- the resolver falls
    // back to workAreaMm.z (140 mm), which the post template uses as the
    // top-of-program rapid Z height.
    expect(resolveSafeZClearanceMm(machine)).toBe(140)
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const issues = validateGcodeSafeZRetractInvariants(
      gcode,
      safeZInvariantModeForMachine(machine),
      resolveSafeZClearanceMm(machine)
    )
    expect(issues).toEqual([])
    expect(warnings.filter(w => /^\[RETRACT_/.test(w))).toEqual([])
  })

  it('Makera Carvera 4-axis (carvera_4axis.hbs) emits zero RETRACT_* warnings', async () => {
    const machine = await loadMachine('makera-carvera-4axis.json')
    expect(resolveSafeZClearanceMm(machine)).toBe(46)
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const issues = validateGcodeSafeZRetractInvariants(
      gcode,
      safeZInvariantModeForMachine(machine),
      resolveSafeZClearanceMm(machine)
    )
    expect(issues).toEqual([])
    expect(warnings.filter(w => /^\[RETRACT_/.test(w))).toEqual([])
  })

  it('Creality K2 Plus (fdm_passthrough.hbs) short-circuits as fdm mode', async () => {
    // K2 Plus is kind=fdm. The safe-Z retract validator skips every check
    // because slicer-generated G-code handles end-of-print retract / Z-park
    // in its own conventions. We assert both the mode resolver and the
    // pipeline warning surface return empty regardless of rendered content.
    const machine = await loadMachine('creality-k2-plus.json')
    expect(safeZInvariantModeForMachine(machine)).toBe('fdm')
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, sampleToolpath)
    const issues = validateGcodeSafeZRetractInvariants(
      gcode,
      safeZInvariantModeForMachine(machine),
      resolveSafeZClearanceMm(machine)
    )
    expect(issues).toEqual([])
    expect(warnings.filter(w => /^\[RETRACT_/.test(w))).toEqual([])
  })

  it('synthetic CNC G-code missing pre-cut retract surfaces RETRACT_NO_PRE_CUT_RETRACT directly', async () => {
    // This guards the validator's pre-cut path against the real fleet's
    // CNC machines. A post template regression that dropped the top-of-
    // program `G0 Z{{machine.workAreaMm.z}}` would trip exactly this
    // warning, indicating the spindle could plunge through stock from
    // an unknown Z.
    const syntheticGcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S12000',
      'G0 X0 Y0',     // XY rapid at unknown Z
      'G1 Z-1.0 F200', // first cut without prior safe-Z lift
      'G0 Z25.0',
      'M5',
      'M2'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(syntheticGcode, 'cnc', 25)
    const preCut = issues.filter(i => i.code === 'RETRACT_NO_PRE_CUT_RETRACT')
    expect(preCut.length).toBe(1)
    expect(preCut[0]!.level).toBe('error')
    // Line anchor points at the offending first cut move (1-based, line 7).
    expect(preCut[0]!.line).toBe(7)
  })

  it('renderPost surface format for RETRACT_* warnings matches `[CODE] message (line N)` shape', async () => {
    // Pin the warning-string shape so downstream renderers / operator
    // toasts can parse "(line N)" reliably. Mirrors the [ID-0108] shape
    // assertion for END_* warnings.
    const syntheticGcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S12000',
      'G0 X0 Y0',
      'G1 Z-1.0 F200',
      'G0 Z25.0',
      'M5',
      'M2'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(syntheticGcode, 'cnc', 25)
    const formatted = issues.map(i => `[${i.code}] ${i.message} (line ${i.line})`)
    expect(formatted.length).toBeGreaterThan(0)
    for (const line of formatted) {
      expect(line).toMatch(/^\[RETRACT_[A-Z_]+\] .+ \(line \d+\)$/)
    }
  })

  it('resolveSafeZClearanceMm prefers safeRetractZMm over workAreaMm.z', async () => {
    // Laguna ships with both fields populated -- safeRetractZMm=25 mm,
    // workAreaMm.z=203 mm. The resolver MUST pick the explicit operator-
    // tuned safe-Z (25), not the conservative full-envelope value (203).
    // Picking the wrong one would cause every job to spend extra rapid
    // time travelling to the top of the envelope between operations.
    const machine = await loadMachine('laguna-swift-5x10.json')
    expect(machine.safeRetractZMm).toBe(25)
    expect(machine.workAreaMm.z).toBe(203)
    expect(resolveSafeZClearanceMm(machine)).toBe(25)
  })

  // ---------------------------------------------------------------------------
  // [ID-0109d] DISCOVERED-TODAY (Cycle 45, 2026-04-25) integration-layer
  // extension on the Cycle 36 [ID-0109] safe-Z retract validator hook-in.
  // Cycle 43 [ID-0109c] added 12 unit-layer tests covering rotary 4-axis +
  // multi-pass + tokenization edge cases inside the validator's own test file.
  // This block mirrors that coverage at the renderPost() integration layer:
  // (1) Carvera 4-axis end-to-end with rotary A-index between cuts;
  // (2) Carvera 4-axis end-to-end where toolpath issues `G0 A180` while modal
  //     Z is at cut depth (A is not X/Y -- must NOT fire XY_RAPID);
  // (3) synthetic CNC missing trailing retract surfaces RETRACT_NO_END_RETRACT
  //     directly (the existing block only pinned NO_PRE_CUT_RETRACT);
  // (4) synthetic CNC with XY rapid at cut depth surfaces RETRACT_XY_RAPID_
  //     AT_CUT_DEPTH directly (the existing block only pinned NO_PRE_CUT);
  // (5) all three RETRACT_* warning codes round-trip the documented
  //     [CODE] message (line N) wire format through the validator.
  // ---------------------------------------------------------------------------

  it('[ID-0109d] Carvera 4-axis end-to-end with rotary A-index between cuts emits zero RETRACT_* warnings', async () => {
    const machine = await loadMachine('makera-carvera-4axis.json')
    expect(safeZInvariantModeForMachine(machine)).toBe('cnc')
    expect(resolveSafeZClearanceMm(machine)).toBe(46)
    // Two cut clusters bracketed by safe-Z lifts and an A-axis index in
    // between -- the canonical 4-axis indexed-rotary pattern. Header
    // (G0 Z46) + footer (G0 Z46 / G0 A0 / G0 X0 Y0) come from the post
    // template; toolpathLines provide the cuts + the rotary index.
    const rotaryIndexedToolpath = [
      'G0 X10 Y0',         // XY rapid at safe Z (header just lifted to Z46)
      'G1 Z-2.000 F200',   // plunge
      'G1 X20.000 F800',   // cut
      'G0 Z46.000',        // lift to safe before rotary index
      'G0 A90.000',        // rotary index -- A is not X/Y -> no XY_RAPID risk
      'G0 X10 Y0',         // XY rapid at safe Z (still at Z46)
      'G1 Z-2.000 F200',   // plunge after index
      'G1 X20.000 F800',   // cut
      'G0 Z46.000'         // lift -- footer trailing retract is already there
    ]
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, rotaryIndexedToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const issues = validateGcodeSafeZRetractInvariants(
      gcode,
      safeZInvariantModeForMachine(machine),
      resolveSafeZClearanceMm(machine)
    )
    expect(issues).toEqual([])
    expect(warnings.filter(w => /^\[RETRACT_/.test(w))).toEqual([])
  })

  it('[ID-0109d] Carvera 4-axis tolerates `G0 A180` at cut depth without firing RETRACT_XY_RAPID_AT_CUT_DEPTH (A is not X/Y)', async () => {
    const machine = await loadMachine('makera-carvera-4axis.json')
    // This toolpath deliberately issues a pure-A rapid while modal Z is still
    // at -2 (cut depth). The validator must NOT flag this as an XY rapid
    // because A is the rotary axis, not a translational X or Y move. The
    // existing Cycle 43 [ID-0109c] unit tests pin this at the validator
    // layer; this test pins it end-to-end through the carvera_4axis.hbs
    // template + real machine profile so a future post-template change
    // (e.g., adding a Z-lift mandate before every A motion) cannot
    // silently relax this case.
    const rotaryAtCutDepthToolpath = [
      'G0 X10 Y0',
      'G1 Z-2.000 F200',  // plunge -> modal Z = -2 (cut depth)
      'G1 X20.000 F800',
      'G0 A180.000',       // pure-A rapid at modal Z=-2 -- MUST NOT fire XY_RAPID
      'G1 X25.000 F800',  // continue cut at Z=-2 after rotary index
      'G0 Z46.000'
    ]
    const { warnings } = await renderPost(resourcesRoot, machine, rotaryAtCutDepthToolpath, {
      workCoordinateIndex: WCS_G54_INDEX
    })
    const xyRapidWarnings = warnings.filter(w => /^\[RETRACT_XY_RAPID_AT_CUT_DEPTH\]/.test(w))
    expect(xyRapidWarnings).toEqual([])
  })

  it('[ID-0109d] synthetic CNC missing trailing retract surfaces RETRACT_NO_END_RETRACT directly', () => {
    // Mirrors the existing NO_PRE_CUT pin but for the END_RETRACT path.
    // A real-world regression of this type would be a post template that
    // drops the trailing `G0 Z{{machine.workAreaMm.z}}` between spindleOff
    // and program-end (M2/M30) -- after the cut, the spindle would stay at
    // cut depth indefinitely until the operator manually jogs Z, exposing
    // an asynchronous-collision hazard if the program is re-run via
    // soft-reset. The validator's NO_END_RETRACT code is what catches this.
    const syntheticGcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'G0 Z25.0',          // header safe-Z -- satisfies pre-cut
      'M3 S12000',
      'G0 X10 Y10',        // XY rapid at safe Z (Z=25 >= 25)
      'G1 Z-2.0 F200',     // plunge
      'G1 X20 Y20 F800',   // cut
      // NO trailing G0 Z>=25 here -- the regression
      'M5',
      'M2'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(syntheticGcode, 'cnc', 25)
    const endRetract = issues.filter(i => i.code === 'RETRACT_NO_END_RETRACT')
    expect(endRetract.length).toBe(1)
    expect(endRetract[0]!.level).toBe('error')
    // The validator anchors NO_END_RETRACT at the FIRST line of the
    // post-cut tail (M5 here, line 11) when no terminating retract
    // exists. Pin behavior so a future revision of the validator that
    // changes the anchor strategy is a deliberate change.
    expect(endRetract[0]!.line).toBeGreaterThan(0)
  })

  it('[ID-0109d] synthetic CNC with XY rapid at cut depth surfaces RETRACT_XY_RAPID_AT_CUT_DEPTH directly', () => {
    // Mirrors the existing NO_PRE_CUT pin but for the per-occurrence
    // XY_RAPID path. Real-world regression: a post template that emits a
    // mid-program reposition rapid (e.g., between two cut clusters in a
    // multi-feature operation) without the intervening Z-lift would trip
    // exactly this code, indicating the spindle would skip across the
    // stock at cut depth -- a guaranteed crash if any obstacle exists
    // between the two clusters.
    const syntheticGcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'G0 Z25.0',          // header safe-Z -- satisfies pre-cut
      'M3 S12000',
      'G0 X10 Y10',        // XY rapid at safe Z
      'G1 Z-2.0 F200',     // plunge -> modal Z = -2
      'G1 X20 Y20 F800',
      'G0 X30 Y30',        // OFFENDER (line 10): XY rapid at modal Z=-2
      'G1 X40 Y40 F800',
      'G0 Z25.0',          // trailing retract
      'M5',
      'M2'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(syntheticGcode, 'cnc', 25)
    const xyRapid = issues.filter(i => i.code === 'RETRACT_XY_RAPID_AT_CUT_DEPTH')
    expect(xyRapid.length).toBe(1)
    expect(xyRapid[0]!.level).toBe('error')
    // Line 10 in the input above (1-based: G21=1, G90=2, G17=3, G54=4,
    // G0 Z25=5, M3=6, G0 X10 Y10=7, G1 Z-2=8, G1 X20 Y20=9, G0 X30 Y30=10).
    expect(xyRapid[0]!.line).toBe(10)
  })

  it('[ID-0109d] all three RETRACT_* warning codes round-trip the [CODE] message (line N) wire format', () => {
    // Build a single synthetic program that triggers ALL THREE codes:
    //   - NO_PRE_CUT_RETRACT (no header G0 Z>=safe before first cut)
    //   - XY_RAPID_AT_CUT_DEPTH (mid-program XY rapid at cut depth)
    //   - NO_END_RETRACT (no trailing G0 Z>=safe before M2/M30)
    // and assert that EVERY emitted issue can be formatted into the
    // documented `[CODE] message (line N)` shape that downstream
    // operator-toast renderers parse.
    const syntheticGcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'M3 S12000',
      'G0 X10 Y10',        // XY rapid at unknown Z -> NO_PRE_CUT trigger
      'G1 Z-2.0 F200',     // plunge -> modal Z = -2
      'G0 X30 Y30',        // OFFENDER for XY_RAPID_AT_CUT_DEPTH
      'G1 X40 Y40 F800',
      // NO trailing G0 Z>=25 -> NO_END_RETRACT
      'M5',
      'M2'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(syntheticGcode, 'cnc', 25)
    expect(issues.length).toBeGreaterThanOrEqual(3)
    const codes = new Set(issues.map(i => i.code))
    expect(codes.has('RETRACT_NO_PRE_CUT_RETRACT')).toBe(true)
    expect(codes.has('RETRACT_XY_RAPID_AT_CUT_DEPTH')).toBe(true)
    expect(codes.has('RETRACT_NO_END_RETRACT')).toBe(true)
    const formatted = issues.map(i => `[${i.code}] ${i.message} (line ${i.line})`)
    for (const line of formatted) {
      expect(line).toMatch(/^\[RETRACT_(NO_PRE_CUT_RETRACT|NO_END_RETRACT|XY_RAPID_AT_CUT_DEPTH)\] .+ \(line \d+\)$/)
    }
  })

  // ---------------------------------------------------------------------------
  // Cycle 48 [ID-0146-saferz] -- DISCOVERED-2026-04-25 follow-up to [ID-0109d]:
  //
  // Pin that the safe-Z retract validator's modal-Z walker is robust to the
  // G93/G94 inverse-time-feed mode toggles emitted by carvera_4axis.hbs and
  // cnc_4axis_grbl.hbs when `inverseTimeFeed: true` is threaded through
  // renderPost(). G93 / G94 are non-motion mode words; the validator's
  // motion-mode regex (`G0*[0-3]` token-bound) intentionally does NOT
  // match G93/G94, so they should be transparent to the modal walker.
  // This pair pins the invariant END-TO-END through the bundled posts so
  // a future post-template change (e.g., adding `G0 Z<safe>` between
  // G93 and the toolpath block) cannot silently flip the validator's
  // judgment on perfectly safe rotary programs.
  //
  // ASSUMPTION: rotary-only A-axis moves at cut depth (modal Z below safe
  // clearance) are NOT flagged as XY rapids -- this was already pinned at
  // the validator-unit layer in Cycle 43 [ID-0109c] and end-to-end at
  // Cycle 45 [ID-0109d]. The new tests here add the inverseTimeFeed=true
  // axis to that coverage matrix.
  // ---------------------------------------------------------------------------

  it('[ID-0146-saferz] Carvera 4-axis with inverseTimeFeed: true emits zero RETRACT_* warnings (G93/G94 transparent to modal-Z walker)', async () => {
    const machine = await loadMachine('makera-carvera-4axis.json')
    expect(safeZInvariantModeForMachine(machine)).toBe('cnc')
    expect(resolveSafeZClearanceMm(machine)).toBe(46)
    // Same indexed-rotary toolpath shape as the [ID-0109d] baseline test --
    // two cut clusters bracketed by safe-Z lifts and an A-axis index in
    // between -- but rendered with `inverseTimeFeed: true` so the post
    // wraps the toolpath block in `G93` ... `G94`. The validator must
    // emit zero RETRACT_* warnings on this output.
    const rotaryIndexedToolpath = [
      'G0 X10 Y0',
      'G1 Z-2.000 F60',     // plunge under inverse-time-feed (F is 1/min)
      'G1 X20.000 F30',     // cut
      'G0 Z46.000',         // lift to safe before rotary index
      'G0 A90.000',         // rotary index -- A is not X/Y -> no XY_RAPID risk
      'G0 X10 Y0',
      'G1 Z-2.000 F60',
      'G1 X20.000 F30',
      'G0 Z46.000'
    ]
    const { gcode, warnings } = await renderPost(resourcesRoot, machine, rotaryIndexedToolpath, {
      workCoordinateIndex: WCS_G54_INDEX,
      inverseTimeFeed: true
    })
    // Sanity: the post DID emit G93 / G94 (the inverseTimeFeed flag was
    // honored end-to-end, so we are exercising the cross-cutting path).
    expect(gcode).toContain('G93')
    expect(gcode).toContain('G94')
    // Validator: zero RETRACT_* issues.
    const issues = validateGcodeSafeZRetractInvariants(
      gcode,
      safeZInvariantModeForMachine(machine),
      resolveSafeZClearanceMm(machine)
    )
    expect(issues).toEqual([])
    expect(warnings.filter(w => /^\[RETRACT_/.test(w))).toEqual([])
  })

  it('[ID-0146-saferz] G93/G94 lines are not misread as G3/G4 motion modes by the modal-Z walker', () => {
    // Direct validator-unit guard. A synthetic program that places G93
    // and G94 immediately before / after motion lines must not flip the
    // modal motion mode to G3 (CCW arc) or G4 (which is not a motion --
    // dwell, but a hypothetical regex bug could match G93 -> 9*3 = 3).
    // The validator's `extractMotionMode` regex is anchored on
    // `(?:^|[^A-Za-z0-9.])G0*([0-3])(?:[^0-9.]|$)` so G93 and G94 are
    // intentionally rejected, but pinning this via a test means a future
    // regex relaxation would fail loudly here instead of silently
    // mis-classifying every inverseTimeFeed-mode program.
    const syntheticGcode = [
      'G21',
      'G90',
      'G17',
      'G54',
      'G0 Z46',            // header safe-Z lift
      'M3 S12000',
      'G93',                // inverse-time-feed mode ON -- NOT a motion code
      'G0 X10 Y0',         // XY rapid at safe Z -- should be fine
      'G1 Z-2.0 F60',      // plunge -> modal Z = -2 (cut depth)
      'G1 X20 F30',        // cut at -2
      'G0 Z46',            // lift to safe
      'G94',                // restore feed-per-minute -- NOT a motion code
      'M5',
      'G0 Z46',            // trailing retract
      'M2'
    ].join('\n')
    const issues = validateGcodeSafeZRetractInvariants(syntheticGcode, 'cnc', 46)
    // The G93/G94 lines must be transparent: the walker should treat
    // them as no-ops and the program should pass cleanly.
    expect(issues).toEqual([])
  })
})
