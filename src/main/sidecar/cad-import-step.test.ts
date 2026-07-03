/**
 * Paired-pin contract test for the sidecar `cad.import_step` and
 * `cad.tessellate` handlers.
 *
 * Covers two axes (mirroring `cam-run-toolpath.test.ts`):
 *   A. Protocol shape — the wire types in
 *      ``src/shared/sidecar-protocol.ts`` MUST agree with the param /
 *      error vocabulary the Python handler implements. Any drift between
 *      ``CadImportStepParams`` / ``CadTessellateParams`` and the Python
 *      validation produces a wire-contract break.
 *   B. Behavior — round-tripping a `cad.import_step` request against the
 *      real sidecar process produces either:
 *        - a structured success envelope with a handle + bbox (when
 *          CadQuery is installed in the Python env), OR
 *        - a structured `cadquery_not_installed` error envelope (when it
 *          isn't — typical for Python 3.14 sandboxes where no wheel exists).
 *      Both are acceptable; the renderer falls back to the legacy
 *      ``engines/occt/step_to_stl.py`` subprocess path in the second case.
 *
 * Safety Rule 1 (G-code is sacred): when CadQuery IS installed, this test
 * additionally tessellates the imported solid to a binary STL and asserts
 * the file is well-formed (80-byte header, uint32 count, 50-byte per
 * triangle) — that STL feeds OCL drop/waterline downstream and a bad
 * header would crash STLReader.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type {
  CadImportStepParams,
  CadImportStepResult,
  CadTessellateParams,
  CadTessellateResult,
} from '../../shared/sidecar-protocol'
import { PythonBridge } from './python-bridge'
import {
  buildStepImportPart,
  type StepImportBridge,
} from '../../shared/assembly-step-import'

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')

function detectPython(): string | null {
  for (const candidate of ['python', 'python3']) {
    const r = spawnSync(candidate, ['--version'])
    if (r.status === 0) return candidate
  }
  return null
}

const PYTHON = detectPython()
const describeIfPython = PYTHON ? describe : describe.skip

// ── A. Wire-contract: TS types vs. Python handler exports ────────────────

describe('cad.import_step / cad.tessellate — protocol shape (paired pin)', () => {
  it('engines/sidecar/cad_handlers.py registers both handler names', () => {
    const py = readFileSync(
      resolve(PROJECT_ROOT, 'engines', 'sidecar', 'cad_handlers.py'),
      'utf-8'
    )
    expect(py).toContain('"import_step": import_step')
    expect(py).toContain('"tessellate": tessellate')
  })

  it('engines/sidecar/cad_handlers.py delegates to engines/cad/cadquery_import.py', () => {
    // Pin: handler MUST go through the shared core so the import + write
    // numerics live in one place (mirror of the CAM sidecar / subprocess
    // sharing ``ocl_strategies.py``).
    const py = readFileSync(
      resolve(PROJECT_ROOT, 'engines', 'sidecar', 'cad_handlers.py'),
      'utf-8'
    )
    expect(py).toContain('import_step_file')
    expect(py).toContain('tessellate_body')
  })

  it('engines/cad/cadquery_import.py exposes the documented error codes', () => {
    // Pin: the operator-facing error vocabulary must be present in the
    // source. The TS bridge does substring matching on these codes in
    // ``occt-import.ts`` style fallback paths.
    const py = readFileSync(
      resolve(PROJECT_ROOT, 'engines', 'cad', 'cadquery_import.py'),
      'utf-8'
    )
    for (const code of [
      'cadquery_not_installed',
      'step_file_missing',
      'step_read_error',
      'invalid_handle',
      'tessellation_error',
      'stl_write_error',
    ]) {
      expect(py).toContain(`"${code}"`)
    }
  })

  it('CadImportStepParams + CadTessellateParams keys match Python validation', () => {
    // Construct a value of each wire type — this is a compile-time check
    // that the TS shape still has the keys the Python side expects.
    const importParams: CadImportStepParams = { path: '/tmp/x.step' }
    const tessParams: CadTessellateParams = {
      handle: 'step:abc',
      outPath: '/tmp/x.stl',
      toleranceMm: 0.1,
    }
    expect(Object.keys(importParams)).toEqual(['path'])
    expect(Object.keys(tessParams).sort()).toEqual(
      ['handle', 'outPath', 'toleranceMm'].sort()
    )
  })
})

// ── B. Behavior: real sidecar round-trip ─────────────────────────────────

describeIfPython('cad.import_step — sidecar end-to-end behavior', () => {
  beforeAll(() => {
    if (!PYTHON) return
    const probe = spawnSync(PYTHON, ['-c', 'import engines.sidecar.cad_handlers'], {
      cwd: PROJECT_ROOT,
    })
    if (probe.status !== 0) {
      throw new Error(
        `cad_handlers import probe failed (exit ${probe.status}): ${probe.stderr.toString()}`
      )
    }
  })

  it('rejects empty path with bad_params error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.call('cad.import_step', { path: '' })
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'bad_params',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('rejects non-STEP extension with bad_params error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.call('cad.import_step', { path: '/tmp/some-mesh.stl' })
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'bad_params',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('rejects missing STEP file with step_file_missing error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.call('cad.import_step', {
          path: '/path/that/does/not/exist.step',
        })
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'step_file_missing',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('imports a real STEP (success) OR returns cadquery_not_installed fallback', async () => {
    // Create a minimal STEP file the test owns so we never depend on a
    // checked-in binary fixture. The contents are not a valid STEP body —
    // CadQuery will either reject with step_read_error (lib present) or
    // we'll get cadquery_not_installed (lib missing). Both prove the error
    // vocabulary is wired correctly.
    const dir = mkdtempSync(join(tmpdir(), 'wtcam-cad-test-'))
    const stepPath = join(dir, 'placeholder.step')
    writeFileSync(stepPath, 'ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n')

    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      let outcome:
        | { kind: 'ok'; result: CadImportStepResult }
        | { kind: 'err'; sidecarCode: string } = { kind: 'err', sidecarCode: 'unset' }
      try {
        const r = await bridge.call<CadImportStepResult>(
          'cad.import_step',
          { path: stepPath } satisfies CadImportStepParams,
          { timeoutMs: 60_000 }
        )
        outcome = { kind: 'ok', result: r }
      } catch (err: unknown) {
        const e = err as { code?: string; sidecarCode?: string }
        if (e.code === 'sidecar_error' && e.sidecarCode) {
          outcome = { kind: 'err', sidecarCode: e.sidecarCode }
        } else {
          throw err
        }
      }

      if (outcome.kind === 'ok') {
        // CadQuery installed AND somehow accepted the placeholder STEP —
        // assert the wire shape.
        expect(typeof outcome.result.handle).toBe('string')
        expect(outcome.result.handle.startsWith('step:')).toBe(true)
        expect(outcome.result.bbox.min).toHaveLength(3)
        expect(outcome.result.bbox.max).toHaveLength(3)
        for (const v of [...outcome.result.bbox.min, ...outcome.result.bbox.max]) {
          expect(Number.isFinite(v)).toBe(true)
        }
      } else {
        // Acceptable error codes for this fixture:
        //   - cadquery_not_installed: pip dep missing (sandbox case)
        //   - step_read_error: CadQuery present but the placeholder isn't
        //     a valid solid (expected — we wrote a header-only STEP).
        expect(['cadquery_not_installed', 'step_read_error']).toContain(
          outcome.sidecarCode
        )
      }
    } finally {
      await bridge.stop()
    }
  }, 60_000)
})

describeIfPython('cad.tessellate — sidecar end-to-end behavior', () => {
  it('rejects empty handle with bad_params error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.call('cad.tessellate', {
          handle: '',
          outPath: '/tmp/x.stl',
          toleranceMm: 0.1,
        })
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'bad_params',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('rejects negative tolerance with invalid_numeric_params error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.call('cad.tessellate', {
          handle: 'step:fake',
          outPath: '/tmp/x.stl',
          toleranceMm: -0.5,
        })
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'invalid_numeric_params',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('rejects unknown handle with invalid_handle error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      const dir = mkdtempSync(join(tmpdir(), 'wtcam-cad-tess-'))
      const outStl = join(dir, 'out.stl')
      let outcome:
        | { kind: 'ok'; result: CadTessellateResult }
        | { kind: 'err'; sidecarCode: string } = { kind: 'err', sidecarCode: 'unset' }
      try {
        const r = await bridge.call<CadTessellateResult>(
          'cad.tessellate',
          {
            handle: 'step:never-imported',
            outPath: outStl,
            toleranceMm: 0.1,
          } satisfies CadTessellateParams,
          { timeoutMs: 30_000 }
        )
        outcome = { kind: 'ok', result: r }
      } catch (err: unknown) {
        const e = err as { code?: string; sidecarCode?: string }
        if (e.code === 'sidecar_error' && e.sidecarCode) {
          outcome = { kind: 'err', sidecarCode: e.sidecarCode }
        } else {
          throw err
        }
      }
      // Either invalid_handle (lib installed) or cadquery_not_installed
      // (lib missing — handle lookup is BEFORE the cadquery import in the
      // tessellate path, BUT in our impl the handle table is populated only
      // after a successful import_step. Without the import, the table is
      // empty so the lookup fails first regardless of whether CadQuery is
      // available — invalid_handle is the expected code in both cases.
      expect(outcome.kind).toBe('err')
      if (outcome.kind === 'err') {
        expect(['invalid_handle', 'cadquery_not_installed']).toContain(
          outcome.sidecarCode
        )
      }
      // No file should have been written.
      expect(existsSync(outStl)).toBe(false)
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('produces a well-formed binary STL when CadQuery + a real STEP are available', async () => {
    // This branch is only meaningfully exercised in environments where
    // CadQuery installs (Python 3.9-3.11 + an OS with a wheel). We probe
    // the lib first and short-circuit otherwise — the test still passes
    // because the contract for the not-installed case is covered above.
    const probe = spawnSync(PYTHON!, ['-c', 'import cadquery'], { cwd: PROJECT_ROOT })
    if (probe.status !== 0) {
      // CadQuery not installed — skip the real-STEP branch. The earlier
      // tests already cover the cadquery_not_installed envelope shape.
      return
    }

    // Build a tiny synthetic STEP in-process via cadquery itself. Doing it
    // this way means we don't have to ship a binary fixture — and we test
    // the round-trip CadQuery → STEP-on-disk → sidecar → STL-on-disk.
    const dir = mkdtempSync(join(tmpdir(), 'wtcam-cad-real-'))
    const stepPath = join(dir, 'cube.step')
    const writeStepScript = `
import cadquery as cq
box = cq.Workplane('XY').box(10, 10, 10)
cq.exporters.export(box, ${JSON.stringify(stepPath)})
`
    const writeR = spawnSync(PYTHON!, ['-c', writeStepScript], { cwd: PROJECT_ROOT })
    if (writeR.status !== 0) {
      throw new Error(`cadquery STEP export failed: ${writeR.stderr.toString()}`)
    }

    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      const imp = await bridge.call<CadImportStepResult>(
        'cad.import_step',
        { path: stepPath } satisfies CadImportStepParams,
        { timeoutMs: 60_000 }
      )
      expect(imp.handle).toMatch(/^step:/)
      // bbox of a 10x10x10 box centered at origin is roughly ±5
      expect(imp.bbox.max[0]).toBeGreaterThan(0)
      expect(imp.bbox.min[0]).toBeLessThan(0)

      const outStl = join(dir, 'cube.stl')
      const tess = await bridge.call<CadTessellateResult>(
        'cad.tessellate',
        {
          handle: imp.handle,
          outPath: outStl,
          toleranceMm: 0.1,
        } satisfies CadTessellateParams,
        { timeoutMs: 60_000 }
      )

      expect(tess.stlPath).toBe(outStl)
      expect(tess.triangleCount).toBeGreaterThan(0)

      // Safety Rule 1: verify the binary STL we'll feed to OCL is shaped
      // exactly the way STLReader expects.
      const bytes = readFileSync(outStl)
      // Header is 80 bytes, then uint32 count, then 50 bytes per triangle.
      expect(bytes.length).toBe(80 + 4 + 50 * tess.triangleCount)
      const headerCount = bytes.readUInt32LE(80)
      expect(headerCount).toBe(tess.triangleCount)
      // First normal must be finite (not NaN/Inf).
      const firstNormalX = bytes.readFloatLE(80 + 4)
      const firstNormalY = bytes.readFloatLE(80 + 4 + 4)
      const firstNormalZ = bytes.readFloatLE(80 + 4 + 8)
      expect(Number.isFinite(firstNormalX)).toBe(true)
      expect(Number.isFinite(firstNormalY)).toBe(true)
      expect(Number.isFinite(firstNormalZ)).toBe(true)

      // File size on disk matches what we asserted from the buffer length.
      expect(statSync(outStl).size).toBe(bytes.length)
    } finally {
      await bridge.stop()
    }
  }, 180_000)
})

// ── C. Phase-4 "Insert from file" end-to-end pipeline ────────────────────────
//
// Drives the SHARED pure ``buildStepImportPart`` against a ``StepImportBridge``
// backed by the REAL sidecar (import_step → tessellate_with_ids on one bridge),
// so the production import→tessellate→shape sequence is exercised end-to-end
// without pulling in electron (the IPC handler ``runStepImportPipeline`` wraps
// this exact adapter, but importing it here would drag in ``ipc-cad`` →
// ``electron``). Runs only when CadQuery is installed in the Python env.

describeIfPython('buildStepImportPart — real sidecar end-to-end', () => {
  it('imports a real cube STEP into an AssemblyPart-shaped result with a durable STEP source', async () => {
    const probe = spawnSync(PYTHON!, ['-c', 'import cadquery'], { cwd: PROJECT_ROOT })
    if (probe.status !== 0) {
      // CadQuery not installed — the mock-bridge pure test covers the shaping;
      // this real-sidecar branch is skipped. (The env probe is the same guard
      // the "produces a well-formed binary STL" test uses.)
      return
    }

    const dir = mkdtempSync(join(tmpdir(), 'wtcam-step-part-'))
    const stepPath = join(dir, 'vendor-cube.step')
    const writeStepScript = `
import cadquery as cq
box = cq.Workplane('XY').box(20, 10, 5)
cq.exporters.export(box, ${JSON.stringify(stepPath)})
`
    const writeR = spawnSync(PYTHON!, ['-c', writeStepScript], { cwd: PROJECT_ROOT })
    if (writeR.status !== 0) {
      throw new Error(`cadquery STEP export failed: ${writeR.stderr.toString()}`)
    }

    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      const importBridge: StepImportBridge = {
        async importStep(path: string) {
          const r = await bridge.call<CadImportStepResult>(
            'cad.import_step',
            { path } satisfies CadImportStepParams,
            { timeoutMs: 120_000 }
          )
          return { handle: r.handle, bbox: r.bbox }
        },
        async tessellateWithIds(handle: string) {
          const r = await bridge.call<{
            vertices: number[]
            indices: number[]
            faceIds: number[]
            triangleCount: number
            bbox: { min: [number, number, number]; max: [number, number, number] }
          }>('cad.tessellate_with_ids', { handle }, { timeoutMs: 120_000 })
          return r
        },
      }

      const out = await buildStepImportPart(stepPath, 'row-e2e', importBridge)
      expect(out.ok).toBe(true)
      if (!out.ok) return
      const r = out.result
      // AssemblyPart-shaped fields.
      expect(r.id).toBe('row-e2e')
      expect(r.name).toBe('vendor-cube')
      expect(r.handle).toMatch(/^step:/)
      // Durable external-STEP geometry source.
      expect(r.geometrySource.kind).toBe('step')
      expect(r.geometrySource.stepPath).toBe(stepPath)
      expect(r.geometrySource.cachedBounds).toBeDefined()
      // A 20×10×5 box → dims are close to those extents (allow tessellation slack).
      const dims = r.geometrySource.cachedDims!
      expect(dims[0]).toBeGreaterThan(19)
      expect(dims[1]).toBeGreaterThan(9)
      expect(dims[2]).toBeGreaterThan(4)
      // Real mesh for the viewport.
      expect(r.mesh.triangleCount).toBeGreaterThan(0)
      expect(r.mesh.vertices.length % 3).toBe(0)
      expect(r.mesh.indices.length % 3).toBe(0)
      for (const v of [...r.mesh.bbox.min, ...r.mesh.bbox.max]) {
        expect(Number.isFinite(v)).toBe(true)
      }
    } finally {
      await bridge.stop()
    }
  }, 180_000)
})
