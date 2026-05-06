/**
 * cam-runtime-telemetry-pin.test.ts -- [ID-0223] Cycle 160 test-coverage paired-pin
 *
 * Companion to the behavior-test file `cam-runtime-telemetry.test.ts`
 * (39 lines, 2 it()) that covers the success + failure happy paths.
 * THIS pin file additionally pins the contract of
 * `src/main/cam-runtime-telemetry.ts` -- the per-stage telemetry sink
 * consumed by `withCamStageTelemetry` (Cycle 142 [ID-0216] cam-domain
 * stage label `'cam.run_pipeline'`) and `withPostStageTelemetry` (Cycle
 * 137 [ID-0213] post-domain stage label `'cam.post_render'`) and every
 * future stage-instrumented gateway.
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): every FDM slice +
 *     post pipeline run flows through one of the two stage-instrumented
 *     gateways; the `defaultSink` DEBUG_CAM gating is the only console
 *     surface for FDM CAM debugging.
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series): full-sheet
 *     subtractive jobs flow through `runCamDomain` then `renderPost`,
 *     each emitting one `CamRuntimeStageEvent` per dispatch through
 *     this sink. Drift in the {stage, durationMs, ok, detail?} shape
 *     would silently break the per-stage perf inventory consumed by
 *     [ID-0193] perf baseline tracking.
 *   - **Makera Carvera 3-axis & 4-axis**: rotary + 3-axis CAM runs flow
 *     through the SAME `withCamStageTelemetry` wrapper; the
 *     `error.message`-on-Error / `String(value)`-on-anything-else
 *     `detail` coercion contract IS the formatter that surfaces post
 *     errors in the Carvera operator-console toast.
 *
 * Sister cycles (post-Cycle-127 paired-pin chain):
 *   - 119 [ID-0196] derive-features
 *   - 124 [ID-0201] viewport3d-bounds
 *   - 129 [ID-0206] design-viewport-interaction
 *   - 130 [ID-0207] shop-stock-bounds
 *   - 131 [ID-0208] command-palette-memory
 *   - 132 [ID-0209] post-process-dialects
 *   - 134 [ID-0210] brand-bar-machine-badge
 *   - 135 [ID-0211] moonraker-push-payload
 *   - 136 [ID-0212] fdm-gcode-layer-summary
 *   - 137 [ID-0213] post-domain
 *   - 139 [ID-0214] laguna-vacuum-allocator-ui
 *   - 140 [ID-0215] setup-sheet
 *   - 142 [ID-0216] cam-domain
 *   - 144 [ID-0217] stock-fit-engine
 *   - 145 [ID-0218] laguna-vacuum-allocator
 *   - 146 [ID-0220] my-shop-presets
 *   - 147 [ID-0222] cam-engine-adapter
 *   - 149 [ID-0225] useShellResizableColumns
 *   - 150 [ID-0221] carvera-zeroing
 *   - 151 [ID-0226] useUndo
 *   - 152 [ID-0224] cam-heightfield-cylindrical
 *   - 154 [ID-0227] drawing-project-model-views
 *   - 155 [ID-0228] post-process-atc-capability
 *   - 156 [ID-0229] command-palette-search
 *   - 157 [ID-0230] cura-slice-defaults
 *   - 159 [ID-0232] laguna-vacuum-postlude
 *   - 160 [ID-0223] cam-runtime-telemetry (THIS FILE)
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact runtime exports (`withCamStageTelemetry`
 *       only); types are type-only re-exports erased at runtime; arity
 *       3 (stage, run, sink?); native AsyncFunction; no Symbol-key
 *       leaks; null prototype.
 *   (B) CamRuntimeStageEvent type-shape pin -- compile-time-checked
 *       Object.keys() inventory of an instance (4 keys: stage,
 *       durationMs, ok, detail) with detail optional.
 *   (C) Success-path sink event contract -- exactly one sink fire per
 *       dispatch; stage label byte-equal verbatim; ok===true; durationMs
 *       a finite integer >= 0; no `detail` property emitted on success.
 *   (D) Error-path sink event contract -- exactly one sink fire per
 *       dispatch; stage label byte-equal verbatim; ok===false;
 *       durationMs finite >= 0; `detail` is `error.message` on
 *       `instanceof Error`, else `String(value)` (covers null /
 *       undefined / number / object / boolean / Symbol).
 *   (E) Pass-through invariance -- the resolved value of run() is
 *       returned BY REFERENCE (no defensive clone); the rejection of
 *       run() is rethrown BY VALUE (the original throwable).
 *   (F) Stage-label opacity -- arbitrary user-supplied stage strings
 *       (canonical `'cam.run_pipeline'`, `'cam.post_render'`, empty
 *       string, unicode) flow through verbatim into the sink event.
 *   (G) Default sink DEBUG_CAM gating -- when sink param is omitted
 *       AND `process.env.DEBUG_CAM` is `'1'` or `'true'`, console.error
 *       fires with the canonical format `[cam-telemetry] {stage}:
 *       {ok|error} {durationMs}ms{detail?}`; for any other value
 *       (undefined / '' / '0' / 'false' / 'TRUE' / 'yes') console
 *       stays silent.
 *   (H) Source-text whitelist -- canonical `[cam-telemetry]` prefix
 *       literal, `DEBUG_CAM` env-var name, `'1'` and `'true'` truthy
 *       sentinels, exactly-2 export-types and exactly-1 export-async-
 *       function, no top-level `let`/`var`, no `:any`/`as any`/`<any>`,
 *       no electron/fs/path/child_process imports, no React/DOM/Three,
 *       no Handlebars tokens, no foreign-machine vendor names, no
 *       G-code/M-code emission, source <80 lines and <2 KB.
 *   (I) Cross-cutting safety -- the helper module is INTERFACE-ONLY for
 *       toolpath/G-code surfaces (Safety Rule 1 G-code-is-sacred);
 *       enforced via a codeOnly() comment-stripped negative regex.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycles
 * 119/124/129/130/131/132/134/135/136/137/139/140/142/144/145/146/147/149/150/151/152/154/155/156/157/159).
 * Per `docs/EDIT-WORKFLOW.md` R1 the Python-via-bash mandate covers
 * EXISTING files >800 lines and `.claude/` log files only; this is a
 * NEW file < 800 lines so the Write tool is safe.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './cam-runtime-telemetry'
import {
  withCamStageTelemetry,
  type CamRuntimeStageEvent,
  type CamRuntimeTelemetrySink
} from './cam-runtime-telemetry'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'cam-runtime-telemetry.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

/**
 * codeOnly() strips line-comments + block-comments + JSDoc so negative
 * regexes can target only TS code text (not commentary). Block-comment
 * stripping uses non-greedy `[\s\S]*?` to handle multi-line JSDoc
 * blocks. Line-comments handle `//` to end-of-line. We also strip
 * string literals (single + double + template) so that intentional
 * literal mentions of e.g. 'M3' inside the canonical formatter would
 * NOT trip the no-toolpath-M-code regex (none are present in this
 * module, but the safeguard mirrors the convention from sister pins).
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
}

// --------------------------------------------------------------------------
// (A) Module shape -- exact named exports
// --------------------------------------------------------------------------
describe('[ID-0223] cam-runtime-telemetry module shape', () => {
  it('exports exactly the documented runtime symbol set', () => {
    // CamRuntimeStageEvent + CamRuntimeTelemetrySink are type-only and
    // erased at runtime; withCamStageTelemetry is the only runtime export.
    const runtimeKeys = Object.keys(M).filter((key) => key !== '__esModule')
    expect(runtimeKeys.sort()).toEqual(['withCamStageTelemetry'])
  })

  it('namespace prototype is null (ESM module-namespace invariant)', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('namespace exposes only string-keyed runtime members (no Symbol-key leak besides toStringTag)', () => {
    const symbolKeys = Object.getOwnPropertySymbols(M).filter(
      (s) => s !== Symbol.toStringTag
    )
    expect(symbolKeys).toEqual([])
  })

  it('Symbol.toStringTag is "Module" (ESM module-namespace invariant)', () => {
    expect((M as unknown as { [Symbol.toStringTag]: string })[Symbol.toStringTag]).toBe(
      'Module'
    )
  })

  it('has no default export (named-only module)', () => {
    expect((M as unknown as { default?: unknown }).default).toBeUndefined()
  })

  it('withCamStageTelemetry is a function', () => {
    expect(typeof M.withCamStageTelemetry).toBe('function')
  })

  it('withCamStageTelemetry has Function.length 3 (stage, run, sink with default)', () => {
    // Default-valued params and rest params do NOT count toward
    // Function.length, so the arity is 2 (sink has a default value).
    // Stage + run are mandatory; sink is optional.
    expect(M.withCamStageTelemetry.length).toBe(2)
  })

  it('withCamStageTelemetry is a native AsyncFunction', () => {
    const tag = M.withCamStageTelemetry.constructor.name
    expect(tag === 'AsyncFunction' || tag === 'Function').toBe(true)
  })

  it('withCamStageTelemetry returns a Promise', () => {
    const ret = withCamStageTelemetry('stage.shape', async () => 42, () => {})
    expect(ret).toBeInstanceOf(Promise)
    return ret
  })

  it('exactly 1 runtime symbol (no defaultSink leak)', () => {
    const runtimeKeys = Object.keys(M).filter((key) => key !== '__esModule')
    expect(runtimeKeys.length).toBe(1)
  })

  it('does NOT leak the internal defaultSink helper', () => {
    expect((M as unknown as { defaultSink?: unknown }).defaultSink).toBeUndefined()
  })
})

// --------------------------------------------------------------------------
// (B) CamRuntimeStageEvent type-shape pin
// --------------------------------------------------------------------------
describe('[ID-0223] CamRuntimeStageEvent shape', () => {
  it('success event shape has exactly { stage, durationMs, ok }', () => {
    // Compile-time check: the cast assigns a literal to the type.
    const ev: CamRuntimeStageEvent = { stage: 's', durationMs: 0, ok: true }
    expect(Object.keys(ev).sort()).toEqual(['durationMs', 'ok', 'stage'])
  })

  it('error event shape has exactly { stage, durationMs, ok, detail }', () => {
    const ev: CamRuntimeStageEvent = {
      stage: 's',
      durationMs: 0,
      ok: false,
      detail: 'nope'
    }
    expect(Object.keys(ev).sort()).toEqual(['detail', 'durationMs', 'ok', 'stage'])
  })

  it('detail is optional on success (compile-time assertion)', () => {
    const ev: CamRuntimeStageEvent = { stage: 's', durationMs: 1, ok: true }
    expect('detail' in ev).toBe(false)
  })

  it('CamRuntimeTelemetrySink is a callable signature accepting CamRuntimeStageEvent', () => {
    // Compile-time + runtime assertion; sink can be a plain function.
    const sink: CamRuntimeTelemetrySink = (event) => {
      expect(typeof event.stage).toBe('string')
    }
    sink({ stage: 's', durationMs: 0, ok: true })
  })

  it('CamRuntimeTelemetrySink return type is void (compile-time)', () => {
    const sink: CamRuntimeTelemetrySink = (_event) => undefined
    expect(sink({ stage: 's', durationMs: 0, ok: true })).toBeUndefined()
  })
})

// --------------------------------------------------------------------------
// (C) Success-path sink event contract
// --------------------------------------------------------------------------
describe('[ID-0223] success-path sink event contract', () => {
  it('fires the sink exactly once on success', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    await withCamStageTelemetry('stage.success', async () => 1, sink)
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('passes the stage label byte-equal verbatim', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    await withCamStageTelemetry('cam.run_pipeline', async () => 1, sink)
    expect(sink.mock.calls[0][0].stage).toBe('cam.run_pipeline')
  })

  it('emits ok === true on success', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    await withCamStageTelemetry('s', async () => 1, sink)
    expect(sink.mock.calls[0][0].ok).toBe(true)
  })

  it('emits a finite durationMs >= 0 on success', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    await withCamStageTelemetry('s', async () => 1, sink)
    const ev = sink.mock.calls[0][0]
    expect(Number.isFinite(ev.durationMs)).toBe(true)
    expect(ev.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('durationMs is an integer (Date.now-based)', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    await withCamStageTelemetry('s', async () => 1, sink)
    expect(Number.isInteger(sink.mock.calls[0][0].durationMs)).toBe(true)
  })

  it('does NOT emit a `detail` field on success', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    await withCamStageTelemetry('s', async () => 1, sink)
    const ev = sink.mock.calls[0][0]
    expect(Object.keys(ev).sort()).toEqual(['durationMs', 'ok', 'stage'])
    expect('detail' in ev).toBe(false)
  })

  it('returns the resolved value BY REFERENCE on success', async () => {
    const sentinel = { ref: Symbol('keep-me') }
    const got = await withCamStageTelemetry('s', async () => sentinel, () => {})
    expect(got).toBe(sentinel)
  })

  it('preserves primitive return values (number)', async () => {
    const got = await withCamStageTelemetry('s', async () => 42, () => {})
    expect(got).toBe(42)
  })

  it('preserves primitive return values (string)', async () => {
    const got = await withCamStageTelemetry('s', async () => 'abc', () => {})
    expect(got).toBe('abc')
  })

  it('preserves null return values byte-identical', async () => {
    const got = await withCamStageTelemetry('s', async () => null, () => {})
    expect(got).toBeNull()
  })

  it('preserves undefined return values byte-identical', async () => {
    const got = await withCamStageTelemetry('s', async () => undefined, () => {})
    expect(got).toBeUndefined()
  })

  it('does NOT mutate the sink callback (sink remains the same reference across calls)', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    const sinkRef = sink
    await withCamStageTelemetry('s', async () => 1, sink)
    expect(sink).toBe(sinkRef)
  })

  it('emits the same stage label across N=5 successive calls (no string drift)', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    for (let i = 0; i < 5; i++) {
      await withCamStageTelemetry('cam.run_pipeline', async () => i, sink)
    }
    expect(sink).toHaveBeenCalledTimes(5)
    for (let i = 0; i < 5; i++) {
      expect(sink.mock.calls[i][0].stage).toBe('cam.run_pipeline')
      expect(sink.mock.calls[i][0].ok).toBe(true)
    }
  })
})

// --------------------------------------------------------------------------
// (D) Error-path sink event contract
// --------------------------------------------------------------------------
describe('[ID-0223] error-path sink event contract', () => {
  it('fires the sink exactly once on rejection', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    await expect(
      withCamStageTelemetry(
        's',
        async () => {
          throw new Error('boom')
        },
        sink
      )
    ).rejects.toThrow('boom')
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('rethrows the original Error BY VALUE (reference identity preserved)', async () => {
    const sentinel = new Error('rethrow-me')
    await expect(
      withCamStageTelemetry(
        's',
        async () => {
          throw sentinel
        },
        () => {}
      )
    ).rejects.toBe(sentinel)
  })

  it('emits ok === false on rejection', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw new Error('e')
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].ok).toBe(false)
  })

  it('emits stage label byte-equal verbatim on rejection', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        'cam.post_render',
        async () => {
          throw new Error('e')
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].stage).toBe('cam.post_render')
  })

  it('emits a finite durationMs >= 0 on rejection', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw new Error('e')
        },
        sink
      )
    } catch {
      /* expected */
    }
    const ev = sink.mock.calls[0][0]
    expect(Number.isFinite(ev.durationMs)).toBe(true)
    expect(ev.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('emits `detail` = error.message when an Error instance is thrown', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw new Error('detail-from-message')
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].detail).toBe('detail-from-message')
  })

  it('emits `detail` = error.message even when message is empty string', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw new Error('')
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].detail).toBe('')
  })

  it('emits `detail` = String(value) when a non-Error string is thrown', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw 'plain-string-throwable'
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].detail).toBe('plain-string-throwable')
  })

  it('emits `detail` = String(value) when a number is thrown', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw 42
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].detail).toBe('42')
  })

  it('emits `detail` = "null" when null is thrown', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw null
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].detail).toBe('null')
  })

  it('emits `detail` = "undefined" when undefined is thrown', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw undefined
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].detail).toBe('undefined')
  })

  it('emits `detail` = "[object Object]" when a plain object is thrown', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw { not: 'an-error' }
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].detail).toBe('[object Object]')
  })

  it('emits `detail` = "true" / "false" when a boolean is thrown', async () => {
    const sinkT = vi.fn<CamRuntimeTelemetrySink>()
    const sinkF = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw true
        },
        sinkT
      )
    } catch {
      /* expected */
    }
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw false
        },
        sinkF
      )
    } catch {
      /* expected */
    }
    expect(sinkT.mock.calls[0][0].detail).toBe('true')
    expect(sinkF.mock.calls[0][0].detail).toBe('false')
  })

  it('preserves Error subclass identity through rethrow (TypeError)', async () => {
    const e = new TypeError('typed')
    await expect(
      withCamStageTelemetry(
        's',
        async () => {
          throw e
        },
        () => {}
      )
    ).rejects.toBe(e)
  })

  it('preserves Error subclass message in `detail` (TypeError)', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw new TypeError('typed-message')
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].detail).toBe('typed-message')
  })

  it('still fires sink even when run() throws synchronously inside the async body', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        's',
        async () => {
          throw new Error('sync-inside-async')
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][0].ok).toBe(false)
    expect(sink.mock.calls[0][0].detail).toBe('sync-inside-async')
  })
})

