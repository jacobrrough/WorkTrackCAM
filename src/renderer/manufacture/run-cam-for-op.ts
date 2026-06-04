/**
 * run-cam-for-op.ts — pure async mapper: one ManufactureFile operation → the
 * PROVEN `fab().camRun` engine, returning the engine result.
 *
 * SAFETY (G-code is sacred): every camRun field below is derived using the
 * SAME helpers and SAME inline guards as the proven caller
 * `ShopApp.tsx` `generate()` (~lines 1437-1517). This file invents ZERO
 * toolpath or post-processing logic — it only resolves the selected op + its
 * parent setup into the existing payload shape and forwards it verbatim.
 *
 * Reused proven primitives:
 *   - resolveManufactureCamDrivingOperation  (op selection / blocked-kind gate)
 *   - resolveManufactureSetupForCam          (parent-setup resolution)
 *   - resolveCamCutParamsWithMaterial + CAM_CUT_DEFAULTS (cut params)
 *   - rotaryDimsFromSetupStock / shopJobStockAsCamSetup  (stock → safe-Z / rotary)
 *   - fab().stlTransformForCam               (3-axis bake; 4-axis sends raw STL)
 *
 * This module deliberately does NOT call the runtime export-safety gate
 * (`assessGcodeForExportSafety`) — that gate runs at SEND/EXPORT time in the
 * host (mirroring ShopApp.sendToPrinter), not at generate time. Generation
 * only produces the toolpath; the caller gates before pushing to a machine.
 */
import { fab } from '../src/shop-types'
import type { ManufactureFile, ManufactureOperation, ManufactureSetup } from '../../shared/manufacture-schema'
import type { MaterialRecord } from '../../shared/material-schema'
import type { ToolLibraryFile } from '../../shared/tool-schema'
import { resolveManufactureCamDrivingOperation } from '../../shared/manufacture-cam-driving-op'
import {
  CAM_CUT_DEFAULTS,
  resolveCamCutParamsWithMaterial,
  resolveManufactureSetupForCam
} from '../../shared/cam-cut-params'
import { rotaryDimsFromSetupStock, shopJobStockAsCamSetup } from '../../shared/cam-setup-defaults'

/** Args the new-shell host (ManufactureHost) can assemble from its in-scope state. */
export type RunCamForOpArgs = {
  /** The active manufacture plan (effectiveMfg from ManufactureWorkspace). */
  mfg: ManufactureFile
  /** Index of the selected operation row (UI selection). */
  selectedOpIndex: number
  /** Resolved CNC machine id this run targets (camRunCncMachineId). */
  machineId: string
  /** Material library for material-tuned feeds. Pass [] when none is loaded. */
  materials: MaterialRecord[]
  /** Tool library for toolId→diameter/flute lookup. Pass null when none is loaded. */
  tools: ToolLibraryFile | null
  /** Python interpreter path (settings.pythonPath or 'python'). */
  pythonPath: string
  /** Absolute output G-code path (host convention: <projectDir>/output/cam.nc). */
  outPath: string
}

export type RunCamForOpResult = {
  ok: boolean
  /** outPath on success — the G-code file the engine wrote. */
  gcodePath?: string
  /** Raw G-code string returned by the engine (when it returns one). */
  gcode?: string
  warnings?: string[]
  error?: string
  hint?: string
}

/** 4-axis op kinds (copied verbatim from ShopApp.tsx:1460). */
function needs4Axis(kind: string): boolean {
  return (
    kind === 'cnc_4axis_roughing' ||
    kind === 'cnc_4axis_finishing' ||
    kind === 'cnc_4axis_contour' ||
    kind === 'cnc_4axis_indexed' ||
    kind === 'cnc_4axis_continuous'
  )
}

/** OS-aware project-dir join (mirrors ManufactureWorkspace.tsx:1424 sep logic). */
function joinProject(projectDir: string, rel: string): string {
  const sep = projectDir.includes('\\') ? '\\' : '/'
  const trimmed = projectDir.replace(/[\\/]+$/, '')
  const cleanRel = rel.replace(/^[\\/]+/, '')
  return `${trimmed}${sep}${cleanRel}`
}

/** Whole-number guard for toolDiameterMm (identical to ShopApp.tsx:1456-1459). */
function resolveToolDiameterMm(params: Record<string, unknown>): number {
  const v = params['toolDiameterMm']
  // ASSUMPTION: matches ShopApp's inline guard exactly — explicit finite >0 wins,
  // otherwise 6 mm (the same fallback resolveCamCutParams uses, cam-cut-params.ts:99).
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 6
}

