import { useCallback, useMemo, useState } from 'react'
import type { AssemblyFile } from '../../shared/assembly-schema'
import type { SketchEntity } from '../../shared/design-schema'
import { kernelOpSummary } from '../../shared/kernel-op-summary'
import type { ManufactureFile } from '../../shared/manufacture-schema'
import { useDesignSessionOptional } from '../design/DesignSessionContext'
import type { Workspace } from './WorkspaceBar'
import type { ShellBrowserSelection } from './browser-selection'

type Props = {
  workspace: Workspace
  projectDir: string | null
  asm: AssemblyFile | null
  mfg: ManufactureFile | null
  shellSelection: ShellBrowserSelection
  onShellSelection: (s: ShellBrowserSelection) => void
  /** When true, hide the scope title row (used inside combo view Model tab). */
  embedInComboView?: boolean
}

function polyPtCount(e: SketchEntity): number {
  if (e.kind !== 'polyline') return 0
  if ('pointIds' in e) return e.pointIds.length
  return e.points.length
}

function TreeRow({
  depth,
  label,
  active,
  onClick,
  itemLabel
}: {
  depth: number
  label: string
  active?: boolean
  onClick?: () => void
  /** Spoken name for the row (e.g. entity id) */
  itemLabel?: string
}) {
  return (
    <div className="browser-tree-row browser-tree-row--dense" style={{ paddingLeft: `${6 + depth * 10}px` }}>
      <button
        type="button"
        className={`browser-tree-label ${active ? 'active' : ''}`}
        onClick={onClick}
        aria-label={itemLabel ?? label}
      >
        {label}
      </button>
    </div>
  )
}

function FeatureTreeRow({
  depth,
  label,
  active,
  suppressed,
  onSelect,
  onToggleSuppress,
  itemLabel
}: {
  depth: number
  label: string
  active?: boolean
  suppressed?: boolean
  onSelect?: () => void
  onToggleSuppress: () => void
  itemLabel?: string
}) {
  return (
    <div className="browser-tree-row browser-tree-row--dense browser-tree-row--with-vis" style={{ paddingLeft: `${6 + depth * 10}px` }}>
      <button
        type="button"
        className={`browser-eye ${suppressed ? 'browser-eye--off' : ''}`}
        title={suppressed ? 'Unsuppress feature' : 'Suppress feature'}
        aria-label={suppressed ? 'Unsuppress feature' : 'Suppress feature'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleSuppress()
        }}
      >
        {suppressed ? '◌' : '●'}
      </button>
      <button
        type="button"
        className={`browser-tree-label ${active ? 'active' : ''}`}
        onClick={onSelect}
        aria-label={itemLabel ?? label}
      >
        {label}
      </button>
    </div>
  )
}

