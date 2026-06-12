/**
 * Sketch S2 -- the DXF-import undo-step RACE FIX regression suite + the S2
 * node-edit history wiring pins on SketchSurface.
 *
 * THE S1 BUG (what must never come back): `handleImportDxfClick` recorded the
 * import's undo step by comparing `liveDesignRef.current !== before` inside a
 * `finally` that can run BEFORE React re-renders the surface with the host's
 * session edit. On that ordering the comparison saw the STALE pre-import
 * design and silently skipped `history.push(before)` -- the import landed but
 * Ctrl+Z could not undo it.
 *
 * THE FIX: the host resolves its `onImportDxf` promise WITH the merged design
 * it applied; the surface decides through the exported pure
 * `resolveDxfImportCommit(before, resolvedMerged, liveAfter)` -- a decision
 * that depends only on values the await chain owns. The unit below replays
 * the EXACT race ordering (resolved merged design, live ref NOT yet flushed)
 * and fails against the old live-ref logic by construction.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { resolveDxfImportCommit } from '../SketchSurface'
import { createSketchHistory } from '../sketch-history'
import { emptyDesign, type DesignFileV2, type SketchEntity } from '../../../shared/design-schema'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SURFACE = readFileSync(join(__dirname, '..', 'SketchSurface.tsx'), 'utf8')
const HOST = readFileSync(join(__dirname, '..', '..', 'app', 'DesignWorkspaceHost.tsx'), 'utf8')
const WORKSPACE = readFileSync(join(__dirname, '..', 'DesignWorkspace.tsx'), 'utf8')

const RECT: SketchEntity = { id: 'r1', kind: 'rect', cx: 0, cy: 0, w: 20, h: 10, rotation: 0 }

describe('resolveDxfImportCommit -- the deterministic one-undo-step decision', () => {
  it('THE RACE ORDERING: merged design resolved, live ref NOT yet flushed -> still records', () => {
    const before = emptyDesign()
    const merged: DesignFileV2 = { ...before, entities: [RECT] }

    // React has NOT re-rendered: the surface live ref still points at `before`.
    const commit = resolveDxfImportCommit(before, merged, before)

    expect(commit.record).toBe(true)
    expect(commit.live).toBe(merged)

    // Documentation of the S1 bug this kills: the old decision compared the
    // live ref only -- on this exact ordering it evaluated false and skipped
    // the push. The new decision above records regardless of flush timing.
    const oldS1LiveRefDecision = (before as DesignFileV2) !== before
    expect(oldS1LiveRefDecision).toBe(false)
  })

  it('already-flushed ordering records identically (decision is flush-independent)', () => {
    const before = emptyDesign()
    const merged: DesignFileV2 = { ...before, entities: [RECT] }
    const commit = resolveDxfImportCommit(before, merged, merged)
    expect(commit.record).toBe(true)
    expect(commit.live).toBe(merged)
  })

  it('host resolved the SAME reference (nothing imported) -> records nothing', () => {
    const before = emptyDesign()
    const commit = resolveDxfImportCommit(before, before, before)
    expect(commit.record).toBe(false)
    expect(commit.live).toBe(before)
  })

  it('legacy void host (null): falls back to the live-ref comparison, both ways', () => {
    const before = emptyDesign()
    const changed: DesignFileV2 = { ...before, entities: [RECT] }
    expect(resolveDxfImportCommit(before, null, changed)).toEqual({ record: true, live: changed })
    expect(resolveDxfImportCommit(before, null, before)).toEqual({ record: false, live: before })
  })
})

describe('handleImportDxfClick harness -- the full surface walk over the REAL ring', () => {
  /** Mirrors the component handler body (source-pinned below + in the history test). */
  async function importClick(
    host: (liveRef: { current: DesignFileV2 }) => Promise<DesignFileV2 | null | void>,
    liveRef: { current: DesignFileV2 },
    history: ReturnType<typeof createSketchHistory>
  ): Promise<void> {
    const before = liveRef.current
    let resolvedMerged: DesignFileV2 | null = null
    try {
      const result = await host(liveRef)
      resolvedMerged = typeof result === 'object' && result !== null ? result : null
    } finally {
      const commit = resolveDxfImportCommit(before, resolvedMerged, liveRef.current)
      liveRef.current = commit.live
      if (commit.record) history.push(before)
    }
  }

  it('race ordering end-to-end: undo lands back on the PRE-import design', async () => {
    const before = emptyDesign()
    const merged: DesignFileV2 = { ...before, entities: [RECT] }
    const liveRef = { current: before }
    const history = createSketchHistory()

    // The host applies via the SESSION (the surface live ref does NOT see it
    // before the await settles -- the exact S1 race) and resolves the merge.
    await importClick(async () => merged, liveRef, history)

    expect(liveRef.current).toBe(merged) // surface treats the merge as live
    expect(history.canUndo()).toBe(true)
    expect(history.undoDepth()).toBe(1) // exactly ONE step for the import
    const undone = history.undo(liveRef.current)
    expect(undone).toEqual(before)
  })

  it('cancelled picker (host resolves null, nothing applied) records nothing', async () => {
    const before = emptyDesign()
    const liveRef = { current: before }
    const history = createSketchHistory()
    await importClick(async () => null, liveRef, history)
    expect(history.canUndo()).toBe(false)
    expect(liveRef.current).toBe(before)
  })

  it('legacy void host that flushed before settle still records (back-compat path)', async () => {
    const before = emptyDesign()
    const merged: DesignFileV2 = { ...before, entities: [RECT] }
    const liveRef = { current: before }
    const history = createSketchHistory()
    await importClick(async (ref) => {
      ref.current = merged // a flush that DID land before the finally
    }, liveRef, history)
    expect(history.undoDepth()).toBe(1)
    expect(history.undo(liveRef.current)).toEqual(before)
  })

  it('throwing host records nothing (finally still settles the live ref)', async () => {
    const before = emptyDesign()
    const liveRef = { current: before }
    const history = createSketchHistory()
    await expect(
      importClick(async () => {
        throw new Error('boom')
      }, liveRef, history)
    ).rejects.toThrow('boom')
    expect(history.canUndo()).toBe(false)
    expect(liveRef.current).toBe(before)
  })
})

