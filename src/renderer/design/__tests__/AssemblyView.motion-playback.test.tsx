/**
 * AssemblyView — motion-study PLAYBACK bar (this cycle's wiring).
 *
 * The `assembly:simulate` IPC computes N solved poses but the view previously
 * only counted them. These pins prove the playback surface that makes the
 * assembly actually MOVE:
 *
 *   (A) RENDER PINS — the playback bar (scrub + Play/Pause + read-out + Done)
 *       renders with stable testids once poses exist (seeded via the
 *       `initialMotionPoses` render-pin escape hatch, mirroring
 *       `initialConvergenceReport`); degenerate studies (1 pose / identical
 *       poses) disable the controls with an honest hint; the per-row summary
 *       is OVERRIDDEN by the pose at the playhead (view-layer overlay — the
 *       `parts` prop is never mutated).
 *   (B) SOURCE PINS — the click/effect wiring the static renderer cannot
 *       fire: the study handler stashes parsed poses, the simulate input
 *       carries the row's joint kind (else every sample is identical), and
 *       the play loop advances through the pure `advancePlaybackT` (no
 *       Date.now in the pure layer).
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AssemblyView, type AssemblyPart } from '../AssemblyView'
import type { MotionPose, MotionPoseTransform } from '../assembly-motion-playback'

// ── window.fab shim (matches AssemblyView.test.tsx) ─────────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const T0: MotionPoseTransform = { x: 0, y: 0, z: 0, rxDeg: 0, ryDeg: 0, rzDeg: 0 }

const pose = (
  sample: number,
  entries: ReadonlyArray<readonly [string, Partial<MotionPoseTransform>]>
): MotionPose => ({
  sample,
  transforms: entries.map(([id, t]) => ({ id, transform: { ...T0, ...t } })),
})

const parts: readonly AssemblyPart[] = [
  {
    id: 'p1',
    name: 'Hinge',
    handle: 'script:abcdef',
    joint: 'revolute',
    transform: { position: [1, 2, 3] },
  },
  { id: 'p2', name: 'Base', handle: 'script:fedcba' },
]

/** 3-sample study: the hinge sweeps x 5 → 10 → 15; the base never moves. */
const movingPoses: readonly MotionPose[] = [
  pose(0, [
    ['p1', { x: 5 }],
    ['p2', {}],
  ]),
  pose(1, [
    ['p1', { x: 10 }],
    ['p2', {}],
  ]),
  pose(2, [
    ['p1', { x: 15 }],
    ['p2', {}],
  ]),
]

const frozenPoses: readonly MotionPose[] = [
  pose(0, [['p1', { x: 5 }]]),
  pose(1, [['p1', { x: 5 }]]),
]

// ── (A) Render pins ─────────────────────────────────────────────────────────

