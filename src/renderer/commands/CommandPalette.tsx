import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { matchesCommandPaletteToggle } from '../../shared/app-keyboard-shortcuts'
import {
  type CommandRibbonGroup,
  type CommandShellWorkspace,
  COMMAND_CATALOG_RIBBON_FILTER_OPTIONS,
  type FusionStyleCommand,
  FUSION_STYLE_COMMAND_CATALOG,
  filterCatalog
} from '../../shared/fusion-style-command-catalog'
import {
  orderRowsByRecent,
  rowMatchesPaletteQuery
} from './command-palette-search'
import {
  pushRecentCommandId,
  readPaletteFilters,
  readRecentCommandIds,
  writePaletteFilters
} from './command-palette-memory'
import { USER_VISIBLE } from '../shell/userVisibleStrings'

function focusablesIn(el: HTMLElement): HTMLElement[] {
  const nodes = el.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )
  return Array.from(nodes).filter((n) => !n.closest('[inert]') && n.tabIndex !== -1)
}

/** Rows to skip per PageUp / PageDown (approx. one viewport chunk). */
const PALETTE_PAGE_STEP = 8

const PALETTE_WORKSPACES: { id: CommandShellWorkspace | 'all'; label: string }[] = [
  { id: 'all', label: 'All workspaces' },
  { id: 'design', label: 'Design' },
  { id: 'assemble', label: 'Assemble' },
  { id: 'manufacture', label: 'Manufacture' },
  { id: 'utilities', label: 'File' }
]

export type CommandPaletteProps = {
  open: boolean
  onClose: () => void
  /** Invoked when user confirms a row (Enter or click). */
  onPick: (cmd: FusionStyleCommand) => void
}

/**
 * Modal command palette over `FUSION_STYLE_COMMAND_CATALOG`.
 * Default filter: **implemented** only (toggle to include partial/planned).
 */
