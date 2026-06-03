/**
 * FirstLaunchWizard -- 3-step guided project bootstrap.
 *
 * Replaces the legacy informational `OnboardingOverlay` (whose 4 cards
 * never actually *did* anything). Per CLAUDE.md "My-Shop-Only Mode" the
 * machine picker is locked to the three target machines (Creality K2
 * Plus, Laguna Swift 5x10, Makera Carvera + 4th-axis HD).
 *
 *   Step 1 -- Welcome      : name + parent folder + Recent Projects MRU
 *   Step 2 -- Pick machine : 3 cards (the Carvera card has a 3- vs
 *                            4-axis sub-toggle since it ships as two
 *                            profiles)
 *   Step 3 -- Starter      : empty / sample STL / import STL/STEP
 *
 * On Finish the wizard:
 *   1. Calls `project:create` (existing IPC, unchanged contract)
 *   2. Optionally copies a bundled sample via `wizard:copySample`
 *      OR opens a file dialog + stages an imported mesh
 *   3. Persists `hasCompletedOnboarding = true` via `settings:set`
 *   4. Hands the chosen machine + starter-op kind back to the host so
 *      `ShopApp` can hand off to `EnvironmentSplash` already-selected
 *
 * IMPORTANT (CLAUDE.md Safety Rule 1): this wizard NEVER touches
 * G-code, post-processor templates, or machine profile YAML. It only
 * creates the project shell + (optionally) one starter operation.
 */
import React, { useEffect, useMemo, useState } from 'react'
import type { MachineProfile } from '../../shared/machine-schema'
import type { ManufactureOperationKind } from '../../shared/manufacture-schema'
import { fab } from './shop-types'
import {
  isWizardStarterMachineId,
  WIZARD_MACHINE_TO_CAD_SAMPLE,
  type WizardStarterMachineId
} from '../../shared/first-launch-wizard-contract'

// ── Public types ────────────────────────────────────────────────────────────

/**
 * What the wizard hands back to its caller. The host (`ShopApp`) is
 * responsible for switching into the matching environment and seeding
 * the in-memory job list with the starter content.
 */
export interface FirstLaunchWizardCompletion {
  readonly projectDir: string
  readonly projectName: string
  readonly machine: MachineProfile
  readonly starterContent: WizardStarterContent
}

export type WizardStarterContent =
  | { kind: 'empty' }
  | {
      kind: 'sample'
      /** Project-relative POSIX path (e.g. `assets/calibration-cube.stl`). */
      assetRelativePath: string
      /** Absolute path inside the new project directory (for `Job.stlPath`). */
      absolutePath: string
      starterOpKind: ManufactureOperationKind
    }
  | {
      kind: 'imported'
      /** Absolute path the user picked in the file dialog. */
      sourcePath: string
      starterOpKind: ManufactureOperationKind
    }
  | {
      kind: 'design'
      /** Display name for the seeded design model (e.g. "L-Bracket"). */
      designName: string
      /** Bundled CadQuery filename (e.g. `bracket.cq.py`). */
      sampleFileName: string
      /** Raw CadQuery Python source -- becomes `designModels[0].scriptText`. */
      scriptText: string
    }

export interface FirstLaunchWizardProps {
  /** All known machine profiles -- used to resolve the wizard machine IDs. */
  machines: readonly MachineProfile[]
  /** Recent project paths from `appSettings.recentProjectPaths` (may be empty / absent). */
  recentProjectPaths: readonly string[]
  /** Default parent folder for new projects, when the user hasn't picked one. */
  defaultProjectsRoot: string | null
  onFinish: (completion: FirstLaunchWizardCompletion) => void
  /** Skip-to-main-app exit. Still persists `hasCompletedOnboarding = true`. */
  onSkip: () => void
  /** User-clicked a recent-project card -- host should open that project. */
  onOpenRecent: (projectDir: string) => void
}

// ── Machine cards (locked to the three target machines) ────────────────────

