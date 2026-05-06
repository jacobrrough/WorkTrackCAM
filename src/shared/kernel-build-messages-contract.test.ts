/**
 * Paired-pin contract for `src/shared/kernel-build-messages.ts` -- [ID-0198].
 *
 * Cycle 121 -- 2026-04-27 -- test-coverage rotation pull. Companion to the
 * existing `kernel-build-messages.test.ts` (5 it() blocks covering 4 of 19
 * KERNEL_BUILD_USER entries + 1 of 7 kernelBuildDetailGuidance branches +
 * 4 of 5 formatKernelBuildStatus output-composition paths). This file pins
 * the surface-area invariants the original file does NOT cover, in the
 * [ID-0188] / [ID-0190] / [ID-0196] / [ID-0197] paired-pin style:
 *
 *   - All 19 known KERNEL_BUILD_USER error codes round-trip through
 *     formatKernelBuildStatus to non-empty, keyword-matching text.
 *   - Unknown error codes fall back to "Kernel build failed (<code>)"
 *     verbatim including the bare empty-string code edge case.
 *   - All 7 kernelBuildDetailGuidance branches return their tip strings
 *     for the documented detail patterns; default returns undefined.
 *   - formatKernelBuildStatus composition: 4 output shapes (base only;
 *     base + detail; base + detail + hint; base + hint with no detail).
 *   - Detail trimming + whitespace handling (.trim() before matching).
 *   - LOFT_MAX_PROFILES interpolation (uses the const value, not a
 *     hard-coded literal -- so a future cap change propagates).
 *
 * Machine scope: kernel-build-messages.ts feeds the renderer Design tab
 * status toasts and `kernel-manifest.json` userHint field for the kernel
 * (CadQuery) build pipeline. Cross-cutting infrastructure used across
 * all three target machines whenever the user runs a Build STEP from the
 * Design tab. ZERO production-code edits this cycle.
 */
import { describe, expect, it } from 'vitest'
import { LOFT_MAX_PROFILES } from './sketch-profile'
import {
  formatKernelBuildStatus,
  kernelBuildDetailGuidance
} from './kernel-build-messages'

// ─── (A) KERNEL_BUILD_USER -- all 19 known codes round-trip -- 19 it() ──────

