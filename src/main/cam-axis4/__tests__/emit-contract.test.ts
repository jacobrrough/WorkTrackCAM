/**
 * Emitter shared-emitter contract paired-pin set -- Cycle 76 [ID-0164]
 *
 * Following the doc-tied paired-pin shape established by:
 *   - Cycle 64 [ID-0007b-followup] K2 Moonraker upload contract
 *   - Cycle 65 [ID-0156] Carvera 4-axis post contract
 *   - Cycle 67 [ID-0155] Carvera 3-axis post contract
 *   - Cycle 70 [ID-0154] Laguna Swift 5x10 post contract
 *
 * Each invariant section asserts BOTH the documented intent (header
 * docstring text in src/main/cam-axis4/emit.ts) AND the runtime behavior
 * (against a real Emitter instance), so doc-vs-code drift fails one of
 * the pair.
 *
 * Scope: Emitter is the SHARED emitter that all five cam-axis4 strategies
 * (roughing / finishing / pattern / indexed / continuous; contour holds a
 * separate 11-test set) build on top of. Each strategy's own pin set
 * exercises a slice of Emitter behavior; this contract pin set fixes the
 * underlying invariants in one place so a future Emitter refactor that
 * weakens (e.g.) the chuck-face safety throw or the never-rotate-at-depth
 * guard fails HERE first instead of cascading silent regressions through
 * five strategy files.
 *
 * Machine scope per CLAUDE.md "My-Shop-Only Mode": the emitter is the
 * 4-axis-rotary code path consumed exclusively by the Makera Carvera +
 * 4th Axis Rotary target machine. K2 Plus (FDM) and Laguna Swift 5x10
 * (3-axis CNC router) do not exercise this module.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Emitter } from '../emit'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Reads emit.ts source text once for the doc-text paired pins. */
const EMIT_SOURCE = readFileSync(
  resolve(__dirname, '..', 'emit.ts'),
  'utf-8'
)

/**
 * Canonical Carvera-style emitter knobs used wherever the test does not
 * care about the exact numeric values. Mirrors the shape produced by the
 * five strategies in src/main/cam-axis4/strategies/.
 */
function makeEmitter(overrides: Partial<ConstructorParameters<typeof Emitter>[0]> = {}): Emitter {
  return new Emitter({
    stockRadius: 25,
    safeZMm: 10,
    feedMmMin: 800,
    plungeMmMin: 300,
    stockDiameterMm: 50,
    toolDiameterMm: 3.175,
    maxRotaryRpm: 0,
    ...overrides
  })
}

// ===========================================================================
// Section 1 -- Architecture / doc-text invariants
// ===========================================================================

describe('Emitter -- architecture doc invariants [ID-0164]', () => {
  it('header docstring pins the modal-state-tracking invariant', () => {
    // DOC PIN: the centralised emitter exists so every strategy can reason
    // about modal X/Y/Z/A/F deltas without re-implementing the bookkeeping.
    expect(EMIT_SOURCE).toContain(
      'Modal state tracking (X/Y/Z/A/F) so we can reason about deltas'
    )
  })

  it('header docstring pins the never-rotate-A-at-depth invariant', () => {
    // DOC PIN: rotateA() must require a retract above the safety floor.
    expect(EMIT_SOURCE).toContain('Never rotate A at cutting depth')
    expect(EMIT_SOURCE).toContain('`rotateA()` requires retract first')
  })

  it('header docstring pins the chuck-face X>=0 safety invariant', () => {
    // DOC PIN: the emitter is the gate that prevents G-code from driving
    // the tool through the rotary chuck face. No strategy is allowed to
    // bypass it.
    expect(EMIT_SOURCE).toContain('Chuck-face safety: never emit X < 0')
  })

  it('header docstring pins the plunge-vs-cut feed selection threshold', () => {
    // DOC PIN: deeper Z move > 0.5 mm uses plunge feed, otherwise the
    // lateral cutting feed. The 0.5 mm threshold is hard-coded in cutTo()
    // and the doc must spell it out so a future tuner is forced to keep
    // them in sync.
    expect(EMIT_SOURCE).toContain(
      'Plunge feed vs cutting feed selection (deeper Z move at > 0.5 mm uses'
    )
    expect(EMIT_SOURCE).toContain('plunge feed, otherwise the lateral cut feed)')
  })
})

// ===========================================================================
// Section 2 -- Constructor + clearZ derivation
// ===========================================================================

