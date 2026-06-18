/**
 * AssemblyMatePanel — render-pin for the V1 mate-creation surface.
 *
 * Mirrors the `AssemblyView.test.tsx` convention: node-env vitest ships no
 * DOM, so we exercise the static `renderToStaticMarkup` path. `useState`
 * initialisers run during SSR but the bridge (`window.fab.cad.addAssemblyMate`)
 * is only touched inside the Solve click handler, which `renderToStaticMarkup`
 * never fires — keeping the suite hermetic (no IPC, no jsdom).
 *
 * The form-state → request and outcome → badge logic is unit-tested
 * exhaustively in `../assembly-mate-form.test.ts`; this file pins the surface
 * (testids, per-kind input selection, disabled-state, badge wording).
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssemblyMatePanel } from '../AssemblyMatePanel'
import type { AssemblyPart } from '../AssemblyView'
import {
  DEFERRED_MATE_KINDS,
  OFFERED_MATE_KINDS,
  makeMateFormDraft,
  type MateBadgeView,
} from '../assembly-mate-form'

// window.fab shim — only consulted inside the click handler (never in SSR),
// but installed so any future render-time bridge read fails loudly instead of
// crashing on a missing global.
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const part = (id: string, name: string): AssemblyPart => ({ id, name, handle: `script:${id}` })
const TWO_PARTS: readonly AssemblyPart[] = [part('p1', 'Bracket'), part('p2', 'Plate')]

/** A driven part that PASSES the rotational gate: non-grounded revolute hinge. */
const revolutePart = (id: string, name: string): AssemblyPart => ({
  id,
  name,
  handle: `script:${id}`,
  joint: 'revolute',
  grounded: false,
})
/** Part 1 reference (grounded base) + Part 2 driven revolute hinge — the solver's converging case. */
const REVOLUTE_PARTS: readonly AssemblyPart[] = [
  { ...part('p1', 'Base'), grounded: true },
  revolutePart('p2', 'Arm'),
]

describe('AssemblyMatePanel — surface', () => {
  it('renders the root testid + BEM class', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: TWO_PARTS, assemblyHandle: 'asm:1' }),
    )
    expect(html).toContain('data-testid="assembly-mate-panel"')
    expect(html).toContain('assembly-mate-panel')
  })

  it('renders the kind picker + both part selects when two parts exist', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: TWO_PARTS, assemblyHandle: 'asm:1' }),
    )
    expect(html).toContain('data-testid="assembly-mate-kind"')
    expect(html).toContain('data-testid="assembly-mate-part1"')
    expect(html).toContain('data-testid="assembly-mate-part2"')
  })

  it('shows the "need a second part" hint when fewer than two parts exist', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: [part('solo', 'Solo')],
        assemblyHandle: 'asm:1',
      }),
    )
    expect(html).toContain('data-testid="assembly-mate-need-parts"')
    // The form (kind picker) must NOT render in this branch.
    expect(html).not.toContain('data-testid="assembly-mate-kind"')
  })
})

describe('AssemblyMatePanel — per-kind vector inputs', () => {
  it('renders point1 + point2 cells for a point mate (the default)', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: TWO_PARTS, assemblyHandle: 'asm:1' }),
    )
    for (const i of [0, 1, 2]) {
      expect(html).toContain(`data-testid="assembly-mate-point1-${i}"`)
      expect(html).toContain(`data-testid="assembly-mate-point2-${i}"`)
    }
    // A point mate must NOT show axis / normal cells.
    expect(html).not.toContain('data-testid="assembly-mate-axis1-0"')
    expect(html).not.toContain('data-testid="assembly-mate-normal1-0"')
  })

  it('renders axis1 + axis2 cells when the draft kind is axis', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: TWO_PARTS,
        assemblyHandle: 'asm:1',
        initialDraft: { ...makeMateFormDraft('p1', 'p2'), kind: 'axis' },
      }),
    )
    expect(html).toContain('data-testid="assembly-mate-axis1-0"')
    expect(html).toContain('data-testid="assembly-mate-axis2-2"')
    expect(html).not.toContain('data-testid="assembly-mate-point1-0"')
  })

  it('renders point + normal cells for both sides when the draft kind is plane', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: TWO_PARTS,
        assemblyHandle: 'asm:1',
        initialDraft: { ...makeMateFormDraft('p1', 'p2'), kind: 'plane' },
      }),
    )
    expect(html).toContain('data-testid="assembly-mate-point1-0"')
    expect(html).toContain('data-testid="assembly-mate-normal1-0"')
    expect(html).toContain('data-testid="assembly-mate-point2-0"')
    expect(html).toContain('data-testid="assembly-mate-normal2-0"')
  })
})

