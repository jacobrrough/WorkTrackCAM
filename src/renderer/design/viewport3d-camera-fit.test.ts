/**
 * Behavioral + paired-pin tests for `viewport3d-camera-fit.ts` — the pure
 * projection-toggle / fit-to-view math behind the Design viewport's two new
 * professional-CAD table-stakes controls:
 *
 *   - ORTHO ⇄ PERSP toggle: `orthoZoomForPerspectiveDistance` /
 *     `perspectiveDistanceForOrthoZoom` must be exact inverses so the
 *     geometry never jumps in apparent size when the operator toggles
 *     projection (alignment/measurement work on Laguna sheets and Carvera
 *     parts depends on a stable image).
 *   - FIT-TO-VIEW: `computeFitViewGoal` frames the displayed geometry's
 *     bounding sphere along the CURRENT view direction (never a reset to
 *     home) in both projections, falling back to the home pose on an
 *     empty scene.
 *
 * Also pins (source-text, mirroring the [ID-0201]/[ID-0302] paired-pin
 * convention) that `Viewport3D.tsx` actually renders the two HUD buttons
 * ("Fit view" + the projection toggle) and mounts the CameraRig swap
 * driver, and that `workspace.css` carries the new button modifiers.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as THREE from 'three'
import {
  computeFitViewGoal,
  createInactiveZoomAnimation,
  orthoZoomForPerspectiveDistance,
  orthoZoomToFitRadius,
  perspectiveDistanceForOrthoZoom,
  readFitBounds,
  startZoomAnimation,
  tickZoomAnimation,
  DEFAULT_FIT_MARGIN,
  MAX_FIT_DISTANCE_MM,
  MIN_FIT_DISTANCE_MM,
  ORTHO_CAMERA_FAR_MM,
  ORTHO_CAMERA_NEAR_MM,
  type FitBounds,
  type FitViewOptions
} from './viewport3d-camera-fit'

const MODULE_SOURCE = readFileSync(resolve(__dirname, 'viewport3d-camera-fit.ts'), 'utf8')
const VIEWPORT_SOURCE = readFileSync(resolve(__dirname, 'Viewport3D.tsx'), 'utf8')
const CSS_SOURCE = readFileSync(
  resolve(__dirname, '..', 'styles', 'workspace.css'),
  'utf8'
)

const FOV = 45
const HEIGHT_PX = 800
const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(FOV) / 2)

/** Perspective viewport options used across the fit tests. */
function perspOpts(overrides: Partial<FitViewOptions> = {}): FitViewOptions {
  return {
    projection: 'perspective',
    fovDeg: FOV,
    aspect: 1.6,
    viewportHeightPx: HEIGHT_PX,
    homePosition: new THREE.Vector3(120, 90, 120),
    ...overrides
  }
}

function orthoOpts(overrides: Partial<FitViewOptions> = {}): FitViewOptions {
  return perspOpts({ projection: 'orthographic', ...overrides })
}

/** BufferGeometry whose 8 corner vertices span the given axis-aligned box. */
function geomWithBox(
  xMin: number, yMin: number, zMin: number,
  xMax: number, yMax: number, zMax: number
): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry()
  const positions = new Float32Array([
    xMin, yMin, zMin, xMax, yMin, zMin, xMin, yMax, zMin, xMax, yMax, zMin,
    xMin, yMin, zMax, xMax, yMin, zMax, xMin, yMax, zMax, xMax, yMax, zMax
  ])
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geom
}

