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
  buildAtcSlotMap,
  isCarveraMachineId,
  TOOL_TYPE_LABELS,
  TOOL_TYPE_ICONS,
  TOOL_TYPES,
  MATERIAL_FAMILIES,
  MATERIAL_FAMILY_LABELS,
  MATERIAL_CATEGORY_TO_FAMILY,
  DEFAULT_DIAMETER_BINS,
  resolvePresetCategory,
  type DiameterBin,
  type MaterialFamily,
  type ToolSortKey,
  type SortDirection,
  type ToolFilters
} from './tool-library-utils'
import type { MaterialCategory } from '../../shared/material-schema'
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
  // Type filter: multi-select chip set. Empty = "all types".
  const [typeChips, setTypeChips] = useState<ReadonlySet<ToolRecord['type']>>(() => new Set())
  // Diameter chip selection by bin id. Empty = no diameter constraint.
  const [diameterBinIds, setDiameterBinIds] = useState<ReadonlySet<string>>(() => new Set())
  // Material-preset family chips. Empty = no material constraint.
  const [materialFamilies, setMaterialFamilies] = useState<ReadonlySet<MaterialFamily>>(() => new Set())
  const [sortBy, setSortBy] = useState<ToolSortKey>('name')
  const [sortDir, setSortDir] = useState<SortDirection>('asc')
  const [editingTool, setEditingTool] = useState<ToolRecord | null>(null)
  const [editErrors, setEditErrors] = useState<string[]>([])
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)

  // ── Derived data ─────────────────────────────────────────────────────────

  /** Currently-selected MachineProfile, if any. */
  const activeMachine = useMemo(
    () => machines.find(m => m.id === selectedMachineId) ?? null,
    [machines, selectedMachineId]
  )

  /**
   * Carvera-specific ATC visibility. Per CLAUDE.md §3, only the Makera
   * Carvera carries an automatic tool changer in the My-Shop cohort.
   * `atcSlotCount` is the source of truth from the machine profile;
   * fall back to 6 for the 3-axis Carvera if the field is missing.
   */
  const showAtcGrid = useMemo(() => {
    if (!activeMachine || !isCarveraMachineId(activeMachine.id)) return false
    // 4-axis Carvera physically can't load ATC, but the schema still tracks
    // pre-staged assignments — surface the grid so users can prep tools.
    return true
  }, [activeMachine])

  const atcSlotCount = useMemo(
    () => activeMachine?.atcSlotCount ?? (isCarveraMachineId(activeMachine?.id) ? 6 : 0),
    [activeMachine]
  )

  const atcEntries = useMemo(
    () => showAtcGrid ? buildAtcSlotMap(tools, atcSlotCount) : [],
    [showAtcGrid, tools, atcSlotCount]
  )

  /**
   * Materialise the resolved [bin, range] payload from the selected chip
   * ids. Two separate min/max are passed down to `filterTools`; the
   * overall band is the union of each selected bin's bounds.
   */
  const diameterRange = useMemo<{ min?: number; max?: number }>(() => {
    if (diameterBinIds.size === 0) return {}
    const bins: DiameterBin[] = DEFAULT_DIAMETER_BINS.filter(b => diameterBinIds.has(b.id))
    if (bins.length === 0) return {}
    return {
      min: Math.min(...bins.map(b => b.min)),
      max: Math.max(...bins.map(b => b.max))
    }
  }, [diameterBinIds])

  /**
   * Expand the user's coarse "Aluminum / Steel / Wood / Plastic" chip
   * selection into the canonical MaterialCategory list that
   * `filterTools` understands.
   */
  const materialCategories = useMemo<MaterialCategory[]>(() => {
    if (materialFamilies.size === 0) return []
    const out: MaterialCategory[] = []
    for (const [cat, fam] of Object.entries(MATERIAL_CATEGORY_TO_FAMILY) as [MaterialCategory, MaterialFamily][]) {
      if (materialFamilies.has(fam)) out.push(cat)
    }
    return out
  }, [materialFamilies])

  const processedTools = useMemo(() => {
    let result: ToolRecord[] = tools

    // 1. Search
    result = searchTools(result, searchQuery)

    // 2. Structured filters
    const filters: ToolFilters = {}
    if (typeChips.size > 0) filters.types = Array.from(typeChips)
    if (diameterRange.min != null) filters.diameterMin = diameterRange.min
    if (diameterRange.max != null) filters.diameterMax = diameterRange.max
    if (materialCategories.length > 0) filters.materialPresetCategories = materialCategories
    result = filterTools(result, filters)

    // 3. Sort
    result = sortTools(result, sortBy, sortDir)

    return result
  }, [tools, searchQuery, typeChips, diameterRange, materialCategories, sortBy, sortDir])

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

  const hasActiveFilters = searchQuery !== ''
    || typeChips.size > 0
    || diameterBinIds.size > 0
    || materialFamilies.size > 0

  const clearAllFilters = useCallback(() => {
    setSearchQuery('')
    setTypeChips(new Set())
    setDiameterBinIds(new Set())
    setMaterialFamilies(new Set())
  }, [])

  // \u2500\u2500 Chip-toggle helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  // Generic toggle for any Set-backed chip group. Keeps the chip handlers
  // tiny and avoids spreading the same useState callback into the JSX.
  const toggleInSet = useCallback(<T,>(prev: ReadonlySet<T>, value: T): ReadonlySet<T> => {
    const next = new Set(prev)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    return next
  }, [])

  const toggleType = useCallback((t: ToolRecord['type']) => {
    setTypeChips(prev => toggleInSet(prev, t))
  }, [toggleInSet])

  const toggleDiameterBin = useCallback((id: string) => {
    setDiameterBinIds(prev => toggleInSet(prev, id))
  }, [toggleInSet])

  const toggleMaterialFamily = useCallback((f: MaterialFamily) => {
    setMaterialFamilies(prev => toggleInSet(prev, f))
  }, [toggleInSet])

  /** Pre-compute the bin id each tool falls into, so we can show counts. */
  const binCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const bin of DEFAULT_DIAMETER_BINS) counts.set(bin.id, 0)
    for (const t of tools) {
      for (const bin of DEFAULT_DIAMETER_BINS) {
        if (t.diameterMm >= bin.min && t.diameterMm <= bin.max) {
          counts.set(bin.id, (counts.get(bin.id) ?? 0) + 1)
          break
        }
      }
    }
    return counts
  }, [tools])

  /** Pre-compute the family count per family chip. */
  const familyCounts = useMemo(() => {
    const counts = new Map<MaterialFamily, number>()
    for (const f of MATERIAL_FAMILIES) counts.set(f, 0)
    for (const t of tools) {
      const seen = new Set<MaterialFamily>()
      for (const p of t.materialPresets ?? []) {
        if (p.enabled === false) continue
        const cat = resolvePresetCategory(p.materialType)
        if (cat == null) continue
        const fam = MATERIAL_CATEGORY_TO_FAMILY[cat]
        if (!seen.has(fam)) {
          counts.set(fam, (counts.get(fam) ?? 0) + 1)
          seen.add(fam)
        }
      }
    }
    return counts
  }, [tools])

  /**
   * ATC slot grid click handler. Opens the inline edit form pre-loaded
   * with the slot's current occupant \u2014 or, when the slot is empty,
   * surfaces a context menu listing the unassigned library tools so the
   * user can click-to-pick. Drag-to-reassign is intentionally deferred to
   * a follow-up cycle (see report).
   */
  const handleSlotClick = useCallback((e: React.MouseEvent, slot: number, tool: ToolRecord | undefined) => {
    if (tool) {
      // Slot is occupied \u2014 open the inline editor on that tool.
      handleEdit(tool)
      return
    }
    // Empty slot \u2014 show a context menu listing unassigned tools.
    const unassigned = tools.filter(t => t.toolSlot == null)
    const items: ContextMenuEntry[] = unassigned.length === 0
      ? [{ id: 'empty', label: 'No unassigned tools', action: () => {} }]
      : unassigned.slice(0, 25).map(t => ({
          id: `assign-${t.id}`,
          label: `${t.name}  \u00D8${t.diameterMm} mm`,
          action: () => void handleSlotChange(t, slot)
        }))
    setCtxMenu({ x: e.clientX, y: e.clientY, items })
  }, [tools, handleEdit, handleSlotChange])

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
          <button type="button" className="btn btn-generate btn-sm" onClick={importTools}>
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleAdd}>
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
          placeholder="Search by name, diameter, type, material, notes\u2026"
          aria-label="Search tools"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        {hasActiveFilters && (
          <span className="lib-count-hint" aria-live="polite">
            {processedTools.length} of {tools.length}
          </span>
        )}
        {hasActiveFilters && (
          <button type="button"
            className="btn btn-ghost btn-xs tlp-clear-btn"
            onClick={clearAllFilters}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Chip filter groups: Type, Diameter, Material preset */}
      <div className="tlp-chip-groups" role="region" aria-label="Tool filter chips">
        <div className="tlp-chip-group" role="group" aria-label="Filter by tool type">
          <span className="tlp-chip-group-label">Type</span>
          {TOOL_TYPES.map(t => {
            const active = typeChips.has(t)
            return (
              <button type="button"
                key={t}
                className={`tlp-chip${active ? ' tlp-chip--active' : ''}`}
                aria-pressed={active}
                title={TOOL_TYPE_LABELS[t]}
                onClick={() => toggleType(t)}
              >
                <span className="tlp-chip-icon" aria-hidden="true">{TOOL_TYPE_ICONS[t]}</span>
                {TOOL_TYPE_LABELS[t]}
              </button>
            )
          })}
        </div>

        <div className="tlp-chip-group" role="group" aria-label="Filter by diameter range">
          <span className="tlp-chip-group-label">\u00D8</span>
          {DEFAULT_DIAMETER_BINS.map(bin => {
            const active = diameterBinIds.has(bin.id)
            const count = binCounts.get(bin.id) ?? 0
            return (
              <button type="button"
                key={bin.id}
                className={`tlp-chip${active ? ' tlp-chip--active' : ''}`}
                aria-pressed={active}
                title={`Diameter ${bin.label} \u2014 ${count} tool${count === 1 ? '' : 's'}`}
                onClick={() => toggleDiameterBin(bin.id)}
              >
                {bin.label}
                <span className="tlp-chip-count" aria-hidden="true">{count}</span>
              </button>
            )
          })}
        </div>

        <div className="tlp-chip-group" role="group" aria-label="Filter by material preset family">
          <span className="tlp-chip-group-label">Material</span>
          {MATERIAL_FAMILIES.map(f => {
            const active = materialFamilies.has(f)
            const count = familyCounts.get(f) ?? 0
            return (
              <button type="button"
                key={f}
                className={`tlp-chip${active ? ' tlp-chip--active' : ''}${count === 0 ? ' tlp-chip--empty' : ''}`}
                aria-pressed={active}
                title={`Tools with a ${MATERIAL_FAMILY_LABELS[f]} preset \u2014 ${count}`}
                onClick={() => toggleMaterialFamily(f)}
              >
                {MATERIAL_FAMILY_LABELS[f]}
                <span className="tlp-chip-count" aria-hidden="true">{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ATC slot grid (Carvera only) */}
      {showAtcGrid && atcSlotCount > 0 && (
        <section
          className="tlp-atc-grid"
          aria-labelledby="tlp-atc-grid-heading"
          data-testid="tlp-atc-grid"
        >
          <div className="tlp-atc-grid-header">
            <h3 id="tlp-atc-grid-heading" className="tlp-atc-grid-title">
              ATC slots ({activeMachine?.name})
            </h3>
            <p className="tlp-atc-grid-hint">
              Click an occupied slot to edit the tool \u00B7 click an empty slot to assign one.
            </p>
          </div>
          <div className="tlp-atc-slot-grid" role="grid" aria-label="Carvera ATC slot grid">
            {atcEntries.map(entry => (
              <button type="button"
                key={entry.slot}
                role="gridcell"
                className={`tlp-atc-slot${entry.tool ? ' tlp-atc-slot--filled' : ' tlp-atc-slot--empty'}`}
                aria-label={entry.tool
                  ? `Slot ${entry.slot}: ${entry.tool.name}, \u00D8${entry.tool.diameterMm} mm`
                  : `Slot ${entry.slot}: empty`}
                onClick={(e) => handleSlotClick(e, entry.slot, entry.tool)}
              >
                <span className="tlp-atc-slot-number">T{entry.slot}</span>
                {entry.tool ? (
                  <>
                    <span className="tlp-atc-slot-name" title={entry.tool.name}>{entry.tool.name}</span>
                    <span className="tlp-atc-slot-meta">
                      \u00D8{entry.tool.diameterMm}mm{' \u00B7 '}{TOOL_TYPE_LABELS[entry.tool.type] ?? entry.tool.type}
                    </span>
                  </>
                ) : (
                  <span className="tlp-atc-slot-empty-label">Empty</span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ── Sort bar ───────────────────────────────────────────────────── */}
      <div className="tlp-sort-bar">
        <span className="text-muted text-sm">Sort:</span>
        {(['name', 'diameter', 'type', 'fluteCount'] as ToolSortKey[]).map(key => (
          <button type="button"
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
              <input type="text" className="tlp-input" value={editingTool.name}
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
              <input type="text" className="tlp-input" value={editingTool.material ?? ''}
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
            <button type="button" className="btn btn-generate btn-sm" onClick={() => void handleSave()}>
              Save
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleCancel}>
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
              <button type="button"
                className="btn btn-ghost btn-sm btn-icon"
                title="Edit"
                aria-label={`Edit ${t.name}`}
                onClick={() => handleEdit(t)}
              >
                \u270F
              </button>
              <button type="button"
                className="btn btn-ghost btn-sm btn-icon"
                title="Duplicate"
                aria-label={`Duplicate ${t.name}`}
                onClick={() => void handleDuplicate(t)}
              >
                \u29C9
              </button>
              <button type="button"
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
