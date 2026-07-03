/**
 * assembly-motion-playback — PURE sample-indexing / interpolation / wrap logic
 * for the AssemblyView's motion-study playback overlay.
 *
 * The `assembly:simulate` IPC (src/main/ipc-modeling.ts) steps each jointed
 * component's scalar across its limit range and returns N solved poses. This
 * module answers "which pose (or blend of poses) do we show at playhead t?"
 * without any React, timers, or IO so the node-env suite can pin every branch
 * deterministically:
 *
 *   - NO Date.now() / performance.now() / Math.random() — the play loop feeds
 *     elapsed-time DELTAS into {@link advancePlaybackT}; tests supply fixed
 *     numbers.
 *   - Poses arrive from the wire as `unknown`-ish payloads; {@link
 *     parseMotionPoses} is the tolerant runtime guard (malformed entries are
 *     skipped, never thrown).
 *   - Playback is a VIEW-layer overlay: nothing in this module (or its
 *     consumers) writes poses back into the assembly parts list or the
 *     project file.
 *
 * Interpolation (not stepping): {@link interpolatePosesAtT} blends between the
 * two adjacent samples — positions lerp linearly, Euler components lerp along
 * the SHORTEST angular path ({@link lerpAngleDeg}) so a 170° → −170° pair
 * sweeps 20° through ±180 instead of spinning 340° backwards. Adjacent motion
 * samples are close together (≤ limit-range / (N−1)), so per-component Euler
 * lerp is a faithful preview; it is not a slerp and is documented as such.
 */

/** 6-DoF pose for one component in one motion sample (matches the IPC wire shape). */
export type MotionPoseTransform = {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly rxDeg: number
  readonly ryDeg: number
  readonly rzDeg: number
}

/** One motion sample: the solver's per-component transforms at sample index `sample`. */
export type MotionPose = {
  readonly sample: number
  readonly transforms: ReadonlyArray<{
    readonly id: string
    readonly transform: MotionPoseTransform
  }>
}

/**
 * Duration of one full playback sweep (t: 0 → 1) in milliseconds. 4 s reads as
 * a deliberate mechanism demo at the default 12-sample study without feeling
 * sluggish; playback loops (wraps) until paused.
 */
export const MOTION_LOOP_DURATION_MS = 4000

/** The two joint kinds `assembly:simulate` actually steps across their range. */
export type DrivenJointKind = 'revolute' | 'slider'

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Clamp to [0, 1]; non-finite input collapses to 0 (a safe playhead). */
export function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * Advance the playhead by an elapsed-time delta with wrap-around looping.
 * Pure: callers (the rAF effect) pass the measured delta in; tests pass fixed
 * numbers. Non-positive / non-finite deltas and durations leave the playhead
 * where it is (clamped), so a paused or degenerate loop can never NaN the UI.
 */
export function advancePlaybackT(prevT: number, elapsedMs: number, durationMs: number): number {
  const base = clamp01(prevT)
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return base
  if (!Number.isFinite(durationMs) || durationMs <= 0) return base
  const next = (base + elapsedMs / durationMs) % 1
  return next < 0 ? next + 1 : next
}

/** Nearest sample index (0-based) for playhead `t` over `poseCount` samples. */
export function sampleIndexAtT(poseCount: number, t: number): number {
  if (!Number.isFinite(poseCount) || poseCount <= 1) return 0
  return Math.round(clamp01(t) * (poseCount - 1))
}

function lerp(a: number, b: number, w: number): number {
  return a + (b - a) * w
}

/**
 * Shortest-path angular lerp in degrees: the delta is normalised to (−180,
 * 180] before blending, so wrapping pairs (170 → −170) sweep the short way.
 */
export function lerpAngleDeg(aDeg: number, bDeg: number, w: number): number {
  const delta = ((((bDeg - aDeg) % 360) + 540) % 360) - 180
  return aDeg + delta * w
}

function lerpTransform(
  a: MotionPoseTransform,
  b: MotionPoseTransform,
  w: number
): MotionPoseTransform {
  return {
    x: lerp(a.x, b.x, w),
    y: lerp(a.y, b.y, w),
    z: lerp(a.z, b.z, w),
    rxDeg: lerpAngleDeg(a.rxDeg, b.rxDeg, w),
    ryDeg: lerpAngleDeg(a.ryDeg, b.ryDeg, w),
    rzDeg: lerpAngleDeg(a.rzDeg, b.rzDeg, w)
  }
}

/**
 * Per-component transforms at playhead `t` ∈ [0, 1], interpolating between the
 * two adjacent samples (positions lerp; angles shortest-path lerp).
 *
 * Degenerate inputs stay honest: 0 poses → empty map; 1 pose → that pose at
 * every t; out-of-range t clamps to the ends. A component id present in only
 * one of the two adjacent samples uses the sample that has it (no
 * extrapolation, no throw).
 */