describe('AssemblyMatePanel — Solve button gating', () => {
  it('disables Solve when no assembly handle is available', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: TWO_PARTS, assemblyHandle: null }),
    )
    expect(html).toMatch(/data-testid="assembly-mate-solve"[^>]*disabled/)
  })

  it('enables Solve when two parts + a handle are present', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: TWO_PARTS, assemblyHandle: 'asm:1' }),
    )
    const match = html.match(/data-testid="assembly-mate-solve"[^>]*>/)
    expect(match).not.toBeNull()
    const tagWithoutAria = match?.[0].replace(/aria-disabled="[^"]*"/, '') ?? ''
    expect(/[\s"]disabled(=|>|\s|$)/.test(tagWithoutAria)).toBe(false)
  })
})

describe('AssemblyMatePanel — solver badge', () => {
  it('renders the idle badge by default', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: TWO_PARTS, assemblyHandle: 'asm:1' }),
    )
    expect(html).toContain('data-testid="assembly-mate-badge"')
    expect(html).toContain('No mate solved')
    expect(html).toContain('design-assembly__solver-badge--not-solved')
  })

  it('renders a green converged badge when seeded with a solved badge', () => {
    const seeded: MateBadgeView = { label: 'Mate solved (10 × 5 × 2 mm)', status: 'solved' }
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: TWO_PARTS,
        assemblyHandle: 'asm:1',
        initialBadge: seeded,
      }),
    )
    expect(html).toContain('design-assembly__solver-badge--converged')
    expect(html).toContain('Mate solved (10 × 5 × 2 mm)')
    expect(html).toContain('data-status="solved"')
  })

  it('renders a red over-constrained badge + detail line when seeded', () => {
    const seeded: MateBadgeView = {
      label: 'Over-constrained',
      status: 'over-constrained',
      detail: 'Loosen or remove a constraint and retry.',
    }
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: TWO_PARTS,
        assemblyHandle: 'asm:1',
        initialBadge: seeded,
      }),
    )
    expect(html).toContain('design-assembly__solver-badge--over-constrained')
    expect(html).toContain('Over-constrained')
    expect(html).toContain('data-testid="assembly-mate-badge-detail"')
    expect(html).toContain('Loosen or remove a constraint and retry.')
  })

  it('renders a red error badge when seeded with a generic error', () => {
    const seeded: MateBadgeView = { label: 'Mate failed: bad_params', status: 'error' }
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: TWO_PARTS,
        assemblyHandle: 'asm:1',
        initialBadge: seeded,
      }),
    )
    expect(html).toContain('design-assembly__solver-badge--error')
    expect(html).toContain('Mate failed: bad_params')
  })
})

