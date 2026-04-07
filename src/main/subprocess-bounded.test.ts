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
    await expect(
      spawnBounded(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        timeoutMs: 400,
        maxBufferBytes: 1024 * 1024
      })
    ).rejects.toThrow(/timed out/)
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
    const promise = spawnBounded(process.execPath, ['-e', script], {
      timeoutMs: 10_000,
      maxBufferBytes: 1024 * 1024,
      signal: controller.signal
    })
    // Abort after a short delay while the child is running
    setTimeout(() => controller.abort(), 150)
    const err = await promise.then(
      () => null,
      (e: unknown) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).name).toBe('AbortError')
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
})
