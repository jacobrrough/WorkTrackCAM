import { useCallback, useEffect, useMemo, useRef } from 'react'
import { kernelOpSummary } from '../../shared/kernel-op-summary'
import { useDesignSessionOptional } from '../design/DesignSessionContext'

export function TimelineBar() {
  const ctx = useDesignSessionOptional()
  const items = ctx?.features?.items ?? []
  const kernelOps = ctx?.features?.kernelOps ?? []

  const selectedFeatureId = ctx?.selection?.scope === 'feature' ? ctx.selection.id : null
  const selectedItem = useMemo(
    () => (selectedFeatureId ? items.find((x) => x.id === selectedFeatureId) : undefined),
    [items, selectedFeatureId]
  )

  const featureIx = useMemo(
    () => (selectedFeatureId ? items.findIndex((x) => x.id === selectedFeatureId) : -1),
    [items, selectedFeatureId]
  )

  const featuresScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!selectedFeatureId || !featuresScrollRef.current) return
    const el = featuresScrollRef.current.querySelector<HTMLElement>(`[data-timeline-feature-id="${selectedFeatureId}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [selectedFeatureId])

  const goFirstFeature = useCallback(() => {
    if (!ctx || items.length === 0) return
    ctx.setSelection({ scope: 'feature', id: items[0]!.id })
  }, [ctx, items])

  const goLastFeature = useCallback(() => {
    if (!ctx || items.length === 0) return
    ctx.setSelection({ scope: 'feature', id: items[items.length - 1]!.id })
  }, [ctx, items])

  const goPrevFeature = useCallback(() => {
    if (!ctx || items.length === 0) return
    const ix = featureIx >= 0 ? featureIx : items.length
    const nextIx = Math.max(0, ix - 1)
    ctx.setSelection({ scope: 'feature', id: items[nextIx]!.id })
  }, [ctx, items, featureIx])

  const goNextFeature = useCallback(() => {
    if (!ctx || items.length === 0) return
    const ix = featureIx >= 0 ? featureIx : -1
    const nextIx = Math.min(items.length - 1, ix + 1)
    ctx.setSelection({ scope: 'feature', id: items[nextIx]!.id })
  }, [ctx, items, featureIx])

  if (!ctx?.projectDir) {
    return <div className="timeline-bar timeline-bar--empty">Open a project for feature history.</div>
  }

  return (
    <div className="timeline-stack" data-fab-ribbon="timeline">
      <div className="timeline-bar timeline-bar--kernel" role="list" aria-label="Kernel operation queue">
        <span className="timeline-rail-label" title="Order matches part/features.json — sent to CadQuery when not suppressed">
          Kernel
        </span>
        <div className="timeline-rail-scroll">
          {kernelOps.length === 0 ? (
            <span className="timeline-empty">No post-solid ops — use Modify tab to append.</span>
          ) : (
            kernelOps.map((op, i) => (
              <div
                key={`${i}-${op.kind}`}
                className={`timeline-kernel-chip ${op.suppressed ? 'timeline-kernel-chip--suppressed' : ''}`}
                role="listitem"
                title={kernelOpSummary(op)}
              >
                <span className="timeline-kernel-ix">{i + 1}</span>
                <span className="timeline-kernel-kind">{op.kind}</span>
                <label className="timeline-kernel-supp chk">
                  <input
                    type="checkbox"
                    checked={!!op.suppressed}
                    onChange={(e) => void ctx.setKernelOpSuppressedAt(i, e.target.checked)}
                    aria-label={`Suppress kernel op ${i + 1}`}
                  />
                </label>
                <div className="timeline-kernel-actions">
                  <button
                    type="button"
                    className="timeline-kernel-move"
                    disabled={i === 0}
                    onClick={() => void ctx.moveKernelOp(i, -1)}
                    aria-label={`Move kernel op ${i + 1} earlier`}
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    className="timeline-kernel-move"
                    disabled={i >= kernelOps.length - 1}
                    onClick={() => void ctx.moveKernelOp(i, 1)}
                    aria-label={`Move kernel op ${i + 1} later`}
                  >
                    ▶
                  </button>
                  <button
                    type="button"
                    className="timeline-kernel-remove"
                    onClick={() => void ctx.removeKernelOpAt(i)}
                    aria-label={`Remove kernel op ${i + 1}`}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="timeline-bar timeline-bar--features" role="list" aria-label="Feature timeline">
        <div className="timeline-feature-controls" aria-label="Feature timeline navigation">
          <button
            type="button"
            className="timeline-transport-btn"
            disabled={!ctx || items.length === 0}
            onClick={goFirstFeature}
            title="Go to first feature"
            aria-label="Go to first feature"
          >
            ⏮
          </button>
          <button
            type="button"
            className="timeline-transport-btn"
            disabled={!ctx || items.length === 0 || featureIx === 0}
            onClick={goPrevFeature}
            title="Previous feature"
            aria-label="Previous feature"
          >
            ◀
          </button>
          <button
            type="button"
            className="timeline-transport-btn"
            disabled={!ctx || items.length === 0 || featureIx === items.length - 1}
            onClick={goNextFeature}
            title="Next feature"
            aria-label="Next feature"
          >
            ▶
          </button>
          <button
            type="button"
            className="timeline-transport-btn"
            disabled={!ctx || items.length === 0}
            onClick={goLastFeature}
            title="Go to last feature"
            aria-label="Go to last feature"
          >
            ⏭
          </button>
        </div>
        <span className="timeline-rail-label">Features</span>
        <div className="timeline-rail-scroll" ref={featuresScrollRef}>
          {items.length === 0 ? (
            <span className="timeline-empty">No feature metadata — save design to derive features.</span>
          ) : (
            items.map((it) => {
              const active = ctx.selection?.scope === 'feature' && ctx.selection.id === it.id
              return (
                <button
                  key={it.id}
                  type="button"
                  role="listitem"
                  data-timeline-feature-id={it.id}
                  className={`timeline-item ${active ? 'active' : ''} ${it.suppressed ? 'suppressed' : ''}`}
                  onClick={() => ctx.setSelection({ scope: 'feature', id: it.id })}
                  title={it.label}
                >
                  <span className="timeline-kind">{it.kind}</span>
                  <span className="timeline-label">{it.label}</span>
                  {it.suppressed ? <span className="timeline-off">off</span> : null}
                </button>
              )
            })
          )}
        </div>
        {selectedFeatureId && selectedItem && (
          <div className="timeline-actions">
            <label className="chk timeline-suppress">
              <input
                type="checkbox"
                checked={!!selectedItem.suppressed}
                onChange={() => void ctx.updateFeatureSuppressed(selectedFeatureId, !selectedItem.suppressed)}
              />
              Suppress
            </label>
          </div>
        )}
      </div>
    </div>
  )
}
