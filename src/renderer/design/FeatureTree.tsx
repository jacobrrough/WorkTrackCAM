/**
 * FeatureTree — read-only feature tree for the parametric Design
 * workspace (BUILD 4, Cycle 233 CAD MVP).
 *
 * Renders the operations list returned by the Python sidecar's
 * `cad.list_operations` RPC. Pure presentation -- no state of its own,
 * no side effects. The parent DesignWorkspace owns the operations
 * array and re-renders this component whenever the debounced
 * `cad.list_operations` call returns.
 *
 * Contract (pinned by `FeatureTree.test.tsx`):
 *   1. When `operations.length === 0` the tree renders the shared
 *      `EmptyState` component (CLAUDE.md rule: do NOT roll your own
 *      empty-state markup -- extend EmptyState instead). Title:
 *      "No operations yet". Body: "Write a CadQuery script and hit
 *      Run." Testid: `cad-feature-empty-state`.
 *   2. When `operations.length > 0` the tree renders an ordered list
 *      where each row exposes:
 *        - the script line number (left gutter, monospace)
 *        - the op name (e.g. `extrude`)
 *        - the truncated args summary (e.g. `distance=12, taper=3`)
 *      Each row gets `data-testid="cad-feature-row"` plus
 *      `data-line="{N}"` so integration tests can pin a specific row.
 *   3. If `onLineClick` is supplied, clicking a row invokes it with
 *      the row's line number. Without that prop the row stays a
 *      pure list item (no `role="button"`).
 *   4. Args longer than `ARGS_MAX_CHARS` are truncated with a
 *      Unicode ellipsis (`U+2026`). The full args string is preserved
 *      in the row's `title` attribute so the operator can hover to
 *      see the full text.
 *   5. The op name + args render in monospace via the
 *      `cad-feature-row__op` / `cad-feature-row__args` classes owned
 *      by Agent 6 (CSS). No inline styles in this component.
 *
 * No `any` types -- the `operations` prop is `ReadonlyArray<...>` so
 * the parent can pass either a frozen array or a mutable one without
 * the component being able to mutate it.
 */

import { type JSX } from 'react'
import { EmptyState } from '../src/EmptyState'

export interface FeatureTreeOperation {
  /** 1-based script line number where this operation was emitted. */
  readonly line: number
  /** Op name, e.g. `extrude`, `box`, `fillet`. */
  readonly op: string
  /**
   * Pre-formatted args string, e.g. `distance=12, taper=3`. The
   * sidecar is responsible for formatting -- this component truncates
   * for display but never re-parses.
   */
  readonly args: string
}

export interface FeatureTreeProps {
  /** Operations to render, in script order. */
  readonly operations: ReadonlyArray<FeatureTreeOperation>
  /**
   * Optional callback when the operator clicks a row. Wired up by
   * DesignWorkspace to seek the CadQueryEditor cursor to the matching
   * script line. When omitted, rows are presentational only.
   */
  readonly onLineClick?: (line: number) => void
}

/**
 * Max characters of an args string we render inline before truncating
 * with an ellipsis. Tuned against the right-panel min-width in the
 * three-pane Design workspace layout (~280 px) -- 48 chars fits a
 * single line at the tokens.css `--mono` 12 px default without
 * overflowing into the line-number gutter.
 */
const ARGS_MAX_CHARS = 48
const ELLIPSIS = '…'

function truncateArgs(args: string): string {
  if (args.length <= ARGS_MAX_CHARS) return args
  return args.slice(0, ARGS_MAX_CHARS - 1) + ELLIPSIS
}

export function FeatureTree(props: FeatureTreeProps): JSX.Element {
  const { operations, onLineClick } = props

  if (operations.length === 0) {
    return (
      <EmptyState
        testId="cad-feature-empty-state"
        title="No operations yet"
        body="Write a CadQuery script and hit Run."
      />
    )
  }

  return (
    <ol
      className="cad-feature-tree"
      data-testid="cad-feature-tree"
      aria-label="CadQuery feature tree"
    >
      {operations.map((entry, index) => {
        const truncated = truncateArgs(entry.args)
        const isClickable = onLineClick != null
        const handleClick = isClickable
          ? (): void => onLineClick(entry.line)
          : undefined
        return (
          <li
            // Index is part of the key because the same `line` can in
            // theory appear twice if the operator splits an op across
            // multiple sidecar emissions; line + op disambiguates
            // without forcing the sidecar to mint unique IDs.
            key={`${entry.line}-${index}-${entry.op}`}
            className="cad-feature-row"
            data-testid="cad-feature-row"
            data-line={entry.line}
            data-op={entry.op}
            title={entry.args}
            // Only emit `role="button"` when there's an actual click
            // handler -- otherwise the row stays a presentational
            // `<li>` so screen readers don't announce a fake button.
            {...(isClickable
              ? { role: 'button', tabIndex: 0, onClick: handleClick }
              : {})}
          >
            <span className="cad-feature-row__line" aria-hidden="true">
              {entry.line}
            </span>
            <span className="cad-feature-row__op">{entry.op}</span>
            <span className="cad-feature-row__args">{truncated}</span>
          </li>
        )
      })}
    </ol>
  )
}

export default FeatureTree
