import { describe, expect, it } from 'vitest'
import { emptyDesign } from './design-schema'
import { defaultPartFeatures } from './part-features-schema'
import {
  kernelDesignHashPayload,
  kernelFeaturesHashPayload,
  kernelInspectStaleReason,
  parseKernelManifestJson
} from './kernel-inspect-hash'

describe('kernel-inspect-hash', () => {
  it('kernelDesignHashPayload is stable for empty design', () => {
    const a = kernelDesignHashPayload(emptyDesign())
    const b = kernelDesignHashPayload(emptyDesign())
    expect(a).toBe(b)
    expect(a.length).toBeGreaterThan(10)
  })

  it('kernelFeaturesHashPayload empty for null features', () => {
    expect(kernelFeaturesHashPayload(null)).toBe('')
  })

  it('kernelFeaturesHashPayload canonicalizes default part features', () => {
    const p = kernelFeaturesHashPayload(defaultPartFeatures())
    expect(p.length).toBeGreaterThan(2)
  })

  it('kernelInspectStaleReason detects design drift', () => {
    const manifest = parseKernelManifestJson({
      version: 1,
      builtAt: 'x',
      ok: true,
      designHash: 'aa',
      featuresHash: 'bb'
    })
    expect(manifest).not.toBeNull()
    expect(
      kernelInspectStaleReason({
        manifest,
        designHash: 'cc',
        featuresHash: 'bb'
      })
    ).toBe('design_changed')
    expect(
      kernelInspectStaleReason({
        manifest,
        designHash: 'aa',
        featuresHash: 'dd'
      })
    ).toBe('features_changed')
    expect(
      kernelInspectStaleReason({
        manifest,
        designHash: 'aa',
        featuresHash: 'bb'
      })
    ).toBeNull()
  })

  it('legacy manifest without featuresHash does not flag features_changed', () => {
    const manifest = parseKernelManifestJson({
      version: 1,
      builtAt: 'x',
      ok: true,
      designHash: 'aa'
    })
    expect(
      kernelInspectStaleReason({
        manifest,
        designHash: 'aa',
        featuresHash: 'anything'
      })
    ).toBeNull()
  })
})
