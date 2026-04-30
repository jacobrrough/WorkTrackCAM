/**
 * Cycle 61 ui-polish [ID-0152] -- pin tests for the brand-bar
 * machine-badge label helpers in `brand-bar-machine-badge.ts`.
 *
 * Coverage targets:
 *   1. Visible-text fallback parity with the pre-Cycle-61 `?? 'No machine'`
 *      expression (Safety Rule 2: zero visual change).
 *   2. Tooltip parity with the pre-Cycle-61 `Current machine: <name> --
 *      Click to change` template literal (Safety Rule 2: zero hover-text
 *      change for already-trained operators).
 *   3. NEW aria-label contract (the missing piece this cycle fixes):
 *      action verb + machine name + human-readable mode label, with a
 *      distinct phrasing for the "no machine" empty-state.
 *
 * The helpers are pure -- no React mounting, no DOM, no electron import.
 */
import { describe, expect, it } from 'vitest'
import {
  formatMachineBadgeAriaLabel,
  formatMachineBadgeLabel,
  formatMachineBadgeTitle,
  MACHINE_BADGE_NAME_FALLBACK,
  MACHINE_BADGE_TITLE_FALLBACK
} from './brand-bar-machine-badge'
import type { MachineUIMode } from './shop-types'

describe('formatMachineBadgeLabel -- visible-text [ID-0152]', () => {
  it('returns the trimmed name when a non-empty string is supplied', () => {
    expect(formatMachineBadgeLabel('Creality K2 Plus')).toBe('Creality K2 Plus')
  })

  it('trims surrounding whitespace before returning', () => {
    expect(formatMachineBadgeLabel('  Laguna Swift 5x10  ')).toBe('Laguna Swift 5x10')
  })

  it('falls back to MACHINE_BADGE_NAME_FALLBACK ("No machine") on null', () => {
    expect(formatMachineBadgeLabel(null)).toBe(MACHINE_BADGE_NAME_FALLBACK)
    expect(MACHINE_BADGE_NAME_FALLBACK).toBe('No machine')
  })

  it('falls back to "No machine" on undefined', () => {
    expect(formatMachineBadgeLabel(undefined)).toBe('No machine')
  })

  it('falls back to "No machine" on empty / whitespace-only string', () => {
    expect(formatMachineBadgeLabel('')).toBe('No machine')
    expect(formatMachineBadgeLabel('   ')).toBe('No machine')
    expect(formatMachineBadgeLabel('\t\n')).toBe('No machine')
  })
})

describe('formatMachineBadgeTitle -- Safety Rule 2 hover-text parity [ID-0152]', () => {
  const allModes: readonly MachineUIMode[] = [
    'fdm', 'cnc_2d', 'cnc_3d', 'cnc_4axis', 'cnc_5axis'
  ] as const

  it('matches the pre-Cycle-61 wording with a real machine name', () => {
    const out = formatMachineBadgeTitle({
      machineName: 'Makera Carvera',
      mode: 'cnc_4axis'
    })
    // Pinned byte-for-byte to the literal in pre-Cycle-61 ShopApp.tsx:
    //   `Current machine: ${name ?? 'None'} \u2014 Click to change`
    expect(out).toBe('Current machine: Makera Carvera \u2014 Click to change')
  })

  it('falls back to "None" (NOT "No machine") when machineName is null', () => {
    // Pinned distinction: visible badge says "No machine" but the
    // tooltip says "Current machine: None". Pre-Cycle-61 used `?? 'None'`.
    expect(formatMachineBadgeTitle({ machineName: null, mode: 'fdm' })).toBe(
      'Current machine: None \u2014 Click to change'
    )
    expect(MACHINE_BADGE_TITLE_FALLBACK).toBe('None')
  })

  it('falls back to "None" on undefined / empty / whitespace', () => {
    for (const v of [undefined, '', '   '] as const) {
      expect(formatMachineBadgeTitle({ machineName: v, mode: 'fdm' })).toBe(
        'Current machine: None \u2014 Click to change'
      )
    }
  })

  it('uses U+2014 EM DASH as the separator (NOT U+2013 EN DASH or hyphen)', () => {
    const out = formatMachineBadgeTitle({
      machineName: 'Creality K2 Plus',
      mode: 'fdm'
    })
    expect(out).toContain('\u2014')
    expect(out).not.toContain('\u2013')
    // Hyphen-minus surrounded by spaces would imply we forgot the em-dash.
    expect(out).not.toMatch(/ - /)
  })

  it('does not vary with mode (mode is not part of the tooltip contract)', () => {
    const titles = allModes.map((mode) =>
      formatMachineBadgeTitle({ machineName: 'M', mode })
    )
    expect(new Set(titles).size).toBe(1)
  })
})

