/**
 * WINDOW/BOX SELECT — INTERACTIVE behaviour spec (happy-dom).
 *
 * The node suite proves the pure halves (drag-state transitions, the
 * projected-vertex CROSSING hit-test in both projections, source-pinned
 * wiring); this spec proves what only a real DOM can:
 *   - a SHIFT+left pointerdown STARTS a drag and RENDERS the dashed
 *     rectangle overlay while the pointer moves (a plain left down does
 *     not),
 *   - releasing an above-slop drag runs the REAL hit-test
 *     (`computeBoxSelectedFaceIds` over a real THREE.OrthographicCamera +
 *     tessellated-shape geometry) and commits the union through the REAL
 *     state transition (`addFacesToSelection`) — the harness badge shows
 *     the multi-face count exactly like the workspace chip,
 *   - a sub-slop shift+click commits nothing,
 *   - a second box is ADDITIVE, and an empty box changes nothing.
 *
 * The harness mirrors `Viewport3D`'s wiring 1:1 (capture-phase shift+left
 * gate → BoxDragState in a useState cell → overlay from boxDragRect →
 * release hit-test + addFacesToSelection commit) around a plain div standing
 * in for the WebGL canvas, which happy-dom cannot mount. The one divergence:
 * the real component additionally requires the gesture to START on the
 * HTMLCanvasElement and stops propagation so OrbitControls never sees the
 * pointerdown — both pinned against the real source in
 * `selection-box.test.ts`. Run with `npm run test:dom` or
 * `npx vitest run --config vitest.dom.config.ts <this file>`.
 */

import { useState } from 'react'
import type { JSX } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as THREE from 'three'
import {
  beginBoxDrag,
  boxDragRect,
  computeBoxSelectedFaceIds,
  isBoxDragClick,
  updateBoxDrag,
  type BoxDragState,
} from '../selection-box'
import {
  addFacesToSelection,
  selectedFaceIds,
  type Selection,
} from '../selection-state'

// ── Real camera + geometry (identical fixtures to the node pins) ────────────

/** Ortho ±50 frustum at z=+100 → 100×100 px maps as sx = x+50, sy = 50-y. */
function makeOrthoCamera(): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000)
  cam.position.set(0, 0, 100)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

/**
 * Two separated quads with faceIds [0,0,1,1]:
 *   face 0 on screen: sx ∈ [10, 30], sy ∈ [40, 60]
 *   face 1 on screen: sx ∈ [70, 90], sy ∈ [40, 60]
 */
function makeTwoQuadGeometry(): { geometry: THREE.BufferGeometry; faceIds: number[] } {
  const g = new THREE.BufferGeometry()
  const positions = new Float32Array([
    -40, -10, 0, -20, -10, 0, -20, 10, 0, -40, 10, 0,
    20, -10, 0, 40, -10, 0, 40, 10, 0, 20, 10, 0,
  ])
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7])
  return { geometry: g, faceIds: [0, 0, 1, 1] }
}

const VIEWPORT = { width: 100, height: 100 }

/**
 * Mirrors Viewport3D's box-select seam: capture-phase SHIFT+left gate,
 * BoxDragState cell, overlay from boxDragRect, release → hit-test →
 * addFacesToSelection. happy-dom's getBoundingClientRect is all-zeros, so
 * client px ARE wrapper-local px here — the same coordinate space the real
 * component derives via its `boxLocalPoint` helper.
 */
function Harness(): JSX.Element {
  const { geometry, faceIds } = makeTwoQuadGeometry()
  const camera = makeOrthoCamera()
  const [drag, setDrag] = useState<BoxDragState | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)

  return (
    <div style={{ position: 'relative' }}>
      <div
        data-testid="fake-viewport"
        onPointerDownCapture={(e) => {
          if (drag !== null) return
          if (e.button !== 0 || !e.shiftKey) return
          e.stopPropagation()
          e.preventDefault()
          if (typeof e.currentTarget.setPointerCapture === 'function') {
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* happy-dom may not track active pointers — capture is a
                 runtime nicety, not required for the state machine. */
            }
          }
          setDrag(beginBoxDrag(e.pointerId, e.clientX, e.clientY))
        }}
        onPointerMove={(e) => {
          if (drag === null || e.pointerId !== drag.pointerId) return
          setDrag((prev) => (prev === null ? null : updateBoxDrag(prev, e.clientX, e.clientY)))
        }}
        onPointerUp={(e) => {
          if (drag === null || e.pointerId !== drag.pointerId) return
          const finalState = updateBoxDrag(drag, e.clientX, e.clientY)
          setDrag(null)
          if (isBoxDragClick(finalState)) return
          const hits = computeBoxSelectedFaceIds(
            geometry,
            faceIds,
            camera,
            boxDragRect(finalState),
            VIEWPORT
          )
          if (hits.length > 0) {
            setSelection((prev) => addFacesToSelection(prev, hits))
          }
        }}
      />
      {drag !== null && !isBoxDragClick(drag) ? (
        <div
          className="viewport-3d__box-select"
          data-testid="viewport-3d-box-select"
          aria-hidden="true"
          style={{
            left: `${boxDragRect(drag).minX}px`,
            top: `${boxDragRect(drag).minY}px`,
            width: `${boxDragRect(drag).maxX - boxDragRect(drag).minX}px`,
            height: `${boxDragRect(drag).maxY - boxDragRect(drag).minY}px`,
          }}
        />
      ) : null}
      <output data-testid="selection-count">{selectedFaceIds(selection).length}</output>
    </div>
  )
}