describe('Emitter -- constructor + clearZ derivation [ID-0164]', () => {
  it('clearZ defaults to stockRadius + safeZMm with no maxZMm cap', () => {
    // DOC PIN: clearZ formula in the constructor body is sourced from
    // EmitterOpts.stockRadius + EmitterOpts.safeZMm.
    expect(EMIT_SOURCE).toContain('opts.stockRadius + opts.safeZMm')

    // RUNTIME PIN: 25 + 10 = 35 (no cap supplied).
    const e = makeEmitter({ stockRadius: 25, safeZMm: 10 })
    expect(e.clearZ).toBeCloseTo(35, 9)
    expect(e.safeZMm).toBe(10)
    expect(e.stockRadius).toBe(25)
  })

  it('clearZ is capped at maxZMm - 1 when maxZMm is the binding constraint', () => {
    // DOC PIN: the source comment + body reference an explicit Math.min
    // against maxZMm - 1 (-1 mm of slop below the work-area Z so a rapid
    // never crashes the Z hard stop).
    expect(EMIT_SOURCE).toContain(
      'opts.maxZMm != null ? Math.min(rawClear, opts.maxZMm - 1) : rawClear'
    )

    // RUNTIME PIN: 25 + 100 would be 125 but maxZMm=46 (Carvera Z work
    // area) caps it to 45.
    const e = makeEmitter({ stockRadius: 25, safeZMm: 100, maxZMm: 46 })
    expect(e.clearZ).toBe(45)
  })

  it('clearZ uses raw stockRadius+safeZMm when maxZMm is non-binding', () => {
    // RUNTIME PIN: with rawClear=35 and maxZMm=46, 46-1=45 is NOT binding,
    // so clearZ stays at 35.
    const e = makeEmitter({ stockRadius: 25, safeZMm: 10, maxZMm: 46 })
    expect(e.clearZ).toBeCloseTo(35, 9)
  })

  it('maxRotaryRpm defaults to 0 (feed adaptation disabled) when omitted', () => {
    // DOC PIN: kinematics.adaptFeedForAngularVelocity treats maxRotaryRpm<=0
    // as "disabled". The Emitter falls back to 0 when the caller omits the
    // field (vs accidentally NaN-ing or undefined-propagating).
    expect(EMIT_SOURCE).toContain('this.maxRotaryRpm = opts.maxRotaryRpm ?? 0')

    // RUNTIME PIN: explicit-undefined (omitted in the spread) -> 0.
    const e = makeEmitter({})
    expect(e.maxRotaryRpm).toBe(0)
  })
})

// ===========================================================================
// Section 3 -- comment() formatting
// ===========================================================================

describe('Emitter -- comment() formatting [ID-0164]', () => {
  it('empty-string comment is a no-op (does not push a blank line)', () => {
    // RUNTIME PIN: comment("") returns immediately, never pushes a line.
    const e = makeEmitter()
    e.comment('')
    expect(e.lines()).toEqual([])
  })

  it('plain text gets the "; " prefix', () => {
    // RUNTIME PIN: comment("hello") -> "; hello"
    const e = makeEmitter()
    e.comment('hello')
    expect(e.lines()).toEqual(['; hello'])
  })

  it('text already starting with ";" is preserved verbatim (no double-prefix)', () => {
    // RUNTIME PIN: comment("; raw") stays "; raw" -- so a strategy that
    // composes "; --- Z depth -2 mm ---" style banners can pre-format
    // without the emitter munging the output.
    const e = makeEmitter()
    e.comment('; --- Z depth -2 mm (radial cut R=10) ---')
    expect(e.lines()).toEqual(['; --- Z depth -2 mm (radial cut R=10) ---'])
  })
})

// ===========================================================================
// Section 4 -- rapidX / rapidZ / retractToClear modal + chuck-face safety
// ===========================================================================