describe('formatMachineBadgeAriaLabel -- screen-reader contract [ID-0152]', () => {
  it('combines action verb + name + human-readable mode for FDM', () => {
    expect(
      formatMachineBadgeAriaLabel({
        machineName: 'Creality K2 Plus',
        mode: 'fdm'
      })
    ).toBe('Change active machine \u2014 currently Creality K2 Plus (FDM Printer)')
  })

  it('renders the CNC 4-Axis mode label exactly (NOT the glyph)', () => {
    const out = formatMachineBadgeAriaLabel({
      machineName: 'Makera Carvera',
      mode: 'cnc_4axis'
    })
    expect(out).toBe('Change active machine \u2014 currently Makera Carvera (CNC 4-Axis)')
    // The icon glyphs (U+1F5A8 etc.) MUST NOT appear -- they are decorative.
    expect(out).not.toContain('\u{1F5A8}')
    expect(out).not.toContain('\u21BB')
    expect(out).not.toContain('\u229E')
  })

  it('uses the empty-state phrasing when no machine is loaded', () => {
    expect(
      formatMachineBadgeAriaLabel({ machineName: null, mode: 'cnc_2d' })
    ).toBe('Set active machine \u2014 CNC Standard mode')
  })

  it('treats whitespace-only names as empty (delegates to trim)', () => {
    for (const v of [undefined, '', '   ', '\t'] as const) {
      expect(
        formatMachineBadgeAriaLabel({ machineName: v, mode: 'cnc_3d' })
      ).toBe('Set active machine \u2014 CNC 3D mode')
    }
  })

  it('trims surrounding whitespace before quoting the machine name', () => {
    expect(
      formatMachineBadgeAriaLabel({
        machineName: '  Laguna Swift 5x10  ',
        mode: 'cnc_2d'
      })
    ).toBe('Change active machine \u2014 currently Laguna Swift 5x10 (CNC Standard)')
  })

  it('uses U+2014 EM DASH as the separator (matches the tooltip)', () => {
    const out = formatMachineBadgeAriaLabel({
      machineName: 'X',
      mode: 'fdm'
    })
    expect(out).toContain('\u2014')
    expect(out).not.toContain('\u2013')
  })

  it('emits the action verb (Change | Set) so SR users hear the affordance, not just the state', () => {
    // Per WAI-ARIA: an icon-only button should announce what activating
    // it does. Pre-Cycle-61 the button announced nothing (no aria-label,
    // visible content was the decorative MODE_ICONS glyph).
    expect(
      formatMachineBadgeAriaLabel({ machineName: 'K2', mode: 'fdm' })
    ).toMatch(/^Change /)
    expect(
      formatMachineBadgeAriaLabel({ machineName: null, mode: 'fdm' })
    ).toMatch(/^Set /)
  })

  it('covers all five MachineUIMode values without throwing', () => {
    const allModes: readonly MachineUIMode[] = [
      'fdm', 'cnc_2d', 'cnc_3d', 'cnc_4axis', 'cnc_5axis'
    ] as const
    for (const mode of allModes) {
      const withName = formatMachineBadgeAriaLabel({ machineName: 'm', mode })
      const withoutName = formatMachineBadgeAriaLabel({ machineName: null, mode })
      expect(withName).toMatch(/^Change active machine \u2014 currently m \(/)
      expect(withoutName).toMatch(/^Set active machine \u2014 .+ mode$/)
    }
  })
})

describe('helper integration -- Safety Rule 2 byte-identical visual surface [ID-0152]', () => {
  it('formatMachineBadgeLabel(name) === sessionMachine?.name ?? "No machine"', () => {
    // Mirrors the inline expression at ShopApp.tsx pre-Cycle-61:
    //   {MODE_ICONS[mode]} {sessionMachine?.name ?? 'No machine'}
    const name: string | null | undefined = 'Creality K2 Plus'
    expect(formatMachineBadgeLabel(name)).toBe(name ?? 'No machine')
    const empty: string | null | undefined = null
    expect(formatMachineBadgeLabel(empty)).toBe(empty ?? 'No machine')
  })

  it('formatMachineBadgeTitle parity with pre-Cycle-61 template literal', () => {
    // Pre-Cycle-61 template:
    //   `Current machine: ${sessionMachine?.name ?? 'None'} \u2014 Click to change`
    const name: string | null | undefined = 'Makera Carvera'
    const expectedLegacy = `Current machine: ${name ?? 'None'} \u2014 Click to change`
    expect(formatMachineBadgeTitle({ machineName: name, mode: 'cnc_4axis' })).toBe(
      expectedLegacy
    )
    const empty: string | null | undefined = null
    const expectedLegacyEmpty = `Current machine: ${empty ?? 'None'} \u2014 Click to change`
    expect(formatMachineBadgeTitle({ machineName: empty, mode: 'cnc_4axis' })).toBe(
      expectedLegacyEmpty
    )
  })
})
