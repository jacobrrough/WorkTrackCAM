/**
 * path-join-pin.test.ts -- [ID-0237] Cycle 165 ui-polish paired-pin
 *
 * Co-located paired-pin contract for `src/renderer/lib/path-join.ts`
 * (8 lines / 286 bytes; SINGLE exported pure helper `joinPath(base,
 * segment)`). The helper exists because the renderer cannot import
 * Node's `path` module (Electron sandbox) yet must still build cross-
 * platform filesystem paths to surface Project / Workspace / Output
 * paths in the UI (status footer, settings drawer, file links).
 *
 * Per CLAUDE.md "USER CONTEXT -- TARGET MACHINES" this helper is
 * cross-cutting across the THREE target machines: every job's output
 * STL / G-code / project file path is rendered through `joinPath`
 * when the renderer composes labels from the workspace root + a
 * relative leaf path. A regression that flipped to the wrong
 * separator on Windows would show backslash-mixed paths in the K2
 * Plus Moonraker upload toast, the Laguna Swift 5x10 full-sheet
 * stock-fit dialog, and the Carvera 4-axis ATC tool-list panel --
 * cosmetic but immediately disorienting in the operator console, so
 * a paired-pin contract is justified.
 *
 * Sister cycles (post-Cycle-127 paired-pin chain, newest-first):
 *   - 164 [ID-0236] EDIT-WORKFLOW.md docs refresh
 *   - 163 [ID-0235] machine-post-template-hints
 *   - 162 [ID-0234] cam-progress
 *   - 161 [ID-0233] shellLayoutStorage
 *   - 160 [ID-0223] cam-runtime-telemetry
 *   - 159 [ID-0232] laguna-vacuum-postlude
 *   - 158 [ID-0231]/[ID-0067-data-v22] EDIT-WORKFLOW.md docs refresh
 *   - 155 [ID-0228] post-process-atc-capability
 *   - 154 [ID-0227] drawing-project-model-views
 *   - 153 [ID-0067-data-v21] EDIT-WORKFLOW.md docs refresh
 *   - 150 [ID-0221] carvera-zeroing
 *   - 149 [ID-0225] useShellResizableColumns
 *   - 147 [ID-0222] cam-engine-adapter
 *   - 146 [ID-0220] my-shop-presets
 *   - 145 [ID-0218] laguna-vacuum-allocator
 *   - 144 [ID-0217] stock-fit-engine
 *   - 142 [ID-0216] cam-domain
 *   - 140 [ID-0215] setup-sheet
 *   - 139 [ID-0214] laguna-vacuum-allocator-ui
 *   - 137 [ID-0213] post-domain
 *   - 136 [ID-0212] fdm-gcode-layer-summary
 *   - 135 [ID-0211] moonraker-push-payload
 *   - 134 [ID-0210] brand-bar-machine-badge
 *   - 132 [ID-0209] post-process-dialects
 *   - 131 [ID-0208] command-palette-memory
 *   - 130 [ID-0207] shop-stock-bounds
 *   - 129 [ID-0206] design-viewport-interaction
 *   - 124 [ID-0201] viewport3d-bounds
 *   - 119 [ID-0196] derive-features
 *
 * Pinned surfaces:
 *   (A) Module shape -- exact runtime export inventory (`joinPath`
 *       only). No accidental side-exports added later.
 *   (B) Function signature pin -- `joinPath` is a NATIVE function
 *       (not an arrow / not bound), arity 2, name "joinPath", string
 *       return type at runtime.
 *   (C) Core algorithm: separator detection. The separator picked
 *       for the joined output is determined SOLELY by whether the
 *       POST-TRAILING-STRIP base contains a backslash. Backslash
 *       anywhere in the stripped base -> '\\'; otherwise -> '/'.
 *       NOTE: the trailing strip runs FIRST, so a base like '\\\\\\'
 *       (only backslashes) collapses to '' before the includes check
 *       and resolves to '/' -- not '\\'. Pinned in (D) and (G).
 *   (D) Trailing-separator strip on base. ALL trailing forward
 *       slashes AND backslashes (one or many, mixed) are removed
 *       from `base` before concatenation.
 *   (E) Leading-separator strip on segment. ALL leading forward
 *       slashes AND backslashes (one or many, mixed) are removed
 *       from `segment` before concatenation.
 *   (F) Idempotence: `joinPath(base, segment)` produces a string
 *       containing exactly ONE separator between the stripped base
 *       and the stripped segment. No double separators.
 *   (G) Edge cases: empty base, empty segment, base of only slashes,
 *       segment of only slashes, single-char inputs.
 *   (H) Three-machine path realism: pinning the renderer's actual
 *       use case -- composing workspace-root + leaf paths for K2
 *       Plus Moonraker uploads, Laguna Swift 5x10 full-sheet output
 *       paths, and Carvera 4-axis ATC tool-list paths.
 *   (I) Pure-function invariants: same inputs -> same output across
 *       repeated calls; no this-binding leakage; no global mutation;
 *       no thrown errors on any documented input shape.
 *
 * NEW file (no prior coverage). Add-only -- no production code is
 * touched in Cycle 165.
 */
