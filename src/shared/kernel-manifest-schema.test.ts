import { describe, expect, it } from 'vitest'
import {
  emptyKernelManifest,
  kernelManifestSchema,
  type KernelManifest
} from './kernel-manifest-schema'

describe('kernel-manifest-schema', () => {
  it('parses minimal valid manifest', () => {
    const input: KernelManifest = {
      version: 1,
      builtAt: '2025-01-01T00:00:00.000Z',
      ok: true
    }
    const r = kernelManifestSchema.safeParse(input)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data).toEqual(input)
  })

  it('parses manifest with optional fields', () => {
    const input = {
      version: 1 as const,
      builtAt: '2025-01-01T00:00:00.000Z',
      ok: false,
      error: 'build_failed',
      detail: 'trace',
      stepPath: 'part/out.step',
      stlPath: 'part/out.stl',
      solidKind: 'loft' as const,
      profileCount: 2,
      payloadVersion: 3 as const,
      postSolidOpCount: 1,
      sketchPlaneKind: 'datum' as const,
      sketchPlaneDatum: 'XZ' as const,
      placementParity: 'ok' as const,
      placementParityDetail: 'max delta 0.030 mm',
      placementParityMaxDeltaMm: 0.03,
      designHash: 'abc'.repeat(10),
      loftStrategy: 'smooth+align',
      userHint: 'Tip: check profile indices.',
      splitKeepHalfspace: { axis: 'X' as const, offsetMm: 0, keep: 'positive' as const },
      splitDiscardedStepPath: 'out/kernel-part-split-discard.step',
      splitDiscardedStlPath: 'out/kernel-part-split-discard.stl',
      loftGuideRailsKernelMode: 'sketch_xy_align' as const,
      inspectBackend: 'kernel_stl_tessellation' as const,
      stlMeshAngularToleranceDeg: 0.25
    }
    const r = kernelManifestSchema.safeParse(input)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data).toEqual(input)
  })

  it('rejects wrong version literal', () => {
    const r = kernelManifestSchema.safeParse({
      version: 2,
      builtAt: 'x',
      ok: true
    })
    expect(r.success).toBe(false)
  })

  it('rejects invalid solidKind', () => {
    const r = kernelManifestSchema.safeParse({
      version: 1,
      builtAt: 'x',
      ok: true,
      solidKind: 'sweep'
    })
    expect(r.success).toBe(false)
  })

  it('accepts payloadVersion 4 and rejects invalid payloadVersion', () => {
    expect(
      kernelManifestSchema.safeParse({
        version: 1,
        builtAt: 'x',
        ok: true,
        payloadVersion: 4
      }).success
    ).toBe(true)
    const r = kernelManifestSchema.safeParse({
      version: 1,
      builtAt: 'x',
      ok: true,
      payloadVersion: 5
    })
    expect(r.success).toBe(false)
  })

  it('rejects invalid sketchPlaneDatum', () => {
    const r = kernelManifestSchema.safeParse({
      version: 1,
      builtAt: 'x',
      ok: true,
      sketchPlaneKind: 'datum',
      sketchPlaneDatum: 'AB'
    })
    expect(r.success).toBe(false)
  })

  it('trims stepPath, stlPath, and loftStrategy', () => {
    const r = kernelManifestSchema.safeParse({
      version: 1,
      builtAt: 'x',
      ok: true,
      stepPath: '  part/out.step  ',
      stlPath: '  part/out.stl  ',
      loftStrategy: '  smooth+align  '
    })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.stepPath).toBe('part/out.step')
    expect(r.data.stlPath).toBe('part/out.stl')
    expect(r.data.loftStrategy).toBe('smooth+align')
  })

  it('rejects empty or whitespace-only artifact paths', () => {
    expect(
      kernelManifestSchema.safeParse({
        version: 1,
        builtAt: 'x',
        ok: true,
        stepPath: '   '
      }).success
    ).toBe(false)
  })

  it('emptyKernelManifest parses and marks never_built', () => {
    const m = emptyKernelManifest()
    const r = kernelManifestSchema.safeParse(m)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.version).toBe(1)
    expect(r.data.ok).toBe(false)
    expect(r.data.error).toBe('never_built')
    expect(typeof r.data.builtAt).toBe('string')
  })
})
