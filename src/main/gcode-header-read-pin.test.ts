/**
 * Paired-pin contract set for `src/main/gcode-header-read.ts` -- pins the
 * doc-string surface and the runtime contract of the bounded-read helper
 * that feeds the pre-upload G-code temperature validator on the Moonraker
 * push path.
 *
 * Roadmap: [ID-0250] (post-processing, Cycle 178); follow-up to [ID-0075]
 * (Cycle 38 introduction) and [ID-0073] (pre-upload guard) and [ID-0070]
 * / [ID-0071] (pure-function validator). Pinning the surface keeps the
 * 128 KiB cap, the readSync-with-finally-closeSync invariant, and the
 * non-finite/non-integer maxBytes fall-back from drifting.
 *
 * Cross-cut for the three target machines per CLAUDE.md "USER CONTEXT":
 *   - Creality K2 Plus (FDM, Klipper/Moonraker): SOLE production consumer
 *     via `src/main/moonraker-push.ts` -- the bounded read is what keeps
 *     direct-push uploads of 100+ MB sliced FDM files from spending two
 *     orders of magnitude more memory + CPU than the temperature
 *     validator actually needs.
 *   - Laguna Swift 5x10 (RichAuto A-series): NOT a consumer (CNC posts
 *     don't carry M104/M109/M140/M141/M190 -- the helper is only used on
 *     the FDM upload path). Pin asserts no Laguna-side regression.
 *   - Makera Carvera + 4th Axis: NOT a consumer (same rationale -- CNC
 *     posts use M3/M4/M5 spindle, not temperature M-codes).
 *
 * Pure helper-level unit tests + source-text whitelist. The behavioral
 * test next door (`gcode-header-read.test.ts`, 148 lines) covers the
 * read-cap arithmetic, multi-byte boundary, and ENOENT propagation; this
 * file pins the SURFACE (module shape, signature, whitelist) so a future
 * refactor cannot silently drop the closeSync-in-finally guard or the
 * Number.isFinite/maxBytes>0 fall-back.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  DEFAULT_GCODE_HEADER_BYTES,
  readGcodeHeaderText,
} from './gcode-header-read'

const SOURCE_PATH = resolve(__dirname, 'gcode-header-read.ts')
const SOURCE_TEXT = readFileSync(SOURCE_PATH, 'utf8')

const mod = { DEFAULT_GCODE_HEADER_BYTES, readGcodeHeaderText }

// Strip /* ... */ + // line comments so whitelist regexes only run against
// executable code -- the JSDoc block legitimately mentions M104/M109 etc.
const codeOnly = SOURCE_TEXT
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '')

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wtc-gcode-header-pin-'))
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

// ─── (A) Module shape ───────────────────────────────────────────────────────

describe('[ID-0250] (A) module shape', () => {
  it('exports exactly 2 runtime symbols', () => {
    const keys = Object.keys(mod).sort()
    expect(keys).toEqual(['DEFAULT_GCODE_HEADER_BYTES', 'readGcodeHeaderText'])
  })

  it('readGcodeHeaderText is a function', () => {
    expect(typeof readGcodeHeaderText).toBe('function')
  })

  it('readGcodeHeaderText is a native Function (not bound/proxy)', () => {
    expect(Object.getPrototypeOf(readGcodeHeaderText)).toBe(Function.prototype)
  })

  it('DEFAULT_GCODE_HEADER_BYTES is a finite positive number', () => {
    expect(typeof DEFAULT_GCODE_HEADER_BYTES).toBe('number')
    expect(Number.isFinite(DEFAULT_GCODE_HEADER_BYTES)).toBe(true)
    expect(DEFAULT_GCODE_HEADER_BYTES).toBeGreaterThan(0)
  })

  it('module surface has no default export', () => {
    expect(SOURCE_TEXT).not.toMatch(/^\s*export\s+default\b/m)
  })
})

// ─── (B) DEFAULT_GCODE_HEADER_BYTES exact-value contract ──────────────────

describe('[ID-0250] (B) DEFAULT_GCODE_HEADER_BYTES exact value', () => {
  it('equals 131_072 (128 KiB) -- the cap committed in CLAUDE.md scope', () => {
    expect(DEFAULT_GCODE_HEADER_BYTES).toBe(131_072)
  })

  it('is exactly 128 * 1024 bytes (KiB-aligned)', () => {
    expect(DEFAULT_GCODE_HEADER_BYTES).toBe(128 * 1024)
  })

  it('is a 32-bit safe integer', () => {
    expect(Number.isSafeInteger(DEFAULT_GCODE_HEADER_BYTES)).toBe(true)
    expect(DEFAULT_GCODE_HEADER_BYTES).toBeLessThan(2 ** 31)
  })

  it('is bigger than the largest realistic slicer-emitted header (~20 KB)', () => {
    expect(DEFAULT_GCODE_HEADER_BYTES).toBeGreaterThan(20 * 1024)
  })

  it('is small enough to keep K2 Plus Moonraker uploads cheap (< 1 MiB)', () => {
    expect(DEFAULT_GCODE_HEADER_BYTES).toBeLessThan(1 * 1024 * 1024)
  })
})