// ---------------------------------------------------------------------------
// A. ortho zoom ⇄ perspective distance equivalence
// ---------------------------------------------------------------------------
describe('A. orthoZoomForPerspectiveDistance / perspectiveDistanceForOrthoZoom', () => {
  it('zoom formula: heightPx / (2·d·tan(fov/2)) — d=100, fov=45, h=800 → ~9.65685', () => {
    const zoom = orthoZoomForPerspectiveDistance(100, FOV, HEIGHT_PX)
    expect(zoom).toBeCloseTo(800 / (2 * 100 * TAN_HALF_FOV), 8)
    expect(zoom).toBeCloseTo(9.65685, 4)
  })

  it('distance formula is the exact inverse — round-trips d → zoom → d', () => {
    for (const d of [6, 65.3, 137.5, 800, 6000]) {
      const zoom = orthoZoomForPerspectiveDistance(d, FOV, HEIGHT_PX)
      expect(perspectiveDistanceForOrthoZoom(zoom, FOV, HEIGHT_PX)).toBeCloseTo(d, 8)
    }
  })

  it('round-trips the other way too (zoom → d → zoom)', () => {
    for (const z of [0.05, 1, 16, 400]) {
      const d = perspectiveDistanceForOrthoZoom(z, FOV, HEIGHT_PX)
      expect(orthoZoomForPerspectiveDistance(d, FOV, HEIGHT_PX)).toBeCloseTo(z, 8)
    }
  })

  it('SCALE PRESERVATION: visible world height matches in both projections', () => {
    const d = 250
    const zoom = orthoZoomForPerspectiveDistance(d, FOV, HEIGHT_PX)
    const perspVisibleHeightMm = 2 * d * TAN_HALF_FOV
    const orthoVisibleHeightMm = HEIGHT_PX / zoom // R3F frustum: top-bottom = heightPx / zoom
    expect(orthoVisibleHeightMm).toBeCloseTo(perspVisibleHeightMm, 8)
  })

  it('guards degenerate input (0 / negative / NaN distance & zoom) with finite positive output', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(orthoZoomForPerspectiveDistance(bad, FOV, HEIGHT_PX)).toBeGreaterThan(0)
      expect(Number.isFinite(orthoZoomForPerspectiveDistance(bad, FOV, HEIGHT_PX))).toBe(true)
      expect(perspectiveDistanceForOrthoZoom(bad, FOV, HEIGHT_PX)).toBeGreaterThan(0)
      expect(Number.isFinite(perspectiveDistanceForOrthoZoom(bad, FOV, HEIGHT_PX))).toBe(true)
    }
  })

  it('guards garbage fov / viewport height', () => {
    expect(Number.isFinite(orthoZoomForPerspectiveDistance(100, Number.NaN, HEIGHT_PX))).toBe(true)
    expect(Number.isFinite(orthoZoomForPerspectiveDistance(100, FOV, 0))).toBe(true)
    expect(Number.isFinite(perspectiveDistanceForOrthoZoom(10, 1e9, -1))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// B. orthoZoomToFitRadius
// ---------------------------------------------------------------------------
describe('B. orthoZoomToFitRadius', () => {
  it('fits via the height when aspect ≥ 1: R=25, h=800, aspect=1.6 → zoom 16', () => {
    expect(orthoZoomToFitRadius(25, 800, 1.6)).toBeCloseTo(16, 8)
  })

  it('fits via the width when aspect < 1: R=25, h=800, aspect=0.5 → zoom 8', () => {
    expect(orthoZoomToFitRadius(25, 800, 0.5)).toBeCloseTo(8, 8)
  })

  it('the fitted sphere diameter equals the smaller visible dimension', () => {
    const zoom = orthoZoomToFitRadius(25, 800, 1.6)
    expect(800 / zoom).toBeCloseTo(50, 6) // visible height = 2R
  })

  it('guards degenerate radius/height/aspect', () => {
    expect(Number.isFinite(orthoZoomToFitRadius(0, 800, 1.6))).toBe(true)
    expect(Number.isFinite(orthoZoomToFitRadius(Number.NaN, 0, 0))).toBe(true)
    expect(orthoZoomToFitRadius(-1, 800, 1.6)).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// C. readFitBounds
// ---------------------------------------------------------------------------
describe('C. readFitBounds', () => {
  it('returns the bounding sphere of a known box (center + half-diagonal radius)', () => {
    const b = readFitBounds(geomWithBox(-10, -10, -10, 10, 10, 10))
    expect(b).not.toBeNull()
    expect(b!.center.x).toBeCloseTo(0, 5)
    expect(b!.center.y).toBeCloseTo(0, 5)
    expect(b!.center.z).toBeCloseTo(0, 5)
    expect(b!.radius).toBeCloseTo(Math.sqrt(300), 3)
  })

  it('offset box → offset center', () => {
    const b = readFitBounds(geomWithBox(0, 0, 0, 20, 10, 30))
    expect(b!.center.x).toBeCloseTo(10, 4)
    expect(b!.center.y).toBeCloseTo(5, 4)
    expect(b!.center.z).toBeCloseTo(15, 4)
  })

  it('null / missing geometry → null', () => {
    expect(readFitBounds(null)).toBeNull()
    expect(readFitBounds(undefined)).toBeNull()
  })

  it('empty geometry (no position attribute) → null', () => {
    expect(readFitBounds(new THREE.BufferGeometry())).toBeNull()
  })

  it('degenerate single-point geometry (radius 0) → null', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([5, 5, 5]), 3))
    expect(readFitBounds(g)).toBeNull()
  })

  it('NaN vertices → null (non-finite sphere rejected)', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, Number.NaN, 0, 1, 1, 1, 2, 2, 2]), 3)
    )
    expect(readFitBounds(g)).toBeNull()
  })

  it('returns a CLONED center (mutating the result never bleeds into the geometry)', () => {
    const g = geomWithBox(-10, -10, -10, 10, 10, 10)
    const b = readFitBounds(g)!
    b.center.set(999, 999, 999)
    expect(g.boundingSphere!.center.x).toBeCloseTo(0, 5)
  })
})

