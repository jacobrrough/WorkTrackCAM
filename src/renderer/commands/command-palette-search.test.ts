import { describe, expect, it } from 'vitest'
import { FUSION_STYLE_COMMAND_CATALOG } from '../../shared/fusion-style-command-catalog'
import { orderRowsByRecent, rowMatchesPaletteQuery } from './command-palette-search'

describe('command-palette-search', () => {
  it('rowMatchesPaletteQuery matches alias pdf to export command', () => {
    const row = FUSION_STYLE_COMMAND_CATALOG.find((c) => c.id === 'dr_export_pdf')!
    expect(rowMatchesPaletteQuery(row, 'pdf')).toBe(true)
  })

  it('orderRowsByRecent promotes recent ids when search empty', () => {
    const a = FUSION_STYLE_COMMAND_CATALOG.find((c) => c.id === 'ut_measure')!
    const b = FUSION_STYLE_COMMAND_CATALOG.find((c) => c.id === 'ut_section')!
    const c = FUSION_STYLE_COMMAND_CATALOG.find((x) => x.id === 'ut_command_palette')!
    const ordered = orderRowsByRecent([a, b, c], ['ut_section', 'ut_measure'], true)
    expect(ordered.map((x) => x.id)).toEqual(['ut_section', 'ut_measure', 'ut_command_palette'])
  })

  it('rowMatchesPaletteQuery supports multi-token matching', () => {
    const row = FUSION_STYLE_COMMAND_CATALOG.find((c) => c.id === 'ut_command_palette')!
    expect(rowMatchesPaletteQuery(row, 'command palette')).toBe(true)
  })

  it('rowMatchesPaletteQuery supports tokenized aliases', () => {
    const row = FUSION_STYLE_COMMAND_CATALOG.find((c) => c.id === 'ut_open')!
    expect(rowMatchesPaletteQuery(row, 'open project')).toBe(true)
  })
})
