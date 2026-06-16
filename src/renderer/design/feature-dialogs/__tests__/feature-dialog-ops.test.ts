/**
 * FG-5b · Pure op-builder + parse-helper tests.
 *
 * The single most important contract this whole feature carries: a dialog must
 * NEVER emit a kernel op that the schema would reject, because that op gets
 * persisted into `part/features.json` `kernelOps[]` and replayed by a Build STEP
 * (CLAUDE.md Safety Rule 1 — bad kernel/G-code ruins parts). So every builder's
 * output is round-tripped through the REAL `kernelPostSolidOpSchema` here.
 *
 * These are pure functions (no React, no DOM), so they run in the existing
 * `node` vitest env with zero rendering.
 */

import { describe, expect, it } from 'vitest'
import { kernelPostSolidOpSchema } from '../../../../shared/part-features-schema'
import { buildFilletOp } from '../FilletDialog'
import { buildChamferOp } from '../ChamferDialog'
import { buildShellOp } from '../ShellDialog'
import { buildHoleOp } from '../HoleDialog'
import { buildDatumPlaneOp } from '../DatumPlaneDialog'
import { buildDatumAxisOp } from '../DatumAxisDialog'
import { buildDatumPointOp } from '../DatumPointDialog'
import {
  EDGE_DIRECTION_OPTIONS,
  parseClampedInt,
  parseFiniteMm,
  parsePositiveMm,
  pickedOcctIdFor,
  resolvePickedSelectionId
} from '../feature-dialog-types'
import {
  makeEdgeSelection,
  makeFaceSelection,
  makeVertexSelection
} from '../../selection-state'
import { buildPickIndex } from '../../../../shared/kernel-pick-file'
import type {
  CadEdgeSignature,
  CadFaceSignature,
  CadTessellateWithIdsResult
} from '../../../../shared/sidecar-protocol'