describe('AssemblyMatePanel — no console errors on render', () => {
  it('does not emit console errors/warnings on a typical render', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderToStaticMarkup(
        createElement(AssemblyMatePanel, {
          parts: TWO_PARTS,
          assemblyHandle: 'asm:1',
          onMateAdded: vi.fn(),
          onToast: vi.fn(),
        }),
      )
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

// ── Mate-kind picker: SSOT-derived options + the rotational gate ──────────────
//
// HONESTY PIN (updated Cycle 276): the picker offers EXACTLY the engine's
// OFFERED_MATE_KINDS (the single source of truth) — now SIX kinds, including the
// once-deferred rotational `angle` / `tangent`. Those two are no longer withheld;
// instead they are GATED: their <option> renders for every part (SSOT-complete)
// but is DISABLED unless the driven part (Part 2) is a non-grounded revolute
// hinge, the only case the solver converges. These pins fail loudly if the picker
// drifts from the SSOT, drops a kind, or stops gating the rotational kinds.

describe('AssemblyMatePanel — kind picker reflects the solver-backed SSOT', () => {
  it('renders one <option> per OFFERED_MATE_KIND (all six, incl. angle/tangent)', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: REVOLUTE_PARTS, assemblyHandle: 'asm:1' }),
    )
    for (const kind of OFFERED_MATE_KINDS) {
      expect(html).toContain(`value="${kind}"`)
    }
    // The rotational kinds are now part of the SSOT — explicitly present.
    expect(OFFERED_MATE_KINDS).toContain('angle')
    expect(OFFERED_MATE_KINDS).toContain('tangent')
    expect(html).toContain('value="angle"')
    expect(html).toContain('value="tangent"')
  })

  it('DEFERRED_MATE_KINDS is now empty — nothing is withheld from the picker', () => {
    // The old "deferred coming-soon" surface is retired; angle/tangent are offered.
    expect(DEFERRED_MATE_KINDS).toEqual([])
  })

  it('DISABLES the angle/tangent options when the driven part is NOT a revolute hinge', () => {
    // TWO_PARTS has no joint → the gate fails → the rotational options carry
    // `disabled` (present for SSOT completeness, but not selectable).
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: TWO_PARTS, assemblyHandle: 'asm:1' }),
    )
    expect(html).toMatch(/<option value="angle"[^>]*disabled/)
    expect(html).toMatch(/<option value="tangent"[^>]*disabled/)
    // The positional kinds are never gated.
    expect(html).not.toMatch(/<option value="point"[^>]*disabled/)
    expect(html).not.toMatch(/<option value="distance"[^>]*disabled/)
  })

  it('ENABLES the angle/tangent options when the driven part IS a non-grounded revolute hinge', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: REVOLUTE_PARTS, assemblyHandle: 'asm:1' }),
    )
    expect(html).not.toMatch(/<option value="angle"[^>]*disabled/)
    expect(html).not.toMatch(/<option value="tangent"[^>]*disabled/)
  })

  it('renders the rotational-gate status note honestly per the driven part', () => {
    const gated = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: TWO_PARTS, assemblyHandle: 'asm:1' }),
    )
    expect(gated).toContain('data-testid="assembly-mate-rotational-gate"')
    expect(gated).toContain('angle / tangent')
    expect(gated).toMatch(/revolute/i)

    const enabled = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: REVOLUTE_PARTS, assemblyHandle: 'asm:1' }),
    )
    expect(enabled).toContain('data-testid="assembly-mate-rotational-gate"')
    expect(enabled).toMatch(/available/i)
  })
})

// ── Angle / tangent: axis-picker + degrees inputs (gated on a revolute part) ──

