/**
 * MultiSetupWizard — Automates multi-setup CNC workflows.
 *
 * Provides three automation actions:
 * 1. Auto-Assign WCS offsets (G54-G59) across setups
 * 2. Validate the setup sequence for conflicts and missing data
 * 3. Suggest a flip setup (180deg rotation) from the selected setup
 *
 * Renders inline within the manufacture workspace setup tab, below the
 * setup selector and stock parameters.
 */

import { useState, useCallback, type ReactNode } from 'react'
import type { ManufactureSetup } from '../../shared/manufacture-schema'
import type { SetupSequenceValidation, FlipSetupSuggestion } from '../../shared/multi-setup-utils'
import { WCS_CODES } from '../../shared/multi-setup-utils'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MultiSetupWizardProps {
  /** All current manufacture setups. */
  setups: ManufactureSetup[]
  /** Index of the currently selected setup (for flip suggestion). */
  selectedSetupIndex: number
  /** Replace the entire setups array (e.g. after auto-assign WCS). */
  onSetupsChange: (setups: ManufactureSetup[]) => void
  /** Append a new setup (e.g. the suggested flip). */
  onAddSetup: (setup: ManufactureSetup) => void
  /** Status bar message callback. */
  onStatus?: (msg: string) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert workCoordinateIndex (1-6) to display string like "G54". */
function wcsLabel(index: number | undefined): string {
  if (index === undefined || index < 1 || index > 6) return 'None'
  return WCS_CODES[index - 1] ?? `G${53 + index}`
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MultiSetupWizard({
  setups,
  selectedSetupIndex,
  onSetupsChange,
  onAddSetup,
  onStatus
}: MultiSetupWizardProps): ReactNode {
  const [busy, setBusy] = useState(false)
  const [validation, setValidation] = useState<SetupSequenceValidation | null>(null)
  const [flipSuggestion, setFlipSuggestion] = useState<FlipSetupSuggestion | null>(null)

  const selectedSetup = setups[selectedSetupIndex] ?? null

  // ── Auto-Assign WCS ───────────────────────────────────────────────────────

  const handleAutoAssignWcs = useCallback(async () => {
    if (setups.length === 0) {
      onStatus?.('No setups to assign WCS offsets to.')
      return
    }
    setBusy(true)
    setValidation(null)
    setFlipSuggestion(null)
    try {
      const result = await window.fab.setupAutoAssignWcs(setups)
      if (result.ok) {
        onSetupsChange(result.setups)
        onStatus?.(`WCS offsets auto-assigned to ${result.setups.length} setup(s).`)
      } else {
        onStatus?.(`Auto-assign failed: ${result.error}`)
      }
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [setups, onSetupsChange, onStatus])

  // ── Validate Sequence ─────────────────────────────────────────────────────

  const handleValidate = useCallback(async () => {
    if (setups.length === 0) {
      onStatus?.('No setups to validate.')
      return
    }
    setBusy(true)
    setFlipSuggestion(null)
    try {
      const result = await window.fab.setupValidate(setups)
      if (result.ok) {
        setValidation({ valid: result.valid, issues: result.issues })
        if (result.valid && result.issues.length === 0) {
          onStatus?.('Setup sequence is valid with no issues.')
        } else if (result.valid) {
          onStatus?.(`Setup sequence valid with ${result.issues.length} warning(s).`)
        } else {
          onStatus?.(`Setup sequence has ${result.issues.filter((i) => i.severity === 'error').length} error(s).`)
        }
      } else {
        onStatus?.(`Validation failed: ${result.error}`)
      }
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [setups, onStatus])

  // ── Suggest Flip Setup ────────────────────────────────────────────────────

  const handleSuggestFlip = useCallback(async () => {
    if (!selectedSetup) {
      onStatus?.('Select a setup to generate a flip suggestion from.')
      return
    }
    setBusy(true)
    setValidation(null)
    try {
      const result = await window.fab.setupSuggestFlip({
        currentSetup: selectedSetup,
        existingSetups: setups,
        flipAxis: 'X'
      })
      if (result.ok) {
        setFlipSuggestion({ setup: result.setup, flipAxis: result.flipAxis, note: result.note })
        onStatus?.(`Flip suggestion ready: ${result.note}`)
      } else {
        onStatus?.(`Flip suggestion failed: ${result.error}`)
      }
    } catch (e) {
      onStatus?.(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [selectedSetup, setups, onStatus])

  // ── Accept Flip ───────────────────────────────────────────────────────────

  const handleAcceptFlip = useCallback(() => {
    if (!flipSuggestion) return
    onAddSetup(flipSuggestion.setup)
    onStatus?.(`Added flip setup "${flipSuggestion.setup.label}".`)
    setFlipSuggestion(null)
  }, [flipSuggestion, onAddSetup, onStatus])

  // ── Dismiss results ───────────────────────────────────────────────────────

  const dismissValidation = useCallback(() => setValidation(null), [])
  const dismissFlip = useCallback(() => setFlipSuggestion(null), [])

  // ── Early return: no setups ───────────────────────────────────────────────

  if (setups.length === 0) return null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <section className="panel panel--nested multi-setup-wizard" aria-labelledby="msw-heading">
      <h3 id="msw-heading" className="subh">Multi-Setup Wizard</h3>

      {/* ── Setup list with WCS assignments ── */}
      <div className="msw-setup-list">
        <table className="msw-table" aria-label="Setup WCS assignments">
          <thead>
            <tr>
              <th>Setup</th>
              <th>Machine</th>
              <th>WCS</th>
              <th>Origin</th>
            </tr>
          </thead>
          <tbody>
            {setups.map((s, i) => (
              <tr key={s.id} className={i === selectedSetupIndex ? 'msw-table-row--selected' : ''}>
                <td>{s.label}</td>
                <td className="msw-cell--mono">{s.machineId}</td>
                <td className="msw-cell--wcs">{wcsLabel(s.workCoordinateIndex)}</td>
                <td className="msw-cell--mono">{s.wcsOriginPoint ?? 'default'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Action buttons ── */}
      <div className="row row--wrap msw-actions">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void handleAutoAssignWcs()}
          aria-label="Auto-assign WCS offsets G54 through G59"
        >
          Auto-Assign WCS
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void handleValidate()}
          aria-label="Validate setup sequence for conflicts"
        >
          Validate Sequence
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !selectedSetup}
          onClick={() => void handleSuggestFlip()}
          aria-label="Suggest flip setup from selected setup"
        >
          Suggest Flip Setup
        </button>
      </div>

      {/* ── Validation results ── */}
      {validation !== null ? (
        <div className="msw-results" aria-live="polite">
          <div className="msw-results-header">
            <strong className={validation.valid ? 'msw-status--ok' : 'msw-status--error'}>
              {validation.valid ? 'Valid' : 'Invalid'}
            </strong>
            {validation.issues.length > 0 ? (
              <span className="msg msg--muted msw-issue-count">
                {validation.issues.length} issue{validation.issues.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="msg msg--muted">No issues found.</span>
            )}
            <button type="button" className="secondary msw-dismiss" onClick={dismissValidation} aria-label="Dismiss validation results">
              Dismiss
            </button>
          </div>
          {validation.issues.length > 0 ? (
            <ul className="msw-issue-list">
              {validation.issues.map((issue, i) => (
                <li
                  key={`${issue.setupId}-${i}`}
                  className={issue.severity === 'error' ? 'msw-issue--error' : 'msw-issue--warning'}
                >
                  <span className="msw-issue-badge">{issue.severity === 'error' ? 'Error' : 'Warning'}</span>
                  <span className="msw-issue-setup">{issue.setupId}</span>
                  <span className="msw-issue-msg">{issue.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* ── Flip suggestion ── */}
      {flipSuggestion !== null ? (
        <div className="msw-results msw-flip-result" aria-live="polite">
          <div className="msw-results-header">
            <strong>Flip Suggestion</strong>
            <button type="button" className="secondary msw-dismiss" onClick={dismissFlip} aria-label="Dismiss flip suggestion">
              Dismiss
            </button>
          </div>
          <div className="msw-flip-detail">
            <p className="msg">
              <strong>{flipSuggestion.setup.label}</strong> — Flip {flipSuggestion.flipAxis}-axis,
              WCS {wcsLabel(flipSuggestion.setup.workCoordinateIndex)},
              origin {flipSuggestion.setup.wcsOriginPoint ?? 'default'}
            </p>
            {flipSuggestion.setup.wcsNote ? (
              <p className="msg msg--muted msw-flip-note">{flipSuggestion.setup.wcsNote}</p>
            ) : null}
            <p className="msg msg--muted">{flipSuggestion.note}</p>
          </div>
          <div className="row msw-flip-actions">
            <button
              type="button"
              className="primary"
              onClick={handleAcceptFlip}
              aria-label="Accept and add the suggested flip setup"
            >
              Add Flip Setup
            </button>
            <button
              type="button"
              className="secondary"
              onClick={dismissFlip}
              aria-label="Reject flip suggestion"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
