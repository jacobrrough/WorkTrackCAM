/**
 * cam-progress-pin.test.ts -- [ID-0234] Cycle 162 cam-engine paired-pin
 *
 * Companion to the behavior-test file `cam-progress.test.ts` (144 lines,
 * 14 it()) that covers the schema + parseCamProgressLine happy paths.
 * THIS pin file additionally pins the CONTRACT of `src/shared/cam-progress.ts` --
 * the structured progress event schema (`camProgressEventSchema`), the
 * stdout line prefix (`CAM_PROGRESS_LINE_PREFIX`), and the line-level
 * parser (`parseCamProgressLine`) consumed by the main process when it
 * forwards Python CAM engine stdout to the renderer via `cam:progress`.
 *
 * Cross-cuts every target machine in the CLAUDE.md "USER CONTEXT" list:
 *
 *   - **Creality K2 Plus** (FDM, Klipper/Moonraker): the FDM slice path
 *     does not currently invoke a Python CAM strategy, but the K2 Plus
 *     `.cam-aligned` STL pipeline (the "stage 1" that prepares mesh data
 *     before slice/post) does emit progress events through this schema.
 *     Any drift in the phase enum or percent range silently breaks the
 *     renderer-side progress bar consumed by the K2 fabrication panel.
 *   - **Laguna Swift 5x10** (CNC router, RichAuto A-series): full-sheet
 *     plywood / MDF / aluminum subtractive jobs run through the Python
 *     `advanced` engine; every strategy emits one `PROGRESS:` line per
 *     phase boundary; the operator-side progress bar IS the only signal
 *     that a 60" x 120" sheet job is making forward motion.
 *   - **Makera Carvera 3-axis & 4-axis**: rotary cylindrical heightfield
 *     + 3-axis pocket / contour runs both flow through the SAME schema;
 *     the `currentZMm` detail field is the only signal the operator has
 *     that a deep-Z cylindrical heightfield run is descending through
 *     the layer stack vs. wedged on a single layer.
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
 *   - 160 [ID-0223] cam-runtime-telemetry
 *   - 161 [ID-0233] shellLayoutStorage
 *   - 162 [ID-0234] cam-progress (THIS FILE)
 *
 * Pinned surfaces:
 *   (A) Module shape -- runtime-exported `camProgressEventSchema` (zod
 *       schema), `CAM_PROGRESS_LINE_PREFIX` (string const),
 *       `parseCamProgressLine` (function). The `CamProgressEvent` type
 *       alias is a `z.infer` type-only export erased at runtime.
 *   (B) Prefix-constant byte equality -- `CAM_PROGRESS_LINE_PREFIX` is
 *       LITERALLY `'PROGRESS:'`. ASCII-only. Includes trailing colon. No
 *       trailing whitespace.
 *   (C) Phase enum exact membership -- the schema accepts EXACTLY 8
 *       phases: init, mesh_load, heightfield, toolpath, post_process,
 *       write, complete, error. Any addition is a contract change. Any
 *       casing or hyphen variant is rejected.
 *   (D) Percent range -- accepts [0, 100] inclusive. Rejects -0.0001,
 *       100.0001, NaN, Infinity, -Infinity, missing.
 *   (E) Optional fields -- message is optional and untyped (any string,
 *       including empty); detail is optional, deeply optional in every
 *       sub-key, and rejects unknown sub-keys at non-strict zod default
 *       (the schema strips them).
 *   (F) parseCamProgressLine contract -- trims input; only matches
 *       prefix at start (post-trim); returns null on JSON.parse failure;
 *       returns null on safeParse failure (wrong schema); never throws;
 *       returns the typed event on success.
 *   (G) Cross-cutting safety invariants -- the helper is INTERFACE-ONLY
 *       (Safety Rule 1 G-code-is-sacred enforced via comment-stripped
 *       negative regex blocking G0-G91 + M3-M65 + tool-path G/M-codes
 *       in the production source). Machine-agnostic (no Creality / K2 /
 *       Laguna / Makera / Carvera in code).
 *   (H) Source-text whitelist -- canonical 'PROGRESS:' literal count==1;
 *       the 8 phase string literals each present; the import surface
 *       is `import { z } from 'zod'` only; no DOM / electron / fs / path
 *       / child_process imports; no top-level TypeScript `any`; no
 *       top-level `let` / `var`.
 *
 * ZERO production-code edits. Pure paired-pin (mirrors Cycles
 * 119/124/129/130/131/132/134/135/136/137/139/140/142/144/145/146/147/149/
 * 150/151/152/154/155/156/157/159/160/161). Per `docs/EDIT-WORKFLOW.md`
 * R1 the Python-via-bash mandate covers EXISTING files >800 lines and
 * `.claude/` log files only; this is a NEW file < 800 lines so the Write
 * tool is safe (per Cycle 141 v18 ledger mid-cycle re-check protocol).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as M from './cam-progress'
import {
  camProgressEventSchema,
  CAM_PROGRESS_LINE_PREFIX,
  parseCamProgressLine
} from './cam-progress'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC_PATH = join(HERE, 'cam-progress.ts')
const SRC = readFileSync(SRC_PATH, 'utf-8')

// Source text with line-comments stripped, used for negative regex assertions
// that should not be tripped by JSDoc commentary. Mirrors Cycles 150/161/etc.
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|\n)\s*\*[^\n]*/g, '$1') // JSDoc continuation lines
    .replace(/\/\/[^\n]*/g, '') // line comments
}
const CODE_ONLY_SRC = codeOnly(SRC)

