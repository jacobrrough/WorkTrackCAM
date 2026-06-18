/**
 * FirstRunOnboarding — first-run picker tests.
 *
 * The new-shell replacement for the deleted FirstLaunchWizard's first-run
 * trigger. Per CLAUDE.md My-Shop-Only mode it offers exactly the four starter
 * choices the wizard did (the three target machines + "Start a parametric
 * design") and CONSUMES the surviving wizard contract/IPC.
 *
 * Test strategy mirrors the sibling new-shell pins (`AppShell.my-shop.test.ts`,
 * `DesignWorkspaceHost.test.tsx`): the project's vitest runs in a node env with
 * NO DOM, so click handlers can't fire under `renderToStaticMarkup`. We therefore
 *   1. assert the RENDER output (visible when not onboarded; the four options;
 *      the Skip control) via `renderToStaticMarkup`;
 *   2. unit-test the PURE seams the click handlers delegate to
 *      (`resolveOnboardingMachine`, `onboardingEscapeKeydownHandler`,
 *      `ONBOARDING_OPTIONS`); and
 *   3. SOURCE-PIN the contract wiring (each option's IPC call + the flag
 *      persistence on every exit path) so the consume-don't-reimplement contract
 *      can't silently drift.
 * The host-level "hidden when onboarded" gate is proven in `AppShell.onboarding.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { MachineProfile } from '../../../shared/machine-schema'
import { WIZARD_MACHINE_TO_CAD_SAMPLE } from '../../../shared/first-launch-wizard-contract'
import {
  FirstRunOnboarding,
  ONBOARDING_OPTIONS,
  onboardingEscapeKeydownHandler,
  resolveOnboardingMachine
} from '../FirstRunOnboarding'

const SRC = readFileSync(join(__dirname, '..', 'FirstRunOnboarding.tsx'), 'utf-8')

// ── window.fab + document shims ──────────────────────────────────────────────
// The component reads `window.fab` inside its click/effect handlers (none of
// which run under renderToStaticMarkup) and registers a document-level keydown
// listener in a useEffect (also inert in SSR). Both globals must resolve to a
// defined object so the module-level `fab` accessor / effect-cleanup typing path
// never touches `undefined` while the test module loads.
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) gAsRecord['window'] = globalThis
if (gAsRecord['fab'] === undefined) gAsRecord['fab'] = {}
;(gAsRecord['window'] as Record<string, unknown>)['fab'] = gAsRecord['fab']

// ── Fixtures ─────────────────────────────────────────────────────────────────

function machine(id: string, name: string): MachineProfile {
  // Minimal MachineProfile-shaped fixture; only `id` + `name` are read by the
  // picker. Cast keeps the fixture terse without an `any`.
  return { id, name } as unknown as MachineProfile
}

const ALL_MACHINES: readonly MachineProfile[] = [
  machine('creality-k2-plus', 'Creality K2 Plus'),
  machine('laguna-swift-5x10', 'Laguna Swift 5×10'),
  machine('makera-carvera-4axis', 'Makera Carvera (4-axis)')
]

function renderPicker(machines: readonly MachineProfile[]): string {
  return renderToStaticMarkup(
    createElement(FirstRunOnboarding, {
      machines,
      onSelectMachine: vi.fn(),
      onStartDesign: vi.fn(),
      onDismiss: vi.fn()
    })
  )
}

// ── 1. Render output (visible when not onboarded) ────────────────────────────

describe('FirstRunOnboarding — render', () => {
  it('renders the accessible modal dialog when mounted (host gates on the flag)', () => {
    const html = renderPicker(ALL_MACHINES)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('data-testid="first-run-onboarding"')
    // Labelled by its title for screen readers.
    expect(html).toContain('aria-labelledby="fro-title"')
    expect(html).toContain('id="fro-title"')
  })

  it('renders all four starter options (3 machines + parametric design)', () => {
    const html = renderPicker(ALL_MACHINES)
    expect(html).toContain('Creality K2 Plus')
    expect(html).toContain('Laguna Swift 5×10')
    expect(html).toContain('Makera Carvera')
    expect(html).toContain('Start a parametric design')
    // One actionable card per option.
    expect(html).toContain('data-testid="fro-option-creality-k2-plus-machine"')
    expect(html).toContain('data-testid="fro-option-laguna-swift-5x10-machine"')
    expect(html).toContain('data-testid="fro-option-makera-carvera-4axis-machine"')
    expect(html).toContain('data-testid="fro-option-creality-k2-plus-design"')
  })

  it('renders a Skip control (WCAG escape route) and every button is type=button', () => {
    const html = renderPicker(ALL_MACHINES)
    expect(html).toContain('data-testid="fro-skip"')
    expect(html).toContain('Skip for now')
    // No <button> may default to submit (reload footgun). Count tags vs. typed tags.
    const total = (html.match(/<button/g) ?? []).length
    const typed = (html.match(/<button[^>]*type="button"/g) ?? []).length
    expect(total).toBeGreaterThanOrEqual(5) // 4 options + Skip
    expect(typed).toBe(total)
  })

  it('disables a machine card whose profile is not installed (half-seeded library)', () => {
    // Only K2 installed → Laguna + Carvera cards are disabled; design card stays enabled.
    const html = renderPicker([machine('creality-k2-plus', 'Creality K2 Plus')])
    expect(html).toContain('Not installed — add it from Settings')
    // The design card never depends on a machine being installed.
    expect(html).toContain('data-testid="fro-option-creality-k2-plus-design"')
    expect(html).toContain('fro-option--disabled')
  })

  it('shows the bundled CAD starter name on the design card (consumes the contract map)', () => {
    const html = renderPicker(ALL_MACHINES)
    // The K2 design card advertises the L-Bracket starter from the contract.
    expect(html).toContain(WIZARD_MACHINE_TO_CAD_SAMPLE['creality-k2-plus'].designName)
  })
})

// ── 2. Pure seams (option→profile mapping, Escape, option set) ───────────────

describe('FirstRunOnboarding — pure seams', () => {
  it('resolveOnboardingMachine maps a wizard id to its installed profile', () => {
    expect(resolveOnboardingMachine('laguna-swift-5x10', ALL_MACHINES)?.id).toBe('laguna-swift-5x10')
  })

  it('resolveOnboardingMachine returns null when the machine is not installed', () => {
    expect(resolveOnboardingMachine('makera-carvera-4axis', [])).toBeNull()
  })

  it('onboardingEscapeKeydownHandler fires onEscape for a bare Escape only', () => {
    const onEscape = vi.fn()
    const h = onboardingEscapeKeydownHandler(onEscape)
    h({ key: 'Escape', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false } as KeyboardEvent)
    expect(onEscape).toHaveBeenCalledTimes(1)
  })

  it('onboardingEscapeKeydownHandler ignores non-Escape keys and modified Escape', () => {
    const onEscape = vi.fn()
    const h = onboardingEscapeKeydownHandler(onEscape)
    h({ key: 'Enter', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false } as KeyboardEvent)
    h({ key: 'Escape', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false } as KeyboardEvent)
    h({ key: 'Escape', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false } as KeyboardEvent)
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('ONBOARDING_OPTIONS is locked to the three target machines + the design card', () => {
    expect(ONBOARDING_OPTIONS).toHaveLength(4)
    const machineIds = ONBOARDING_OPTIONS.filter((o) => o.kind === 'machine').map((o) => o.machineId)
    expect(machineIds).toEqual(['creality-k2-plus', 'laguna-swift-5x10', 'makera-carvera-4axis'])
    const designCards = ONBOARDING_OPTIONS.filter((o) => o.kind === 'design')
    expect(designCards).toHaveLength(1)
    // The design card must point at a machine that has a bundled CAD sample.
    expect(WIZARD_MACHINE_TO_CAD_SAMPLE[designCards[0]!.machineId]).toBeDefined()
    // No machine outside My-Shop-Only mode leaks in.
    expect(machineIds).not.toContain('makera-carvera-3axis')
  })
})

// ── 3. Contract wiring (source pins — handlers can't fire in node-env) ───────

describe('FirstRunOnboarding — contract wiring (consume, do not reimplement)', () => {
  it('imports the wizard contract + the fab bridge (no ad-hoc backend)', () => {
    expect(SRC).toContain("from '../../shared/first-launch-wizard-contract'")
    expect(SRC).toContain("import { fab } from '../src/shop-types'")
    expect(SRC).toContain('WIZARD_MACHINE_TO_CAD_SAMPLE')
  })

  it('the design option READS the bundled CAD sample via wizard:readCadSample', () => {
    expect(SRC).toContain('fab().wizardReadCadSample({ machineId })')
  })

  it('every exit path persists hasCompletedOnboarding via settings:set', () => {
    expect(SRC).toContain("fab().settingsSet({ hasCompletedOnboarding: true })")
    // Shared persistence helper used by machine-pick, design, skip, AND Escape.
    expect(SRC).toContain('async function persistOnboardingComplete()')
    expect(SRC).toContain('void persistOnboardingComplete()')
  })

  it('Skip AND Escape both dismiss through the same flag-persisting path', () => {
    // Skip button wires to handleDismiss; Escape wires the same handler.
    expect(SRC).toContain('onClick={handleDismiss}')
    expect(SRC).toContain('onboardingEscapeKeydownHandler(handleDismiss)')
    expect(SRC).toContain("document.addEventListener('keydown', handler)")
    expect(SRC).toContain("document.removeEventListener('keydown', handler)")
  })

  it('does NOT persist the flag when a design-sample read fails (operator never started)', () => {
    // On the failure branch we surface the error and bail BEFORE persisting.
    expect(SRC).toContain('Couldn')
    expect(SRC).toContain('load the starter design')
    // The persist+handoff only runs after the ok-guard.
    expect(SRC).toContain('await persistOnboardingComplete()')
    expect(SRC).toContain('onStartDesign({')
  })
})
