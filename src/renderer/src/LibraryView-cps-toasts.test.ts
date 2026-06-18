/**
 * buildCpsImportToasts — CPS-import toast builder contract.
 *
 * `importCps` in LibraryView.tsx delegates to this pure helper, then raises
 * each returned toast through `onToast`. Testing the helper directly (rather
 * than rendering LibraryView + mocking `fab`) matches the repo's
 * extract-pure-helper test convention (see toast-clipboard.test.ts,
 * env-action-strip-helpers.test.ts) and keeps the suite in the `node` env.
 *
 * Contract:
 *   - Always returns the "Imported ..." summary toast (kind 'ok').
 *   - When the summary carries a fiveAxisFallback warning, ALSO returns a
 *     'warn' toast carrying that warning's message — so the operator is told
 *     their 5-axis features were dropped.
 *   - When there is no warning, returns ONLY the summary toast.
 */
import { describe, expect, it } from 'vitest'
import { buildCpsImportToasts } from './LibraryView'
import type { MachineProfile } from './shop-types'
import type { CpsImportSummary } from '../../main/machine-cps-import'

const fakeProfile = (overrides: Partial<MachineProfile> = {}): MachineProfile => ({
  id: 'imported',
  name: 'Imported CPS post',
  kind: 'cnc',
  workAreaMm: { x: 300, y: 300, z: 120 },
  maxFeedMmMin: 2000,
  postTemplate: 'cnc_generic_mm.hbs',
  dialect: 'generic_mm',
  ...overrides
})

const baseDetected: CpsImportSummary['detected'] = {
  name: true,
  workArea: false,
  maxFeed: false,
  dialect: true,
  axisCount: false
}

describe('buildCpsImportToasts', () => {
  it('returns only the summary toast when there are no warnings', () => {
    const summary: CpsImportSummary = {
      profile: fakeProfile({ name: 'Bench Mill' }),
      detected: baseDetected
    }
    const toasts = buildCpsImportToasts(summary)
    expect(toasts).toHaveLength(1)
    expect(toasts[0].kind).toBe('ok')
    expect(toasts[0].msg).toContain('Imported "Bench Mill"')
  })

  it('ignores an undefined warnings field (backward compatible)', () => {
    const summary = {
      profile: fakeProfile(),
      detected: baseDetected
    } as CpsImportSummary
    expect(() => buildCpsImportToasts(summary)).not.toThrow()
    expect(buildCpsImportToasts(summary)).toHaveLength(1)
  })

  it('adds a warn toast when a fiveAxisFallback warning is present', () => {
    const summary: CpsImportSummary = {
      profile: fakeProfile({ name: 'Fanuc 5X' }),
      detected: { ...baseDetected, axisCount: true },
      warnings: [{
        code: 'fiveAxisFallback',
        from: '5axis',
        to: 'cnc_generic_mm.hbs',
        message:
          '5-axis dialect detected → 3-axis generic fallback; ' +
          '5-axis features will not be in the output.'
      }]
    }
    const toasts = buildCpsImportToasts(summary)
    expect(toasts).toHaveLength(2)
    // Summary toast first, warning toast second.
    expect(toasts[0].kind).toBe('ok')
    const warn = toasts[1]
    expect(warn.kind).toBe('warn')
    expect(warn.msg).toContain('5-axis')
    expect(warn.msg).toContain('will not be in the output')
  })

  it('warn toast message is exactly the warning message (passed through verbatim)', () => {
    const message = '5-axis dialect detected → 3-axis generic fallback; ' +
      '5-axis features will not be in the output.'
    const summary: CpsImportSummary = {
      profile: fakeProfile(),
      detected: baseDetected,
      warnings: [{ code: 'fiveAxisFallback', from: '5axis', to: 'cnc_generic_mm.hbs', message }]
    }
    const warn = buildCpsImportToasts(summary).find((t) => t.kind === 'warn')
    expect(warn?.msg).toBe(message)
  })
})
