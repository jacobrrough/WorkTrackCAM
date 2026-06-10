/**
 * DesignWorkspace — no-code build→render pin.
 *
 * Before this wiring the cockpit viewport only ever rendered geometry produced
 * by the CadQuery `execute_script` path (the internal selection-grade
 * `viewportGeometry`). The no-code feature timeline (extrude → fillet a picked
 * edge, …) emitted ops and the host session built a STEP+STL, but nothing
 * threaded that built solid into the rendered viewport — so adding a no-code
 * feature displayed nothing.
 *
 * These pins lock the additive render path:
 *   1. With NO script result but a host-supplied `kernelViewportGeometry`, the
 *      cockpit mounts the 3D viewport on that geometry (the no-code solid shows).
 *   2. The script path still wins: when a script HAS run (an internal geometry
 *      exists) the kernel fallback is NOT what renders — but we can't easily
 *      construct the internal script geometry here, so we assert the inverse
 *      contract instead: with neither geometry the new empty-state copy shows.
 *   3. `kernelBuilding` renders the non-blocking "Building model…" overlay.
 *
 * `Viewport3D` mounts a real WebGL canvas, which the node-env vitest cannot
 * instantiate; we mock it to a sentinel `<div>` that echoes whether it received
 * a geometry. `MvpSketchCanvas` is likewise mocked (a sibling agent owns the
 * sketcher; we only need it inert here). This is a test double, not an edit of
 * those source files.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE from 'three'

vi.mock('../Viewport3D', () => ({
  Viewport3D: ({ geometry }: { geometry: THREE.BufferGeometry | null }) =>
    createElement('div', {
      'data-testid': 'mock-viewport3d',
      'data-has-geometry': geometry ? 'true' : 'false'
    })
}))

vi.mock('../Sketch2DCanvas', () => ({
  MvpSketchCanvas: () => createElement('div', { 'data-testid': 'mock-sketch-canvas' })
}))

import { DesignWorkspace } from '../DesignWorkspace'

function makeBoxGeometry(): THREE.BufferGeometry {
  // A plain BufferGeometry needs no WebGL context to construct.
  const g = new THREE.BufferGeometry()
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)
  )
  return g
}

describe('DesignWorkspace — no-code build→render', () => {
  it('mounts the viewport on the host kernel geometry when no script has run', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# no-code: the timeline built this, not a script run',
        kernelViewportGeometry: makeBoxGeometry()
      })
    )
    // The no-code solid reaches the rendered viewport.
    expect(html).toContain('data-testid="mock-viewport3d"')
    expect(html).toContain('data-has-geometry="true"')
    // It is NOT the empty-state.
    expect(html).not.toContain('data-testid="design-workspace-viewport-empty"')
  })

  it('shows the empty-state (new no-code copy) when neither script nor kernel geometry exists', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# typed but not run',
        kernelViewportGeometry: null
      })
    )
    expect(html).toContain('data-testid="design-workspace-viewport-empty"')
    expect(html).toContain('Build a model to see it here')
    expect(html).not.toContain('data-testid="mock-viewport3d"')
  })

  it('renders the "Building model…" overlay while a kernel build is in flight', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# building',
        kernelBuilding: true
      })
    )
    expect(html).toContain('data-testid="design-workspace-build-indicator"')
    expect(html).toContain('Building model…')
  })

  it('does NOT render the build overlay when not building', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# idle',
        kernelBuilding: false
      })
    )
    expect(html).not.toContain('data-testid="design-workspace-build-indicator"')
  })

  it('mounts the Inspect (Measure / Section) toggles whenever a model is displayed', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# no-code model',
        kernelViewportGeometry: makeBoxGeometry()
      })
    )
    expect(html).toContain('data-testid="design-workspace-inspect-tools"')
    expect(html).toContain('data-testid="design-workspace-inspect-measure"')
    expect(html).toContain('data-testid="design-workspace-inspect-section"')
  })

  it('does NOT mount the Inspect toggles when no model is displayed (empty-state)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# typed but not run',
        kernelViewportGeometry: null
      })
    )
    expect(html).not.toContain('data-testid="design-workspace-inspect-tools"')
  })

  it('arms the sketch-on-face prompt when sketchPlanePickArmed + a model is shown', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# pick a face to sketch on',
        kernelViewportGeometry: makeBoxGeometry(),
        sketchPlanePickArmed: true
      })
    )
    expect(html).toContain('data-testid="design-workspace-sketch-plane-prompt"')
    expect(html).toContain('Click a face to start a sketch')
  })

  it('does NOT show the sketch-on-face prompt without a model to pick from', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# armed but nothing to pick',
        kernelViewportGeometry: null,
        sketchPlanePickArmed: true
      })
    )
    expect(html).not.toContain('data-testid="design-workspace-sketch-plane-prompt"')
  })

  it('renders the Construct datum picker buttons when a session sink is threaded', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# session with datum picker',
        kernelViewportGeometry: makeBoxGeometry(),
        onAppendKernelOp: () => undefined
      })
    )
    // The Plane / Axis / Point datum picker buttons join the 6 solid features.
    expect(html).toContain('data-testid="design-workspace-feature-pick-datum_plane"')
    expect(html).toContain('data-testid="design-workspace-feature-pick-datum_axis"')
    expect(html).toContain('data-testid="design-workspace-feature-pick-datum_point"')
  })

  // task_f76b39b3 — picking gates on CAPABILITY, not source: a pick-tagged
  // no-code kernel mesh (rebuilt from output/kernel-part.pick.json) gets the
  // Faces/Edges selection-mode toggle; a legacy untagged kernel STL does not.
  it('shows the selection-mode toggle for a PICK-TAGGED kernel geometry', () => {
    const tagged = makeBoxGeometry()
    tagged.userData = {
      faceIds: [0],
      faceOcctIds: ['f:abc'],
      pickableEdges: [{ edgeId: 0, occtId: 'e:001', positions: new Float32Array(6) }]
    }
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# no-code model with pick data',
        kernelViewportGeometry: tagged
      })
    )
    expect(html).toContain('data-testid="design-workspace-selection-mode"')
  })

  it('does NOT show the selection-mode toggle for an untagged kernel STL', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: '# legacy untagged kernel mesh',
        kernelViewportGeometry: makeBoxGeometry()
      })
    )
    expect(html).not.toContain('data-testid="design-workspace-selection-mode"')
  })
})
