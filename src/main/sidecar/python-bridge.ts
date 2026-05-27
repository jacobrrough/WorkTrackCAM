/**
 * Bridge between the Electron main process and the Python sidecar at
 * `engines/sidecar/main.py`.
 *
 * Lifecycle
 * =========
 * - `start(opts)` spawns Python, returns a `PythonBridge` instance.
 * - `call(method, params, opts?)` sends one JSON-RPC request, awaits the
 *   response with matching `id`, resolves with the parsed result or rejects
 *   with a tagged error.
 * - `stop()` sends `shutdown`, waits for graceful exit; if the child does
 *   not exit within `stopGraceMs`, SIGKILL.
 *
 * Concurrency
 * ===========
 * Many in-flight calls are allowed; each is routed by `id`. The bridge
 * generates monotonic ids internally so callers cannot collide.
 *
 * Failure modes
 * =============
 * - `python_spawn_failed`: spawn() returned ENOENT or similar.
 * - `bridge_closed`: the child exited (crash or shutdown) while a call was
 *   pending; all pending calls reject with this.
 * - `bridge_timeout`: per-call `timeoutMs` elapsed before a matching response.
 * - `sidecar_error`: the sidecar returned a structured error envelope.
 * - `bad_response`: the sidecar wrote a line that did not parse as a valid
 *   response envelope. Treated as a protocol violation.
 */
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import {
  isSidecarResponse,
  type SidecarRequest,
  type SidecarResponse,
} from '../../shared/sidecar-protocol'

export type PythonBridgeStartOptions = {
  /** Absolute path to the Python interpreter to use. */
  pythonPath: string
  /** Absolute path to the app root (used as cwd; sidecar uses `python -m engines.sidecar.main`). */
  appRoot: string
  /** Optional environment overrides merged onto `process.env`. */
  env?: Record<string, string>
}

export type PythonBridgeCallOptions = {
  /** Reject after this many ms. Defaults to 60_000. */
  timeoutMs?: number
  /** AbortSignal — when fired, the in-flight call rejects with `AbortError`. */
  signal?: AbortSignal
}

export type PythonBridgeError =
  | { code: 'python_spawn_failed'; message: string; detail?: string }
  | { code: 'bridge_closed'; message: string; detail?: string }
  | { code: 'bridge_timeout'; message: string; detail?: string }
  | { code: 'sidecar_error'; message: string; detail?: string; sidecarCode: string }
  | { code: 'bad_response'; message: string; detail?: string }

type PendingCall = {
  id: string
  resolve: (result: Record<string, unknown>) => void
  reject: (err: PythonBridgeError) => void
  timer: NodeJS.Timeout | null
  abortHandler: (() => void) | null
  signal: AbortSignal | null
}

export class PythonBridge {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<string, PendingCall>()
  private idSeq = 0
  private stdoutBuf = ''
  private closed = false
  private closeReason: string | null = null

  private constructor() {}

  /** Spawn the sidecar and return a ready-to-use bridge. */
  static start(opts: PythonBridgeStartOptions): PythonBridge {
    const bridge = new PythonBridge()
    bridge.spawnChild(opts)
    return bridge
  }

  /** Number of currently in-flight calls. */
  get pendingCount(): number {
    return this.pending.size
  }

  /** True after `stop()` resolves or the child exits unexpectedly. */
  get isClosed(): boolean {
    return this.closed
  }

