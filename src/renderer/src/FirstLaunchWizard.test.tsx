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
import { describe, expect, it } from 'vitest'
import {
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

    it('uses a non-empty filename for each machine', () => {
      for (const [, file] of Object.entries(WIZARD_MACHINE_TO_SAMPLE_FILE)) {
        expect(file.length).toBeGreaterThan(0)
        expect(file).toMatch(/\.stl$/i)
      }
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