export function BrowserPanel({
  workspace,
  projectDir,
  asm,
  mfg,
  shellSelection,
  onShellSelection,
  embedInComboView = false
}: Props) {
  const designCtx = useDesignSessionOptional()
  const [open, setOpen] = useState<Record<string, boolean>>({
    designRoot: true,
    sketch: true,
    entities: true,
    points: true,
    constraints: true,
    features: true,
    kernelOps: true,
    asmRoot: true,
    mfgRoot: true
  })

  const toggle = useCallback((key: string) => {
    setOpen((o) => ({ ...o, [key]: !o[key] }))
  }, [])

  const design = designCtx?.design
  const features = designCtx?.features
  const setDesignSel = designCtx?.setSelection
  const setKernelOpSuppressedAt = designCtx?.setKernelOpSuppressedAt
  const updateFeatureSuppressed = designCtx?.updateFeatureSuppressed

  const designBody = useMemo(() => {
    if (!designCtx || !design) {
      return (
        <p className="browser-empty" role="status">
          Open a project to browse design data.
        </p>
      )
    }
    const ptCount = Object.keys(design.points).length

    return (
      <>
        <div className="browser-tree-node browser-tree-node--dense">
          <button
            type="button"
            className="browser-tree-caret"
            onClick={() => toggle('designRoot')}
            aria-expanded={open.designRoot}
            aria-label={open.designRoot ? 'Collapse Document section' : 'Expand Document section'}
          >
            {open.designRoot ? '▼' : '▶'}
          </button>
          <span className="browser-tree-heading">Document</span>
        </div>
        {open.designRoot && (
          <>
            <div className="browser-tree-node">
              <button
                type="button"
                className="browser-tree-caret"
                onClick={() => toggle('sketch')}
                aria-expanded={open.sketch}
                aria-label={open.sketch ? 'Collapse Sketch section' : 'Expand Sketch section'}
              >
                {open.sketch ? '▼' : '▶'}
              </button>
              <span className="browser-tree-heading">Sketch</span>
            </div>
            {open.sketch && (
              <>
                <div className="browser-tree-node">
                  <button
                    type="button"
                    className="browser-tree-caret"
                    onClick={() => toggle('entities')}
                    aria-expanded={open.entities}
                    aria-label={open.entities ? 'Collapse Entities section' : 'Expand Entities section'}
                  >
                    {open.entities ? '▼' : '▶'}
                  </button>
                  <span className="browser-tree-heading">Entities ({design.entities.length})</span>
                </div>
                {open.entities &&
                  design.entities.map((e) => (
                    <TreeRow
                      key={e.id}
                      depth={2}
                      label={`${e.kind} ${
                        e.kind === 'rect'
                          ? `${e.w}×${e.h}`
                          : e.kind === 'slot'
                            ? `L=${e.length.toFixed(1)} W=${e.width.toFixed(1)}`
                            : e.kind === 'circle'
                              ? `r=${e.r.toFixed(1)}`
                              : `(${polyPtCount(e)} pts)`
                      }`}
                      active={designCtx.selection?.scope === 'entity' && designCtx.selection.id === e.id}
                      onClick={() => setDesignSel?.({ scope: 'entity', id: e.id })}
                    />
                  ))}
                <div className="browser-tree-node">
                  <button
                    type="button"
                    className="browser-tree-caret"
                    onClick={() => toggle('points')}
                    aria-expanded={open.points}
                    aria-label={open.points ? 'Collapse Points section' : 'Expand Points section'}
                  >
                    {open.points ? '▼' : '▶'}
                  </button>
                  <span className="browser-tree-heading">Points ({ptCount})</span>
                </div>
                {open.points &&
                  Object.keys(design.points).map((pid) => (
                    <TreeRow
                      key={pid}
                      depth={2}
                      label={pid.slice(0, 8) + '…'}
                      itemLabel={`Sketch point ${pid}`}
                      active={designCtx.selection?.scope === 'point' && designCtx.selection.id === pid}
                      onClick={() => setDesignSel?.({ scope: 'point', id: pid })}
                    />
                  ))}
                <div className="browser-tree-node">
                  <button
                    type="button"
                    className="browser-tree-caret"
                    onClick={() => toggle('constraints')}
                    aria-expanded={open.constraints}
                    aria-label={open.constraints ? 'Collapse Constraints section' : 'Expand Constraints section'}
                  >
                    {open.constraints ? '▼' : '▶'}
                  </button>
                  <span className="browser-tree-heading">Constraints ({design.constraints.length})</span>
                </div>
                {open.constraints &&
                  design.constraints.map((c) => (
                    <TreeRow
                      key={c.id}
                      depth={2}
                      label={`${c.type}`}
                      active={designCtx.selection?.scope === 'constraint' && designCtx.selection.id === c.id}
                      onClick={() => setDesignSel?.({ scope: 'constraint', id: c.id })}
                    />
                  ))}
              </>
            )}
            <div className="browser-tree-node">
              <button
                type="button"
                className="browser-tree-caret"
                onClick={() => toggle('features')}
                aria-expanded={open.features}
                aria-label={open.features ? 'Collapse Features section' : 'Expand Features section'}
              >
                {open.features ? '▼' : '▶'}
              </button>
              <span className="browser-tree-heading">Features ({features?.items.length ?? 0})</span>
            </div>
            {open.features &&
              features?.items.map((it) => (
                <FeatureTreeRow
                  key={it.id}
                  depth={1}
                  label={`${it.label} (${it.kind})${it.suppressed ? ' · off' : ''}`}
                  suppressed={!!it.suppressed}
                  active={designCtx.selection?.scope === 'feature' && designCtx.selection.id === it.id}
                  onSelect={() => setDesignSel?.({ scope: 'feature', id: it.id })}
                  onToggleSuppress={() => void updateFeatureSuppressed?.(it.id, !it.suppressed)}
                />
              ))}
            <div className="browser-tree-node">
              <button
                type="button"
                className="browser-tree-caret"
                onClick={() => toggle('kernelOps')}
                aria-expanded={open.kernelOps}
                aria-label={open.kernelOps ? 'Collapse Kernel ops' : 'Expand Kernel ops'}
              >
                {open.kernelOps ? '▼' : '▶'}
              </button>
              <span className="browser-tree-heading">
                Kernel ops ({features?.kernelOps?.length ?? 0})
              </span>
            </div>
            {open.kernelOps &&
              (features?.kernelOps?.length ? (
                features.kernelOps.map((op, ki) => (
                  <div
                    key={`ko-${ki}-${op.kind}`}
                    className="browser-kernel-row browser-indent-1"
                  >
                    <button
                      type="button"
                      className={`browser-eye ${op.suppressed ? 'browser-eye--off' : ''}`}
                      title={op.suppressed ? 'Enable in kernel build' : 'Suppress in kernel build'}
                      aria-label={op.suppressed ? `Enable kernel op ${ki + 1}` : `Suppress kernel op ${ki + 1}`}
                      onClick={() => void setKernelOpSuppressedAt?.(ki, !op.suppressed)}
                    >
                      {op.suppressed ? '◌' : '●'}
                    </button>
                    <span className="browser-kernel-label" title={JSON.stringify(op)}>
                      {ki + 1}. {kernelOpSummary(op)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="browser-empty browser-empty--nested" role="status">
                  No post-solid ops
                </p>
              ))}
          </>
        )}
      </>
    )
  }, [design, designCtx, features, open, setDesignSel, setKernelOpSuppressedAt, toggle, updateFeatureSuppressed])

  const assembleBody = useMemo(() => {
    if (!projectDir)
      return (
        <p className="browser-empty" role="status">
          Open a project.
        </p>
      )
    if (!asm)
      return (
        <p className="browser-empty" role="status" aria-live="polite">
          Loading…
        </p>
      )
    return (
      <>
        <div className="browser-tree-node">
          <button
            type="button"
            className="browser-tree-caret"
            onClick={() => toggle('asmRoot')}
            aria-expanded={open.asmRoot}
            aria-label={open.asmRoot ? 'Collapse Components section' : 'Expand Components section'}
          >
            {open.asmRoot ? '▼' : '▶'}
          </button>
          <span className="browser-tree-heading">Components ({asm.components.length})</span>
        </div>
        {open.asmRoot &&
          asm.components.map((c) => {
            const qty = c.bomQuantity > 1 ? ` ×${c.bomQuantity}` : ''
            const pn = c.partNumber ? ` [${c.partNumber}]` : ''
            const iso = c.motionIsolated ? ' (isolated)' : ''
            return (
              <TreeRow
                key={c.id}
                depth={1}
                label={`${c.name}${qty}${pn}${iso}${c.suppressed ? ' · off' : ''}`}
                active={shellSelection?.kind === 'assemble' && shellSelection.componentId === c.id}
                onClick={() => onShellSelection({ kind: 'assemble', componentId: c.id })}
              />
            )
          })}
      </>
    )
  }, [asm, onShellSelection, open.asmRoot, projectDir, shellSelection, toggle])

  const manufactureBody = useMemo(() => {
    if (!projectDir)
      return (
        <p className="browser-empty" role="status">
          Open a project.
        </p>
      )
    if (!mfg)
      return (
        <p className="browser-empty" role="status" aria-live="polite">
          Loading…
        </p>
      )
    return (
      <>
        <div className="browser-tree-node">
          <button
            type="button"
            className="browser-tree-caret"
            onClick={() => toggle('mfgRoot')}
            aria-expanded={open.mfgRoot}
            aria-label={open.mfgRoot ? 'Collapse Manufacture section' : 'Expand Manufacture section'}
          >
            {open.mfgRoot ? '▼' : '▶'}
          </button>
          <span className="browser-tree-heading">Manufacture</span>
        </div>
        {open.mfgRoot && (
          <>
            <div className="browser-tree-heading browser-indent-1">
              Setups ({mfg.setups.length})
            </div>
            {mfg.setups.map((s) => (
              <TreeRow
                key={s.id}
                depth={1}
                label={s.label}
                active={shellSelection?.kind === 'manufacture-setup' && shellSelection.id === s.id}
                onClick={() => onShellSelection({ kind: 'manufacture-setup', id: s.id })}
              />
            ))}
            <div className="browser-tree-heading browser-indent-1">
              Operations ({mfg.operations.length})
            </div>
            {mfg.operations.map((op) => (
              <TreeRow
                key={op.id}
                depth={1}
                label={op.label}
                active={shellSelection?.kind === 'manufacture-op' && shellSelection.id === op.id}
                onClick={() => onShellSelection({ kind: 'manufacture-op', id: op.id })}
              />
            ))}
          </>
        )}
      </>
    )
  }, [mfg, onShellSelection, open.mfgRoot, projectDir, shellSelection, toggle])

  const title =
    workspace === 'design'
      ? 'Design'
      : workspace === 'assemble'
        ? 'Assemble'
        : workspace === 'manufacture'
          ? 'Manufacture'
          : 'File'

  const headId = 'browser-panel-scope-title'

  return (
    <div className="browser-panel">
      {!embedInComboView && (
        <div className="browser-panel-head" id={headId}>
          {title}
        </div>
      )}
      <div
        className="browser-panel-body"
        role="region"
        aria-label={embedInComboView ? `${title} browser` : undefined}
        aria-labelledby={embedInComboView ? undefined : headId}
      >
        {workspace === 'design' && designBody}
        {workspace === 'assemble' && assembleBody}
        {workspace === 'manufacture' && manufactureBody}
        {workspace === 'utilities' && (
          <p className="browser-empty" role="status">
            Switch to Design, Assemble, or Manufacture for the model browser. File is for project + settings only.
          </p>
        )}
      </div>
    </div>
  )
}
