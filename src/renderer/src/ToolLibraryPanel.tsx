/**
 * ToolLibraryPanel — Professional tool library view with search, filter, and CRUD.
 *
 * Extracted from LibraryView's inline "tools" tab into a standalone component
 * so ShopApp can mount it as <ToolLibraryPanel /> and the library panel stays
 * focused on routing between tabs.
 */
import React, { useCallback, useMemo, useState } from 'react'
import type { ToolRecord } from '../../shared/tool-schema'
import type { MachineProfile } from '../../shared/machine-schema'
import type { ContextMenuEntry } from './ContextMenu'
import { ContextMenu } from './ContextMenu'
import {
  searchTools,
  filterTools,
  sortTools,
  createDefaultTool,
  validateTool,
  duplicateTool,
  TOOL_TYPE_LABELS,
  TOOL_TYPE_ICONS,
  TOOL_TYPES,
  type ToolSortKey,
  type SortDirection,
  type ToolFilters
} from './tool-library-utils'
import { ToolWearBadge } from '../manufacture/ToolWearBadge'

// ── Electron API bridge ──────────────────────────────────────────────────────

declare const window: Window & {
  fab: {
    toolsRead: (dir: string) => Promise<{ version: number; tools: ToolRecord[] }>
    toolsSave: (dir: string, lib: { version: 1; tools: ToolRecord[] }) => Promise<void>
    toolsImportFile: (dir: string, filePath: string) => Promise<{ version: number; tools: ToolRecord[] }>
    machineToolsRead: (machineId: string) => Promise<{ version: number; tools: ToolRecord[] }>
    machineToolsSave: (machineId: string, lib: { version: 1; tools: ToolRecord[] }) => Promise<void>
    machineToolsImportFile: (machineId: string, filePath: string) => Promise<{ version: number; tools: ToolRecord[] }>
    dialogOpenFile: (filters: { name: string; extensions: string[] }[], dp?: string) => Promise<string | null>
  }
}
const fab = () => window.fab

// ── Props ────────────────────────────────────────────────────────────────────

export interface ToolLibraryPanelProps {
  tools: ToolRecord[]
  setTools: (tools: ToolRecord[]) => void
  machines: MachineProfile[]
  selectedMachineId: string | null
  setSelectedMachineId: (id: string | null) => void
  onToast: (kind: 'ok' | 'err' | 'warn', msg: string) => void
}

// ── Component ────────────────────────────────────────────────────────────────

