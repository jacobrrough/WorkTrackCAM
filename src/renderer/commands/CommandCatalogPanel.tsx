import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import {
  type CommandParityStatus,
  type CommandRibbonGroup,
  COMMAND_CATALOG_RIBBON_FILTER_OPTIONS,
  type CommandShellWorkspace,
  FUSION_STYLE_COMMAND_CATALOG,
  catalogStats,
  filterCatalog
} from '../../shared/fusion-style-command-catalog'
import {
  readPersistedCommandCatalogQuery,
  readPersistedCommandCatalogRibbon,
  readPersistedCommandCatalogStatus,
  readPersistedCommandCatalogWorkspace,
  writePersistedCommandCatalogQuery,
  writePersistedCommandCatalogRibbon,
  writePersistedCommandCatalogStatus,
  writePersistedCommandCatalogWorkspace
} from '../shell/workspaceMemory'

const WORKSPACES: { id: CommandShellWorkspace | 'all'; label: string }[] = [
  { id: 'all', label: 'All workspaces' },
  { id: 'design', label: 'Design' },
  { id: 'assemble', label: 'Assemble' },
  { id: 'manufacture', label: 'Manufacture' },
  { id: 'utilities', label: 'File' }
]

const STATUSES: { id: CommandParityStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'Any status' },
  { id: 'implemented', label: 'Implemented' },
  { id: 'partial', label: 'Partial' },
  { id: 'planned', label: 'Planned' }
]

type Props = {
  onStatus?: (msg: string) => void
}

export function CommandCatalogPanel({ onStatus }: Props) {
  const statsDescId = useId()
  const searchId = useId()
  const workspaceFilterId = useId()
  const statusFilterId = useId()
  const ribbonFilterId = useId()

  const [q, setQ] = useState(() => readPersistedCommandCatalogQuery(''))
  const [workspace, setWorkspace] = useState<CommandShellWorkspace | 'all'>(() =>
    readPersistedCommandCatalogWorkspace('all')
  )
  const [status, setStatus] = useState<CommandParityStatus | 'all'>(() => readPersistedCommandCatalogStatus('all'))
  const [ribbon, setRibbon] = useState<CommandRibbonGroup | 'all'>(() => readPersistedCommandCatalogRibbon('all'))

  const stats = useMemo(() => catalogStats(), [])
  const rows = useMemo(
    () =>
      filterCatalog(FUSION_STYLE_COMMAND_CATALOG, {
        q,
        workspace,
        status,
        ribbon
      }),
    [q, workspace, status, ribbon]
  )

  const grouped = useMemo(() => {
    const m = new Map<string, typeof rows>()
    for (const row of rows) {
      const key = row.ribbon
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(row)
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [rows])

  const resetFilters = useCallback(() => {
    setQ('')
    setWorkspace('all')
    setStatus('all')
    setRibbon('all')
  }, [])

  const openCommandPalette = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true
      })
    )
  }, [])

  useEffect(() => writePersistedCommandCatalogQuery(q), [q])
  useEffect(() => writePersistedCommandCatalogWorkspace(workspace), [workspace])
  useEffect(() => writePersistedCommandCatalogStatus(status), [status])
  useEffect(() => writePersistedCommandCatalogRibbon(ribbon), [ribbon])

  return (
    <section
      className="panel workspace-util-panel command-catalog"
      aria-labelledby="command-catalog-heading"
    >
      <h2 id="command-catalog-heading">Command catalog (CAD-style coverage)</h2>
      <p className="msg util-panel-intro">
        Inventory aligned with common parametric CAD workflows (e.g. sketch → constrain → solid → assemble → manufacture).{' '}
        <strong>Planned</strong> means not built here yet — not a promise of 1:1 behavior with any commercial product.
        Use <strong>Ctrl+K</strong> / <strong>⌘K</strong> to run these commands from the palette (recent commands show
        first when search is empty).
      </p>
      <p className="msg command-catalog-safety">
        Slice and CAM outputs are <strong>unverified</strong> for real machines until you validate posts, units, and
        clearances (<code>docs/MACHINES.md</code>).
      </p>
      <p id={statsDescId} className="command-catalog-stats">
        <span className="ok">{stats.implemented} implemented</span>
        {' · '}
        <span className="msg">{stats.partial} partial</span>
        {' · '}
        <span className="muted-stat">{stats.planned} planned</span>
        {' — '}
        <strong>{FUSION_STYLE_COMMAND_CATALOG.length}</strong> total
      </p>

      <h3 className="subh util-section-heading" id="command-catalog-filters-heading">
        Filters
      </h3>
      <div
        className="command-catalog-filters row"
        role="group"
        aria-labelledby="command-catalog-filters-heading"
      >
        <label className="command-catalog-search" htmlFor={searchId}>
          Search
          <input
            id={searchId}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. fillet, pattern, joint"
            autoComplete="off"
            aria-describedby={statsDescId}
          />
        </label>
        <label htmlFor={workspaceFilterId}>
          Workspace
          <select
            id={workspaceFilterId}
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value as typeof workspace)}
          >
            {WORKSPACES.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={statusFilterId}>
          Status
          <select
            id={statusFilterId}
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ribbonFilterId}>
          Ribbon group
          <select
            id={ribbonFilterId}
            value={ribbon}
            onChange={(e) => setRibbon(e.target.value as typeof ribbon)}
          >
            {COMMAND_CATALOG_RIBBON_FILTER_OPTIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary command-catalog-open-palette" onClick={openCommandPalette}>
          Open command palette (Ctrl+K / ⌘K)
        </button>
      </div>

      <h3 className="subh util-section-heading" id="command-catalog-results-heading">
        Catalog entries
      </h3>
      <div className="command-catalog-list" role="region" aria-labelledby="command-catalog-results-heading">
        {rows.length === 0 ? (
          <div className="command-catalog-empty" role="status" aria-live="polite">
            <p className="command-catalog-empty-title">No commands match these filters</p>
            <p className="command-catalog-empty-hint">
              Clear the search, set workspace to <strong>All workspaces</strong>, status to <strong>Any status</strong>,
              and ribbon to <strong>Any ribbon</strong> to see the full catalog again.
            </p>
            <button type="button" className="secondary command-catalog-reset-filters" onClick={resetFilters}>
              Reset filters
            </button>
          </div>
        ) : (
          grouped.map(([group, items]) => (
            <details key={group} className="command-catalog-group" open>
              <summary aria-label={`${group} command group`}>
                {COMMAND_CATALOG_RIBBON_FILTER_OPTIONS.find((r) => r.id === group)?.label ?? group}{' '}
                <span className="msg">({items.length})</span>
              </summary>
              <ul
                className="command-catalog-ul"
                aria-label={`${COMMAND_CATALOG_RIBBON_FILTER_OPTIONS.find((r) => r.id === group)?.label ?? group} commands`}
              >
                {items.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="command-catalog-row"
                      onClick={() =>
                        onStatus?.(
                          `${row.label} — ${row.status}${row.notes ? ` (${row.notes})` : ''}. Use the matching workspace ribbon when available.`
                        )
                      }
                    >
                      <span className={`command-status command-status--${row.status}`}>{row.status}</span>
                      <span className="command-label">{row.label}</span>
                      <span className="command-meta">
                        {row.workspace}
                        {row.fusionRibbon ? ` · ${row.fusionRibbon}` : ''}
                      </span>
                    </button>
                    {row.notes && <p className="command-notes">{row.notes}</p>}
                  </li>
                ))}
              </ul>
            </details>
          ))
        )}
      </div>
    </section>
  )
}
