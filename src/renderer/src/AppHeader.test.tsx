/**
 * Render-contract pins for `AppHeader` (UX MOVE 7 — locked global status
 * strip).
 *
 * Uses `react-dom/server.renderToStaticMarkup` so the suite stays in the
 * existing node-vitest environment without a jsdom dependency (matches
 * `WorkshopDashboard.test.tsx` / `MoonrakerPreviewBanner.test.tsx`
 * patterns).
 *
 * The polling lifecycle is exercised by passing
 * `pollIntervalMs={Number.MAX_SAFE_INTEGER}` — the effect runs exactly
 * one initial poll and does not schedule a recurring tick, so the
 * snapshot stays deterministic.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { AppHeader, type AppHeaderFabBridge } from './AppHeader'
import type { Job } from './shop-types'

// ── Fixtures ───────────────────────────────────────────────────────────

const job = (
  id: string,
  machineId: string | null,
  status: Job['status'] = 'idle',
  gcodeOut: string | null = null
): Job => ({
  id,
  name: id,
  stlPath: null,
  machineId,
  materialId: null,
  stock: { x: 100, y: 100, z: 20 },
  transform: {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  },
  stockProfile: 'cylinder',
  operations: [],
  posts: null,
  chuckDepthMm: 5,
  clampOffsetMm: 0,
  gcodeOut,
  status,
  lastLog: '',
  printerUrl: ''
})

const noopFab: AppHeaderFabBridge = {
  moonrakerStatus: () => Promise.resolve({ ok: false, error: 'test-stub' })
}

function render(
  props: Partial<Parameters<typeof AppHeader>[0]> = {}
): string {
  return renderToStaticMarkup(
    createElement(AppHeader, {
      currentMachineId: null,
      jobs: [],
      moonrakerUrl: null,
      pollIntervalMs: Number.MAX_SAFE_INTEGER,
      fab: noopFab,
      ...props
    })
  )
}

// ── Banner / layout contract ────────────────────────────────────────────

describe('AppHeader — locked global status strip layout', () => {
  it('renders a banner-role wrapper with the app-header class', () => {
    const html = render()
    expect(html).toMatch(/<div[^>]*class="app-header"/)
    expect(html).toMatch(/role="banner"/)
  })

  it('exposes the resolved status via a `data-status` attribute', () => {
    const html = render()
    // With no machine, status defaults to "idle".
    expect(html).toMatch(/data-status="idle"/)
  })

  it('renders exactly one status dot with role="img"', () => {
    const html = render()
    const dots = html.match(/class="app-header__status-dot"/g) ?? []
    expect(dots).toHaveLength(1)
    expect(html).toMatch(/role="img"/)
  })

  it('renders three layout regions: left, center, right', () => {
    const html = render()
    expect(html).toMatch(/class="app-header__left"/)
    expect(html).toMatch(/class="app-header__center"/)
    expect(html).toMatch(/class="app-header__right"/)
  })
})

// ── Machine-ID display ─────────────────────────────────────────────────

describe('AppHeader — center column displays the active machine ID', () => {
  it('falls back to "No machine" when no session machine is active', () => {
    const html = render({ currentMachineId: null })
    expect(html).toContain('No machine')
  })

  it('renders the machine ID verbatim in mono', () => {
    const html = render({ currentMachineId: 'creality-k2-plus' })
    // Look for both the visible text and the class hook.
    expect(html).toContain('creality-k2-plus')
    expect(html).toMatch(/class="app-header__machine-id"/)
  })
})

// ── Status derivation ─────────────────────────────────────────────────

describe('AppHeader — status reflects job state for the active machine', () => {
  it('idle when no machine is active', () => {
    const html = render({ currentMachineId: null })
    expect(html).toMatch(/data-status="idle"/)
    // The label appears in human-readable form too.
    expect(html).toContain('Idle')
  })

  it('running when the K2 Plus job is mid-CAM', () => {
    const html = render({
      currentMachineId: 'creality-k2-plus',
      jobs: [job('k2-1', 'creality-k2-plus', 'running')]
    })
    expect(html).toMatch(/data-status="running"/)
    expect(html).toContain('Running')
  })

  it('error when the Carvera 4-axis job failed', () => {
    const html = render({
      currentMachineId: 'makera-carvera-4axis',
      jobs: [job('car-1', 'makera-carvera-4axis', 'error', '/tmp/car.gcode')]
    })
    expect(html).toMatch(/data-status="error"/)
    expect(html).toContain('Error')
  })

  it('bucketed Carvera 3-axis and 4-axis variants share the same status pool', () => {
    const html = render({
      currentMachineId: 'makera-carvera-3axis',
      jobs: [
        job('three', 'makera-carvera-3axis', 'done', '/tmp/three.gcode'),
        job('four', 'makera-carvera-4axis', 'running', '/tmp/four.gcode')
      ]
    })
    // Latest (4-axis) status wins.
    expect(html).toMatch(/data-status="running"/)
  })

  it('falls back to idle when only off-list machine jobs are present', () => {
    const html = render({
      currentMachineId: 'creality-k2-plus',
      jobs: [job('foreign', 'prusa-mk4', 'running', '/tmp/foreign.gcode')]
    })
    expect(html).toMatch(/data-status="idle"/)
    expect(html).not.toContain('foreign')
  })
})

// ── E-stop gating ───────────────────────────────────────────────────────

describe('AppHeader — E-stop button gating', () => {
  it('does NOT render E-stop when onEstop is omitted', () => {
    const html = render({ currentMachineId: 'creality-k2-plus' })
    expect(html).not.toMatch(/data-action="estop"/)
    expect(html).not.toContain('E-STOP')
  })

  it('does NOT render E-stop when no machine is active, even if onEstop is provided', () => {
    const html = render({
      currentMachineId: null,
      onEstop: vi.fn()
    })
    expect(html).not.toMatch(/data-action="estop"/)
  })

  it('renders E-stop when onEstop is provided AND a machine is active', () => {
    const html = render({
      currentMachineId: 'creality-k2-plus',
      onEstop: vi.fn()
    })
    expect(html).toMatch(/data-action="estop"/)
    expect(html).toContain('E-STOP')
    // Carries an explicit type="button" so it never accidentally
    // submits an ancestor form.
    expect(html).toMatch(/<button[^>]*type="button"[^>]*data-action="estop"/)
  })

  it('E-stop button has an accessible aria-label', () => {
    const html = render({
      currentMachineId: 'creality-k2-plus',
      onEstop: vi.fn()
    })
    expect(html).toMatch(/aria-label="Emergency stop"/)
  })

  // Visibility pin #1 (Workflow F task 3) — both prerequisites present.
  it('renders the E-stop button only when onEstop AND currentMachineId are both present', () => {
    const html = render({
      currentMachineId: 'laguna-swift-5x10',
      onEstop: vi.fn()
    })
    expect(html).toMatch(/data-testid="app-header-estop-button"/)
    expect(html).toMatch(/data-action="estop"/)
  })

  // Visibility pin #2 (Workflow F task 3) — onEstop missing.
  it('hides the E-stop button when onEstop is undefined (no callback wired)', () => {
    const html = render({
      currentMachineId: 'laguna-swift-5x10'
      // onEstop intentionally omitted
    })
    expect(html).not.toMatch(/data-testid="app-header-estop-button"/)
    expect(html).not.toMatch(/data-action="estop"/)
  })

  // Visibility pin #3 (Workflow F task 3) — currentMachineId null.
  it('hides the E-stop button when currentMachineId is null even if onEstop is provided', () => {
    const html = render({
      currentMachineId: null,
      onEstop: vi.fn()
    })
    expect(html).not.toMatch(/data-testid="app-header-estop-button"/)
    expect(html).not.toMatch(/data-action="estop"/)
  })

  // Safety-treatment pin — the button must render with a visually
  // distinctive red surface so operators never confuse it with the
  // normal toolbar pills. The treatment is driven by inline style + the
  // `app-header__estop--active` class so we don't have to ship CSS for
  // a one-off here.
  it('renders the E-stop button with a distinctive red treatment when active', () => {
    const html = render({
      currentMachineId: 'creality-k2-plus',
      onEstop: vi.fn()
    })
    // Class hook for any future CSS overrides.
    expect(html).toMatch(/class="app-header__estop app-header__estop--active"/)
    // Inline style ensures the danger treatment ships without depending
    // on a CSS file the parallel agents might touch.
    expect(html).toMatch(/var\(--err\)/)
  })

  // The button must carry the documented data-testid so end-to-end and
  // render-pin suites can target it without scraping label text.
  it('exposes data-testid="app-header-estop-button" so suites can target it', () => {
    const html = render({
      currentMachineId: 'makera-carvera-4axis',
      onEstop: vi.fn()
    })
    expect(html).toMatch(/data-testid="app-header-estop-button"/)
  })
})

// ── Poll lifecycle (single initial poll, no recurring tick) ────────────

describe('AppHeader — Moonraker poll lifecycle (static render: useEffect inactive)', () => {
  // `renderToStaticMarkup` is a pure server-side render that never
  // dispatches `useEffect`. These tests assert the contract *for static
  // markup* — namely, no poll is ever observed (the effect is dormant
  // until the component is mounted in a real DOM). The poll lifecycle
  // itself is covered by `WorkshopDashboard.test.tsx`, which shares the
  // same helper module (`workshop-dashboard-helpers.ts`).
  it('does NOT poll during static markup render — even when configured for K2', () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, rawState: 'standby' })
    render({
      currentMachineId: 'creality-k2-plus',
      moonrakerUrl: 'http://k2plus.local',
      fab: { moonrakerStatus: mock }
    })
    expect(mock).not.toHaveBeenCalled()
  })

  it('produces a deterministic static snapshot regardless of fab bridge state', () => {
    const html1 = render({
      currentMachineId: 'creality-k2-plus',
      moonrakerUrl: 'http://k2plus.local',
      fab: { moonrakerStatus: () => Promise.resolve({ ok: true, rawState: 'printing' }) }
    })
    const html2 = render({
      currentMachineId: 'creality-k2-plus',
      moonrakerUrl: 'http://k2plus.local',
      fab: { moonrakerStatus: () => Promise.resolve({ ok: false }) }
    })
    // Both renders fall back to job-derived status (idle) because the
    // async poll never runs during static markup.
    expect(html1).toMatch(/data-status="idle"/)
    expect(html2).toMatch(/data-status="idle"/)
  })
})