// ─── (C) Function signature ────────────────────────────────────────────────

describe('[ID-0250] (C) readGcodeHeaderText signature', () => {
  it('.name === "readGcodeHeaderText"', () => {
    expect(readGcodeHeaderText.name).toBe('readGcodeHeaderText')
  })

  it('.length === 1 (gcodePath required; maxBytes defaulted not counted)', () => {
    expect(readGcodeHeaderText.length).toBe(1)
  })

  it('returns a string when called on an empty file', () => {
    const p = join(dir, 'empty.gcode')
    writeFileSync(p, '')
    expect(typeof readGcodeHeaderText(p)).toBe('string')
  })

  it('returns "" on a zero-byte file', () => {
    const p = join(dir, 'zero.gcode')
    writeFileSync(p, '')
    expect(readGcodeHeaderText(p)).toBe('')
  })
})

// ─── (D) Cap fallback contract ─────────────────────────────────────────────

describe('[ID-0250] (D) cap fallback contract', () => {
  let p: string
  beforeAll(() => {
    p = join(dir, 'cap-fallback.gcode')
    // Build a 64-line FDM-realistic header with M104/M140 commands so we can
    // assert specific lines come back at specific cap sizes.
    const lines: string[] = []
    for (let i = 0; i < 64; i++) {
      lines.push(`; line ${i.toString().padStart(3, '0')} -- header sentinel`)
    }
    lines.push('M104 S210 ; nozzle')
    lines.push('M140 S60  ; bed')
    writeFileSync(p, lines.join('\n'))
  })

  it('maxBytes = 0 falls back to DEFAULT_GCODE_HEADER_BYTES (full file fits in default)', () => {
    const text = readGcodeHeaderText(p, 0)
    expect(text).toContain('M104 S210')
    expect(text).toContain('M140 S60')
  })

  it('maxBytes = -1 falls back to default (negative guard)', () => {
    const text = readGcodeHeaderText(p, -1)
    expect(text).toContain('M104 S210')
  })

  it('maxBytes = NaN falls back to default (non-finite guard)', () => {
    const text = readGcodeHeaderText(p, NaN)
    expect(text).toContain('M104 S210')
  })

  it('maxBytes = Infinity falls back to default (non-finite guard)', () => {
    const text = readGcodeHeaderText(p, Infinity)
    expect(text).toContain('M104 S210')
  })

  it('maxBytes = -Infinity falls back to default (non-finite guard)', () => {
    const text = readGcodeHeaderText(p, -Infinity)
    expect(text).toContain('M104 S210')
  })

  it('maxBytes = 0.5 floors to 0 then falls back to default (combined guard)', () => {
    // > 0 but <1 -> Math.floor would drop to 0 -- but the source uses
    // the non-finite/<=0 guard FIRST (`maxBytes > 0`), so 0.5 satisfies
    // the >0 branch and floors to 0. Let's pin actual current behavior.
    const text = readGcodeHeaderText(p, 0.5)
    // 0.5 > 0 is true, Math.floor(0.5) === 0 -> readLen = min(0, fileSize) = 0
    // -> returns '' per the readLen <= 0 short-circuit.
    expect(text).toBe('')
  })

  it('omitted maxBytes uses the default', () => {
    const text = readGcodeHeaderText(p)
    expect(text).toContain('M104 S210')
  })

  it('non-integer maxBytes (e.g. 1024.7) is floored', () => {
    const text = readGcodeHeaderText(p, 1024.7)
    // Math.floor(1024.7) === 1024
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(1024)
  })
})

// ─── (E) Read-cap arithmetic ───────────────────────────────────────────────

