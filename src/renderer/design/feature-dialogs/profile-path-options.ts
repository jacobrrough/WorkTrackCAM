/**
 * Profile / path PICKER options — the bridge between the sketch and the selection-heavy feature
 * dialogs (Press/Pull, Combine, Sweep, Pipe, Pattern-along-path).
 *
 * The kernel ops reference geometry two ways (see part-features-schema.ts + build_part.py):
 *   - a PROFILE by integer `profileIndex` into the sketch's auto-detected closed profiles
 *     (`extractKernelProfiles`), and/or
 *   - a PATH as `pathPoints: [[x,y],…]` — the world-mm points of an OPEN sketch polyline.
 *
 * These pure builders turn the live `sketchDesign` into LABELLED option lists the dialogs render as
 * dropdowns (a real upgrade over the blind numeric index HoleDialog uses). Framework-agnostic +
 * node-testable; the dialogs stay presentational and just map the chosen option to the emitted op.
 */

import type { DesignFileV2 } from '../../../shared/design-schema'
import type { KernelProfileV1 } from '../../../shared/sketch-profile'
import { extractKernelProfiles } from '../../../shared/sketch-profile'

/** One selectable closed profile: its index (what the kernel op stores) + a human label. */
export type ProfileOption = {
  readonly index: number
  readonly label: string
  readonly profile: KernelProfileV1
}

/** One selectable open path: the source entity id, a label, and its resolved [x,y] points. */
export type PathOption = {
  readonly id: string
  readonly label: string
  readonly points: [number, number][]
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Human label for a detected profile, e.g. "0 · Circle ⌀20 @ (5, 5)" or "1 · Loop · 4 pts". */
export function describeProfile(profile: KernelProfileV1, index: number): string {
  if (profile.type === 'circle') {
    return `${index} · Circle ⌀${round2(profile.r * 2)} @ (${round2(profile.cx)}, ${round2(profile.cy)})`
  }
  return `${index} · Loop · ${profile.points.length} pts`
}

/** The sketch's closed profiles as selectable options (index = the kernel `profileIndex`). */
export function profileOptions(design: DesignFileV2 | undefined | null): ProfileOption[] {
  if (!design) return []
  const profiles = extractKernelProfiles(design) ?? []
  return profiles.map((profile, index) => ({ index, label: describeProfile(profile, index), profile }))
}

/** The sketch's OPEN polylines as selectable path options (their points feed `pathPoints`). */
export function pathOptions(design: DesignFileV2 | undefined | null): PathOption[] {
  if (!design) return []
  const out: PathOption[] = []
  for (const e of design.entities) {
    if (e.kind !== 'polyline' || e.closed) continue
    // The polyline entity is a union: the persisted by-point-ids form, or a resolved points form.
    let points: [number, number][]
    if ('pointIds' in e) {
      points = []
      for (const pid of e.pointIds) {
        const p = design.points[pid]
        if (p) points.push([p.x, p.y])
      }
    } else {
      points = e.points
    }
    if (points.length >= 2) out.push({ id: e.id, label: `Polyline · ${points.length} pts`, points })
  }
  return out
}