const ALL_PHASES = [
  'init',
  'mesh_load',
  'heightfield',
  'toolpath',
  'post_process',
  'write',
  'complete',
  'error'
] as const

// ---------------------------------------------------------------------------
// (A) Module shape
// ---------------------------------------------------------------------------

describe('[ID-0234] cam-progress module shape', () => {
  it('exports exactly three runtime symbols (schema + prefix + parser)', () => {
    const keys = Object.keys(M).sort()
    expect(keys).toEqual([
      'CAM_PROGRESS_LINE_PREFIX',
      'camProgressEventSchema',
      'parseCamProgressLine'
    ])
  })

  it('module-namespace prototype is null (per ESM spec)', () => {
    expect(Object.getPrototypeOf(M)).toBeNull()
  })

  it('module-namespace string-keyed exports are exactly the three runtime symbols', () => {
    const stringKeys = Reflect.ownKeys(M)
      .filter((k): k is string => typeof k === 'string')
      .sort()
    expect(stringKeys).toEqual([
      'CAM_PROGRESS_LINE_PREFIX',
      'camProgressEventSchema',
      'parseCamProgressLine'
    ])
  })

  it('module-namespace symbol-keyed exports are at most Symbol.toStringTag', () => {
    const symbolKeys = Reflect.ownKeys(M).filter(
      (k): k is symbol => typeof k === 'symbol'
    )
    for (const s of symbolKeys) {
      expect(s).toBe(Symbol.toStringTag)
    }
  })

  it('has no default export', () => {
    expect((M as { default?: unknown }).default).toBeUndefined()
  })

  it('parseCamProgressLine is a function (typeof)', () => {
    expect(typeof parseCamProgressLine).toBe('function')
  })

  it('parseCamProgressLine has arity 1', () => {
    expect(parseCamProgressLine.length).toBe(1)
  })

  it('CAM_PROGRESS_LINE_PREFIX is a string (typeof)', () => {
    expect(typeof CAM_PROGRESS_LINE_PREFIX).toBe('string')
  })

  it('camProgressEventSchema is a zod object schema (has .parse method)', () => {
    expect(typeof (camProgressEventSchema as { parse: unknown }).parse).toBe(
      'function'
    )
    expect(
      typeof (camProgressEventSchema as { safeParse: unknown }).safeParse
    ).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// (B) Prefix-constant byte equality
// ---------------------------------------------------------------------------

describe('[ID-0234] CAM_PROGRESS_LINE_PREFIX byte equality', () => {
  it('equals exactly the literal string "PROGRESS:"', () => {
    expect(CAM_PROGRESS_LINE_PREFIX).toBe('PROGRESS:')
  })

  it('is exactly 9 characters long', () => {
    expect(CAM_PROGRESS_LINE_PREFIX.length).toBe(9)
  })

  it('is ASCII-only (no unicode drift)', () => {
    for (let i = 0; i < CAM_PROGRESS_LINE_PREFIX.length; i++) {
      expect(CAM_PROGRESS_LINE_PREFIX.charCodeAt(i)).toBeLessThan(128)
    }
  })

  it('has no leading whitespace', () => {
    expect(CAM_PROGRESS_LINE_PREFIX[0]).not.toMatch(/\s/)
  })

  it('has no trailing whitespace (the trailing colon is intentional)', () => {
    expect(
      CAM_PROGRESS_LINE_PREFIX[CAM_PROGRESS_LINE_PREFIX.length - 1]
    ).toBe(':')
  })

  it('starts with uppercase "P" (Python engines emit canonical casing)', () => {
    expect(CAM_PROGRESS_LINE_PREFIX[0]).toBe('P')
  })

  it('does NOT contain a hyphen, underscore, or alternate spelling', () => {
    expect(CAM_PROGRESS_LINE_PREFIX).not.toContain('-')
    expect(CAM_PROGRESS_LINE_PREFIX).not.toContain('_')
    // Lowercase or mixed-case spellings would silently break the prefix
    // match against canonical Python-emitted output.
    expect(CAM_PROGRESS_LINE_PREFIX).not.toMatch(/^progress/)
    expect(CAM_PROGRESS_LINE_PREFIX).not.toMatch(/^Progress/)
    // Sanity: it DOES contain the canonical casing.
    expect(CAM_PROGRESS_LINE_PREFIX).toContain('PROGRESS')
  })

  it('is a primitive string (not a String object wrapper)', () => {
    expect(typeof CAM_PROGRESS_LINE_PREFIX).toBe('string')
    expect(CAM_PROGRESS_LINE_PREFIX).not.toBeInstanceOf(String)
  })
})

// ---------------------------------------------------------------------------
// (C) Phase enum exact membership
// ---------------------------------------------------------------------------

describe('[ID-0234] phase enum exact membership', () => {
  it('accepts each of the 8 documented phase values', () => {
    for (const phase of ALL_PHASES) {
      const result = camProgressEventSchema.safeParse({ phase, percent: 0 })
      expect(result.success).toBe(true)
    }
  })

  it('rejects unknown phase strings', () => {
    const unknowns = [
      'unknown',
      'bogus',
      'progress',
      'cancelled',
      'aborted',
      'paused',
      'staged',
      'finalize',
      'mesh',
      'cam',
      'post',
      'sliced'
    ]
    for (const phase of unknowns) {
      const result = camProgressEventSchema.safeParse({ phase, percent: 50 })
      expect(result.success).toBe(false)
    }
  })

  it('rejects each phase value with case drift (uppercase variant)', () => {
    for (const phase of ALL_PHASES) {
      const upper = phase.toUpperCase()
      if (upper === phase) continue
      const result = camProgressEventSchema.safeParse({ phase: upper, percent: 50 })
      expect(result.success).toBe(false)
    }
  })

  it('rejects phase value with hyphen variant for snake_case names', () => {
    // mesh_load -> mesh-load, post_process -> post-process
    const variants = ['mesh-load', 'post-process']
    for (const phase of variants) {
      const result = camProgressEventSchema.safeParse({ phase, percent: 50 })
      expect(result.success).toBe(false)
    }
  })

  it('rejects phase value with camelCase variant for snake_case names', () => {
    const variants = ['meshLoad', 'postProcess']
    for (const phase of variants) {
      const result = camProgressEventSchema.safeParse({ phase, percent: 50 })
      expect(result.success).toBe(false)
    }
  })

  it('rejects empty string phase', () => {
    const result = camProgressEventSchema.safeParse({ phase: '', percent: 0 })
    expect(result.success).toBe(false)
  })

  it('rejects whitespace-padded phase', () => {
    const result = camProgressEventSchema.safeParse({
      phase: ' init',
      percent: 0
    })
    expect(result.success).toBe(false)
  })

  it('rejects null / undefined / number phase', () => {
    expect(
      camProgressEventSchema.safeParse({ phase: null, percent: 0 }).success
    ).toBe(false)
    expect(
      camProgressEventSchema.safeParse({ phase: undefined, percent: 0 }).success
    ).toBe(false)
    expect(
      camProgressEventSchema.safeParse({ phase: 1, percent: 0 }).success
    ).toBe(false)
  })

  it('exposes EXACTLY 8 phase enum values (cardinality pin)', () => {
    expect(ALL_PHASES).toHaveLength(8)
    // The fixture array IS the contract. Adding a 9th phase is a
    // breaking change to the renderer-side progress UI.
    let acceptedCount = 0
    for (const phase of ALL_PHASES) {
      if (camProgressEventSchema.safeParse({ phase, percent: 0 }).success) {
        acceptedCount += 1
      }
    }
    expect(acceptedCount).toBe(8)
  })

  it('phase order in source matches the documented init -> ... -> error progression', () => {
    // The phase enum order is human-meaningful: init opens the run, error
    // closes a failed run; complete closes a successful run. Drift in the
    // ordering would not BREAK runtime parsing but would obscure intent.
    const orderRegex =
      /'init'[\s\S]*'mesh_load'[\s\S]*'heightfield'[\s\S]*'toolpath'[\s\S]*'post_process'[\s\S]*'write'[\s\S]*'complete'[\s\S]*'error'/
    expect(SRC).toMatch(orderRegex)
  })
})

// ---------------------------------------------------------------------------
// (D) Percent range
// ---------------------------------------------------------------------------

describe('[ID-0234] percent range constraints', () => {
  it('accepts 0', () => {
    const out = camProgressEventSchema.parse({ phase: 'init', percent: 0 })
    expect(out.percent).toBe(0)
  })

  it('accepts 100', () => {
    const out = camProgressEventSchema.parse({
      phase: 'complete',
      percent: 100
    })
    expect(out.percent).toBe(100)
  })

  it('accepts a typical mid-run percent (45.5)', () => {
    const out = camProgressEventSchema.parse({
      phase: 'toolpath',
      percent: 45.5
    })
    expect(out.percent).toBe(45.5)
  })

  it('accepts the boundary epsilon (just inside 0)', () => {
    const out = camProgressEventSchema.parse({
      phase: 'init',
      percent: 0.0001
    })
    expect(out.percent).toBe(0.0001)
  })

  it('accepts the boundary epsilon (just inside 100)', () => {
    const out = camProgressEventSchema.parse({
      phase: 'complete',
      percent: 99.9999
    })
    expect(out.percent).toBe(99.9999)
  })

  it('rejects -0.0001 (just below 0)', () => {
    expect(() =>
      camProgressEventSchema.parse({ phase: 'init', percent: -0.0001 })
    ).toThrow()
  })

  it('rejects 100.0001 (just above 100)', () => {
    expect(() =>
      camProgressEventSchema.parse({ phase: 'complete', percent: 100.0001 })
    ).toThrow()
  })

  it('rejects NaN', () => {
    expect(() =>
      camProgressEventSchema.parse({ phase: 'init', percent: Number.NaN })
    ).toThrow()
  })

  it('rejects Infinity', () => {
    expect(() =>
      camProgressEventSchema.parse({
        phase: 'init',
        percent: Number.POSITIVE_INFINITY
      })
    ).toThrow()
  })

  it('rejects -Infinity', () => {
    expect(() =>
      camProgressEventSchema.parse({
        phase: 'init',
        percent: Number.NEGATIVE_INFINITY
      })
    ).toThrow()
  })

  it('rejects missing percent', () => {
    expect(() =>
      camProgressEventSchema.parse({ phase: 'init' })
    ).toThrow()
  })

  it('rejects string percent (no coercion)', () => {
    expect(() =>
      camProgressEventSchema.parse({ phase: 'init', percent: '50' })
    ).toThrow()
  })

  it('rejects null percent', () => {
    expect(() =>
      camProgressEventSchema.parse({ phase: 'init', percent: null })
    ).toThrow()
  })

  it('accepts integer 50 with .percent === 50 (no float coercion)', () => {
    const out = camProgressEventSchema.parse({ phase: 'toolpath', percent: 50 })
    expect(out.percent).toBe(50)
    expect(Number.isInteger(out.percent)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// (E) Optional fields: message + detail
// ---------------------------------------------------------------------------

describe('[ID-0234] optional fields (message + detail)', () => {
  it('omits message and detail keys on a minimal event', () => {
    const out = camProgressEventSchema.parse({ phase: 'init', percent: 0 })
    expect(out.message).toBeUndefined()
    expect(out.detail).toBeUndefined()
  })

  it('accepts an empty message (zod string allows empty by default)', () => {
    const out = camProgressEventSchema.parse({
      phase: 'init',
      percent: 0,
      message: ''
    })
    expect(out.message).toBe('')
  })

  it('accepts a long human-readable message', () => {
    const long = 'A'.repeat(4096)
    const out = camProgressEventSchema.parse({
      phase: 'toolpath',
      percent: 50,
      message: long
    })
    expect(out.message).toBe(long)
  })

  it('rejects non-string message (no coercion)', () => {
    expect(() =>
      camProgressEventSchema.parse({
        phase: 'init',
        percent: 0,
        message: 42
      })
    ).toThrow()
  })

  it('accepts a fully-populated detail object with all four sub-keys', () => {
    const out = camProgressEventSchema.parse({
      phase: 'toolpath',
      percent: 50,
      detail: {
        pointCount: 1500,
        estimatedLengthMm: 2400.5,
        currentZMm: -3.2,
        strategy: 'raster'
      }
    })
    expect(out.detail?.pointCount).toBe(1500)
    expect(out.detail?.estimatedLengthMm).toBe(2400.5)
    expect(out.detail?.currentZMm).toBe(-3.2)
    expect(out.detail?.strategy).toBe('raster')
  })

  it('accepts a partial detail with only pointCount', () => {
    const out = camProgressEventSchema.parse({
      phase: 'toolpath',
      percent: 50,
      detail: { pointCount: 7 }
    })
    expect(out.detail?.pointCount).toBe(7)
    expect(out.detail?.estimatedLengthMm).toBeUndefined()
    expect(out.detail?.currentZMm).toBeUndefined()
    expect(out.detail?.strategy).toBeUndefined()
  })

  it('accepts an empty detail object (all sub-keys are optional)', () => {
    const out = camProgressEventSchema.parse({
      phase: 'toolpath',
      percent: 50,
      detail: {}
    })
    expect(out.detail).toBeDefined()
    expect(out.detail?.pointCount).toBeUndefined()
    expect(out.detail?.estimatedLengthMm).toBeUndefined()
    expect(out.detail?.currentZMm).toBeUndefined()
    expect(out.detail?.strategy).toBeUndefined()
  })

  it('rejects negative pointCount (nonnegative constraint)', () => {
    expect(() =>
      camProgressEventSchema.parse({
        phase: 'toolpath',
        percent: 50,
        detail: { pointCount: -1 }
      })
    ).toThrow()
  })

  it('rejects non-integer pointCount (int constraint)', () => {
    expect(() =>
      camProgressEventSchema.parse({
        phase: 'toolpath',
        percent: 50,
        detail: { pointCount: 1.5 }
      })
    ).toThrow()
  })

  it('rejects negative estimatedLengthMm (nonnegative constraint)', () => {
    expect(() =>
      camProgressEventSchema.parse({
        phase: 'toolpath',
        percent: 50,
        detail: { estimatedLengthMm: -0.001 }
      })
    ).toThrow()
  })

  it('accepts negative currentZMm (Z descends below part top)', () => {
    // Z height is signed; negative values are normal for subtractive runs
    // descending into stock material.
    const out = camProgressEventSchema.parse({
      phase: 'heightfield',
      percent: 30,
      detail: { currentZMm: -25.4 }
    })
    expect(out.detail?.currentZMm).toBe(-25.4)
  })

  it('accepts strategy strings of any content', () => {
    const out = camProgressEventSchema.parse({
      phase: 'toolpath',
      percent: 50,
      detail: { strategy: 'adaptive_clear' }
    })
    expect(out.detail?.strategy).toBe('adaptive_clear')
  })

  it('rejects non-string strategy', () => {
    expect(() =>
      camProgressEventSchema.parse({
        phase: 'toolpath',
        percent: 50,
        detail: { strategy: 42 }
      })
    ).toThrow()
  })

  it('strips unknown top-level keys (zod default non-strict behavior)', () => {
    // Unknown keys should not cause a parse failure -- the schema is
    // non-strict so future Python-emitter additions are non-breaking on
    // the parse path.
    const result = camProgressEventSchema.safeParse({
      phase: 'init',
      percent: 0,
      futureKeyAddedByPython: 'ignored'
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(
        (result.data as { futureKeyAddedByPython?: unknown })
          .futureKeyAddedByPython
      ).toBeUndefined()
    }
  })

  it('strips unknown detail sub-keys (zod default non-strict behavior)', () => {
    const result = camProgressEventSchema.safeParse({
      phase: 'toolpath',
      percent: 50,
      detail: { pointCount: 5, unknownDetailKey: 'ignored' }
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.detail) {
      expect(
        (result.data.detail as { unknownDetailKey?: unknown }).unknownDetailKey
      ).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// (F) parseCamProgressLine contract
// ---------------------------------------------------------------------------

describe('[ID-0234] parseCamProgressLine contract', () => {
  it('returns a typed event for a canonical PROGRESS line', () => {
    const event = parseCamProgressLine(
      'PROGRESS:{"phase":"toolpath","percent":45}'
    )
    expect(event).not.toBeNull()
    expect(event?.phase).toBe('toolpath')
    expect(event?.percent).toBe(45)
  })

  it('returns the parsed event on each of the 8 phase values', () => {
    for (const phase of ALL_PHASES) {
      const event = parseCamProgressLine(
        `PROGRESS:{"phase":"${phase}","percent":0}`
      )
      expect(event).not.toBeNull()
      expect(event?.phase).toBe(phase)
    }
  })

  it('returns null for empty string input', () => {
    expect(parseCamProgressLine('')).toBeNull()
  })

  it('returns null for whitespace-only input', () => {
    expect(parseCamProgressLine('   ')).toBeNull()
    expect(parseCamProgressLine('\t')).toBeNull()
    expect(parseCamProgressLine('\n')).toBeNull()
    expect(parseCamProgressLine('\r\n')).toBeNull()
  })

  it('returns null for non-PROGRESS lines (regular Python stdout)', () => {
    expect(parseCamProgressLine('Loading mesh from file')).toBeNull()
    expect(parseCamProgressLine('ERROR: failed to read STL')).toBeNull()
    expect(parseCamProgressLine('INFO: 5000 triangles loaded')).toBeNull()
    expect(parseCamProgressLine('Traceback (most recent call last):')).toBeNull()
  })

  it('returns null for case-drift prefixes', () => {
    expect(
      parseCamProgressLine('progress:{"phase":"init","percent":0}')
    ).toBeNull()
    expect(
      parseCamProgressLine('Progress:{"phase":"init","percent":0}')
    ).toBeNull()
    expect(
      parseCamProgressLine('PROGRESS{"phase":"init","percent":0}')
    ).toBeNull()
  })

  it('strips leading and trailing whitespace before matching the prefix', () => {
    const event = parseCamProgressLine(
      '  PROGRESS:{"phase":"init","percent":0}  '
    )
    expect(event).not.toBeNull()
    expect(event?.phase).toBe('init')
  })

  it('strips a single trailing newline before matching', () => {
    const event = parseCamProgressLine(
      'PROGRESS:{"phase":"init","percent":0}\n'
    )
    expect(event).not.toBeNull()
    expect(event?.phase).toBe('init')
  })

  it('returns null for prefix-only input (no JSON body)', () => {
    expect(parseCamProgressLine('PROGRESS:')).toBeNull()
  })

  it('returns null for prefix + invalid JSON body', () => {
    expect(parseCamProgressLine('PROGRESS:{not json}')).toBeNull()
    expect(parseCamProgressLine("PROGRESS:{'phase':'init'}")).toBeNull()
    expect(parseCamProgressLine('PROGRESS:[1,2,3')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:undefined')).toBeNull()
  })

  it('returns null for prefix + valid JSON that fails the schema', () => {
    expect(
      parseCamProgressLine('PROGRESS:{"phase":"bogus","percent":50}')
    ).toBeNull()
    expect(parseCamProgressLine('PROGRESS:{"phase":"init"}')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:{"percent":50}')).toBeNull()
    expect(
      parseCamProgressLine('PROGRESS:{"phase":"init","percent":-1}')
    ).toBeNull()
    expect(
      parseCamProgressLine('PROGRESS:{"phase":"init","percent":101}')
    ).toBeNull()
  })

  it('returns null for prefix + valid JSON that is not an object', () => {
    expect(parseCamProgressLine('PROGRESS:42')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:"hello"')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:null')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:true')).toBeNull()
    expect(parseCamProgressLine('PROGRESS:[1,2,3]')).toBeNull()
  })

  it('does NOT throw for ANY input string (defensive contract)', () => {
    // Real-world Python stdout includes binary control bytes, BOMs, very
    // long lines, half-truncated JSON, etc. The parser is on the hot
    // path; throwing would crash the IPC forwarder.
    const inputs: string[] = [
      '',
      ' ',
      'PROGRESS:',
      'PROGRESS:\x00',
      'PROGRESS:﻿{"phase":"init","percent":0}',
      'PROGRESS:{"phase":"init","percent":0', // half-truncated
      'PROGRESS:{"phase":"init","percent":0}',
      'PROGRESS:'.repeat(1000),
      'PROGRESS:{}',
      'PROGRESS:[]',
      'PROGRESS:NaN'
    ]
    for (const input of inputs) {
      expect(() => parseCamProgressLine(input)).not.toThrow()
    }
  })

  it('returns the FULL parsed event including detail subfields when present', () => {
    const json = JSON.stringify({
      phase: 'complete',
      percent: 100,
      message: 'Done',
      detail: { pointCount: 5000, estimatedLengthMm: 12000 }
    })
    const event = parseCamProgressLine(`PROGRESS:${json}`)
    expect(event).not.toBeNull()
    expect(event?.phase).toBe('complete')
    expect(event?.percent).toBe(100)
    expect(event?.message).toBe('Done')
    expect(event?.detail?.pointCount).toBe(5000)
    expect(event?.detail?.estimatedLengthMm).toBe(12000)
  })

  it('preserves error-phase events through the parser', () => {
    const json = JSON.stringify({
      phase: 'error',
      percent: 0,
      message: 'STL file not found'
    })
    const event = parseCamProgressLine(`PROGRESS:${json}`)
    expect(event).not.toBeNull()
    expect(event?.phase).toBe('error')
    expect(event?.message).toBe('STL file not found')
  })

  it('returns a NEW object on each call (no caching)', () => {
    const a = parseCamProgressLine(
      'PROGRESS:{"phase":"init","percent":0}'
    )
    const b = parseCamProgressLine(
      'PROGRESS:{"phase":"init","percent":0}'
    )
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// (G) Cross-cutting safety invariants
// ---------------------------------------------------------------------------

describe('[ID-0234] cross-cutting safety invariants', () => {
  it('the schema accepts FDM-shaped events (K2 Plus mesh_load -> heightfield -> write)', () => {
    const fdmShape = [
      { phase: 'mesh_load' as const, percent: 5, message: 'Loading STL' },
      {
        phase: 'heightfield' as const,
        percent: 30,
        detail: { currentZMm: -1.5, strategy: 'cam_aligned' }
      },
      { phase: 'write' as const, percent: 95, message: 'Writing G-code' },
      { phase: 'complete' as const, percent: 100 }
    ]
    for (const event of fdmShape) {
      expect(camProgressEventSchema.safeParse(event).success).toBe(true)
    }
  })

  it('the schema accepts CNC-router-shaped events (Laguna full-sheet adaptive_clear)', () => {
    const lagunaShape = [
      { phase: 'init' as const, percent: 0, message: 'Starting Laguna run' },
      {
        phase: 'toolpath' as const,
        percent: 45,
        detail: {
          pointCount: 12500,
          estimatedLengthMm: 35000,
          strategy: 'adaptive_clear'
        }
      },
      {
        phase: 'post_process' as const,
        percent: 90,
        message: 'Posting to RichAuto A-series'
      },
      { phase: 'complete' as const, percent: 100 }
    ]
    for (const event of lagunaShape) {
      expect(camProgressEventSchema.safeParse(event).success).toBe(true)
    }
  })

  it('the schema accepts 4-axis-shaped events (Carvera cylindrical heightfield)', () => {
    const carveraShape = [
      { phase: 'init' as const, percent: 0 },
      {
        phase: 'heightfield' as const,
        percent: 50,
        detail: {
          currentZMm: -12.5,
          strategy: 'cylindrical_heightfield'
        }
      },
      {
        phase: 'toolpath' as const,
        percent: 75,
        detail: { pointCount: 8000 }
      },
      { phase: 'complete' as const, percent: 100 }
    ]
    for (const event of carveraShape) {
      expect(camProgressEventSchema.safeParse(event).success).toBe(true)
    }
  })

  it('the parser correctly handles a stream of mixed PROGRESS and non-PROGRESS lines', () => {
    const stream = [
      'INFO: starting engine',
      'PROGRESS:{"phase":"init","percent":0}',
      'Loading mesh',
      'PROGRESS:{"phase":"mesh_load","percent":5}',
      '',
      'PROGRESS:{"phase":"toolpath","percent":50}',
      'Done'
    ]
    const events = stream.map(parseCamProgressLine)
    expect(events.filter((e) => e !== null)).toHaveLength(3)
    expect(events[1]?.phase).toBe('init')
    expect(events[3]?.phase).toBe('mesh_load')
    expect(events[5]?.phase).toBe('toolpath')
  })

  it('the parser is referentially transparent (same input -> equal output across calls)', () => {
    const input = 'PROGRESS:{"phase":"toolpath","percent":42,"message":"x"}'
    const a = parseCamProgressLine(input)
    const b = parseCamProgressLine(input)
    expect(a).toEqual(b)
  })

  it('the schema is independent of percent precision (integers and floats both accepted)', () => {
    expect(
      camProgressEventSchema.safeParse({ phase: 'init', percent: 0 }).success
    ).toBe(true)
    expect(
      camProgressEventSchema.safeParse({ phase: 'init', percent: 0.0 }).success
    ).toBe(true)
    expect(
      camProgressEventSchema.safeParse({
        phase: 'toolpath',
        percent: 33.333_333_3
      }).success
    ).toBe(true)
  })

  it('the parser does NOT mutate its input string (strings are immutable in JS but pin the contract)', () => {
    const input = '  PROGRESS:{"phase":"init","percent":0}  '
    const before = input
    parseCamProgressLine(input)
    expect(input).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// (H) Source-text whitelist
// ---------------------------------------------------------------------------

describe('[ID-0234] cam-progress.ts source-text whitelist', () => {
  it('contains the canonical "PROGRESS:" literal with no near-miss spellings', () => {
    expect(SRC).toContain("'PROGRESS:'")
    expect(SRC).not.toContain("'progress:'")
    expect(SRC).not.toContain("'Progress:'")
    expect(SRC).not.toContain("'PROGRESS '")
    expect(SRC).not.toContain("'PROGRESS-'")
  })

  it("contains exactly one 'PROGRESS:' string-literal in source code", () => {
    // The constant is the single source-of-truth literal. Any duplicate
    // is a refactor smell (someone hard-coded it instead of importing the
    // constant).
    const matches = SRC.match(/'PROGRESS:'/g) ?? []
    expect(matches).toHaveLength(1)
  })

  it('contains each of the 8 phase enum string literals', () => {
    expect(SRC).toContain("'init'")
    expect(SRC).toContain("'mesh_load'")
    expect(SRC).toContain("'heightfield'")
    expect(SRC).toContain("'toolpath'")
    expect(SRC).toContain("'post_process'")
    expect(SRC).toContain("'write'")
    expect(SRC).toContain("'complete'")
    expect(SRC).toContain("'error'")
  })

  it('imports zod as `import { z } from \'zod\'` and nothing else', () => {
    expect(SRC).toContain("import { z } from 'zod'")
    // Should be the ONLY import line.
    const importLines = SRC.match(/^import\b[^\n]*$/gm) ?? []
    expect(importLines).toHaveLength(1)
  })

  it('declares camProgressEventSchema as a z.object schema', () => {
    expect(SRC).toContain('export const camProgressEventSchema = z.object(')
  })

  it('declares CAM_PROGRESS_LINE_PREFIX as an exported const', () => {
    expect(SRC).toContain(
      "export const CAM_PROGRESS_LINE_PREFIX = 'PROGRESS:'"
    )
  })

  it('declares parseCamProgressLine as an exported function returning a nullable typed event', () => {
    expect(SRC).toContain(
      'export function parseCamProgressLine(line: string): CamProgressEvent | null'
    )
  })

  it('exports the CamProgressEvent type via z.infer', () => {
    expect(SRC).toContain(
      'export type CamProgressEvent = z.infer<typeof camProgressEventSchema>'
    )
  })

  it('uses the safeParse idiom in the parser (not throwing parse)', () => {
    // The parser MUST NOT throw on bad payload; the safeParse call site
    // is what prevents that.
    expect(SRC).toContain('camProgressEventSchema.safeParse(parsed)')
    // Negative: the parser does NOT route through .parse on the hot path.
    expect(CODE_ONLY_SRC).not.toMatch(
      /camProgressEventSchema\.parse\(/
    )
  })

  it('uses .min(0).max(100) on percent (boundary pin)', () => {
    expect(SRC).toContain('z.number().min(0).max(100)')
  })

  it('uses .int().nonnegative() on pointCount', () => {
    expect(SRC).toContain('z.number().int().nonnegative()')
  })

  it('uses .nonnegative() on estimatedLengthMm', () => {
    // estimatedLengthMm allows decimals (so no .int()) but must be >= 0.
    expect(SRC).toMatch(/estimatedLengthMm:\s*z\.number\(\)\.nonnegative\(\)/)
  })

  it('declares currentZMm as a signed number (no nonneg constraint)', () => {
    // Z descends below the part top -- negative values are valid.
    expect(SRC).toMatch(/currentZMm:\s*z\.number\(\)\.optional\(\)/)
  })

  it('contains exactly one try/catch in the parser (the JSON.parse fence)', () => {
    const tryCount = (CODE_ONLY_SRC.match(/\btry\s*\{/g) ?? []).length
    const catchCount = (CODE_ONLY_SRC.match(/\}\s*catch\s*[({]/g) ?? []).length
    expect(tryCount).toBe(1)
    expect(catchCount).toBe(1)
  })

  it('uses the trimmed-line idiom (line.trim() at the top of the parser)', () => {
    expect(SRC).toContain('line.trim()')
  })

  it('uses startsWith to recognize the prefix (not a regex on the hot path)', () => {
    expect(SRC).toContain('.startsWith(CAM_PROGRESS_LINE_PREFIX)')
  })

  it('uses .slice(CAM_PROGRESS_LINE_PREFIX.length) to extract the JSON body', () => {
    expect(SRC).toContain('.slice(CAM_PROGRESS_LINE_PREFIX.length)')
  })

  it('does NOT import any DOM / electron / fs / path / subprocess / network module', () => {
    expect(SRC).not.toMatch(/from ['"]fs['"]/)
    expect(SRC).not.toMatch(/from ['"]node:fs['"]/)
    expect(SRC).not.toMatch(/from ['"]path['"]/)
    expect(SRC).not.toMatch(/from ['"]node:path['"]/)
    expect(SRC).not.toMatch(/from ['"]child_process['"]/)
    expect(SRC).not.toMatch(/from ['"]node:child_process['"]/)
    expect(SRC).not.toMatch(/from ['"]electron['"]/)
    expect(SRC).not.toMatch(/from ['"]react['"]/)
    expect(SRC).not.toMatch(/from ['"]three['"]/)
    expect(SRC).not.toMatch(/from ['"]handlebars['"]/)
    expect(SRC).not.toMatch(/from ['"]node:dgram['"]/)
    expect(SRC).not.toMatch(/from ['"]node:net['"]/)
    expect(SRC).not.toMatch(/from ['"]node:tls['"]/)
    expect(SRC).not.toMatch(/from ['"]node:http['"]/)
  })

  it('contains zero top-level TypeScript `any` annotations', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/:\s*any\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bas\s+any\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/<any\s*[,>]/)
  })

  it('contains zero top-level `let` declarations (pure module -- no mutable state)', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/^let\s/m)
  })

  it('contains zero top-level `var` declarations', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/^var\s/m)
  })

  it('does NOT mention any specific machine vendor in source code', () => {
    // The schema is machine-agnostic. Drift to e.g. "Carvera" or
    // "K2 Plus" hard-coded in the schema would break the cross-cutting
    // invariant.
    expect(CODE_ONLY_SRC).not.toMatch(/\bCreality\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bK2\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bLaguna\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bMakera\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bCarvera\b/)
    // Foreign vendors that should NEVER appear (per CLAUDE.md My-Shop-
    // Only mode).
    expect(CODE_ONLY_SRC).not.toMatch(/\bBambu\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bPrusa\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bFanuc\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bHaas\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bTormach\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bMach3\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bMach4\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bShapeoko\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bOnefinity\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bX-Carve\b/)
  })

  it('does NOT emit any toolpath G-code in source (Safety Rule 1)', () => {
    // The schema is interface-only; any stray motion G-code in the
    // source would smell like a leak from a posting routine. (G-code
    // line tokens like `G0 X0` should never appear here.)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG0\s+X/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG1\s+X/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG2\s+X/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG3\s+X/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG17\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG18\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG19\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG20\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG21\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG28\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG54\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG90\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bG91\b/)
  })

  it('does NOT emit any toolpath M-code in source (Safety Rule 1)', () => {
    expect(CODE_ONLY_SRC).not.toMatch(/\bM3\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bM4\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bM5\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bM6\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bM7\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bM8\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bM9\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bM30\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bM64\b/)
    expect(CODE_ONLY_SRC).not.toMatch(/\bM65\b/)
  })

  it('file size stays under the docs/EDIT-WORKFLOW.md R1 mandatory-territory threshold', () => {
    const lineCount = SRC.split('\n').length
    expect(lineCount).toBeLessThan(800)
  })

  it('file size stays small enough to be a pure boundary contract (under 100 lines)', () => {
    // A growing schema/parser is a smell -- additional logic belongs in
    // the renderer or main IPC handler, not in the contract.
    const lineCount = SRC.split('\n').length
    expect(lineCount).toBeLessThan(100)
  })

  it('exports exactly four symbols (1 schema + 1 const + 1 function + 1 type)', () => {
    // The single source-text count of `export ` -- 1 type alias + 2
    // const/var + 1 function = 4. Drift here means a new export was
    // added without updating the module-shape contract above.
    const matches = SRC.match(/^export\s+/gm) ?? []
    expect(matches).toHaveLength(4)
  })

  it('contains the documented "Python CAM engines" JSDoc rationale', () => {
    expect(SRC).toContain('Python CAM engines')
  })

  it('contains the documented "cam:progress" IPC channel reference', () => {
    expect(SRC).toContain("cam:progress")
  })

  it('contains the documented "PROGRESS:" prefix example in JSDoc', () => {
    // The JSDoc example block shows a sample line for documentation.
    expect(SRC).toContain('PROGRESS:{')
  })
})
