import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useUI } from '../contexts/UIContext'
import {
  SHELL_COMMANDS,
  SHELL_COMMAND_IDS,
  buildPaletteRows,
  groupPaletteRows,
  useCommandEngine,
  type PaletteRow
} from '../commands'
import { pushRecentCommandId, readRecentCommandIds } from '../commands/command-palette-memory'

/**
 * Command-palette wrapper for the new WorkTrack3D shell.
 *
 * ## FG-4b — palette reconciliation
 * This palette previously hand-listed ~17 rows (6 nav + Settings + Help + theme
 * rows) and searched only those. It now renders the **entire command surface**:
 * the synthetic shell commands ({@link SHELL_COMMANDS}, registered as handlers by
 * `registerStarterCommands` in `AppShell`) **plus** every entry in
 * `FUSION_STYLE_COMMAND_CATALOG`, joined to its handler + computed enablement by
 * the Context Engine (`useCommandEngine().resolve`). Picking a row dispatches the
 * one true `runCommand(id, ctx)` path (`engine.run(id)`), so the palette, the
 * (forthcoming) ribbon, and any menu run the same `command.id`.
 *
 * The rich `src/renderer/commands/CommandPalette.tsx` had these capabilities but
 * `onPick` had no production caller and it renders against unstyled
 * `.command-palette-*` classes. Rather than ship that unstyled modal, its
 * capabilities are ported here onto the already-themed `.cmd-*` styling:
 *   - status badges on catalog rows (`implemented` / `partial` / `planned`),
 *   - **greyed / disabled rows** for ids with no registered handler (or whose
 *     `enabled(ctx)` is false) — the engine's honest "shows but not wired yet",
 *   - recency-first ordering on an empty query (shared `command-palette-memory`),
 *   - the full keyboard model (↑↓ · Home/End · PgUp/PgDn · Enter · Esc),
 *   - an "Implemented only" toggle (default off, so the full catalog + the
 *     honest greying are visible by default),
 *   - matched-substring highlight.
 *
 * The "Open Command palette" shell row is filtered out (opening the palette from
 * inside it is redundant) but stays registered for the ribbon/menus.
 */

/** Rows skipped per PageUp / PageDown (approx. one viewport chunk). */
const PALETTE_PAGE_STEP = 8

