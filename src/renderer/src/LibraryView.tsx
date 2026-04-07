/**
 * LibraryView -- Library view for machines, tools, materials, and post processors.
 * Extracted from ShopApp.tsx (pure refactoring).
 */
import React, { useState, useEffect } from 'react'
import type { MachineProfile, ToolRecord, MaterialRecord, MaterialCategory, LibTab } from './shop-types'
import type { Toast } from './shop-types'
import { fab, getMachineMode, MODE_LABELS, MODE_ICONS, MATERIAL_CATEGORY_LABELS } from './shop-types'
import { friendlyError } from '../../shared/file-parse-errors'
import { ContextMenu } from './ContextMenu'
import type { ContextMenuEntry } from './ContextMenu'
import type { AuditSeverity, MaterialAuditFinding } from '../../shared/material-audit'

// ── Machine editor ─────────────────────────────────────────────────────────────
function MachineEditor({ machine, onChange, onSave, onCancel }: {
  machine: MachineProfile; onChange: (m: MachineProfile) => void
  onSave: () => void; onCancel: () => void
}): React.ReactElement {
  const set = (k: keyof MachineProfile, v: unknown): void => onChange({ ...machine, [k]: v })
  const mmode = getMachineMode(machine)
  return (
    <div className="card card-mb">
      <div className="card-header">
        <span className="card-title">Edit Machine</span>
        <span className={`tb-machine-badge tb-machine-badge--${mmode} cursor-default`}>
          {MODE_ICONS[mmode]} {MODE_LABELS[mmode]}
        </span>
        <div className="flex-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-sm btn-generate" onClick={onSave}>Save</button>
      </div>
      <div className="card-body section-gap">
        <div className="form-row-3">
          <div className="form-group"><label>Name</label>
            <input value={machine.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div className="form-group"><label>Kind</label>
            <select value={machine.kind} onChange={e => set('kind', e.target.value as MachineProfile['kind'])}>
              <option value="cnc">CNC</option>
              <option value="fdm">FDM Printer</option>
            </select>
          </div>
          <div className="form-group"><label>Axis Count</label>
            <select value={machine.axisCount ?? 3} onChange={e => set('axisCount', +e.target.value)}>
              <option value={3}>3-axis</option>
              <option value={4}>4-axis</option>
              <option value={5}>5-axis</option>
            </select>
          </div>
        </div>
        {machine.kind === 'cnc' && (machine.axisCount ?? 3) <= 3 && (
          <div className="form-row-3">
            <div className="form-group"><label>CNC Profile</label>
              <select value={machine.meta?.cncProfile ?? '2d'}
                onChange={e => onChange({ ...machine, meta: { ...machine.meta, cncProfile: e.target.value as '2d' | '3d' } })}>
                <option value="2d">Standard {'\u2014'} VCarve style (2D/2.5D focus)</option>
                <option value="3d">3D Surfacing {'\u2014'} Fusion style (rough/finish focus)</option>
              </select>
            </div>
          </div>
        )}
        <div className="form-row-3">
          <div className="form-group"><label>Dialect</label>
            <select value={machine.dialect} onChange={e => set('dialect', e.target.value as MachineProfile['dialect'])}>
              <option value="grbl">GRBL</option>
              <option value="grbl_4axis">GRBL 4-Axis</option>
              <option value="mach3">Mach3/4</option>
              <option value="generic_mm">Generic (mm)</option>
            </select>
          </div>
          <div className="form-group"><label>Post Template</label>
            <input value={machine.postTemplate ?? ''} onChange={e => set('postTemplate', e.target.value)} />
          </div>
          <div className="form-group"><label>Max Feed (mm/min)</label>
            <input type="number" value={machine.maxFeedMmMin ?? ''} onChange={e => set('maxFeedMmMin', +e.target.value)} />
          </div>
        </div>
        <div className="form-row-3">
          {(['x','y','z'] as const).map(ax => (
            <div className="form-group" key={ax}><label>Work Area {ax.toUpperCase()} (mm)</label>
              <input type="number" value={machine.workAreaMm[ax]}
                onChange={e => set('workAreaMm', { ...machine.workAreaMm, [ax]: +e.target.value })} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Material editor ────────────────────────────────────────────────────────────
function MaterialEditor({ material, onChange, onSave, onCancel }: {
  material: MaterialRecord; onChange: (m: MaterialRecord) => void
  onSave: () => void; onCancel: () => void
}): React.ReactElement {
  const cp = material.cutParams?.['default'] ?? { surfaceSpeedMMin: 200, chiploadMm: 0.05, docFactor: 0.5, stepoverFactor: 0.45, plungeFactor: 0.3 }
  const setCP = (k: string, v: number): void => onChange({ ...material, cutParams: { ...material.cutParams, default: { ...cp, [k]: v } } })
  const [cat, setCat] = useState<MaterialCategory>(material.category ?? 'other')
  return (
    <div className="card card-mb">
      <div className="card-header">
        <span className="card-title">Edit Material</span>
        <div className="flex-spacer" />
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-sm btn-generate" onClick={onSave}>Save</button>
      </div>
      <div className="card-body section-gap">
        <div className="form-row-3">
          <div className="form-group"><label>Name</label>
            <input value={material.name} onChange={e => onChange({ ...material, name: e.target.value })} />
          </div>
          <div className="form-group"><label>Category</label>
            <select value={cat} onChange={e => { const v = e.target.value as MaterialCategory; setCat(v); onChange({ ...material, category: v }) }}>
              {Object.entries(MATERIAL_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="form-group"><label>Notes</label>
            <input value={material.notes ?? ''} onChange={e => onChange({ ...material, notes: e.target.value })} />
          </div>
        </div>
        <div className="label-upper">Default Cut Params</div>
        <div className="form-row-3">
          {[['Surface Speed (m/min)','surfaceSpeedMMin'],['Chipload (mm/tooth)','chiploadMm'],['DOC Factor','docFactor'],['Stepover Factor','stepoverFactor'],['Plunge Factor','plungeFactor']].map(([label, key]) => (
            <div className="form-group" key={key}><label>{label}</label>
              <input type="number" step="any" value={(cp as Record<string,number>)[key] ?? ''}
                onChange={e => setCP(key, +e.target.value)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Audit badge helper ────────────────────────────────────────────────────────
const AUDIT_ICONS: Record<AuditSeverity, string> = { ok: '\u2713', warn: '\u26A0', danger: '\u26D4' }
const AUDIT_LABELS: Record<string, string> = {
  surfaceSpeed: 'Surface speed', chipLoad: 'Chip load', plungeFactor: 'Plunge factor'
}

function describeAuditFinding(f: MaterialAuditFinding): string {
  const fieldLabel = AUDIT_LABELS[f.field] ?? f.field
  const dir = f.deviationPercent > 0 ? 'above' : 'below'
  const pct = Math.abs(f.deviationPercent)
  return `${fieldLabel} ${pct.toFixed(0)}% ${dir} recommended range for ${f.materialName} (${f.toolType})`
}

function MaterialAuditBadge({ findings }: { findings: MaterialAuditFinding[] }): React.ReactElement | null {
  if (findings.length === 0) {
    return <span className="mat-audit-badge mat-audit-badge--ok" title="All checks passed">{AUDIT_ICONS.ok}</span>
  }
  const worstSeverity: AuditSeverity = findings.some(f => f.severity === 'danger') ? 'danger' : 'warn'
  const tooltip = findings.map(describeAuditFinding).join('\n')
  return (
    <span className={`mat-audit-badge mat-audit-badge--${worstSeverity}`} title={tooltip}>
      {AUDIT_ICONS[worstSeverity]} {findings.length}
    </span>
  )
}

// ── LibraryView ──────────────────────────────────────────────────────────────
export interface LibraryViewProps {
  onToast: (k: Toast['kind'], m: string) => void
  onMachinesChanged: () => void
}

export function LibraryView({ onToast, onMachinesChanged }: LibraryViewProps): React.ReactElement {
  const [tab, setTab] = useState<LibTab>('machines')
  const [machines, setMachines] = useState<MachineProfile[]>([])
  const [tools, setTools] = useState<ToolRecord[]>([])
  const [materials, setMaterials] = useState<MaterialRecord[]>([])
  const [posts, setPosts] = useState<Array<{ filename: string; path: string; source: string; preview: string }>>([])
  const [selectedMachineId, setSelectedMachineId] = useState<string | null>(null)
  const [editingMachine, setEditingMachine] = useState<MachineProfile | null>(null)
  const [editingMaterial, setEditingMaterial] = useState<MaterialRecord | null>(null)
  const [postContent, setPostContent] = useState('')
  const [editingPostFilename, setEditingPostFilename] = useState<string | null>(null)
  const [toolSearch, setToolSearch] = useState('')
  const [toolTypeFilter, setToolTypeFilter] = useState<string>('all')
  const [libCtx, setLibCtx] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)
  const [auditFindings, setAuditFindings] = useState<Map<string, MaterialAuditFinding[]>>(new Map())

  useEffect(() => { fab().machinesList().then(setMachines).catch(e => { console.error(e); onToast('err', 'Failed to load machines') }) }, [])
  useEffect(() => {
    if (tab === 'tools' && selectedMachineId)
      fab().machineToolsRead(selectedMachineId).then(lib => setTools(lib.tools ?? [])).catch(e => { console.error(e); onToast('err', 'Failed to load tools') })
  }, [tab, selectedMachineId])
  useEffect(() => { if (tab === 'materials') fab().materialsList().then(setMaterials).catch(e => { console.error(e); onToast('err', 'Failed to load materials') }) }, [tab])

  // Load audit results when materials tab is active and materials change
  useEffect(() => {
    if (tab !== 'materials' || materials.length === 0) { setAuditFindings(new Map()); return }
    fab().materialAudit().then(result => {
      if (!result.ok) { console.error('Material audit failed:', result.error); return }
      const map = new Map<string, MaterialAuditFinding[]>()
      for (const f of result.issues) {
        const existing = map.get(f.materialId) ?? []
        existing.push(f)
        map.set(f.materialId, existing)
      }
      setAuditFindings(map)
    }).catch(e => console.error('Material audit error:', e))
  }, [tab, materials])
  useEffect(() => { if (tab === 'posts') fab().postsList().then(setPosts).catch(e => { console.error(e); onToast('err', 'Failed to load post processors') }) }, [tab])

  const refreshMachines = async (): Promise<void> => {
    const m = await fab().machinesList(); setMachines(m); onMachinesChanged()
  }

  const importCps = async (): Promise<void> => {
    try {
      const r = await fab().machinesPickAndImportCps()
      if (!r) return
      const d = r.detected
      onToast('ok', `Imported "${r.profile.name}" \u00B7 ${[d.name?'\u2713 name':'~ name',d.workArea?'\u2713 area':'~ area',d.maxFeed?'\u2713 feed':'~ feed'].join(' \u00B7 ')}`)
      await refreshMachines()
    } catch (e) { onToast('err', friendlyError(e, 'Machine import failed')) }
  }

  const importTools = async (): Promise<void> => {
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
    } catch (e) { onToast('err', friendlyError(e, 'Tool import failed')) }
  }

  const buildMachineCtx = (m: MachineProfile): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      { id: 'edit', label: 'Edit', icon: '\u270F', action: () => setEditingMachine({ ...m }) },
      { id: 'export', label: 'Export JSON\u2026', icon: '\u2197', action: async () => {
        const r = await fab().machinesExportUser(m.id)
        if (r.ok) onToast('ok', `Exported to ${r.path}`)
        else onToast('err', r.error)
      }},
    ]
    if (m.meta?.source === 'user') {
      items.push({ separator: true })
      items.push({ id: 'delete', label: 'Delete', icon: '\u{1F5D1}', danger: true, action: async () => {
        await fab().machinesDeleteUser(m.id); await refreshMachines(); onToast('ok', 'Deleted')
      }})
    }
    return items
  }

  const buildMaterialCtx = (m: MaterialRecord): ContextMenuEntry[] => {
    const items: ContextMenuEntry[] = [
      { id: 'edit', label: 'Edit', icon: '\u270F', action: () => setEditingMaterial({ ...m }) },
    ]
    if (m.source !== 'bundled') {
      items.push({ separator: true })
      items.push({ id: 'delete', label: 'Delete', icon: '\u{1F5D1}', danger: true, action: async () => {
        await fab().materialsDelete(m.id); setMaterials(await fab().materialsList()); onToast('ok', 'Deleted')
      }})
    }
    return items
  }

  const showLibCtx = (e: React.MouseEvent, items: ContextMenuEntry[]): void => {
    e.preventDefault()
    setLibCtx({ x: e.clientX, y: e.clientY, items })
  }

  const TABS: { id: LibTab; label: string }[] = [
    { id: 'machines', label: 'Machines' }, { id: 'tools', label: 'Tools' },
    { id: 'materials', label: 'Materials' }, { id: 'posts', label: 'Post Processors' }
  ]

  const TOOL_TYPE_FILTER_LABELS: Record<string, string> = {
    all: 'All Types', endmill: 'Flat Endmill', ball: 'Ball Nose', vbit: 'V-Bit',
    drill: 'Drill', face: 'Face Mill', chamfer: 'Chamfer',
    thread_mill: 'Thread Mill', o_flute: 'O-Flute', corn: 'Corn Cob', other: 'Other'
  }

  const filteredTools = tools.filter(t => {
    const matchesType = toolTypeFilter === 'all' || t.type === toolTypeFilter
    const query = toolSearch.trim().toLowerCase()
    const matchesSearch = query === '' ||
      t.name.toLowerCase().includes(query) ||
      String(t.diameterMm).includes(query) ||
      (t.type ?? '').toLowerCase().includes(query)
    return matchesType && matchesSearch
  })

  return (
    <>
    <div className="lib-tabs">
      <div className="lib-tab-bar">
        {TABS.map(t => (
          <button key={t.id}
            className={`btn btn-ghost lib-tab-btn${tab === t.id ? ' btn-ghost--active lib-tab-btn--active' : ''}`}
            onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="lib-tab-body">

        {tab === 'machines' && (
          <div className="lib-scroll">
            <div className="flex gap-8 mb-12">
              <button className="btn btn-ghost btn-sm" onClick={importCps}>Import .cps{'\u2026'}</button>
              <button className="btn btn-ghost btn-sm" onClick={async () => {
                const p = await fab().dialogOpenFile([{ name: 'Machine JSON', extensions: ['json'] }])
                if (!p) return
                try { await fab().machinesImportFile(p); await refreshMachines(); onToast('ok', 'Machine imported') }
                catch (e) { onToast('err', friendlyError(e, 'Machine import failed')) }
              }}>Import JSON{'\u2026'}</button>
            </div>
            {editingMachine && (
              <MachineEditor machine={editingMachine} onChange={setEditingMachine}
                onSave={async () => { await fab().machinesSaveUser(editingMachine); await refreshMachines(); setEditingMachine(null); onToast('ok', 'Saved') }}
                onCancel={() => setEditingMachine(null)} />
            )}
            {!editingMachine && machines.map(m => {
              const mmode = getMachineMode(m)
              return (
                <div key={m.id} className="lib-row"
                  onContextMenu={e => showLibCtx(e, buildMachineCtx(m))}>
                  <div className="flex-spacer">
                    <div className="flex items-center gap-8 fw-600">
                      {m.name}
                      <span className={`tb-machine-badge tb-machine-badge--${mmode} text-xs pointer`}>
                        {MODE_ICONS[mmode]} {MODE_LABELS[mmode]}
                      </span>
                    </div>
                    <div className="text-muted text-sm">
                      {m.dialect} {'\u00B7'} {m.workAreaMm.x}{'\u00D7'}{m.workAreaMm.y}{'\u00D7'}{m.workAreaMm.z}mm
                    </div>
                  </div>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditingMachine({ ...m })}>{'\u270F'}</button>
                  {m.meta?.source === 'user' && (
                    <button className="btn btn-ghost btn-sm btn-icon text-danger"
                      onClick={async () => { await fab().machinesDeleteUser(m.id); await refreshMachines(); onToast('ok', 'Deleted') }}>{'\u{1F5D1}'}</button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'tools' && (
          <div className="lib-scroll">
            <div className="flex items-center gap-8 mb-8 lib-tool-import-bar">
              <button className="btn btn-generate btn-sm" onClick={importTools}>{'\u2191'} Import Tool Library{'\u2026'}</button>
              <select className="tb-select lib-machine-select" value={selectedMachineId ?? ''}
                onChange={e => setSelectedMachineId(e.target.value || null)}>
                <option value="">{'\u2014'} import into global library {'\u2014'}</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.name} (machine)</option>)}
              </select>
            </div>
            <div className="text-muted text-sm mb-12">
              Accepts .tools, .json, .csv {'\u2014'} leave machine unselected for global library.
            </div>
            {tools.length > 0 && (
              <div className="lib-filter-bar">
                <input
                  className="lib-search-input"
                  type="search"
                  placeholder="Search by name, diameter, or type\u2026"
                  value={toolSearch}
                  onChange={e => setToolSearch(e.target.value)}
                />
                <select className="tb-select" value={toolTypeFilter}
                  onChange={e => setToolTypeFilter(e.target.value)}>
                  {Object.entries(TOOL_TYPE_FILTER_LABELS).map(([v, label]) => (
                    <option key={v} value={v}>{label}</option>
                  ))}
                </select>
                {(toolSearch || toolTypeFilter !== 'all') && (
                  <span className="lib-count-hint">
                    {filteredTools.length} of {tools.length}
                  </span>
                )}
              </div>
            )}
            {filteredTools.map(t => (
              <div key={t.id} className="lib-row">
                <div className="lib-row-info">
                  <div className="lib-row-name">{t.name}</div>
                  <div className="lib-row-meta">
                    {'\u00D8'}{t.diameterMm}mm {'\u00B7'} {TOOL_TYPE_FILTER_LABELS[t.type] ?? t.type} {'\u00B7'} {t.fluteCount} flute{t.fluteCount !== 1 ? 's' : ''}
                    {t.lengthMm ? ` \u00B7 L${t.lengthMm}mm` : ''}
                  </div>
                </div>
              </div>
            ))}
            {tools.length === 0 && selectedMachineId && (
              <div className="lib-empty-filter">No tools {'\u2014'} import a library file.</div>
            )}
            {tools.length > 0 && filteredTools.length === 0 && (
              <div className="lib-empty-filter">No tools match the current filter.</div>
            )}
          </div>
        )}

        {tab === 'materials' && (
          <div className="lib-scroll">
            <div className="flex gap-8 mb-12">
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingMaterial({
                id: `mat_${Date.now()}`, name: '', category: 'other', source: 'user',
                cutParams: { default: { surfaceSpeedMMin: 200, chiploadMm: 0.05, docFactor: 0.5, stepoverFactor: 0.45, plungeFactor: 0.3 } }
              })}>+ New Material</button>
              <button className="btn btn-ghost btn-sm" onClick={async () => {
                const r = await fab().materialsPickAndImport()
                if (!r) return
                setMaterials(await fab().materialsList())
                onToast('ok', `Imported ${r.length} material(s)`)
              }}>Import JSON{'\u2026'}</button>
            </div>
            {editingMaterial && (
              <MaterialEditor material={editingMaterial} onChange={setEditingMaterial}
                onSave={async () => { await fab().materialsSave(editingMaterial); setMaterials(await fab().materialsList()); setEditingMaterial(null); onToast('ok', 'Saved') }}
                onCancel={() => setEditingMaterial(null)} />
            )}
            {!editingMaterial && materials.map(m => {
              const issues = auditFindings.get(m.id) ?? []
              return (
                <div key={m.id} className="lib-row"
                  onContextMenu={e => showLibCtx(e, buildMaterialCtx(m))}>
                  <div className="flex-spacer">
                    <div className="flex items-center gap-8 fw-600">
                      {m.name}
                      <MaterialAuditBadge findings={issues} />
                    </div>
                    <div className="text-muted text-sm">{MATERIAL_CATEGORY_LABELS[m.category] ?? m.category}{m.source === 'bundled' ? ' \u00B7 bundled' : ''}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditingMaterial({ ...m })}>{'\u270F'}</button>
                  {m.source !== 'bundled' && (
                    <button className="btn btn-ghost btn-sm btn-icon text-danger"
                      onClick={async () => { await fab().materialsDelete(m.id); setMaterials(await fab().materialsList()); onToast('ok', 'Deleted') }}>{'\u{1F5D1}'}</button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {tab === 'posts' && (
          <div className="post-editor-layout">
            <div className="post-editor-sidebar">
              <button className="btn btn-ghost btn-sm w-full mb-8"
                onClick={async () => { const r = await fab().postsPickAndUpload(); if (r) { setPosts(await fab().postsList()); onToast('ok', `Imported ${r.filename}`) } }}>
                Import .hbs{'\u2026'}
              </button>
              {posts.map(p => (
                <div key={p.filename}
                  className={`lib-row pointer${editingPostFilename === p.filename ? ' lib-row--active' : ''}`}
                  onClick={async () => { setPostContent(await fab().postsRead(p.filename)); setEditingPostFilename(p.filename) }}>
                  <div className="flex-spacer text-base">
                    <div>{p.filename}</div>
                    <div className="text-muted text-xs">{p.source}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="post-editor-main">
              {editingPostFilename ? (
                <>
                  <div className="flex items-center gap-8 mb-8">
                    <span className="fw-600">{editingPostFilename}</span>
                    <div className="flex-spacer" />
                    <button className="btn btn-sm btn-generate" onClick={async () => {
                      await fab().postsSave(editingPostFilename, postContent)
                      setPosts(await fab().postsList()); onToast('ok', 'Saved')
                    }}>Save</button>
                  </div>
                  <textarea className="post-editor-textarea"
                    value={postContent} onChange={e => setPostContent(e.target.value)} />
                </>
              ) : <div className="text-muted post-editor-empty">Select a post-processor to edit</div>}
            </div>
          </div>
        )}
      </div>
    </div>
    {libCtx && <ContextMenu x={libCtx.x} y={libCtx.y} items={libCtx.items} onClose={() => setLibCtx(null)} />}
    </>
  )
}
