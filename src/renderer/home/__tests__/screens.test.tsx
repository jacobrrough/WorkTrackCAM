/**
 * Node-env render pins for the five shop-relevant app screens (Files, Templates,
 * Machine, Jobs, Settings). Structure + key content from the handoff; interactive
 * behaviour is covered by `screens.dom.spec.tsx`.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FilesScreen } from '../screens/FilesScreen'
import { TemplatesScreen } from '../screens/TemplatesScreen'
import { MachineScreen } from '../screens/MachineScreen'
import { JobsScreen } from '../screens/JobsScreen'
import { SettingsScreen } from '../screens/SettingsScreen'

describe('FilesScreen', () => {
  const html = renderToStaticMarkup(createElement(FilesScreen))
  it('renders the folder rail, storage card and breadcrumb', () => {
    expect(html).toContain('Library')
    expect(html).toContain('All files')
    expect(html).toContain('Production')
    expect(html).toContain('Storage')
    expect(html).toContain('31.0 / 50 GB')
    expect(html).toContain('bracket-mount')
  })
  it('renders the file table with headers, rows and the primary Upload action', () => {
    for (const h of ['Name', 'Type', 'Modified', 'Size', 'Owner']) expect(html).toContain(`>${h}</span>`)
    expect(html).toContain('bracket-mount.wtc')
    expect(html).toContain('drawing-v2.pdf')
    expect(html.match(/ds-btn-primary/g)?.length).toBe(1) // Upload
  })
})

describe('TemplatesScreen', () => {
  const html = renderToStaticMarkup(createElement(TemplatesScreen, { onEnterWorkspace: () => {} }))
  it('renders the category chips and template cards', () => {
    for (const c of ['All', 'Enclosures', 'Brackets', 'Gears']) expect(html).toContain(c)
    expect(html).toContain('Parametric Enclosure')
    expect(html).toContain('Snap-fit, adjustable walls')
    expect(html.match(/Use template/g)?.length).toBe(8)
  })
})

describe('MachineScreen', () => {
  const html = renderToStaticMarkup(createElement(MachineScreen))
  it('renders identity, telemetry, position, controls and maintenance', () => {
    expect(html).toContain('Carvera')
    expect(html).toContain('Online · Cutting')
    expect(html).toContain('Spindle')
    expect(html).toContain('15000')
    expect(html).toContain('mm/min')
    expect(html).toContain('X 42.180')
    expect(html).toContain('Controls')
    expect(html).toContain('Probe')
    expect(html).toContain('Run calibration')
    expect(html).toContain('Now cutting')
    expect(html).toContain('USB-C')
  })
})

describe('JobsScreen', () => {
  const html = renderToStaticMarkup(createElement(JobsScreen))
  it('puts the running job in the single accent PrimaryCard and shows the queue by default', () => {
    expect(html.match(/ds-primary-card/g)?.length).toBe(1)
    expect(html).toContain('Running now')
    expect(html).toContain('bracket-mount.nc')
    expect(html).toContain('6061 Aluminum · T3 ⌀6')
    expect(html).toContain('Queue')
    expect(html).toContain('History')
    expect(html).toContain('enclosure-lid.nc') // queue is the default tab
  })
})

describe('SettingsScreen', () => {
  const html = renderToStaticMarkup(createElement(SettingsScreen))
  it('renders the Units & display + Appearance prefs', () => {
    expect(html).toContain('Units')
    expect(html).toContain('Coordinate readout')
    expect(html).toContain('Decimal places')
    expect(html).toContain('Millimeters')
    expect(html).toContain('Inches')
    expect(html).toContain('Appearance')
    expect(html).toContain('Theme')
    expect(html).toContain('Accent')
    expect(html).toContain('wt-set__toggle is-on') // coordinate readout defaults on
  })
})
