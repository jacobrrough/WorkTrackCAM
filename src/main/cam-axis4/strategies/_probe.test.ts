/**
 * Bindfs-stranded placeholder.
 *
 * This file was created as a one-off probe by the Cycle 232 hourly worker
 * while inspecting `generateIndexed` output to draft the canonical pin
 * file at `indexed-pin.test.ts`. The session's bindfs mount does not
 * permit unlinking even by the owning uid (`rm -f` returns "Operation
 * not permitted"); only the in-process Write tool can mutate. Reduced
 * to a single trivial assertion so vitest file-discovery does not error
 * and the file does not bias the skipped count.
 *
 * Not part of the canonical Cycle 232 [ID-0305] paired-pin work -- see
 * `src/main/cam-axis4/strategies/indexed-pin.test.ts` for that.
 */
import { describe, expect, it } from 'vitest'

describe('_probe placeholder (bindfs cannot unlink)', () => {
  it('exists as a single no-op assertion', () => {
    expect(1).toBe(1)
  })
})
