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
})
