import { describe, expect, it } from 'vitest'
import { spawnBounded, spawnBoundedWithLineCallback } from './subprocess-bounded'

describe('spawnBounded', () => {
  it('captures stdout from node -e', async () => {
    const r = await spawnBounded(process.execPath, ['-e', "console.log('ok')"], { timeoutMs: 10_000 })
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('ok')
  })

  it('rejects when output exceeds maxBufferBytes', async () => {
    const script =
      "for (let i = 0; i < 5000; i++) { process.stdout.write('y'.repeat(200) + '\\n') }"
    await expect(
      spawnBounded(process.execPath, ['-e', script], {
        timeoutMs: 30_000,
        maxBufferBytes: 4000
      })
    ).rejects.toThrow(/maxBufferBytes/)
  })

  it('rejects on timeout for a long-running child', async () => {
    // [ID-0107] (Cycle 41 / perf): timeoutMs 400 -> 100 + wall-clock budget pin so a
    // future regression that ignores `timeoutMs` (e.g. drops the AbortController
    // wiring or re-introduces a setInterval-based timeout that survives spawn) is
    // caught here instead of silently re-inflating the suite. spawn() startup adds
    // ~50 ms on Linux; the 400 ms ceiling is 4x the 100 ms timeout which preserves
    // headroom for slow CI workers while still proving the abort fired on time.
    const t0 = Date.now()
    await expect(
      spawnBounded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        timeoutMs: 100,
        maxBufferBytes: 1024 * 1024
      })
    ).rejects.toThrow(/timed out/)
    const elapsed = Date.now() - t0
    expect(elapsed).toBeLessThan(400)
  })

  it('rejects immediately with AbortError when signal is already aborted before spawn', async () => {
    const controller = new AbortController()
    controller.abort()
    const err = await spawnBounded(process.execPath, ['-e', "console.log('ok')"], {
      timeoutMs: 10_000,
      signal: controller.signal
    }).then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('AbortError')
  })

  it('rejects with AbortError when signal is aborted during execution', async () => {
    const controller = new AbortController()
    const script = 'setInterval(() => {}, 1000)'
    const t0 = Date.now()
    const promise = spawnBounded(process.execPath, ['-e', script], {
      timeoutMs: 10_000,
      maxBufferBytes: 1024 * 1024,
      signal: controller.signal
    })
    // Abort after a short delay while the child is running. [ID-0107] (Cycle 41 /
    // perf): abort delay 150 -> 50 ms + wall-clock pin. spawn() startup is ~50 ms on
    // Linux, so 50 ms gives the child a moment to start before abort fires; 350 ms
    // ceiling is 7x the abort delay which preserves headroom on slow workers.
    setTimeout(() => controller.abort(), 50)
    const err = await promise.then(
      () => null,
      (e: unknown) => e
    )
    const elapsed = Date.now() - t0
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('AbortError')
    expect(elapsed).toBeLessThan(350)
  })

  it('resolves normally when signal is provided but never aborted', async () => {
    const controller = new AbortController()
    const r = await spawnBounded(process.execPath, ['-e', "console.log('hello')"], {
      timeoutMs: 10_000,
      signal: controller.signal
    })
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('hello')
  })

  it('resolves (does not reject) with the non-zero exit code surfaced', async () => {
    // The CAM/CAD sidecar and OrcaSlicer CLI signal failure via a non-zero exit
    // code while still writing diagnostics to stdout/stderr. spawnBounded must
    // RESOLVE (not reject) so callers can read `code` + the captured streams to
    // build a useful error; rejecting here would discard the child's diagnostics.
    const script = "process.stdout.write('partial'); process.exit(7)"
    const r = await spawnBounded(process.execPath, ['-e', script], { timeoutMs: 10_000 })
    expect(r.code).toBe(7)
    expect(r.stdout).toBe('partial')
  })

  it('captures stderr independently from stdout', async () => {
    // Exercises the `else stderr += s` branch in append() and proves the two
    // streams are kept separate (diagnostics on stderr must not leak into stdout,
    // which downstream parsers treat as structured tool output).
    const script = "process.stdout.write('OUT'); process.stderr.write('ERR')"
    const r = await spawnBounded(process.execPath, ['-e', script], { timeoutMs: 10_000 })
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('OUT')
    expect(r.stderr).toBe('ERR')
  })

  it('counts stdout+stderr together against the combined maxBufferBytes cap', async () => {
    // The cap is a COMBINED ceiling on decoded stdout+stderr (guards main-process
    // memory). Flood stderr alone to prove the cap is not stdout-only and that the
    // rejection path fires + kills the child for runaway stderr too.
    const script = "for (let i = 0; i < 5000; i++) { process.stderr.write('e'.repeat(200) + '\\n') }"
    await expect(
      spawnBounded(process.execPath, ['-e', script], {
        timeoutMs: 30_000,
        maxBufferBytes: 4000
      })
    ).rejects.toThrow(/maxBufferBytes/)
  })

  it('rejects with an ENOENT error when the command does not exist', async () => {
    // Spawn-failure path: a missing executable (e.g. an unbundled sidecar/CLI)
    // surfaces via the child `error` event -> reject. Asserts the Node ErrnoException
    // `.code` so callers can distinguish "tool not installed" from a tool that ran
    // and failed. Uses a name with no shell metacharacters; shell defaults to false.
    const err = await spawnBounded('worktrackcam-no-such-binary-xyzzy', [], {
      timeoutMs: 10_000
    }).then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as NodeJS.ErrnoException).code).toBe('ENOENT')
  })

  it('does not reject when timeoutMs is null (no timer armed)', async () => {
    // Guards the `timeoutMs != null && timeoutMs > 0` branch: a falsy/omitted
    // timeout must NOT arm a timer, so a fast child still resolves cleanly.
    const r = await spawnBounded(process.execPath, ['-e', "console.log('done')"], {
      timeoutMs: null
    })
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('done')
  })
})

