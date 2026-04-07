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
        '**Generate CAM** uses the built-in **parallel finish** from STL mesh bounds (no OpenCAMLib requirement for this op). G-code stays **unverified** until post/machine checks (docs/MACHINES.md).'
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
  if (kind === 'cnc_thread_mill') {
    return {
      runnable: true,
      hint:
        '**Thread Milling** — helical thread entry along a bore or contour. Requires `contourPoints`, `threadPitchMm`, `threadDepthMm`, and `toolDiameterMm`. `threadDirection` defaults to right-hand (\'right\'). G-code is **unverified** (docs/MACHINES.md).'
    }
  }
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
  if (kind === 'cnc_spiral_finish') {
    return {
      runnable: true,
      hint:
        '**Spiral finishing** — continuous spiral toolpath for smooth freeform surfaces. Minimal retracts, low vibration. Best for gently curved parts with low curvature variance. Requires Python toolpath engine. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_morphing_finish') {
    return {
      runnable: true,
      hint:
        '**Morphing finish** — automatic blend between waterline and raster based on local surface angle. Seamless steep-to-shallow transitions without manual region selection. Requires Python toolpath engine. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_trochoidal_hsm') {
    return {
      runnable: true,
      hint:
        '**Trochoidal HSM** — constant chip-load trochoidal slot clearing for high-speed machining. Reduces tool wear and heat in slotting. Set `zPassMm` for depth, `stepoverMm` for advance per circle. Requires Python toolpath engine. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_steep_shallow') {
    return {
      runnable: true,
      hint:
        '**Steep-and-shallow** — classifies mesh into steep and shallow regions, applies waterline to steep walls and raster to gentle surfaces with overlap band for seamless blending. Best for mixed-angle geometry. Requires Python toolpath engine. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_scallop_finish') {
    return {
      runnable: true,
      hint:
        '**Scallop finishing** — adapts XY pass spacing based on local surface angle to maintain uniform residual cusp height. Produces the best surface finish quality on mixed-curvature freeform parts. Set `surfaceFinishRaUm` for target Ra (default 3.2 µm). Requires Python toolpath engine. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_4axis_continuous') {
    return {
      runnable: true,
      hint:
        '**4-axis continuous** — simultaneous 4-axis machining with cylindrical heightmap. Tool addresses workpiece radially with helical ramp entries and zigzag axial sweeps. Both roughing and finishing in one pass. Requires `axisCount: 4` and Python toolpath engine. G-code is **unverified** — run an air cut first (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_5axis_contour') {
    return {
      runnable: true,
      hint:
        '**5-axis contour** — simultaneous 5-axis normal-following with BVH collision avoidance. Tool tilts to follow surface normals for optimal cutter contact. Requires `axisCount: 5` and Python toolpath engine. G-code is **unverified** — verify on machine with air cut first (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_5axis_swarf') {
    return {
      runnable: true,
      hint:
        '**5-axis swarf** — flank milling for steep/vertical walls. Tool tilts into wall along contour tangent for efficient wall finishing. Best for ruled or near-vertical surfaces. Requires `axisCount: 5` and Python toolpath engine. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_5axis_flowline') {
    return {
      runnable: true,
      hint:
        '**5-axis flowline** — follows dominant surface direction with smooth angular rate limits. Continuous tool orientation for complex freeform surfaces. Requires `axisCount: 5` and Python toolpath engine. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
  if (kind === 'cnc_auto_select') {
    return {
      runnable: true,
      hint:
        '**Auto-select** — analyzes mesh geometry (surface angles, curvature, aspect ratio) and automatically selects the optimal machining strategy. The chosen strategy and confidence level are reported in the G-code output. Requires Python toolpath engine. G-code is **unverified** (docs/MACHINES.md).'
    }
  }
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