describe('source pins -- the fix is wired end-to-end (surface, host, workspace)', () => {
  it('SketchSurface: the import handler decides through resolveDxfImportCommit (never the bare ref compare)', () => {
    expect(SURFACE).toContain(
      'const commit = resolveDxfImportCommit(before, resolvedMerged, liveDesignRef.current)'
    )
    expect(SURFACE).toContain('liveDesignRef.current = commit.live')
    expect(SURFACE).not.toMatch(/if \(liveDesignRef\.current !== before\) \{\s*history\.push\(before\)/)
  })

  it('SketchSurface: onImportDxf may resolve the merged design (widened, backward-compatible)', () => {
    expect(SURFACE).toContain(
      'readonly onImportDxf?: () => void | DesignFileV2 | null | Promise<void | DesignFileV2 | null>'
    )
  })

  it('DesignWorkspaceHost: handleImportDxf RESOLVES the merged design; every no-op path resolves null', () => {
    expect(HOST).toContain(
      'const handleImportDxf = useCallback(async (): Promise<DesignFileV2 | null> => {'
    )
    expect((HOST.match(/return null/g) ?? []).length).toBeGreaterThanOrEqual(5)
    expect((HOST.match(/return design/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('DesignWorkspace: the pass-through prop type is widened to carry the merged design', () => {
    expect(WORKSPACE).toContain('| Promise<void | DesignFileV2 | null>')
  })
})

describe('source pins -- S2 node-edit callbacks route through the S1 history seam', () => {
  it('node move coalesces per node-drag (one undo step per gesture)', () => {
    expect(SURFACE).toMatch(
      /function handleNodeMove\(entityId: string, nodeId: string, point: readonly \[number, number\]\): void \{[\s\S]{0,400}?history\.pushCoalesced\(cur, `node:\$\{entityId\}:\$\{nodeId\}`\)/
    )
  })

  it('node insert + node delete record exactly ONE plain push each', () => {
    const insertBody = SURFACE.slice(
      SURFACE.indexOf('function handleNodeInsert'),
      SURFACE.indexOf('function handleNodeDelete')
    )
    const deleteBody = SURFACE.slice(
      SURFACE.indexOf('function handleNodeDelete'),
      SURFACE.indexOf('const canvasSelectionBridge')
    )
    expect(insertBody.match(/history\.push\(/g) ?? []).toHaveLength(1)
    expect(deleteBody.match(/history\.push\(/g) ?? []).toHaveLength(1)
    expect(insertBody).toContain('insertPolylineNode(cur, entityId, segmentIndex, point)')
    expect(deleteBody).toContain('deletePolylineNode(cur, entityId, nodeId)')
  })

  it('the bridge hands all three S2 callbacks to the canvas', () => {
    expect(SURFACE).toContain('onNodeMove: handleNodeMove')
    expect(SURFACE).toContain('onNodeInsert: handleNodeInsert')
    expect(SURFACE).toContain('onNodeDelete: handleNodeDelete')
  })

  it('no `any` types in the S2 surface code (CLAUDE.md rule)', () => {
    expect(SURFACE).not.toMatch(/:\s*any\b/)
    expect(SURFACE).not.toMatch(/as any\b/)
  })
})
