/**
 * Integration tests for the Python sidecar bridge.
 *
 * These exercise the real `engines/sidecar/main.py` via `python` to verify
 * the JSON-RPC round-trip end-to-end (spawn, request framing, response
 * routing, shutdown). Tests are skipped if Python is unavailable on PATH.
 */
import { spawnSync } from 'node:child_process'
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import {
  isCadEdgeMapEntry,
  isCadEdgePolyline,
  type CadExecuteScriptResult,
} from '../../shared/sidecar-protocol'
import { PythonBridge } from './python-bridge'

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..')

/** Resolve the python executable on PATH. Returns null when not found. */
function detectPython(): string | null {
  for (const candidate of ['python', 'python3']) {
    const r = spawnSync(candidate, ['--version'])
    if (r.status === 0) return candidate
  }
  return null
}

const PYTHON = detectPython()
const describeIfPython = PYTHON ? describe : describe.skip

describeIfPython('PythonBridge — sidecar round-trip', () => {
  beforeAll(() => {
    if (!PYTHON) return
    // Confirm the sidecar module imports before we run round-trips. If this
    // fails the test reports a clear setup error rather than a misleading
    // bridge timeout.
    const probe = spawnSync(PYTHON, ['-c', 'import engines.sidecar.main'], {
      cwd: PROJECT_ROOT,
    })
    if (probe.status !== 0) {
      throw new Error(
        `sidecar module probe failed (exit ${probe.status}): ${probe.stderr.toString()}`,
      )
    }
  })

  it('responds to ping with the version handshake', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      const result = await bridge.call<{ pong: true; version: string }>('ping')
      expect(result.pong).toBe(true)
      expect(typeof result.version).toBe('string')
      expect(result.version.length).toBeGreaterThan(0)
    } finally {
      await bridge.stop()
    }
  }, 15_000)

  it('rejects unknown methods with the sidecar_error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(bridge.call('does.not.exist')).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'unknown_method',
      })
    } finally {
      await bridge.stop()
    }
  }, 15_000)

  it('rejects bad params with the sidecar_error code', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.call('cam.run_toolpath', { strategy: 'not-a-strategy' }),
      ).rejects.toMatchObject({
        code: 'sidecar_error',
      })
    } finally {
      await bridge.stop()
    }
  }, 15_000)

  it('routes concurrent calls correctly by id', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      const results = await Promise.all([
        bridge.call<{ pong: true }>('ping'),
        bridge.call<{ pong: true }>('ping'),
        bridge.call<{ pong: true }>('ping'),
      ])
      expect(results).toHaveLength(3)
      for (const r of results) expect(r.pong).toBe(true)
    } finally {
      await bridge.stop()
    }
  }, 15_000)

  it('rejects pending calls with bridge_closed after stop()', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    await bridge.call('ping')
    await bridge.stop()
    await expect(bridge.call('ping')).rejects.toMatchObject({ code: 'bridge_closed' })
  }, 15_000)
})

// ── SIDECAR EDGE-ID EMISSION: typed tessellateWithIds round trip ───────────
//
// `PythonBridge.tessellateWithIds` is the typed entry point for the
// selection-grade tessellation (`cad.tessellate_with_ids`). Two axes:
//   1. Error threading works without CadQuery — an unknown handle fails the
//      table lookup BEFORE any cadquery import, so `invalid_handle` is the
//      deterministic structured error in every environment.
//   2. When CadQuery IS installed, a real box round-trips end-to-end through
//      the typed method: 12 stable `e:`-id polylines whose ids exactly key
//      `edgeMap`, identical across two calls, honestly un-truncated. (The
//      geometry-level assertions — points on curve, cap truncation — live in
//      engines/sidecar/__tests__/test_cad_edge_wire_emission.py under the
//      cadquery venv; this test proves the TYPED BRIDGE surface.)

describeIfPython('PythonBridge.tessellateWithIds — typed edge emission', () => {
  it('threads params through and surfaces invalid_handle as a structured error', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.tessellateWithIds({ handle: 'script:never-created' }, { timeoutMs: 30_000 }),
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'invalid_handle',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('rejects a non-positive tolerance with invalid_numeric_params', async () => {
    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      await expect(
        bridge.tessellateWithIds({ handle: 'script:x', toleranceMm: -0.1 }, { timeoutMs: 30_000 }),
      ).rejects.toMatchObject({
        code: 'sidecar_error',
        sidecarCode: 'invalid_numeric_params',
      })
    } finally {
      await bridge.stop()
    }
  }, 30_000)

  it('returns stable per-edge polylines end-to-end when CadQuery is installed', async () => {
    // Probe cadquery first — on a Python without a cadquery wheel the earlier
    // tests already cover the structured-error surface; the full-geometry
    // branch is exercised here when the interpreter has the lib AND (always)
    // by the venv pytest suite named in the block comment above.
    const probe = spawnSync(PYTHON!, ['-c', 'import cadquery'], { cwd: PROJECT_ROOT })
    if (probe.status !== 0) return

    const bridge = PythonBridge.start({ pythonPath: PYTHON!, appRoot: PROJECT_ROOT })
    try {
      const exec = await bridge.call<CadExecuteScriptResult>(
        'cad.execute_script',
        { script: "import cadquery as cq\nresult = cq.Workplane('XY').box(20, 15, 10)\n" },
        { timeoutMs: 120_000 },
      )
      const mesh = exec.meshes[0]
      expect(mesh).toBeDefined()

      const r1 = await bridge.tessellateWithIds({ handle: mesh.handle }, { timeoutMs: 120_000 })
      const r2 = await bridge.tessellateWithIds({ handle: mesh.handle }, { timeoutMs: 120_000 })

      // 12 well-formed stable polylines, ids exactly keying edgeMap.
      expect(r1.edges).toHaveLength(12)
      expect(r1.edges.every(isCadEdgePolyline)).toBe(true)
      expect(Object.values(r1.edgeMap).every(isCadEdgeMapEntry)).toBe(true)
      expect(new Set(r1.edges.map((e) => e.id))).toEqual(new Set(Object.keys(r1.edgeMap)))
      for (const poly of r1.edges) expect(poly.id.startsWith('e:')).toBe(true)

      // Stable across two calls on the same handle.
      expect(r1.edges.map((e) => e.id).sort()).toEqual(r2.edges.map((e) => e.id).sort())

      // Honest truncation flag present and false for a 24-point box.
      expect(r1.edgesTruncated).toBe(false)

      // The execute_script mesh embeds the same edge surface (wire completion).
      expect(Array.isArray(mesh.edges)).toBe(true)
      expect(mesh.edges).toHaveLength(12)
      expect(mesh.edgesTruncated).toBe(false)
    } finally {
      await bridge.stop()
    }
  }, 180_000)
})