describe('Emitter -- rapidX chuck-face safety + dedupe [ID-0164]', () => {
  it('rapidX(< 0) throws with the documented chuck-crash error message', () => {
    // DOC PIN: error text spells out "would crash chuck face" so a future
    // refactor that softens the throw to a warning fails this assertion
    // and forces a deliberate decision.
    expect(EMIT_SOURCE).toContain(
      'emit.rapidX: refusing negative X'
    )
    expect(EMIT_SOURCE).toContain('would crash chuck face')

    // RUNTIME PIN: any negative X throws.
    const e = makeEmitter()
    expect(() => e.rapidX(-0.001)).toThrowError(/refusing negative X/)
    expect(() => e.rapidX(-50)).toThrowError(/would crash chuck face/)
    // Failed throws must NOT leak G-code into the buffer.
    expect(e.lines()).toEqual([])
  })

  it('rapidX dedupes consecutive moves to the same X (after first emit)', () => {
    // RUNTIME PIN: from initial state, first rapidX(10) emits because
    // hasPos=false; second rapidX(10) is a no-op because |10-10|<1e-6 AND
    // hasPos is now true. Third rapidX(10.5) emits.
    const e = makeEmitter()
    e.rapidX(10)
    e.rapidX(10)
    e.rapidX(10.5)
    expect(e.lines()).toEqual(['G0 X10.000', 'G0 X10.500'])
    expect(e.getX()).toBeCloseTo(10.5, 9)
  })

  it('rapidZ dedupes against modal Z but emits on first call (hasPos=false)', () => {
    // RUNTIME PIN: cz starts at 0 but hasPos=false, so rapidZ(0) DOES emit
    // (the "same Z" guard requires hasPos to short-circuit). Subsequent
    // rapidZ(0) is a no-op.
    const e = makeEmitter()
    e.rapidZ(0)
    e.rapidZ(0)
    e.rapidZ(35)
    expect(e.lines()).toEqual(['G0 Z0.000', 'G0 Z35.000'])
  })

  it('retractToClear() emits "G0 Z<clearZ>" without Y0 by default', () => {
    // RUNTIME PIN: clearZ for stockRadius=25, safeZMm=10 is 35; retract
    // emits exactly one line and updates cz.
    const e = makeEmitter()
    e.retractToClear()
    expect(e.lines()).toEqual(['G0 Z35.000'])
    expect(e.getZ()).toBeCloseTo(35, 9)
  })

  it('retractToClear(true) appends Y0 for axis-recentering retracts', () => {
    // RUNTIME PIN: includeY0=true emits a single combined "G0 Z<clearZ> Y0"
    // line. This is the strategy entry-point retract (see e.g.
    // strategies/finishing.ts) where Y must be re-zeroed before any A
    // rotation in case a previous job left the Y axis off-rotation-axis.
    const e = makeEmitter()
    e.retractToClear(true)
    expect(e.lines()).toEqual(['G0 Z35.000 Y0'])
  })
})

// ===========================================================================
// Section 5 -- rotateA "never rotate at cutting depth"
// ===========================================================================

describe('Emitter -- rotateA never-rotate-at-depth safety [ID-0164]', () => {
  it('rotateA throws when current Z is below the safety floor by more than 1e-3', () => {
    // DOC PIN: error text spells out "never rotate at cutting depth" so a
    // future refactor that softens the throw fails this assertion.
    expect(EMIT_SOURCE).toContain(
      'emit.rotateA: refusing to rotate A while Z='
    )
    expect(EMIT_SOURCE).toContain('never rotate at cutting depth')

    // RUNTIME PIN: cutTo(10, -2) leaves cz=-2; rotateA(90, 35) requires
    // cz >= 35-1e-3, so it throws.
    const e = makeEmitter()
    e.retractToClear() // cz = 35, hasPos = true
    e.rapidX(10)
    e.cutTo(10, -2)
    expect(e.getZ()).toBeCloseTo(-2, 9)
    expect(() => e.rotateA(90, 35)).toThrowError(/never rotate at cutting depth/)
  })

  it('rotateA succeeds when current Z is exactly at the safety floor', () => {
    // RUNTIME PIN: the threshold is "cz < safetyFloor - 1e-3", so equality
    // (cz === safetyFloor) passes. This is the canonical
    // retract-then-rotate pattern strategies use after each pass.
    const e = makeEmitter()
    e.retractToClear() // cz = 35
    e.rotateA(90, 35)
    expect(e.lines()).toEqual(['G0 Z35.000', 'G0 A90.000'])
    expect(e.getA()).toBeCloseTo(90, 9)
  })

  it('rotateA with hasPos=false bypasses the safety check (initial state)', () => {
    // RUNTIME PIN: a brand-new Emitter has hasPos=false, so the first
    // rotateA call (typically the strategy header rotation) is allowed even
    // though cz starts at 0 < safetyFloor. This is intentional: there is
    // no tool yet at depth, so the safety predicate is meaningless.
    const e = makeEmitter()
    e.rotateA(45, 35)
    expect(e.lines()).toEqual(['G0 A45.000'])
  })

  it('rotateA dedupes consecutive rotations to the same target A', () => {
    // RUNTIME PIN: |targetDeg - this.ca| < 1e-6 AND hasPos=true -> no-op.
    const e = makeEmitter()
    e.retractToClear() // hasPos=true, cz=35
    e.rotateA(90, 35)
    e.rotateA(90, 35) // dedupe
    e.rotateA(90.0000001, 35) // still within 1e-6 -> dedupe
    e.rotateA(91, 35) // emits
    expect(e.lines()).toEqual(['G0 Z35.000', 'G0 A90.000', 'G0 A91.000'])
  })
})