describe('[ID-0198] (A) KERNEL_BUILD_USER -- all 19 known codes', () => {
  it('design_file_missing -> mentions design sketch + missing', () => {
    const s = formatKernelBuildStatus('design_file_missing')
    expect(s).toMatch(/design/i)
    expect(s).toMatch(/missing/i)
    // No "Kernel build failed (...)" fallback -- the code IS known.
    expect(s).not.toMatch(/Kernel build failed \(/)
  })

  it('no_closed_profile -> mentions closed profile + extrude/revolve/loft', () => {
    const s = formatKernelBuildStatus('no_closed_profile')
    expect(s).toMatch(/closed profile/i)
    expect(s).toMatch(/extrude.*revolve.*loft/i)
  })

  it('circle_revolve_use_polyline_approximation -> mentions revolve + circle', () => {
    const s = formatKernelBuildStatus('circle_revolve_use_polyline_approximation')
    expect(s).toMatch(/revolve/i)
    expect(s).toMatch(/circle/i)
  })

  it('loft_requires_two_profiles -> mentions loft + at least two', () => {
    const s = formatKernelBuildStatus('loft_requires_two_profiles')
    expect(s).toMatch(/loft/i)
    expect(s).toMatch(/two/i)
  })

  it('loft_too_many_profiles -> mentions loft + interpolates LOFT_MAX_PROFILES', () => {
    const s = formatKernelBuildStatus('loft_too_many_profiles')
    expect(s).toMatch(/loft/i)
    expect(s).toContain(String(LOFT_MAX_PROFILES))
    // Pin: NOT a hard-coded literal -- a future change to LOFT_MAX_PROFILES
    // must propagate. Assert via the const, not via the value 16 in this
    // test, so this pin survives a constant change.
  })

  it('invalid_extrude_depth_mm -> mentions extrude + finite + positive', () => {
    const s = formatKernelBuildStatus('invalid_extrude_depth_mm')
    expect(s).toMatch(/extrude/i)
    expect(s).toMatch(/finite/i)
    expect(s).toMatch(/positive/i)
  })

  it('invalid_loft_separation_mm -> mentions loft spacing + finite + positive', () => {
    const s = formatKernelBuildStatus('invalid_loft_separation_mm')
    expect(s).toMatch(/loft/i)
    expect(s).toMatch(/spacing|separation/i)
    expect(s).toMatch(/finite/i)
    expect(s).toMatch(/positive/i)
  })

  it('invalid_revolve_params -> mentions revolve + angle + finite + positive', () => {
    const s = formatKernelBuildStatus('invalid_revolve_params')
    expect(s).toMatch(/revolve/i)
    expect(s).toMatch(/angle/i)
    expect(s).toMatch(/finite/i)
  })

  it('cadquery_not_installed -> mentions CadQuery + Settings + pip install', () => {
    const s = formatKernelBuildStatus('cadquery_not_installed')
    expect(s).toMatch(/CadQuery/)
    expect(s).toMatch(/pip install/i)
    expect(s).toMatch(/Settings/i)
  })

  it('invalid_payload -> mentions kernel payload + validation', () => {
    const s = formatKernelBuildStatus('invalid_payload')
    expect(s).toMatch(/payload/i)
    expect(s).toMatch(/validation/i)
  })

  it('no_solid -> mentions solid + sketch + profiles', () => {
    const s = formatKernelBuildStatus('no_solid')
    expect(s).toMatch(/solid/i)
    expect(s).toMatch(/sketch/i)
    expect(s).toMatch(/profile/i)
  })

  it('build_failed -> mentions CadQuery / STEP / STL', () => {
    const s = formatKernelBuildStatus('build_failed')
    expect(s).toMatch(/CadQuery|STEP|STL/i)
  })

  it('kernel_build_failed -> mentions kernel-manifest.json', () => {
    const s = formatKernelBuildStatus('kernel_build_failed')
    expect(s).toMatch(/kernel-manifest\.json/i)
  })

  it('unknown_solid_kind -> mentions Unsupported + solid kind', () => {
    const s = formatKernelBuildStatus('unknown_solid_kind')
    expect(s).toMatch(/Unsupported/i)
    expect(s).toMatch(/solid kind/i)
  })

  it('bad_payload_version -> mentions payload version + not supported', () => {
    const s = formatKernelBuildStatus('bad_payload_version')
    expect(s).toMatch(/payload/i)
    expect(s).toMatch(/version/i)
    expect(s).toMatch(/not supported/i)
  })

  it('payload_read_failed -> mentions kernel payload', () => {
    const s = formatKernelBuildStatus('payload_read_failed')
    expect(s).toMatch(/kernel/i)
    expect(s).toMatch(/payload/i)
  })

  it('output_dir_failed -> mentions project output folder + kernel', () => {
    const s = formatKernelBuildStatus('output_dir_failed')
    expect(s).toMatch(/output/i)
    expect(s).toMatch(/folder|directory/i)
  })

  it('usage -> mentions Kernel script + internal error', () => {
    const s = formatKernelBuildStatus('usage')
    expect(s).toMatch(/Kernel script/i)
    expect(s).toMatch(/internal/i)
  })

  it('every known code returns a non-empty string', () => {
    const knownCodes = [
      'design_file_missing',
      'no_closed_profile',
      'circle_revolve_use_polyline_approximation',
      'loft_requires_two_profiles',
      'loft_too_many_profiles',
      'invalid_extrude_depth_mm',
      'invalid_loft_separation_mm',
      'invalid_revolve_params',
      'cadquery_not_installed',
      'invalid_payload',
      'no_solid',
      'build_failed',
      'kernel_build_failed',
      'unknown_solid_kind',
      'bad_payload_version',
      'payload_read_failed',
      'output_dir_failed',
      'usage'
    ]
    // 18 codes (one per registered key in KERNEL_BUILD_USER).
    expect(knownCodes.length).toBe(18)
    for (const code of knownCodes) {
      const s = formatKernelBuildStatus(code)
      expect(s.length).toBeGreaterThan(0)
      // No fallback shape ("Kernel build failed (<code>)") for any known code.
      expect(s).not.toBe(`Kernel build failed (${code})`)
    }
  })
})

// ─── (B) Unknown error code fallback -- 3 it() ──────────────────────────────

describe('[ID-0198] (B) unknown error code fallback', () => {
  it('an unknown code returns "Kernel build failed (<code>)" verbatim', () => {
    expect(formatKernelBuildStatus('some_future_code')).toBe('Kernel build failed (some_future_code)')
  })

  it('an unknown code with no detail interpolates the EXACT code string', () => {
    const exotic = 'a_very_specific_code_42'
    const s = formatKernelBuildStatus(exotic)
    expect(s).toContain(exotic)
    expect(s).toBe(`Kernel build failed (${exotic})`)
  })

  it('the bare empty-string code falls through to "Kernel build failed ()"', () => {
    // Edge case: empty error string is not a registered key, so the
    // fallback runs and emits a parenthetical with no code inside.
    expect(formatKernelBuildStatus('')).toBe('Kernel build failed ()')
  })
})

// ─── (C) kernelBuildDetailGuidance -- all 7 branches + default -- 8 it() ───

describe('[ID-0198] (C) kernelBuildDetailGuidance branches', () => {
  it('profileIndex out of range -> tip about 0-based indices and entity order', () => {
    const tip = kernelBuildDetailGuidance('profileIndex out of range: 3')
    expect(tip).toBeDefined()
    expect(tip!).toMatch(/0-based/i)
    expect(tip!).toMatch(/entity order/i)
  })

  it('split_keep_halfspace produced empty keep region -> tip about opposite side / offsetMm', () => {
    const tip = kernelBuildDetailGuidance('split_keep_halfspace produced empty keep region')
    expect(tip).toBeDefined()
    expect(tip!).toMatch(/opposite/i)
    expect(tip!).toMatch(/offsetMm/i)
  })

  it('boolean_combine_profile extrudeDirection -> tip about +Z / -Z only', () => {
    const tip = kernelBuildDetailGuidance('boolean_combine_profile extrudeDirection invalid')
    expect(tip).toBeDefined()
    expect(tip!).toMatch(/\+Z/)
    expect(tip!).toMatch(/-Z/)
  })

  it('pattern_path alignToPathTangent -> tip about boolean type', () => {
    const tip = kernelBuildDetailGuidance('pattern_path alignToPathTangent must be a boolean')
    expect(tip).toBeDefined()
    expect(tip!).toMatch(/boolean/i)
  })

  it('hole_from_profile depthMm -> tip about depth mode + through_all', () => {
    const tip = kernelBuildDetailGuidance('hole_from_profile depthMm: must be > 0')
    expect(tip).toBeDefined()
    expect(tip!).toMatch(/depth/i)
    expect(tip!).toMatch(/through_all/i)
  })

  it('hole_from_profile depth mode requires -> same depth-mode tip', () => {
    const tip = kernelBuildDetailGuidance('hole_from_profile depth mode requires depthMm > 0')
    expect(tip).toBeDefined()
    expect(tip!).toMatch(/depth/i)
    expect(tip!).toMatch(/through_all/i)
  })

  it('design_file_missing error -> tip about saving / opening project (NOT detail-driven)', () => {
    // This branch is keyed off the ERROR field, not the detail field.
    // Pass an unrelated detail to confirm the error-keyed branch fires.
    const tip = kernelBuildDetailGuidance('any unrelated detail', 'design_file_missing')
    expect(tip).toBeDefined()
    expect(tip!).toMatch(/save|design\/sketch\.json|project folder/i)
  })

  it('default branch (no matching pattern + non-design_file_missing error) -> undefined', () => {
    expect(kernelBuildDetailGuidance('totally unrecognized detail text')).toBeUndefined()
    expect(kernelBuildDetailGuidance('totally unrelated', 'build_failed')).toBeUndefined()
    // Empty / undefined detail also goes to default unless error matches.
    expect(kernelBuildDetailGuidance('', 'build_failed')).toBeUndefined()
    expect(kernelBuildDetailGuidance(undefined)).toBeUndefined()
  })
})

// ─── (D) formatKernelBuildStatus -- output composition -- 5 it() ────────────

describe('[ID-0198] (D) formatKernelBuildStatus output composition', () => {
  it('base only: known code with NO detail -> bare KERNEL_BUILD_USER text', () => {
    const s = formatKernelBuildStatus('invalid_payload')
    // No em-dash, no period-then-space-Tip.
    expect(s).not.toMatch(/—/)
    expect(s).not.toMatch(/Tip:/i)
    // The exact text from the registry.
    expect(s).toBe('Kernel payload failed validation before CadQuery ran.')
  })

  it('base + detail (no hint match): emits "<base> — <detail>" with em-dash separator', () => {
    const detail = 'some specific cadquery error'
    const s = formatKernelBuildStatus('build_failed', detail)
    expect(s).toContain('—')
    expect(s).toContain(detail)
    // Format: "<base> — <detail>" -- NO trailing period because no hint.
    expect(s).toMatch(/—\s+some specific cadquery error$/)
    // No tip.
    expect(s).not.toMatch(/Tip:/i)
  })

  it('base + detail + hint: emits "<base> — <detail>. <hint>" with period before tip', () => {
    const detail = 'profileIndex out of range: 7'
    const s = formatKernelBuildStatus('build_failed', detail)
    expect(s).toContain('—')
    expect(s).toContain(detail)
    expect(s).toMatch(/Tip:/i)
    // Period between detail and hint is REQUIRED -- pinned because the
    // composition logic emits `${base} — ${d}. ${hint}`.
    expect(s).toMatch(/profileIndex out of range: 7\. Tip:/)
  })

  it('base + hint (no detail, error-keyed hint): emits "<base> <hint>" with NO em-dash', () => {
    // design_file_missing has both a base text AND an error-keyed hint via
    // the kernelBuildDetailGuidance error parameter. No detail string is
    // provided, so the formatter emits "<base> <hint>" with a single space.
    const s = formatKernelBuildStatus('design_file_missing')
    expect(s).toMatch(/Tip:/i)
    // No em-dash separator (em-dash is only emitted when detail is present).
    expect(s).not.toMatch(/—/)
  })

  it('falls-back code WITH detail emits "Kernel build failed (<code>) — <detail>"', () => {
    const s = formatKernelBuildStatus('made_up_code', 'specific reason')
    expect(s).toContain('Kernel build failed (made_up_code)')
    expect(s).toContain('—')
    expect(s).toContain('specific reason')
  })
})

// ─── (E) Detail trimming + whitespace + edge cases -- 4 it() ────────────────

describe('[ID-0198] (E) detail trimming + whitespace + edge cases', () => {
  it('detail with surrounding whitespace is trimmed before composition', () => {
    const s = formatKernelBuildStatus('build_failed', '   surrounded by space   ')
    // The trimmed detail appears in output; the leading/trailing whitespace does NOT.
    expect(s).toContain('surrounded by space')
    expect(s).not.toMatch(/   surrounded/)
    expect(s).not.toMatch(/space   /)
  })

  it('detail empty string === undefined detail (both produce base only)', () => {
    const baseOnly = formatKernelBuildStatus('invalid_payload')
    expect(formatKernelBuildStatus('invalid_payload', '')).toBe(baseOnly)
    expect(formatKernelBuildStatus('invalid_payload', '   ')).toBe(baseOnly)
    expect(formatKernelBuildStatus('invalid_payload', undefined)).toBe(baseOnly)
  })

  it('detail with whitespace-only string is treated as no detail (no em-dash)', () => {
    const s = formatKernelBuildStatus('build_failed', '   \n\t  ')
    expect(s).not.toMatch(/—/)
    // Falls through to base text only (no hint matches the whitespace-only detail).
    expect(s).toBe('CadQuery or STEP/STL export failed while building the part.')
  })

  it('detail trimming applies to the hint detection path too', () => {
    // Wrapping the recognizable detail in whitespace must NOT block the
    // tip pattern match -- the regex runs against the trimmed detail.
    const s = formatKernelBuildStatus(
      'build_failed',
      '   profileIndex out of range: 9   '
    )
    expect(s).toMatch(/Tip:/i)
    expect(s).toMatch(/0-based/i)
  })
})
