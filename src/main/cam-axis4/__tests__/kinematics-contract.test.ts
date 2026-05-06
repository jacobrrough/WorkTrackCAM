/**
 * kinematics.ts contract paired-pin set -- Cycle 78 [ID-0166]
 *
 * Following the doc-tied paired-pin shape established by:
 *   - Cycle 64 [ID-0007b-followup] K2 Moonraker upload contract
 *   - Cycle 65 [ID-0156] Carvera 4-axis post contract
 *   - Cycle 67 [ID-0155] Carvera 3-axis post contract
 *   - Cycle 70 [ID-0154] Laguna Swift 5x10 post contract
 *   - Cycle 76 [ID-0164] cam-axis4 Emitter shared-emitter contract
 *   - Cycle 77 [ID-0165] sequenceMultiToolJob helper-level contract
 *
 * Each invariant section asserts BOTH the documented intent (header
 * docstring + per-export JSDoc text in `src/main/cam-axis4/kinematics.ts`)
 * AND the runtime behavior (against direct function invocation), so
 * doc-vs-code drift fails one of the pair.
 *
 * Why a SEPARATE file from the existing `kinematics.test.ts`:
 *   `kinematics.test.ts` is a UNIT test set (14 tests across 3 describe
 *   blocks) covering core behaviors (passthrough, throttle, boundary
 *   wrap). This contract pin set adds the doc-text pins AND the runtime
 *   pins for invariants the unit set does not cover:
 *     - the documented (-180, 180] range and the -180 -> +180 mapping
 *     - the documented "pre-emission, not post-hoc" architecture principle
 *     - the documented Two-Case formula split for adaptFeedForAngularVelocity
 *     - the warning string EXACT format (toFixed digit counts, label order)
 *     - the Math.max(1, Math.floor(cap)) safety floor
 *     - the stockDiameterMm <= 1e-6 zero-stock passthrough guard in the
 *       pure-rotation branch
 *     - the cap + 1e-9 epsilon at the requested-feed-equals-cap boundary
 *
 * Machine scope per CLAUDE.md "My-Shop-Only Mode": kinematics.ts is the
 * 4-axis-rotary feed-cap helper consumed exclusively by the **Makera
 * Carvera + 4th Axis Rotary** target machine through Emitter.cutTo()
 * (which calls `adaptFeedForAngularVelocity` BEFORE writing each G1).
 * K2 Plus (FDM) and Laguna Swift 5x10 (3-axis CNC router) do not exercise
 * this module.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  adaptFeedForAngularVelocity,
  arcLengthMm,
  shortestAngularPath
} from '../kinematics'

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/** Reads kinematics.ts source text once for the doc-text paired pins. */
const KINEMATICS_SOURCE = readFileSync(
  resolve(__dirname, '..', 'kinematics.ts'),
  'utf-8'
)

// ===========================================================================
// Section 1 -- Module header doc invariants
// ===========================================================================

describe('kinematics -- module header doc invariants [ID-0166]', () => {
  it('header docstring pins the "pre-emission, not post-hoc" architecture principle', () => {
    // DOC PIN: the file replaces the old `cam-4axis-feed-check.ts` post-hoc
    // analysis. The principle "throttle BEFORE writing G1" is a Safety
    // Rule 1 invariant -- a regression that flips this back to post-hoc
    // would emit unsafe G-code and warn after the fact.
    expect(KINEMATICS_SOURCE).toContain('pre-emission, not post-hoc')
    // The phrase straddles a JSDoc line break; match across `*` prefix.
    expect(KINEMATICS_SOURCE).toMatch(
      /throttle\s*\n\s*\*\s*the feed in-place \(and surface a warning\) rather than emitting unsafe/
    )
  })

  it('header docstring pins the Replaces-cam-4axis-feed-check predecessor link', () => {
    // DOC PIN: the doc explicitly names the deprecated module. Renaming
    // or losing this reference would obscure the migration history -- a
    // future investigator wouldn't know where the kinematics moved from.
    expect(KINEMATICS_SOURCE).toMatch(/cam-4axis-feed-check\.ts/)
  })

  it('header docstring lists all three exported helpers in a Provides block', () => {
    // DOC PIN: the Provides block is the public API contract for the
    // module. Adding a fourth export without updating the doc would drift
    // the file from its stated surface.
    expect(KINEMATICS_SOURCE).toContain('shortestAngularPath')
    expect(KINEMATICS_SOURCE).toContain('arcLengthMm')
    expect(KINEMATICS_SOURCE).toContain('adaptFeedForAngularVelocity')
    // The Provides block specifically frames them as helpers the emitter calls.
    expect(KINEMATICS_SOURCE).toMatch(/Provides:[\s\S]*shortestAngularPath/)
  })
})