/** Stable display order for the three Step-2 cards. */
const WIZARD_MACHINE_CARDS: ReadonlyArray<{
  cardId: 'creality' | 'laguna' | 'makera'
  /** Default machineId; the Makera card swaps between 3-axis and 4-axis IDs. */
  defaultMachineId: WizardStarterMachineId
  /** Variants surfaced inline (Makera = 3-axis / 4-axis HD). */
  variants?: ReadonlyArray<{ id: WizardStarterMachineId; label: string }>
  title: string
  shortSpec: string
  iconGlyph: string
}> = [
  {
    cardId: 'creality',
    defaultMachineId: 'creality-k2-plus',
    title: 'Creality K2 Plus',
    shortSpec: 'FDM 3D Printer · 350 × 350 × 350 mm',
    iconGlyph: '\u{1F5A8}'
  },
  {
    cardId: 'laguna',
    defaultMachineId: 'laguna-swift-5x10',
    title: 'Laguna Swift 5×10',
    shortSpec: 'CNC Router · 60" × 120" (full sheet)',
    iconGlyph: '\u{1FAB5}'
  },
  {
    cardId: 'makera',
    defaultMachineId: 'makera-carvera-3axis',
    variants: [
      { id: 'makera-carvera-3axis', label: '3-axis' },
      { id: 'makera-carvera-4axis', label: '4-axis HD' }
    ],
    title: 'Makera Carvera',
    shortSpec: 'Desktop CNC + ATC · 360 × 240 × 140 mm',
    iconGlyph: '✦'
  }
] as const

// ── Starter-op kind chosen per machine -- safe defaults ────────────────────

/**
 * Per-machine starter operation kind. Picked to land the user in an
 * op they can actually run (Slice for K2; Contour for Laguna; Pocket
 * for Carvera 3-axis; Indexed for Carvera 4-axis HD). Mirrors the
 * sample-bundle README convention.
 */
export function wizardStarterOpKind(
  machineId: WizardStarterMachineId
): ManufactureOperationKind {
  switch (machineId) {
    case 'creality-k2-plus':
      return 'fdm_slice'
    case 'laguna-swift-5x10':
      return 'cnc_contour'
    case 'makera-carvera-3axis':
      return 'cnc_pocket'
    case 'makera-carvera-4axis':
      return 'cnc_4axis_indexed'
  }
}

// ── Keyboard helpers ───────────────────────────────────────────────────────

/**
 * Pure factory for the wizard's Escape-to-skip keydown handler. WCAG
 * 2.1.2 forbids focus traps without an escape route; this matches the
 * `ConfirmDialog`/`ContextMenu` pattern so a single Escape press exits
 * the modal exactly like clicking "Skip wizard".
 *
 * Exported so the keyboard wiring can be exercised by a vitest unit
 * without booting React (project has no testing-library dep; see
 * `useUndo-keyboard.test.ts` for the precedent).
 *
 * Only a bare Escape (no Ctrl/Meta/Shift/Alt) triggers `onEscape` so we
 * don't fight other accelerators that happen to ride on Escape.
 */
export function wizardEscapeKeydownHandler(
  onEscape: () => void
): (e: KeyboardEvent) => void {
  return (e) => {
    if (e.key !== 'Escape') return
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    onEscape()
  }
}

// ── Project-name + folder helpers ──────────────────────────────────────────

/**
 * Sanitize a project name to a safe folder slug. Strict but permissive:
 * accepts alphanum, dash, underscore, space (collapsed to dash), removes
 * everything else. Caps length so we don't blow past Windows MAX_PATH on
 * a deeply-nested parent folder.
 */
export function wizardSlugifyName(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return 'New-Project'
  const cleaned = trimmed
    .replace(/[\s]+/g, '-')
    .replace(/[^A-Za-z0-9_\-]/g, '')
    .replace(/-{2,}/g, '-')        // collapse runs of dashes from stripped specials
    .replace(/^-+|-+$/g, '')       // trim leading / trailing dashes
    .slice(0, 64)
  return cleaned || 'New-Project'
}

/**
 * UUID factory for the starter design model the wizard splices into the
 * project's `designModels[]` (UNIFY 2 "Start a parametric design" path).
 * Exported so a vitest can substitute a deterministic generator without
 * monkey-patching `globalThis.crypto`.
 *
 * Falls back to a v4-ish pseudo-random id when `crypto.randomUUID` is
 * unavailable (older test runners) -- the project schema validates the
 * shape so the value still has to look like a UUID.
 */
export function wizardGenerateDesignId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Pseudo-random v4 fallback. Not cryptographically strong; just keeps the
  // schema happy on environments without `crypto.randomUUID`.
  const hex = (n: number): string => n.toString(16).padStart(2, '0')
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant
  const parts = Array.from(bytes, hex)
  return (
    parts.slice(0, 4).join('') +
    '-' +
    parts.slice(4, 6).join('') +
    '-' +
    parts.slice(6, 8).join('') +
    '-' +
    parts.slice(8, 10).join('') +
    '-' +
    parts.slice(10, 16).join('')
  )
}