describe('FG-5b op builders emit schema-valid kernel ops', () => {
  describe('buildFilletOp', () => {
    it('builds fillet_all when mode is "all" (ignores the direction)', () => {
      const op = buildFilletOp(2.5, 'all', '+Z')
      expect(op).toEqual({ kind: 'fillet_all', radiusMm: 2.5 })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('builds fillet_select carrying the axis bucket when mode is "select"', () => {
      for (const dir of EDGE_DIRECTION_OPTIONS) {
        const op = buildFilletOp(1, 'select', dir)
        expect(op).toEqual({ kind: 'fillet_select', radiusMm: 1, edgeDirection: dir })
        expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
      }
    })

    it('FG-5b: layers pickedEdgeIds onto fillet_select when a stable edge id is passed', () => {
      const op = buildFilletOp(1.5, 'select', '+Z', 'e:abc123')
      expect(op).toEqual({
        kind: 'fillet_select',
        radiusMm: 1.5,
        edgeDirection: '+Z',
        pickedEdgeIds: ['e:abc123']
      })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('FG-5b: ignores a picked edge id in "all" mode (fillet_all has no targeting)', () => {
      const op = buildFilletOp(2, 'all', '+Z', 'e:abc123')
      expect(op).toEqual({ kind: 'fillet_all', radiusMm: 2 })
      expect(op).not.toHaveProperty('pickedEdgeIds')
    })

    it('FG-5b: a null / empty picked id omits the field (schema rejects empty arrays)', () => {
      const op = buildFilletOp(2, 'select', '+Z', null)
      expect(op).not.toHaveProperty('pickedEdgeIds')
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })
  })

  describe('buildChamferOp', () => {
    it('builds chamfer_all when mode is "all"', () => {
      const op = buildChamferOp(1.2, 'all', '-X')
      expect(op).toEqual({ kind: 'chamfer_all', lengthMm: 1.2 })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('builds chamfer_select with the axis bucket when mode is "select"', () => {
      const op = buildChamferOp(0.8, 'select', '+Y')
      expect(op).toEqual({ kind: 'chamfer_select', lengthMm: 0.8, edgeDirection: '+Y' })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('FG-5b: layers pickedEdgeIds onto chamfer_select when a stable edge id is passed', () => {
      const op = buildChamferOp(0.8, 'select', '-X', 'e:deadbeef')
      expect(op).toEqual({
        kind: 'chamfer_select',
        lengthMm: 0.8,
        edgeDirection: '-X',
        pickedEdgeIds: ['e:deadbeef']
      })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('FG-5b: ignores a picked edge id in "all" mode', () => {
      const op = buildChamferOp(1, 'all', '+Z', 'e:deadbeef')
      expect(op).toEqual({ kind: 'chamfer_all', lengthMm: 1 })
      expect(op).not.toHaveProperty('pickedEdgeIds')
    })
  })

  describe('buildShellOp', () => {
    it('builds shell_inward with thickness + open direction', () => {
      const op = buildShellOp(2, '+Z')
      expect(op).toEqual({ kind: 'shell_inward', thicknessMm: 2, openDirection: '+Z' })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('accepts every axis bucket as the open direction', () => {
      for (const dir of EDGE_DIRECTION_OPTIONS) {
        const op = buildShellOp(1.5, dir)
        expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
      }
    })

    it('FG-5b: layers pickedFaceIds onto shell_inward when a stable face id is passed', () => {
      const op = buildShellOp(2, '+Z', 'f:cap42')
      expect(op).toEqual({
        kind: 'shell_inward',
        thicknessMm: 2,
        openDirection: '+Z',
        pickedFaceIds: ['f:cap42']
      })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('FG-5b: a null / empty picked id omits the field (schema rejects empty arrays)', () => {
      const op = buildShellOp(2, '+Z', null)
      expect(op).not.toHaveProperty('pickedFaceIds')
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })
  })

  describe('buildHoleOp', () => {
    it('builds a through-all hole WITHOUT a depthMm field', () => {
      const op = buildHoleOp(0, 'through_all', 10, 0)
      expect(op).toEqual({
        kind: 'hole_from_profile',
        profileIndex: 0,
        mode: 'through_all',
        zStartMm: 0
      })
      // The schema's refine only requires depthMm for depth mode; through-all
      // must NOT carry it (keeps the persisted op canonical).
      expect(op).not.toHaveProperty('depthMm')
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })

    it('builds a depth hole WITH a positive depthMm field', () => {
      const op = buildHoleOp(3, 'depth', 12, 1)
      expect(op).toEqual({
        kind: 'hole_from_profile',
        profileIndex: 3,
        mode: 'depth',
        depthMm: 12,
        zStartMm: 1
      })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
    })
  })

  describe('Construct datum op builders (reference geometry markers)', () => {
    it('buildDatumPlaneOp: offset 0 is allowed; label included only when non-empty', () => {
      const noLabel = buildDatumPlaneOp('XY', 0)
      expect(noLabel).toEqual({ kind: 'datum_plane', basePlane: 'XY', offsetMm: 0 })
      expect(noLabel).not.toHaveProperty('label')
      expect(() => kernelPostSolidOpSchema.parse(noLabel)).not.toThrow()

      const withLabel = buildDatumPlaneOp('YZ', -3.5, '  mid plane  ')
      expect(withLabel).toEqual({
        kind: 'datum_plane',
        basePlane: 'YZ',
        offsetMm: -3.5,
        label: 'mid plane'
      })
      expect(() => kernelPostSolidOpSchema.parse(withLabel)).not.toThrow()
      // A whitespace-only label is treated as absent.
      expect(buildDatumPlaneOp('XZ', 1, '   ')).not.toHaveProperty('label')
    })

    it('buildDatumAxisOp: carries axis + origin; label optional', () => {
      const op = buildDatumAxisOp('Z', { x: 1, y: 2, z: 3 })
      expect(op).toEqual({
        kind: 'datum_axis',
        axis: 'Z',
        originXMm: 1,
        originYMm: 2,
        originZMm: 3
      })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
      const labelled = buildDatumAxisOp('X', { x: 0, y: 0, z: 0 }, 'rev axis')
      expect(labelled).toMatchObject({ label: 'rev axis' })
      expect(() => kernelPostSolidOpSchema.parse(labelled)).not.toThrow()
    })

    it('buildDatumPointOp: carries x/y/z; label optional', () => {
      const op = buildDatumPointOp({ x: 4, y: 5, z: 6 })
      expect(op).toEqual({ kind: 'datum_point', xMm: 4, yMm: 5, zMm: 6 })
      expect(() => kernelPostSolidOpSchema.parse(op)).not.toThrow()
      const labelled = buildDatumPointOp({ x: 0, y: 0, z: 0 }, 'origin')
      expect(labelled).toMatchObject({ label: 'origin' })
      expect(() => kernelPostSolidOpSchema.parse(labelled)).not.toThrow()
    })
  })
})

describe('FG-5b parse helpers', () => {
  describe('parsePositiveMm', () => {
    it('parses a positive number', () => {
      expect(parsePositiveMm('2.5')).toBe(2.5)
    })
    it('rejects empty / zero / negative / NaN', () => {
      expect(parsePositiveMm('')).toBeNull()
      expect(parsePositiveMm('   ')).toBeNull()
      expect(parsePositiveMm('0')).toBeNull()
      expect(parsePositiveMm('-3')).toBeNull()
      expect(parsePositiveMm('abc')).toBeNull()
    })
  })

  describe('parseFiniteMm', () => {
    it('parses any finite signed number, including zero and negatives', () => {
      expect(parseFiniteMm('0')).toBe(0)
      expect(parseFiniteMm('-4.2')).toBe(-4.2)
      expect(parseFiniteMm('7')).toBe(7)
    })
    it('rejects empty / NaN / Infinity', () => {
      expect(parseFiniteMm('')).toBeNull()
      expect(parseFiniteMm('xyz')).toBeNull()
      expect(parseFiniteMm('Infinity')).toBeNull()
    })
  })

  describe('parseClampedInt', () => {
    it('clamps into [min, max]', () => {
      expect(parseClampedInt('5', 0, 255)).toBe(5)
      expect(parseClampedInt('-1', 0, 255)).toBe(0)
      expect(parseClampedInt('999', 0, 255)).toBe(255)
    })
    it('rejects empty / non-numeric', () => {
      expect(parseClampedInt('', 0, 255)).toBeNull()
      expect(parseClampedInt('abc', 0, 255)).toBeNull()
    })
  })
})

describe('FG-5b pickedOcctIdFor — the kernel-by-id gate', () => {
  it('returns the stable id when the selection matches the kind AND carries occtHash', () => {
    expect(pickedOcctIdFor(makeFaceSelection(4, 'f:cap'), 'face')).toBe('f:cap')
    expect(pickedOcctIdFor(makeEdgeSelection(7, 'e:rail'), 'edge')).toBe('e:rail')
    expect(pickedOcctIdFor(makeVertexSelection(2, 'v:corner'), 'vertex')).toBe('v:corner')
  })

  it('returns null when the selection KIND does not match the requested kind', () => {
    // A face pick must NOT drive a fillet (which wants an edge), and vice versa.
    expect(pickedOcctIdFor(makeFaceSelection(4, 'f:cap'), 'edge')).toBeNull()
    expect(pickedOcctIdFor(makeEdgeSelection(7, 'e:rail'), 'face')).toBeNull()
  })

  it('returns null when the selection carries no stable occtHash (id-only pick)', () => {
    expect(pickedOcctIdFor(makeFaceSelection(4), 'face')).toBeNull()
    expect(pickedOcctIdFor(makeEdgeSelection(7), 'edge')).toBeNull()
  })

  it('returns null for an empty occtHash string and for a null selection', () => {
    expect(pickedOcctIdFor(makeFaceSelection(4, ''), 'face')).toBeNull()
    expect(pickedOcctIdFor(null, 'face')).toBeNull()
  })
})

// ── Tier-2 · resolvePickedSelectionId — the dialog's resolver gate ────────────
//
// The single seam Fillet/Chamfer/Shell route their picked id through. It layers
// the tiered resolver on top of pickedOcctIdFor so a pick that MOVED / UNIFORMLY
// RESIZED upstream resolves to its CURRENT stable id (Tier 2) — or is honestly
// lost (axis bucket) — instead of emitting a now-dead id.

const FACE_SIG: CadFaceSignature = {
  kind: 'plane',
  adjacentFaceCount: 4,
  normalClass: '+0,+0,+1',
  areaRank: 0,
  centroidOctant: 7
}
const EDGE_SIG: CadEdgeSignature = {
  kind: 'line',
  lengthRank: 0,
  midpointOctant: 3,
  incidentFaceKinds: 'plane|plane'
}

/** Minimal current-build tessellation carrying one face + one edge with signatures. */
function indexWith(
  faceId: string,
  faceSig: CadFaceSignature | undefined,
  edgeId: string,
  edgeSig: CadEdgeSignature | undefined
) {
  const tess: CadTessellateWithIdsResult = {
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    indices: [0, 1, 2],
    faceIds: [0],
    triangleCount: 1,
    bbox: { min: [0, 0, 0], max: [1, 1, 0] },
    faceMap: { '0': { kind: 'face', occtHash: 0, occtId: faceId, area: 1, signature: faceSig } },
    edgeMap: { [edgeId]: { kind: 'edge', occtId: edgeId, occtHash: 0, length: 1, signature: edgeSig } },
    edges: []
  }
  return buildPickIndex(tess)
}

describe('Tier-2 resolvePickedSelectionId — dialog resolver gate', () => {
  it('no picked id (wrong kind / no stable id) → { id: null } with no reason', () => {
    // A face pick handed to an edge op produces no picked id at all.
    expect(resolvePickedSelectionId(makeFaceSelection(4, 'f:cap'), 'edge')).toEqual({ id: null })
    // An id-only pick (no occtHash) likewise.
    expect(resolvePickedSelectionId(makeFaceSelection(4), 'face')).toEqual({ id: null })
    expect(resolvePickedSelectionId(null, 'face')).toEqual({ id: null })
  })

  it('NO current index supplied → Tier-1-only: emits the live id unchanged', () => {
    const res = resolvePickedSelectionId(makeEdgeSelection(7, 'e:rail', EDGE_SIG), 'edge')
    expect(res).toEqual({ id: 'e:rail', tier: 1 })
  })

  it('TIER 1: the live id is present in the current build', () => {
    const idx = indexWith('f:x', FACE_SIG, 'e:rail', EDGE_SIG)
    const res = resolvePickedSelectionId(makeEdgeSelection(7, 'e:rail', EDGE_SIG), 'edge', idx)
    expect(res).toEqual({ id: 'e:rail', tier: 1 })
  })

  it('TIER 2: the picked edge MOVED/RESIZED — recovered by signature to the CURRENT id', () => {
    // Live pick still carries the OLD id "e:old" + its signature; the build now
    // exposes "e:new" with the same signature (uniform move/resize).
    const idx = indexWith('f:x', FACE_SIG, 'e:new', EDGE_SIG)
    const res = resolvePickedSelectionId(makeEdgeSelection(7, 'e:old', EDGE_SIG), 'edge', idx)
    expect(res).toEqual({ id: 'e:new', tier: 2 })
  })

  it('TIER 2: a moved/resized FACE pick recovers to the current face id', () => {
    const idx = indexWith('f:new', FACE_SIG, 'e:1', EDGE_SIG)
    const res = resolvePickedSelectionId(makeFaceSelection(4, 'f:old', FACE_SIG), 'face', idx)
    expect(res).toEqual({ id: 'f:new', tier: 2 })
  })

  it('HONEST LOSS: id missing + no signature match → { id: null, reason }', () => {
    const idx = indexWith('f:x', FACE_SIG, 'e:1', { ...EDGE_SIG, kind: 'circle' })
    const res = resolvePickedSelectionId(makeEdgeSelection(7, 'e:old', EDGE_SIG), 'edge', idx)
    expect(res.id).toBeNull()
    expect(res).toMatchObject({ reason: 'no-signature-match' })
  })

  it('HONEST LOSS: a stale pick with no captured signature can only Tier-1 (then lost)', () => {
    const idx = indexWith('f:x', FACE_SIG, 'e:new', EDGE_SIG)
    // occtHash present (so there IS a picked id) but no signature captured.
    const res = resolvePickedSelectionId(makeEdgeSelection(7, 'e:old'), 'edge', idx)
    expect(res).toEqual({ id: null, reason: 'no-tier1-no-signature' })
  })
})