// ===========================================================================
// Section 2 -- shortestAngularPath contract
// ===========================================================================

describe('kinematics -- shortestAngularPath contract [ID-0166]', () => {
  it('JSDoc declares the return range as (-180, 180] (open lower, closed upper)', () => {
    // DOC PIN: the range exclusion is intentional -- -180 maps to +180 to
    // pick a canonical direction. The doc spells out "in (-180, 180]" so
    // a reader knows to expect +180 (never -180) at the boundary.
    expect(KINEMATICS_SOURCE).toMatch(/in \(-180, 180\]/)
  })

  it('JSDoc lists four canonical worked examples in order', () => {
    // DOC PIN: the four examples cover (a) wrap-around forward, (b) wrap-
    // around backward, (c) the boundary at +180, (d) identity. Losing any
    // would weaken the readability of the helper's contract.
    expect(KINEMATICS_SOURCE).toMatch(/shortestAngularPath\(\s*0, 350\)\s*→\s*-10/)
    expect(KINEMATICS_SOURCE).toMatch(/shortestAngularPath\(350,\s*10\)\s*→\s*\+20/)
    expect(KINEMATICS_SOURCE).toMatch(/shortestAngularPath\(\s*0, 180\)\s*→\s*180/)
    expect(KINEMATICS_SOURCE).toMatch(/shortestAngularPath\(\s*90,\s*90\)\s*→\s*0/)
  })

  it('runtime: matches all four documented worked examples exactly', () => {
    // RUNTIME PIN: the doc examples are the contract. If the runtime
    // diverges from any of them, a future Emitter caller will pick the
    // wrong A-axis direction and burn cycles taking the long way around.
    expect(shortestAngularPath(0, 350)).toBeCloseTo(-10, 9)
    expect(shortestAngularPath(350, 10)).toBeCloseTo(20, 9)
    expect(shortestAngularPath(0, 180)).toBeCloseTo(180, 9)
    expect(shortestAngularPath(90, 90)).toBe(0)
  })

  it('runtime: -180 input is mapped to +180 (lower bound exclusive)', () => {
    // RUNTIME PIN: the helper explicitly remaps -180 -> +180 so callers
    // that compare to a fixed boundary can rely on a single canonical
    // value. A future "simplify the modulo" refactor that re-introduces
    // the -180 lower-bound would break the canonical-direction contract.
    // Inputs that arithmetically yield exactly -180:
    //   from=180, to=0  -> raw delta = (-180 % 360 + 540) % 360 - 180 = 180
    //   from=0, to=-180 -> ditto: 180 in (-180, 180]
    expect(shortestAngularPath(180, 0)).toBe(180)
    expect(shortestAngularPath(0, -180)).toBe(180)
    // Negative result must never be -180 specifically:
    for (let from = 0; from <= 360; from += 30) {
      for (let to = 0; to <= 360; to += 30) {
        const d = shortestAngularPath(from, to)
        expect(d).toBeGreaterThan(-180)
        expect(d).toBeLessThanOrEqual(180)
      }
    }
  })

  it('runtime: handles arbitrary numeric inputs outside [0, 360)', () => {
    // RUNTIME PIN: the helper normalizes via `(((to - from) % 360 + 540)
    // % 360 - 180)`, which is robust to negative inputs and inputs > 360.
    // This is critical because A-axis state in the emitter accumulates
    // across rotations and can exceed 360 (multi-turn parts).
    expect(shortestAngularPath(720, 730)).toBeCloseTo(10, 9)
    expect(shortestAngularPath(-10, 10)).toBeCloseTo(20, 9)
    expect(shortestAngularPath(1000, 1010)).toBeCloseTo(10, 9)
  })
})

// ===========================================================================
// Section 3 -- arcLengthMm contract
// ===========================================================================

