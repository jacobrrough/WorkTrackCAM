/**
 * ViewportChrome — presentational viewport overlay chrome for the Design
 * cockpit (UI-3). Ports the 10-mockup's `.vp-toolbar` / `.stage-tabs` /
 * `.viewcube` / `.triad` look onto the Part-view center pane using the
 * cockpit `dc-` CSS classes (see `styles/shell/design-cockpit.css`).
 *
 * This component is PURELY presentational — there is no live Three.js
 * viewport yet, so the orbit / pan / zoom / section / measure buttons are
 * decorative placeholders (no handlers). The two pieces that ARE wired:
 *
 *   1. The `Code </>` toggle button — calls `onToggleCode` and paints a
 *      pressed state (`aria-pressed`) when the code drawer is open.
 *   2. The Model / Sketch / Inspect stage-tabs — bound to `stage` /
 *      `onStageChange` so the cockpit can swap stage context. (The stages
 *      are presentational selection state for now; the Part-view body does
 *      not yet branch on them, matching the "no live 3D" reality.)
 *
 * The selection chip is intentionally NOT rendered here — DesignWorkspace
 * owns the `design-workspace__selection-chip` element (pinned by
 * `DesignWorkspace.selection.test.tsx`). `selectionLabel` is accepted so a
 * future toolbar read-out can surface it without another prop wave.
 *
 * No `any` types, no inline styles, every interactive element is a
 * `<button type="button">`.
 */

import type { JSX } from 'react'

/** The three cockpit stage contexts mirrored from the mockup stage-tabs. */
export type DesignStage = 'model' | 'sketch' | 'inspect'

export interface ViewportChromeProps {
  /** Currently-active stage tab. */
  readonly stage: DesignStage
  /** Fires when the operator picks a different stage tab. */
  readonly onStageChange: (stage: DesignStage) => void
  /**
   * Friendly label of the current selection (e.g. "Face 4 · 25.0 mm²").
   * Accepted for a future toolbar read-out; the visible chip is owned by
   * DesignWorkspace so this component never duplicates it.
   */
  readonly selectionLabel: string | null
  /** True while the CadQuery code drawer is open (drives the pressed state). */
  readonly codeOpen: boolean
  /** Toggles the CadQuery code drawer open/closed. */
  readonly onToggleCode: () => void
}

/** Ordered stage-tab definitions (mockup `.stage-tabs`). */
const STAGES: ReadonlyArray<{ id: DesignStage; label: string }> = [
  { id: 'model', label: 'Model' },
  { id: 'sketch', label: 'Sketch' },
  { id: 'inspect', label: 'Inspect' },
]

/**
 * Decorative navigation buttons (orbit / pan / zoom-fit). No handlers yet —
 * there is no live viewport to drive. SVG paths are ported verbatim from
 * `docs/ui-mockups/index.html` `.vp-toolbar`.
 */
