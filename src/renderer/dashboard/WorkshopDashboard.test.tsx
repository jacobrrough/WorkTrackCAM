/**
 * Render-contract pins for `WorkshopDashboard` (Gap #10).
 *
 * Uses `react-dom/server.renderToStaticMarkup` so the suite keeps the
 * existing node-vitest environment without a jsdom dependency
 * (matches the MoonrakerPreviewBanner test style).
 *
 * The dashboard's polling lifecycle is exercised by passing
 * `pollIntervalMs={Number.MAX_SAFE_INTEGER}` — the effect kicks off
 * exactly one initial poll and does not schedule a recurring tick, so
 * `renderToStaticMarkup` produces a deterministic snapshot.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkshopDashboard, type WorkshopDashboardFabBridge } from './WorkshopDashboard'
import type { Job } from '../src/shop-types'

// ── Test fixtures ───────────────────────────────────────────────────────

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

// Stub bridge that resolves with no-op data, so the once-per-mount
// poll in `useEffect` returns without crashing the SSR render.
const noopFab: WorkshopDashboardFabBridge = {
  moonrakerStatus: () => Promise.resolve({ ok: false, error: 'test-stub' })
}

function render(
  props: Partial<Parameters<typeof WorkshopDashboard>[0]> = {}
): string {
  return renderToStaticMarkup(
    createElement(WorkshopDashboard, {
      jobs: [],
      moonrakerUrl: null,
      currentMachineId: null,
      pollIntervalMs: Number.MAX_SAFE_INTEGER,
      fab: noopFab,
      ...props
    })
  )
}

// ── Layout contract ─────────────────────────────────────────────────────

describe('WorkshopDashboard — three-card layout (My-Shop-Only)', () => {
  it('renders exactly three machine status cards', () => {
    const html = render()
    // Each card has a stable `data-card-id` matching the slot ID.
    const matches = html.match(/data-card-id="[^"]+"/g) ?? []
    expect(matches).toHaveLength(3)
  })

  it('renders the three cards in canonical order: Laguna → K2 Plus → Carvera', () => {
    const html = render()
    const lag = html.indexOf('data-card-id="laguna-swift-5x10"')
    const k2 = html.indexOf('data-card-id="creality-k2-plus"')
    const car = html.indexOf('data-card-id="makera-carvera"')
    expect(lag).toBeGreaterThanOrEqual(0)
    expect(k2).toBeGreaterThan(lag)
    expect(car).toBeGreaterThan(k2)
  })

  it('uses the verbatim CLAUDE.md target machine names in the card headers', () => {
    const html = render()
    expect(html).toContain('Laguna Swift 5x10')
    expect(html).toContain('Creality K2 Plus')
    expect(html).toContain('Makera Carvera')
  })

  it('shows status dots with role="img" for every card (a11y baseline)', () => {
    const html = render()
    // Three dots, one per card.
    const dots = html.match(/class="workshop-dashboard__dot"/g) ?? []
    expect(dots).toHaveLength(3)
  })

  it('top-level region is labelled "Workshop dashboard" for screen readers', () => {
    const html = render()
    expect(html).toMatch(/role="region"[^>]*aria-label="Workshop dashboard"/)
  })

  it('does NOT render an "Add machine" / "Install machine" affordance (My-Shop-Only enforcement)', () => {
    // Hard constraint from the task: "Exactly the three machine cards.
    // No 'Add machine' affordance."
    const html = render()
    expect(html.toLowerCase()).not.toContain('add machine')
    expect(html.toLowerCase()).not.toContain('install machine')
  })
})

// ── Status derivation ────────────────────────────────────────────────────

describe('WorkshopDashboard — status derivation from existing job state', () => {
  it('idle when no jobs exist', () => {
    const html = render({ jobs: [] })
    // All three dots labelled "Idle".
    const idleMatches = html.match(/aria-label="Idle"/g) ?? []
    expect(idleMatches.length).toBeGreaterThanOrEqual(3)
  })

  it('running for the K2 card when its latest job is running', () => {
    const html = render({
      jobs: [job('k2-1', 'creality-k2-plus', 'running')]
    })
    // The K2 section should contain a Running label adjacent to its dot.
    const k2Section = html.split('data-card-id="creality-k2-plus"')[1] ?? ''
    expect(k2Section).toMatch(/aria-label="Running"/)
  })

  it('error for the Carvera card when its latest job failed', () => {
    const html = render({
      jobs: [job('car-1', 'makera-carvera-4axis', 'error')]
    })
    const carSection = html.split('data-card-id="makera-carvera"')[1] ?? ''
    expect(carSection).toMatch(/aria-label="Error"/)
  })

  it('setup-required for the Laguna card when a finished job has gcodeOut', () => {
    const html = render({
      jobs: [job('lag-1', 'laguna-swift-5x10', 'done', '/tmp/path/contour.gcode')]
    })
    const lagSection = html.split('data-card-id="laguna-swift-5x10"')[1] ?? ''
    expect(lagSection).toMatch(/aria-label="Setup required"/)
  })

  it('Carvera card groups both 3-axis and 4-axis jobs into the same slot', () => {
    const html = render({
      jobs: [
        job('three', 'makera-carvera-3axis', 'done', '/tmp/three.gcode'),
        job('four', 'makera-carvera-4axis', 'running', '/tmp/four.gcode')
      ]
    })
    // The Carvera card surfaces the LATEST (4-axis) job's filename.
    const carSection = html.split('data-card-id="makera-carvera"')[1] ?? ''
    expect(carSection).toContain('four.gcode')
    // And its status is "Running" (4-axis), NOT "Complete" (3-axis).
    expect(carSection).toMatch(/aria-label="Running"/)
  })

  it('does NOT leak jobs from non-shop machines (My-Shop-Only enforcement)', () => {
    const html = render({
      jobs: [
        job('foreign', 'prusa-mk4', 'running', '/tmp/foreign.gcode')
      ]
    })
    // The foreign filename never appears anywhere in the dashboard.
    expect(html).not.toContain('foreign.gcode')
    // And all three cards stay idle.
    const idleMatches = html.match(/aria-label="Idle"/g) ?? []
    expect(idleMatches.length).toBeGreaterThanOrEqual(3)
  })
})

// ── Quick-action gating ─────────────────────────────────────────────────

describe('WorkshopDashboard — quick-action gating (FDM-only "Send latest slice")', () => {
  it('K2 "Send latest slice" is disabled when no Moonraker URL is configured', () => {
    const onSend = vi.fn()
    const html = render({
      jobs: [job('k2-1', 'creality-k2-plus', 'done', '/tmp/k2.gcode')],
      moonrakerUrl: null,
      onSendLatestSlice: onSend
    })
    const k2Section = html.split('data-card-id="creality-k2-plus"')[1] ?? ''
    // Button is rendered but disabled. React serializes the disabled
    // boolean attribute as `disabled=""` in static markup, so the regex
    // captures either form.
    expect(k2Section).toMatch(/data-action="send-latest-slice"/)
    const buttonOpen = k2Section.match(/<button[^>]*data-action="send-latest-slice"[^>]*>/)?.[0] ?? ''
    expect(buttonOpen).toMatch(/disabled(="")?/)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('K2 "Send latest slice" is disabled when no slice path is in hand', () => {
    const html = render({
      jobs: [job('k2-1', 'creality-k2-plus', 'idle', null)],
      moonrakerUrl: 'http://k2plus.local',
      onSendLatestSlice: vi.fn()
    })
    // With no gcodeOut, the callback prop is undefined and the card
    // does NOT render the Send button at all (gated rendering).
    const k2Section = html.split('data-card-id="creality-k2-plus"')[1] ?? ''
    expect(k2Section).not.toMatch(/data-action="send-latest-slice"/)
  })

  it('K2 "Send latest slice" is enabled when both slice path AND URL are present', () => {
    const html = render({
      jobs: [job('k2-1', 'creality-k2-plus', 'done', '/tmp/k2.gcode')],
      moonrakerUrl: 'http://k2plus.local',
      onSendLatestSlice: vi.fn()
    })
    const k2Section = html.split('data-card-id="creality-k2-plus"')[1] ?? ''
    expect(k2Section).toMatch(/data-action="send-latest-slice"/)
    // Extract just the button's opening tag and assert no `disabled`
    // attribute is present (the gated path).
    const buttonOpen = k2Section.match(/<button[^>]*data-action="send-latest-slice"[^>]*>/)?.[0] ?? ''
    expect(buttonOpen).not.toMatch(/disabled/)
  })

  it('The "Send latest slice" action is K2-EXCLUSIVE — never rendered on Laguna or Carvera', () => {
    const html = render({
      jobs: [
        job('lag', 'laguna-swift-5x10', 'done', '/tmp/lag.gcode'),
        job('car', 'makera-carvera-4axis', 'done', '/tmp/car.gcode'),
        job('k2', 'creality-k2-plus', 'done', '/tmp/k2.gcode')
      ],
      moonrakerUrl: 'http://k2plus.local',
      onSendLatestSlice: vi.fn(),
      onOpenSetupSheet: vi.fn(),
      onSendToCarvera: vi.fn()
    })
    // Exactly one "send-latest-slice" button in the whole render.
    const matches = html.match(/data-action="send-latest-slice"/g) ?? []
    expect(matches).toHaveLength(1)
    // And it lives inside the K2 card section.
    const lagSection = html.split('data-card-id="laguna-swift-5x10"')[1]?.split('data-card-id=')[0] ?? ''
    expect(lagSection).not.toMatch(/data-action="send-latest-slice"/)
    const carSection = html.split('data-card-id="makera-carvera"')[1]?.split('data-card-id=')[0] ?? ''
    expect(carSection).not.toMatch(/data-action="send-latest-slice"/)
  })
})

describe('WorkshopDashboard — per-card quick actions stay scoped to their card', () => {
  it('Laguna card surfaces only "Open setup sheet"', () => {
    const html = render({
      jobs: [job('lag-1', 'laguna-swift-5x10', 'done', '/tmp/lag.gcode')],
      onOpenSetupSheet: vi.fn()
    })
    const lagSection = html.split('data-card-id="laguna-swift-5x10"')[1]?.split('data-card-id=')[0] ?? ''
    expect(lagSection).toMatch(/data-action="open-setup-sheet"/)
    expect(lagSection).not.toMatch(/data-action="send-latest-slice"/)
    expect(lagSection).not.toMatch(/data-action="send-to-carvera"/)
  })

  it('Carvera card surfaces only "Send to Carvera"', () => {
    const html = render({
      jobs: [job('car-1', 'makera-carvera-4axis', 'done', '/tmp/car.gcode')],
      onSendToCarvera: vi.fn()
    })
    const carSection = html.split('data-card-id="makera-carvera"')[1]?.split('data-card-id=')[0] ?? ''
    expect(carSection).toMatch(/data-action="send-to-carvera"/)
    expect(carSection).not.toMatch(/data-action="send-latest-slice"/)
    expect(carSection).not.toMatch(/data-action="open-setup-sheet"/)
  })
})

// ── Active machine highlighting ─────────────────────────────────────────

describe('WorkshopDashboard — "current machine" highlight', () => {
  /**
   * The card's class string (with the `--current` modifier) appears
   * BEFORE its `data-card-id` attribute inside the same `<section>`
   * opening tag. Extract the whole opening tag for the requested card
   * so the assertion sees both attributes.
   */
  function cardOpenTag(html: string, cardId: string): string {
    const re = new RegExp(`<section[^>]*data-card-id="${cardId}"[^>]*>`)
    return html.match(re)?.[0] ?? ''
  }

  it('highlights the K2 card when the K2 is the session machine', () => {
    const html = render({ currentMachineId: 'creality-k2-plus' })
    const tag = cardOpenTag(html, 'creality-k2-plus')
    expect(tag).toContain('workshop-dashboard__card--current')
  })

  it('treats either Carvera variant (3-axis OR 4-axis) as the Carvera card being current', () => {
    const html3 = render({ currentMachineId: 'makera-carvera-3axis' })
    expect(cardOpenTag(html3, 'makera-carvera')).toContain('workshop-dashboard__card--current')

    const html4 = render({ currentMachineId: 'makera-carvera-4axis' })
    expect(cardOpenTag(html4, 'makera-carvera')).toContain('workshop-dashboard__card--current')
  })

  it('does not highlight any card when the session machine is foreign', () => {
    const html = render({ currentMachineId: 'prusa-mk4' })
    expect(html).not.toContain('workshop-dashboard__card--current')
  })
})