export function ToolLibraryPanel({
  tools,
  setTools,
  machines,
  selectedMachineId,
  setSelectedMachineId,
  onToast
}: ToolLibraryPanelProps): React.ReactElement {

  // ── Local state ──────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<ToolRecord['type'] | 'all'>('all')
  const [diameterMin, setDiameterMin] = useState('')
  const [diameterMax, setDiameterMax] = useState('')
  const [sortBy, setSortBy] = useState<ToolSortKey>('name')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')
  const [editingTool, setEditingTool] = useState<ToolRecord | null>(null)
  const [editErrors, setEditErrors] = useState<string[]>([])
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

  // ── Derived data ─────────────────────────────────────────────────────────

  const processedTools = useMemo(() => {
    let result: ToolRecord[] = tools

    // 1. Search
    result = searchTools(result, searchQuery)

    // 2. Structured filters
    const filters: ToolFilters = {}
    if (typeFilter !== 'all') filters.types = [typeFilter]
    const dMin = parseFloat(diameterMin)
    const dMax = parseFloat(diameterMax)
    if (!isNaN(dMin) && dMin > 0) filters.diameterMin = dMin
    if (!isNaN(dMax) && dMax > 0) filters.diameterMax = dMax
    result = filterTools(result, filters)

    // 3. Sort
    result = sortTools(result, sortBy, sortDir)

    return result
  }, [tools, searchQuery, typeFilter, diameterMin, diameterMax, sortBy, sortDir])

  // ── Persistence helpers ──────────────────────────────────────────────────

  const saveTools = useCallback(async (updated: ToolRecord[]) => {
    try {
      if (selectedMachineId) {
        await fab().machineToolsSave(selectedMachineId, { version: 1, tools: updated })
      } else {
        await fab().toolsSave('default', { version: 1, tools: updated })
      }
      setTools(updated)
    } catch (e) {
      onToast('err', `Save failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [selectedMachineId, setTools, onToast])

  // ── CRUD actions ─────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    const newTool = createDefaultTool('endmill')
    setEditingTool(newTool)
    setEditErrors([])
  }, [])

  const handleEdit = useCallback((tool: ToolRecord) => {
    setEditingTool({ ...tool, materialPresets: tool.materialPresets?.map(p => ({ ...p })) })
    setEditErrors([])
  }, [])

  const handleDuplicate = useCallback(async (tool: ToolRecord) => {
    const clone = duplicateTool(tool)
    const updated = [...tools, clone]
    await saveTools(updated)
    onToast('ok', `Duplicated "${tool.name}"`)
  }, [tools, saveTools, onToast])

  const handleDelete = useCallback(async (tool: ToolRecord) => {
    const updated = tools.filter(t => t.id !== tool.id)
    await saveTools(updated)
    onToast('ok', `Deleted "${tool.name}"`)
  }, [tools, saveTools, onToast])

  const handleSave = useCallback(async () => {
    if (!editingTool) return
    const validation = validateTool(editingTool)
    if (!validation.success) {
      setEditErrors(validation.errors ?? ['Unknown validation error'])
      return
    }
    const exists = tools.some(t => t.id === editingTool.id)
    const updated = exists
      ? tools.map(t => t.id === editingTool.id ? editingTool : t)
      : [...tools, editingTool]
    await saveTools(updated)
    setEditingTool(null)
    setEditErrors([])
    onToast('ok', exists ? `Updated "${editingTool.name}"` : `Added "${editingTool.name}"`)
  }, [editingTool, tools, saveTools, onToast])

  const handleCancel = useCallback(() => {
    setEditingTool(null)
    setEditErrors([])
  }, [])

  const handleSlotChange = useCallback(async (tool: ToolRecord, slot: number | undefined) => {
    const updated = tools.map(t => {
      if (t.id === tool.id) return { ...t, toolSlot: slot }
      // Clear conflicting slot assignment
      if (slot != null && t.toolSlot === slot) return { ...t, toolSlot: undefined }
      return t
    })
    await saveTools(updated)
  }, [tools, saveTools])

  const importTools = useCallback(async () => {
    try {
      const path = await fab().dialogOpenFile([{ name: 'Tool Libraries', extensions: ['json', 'csv', 'tools'] }])
      if (!path) return
      if (selectedMachineId) {
        const lib = await fab().machineToolsImportFile(selectedMachineId, path)
        setTools(lib.tools ?? [])
        onToast('ok', `Imported ${lib.tools?.length ?? 0} tools into machine library`)
      } else {
        const lib = await fab().toolsImportFile('default', path)
        setTools(lib.tools ?? [])
        onToast('ok', `Imported ${lib.tools?.length ?? 0} tools into global library`)
      }
    } catch (e) {
      onToast('err', `Tool import failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [selectedMachineId, setTools, onToast])

  // ── Context menu ─────────────────────────────────────────────────────────

  const showCtx = useCallback((e: React.MouseEvent, tool: ToolRecord) => {
    e.preventDefault()
    const items: ContextMenuEntry[] = [
      { id: 'edit', label: 'Edit', icon: '\u270F', action: () => handleEdit(tool) },
      { id: 'duplicate', label: 'Duplicate', icon: '\u29C9', action: () => void handleDuplicate(tool) },
      { separator: true },
      { id: 'delete', label: 'Delete', icon: '\uD83D\uDDD1', danger: true, action: () => void handleDelete(tool) }
    ]
    setCtxMenu({ x: e.clientX, y: e.clientY, items })
  }, [handleEdit, handleDuplicate, handleDelete])

  // ── Sort toggle helper ─────────────────────────────────────────────────

  const toggleSort = useCallback((key: ToolSortKey) => {
    if (sortBy === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir('asc')
    }
  }, [sortBy])

  const sortIndicator = (key: ToolSortKey): string =>
    sortBy === key ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''

  const hasActiveFilters = searchQuery !== '' || typeFilter !== 'all' || diameterMin !== '' || diameterMax !== ''

  // ── Edit form field updater ────────────────────────────────────────────

  const updateField = useCallback(<K extends keyof ToolRecord>(field: K, value: ToolRecord[K]) => {
    setEditingTool(prev => prev ? { ...prev, [field]: value } : prev)
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="tlp">
      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div className="tlp-toolbar">
        <div className="tlp-toolbar-left">
          <button className="btn btn-generate btn-sm" onClick={importTools}>
            \u2191 Import Tool Library\u2026
          </button>
          <select
            className="tb-select lib-machine-select"
            aria-label="Select machine for tool library"
            value={selectedMachineId ?? ''}
            onChange={e => setSelectedMachineId(e.target.value || null)}
          >
            <option value="">\u2014 global library \u2014</option>
            {machines.map(m => (
              <option key={m.id} value={m.id}>{m.name} (machine)</option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={handleAdd}>
            + New Tool
          </button>
        </div>
        <div className="text-muted text-sm">
          Accepts .tools, .json, .csv
        </div>
      </div>

      {/* ── Search + filter bar ────────────────────────────────────────── */}
      <div className="tlp-filter-bar">
        <input
          className="lib-search-input"
          type="search"
          placeholder="Search by name, diameter, type, material\u2026"
          aria-label="Search tools"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <select
          className="tb-select tlp-type-select"
          aria-label="Filter by tool type"
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as ToolRecord['type'] | 'all')}
        >
          <option value="all">All Types</option>
          {TOOL_TYPES.map(t => (
            <option key={t} value={t}>{TOOL_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <input
          className="tlp-diameter-input"
          type="number"
          min="0"
          step="0.1"
          placeholder="\u00D8 min"
          aria-label="Minimum diameter filter"
          value={diameterMin}
          onChange={e => setDiameterMin(e.target.value)}
        />
        <input
          className="tlp-diameter-input"
          type="number"
          min="0"
          step="0.1"
          placeholder="\u00D8 max"
          aria-label="Maximum diameter filter"
          value={diameterMax}
          onChange={e => setDiameterMax(e.target.value)}
        />
        {hasActiveFilters && (
          <span className="lib-count-hint">
            {processedTools.length} of {tools.length}
          </span>
        )}
        {hasActiveFilters && (
          <button
            className="btn btn-ghost btn-xs tlp-clear-btn"
            onClick={() => {
              setSearchQuery('')
              setTypeFilter('all')
              setDiameterMin('')
              setDiameterMax('')
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* ── Sort bar ───────────────────────────────────────────────────── */}
      <div className="tlp-sort-bar">
        <span className="text-muted text-sm">Sort:</span>
        {(['name', 'diameter', 'type', 'fluteCount'] as ToolSortKey[]).map(key => (
          <button
            key={key}
            className={`btn btn-ghost btn-xs${sortBy === key ? ' btn-ghost--active' : ''}`}
            onClick={() => toggleSort(key)}
          >
            {key === 'fluteCount' ? 'Flutes' : key.charAt(0).toUpperCase() + key.slice(1)}
            {sortIndicator(key)}
          </button>
        ))}
      </div>

      {/* ── Edit form (inline) ─────────────────────────────────────────── */}
      {editingTool && (
        <div className="tlp-edit-form">
          <div className="tlp-edit-title">
            {tools.some(t => t.id === editingTool.id) ? 'Edit Tool' : 'New Tool'}
          </div>

          {editErrors.length > 0 && (
            <div className="tlp-errors">
              {editErrors.map((err, i) => (
                <div key={i} className="tlp-error-line">{err}</div>
              ))}
            </div>
          )}

          <div className="tlp-edit-grid">
            <label className="tlp-label">Name
              <input className="tlp-input" value={editingTool.name}
                onChange={e => updateField('name', e.target.value)} />
            </label>
            <label className="tlp-label">Type
              <select className="tb-select" value={editingTool.type}
                onChange={e => updateField('type', e.target.value as ToolRecord['type'])}>
                {TOOL_TYPES.map(t => (
                  <option key={t} value={t}>{TOOL_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
            <label className="tlp-label">Diameter (mm)
              <input className="tlp-input" type="number" min="0.01" step="0.01"
                value={editingTool.diameterMm}
                onChange={e => updateField('diameterMm', parseFloat(e.target.value) || 0)} />
            </label>
            <label className="tlp-label">Flutes
              <input className="tlp-input" type="number" min="0" step="1"
                value={editingTool.fluteCount ?? ''}
                onChange={e => {
                  const v = e.target.value
                  updateField('fluteCount', v === '' ? undefined : parseInt(v, 10))
                }} />
            </label>
            <label className="tlp-label">Length (mm)
              <input className="tlp-input" type="number" min="0" step="0.1"
                value={editingTool.lengthMm ?? ''}
                onChange={e => {
                  const v = e.target.value
                  updateField('lengthMm', v === '' ? undefined : parseFloat(v))
                }} />
            </label>
            <label className="tlp-label">Stickout (mm)
              <input className="tlp-input" type="number" min="0" step="0.1"
                value={editingTool.stickoutMm ?? ''}
                onChange={e => {
                  const v = e.target.value
                  updateField('stickoutMm', v === '' ? undefined : parseFloat(v))
                }} />
            </label>
            <label className="tlp-label">Material
              <input className="tlp-input" value={editingTool.material ?? ''}
                onChange={e => updateField('material', e.target.value || undefined)}
                placeholder="e.g. Carbide, HSS" />
            </label>
            <label className="tlp-label">ATC Slot (1-6)
              <select className="tb-select" value={editingTool.toolSlot ?? ''}
                onChange={e => {
                  const v = e.target.value
                  updateField('toolSlot', v === '' ? undefined : parseInt(v, 10))
                }}>
                <option value="">None</option>
                {[1, 2, 3, 4, 5, 6].map(s => {
                  const taken = tools.find(t => t.toolSlot === s && t.id !== editingTool.id)
                  return (
                    <option key={s} value={s}>
                      Slot {s}{taken ? ` (${taken.name})` : ''}
                    </option>
                  )
                })}
              </select>
            </label>
            <label className="tlp-label tlp-label--wide">Notes
              <textarea className="tlp-textarea" rows={2}
                value={editingTool.notes ?? ''}
                onChange={e => updateField('notes', e.target.value || undefined)} />
            </label>
          </div>

          <div className="tlp-edit-actions">
            <button className="btn btn-generate btn-sm" onClick={() => void handleSave()}>
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Tool list ──────────────────────────────────────────────────── */}
      <div className="lib-scroll">
        {processedTools.map(t => (
          <div
            key={t.id}
            className="lib-row tlp-row"
            onContextMenu={e => showCtx(e, t)}
          >
            <span className="lib-row-icon tlp-type-icon" title={TOOL_TYPE_LABELS[t.type]}>
              {TOOL_TYPE_ICONS[t.type]}
            </span>
            <div className="lib-row-info">
              <div className="lib-row-name">{t.name}</div>
              <div className="lib-row-meta">
                \u00D8{t.diameterMm}mm
                {' \u00B7 '}{TOOL_TYPE_LABELS[t.type] ?? t.type}
                {t.fluteCount != null && <>{' \u00B7 '}{t.fluteCount}F</>}
                {t.lengthMm != null && <>{' \u00B7 L'}{t.lengthMm}mm</>}
                {t.material && <>{' \u00B7 '}{t.material}</>}
              </div>
            </div>
            {t.toolSlot != null && (
              <span className="tlp-slot-badge" title={`ATC Slot ${t.toolSlot}`}>
                T{t.toolSlot}
              </span>
            )}
            <ToolWearBadge tool={t} />
            <div className="tlp-row-actions">
              <button
                className="btn btn-ghost btn-sm btn-icon"
                title="Edit"
                aria-label={`Edit ${t.name}`}
                onClick={() => handleEdit(t)}
              >
                \u270F
              </button>
              <button
                className="btn btn-ghost btn-sm btn-icon"
                title="Duplicate"
                aria-label={`Duplicate ${t.name}`}
                onClick={() => void handleDuplicate(t)}
              >
                \u29C9
              </button>
              <button
                className="btn btn-ghost btn-sm btn-icon text-danger"
                title="Delete"
                aria-label={`Delete ${t.name}`}
                onClick={() => void handleDelete(t)}
              >
                \uD83D\uDDD1
              </button>
            </div>
          </div>
        ))}

        {tools.length === 0 && selectedMachineId && (
          <div className="lib-empty-filter">No tools \u2014 import a library file.</div>
        )}
        {tools.length === 0 && !selectedMachineId && (
          <div className="lib-empty-filter">No tools \u2014 select a machine or import a library.</div>
        )}
        {tools.length > 0 && processedTools.length === 0 && (
          <div className="lib-empty-filter">No tools match the current filter.</div>
        )}
      </div>

      {/* ── Context menu overlay ───────────────────────────────────────── */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  )
}
