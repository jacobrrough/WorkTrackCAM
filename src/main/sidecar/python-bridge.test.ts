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
