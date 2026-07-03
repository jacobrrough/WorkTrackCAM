/**
 * AssemblyViewport3D — node-env render-pin + guard test.
 *
 * The R3F `<Canvas>` cannot mount in node/vitest (no WebGL — mirror of
 * `Viewport3D`, whose own suite only exercises pure exports). So this suite:
 *   1. Pins {@link canMountAssemblyCanvas} returns false in node (the guard that
 *      keeps the summary fallback shipping there).
 *   2. Renders the component under `renderToStaticMarkup` and asserts it degrades
 *      to the summary placeholder with the SAME `design-assembly-summary` testid +
 *      "Assembly preview" text the AssemblyView render pins depend on — i.e. the
 *      guard is honoured and the node path never touches the Canvas.
 *   3. Source-pins the component's load-bearing scene wiring (Canvas, OrbitControls,
 *      per-part box, playback-override + explode threading) without mounting it —
 *      the same posture the file-header calls out.
 *
 * A DOM spec is intentionally omitted: happy-dom provides no WebGL context, so a
 * real Canvas mount would throw exactly as `Viewport3D`'s does. The mountable
 * surface (the guard + the pure render-state math) is covered here + in
 * `assembly-viewport-transforms.test.ts`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssemblyViewport3D, canMountAssemblyCanvas } from './AssemblyViewport3D'
import type { AssemblyViewportPart } from './assembly-viewport-transforms'

const SRC = readFileSync(
  join(__dirname, 'AssemblyViewport3D.tsx'),
  'utf8'
)

const part = (o: Partial<AssemblyViewportPart> = {}): AssemblyViewportPart => ({
  id: 'p1',
  name: 'Bracket',
  handle: 'script:abc',
  ...o
})

describe('AssemblyViewport3D — node guard', () => {
  it('canMountAssemblyCanvas returns false in the node-env test pool', () => {
    // node vitest has no `document`; the guard must decline the Canvas so the
    // summary fallback ships (keeping the AssemblyView render pins green).
    expect(canMountAssemblyCanvas()).toBe(false)
  })

  it('renders the summary placeholder (not a Canvas) with the pinned testids', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyViewport3D, { parts: [part(), part({ id: 'p2', name: 'Plate' })] })
    )
    expect(html).toContain('data-testid="design-assembly-summary"')
    expect(html).toContain('Assembly preview')
    // The node path must NOT emit a canvas element.
    expect(html).not.toContain('<canvas')
  })

  it('summary caption shows the part count when no triangle summary is known', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyViewport3D, { parts: [part(), part({ id: 'p2' })] })
    )
    expect(html).toContain('2 parts')
  })

  it('surfaces the playback overlay note in the fallback when playbackActive', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyViewport3D, {
        parts: [part()],
        playbackActive: true
      })
    )
    expect(html).toContain('data-testid="design-assembly-playback-note"')
    expect(html).toContain('Motion playback')
  })

  it('surfaces the mate-count line when mateConstraintCount > 0', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyViewport3D, {
        parts: [part()],
        mateConstraintCount: 3
      })
    )
    expect(html).toContain('data-testid="design-assembly-mate-count"')
    expect(html).toContain('3 mates positioning parts')
  })

  it('forceFallback renders the summary even if a DOM were present', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyViewport3D, { parts: [part()], forceFallback: true })
    )
    expect(html).toContain('data-testid="design-assembly-summary"')
  })
})

describe('AssemblyViewport3D — scene source pins', () => {
  it('mounts an R3F Canvas with OrbitControls (design-viewport convention)', () => {
    expect(SRC).toMatch(/from '@react-three\/fiber'/)
    expect(SRC).toContain('<Canvas')
    expect(SRC).toContain('OrbitControls')
    expect(SRC).toContain('makeDefault')
  })

  it('draws one primitive per part via PartMesh in the scene', () => {
    expect(SRC).toContain('renderStates.map')
    expect(SRC).toContain('<PartMesh')
    // Box-tier parts reuse the SHARED unit box (scaled to real extents); mesh-tier
    // parts build a per-part BufferGeometry.
    expect(SRC).toContain('SHARED_BOX_GEOMETRY')
    expect(SRC).toContain('new THREE.BoxGeometry')
    expect(SRC).toContain('buildMeshGeometry')
    expect(SRC).toContain('new THREE.BufferGeometry')
  })

  it('threads per-part geometry descriptors + a triangle budget into the render-state build', () => {
    expect(SRC).toContain('descriptors')
    expect(SRC).toContain('triangleBudget')
    // Honest HUD tier tally (mesh vs. schematic = bbox + nominal).
    expect(SRC).toContain('summarizeRenderTiers')
    expect(SRC).toContain('hudTierLabel')
  })

  it('disposes per-part mesh geometry on removal (no GPU leak)', () => {
    expect(SRC).toContain('meshGeometry?.dispose()')
    expect(SRC).toContain('useEffect')
  })

  it('threads the wave-2 playback overlay + explode into the render-state build', () => {
    expect(SRC).toContain('playbackOverlay')
    expect(SRC).toContain('computePartRenderStates')
    expect(SRC).toContain('explode')
  })

  it('wires row ↔ viewport selection sync (onSelectPart on box click)', () => {
    expect(SRC).toContain('onSelectPart')
    expect(SRC).toContain('onSelect(state.id)')
  })

  it('maps interference clash ids into the tint via clashIds', () => {
    expect(SRC).toContain('clashIds')
    expect(SRC).toContain("ROLE_COLOR")
  })

  it('guards the Canvas behind canMountAssemblyCanvas', () => {
    expect(SRC).toContain('canMountAssemblyCanvas()')
    expect(SRC).toContain('showFallback')
  })
})