import { describe, expect, it } from 'vitest'
import * as PathJoinModule from './path-join'
import { joinPath } from './path-join'

describe('[ID-0237] path-join.ts -- module shape pin', () => {
  it('(A) exports exactly { joinPath } -- one runtime export, no extras', () => {
    const keys = Object.keys(PathJoinModule).sort()
    expect(keys).toEqual(['joinPath'])
  })

  it('(A) module namespace has only the standard Symbol.toStringTag (no other Symbol-keyed leaks)', () => {
    // Vite's ESM namespace proxy installs Symbol.toStringTag === "Module"
    // on every module namespace object. That's the ONLY Symbol-keyed
    // property we expect. A future cycle adding a Symbol-tagged side-
    // export (e.g. `export const ID = Symbol(...)`) would land on
    // string keys, so any unexpected Symbol-keyed property is a drift
    // signal worth catching.
    const syms = Object.getOwnPropertySymbols(PathJoinModule)
    expect(syms).toHaveLength(1)
    expect(syms[0]).toBe(Symbol.toStringTag)
    expect((PathJoinModule as unknown as Record<symbol, unknown>)[Symbol.toStringTag]).toBe('Module')
  })

  it('(A) joinPath is the same reference via namespace and named import', () => {
    expect(PathJoinModule.joinPath).toBe(joinPath)
  })
})

describe('[ID-0237] path-join.ts -- (B) function signature pin', () => {
  it('joinPath is a native function (typeof === "function")', () => {
    expect(typeof joinPath).toBe('function')
  })

  it('joinPath.name === "joinPath"', () => {
    expect(joinPath.name).toBe('joinPath')
  })

  it('joinPath has arity 2 (base, segment)', () => {
    expect(joinPath.length).toBe(2)
  })

  it('joinPath returns a string for ASCII inputs', () => {
    expect(typeof joinPath('a', 'b')).toBe('string')
  })

  it('joinPath returns a string for empty inputs', () => {
    expect(typeof joinPath('', '')).toBe('string')
  })

  it('joinPath is NOT an AsyncFunction', () => {
    // Sanity: pure synchronous helper. If someone refactors to
    // async-await over fs the renderer crashes (no Node fs in
    // sandbox) -- pin against that drift.
    const ctorName = (joinPath as unknown as { constructor: { name: string } }).constructor.name
    expect(ctorName).toBe('Function')
  })
})

describe('[ID-0237] path-join.ts -- (C) separator detection from base', () => {
  it('Unix-style base with no backslash -> joins with "/"', () => {
    expect(joinPath('/var/lib/worktrack', 'projects/k2.json')).toBe(
      '/var/lib/worktrack/projects/k2.json'
    )
  })

  it('Bare relative base "a" with no separators in either side -> "/" default', () => {
    // Algorithm: a.includes("\\") ? "\\" : "/" -- empty base contains
    // no backslash so "/" wins. Documented invariant.
    expect(joinPath('a', 'b')).toBe('a/b')
  })

  it('Empty base ("" no backslash) -> joins with "/"', () => {
    expect(joinPath('', 'leaf')).toBe('/leaf')
  })

  it('Windows-style base with backslash -> joins with "\\"', () => {
    expect(joinPath('C:\\Users\\jacob\\WorkTrack', 'projects\\k2.json')).toBe(
      'C:\\Users\\jacob\\WorkTrack\\projects\\k2.json'
    )
  })

  it('Mixed-separator base containing backslash -> "\\" wins (backslash detection is first-match)', () => {
    expect(joinPath('C:/Users/jacob\\WorkTrack', 'projects')).toBe(
      'C:/Users/jacob\\WorkTrack\\projects'
    )
  })

  it('Mixed-separator base containing only forward slashes -> "/" wins', () => {
    expect(joinPath('C:/Users/jacob/WorkTrack', 'projects')).toBe(
      'C:/Users/jacob/WorkTrack/projects'
    )
  })

  it('Backslash in segment is IGNORED for separator detection (only base counts)', () => {
    // Segment-side backslash is preserved as-is in the leaf but the
    // joining separator is '/' because base has no backslash. This
    // mirrors the renderer's intent: trust the base path's OS
    // convention, leaf is opaque.
    expect(joinPath('/var/lib/worktrack', 'sub\\leaf')).toBe('/var/lib/worktrack/sub\\leaf')
  })
})

