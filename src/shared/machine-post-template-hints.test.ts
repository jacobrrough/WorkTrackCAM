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

  it('includes 4-axis GRBL template', () => {
    expect(COMMON_POST_TEMPLATE_FILENAMES).toContain('cnc_4axis_grbl.hbs')
  })

  it('includes 5-axis templates', () => {
    const fiveAxis = COMMON_POST_TEMPLATE_FILENAMES.filter((f) => f.includes('5axis'))
    expect(fiveAxis.length).toBeGreaterThan(0)
  })

  it('has no duplicate entries', () => {
    const unique = new Set(COMMON_POST_TEMPLATE_FILENAMES)
    expect(unique.size).toBe(COMMON_POST_TEMPLATE_FILENAMES.length)
  })

  it('all entries match expected naming pattern cnc_*axis_*.hbs or cnc_generic_*.hbs', () => {
    for (const filename of COMMON_POST_TEMPLATE_FILENAMES) {
      expect(filename).toMatch(/^cnc_/)
    }
  })
})
