import { getManufactureCamRunBlock, isManufactureKindBlockedFromCam } from './manufacture-cam-gate'
import type { ManufactureFile, ManufactureOperation } from './manufacture-schema'

function isCncKind(kind: string): boolean {
  return kind.startsWith('cnc_')
}

function isRunnableCncOp(op: ManufactureOperation | undefined): op is ManufactureOperation {
  if (!op || op.suppressed) return false
  if (!isCncKind(op.kind)) return false
  return !isManufactureKindBlockedFromCam(op.kind)
}

/**
 * Picks the single manufacture operation that drives **Generate CAM** (`cam:run`).
 * Prefers the **selected** row when it is a runnable CNC op; otherwise the first runnable `cnc_*` op.
 */
export function resolveManufactureCamDrivingOperation(
  mfg: ManufactureFile,
  selectedOpIndex: number
): { ok: true; op: ManufactureOperation; index: number } | { ok: false; error: string; hint: string } {
  const ops = mfg.operations
  if (ops.length === 0) {
    return {
      ok: false,
      error: 'No operations in the manufacture plan.',
      hint: 'Add a CNC operation and set its source mesh before generating a toolpath.'
    }
  }

  const sel = Math.max(0, Math.min(selectedOpIndex, ops.length - 1))
  const selected = ops[sel]
  if (selected && isRunnableCncOp(selected)) {
    const block = getManufactureCamRunBlock(selected.kind)
    if (block) {
      return { ok: false, error: block.error, hint: block.hint }
    }
    return { ok: true, op: selected, index: sel }
  }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    if (isRunnableCncOp(op)) {
      const block = getManufactureCamRunBlock(op.kind)
      if (block) continue
      return { ok: true, op, index: i }
    }
  }

  return {
    ok: false,
    error: 'No runnable CNC operation found.',
    hint:
      'Add or un-suppress a `cnc_*` operation (not fdm_slice, export_stl, cnc_laser, or cnc_lathe_turn). Select the operation you want to generate, or put a runnable CNC row in the plan.'
  }
}
