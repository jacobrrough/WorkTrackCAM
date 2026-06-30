/**
 * MyShopDrawer — reachability + content pins.
 *
 * The drawer (and the `MyShopPanel` it wraps) were mounted NOWHERE before this
 * cycle, despite CLAUDE.md mandating a one-click "My Shop" quick-select that
 * shows ONLY Jacob's three machines + their real-world presets. AppShell now
 * mounts it from the TopBar trigger; these tests prove the drawer renders the
 * mandated surface.
 *
 * Node-env constraint (vitest.config.ts `environment: 'node'`, no jsdom /
 * react-test-renderer per [ID-0225]): we assert via `renderToStaticMarkup`
 * (open/closed markup) + a source-pin on the click-wiring the static render
 * cannot exercise. The launch/install *dispatch* logic is unit-tested on the
 * pure `composePresetLaunchPlan` seam (preset-launch-plan.test.ts) that
 * AppShell wires this drawer to.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MyShopDrawer } from './MyShopDrawer'
import type { MachineProfile } from '../../shared/machine-schema'
import { MY_SHOP_MACHINE_IDS, MY_SHOP_PRESETS } from '../src/environments/my-shop-presets'

const SRC = readFileSync(join(__dirname, 'MyShopDrawer.tsx'), 'utf-8')

// Minimal MachineProfile fixture — mirrors the env-routing / my-shop-presets
// fixture helpers so the suites stay in lock-step.
function fakeMachine(id: string, overrides: Partial<MachineProfile> = {}): MachineProfile {
  return {
    id,
    name: id,
    kind: 'cnc',
    workAreaMm: { x: 100, y: 100, z: 100 },
    maxFeedMmMin: 1000,
    postTemplate: 'cnc_generic_mm.hbs',
    dialect: 'generic_mm',
    ...overrides
  }
}

function render(props: Partial<Parameters<typeof MyShopDrawer>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(MyShopDrawer, {
      open: true,
      onClose: () => {},
      machines: MY_SHOP_MACHINE_IDS.map((id) => fakeMachine(id)),
      currentMachineId: null,
      onLaunchPreset: () => {},
      onInstallMachine: () => {},
      ...props
    })
  )
}

describe('MyShopDrawer', () => {
  it('renders nothing when closed', () => {
    const html = render({ open: false })
    expect(html).toBe('')
  })

  it('renders the My Shop dialog chrome when open', () => {
    const html = render()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="My Shop"')
    expect(html).toContain('drawer--right')
    expect(html).toContain('My Shop')
  })

  it('renders exactly the three target-machine cards (My-Shop-Only scope)', () => {
    const html = render()
    for (const id of MY_SHOP_MACHINE_IDS) {
      expect(html).toContain(`data-machine-id="${id}"`)
    }
    // Locked to three — no fourth bay leaks in. `data-machine-id` is the
    // per-card root marker (one per <section>), so it counts cards exactly
    // (unlike the `my-shop-card__*` BEM child classes).
    const cardCount = (html.match(/data-machine-id="/g) ?? []).length
    expect(cardCount).toBe(MY_SHOP_MACHINE_IDS.length)
  })

  it('renders every real-world preset button by its stable id', () => {
    const html = render()
    for (const preset of MY_SHOP_PRESETS) {
      expect(html).toContain(`data-preset-id="${preset.id}"`)
    }
  })

  it('shows the uninstalled affordance for a target machine that is not installed', () => {
    // Only the K2 installed → the other two render their "Install" affordance.
    const html = render({ machines: [fakeMachine('creality-k2-plus', { kind: 'fdm' })] })
    expect(html).toContain('my-shop-card--uninstalled')
    expect(html).toContain('Install laguna-swift-5x10')
    expect(html).toContain('Install makera-carvera-4axis')
  })

  it('highlights the active machine card', () => {
    const html = render({ currentMachineId: 'creality-k2-plus' })
    expect(html).toContain('my-shop-card--current')
    expect(html).toContain('>Active<')
  })

  it('keeps explicit type="button" on every drawer button (no submit footgun)', () => {
    const html = render()
    expect(html).not.toMatch(/<button(?![^>]*type=)/)
  })

  it('wires launch + install through onClose so picking a preset closes the drawer', () => {
    // Source-pin (node-env cannot dispatch a real click): the drawer composes
    // the parent callback WITH its own onClose so the overlay dismisses after a
    // selection — the "brand-bar control" UX the module header promises.
    expect(SRC).toContain('onLaunchPreset(preset)')
    expect(SRC).toContain('onInstallMachine(machineId)')
    expect(SRC).toContain('const handleLaunchPreset = (preset: MyShopPreset): void => {')
    expect(SRC).toContain('onClose()')
    // The panel receives the WRAPPED handlers, not the raw parent props.
    expect(SRC).toContain('onLaunchPreset={handleLaunchPreset}')
    expect(SRC).toContain('onInstallMachine={handleInstallMachine}')
  })
})
