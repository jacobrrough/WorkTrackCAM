/**
 * assembly-motion-playback — pure-logic pins for the motion-study playback
 * overlay ("which pose at t?").
 *
 * Everything here is deterministic by construction: the module takes
 * elapsed-time DELTAS and playhead fractions as inputs (no Date.now /
 * performance.now / Math.random), so these tests pass fixed numbers and pin
 * exact outputs — wrap-around looping, clamping, adjacent-sample
 * interpolation (positions lerp, angles shortest-path), and the degenerate
 * studies (0 / 1 / identical poses) that must disable playback with an honest
 * hint.
 */
import { describe, expect, it } from 'vitest'
import {
  MOTION_LOOP_DURATION_MS,
  advancePlaybackT,
  clamp01,
  firstDrivenJointKind,
  firstDrivenJointRange,
  formatPoseSummary,
  interpolatePosesAtT,
  jointScalarLabel,
  lerpAngleDeg,
  parseMotionPoses,
  playbackDisabledHint,
  playbackReadout,
  posesAreStatic,
  sampleIndexAtT,
  type MotionPose,
  type MotionPoseTransform,
} from './assembly-motion-playback'

const T0: MotionPoseTransform = { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }

const pose = (
  sample: number,
  entries: ReadonlyArray<readonly [string, Partial<MotionPoseTransform>]>
): MotionPose => ({
  sample,
  transforms: entries.map(([id, t]) => ({ id, transform: { ...T0, ...t } })),
})

/** 3-sample study: part `a` sweeps x 0 → 10 → 20 while `b` stays put. */
const movingPoses: MotionPose[] = [
  pose(0, [
    ['a', { x: 0 }],
    ['b', { x: 100 }],
  ]),
  pose(1, [
    ['a', { x: 10 }],
    ['b', { x: 100 }],
  ]),
  pose(2, [
    ['a', { x: 20 }],
    ['b', { x: 100 }],
  ]),
]

