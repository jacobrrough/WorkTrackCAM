/**
 * Tests for the bounded-read helper that feeds the pre-upload G-code
 * temperature validator on the Moonraker push path.
 *
 * Roadmap: [ID-0075] -- see `gcode-header-read.ts` for the design rationale.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DEFAULT_GCODE_HEADER_BYTES,
  readGcodeHeaderText
} from './gcode-header-read'

describe('readGcodeHeaderText [ID-0075]', () => {
  // Safety Rule 6: mkdtempSync with a per-suite prefix.
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'wtc-gcode-header-'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the entire file when it is smaller than maxBytes', () => {
    const path = join(dir, 'small.gcode')
    const content = '; PrusaSlicer 2.7.0\nM104 S210 ; nozzle\nM140 S60 ; bed\nG1 X10 Y10\n'
    writeFileSync(path, content, 'utf-8')

    const out = readGcodeHeaderText(path, 1024)

    expect(out).toBe(content)
    expect(out.length).toBeLessThanOrEqual(1024)
  })

  it('returns an empty string for an empty file', () => {
    const path = join(dir, 'empty.gcode')
    writeFileSync(path, '', 'utf-8')

    expect(readGcodeHeaderText(path)).toBe('')
  })

  it('reads exactly maxBytes when the file is larger than the cap', () => {
    const path = join(dir, 'large.gcode')
    const header = '; header\nM104 S210\nM140 S60\n'
    // Fill the remainder with a bulk body that brings total size well
    // past the default 128 KiB cap -- 300 KiB total leaves ~172 KiB of
    // tail that the bounded read must NOT decode.
    const bulk = 'G1 X0.1 Y0.1 E0.01\n'.repeat(15_000) // ~285 KiB
    writeFileSync(path, header + bulk, 'utf-8')

    const out = readGcodeHeaderText(path) // default cap = 128 KiB

    // Byte-length of the returned string must be <= the cap. UTF-8 encoded
    // length === string length for this ASCII-only content.
    expect(Buffer.byteLength(out, 'utf-8')).toBe(DEFAULT_GCODE_HEADER_BYTES)
    // Header region appears at the start of the read.
    expect(out.startsWith(header)).toBe(true)
    // Tail did not sneak in. Build a sentinel in the tail and assert it is
    // absent. (Append a distinctive marker past the cap; we'll rewrite the
    // file to include it so the assertion is meaningful.)
    const sentinel = '; [ID-0075] SENTINEL TAIL MARKER\n'
    writeFileSync(path, header + bulk + sentinel, 'utf-8')
    const out2 = readGcodeHeaderText(path)
    expect(Buffer.byteLength(out2, 'utf-8')).toBe(DEFAULT_GCODE_HEADER_BYTES)
    expect(out2.includes('SENTINEL TAIL MARKER')).toBe(false)
  })

  it('honors a caller-supplied maxBytes below the default', () => {
    const path = join(dir, 'custom-cap.gcode')
    const content = 'A'.repeat(2048)
    writeFileSync(path, content, 'utf-8')

    const out = readGcodeHeaderText(path, 512)

    expect(out.length).toBe(512)
    expect(out).toBe('A'.repeat(512))
  })

  it('falls back to the default cap when maxBytes is zero / negative / non-finite', () => {
    const path = join(dir, 'fallback.gcode')
    const content = 'B'.repeat(DEFAULT_GCODE_HEADER_BYTES + 2048)
    writeFileSync(path, content, 'utf-8')

    // 0, negative, NaN, Infinity, -Infinity -- all should fall back to default.
    for (const bad of [0, -1, -1024, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const out = readGcodeHeaderText(path, bad)
      expect(Buffer.byteLength(out, 'utf-8')).toBe(DEFAULT_GCODE_HEADER_BYTES)
    }
  })

  it('floors a non-integer maxBytes', () => {
    const path = join(dir, 'float.gcode')
    writeFileSync(path, 'C'.repeat(2048), 'utf-8')

    const out = readGcodeHeaderText(path, 513.9)

    // Floor of 513.9 is 513; exactly 513 bytes should come back.
    expect(out.length).toBe(513)
  })

  it('throws the underlying fs error for a missing file (ENOENT)', () => {
    const missing = join(dir, 'does-not-exist.gcode')

    expect(() => readGcodeHeaderText(missing)).toThrow(/ENOENT|no such file/i)
  })

  it('captures every slicer-emitted temperature command in the first 128 KiB even on a huge file', () => {
    // Regression-shape test: the whole reason [ID-0075] exists is to make
    // sure we do not lose temperature-validator coverage when we stop
    // reading past 128 KiB. Simulate a 5 MB sliced gcode where the full
    // PrusaSlicer header lives in the first ~2 KB.
    const path = join(dir, 'huge.gcode')
    const header = [
      '; PrusaSlicer 2.7.0',
      '; generated on 2026-04-24',
      'M140 S60',
      'M104 S210',
      'M141 S40',
      'M190 S60',
      'M109 S210',
      'G28',
      '',
    ].join('\n')
    const body = 'G1 X0.1 Y0.1 E0.01 F1200\n'.repeat(250_000) // ~6 MB
    writeFileSync(path, header + body, 'utf-8')

    const out = readGcodeHeaderText(path)

    // Every slicer-emitted command is present in the decoded prefix.
    for (const cmd of ['M140 S60', 'M104 S210', 'M141 S40', 'M190 S60', 'M109 S210']) {
      expect(out).toContain(cmd)
    }
    // And the bounded read did not pull the tail.
    expect(Buffer.byteLength(out, 'utf-8')).toBeLessThanOrEqual(DEFAULT_GCODE_HEADER_BYTES)
  })

  it('exports DEFAULT_GCODE_HEADER_BYTES = 128 KiB', () => {
    expect(DEFAULT_GCODE_HEADER_BYTES).toBe(131_072)
    expect(DEFAULT_GCODE_HEADER_BYTES).toBe(128 * 1024)
  })
})