describe('kinematics -- arcLengthMm contract [ID-0166]', () => {
  it('JSDoc states the formula |Δθ| × radius in radians', () => {
    // DOC PIN: the formula is the public contract. A future "optimize via
    // pre-computed degrees-per-mm constants" refactor would have to update
    // the doc here first.
    expect(KINEMATICS_SOURCE).toMatch(/arcLength\s*=\s*\|Δθ\|\s*×\s*radius/)
    expect(KINEMATICS_SOURCE).toMatch(/Δθ in radians/)
  })

  it('runtime: 360° at radius 10 returns 2π × 10 (≈ 62.832 mm)', () => {
    // RUNTIME PIN: the canonical case. Independent of the unit test's
    // toBeCloseTo-2 spot-check, this pin uses the exact 9-digit precision
    // that the emitter's downstream feed-rate math relies on.
    expect(arcLengthMm(360, 10)).toBeCloseTo(2 * Math.PI * 10, 9)
  })

  it('runtime: silently floors negative radius to 0 (Math.max(0, radiusMm))', () => {
    // RUNTIME PIN: an undocumented-but-implemented safety guard. The
    // helper has `Math.max(0, radiusMm)` inline, which silently absorbs
    // negative-radius bugs upstream into a zero arc length. This pin
    // captures the current behavior so a future strict-validation refactor
    // (which would throw instead) is a deliberate, visible change.
    expect(arcLengthMm(180, -50)).toBe(0)
    expect(arcLengthMm(360, -1e6)).toBe(0)
  })

  it('runtime: zero radius -> zero arc regardless of angular delta', () => {
    // RUNTIME PIN: redundant with the unit test but locks the boundary as
    // part of the contract pin set so future refactors of the radius
    // guard see this assertion in the contract suite.
    expect(arcLengthMm(0, 0)).toBe(0)
    expect(arcLengthMm(360, 0)).toBe(0)
    expect(arcLengthMm(-180, 0)).toBe(0)
  })

  it('runtime: uses absolute angular delta -- negative degrees produce positive arc', () => {
    // RUNTIME PIN: arc length is unsigned. A regression that returned
    // signed arc length would silently invert the time-per-arc math in
    // adaptFeedForAngularVelocity's combined branch.
    expect(arcLengthMm(-90, 5)).toBeCloseTo(Math.abs(-90) * (Math.PI / 180) * 5, 9)
    expect(arcLengthMm(90, 5)).toBeCloseTo(arcLengthMm(-90, 5), 9)
  })
})

// ===========================================================================
// Section 4 -- adaptFeedForAngularVelocity contract
// ===========================================================================

