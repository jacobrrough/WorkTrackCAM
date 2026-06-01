import { describe, expect, it } from 'vitest'
import { COMMON_POST_TEMPLATE_FILENAMES } from './machine-post-template-hints'

describe('machine-post-template-hints', () => {
  it('exports COMMON_POST_TEMPLATE_FILENAMES as a non-empty readonly array', () => {
    expect(Array.isArray(COMMON_POST_TEMPLATE_FILENAMES)).toBe(true)
    expect(COMMON_POST_TEMPLATE_FILENAMES.length).toBeGreaterThan(0)
  })

  it('every entry ends with .hbs', () => {
    for (const filename of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(filename).toMatch(/\.hbs$/)
    }
  })

  it('every entry is a non-empty string', () => {
    for (const filename of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(typeof filename).toBe('string')
      expect(filename.length).toBeGreaterThan(0)
    }
  })

  it('includes the generic mm post template', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('cnc_generic_mm.hbs')
  })

  it('includes 4-axis GRBL/Carvera fallback template (renamed from cnc_4axis_grbl in pre-launch rank-16)', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('carvera_4axis_grbl.hbs')
  })

  it('contains no 5-axis templates (June 2026 My-Shop-Only enforcement)', () => {
    // None of the three target shops own a 5-axis machine, so the speculative
    // 5-axis Fanuc / Siemens fallbacks were removed.
    const fiveAxis = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.includes('5axis'))
    expect(fiveAxis.length).toBe(0)
  })

  it('has no duplicate entries', () => {
    const unique = new Set(COMMON_POST_TEMPLATE_FILENAMES)
    expect(unique.size).toBe(COMMON_POST_TEMPLATE_FILENAMES.length)
  })

  it('all entries match expected naming pattern (cnc_*, carvera_*, vcarve_*, fdm_*)', () => {
    for (const filename of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(filename).toMatch(/^(cnc_|carvera_|vcarve_|fdm_)/)
    }
  })

  it('includes the VCarve Pro environment post', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('vcarve_mach3.hbs')
  })

  it('includes the Creality Print passthrough post', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('fdm_passthrough.hbs')
  })

  it('includes both Carvera (Makera CAM) post templates', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('carvera_3axis.hbs')
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('carvera_4axis.hbs')
  })
})
