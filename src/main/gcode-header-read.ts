/**
 * Bounded-read helper for the pre-upload G-code temperature validator.
 *
 * Why not `readFileSync(path, 'utf-8')`?
 * -------------------------------------
 * Pre-[ID-0075], `moonraker-push.ts` called `readFileSync` with no size
 * cap to feed the pre-upload temperature validator. Sliced FDM G-code
 * files routinely cross 50 MB (and can approach 500 MB for dense
 * multi-material or high-resolution jobs), but every M104 / M109 / M140 /
 * M141 / M190 command and every `SET_HEATER_TEMPERATURE HEATER=chamber`
 * Klipper macro call emitted by PrusaSlicer / OrcaSlicer / Cura / Creality
 * Print all live in the slicer-emitted header -- typically under 20 KB.
 * A full-file read + UTF-8 decode is therefore two orders of magnitude
 * more memory + CPU than the validator actually needs.
 *
 * Design
 * ------
 * - Open the file read-only via `openSync`.
 * - Allocate a single `Buffer` of `min(maxBytes, fileSize)` bytes.
 * - One `readSync` into that buffer.
 * - `Buffer.toString('utf-8', 0, bytesRead)` to decode; `closeSync` in
 *   a `finally` to guarantee the fd is released even on decode errors.
 * - `DEFAULT_GCODE_HEADER_BYTES = 131072` (128 KiB) is conservatively
 *   ~6x the largest realistic slicer header. Raise if a future slicer
 *   moves temperature emission deeper into the file (none observed as
 *   of 2026-04).
 *
 * UTF-8 boundary safety
 * ---------------------
 * Slicer-emitted G-code is ASCII for all command lines; `;`-comments and
 * `(...)` comments are also ASCII in practice. Even if a multi-byte
 * codepoint straddles the read boundary, `Buffer.toString('utf-8')`
 * emits a `U+FFFD` replacement char for the partial sequence -- which
 * only appears in a comment, and the validator's comment stripper
 * discards the entire comment anyway. No parsing impact.
 *
 * Scope / Safety Rules
 * --------------------
 * Safety Rule 1 (G-code is sacred): this helper is READ-ONLY. It never
 * writes, never mutates, and never emits new G-code.
 * Safety Rule 2 (schema migrations): pure addition; no existing caller
 * signature changes. `moonraker-push.ts` swaps its `readFileSync` for
 * `readGcodeHeaderText` with no behavioral change on files ≤ the cap.
 *
 * Roadmap: [ID-0075] (this module), follow-up to [ID-0073] (pre-upload
 * guard) and [ID-0070] / [ID-0071] (the pure-function validator).
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'

/**
 * Default cap for the bounded header read. 128 KiB is roughly 6x the
 * largest slicer-emitted header observed in the wild; raise only if a
 * future slicer moves temperature commands past this depth.
 */
export const DEFAULT_GCODE_HEADER_BYTES = 131_072

/**
 * Read up to `maxBytes` of the G-code file at `gcodePath` as UTF-8 text.
 *
 * - If the file is smaller than `maxBytes`, returns the full file.
 * - If `maxBytes` ≤ 0 or non-finite, falls back to the default cap.
 * - Non-integer `maxBytes` is floored.
 * - Throws the underlying `fs` error (ENOENT, EACCES, ...) so the caller
 *   can surface it the same way a `readFileSync` failure would.
 */
export function readGcodeHeaderText(
  gcodePath: string,
  maxBytes: number = DEFAULT_GCODE_HEADER_BYTES
): string {
  const cap =
    Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.floor(maxBytes)
      : DEFAULT_GCODE_HEADER_BYTES

  const fileSize = statSync(gcodePath).size
  const readLen = Math.min(cap, fileSize)
  if (readLen <= 0) return ''

  const fd = openSync(gcodePath, 'r')
  try {
    const buf = Buffer.alloc(readLen)
    // readSync(fd, buffer, offset, length, position). `position = 0` anchors
    // the read at the start of the file regardless of the fd's current
    // position, which matters on some platforms when the same fd was
    // inherited.
    const bytesRead = readSync(fd, buf, 0, readLen, 0)
    if (bytesRead <= 0) return ''
    return buf.toString('utf-8', 0, bytesRead)
  } finally {
    closeSync(fd)
  }
}