  async call<TResult extends Record<string, unknown> = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    opts: PythonBridgeCallOptions = {},
  ): Promise<TResult> {
    if (this.closed || !this.child) {
      throw bridgeError('bridge_closed', `sidecar closed: ${this.closeReason ?? 'no reason recorded'}`)
    }

    const id = this.nextId()
    const req: SidecarRequest = { id, method, params }
    const line = JSON.stringify(req) + '\n'
    const timeoutMs = opts.timeoutMs ?? 60_000

    return new Promise<TResult>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              const p = this.pending.get(id)
              if (!p) return
              this.pending.delete(id)
              if (p.abortHandler && p.signal) p.signal.removeEventListener('abort', p.abortHandler)
              reject(bridgeError('bridge_timeout', `call ${method} timed out after ${timeoutMs}ms`))
            }, timeoutMs)
          : null

      let abortHandler: (() => void) | null = null
      if (opts.signal) {
        if (opts.signal.aborted) {
          if (timer) clearTimeout(timer)
          reject(bridgeError('bridge_closed', 'aborted before send'))
          return
        }
        abortHandler = () => {
          const p = this.pending.get(id)
          if (!p) return
          this.pending.delete(id)
          if (p.timer) clearTimeout(p.timer)
          reject(bridgeError('bridge_closed', 'aborted'))
        }
        opts.signal.addEventListener('abort', abortHandler)
      }

      this.pending.set(id, {
        id,
        resolve: (result) => resolve(result as TResult),
        reject,
        timer,
        abortHandler,
        signal: opts.signal ?? null,
      })

      this.child!.stdin.write(line)
    })
  }

  /** Send `shutdown` and wait for the child to exit. */
  async stop(stopGraceMs = 2000): Promise<void> {
    if (this.closed || !this.child) return
    const child = this.child
    try {
      const shutdownReq: SidecarRequest = { id: this.nextId(), method: 'shutdown', params: {} }
      child.stdin.write(JSON.stringify(shutdownReq) + '\n')
      child.stdin.end()
    } catch {
      // ignore — child may already be dead
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* ignore */
        }
        resolve()
      }, stopGraceMs)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    if (!this.closed) this.handleClose('stop')
  }

  // ── internals ───────────────────────────────────────────────────────────

  private nextId(): string {
    this.idSeq += 1
    return `req-${this.idSeq}`
  }

  private spawnChild(opts: PythonBridgeStartOptions): void {
    try {
      this.child = spawn(opts.pythonPath, ['-m', 'engines.sidecar.main'], {
        cwd: opts.appRoot,
        env: opts.env ? { ...process.env, ...opts.env } : { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw bridgeError('python_spawn_failed', msg)
    }

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.onStdout(chunk))
    this.child.on('exit', (code, signal) => {
      this.handleClose(`child exited code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    })
    this.child.on('error', (err) => {
      this.handleClose(`spawn error: ${err.message}`)
    })
  }

  private onStdout(chunk: string): void {
    this.stdoutBuf += chunk
    let idx = this.stdoutBuf.indexOf('\n')
    while (idx >= 0) {
      const line = this.stdoutBuf.slice(0, idx).trim()
      this.stdoutBuf = this.stdoutBuf.slice(idx + 1)
      if (line) this.routeResponse(line)
      idx = this.stdoutBuf.indexOf('\n')
    }
  }

  private routeResponse(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // Drop unparseable lines. Sidecar promises one JSON object per line; a
      // violation here is a protocol bug, not a per-call failure.
      return
    }
    if (!isSidecarResponse(parsed)) return
    const resp = parsed as SidecarResponse
    const pending = this.pending.get(resp.id)
    if (!pending) return
    this.pending.delete(resp.id)
    if (pending.timer) clearTimeout(pending.timer)
    if (pending.abortHandler && pending.signal) {
      pending.signal.removeEventListener('abort', pending.abortHandler)
    }
    if (resp.ok) {
      pending.resolve(resp.result)
    } else {
      pending.reject({
        code: 'sidecar_error',
        message: resp.error.message,
        detail: resp.error.detail,
        sidecarCode: resp.error.code,
      })
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) return
    this.closed = true
    this.closeReason = reason
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      if (pending.abortHandler && pending.signal) {
        pending.signal.removeEventListener('abort', pending.abortHandler)
      }
      pending.reject(bridgeError('bridge_closed', reason))
    }
    this.pending.clear()
  }
}

function bridgeError(code: PythonBridgeError['code'], message: string, detail?: string): PythonBridgeError {
  if (code === 'sidecar_error') {
    return { code, message, detail, sidecarCode: 'unknown' }
  }
  return { code, message, detail }
}
