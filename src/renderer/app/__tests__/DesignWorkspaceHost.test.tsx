/**
 * DesignWorkspaceHost — new-shell session→timeline wiring pin.
 *
 * `DesignWorkspaceHost` is the ONLY new-shell code that reads
 * `useDesignSession()`. It maps the session's editable kernel-op timeline
 * (`features.kernelOps` + the reorder / move / suppress / roll-back handlers)
 * onto the prop-driven `DesignWorkspace`, which forwards them to the
 * FeatureTree's KernelTimeline.
 *
 * This pin proves the feature is now REACHABLE end-to-end through the host:
 *   1. With an active session whose `features.kernelOps` is non-empty, the
 *      KernelTimeline (`data-testid="cad-kernel-timeline"`) renders with one
 *      row per op — i.e. mounting the host inside a session lights up the
 *      timeline that was dormant before this wiring.
 *   2. With an active session but no features (the CAD-first boot state, where
 *      the DesignSessionProvider is inert because `projectDir == null`), the
 *      timeline is ABSENT — the required "timeline simply does not render"
 *      backward-compatible fallback. The rest of DesignWorkspace still renders.
 *
 * Why inject the session via `DesignSessionContext.Provider` rather than the
 * real `DesignSessionProvider`? The real provider derives its value
 * asynchronously from `fab.featuresLoad`, which a synchronous
 * `renderToStaticMarkup` cannot flush. Wrapping the raw context with a
 * hand-built value is the deterministic node-env equivalent and exercises the
 * exact host→workspace→FeatureTree prop path the running shell uses.
 *
 * Why `renderToStaticMarkup`? Same rationale as the sibling
 * `DesignWorkspace.test.tsx` / `FeatureTree.timeline.test.tsx` — the project's
 * node-env vitest ships no DOM, so we assert on the server-rendered HTML.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesignWorkspaceHost } from '../DesignWorkspaceHost'
import {
  DesignSessionContext,
  type DesignSessionValue
} from '../../design/DesignSessionContext'
import { defaultPartFeatures, type KernelPostSolidOp, type PartFeaturesFile } from '../../../shared/part-features-schema'
import { emptyDesign } from '../../../shared/design-schema'

// ── window.fab shim ────────────────────────────────────────────────────────
// DesignWorkspace reads `window.fab` for its `cad.*` effects. Effects do not
// run under renderToStaticMarkup, but the module-level `fab` accessor must
// resolve to a defined object so the render path never touches `undefined`.
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}
;(gAsRecord['window'] as Record<string, unknown>)['fab'] = gAsRecord['fab']

// ── Fixtures ───────────────────────────────────────────────────────────────

const unionBox = (): KernelPostSolidOp => ({
  kind: 'boolean_union_box',
  xMinMm: 0,
  xMaxMm: 10,
  yMinMm: 0,
  yMaxMm: 10,
  zMinMm: 0,
  zMaxMm: 5
})
const filletAll = (radiusMm = 0.5): KernelPostSolidOp => ({ kind: 'fillet_all', radiusMm })

/**
 * Build a complete `DesignSessionValue`. Only `features` is meaningful for the
 * timeline pin; every handler is a no-op stub (the render path never invokes
 * them, and the pure edit-action mapping is proven in
 * `feature-timeline-actions.test.ts`).
 */
function fakeSession(features: PartFeaturesFile | null): DesignSessionValue {
  const asyncNoop = async (): Promise<void> => {}
  return {
    projectDir: features ? '/tmp/wt-project' : null,
    design: emptyDesign(),
    pastLength: 0,
    features,
    loaded: features != null,
    geometry: null,
    viewportGeometry: null,
    inspectMeshSourceLabel: '—',
    kernelManifest: null,
    kernelInspectStaleReason: null,
    kernelBuilding: false,
    refreshKernelInspectGeometry: asyncNoop,
    buildKernelPart: asyncNoop,
    selection: null,
    setSelection: () => {},
    dispatch: () => {},
    onDesignChange: () => {},
    saveDesign: asyncNoop,
    exportStl: asyncNoop,
    removeEntity: () => {},
    addPresetRect: () => {},
    addConstraint: () => {},
    runSolve: () => {},
    setParameter: () => {},
    mirrorX: () => {},
    pattern40X: () => {},
    undo: () => {},
    setFeatures: () => {},
    appendKernelOp: asyncNoop,
    updateKernelOpAt: asyncNoop,
    removeKernelOpAt: asyncNoop,
    moveKernelOp: asyncNoop,
    reorderKernelOps: asyncNoop,
    setKernelOpSuppressedAt: asyncNoop,
    setKernelRollbackMarker: asyncNoop,
    updateFeatureSuppressed: () => {},
    solveReport: '',
    drawing: null,
    onDrawingChange: () => {},
    drawingWorkspace: null,
    onDrawingSelectSheet: () => {},
    onDrawingAddSheet: () => {},
    onDrawingRenameSheet: () => {},
    onDrawingDeleteSheet: () => {}
  }
}

function renderHost(features: PartFeaturesFile | null): string {
  return renderToStaticMarkup(
    createElement(
      DesignSessionContext.Provider,
      { value: fakeSession(features) },
      createElement(DesignWorkspaceHost, {
        initialScript: 'import cadquery as cq\nshow_object(cq.Workplane("XY").box(1, 1, 1))',
        onSave: vi.fn(),
        onSendToCam: vi.fn(),
        onToast: vi.fn()
      })
    )
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DesignWorkspaceHost — session → KernelTimeline wiring', () => {
  it('renders the KernelTimeline when the active session has kernel ops', () => {
    const features: PartFeaturesFile = {
      ...defaultPartFeatures(),
      kernelOps: [unionBox(), filletAll()]
    }
    const html = renderHost(features)
    // The dormant timeline is now reachable through the host.
    expect(html).toContain('data-testid="cad-kernel-timeline"')
    const rows = html.match(/data-testid="cad-kernel-row"/g) ?? []
    expect(rows).toHaveLength(2)
    // Friendly labels confirm the ops threaded all the way to the FeatureTree.
    expect(html).toContain('Union box')
    expect(html).toContain('Fillet all · 0.5 mm')
  })

  it('does NOT render the KernelTimeline when there is no active design session', () => {
    // `features == null` is the CAD-first boot state (provider inert, no project).
    const html = renderHost(null)
    expect(html).not.toContain('data-testid="cad-kernel-timeline"')
    // The workspace itself still renders (three-pane shell present).
    expect(html).toContain('design-workspace__tree-col')
  })

  it('does NOT render the KernelTimeline when the session has an empty kernelOps list', () => {
    const features: PartFeaturesFile = { ...defaultPartFeatures(), kernelOps: [] }
    const html = renderHost(features)
    expect(html).not.toContain('data-testid="cad-kernel-timeline"')
  })
})
