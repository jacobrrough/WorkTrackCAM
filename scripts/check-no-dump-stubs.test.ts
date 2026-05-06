/**
 * scripts/check-no-dump-stubs.test.ts -- TOMBSTONE
 *
 * The active paired-pin contract for the [ID-0150] check-no-dump-stubs gate
 * lives at:
 *
 *   src/shared/check-no-dump-stubs-gate.test.ts
 *
 * That file is inside both the vitest include glob (`src/**/*.test.{ts,tsx}`)
 * and the tsconfig.json include list. This file is OUTSIDE both of them and
 * is never executed or typechecked.
 *
 * Why this stub exists at all: an earlier draft of the contract was written
 * here by mistake during Cycle 111. The bind-mount blocked unlink, so the
 * file was repurposed as this tombstone redirect to keep the relocation
 * auditable rather than silent.
 */

export {}