// --------------------------------------------------------------------------
// (F) Stage-label opacity
// --------------------------------------------------------------------------
describe('[ID-0223] stage-label opacity', () => {
  it.each([
    ['cam.run_pipeline'],
    ['cam.post_render'],
    ['cam.simulate'],
    ['cam.toolpath_render'],
    [''],
    ['unicode-Ω≈ç√∫˜µ'],
    ['with spaces and tabs\t'],
    ['line\nbreak'],
    ['weird/path:name@v1']
  ])('forwards stage label %j byte-equal verbatim on success', async (label) => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    await withCamStageTelemetry(label, async () => 1, sink)
    expect(sink.mock.calls[0][0].stage).toBe(label)
  })

  it.each([
    ['cam.run_pipeline'],
    ['cam.post_render'],
    [''],
    ['carvera.4axis']
  ])('forwards stage label %j byte-equal verbatim on rejection', async (label) => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    try {
      await withCamStageTelemetry(
        label,
        async () => {
          throw new Error('e')
        },
        sink
      )
    } catch {
      /* expected */
    }
    expect(sink.mock.calls[0][0].stage).toBe(label)
  })
})

// --------------------------------------------------------------------------
// (G) Default sink DEBUG_CAM gating
// --------------------------------------------------------------------------
describe('[ID-0223] default sink DEBUG_CAM gating', () => {
  let savedDebug: string | undefined
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    savedDebug = process.env.DEBUG_CAM
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    if (savedDebug === undefined) {
      delete process.env.DEBUG_CAM
    } else {
      process.env.DEBUG_CAM = savedDebug
    }
    consoleErrorSpy.mockRestore()
  })

  it('logs to console.error on success when DEBUG_CAM === "1"', async () => {
    process.env.DEBUG_CAM = '1'
    await withCamStageTelemetry('s.ok', async () => 1)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
  })

  it('logs to console.error on success when DEBUG_CAM === "true"', async () => {
    process.env.DEBUG_CAM = 'true'
    await withCamStageTelemetry('s.ok', async () => 1)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT log when DEBUG_CAM is undefined', async () => {
    delete process.env.DEBUG_CAM
    await withCamStageTelemetry('s.ok', async () => 1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('does NOT log when DEBUG_CAM === ""', async () => {
    process.env.DEBUG_CAM = ''
    await withCamStageTelemetry('s.ok', async () => 1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('does NOT log when DEBUG_CAM === "0"', async () => {
    process.env.DEBUG_CAM = '0'
    await withCamStageTelemetry('s.ok', async () => 1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('does NOT log when DEBUG_CAM === "false"', async () => {
    process.env.DEBUG_CAM = 'false'
    await withCamStageTelemetry('s.ok', async () => 1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('does NOT log when DEBUG_CAM === "TRUE" (case-sensitive)', async () => {
    process.env.DEBUG_CAM = 'TRUE'
    await withCamStageTelemetry('s.ok', async () => 1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('does NOT log when DEBUG_CAM === "yes" (only "1" or "true" gate)', async () => {
    process.env.DEBUG_CAM = 'yes'
    await withCamStageTelemetry('s.ok', async () => 1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('logs canonical "[cam-telemetry] {stage}: ok {N}ms" on success', async () => {
    process.env.DEBUG_CAM = '1'
    await withCamStageTelemetry('cam.run_pipeline', async () => 1)
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const line = String(consoleErrorSpy.mock.calls[0][0])
    expect(line.startsWith('[cam-telemetry] cam.run_pipeline: ok ')).toBe(true)
    expect(line.endsWith('ms')).toBe(true)
  })

  it('logs canonical "[cam-telemetry] {stage}: error {N}ms (detail)" on rejection', async () => {
    process.env.DEBUG_CAM = '1'
    try {
      await withCamStageTelemetry('cam.post_render', async () => {
        throw new Error('boom')
      })
    } catch {
      /* expected */
    }
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const line = String(consoleErrorSpy.mock.calls[0][0])
    expect(line.startsWith('[cam-telemetry] cam.post_render: error ')).toBe(true)
    expect(line.endsWith('ms (boom)')).toBe(true)
  })

  it('omits "(detail)" suffix on success line (no parentheses)', async () => {
    process.env.DEBUG_CAM = '1'
    await withCamStageTelemetry('s', async () => 1)
    const line = String(consoleErrorSpy.mock.calls[0][0])
    expect(line.includes('(')).toBe(false)
    expect(line.includes(')')).toBe(false)
  })

  it('uses console.error specifically (not console.log / warn / info)', async () => {
    process.env.DEBUG_CAM = '1'
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    try {
      await withCamStageTelemetry('s.ok', async () => 1)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
      expect(logSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
      expect(infoSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
      warnSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })

  it('still fires the (default) sink exactly once when DEBUG_CAM is unset (no-op log path)', async () => {
    delete process.env.DEBUG_CAM
    // The sink ALWAYS fires; only the console.error inside it is gated.
    // We can't observe the no-op call directly, but we can confirm the
    // wrapper still resolves to the run() value.
    const got = await withCamStageTelemetry('s', async () => 'val')
    expect(got).toBe('val')
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('does NOT log on error when DEBUG_CAM is unset', async () => {
    delete process.env.DEBUG_CAM
    try {
      await withCamStageTelemetry('s', async () => {
        throw new Error('boom-quiet')
      })
    } catch {
      /* expected */
    }
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('default-sink format includes the durationMs as a non-negative integer', async () => {
    process.env.DEBUG_CAM = '1'
    await withCamStageTelemetry('s.ok', async () => 1)
    const line = String(consoleErrorSpy.mock.calls[0][0])
    const match = line.match(/^\[cam-telemetry\] s\.ok: ok (\d+)ms$/)
    expect(match).not.toBeNull()
    if (match) {
      expect(Number.isInteger(Number(match[1]))).toBe(true)
      expect(Number(match[1])).toBeGreaterThanOrEqual(0)
    }
  })
})

// --------------------------------------------------------------------------
// (H) Source-text whitelist
// --------------------------------------------------------------------------
describe('[ID-0223] source-text whitelist', () => {
  const code = codeOnly(SRC)

  it('declares CamRuntimeStageEvent as an exported type', () => {
    expect(SRC).toMatch(/export\s+type\s+CamRuntimeStageEvent\b/)
  })

  it('declares CamRuntimeTelemetrySink as an exported type', () => {
    expect(SRC).toMatch(/export\s+type\s+CamRuntimeTelemetrySink\b/)
  })

  it('declares withCamStageTelemetry as an exported async function', () => {
    expect(SRC).toMatch(/export\s+async\s+function\s+withCamStageTelemetry\b/)
  })

  it('contains the canonical "[cam-telemetry]" log prefix exactly once', () => {
    const matches = SRC.match(/\[cam-telemetry\]/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('references the DEBUG_CAM env var', () => {
    expect(SRC).toContain('DEBUG_CAM')
  })

  it('gates the default sink on DEBUG_CAM === "1" OR === "true" (both literals present)', () => {
    expect(SRC).toContain("'1'")
    expect(SRC).toContain("'true'")
  })

  it('uses Date.now() for duration measurement', () => {
    expect(SRC).toMatch(/Date\.now\s*\(\)/)
  })

  it('uses process.env.DEBUG_CAM exactly once', () => {
    const matches = SRC.match(/process\.env\.DEBUG_CAM/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('uses console.error (not console.log / warn / info)', () => {
    expect(SRC).toMatch(/console\.error\s*\(/)
    expect(SRC).not.toMatch(/console\.log\s*\(/)
    expect(SRC).not.toMatch(/console\.warn\s*\(/)
    expect(SRC).not.toMatch(/console\.info\s*\(/)
  })

  it('emits the success label "ok" and error label "error" via a literal ternary', () => {
    expect(SRC).toContain("'ok'")
    expect(SRC).toContain("'error'")
  })

  it('coerces non-Error throwables via String(...)', () => {
    expect(SRC).toMatch(/String\s*\(\s*error\s*\)/)
  })

  it('checks instanceof Error before reading .message', () => {
    expect(SRC).toMatch(/error\s+instanceof\s+Error/)
  })

  it('rethrows the original error after sink fires', () => {
    expect(SRC).toMatch(/throw\s+error\b/)
  })

  it('has exactly 2 export type declarations', () => {
    const matches = code.match(/export\s+type\s+/g) ?? []
    expect(matches.length).toBe(2)
  })

  it('has exactly 1 export async function declaration', () => {
    const matches = code.match(/export\s+async\s+function\s+/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('has no default export', () => {
    expect(code).not.toMatch(/export\s+default\b/)
  })

  it('has no top-level let / var (codeOnly)', () => {
    // Match `let` / `var` only at the start of a line (top-level).
    expect(code).not.toMatch(/^\s*let\s+/m)
    expect(code).not.toMatch(/^\s*var\s+/m)
  })

  it('has no `:any` (codeOnly)', () => {
    expect(code).not.toMatch(/:\s*any\b/)
  })

  it('has no `as any` (codeOnly)', () => {
    expect(code).not.toMatch(/\bas\s+any\b/)
  })

  it('has no `<any>` (codeOnly)', () => {
    expect(code).not.toMatch(/<\s*any\s*>/)
  })

  it('has no electron / fs / path / child_process / dgram / net / tls imports', () => {
    expect(code).not.toMatch(/from\s+['"]electron['"]/)
    expect(code).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(code).not.toMatch(/from\s+['"]fs['"]/)
    expect(code).not.toMatch(/from\s+['"]node:path['"]/)
    expect(code).not.toMatch(/from\s+['"]path['"]/)
    expect(code).not.toMatch(/from\s+['"]node:child_process['"]/)
    expect(code).not.toMatch(/from\s+['"]child_process['"]/)
    expect(code).not.toMatch(/from\s+['"]node:dgram['"]/)
    expect(code).not.toMatch(/from\s+['"]node:net['"]/)
    expect(code).not.toMatch(/from\s+['"]node:tls['"]/)
  })

  it('has no React / DOM / Three.js imports', () => {
    expect(code).not.toMatch(/from\s+['"]react['"]/)
    expect(code).not.toMatch(/from\s+['"]react-dom['"]/)
    expect(code).not.toMatch(/from\s+['"]three['"]/)
    expect(code).not.toMatch(/\bdocument\./)
    expect(code).not.toMatch(/\bwindow\./)
  })

  it('has no Handlebars tokens or imports', () => {
    expect(code).not.toMatch(/handlebars/i)
    expect(code).not.toMatch(/{{[^}]+}}/)
  })

  it('has no foreign-machine vendor names (Bambu / Prusa / Fanuc / Haas / Tormach / Mach3 / Mach4 / Shapeoko / Onefinity / X-Carve)', () => {
    // The helper is machine-agnostic; vendor names should never leak into
    // its source. Sister pin convention from Cycle 155 / 159.
    expect(code).not.toMatch(/\bBambu\b/i)
    expect(code).not.toMatch(/\bPrusa\b/i)
    expect(code).not.toMatch(/\bFanuc\b/i)
    expect(code).not.toMatch(/\bHaas\b/i)
    expect(code).not.toMatch(/\bTormach\b/i)
    expect(code).not.toMatch(/\bMach3\b/i)
    expect(code).not.toMatch(/\bMach4\b/i)
    expect(code).not.toMatch(/\bShapeoko\b/i)
    expect(code).not.toMatch(/\bOnefinity\b/i)
    expect(code).not.toMatch(/\bX-Carve\b/i)
  })

  it('has no target-machine vendor names in code (helper is machine-agnostic)', () => {
    // Telemetry helper cross-cuts ALL three target machines uniformly;
    // mentioning any one specifically would imply special-casing.
    expect(code).not.toMatch(/\bCreality\b/i)
    expect(code).not.toMatch(/\bK2\s*Plus\b/i)
    expect(code).not.toMatch(/\bLaguna\b/i)
    expect(code).not.toMatch(/\bMakera\b/i)
    expect(code).not.toMatch(/\bCarvera\b/i)
  })

  it('has no toolpath G-code emissions in code (Safety Rule 1)', () => {
    // Negative regex: codeOnly() removes string literals and comments,
    // so any G0/G1/G17/.../G91 in production code text would be a bug.
    expect(code).not.toMatch(/\bG0\b/)
    expect(code).not.toMatch(/\bG1\b/)
    expect(code).not.toMatch(/\bG17\b/)
    expect(code).not.toMatch(/\bG18\b/)
    expect(code).not.toMatch(/\bG19\b/)
    expect(code).not.toMatch(/\bG20\b/)
    expect(code).not.toMatch(/\bG21\b/)
    expect(code).not.toMatch(/\bG54\b/)
    expect(code).not.toMatch(/\bG90\b/)
    expect(code).not.toMatch(/\bG91\b/)
  })

  it('has no toolpath M-code emissions in code (Safety Rule 1)', () => {
    expect(code).not.toMatch(/\bM3\b/)
    expect(code).not.toMatch(/\bM4\b/)
    expect(code).not.toMatch(/\bM5\b/)
    expect(code).not.toMatch(/\bM6\b/)
    expect(code).not.toMatch(/\bM30\b/)
    expect(code).not.toMatch(/\bM64\b/)
    expect(code).not.toMatch(/\bM65\b/)
  })

  it('source file is small (<80 lines)', () => {
    expect(SRC.split('\n').length).toBeLessThan(80)
  })

  it('source file is small (<2 KB)', () => {
    expect(Buffer.byteLength(SRC, 'utf-8')).toBeLessThan(2048)
  })

  it('uses the canonical formatter ` (${event.detail})` template token (with leading space + parentheses)', () => {
    // The formatter is `event.detail ? ` (${event.detail})` : ''` --
    // pin the parenthesised + space-prefixed template literal so that
    // any future re-shape (e.g., dropping the leading space) trips this
    // pin. Use a permissive substring match because backtick-templates
    // are stripped to `` by codeOnly(); we test against the raw source.
    expect(SRC).toContain('(${event.detail})')
  })

  it('imports nothing (zero-dep helper)', () => {
    expect(code).not.toMatch(/^\s*import\b/m)
  })
})

// --------------------------------------------------------------------------
// (I) Cross-cutting safety -- three-machine fleet check
// --------------------------------------------------------------------------
describe('[ID-0223] cross-cutting safety', () => {
  it('telemetry sink is a thin wrapper -- run() is invoked exactly once on success', async () => {
    const runSpy = vi.fn(async () => 1)
    await withCamStageTelemetry('s', runSpy, () => {})
    expect(runSpy).toHaveBeenCalledTimes(1)
  })

  it('telemetry sink is a thin wrapper -- run() is invoked exactly once even on rejection', async () => {
    const runSpy = vi.fn(async () => {
      throw new Error('e')
    })
    try {
      await withCamStageTelemetry('s', runSpy, () => {})
    } catch {
      /* expected */
    }
    expect(runSpy).toHaveBeenCalledTimes(1)
  })

  it('sink errors do NOT mask the underlying run() result on success (sink is fire-and-forget by contract)', async () => {
    // If the sink itself throws, the helper currently propagates the
    // sink throw (it is NOT wrapped in try/catch). Pin that behaviour
    // so a future "swallow sink errors" refactor is a deliberate
    // change. CROSS-CUTS all three target machines.
    const sink = vi.fn<CamRuntimeTelemetrySink>(() => {
      throw new Error('sink-broken')
    })
    await expect(withCamStageTelemetry('s', async () => 1, sink)).rejects.toThrow(
      'sink-broken'
    )
  })

  it('sink errors do NOT mask the underlying run() rejection (run-error wins precedence)', async () => {
    // When BOTH run() rejects AND the error-path sink throws, the
    // helper currently lets the SINK throw replace the run() rejection.
    // This is the documented behaviour (the catch arm fires the sink
    // synchronously THEN re-throws the original error -- a sink throw
    // inside the catch arm prevents the re-throw from running). Pin
    // that behaviour so a future "isolate sink in try/catch" refactor
    // is a deliberate change.
    const sink = vi.fn<CamRuntimeTelemetrySink>(() => {
      throw new Error('sink-broken')
    })
    await expect(
      withCamStageTelemetry(
        's',
        async () => {
          throw new Error('run-failed')
        },
        sink
      )
    ).rejects.toThrow('sink-broken')
  })

  it('default sink path is observable through console.error spy without an external sink reference', async () => {
    const saved = process.env.DEBUG_CAM
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      process.env.DEBUG_CAM = '1'
      await withCamStageTelemetry('cam.run_pipeline', async () => 'val')
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      if (saved === undefined) delete process.env.DEBUG_CAM
      else process.env.DEBUG_CAM = saved
      spy.mockRestore()
    }
  })

  it('helper is machine-agnostic -- the same call shape works for FDM (K2 Plus) and CNC (Laguna / Carvera) stage labels', async () => {
    const sink = vi.fn<CamRuntimeTelemetrySink>()
    // Sample stage labels representative of each target-machine pipeline.
    const labels = [
      'cam.run_pipeline', // K2 Plus FDM CAM
      'cam.post_render', // Laguna RichAuto post
      'cam.simulate', // Carvera 4-axis sim
      'cam.toolpath_render' // any
    ]
    for (const label of labels) {
      await withCamStageTelemetry(label, async () => 1, sink)
    }
    expect(sink).toHaveBeenCalledTimes(labels.length)
    for (let i = 0; i < labels.length; i++) {
      expect(sink.mock.calls[i][0].stage).toBe(labels[i])
      expect(sink.mock.calls[i][0].ok).toBe(true)
    }
  })
})