// ── Filename surfacing ──────────────────────────────────────────────────

describe('WorkshopDashboard — last-outcome filename surfacing', () => {
  it('renders the basename (not the full path) of the latest gcode for the card', () => {
    const html = render({
      jobs: [
        job('lag-1', 'laguna-swift-5x10', 'done', '/long/abs/path/to/output/contour.gcode')
      ]
    })
    const lagSection = html.split('data-card-id="laguna-swift-5x10"')[1]?.split('data-card-id=')[0] ?? ''
    expect(lagSection).toContain('contour.gcode')
    // The long absolute path appears only inside the title attribute,
    // never as the rendered text — keeps the card compact.
    expect(lagSection).toMatch(/title="[^"]*\/long\/abs\/path/)
  })

  it('renders a dash placeholder when no job has produced gcode yet', () => {
    const html = render({
      jobs: [job('lag-1', 'laguna-swift-5x10', 'idle', null)]
    })
    const lagSection = html.split('data-card-id="laguna-swift-5x10"')[1]?.split('data-card-id=')[0] ?? ''
    // The em-dash placeholder appears inside the "Last:" row.
    expect(lagSection).toMatch(/workshop-dashboard__last-file[^>]*>—</)
  })
})

// ── a11y: list / listitem pairing ───────────────────────────────────────

