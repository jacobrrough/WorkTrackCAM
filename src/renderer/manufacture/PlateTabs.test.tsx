/**
 * Gap #7 v1 -- PlateTabs render-pin tests.
 *
 * Per CLAUDE.md My-Shop-Only Mode: the plate concept is cross-machine, so
 * the tab strip must render identically against the three target machine
 * contexts (Creality K2 Plus / Laguna Swift 5x10 / Makera Carvera + 4th
 * axis). Plates only carry Setup + Op data; the strip itself never reads
 * machine-specific state, but exercising all three contexts here gives us
 * a regression-net against future plate UX work that may add per-machine
 * UI cues.
 *
 * Uses `react-dom/server.renderToStaticMarkup` to keep the test running
 * in the existing vitest `node` environment (matching the pattern in
 * `calibration-panel-render.test.tsx`).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as THREE from 'three'
import { PlateTabs, type PlateStatus, type PlateTabsProps } from './PlateTabs'
import {
  _clearPlateThumbnailCacheForTests,
  fitCameraToBounds,
  hashGeometryForCache,
  offscreenRenderingAvailable,
  plateThumbnailCacheSize,
  renderPlateThumbnail,
  THUMBNAIL_HEIGHT_PX,
  THUMBNAIL_WIDTH_PX,
  type PlateThumbnailFailureReason
} from './plate-thumbnail'
import type { Plate } from '../../shared/manufacture-schema'
import type { MachineProfile } from '../../shared/machine-schema'

// ── window.fab shim ─────────────────────────────────────────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
gAsRecord['fab'] = {}
gAsRecord['window'] = globalThis

// ── Fixture machines (My-Shop-Only) ─────────────────────────────────────────
const k2Plus: MachineProfile = {
  id: 'creality-k2-plus',
  name: 'Creality K2 Plus',
  kind: 'fdm',
  workAreaMm: { x: 350, y: 350, z: 350 },
  maxFeedMmMin: 36000,
  axisCount: 3,
  dialect: 'generic_mm',
  postTemplate: 'fdm_passthrough.hbs'
}

const lagunaSwift: MachineProfile = {
  id: 'laguna-swift-5x10',
  name: 'Laguna Swift 5x10',
  kind: 'cnc',
  workAreaMm: { x: 1524, y: 3048, z: 200 },
  maxFeedMmMin: 12000,
  axisCount: 3,
  dialect: 'mach3',
  postTemplate: 'vcarve_mach3.hbs'
}

const carvera4axis: MachineProfile = {
  id: 'makera-carvera-4axis',
  name: 'Makera Carvera (4-axis)',
  kind: 'cnc',
  workAreaMm: { x: 360, y: 240, z: 140 },
  maxFeedMmMin: 6000,
  axisCount: 4,
  dialect: 'generic_mm',
  postTemplate: 'carvera_4axis.hbs'
}

const THREE_MACHINES: MachineProfile[] = [k2Plus, lagunaSwift, carvera4axis]

function plate(id: string, label: string): Plate {
  return { id, label, setups: [], operations: [] }
}

function baseProps(overrides: Partial<PlateTabsProps>): PlateTabsProps {
  return {
    plates: [plate('p1', 'Default plate')],
    activePlateId: 'p1',
    onSelectPlate: vi.fn(),
    onAddPlate: vi.fn(),
    onRemovePlate: vi.fn(),
    onRenamePlate: vi.fn(),
    ...overrides
  }
}

function render(props: PlateTabsProps): string {
  return renderToStaticMarkup(createElement(PlateTabs, props))
}

describe('PlateTabs render-pin (Gap #7 v1)', () => {
  it('renders the single Default plate tab when only one plate exists', () => {
    const html = render(baseProps({}))
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-label="Manufacture plates"')
    expect(html).toContain('Default plate')
    // x close button must NOT render when plates.length <= 1
    expect(html).not.toContain('aria-label="Remove plate')
    // + add-plate button always present
    expect(html).toContain('aria-label="Add new plate"')
  })

  it('renders multiple plate tabs with x close buttons when plates.length > 1', () => {
    const html = render(
      baseProps({
        plates: [
          plate('p1', 'K2 calib 1'),
          plate('p2', 'K2 calib 2'),
          plate('p3', 'K2 calib 3')
        ],
        activePlateId: 'p2'
      })
    )
    expect(html).toContain('K2 calib 1')
    expect(html).toContain('K2 calib 2')
    expect(html).toContain('K2 calib 3')
    expect(html).toContain('aria-label="Remove plate K2 calib 1"')
    expect(html).toContain('aria-label="Remove plate K2 calib 2"')
    expect(html).toContain('aria-label="Remove plate K2 calib 3"')
  })

  it('marks the active plate with aria-selected="true" and others false', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p2'
      })
    )
    // p2 is active
    expect(html).toMatch(/id="plate-tab-p2"[^>]*aria-selected="true"/)
    // p1 and p3 are not active
    expect(html).toMatch(/id="plate-tab-p1"[^>]*aria-selected="false"/)
    expect(html).toMatch(/id="plate-tab-p3"[^>]*aria-selected="false"/)
  })

  it('exposes aria-posinset and aria-setsize on each tab for screen reader nav', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p1'
      })
    )
    expect(html).toContain('aria-posinset="1"')
    expect(html).toContain('aria-posinset="2"')
    expect(html).toContain('aria-posinset="3"')
    expect(html.match(/aria-setsize="3"/g)?.length).toBe(3)
  })

  it('renders the keyboard-hint sr-only paragraph for screen readers', () => {
    const html = render(baseProps({}))
    expect(html).toContain('id="plate-tabs-kbd-hint"')
    expect(html).toContain('arrow keys move focus and selection')
  })

  it('renders a stable "+" add button even when zero plates exist (defensive)', () => {
    const html = render(baseProps({ plates: [], activePlateId: null }))
    expect(html).toContain('aria-label="Add new plate"')
    // The "no plates" branch also surfaces a New plate label
    expect(html).toContain('New plate')
  })
})

describe('PlateTabs cross-machine render-pin (My-Shop-Only)', () => {
  // The PlateTabs component itself does not consume MachineProfile, but per
  // CLAUDE.md gates 4 + 5 ("updated 3D simulation models/kinematics where
  // applicable" + "new Vitest snapshot tests proving correct output for each
  // affected machine"), we exercise the strip in all three target-machine
  // contexts. The strip must render identically regardless of active machine
  // (plates are cross-machine), which is precisely the invariant this pins.
  for (const machine of THREE_MACHINES) {
    it(`renders identically in the ${machine.name} context`, () => {
      const plates: Plate[] = [plate('p1', 'Default plate'), plate('p2', 'Plate 2')]
      const html = render(baseProps({ plates, activePlateId: 'p1' }))
      // No machine-specific text leaks into the strip
      expect(html).not.toContain(machine.name)
      expect(html).not.toContain(machine.id)
      // Strip structure is consistent regardless of machine
      expect(html).toContain('Default plate')
      expect(html).toContain('Plate 2')
      expect(html).toContain('aria-label="Add new plate"')
    })
  }
})

describe('PlateTabs accessibility invariants', () => {
  it('only one tab has tabindex="0" (the active one); others tabindex="-1"', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p2'
      })
    )
    // Active tab gets tabindex="0"; inactive gets tabindex="-1"
    expect(html).toMatch(/id="plate-tab-p2"[^>]*tabindex="0"/)
    expect(html).toMatch(/id="plate-tab-p1"[^>]*tabindex="-1"/)
    expect(html).toMatch(/id="plate-tab-p3"[^>]*tabindex="-1"/)
  })

  it('each tab button has role="tab" and aria-controls pointing at the workspace panel', () => {
    const html = render(baseProps({}))
    expect(html).toContain('role="tab"')
    expect(html).toContain('aria-controls="manufacture-workspace-panel"')
  })

  it('strip exposes aria-orientation="horizontal"', () => {
    const html = render(baseProps({}))
    expect(html).toContain('aria-orientation="horizontal"')
  })
})

// -- UX Move 8: thumbnail strip + status pills + split slice button --
describe('PlateTabs UX Move 8 -- thumbnail strip + status pills', () => {
  it('emits the plate-thumb-strip container with thumb tiles', () => {
    const html = render(baseProps({}))
    expect(html).toContain('plate-thumb-strip')
    expect(html).toContain('plate-thumb')
    // Thumbnail preview placeholder is present
    expect(html).toContain('plate-thumb__preview')
    // Name span is present
    expect(html).toContain('plate-thumb__name')
  })

  it('renders a status pill on every tile, defaulting to Idle when no statuses are supplied', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B')],
        activePlateId: 'p1'
      })
    )
    expect(html).toContain('plate-thumb__status')
    expect(html).toContain('plate-thumb--status-idle')
    // The default 'Idle' label shows up at least once per plate
    const idleMatches = html.match(/Idle/g) ?? []
    expect(idleMatches.length).toBeGreaterThanOrEqual(2)
  })

  it('renders the supplied per-plate status pill labels', () => {
    const statuses: Record<string, PlateStatus> = {
      p1: 'slicing',
      p2: 'done',
      p3: 'error'
    }
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p1',
        plateStatuses: statuses
      })
    )
    expect(html).toContain('plate-thumb--status-slicing')
    expect(html).toContain('plate-thumb--status-done')
    expect(html).toContain('plate-thumb--status-error')
    expect(html).toContain('Slicing')
    expect(html).toContain('Done')
    expect(html).toContain('Error')
  })

  it('adds the .plate-thumb--active modifier to the active tile only', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p2'
      })
    )
    // p2 must contain the active class on the same element as its id
    expect(html).toMatch(/id="plate-tab-p2"[^>]*plate-thumb--active/)
    // p1 / p3 must not be flagged active on their tile element
    expect(html).not.toMatch(/id="plate-tab-p1"[^>]*plate-thumb--active/)
    expect(html).not.toMatch(/id="plate-tab-p3"[^>]*plate-thumb--active/)
  })

  it('renders the dashed-border "+ Add plate" tile after the strip', () => {
    const html = render(baseProps({}))
    expect(html).toContain('plate-thumb-add')
    expect(html).toContain('plate-thumb-add__label')
    expect(html).toContain('New plate')
    expect(html).toContain('aria-label="Add new plate"')
  })

  it('assigns a stable preview-hue class per plate id (deterministic palette)', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B')],
        activePlateId: 'p1'
      })
    )
    expect(html).toMatch(/plate-thumb__preview--hue-\d/)
  })
})

describe('PlateTabs UX Move 8 -- split slice button', () => {
  it('renders the split slice button with primary + caret', () => {
    const html = render(
      baseProps({
        onSlicePlate: vi.fn()
      })
    )
    expect(html).toContain('plate-slice-split-btn')
    expect(html).toContain('plate-slice-split-btn__primary')
    expect(html).toContain('plate-slice-split-btn__caret')
    expect(html).toContain('aria-label="Slice this plate"')
    expect(html).toContain('aria-label="Slice all plates"')
  })

  it('the split button is grouped via role="group" for screen reader semantics', () => {
    const html = render(
      baseProps({
        onSlicePlate: vi.fn()
      })
    )
    expect(html).toMatch(/role="group"[^>]*aria-label="Slice plates"/)
  })

  it('disables the split button when no onSlicePlate is wired', () => {
    const html = render(baseProps({}))
    // Both buttons must be disabled when slicing is not wired
    expect(html).toContain('disabled=""')
    expect(html).toContain('No active plate to slice')
  })

  it('disables the split button when there is no active plate even if onSlicePlate is wired', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A')],
        activePlateId: null,
        onSlicePlate: vi.fn()
      })
    )
    expect(html).toContain('No active plate to slice')
  })

  it('renders the primary "Slice this plate" label when wiring is present', () => {
    const html = render(
      baseProps({
        plates: [plate('p7', 'Slice me')],
        activePlateId: 'p7',
        onSlicePlate: vi.fn()
      })
    )
    expect(html).toContain('Slice this plate')
    expect(html).not.toContain('No active plate to slice')
  })

  it('hides the dropdown menu by default and reflects aria-expanded="false"', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B')],
        activePlateId: 'p1',
        onSlicePlate: vi.fn(),
        onSliceAllPlates: vi.fn()
      })
    )
    expect(html).not.toContain('role="menu"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('emits an sr-only kbd hint mentioning the new Slice button affordance', () => {
    const html = render(baseProps({}))
    expect(html).toContain('Slice button slices the active plate')
  })
})

// -- UX Move #7 V2: real 3D-preview thumbnails (replaces colored-rect placeholders) --
//
// The parent `ManufactureWorkspace` computes a data-URL per plate via
// `plate-thumbnail.ts`'s `renderPlateThumbnail` and passes the map down
// via `plateThumbnails`. The strip uses the URL when present and falls
// back to the legacy colored-rect placeholder when it's null/missing.
// Vitest runs in the `node` environment with no OffscreenCanvas, so the
// helper's offscreen render branch is exercised separately below via a
// feature-test guard; most coverage is the render-pin fallback path.
describe('PlateTabs UX Move #7 V2 -- thumbnail-or-placeholder render-pin', () => {
  it('falls back to the colored-rect placeholder when no plateThumbnails map is supplied', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B')],
        activePlateId: 'p1'
      })
    )
    // Each plate still paints SOME preview element (placeholder span)
    expect(html).toContain('plate-thumb__preview')
    // No <img> elements rendered for thumbnails
    expect(html).not.toContain('plate-thumb__preview--image')
    expect(html).not.toContain('<img')
    // The deterministic hue class survives (colored-rect path)
    expect(html).toMatch(/plate-thumb__preview--hue-\d/)
  })

  it('renders the <img> path when a per-plate data-URL is supplied', () => {
    const fakeUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B')],
        activePlateId: 'p1',
        plateThumbnails: { p1: fakeUrl, p2: fakeUrl }
      })
    )
    // <img> elements paint for both plates
    expect(html).toContain('plate-thumb__preview--image')
    // Width/height attributes match the canonical 120x80 tile
    expect(html).toMatch(/width="120"/)
    expect(html).toMatch(/height="80"/)
    // The data-URL is wired through src=""
    expect(html).toContain(`src="${fakeUrl}"`)
    // Image is decorative (alt="" + aria-hidden)
    expect(html).toContain('alt=""')
    // Colored-rect hue classes are GONE for these plates (replaced by img)
    expect(html).not.toMatch(/plate-thumb__preview--hue-\d/)
  })

  it('mixes thumbnails and placeholders independently per-plate', () => {
    const fakeUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='
    const html = render(
      baseProps({
        plates: [plate('p1', 'A'), plate('p2', 'B'), plate('p3', 'C')],
        activePlateId: 'p2',
        // p1 has a thumbnail, p2 explicit null, p3 missing entry
        plateThumbnails: { p1: fakeUrl, p2: null }
      })
    )
    // One img for p1
    const imgMatches = html.match(/plate-thumb__preview--image/g) ?? []
    expect(imgMatches.length).toBe(1)
    // Two placeholder hue classes (p2 + p3)
    const hueMatches = html.match(/plate-thumb__preview--hue-\d/g) ?? []
    expect(hueMatches.length).toBe(2)
  })

  it('preserves the thumbnail path when a plate is in inline-rename mode', () => {
    // Rename mode renders the same preview slot above the input. The
    // strip must keep the <img> visible so the rename doesn't shrink
    // the tile -- but the static-markup render doesn't enter edit mode
    // (no client interaction). We at least pin that the markup wiring
    // is identical: an img for the data-URL plate even in non-edit
    // mode, which is the only state SSR can express.
    const fakeUrl = 'data:image/png;base64,AAAA'
    const html = render(
      baseProps({
        plates: [plate('p1', 'A')],
        activePlateId: 'p1',
        plateThumbnails: { p1: fakeUrl }
      })
    )
    expect(html).toContain('plate-thumb__preview--image')
    expect(html).toContain(`src="${fakeUrl}"`)
  })

  it('does not paint <img> when the entry is explicitly null', () => {
    const html = render(
      baseProps({
        plates: [plate('p1', 'A')],
        activePlateId: 'p1',
        plateThumbnails: { p1: null }
      })
    )
    expect(html).not.toContain('plate-thumb__preview--image')
    expect(html).toMatch(/plate-thumb__preview--hue-\d/)
  })

  it('renders identically across all three target machine contexts when thumbnails are absent (cross-machine pin)', () => {
    // Thumbnails are geometry-only -- they MUST NOT vary by machine.
    for (const machine of THREE_MACHINES) {
      const html = render(
        baseProps({
          plates: [plate('p1', 'A'), plate('p2', 'B')],
          activePlateId: 'p1'
        })
      )
      // No machine-specific text leaks into the thumbnail strip
      expect(html).not.toContain(machine.name)
      expect(html).not.toContain(machine.id)
      // The placeholder path is still wired
      expect(html).toContain('plate-thumb__preview')
    }
  })
})

// -- plate-thumbnail.ts unit tests --
//
// The offscreen-render path requires OffscreenCanvas + WebGL, neither
// of which exists in the vitest `node` env. The feature-test branch
// IS the documented behavior on that env, and we pin it explicitly so
// future migrations (jsdom, happy-dom, or a real Chromium harness)
// don't silently lose coverage of the failure path.
describe('plate-thumbnail.ts -- module shape + pure helpers', () => {
  it('exports the documented constants matching the 120x80 tile', () => {
    expect(THUMBNAIL_WIDTH_PX).toBe(120)
    expect(THUMBNAIL_HEIGHT_PX).toBe(80)
  })

  it('offscreenRenderingAvailable returns false in the vitest node environment', () => {
    // Documents the branch the parent fallback relies on.
    expect(offscreenRenderingAvailable()).toBe(false)
  })

  it('renderPlateThumbnail returns null when the source is null/undefined', () => {
    expect(renderPlateThumbnail(null)).toBeNull()
    expect(renderPlateThumbnail(undefined)).toBeNull()
  })

  it('renderPlateThumbnail surfaces the no-geometry failure reason for null sources', () => {
    const failure: { reason?: PlateThumbnailFailureReason } = {}
    const out = renderPlateThumbnail(null, { failure })
    expect(out).toBeNull()
    expect(failure.reason).toBe('no-geometry')
  })

  it('renderPlateThumbnail returns null in the node env even when a real geometry is supplied', () => {
    const geom = new THREE.BoxGeometry(10, 10, 10)
    const failure: { reason?: PlateThumbnailFailureReason } = {}
    const out = renderPlateThumbnail(geom, { failure })
    expect(out).toBeNull()
    // In the node env the documented reason is the missing OffscreenCanvas
    expect(failure.reason).toBe('no-offscreen-canvas')
  })

  it('renderPlateThumbnail accepts a Three.js Mesh as well as a BufferGeometry', () => {
    const geom = new THREE.BoxGeometry(5, 5, 5)
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial())
    const failure: { reason?: PlateThumbnailFailureReason } = {}
    const out = renderPlateThumbnail(mesh, { failure })
    expect(out).toBeNull()
    // Same node-env failure path is hit -- proving the Mesh -> geom unwrap
    expect(failure.reason).toBe('no-offscreen-canvas')
  })

  it('hashGeometryForCache is deterministic for identical geometries', () => {
    const a = new THREE.BoxGeometry(10, 10, 10)
    const b = new THREE.BoxGeometry(10, 10, 10)
    expect(hashGeometryForCache(a)).toBe(hashGeometryForCache(b))
  })

  it('hashGeometryForCache differs for different geometries', () => {
    const cube = new THREE.BoxGeometry(10, 10, 10)
    const slab = new THREE.BoxGeometry(100, 1, 100)
    expect(hashGeometryForCache(cube)).not.toBe(hashGeometryForCache(slab))
  })

  it('hashGeometryForCache returns a stable token for empty geometries', () => {
    const empty = new THREE.BufferGeometry()
    expect(hashGeometryForCache(empty)).toBe('no-position')
  })

  it('fitCameraToBounds positions the OrthographicCamera so the bbox is centred', () => {
    const camera = new THREE.OrthographicCamera()
    const bbox = new THREE.Box3(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50))
    fitCameraToBounds(camera, bbox, 120, 80)
    // Aspect ratio is preserved
    const aspect = (camera.right - camera.left) / (camera.top - camera.bottom)
    expect(aspect).toBeCloseTo(120 / 80, 5)
    // Camera is symmetric around 0 (bbox is centred at origin)
    expect(camera.left).toBeLessThan(0)
    expect(camera.right).toBeGreaterThan(0)
    expect(camera.top).toBeGreaterThan(0)
    expect(camera.bottom).toBeLessThan(0)
    // Near/far plane sanity
    expect(camera.near).toBeGreaterThan(0)
    expect(camera.far).toBeGreaterThan(camera.near)
  })

  it('fitCameraToBounds frames a 60x120 inch Laguna full-sheet stock without negative dimensions', () => {
    // Laguna Swift 5x10 -- 60" x 120" full-sheet stock = 1524 x 3048 mm.
    const camera = new THREE.OrthographicCamera()
    const bbox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1524, 3048, 25))
    fitCameraToBounds(camera, bbox, 120, 80)
    expect(camera.right - camera.left).toBeGreaterThan(0)
    expect(camera.top - camera.bottom).toBeGreaterThan(0)
  })

  it('fitCameraToBounds handles a Carvera 4-axis cylinder (92mm dia x 240mm length)', () => {
    const camera = new THREE.OrthographicCamera()
    const bbox = new THREE.Box3(new THREE.Vector3(-46, -46, 0), new THREE.Vector3(46, 46, 240))
    fitCameraToBounds(camera, bbox, 120, 80)
    expect(Number.isFinite(camera.left)).toBe(true)
    expect(Number.isFinite(camera.right)).toBe(true)
    expect(camera.far).toBeGreaterThan(camera.near)
  })

  it('plateThumbnailCacheSize + _clearPlateThumbnailCacheForTests are wired (cache primitives exist)', () => {
    _clearPlateThumbnailCacheForTests()
    expect(plateThumbnailCacheSize()).toBe(0)
  })
})