/** Compose the proposed project directory from parent + name. */
export function wizardComposeProjectDir(
  parentDir: string,
  projectName: string
): string {
  // We can't use `path.join` from the renderer; do a permissive join that
  // preserves the parent's existing separator style.
  const slug = wizardSlugifyName(projectName)
  const sep = parentDir.includes('\\') ? '\\' : '/'
  const cleanParent = parentDir.replace(/[\/\\]+$/, '')
  return `${cleanParent}${sep}${slug}`
}

// ── Component ──────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3

export function FirstLaunchWizard(props: FirstLaunchWizardProps): React.ReactElement {
  const {
    machines,
    recentProjectPaths,
    defaultProjectsRoot,
    onFinish,
    onSkip,
    onOpenRecent
  } = props

  const [step, setStep] = useState<WizardStep>(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Step 1 state
  const [projectName, setProjectName] = useState('New WorkTrack3D Project')
  const [parentDir, setParentDir] = useState<string>(defaultProjectsRoot ?? '')

  // Step 2 state -- which card; which Makera variant.
  const [selectedCardId, setSelectedCardId] = useState<'creality' | 'laguna' | 'makera' | null>(null)
  const [makeraVariantId, setMakeraVariantId] = useState<WizardStarterMachineId>('makera-carvera-3axis')

  // Step 3 state
  const [starterChoice, setStarterChoice] = useState<'empty' | 'sample' | 'import' | 'design'>('empty')
  const [importedPath, setImportedPath] = useState<string | null>(null)
  const [availableSampleMachineIds, setAvailableSampleMachineIds] = useState<readonly WizardStarterMachineId[]>([])

  // Resolve the selected wizard machine ID from card + variant
  const selectedMachineId: WizardStarterMachineId | null = useMemo(() => {
    if (!selectedCardId) return null
    if (selectedCardId === 'creality') return 'creality-k2-plus'
    if (selectedCardId === 'laguna') return 'laguna-swift-5x10'
    return makeraVariantId
  }, [selectedCardId, makeraVariantId])

  const selectedMachine: MachineProfile | null = useMemo(() => {
    if (!selectedMachineId) return null
    return machines.find((m) => m.id === selectedMachineId) ?? null
  }, [selectedMachineId, machines])

  // Load sample-bundle availability once per mount.
  useEffect(() => {
    let cancelled = false
    fab().samplesList()
      .then((r) => {
        if (cancelled) return
        const ids = (r.availableMachineIds ?? []).filter(isWizardStarterMachineId)
        setAvailableSampleMachineIds(ids)
      })
      .catch(() => {
        if (!cancelled) setAvailableSampleMachineIds([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  // If user lands on Step 3 with a machine that has no sample, force "empty".
  useEffect(() => {
    if (step !== 3) return
    if (
      starterChoice === 'sample' &&
      selectedMachineId &&
      !availableSampleMachineIds.includes(selectedMachineId)
    ) {
      setStarterChoice('empty')
    }
  }, [step, starterChoice, selectedMachineId, availableSampleMachineIds])

  // Recent projects -- safely handle "MRU not yet present" / empty array.
  const recentList: readonly string[] = useMemo(() => {
    if (!Array.isArray(recentProjectPaths)) return []
    return recentProjectPaths.filter((p) => typeof p === 'string' && p.length > 0).slice(0, 5)
  }, [recentProjectPaths])

  // ── Step actions ──

  const handlePickParentFolder = async (): Promise<void> => {
    setError(null)
    try {
      const picked = await fab().projectOpenDir()
      if (picked) setParentDir(picked)
    } catch (e) {
      setError(`Failed to pick folder: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const handlePickImportFile = async (): Promise<void> => {
    setError(null)
    try {
      const picked = await fab().dialogOpenFile([
        { name: 'CAD Models', extensions: ['stl', 'step', 'stp'] }
      ])
      if (picked) setImportedPath(picked)
    } catch (e) {
      setError(`Failed to pick file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const canAdvanceFromStep1 = projectName.trim().length > 0 && parentDir.trim().length > 0
  const canAdvanceFromStep2 = selectedMachine !== null
  const canFinish =
    selectedMachine !== null &&
    (starterChoice !== 'import' || importedPath !== null)

  const handleFinish = async (): Promise<void> => {
    if (!selectedMachine || !selectedMachineId) return
    setBusy(true)
    setError(null)
    try {
      const projectDir = wizardComposeProjectDir(parentDir, projectName)
      // 1. Create project (existing IPC, unchanged).
      await fab().projectCreate({
        dir: projectDir,
        name: projectName.trim(),
        machineId: selectedMachine.id
      })

      // 2. Build starter content payload based on user choice.
      let starterContent: WizardStarterContent = { kind: 'empty' }
      if (starterChoice === 'sample') {
        const copyRes = await fab().wizardCopySample({
          projectDir,
          machineId: selectedMachineId
        })
        if (copyRes.ok) {
          const sep = projectDir.includes('\\') ? '\\' : '/'
          const absolutePath = `${projectDir}${sep}${copyRes.assetRelativePath.replace(/\//g, sep)}`
          starterContent = {
            kind: 'sample',
            assetRelativePath: copyRes.assetRelativePath,
            absolutePath,
            starterOpKind: wizardStarterOpKind(selectedMachineId)
          }
        } else {
          // Non-fatal: continue with empty project, surface a soft error.
          setError(`Sample copy failed; created empty project. (${copyRes.error})`)
        }
      } else if (starterChoice === 'import' && importedPath) {
        starterContent = {
          kind: 'imported',
          sourcePath: importedPath,
          starterOpKind: wizardStarterOpKind(selectedMachineId)
        }
      } else if (starterChoice === 'design') {
        // UNIFY 2: read the bundled CadQuery starter script for this machine
        // and stage it as the project's first `designModels[]` entry. The
        // host (`ShopApp.handleWizardFinish`) opens the Design workspace
        // with the script preloaded so the user lands on the parametric
        // surface with a body already authored.
        const readRes = await fab().wizardReadCadSample({
          machineId: selectedMachineId
        })
        if (readRes.ok) {
          // Persist the starter design back into the project.json so
          // re-opening the project shows the same parametric model. We
          // re-read after `project:create` to pick up any defaults the
          // main process supplied (BUILD 3 schema: designModels: []), then
          // splice in the new entry and write back.
          try {
            const created = await fab().projectRead(projectDir)
            const nowIso = new Date().toISOString()
            const designId = wizardGenerateDesignId()
            const updated = {
              ...created,
              updatedAt: nowIso,
              designModels: [
                ...created.designModels,
                {
                  id: designId,
                  name: readRes.designName,
                  scriptText: readRes.scriptText,
                  createdAt: nowIso,
                  updatedAt: nowIso
                }
              ]
            }
            await fab().projectSave(projectDir, updated)
          } catch (e) {
            // Non-fatal: project shell already exists; surface a soft
            // warning. The user can still author a design in-session.
            setError(
              `Created project but failed to seed design model: ${
                e instanceof Error ? e.message : String(e)
              }`
            )
          }
          starterContent = {
            kind: 'design',
            designName: readRes.designName,
            sampleFileName: readRes.fileName,
            scriptText: readRes.scriptText
          }
        } else {
          // Non-fatal: continue with empty project, surface a soft error.
          setError(`Design sample load failed; created empty project. (${readRes.error})`)
        }
      }

      // 3. Persist completion flag + projectsRoot + MRU (best-effort).
      try {
        await fab().settingsSet({
          hasCompletedOnboarding: true,
          projectsRoot: parentDir,
          lastProjectPath: projectDir
        })
      } catch {
        /* Persisting the flag is best-effort; do not block project creation. */
      }

      onFinish({
        projectDir,
        projectName: projectName.trim(),
        machine: selectedMachine,
        starterContent
      })
    } catch (e) {
      setError(`Failed to create project: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const handleSkip = (): void => {
    // Persist completion flag so we don't re-show on next launch.
    void fab().settingsSet({ hasCompletedOnboarding: true }).catch(() => { /* */ })
    onSkip()
  }

  // Escape-to-skip (WCAG 2.1.2: focus trap MUST have an escape route).
  // Mirrors ConfirmDialog.tsx's document-level keydown pattern. The
  // listener is gated on `busy` so a mid-create Escape can't drop the
  // user out of an in-flight `project:create` IPC.
  useEffect(() => {
    if (busy) return
    const handler = wizardEscapeKeydownHandler(() => {
      // Same exit path as the visible "Skip wizard" button -- persists
      // `hasCompletedOnboarding=true` so the wizard doesn't re-open on
      // the next launch.
      void fab().settingsSet({ hasCompletedOnboarding: true }).catch(() => { /* */ })
      onSkip()
    })
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [busy, onSkip])

  // ── Render ──

  return (
    <div
      className="onboarding-overlay flw-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="flw-title"
    >
      <div className="onboarding-card flw-card">
        <header className="flw-header">
          <h1 id="flw-title" className="onboarding-title">Welcome to WorkTrack3D</h1>
          <p className="onboarding-subtitle">
            Let&apos;s set up your first project. (Step {step} of 3)
          </p>
          <div className="flw-stepper" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}>
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={`flw-stepper__dot${n === step ? ' flw-stepper__dot--active' : ''}${n < step ? ' flw-stepper__dot--done' : ''}`}
                aria-hidden="true"
              />
            ))}
          </div>
        </header>

        {step === 1 && (
          <section className="flw-body" aria-label="Step 1: Welcome">
            <label className="flw-field">
              <span className="flw-field__label">Project name</span>
              <input
                type="text"
                className="flw-input"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="My new project"
                aria-label="Project name"
                autoFocus
              />
            </label>
            <label className="flw-field">
              <span className="flw-field__label">Save in folder</span>
              <div className="flw-folder-row">
                <input
                  type="text"
                  className="flw-input flw-input--mono"
                  value={parentDir}
                  onChange={(e) => setParentDir(e.target.value)}
                  placeholder={defaultProjectsRoot ?? 'Pick a folder for your projects'}
                  aria-label="Parent folder"
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handlePickParentFolder()}>
                  Browse{'…'}
                </button>
              </div>
              <span className="flw-field__hint">
                Your project will be saved at:{' '}
                <code>{wizardComposeProjectDir(parentDir || '(pick a folder)', projectName)}</code>
              </span>
            </label>

            {recentList.length > 0 && (
              <div className="flw-recent">
                <div className="flw-recent__title">Or open a recent project</div>
                <ul className="flw-recent__list">
                  {recentList.map((p) => (
                    <li key={p}>
                      <button
                        type="button"
                        className="flw-recent__btn"
                        onClick={() => onOpenRecent(p)}
                        title={p}
                      >
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {step === 2 && (
          <section className="flw-body" aria-label="Step 2: Pick a machine">
            <div className="flw-machine-grid" role="radiogroup" aria-label="Pick a machine">
              {WIZARD_MACHINE_CARDS.map((card) => {
                const installed = machines.some((m) =>
                  card.variants
                    ? card.variants.some((v) => v.id === m.id)
                    : m.id === card.defaultMachineId
                )
                const isActive = selectedCardId === card.cardId
                return (
                  <button
                    key={card.cardId}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    disabled={!installed}
                    className={`flw-machine-card${isActive ? ' flw-machine-card--active' : ''}${!installed ? ' flw-machine-card--disabled' : ''}`}
                    onClick={() => setSelectedCardId(card.cardId)}
                    title={installed ? card.title : `${card.title} (profile not installed)`}
                  >
                    <div className="flw-machine-card__icon" aria-hidden="true">{card.iconGlyph}</div>
                    <div className="flw-machine-card__title">{card.title}</div>
                    <div className="flw-machine-card__spec">{card.shortSpec}</div>
                    {card.variants && isActive && (
                      <div
                        className="flw-machine-card__variants"
                        role="radiogroup"
                        aria-label={`${card.title} variant`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {card.variants.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            role="radio"
                            aria-checked={makeraVariantId === v.id}
                            className={`flw-variant-btn${makeraVariantId === v.id ? ' flw-variant-btn--selected' : ''}`}
                            onClick={() => setMakeraVariantId(v.id)}
                          >
                            {v.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {isActive && (
                      <div className="flw-machine-card__choose">Selected ✓</div>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {step === 3 && selectedMachineId && (
          <section className="flw-body" aria-label="Step 3: Pick starter content">
            <fieldset className="flw-starter">
              <legend className="flw-starter__legend">Starter content</legend>

              <label className={`flw-starter__option${starterChoice === 'empty' ? ' flw-starter__option--selected' : ''}`}>
                <input
                  type="radio"
                  name="flw-starter"
                  value="empty"
                  checked={starterChoice === 'empty'}
                  onChange={() => setStarterChoice('empty')}
                />
                <span className="flw-starter__option-title">Empty project</span>
                <span className="flw-starter__option-desc">
                  Just create the project with the chosen machine. Add models and operations later.
                </span>
              </label>

              {(() => {
                const sampleAvailable = availableSampleMachineIds.includes(selectedMachineId)
                return (
                  <label
                    className={`flw-starter__option${starterChoice === 'sample' ? ' flw-starter__option--selected' : ''}${!sampleAvailable ? ' flw-starter__option--disabled' : ''}`}
                    title={sampleAvailable ? '' : 'Sample bundle coming soon for this machine'}
                  >
                    <input
                      type="radio"
                      name="flw-starter"
                      value="sample"
                      checked={starterChoice === 'sample'}
                      disabled={!sampleAvailable}
                      onChange={() => setStarterChoice('sample')}
                    />
                    <span className="flw-starter__option-title">
                      Sample STL for this machine
                    </span>
                    <span className="flw-starter__option-desc">
                      {sampleAvailable
                        ? 'Copies a small starter mesh into the project and pre-creates a starter operation.'
                        : 'Sample bundle coming soon for this machine.'}
                    </span>
                  </label>
                )
              })()}

              <label className={`flw-starter__option${starterChoice === 'import' ? ' flw-starter__option--selected' : ''}`}>
                <input
                  type="radio"
                  name="flw-starter"
                  value="import"
                  checked={starterChoice === 'import'}
                  onChange={() => setStarterChoice('import')}
                />
                <span className="flw-starter__option-title">Import existing STL/STEP</span>
                <span className="flw-starter__option-desc">
                  Pick a file you already have. We stage it into the project and create a starter operation.
                </span>
                {starterChoice === 'import' && (
                  <div className="flw-import-row" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handlePickImportFile()}>
                      {importedPath ? 'Change file…' : 'Browse for file…'}
                    </button>
                    {importedPath && (
                      <span className="flw-import-row__path" title={importedPath}>
                        {importedPath}
                      </span>
                    )}
                  </div>
                )}
              </label>

              {/*
                UNIFY 2 "Start a parametric design" option. Loads a bundled
                CadQuery starter script for the chosen machine (see
                `WIZARD_MACHINE_TO_CAD_SAMPLE`) and seeds it as the project's
                first `designModels[]` entry. On Finish the host opens the
                Design workspace with the script preloaded. All four wizard
                machine IDs currently ship with a CAD sample, so the option
                is always enabled -- if a future machine lacks one, we
                disable + tooltip the same way Sample STL does.
              */}
              {(() => {
                const cadAvailable =
                  selectedMachineId in WIZARD_MACHINE_TO_CAD_SAMPLE
                const designName = cadAvailable
                  ? WIZARD_MACHINE_TO_CAD_SAMPLE[selectedMachineId].designName
                  : null
                return (
                  <label
                    className={`flw-starter__option${starterChoice === 'design' ? ' flw-starter__option--selected' : ''}${!cadAvailable ? ' flw-starter__option--disabled' : ''}`}
                    title={cadAvailable ? '' : 'CadQuery starter coming soon for this machine'}
                    data-testid="flw-starter-design"
                  >
                    <input
                      type="radio"
                      name="flw-starter"
                      value="design"
                      checked={starterChoice === 'design'}
                      disabled={!cadAvailable}
                      onChange={() => setStarterChoice('design')}
                    />
                    <span className="flw-starter__option-title">
                      Start a parametric design
                    </span>
                    <span className="flw-starter__option-desc">
                      {cadAvailable && designName
                        ? `Loads the bundled "${designName}" CadQuery starter script and opens the Design workspace so you can edit dimensions before sending to CAM.`
                        : 'CadQuery starter coming soon for this machine.'}
                    </span>
                  </label>
                )
              })()}
            </fieldset>
          </section>
        )}

        {error && <div className="flw-error" role="alert">{error}</div>}

        <footer className="onboarding-footer flw-footer">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleSkip}
            disabled={busy}
          >
            Skip wizard
          </button>
          <div className="flex-spacer" />
          {step > 1 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setStep((s) => (s - 1) as WizardStep)}
              disabled={busy}
            >
              {'←'} Back
            </button>
          )}
          {step < 3 && (
            <button
              type="button"
              className="onboarding-start-btn flw-primary-btn"
              onClick={() => setStep((s) => (s + 1) as WizardStep)}
              disabled={busy || (step === 1 ? !canAdvanceFromStep1 : !canAdvanceFromStep2)}
            >
              Next {'→'}
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              className="onboarding-start-btn flw-primary-btn"
              onClick={() => void handleFinish()}
              disabled={busy || !canFinish}
            >
              {busy ? 'Creating…' : 'Finish & open project'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
