/**
 * VIEWPORT EDGE PICKING (Fusion-parity wave 4) — INTERACTIVE behaviour spec
 * (happy-dom).
 *
 * The node suite proves the pure halves (the screen-space distance-to-segment
 * hit test with the occluder precedence gate — `edge-pick.test.ts`; the
 * multi-edge selection transitions — `selection-state.test.ts`; the dialog
 * pre-fill resolver — `feature-dialog-ops.test.ts`). This spec proves what only
 * a real DOM can: the ACCUMULATION state machine across several React clicks —
 *   - a plain click on an edge REPLACES the selection (single pick),
 *   - a Ctrl/Cmd-click ADDS an edge to the set (multi-edge fillet/chamfer),
 *   - a Ctrl/Cmd-click on an already-selected edge REMOVES it,
 *   - the derived highlight set (mirrors Viewport3D's `PickableEdges`
 *     `highlightSet`) always matches the accumulated selection, and
 *   - a click in empty space near NO edge resolves nothing (face picking would
 *     take over in the real viewport) — the selection is untouched.
 *
 * happy-dom cannot mount a WebGL canvas or run R3F's raycast, so — exactly like
 * `BoxSelect.dom.spec.tsx` — the harness mirrors Viewport3D's edge-pick seam
 * 1:1 around a plain div: a click resolves an edge via the REAL
 * `pickEdgeAtPoint` against a REAL THREE.OrthographicCamera + pickable-edge
 * fixtures, then commits through the REAL `toggleEdgeInSelection` /
 * `setSelection` transitions. Run with `npm run test:dom` or
 * `npx vitest run --config vitest.dom.config.ts <this file>`.
 */

import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import * as THREE from 'three'
import { pickEdgeAtPoint } from '../edge-pick'
import type { PickableEdge } from '../viewport3d-geometry'
import {
  makeEdgeSelection,
  selectedEdgeIds,
  setSelection,
  toggleEdgeInSelection,
  type Selection,
} from '../selection-state'

// ── Real camera + pickable-edge fixtures ────────────────────────────────────

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
 * Three horizontal edges at distinct heights, each one segment:
 *   edge 0 at y=+20 → screen y=30
 *   edge 1 at y=0   → screen y=50
 *   edge 2 at y=−20 → screen y=70
 */
const EDGES: PickableEdge[] = [
  { edgeId: 0, occtId: 'e:0', positions: new Float32Array([-20, 20, 0, 20, 20, 0]) },
  { edgeId: 1, occtId: 'e:1', positions: new Float32Array([-20, 0, 0, 20, 0, 0]) },
  { edgeId: 2, occtId: 'e:2', positions: new Float32Array([-20, -20, 0, 20, -20, 0]) },
]

const VIEWPORT = { width: 100, height: 100 }

/**
 * Mirrors Viewport3D's edge-pick seam: a click resolves an edge via the real
 * `pickEdgeAtPoint`; a plain click REPLACES via `setSelection`, a Ctrl/Cmd
 * click TOGGLES membership via `toggleEdgeInSelection`. A miss (no edge within
 * threshold) is a no-op here — the real viewport would fall through to a face
 * pick. The rendered highlight set mirrors `PickableEdges.highlightSet`
 * (multi-edge ordinals from the live selection).
 */
function Harness(): JSX.Element {
  const camera = useMemo(() => makeOrthoCamera(), [])
  const [selection, setSelectionState] = useState<Selection | null>(null)

  const highlightIds = selectedEdgeIds(selection)

  const clickAt = (clientX: number, clientY: number, toggle: boolean): void => {
    const hit = pickEdgeAtPoint(EDGES, camera, { x: clientX, y: clientY }, VIEWPORT)
    if (hit === null) return // real viewport would fall through to a face pick
    const next = makeEdgeSelection(hit.edge.edgeId, hit.edge.occtId, hit.edge.signature)
    setSelectionState((prev) => (toggle ? toggleEdgeInSelection(prev, next) : setSelection(prev, next)))
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        data-testid="fake-viewport"
        onClick={(e) => clickAt(e.clientX, e.clientY, e.ctrlKey || e.metaKey)}
      />
      <output data-testid="edge-count">{highlightIds.length}</output>
      <output data-testid="edge-ids">{[...highlightIds].sort((a, b) => a - b).join(',')}</output>
    </div>
  )
}

// ── Specs ────────────────────────────────────────────────────────────────────

describe('EdgePick — click accumulation over the viewport (happy-dom)', () => {
  it('a plain click on an edge selects exactly that one edge', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    // Screen y=50 → edge 1 (y=0).
    fireEvent.click(vp, { clientX: 50, clientY: 50 })
    expect(screen.getByTestId('edge-count').textContent).toBe('1')
    expect(screen.getByTestId('edge-ids').textContent).toBe('1')
  })

  it('a plain click on a DIFFERENT edge REPLACES the selection', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    fireEvent.click(vp, { clientX: 50, clientY: 50 }) // edge 1
    fireEvent.click(vp, { clientX: 50, clientY: 30 }) // edge 0 (plain → replace)
    expect(screen.getByTestId('edge-ids').textContent).toBe('0')
  })

  it('Ctrl-click ACCUMULATES a multi-edge set; the highlight set tracks it', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    fireEvent.click(vp, { clientX: 50, clientY: 50 }) // edge 1 (plain)
    fireEvent.click(vp, { clientX: 50, clientY: 30, ctrlKey: true }) // + edge 0
    fireEvent.click(vp, { clientX: 50, clientY: 70, ctrlKey: true }) // + edge 2
    expect(screen.getByTestId('edge-count').textContent).toBe('3')
    expect(screen.getByTestId('edge-ids').textContent).toBe('0,1,2')
  })

  it('Cmd-click (metaKey) accumulates too (macOS parity)', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    fireEvent.click(vp, { clientX: 50, clientY: 50 }) // edge 1
    fireEvent.click(vp, { clientX: 50, clientY: 30, metaKey: true }) // + edge 0
    expect(screen.getByTestId('edge-ids').textContent).toBe('0,1')
  })

  it('Ctrl-click on an already-selected edge REMOVES it', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    fireEvent.click(vp, { clientX: 50, clientY: 50 }) // edge 1
    fireEvent.click(vp, { clientX: 50, clientY: 30, ctrlKey: true }) // + edge 0 → {0,1}
    fireEvent.click(vp, { clientX: 50, clientY: 30, ctrlKey: true }) // toggle 0 off → {1}
    expect(screen.getByTestId('edge-count').textContent).toBe('1')
    expect(screen.getByTestId('edge-ids').textContent).toBe('1')
  })

  it('Ctrl-click off every edge removes the last member → empty selection', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    fireEvent.click(vp, { clientX: 50, clientY: 50 }) // edge 1
    fireEvent.click(vp, { clientX: 50, clientY: 50, ctrlKey: true }) // toggle 1 off → null
    expect(screen.getByTestId('edge-count').textContent).toBe('0')
    expect(screen.getByTestId('edge-ids').textContent).toBe('')
  })

  it('a click in empty space (no edge within threshold) is a no-op', () => {
    render(<Harness />)
    const vp = screen.getByTestId('fake-viewport')
    fireEvent.click(vp, { clientX: 50, clientY: 50 }) // edge 1 selected
    // Screen y=10 is far from every edge (nearest is edge 0 at y=30) → miss.
    fireEvent.click(vp, { clientX: 50, clientY: 10, ctrlKey: true })
    expect(screen.getByTestId('edge-ids').textContent).toBe('1')
  })
})