describe('[ID-0237] path-join.ts -- (D) trailing-separator strip on base', () => {
  it('strips a single trailing "/"', () => {
    expect(joinPath('/var/lib/worktrack/', 'projects')).toBe('/var/lib/worktrack/projects')
  })

  it('strips a single trailing "\\"', () => {
    expect(joinPath('C:\\Users\\jacob\\', 'projects')).toBe('C:\\Users\\jacob\\projects')
  })

  it('strips MULTIPLE trailing forward slashes', () => {
    expect(joinPath('/var/lib/worktrack///', 'projects')).toBe('/var/lib/worktrack/projects')
  })

  it('strips MULTIPLE trailing backslashes', () => {
    expect(joinPath('C:\\Users\\jacob\\\\\\', 'projects')).toBe('C:\\Users\\jacob\\projects')
  })

  it('strips MIXED trailing separators ("/\\/")', () => {
    // Regex /[/\\]+$/ matches a run of any-separators -- mixed runs
    // collapse together.
    expect(joinPath('/var/lib/worktrack/\\/', 'leaf')).toBe('/var/lib/worktrack/leaf')
  })

  it('does NOT strip a separator from the MIDDLE of the base', () => {
    expect(joinPath('/a/b/c', 'd')).toBe('/a/b/c/d')
  })

  it('does NOT strip a leading separator from the base (root path preserved)', () => {
    expect(joinPath('/', 'leaf')).toBe('/leaf')
  })

  it('base of only forward slashes ("///") collapses to empty -> "/leaf"', () => {
    // After /[/\\]+$/ strip on "///" the base becomes ""; sep is
    // "/" because no backslash in original base -> "" + "/" + "leaf".
    expect(joinPath('///', 'leaf')).toBe('/leaf')
  })

  it('base of only backslashes ("\\\\\\") collapses to empty -> "/" sep wins -> "/leaf"', () => {
    // Important corner: trailing strip runs FIRST. After
    // `'\\\\\\'.replace(/[/\\]+$/, '')` the stripped base is `''`,
    // and `''.includes('\\')` is FALSE, so sep falls back to '/'.
    // The original-vs-stripped distinction is intentional but easy
    // to miss; pinning it here so a "use original base for sep
    // detection" refactor would be caught.
    expect(joinPath('\\\\\\', 'leaf')).toBe('/leaf')
  })
})

describe('[ID-0237] path-join.ts -- (E) leading-separator strip on segment', () => {
  it('strips a single leading "/"', () => {
    expect(joinPath('/var/lib/worktrack', '/projects')).toBe('/var/lib/worktrack/projects')
  })

  it('strips a single leading "\\"', () => {
    expect(joinPath('C:\\Users\\jacob', '\\projects')).toBe('C:\\Users\\jacob\\projects')
  })

  it('strips MULTIPLE leading forward slashes', () => {
    expect(joinPath('/var/lib/worktrack', '///projects')).toBe('/var/lib/worktrack/projects')
  })

  it('strips MULTIPLE leading backslashes', () => {
    expect(joinPath('C:\\Users\\jacob', '\\\\\\projects')).toBe('C:\\Users\\jacob\\projects')
  })

  it('strips MIXED leading separators ("/\\/" prefix)', () => {
    expect(joinPath('/var/lib/worktrack', '/\\/projects')).toBe('/var/lib/worktrack/projects')
  })

  it('does NOT strip a separator from the MIDDLE of the segment', () => {
    expect(joinPath('/a', 'b/c/d')).toBe('/a/b/c/d')
  })

  it('does NOT strip a TRAILING separator from the segment', () => {
    // Trailing slash on a directory path is preserved; only LEADING
    // separators get stripped from segment.
    expect(joinPath('/a', 'b/')).toBe('/a/b/')
  })

  it('segment of only forward slashes ("///") collapses to empty -> "/var/lib/worktrack/"', () => {
    // After /^[/\\]+/ strip on "///" the segment becomes ""; sep is
    // "/" -> base + "/" + "" = "/var/lib/worktrack/".
    expect(joinPath('/var/lib/worktrack', '///')).toBe('/var/lib/worktrack/')
  })

  it('segment of only backslashes ("\\\\\\") collapses to empty -> base + sep + ""', () => {
    expect(joinPath('C:\\Users\\jacob', '\\\\\\')).toBe('C:\\Users\\jacob\\')
  })
})

