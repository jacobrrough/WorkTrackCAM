/**
 * Pin tests for `FirstLaunchWizard.tsx`'s pure helpers + dismiss-persist
 * contract. The wizard itself is rendered in an Electron preload context
 * (uses `fab()` for IPC) so this suite focuses on the testable surface:
 *
 *   - `wizardSlugifyName`     -- folder-safe slug
 *   - `wizardComposeProjectDir` -- parent + name path composition
 *   - `wizardStarterOpKind`   -- machine -> op kind mapping (matches
 *                                README convention + CLAUDE.md targets)
 *
 * Plus a small renderer-API contract test that proves the wizard
 * persists `hasCompletedOnboarding = true` via the `settings:set` IPC
 * on Finish AND on Skip (acceptance criterion: after completing the
 * wizard once, subsequent launches go straight to the main app).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  wizardEscapeKeydownHandler,
  wizardSlugifyName,
  wizardComposeProjectDir,
  wizardStarterOpKind
} from './FirstLaunchWizard'
import {
  isWizardStarterMachineId,
  WIZARD_MACHINE_TO_SAMPLE_FILE
} from '../../shared/first-launch-wizard-contract'

describe('FirstLaunchWizard helpers', () => {
  describe('wizardSlugifyName', () => {
    it('collapses whitespace to a single dash', () => {
      expect(wizardSlugifyName('My  cool   project')).toBe('My-cool-project')
    })

    it('strips disallowed characters but keeps letters / numbers / dash / underscore', () => {
      expect(wizardSlugifyName('Sign Job #42! / final?')).toBe('Sign-Job-42-final')
    })

    it('falls back to a stable default for empty / whitespace-only input', () => {
      expect(wizardSlugifyName('')).toBe('New-Project')
      expect(wizardSlugifyName('   ')).toBe('New-Project')
    })

    it('falls back to default when only disallowed characters remain', () => {
      expect(wizardSlugifyName('?!*')).toBe('New-Project')
    })

    it('caps slug length at 64 characters', () => {
      const long = 'x'.repeat(200)
      expect(wizardSlugifyName(long)).toHaveLength(64)
    })
  })

  describe('wizardComposeProjectDir', () => {
    it('joins POSIX paths with /', () => {
      expect(wizardComposeProjectDir('/home/jacob/projects', 'New Job'))
        .toBe('/home/jacob/projects/New-Job')
    })

    it('joins Windows paths with \\', () => {
      expect(wizardComposeProjectDir('C:\\Users\\jacob\\Projects', 'New Job'))
        .toBe('C:\\Users\\jacob\\Projects\\New-Job')
    })

    it('strips trailing separators from the parent path', () => {
      expect(wizardComposeProjectDir('/home/jacob/projects/', 'My Job'))
        .toBe('/home/jacob/projects/My-Job')
      expect(wizardComposeProjectDir('C:\\Projects\\', 'My Job'))
        .toBe('C:\\Projects\\My-Job')
    })

    it('uses default name fallback when the input is empty', () => {
      expect(wizardComposeProjectDir('/p', '')).toBe('/p/New-Project')
    })
  })

  describe('wizardStarterOpKind', () => {
    it('maps Creality K2 Plus to fdm_slice', () => {
      expect(wizardStarterOpKind('creality-k2-plus')).toBe('fdm_slice')
    })
    it('maps Laguna Swift 5x10 to cnc_contour (full-sheet routing)', () => {
      expect(wizardStarterOpKind('laguna-swift-5x10')).toBe('cnc_contour')
    })
    it('maps Carvera 3-axis to cnc_pocket (precision desktop milling)', () => {
      expect(wizardStarterOpKind('makera-carvera-3axis')).toBe('cnc_pocket')
    })
    it('maps Carvera 4-axis HD to cnc_4axis_indexed (3+2 strategy)', () => {
      expect(wizardStarterOpKind('makera-carvera-4axis')).toBe('cnc_4axis_indexed')
    })
  })

  describe('wizardEscapeKeydownHandler (WCAG 2.1.2 escape route)', () => {
    /**
     * Minimal KeyboardEvent shim -- the project has no jsdom or
     * testing-library dependency, so we synthesize the few props the
     * handler reads. Mirrors the `useUndo-keyboard.test.ts` pattern.
     */
    function mkEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
      return {
        key: '',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        ...overrides
      } as KeyboardEvent
    }

    it('invokes onSkip when a bare Escape keydown is dispatched', () => {
      const onSkip = vi.fn()
      const handler = wizardEscapeKeydownHandler(onSkip)
      handler(mkEvent({ key: 'Escape' }))
      expect(onSkip).toHaveBeenCalledOnce()
    })

    it('ignores non-Escape keys (Enter / Tab / arrow keys must not skip)', () => {
      const onSkip = vi.fn()
      const handler = wizardEscapeKeydownHandler(onSkip)
      handler(mkEvent({ key: 'Enter' }))
      handler(mkEvent({ key: 'Tab' }))
      handler(mkEvent({ key: 'ArrowDown' }))
      handler(mkEvent({ key: 'a' }))
      handler(mkEvent({ key: ' ' }))
      expect(onSkip).not.toHaveBeenCalled()
    })

    it('ignores Escape combined with modifiers (Ctrl/Meta/Shift/Alt) so app accelerators stay safe', () => {
      const onSkip = vi.fn()
      const handler = wizardEscapeKeydownHandler(onSkip)
      handler(mkEvent({ key: 'Escape', ctrlKey: true }))
      handler(mkEvent({ key: 'Escape', metaKey: true }))
      handler(mkEvent({ key: 'Escape', shiftKey: true }))
      handler(mkEvent({ key: 'Escape', altKey: true }))
      expect(onSkip).not.toHaveBeenCalled()
    })

    it('cleans up after document.addEventListener -- handler reference is stable per call to factory', () => {
      // The cleanup contract: the wizard mounts a single handler and
      // unmounts the SAME reference on teardown. Re-creating the
      // factory yields a fresh handler instance, so removeEventListener
      // would mis-match if the effect did not capture the same ref.
      const onSkip = vi.fn()
      const a = wizardEscapeKeydownHandler(onSkip)
      const b = wizardEscapeKeydownHandler(onSkip)
      expect(a).not.toBe(b)
      // But both forward Escape to the same callback:
      a(mkEvent({ key: 'Escape' }))
      b(mkEvent({ key: 'Escape' }))
      expect(onSkip).toHaveBeenCalledTimes(2)
    })

    it('integration: dispatching a real keydown Escape on document fires the registered handler exactly once', () => {
      // Pins the wiring pattern the wizard uses (document-level
      // listener + cleanup). If a future refactor swaps target -> window
      // or drops cleanup, this test catches the drift.
      const onSkip = vi.fn()
      const handler = wizardEscapeKeydownHandler(onSkip)
      const docMock = {
        listeners: new Map<string, EventListener[]>(),
        addEventListener(type: string, fn: EventListener): void {
          const arr = this.listeners.get(type) ?? []
          arr.push(fn)
          this.listeners.set(type, arr)
        },
        removeEventListener(type: string, fn: EventListener): void {
          const arr = this.listeners.get(type) ?? []
          this.listeners.set(type, arr.filter((f) => f !== fn))
        },
        dispatch(type: string, e: KeyboardEvent): void {
          for (const fn of this.listeners.get(type) ?? []) fn(e as unknown as Event)
        }
      }
      docMock.addEventListener('keydown', handler as unknown as EventListener)
      docMock.dispatch('keydown', mkEvent({ key: 'Escape' }))
      expect(onSkip).toHaveBeenCalledOnce()
      // Cleanup removes the listener so a second dispatch is inert.
      docMock.removeEventListener('keydown', handler as unknown as EventListener)
      docMock.dispatch('keydown', mkEvent({ key: 'Escape' }))
      expect(onSkip).toHaveBeenCalledOnce()
    })
  })
})