describe('spawnBoundedWithLineCallback', () => {
  it('fires callback per stdout line while still accumulating output', async () => {
    const lines: string[] = []
    const script = "console.log('line1'); console.log('line2'); console.log('line3')"
    const r = await spawnBoundedWithLineCallback(process.execPath, ['-e', script], {
      timeoutMs: 10_000,
      onStdoutLine: (line) => lines.push(line)
    })
    expect(r.code).toBe(0)
    expect(lines).toEqual(['line1', 'line2', 'line3'])
    expect(r.stdout).toContain('line1')
    expect(r.stdout).toContain('line3')
  })

  it('delegates to spawnBounded when no callback is provided', async () => {
    const r = await spawnBoundedWithLineCallback(process.execPath, ['-e', "console.log('ok')"], {
      timeoutMs: 10_000
    })
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('ok')
  })

  it('handles empty lines correctly', async () => {
    const lines: string[] = []
    const script = "console.log('a'); console.log(''); console.log('b')"
    await spawnBoundedWithLineCallback(process.execPath, ['-e', script], {
      timeoutMs: 10_000,
      onStdoutLine: (line) => lines.push(line)
    })
    expect(lines).toEqual(['a', '', 'b'])
  })

  it('swallows callback errors without crashing', async () => {
    const lines: string[] = []
    const script = "console.log('a'); console.log('b')"
    const r = await spawnBoundedWithLineCallback(process.execPath, ['-e', script], {
      timeoutMs: 10_000,
      onStdoutLine: (line) => {
        if (line === 'a') throw new Error('callback error')
        lines.push(line)
      }
    })
    expect(r.code).toBe(0)
    // 'a' threw but 'b' should still be collected
    expect(lines).toEqual(['b'])
  })

  it('respects AbortSignal', async () => {
    const controller = new AbortController()
    controller.abort()
    const err = await spawnBoundedWithLineCallback(
      process.execPath,
      ['-e', "console.log('ok')"],
      { timeoutMs: 10_000, signal: controller.signal, onStdoutLine: () => {} }
    ).then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('AbortError')
  })

  it('enforces maxBufferBytes (kills the child) even in line-callback mode', async () => {
    // The line-callback path has its own append()/cap implementation; prove the
    // bounded-output guarantee still holds when a callback is supplied so a future
    // edit there cannot silently uncap memory for progress-parsing callers.
    const lines: string[] = []
    const script =
      "for (let i = 0; i < 5000; i++) { process.stdout.write('z'.repeat(200) + '\\n') }"
    await expect(
      spawnBoundedWithLineCallback(process.execPath, ['-e', script], {
        timeoutMs: 30_000,
        maxBufferBytes: 4000,
        onStdoutLine: (line) => lines.push(line)
      })
    ).rejects.toThrow(/maxBufferBytes/)
  })

  it('rejects on timeout in line-callback mode for a long-running child', async () => {
    // The timeout path is duplicated in the line-callback implementation; pin it
    // with a wall-clock budget so a regression that drops the timer there is caught.
    const t0 = Date.now()
    await expect(
      spawnBoundedWithLineCallback(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        timeoutMs: 100,
        maxBufferBytes: 1024 * 1024,
        onStdoutLine: () => {}
      })
    ).rejects.toThrow(/timed out/)
    expect(Date.now() - t0).toBeLessThan(400)
  })
})