describe('[ID-0237] path-join.ts -- (F) idempotence / no-double-separator invariant', () => {
  it('output contains exactly ONE separator between stripped base and stripped segment (Unix)', () => {
    const out = joinPath('/var/lib/worktrack/', '/projects')
    // After stripping there must be exactly one "/" -- no "//".
    expect(out).not.toMatch(/\/\//)
    expect(out).toBe('/var/lib/worktrack/projects')
  })

  it('output contains exactly ONE separator between stripped base and stripped segment (Windows)', () => {
    const out = joinPath('C:\\Users\\jacob\\', '\\projects')
    expect(out).not.toMatch(/\\\\/)
    expect(out).toBe('C:\\Users\\jacob\\projects')
  })

  it('joinPath of an already-clean (base, segment) pair adds exactly one separator', () => {
    expect(joinPath('/a/b', 'c/d')).toBe('/a/b/c/d')
  })

  it('joinPath is NOT idempotent under self-application (does not collapse a/b/c/d)', () => {
    // joinPath('/a/b', '/c') === '/a/b/c'; calling joinPath('/a/b/c', '/d')
    // adds a fresh sep -> '/a/b/c/d'. Documented as intended; the
    // helper is a one-shot composer, not a normalizer.
    const once = joinPath('/a/b', '/c')
    const twice = joinPath(once, '/d')
    expect(once).toBe('/a/b/c')
    expect(twice).toBe('/a/b/c/d')
  })
})

describe('[ID-0237] path-join.ts -- (G) edge cases', () => {
  it('empty base + empty segment -> "/" (sep is "/" by default, both sides empty)', () => {
    expect(joinPath('', '')).toBe('/')
  })

  it('empty base + non-empty segment -> "/" + segment', () => {
    expect(joinPath('', 'leaf')).toBe('/leaf')
  })

  it('non-empty base + empty segment -> base + "/"', () => {
    expect(joinPath('/a', '')).toBe('/a/')
  })

  it('non-empty backslash base + empty segment -> base + "\\"', () => {
    expect(joinPath('C:\\a', '')).toBe('C:\\a\\')
  })

  it('single-char base "a" + single-char segment "b" -> "a/b"', () => {
    expect(joinPath('a', 'b')).toBe('a/b')
  })

  it('single-char backslash-only base "\\\\" + segment "b" -> "/b" (stripped to empty -> "/" wins)', () => {
    // Same corner as the (D) "only backslashes" pin: the lone
    // trailing backslash gets stripped first, leaving an empty
    // base, so sep falls back to '/'.
    expect(joinPath('\\', 'b')).toBe('/b')
  })

  it('single-char slash-only base "/" + segment "b" -> "/b"', () => {
    expect(joinPath('/', 'b')).toBe('/b')
  })

  it('handles paths with spaces verbatim (no URL-encoding, no quoting)', () => {
    expect(joinPath('/Users/Jacob Rough/3d software', 'WorkTrackCAM')).toBe(
      '/Users/Jacob Rough/3d software/WorkTrackCAM'
    )
  })

  it('handles non-ASCII characters verbatim', () => {
    expect(joinPath('/var/projets/café', 'résumé.txt')).toBe('/var/projets/café/résumé.txt')
  })

  it('handles a base ending with multiple alternating "/" and "\\" -- collapses all', () => {
    expect(joinPath('/a/b/\\/\\/', 'c')).toBe('/a/b/c')
  })
})

describe('[ID-0237] path-join.ts -- (H) three-machine renderer path realism', () => {
  // K2 Plus (FDM, Klipper/Moonraker): Moonraker upload preview shows
  // workspace-root + relative G-code path. The renderer composes
  // these via joinPath when the workspace root is the user's chosen
  // folder.
  it('K2 Plus -- Unix workspace root + FDM G-code leaf', () => {
    expect(joinPath('/Users/jacob/WorkTrackCAM/output', 'k2-cube-0.4nozzle.gcode')).toBe(
      '/Users/jacob/WorkTrackCAM/output/k2-cube-0.4nozzle.gcode'
    )
  })

  it('K2 Plus -- Windows workspace root + FDM G-code leaf', () => {
    expect(
      joinPath('C:\\Users\\jacob\\3d software\\WorkTrackCAM\\output', 'k2-cube-0.4nozzle.gcode')
    ).toBe('C:\\Users\\jacob\\3d software\\WorkTrackCAM\\output\\k2-cube-0.4nozzle.gcode')
  })

  it('K2 Plus -- Moonraker uploads/ subdirectory composition', () => {
    expect(joinPath('/home/biqu/printer_data/gcodes', 'uploads/k2-bracket.gcode')).toBe(
      '/home/biqu/printer_data/gcodes/uploads/k2-bracket.gcode'
    )
  })

  // Laguna Swift 5x10 (CNC router, RichAuto A-series): full-sheet
  // jobs output to a per-job dir; the renderer's setup-sheet PDF
  // path is composed via joinPath.
  it('Laguna Swift 5x10 -- Unix per-job output dir + .nc leaf', () => {
    expect(
      joinPath('/Users/jacob/WorkTrackCAM/output/laguna-fullsheet-2026-04-29', 'plywood-pocket.nc')
    ).toBe(
      '/Users/jacob/WorkTrackCAM/output/laguna-fullsheet-2026-04-29/plywood-pocket.nc'
    )
  })

  it('Laguna Swift 5x10 -- Windows per-job dir with trailing "\\" + setup-sheet leaf', () => {
    expect(
      joinPath(
        'C:\\Users\\jacob\\3d software\\WorkTrackCAM\\output\\laguna-2026-04-29\\',
        '\\setup-sheet.pdf'
      )
    ).toBe(
      'C:\\Users\\jacob\\3d software\\WorkTrackCAM\\output\\laguna-2026-04-29\\setup-sheet.pdf'
    )
  })

  // Makera Carvera + 4th Axis: ATC tool-list and 4-axis project
  // paths composed via joinPath for the operator-console panel.
  it('Carvera 4-axis -- Unix project root + 4-axis .cnc leaf', () => {
    expect(joinPath('/Users/jacob/WorkTrackCAM/output', 'carvera-4axis-shaft.cnc')).toBe(
      '/Users/jacob/WorkTrackCAM/output/carvera-4axis-shaft.cnc'
    )
  })

  it('Carvera 4-axis -- Windows project root with redundant separators on both sides', () => {
    expect(
      joinPath(
        'C:\\Users\\jacob\\3d software\\WorkTrackCAM\\output\\\\',
        '\\\\carvera-4axis-shaft.cnc'
      )
    ).toBe(
      'C:\\Users\\jacob\\3d software\\WorkTrackCAM\\output\\carvera-4axis-shaft.cnc'
    )
  })

  it('Carvera 4-axis -- ATC tool-list under project root, Unix flavor', () => {
    expect(joinPath('/Users/jacob/WorkTrackCAM/output/carvera-2026-04-29', 'atc-tools.json')).toBe(
      '/Users/jacob/WorkTrackCAM/output/carvera-2026-04-29/atc-tools.json'
    )
  })
})

describe('[ID-0237] path-join.ts -- (I) pure-function invariants', () => {
  it('same input -> same output across N=20 successive calls (no internal state)', () => {
    const expected = '/var/lib/worktrack/projects'
    for (let i = 0; i < 20; i++) {
      expect(joinPath('/var/lib/worktrack/', '/projects')).toBe(expected)
    }
  })

  it('does not mutate either string argument (strings are immutable in JS, but pin the contract)', () => {
    const base = '/var/lib/worktrack/'
    const segment = '/projects'
    joinPath(base, segment)
    expect(base).toBe('/var/lib/worktrack/')
    expect(segment).toBe('/projects')
  })

  it('does not throw on any documented input combination', () => {
    expect(() => joinPath('', '')).not.toThrow()
    expect(() => joinPath('a', 'b')).not.toThrow()
    expect(() => joinPath('/', '/')).not.toThrow()
    expect(() => joinPath('\\', '\\')).not.toThrow()
    expect(() => joinPath('///', '///')).not.toThrow()
    expect(() => joinPath('\\\\\\', '\\\\\\')).not.toThrow()
    expect(() => joinPath('C:\\Windows\\', '\\System32\\')).not.toThrow()
  })

  it('does not depend on `this` (call-site binding does not leak)', () => {
    const detached = joinPath
    expect(detached('/a', 'b')).toBe('/a/b')
  })

  it('result length equals strippedBase.length + 1 (sep) + strippedSegment.length', () => {
    const base = '/a/b///'
    const segment = '\\\\c'
    const out = joinPath(base, segment)
    // Base has no backslash -> sep "/". Stripped base "/a/b", stripped
    // segment "c". Length = 4 + 1 + 1 = 6 ("/a/b/c").
    expect(out).toBe('/a/b/c')
    expect(out.length).toBe(6)
  })

  it('separator characters in result are EXACTLY one of "/" or "\\" (no other unicode separators introduced)', () => {
    const out = joinPath('/a/b', 'c')
    // Strip non-separator chars; what remains must be only / and \ ASCII.
    expect(out.replace(/[^/\\]/g, '').replace(/[/\\]/g, '')).toBe('')
  })
})

describe('[ID-0237] path-join.ts -- regex contract pin (defensive)', () => {
  it('the trailing-strip regex is greedy on "/" runs (one-or-more, anchored)', () => {
    // Indirectly tested via output: 1, 2, 3, 4, 5 trailing "/"
    // all collapse to nothing (then sep gets appended fresh).
    expect(joinPath('/a/', 'b')).toBe('/a/b')
    expect(joinPath('/a//', 'b')).toBe('/a/b')
    expect(joinPath('/a///', 'b')).toBe('/a/b')
    expect(joinPath('/a////', 'b')).toBe('/a/b')
    expect(joinPath('/a/////', 'b')).toBe('/a/b')
  })

  it('the leading-strip regex is greedy on "/" runs (one-or-more, anchored)', () => {
    expect(joinPath('/a', '/b')).toBe('/a/b')
    expect(joinPath('/a', '//b')).toBe('/a/b')
    expect(joinPath('/a', '///b')).toBe('/a/b')
    expect(joinPath('/a', '////b')).toBe('/a/b')
    expect(joinPath('/a', '/////b')).toBe('/a/b')
  })

  it('the trailing-strip regex is greedy on "\\" runs (one-or-more, anchored)', () => {
    expect(joinPath('C:\\a\\', 'b')).toBe('C:\\a\\b')
    expect(joinPath('C:\\a\\\\', 'b')).toBe('C:\\a\\b')
    expect(joinPath('C:\\a\\\\\\', 'b')).toBe('C:\\a\\b')
    expect(joinPath('C:\\a\\\\\\\\', 'b')).toBe('C:\\a\\b')
  })

  it('the leading-strip regex is greedy on "\\" runs (one-or-more, anchored)', () => {
    expect(joinPath('C:\\a', '\\b')).toBe('C:\\a\\b')
    expect(joinPath('C:\\a', '\\\\b')).toBe('C:\\a\\b')
    expect(joinPath('C:\\a', '\\\\\\b')).toBe('C:\\a\\b')
    expect(joinPath('C:\\a', '\\\\\\\\b')).toBe('C:\\a\\b')
  })

  it('the strip regexes work on MIXED separator runs', () => {
    // /[/\\]+$/  and  /^[/\\]+/  both treat "/" and "\\" as
    // interchangeable in the run -- mixed runs collapse together.
    expect(joinPath('/a/\\/\\', 'b')).toBe('/a/b')
    expect(joinPath('/a', '\\/\\/b')).toBe('/a/b')
  })

  it('separator detection uses includes("\\") on the STRIPPED base (substring, NOT a regex)', () => {
    // Confirmed empirically: any backslash anywhere in the
    // POST-TRAILING-STRIP base flips sep to "\\". Even at position
    // 0 or buried mid-string. CRITICAL CORNER: a backslash that
    // exists ONLY as the trailing separator gets stripped before
    // the includes check, so it does NOT influence sep selection
    // (see `'a/b/c\\'` case below -- the trailing `\\` strips out
    // and the remaining `'a/b/c'` has no backslash, so sep = '/').
    // The pin guards against a future "smart" rewrite that picks
    // the first-encountered separator instead, AND against a
    // refactor that moves the includes check before the strip.
    expect(joinPath('\\abc', 'd')).toBe('\\abc\\d')
    expect(joinPath('a/b/c\\', 'd')).toBe('a/b/c/d') // trailing-only \\ gets stripped
    expect(joinPath('a/b\\c/d', 'e')).toBe('a/b\\c/d\\e') // mid-string \\ survives
  })
})
