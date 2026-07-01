/**
 * Coercion tests for the ``'quadrant'`` drawing-snap kind through the main-process
 * IPC layer (``V15_SNAP_KINDS`` + ``v15CoerceExtractDrawingGeometryResult`` →
 * ``coerceDrawingSnapPoint``).
 *
 * The sidecar's ``_emit_circle_snaps`` emits ``'quadrant'`` candidates (the
 * 0/90/180/270° points on full circles — holes / bosses). Before this fix the TS
 * whitelist omitted ``'quadrant'`` and the coercer silently dropped those points
 * before the renderer ever saw them. These tests prove a quadrant snap now
 * survives coercion while the four legacy kinds keep working and true garbage is
 * still rejected.
 *
 * Three-machine context: drawing snap feeds the Laguna Swift 5x10 and Makera
 * Carvera drawing/section-view dimension workflows. Renderer-only path — never
 * touches G-code / STL (Safety Rule 1).
 */
import { describe, expect, it } from 'vitest'
import { V15_SNAP_KINDS, v15CoerceExtractDrawingGeometryResult } from './ipc-cad'

function snap(id: string, kind: string): Record<string, unknown> {
  return { id, x: 10, y: 20, kind, sourceId: `src-${id}` }
}

function geometry(snapPoints: unknown[]): Record<string, unknown> {
  return { view: 'front', vertices: [], edges: [], snapPoints }
}

describe('V15_SNAP_KINDS whitelist includes quadrant', () => {
  it('contains all five kinds including quadrant', () => {
    expect([...V15_SNAP_KINDS].sort()).toEqual([
      'center',
      'endpoint',
      'midpoint',
      'quadrant',
      'vertex',
    ])
  })
})

describe("v15CoerceExtractDrawingGeometryResult — 'quadrant' survives coercion", () => {
  it('keeps a well-formed quadrant snap point (previously dropped)', () => {
    const result = v15CoerceExtractDrawingGeometryResult(geometry([snap('q1', 'quadrant')]))
    expect(result).not.toBeNull()
    expect(result!.snapPoints).toHaveLength(1)
    expect(result!.snapPoints[0].kind).toBe('quadrant')
    expect(result!.snapPoints[0].id).toBe('q1')
    expect(result!.snapPoints[0].sourceId).toBe('src-q1')
  })

  it('keeps all five kinds together in one projection', () => {
    const result = v15CoerceExtractDrawingGeometryResult(
      geometry([
        snap('v', 'vertex'),
        snap('e', 'endpoint'),
        snap('m', 'midpoint'),
        snap('c', 'center'),
        snap('q', 'quadrant'),
      ]),
    )
    expect(result).not.toBeNull()
    const kinds = result!.snapPoints.map((s) => s.kind).sort()
    expect(kinds).toEqual(['center', 'endpoint', 'midpoint', 'quadrant', 'vertex'])
  })

  it('still drops an unknown kind while keeping a valid quadrant', () => {
    const result = v15CoerceExtractDrawingGeometryResult(
      geometry([snap('q', 'quadrant'), snap('bad', 'bogus-kind')]),
    )
    expect(result).not.toBeNull()
    expect(result!.snapPoints).toHaveLength(1)
    expect(result!.snapPoints[0].kind).toBe('quadrant')
  })

  it('drops a quadrant entry missing sourceId (defense-in-depth unchanged)', () => {
    const result = v15CoerceExtractDrawingGeometryResult(
      geometry([{ id: 'q', x: 1, y: 2, kind: 'quadrant' }]),
    )
    expect(result).not.toBeNull()
    expect(result!.snapPoints).toHaveLength(0)
  })
})
