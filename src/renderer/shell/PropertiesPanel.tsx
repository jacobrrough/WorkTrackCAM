import type { Workspace } from './WorkspaceBar'
import type { ShellBrowserSelection } from './browser-selection'
import type { AssemblyFile } from '../../shared/assembly-schema'
import type { ManufactureFile } from '../../shared/manufacture-schema'
import { useDesignSessionOptional } from '../design/DesignSessionContext'

type Props = {
  workspace: Workspace
  asm: AssemblyFile | null
  mfg: ManufactureFile | null
  shellSelection: ShellBrowserSelection
}

export function PropertiesPanel({ workspace, asm, mfg, shellSelection }: Props) {
  const ctx = useDesignSessionOptional()

  if (workspace === 'utilities') {
    return (
      <div className="properties-panel">
        <h2 className="properties-head">Properties</h2>
        <p className="properties-empty">
          In <strong>File</strong>, the main column is project data and app settings. Slice, CAM, and tools live under{' '}
          <strong>Manufacture</strong>. This side panel stays empty — there is no selection-driven inspector here.
        </p>
      </div>
    )
  }

  if (workspace === 'design') {
    if (!ctx?.projectDir) {
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Properties</h2>
          <p className="properties-empty">Open a project.</p>
        </div>
      )
    }

    const sel = ctx.selection
    const { design, features } = ctx

    if (!sel) {
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Solid</h2>
          <p className="properties-hint">Select a tree or timeline item, or edit defaults below.</p>
          <label>
            Mode
            <select
              value={design.solidKind}
              onChange={(e) =>
                ctx.dispatch({
                  type: 'edit',
                  design: { ...design, solidKind: e.target.value as typeof design.solidKind }
                })
              }
            >
              <option value="extrude">Extrude</option>
              <option value="revolve">Revolve</option>
              <option value="loft">Loft</option>
            </select>
          </label>
          {design.solidKind === 'extrude' ? (
            <label>
              Depth (mm)
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={design.extrudeDepthMm}
                onChange={(e) =>
                  ctx.dispatch({
                    type: 'edit',
                    design: { ...design, extrudeDepthMm: Math.max(0.1, Number(e.target.value) || 0.1) }
                  })
                }
              />
            </label>
          ) : design.solidKind === 'revolve' ? (
            <>
              <label>
                Angle (deg)
                <input
                  type="number"
                  min={1}
                  max={360}
                  value={design.revolve.angleDeg}
                  onChange={(e) =>
                    ctx.dispatch({
                      type: 'edit',
                      design: {
                        ...design,
                        revolve: {
                          ...design.revolve,
                          angleDeg: Math.min(360, Math.max(1, Number(e.target.value) || 360))
                        }
                      }
                    })
                  }
                />
              </label>
              <label>
                Axis X
                <input
                  type="number"
                  step={1}
                  value={design.revolve.axisX}
                  onChange={(e) =>
                    ctx.dispatch({
                      type: 'edit',
                      design: {
                        ...design,
                        revolve: { ...design.revolve, axisX: Number(e.target.value) || 0 }
                      }
                    })
                  }
                />
              </label>
            </>
          ) : (
            <label title="Uniform +Z spacing between consecutive closed profiles (loft); max 16 profiles">
              Loft step (mm)
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={design.loftSeparationMm}
                onChange={(e) =>
                  ctx.dispatch({
                    type: 'edit',
                    design: { ...design, loftSeparationMm: Math.max(0.1, Number(e.target.value) || 0.1) }
                  })
                }
              />
            </label>
          )}
        </div>
      )
    }

    if (sel.scope === 'feature') {
      const it = features?.items.find((x) => x.id === sel.id)
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Feature</h2>
          {!it ? (
            <p className="properties-empty">Unknown feature id.</p>
          ) : (
            <>
              <p className="properties-kv">
                <strong>{it.label}</strong>
              </p>
              <p className="properties-kv">Kind: {it.kind}</p>
              <label className="chk">
                <input
                  type="checkbox"
                  checked={!!it.suppressed}
                  onChange={() => void ctx.updateFeatureSuppressed(it.id, !it.suppressed)}
                />
                Suppressed
              </label>
              {it.params && Object.keys(it.params).length > 0 && (
                <pre className="properties-json">{JSON.stringify(it.params, null, 2)}</pre>
              )}
            </>
          )}
        </div>
      )
    }

    if (sel.scope === 'entity') {
      const e = design.entities.find((x) => x.id === sel.id)
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Sketch entity</h2>
          {!e ? (
            <p className="properties-empty">Missing entity.</p>
          ) : e.kind === 'rect' ? (
            <>
              <p className="properties-kv">Rectangle</p>
              <label>
                W
                <input
                  type="number"
                  value={e.w}
                  onChange={(ev) =>
                    ctx.onDesignChange({
                      ...design,
                      entities: design.entities.map((x) => (x.id === e.id ? { ...e, w: Number(ev.target.value) || 0 } : x))
                    })
                  }
                />
              </label>
              <label>
                H
                <input
                  type="number"
                  value={e.h}
                  onChange={(ev) =>
                    ctx.onDesignChange({
                      ...design,
                      entities: design.entities.map((x) => (x.id === e.id ? { ...e, h: Number(ev.target.value) || 0 } : x))
                    })
                  }
                />
              </label>
            </>
          ) : e.kind === 'circle' ? (
            <label>
              Radius
              <input
                type="number"
                value={e.r}
                onChange={(ev) =>
                  ctx.onDesignChange({
                    ...design,
                    entities: design.entities.map((x) => (x.id === e.id ? { ...e, r: Math.max(0.01, Number(ev.target.value) || 0) } : x))
                  })
                }
              />
            </label>
          ) : e.kind === 'slot' ? (
            <>
              <p className="properties-kv">Slot (center-to-center)</p>
              <label>
                Length
                <input
                  type="number"
                  value={e.length}
                  onChange={(ev) =>
                    ctx.onDesignChange({
                      ...design,
                      entities: design.entities.map((x) =>
                        x.id === e.id ? { ...e, length: Math.max(0, Number(ev.target.value) || 0) } : x
                      )
                    })
                  }
                />
              </label>
              <label>
                Width
                <input
                  type="number"
                  value={e.width}
                  onChange={(ev) =>
                    ctx.onDesignChange({
                      ...design,
                      entities: design.entities.map((x) =>
                        x.id === e.id ? { ...e, width: Math.max(0.01, Number(ev.target.value) || 0) } : x
                      )
                    })
                  }
                />
              </label>
              <label>
                Rotation (rad)
                <input
                  type="number"
                  step={0.01}
                  value={e.rotation}
                  onChange={(ev) =>
                    ctx.onDesignChange({
                      ...design,
                      entities: design.entities.map((x) =>
                        x.id === e.id ? { ...e, rotation: Number(ev.target.value) || 0 } : x
                      )
                    })
                  }
                />
              </label>
            </>
          ) : (
            <p className="properties-kv">Polyline — edit in sketch view.</p>
          )}
        </div>
      )
    }

    if (sel.scope === 'constraint') {
      const c = design.constraints.find((x) => x.id === sel.id)
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Constraint</h2>
          {!c ? (
            <p className="properties-empty">Missing constraint.</p>
          ) : (
            <pre className="properties-json">{JSON.stringify(c, null, 2)}</pre>
          )}
        </div>
      )
    }

    if (sel.scope === 'point') {
      const p = design.points[sel.id]
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Point</h2>
          {!p ? (
            <p className="properties-empty">Missing point.</p>
          ) : (
            <>
              <label>
                X
                <input
                  type="number"
                  value={p.x}
                  onChange={(ev) =>
                    ctx.onDesignChange({
                      ...design,
                      points: { ...design.points, [sel.id]: { ...p, x: Number(ev.target.value) || 0 } }
                    })
                  }
                />
              </label>
              <label>
                Y
                <input
                  type="number"
                  value={p.y}
                  onChange={(ev) =>
                    ctx.onDesignChange({
                      ...design,
                      points: { ...design.points, [sel.id]: { ...p, y: Number(ev.target.value) || 0 } }
                    })
                  }
                />
              </label>
            </>
          )}
        </div>
      )
    }

    return null
  }

  if (workspace === 'assemble') {
    if (!asm || shellSelection?.kind !== 'assemble') {
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Component</h2>
          <p className="properties-empty">Select a component in the browser.</p>
        </div>
      )
    }
    const row = asm.components.find((x) => x.id === shellSelection.componentId)
    if (!row) {
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Component</h2>
          <p className="properties-empty">Component not found.</p>
        </div>
      )
    }
    return (
      <div className="properties-panel">
        <h2 className="properties-head">Component</h2>
        <p className="properties-kv">
          <strong>{row.name}</strong>
        </p>
        <p className="properties-kv">Part: {row.partPath}</p>
        {row.meshPath != null && row.meshPath !== '' ? (
          <p className="properties-kv">Mesh (STL): {row.meshPath}</p>
        ) : null}
        <p className="properties-kv">
          Transform: {row.transform.x}, {row.transform.y}, {row.transform.z} mm · R {row.transform.rxDeg},{' '}
          {row.transform.ryDeg},{row.transform.rzDeg}°
        </p>
        <p className="properties-kv">Grounded: {row.grounded ? 'yes' : 'no'}</p>
        {row.joint && <p className="properties-kv">Joint: {row.joint}</p>}
        <p className="properties-kv">BOM qty: {row.bomQuantity}</p>
        {row.referenceTag != null && row.referenceTag !== '' && (
          <p className="properties-kv">Reference: {row.referenceTag}</p>
        )}
        {row.partNumber != null && row.partNumber !== '' && (
          <p className="properties-kv">Part number: {row.partNumber}</p>
        )}
        {row.motionIsolated ? <p className="properties-kv">Motion isolated: yes</p> : null}
        <p className="properties-hint">Full editing is in the Assemble workspace.</p>
      </div>
    )
  }

  if (workspace === 'manufacture') {
    if (!mfg) {
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Manufacture</h2>
          <p className="properties-empty">Loading…</p>
        </div>
      )
    }
    if (shellSelection?.kind === 'manufacture-setup') {
      const s = mfg.setups.find((x) => x.id === shellSelection.id)
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Setup</h2>
          {!s ? (
            <p className="properties-empty">Not found.</p>
          ) : (
            <>
              <p className="properties-kv">
                <strong>{s.label}</strong>
              </p>
              <p className="properties-kv">Machine: {s.machineId}</p>
              {s.wcsNote != null && s.wcsNote !== '' && (
                <p className="properties-kv">WCS: {s.wcsNote}</p>
              )}
              {s.fixtureNote != null && s.fixtureNote !== '' && (
                <p className="properties-kv">Fixture: {s.fixtureNote}</p>
              )}
              {s.workCoordinateIndex != null && (
                <p className="properties-kv">
                  Work offset: G{53 + s.workCoordinateIndex} ({s.workCoordinateIndex})
                </p>
              )}
              {s.stock && <pre className="properties-json">{JSON.stringify(s.stock, null, 2)}</pre>}
            </>
          )}
        </div>
      )
    }
    if (shellSelection?.kind === 'manufacture-op') {
      const op = mfg.operations.find((x) => x.id === shellSelection.id)
      return (
        <div className="properties-panel">
          <h2 className="properties-head">Operation</h2>
          {!op ? (
            <p className="properties-empty">Not found.</p>
          ) : (
            <>
              <p className="properties-kv">
                <strong>{op.label}</strong>
              </p>
              <p className="properties-kv">Kind: {op.kind}</p>
              <p className="properties-kv">Source: {op.sourceMesh ?? '—'}</p>
              <label className="chk">
                <input type="checkbox" checked={!!op.suppressed} readOnly />
                Suppressed (edit in Manufacture workspace)
              </label>
            </>
          )}
        </div>
      )
    }
    return (
      <div className="properties-panel">
        <h2 className="properties-head">Manufacture</h2>
        <p className="properties-empty">Select a setup or operation in the browser.</p>
      </div>
    )
  }

  return null
}
