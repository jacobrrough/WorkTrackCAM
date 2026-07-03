import { describe, expect, it } from 'vitest'
import { kernelOpSummary } from './kernel-op-summary'

describe('kernelOpSummary', () => {
  it('labels linear 3d, path pattern, directional fillet/chamfer, split, hole, thread, move/copy, press-pull, sweep, pipe, thicken, coil, intersect box, and profile combine', () => {
    expect(
      kernelOpSummary({
        kind: 'pattern_linear_3d',
        count: 4,
        dxMm: 1,
        dyMm: 2,
        dzMm: 3
      })
    ).toContain('linear 3D')
    expect(
      kernelOpSummary({
        kind: 'pattern_path',
        count: 4,
        pathPoints: [
          [0, 0],
          [5, 0]
        ]
      })
    ).toContain('path pattern')
    expect(
      kernelOpSummary({
        kind: 'pattern_path',
        count: 4,
        closedPath: true,
        pathPoints: [
          [0, 0],
          [5, 0],
          [2, 4]
        ]
      })
    ).toContain('closed')
    expect(
      kernelOpSummary({
        kind: 'fillet_select',
        radiusMm: 1,
        edgeDirection: '+Z'
      })
    ).toContain('fillet +Z')
    expect(
      kernelOpSummary({
        kind: 'chamfer_select',
        lengthMm: 1,
        edgeDirection: '-X'
      })
    ).toContain('chamfer -X')
    expect(
      kernelOpSummary({
        kind: 'split_keep_halfspace',
        axis: 'X',
        offsetMm: 2,
        keep: 'negative'
      })
    ).toContain('split X@2 keep negative')
    expect(
      kernelOpSummary({
        kind: 'hole_from_profile',
        profileIndex: 1,
        mode: 'through_all',
        zStartMm: 0
      })
    ).toContain('hole profile#1 through-all')
    // Depth-mode simple hole keeps the legacy "hole … depth=" label.
    expect(
      kernelOpSummary({
        kind: 'hole_from_profile',
        profileIndex: 2,
        mode: 'depth',
        depthMm: 6,
        zStartMm: 0
      })
    ).toBe('hole profile#2 depth=6 z0=0')
    expect(
      kernelOpSummary({
        kind: 'thread_cosmetic',
        centerXMm: 0,
        centerYMm: 0,
        majorRadiusMm: 4,
        pitchMm: 1.5,
        lengthMm: 8,
        depthMm: 0.4,
        zStartMm: 0
      })
    ).toMatch(/thread cosmetic.*≤256 rings/)
    expect(
      kernelOpSummary({
        kind: 'transform_translate',
        dxMm: 10,
        dyMm: 0,
        dzMm: 0,
        keepOriginal: false
      })
    ).toContain('move')
    expect(
      kernelOpSummary({
        kind: 'press_pull_profile',
        profileIndex: 0,
        deltaMm: -2,
        zStartMm: 0
      })
    ).toContain('press/pull')
    expect(
      kernelOpSummary({
        kind: 'sweep_profile_path',
        profileIndex: 0,
        pathPoints: [
          [0, 0],
          [2, 0]
        ],
        zStartMm: 0
      })
    ).toContain('sweep profile#0')
    expect(
      kernelOpSummary({
        kind: 'sweep_profile_path_true',
        profileIndex: 0,
        pathPoints: [
          [0, 0],
          [2, 0]
        ],
        zStartMm: 0,
        orientationMode: 'frenet'
      })
    ).toContain('sweep(true)')
    expect(
      kernelOpSummary({
        kind: 'pipe_path',
        pathPoints: [
          [0, 0],
          [3, 0]
        ],
        outerRadiusMm: 2,
        wallThicknessMm: 0.5,
        zStartMm: 0,
        orientationMode: 'frenet'
      })
    ).toContain('mode=frenet')
    expect(
      kernelOpSummary({
        kind: 'thicken_scale',
        deltaMm: 1.2
      })
    ).toContain('thicken(scale)')
    expect(
      kernelOpSummary({
        kind: 'thicken_offset',
        distanceMm: 1.2,
        side: 'both'
      })
    ).toContain('thicken(offset)')
    expect(
      kernelOpSummary({
        kind: 'thread_wizard',
        centerXMm: 0,
        centerYMm: 0,
        majorRadiusMm: 4,
        pitchMm: 1.25,
        lengthMm: 10,
        depthMm: 0.6,
        zStartMm: 0,
        hand: 'right',
        mode: 'modeled',
        standard: 'ISO',
        designation: 'M8x1.25',
        class: '6g',
        starts: 1
      })
    ).toContain('thread ISO')
    expect(
      kernelOpSummary({
        kind: 'coil_cut',
        centerXMm: 0,
        centerYMm: 0,
        majorRadiusMm: 4,
        pitchMm: 1.5,
        turns: 4,
        depthMm: 0.4,
        zStartMm: 0
      })
    ).toMatch(/coil cut.*≤1024 rings/)
    expect(
      kernelOpSummary({
        kind: 'boolean_intersect_box',
        xMinMm: 0,
        xMaxMm: 1,
        yMinMm: 0,
        yMaxMm: 1,
        zMinMm: 0,
        zMaxMm: 1
      })
    ).toContain('∩ box')
    expect(
      kernelOpSummary({
        kind: 'boolean_combine_profile',
        mode: 'union',
        profileIndex: 2,
        extrudeDepthMm: 12,
        zStartMm: 1
      })
    ).toContain('profile#2')
    expect(
      kernelOpSummary({
        kind: 'sheet_fold',
        bendLineYMm: 5,
        bendRadiusMm: 1,
        bendAngleDeg: 90,
        kFactor: 0.44,
        bendAllowanceMode: 'k_factor'
      })
    ).toContain('sheet fold')
    expect(
      kernelOpSummary({
        kind: 'sheet_flat_pattern',
        includeBendLines: true
      })
    ).toContain('flat pattern')
    expect(
      kernelOpSummary({
        kind: 'loft_guide_rails',
        rails: [
          [
            [0, 0],
            [3, 0]
          ]
        ]
      })
    ).toContain('guide rails')
    expect(
      kernelOpSummary({
        kind: 'plastic_rule_fillet',
        radiusMm: 1
      })
    ).toContain('plastic rule fillet')
  })

  it('labels Construct datum markers (plane / axis / point)', () => {
    expect(
      kernelOpSummary({ kind: 'datum_plane', basePlane: 'XY', offsetMm: 5, label: 'mid' })
    ).toBe('datum plane XY +5 mm "mid"')
    expect(
      kernelOpSummary({ kind: 'datum_plane', basePlane: 'YZ', offsetMm: 0 })
    ).toBe('datum plane YZ')
    expect(
      kernelOpSummary({
        kind: 'datum_axis',
        axis: 'Z',
        originXMm: 1,
        originYMm: 2,
        originZMm: 3
      })
    ).toBe('datum axis Z @(1,2,3)')
    expect(
      kernelOpSummary({ kind: 'datum_point', xMm: 4, yMm: 5, zMm: 6 })
    ).toBe('datum point (4,5,6)')
  })

  it('enriches hole labels with hole type (cbore / csink) and tap designation', () => {
    // Explicit `simple` reads exactly like a legacy hole (no prefix change) so
    // an upgraded op with holeType='simple' stays byte-identical in the UI.
    expect(
      kernelOpSummary({
        kind: 'hole_from_profile',
        profileIndex: 0,
        mode: 'through_all',
        zStartMm: 0,
        holeType: 'simple'
      })
    ).toBe('hole profile#0 through-all z0=0')
    // Counterbore → "cbore hole".
    expect(
      kernelOpSummary({
        kind: 'hole_from_profile',
        profileIndex: 3,
        mode: 'depth',
        depthMm: 10,
        zStartMm: 0,
        holeType: 'counterbore',
        cboreDiameterMm: 8,
        cboreDepthMm: 3
      })
    ).toBe('cbore hole profile#3 depth=10 z0=0')
    // Countersink → "csink hole".
    expect(
      kernelOpSummary({
        kind: 'hole_from_profile',
        profileIndex: 4,
        mode: 'through_all',
        zStartMm: 0,
        holeType: 'countersink',
        csinkDiameterMm: 9,
        csinkAngleDeg: 82
      })
    ).toBe('csink hole profile#4 through-all z0=0')
    // Tap designation is appended (metadata only) — here on a simple hole.
    expect(
      kernelOpSummary({
        kind: 'hole_from_profile',
        profileIndex: 1,
        mode: 'through_all',
        zStartMm: 0,
        tapDesignation: 'M5x0.8'
      })
    ).toBe('hole profile#1 through-all z0=0 tap M5x0.8')
    // Tap + counterbore compose: prefix AND suffix both present.
    expect(
      kernelOpSummary({
        kind: 'hole_from_profile',
        profileIndex: 2,
        mode: 'depth',
        depthMm: 12,
        zStartMm: 1,
        holeType: 'counterbore',
        cboreDiameterMm: 8,
        cboreDepthMm: 3,
        tapDesignation: 'M6x1'
      })
    ).toBe('cbore hole profile#2 depth=12 z0=1 tap M6x1')
  })
})
