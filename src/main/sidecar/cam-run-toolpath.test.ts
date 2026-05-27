/**
 * Paired-pin contract test for the sidecar `cam.run_toolpath` handler.
 *
 * Covers two axes:
 *   A. Protocol shape — the strategy names declared in
 *      ``src/shared/sidecar-protocol.ts::CamStrategy`` MUST equal the set of
 *      ``ALLOWED_STRATEGIES`` in ``engines/sidecar/cam_handlers.py`` AND the
 *      ``STRATEGY_NAMES`` constant in ``engines/cam/ocl_strategies.py``. Any
 *      drift between the three files is a wire-contract break.
 *   B. Behavior — round-tripping a `cam.run_toolpath` request against the real
 *      sidecar process produces either:
 *        - a structured success envelope with non-empty `toolpathLines`
 *          (when OpenCAMLib is installed in the Python env), OR
 *        - a structured `opencamlib_not_installed` error (when it isn't).
 *      Both are acceptable; the post-2026-05-27 pipeline falls back to the
 *      built-in mesh raster in the second case (`cam-runner.ts` line ~1440).
 *
 * Safety Rule 1 (G-code is sacred): when OCL IS installed, this test sanity-
 * checks the emitted G-code line strings — every cutting move has finite,
 * properly-formatted coordinates and a feed value.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { CamStrategy } from '../../shared/sidecar-protocol'
import { PythonBridge } from './python-bridge'

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')
const STL_FIXTURE = resolve(
  PROJECT_ROOT,
  'default',
  'assets',
  'Meshy_AI_Desert_Sentinel_0311134458_texture.stl'
)

function detectPython(): string | null {
  for (const candidate of ['python', 'python3']) {
    const r = spawnSync(candidate, ['--version'])
    if (r.status === 0) return candidate
  }
  return null
}

const PYTHON = detectPython()
const describeIfPython = PYTHON ? describe : describe.skip

// ── A. Wire-contract: TS union vs. Python frozenset ──────────────────────

describe('cam.run_toolpath — protocol shape (paired pin)', () => {
  it('every CamStrategy literal appears in engines/cam/ocl_strategies.py STRATEGY_NAMES', () => {
    // Compile-time list of valid TS strategies — adding a new one here without
    // updating the Python side will break the round-trip in part (B).
    const tsStrategies: CamStrategy[] = [
      'waterline',
      'adaptive_waterline',
      'raster',
      'surface_scan',
    ]
    const py = readFileSync(
      resolve(PROJECT_ROOT, 'engines', 'cam', 'ocl_strategies.py'),
      'utf-8'
    )
    for (const s of tsStrategies) {
      expect(py).toContain(`"${s}"`)
    }
  })

  it('engines/sidecar/cam_handlers.py imports ALLOWED_STRATEGIES from the shared module', () => {
    const py = readFileSync(
      resolve(PROJECT_ROOT, 'engines', 'sidecar', 'cam_handlers.py'),
      'utf-8'
    )
    expect(py).toContain('STRATEGY_NAMES')
    expect(py).toContain('ALLOWED_STRATEGIES = STRATEGY_NAMES')
  })

  it('engines/cam/ocl_toolpath.py delegates strategy execution to the shared dispatch_strategy', () => {
    // Pin: the legacy subprocess MUST go through the shared module so
    // sidecar / subprocess outputs stay byte-identical.
    const py = readFileSync(
      resolve(PROJECT_ROOT, 'engines', 'cam', 'ocl_toolpath.py'),
      'utf-8'
    )
    expect(py).toContain('dispatch_strategy')
    expect(py).not.toMatch(/def _run_raster_pathdrop/)
    expect(py).not.toMatch(/def _run_waterline_levels/)
  })
})

// ── B. Behavior: real sidecar round-trip ─────────────────────────────────

describeIfPython('cam.run_toolpath — sidecar end-to-end behavior', () => {
  beforeAll(() => {
    if (!PYTHON) return
    const probe = spawnSync(PYTHON, ['-c', 'import engines.sidecar.cam_handlers'], {
      cwd: PROJECT_ROOT,
    })
    if (probe.status !== 0) {
      throw new Error(
        `cam_handlers import probe failed (exit ${probe.status}): ${probe.stderr.toString()}`
      )
    }
  })

  it('rejects unknown strategy with invalid_strategy error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.call('cam.run_toolpath', {
          strategy: 'definitely-not-a-strategy',
          stlPath: STL_FIXTURE,
          toolDiameterMm: 6,
          stepoverMm: 1,
          feedMmMin: 1000,
          plungeMmMin: 400,
          safeZMm: 10,
        })
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'invalid_strategy',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('rejects missing STL with stl_missing error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.call('cam.run_toolpath', {
          strategy: 'raster',
          stlPath: '/path/that/does/not/exist.stl',
          toolDiameterMm: 6,
          stepoverMm: 1,
          feedMmMin: 1000,
          plungeMmMin: 400,
          safeZMm: 10,
        })
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'stl_missing',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('rejects negative toolDiameterMm with invalid_numeric_params error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.call('cam.run_toolpath', {
          strategy: 'raster',
          stlPath: STL_FIXTURE,
          toolDiameterMm: -1,
          stepoverMm: 1,
          feedMmMin: 1000,
          plungeMmMin: 400,
          safeZMm: 10,
        })
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'invalid_numeric_params',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('runs surface_scan end-to-end (success OR opencamlib_not_installed fallback)', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      let result:
        | { ok: true; toolpathLines: string[]; lineCount: number }
        | { ok: false; sidecarCode: string } = { ok: false, sidecarCode: 'unset' }
      try {
        const r = await bridge.call<{
          toolpathLines: string[]
          strategy: string
          lineCount: number
        }>(
          'cam.run_toolpath',
          {
            strategy: 'surface_scan',
            stlPath: STL_FIXTURE,
            toolDiameterMm: 6,
            stepoverMm: 3,
            feedMmMin: 1500,
            plungeMmMin: 400,
            safeZMm: 10,
            zPassMm: 1,
          },
          { timeoutMs: 120_000 }
        )
        result = {
          ok: true,
          toolpathLines: r.toolpathLines,
          lineCount: r.lineCount,
        }
      } catch (err: unknown) {
        const e = err as { code?: string; sidecarCode?: string }
        if (e.code === 'sidecar_error' && e.sidecarCode) {
          result = { ok: false, sidecarCode: e.sidecarCode }
        } else {
          throw err
        }
      }

      if (result.ok) {
        // OCL installed: validate the G-code lines.
        expect(result.toolpathLines.length).toBeGreaterThan(0)
        expect(result.lineCount).toBe(result.toolpathLines.length)
        // Every cutting move (G1 with X/Y/Z) MUST have a feed.
        // Every coordinate MUST be a finite number with 3 decimals.
        const cuttingMovePattern =
          /^G1 X(-?\d+\.\d{3}) Y(-?\d+\.\d{3}) Z(-?\d+\.\d{3}) F\d+$/
        const plungePattern = /^G1 Z(-?\d+\.\d{3}) F\d+$/
        const rapidPattern = /^G0 (Z(-?\d+\.\d{3})|X(-?\d+\.\d{3}) Y(-?\d+\.\d{3}))$/
        const commentPattern = /^; /
        let cuttingMoveCount = 0
        for (const line of result.toolpathLines) {
          const matchesCutting = cuttingMovePattern.test(line)
          const matchesPlunge = plungePattern.test(line)
          const matchesRapid = rapidPattern.test(line)
          const matchesComment = commentPattern.test(line)
          // Safety Rule 1: every emitted line must match a known form. No NaN
          // / Inf / unbounded numbers slipping into the post-processor.
          expect(
            matchesCutting || matchesPlunge || matchesRapid || matchesComment,
            `unexpected G-code line shape: ${JSON.stringify(line)}`
          ).toBe(true)
          if (matchesCutting) cuttingMoveCount += 1
        }
        // A non-trivial mesh should produce many cutting moves.
        expect(cuttingMoveCount).toBeGreaterThan(10)
      } else {
        // OCL not installed in this Python env: the pipeline's mesh-raster
        // fallback handles this case. Test acknowledges either acceptable
        // outcome; CI installs OCL to exercise the real branch.
        expect(['opencamlib_not_installed']).toContain(result.sidecarCode)
      }
    } finally {
      await bridge.stop()
    }
  }, 180_000)
})