// ===========================================================================
// Section 6 -- plungeZ + cutTo feed selection + chuck-face safety
// ===========================================================================

describe('Emitter -- plungeZ + cutTo feed selection + chuck-face safety [ID-0164]', () => {
  it('plungeZ refuses non-deepening Z (idempotent for Z >= cz)', () => {
    // RUNTIME PIN: plungeZ(z) where z >= cz - 1e-9 returns immediately.
    // After retractToClear cz=35; plungeZ(35) and plungeZ(40) are no-ops.
    // plungeZ(20) deepens (20 < 35) -> emits with plunge feed.
    const e = makeEmitter()
    e.retractToClear()
    e.plungeZ(35) // no-op (== cz)
    e.plungeZ(40) // no-op (> cz)
    e.plungeZ(20) // emits
    expect(e.lines()).toEqual(['G0 Z35.000', 'G1 Z20.000 F300'])
    expect(e.getZ()).toBeCloseTo(20, 9)
  })

  it('cutTo with deepening Z > 0.5 mm selects plunge feed', () => {
    // RUNTIME PIN: from cz=10, cutTo(20, 5) has dz=-5, |dz|=5 > 0.5 ->
    // plunge feed (300 mm/min) on the emitted line.
    const e = makeEmitter({ feedMmMin: 800, plungeMmMin: 300 })
    e.rapidX(20)
    e.rapidZ(10)
    e.cutTo(20, 5)
    // The cut line ends with F300 (plunge), not F800.
    const cutLine = e.lines().find((l) => l.startsWith('G1 X20.000'))
    expect(cutLine).toBeDefined()
    expect(cutLine).toMatch(/F300$/)
    expect(cutLine).not.toMatch(/F800/)
  })

  it('cutTo with lateral move (no Z change) selects cutting feed, not plunge', () => {
    // RUNTIME PIN: from (cx=10, cz=-2), cutTo(30, -2) has dz=0 -> cutting
    // feed (800 mm/min). Z is omitted because |dz| <= 0.005.
    const e = makeEmitter({ feedMmMin: 800, plungeMmMin: 300 })
    e.rapidX(10)
    e.rapidZ(-2)
    e.cutTo(30, -2)
    const cutLine = e.lines().find((l) => l.startsWith('G1 X30.000'))
    expect(cutLine).toBeDefined()
    // No "Z" word because |dz| <= 0.005.
    expect(cutLine).not.toMatch(/Z/)
    // Feed is the cutting feed.
    expect(cutLine).toMatch(/F800$/)
  })

  it('cutTo(< 0) throws with chuck-face safety message', () => {
    // DOC PIN: error string in cutTo() also spells out the chuck-face
    // safety reason so a future refactor cannot silently weaken it.
    expect(EMIT_SOURCE).toContain('emit.cutTo: refusing negative X')
    expect(EMIT_SOURCE).toContain('chuck-face safety')

    // RUNTIME PIN: cutTo(-0.001, -2) throws; no line leaks to the buffer.
    const e = makeEmitter()
    e.rapidX(5)
    e.rapidZ(-2)
    const beforeLineCount = e.lines().length
    expect(() => e.cutTo(-0.001, -2)).toThrowError(/refusing negative X/)
    expect(() => e.cutTo(-50, -2)).toThrowError(/chuck-face safety/)
    // No line appended by the failed throws.
    expect(e.lines().length).toBe(beforeLineCount)
  })
})

// ===========================================================================
// Section 7 -- cutTo absolute-A + feed adaptation + returnHome + immutability
// ===========================================================================

