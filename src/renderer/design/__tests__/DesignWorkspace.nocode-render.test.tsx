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
})
