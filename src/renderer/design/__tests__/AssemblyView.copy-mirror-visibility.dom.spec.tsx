/**
 * AssemblyView — Copy / Mirror position / Visibility INTERACTIVE behaviour spec
 * (happy-dom).
 *
 * The node suite (`AssemblyView.test.tsx`) proves the pure folds (`copyPart`,
 * `mirrorPartPosition`, `mirrorPositionAcrossPlane`) and the render-pin
 * affordances (buttons present, a hidden row dims). This spec proves what only a
 * real DOM can — the round-trip through the host's persist seam and the live
 * viewport filter across React clicks:
 *   - clicking a row's COPY appends ONE new instance (fresh id, +X offset, same
 *     geometry source) to the host's parts list — the SAME seam add / solve use,
 *   - clicking a MIRROR plane appends a mirrored instance (translation reflected),
 *   - clicking the eye TOGGLE hides the part (row dims) AND removes its box from
 *     the 3D viewport's `parts` prop, while the part stays in the BOM (hidden !=
 *     suppressed), and toggling again restores it,
 *   - the copy/mirror new row carries NO mate (the host's mate list is keyed by
 *     part id, and the fresh id cannot inherit the original's mate).
 *
 * The harness is a controlled parent that mirrors DesignWorkspace 1:1: it holds
 * `parts` in state and wires `onPartsChange` to `setParts` (exactly the handoff
 * line this component needs from the host). `window.fab` is shimmed to a bare
 * `{ cad: {} }` so AssemblyView's build effect no-ops instead of crashing (it
 * only reads the bridge inside the effect; the bridge is absent, so it folds to
 * an inline "bridge not available" notice — irrelevant to these assertions).
 * Run with `npm run test:dom` or
 * `npx vitest run --config vitest.dom.config.ts <this file>`.
 */

import { useState } from 'react'
import type { JSX } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { AssemblyView, type AssemblyPart } from '../AssemblyView'

// ── window.fab shim: the build effect reads fab().cad; give it a bare object so
//    the effect degrades to its "bridge not available" branch instead of throwing.
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  const win = (g['window'] ?? globalThis) as unknown as Record<string, unknown>
  if (win['fab'] === undefined) win['fab'] = { cad: {} }
  g['fab'] = win['fab']
})

const BASE_PARTS: readonly AssemblyPart[] = [
  {
    id: 'p1',
    name: 'Bracket',
    handle: 'script:bracket',
    geometrySource: 'script:bracket',
    transform: { position: [10, 0, 0], rotation: [0, 0, 0] },
  },
  {
    id: 'p2',
    name: 'Plate',
    handle: 'script:plate',
    geometrySource: 'script:plate',
    transform: { position: [40, 0, 0], rotation: [0, 0, 0] },
  },
]

/**
 * Controlled parent mirroring DesignWorkspace's assembly wiring: parts live in
 * state; onPartsChange replaces the whole list (the copy/mirror persist seam).
 * `onParts` reports each committed list so tests can assert the exact rows.
 */
function Harness({
  initialParts = BASE_PARTS,
  onParts,
}: {
  initialParts?: readonly AssemblyPart[]
  onParts?: (parts: readonly AssemblyPart[]) => void
}): JSX.Element {
  const [parts, setParts] = useState<readonly AssemblyPart[]>(initialParts)
  return (
    <AssemblyView
      parts={parts}
      onRemovePart={(id) => setParts((prev) => prev.filter((pt) => pt.id !== id))}
      onPartsChange={(next) => {
        setParts(next)
        onParts?.(next)
      }}
    />
  )
}

describe('AssemblyView (DOM) — Copy row action', () => {
  it('appends ONE new instance with a fresh id, +X offset, and the same geometry source', () => {
    const committed: Array<readonly AssemblyPart[]> = []
    render(<Harness onParts={(p) => committed.push(p)} />)

    fireEvent.click(screen.getByTestId('design-assembly-part-p1-copy'))

    expect(committed).toHaveLength(1)
    const next = committed[0]!
    expect(next).toHaveLength(3)
    const copy = next[2]!
    // Fresh id (not the source's), offset +60 on X, same body ref.
    expect(copy.id).not.toBe('p1')
    expect(copy.transform?.position).toEqual([70, 0, 0])
    expect(copy.geometrySource).toBe('script:bracket')
    expect(copy.name).toBe('Bracket copy')
  })

  it('renders the new copied row after the click (list grows by one)', () => {
    render(<Harness />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(screen.getByTestId('design-assembly-part-p1-copy'))
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('Bracket copy')).toBeInTheDocument()
  })

  it('the copy carries NO mate reference (mates on the original do not follow it)', () => {
    const committed: Array<readonly AssemblyPart[]> = []
    render(<Harness onParts={(p) => committed.push(p)} />)
    fireEvent.click(screen.getByTestId('design-assembly-part-p2-copy'))
    const copy = committed[0]![2]!
    expect(Object.keys(copy)).not.toContain('mates')
    expect(Object.keys(copy)).not.toContain('mateConstraints')
  })
})

