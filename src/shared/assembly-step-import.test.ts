import { describe, expect, it } from 'vitest'
import {
  STEP_IMPORT_EXTENSIONS,
  STEP_IMPORT_MAX_BYTES,
  bboxDimensions,
  buildStepImportPart,
  isExternalStepSource,
  stepImportPartName,
  stepImportSourceIsDangling,
  validateStepImportPath,
  type StepImportBridge,
  type StepImportBridgeImportResult,
  type StepImportBridgeTessellateResult
} from './assembly-step-import'
import { assemblyGeometrySourceSchema } from './assembly-schema'

// ── Path validation matrix ─────────────────────────────────────────────────

describe('validateStepImportPath — matrix', () => {
  it('accepts a .step and a .stp path (case-insensitive)', () => {
    expect(validateStepImportPath('C:/vendor/M6-bolt.step')).toMatchObject({ ok: true, ext: '.step' })
    expect(validateStepImportPath('/lib/motor.STP')).toMatchObject({ ok: true, ext: '.stp' })
    expect(validateStepImportPath('bracket.Step')).toMatchObject({ ok: true, ext: '.step' })
  })

  it('rejects an empty / non-string path', () => {
    expect(validateStepImportPath('')).toMatchObject({ ok: false, reason: 'empty_path' })
    expect(validateStepImportPath('   ')).toMatchObject({ ok: false, reason: 'empty_path' })
    expect(validateStepImportPath(undefined)).toMatchObject({ ok: false, reason: 'empty_path' })
    expect(validateStepImportPath(42)).toMatchObject({ ok: false, reason: 'empty_path' })
  })

  it('rejects a null byte before any other check', () => {
    expect(validateStepImportPath('C:/vendor/evil\0.step')).toMatchObject({
      ok: false,
      reason: 'null_byte'
    })
  })

  it('rejects a wrong extension', () => {
    expect(validateStepImportPath('C:/vendor/mesh.stl')).toMatchObject({
      ok: false,
      reason: 'bad_extension'
    })
    expect(validateStepImportPath('C:/vendor/model.iges')).toMatchObject({
      ok: false,
      reason: 'bad_extension'
    })
    expect(validateStepImportPath('C:/vendor/noext')).toMatchObject({
      ok: false,
      reason: 'bad_extension'
    })
    // A path that merely CONTAINS ".step" mid-name but ends elsewhere.
    expect(validateStepImportPath('C:/vendor/part.step.bak')).toMatchObject({
      ok: false,
      reason: 'bad_extension'
    })
  })

  it('rejects ".." traversal segments (both separators)', () => {
    expect(validateStepImportPath('C:/vendor/../../etc/passwd.step')).toMatchObject({
      ok: false,
      reason: 'path_traversal'
    })
    expect(validateStepImportPath('..\\..\\secret.stp')).toMatchObject({
      ok: false,
      reason: 'path_traversal'
    })
  })

  it('enforces the size cap only when sizeBytes is supplied', () => {
    const good = 'C:/vendor/small.step'
    // No sizeBytes → lexical-only pass.
    expect(validateStepImportPath(good)).toMatchObject({ ok: true })
    // At the cap → still ok.
    expect(validateStepImportPath(good, STEP_IMPORT_MAX_BYTES)).toMatchObject({ ok: true })
    // Over the cap → rejected.
    expect(validateStepImportPath(good, STEP_IMPORT_MAX_BYTES + 1)).toMatchObject({
      ok: false,
      reason: 'file_too_large'
    })
    // A non-finite / negative size is treated as too-large (defensive).
    expect(validateStepImportPath(good, Number.NaN)).toMatchObject({
      ok: false,
      reason: 'file_too_large'
    })
    expect(validateStepImportPath(good, -1)).toMatchObject({ ok: false, reason: 'file_too_large' })
  })

  it('exposes the extension whitelist + a positive cap', () => {
    expect(STEP_IMPORT_EXTENSIONS).toEqual(['.step', '.stp'])
    expect(STEP_IMPORT_MAX_BYTES).toBeGreaterThan(0)
  })
})