describe('AssemblyMatePanel — angle/tangent authoring inputs', () => {
  const angleDraft = () => ({ ...makeMateFormDraft('p1', 'p2'), kind: 'angle' as const })
  const tangentDraft = () => ({ ...makeMateFormDraft('p1', 'p2'), kind: 'tangent' as const })

  it('renders a cardinal axis picker per part AND the degrees input for an angle mate', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: REVOLUTE_PARTS,
        assemblyHandle: 'asm:1',
        initialDraft: angleDraft(),
      }),
    )
    expect(html).toContain('data-testid="assembly-mate-axis1-cardinal"')
    expect(html).toContain('data-testid="assembly-mate-axis2-cardinal"')
    // The degrees target is unique to the angle kind.
    expect(html).toContain('data-testid="assembly-mate-angle"')
    expect(html).toContain('Target angle (degrees)')
    // No free 3-vector cells for a rotational mate.
    expect(html).not.toContain('data-testid="assembly-mate-point1-0"')
    expect(html).not.toContain('data-testid="assembly-mate-axis1-0"')
  })

  it('renders the axis pickers but NO degrees input for a tangent mate', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: REVOLUTE_PARTS,
        assemblyHandle: 'asm:1',
        initialDraft: tangentDraft(),
      }),
    )
    expect(html).toContain('data-testid="assembly-mate-axis1-cardinal"')
    expect(html).toContain('data-testid="assembly-mate-axis2-cardinal"')
    // Tangent has no numeric target.
    expect(html).not.toContain('data-testid="assembly-mate-angle"')
  })

  it('the axis picker offers exactly x / y / z options', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: REVOLUTE_PARTS,
        assemblyHandle: 'asm:1',
        initialDraft: angleDraft(),
      }),
    )
    for (const ax of ['x', 'y', 'z']) {
      expect(html).toContain(`value="${ax}"`)
    }
  })

  it('ENABLES the submit for an angle mate with NO assembly handle (persist-only)', () => {
    // An angle mate folds straight to a Model-C constraint — no live B-rep.
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: REVOLUTE_PARTS,
        assemblyHandle: null,
        initialDraft: angleDraft(),
      }),
    )
    const match = html.match(/data-testid="assembly-mate-solve"[^>]*>/)
    expect(match).not.toBeNull()
    const tagWithoutAria = match?.[0].replace(/aria-disabled="[^"]*"/, '') ?? ''
    expect(/[\s"]disabled(=|>|\s|$)/.test(tagWithoutAria)).toBe(false)
    // Persist-only path labels the action "Add mate".
    expect(html).toContain('Add mate')
  })
})

// ── Distance kind: per-kind inputs + persist-only gating ──────────────────────

describe('AssemblyMatePanel — distance kind inputs', () => {
  const distanceDraft = () => ({ ...makeMateFormDraft('p1', 'p2'), kind: 'distance' as const })

  it('renders point1 + point2 cells AND the target-separation input for a distance mate', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: TWO_PARTS,
        assemblyHandle: 'asm:1',
        initialDraft: distanceDraft(),
      }),
    )
    for (const i of [0, 1, 2]) {
      expect(html).toContain(`data-testid="assembly-mate-point1-${i}"`)
      expect(html).toContain(`data-testid="assembly-mate-point2-${i}"`)
    }
    // The numeric distance-target field is unique to this kind.
    expect(html).toContain('data-testid="assembly-mate-value"')
    expect(html).toContain('Target separation (mm)')
    // A distance mate must NOT show axis / normal cells.
    expect(html).not.toContain('data-testid="assembly-mate-axis1-0"')
    expect(html).not.toContain('data-testid="assembly-mate-normal1-0"')
  })

  it('does NOT render the target-separation input for a point mate', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, { parts: TWO_PARTS, assemblyHandle: 'asm:1' }),
    )
    expect(html).not.toContain('data-testid="assembly-mate-value"')
  })

  it('ENABLES the submit for a distance mate even with NO assembly handle (persist-only)', () => {
    // A distance mate folds straight to a Model-C constraint — no live B-rep — so
    // it does not need a built assembly. The button stays usable when handle=null.
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: TWO_PARTS,
        assemblyHandle: null,
        initialDraft: distanceDraft(),
      }),
    )
    const match = html.match(/data-testid="assembly-mate-solve"[^>]*>/)
    expect(match).not.toBeNull()
    const tagWithoutAria = match?.[0].replace(/aria-disabled="[^"]*"/, '') ?? ''
    expect(/[\s"]disabled(=|>|\s|$)/.test(tagWithoutAria)).toBe(false)
    // Persist-only path labels the action "Add mate" (not "Solve mate").
    expect(html).toContain('Add mate')
  })

  it('still DISABLES the submit for a distance mate when only one part exists', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyMatePanel, {
        parts: [part('solo', 'Solo')],
        assemblyHandle: null,
        initialDraft: { ...makeMateFormDraft('solo', 'solo'), kind: 'distance' as const },
      }),
    )
    // Fewer than two parts → the "need a second part" hint, no form.
    expect(html).toContain('data-testid="assembly-mate-need-parts"')
  })
})