describe('clamp01', () => {
  it('clamps into [0, 1] and collapses non-finite input to 0', () => {
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(clamp01(Number.NaN)).toBe(0)
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('advancePlaybackT — deterministic wrap-around looping', () => {
  it('advances proportionally to the elapsed delta', () => {
    expect(advancePlaybackT(0, 1000, 4000)).toBeCloseTo(0.25, 10)
    expect(advancePlaybackT(0.25, 2000, 4000)).toBeCloseTo(0.75, 10)
  })

  it('wraps past 1 back into [0, 1) (looping playback)', () => {
    expect(advancePlaybackT(0.9, 800, 4000)).toBeCloseTo(0.1, 10)
    // A delta of exactly one full loop lands back where it started.
    expect(advancePlaybackT(0.3, 4000, 4000)).toBeCloseTo(0.3, 10)
  })

  it('ignores non-positive / non-finite deltas (pause safety)', () => {
    expect(advancePlaybackT(0.4, 0, 4000)).toBe(0.4)
    expect(advancePlaybackT(0.4, -16, 4000)).toBe(0.4)
    expect(advancePlaybackT(0.4, Number.NaN, 4000)).toBe(0.4)
  })

  it('refuses to advance on a degenerate duration and clamps a wild playhead', () => {
    expect(advancePlaybackT(0.4, 16, 0)).toBe(0.4)
    expect(advancePlaybackT(0.4, 16, -100)).toBe(0.4)
    expect(advancePlaybackT(7, 0, 4000)).toBe(1)
  })

  it('exports a sensible loop duration constant', () => {
    expect(MOTION_LOOP_DURATION_MS).toBe(4000)
  })
})

describe('sampleIndexAtT', () => {
  it('maps the playhead onto the nearest sample index', () => {
    expect(sampleIndexAtT(12, 0)).toBe(0)
    expect(sampleIndexAtT(12, 1)).toBe(11)
    expect(sampleIndexAtT(3, 0.5)).toBe(1)
  })

  it('clamps out-of-range playheads and degenerate counts', () => {
    expect(sampleIndexAtT(12, -0.5)).toBe(0)
    expect(sampleIndexAtT(12, 1.5)).toBe(11)
    expect(sampleIndexAtT(0, 0.5)).toBe(0)
    expect(sampleIndexAtT(1, 0.9)).toBe(0)
  })
})

describe('lerpAngleDeg — shortest angular path', () => {
  it('lerps plain angles linearly', () => {
    expect(lerpAngleDeg(0, 90, 0.5)).toBeCloseTo(45, 10)
  })

  it('crosses the ±180 seam the short way instead of spinning backwards', () => {
    // 170° → −170° is a 20° sweep through 180, not a 340° reverse spin.
    expect(lerpAngleDeg(170, -170, 0.5)).toBeCloseTo(180, 10)
    expect(lerpAngleDeg(-170, 170, 0.25)).toBeCloseTo(-175, 10)
  })
})

describe('interpolatePosesAtT — pose-at-t with interpolation', () => {
  it('returns the exact sample at sample-aligned playheads', () => {
    expect(interpolatePosesAtT(movingPoses, 0).get('a')?.x).toBeCloseTo(0, 10)
    expect(interpolatePosesAtT(movingPoses, 0.5).get('a')?.x).toBeCloseTo(10, 10)
    expect(interpolatePosesAtT(movingPoses, 1).get('a')?.x).toBeCloseTo(20, 10)
  })

  it('blends between adjacent samples for in-between playheads', () => {
    expect(interpolatePosesAtT(movingPoses, 0.25).get('a')?.x).toBeCloseTo(5, 10)
    expect(interpolatePosesAtT(movingPoses, 0.75).get('a')?.x).toBeCloseTo(15, 10)
    // The static part stays put at every t.
    expect(interpolatePosesAtT(movingPoses, 0.37).get('b')?.x).toBeCloseTo(100, 10)
  })

  it('interpolates rotations along the shortest angular path', () => {
    const spin: MotionPose[] = [
      pose(0, [['a', { rzDeg: 170 }]]),
      pose(1, [['a', { rzDeg: -170 }]]),
    ]
    expect(interpolatePosesAtT(spin, 0.5).get('a')?.rzDeg).toBeCloseTo(180, 10)
  })

  it('clamps out-of-range playheads to the ends', () => {
    expect(interpolatePosesAtT(movingPoses, -3).get('a')?.x).toBeCloseTo(0, 10)
    expect(interpolatePosesAtT(movingPoses, 42).get('a')?.x).toBeCloseTo(20, 10)
  })

  it('degenerate: 0 poses → empty map; 1 pose → that pose at every t', () => {
    expect(interpolatePosesAtT([], 0.5).size).toBe(0)
    const single = [pose(0, [['a', { x: 7 }]])]
    expect(interpolatePosesAtT(single, 0).get('a')?.x).toBe(7)
    expect(interpolatePosesAtT(single, 0.9).get('a')?.x).toBe(7)
  })

  it('falls back to the available sample when an id exists on only one side', () => {
    const lopsided: MotionPose[] = [
      pose(0, [['a', { x: 0 }]]),
      pose(1, [
        ['a', { x: 10 }],
        ['late', { x: 99 }],
      ]),
    ]
    const at = interpolatePosesAtT(lopsided, 0.5)
    expect(at.get('a')?.x).toBeCloseTo(5, 10)
    expect(at.get('late')?.x).toBe(99)
  })
})

describe('posesAreStatic + playbackDisabledHint — degenerate studies', () => {
  it('detects a frozen study (all samples identical)', () => {
    const frozen: MotionPose[] = [
      pose(0, [['a', { x: 5 }]]),
      pose(1, [['a', { x: 5 }]]),
      pose(2, [['a', { x: 5 }]]),
    ]
    expect(posesAreStatic(frozen)).toBe(true)
    expect(posesAreStatic(movingPoses)).toBe(false)
  })

  it('treats differing component-id sets as motion', () => {
    const changed: MotionPose[] = [pose(0, [['a', {}]]), pose(1, [['b', {}]])]
    expect(posesAreStatic(changed)).toBe(false)
  })

  it('hints honestly for 0 poses, 1 pose, and a frozen study; null when animatable', () => {
    expect(playbackDisabledHint([])).toContain('run a Motion Study')
    expect(playbackDisabledHint([movingPoses[0]!])).toContain('Only one pose')
    const frozen: MotionPose[] = [pose(0, [['a', {}]]), pose(1, [['a', {}]])]
    expect(playbackDisabledHint(frozen)).toContain('revolute or slider joint')
    expect(playbackDisabledHint(movingPoses)).toBeNull()
  })
})

describe('firstDrivenJointKind + jointScalarLabel + playbackReadout', () => {
  it('finds the first joint kind assembly:simulate actually drives', () => {
    expect(firstDrivenJointKind([{ joint: 'rigid' }, { joint: 'slider' }, { joint: 'revolute' }])).toBe('slider')
    expect(firstDrivenJointKind([{ joint: 'revolute' }])).toBe('revolute')
    expect(firstDrivenJointKind([{}, { joint: 'planar' }, { joint: 'ball' }])).toBeNull()
  })

  it('phrases the revolute read-out across the default −180..180° range', () => {
    // Default fallback: a row with no authored jointLimits sweeps the IPC's
    // documented default range, which this formatter mirrors.
    expect(jointScalarLabel('revolute', 0)).toBe('-180.0°')
    expect(jointScalarLabel('revolute', 0.5)).toBe('0.0°')
    expect(jointScalarLabel('revolute', 1)).toBe('180.0°')
  })

  it('phrases the slider read-out across the default 0..100 mm range', () => {
    expect(jointScalarLabel('slider', 0)).toBe('0.0 mm')
    expect(jointScalarLabel('slider', 0.25)).toBe('25.0 mm')
    expect(jointScalarLabel('slider', 1)).toBe('100.0 mm')
  })

  it('honours authored limits threaded through from the Limits editor', () => {
    // LIMIT COUPLING (closed): the AssemblyView now threads each row's authored
    // jointLimits into the assembly:simulate input AND passes the first driven
    // row's real range here, so the read-out sweeps the AUTHORED range — not
    // the −180..180 / 0..100 defaults.
    expect(jointScalarLabel('revolute', 0.5, { min: 0, max: 90 })).toBe('45.0°')
    expect(jointScalarLabel('slider', 0.5, { min: 10, max: 20 })).toBe('15.0 mm')
  })

  it('falls back to a percentage when nothing is driven', () => {
    expect(jointScalarLabel(null, 0.25)).toBe('t = 25%')
  })

  it('composes the one-line playback read-out (1-based nearest sample)', () => {
    expect(playbackReadout(3, 0, 'slider')).toBe('pose 1/3 · 0.0 mm')
    expect(playbackReadout(3, 1, 'revolute')).toBe('pose 3/3 · 180.0°')
    expect(playbackReadout(12, 0.5, null)).toBe('pose 7/12 · t = 50%')
  })

  it('composes the read-out over the AUTHORED range when limits are passed', () => {
    // The AssemblyView passes firstDrivenJointRange(parts) here, so the scrub
    // label reflects the range the motion study actually swept.
    expect(playbackReadout(3, 1, 'revolute', { min: 0, max: 90 })).toBe('pose 3/3 · 90.0°')
    expect(playbackReadout(5, 0, 'slider', { min: 10, max: 60 })).toBe('pose 1/5 · 10.0 mm')
  })
})

describe('firstDrivenJointRange — couples authored limits into the read-out', () => {
  it('returns the first revolute row range, authored bounds winning per side', () => {
    expect(
      firstDrivenJointRange([
        { joint: 'rigid' },
        { joint: 'revolute', jointLimits: { scalarMinDeg: -45, scalarMaxDeg: 90 } },
      ])
    ).toEqual({ kind: 'revolute', min: -45, max: 90 })
  })

  it('returns the first slider row range, authored bounds winning per side', () => {
    expect(
      firstDrivenJointRange([{ joint: 'slider', jointLimits: { scalarMinMm: 5, scalarMaxMm: 55 } }])
    ).toEqual({ kind: 'slider', min: 5, max: 55 })
  })

  it('falls back per missing side to the IPC defaults (revolute −180..180)', () => {
    // Only the max is authored → the min side falls back to the −180 default,
    // mirroring assembly:simulate's per-side resolution exactly.
    expect(firstDrivenJointRange([{ joint: 'revolute', jointLimits: { scalarMaxDeg: 60 } }])).toEqual(
      { kind: 'revolute', min: -180, max: 60 }
    )
  })

  it('falls back to slider defaults 0..100 when no limits are authored', () => {
    expect(firstDrivenJointRange([{ joint: 'slider' }])).toEqual({ kind: 'slider', min: 0, max: 100 })
  })

  it('is null when nothing driven (only non-swept joint kinds present)', () => {
    expect(firstDrivenJointRange([{ joint: 'ball' }, { joint: 'planar' }, {}])).toBeNull()
  })
})

describe('formatPoseSummary', () => {
  it('shows the position with one decimal, appending rotation only when visible', () => {
    expect(formatPoseSummary({ ...T0, x: 5 })).toBe('@(5.0, 0.0, 0.0)')
    expect(formatPoseSummary({ ...T0, x: 1.25, ryDeg: 90 })).toBe('@(1.3, 0.0, 0.0) ∠(0, 90, 0)°')
  })
})

describe('parseMotionPoses — tolerant wire guard', () => {
  it('parses a well-formed assembly:simulate payload', () => {
    const wire: unknown = [
      { sample: 1, transforms: [{ id: 'a', transform: { x: 1, y: 2, z: 3, rxDeg: 0, ryDeg: 0, rzDeg: 90 } }] },
      { sample: 0, transforms: [{ id: 'a', transform: { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 } }] },
    ]
    const poses = parseMotionPoses(wire)
    expect(poses).toHaveLength(2)
    // Sorted by sample index regardless of wire order.
    expect(poses[0]!.sample).toBe(0)
    expect(poses[1]!.transforms[0]!.transform.rzDeg).toBe(90)
  })

  it('skips malformed poses / entries instead of throwing', () => {
    const wire: unknown = [
      null,
      'garbage',
      { sample: 'zero', transforms: [] },
      {
        sample: 0,
        transforms: [
          { id: '', transform: T0 },
          { id: 'ok', transform: { ...T0, x: Number.NaN } },
          { id: 'good', transform: T0 },
          { id: 'no-transform' },
        ],
      },
    ]
    const poses = parseMotionPoses(wire)
    expect(poses).toHaveLength(1)
    expect(poses[0]!.transforms).toHaveLength(1)
    expect(poses[0]!.transforms[0]!.id).toBe('good')
  })

  it('returns [] for a non-array payload', () => {
    expect(parseMotionPoses(undefined)).toEqual([])
    expect(parseMotionPoses({ poses: [] })).toEqual([])
  })
})
