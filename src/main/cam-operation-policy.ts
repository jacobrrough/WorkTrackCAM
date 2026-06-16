import { getManufactureCamRunBlock } from '../shared/manufacture-cam-gate'

/**
 * Maps manufacture.json operation kinds to the STL-based CAM runner.
 * Keeps IPC backward-compatible: omit kind → parallel finish.
 * Non-CNC rows (`fdm_slice`, `export_stl`) are not runnable via `cam:run`.
 */
export function describeCamOperationKind(kind: string | undefined): {
  runnable: boolean
  error?: string
  hint?: string
} {
  const blocked = getManufactureCamRunBlock(kind)
  if (blocked) {
    return { runnable: false, error: blocked.error, hint: blocked.hint }
  }
  if (kind === 'cnc_parallel') {
    return {
      runnable: true,
      hint:
        '**Generate CAM** uses the built-in **parallel finish** from STL mesh bounds (no OpenCAMLib requirement for this op). If you overwrite the STL in `assets/`, regenerate G-code — Manufacture compares mesh file mtime to `output/cam.nc` and warns when the file on disk is newer. G-code stays **unverified** until post/machine checks (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_adaptive') {
    return {
      runnable: true,
      hint:
        '**Generate CAM** uses the **advanced adaptive clearing engine** (constant-engagement roughing with ramp entry) when Python is available; falls back to OpenCAMLib **AdaptiveWaterline** or built-in parallel finish. G-code stays unverified until post/machine checks (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_waterline') {
    return {
      runnable: true,
      hint:
        '**Generate CAM** uses the **advanced waterline engine** (Z-level contouring with scallop-aware stepdown) when Python is available; falls back to OpenCAMLib **Waterline** or built-in parallel finish. G-code stays unverified until post/machine checks (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_raster') {
    return {
      runnable: true,
      hint:
        '**Generate CAM** uses the **advanced raster engine** (surface-following zigzag with gap detection) when Python is available; falls back to **OpenCAMLib PathDropCutter** XY raster, then **built-in 2.5D mesh height-field** raster, then **orthogonal bounds** zigzag. Optional **`usePriorPostedGcodeRest: true`** (Manufacture) enables rest machining. G-code stays **unverified** until post/machine checks (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_pencil') {
    return {
      runnable: true,
      hint:
        '**Pencil / rest cleanup:** uses the **advanced pencil trace engine** (Laplacian curvature detection for concave regions) when Python is available; falls back to **OpenCAMLib raster** with tighter stepover, then built-in mesh / bounds raster. G-code stays **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_contour' || kind === 'cnc_pocket' || kind === 'cnc_drill') {
    return {
      runnable: true,
      hint:
        'Uses built-in 2D paths from operation geometry (`contourPoints` for contour/pocket, `drillPoints` for drilling). Contour supports side (`climb`/`conventional`) plus optional lead-in/out and optional multi-depth (`zStepMm` when `zPassMm` is negative, same step semantics as pocket). Pocket supports optional step-down (`zStepMm`), entry mode (`plunge`/`ramp` + `rampMm` + optional `rampMaxAngleDeg`, default 45° — XY run is lengthened within each segment to limit ramp steepness, with CAM hints if a span is too short), rough wall stock, and optional finish contour pass with side + lead-in/out (final depth or each depth). Drill cycles are machine-aware (Grbl defaults to expanded moves; other profiles default to G81, optional G82/G83 via params). Missing/invalid geometry is a hard error (no STL parallel fallback). G-code stays **unverified** until post/machine checks (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_4axis_roughing') {
    return {
      runnable: true,
      hint:
        '**4-axis roughing** — mesh-aware radial waterline roughing. Removes bulk material layer-by-layer from stock OD toward the part surface using a cylindrical heightmap with tool-radius compensation. Requires `axisCount: 4`. Set `zPassMm` (total radial depth), `zStepMm` (per-layer step-down), `stepoverDeg` (angular step). G-code is **unverified** — run an air cut first (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_4axis_finishing') {
    return {
      runnable: true,
      hint:
        '**4-axis finishing** — mesh-aware surface-following finish pass. Fine angular stepover follows the compensated part surface at final depth. Requires `axisCount: 4`. Set `zPassMm` (final depth), `finishStepoverDeg` (fine angular step). G-code is **unverified** — run an air cut first (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_4axis_contour') {
    return {
      runnable: true,
      hint:
        '**4-axis contour** — wraps a 2D contour onto the cylinder surface for engraving or profiling. Requires `axisCount: 4` and `contourPoints: [x,y][]`. Set `zPassMm` for cut depth. G-code is **unverified** — run an air cut first (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_4axis_indexed') {
    return {
      runnable: true,
      hint:
        '**4-axis indexed** — locks A at discrete angles (`indexAnglesDeg`) and machines a 3-axis pass at each stop. Useful for milling flat faces, keyways, or hex profiles on round stock. Requires `axisCount: 4` on the machine profile. **Shop:** stock length and diameter come from job stock (X/Y); **Manufacture:** set `cylinderDiameterMm` / `cylinderLengthMm` when rotary stock is not on `cam:run`. **Run an air cut with spindle OFF before any real cut.** G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_chamfer') {
    return {
      runnable: true,
      hint:
        '**2D Chamfer** — cuts a chamfer along a closed contour using a V-bit or chamfer mill. Requires `contourPoints: [x,y][]` and `chamferDepthMm`. `chamferAngleDeg` defaults to 45° (half-angle of tool). Feed/plunge from cut params. G-code is **unverified** until post/machine checks (docs/MACHINES.md).'
    }
  }
  // cnc_thread_mill is BLOCKED by the gate (no thread-milling engine — it would
  // fall through to a flat parallel finish, which is not a thread). See
  // getManufactureCamRunBlock in ../shared/manufacture-cam-gate.
  if (kind === 'cnc_laser') {
    return {
      runnable: false,
      error: 'Laser operations are not yet posted by the built-in CAM runner. Export G-code from dedicated laser software or Makera CAM and import via the Tools tab.',
      hint: '**Laser path** — set `laserMode` (\'vector\'|\'raster\'|\'fill\'), `laserPower` (0–100), `laserSpeed` mm/min, and `passes`. Contour points drive vector/fill mode.'
    }
  }
  if (kind === 'cnc_pcb_isolation' || kind === 'cnc_pcb_drill' || kind === 'cnc_pcb_contour') {
    return {
      runnable: true,
      hint:
        '**PCB operation** — isolation routing, drilling, or board outline. Set `contourPoints` (isolation/outline) or `drillPoints` (drilling), `zPassMm`, and tool params. PCB operations use the same 2D path engine as standard contour/drill ops. Material type should be set to `pcb` on the setup stock. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  // ── v4.0 Toolpath Engine strategies ──
  // cnc_spiral_finish / cnc_morphing_finish / cnc_steep_shallow /
  // cnc_scallop_finish / cnc_auto_select are BLOCKED by the gate — their Python
  // toolpath_engine was deleted in the 2026-05-27 pivot and they have no
  // fallback, so cam:run always hard-fails. See getManufactureCamRunBlock.
  // cnc_trochoidal_hsm stays runnable: it has a real 2D contour engine (and an
  // honest parallel-finish fallback in mesh mode).
  if (kind === 'cnc_trochoidal_hsm') {
    return {
      runnable: true,
      hint:
        '**Trochoidal HSM** — constant chip-load trochoidal slot clearing for high-speed machining. Reduces tool wear and heat in slotting. Set `zPassMm` for depth, `stepoverMm` for advance per circle. Requires Python toolpath engine. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  // cnc_steep_shallow / cnc_scallop_finish: BLOCKED by the gate (deleted engine,
  // no fallback). See getManufactureCamRunBlock.
  if (kind === 'cnc_4axis_continuous') {
    return {
      runnable: true,
      hint:
        '**4-axis continuous** — simultaneous 4-axis machining with cylindrical heightmap. Tool addresses workpiece radially with helical ramp entries and zigzag axial sweeps. Both roughing and finishing in one pass. Requires `axisCount: 4` and Python toolpath engine. G-code is **unverified** — run an air cut first (docs/MACHINES.md).'
    }
  }
  // cnc_5axis_contour / cnc_5axis_swarf / cnc_5axis_flowline: BLOCKED by the gate
  // (no 5-axis machine in shop scope + deleted engine). cnc_auto_select: BLOCKED
  // (deleted engine, no fallback). See getManufactureCamRunBlock.
  if (kind === 'cnc_3d_rough') {
    return {
      runnable: true,
      hint:
        '**3D Roughing** — bulk material removal with constant-engagement adaptive clearing. Leaves `stockAllowanceMm` (default 0.5 mm) on all walls for a subsequent finish pass. Uses the Python adaptive clearing engine when available; falls back to OpenCAMLib AdaptiveWaterline then built-in parallel. Set `zPassMm`, `stepoverMm`, `toolDiameterMm`, and optionally `stockAllowanceMm`. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_3d_finish') {
    return {
      runnable: true,
      hint:
        '**3D Finishing** — fine surface pass to final geometry. `finishStrategy` selects `raster` (default), `waterline`, or `pencil`. `finishStepoverMm` overrides stepover; alternatively `finishScallopMm` (with optional `finishScallopMode` `ball`|`flat`) derives stepover from target scallop height. Requires Python toolpath engine for waterline/pencil strategies; raster falls back to OpenCAMLib PathDropCutter. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  return { runnable: true }
}