// ---------------------------------------------------------------------------
// D. computeFitViewGoal — perspective
// ---------------------------------------------------------------------------
describe('D. computeFitViewGoal — perspective framing', () => {
  const bounds: FitBounds = { center: new THREE.Vector3(10, 5, 10), radius: 20 }
  const pos = new THREE.Vector3(120, 90, 120)
  const up = new THREE.Vector3(0, 1, 0)
  const target = new THREE.Vector3(0, 0, 0)

  it('targets the bounds center and reports zoom: null (perspective leaves zoom alone)', () => {
    const g = computeFitViewGoal(bounds, pos, up, target, perspOpts())
    expect(g.target.x).toBeCloseTo(10, 6)
    expect(g.target.y).toBeCloseTo(5, 6)
    expect(g.target.z).toBeCloseTo(10, 6)
    expect(g.zoom).toBeNull()
  })

  it('PRESERVES the current view direction (never resets to home)', () => {
    const g = computeFitViewGoal(bounds, pos, up, target, perspOpts())
    const wantDir = pos.clone().sub(target).normalize()
    const gotDir = g.position.clone().sub(g.target).normalize()
    expect(gotDir.x).toBeCloseTo(wantDir.x, 6)
    expect(gotDir.y).toBeCloseTo(wantDir.y, 6)
    expect(gotDir.z).toBeCloseTo(wantDir.z, 6)
  })

  it('backs off to paddedRadius / sin(halfAngle): R=20·1.25, fov=45, aspect≥1 → ~65.33 mm', () => {
    const g = computeFitViewGoal(bounds, pos, up, target, perspOpts())
    const dist = g.position.distanceTo(g.target)
    const expected = (20 * DEFAULT_FIT_MARGIN) / Math.sin(THREE.MathUtils.degToRad(FOV) / 2)
    expect(dist).toBeCloseTo(expected, 4)
    expect(dist).toBeCloseTo(65.328, 2)
  })

  it('narrow viewport (aspect < 1) fits the HORIZONTAL half-angle → farther away', () => {
    const wide = computeFitViewGoal(bounds, pos, up, target, perspOpts({ aspect: 1.6 }))
    const narrow = computeFitViewGoal(bounds, pos, up, target, perspOpts({ aspect: 0.5 }))
    const wideDist = wide.position.distanceTo(wide.target)
    const narrowDist = narrow.position.distanceTo(narrow.target)
    expect(narrowDist).toBeGreaterThan(wideDist)
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * 0.5)
    expect(narrowDist).toBeCloseTo((20 * DEFAULT_FIT_MARGIN) / Math.sin(hHalf), 3)
  })

  it('clamps a tiny part to the controls MIN dolly distance (6 mm)', () => {
    const tiny: FitBounds = { center: new THREE.Vector3(), radius: 0.1 }
    const g = computeFitViewGoal(tiny, pos, up, target, perspOpts())
    expect(g.position.distanceTo(g.target)).toBeCloseTo(MIN_FIT_DISTANCE_MM, 6)
  })

  it('clamps a full-sheet-scale scene to the controls MAX dolly distance (6000 mm)', () => {
    const huge: FitBounds = { center: new THREE.Vector3(), radius: 4000 }
    const g = computeFitViewGoal(huge, pos, up, target, perspOpts())
    expect(g.position.distanceTo(g.target)).toBeCloseTo(MAX_FIT_DISTANCE_MM, 6)
  })

  it('honors a custom marginFactor', () => {
    const g = computeFitViewGoal(bounds, pos, up, target, perspOpts({ marginFactor: 2 }))
    const expected = 40 / Math.sin(THREE.MathUtils.degToRad(FOV) / 2)
    expect(g.position.distanceTo(g.target)).toBeCloseTo(expected, 4)
  })

  it('preserves the current up vector (normalized clone, not a reset)', () => {
    const tiltedUp = new THREE.Vector3(0, 0, -2)
    const g = computeFitViewGoal(bounds, pos, tiltedUp, target, perspOpts())
    expect(g.up.z).toBeCloseTo(-1, 6)
    expect(g.up.length()).toBeCloseTo(1, 6)
    expect(g.up).not.toBe(tiltedUp)
  })

  it('degenerate pose (position === target) falls back to an iso-ish direction, still finite', () => {
    const same = new THREE.Vector3(5, 5, 5)
    const g = computeFitViewGoal(bounds, same, up, same.clone(), perspOpts())
    const dir = g.position.clone().sub(g.target).normalize()
    const iso = new THREE.Vector3(1, 0.75, 1).normalize()
    expect(dir.x).toBeCloseTo(iso.x, 6)
    expect(dir.y).toBeCloseTo(iso.y, 6)
    expect(dir.z).toBeCloseTo(iso.z, 6)
  })

  it('does not mutate the caller vectors', () => {
    const p2 = pos.clone()
    const u2 = up.clone()
    const t2 = target.clone()
    computeFitViewGoal(bounds, p2, u2, t2, perspOpts())
    expect(p2.equals(pos)).toBe(true)
    expect(u2.equals(up)).toBe(true)
    expect(t2.equals(target)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// E. computeFitViewGoal — orthographic
// ---------------------------------------------------------------------------
describe('E. computeFitViewGoal — orthographic framing', () => {
  const bounds: FitBounds = { center: new THREE.Vector3(10, 5, 10), radius: 20 }
  const pos = new THREE.Vector3(120, 90, 120)
  const up = new THREE.Vector3(0, 1, 0)
  const target = new THREE.Vector3(0, 0, 0)

  it('computes the fit ZOOM (image scale is zoom-driven): R=20·1.25, h=800, aspect=1.6 → 16', () => {
    const g = computeFitViewGoal(bounds, pos, up, target, orthoOpts())
    expect(g.zoom).not.toBeNull()
    expect(g.zoom!).toBeCloseTo(16, 6)
  })

  it('keeps the current stand-off distance (position slides to the new center only)', () => {
    const g = computeFitViewGoal(bounds, pos, up, target, orthoOpts())
    expect(g.position.distanceTo(g.target)).toBeCloseTo(pos.distanceTo(target), 4)
  })

  it('preserves the current view direction and targets the center', () => {
    const g = computeFitViewGoal(bounds, pos, up, target, orthoOpts())
    const wantDir = pos.clone().sub(target).normalize()
    const gotDir = g.position.clone().sub(g.target).normalize()
    expect(gotDir.distanceTo(wantDir)).toBeLessThan(1e-6)
    expect(g.target.distanceTo(bounds.center)).toBeLessThan(1e-6)
  })

  it('narrow viewport fits via the width (smaller zoom)', () => {
    const g = computeFitViewGoal(bounds, pos, up, target, orthoOpts({ aspect: 0.5 }))
    expect(g.zoom!).toBeCloseTo(8, 6)
  })
})

// ---------------------------------------------------------------------------
// F. computeFitViewGoal — empty-scene fallback
// ---------------------------------------------------------------------------
describe('F. computeFitViewGoal — empty-scene home fallback', () => {
  const pos = new THREE.Vector3(-30, 44, 2)
  const up = new THREE.Vector3(0, 0, 1)
  const target = new THREE.Vector3(9, 9, 9)

  it('perspective: null bounds → home position, origin target, Y up, zoom null', () => {
    const g = computeFitViewGoal(null, pos, up, target, perspOpts())
    expect(g.position.x).toBeCloseTo(120, 6)
    expect(g.position.y).toBeCloseTo(90, 6)
    expect(g.position.z).toBeCloseTo(120, 6)
    expect(g.target.length()).toBeCloseTo(0, 6)
    expect(g.up.y).toBeCloseTo(1, 6)
    expect(g.zoom).toBeNull()
  })

  it('orthographic: null bounds → home pose PLUS the scale-equivalent home zoom', () => {
    const g = computeFitViewGoal(null, pos, up, target, orthoOpts())
    const homeDist = new THREE.Vector3(120, 90, 120).length()
    expect(g.zoom!).toBeCloseTo(orthoZoomForPerspectiveDistance(homeDist, FOV, HEIGHT_PX), 8)
    expect(g.zoom!).toBeGreaterThan(0)
  })

  it('home position is a CLONE (mutating the goal never bleeds into opts)', () => {
    const opts = perspOpts()
    const g = computeFitViewGoal(null, pos, up, target, opts)
    g.position.set(0, 0, 0)
    expect(opts.homePosition.x).toBe(120)
  })
})

// ---------------------------------------------------------------------------
// G. zoom animation lifecycle (ortho fit rides this on the 400 ms clock)
// ---------------------------------------------------------------------------
describe('G. ZoomAnimationState lifecycle', () => {
  it('createInactiveZoomAnimation: inactive, durationMs 400, unit zooms', () => {
    const s = createInactiveZoomAnimation()
    expect(s.active).toBe(false)
    expect(s.durationMs).toBe(400)
    expect(s.fromZoom).toBe(1)
    expect(s.toZoom).toBe(1)
    expect(tickZoomAnimation(s, 123456)).toBeNull()
  })

  it('startZoomAnimation activates and stamps performance.now()', () => {
    const s = createInactiveZoomAnimation()
    const before = performance.now()
    startZoomAnimation(s, 2, 16, 1000)
    const after = performance.now()
    expect(s.active).toBe(true)
    expect(s.fromZoom).toBe(2)
    expect(s.toZoom).toBe(16)
    expect(s.durationMs).toBe(1000)
    expect(s.startTime).toBeGreaterThanOrEqual(before - 1e-3)
    expect(s.startTime).toBeLessThanOrEqual(after + 1e-3)
  })

  it('midpoint tick returns the smoothstep midpoint (exactly halfway)', () => {
    const s = createInactiveZoomAnimation()
    startZoomAnimation(s, 1, 16, 1000)
    const z = tickZoomAnimation(s, s.startTime + 500)
    expect(z).toBeCloseTo(8.5, 6) // smoothstep(0.5) = 0.5 → 1 + 15·0.5
    expect(s.active).toBe(true)
  })

  it('completion returns the EXACT goal zoom once, then null', () => {
    const s = createInactiveZoomAnimation()
    startZoomAnimation(s, 1, 16, 1000)
    expect(tickZoomAnimation(s, s.startTime + 1100)).toBe(16)
    expect(s.active).toBe(false)
    expect(tickZoomAnimation(s, s.startTime + 2000)).toBeNull()
  })

  it('zero duration snaps immediately', () => {
    const s = createInactiveZoomAnimation()
    startZoomAnimation(s, 1, 16, 0)
    expect(tickZoomAnimation(s, s.startTime)).toBe(16)
    expect(s.active).toBe(false)
  })

  it('guards non-finite / non-positive zoom inputs to 1', () => {
    const s = createInactiveZoomAnimation()
    startZoomAnimation(s, Number.NaN, -3, 400)
    expect(s.fromZoom).toBe(1)
    expect(s.toZoom).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// H. Constant pins (pure-module source + values)
// ---------------------------------------------------------------------------
describe('H. viewport3d-camera-fit constant pins', () => {
  it('DEFAULT_FIT_MARGIN = 1.25', () => {
    expect(DEFAULT_FIT_MARGIN).toBe(1.25)
  })

  it('fit distance clamp mirrors the OrbitControls dolly range (6–6000 mm)', () => {
    expect(MIN_FIT_DISTANCE_MM).toBe(6)
    expect(MAX_FIT_DISTANCE_MM).toBe(6000)
  })

  it('ortho clip planes: NEGATIVE near (CAD convention) and far matching perspective', () => {
    expect(ORTHO_CAMERA_NEAR_MM).toBe(-8000)
    expect(ORTHO_CAMERA_FAR_MM).toBe(8000)
  })

  it('module only imports three + the animate module smoothstep (no React/R3F)', () => {
    const importLines = MODULE_SOURCE
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => /^\s*import\s/.test(l))
    expect(importLines.length).toBe(2)
    expect(MODULE_SOURCE).toMatch(/import \* as THREE from 'three'/)
    expect(MODULE_SOURCE).toMatch(/import \{ smoothstep \} from '\.\/viewport3d-camera-animate'/)
    expect(MODULE_SOURCE).not.toMatch(/from 'react'/)
    expect(MODULE_SOURCE).not.toMatch(/@react-three/)
  })

  it('no `any` in the module source', () => {
    const code = MODULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(code).not.toMatch(/\bas\s+any\b/)
    expect(code).not.toMatch(/:\s*any\b/)
  })
})

// ---------------------------------------------------------------------------
// I. Viewport3D.tsx wiring pins — the two HUD buttons render + CameraRig
// ---------------------------------------------------------------------------
describe('I. Viewport3D.tsx — fit + projection-toggle button wiring pins', () => {
  it('renders the Fit view button (title + aria-label + handler)', () => {
    expect(VIEWPORT_SOURCE).toContain('title="Fit view"')
    expect(VIEWPORT_SOURCE).toContain('aria-label="Fit view"')
    expect(VIEWPORT_SOURCE).toContain('onClick={onFitView}')
  })

  it('renders the projection toggle with the mode-you-switch-to tooltip', () => {
    expect(VIEWPORT_SOURCE).toContain(
      "title={projection === 'orthographic' ? 'Perspective view' : 'Orthographic view'}"
    )
    expect(VIEWPORT_SOURCE).toContain("aria-pressed={projection === 'orthographic'}")
    expect(VIEWPORT_SOURCE).toContain('onClick={onToggleProjection}')
    expect(VIEWPORT_SOURCE).toContain("{projection === 'orthographic' ? 'ORTHO' : 'PERSP'}")
  })

  it('both buttons live in the viewcube cluster with the wide modifier class', () => {
    const matches = VIEWPORT_SOURCE.match(/viewport-3d__cube-btn--wide/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('mounts CameraRig inside the Canvas with the projection + zoom-anim wiring', () => {
    expect(VIEWPORT_SOURCE).toMatch(/<CameraRig\s[\s\S]{0,220}projection=\{projection\}/)
    expect(VIEWPORT_SOURCE).toMatch(/zoomAnimRef=\{zoomAnimRef\}/)
    expect(VIEWPORT_SOURCE).toMatch(/sizeRef=\{viewportSizeRef\}/)
  })

  it('the swap preserves apparent scale in BOTH directions (zoom⇄distance calls present)', () => {
    expect(VIEWPORT_SOURCE).toMatch(
      /ortho\.zoom = orthoZoomForPerspectiveDistance\(distance, persp\.fov, size\.height\)/
    )
    expect(VIEWPORT_SOURCE).toMatch(/perspectiveDistanceForOrthoZoom\(ortho\.zoom, persp\.fov, size\.height\)/)
    expect(VIEWPORT_SOURCE).toContain('set({ camera: ortho })')
    expect(VIEWPORT_SOURCE).toContain('set({ camera: persp })')
  })

  it('OrbitControls gains the ortho zoom range alongside the shared dolly consts', () => {
    expect(VIEWPORT_SOURCE).toContain('minDistance={MIN_FIT_DISTANCE_MM}')
    expect(VIEWPORT_SOURCE).toContain('maxDistance={MAX_FIT_DISTANCE_MM}')
    expect(VIEWPORT_SOURCE).toContain('minZoom={ORTHO_MIN_ZOOM}')
    expect(VIEWPORT_SOURCE).toContain('maxZoom={ORTHO_MAX_ZOOM}')
  })

  it('the fit handler feeds the existing fly-to animation and the ortho zoom animation', () => {
    expect(VIEWPORT_SOURCE).toMatch(
      /const goal = computeFitViewGoal\(readFitBounds\(stable\), cam\.position, cam\.up, c\.target, \{/
    )
    expect(VIEWPORT_SOURCE).toMatch(
      /startCameraAnimation\(animRef\.current, cam\.position, cam\.up, c\.target, goal, 400\)/
    )
    expect(VIEWPORT_SOURCE).toMatch(/startZoomAnimation\(zoomAnimRef\.current, cam\.zoom, goal\.zoom, 400\)/)
  })

  it('the Canvas fov and the fit handler share the single DESIGN_FOV_DEG source', () => {
    expect(VIEWPORT_SOURCE).toContain('const DESIGN_FOV_DEG = 45')
    expect(VIEWPORT_SOURCE).toContain('fov: DESIGN_FOV_DEG')
  })

  it('imports the pure module (no math re-implemented inline)', () => {
    expect(VIEWPORT_SOURCE).toMatch(/from '\.\/viewport3d-camera-fit'/)
  })
})

// ---------------------------------------------------------------------------
// J. workspace.css pins — the new button modifiers exist
// ---------------------------------------------------------------------------
describe('J. workspace.css — HUD button modifier pins', () => {
  it('declares .viewport-3d__cube-btn--wide (auto-width label buttons)', () => {
    expect(CSS_SOURCE).toContain('.viewport-3d__cube-btn--wide {')
  })

  it('declares .viewport-3d__cube-btn--active with the accent tokens', () => {
    expect(CSS_SOURCE).toMatch(
      /\.viewport-3d__cube-btn--active \{[^}]*var\(--accent-10\)[^}]*var\(--accent-20\)[^}]*var\(--accent\)/s
    )
  })
})
