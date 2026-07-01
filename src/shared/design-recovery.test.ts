/**
 * AUTOSAVE + CRASH RECOVERY - pure decide-to-offer logic + snapshot schema.
 *
 * These are the node-suite tests for the recovery-offer gate: the newer-than
 * comparison against the persisted sketch mtime, safe rejection of
 * schema-invalid recovery files, the same-content suppression, and the
 * wrong-project echo check. The IPC/store halves are covered in
 * src/main/design-recovery-store.test.ts + src/main/ipc-recovery.test.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  decideRecoveryOffer,
  designRecoverySnapshotSchema,
  type DesignRecoveryReadResult,
  type DesignRecoverySnapshot
} from './design-recovery'
import { emptyDesign, type DesignFileV2 } from './design-schema'

const PROJECT = 'C:/Users/jacob/projects/bracket'

function designWithRect(): DesignFileV2 {
  return {
    ...emptyDesign(),
    entities: [{ id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 50, h: 30, rotation: 0 }]
  }
}

function snapshot(overrides: Partial<DesignRecoverySnapshot> = {}): DesignRecoverySnapshot {
  return {
    version: 1,
    projectDir: PROJECT,
    savedAtMs: 2_000,
    design: designWithRect(),
    ...overrides
  }
}

function okRead(
  snap: DesignRecoverySnapshot,
  persistedDesignMtimeMs: number | null
): DesignRecoveryReadResult {
  return { ok: true, snapshot: snap, persistedDesignMtimeMs }
}

describe('designRecoverySnapshotSchema', () => {
  it('accepts a valid snapshot round-trip (design validated by the REAL schema)', () => {
    const parsed = designRecoverySnapshotSchema.safeParse(snapshot())
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.projectDir).toBe(PROJECT)
      expect(parsed.data.design.entities).toHaveLength(1)
    }
  })

  it('rejects an unknown version (no silent forward-compat guessing)', () => {
    expect(
      designRecoverySnapshotSchema.safeParse({ ...snapshot(), version: 2 }).success
    ).toBe(false)
  })

  it('rejects a missing design payload', () => {
    const { design: _drop, ...rest } = snapshot()
    expect(designRecoverySnapshotSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a corrupt design payload (schema-invalid entity)', () => {
    const bad = {
      ...snapshot(),
      design: { ...emptyDesign(), entities: [{ id: 'x', kind: 'rect', w: -5 }] }
    }
    expect(designRecoverySnapshotSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects non-finite / negative savedAtMs', () => {
    expect(
      designRecoverySnapshotSchema.safeParse({ ...snapshot(), savedAtMs: Number.NaN }).success
    ).toBe(false)
    expect(
      designRecoverySnapshotSchema.safeParse({ ...snapshot(), savedAtMs: -1 }).success
    ).toBe(false)
  })

  it('rejects an empty projectDir', () => {
    expect(
      designRecoverySnapshotSchema.safeParse({ ...snapshot(), projectDir: '' }).success
    ).toBe(false)
  })
})

describe('decideRecoveryOffer - the pure offer gate', () => {
  it('no snapshot file -> no offer', () => {
    expect(
      decideRecoveryOffer({ ok: false, reason: 'none' }, { projectDir: PROJECT, loadedDesign: null })
    ).toEqual({ offer: false, reason: 'no_snapshot' })
  })

  it('schema-invalid recovery file -> rejected safely, never offered', () => {
    expect(
      decideRecoveryOffer({ ok: false, reason: 'invalid' }, { projectDir: PROJECT, loadedDesign: null })
    ).toEqual({ offer: false, reason: 'invalid_snapshot' })
  })

  it('read failure -> treated like no snapshot (never blocks project open)', () => {
    expect(
      decideRecoveryOffer({ ok: false, reason: 'read_failed' }, { projectDir: PROJECT, loadedDesign: null })
    ).toEqual({ offer: false, reason: 'no_snapshot' })
  })

  it('snapshot for a DIFFERENT project -> wrong_project (hash-collision guard)', () => {
    const read = okRead(snapshot({ projectDir: 'C:/other/project' }), null)
    expect(decideRecoveryOffer(read, { projectDir: PROJECT, loadedDesign: null })).toEqual({
      offer: false,
      reason: 'wrong_project'
    })
  })

  it('snapshot OLDER than the persisted sketch -> stale (the newer-than comparison)', () => {
    const read = okRead(snapshot({ savedAtMs: 1_000 }), 5_000)
    expect(decideRecoveryOffer(read, { projectDir: PROJECT, loadedDesign: emptyDesign() })).toEqual({
      offer: false,
      reason: 'stale_snapshot'
    })
  })

  it('snapshot EQUAL to the persisted sketch mtime -> stale (<= is not newer)', () => {
    const read = okRead(snapshot({ savedAtMs: 5_000 }), 5_000)
    expect(decideRecoveryOffer(read, { projectDir: PROJECT, loadedDesign: emptyDesign() })).toEqual({
      offer: false,
      reason: 'stale_snapshot'
    })
  })

  it('snapshot NEWER than disk + different content -> OFFER', () => {
    const snap = snapshot({ savedAtMs: 9_000 })
    const read = okRead(snap, 5_000)
    const decision = decideRecoveryOffer(read, { projectDir: PROJECT, loadedDesign: emptyDesign() })
    expect(decision.offer).toBe(true)
    if (decision.offer) expect(decision.snapshot).toBe(snap)
  })

  it('no persisted sketch on disk (mtime null) + content differs -> OFFER', () => {
    const read = okRead(snapshot(), null)
    const decision = decideRecoveryOffer(read, { projectDir: PROJECT, loadedDesign: emptyDesign() })
    expect(decision.offer).toBe(true)
  })

  it('snapshot identical to the loaded design -> suppressed (restoring is noise)', () => {
    const read = okRead(snapshot({ savedAtMs: 9_000 }), 5_000)
    expect(
      decideRecoveryOffer(read, { projectDir: PROJECT, loadedDesign: designWithRect() })
    ).toEqual({ offer: false, reason: 'same_as_loaded' })
  })

  it('null loadedDesign skips the content check but still offers', () => {
    const read = okRead(snapshot({ savedAtMs: 9_000 }), 5_000)
    expect(decideRecoveryOffer(read, { projectDir: PROJECT, loadedDesign: null }).offer).toBe(true)
  })

  it('NEVER applies anything - the decision is data only (no design mutation)', () => {
    const loaded = emptyDesign()
    const before = JSON.stringify(loaded)
    decideRecoveryOffer(okRead(snapshot({ savedAtMs: 9_000 }), 5_000), {
      projectDir: PROJECT,
      loadedDesign: loaded
    })
    expect(JSON.stringify(loaded)).toBe(before)
  })
})
