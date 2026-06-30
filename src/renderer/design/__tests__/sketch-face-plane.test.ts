/**
 * Sketch-on-face: the missing link. The face-pick, the renderer placement matrix, and the kernel
 * `_apply_placement` were all already built + pinned to mirror each other — the loop only broke
 * because the picked plane was never written to the design. These pins lock the fix: the helper sets
 * a `kind: 'face'` plane, and that plane drives the preview placement to the picked origin (so the
 * kernel, which mirrors that math, lands the extrude on the face).
 */

import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { emptyDesign, withSketchFacePlane } from '../../../shared/design-schema'
import { sketchPreviewPlacementMatrix } from '../sketch-preview-placement'

const PICK = {
  origin: [12, -4, 7] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
  xAxis: [1, 0, 0] as [number, number, number]
}

describe('withSketchFacePlane — closes the sketch-on-face loop', () => {
  it('writes the picked face as the design sketch plane', () => {
    expect(withSketchFacePlane(emptyDesign(), PICK).sketchPlane).toEqual({
      kind: 'face',
      origin: [12, -4, 7],
      normal: [0, 0, 1],
      xAxis: [1, 0, 0]
    })
  })

  it('does not mutate the input (the original stays XY datum)', () => {
    const d = emptyDesign()
    withSketchFacePlane(d, PICK)
    expect(d.sketchPlane).toEqual({ kind: 'datum', datum: 'XY' })
  })

  it('the resulting plane drives the preview placement to the picked origin', () => {
    const next = withSketchFacePlane(emptyDesign(), PICK)
    const pos = new THREE.Vector3().setFromMatrixPosition(
      sketchPreviewPlacementMatrix(next.sketchPlane)
    )
    expect([pos.x, pos.y, pos.z]).toEqual([12, -4, 7])
  })

  it('a default (XY) design still places at the origin (no regression)', () => {
    const pos = new THREE.Vector3().setFromMatrixPosition(
      sketchPreviewPlacementMatrix(emptyDesign().sketchPlane)
    )
    expect([pos.x, pos.y, pos.z]).toEqual([0, 0, 0])
  })
})