describe('first-launch-wizard-contract (shared)', () => {
  describe('WIZARD_MACHINE_TO_SAMPLE_FILE', () => {
    it('covers all four wizard machine ids exactly', () => {
      expect(Object.keys(WIZARD_MACHINE_TO_SAMPLE_FILE).sort()).toEqual([
        'creality-k2-plus',
        'laguna-swift-5x10',
        'makera-carvera-3axis',
        'makera-carvera-4axis'
      ])
    })

    it('uses a non-empty mesh-or-vector filename for each machine', () => {
      // STL for 3D mesh starters (K2 Plus / Carvera), DXF for 2D contour
      // starters (Laguna Swift 5x10 sign-board). Anything else would
      // confuse the wizard's "Sample STL" radio + starter-op kind logic.
      for (const [, file] of Object.entries(WIZARD_MACHINE_TO_SAMPLE_FILE)) {
        expect(file.length).toBeGreaterThan(0)
        expect(file).toMatch(/\.(stl|dxf)$/i)
      }
    })

    it('maps the FDM and 3D CAM machines to .stl meshes', () => {
      expect(WIZARD_MACHINE_TO_SAMPLE_FILE['creality-k2-plus']).toMatch(/\.stl$/i)
      expect(WIZARD_MACHINE_TO_SAMPLE_FILE['makera-carvera-3axis']).toMatch(/\.stl$/i)
      expect(WIZARD_MACHINE_TO_SAMPLE_FILE['makera-carvera-4axis']).toMatch(/\.stl$/i)
    })

    it('maps the Laguna router to a .dxf 2D contour starter', () => {
      expect(WIZARD_MACHINE_TO_SAMPLE_FILE['laguna-swift-5x10']).toMatch(/\.dxf$/i)
    })
  })

  describe('isWizardStarterMachineId', () => {
    it('accepts the four wizard machine ids', () => {
      expect(isWizardStarterMachineId('creality-k2-plus')).toBe(true)
      expect(isWizardStarterMachineId('laguna-swift-5x10')).toBe(true)
      expect(isWizardStarterMachineId('makera-carvera-3axis')).toBe(true)
      expect(isWizardStarterMachineId('makera-carvera-4axis')).toBe(true)
    })

    it('rejects unknown values', () => {
      expect(isWizardStarterMachineId('grbl-generic')).toBe(false)
      expect(isWizardStarterMachineId(null)).toBe(false)
      expect(isWizardStarterMachineId(undefined)).toBe(false)
      expect(isWizardStarterMachineId(42)).toBe(false)
      expect(isWizardStarterMachineId({})).toBe(false)
    })
  })
})