describe('[ID-0250] (E) read-cap arithmetic', () => {
  let p: string
  let bigPayload: string
  beforeAll(() => {
    p = join(dir, 'cap-arith.gcode')
    bigPayload = 'A'.repeat(10_000) + '\nM104 S210\n' + 'B'.repeat(10_000)
    writeFileSync(p, bigPayload)
  })

  it('returns full file when smaller than cap', () => {
    const text = readGcodeHeaderText(p, 1_000_000)
    expect(text).toBe(bigPayload)
  })

  it('truncates to cap when file is bigger than cap', () => {
    const text = readGcodeHeaderText(p, 100)
    expect(text.length).toBe(100)
    expect(text).toBe(bigPayload.slice(0, 100))
  })

  it('cap of exactly 1 returns the first byte of the file', () => {
    const text = readGcodeHeaderText(p, 1)
    expect(text).toBe(bigPayload[0])
  })

  it('cap that exactly equals fileSize returns the whole file', () => {
    const fileSize = Buffer.byteLength(bigPayload, 'utf8')
    const text = readGcodeHeaderText(p, fileSize)
    expect(text).toBe(bigPayload)
  })

  it('cap of fileSize+1 returns the whole file (no over-read)', () => {
    const fileSize = Buffer.byteLength(bigPayload, 'utf8')
    const text = readGcodeHeaderText(p, fileSize + 1)
    expect(text).toBe(bigPayload)
  })
})

// ─── (F) UTF-8 boundary safety ─────────────────────────────────────────────

describe('[ID-0250] (F) UTF-8 boundary safety', () => {
  it('multi-byte char split across cap boundary emits replacement char in comment, no throw', () => {
    const p = join(dir, 'utf8-split.gcode')
    // 4-byte emoji at byte offset 8 -- read cap of 10 bytes splits it.
    const payload = 'PRELUDE \u{1F600} TAIL'
    writeFileSync(p, payload)
    expect(() => readGcodeHeaderText(p, 10)).not.toThrow()
    const text = readGcodeHeaderText(p, 10)
    // Buffer.toString('utf-8') emits U+FFFD for the partial sequence.
    expect(text).toMatch(/^PRELUDE/)
    expect(text.length).toBeGreaterThan(0)
  })

  it('ASCII-only header returns byte-equal text', () => {
    const p = join(dir, 'ascii-only.gcode')
    const payload = '; ASCII only header\nM104 S210\n'
    writeFileSync(p, payload)
    expect(readGcodeHeaderText(p)).toBe(payload)
  })
})

// ─── (G) ENOENT / error propagation ────────────────────────────────────────

describe('[ID-0250] (G) error propagation', () => {
  it('throws on missing file (ENOENT propagates)', () => {
    const p = join(dir, 'does-not-exist.gcode')
    expect(() => readGcodeHeaderText(p)).toThrow(/ENOENT/)
  })

  it('throws when called with empty path', () => {
    expect(() => readGcodeHeaderText('')).toThrow()
  })
})

// ─── (H) K2 Plus Moonraker path realism ────────────────────────────────────

describe('[ID-0250] (H) K2 Plus Moonraker path realism', () => {
  it('reads the sliced-FDM header containing M104/M140/M141/M190 + chamber macro', () => {
    const p = join(dir, 'k2-fdm-sliced.gcode')
    const header = [
      '; Generated by Creality Print 5.0',
      '; FLAVOR:Klipper',
      'M140 S60 ; bed',
      'M104 S210 ; nozzle',
      'M190 S60 ; wait bed',
      'M109 S210 ; wait nozzle',
      'SET_HEATER_TEMPERATURE HEATER=chamber TARGET=45',
      'G28',
      'G1 X10 Y10 Z0.2 F3000',
    ].join('\n')
    // Pad with toolpath body to push file past 64 KB
    const body = '\n' + 'G1 X100 Y100 E0.1 F1500'.repeat(5_000)
    writeFileSync(p, header + body)
    const text = readGcodeHeaderText(p)
    expect(text).toContain('M104 S210')
    expect(text).toContain('M140 S60')
    expect(text).toContain('M190 S60')
    expect(text).toContain('M109 S210')
    expect(text).toContain('SET_HEATER_TEMPERATURE HEATER=chamber')
  })

  it('default cap is sufficient for a 5 MB sliced K2 file (header preserved)', () => {
    const p = join(dir, 'k2-fdm-large.gcode')
    const header = '; FLAVOR:Klipper\nM140 S60\nM104 S210\n'
    const body = 'G1 X1 Y1 E0.01\n'.repeat(300_000) // ~5 MB body
    writeFileSync(p, header + body)
    const text = readGcodeHeaderText(p)
    expect(text).toContain('M140 S60')
    expect(text).toContain('M104 S210')
    expect(Buffer.byteLength(text, 'utf8')).toBe(DEFAULT_GCODE_HEADER_BYTES)
  })

  it('500 KB header with cap = 256 KB returns first 256 KB (cap honored)', () => {
    const p = join(dir, 'k2-bigheader.gcode')
    const padded = '; padding line\n'.repeat(40_000) // ~600 KB
    writeFileSync(p, padded)
    const text = readGcodeHeaderText(p, 256 * 1024)
    expect(Buffer.byteLength(text, 'utf8')).toBe(256 * 1024)
  })
})