export function interpolatePosesAtT(
  poses: readonly MotionPose[],
  t: number
): ReadonlyMap<string, MotionPoseTransform> {
  const out = new Map<string, MotionPoseTransform>()
  if (poses.length === 0) return out
  if (poses.length === 1) {
    for (const e of poses[0]!.transforms) out.set(e.id, e.transform)
    return out
  }
  const s = clamp01(t) * (poses.length - 1)
  const i0 = Math.min(Math.floor(s), poses.length - 2)
  const w = s - i0
  const a = poses[i0]!
  const b = poses[i0 + 1]!
  const bById = new Map(b.transforms.map((e) => [e.id, e.transform]))
  for (const e of a.transforms) {
    const target = bById.get(e.id)
    out.set(e.id, target !== undefined ? lerpTransform(e.transform, target, w) : e.transform)
  }
  for (const e of b.transforms) {
    if (!out.has(e.id)) out.set(e.id, e.transform)
  }
  return out
}

/**
 * True when every sample's per-component pose equals the first sample's (within
 * `epsilonMm`/deg) — i.e. the study ran but nothing is jointed, so playback
 * would show a frozen assembly. Differing component-id sets count as motion
 * (something appeared/vanished — worth animating rather than hiding).
 */
export function posesAreStatic(poses: readonly MotionPose[], epsilon = 1e-6): boolean {
  if (poses.length < 2) return true
  const first = new Map(poses[0]!.transforms.map((e) => [e.id, e.transform]))
  for (let i = 1; i < poses.length; i++) {
    const pose = poses[i]!
    if (pose.transforms.length !== first.size) return false
    for (const e of pose.transforms) {
      const ref = first.get(e.id)
      if (ref === undefined) return false
      if (
        Math.abs(e.transform.x - ref.x) > epsilon ||
        Math.abs(e.transform.y - ref.y) > epsilon ||
        Math.abs(e.transform.z - ref.z) > epsilon ||
        Math.abs(e.transform.rxDeg - ref.rxDeg) > epsilon ||
        Math.abs(e.transform.ryDeg - ref.ryDeg) > epsilon ||
        Math.abs(e.transform.rzDeg - ref.rzDeg) > epsilon
      ) {
        return false
      }
    }
  }
  return true
}

/**
 * Honest reason playback is disabled, or `null` when the study is animatable.
 * Degenerate cases (0 / 1 poses, or N identical poses) each get a hint that
 * says what to DO about it, not just that playback is off.
 */
export function playbackDisabledHint(poses: readonly MotionPose[]): string | null {
  if (poses.length === 0) {
    return 'No poses returned — run a Motion Study first.'
  }
  if (poses.length === 1) {
    return 'Only one pose computed — nothing to animate. Increase the sample count.'
  }
  if (posesAreStatic(poses)) {
    return 'All poses are identical — assign a revolute or slider joint to a part so the study has a degree of freedom to sweep.'
  }
  return null
}

/**
 * First joint kind in the rows that `assembly:simulate` actually drives
 * (revolute / slider), or `null` when nothing is driven. Used to phrase the
 * scrub read-out in the joint's own units (deg / mm).
 */
export function firstDrivenJointKind(
  rows: ReadonlyArray<{ readonly joint?: string }>
): DrivenJointKind | null {
  for (const row of rows) {
    if (row.joint === 'revolute' || row.joint === 'slider') return row.joint
  }
  return null
}

/** The scalar limits of a row's authored `jointLimits` the sweep read-out needs. */
export type DrivenRowLimits = {
  readonly scalarMinDeg?: number
  readonly scalarMaxDeg?: number
  readonly scalarMinMm?: number
  readonly scalarMaxMm?: number
}

/** The first driven joint's kind + the REAL sweep range the study covers. */
export type DrivenJointRange = {
  readonly kind: DrivenJointKind
  readonly min: number
  readonly max: number
}

/**
 * Kind + sweep range of the FIRST row `assembly:simulate` actually drives, or
 * `null` when nothing is driven. Mirrors the IPC's per-side resolution exactly
 * (src/main/ipc-modeling.ts `assembly:simulate`): an authored bound wins,
 * a missing side falls back to the documented default — revolute −180°..180°,
 * slider 0..100 mm. This is what couples the AUTHORED limits (AssemblyView's
 * Limits editor) into the playback read-out, so the scrub label reflects the
 * range the study really swept.
 */
export function firstDrivenJointRange(
  rows: ReadonlyArray<{ readonly joint?: string; readonly jointLimits?: DrivenRowLimits }>
): DrivenJointRange | null {
  for (const row of rows) {
    if (row.joint === 'revolute') {
      return {
        kind: 'revolute',
        min: row.jointLimits?.scalarMinDeg ?? -180,
        max: row.jointLimits?.scalarMaxDeg ?? 180
      }
    }
    if (row.joint === 'slider') {
      return {
        kind: 'slider',
        min: row.jointLimits?.scalarMinMm ?? 0,
        max: row.jointLimits?.scalarMaxMm ?? 100
      }
    }
  }
  return null
}