describe('AssemblyView — motion playback bar (render)', () => {
  it('does not render the playback bar until a study has produced poses', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).not.toContain('data-testid="design-assembly-playback"')
  })

  it('renders scrub + toggle + read-out + Done with stable testids once poses exist', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, initialMotionPoses: movingPoses })
    )
    expect(html).toContain('data-testid="design-assembly-playback"')
    expect(html).toContain('data-testid="design-assembly-playback-toggle"')
    expect(html).toContain('data-testid="design-assembly-playback-scrub"')
    expect(html).toContain('data-testid="design-assembly-playback-readout"')
    expect(html).toContain('data-testid="design-assembly-playback-close"')
    // Paused by default — the toggle offers Play.
    expect(html).toContain('>Play</button>')
    expect(html).toContain('>Done</button>')
  })

  it('reads out the nearest pose + the joint scalar in the joint units (revolute → deg)', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, initialMotionPoses: movingPoses })
    )
    // t = 0 over a revolute study: first pose, default −180..180° sweep start.
    expect(html).toContain('pose 1/3')
    expect(html).toContain('-180.0°')
  })

  it('scrubbing position is honoured via the initialPlaybackT seed (t = 1 → last pose)', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        initialMotionPoses: movingPoses,
        initialPlaybackT: 1,
      })
    )
    expect(html).toContain('pose 3/3')
    expect(html).toContain('180.0°')
  })

  it('OVERRIDES the row summary with the pose at the playhead (view overlay)', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, initialMotionPoses: movingPoses })
    )
    // p1's stored transform is @(1, 2, 3); the sample-0 pose puts it at x=5.
    expect(html).toContain('@(5.0, 0.0, 0.0)')
    expect(html).not.toContain('@(1, 2, 3)')
    // The animated row is marked so the theme can tint it.
    expect(html).toMatch(/data-testid="design-assembly-part-p1"[^>]*data-motion="true"/)
    // And the viewport says the overlay is a preview, not a save.
    expect(html).toContain('data-testid="design-assembly-playback-note"')
    expect(html).toContain('preview overlay, not saved')
  })

  it('leaves the row summaries untouched when no playback is active', () => {
    const html = renderToStaticMarkup(createElement(AssemblyView, { parts }))
    expect(html).toContain('@(1, 2, 3)')
    expect(html).not.toContain('data-motion=')
    expect(html).not.toContain('data-testid="design-assembly-playback-note"')
  })

  it('degenerate: a single pose disables the controls with an honest hint', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, initialMotionPoses: [movingPoses[0]!] })
    )
    expect(html).toMatch(/data-testid="design-assembly-playback-toggle"[^>]*disabled/)
    expect(html).toMatch(/data-testid="design-assembly-playback-scrub"[^>]*disabled/)
    expect(html).toContain('data-testid="design-assembly-playback-hint"')
    expect(html).toContain('Only one pose')
    // No overlay when playback is unusable — rows keep their stored summary.
    expect(html).toContain('@(1, 2, 3)')
  })

  it('degenerate: identical poses (no jointed DOF) hint at assigning a joint', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts, initialMotionPoses: frozenPoses })
    )
    expect(html).toContain('data-testid="design-assembly-playback-hint"')
    expect(html).toContain('revolute or slider joint')
    expect(html).toMatch(/data-testid="design-assembly-playback-toggle"[^>]*disabled/)
  })

  it('marks the study approximate when the solver did not converge', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        initialMotionPoses: movingPoses,
        initialConvergenceReport: {
          converged: false,
          iterations: 50,
          finalResidual: 0.5,
          perConstraintResiduals: [],
          status: 'max_iterations_reached',
        },
      })
    )
    expect(html).toContain('data-testid="design-assembly-playback-quality"')
    expect(html).toContain('approximate')
  })

  it('does not mark a converged study approximate', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, {
        parts,
        initialMotionPoses: movingPoses,
        initialConvergenceReport: {
          converged: true,
          iterations: 3,
          finalResidual: 1e-9,
          perConstraintResiduals: [],
          status: 'converged',
        },
      })
    )
    expect(html).not.toContain('data-testid="design-assembly-playback-quality"')
  })

  it('never renders the playback bar in the empty-state branch', () => {
    const html = renderToStaticMarkup(
      createElement(AssemblyView, { parts: [], initialMotionPoses: movingPoses })
    )
    expect(html).not.toContain('data-testid="design-assembly-playback"')
  })

  it('does not emit console errors rendering the playback bar', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow */
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* swallow */
    })
    try {
      renderToStaticMarkup(
        createElement(AssemblyView, { parts, initialMotionPoses: movingPoses })
      )
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})

// ── (B) Source pins (click/effect wiring — never fires under SSR) ───────────

describe('AssemblyView — playback wiring source pins', () => {
  const src = readFileSync(join(__dirname, '..', 'AssemblyView.tsx'), 'utf-8')

  it('the motion-study handler stashes the parsed poses for playback', () => {
    expect(src).toContain('setMotionPoses(parseMotionPoses(res.poses))')
  })

  it('the simulate input threads the row joint kind (else every sample is identical)', () => {
    expect(src).toContain('...(part.joint !== undefined ? { joint: part.joint } : {})')
  })

  it('the play loop advances through the pure module (deterministic wrap math)', () => {
    expect(src).toContain('advancePlaybackT(prev, dt, MOTION_LOOP_DURATION_MS)')
  })

  it('a fresh solve and any parts-list change both drop the overlay (view-layer only)', () => {
    // handleSolve clears playback before dispatching…
    expect(src).toMatch(/setSolving\(true\)[\s\S]{0,400}setMotionPoses\(null\)/)
    // …and the assembly-key effect clears it on any parts edit.
    expect(src).toMatch(/playbackKeyDidMount[\s\S]{0,600}\}, \[key\]\)/)
  })
})