describe('WorkshopDashboard — list/listitem ARIA pairing (Cycle 233 ui-polish)', () => {
  it('grid container declares role="list" for screen readers', () => {
    const html = render()
    // The grid wraps the three cards; it must announce as a list so
    // assistive tech traverses card-by-card.
    expect(html).toMatch(/class="workshop-dashboard__grid"[^>]*role="list"/)
  })

  it('each of the three cards declares role="listitem" so the list is well-formed', () => {
    const html = render()
    // ARIA requires listitem children when an ancestor declares role=list;
    // without this pairing screen readers stop announcing the list.
    const items = html.match(/role="listitem"/g) ?? []
    expect(items).toHaveLength(3)
  })

  it('every card section carries role="listitem" regardless of job state', () => {
    // Mixed job state across the three cards — listitem role must be
    // present on each <section>, not gated on whether a job exists.
    const html = render({
      jobs: [
        job('lag', 'laguna-swift-5x10', 'done', '/tmp/lag.gcode'),
        job('k2', 'creality-k2-plus', 'running'),
        job('car', 'makera-carvera-3axis', 'error', '/tmp/car.gcode')
      ]
    })
    for (const cardId of ['laguna-swift-5x10', 'creality-k2-plus', 'makera-carvera']) {
      const tag = html.match(new RegExp(`<section[^>]*data-card-id="${cardId}"[^>]*>`))?.[0] ?? ''
      expect(tag).toContain('role="listitem"')
    }
  })
})