// ── Filename → part name ────────────────────────────────────────────────────

describe('stepImportPartName', () => {
  it('strips directory + extension', () => {
    expect(stepImportPartName('C:/vendor/M6-bolt.step')).toBe('M6-bolt')
    expect(stepImportPartName('/lib/nema17.STP')).toBe('nema17')
    expect(stepImportPartName('bracket.stp')).toBe('bracket')
  })

  it('falls back to a non-empty default', () => {
    expect(stepImportPartName('.step')).toBe('Imported part')
    expect(stepImportPartName('C:/vendor/')).toBe('Imported part')
  })
})

// ── bboxDimensions ──────────────────────────────────────────────────────────

describe('bboxDimensions', () => {
  it('computes max - min per axis', () => {
    expect(bboxDimensions({ min: [-5, -1, 0], max: [5, 1, 10] })).toEqual([10, 2, 10])
  })
})

// ── buildStepImportPart against a mock bridge ───────────────────────────────

const OK_IMPORT: StepImportBridgeImportResult = {
  handle: 'step:abc123',
  bbox: { min: [-5, -5, -5], max: [5, 5, 5] }
}

const OK_TESS: StepImportBridgeTessellateResult = {
  vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
  faceIds: [0],
  triangleCount: 1,
  bbox: { min: [-5, -5, -5], max: [5, 5, 5] }
}

function mockBridge(over: Partial<StepImportBridge> = {}): StepImportBridge {
  return {
    importStep: async () => OK_IMPORT,
    tessellateWithIds: async () => OK_TESS,
    ...over
  }
}

describe('buildStepImportPart — happy path', () => {
  it('produces an AssemblyPart-shaped result with a durable external-STEP source', async () => {
    const out = await buildStepImportPart('C:/vendor/M6-bolt.step', 'row-1', mockBridge())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const r = out.result
    expect(r.id).toBe('row-1')
    expect(r.name).toBe('M6-bolt')
    expect(r.handle).toBe('step:abc123')
    // Durable geometry source records the external file + cached bounds.
    expect(r.geometrySource.kind).toBe('step')
    expect(r.geometrySource.stepPath).toBe('C:/vendor/M6-bolt.step')
    expect(r.geometrySource.handle).toBe('step:abc123')
    expect(r.geometrySource.cachedBounds).toEqual({ min: [-5, -5, -5], max: [5, 5, 5] })
    expect(r.geometrySource.cachedDims).toEqual([10, 10, 10])
    // Mesh for the viewport / interference.
    expect(r.mesh.vertices).toEqual(OK_TESS.vertices)
    expect(r.mesh.indices).toEqual(OK_TESS.indices)
    expect(r.mesh.faceIds).toEqual([0])
    expect(r.mesh.triangleCount).toBe(1)
    expect(r.mesh.bbox).toEqual(OK_TESS.bbox)
  })

  it('the produced geometrySource round-trips through the assembly schema', async () => {
    const out = await buildStepImportPart('C:/vendor/motor.step', 'row-2', mockBridge())
    expect(out.ok).toBe(true)
    if (!out.ok) return
    // The durable source must parse under the real schema (proves the additive
    // variant is valid + that a persisted row would round-trip).
    const parsed = assemblyGeometrySourceSchema.parse(out.result.geometrySource)
    expect(parsed.kind).toBe('step')
    expect(parsed.stepPath).toBe('C:/vendor/motor.step')
  })

  it('derives triangleCount from indices when the tessellator omits it', async () => {
    const out = await buildStepImportPart(
      'C:/vendor/x.step',
      'row-3',
      mockBridge({
        tessellateWithIds: async () =>
          ({ ...OK_TESS, triangleCount: Number.NaN, indices: [0, 1, 2, 3, 4, 5] } as StepImportBridgeTessellateResult)
      })
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.mesh.triangleCount).toBe(2)
  })

  it('falls back to the import bbox when the tessellation bbox is non-finite', async () => {
    const out = await buildStepImportPart(
      'C:/vendor/x.step',
      'row-4',
      mockBridge({
        tessellateWithIds: async () =>
          ({ ...OK_TESS, bbox: { min: [Number.NaN, 0, 0], max: [1, 1, 1] } } as StepImportBridgeTessellateResult)
      })
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.mesh.bbox).toEqual(OK_IMPORT.bbox)
    expect(out.result.geometrySource.cachedBounds).toEqual({ min: [-5, -5, -5], max: [5, 5, 5] })
  })
})