// ── Pointer-sequence helpers ────────────────────────────────────────────────

function shiftDrag(
  el: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pointerId = 1
): void {
  fireEvent.pointerDown(el, {
    button: 0,
    shiftKey: true,
    clientX: from.x,
    clientY: from.y,
    pointerId,
  })
  fireEvent.pointerMove(el, { clientX: to.x, clientY: to.y, pointerId })
  fireEvent.pointerUp(el, { clientX: to.x, clientY: to.y, pointerId })
}

// ── Specs ───────────────────────────────────────────────────────────────────

describe('BoxSelect — SHIFT+left-drag over the viewport (happy-dom)', () => {
  it('renders the dashed rectangle overlay while an above-slop drag is in flight', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    fireEvent.pointerDown(vp, { button: 0, shiftKey: true, clientX: 5, clientY: 35, pointerId: 1 })
    // No overlay yet — zero travel is still a potential click.
    expect(screen.queryByTestId('viewport-3d-box-select')).toBeNull()
    fireEvent.pointerMove(vp, { clientX: 35, clientY: 65, pointerId: 1 })
    const overlay = screen.getByTestId('viewport-3d-box-select')
    expect(overlay.style.left).toBe('5px')
    expect(overlay.style.top).toBe('35px')
    expect(overlay.style.width).toBe('30px')
    expect(overlay.style.height).toBe('30px')
    fireEvent.pointerUp(vp, { clientX: 35, clientY: 65, pointerId: 1 })
    // Overlay is gone after release; face 0 committed.
    expect(screen.queryByTestId('viewport-3d-box-select')).toBeNull()
    expect(screen.getByTestId('selection-count').textContent).toBe('1')
  })

  it('a plain left-drag (no SHIFT) never starts a box', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    fireEvent.pointerDown(vp, { button: 0, shiftKey: false, clientX: 5, clientY: 35, pointerId: 1 })
    fireEvent.pointerMove(vp, { clientX: 95, clientY: 65, pointerId: 1 })
    expect(screen.queryByTestId('viewport-3d-box-select')).toBeNull()
    fireEvent.pointerUp(vp, { clientX: 95, clientY: 65, pointerId: 1 })
    expect(screen.getByTestId('selection-count').textContent).toBe('0')
  })

  it('a sub-slop shift+click commits nothing (click, not box)', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    shiftDrag(vp, { x: 20, y: 50 }, { x: 21, y: 51 })
    expect(screen.getByTestId('selection-count').textContent).toBe('0')
  })

  it('boxing both faces selects both; a second box is ADDITIVE', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    // Box the whole viewport → both quads.
    shiftDrag(vp, { x: 0, y: 0 }, { x: 100, y: 100 })
    expect(screen.getByTestId('selection-count').textContent).toBe('2')
    // Re-box just face 0 — union, not replace: still 2.
    shiftDrag(vp, { x: 0, y: 30 }, { x: 40, y: 70 }, 2)
    expect(screen.getByTestId('selection-count').textContent).toBe('2')
  })

  it('builds the set box by box (face 0, then face 1)', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    shiftDrag(vp, { x: 0, y: 30 }, { x: 40, y: 70 })
    expect(screen.getByTestId('selection-count').textContent).toBe('1')
    shiftDrag(vp, { x: 60, y: 30 }, { x: 95, y: 70 }, 2)
    expect(screen.getByTestId('selection-count').textContent).toBe('2')
  })

  it('an empty box (over empty space) changes nothing', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    shiftDrag(vp, { x: 0, y: 30 }, { x: 40, y: 70 })
    expect(screen.getByTestId('selection-count').textContent).toBe('1')
    // Between the quads — catches no vertex.
    shiftDrag(vp, { x: 45, y: 45 }, { x: 55, y: 55 }, 2)
    expect(screen.getByTestId('selection-count').textContent).toBe('1')
  })
})
