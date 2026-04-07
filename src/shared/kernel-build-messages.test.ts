import { describe, expect, it } from 'vitest'
import { LOFT_MAX_PROFILES } from './sketch-profile'
import { formatKernelBuildStatus, kernelBuildDetailGuidance } from './kernel-build-messages'

describe('formatKernelBuildStatus', () => {
  it('maps known payload guard codes to readable text', () => {
    expect(formatKernelBuildStatus('invalid_extrude_depth_mm')).toMatch(/finite|positive|mm/i)
    expect(formatKernelBuildStatus('invalid_loft_separation_mm')).toMatch(/loft|spacing/i)
    expect(formatKernelBuildStatus('invalid_revolve_params')).toMatch(/revolve/i)
  })

  it('appends detail when provided', () => {
    const s = formatKernelBuildStatus('invalid_payload', "postSolidOps[0] kind='fillet_all': …")
    expect(s).toContain('validation')
    expect(s).toContain('postSolidOps')
  })

  it('falls back for unknown codes', () => {
    expect(formatKernelBuildStatus('some_future_code')).toContain('some_future_code')
  })

  it('mentions loft profile cap from LOFT_MAX_PROFILES', () => {
    const s = formatKernelBuildStatus('loft_too_many_profiles')
    expect(s).toContain(String(LOFT_MAX_PROFILES))
  })

  it('appends guidance for profile index errors', () => {
    expect(kernelBuildDetailGuidance('profileIndex out of range: 3')).toMatch(/0-based|indices/i)
    const s = formatKernelBuildStatus('build_failed', 'profileIndex out of range: 3')
    expect(s).toContain('profileIndex out of range')
    expect(s).toMatch(/Tip:/i)
  })
})