export function ViewportChrome({
  stage,
  onStageChange,
  selectionLabel,
  codeOpen,
  onToggleCode,
}: ViewportChromeProps): JSX.Element {
  return (
    <>
      {/* ── Viewport toolbar (mockup .vp-toolbar) ───────────────────── */}
      <div
        className="dc-vp-toolbar"
        role="toolbar"
        aria-label="Viewport tools"
        data-testid="design-cockpit-vp-toolbar"
      >
        <button
          type="button"
          className="dc-iconbtn"
          title="Orbit"
          aria-label="Orbit"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M20 12a8 8 0 0 1-8 8M4 12a8 8 0 0 1 8-8"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M9 20l-1-3 3 1M15 4l1 3-3-1"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        <button
          type="button"
          className="dc-iconbtn"
          title="Pan"
          aria-label="Pan"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </svg>
        </button>
        <button
          type="button"
          className="dc-iconbtn"
          title="Zoom fit"
          aria-label="Zoom fit"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M20 20l-4.5-4.5M11 8v6M8 11h6"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        <span className="dc-vp-toolbar-sep" aria-hidden="true" />
        <button
          type="button"
          className="dc-iconbtn"
          title="Section"
          aria-label="Section"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 4h16v16" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M4 4 20 20"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray="3 2"
            />
          </svg>
        </button>
        <button
          type="button"
          className="dc-iconbtn"
          title="Measure"
          aria-label="Measure"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M3 9l6-6 12 12-6 6L3 9Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M7 7l2 2M10 4l3 3M13 7l2 2M16 10l3 3"
              stroke="currentColor"
              strokeWidth="1.3"
            />
          </svg>
        </button>
        <span className="dc-vp-toolbar-sep" aria-hidden="true" />
        <button
          type="button"
          className={
            codeOpen ? 'dc-iconbtn dc-iconbtn--code dc-iconbtn--on' : 'dc-iconbtn dc-iconbtn--code'
          }
          title="Toggle CadQuery code"
          aria-label="Toggle CadQuery code"
          aria-pressed={codeOpen}
          data-testid="design-cockpit-code-toggle"
          onClick={onToggleCode}
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="dc-iconbtn-label">Code</span>
        </button>
      </div>

      {/* ── Stage tabs (mockup .stage-tabs) ─────────────────────────── */}
      <div
        className="dc-stage-tabs"
        role="tablist"
        aria-label="Design stage"
        data-testid="design-cockpit-stage-tabs"
      >
        {STAGES.map((s) => {
          const isActive = stage === s.id
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`design-cockpit-stage-${s.id}`}
              className={isActive ? 'dc-stage-tab dc-stage-tab--on' : 'dc-stage-tab'}
              onClick={() => onStageChange(s.id)}
            >
              {s.label}
            </button>
          )
        })}
      </div>

      {/* ── Viewcube (mockup .viewcube) ─────────────────────────────── */}
      <svg
        className="dc-viewcube"
        viewBox="0 0 100 100"
        aria-hidden="true"
        data-testid="design-cockpit-viewcube"
      >
        <path
          d="M50 12 86 30 50 48 14 30Z"
          fill="var(--bg3)"
          stroke="var(--border-hi)"
        />
        <path
          d="M14 30 50 48 50 88 14 70Z"
          fill="var(--bg2)"
          stroke="var(--border-hi)"
        />
        <path
          d="M86 30 50 48 50 88 86 70Z"
          fill="var(--bg0)"
          stroke="var(--border-hi)"
        />
        <text
          x="50"
          y="34"
          textAnchor="middle"
          fontSize="11"
          fill="var(--txt1)"
          fontFamily="var(--font)"
        >
          TOP
        </text>
        <text
          x="31"
          y="60"
          textAnchor="middle"
          fontSize="10"
          fill="var(--txt2)"
          fontFamily="var(--font)"
        >
          FNT
        </text>
        <text
          x="69"
          y="60"
          textAnchor="middle"
          fontSize="10"
          fill="var(--txt2)"
          fontFamily="var(--font)"
        >
          RT
        </text>
        {selectionLabel !== null && <title>{selectionLabel}</title>}
      </svg>

      {/* ── Axis triad (mockup .triad) ──────────────────────────────── */}
      <svg
        className="dc-triad"
        viewBox="0 0 100 100"
        aria-hidden="true"
        data-testid="design-cockpit-triad"
      >
        <g strokeWidth="2.4" fill="none">
          <path d="M50 60 L50 24" stroke="#5b9bff" />
          <path d="M50 60 L82 76" stroke="#ff5b5b" />
          <path d="M50 60 L18 76" stroke="#4bd06a" />
        </g>
        <text x="50" y="18" fontSize="11" fill="#5b9bff" textAnchor="middle">
          Z
        </text>
        <text x="88" y="80" fontSize="11" fill="#ff5b5b">
          X
        </text>
        <text x="8" y="80" fontSize="11" fill="#4bd06a">
          Y
        </text>
        <circle cx="50" cy="60" r="3" fill="var(--txt1)" />
      </svg>
    </>
  )
}

export default ViewportChrome
