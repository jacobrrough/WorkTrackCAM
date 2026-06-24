/**
 * Wave 3n — SOURCE-LEVEL threading pins for the StatusBar cursor coordinates.
 *
 * Why textual pins: the producing surfaces are hook-bearing components
 * (canvas pointer handlers, R3F click handlers) that node-env vitest cannot
 * click; the LAST inch of the wiring is pinned textually instead — the same
 * convention as `manufacture/gcode-send-gate-wiring.test.ts` and
 * `app/__tests__/new-shell-button-types.test.ts`. The pure/renderable halves
 * are covered behaviorally in `app/__tests__/cursor-coords.test.tsx` and
 * `app/__tests__/StatusBar.coords.test.tsx`.
 *
 * The load-bearing honesty contract these pins protect:
 *   1. The sketch value is THREADED, never recomputed — the canvas emits the
 *      EXACT snap-resolved point its own placement logic computes (the #20-fix
 *      pointer math is byte-identical), and no consumer re-derives world
 *      coordinates from DOM events.
 *   2. The 3D value is the LAST PICK only — no per-frame hover raycast was
 *      added to the viewport.
 *   3. Sources go INACTIVE honestly: pointer-leave and surface unmount blank
 *      the read-out (no stale coordinates pretending to be live).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf-8')

const CANVAS = read('Sketch2DCanvas.tsx')
const SURFACE = read('SketchSurface.tsx')
const WORKSPACE = read('DesignWorkspace.tsx')
const VIEWPORT = read('Viewport3D.tsx')
const HOST = read('../app/DesignWorkspaceHost.tsx')

describe('Sketch2DCanvas — the existing pointer→world value is threaded out', () => {
  it('emits the SAME snap-resolved point the placement logic computes (no recompute)', () => {
    // The emit sits directly after the existing math: raw -> the S2 osnap/grid
    // resolution (resolvePointerPlacement) -> constraint inference (inferDrawPoint) -> p -> emit.
    expect(CANVAS).toMatch(
      /const res = resolvePointerPlacement\(raw\)[\s\S]{0,350}?const p: \[number, number\] = inferred\.point[\s\S]{0,350}?onCursorWorld\?\.\(p\)/
    )
  })

  it('the #20-fix pointer math is untouched (load-bearing mapping line intact)', () => {
    expect(CANVAS).toContain(
      'screenToWorld(lx, ly, c.width, c.height, scale * dpr, ox, oy)'
    )
    expect(CANVAS).toContain('clientToCanvasLocal(ev.clientX, ev.clientY, c)')
  })

  it('blanks the read-out when the pointer leaves the canvas', () => {
    expect(CANVAS).toMatch(/onMouseLeave=\{\(\) => \{[\s\S]{0,250}?onCursorWorld\?\.\(null\)/)
  })

  it('the output prop is optional + additive (legacy mounts unchanged)', () => {
    expect(CANVAS).toContain('onCursorWorld?: (xyMm: readonly [number, number] | null) => void')
  })

  it('the MVP variant and its in-canvas readout are untouched', () => {
    expect(CANVAS).toContain('sketch-mvp-cursor-readout')
  })
})

describe('SketchSurface — pass-through + unmount blank', () => {
  it('threads the canvas output through verbatim', () => {
    expect(SURFACE).toContain('onCursorWorld={onCursorWorld}')
  })

  it('fires null on unmount so a stage switch blanks the StatusBar', () => {
    expect(SURFACE).toMatch(
      /useEffect\(\(\) => \{\s*\n\s*return \(\) => \{\s*\n\s*onCursorWorldRef\.current\?\.\(null\)/
    )
  })
})

describe('DesignWorkspace — provider-less pass-through of both sources', () => {
  it('threads the sketch source into the mounted SketchSurface', () => {
    expect(WORKSPACE).toContain('onCursorWorld={onSketchCursorWorld}')
  })

  it('threads the pick source into the mounted Viewport3D', () => {
    expect(WORKSPACE).toContain('onPickPoint={onViewportPickPoint}')
  })

  it('stays provider-less: no CursorCoordsContext import in the workspace', () => {
    // The props JSDoc may MENTION the context (documentation); the component
    // must never import it — the host owns the context wiring.
    expect(WORKSPACE).not.toMatch(/import[^\n]*CursorCoordsContext/)
  })
})

describe('Viewport3D — last-pick point only (honest scope)', () => {
  it('fires onPickPoint with the raycast point ONLY alongside a registered face pick', () => {
    expect(VIEWPORT).toMatch(
      /onSelect\(next\)\s*\n\s*\/\/ Wave 3n[^\n]*\n\s*onPickPoint\?\.\(\{ x: e\.point\.x, y: e\.point\.y, z: e\.point\.z \}\)/
    )
  })

  it('the edge pick forwards its intersection point through the pick handler', () => {
    expect(VIEWPORT).toContain('onPick(edge, { x: e.point.x, y: e.point.y, z: e.point.z })')
    // Tier-2: the edge selection now ALSO carries `edge.signature` (the geometry-
    // invariant signature) so a picked fillet/chamfer can be recovered after a
    // move/resize — but the point-forwarding still rides alongside the pick.
    expect(VIEWPORT).toMatch(/onSelect\(makeEdgeSelection\(edge\.edgeId, edge\.occtId, edge\.signature\)\)[\s\S]{0,200}?onPickPoint\?\.\(pointMm\)/)
  })

  it('adds NO per-frame hover raycast (deliberately rejected as too heavy)', () => {
    expect(VIEWPORT).not.toContain('onPointerMove')
  })
})

describe('DesignWorkspaceHost — the context wiring (the only producer-side consumer)', () => {
  it('publishes through the provider-tolerant setter hook', () => {
    expect(HOST).toContain('useOptionalSetCursorCoords()')
  })

  it('maps the sketch tuple to the sketch2d coords (null passes through as inactive)', () => {
    expect(HOST).toContain(
      "setCursorCoords(xyMm === null ? null : { kind: 'sketch2d', xMm: xyMm[0], yMm: xyMm[1] })"
    )
  })

  it('maps the viewport pick to the pick3d coords', () => {
    expect(HOST).toContain("setCursorCoords({ kind: 'pick3d', xMm: pointMm.x, yMm: pointMm.y, zMm: pointMm.z })")
  })

  it('clears the read-out when the Design workspace unmounts (route switch)', () => {
    expect(HOST).toMatch(/useEffect\(\(\) => \{\s*\n\s*return \(\) => \{\s*\n\s*setCursorCoords\(null\)/)
  })

  it('hands both callbacks to DesignWorkspace', () => {
    expect(HOST).toContain('onSketchCursorWorld={handleSketchCursorWorld}')
    expect(HOST).toContain('onViewportPickPoint={handleViewportPickPoint}')
  })
})