export function CommandPalette({ open, onClose, onPick }: CommandPaletteProps) {
  const [q, setQ] = useState('')
  const [implementedOnly, setImplementedOnly] = useState(() => readPaletteFilters().implementedOnly)
  const [workspaceFilter, setWorkspaceFilter] = useState<CommandShellWorkspace | 'all'>(
    () => readPaletteFilters().workspaceFilter
  )
  const [ribbonFilter, setRibbonFilter] = useState<CommandRibbonGroup | 'all'>(
    () => readPaletteFilters().ribbonFilter
  )
  const [recentIds, setRecentIds] = useState<string[]>(() => readRecentCommandIds())
  const [active, setActive] = useState(0)
  const hasNonDefaultFilters = implementedOnly !== true || workspaceFilter !== 'all' || ribbonFilter !== 'all'

  const resetPaletteFilters = useCallback(() => {
    setImplementedOnly(true)
    setWorkspaceFilter('all')
    setRibbonFilter('all')
    setQ('')
  }, [])

  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const base = filterCatalog(FUSION_STYLE_COMMAND_CATALOG, {
      q: '',
      workspace: workspaceFilter,
      status: implementedOnly ? 'implemented' : 'all',
      ribbon: ribbonFilter
    })
    const filtered = base.filter((row) => rowMatchesPaletteQuery(row, q))
    const qEmpty = q.trim() === ''
    return orderRowsByRecent(filtered, recentIds, qEmpty)
  }, [q, implementedOnly, workspaceFilter, ribbonFilter, recentIds])
  const qEmpty = q.trim() === ''

  useEffect(() => {
    if (!open) return
    const f = readPaletteFilters()
    setImplementedOnly(f.implementedOnly)
    setWorkspaceFilter(f.workspaceFilter)
    setRibbonFilter(f.ribbonFilter)
    setRecentIds(readRecentCommandIds())
    setActive(0)
    setQ('')
    queueMicrotask(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    if (open) return
    writePaletteFilters({ implementedOnly, workspaceFilter, ribbonFilter })
  }, [open, implementedOnly, workspaceFilter, ribbonFilter])

  useEffect(() => {
    setActive((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)))
  }, [rows])

  useEffect(() => {
    if (!open || rows.length === 0) return
    const id = rows[active]?.id
    if (!id) return
    const rowEl = document.getElementById(`cmd-palette-${id}`)
    rowEl?.scrollIntoView({ block: 'nearest' })
  }, [active, open, rows])

  useEffect(() => {
    if (!open) return
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const list = focusablesIn(root)
      if (list.length === 0) return
      const activeEl = document.activeElement
      if (!activeEl || !root.contains(activeEl)) return
      const i = list.indexOf(activeEl as HTMLElement)
      if (i < 0) return
      if (!e.shiftKey && i === list.length - 1) {
        e.preventDefault()
        list[0]?.focus()
      } else if (e.shiftKey && i === 0) {
        e.preventDefault()
        list[list.length - 1]?.focus()
      }
    }
    document.addEventListener('keydown', onTab, true)
    return () => document.removeEventListener('keydown', onTab, true)
  }, [open, rows])

  const confirm = useCallback(
    (cmd: FusionStyleCommand | undefined) => {
      if (!cmd) return
      pushRecentCommandId(cmd.id)
      setRecentIds(readRecentCommandIds())
      onPick(cmd)
      onClose()
    },
    [onPick, onClose]
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown' && rows.length) {
        e.preventDefault()
        setActive((i) => Math.min(i + 1, rows.length - 1))
        return
      }
      if (e.key === 'ArrowUp' && rows.length) {
        e.preventDefault()
        setActive((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Home' && rows.length) {
        e.preventDefault()
        setActive(0)
        return
      }
      if (e.key === 'End' && rows.length) {
        e.preventDefault()
        setActive(rows.length - 1)
        return
      }
      if (e.key === 'PageDown' && rows.length) {
        e.preventDefault()
        setActive((i) => Math.min(i + PALETTE_PAGE_STEP, rows.length - 1))
        return
      }
      if (e.key === 'PageUp' && rows.length) {
        e.preventDefault()
        setActive((i) => Math.max(i - PALETTE_PAGE_STEP, 0))
        return
      }
      if (e.key === 'Enter' && rows.length) {
        const cmd = rows[active]
        if (cmd) {
          e.preventDefault()
          confirm(cmd)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, rows, active, onClose, confirm])

  if (!open) return null

  return (
    <div className="command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        aria-describedby="command-palette-hint"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="command-palette-head">
          <input
            ref={inputRef}
            className="command-palette-input"
            placeholder="Search commands…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            aria-activedescendant={rows[active] ? `cmd-palette-${rows[active].id}` : undefined}
          />
          <div className="command-palette-filters">
            <label className="command-palette-workspace">
              <span className="sr-only">Workspace</span>
              <select
                value={workspaceFilter}
                onChange={(e) => setWorkspaceFilter(e.target.value as CommandShellWorkspace | 'all')}
                aria-label="Filter by workspace"
              >
                {PALETTE_WORKSPACES.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="command-palette-ribbon">
              <span className="sr-only">Ribbon group</span>
              <select
                value={ribbonFilter}
                onChange={(e) => setRibbonFilter(e.target.value as CommandRibbonGroup | 'all')}
                aria-label="Filter by ribbon group"
              >
                {COMMAND_CATALOG_RIBBON_FILTER_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="command-palette-toggle">
              <input
                type="checkbox"
                checked={implementedOnly}
                onChange={(e) => setImplementedOnly(e.target.checked)}
              />
              Implemented only
            </label>
            {hasNonDefaultFilters ? (
              <button type="button" className="secondary command-palette-reset-filters" onClick={resetPaletteFilters}>
                Reset filters
              </button>
            ) : null}
          </div>
        </div>
        <p className="command-palette-hint" role="status" aria-live="polite">
          {qEmpty
            ? USER_VISIBLE.commandPaletteEmptyQueryHint
            : `${rows.length} match${rows.length === 1 ? '' : 'es'} in current filters.`}
        </p>
        <ul id="command-palette-list" className="command-palette-list" role="listbox" aria-multiselectable={false}>
          {rows.length === 0 ? (
            <li className="command-palette-empty" role="presentation">
              <span className="command-palette-empty-title">No matching commands</span>
              <span className="command-palette-empty-hint">
                Try a different search, set workspace or ribbon to <strong>All</strong> / <strong>Any ribbon</strong>, or
                turn off “Implemented only” to include planned and partial commands.
              </span>
              <button
                type="button"
                className="secondary command-palette-reset-filters"
                onClick={resetPaletteFilters}
              >
                Reset palette filters
              </button>
            </li>
          ) : (
            rows.map((row, i) => (
              <li key={row.id} role="presentation">
                <button
                  type="button"
                  id={`cmd-palette-${row.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={`command-palette-row ${i === active ? 'is-active' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => confirm(row)}
                >
                  <span className={`command-status command-status--${row.status}`}>{row.status}</span>
                  <span className="command-palette-label">{row.label}</span>
                  <span className="command-palette-meta">
                    {row.workspace}
                    {row.fusionRibbon ? ` · ${row.fusionRibbon}` : ''}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <p id="command-palette-hint" className="command-palette-hint">
          {USER_VISIBLE.commandPaletteFooter}
        </p>
      </div>
    </div>
  )
}

/** @deprecated Prefer `useShellKeyboardShortcuts` so palette + reference shortcuts stay in one place. */
export function useCommandPaletteShortcut(onOpenToggle: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesCommandPaletteToggle(e)) {
        e.preventDefault()
        onOpenToggle()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onOpenToggle])
}