/** Highlight the matched substring of `text` for the current query. */
function highlight(text: string, q: string): ReactNode {
  const query = q.trim()
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="cmd-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

/**
 * New-shell command palette. Renders nothing unless `useUI().cmdOpen` is true.
 *
 * Rows are the full command surface (shell commands + resolved catalog),
 * filtered by the live search + the Implemented-only toggle and ordered
 * recent-first on an empty query. Selecting a row dispatches `engine.run(id)`
 * against the live command context; disabled rows (no handler / not applicable)
 * are inert.
 */
export function NewShellCommandPalette(): ReactElement | null {
  const { cmdOpen, setCmdOpen } = useUI()
  const engine = useCommandEngine()

  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [implementedOnly, setImplementedOnly] = useState(false)
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentCommandIds())
  const inputRef = useRef<HTMLInputElement>(null)

  const close = (): void => setCmdOpen(false)

  // Reset transient state + refresh recency each time the palette opens.
  useEffect(() => {
    if (!cmdOpen) return
    setQuery('')
    setActiveIdx(0)
    setRecentIds(readRecentCommandIds())
    queueMicrotask(() => inputRef.current?.focus())
  }, [cmdOpen])

  // The shell rows minus the redundant "open palette" entry.
  const shell = useMemo(
    () => SHELL_COMMANDS.filter((c) => c.id !== SHELL_COMMAND_IDS.openCommandPalette),
    []
  )

  // The whole catalog joined with handlers + enablement for the live context.
  // `filterByWorkspace: false` ⇒ the palette searches every command, not just
  // the active workspace's. `engine` re-memoizes when the context changes, so
  // enablement (e.g. selection-gated rows) stays current.
  const resolvedCatalog = useMemo(() => engine.resolve({ filterByWorkspace: false }), [engine])

  const rows = useMemo<PaletteRow[]>(
    () =>
      buildPaletteRows({
        shell,
        catalog: resolvedCatalog,
        query,
        recentIds,
        implementedOnly
      }),
    [shell, resolvedCatalog, query, recentIds, implementedOnly]
  )

  // Keep the active index in range as the row set changes.
  useEffect(() => {
    setActiveIdx((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)))
  }, [rows.length])

  // Scroll the active row into view.
  useEffect(() => {
    if (!cmdOpen || rows.length === 0) return
    const id = rows[activeIdx]?.id
    if (!id) return
    document.getElementById(`cmd-row-${id}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, cmdOpen, rows])

  const groups = useMemo(() => groupPaletteRows(rows), [rows])

  if (!cmdOpen) return null

  const pick = (row: PaletteRow | undefined): void => {
    if (!row || !row.enabled) return
    const ran = engine.run(row.id)
    if (ran) {
      pushRecentCommandId(row.id)
      setRecentIds(readRecentCommandIds())
    }
    close()
  }

  const handleKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (rows.length === 0) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, rows.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActiveIdx(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIdx(rows.length - 1)
        break
      case 'PageDown':
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + PALETTE_PAGE_STEP, rows.length - 1))
        break
      case 'PageUp':
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - PALETTE_PAGE_STEP, 0))
        break
      case 'Enter':
        e.preventDefault()
        pick(rows[activeIdx])
        break
      default:
        break
    }
  }

  const activeRowId = rows[activeIdx]?.id
  let flatIdx = 0

  return (
    <div
      className="cmd-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={close}
    >
      <div className="cmd-box" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-row">
          <span className="cmd-icon" aria-hidden="true">
            {'⌘'}
          </span>
          <input
            type="text"
            ref={inputRef}
            className="cmd-input"
            placeholder={'Search commands…'}
            aria-label="Search commands"
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-autocomplete="list"
            aria-controls="cmd-results-list"
            aria-activedescendant={activeRowId ? `cmd-row-${activeRowId}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIdx(0)
            }}
            onKeyDown={handleKey}
          />
          <label className="cmd-implemented-toggle">
            <input
              type="checkbox"
              checked={implementedOnly}
              onChange={(e) => {
                setImplementedOnly(e.target.checked)
                setActiveIdx(0)
              }}
            />
            Implemented only
          </label>
          <kbd className="cmd-esc-hint" aria-hidden="true">
            Esc
          </kbd>
        </div>
        <div className="cmd-results" id="cmd-results-list" role="listbox">
          {rows.length === 0 && <div className="text-muted cmd-empty">No commands match</div>}
          {groups.map((g) => (
            <Fragment key={g.group}>
              <div className="cmd-group-label" role="presentation">
                {g.group}
              </div>
              {g.rows.map((row) => {
                const myIdx = flatIdx++
                const isActive = myIdx === activeIdx
                return (
                  <div
                    key={row.id}
                    id={`cmd-row-${row.id}`}
                    role="option"
                    aria-selected={isActive}
                    aria-disabled={!row.enabled}
                    className={[
                      'cmd-item',
                      isActive ? 'cmd-item--active' : '',
                      row.enabled ? '' : 'cmd-item--disabled'
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onMouseEnter={() => setActiveIdx(myIdx)}
                    onClick={() => pick(row)}
                  >
                    <span className="cmd-item-icon" aria-hidden="true">
                      {row.icon ?? '•'}
                    </span>
                    <span className="cmd-item-label">{highlight(row.label, query)}</span>
                    {row.meta ? <span className="cmd-item-meta">{row.meta}</span> : null}
                    {row.status ? (
                      <span className={`cmd-status cmd-status--${row.status}`}>{row.status}</span>
                    ) : null}
                    {row.keybinding ? <kbd className="cmd-item-kbd">{row.keybinding}</kbd> : null}
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
        <div className="cmd-footer" role="presentation">
          ↑↓ navigate · PgUp/PgDn page · Home/End first/last · Enter run · Esc close
        </div>
      </div>
    </div>
  )
}