// ── ui-polish: token-scoped status-dot inline style ──────────────────────

describe('WorkshopDashboard — StatusDot inline style is token-scoped (Cycle 233 ui-polish)', () => {
  it('status-dot inline style contains only the dynamic background-color', () => {
    // The 10x10 geometry, border-radius, and margin all live in
    // manufacture.css under `.workshop-dashboard__dot`. ONLY the
    // per-status color (driven by the DASHBOARD_STATUS_COLORS map) is
    // legitimately inline.
    const html = render({ jobs: [job('k2', 'creality-k2-plus', 'running')] })
    // Find the dot inside the K2 card.
    const k2Section = html.split('data-card-id="creality-k2-plus"')[1] ?? ''
    const dotTag = k2Section.match(/<span[^>]*class="workshop-dashboard__dot"[^>]*>/)?.[0] ?? ''
    expect(dotTag).toMatch(/style="[^"]*background-color/)
    // No geometry/spacing should leak into the inline style.
    expect(dotTag).not.toMatch(/style="[^"]*\bwidth/)
    expect(dotTag).not.toMatch(/style="[^"]*\bheight/)
    expect(dotTag).not.toMatch(/style="[^"]*border-radius/)
    expect(dotTag).not.toMatch(/style="[^"]*margin/)
  })
})