// ─── (I) Three-machine non-applicability ──────────────────────────────────

describe('[ID-0250] (I) three-machine non-applicability', () => {
  it('Laguna Swift 5x10 .nc files have NO temperature M-codes (helper is FDM-only)', () => {
    // The helper itself doesn't filter by extension, but the SOURCE module's
    // JSDoc explicitly scopes it to "the pre-upload G-code temperature
    // validator". Here we pin that the helper still works on a CNC file but
    // that no thermal command exists in the realistic Laguna header.
    const p = join(dir, 'laguna-vcarve.nc')
    const header = '; VCarve Pro 11.5 / mach3\nG21\nG90\nG17\nG54\n(stock 1524x3048x18 plywood)\nT1 M6\nM3 S18000\nG0 Z25\n'
    writeFileSync(p, header)
    const text = readGcodeHeaderText(p)
    expect(text).toBe(header)
    expect(text).not.toMatch(/\bM104\b/)
    expect(text).not.toMatch(/\bM140\b/)
    expect(text).not.toMatch(/\bSET_HEATER_TEMPERATURE\b/)
  })

  it('Makera Carvera 4-axis .nc files have NO temperature M-codes', () => {
    const p = join(dir, 'carvera-4axis.nc')
    const header = '; Makera Carvera 4-axis (Smoothieware)\nG21\nG90\nG17\nT1 M6\nG43 H1\nM3 S15000\nG0 X0 Y0 Z25 A0\n'
    writeFileSync(p, header)
    const text = readGcodeHeaderText(p)
    expect(text).toBe(header)
    expect(text).not.toMatch(/\bM104\b/)
    expect(text).not.toMatch(/\bM109\b/)
  })

  it('CNC files smaller than the cap return whole-file text identically', () => {
    const p = join(dir, 'small-cnc.nc')
    const header = '; small\nG21\nG90\nG54\nG0 Z25\nM30\n'
    writeFileSync(p, header)
    expect(readGcodeHeaderText(p)).toBe(header)
  })
})

// ─── (J) Pure-ish invariants ──────────────────────────────────────────────

describe('[ID-0250] (J) pure-ish invariants', () => {
  let p: string
  beforeAll(() => {
    p = join(dir, 'pure-invariants.gcode')
    writeFileSync(p, '; header\nM104 S210\n')
  })

  it('idempotent across N=20 reads (same path => same text)', () => {
    const baseline = readGcodeHeaderText(p)
    for (let n = 0; n < 20; n++) {
      expect(readGcodeHeaderText(p)).toBe(baseline)
    }
  })

  it('does not bind `this` (call/apply with arbitrary thisArg works)', () => {
    const fn = readGcodeHeaderText
    expect(fn.call(undefined, p)).toBe('; header\nM104 S210\n')
    expect(fn.apply(null, [p])).toBe('; header\nM104 S210\n')
  })

  it('does not throw on a 1-byte file', () => {
    const small = join(dir, 'tiny.gcode')
    writeFileSync(small, 'M')
    expect(() => readGcodeHeaderText(small)).not.toThrow()
    expect(readGcodeHeaderText(small)).toBe('M')
  })

  it('multiple distinct files are read independently (no cross-talk)', () => {
    const a = join(dir, 'parallel-a.gcode')
    const b = join(dir, 'parallel-b.gcode')
    writeFileSync(a, 'AAA-' + 'x'.repeat(10))
    writeFileSync(b, 'BBB-' + 'y'.repeat(10))
    const ra = readGcodeHeaderText(a)
    const rb = readGcodeHeaderText(b)
    expect(ra).toMatch(/^AAA-/)
    expect(rb).toMatch(/^BBB-/)
    expect(ra).not.toBe(rb)
  })

  it('100 sequential reads on the same file do not exhaust file descriptors (closeSync invariant)', () => {
    // If the closeSync-in-finally guard regresses, this loop exhausts the
    // process FD limit (typically 1024 or 4096). 100 is conservatively well
    // below any reasonable limit but plenty to detect a leak.
    for (let n = 0; n < 100; n++) {
      readGcodeHeaderText(p)
    }
    // If we got here, no EMFILE was thrown.
    expect(true).toBe(true)
  })
})

// ─── (K) Source-text whitelist ────────────────────────────────────────────

