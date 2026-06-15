/**
 * ManufactureWorkspace × unsaved-changes navigation guard — source pins.
 *
 * The full `ManufactureWorkspace` is too heavy to mount in the `node` vitest env
 * (Three.js, plate state, fab IPC) — the established convention (see
 * `manufacture-load-guard.test.ts` + `ManufactureWorkspace.stage-content.test.tsx`)
 * is to unit-test the PURE pieces (`manufacture-dirty.test.ts`) + the SEAM
 * (`NavigationGuardContext.test.tsx`) and SOURCE-PIN the in-component wiring. This
 * file pins that the workspace:
 *
 *   - registers a dirty-probe on mount + unregisters on unmount via the seam;
 *   - threads the probe through a latest-value ref (so the single registration
 *     always reads the CURRENT dirty without re-registering per edit);
 *   - sets the last-saved baseline at the THREE disk==memory moments
 *     (load .then, empty/no-project branch, post-save) PLUS after the Send-to-CAM
 *     live-merge save (so importing a part doesn't leave the plan stuck dirty);
 *   - derives `dirty` from the pure fingerprint compare;
 *   - renders the persistent aria-live "Unsaved changes" indicator near Save,
 *     gated on `dirty` (no stale text when clean).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(__dirname, '..', 'ManufactureWorkspace.tsx'), 'utf-8')

describe('ManufactureWorkspace — guard imports + dirty derivation', () => {
  it('imports the pure dirty helpers + the navigation-guard seam', () => {
    expect(SRC).toContain(
      "import { manufacturePlanFingerprint, isManufacturePlanDirty } from './manufacture-dirty'"
    )
    expect(SRC).toContain("import { useNavigationGuard } from '../app/NavigationGuardContext'")
  })

  it('derives dirty from a fingerprint(mfg) vs the last-saved baseline ref', () => {
    expect(SRC).toContain(
      'const lastSavedFingerprintRef = useRef<string>(manufacturePlanFingerprint(emptyManufacture()))'
    )
    expect(SRC).toContain('const dirty = useMemo(')
    expect(SRC).toContain(
      'isManufacturePlanDirty(manufacturePlanFingerprint(mfg), lastSavedFingerprintRef.current)'
    )
    // dirty tracks the PERSISTED state (mfg), not the per-plate view (effectiveMfg),
    // AND a baseline-version counter so a rebaseline that does NOT change mfg (a
    // successful Save / the Send-to-CAM merge save) still recomputes dirty → clean.
    expect(SRC).toContain('[mfg, savedBaselineVersion]\n  )')
  })

  it('a baseline rebaseline that leaves mfg unchanged still flips dirty clean (no stuck-dirty after Save)', () => {
    // The bug this guards: `useMemo(..., [mfg])` reading the baseline ref never
    // recomputes when only the ref changes (Save / merge update the ref but NOT
    // mfg), so dirty stuck `true` post-save. A version counter listed in the deps
    // forces the re-render + recompute the ref write alone cannot.
    expect(SRC).toContain('const [savedBaselineVersion, setSavedBaselineVersion] = useState(0)')
    // Bumped at the two rebaseline sites that do NOT also call setMfg: the save
    // callback and the Send-to-CAM merge IIFE (the load/no-project/catch sites
    // already re-render via setMfg). So exactly two bumps.
    const bumps = SRC.split('setSavedBaselineVersion((v) => v + 1)').length - 1
    expect(bumps).toBe(2)
  })
})

describe('ManufactureWorkspace — registers the guard probe (mount) + unregisters (unmount)', () => {
  it('routes the probe through a latest-value ref (no per-edit re-registration)', () => {
    expect(SRC).toContain('const dirtyRef = useRef(dirty)')
    expect(SRC).toContain('dirtyRef.current = dirty')
  })

  it('registers on mount and returns an unregister cleanup, keyed on the stable seam', () => {
    expect(SRC).toContain('const navGuard = useNavigationGuard()')
    expect(SRC).toContain("const id = 'manufacture-workspace'")
    expect(SRC).toContain('navGuard.register(id, () => dirtyRef.current)')
    expect(SRC).toContain('return () => navGuard.unregister(id)')
    // The effect depends only on the stable seam, so it registers ONCE.
    expect(SRC).toContain('}, [navGuard])')
  })
})

describe('ManufactureWorkspace — sets the last-saved baseline at every disk==memory moment', () => {
  it('(a) after the load effect loads the plan from disk', () => {
    expect(SRC).toContain('lastSavedFingerprintRef.current = manufacturePlanFingerprint(loaded)')
  })

  it('(b) on the empty / no-project + load-failure branches', () => {
    // Both the no-project reset and the catch-fallback rebaseline to empty.
    const emptyBaselineHits = SRC.split(
      'lastSavedFingerprintRef.current = manufacturePlanFingerprint(empty)'
    ).length - 1
    expect(emptyBaselineHits).toBeGreaterThanOrEqual(2)
  })

  it('(c) after a SUCCESSFUL save (disk == this exact mfg)', () => {
    expect(SRC).toContain('await fab.manufactureSave(projectDir, JSON.stringify(mfg))')
    expect(SRC).toContain('lastSavedFingerprintRef.current = manufacturePlanFingerprint(mfg)')
  })

  it('(d) after the Send-to-CAM live-merge save (import must not leave the plan dirty)', () => {
    expect(SRC).toContain('await fab.manufactureSave(projectDir, JSON.stringify(merged))')
    expect(SRC).toContain('lastSavedFingerprintRef.current = manufacturePlanFingerprint(merged)')
  })
})

describe('ManufactureWorkspace — renders the persistent Unsaved-changes indicator near Save', () => {
  it('is an aria-live status region gated on dirty (cleared when clean)', () => {
    expect(SRC).toContain(
      '<p className="msg manufacture-unsaved-indicator" role="status" aria-live="polite">'
    )
    expect(SRC).toContain('{dirty ? (')
    expect(SRC).toContain('<strong>Unsaved changes</strong>')
  })

  it('sits right after the plan toolbar that carries the Save button', () => {
    // The indicator must be adjacent to Save so the operator sees it in context.
    const toolbarIdx = SRC.indexOf('onSave={() => void save()}')
    const indicatorIdx = SRC.indexOf('manufacture-unsaved-indicator')
    expect(toolbarIdx).toBeGreaterThan(0)
    expect(indicatorIdx).toBeGreaterThan(toolbarIdx)
  })
})
