/**
 * FEATURE RE-EDIT · Pure mapper from a persisted timeline op
 * (`KernelPostSolidOp`) to the {@link FeatureDialogSpec} that opens the SAME
 * feature dialog PRE-FILLED with that op's current parameters — the seam that
 * lets the timeline's ✎ button reuse the existing per-feature dialogs for
 * editing instead of growing 30 bespoke edit forms.
 *
 * Contract (mirrors the seed-spec switch in `DesignWorkspace.featureDialogSpec`
 * — the param shapes here MUST stay in lockstep with each dialog's `*Params`):
 *   - Returns a spec ONLY when the dialog can round-trip the op FAITHFULLY:
 *     every field the op carries is either seeded into the dialog or re-emitted
 *     unchanged by the dialog's op-builder. Anything less would silently drop
 *     data on Apply (e.g. FilletDialog derives `pickedEdgeIds` from the LIVE
 *     viewport selection, not from params — so an op that carries picked ids
 *     must NOT open it, or the ids would vanish).
 *   - Returns `null` for every other kind; the caller falls back to the
 *     {@link GenericOpEditor}, which edits primitive fields and preserves the
 *     rest verbatim. Every op kind is therefore editable — just not always
 *     through a bespoke dialog.
 *
 * Honest null cases (generic editor instead):
 *   - `fillet_select` / `chamfer_select` with `pickedEdgeIds`, `shell_inward`
 *     with `pickedFaceIds` — the dialogs would drop the picked topology.
 *   - `datum_*` with a `label` — the datum dialogs seed the label field empty.
 *   - profile/path ops (`press_pull_profile`, `boolean_combine_profile`,
 *     `pipe_path`, `pattern_path`, `sweep_profile_path_true`) — their dialogs
 *     re-derive `pathPoints` / profile options from the LIVE sketch pickers,
 *     which may no longer match the persisted geometry.
 *   - kinds with no dialog at all (`sweep_profile_path`, `thread_cosmetic`,
 *     `thicken_scale`, `sheet_*`, `loft_guide_rails`).
 *
 * No React, no IPC, no Zod — exported pure so the node-suite test can assert
 * every mapping (and every honest null) without rendering.
 */

import type { KernelPostSolidOp } from '../../../shared/part-features-schema'
import type { FeatureDialogSpec } from './FeatureDialogHost'