describe('kinematics -- adaptFeedForAngularVelocity contract [ID-0166]', () => {
  it('JSDoc states the Two-Cases split (pure rotation vs combined XYZ+A)', () => {
    // DOC PIN: the doc explicitly documents the two branches. A future
    // refactor that merges them would have to update the doc first.
    expect(KINEMATICS_SOURCE).toMatch(/Two cases:/)
    expect(KINEMATICS_SOURCE).toMatch(/1\.\s+Pure rotation \(linearDistMm\s*≈\s*0\)/)
    expect(KINEMATICS_SOURCE).toMatch(/2\.\s+Combined XYZ \+ A/)
  })

  it('JSDoc spells out both cap formulas (angVel = F × 360 / (π × stockDia) and angVel = |Δθ| × F / linearDist)', () => {
    // DOC PIN: the formulas tell the reader exactly how the cap is
    // derived. A regression that flips the formulas would emit unsafe
    // feeds at the rotary table, a Safety Rule 1 hazard.
    expect(KINEMATICS_SOURCE).toMatch(/angVel\s*=\s*F\s*×\s*360\s*\/\s*\(π\s*×\s*stockDia\)/)
    expect(KINEMATICS_SOURCE).toMatch(/angVel\s*=\s*\|Δθ\|\s*\/\s*time\s*=\s*\|Δθ\|\s*×\s*F\s*\/\s*linearDist/)
  })

  it('runtime: passthrough when dA < 1e-6 / requested <= 0 / maxRotaryRpm <= 0', () => {
    // RUNTIME PIN: the three short-circuit conditions at the top of the
    // function. Removing any of them would either NaN out the cap
    // computation or hit a divide-by-zero downstream.
    const noRotation = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 800,
      deltaADeg: 0,
      linearDistMm: 50,
      stockDiameterMm: 50,
      maxRotaryRpm: 30
    })
    expect(noRotation).toEqual({ feedMmMin: 800, throttled: false })

    const zeroFeed = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 0,
      deltaADeg: 90,
      linearDistMm: 50,
      stockDiameterMm: 50,
      maxRotaryRpm: 30
    })
    expect(zeroFeed).toEqual({ feedMmMin: 0, throttled: false })

    const noRpmCap = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 800,
      deltaADeg: 90,
      linearDistMm: 50,
      stockDiameterMm: 50,
      maxRotaryRpm: 0
    })
    expect(noRpmCap).toEqual({ feedMmMin: 800, throttled: false })
  })

  it('runtime: pure-rotation branch passthrough when stockDiameterMm <= 1e-6 (zero-stock guard)', () => {
    // RUNTIME PIN: the pure-rotation branch hits a `stockDiameterMm <=
    // 1e-6 -> passthrough` short-circuit that the JSDoc does not call
    // out explicitly. This pin captures the runtime guard so a future
    // refactor that drops the guard (and produces NaN cap) is caught.
    const result = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 1500,
      deltaADeg: 90,
      linearDistMm: 0,
      stockDiameterMm: 0,
      maxRotaryRpm: 30
    })
    expect(result.throttled).toBe(false)
    expect(result.feedMmMin).toBe(1500)
  })

  it('runtime: pure-rotation cap formula F <= maxDegPerMin × π × D / 360', () => {
    // RUNTIME PIN: at maxRotaryRpm=30 (Carvera's harmonic-drive default),
    // stockDiameter=50: maxDegPerMin = 30 * 360 = 10800 deg/min.
    //   cap = 10800 * π * 50 / 360 = 1500π ≈ 4712.39 mm/min
    // Request 6000 (above cap) -> throttled to floor(4712.39) = 4712.
    const result = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 6000,
      deltaADeg: 45,
      linearDistMm: 0,
      stockDiameterMm: 50,
      maxRotaryRpm: 30
    })
    expect(result.throttled).toBe(true)
    expect(result.feedMmMin).toBe(Math.floor(1500 * Math.PI))
    expect(result.warning).toBeDefined()
  })

  it('runtime: combined-move cap formula F <= maxDegPerMin × linearDist / dA', () => {
    // RUNTIME PIN: maxRotaryRpm=30: maxDegPerMin = 10800 deg/min.
    // linearDist=20 mm, dA=180 deg -> cap = 10800 * 20 / 180 = 1200 mm/min.
    // Request 1800 -> throttled to 1200.
    const result = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 1800,
      deltaADeg: 180,
      linearDistMm: 20,
      stockDiameterMm: 50,
      maxRotaryRpm: 30
    })
    expect(result.throttled).toBe(true)
    expect(result.feedMmMin).toBe(1200)
  })

  it('runtime: requested at the cap boundary (within 1e-9 epsilon) is treated as passthrough', () => {
    // RUNTIME PIN: the `requested <= cap + 1e-9` epsilon prevents float-
    // jitter from trip-throttling at the exact boundary. A future "tighten
    // to strict <=" refactor would surface spurious throttle warnings on
    // ostensibly clean feeds.
    // Combined branch at cap: F = 1200 exactly with dA=180, linear=20, rpm=30.
    const exact = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 1200,
      deltaADeg: 180,
      linearDistMm: 20,
      stockDiameterMm: 50,
      maxRotaryRpm: 30
    })
    expect(exact.throttled).toBe(false)
    expect(exact.feedMmMin).toBe(1200)
    // Just under cap (within 1e-9):
    const justUnder = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 1200 - 1e-12,
      deltaADeg: 180,
      linearDistMm: 20,
      stockDiameterMm: 50,
      maxRotaryRpm: 30
    })
    expect(justUnder.throttled).toBe(false)
  })

  it('runtime: throttled feed is Math.max(1, Math.floor(cap)) -- never below 1 mm/min', () => {
    // RUNTIME PIN: the safety floor at 1 mm/min keeps the helper from
    // emitting F0 (which is dwell on most controllers) when the cap math
    // produces sub-1 values for tiny stock or tight RPM caps.
    const result = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 1000,
      deltaADeg: 359,
      linearDistMm: 0.001,
      stockDiameterMm: 0.5,
      maxRotaryRpm: 0.001
    })
    expect(result.throttled).toBe(true)
    expect(result.feedMmMin).toBeGreaterThanOrEqual(1)
  })

  it('runtime: warning string format is exact -- "4-axis feed reduced from X to Y mm/min..."', () => {
    // RUNTIME PIN: the warning text is surfaced into the renderer warning
    // bar via Emitter.warnings(). Changing the wording would break user-
    // facing warning de-dup logic upstream that anchors on the prefix.
    const result = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 6000,
      deltaADeg: 45,
      linearDistMm: 0,
      stockDiameterMm: 50,
      maxRotaryRpm: 30
    })
    expect(result.warning).toMatch(/^4-axis feed reduced from 6000 to \d+ mm\/min/)
    expect(result.warning).toMatch(/to stay within 30\.0 RPM rotary limit/)
    // The trailing parenthetical includes ΔA (2 digits) and linear (2 digits).
    expect(result.warning).toMatch(/\(ΔA=45\.00°, linear=0\.00 mm\)$/)
  })

  it('runtime: passthrough returns omit the warning field (not warning="")', () => {
    // RUNTIME PIN: the FeedAdaptResult discriminator is `throttled`. A
    // passthrough must NOT carry a warning field at all (so callers can
    // use `if (result.warning)` truthiness). Returning warning="" instead
    // would silently fail truthy checks upstream.
    const passthrough = adaptFeedForAngularVelocity({
      requestedFeedMmMin: 100,
      deltaADeg: 1,
      linearDistMm: 100,
      stockDiameterMm: 50,
      maxRotaryRpm: 30
    })
    expect(passthrough.throttled).toBe(false)
    expect(passthrough.warning).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(passthrough, 'warning')).toBe(false)
  })
})
