/**
 * ViewportChrome — the slim Design-cockpit overlay chrome that sits ON TOP
 * of the live {@link Viewport3D} center pane.
 *
 * FG-2 (mount the real Viewport3D) retired this component's decorative
 * navigation surface. `Viewport3D` now brings its OWN viewcube
 * (drei `GizmoViewcube`), orientation triad (`GizmoHelper`), standard-view
 * HUD (ISO/Top/Front/Right/Home), Orbit/Pan/Zoom nav strip, and
 * measurement tool — so the previous decorative orbit/pan/zoom/section/
 * measure toolbar, the SVG viewcube, and the SVG triad were DELETED here to
 * remove the duplication the Wave-0 audit flagged (two viewcubes, two
 * triads, two orbit/pan/zoom sets).
 *
 * What remains is the one piece the live viewport does NOT provide, which is
 * genuinely wired:
 *
 *   1. The `Code </>` toggle button — calls `onToggleCode` and paints a
 *      pressed state (`aria-pressed`) when the CadQuery code drawer is open.
 *
 * The Model / Sketch / Inspect stage-tabs were RETIRED as redundant chrome:
 * sketch entry/exit is driven by the Design ribbon (`armSketchMode`), the
 * viewport face-pick (`onSketchPlanePicked` → `onSketchEnter`), and the
 * in-sketch exit button — the tabs were a presentational duplicate.
 *
 * The selection chip is intentionally NOT rendered here — DesignWorkspace
 * owns the `design-workspace__selection-chip` element (pinned by
 * `DesignWorkspace.selection.test.tsx`).
 *
 * No `any` types, no inline styles, every interactive element is a
 * `<button type="button">`.
 */

import type { JSX } from 'react'

export interface ViewportChromeProps {
  /** True while the CadQuery code drawer is open (drives the pressed state). */
  readonly codeOpen: boolean
  /** Toggles the CadQuery code drawer open/closed. */
  readonly onToggleCode: () => void
  /**
   * When false, the CadQuery code `</>` toggle is hidden entirely (the no-code cockpit default the
   * operator can opt into). Defaults true so existing mounts/pins are byte-identical.
   */
  readonly showCodeToggle?: boolean
}

/**
 * Slim chrome overlay for the live viewport: just the optional Code drawer toggle (in a minimal
 * floating pill). The navigation/viewcube/triad chrome lives inside {@link Viewport3D}, and the
 * Model / Sketch / Inspect stage-tabs were retired (sketch entry/exit is ribbon- + face-pick-driven).
 */
export function ViewportChrome({
  codeOpen,
  onToggleCode,
  showCodeToggle = true,
}: ViewportChromeProps): JSX.Element {
  return (
    <>
      {/* ── Viewport toolbar (mockup .vp-toolbar) — optional Code drawer toggle.
          Orbit / Pan / Zoom / Section / Measure moved into Viewport3D's HUD. */}
      {showCodeToggle && (
      <div
        className="dc-vp-toolbar"
        role="toolbar"
        aria-label="Viewport tools"
        data-testid="design-cockpit-vp-toolbar"
      >
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
      )}
    </>
  )
}

export default ViewportChrome