export function featureDialogSpecForOp(op: KernelPostSolidOp): FeatureDialogSpec | null {
  switch (op.kind) {
    case 'fillet_all':
      return { kind: 'fillet', params: { radiusMm: op.radiusMm, mode: 'all' } }
    case 'fillet_select':
      if (op.pickedEdgeIds !== undefined) return null // dialog would drop the picked ids
      return {
        kind: 'fillet',
        params: { radiusMm: op.radiusMm, mode: 'select', edgeDirection: op.edgeDirection }
      }
    case 'chamfer_all':
      return { kind: 'chamfer', params: { lengthMm: op.lengthMm, mode: 'all' } }
    case 'chamfer_select':
      if (op.pickedEdgeIds !== undefined) return null
      return {
        kind: 'chamfer',
        params: { lengthMm: op.lengthMm, mode: 'select', edgeDirection: op.edgeDirection }
      }
    case 'shell_inward':
      if (op.pickedFaceIds !== undefined) return null
      return {
        kind: 'shell',
        params: { thicknessMm: op.thicknessMm, openDirection: op.openDirection }
      }
    case 'hole_from_profile':
      return {
        kind: 'hole',
        params: {
          profileIndex: op.profileIndex,
          mode: op.mode,
          depthMm: op.depthMm,
          zStartMm: op.zStartMm
        }
      }
    case 'datum_plane':
      if (op.label !== undefined) return null // dialog seeds the label field empty
      return { kind: 'datum_plane', params: { basePlane: op.basePlane, offsetMm: op.offsetMm } }
    case 'datum_axis':
      if (op.label !== undefined) return null
      return {
        kind: 'datum_axis',
        params: {
          axis: op.axis,
          originXMm: op.originXMm,
          originYMm: op.originYMm,
          originZMm: op.originZMm
        }
      }
    case 'datum_point':
      if (op.label !== undefined) return null
      return { kind: 'datum_point', params: { xMm: op.xMm, yMm: op.yMm, zMm: op.zMm } }
    case 'transform_translate':
      return {
        kind: 'transform_translate',
        params: {
          dxMm: op.dxMm,
          dyMm: op.dyMm,
          dzMm: op.dzMm,
          mode: op.keepOriginal ? 'copy' : 'move'
        }
      }
    case 'mirror_union_plane':
      return {
        kind: 'mirror_union_plane',
        params: {
          plane: op.plane,
          originXMm: op.originXMm,
          originYMm: op.originYMm,
          originZMm: op.originZMm
        }
      }
    case 'split_keep_halfspace':
      return {
        kind: 'split_keep_halfspace',
        params: { axis: op.axis, offsetMm: op.offsetMm, keep: op.keep }
      }
    case 'pattern_rectangular':
      return {
        kind: 'pattern_rectangular',
        params: {
          countX: op.countX,
          countY: op.countY,
          spacingXMm: op.spacingXMm,
          spacingYMm: op.spacingYMm
        }
      }
    case 'pattern_circular':
      return {
        kind: 'pattern_circular',
        params: {
          count: op.count,
          centerXMm: op.centerXMm,
          centerYMm: op.centerYMm,
          startAngleDeg: op.startAngleDeg,
          totalAngleDeg: op.totalAngleDeg
        }
      }
    case 'pattern_linear_3d':
      return {
        kind: 'pattern_linear_3d',
        params: { count: op.count, dxMm: op.dxMm, dyMm: op.dyMm, dzMm: op.dzMm }
      }
    case 'boolean_union_box':
      return {
        kind: 'boolean_union_box',
        params: {
          xMinMm: op.xMinMm,
          xMaxMm: op.xMaxMm,
          yMinMm: op.yMinMm,
          yMaxMm: op.yMaxMm,
          zMinMm: op.zMinMm,
          zMaxMm: op.zMaxMm
        }
      }
    case 'boolean_subtract_box':
      return {
        kind: 'boolean_subtract_box',
        params: {
          xMinMm: op.xMinMm,
          xMaxMm: op.xMaxMm,
          yMinMm: op.yMinMm,
          yMaxMm: op.yMaxMm,
          zMinMm: op.zMinMm,
          zMaxMm: op.zMaxMm
        }
      }
    case 'boolean_intersect_box':
      return {
        kind: 'boolean_intersect_box',
        params: {
          xMinMm: op.xMinMm,
          xMaxMm: op.xMaxMm,
          yMinMm: op.yMinMm,
          yMaxMm: op.yMaxMm,
          zMinMm: op.zMinMm,
          zMaxMm: op.zMaxMm
        }
      }
    case 'boolean_subtract_cylinder':
      return {
        kind: 'boolean_subtract_cylinder',
        params: {
          centerXMm: op.centerXMm,
          centerYMm: op.centerYMm,
          radiusMm: op.radiusMm,
          zMinMm: op.zMinMm,
          zMaxMm: op.zMaxMm
        }
      }
    case 'thread_wizard':
      return {
        kind: 'thread_wizard',
        params: {
          centerXMm: op.centerXMm,
          centerYMm: op.centerYMm,
          majorRadiusMm: op.majorRadiusMm,
          pitchMm: op.pitchMm,
          lengthMm: op.lengthMm,
          depthMm: op.depthMm,
          zStartMm: op.zStartMm,
          hand: op.hand,
          mode: op.mode,
          standard: op.standard,
          designation: op.designation,
          class: op.class,
          starts: op.starts
        }
      }
    case 'thicken_offset':
      return { kind: 'thicken_offset', params: { distanceMm: op.distanceMm, side: op.side } }
    case 'coil_cut':
      return {
        kind: 'coil_cut',
        params: {
          centerXMm: op.centerXMm,
          centerYMm: op.centerYMm,
          majorRadiusMm: op.majorRadiusMm,
          pitchMm: op.pitchMm,
          turns: op.turns,
          depthMm: op.depthMm,
          zStartMm: op.zStartMm
        }
      }
    case 'plastic_rule_fillet':
      return { kind: 'plastic_rule_fillet', params: { radiusMm: op.radiusMm } }
    case 'plastic_boss':
      return {
        kind: 'plastic_boss',
        params: {
          centerXMm: op.centerXMm,
          centerYMm: op.centerYMm,
          zBaseMm: op.zBaseMm,
          outerRadiusMm: op.outerRadiusMm,
          heightMm: op.heightMm,
          holeRadiusMm: op.holeRadiusMm,
          draftDeg: op.draftDeg
        }
      }
    case 'plastic_lip_groove':
      return {
        kind: 'plastic_lip_groove',
        params: {
          mode: op.mode,
          xMinMm: op.xMinMm,
          xMaxMm: op.xMaxMm,
          yMinMm: op.yMinMm,
          yMaxMm: op.yMaxMm,
          zBaseMm: op.zBaseMm,
          depthMm: op.depthMm
        }
      }
    // Profile/path dialogs re-derive their geometry from LIVE sketch pickers —
    // a pre-fill could silently rebind the op to different geometry. Generic.
    case 'press_pull_profile':
    case 'boolean_combine_profile':
    case 'pipe_path':
    case 'pattern_path':
    case 'sweep_profile_path_true':
      return null
    // No dialog exists for these kinds — generic editor.
    case 'sweep_profile_path':
    case 'thread_cosmetic':
    case 'thicken_scale':
    case 'sheet_tab_union':
    case 'sheet_fold':
    case 'sheet_flat_pattern':
    case 'loft_guide_rails':
      return null
    default: {
      // Exhaustiveness guard — a new op kind must be classified above (spec or
      // an explicit null) so re-edit coverage is a conscious decision.
      const _never: never = op
      void _never
      return null
    }
  }
}

export default featureDialogSpecForOp
