type Props = {
  /** Shown in the exported title block when set */
  projectName?: string
  disabled?: boolean
  onExportPdf: () => void
  onExportDxf: () => void
}

/**
 * Fusion-style “Drawing” strip for File → Project: real PDF/DXF template export (no 2D views from the model yet).
 */
export function DrawingExportRibbon({ projectName, disabled, onExportPdf, onExportDxf }: Props) {
  return (
    <div
      className="design-ribbon drawing-export-ribbon"
      role="region"
      aria-label="Drawing template export"
      aria-busy={disabled === true}
      data-fab-ribbon="drawing-export"
    >
      <div className="ribbon-group">
        <span className="ribbon-group-label">Drawing</span>
        <p className="msg drawing-export-hint">
          Export a printable <strong>PDF title block</strong> (A4) or a <strong>DXF</strong> sheet. With view slots in{' '}
          <strong>drawing/drawing.json</strong> and <code>output/kernel-part.stl</code> from <strong>Build STEP (kernel)</strong>,
          exports embed <strong>Tier A</strong> mesh-edge projections (no hidden-line removal). Otherwise you get the title
          block and manifest text only. Use Design for meshes or Manufacture for toolpaths.
          {projectName ? (
            <>
              {' '}
              Current document: <strong>{projectName}</strong>.
            </>
          ) : null}
        </p>
        <p className="msg drawing-export-clarity">
          Tier A projections are tessellated-edge documentation only — not certified mechanical drawings. Optional OCC hidden-line
          (Tier B) is future work.
        </p>
        <div className="ribbon-row" role="group" aria-label="Drawing export formats">
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={onExportPdf}
            aria-label="Export drawing as PDF title block"
          >
            Export PDF…
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={onExportDxf}
            aria-label="Export drawing as placeholder DXF"
          >
            Export DXF…
          </button>
        </div>
      </div>
    </div>
  )
}
