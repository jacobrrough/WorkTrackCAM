/**
 * AssemblyView — per-row JOINT LIMITS authoring UI (this cycle's wiring).
 *
 * The schema (`AssemblyComponent.jointLimits`) + the solver clamps were already
 * done; there was no UI. These pins prove the authoring surface:
 *
 *   (A) RENDER PINS — a "Limits" toggle renders only for joint kinds with a
 *       limitable DOF (revolute / slider / cylindrical / planar / universal /
 *       ball) and NOT for rigid / no-joint rows; the expandable editor (seeded
 *       open via the `initialLimitsOpenPartId` render-pin escape hatch, mirroring
 *       `initialMotionPoses` / `initialSelectedPartId`) shows a min..max numeric
 *       field per DOF with a unit suffix and Apply / Clear actions; an authored
 *       row shows a compact summary chip.
 *   (B) SOURCE PINS — the click/effect wiring the static renderer cannot fire:
 *       the editor pushes its edit through the SAME solved-transforms host seam a
 *       solve uses (one round-trip → persist), the solve + simulate inputs both
 *       thread the row's authored `jointLimits`, and `applySolvedTransforms`
 *       folds the limits rider onto the row.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AssemblyView, applySolvedTransforms, type AssemblyPart } from '../AssemblyView'

// ── window.fab shim (matches AssemblyView.test.tsx) ─────────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const revolutePart = (overrides: Partial<AssemblyPart> = {}): AssemblyPart => ({
  id: 'p1',
  name: 'Hinge',
  handle: 'script:abcdef',
  joint: 'revolute',
  ...overrides,
})

const rigidPart: AssemblyPart = {
  id: 'p2',
  name: 'Base',
  handle: 'script:fedcba',
  joint: 'rigid',
}

// ── (A) Render pins ─────────────────────────────────────────────────────────

describe('AssemblyView — joint-limits toggle visibility', () => {
  it('renders a Limits toggle for a revolute row', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts: [revolutePart()] }))
    expect(html).toContain('data-testid="design-assembly-part-p1-limits-toggle"')
    expect(html).toContain('>Limits</button>')
  })

  it('does NOT render a Limits toggle for a rigid row (no limitable DOF)', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts: [rigidPart] }))
    expect(html).not.toContain('design-assembly-part-p2-limits-toggle')
  })

  it('does NOT render a Limits toggle for a row with no joint assigned', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts: [{ id: 'p3', name: 'Free', handle: 'script:x' }] })
    )
    expect(html).not.toContain('design-assembly-part-p3-limits-toggle')
  })
})

describe('AssemblyView — joint-limits editor (seeded open)', () => {
  it('renders one min..max field with the ° suffix for a revolute joint', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: [revolutePart()],
        initialLimitsOpenPartId: 'p1',
      })
    )
    expect(html).toContain('data-testid="design-assembly-part-p1-limits"')
    expect(html).toContain('data-testid="design-assembly-part-p1-limits-scalarMinDeg"')
    expect(html).toContain('data-testid="design-assembly-part-p1-limits-scalarMaxDeg"')
    expect(html).toContain('data-testid="design-assembly-part-p1-limits-apply"')
    expect(html).toContain('data-testid="design-assembly-part-p1-limits-clear"')
    // Unit suffix reads ° for a degree DOF.
    expect(html).toContain('°')
    // aria-expanded reflects the open editor.
    expect(html).toMatch(
      /data-testid="design-assembly-part-p1-limits-toggle"[^>]*aria-expanded="true"/
    )
  })

  it('renders BOTH DOF (slide mm + spin deg) for a cylindrical joint', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: [revolutePart({ id: 'c1', name: 'Pin', joint: 'cylindrical' })],
        initialLimitsOpenPartId: 'c1',
      })
    )
    expect(html).toContain('data-testid="design-assembly-part-c1-limits-slideMinMm"')
    expect(html).toContain('data-testid="design-assembly-part-c1-limits-slideMaxMm"')
    expect(html).toContain('data-testid="design-assembly-part-c1-limits-spinMinDeg"')
    expect(html).toContain('data-testid="design-assembly-part-c1-limits-spinMaxDeg"')
  })

  it('seeds the draft inputs from the row current jointLimits', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: [revolutePart({ jointLimits: { scalarMinDeg: -90, scalarMaxDeg: 90 } })],
        initialLimitsOpenPartId: 'p1',
      })
    )
    // Controlled inputs carry the seeded values.
    expect(html).toMatch(
      /data-testid="design-assembly-part-p1-limits-scalarMinDeg"[^>]*value="-90"/
    )
    expect(html).toMatch(
      /data-testid="design-assembly-part-p1-limits-scalarMaxDeg"[^>]*value="90"/
    )
  })

  it('leaves the editor closed by default (no initialLimitsOpenPartId)', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts: [revolutePart()] }))
    expect(html).not.toContain('data-testid="design-assembly-part-p1-limits"')
    expect(html).toMatch(
      /data-testid="design-assembly-part-p1-limits-toggle"[^>]*aria-expanded="false"/
    )
  })

  it('disables Apply / Clear when the host has not wired onSolvedTransforms', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: [revolutePart()],
        initialLimitsOpenPartId: 'p1',
        // no onSolvedTransforms → the edit has nowhere to persist.
      })
    )
    // React renders a boolean `disabled={true}` as the bare `disabled=""` attr.
    expect(html).toMatch(/data-testid="design-assembly-part-p1-limits-apply"[^>]*\bdisabled=""/)
    expect(html).toMatch(/data-testid="design-assembly-part-p1-limits-clear"[^>]*\bdisabled=""/)
  })

  it('enables Apply / Clear once onSolvedTransforms is wired', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: [revolutePart()],
        initialLimitsOpenPartId: 'p1',
        onSolvedTransforms: vi.fn(),
      })
    )
    // No bare `disabled` attr (aria-disabled="false" is the only "disabled"
    // substring, so match the boolean attr specifically).
    expect(html).not.toMatch(/data-testid="design-assembly-part-p1-limits-apply"[^>]*\bdisabled=""/)
    expect(html).toMatch(
      /data-testid="design-assembly-part-p1-limits-apply"[^>]*aria-disabled="false"/
    )
  })
})

describe('AssemblyView — authored-limits summary chip', () => {
  it('shows the compact summary for a row with authored limits', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts: [revolutePart({ jointLimits: { scalarMinDeg: -90, scalarMaxDeg: 90 } })],
      })
    )
    expect(html).toContain('data-testid="design-assembly-part-p1-limits-summary"')
    expect(html).toContain('-90..90°')
  })

  it('hides the summary chip when the row has no authored limits', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts: [revolutePart()] }))
    expect(html).not.toContain('design-assembly-part-p1-limits-summary')
  })

  it('does not emit console errors rendering the limits editor', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderToStaticMarkup(
        createElement(AssemblyView, {
          parts: [revolutePart({ jointLimits: { scalarMinDeg: -45, scalarMaxDeg: 45 } })],
          initialLimitsOpenPartId: 'p1',
          onSolvedTransforms: vi.fn(),
        })
      )
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

// ── (B) applySolvedTransforms — the limits rider (pure apply-back) ──────────

describe('applySolvedTransforms — folds the jointLimits rider onto the row', () => {
  const base: readonly AssemblyPart[] = [revolutePart()]

  it('an object rider REPLACES the row limits (and keeps the pose)', () => {
    const next = applySolvedTransforms(base, [
      {
        id: 'p1',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        jointLimits: { scalarMinDeg: -30, scalarMaxDeg: 30 },
      },
    ])
    expect(next[0]!.jointLimits).toEqual({ scalarMinDeg: -30, scalarMaxDeg: 30 })
  })

  it('a null rider CLEARS to the explicit empty object (persist replaces on-disk limits)', () => {
    const seeded: readonly AssemblyPart[] = [
      revolutePart({ jointLimits: { scalarMinDeg: -90, scalarMaxDeg: 90 } }),
    ]
    const next = applySolvedTransforms(seeded, [
      {
        id: 'p1',
        transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 },
        jointLimits: null,
      },
    ])
    // Explicit {} — NOT undefined — so the persist seam overwrites prior limits.
    expect(next[0]!.jointLimits).toEqual({})
  })

  it('an UNDEFINED rider (a plain solve) leaves the row limits untouched', () => {
    const seeded: readonly AssemblyPart[] = [
      revolutePart({ jointLimits: { scalarMinDeg: -90, scalarMaxDeg: 90 } }),
    ]
    const next = applySolvedTransforms(seeded, [
      { id: 'p1', transform: { x: 1, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } },
    ])
    expect(next[0]!.jointLimits).toEqual({ scalarMinDeg: -90, scalarMaxDeg: 90 })
  })
})

// ── (C) Source pins (click/effect wiring — never fires under SSR) ───────────

describe('AssemblyView — joint-limits wiring source pins', () => {
  const src = readFileSync(join(__dirname, '..', 'AssemblyView.tsx'), 'utf-8')

  it('the limits edit rides the SAME solved-transforms host seam a solve uses (one round-trip)', () => {
    // pushLimitsPatch dispatches through onSolvedTransforms with the limits rider.
    expect(src).toContain('const pushLimitsPatch = useCallback(')
    expect(src).toContain('jointLimits: limits ?? null')
  })

  it('the SOLVE input threads the row authored jointLimits into the solver', () => {
    expect(src).toContain(
      '...(part.jointLimits !== undefined ? { jointLimits: part.jointLimits } : {})'
    )
  })

  it('the SIMULATE input threads the authored jointLimits so the sweep uses the real range', () => {
    // The LIMIT COUPLING gap is closed — the simulate input carries jointLimits.
    expect(src).toMatch(/LIMIT COUPLING \(closed\)[\s\S]{0,200}part\.jointLimits/)
  })

  it('the playback read-out is phrased over the authored range (firstDrivenJointRange)', () => {
    expect(src).toContain('firstDrivenJointRange(parts)')
    expect(src).toContain('drivenJointRange?.kind ?? null')
  })

  it('applying limits exits any open playback (stale poses must not animate a fresh range)', () => {
    expect(src).toMatch(/const pushLimitsPatch = useCallback\([\s\S]{0,900}exitPlayback\(\)/)
  })

  it('Apply validates through the pure parser before pushing', () => {
    expect(src).toContain('parseJointLimitsDraft(part.joint, limitsDraft)')
  })
})