describe('Emitter -- cutTo absolute-A + feed adaptation + returnHome + immutability [ID-0164]', () => {
  it('cutTo emits ABSOLUTE A target (not delta) and updates modal A', () => {
    // DOC PIN: the absolute-vs-delta choice is a comment in cutTo() body
    // because controllers track absolute A; emitting deltas would cause
    // angular drift across rotations.
    expect(EMIT_SOURCE).toContain(
      'Emit absolute target angle, not delta'
    )

    // RUNTIME PIN: from ca=0, cutTo(10, -2, aDeg=45) emits "A45.000",
    // not "A45.000" as a delta of 45 -- they happen to coincide at the
    // first call so we follow up with cutTo(11, -2, aDeg=80), which from
    // ca=45 has delta=35 yet emits "A80.000".
    const e = makeEmitter({ feedMmMin: 800, plungeMmMin: 300 })
    e.rapidX(10)
    e.rapidZ(-2)
    e.cutTo(10, -2, 45)
    expect(e.getA()).toBeCloseTo(45, 9)
    e.cutTo(11, -2, 80)
    expect(e.getA()).toBeCloseTo(80, 9)
    const aWords = e.lines().flatMap((l) => {
      const m = l.match(/A([\-\d.]+)/)
      return m ? [m[1]] : []
    })
    // Two A words emitted, both ABSOLUTE, in source order.
    expect(aWords).toEqual(['45.000', '80.000'])
  })

  it('cutTo throttles feed via kinematics when angular velocity exceeds maxRotaryRpm and surfaces a warning', () => {
    // DOC PIN: pre-emission angular-velocity adaptation is the whole point
    // of the kinematics.ts collaborator.
    expect(EMIT_SOURCE).toContain(
      'Pre-emission angular velocity adaptation via `kinematics.ts`'
    )

    // RUNTIME PIN: maxRotaryRpm=1 with stockDiameterMm=50 caps angular
    // velocity at 1*360 = 360 deg/min. Combined move with delta-A=180 deg
    // over linearDist=1 mm requires angVel = 180 * F / 1; F=800 -> 144000
    // deg/min, far over cap -- so the emitted line carries the throttled
    // feed and a warning is recorded.
    const e = makeEmitter({
      feedMmMin: 800,
      plungeMmMin: 300,
      stockDiameterMm: 50,
      maxRotaryRpm: 1
    })
    e.rapidX(10)
    e.rapidZ(-2)
    e.cutTo(11, -2, 180)
    // The emitted feed must be much lower than the requested 800 mm/min.
    const cutLine = e.lines().find((l) => /A180\.000/.test(l))
    expect(cutLine).toBeDefined()
    const feedMatch = cutLine!.match(/F(\d+)/)
    expect(feedMatch).not.toBeNull()
    expect(Number(feedMatch![1])).toBeLessThan(800)
    // And exactly one throttle warning surfaced.
    const warnings = e.warnings()
    expect(warnings.length).toBeGreaterThanOrEqual(1)
    expect(warnings.some((w) => /4-axis feed reduced/.test(w))).toBe(true)
    expect(warnings.some((w) => /RPM rotary limit/.test(w))).toBe(true)
  })

  it('returnHome emits exactly two lines: G0 Z<clearZ> Y0 then G0 A0 with comment', () => {
    // RUNTIME PIN: the LAST lines of every strategy come from returnHome();
    // the literal "; return A to home" comment must remain because the
    // Carvera 4-axis post-contract pin set (Cycle 65 [ID-0156]) reads it
    // as a marker.
    const e = makeEmitter()
    e.cutTo(10, -2, 45) // dirty modal state so returnHome has work to do
    const baseline = e.lines().length
    e.returnHome()
    const tail = e.lines().slice(baseline)
    expect(tail).toEqual(['G0 Z35.000 Y0', 'G0 A0 ; return A to home'])
    expect(e.getZ()).toBeCloseTo(35, 9)
    expect(e.getA()).toBeCloseTo(0, 9)
  })

  it('lines() and warnings() return defensive slices (mutating the result does not leak into the emitter)', () => {
    // RUNTIME PIN: both accessors return ._lines.slice() / ._warnings.slice()
    // so a caller can sort / filter the result without corrupting the
    // emitter state. A future refactor that returns the underlying array
    // by reference would silently break every strategy that introspects
    // its own output -- this test is the gate against that.
    const e = makeEmitter()
    e.rapidX(10)
    e.rapidZ(-2)
    const snapshot = e.lines()
    snapshot.push('JUNK LINE')
    snapshot.length = 0 // try to wipe the snapshot
    // The emitter must still report its real internal state.
    expect(e.lines()).toEqual(['G0 X10.000', 'G0 Z-2.000'])
    // Same property for warnings():
    const w = e.warnings()
    w.push('JUNK WARNING')
    expect(e.warnings()).toEqual([])
  })
})