/**
 * Joint-scalar read-out at playhead `t`, phrased in the joint's units.
 *
 * LIMIT COUPLING (closed — was a pinned gap): the AssemblyView now threads each
 * row's authored `jointLimits` into the `assembly:simulate` input, and passes
 * the first driven row's real range here via {@link firstDrivenJointRange} /
 * {@link playbackReadout}, so the read-out sweeps the AUTHORED range. Rows with
 * no authored limits fall back to the IPC's documented defaults — revolute
 * −180°..180°, slider 0..100 mm (see src/main/ipc-modeling.ts
 * `assembly:simulate`) — which the parameter defaults below mirror.
 */
export function jointScalarLabel(
  kind: DrivenJointKind | null,
  t: number,
  limits?: { readonly min: number; readonly max: number }
): string {
  const tt = clamp01(t)
  if (kind === 'revolute') {
    const min = limits?.min ?? -180
    const max = limits?.max ?? 180
    return `${(min + tt * (max - min)).toFixed(1)}°`
  }
  if (kind === 'slider') {
    const min = limits?.min ?? 0
    const max = limits?.max ?? 100
    return `${(min + tt * (max - min)).toFixed(1)} mm`
  }
  return `t = ${Math.round(tt * 100)}%`
}

/**
 * One-line playback read-out: `pose k/N · <joint scalar>` (1-based nearest
 * sample). `limits` carries the driven joint's REAL sweep range (authored
 * limits with IPC-default fallback — see {@link firstDrivenJointRange});
 * omitted ⇒ the formatter's own defaults apply (backward compatible).
 */
export function playbackReadout(
  poseCount: number,
  t: number,
  jointKind: DrivenJointKind | null,
  limits?: { readonly min: number; readonly max: number }
): string {
  const idx = sampleIndexAtT(poseCount, t) + 1
  const total = Math.max(1, Math.floor(poseCount))
  return `pose ${idx}/${total} · ${jointScalarLabel(jointKind, t, limits)}`
}

/**
 * Compact pose summary for a part row while playback overrides its placement:
 * `@(x, y, z)` (one decimal), with ` ∠(rx, ry, rz)°` appended when any Euler
 * component is visibly non-zero. Mirrors the tone of `formatTransformSummary`.
 */
export function formatPoseSummary(t: MotionPoseTransform): string {
  const pos = `@(${t.x.toFixed(1)}, ${t.y.toFixed(1)}, ${t.z.toFixed(1)})`
  const hasRotation =
    Math.abs(t.rxDeg) > 0.05 || Math.abs(t.ryDeg) > 0.05 || Math.abs(t.rzDeg) > 0.05
  if (!hasRotation) return pos
  return `${pos} ∠(${t.rxDeg.toFixed(0)}, ${t.ryDeg.toFixed(0)}, ${t.rzDeg.toFixed(0)})°`
}

function parsePoseTransform(raw: unknown): MotionPoseTransform | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const x = o['x']
  const y = o['y']
  const z = o['z']
  const rxDeg = o['rxDeg']
  const ryDeg = o['ryDeg']
  const rzDeg = o['rzDeg']
  if (
    !isFiniteNumber(x) ||
    !isFiniteNumber(y) ||
    !isFiniteNumber(z) ||
    !isFiniteNumber(rxDeg) ||
    !isFiniteNumber(ryDeg) ||
    !isFiniteNumber(rzDeg)
  ) {
    return null
  }
  return { x, y, z, rxDeg, ryDeg, rzDeg }
}

/**
 * Tolerant runtime guard for the `assembly:simulate` `poses` payload. Malformed
 * poses / transform entries are skipped (never thrown) so a wire-shape drift
 * degrades to "fewer poses" instead of a crashed view. Output is sorted by
 * sample index so playback order never depends on wire order.
 */
export function parseMotionPoses(raw: unknown): MotionPose[] {
  if (!Array.isArray(raw)) return []
  const out: MotionPose[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const sample = o['sample']
    const transformsRaw = o['transforms']
    if (!isFiniteNumber(sample) || !Array.isArray(transformsRaw)) continue
    const transforms: Array<{ id: string; transform: MotionPoseTransform }> = []
    for (const entry of transformsRaw) {
      if (entry === null || typeof entry !== 'object') continue
      const eo = entry as Record<string, unknown>
      const id = eo['id']
      if (typeof id !== 'string' || id.length === 0) continue
      const transform = parsePoseTransform(eo['transform'])
      if (transform === null) continue
      transforms.push({ id, transform })
    }
    out.push({ sample, transforms })
  }
  out.sort((a, b) => a.sample - b.sample)
  return out
}