describe('buildStepImportPart — failure paths (never throws)', () => {
  it('folds an import rejection into an error envelope, preferring sidecarCode', async () => {
    const out = await buildStepImportPart(
      'C:/vendor/bad.step',
      'row-5',
      mockBridge({
        importStep: async () => {
          throw { sidecarCode: 'step_read_error', message: 'malformed STEP' }
        }
      })
    )
    expect(out).toEqual({ ok: false, error: 'step_read_error', hint: 'malformed STEP' })
  })

  it('folds a tessellate rejection into an error envelope', async () => {
    const out = await buildStepImportPart(
      'C:/vendor/x.step',
      'row-6',
      mockBridge({
        tessellateWithIds: async () => {
          throw { sidecarCode: 'tessellation_error', message: 'OCP raised' }
        }
      })
    )
    expect(out).toEqual({ ok: false, error: 'tessellation_error', hint: 'OCP raised' })
  })

  it('uses fallback error/hint when the rejection carries no sidecarCode', async () => {
    const out = await buildStepImportPart(
      'C:/vendor/x.step',
      'row-7',
      mockBridge({
        importStep: async () => {
          throw new Error('spawn ENOENT')
        }
      })
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toBe('step_import_failed')
    expect(out.hint).toBe('spawn ENOENT')
  })

  it('rejects a bad import response (empty handle)', async () => {
    const out = await buildStepImportPart(
      'C:/vendor/x.step',
      'row-8',
      mockBridge({
        importStep: async () => ({ handle: '', bbox: OK_IMPORT.bbox })
      })
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toBe('step_import_bad_response')
  })

  it('rejects a malformed tessellate response', async () => {
    const out = await buildStepImportPart(
      'C:/vendor/x.step',
      'row-9',
      mockBridge({
        tessellateWithIds: async () => ({ vertices: null } as unknown as StepImportBridgeTessellateResult)
      })
    )
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error).toBe('step_tessellate_bad_response')
  })
})

// ── Hydrate honesty ─────────────────────────────────────────────────────────

describe('isExternalStepSource', () => {
  it('detects a source by kind or by stepPath', () => {
    expect(isExternalStepSource({ kind: 'step', stepPath: '/a.step' })).toBe(true)
    expect(isExternalStepSource({ stepPath: '/a.step' })).toBe(true)
    expect(isExternalStepSource({ handle: 'step:x' })).toBe(false)
    expect(isExternalStepSource({ designModelId: 'dm-1' })).toBe(false)
    expect(isExternalStepSource(undefined)).toBe(false)
  })
})

describe('stepImportSourceIsDangling', () => {
  it('is true for an external source whose file is missing', () => {
    expect(stepImportSourceIsDangling({ kind: 'step', stepPath: '/gone.step' }, false)).toBe(true)
  })

  it('is false for an external source whose file exists', () => {
    expect(stepImportSourceIsDangling({ kind: 'step', stepPath: '/here.step' }, true)).toBe(false)
  })

  it('is false for a non-external (internal) source regardless of fileExists', () => {
    expect(stepImportSourceIsDangling({ handle: 'step:x' }, false)).toBe(false)
    expect(stepImportSourceIsDangling({ designModelId: 'dm' }, false)).toBe(false)
    expect(stepImportSourceIsDangling(undefined, false)).toBe(false)
  })

  it('is true for a kind:step source with a missing stepPath (can never resolve)', () => {
    // stepPath omitted but kind marks it external → dangling.
    expect(stepImportSourceIsDangling({ kind: 'step', handle: 'step:x' }, true)).toBe(true)
  })
})