/**
 * Map a single ManufactureFile operation onto `fab().camRun` and return the result.
 *
 * The `outPath` is supplied by the caller because the project directory only
 * exists in the host's settings scope; this keeps the function pure (no IPC for
 * path resolution, no global state).
 *
 * GAP-PROJECTDIR: the caller must already have a project open and pass an
 * absolute `outPath`. The op's `sourceMesh` is project-RELATIVE, so we derive
 * the project directory from `outPath`'s parent-of-`output` segment. To avoid a
 * fragile reverse-derivation, we instead require `outPath` to be absolute and
 * resolve `sourceMesh` against the directory two levels up only when needed —
 * see stlPath note. The host already knows projectDir; we reconstruct it from
 * outPath by stripping the trailing `<sep>output<sep>cam.nc` (the documented
 * host convention). If that strip fails (non-standard outPath), we fall back to
 * the outPath's own directory so the STL is still resolvable next to the gcode.
 */
export async function runCamForOp(args: RunCamForOpArgs): Promise<RunCamForOpResult> {
  const { mfg, selectedOpIndex, machineId, materials, tools, pythonPath, outPath } = args

  // ── Step 0: resolve the op that actually runs (PROVEN: rejects fdm_slice,
  // export_stl, cnc_laser, cnc_lathe_turn, cnc_probe; prefers selected else
  // first runnable cnc_* — manufacture-cam-driving-op.ts:18). ───────────────
  const picked = resolveManufactureCamDrivingOperation(mfg, selectedOpIndex)
  if (!picked.ok) {
    return { ok: false, error: picked.error, hint: picked.hint }
  }
  const op: ManufactureOperation = picked.op
  const params = (op.params ?? {}) as Record<string, unknown>

  // ── Resolve project directory from the host-convention outPath. ───────────
  // ASSUMPTION (host convention, ManufactureWorkspace.tsx:1425): outPath is
  // `<projectDir><sep>output<sep>cam.nc`. Strip that tail to recover projectDir
  // for resolving the project-relative `op.sourceMesh`. Fallback: the gcode's
  // own directory (STL is then expected alongside the gcode).
  const sep = outPath.includes('\\') ? '\\' : '/'
  const outputTail = `${sep}output${sep}`
  const tailIdx = outPath.lastIndexOf(outputTail)
  const projectDir =
    tailIdx >= 0 ? outPath.slice(0, tailIdx) : outPath.slice(0, outPath.lastIndexOf(sep))

  // ── stlPath: project-relative sourceMesh → absolute. ──────────────────────
  // GAP: ManufactureFile op has no sourceMesh? Then there is no mesh to cut.
  if (!op.sourceMesh || !op.sourceMesh.trim()) {
    return {
      ok: false,
      error: `Operation "${op.label}" has no source mesh.`,
      hint: 'Assign a source mesh (assets/*.stl) to this operation before generating a toolpath.'
    }
  }
  if (!projectDir.trim()) {
    // GAP-PROJECTDIR: cannot resolve a relative mesh without a project root.
    return {
      ok: false,
      error: 'No project directory — cannot resolve the operation source mesh.',
      hint: 'Open or save the project first so the toolpath has an absolute mesh + output path.'
    }
  }
  const absStl = joinProject(projectDir, op.sourceMesh)

  // ── Step 1: resolve the parent setup (PROVEN: cam-cut-params.ts:288). ──────
  // GAP-SETUP: operations carry no setupId in this schema — the run uses ONE
  // resolved setup for stock/WCS regardless of which op is selected (matches
  // ManufactureWorkspace.camResolvedSetup). When no setup exists at all, fall
  // back to a benign 200×200×25 box (the same default addSetup uses,
  // ManufactureWorkspace.tsx:932) so safe-Z still derives; rotary*/stockBox*
  // fields are then left undefined.
  const setup: ManufactureSetup | undefined = resolveManufactureSetupForCam(mfg, machineId)
  const setupStockForCut: Pick<ManufactureSetup, 'stock'> = setup
    ? { stock: setup.stock }
    : shopJobStockAsCamSetup({ x: 200, y: 200, z: 25 })

  // ── Step 2: resolve cut params (PROVEN: cam-cut-params.ts:125). ───────────
  // GAP-MATERIAL: ManufactureFile/Setup has no MaterialRecord id (only
  // stock.materialType enum). With materialId:null + empty libs this safely
  // short-circuits to resolveCamCutParams (op params → stock safe-Z →
  // CAM_CUT_DEFAULTS). G-code-safe; just no material-tuned feeds.
  // GAP-TOOLS: tools come from a ToolLibraryFile|null; unwrap to ToolRecord[]
  // (empty when null). toolId→diameter/flute lookups degrade to the op's
  // explicit toolDiameterMm or 6 mm.
  const cut = resolveCamCutParamsWithMaterial({
    operation: op,
    materialId: null, // GAP-MATERIAL — no per-setup material id source
    materials, // [] degrades cleanly
    tools: tools?.tools ?? [], // GAP-TOOLS — unwrap library; [] when absent
    setup: setupStockForCut
  })

  const toolDiameterMm = resolveToolDiameterMm(params)
  const is4axis = needs4Axis(op.kind)

  // ── stlPath baking: 3-axis bakes the gizmo transform into a `.cam-aligned.stl`
  // exactly as ShopApp; 4-axis sends the RAW STL (the cam-axis4 facade applies
  // `placement` itself). ManufactureFile has no per-op transform, so the 3-axis
  // bake uses IDENTITY (position 0 / rotation 0 / scale 1) — which is a no-op
  // alignment and equivalent to sending the raw STL. We still route through
  // stlTransformForCam for 3-axis to match the proven path byte-for-byte, and
  // fall back to the raw STL on failure (ShopApp.tsx:1444). ───────────────────
  const identityTransform = {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
  let stlPathForCam = absStl
  if (!is4axis) {
    try {
      // ASSUMPTION (GAP-PLACEMENT): no per-op transform in ManufactureFile →
      // identity. Baking identity is a no-op; included only to mirror ShopApp.
      stlPathForCam = await fab().stlTransformForCam({
        stlPath: absStl,
        transform: identityTransform
      })
    } catch {
      // Mirror ShopApp: on transform failure, use the raw STL.
      stlPathForCam = absStl
    }
  }

  // ── Step 3: rest-machining prior-gcode read (opt-in, PROVEN ShopApp:1473). ─
  let priorPostedGcode: string | undefined
  if (params['usePriorPostedGcodeRest'] === true) {
    try {
      priorPostedGcode = await fab().readTextFile(outPath)
    } catch {
      priorPostedGcode = undefined
    }
  }

  // ── Rotary / stock-box fields. Only meaningful when a real setup with stock
  // exists; rotaryDimsFromSetupStock returns {} for fromExtents/no-stock so the
  // values are undefined and omitted by camRun. ────────────────────────────
  const rotaryDims = rotaryDimsFromSetupStock(setup?.stock)
  const stockX = setup?.stock && setup.stock.kind !== 'fromExtents' ? setup.stock.x : undefined
  const stockY = setup?.stock && setup.stock.kind !== 'fromExtents' ? setup.stock.y : undefined
  const stockZ = setup?.stock && setup.stock.kind !== 'fromExtents' ? setup.stock.z : undefined

  // ── Build the payload (field order mirrors ShopApp.tsx:1482-1507). ────────
  const r = await fab().camRun({
    stlPath: stlPathForCam,
    outPath,
    machineId,
    zPassMm: cut.zPassMm,
    stepoverMm: cut.stepoverMm,
    feedMmMin: cut.feedMmMin,
    plungeMmMin: cut.plungeMmMin,
    safeZMm: cut.safeZMm ?? CAM_CUT_DEFAULTS.safeZMm,
    pythonPath,
    operationKind: op.kind,
    toolDiameterMm,
    operationParams: params,
    // 4-axis rotary geometry — stock X = length along rotation axis, Y = diameter.
    rotaryStockLengthMm: rotaryDims.lengthMm,
    rotaryStockDiameterMm: rotaryDims.diameterMm,
    rotaryChuckDepthMm: setup?.rotaryChuckDepthMm, // direct setup field (schema:164)
    rotaryClampOffsetMm: setup?.rotaryClampOffsetMm ?? 0, // default 0 (ShopApp:1496)
    stockBoxZMm: stockZ,
    stockBoxXMm: stockX,
    stockBoxYMm: stockY,
    // 4-axis-only fields: mesh X-clamp + the gizmo placement. ManufactureFile
    // has no per-op transform → identity placement (GAP-PLACEMENT): correct when
    // the STL is authored in rotary WCS (X = rotation axis); rotary intent (e.g.
    // contourPoints / indexAnglesDeg) rides in operationParams.
    ...(is4axis
      ? {
          useMeshMachinableXClamp: params['useMeshMachinableXClamp'] === true,
          placement: identityTransform
        }
      : {}),
    // Only include priorPostedGcode when non-empty (ShopApp.tsx:1506).
    ...(priorPostedGcode?.trim() ? { priorPostedGcode } : {})
  })

  if (r.ok) {
    return {
      ok: true,
      gcodePath: r.gcode ? outPath : undefined,
      gcode: r.gcode,
      warnings: r.warnings,
      hint: r.hint
    }
  }
  // NOTE: the canonical cam:run contract (cam-ipc-contract.ts camRunFailureSchema)
  // is a discriminated union — the ok:false arm carries only { error, hint? },
  // NO `warnings`. So we omit warnings here (they only exist on success).
  return { ok: false, error: r.error, hint: r.hint }
}