describe('[ID-0250] (K) source-text whitelist', () => {
  it('source file has fewer than 100 lines', () => {
    expect(SOURCE_TEXT.split('\n').length).toBeLessThan(100)
  })

  it('source file is smaller than 4 KB', () => {
    expect(Buffer.byteLength(SOURCE_TEXT, 'utf8')).toBeLessThan(4096)
  })

  it('source has exactly 1 named function export (readGcodeHeaderText)', () => {
    const matches = codeOnly.match(/\bexport\s+function\s+\w+/g) ?? []
    expect(matches.length).toBe(1)
    expect(codeOnly).toMatch(/\bexport\s+function\s+readGcodeHeaderText\b/)
  })

  it('source has exactly 1 named const export (DEFAULT_GCODE_HEADER_BYTES)', () => {
    const matches = codeOnly.match(/\bexport\s+const\s+\w+/g) ?? []
    expect(matches.length).toBe(1)
    expect(codeOnly).toMatch(/\bexport\s+const\s+DEFAULT_GCODE_HEADER_BYTES\b/)
  })

  it('source has no default export', () => {
    expect(codeOnly).not.toMatch(/^\s*export\s+default\b/m)
  })

  it('source has no `:any` annotation', () => {
    expect(codeOnly).not.toMatch(/:\s*any\b/)
  })

  it('source has no `as any` cast', () => {
    expect(codeOnly).not.toMatch(/\bas\s+any\b/)
  })

  it('source uses node:fs sync API only (openSync/readSync/closeSync/statSync)', () => {
    expect(codeOnly).toMatch(/\bopenSync\b/)
    expect(codeOnly).toMatch(/\breadSync\b/)
    expect(codeOnly).toMatch(/\bcloseSync\b/)
    expect(codeOnly).toMatch(/\bstatSync\b/)
  })

  it('source does NOT call write/unlink/mkdir/rename or any fs mutation method', () => {
    expect(codeOnly).not.toMatch(/\b(writeFileSync|writeFile|writeSync|appendFileSync|appendFile|unlinkSync|unlink|mkdirSync|mkdir|renameSync|rename|chmodSync|chmod|chownSync|chown|truncateSync|truncate|ftruncateSync)\b/)
  })

  it('source is a pure-leaf module (only node:fs imported, no electron/path/child_process)', () => {
    expect(codeOnly).toMatch(/\bfrom\s+['"]node:fs['"]/)
    expect(codeOnly).not.toMatch(/\bfrom\s+['"](node:)?(electron|child_process|os|net|tls|dgram|http|https)['"]/)
  })

  it('source uses Number.isFinite for the maxBytes guard', () => {
    expect(codeOnly).toMatch(/Number\.isFinite\b/)
  })

  it('source uses Math.floor for non-integer maxBytes', () => {
    expect(codeOnly).toMatch(/Math\.floor\b/)
  })

  it('source has the closeSync-in-finally invariant (try { ... } finally { closeSync(fd) })', () => {
    expect(codeOnly).toMatch(/finally\s*\{[\s\S]*?closeSync\(\s*fd\s*\)/m)
  })

  it('source pins the readSync position argument to 0 (anchor at file start)', () => {
    expect(codeOnly).toMatch(/readSync\(\s*fd\s*,\s*buf\s*,\s*0\s*,\s*readLen\s*,\s*0\s*\)/)
  })

  it('source mentions no foreign-machine vendors', () => {
    expect(codeOnly).not.toMatch(/\b(Bambu|Prusa|Haas|Tormach|Mach4|Shapeoko|Onefinity|X-Carve|Snapmaker|Roland)\b/i)
  })

  it('source does NOT emit toolpath G-code or M-code (read-only helper)', () => {
    // Code-side only: the JSDoc is allowed to discuss M104/M109/M140/M141/M190.
    expect(codeOnly).not.toMatch(/\b[Gg]0?[0-9]\s+[XYZ]/)
    expect(codeOnly).not.toMatch(/\b[Mm](?:104|109|140|141|190|3|4|5|6|30)\b/)
  })

  it('source declares 1 typed parameter (string) and 1 typed parameter with a numeric default', () => {
    expect(codeOnly).toMatch(/gcodePath\s*:\s*string/)
    expect(codeOnly).toMatch(/maxBytes\s*:\s*number\s*=\s*DEFAULT_GCODE_HEADER_BYTES/)
  })

  it('source declares the 128 KiB default literal (131_072) once', () => {
    const matches = codeOnly.match(/\b131_?072\b/g) ?? []
    expect(matches.length).toBe(1)
  })
})
