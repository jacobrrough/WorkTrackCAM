/**
 * DesignWorkspaceHost — route → view-mode threading pin (CAD V1 Wire phase).
 *
 * Companion to `DesignWorkspaceHost.test.tsx` (which pins the session →
 * KernelTimeline path). This pin proves the OTHER prop the new-shell
 * `WorkspaceHost` now threads through the host: `initialViewMode`. The
 * `assemble` route maps to `'assembly'`, so the host must open DesignWorkspace
 * on the Assembly tab — mounting the AssemblyView (and, once the operator adds
 * a part, the mate-creation surface) instead of the Part editor.
 *
 * Reachability proven here: mounting `DesignWorkspaceHost` with
 * `initialViewMode='assembly'` lights up `design-assembly-view` and suppresses
 * the Part editor column — i.e. the `assemble` route lands on the Assembly tab
 * end-to-end through the host, which is what makes the dormant assembly/mate UI
 * reachable in the running shell.
 *
 * Why inject the session via the raw `DesignSessionContext.Provider`? Same
 * reason as the sibling host test — the real `DesignSessionProvider` derives
 * its value asynchronously from `fab.featuresLoad`, which a synchronous
 * `renderToStaticMarkup` cannot flush. A hand-built value is the deterministic
 * node-env equivalent and exercises the exact host → workspace prop path.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesignWorkspaceHost } from '../DesignWorkspaceHost'
import {
  DesignSessionContext,
  type DesignSessionValue,
} from '../../design/DesignSessionContext'
import type { DesignViewMode } from '../../design/DesignWorkspace'
import { emptyDesign } from '../../../shared/design-schema'

// ── window.fab shim ────────────────────────────────────────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}
;(gAsRecord['window'] as Record<string, unknown>)['fab'] = gAsRecord['fab']

/**
 * A minimal, render-only `DesignSessionValue`. `features = null` keeps the
 * KernelTimeline out of the picture (this pin is only about the view-mode
 * tab) — exactly the CAD-first boot state. Every handler is a no-op stub the
 * render path never invokes.
 */
function fakeSession(): DesignSessionValue {
  const asyncNoop = async (): Promise<void> => {}
  return {
    projectDir: null,
    design: emptyDesign(),
    pastLength: 0,
    features: null,
    loaded: false,
    geometry: null,
    viewportGeometry: null,
    inspectMeshSourceLabel: '—',
    kernelManifest: null,
    kernelInspectStaleReason: null,
    refreshKernelInspectGeometry: asyncNoop,
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
    removeKernelOpAt: asyncNoop,
    moveKernelOp: asyncNoop,
    reorderKernelOps: asyncNoop,
    setKernelOpSuppressedAt: asyncNoop,
    setKernelRollbackMarker: asyncNoop,
    updateFeatureSuppressed: () => {},
    solveReport: '',
  }
}

function renderHost(initialViewMode?: DesignViewMode): string {
  return renderToStaticMarkup(
    createElement(
      DesignSessionContext.Provider,
      { value: fakeSession() },
      createElement(DesignWorkspaceHost, {
        initialScript:
          'import cadquery as cq\nshow_object(cq.Workplane("XY").box(1, 1, 1))',
        onSave: vi.fn(),
        onSendToCam: vi.fn(),
        onToast: vi.fn(),
        initialViewMode,
        onMateAdded: vi.fn(),
      }),
    ),
  )
}

describe('DesignWorkspaceHost — initialViewMode threading', () => {
  it('opens the Assembly tab when initialViewMode is "assembly" (the assemble route)', () => {
    const html = renderHost('assembly')
    expect(html).toContain('data-testid="design-assembly-view"')
    // The Part editor column must NOT be in the DOM — the route landed on the
    // Assembly tab, not the default Part view.
    expect(html).not.toContain('design-workspace__editor-col')
  })

  it('opens the Drawing tab when initialViewMode is "drawing" (the drawings route)', () => {
    const html = renderHost('drawing')
    expect(html).toContain('data-testid="design-drawing-view"')
    expect(html).not.toContain('design-workspace__editor-col')
  })

  it('falls back to the Part view when initialViewMode is omitted (legacy/default)', () => {
    const html = renderHost(undefined)
    // No view-mode → DesignWorkspace's own 'part' default → editor column up.
    expect(html).toContain('design-workspace__editor-col')
    expect(html).not.toContain('data-testid="design-assembly-view"')
  })

  it('marks the Assembly tab active in the tab bar when on the assemble route', () => {
    const html = renderHost('assembly')
    const assemblyTab = html.match(
      /<button[^>]*data-testid="design-workspace-tab-assembly"[^>]*>/,
    )
    expect(assemblyTab).not.toBeNull()
    expect(assemblyTab?.[0].includes('aria-selected="true"')).toBe(true)
  })
})