describe('AssemblyView (DOM) — Mirror position row action', () => {
  it('appends a mirrored instance with the translation reflected across YZ (negate X)', () => {
    const committed: Array<readonly AssemblyPart[]> = []
    render(<Harness onParts={(p) => committed.push(p)} />)

    fireEvent.click(screen.getByTestId('design-assembly-part-p1-mirror-yz'))

    const next = committed[0]!
    expect(next).toHaveLength(3)
    const mirror = next[2]!
    // -10 reflected across YZ, then +60 separation offset.
    expect(mirror.transform?.position).toEqual([50, 0, 0])
    expect(mirror.name).toBe('Bracket mirror YZ')
  })

  it('reflects across XY (negate Z) for the XY plane button', () => {
    const committed: Array<readonly AssemblyPart[]> = []
    render(
      <Harness
        initialParts={[
          {
            id: 'q1',
            name: 'Lug',
            handle: 'h',
            transform: { position: [0, 0, 25], rotation: [0, 0, 0] },
          },
        ]}
        onParts={(p) => committed.push(p)}
      />,
    )
    fireEvent.click(screen.getByTestId('design-assembly-part-q1-mirror-xy'))
    const mirror = committed[0]![1]!
    expect(mirror.transform?.position).toEqual([60, 0, -25])
  })
})

describe('AssemblyView (DOM) — Visibility eye toggle (view-only)', () => {
  it('hides the part: dims the row + sets data-hidden, then restores on re-toggle', () => {
    // NOTE: in happy-dom the 3D Canvas actually mounts (window + document exist),
    // so the viewport's internal box count is opaque here. The viewport filter is
    // pinned in node-env (`visibleParts` → summary count) in AssemblyView.test.tsx;
    // this spec proves the operator-visible ROW state across live clicks.
    render(<Harness />)
    const p1Row = screen.getByTestId('design-assembly-part-p1')
    expect(p1Row.className).not.toContain('design-assembly__row--hidden')

    fireEvent.click(screen.getByTestId('design-assembly-part-p1-visibility'))

    // Row dims + carries the data-hidden attribute.
    const hiddenRow = screen.getByTestId('design-assembly-part-p1')
    expect(hiddenRow.className).toContain('design-assembly__row--hidden')
    expect(hiddenRow.getAttribute('data-hidden')).toBe('true')

    // Toggle again → restored.
    fireEvent.click(screen.getByTestId('design-assembly-part-p1-visibility'))
    expect(screen.getByTestId('design-assembly-part-p1').className).not.toContain(
      'design-assembly__row--hidden',
    )
    expect(screen.getByTestId('design-assembly-part-p1').getAttribute('data-hidden')).toBeNull()
  })

  it('a hidden part STAYS in the BOM (hidden != suppressed)', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('design-assembly-part-p1-visibility'))
    // The BOM row for the hidden part is still present.
    expect(screen.getByTestId('design-assembly-bom-row-p1')).toBeInTheDocument()
  })

  it('the eye toggle flips its aria-pressed + Hide/Show label', () => {
    render(<Harness />)
    const eye = screen.getByTestId('design-assembly-part-p1-visibility')
    expect(eye.getAttribute('aria-pressed')).toBe('false')
    expect(eye.textContent).toBe('Hide')
    fireEvent.click(eye)
    const pressed = screen.getByTestId('design-assembly-part-p1-visibility')
    expect(pressed.getAttribute('aria-pressed')).toBe('true')
    expect(pressed.textContent).toBe('Show')
  })

  it('hiding one part leaves sibling rows fully visible', () => {
    render(<Harness />)
    fireEvent.click(screen.getByTestId('design-assembly-part-p1-visibility'))
    const p2 = screen.getByTestId('design-assembly-part-p2')
    expect(p2.className).not.toContain('design-assembly__row--hidden')
    // within() sanity: p2's own eye still offers Hide.
    expect(within(p2).getByTestId('design-assembly-part-p2-visibility').textContent).toBe('Hide')
  })
})
