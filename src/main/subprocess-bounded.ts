import { spawn } from 'node:child_process'

export type SpawnBoundedWithLineCallbackOptions = SpawnBoundedOptions & {
  /**
   * Called for each complete line of stdout as it arrives.
   * Lines are split on `\n` (trailing `\r` is trimmed). The callback receives
   * the raw line text before it is accumulated into the final `stdout` result.
   * Useful for parsing structured progress output from child processes.
   */
  onStdoutLine?: (line: string) => void
}

/**
 * Like `spawnBounded`, but also invokes `onStdoutLine` for each complete line of stdout
 * as it arrives. The full stdout is still accumulated and returned in the result.
 * Use this when you need real-time line-by-line processing (e.g. progress parsing)
 * while retaining the bounded output guarantee.
 */
export function spawnBoundedWithLineCallback(
  command: string,
  args: string[],
  options: SpawnBoundedWithLineCallbackOptions = {}
): Promise<SpawnBoundedResult> {
  const { onStdoutLine, ...rest } = options

  if (!onStdoutLine) {
    // No callback — delegate to the standard implementation
    return spawnBounded(command, args, rest)
  }

  // We wrap spawnBounded but intercept stdout line-by-line.
  // To avoid duplicating the full spawn logic, we use the same approach
  // but add a line buffer that fires the callback per line.
  return new Promise((resolve, reject) => {
    const maxBufferBytes = rest.maxBufferBytes ?? 10 * 1024 * 1024
    const timeoutMs = rest.timeoutMs
    const { signal } = rest

    if (signal?.aborted) {
      reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
      return
    }

    const child = spawn(command, args, {
      cwd: rest.cwd,
      env: rest.env ? { ...process.env, ...rest.env } : { ...process.env },
      shell: rest.shell ?? false
    })

    let stdout = ''
    let stderr = ''
    let combinedLen = 0
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let abortHandler: (() => void) | undefined
    let stdoutLineBuf = ''

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimer()
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
      fn()
    }

    if (signal) {
      abortHandler = (): void => {
        finish(() => {
          try { child.kill() } catch { /* ignore */ }
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
        })
      }
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    const append = (which: 'stdout' | 'stderr', chunk: Buffer): void => {
      const s = chunk.toString()
      if (combinedLen + s.length > maxBufferBytes) {
        finish(() => {
          try { child.kill() } catch { /* ignore */ }
          reject(new Error(`Child process output exceeded maxBufferBytes (${maxBufferBytes}); process was killed.`))
        })
        return
      }
      combinedLen += s.length
      if (which === 'stdout') {
        stdout += s
        // Line-buffer and fire callback per complete line
        stdoutLineBuf += s
        const lines = stdoutLineBuf.split('\n')
        // Keep the last (possibly incomplete) segment in the buffer
        stdoutLineBuf = lines.pop()!
        for (const line of lines) {
          try { onStdoutLine(line.replace(/\r$/, '')) } catch { /* callback errors are swallowed */ }
        }
      } else {
        stderr += s
      }
    }

    if (timeoutMs != null && timeoutMs > 0) {
      timer = setTimeout(() => {
        finish(() => {
          try { child.kill() } catch { /* ignore */ }
          reject(new Error(`Process timed out after ${timeoutMs / 1000}s. Check the executable path and whether the task can finish on this machine.`))
        })
      }, timeoutMs)
    }

    child.stdout?.on('data', (d: Buffer) => append('stdout', d))
    child.stderr?.on('data', (d: Buffer) => append('stderr', d))
    child.on('error', (err) => { finish(() => reject(err)) })
    child.on('close', (code) => {
      // Flush any remaining content in the line buffer
      if (stdoutLineBuf.length > 0) {
        try { onStdoutLine(stdoutLineBuf.replace(/\r$/, '')) } catch { /* ignore */ }
      }
      finish(() => resolve({ code, stdout, stderr }))
    })
  })
}

export type SpawnBoundedOptions = {
  cwd?: string
  /** Merged onto `process.env` when set. */
  env?: NodeJS.ProcessEnv
  shell?: boolean
  /** Omit or `null` for no timeout. */
  timeoutMs?: number | null
  /** Total cap for decoded stdout+stderr (UTF-8 string length). Default 10 MiB. */
  maxBufferBytes?: number
  /**
   * When this signal is aborted, the child process is killed immediately and the
   * promise rejects with an Error whose `.name` is `'AbortError'`.
   * If the signal is already aborted at call time, the promise rejects immediately
   * without spawning a child process.
   */
  signal?: AbortSignal
}

export type SpawnBoundedResult = {
  code: number | null
  stdout: string
  stderr: string
}

const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024

/**
 * Spawn a child process with optional timeout and a hard cap on accumulated stdout/stderr size
 * to avoid main-process memory blowups from noisy or runaway tools.
 */
export function spawnBounded(
  command: string,
  args: string[],
  options: SpawnBoundedOptions = {}
): Promise<SpawnBoundedResult> {
  const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
  const timeoutMs = options.timeoutMs
  const { signal } = options

  if (signal?.aborted) {
    return Promise.reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : { ...process.env },
      shell: options.shell ?? false
    })

    let stdout = ''
    let stderr = ''
    let combinedLen = 0
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let abortHandler: (() => void) | undefined

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimer()
      if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
      fn()
    }

    if (signal) {
      abortHandler = (): void => {
        finish(() => {
          try {
            child.kill()
          } catch {
            /* ignore */
          }
          reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }))
        })
      }
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    const append = (which: 'stdout' | 'stderr', chunk: Buffer): void => {
      const s = chunk.toString()
      if (combinedLen + s.length > maxBufferBytes) {
        finish(() => {
          try {
            child.kill()
          } catch {
            /* ignore */
          }
          reject(
            new Error(
              `Child process output exceeded maxBufferBytes (${maxBufferBytes}); process was killed.`
            )
          )
        })
        return
      }
      combinedLen += s.length
      if (which === 'stdout') stdout += s
      else stderr += s
    }

    if (timeoutMs != null && timeoutMs > 0) {
      timer = setTimeout(() => {
        finish(() => {
          try {
            child.kill()
          } catch {
            /* ignore */
          }
          reject(
            new Error(
              `Process timed out after ${timeoutMs / 1000}s. Check the executable path and whether the task can finish on this machine.`
            )
          )
        })
      }, timeoutMs)
    }

    child.stdout?.on('data', (d: Buffer) => append('stdout', d))
    child.stderr?.on('data', (d: Buffer) => append('stderr', d))
    child.on('error', (err) => {
      finish(() => reject(err))
    })
    child.on('close', (code) => {
      finish(() => resolve({ code, stdout, stderr }))
    })
  })
}
