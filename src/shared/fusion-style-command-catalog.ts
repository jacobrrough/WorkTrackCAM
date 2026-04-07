/**
 * Fusion-style command inventory for Unified Fab Studio.
 * Names mirror common CAD/Fusion workflows; this is not Autodesk software and does not ship proprietary assets.
 * Status reflects this codebase today — most modeling commands remain planned until OCCT/history integration.
 */

export type CommandParityStatus = 'implemented' | 'partial' | 'planned'

/** Where the command would live in our shell (not a 1:1 Fusion ribbon clone). */
export type CommandShellWorkspace = 'design' | 'assemble' | 'manufacture' | 'utilities'

/** Logical ribbon / tab grouping (Fusion-like buckets). */
export type CommandRibbonGroup =
  | 'sketch_create'
  | 'sketch_modify'
  | 'sketch_constraint'
  | 'sketch_dimension'
  | 'solid_create'
  | 'solid_modify'
  | 'solid_pattern'
  | 'surface'
  | 'sheet_metal'
  | 'plastic'
  | 'assemble'
  | 'assemble_joint'
  | 'manufacture_setup'
  | 'manufacture_2d'
  | 'manufacture_3d'
  | 'drawing'
  | 'inspect'
  | 'manage'

export type FusionStyleCommand = {
  id: string
  /** User-visible name */
  label: string
  ribbon: CommandRibbonGroup
  workspace: CommandShellWorkspace
  status: CommandParityStatus
  /** Fusion-style ribbon hint for users (e.g. CREATE, MODIFY) */
  fusionRibbon?: string
  notes?: string
}

/** Ribbon dropdown options shared by command palette and Utilities → Commands catalog. */
export const COMMAND_CATALOG_RIBBON_FILTER_OPTIONS: { id: CommandRibbonGroup | 'all'; label: string }[] = [
  { id: 'all', label: 'Any ribbon' },
  { id: 'sketch_create', label: 'Sketch · Create' },
  { id: 'sketch_modify', label: 'Sketch · Modify' },
  { id: 'sketch_constraint', label: 'Sketch · Constraints' },
  { id: 'sketch_dimension', label: 'Sketch · Dimensions' },
  { id: 'solid_create', label: 'Solid · Create' },
  { id: 'solid_modify', label: 'Solid · Modify' },
  { id: 'solid_pattern', label: 'Solid · Pattern' },
  { id: 'surface', label: 'Surface' },
  { id: 'sheet_metal', label: 'Sheet metal' },
  { id: 'plastic', label: 'Plastic' },
  { id: 'assemble', label: 'Assemble' },
  { id: 'assemble_joint', label: 'Joints' },
  { id: 'manufacture_setup', label: 'Mfg · Setup' },
  { id: 'manufacture_2d', label: 'Mfg · 2D' },
  { id: 'manufacture_3d', label: 'Mfg · 3D' },
  { id: 'drawing', label: 'Drawing' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'manage', label: 'Manage' }
]

function c(
  id: string,
  label: string,
  ribbon: CommandRibbonGroup,
  workspace: CommandShellWorkspace,
  status: CommandParityStatus,
  fusionRibbon?: string,
  notes?: string
): FusionStyleCommand {
  return { id, label, ribbon, workspace, status, fusionRibbon, notes }
}

/** Full inventory — expand over time; search UI reads this list. */
export const FUSION_STYLE_COMMAND_CATALOG: FusionStyleCommand[] = [
  // —— Sketch CREATE (Fusion: SKETCH / CREATE) ——
  c(
    'sk_line',
    'Line',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Two-click open segment (point-ID polyline, 2 vertices)'
  ),
  c(
    'sk_arc_3pt',
    'Arc (three point)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'v2 arc + optional closed profile (chord); kernel loop tessellation matches Three preview'
  ),
  c(
    'sk_arc_center',
    'Arc (center)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Center → start (radius) → end; minor arc stored as v2 three-point arc (trim/kernel unchanged)'
  ),
  c('sk_circle_center', 'Circle (center)', 'sketch_create', 'design', 'implemented', 'CREATE', '2D circle entity'),
  c(
    'sk_circle_2pt',
    'Circle (two point)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Two clicks = diameter; stored as `circle` entity (center midpoint, r = half chord)'
  ),
  c(
    'sk_circle_3pt',
    'Circle (three point)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Three non-collinear picks → circumcircle; stored as `circle` entity'
  ),
  c('sk_rect', 'Rectangle', 'sketch_create', 'design', 'implemented', 'CREATE', 'Axis-aligned rect'),
  c(
    'sk_rect_3pt',
    'Rectangle (three point)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Two clicks = first edge (width + angle); third = height; same `rect` entity as drag'
  ),
  c(
    'sk_slot_center',
    'Slot (center to center)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Two cap-center picks + third for width → `slot` entity (stadium loop for kernel / extrude)'
  ),
  c(
    'sk_slot_overall',
    'Slot (overall)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Two tip picks (overall axis length) + width → `slot` with length = overall − width'
  ),
  c(
    'sk_polygon',
    'Polygon',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Regular N-gon (3–128 sides): center + corner → closed point-ID `polyline`'
  ),
  c(
    'sk_ellipse',
    'Ellipse',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Center → major axis end → third pick sets minor extent (ellipse entity; kernel loop tessellated)'
  ),
  c(
    'sk_spline_fit',
    'Spline (fit points)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Catmull–Rom through knot point IDs; constraints/solver2d apply to those points only (no spline-specific energy). Trim uses dense tessellation for more stable cuts.'
  ),
  c(
    'sk_spline_cp',
    'Spline (control points)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Uniform cubic B-spline from control point IDs; constraints target control vertices only; curve does not pass through all controls. Trim uses dense tessellation for more stable cuts.'
  ),
  c(
    'sk_fillet_sk',
    'Fillet (sketch)',
    'sketch_modify',
    'design',
    'implemented',
    'MODIFY',
    'Polyline corner fillet plus arc-arc fillet when two arcs share an endpoint; radius in ribbon; resulting arc chain remains extrudable-friendly.'
  ),
  c(
    'sk_chamfer_sk',
    'Chamfer (sketch)',
    'sketch_modify',
    'design',
    'implemented',
    'MODIFY',
    'Point-ID polyline: two consecutive edges at a corner; leg length L along each edge from vertex'
  ),
  c(
    'sk_point',
    'Point',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Click adds UUID in `points` (no entity); visible on canvas; constraints / dims can reference'
  ),
  c('sk_polyline', 'Polyline', 'sketch_create', 'design', 'implemented', 'CREATE', 'Close loop for profile'),
  c(
    'sk_offset',
    'Offset',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Closed point-ID polyline → miter offset copy (Sketch ribbon Δ mm); palette scrolls to offset controls'
  ),
  c(
    'sk_project',
    'Project / Include',
    'sketch_create',
    'design',
    'partial',
    'CREATE',
    'Click mesh in 3D → orthogonal projection to sketch plane; Commit sanitizes duplicate picks and auto-closes near-loop drafts. Still not true edge topology / curve trim.'
  ),
  c(
    'sk_mirror_sk',
    'Mirror (sketch)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Two picks define mirror axis; reflects points + primitive centers; with point selection, mirrors selection only'
  ),
  c(
    'sk_pattern_sk',
    'Pattern (sketch)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Linear: Pat # + ΔX/ΔY along k×Δ. Circular: pivot + total° + start°, step = total°÷Pat # (matches kernel pattern_circular). Path: translation-only samples along selected polyline (optional closed-path sampling).'
  ),
  c(
    'sk_move_sk',
    'Move (sketch)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Two-click translation; with sketch points selected, moves selection only'
  ),
  c(
    'sk_rotate_sk',
    'Rotate (sketch)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Pivot + ribbon angle (deg); with points selected, rotates selection only'
  ),
  c(
    'sk_scale_sk',
    'Scale (sketch)',
    'sketch_create',
    'design',
    'implemented',
    'CREATE',
    'Pivot + scale factor; with points selected, scales selection only'
  ),
  c(
    'sk_trim',
    'Trim',
    'sketch_modify',
    'design',
    'implemented',
    'MODIFY',
    'Polyline or arc target; polyline cutter = infinite line, arc cutter = full circle; click picks side to remove'
  ),
  c(
    'sk_extend',
    'Extend',
    'sketch_modify',
    'design',
    'implemented',
    'MODIFY',
    'Two-click extend: pick boundary edge/arc, then target open polyline edge end'
  ),
  c(
    'sk_break',
    'Break',
    'sketch_modify',
    'design',
    'implemented',
    'MODIFY',
    'Click edge to break into two disconnected entities (open polyline/arc)'
  ),
  c(
    'sk_split',
    'Split',
    'sketch_modify',
    'design',
    'implemented',
    'MODIFY',
    'Click edge to split at point (polyline edge insert, arc split into two arcs)'
  ),

  // —— Sketch CONSTRAINTS ——
  c('co_coincident', 'Coincident', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS'),
  c('co_collinear', 'Collinear', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'Three points, solver'),
  c('co_concentric', 'Concentric', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'Two circle/arc entities share center'),
  c('co_equal', 'Equal', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'Two segments, solver'),
  c('co_fix', 'Fix / Unfix', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'Fix point'),
  c('co_horizontal', 'Horizontal', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS'),
  c('co_vertical', 'Vertical', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS'),
  c('co_parallel', 'Parallel', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'Two segments, solver'),
  c('co_perpendicular', 'Perpendicular', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'Two segments, solver'),
  c(
    'co_tangent',
    'Tangent',
    'sketch_constraint',
    'design',
    'implemented',
    'CONSTRAINTS',
    'Line segment + arc start/end; line direction ⟂ radius at tangency (solver)'
  ),
  c('co_smooth', 'Smooth (G2)', 'sketch_constraint', 'design', 'planned', 'CONSTRAINTS'),
  c(
    'co_symmetric',
    'Symmetric',
    'sketch_constraint',
    'design',
    'implemented',
    'CONSTRAINTS',
    'P2 = reflect(P1) across axis line La—Lb (solver)'
  ),
  c('co_midpoint', 'Midpoint', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'M = midpoint of A—B, solver'),
  c('co_polygon', 'Polygon', 'sketch_constraint', 'design', 'planned', 'CONSTRAINTS'),
  c('co_distance', 'Distance / length', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'Driven by parameters map'),
  c('co_radius', 'Radius', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'Circle/arc radius driven by parameter key'),
  c('co_diameter', 'Diameter', 'sketch_constraint', 'design', 'implemented', 'CONSTRAINTS', 'Circle/arc diameter driven by parameter key'),
  c(
    'co_angle',
    'Angle',
    'sketch_constraint',
    'design',
    'implemented',
    'CONSTRAINTS',
    'Two segments; target angle in degrees via parameters map + solver'
  ),

  // —— Sketch DIMENSIONS ——
  c(
    'dim_linear',
    'Linear dimension',
    'sketch_dimension',
    'design',
    'implemented',
    'CREATE',
    'Hybrid driving: linear/aligned auto-create distance driver + parameter; optional parameterKey readout remains visible in canvas and list controls.'
  ),
  c(
    'dim_aligned',
    'Aligned dimension',
    'sketch_dimension',
    'design',
    'implemented',
    'CREATE',
    'Two-point annotation; optional parameterKey for driven display'
  ),
  c(
    'dim_angular',
    'Angular dimension',
    'sketch_dimension',
    'design',
    'implemented',
    'CREATE',
    'Hybrid driving: angular dimensions now auto-create angle driver + parameter; parameterKey remains visible/editable in canvas/list.'
  ),
  c(
    'dim_radial',
    'Radial dimension',
    'sketch_dimension',
    'design',
    'implemented',
    'CREATE',
    'Circle/arc/ellipse; optional parameterKey'
  ),
  c(
    'dim_diameter',
    'Diameter dimension',
    'sketch_dimension',
    'design',
    'implemented',
    'CREATE',
    'Circle/arc/ellipse; optional parameterKey'
  ),

  // —— Solid CREATE ——
  c('so_extrude', 'Extrude', 'solid_create', 'design', 'implemented', 'CREATE', 'Single profile depth'),
  c('so_revolve', 'Revolve', 'solid_create', 'design', 'implemented', 'CREATE', 'Axis line X = const'),
  c(
    'so_sweep',
    'Sweep',
    'solid_create',
    'design',
    'implemented',
    'CREATE',
    'Kernel `sweep_profile_path_true`: orientation-follow sweep with `frenet`, `path_tangent_lock`, or `fixed_normal` modes'
  ),
  c(
    'so_loft',
    'Loft',
    'solid_create',
    'design',
    'implemented',
    'CREATE',
    '2–16 closed profiles (order), uniform loft step → kernel segment lofts + union (`multi+union-chain` when n≥3) + Three ruled strips; manifest `loftStrategy`'
  ),
  c('so_rib', 'Rib', 'solid_create', 'design', 'planned', 'CREATE'),
  c('so_web', 'Web', 'solid_create', 'design', 'planned', 'CREATE'),
  c(
    'so_coil',
    'Coil',
    'solid_create',
    'design',
    'partial',
    'CREATE',
    'Kernel `coil_cut` partial: stacked ring-cut surrogate with pitch/turns/depth; ≤1024 ring instances in build; not true helical section sweep'
  ),
  c(
    'so_pipe',
    'Pipe',
    'solid_create',
    'design',
    'implemented',
    'CREATE',
    'Kernel `pipe_path`: circular section path sweep with optional wall thickness and orientation modes (`frenet`, `path_tangent_lock`, `fixed_normal`)'
  ),
  c(
    'so_thicken',
    'Thicken / Offset surface',
    'solid_create',
    'design',
    'implemented',
    'CREATE',
    'Kernel `thicken_offset` true offset request (outward/inward/both) with topology-safe failure reporting'
  ),

  // —— Solid MODIFY ——
  c(
    'so_fillet',
    'Fillet',
    'solid_modify',
    'design',
    'partial',
    'MODIFY',
    'Kernel: `part/features.json` → `kernelOps` → `fillet_all` + directional `fillet_select` (±X/±Y/±Z)'
  ),
  c(
    'so_chamfer',
    'Chamfer',
    'solid_modify',
    'design',
    'partial',
    'MODIFY',
    'Kernel: `kernelOps` → `chamfer_all` + directional `chamfer_select` (±X/±Y/±Z)'
  ),
  c(
    'so_shell',
    'Shell',
    'solid_modify',
    'design',
    'partial',
    'MODIFY',
    'Kernel: shell_inward (openDirection ±X/±Y/±Z, default +Z) via features.json / Design ribbon'
  ),
  c(
    'so_hole',
    'Hole',
    'solid_modify',
    'design',
    'partial',
    'MODIFY',
    'Kernel `hole_from_profile` (profileIndex, depth + depthMm or through_all, zStart); full hole wizard semantics still planned'
  ),
  c(
    'so_thread',
    'Thread',
    'solid_modify',
    'design',
    'implemented',
    'MODIFY',
    'Kernel `thread_wizard` supports modeled helical cut and cosmetic mode with standard/designation/class/hand/starts metadata'
  ),
  c(
    'so_combine',
    'Combine (boolean)',
    'solid_modify',
    'design',
    'partial',
    'MODIFY',
    'Kernel: primitives + `boolean_combine_profile` (union/subtract/intersect from profileIndex + extrude depth, optional extrudeDirection ±Z) in `kernelOps` (CadQuery); profileIndex range-checked vs payload profiles pre-OCC (clear error if index out of range or zero profiles)'
  ),
  c(
    'so_split',
    'Split body',
    'solid_modify',
    'design',
    'partial',
    'MODIFY',
    'Kernel `split_keep_halfspace` (axis, offsetMm, keep positive/negative); samples include negative keep + offset; full split-body management still planned'
  ),
  c(
    'so_move_copy',
    'Move / Copy body',
    'solid_modify',
    'design',
    'partial',
    'MODIFY',
    'Kernel `transform_translate` (ΔX/ΔY/ΔZ) with optional keepOriginal union-copy'
  ),
  c(
    'so_press_pull',
    'Press pull',
    'solid_modify',
    'design',
    'partial',
    'MODIFY',
    'Kernel `press_pull_profile` signed delta on profileIndex (+ union, - cut); face-pick/direct-manipulate UX still planned'
  ),

  // —— Solid PATTERN ——
  c(
    'so_pattern_rect',
    'Rectangular pattern',
    'solid_pattern',
    'design',
    'partial',
    'PATTERN',
    'Sketch linear pattern; kernel `pattern_rectangular` on B-rep (`kernelOps`)'
  ),
  c(
    'so_pattern_circ',
    'Circular pattern',
    'solid_pattern',
    'design',
    'partial',
    'PATTERN',
    'Kernel `pattern_circular` (+Z pivot, count/total°/start°) — Design ribbon + circ pattern'
  ),
  c(
    'so_pattern_path',
    'Path pattern',
    'solid_pattern',
    'design',
    'partial',
    'PATTERN',
    'Kernel `pattern_path` on sketch polyline points (sampled along path length); optional `alignToPathTangent` rotates copies about +Z at path start (tangent MVP); optional `closedPath` includes last→first segment; linear translation in 3D is `pattern_linear_3d`'
  ),
  c(
    'so_mirror_body',
    'Mirror (body)',
    'solid_pattern',
    'design',
    'partial',
    'PATTERN',
    'Kernel `mirror_union_plane` (YZ/XZ/XY + origin) — Design ribbon + mirror ∪'
  ),
  c('so_mirror_sketch_plane', 'Mirror (sketch plane)', 'solid_pattern', 'design', 'partial', 'PATTERN', 'Mirror across Y axis in sketch'),

  // —— Surface / advanced ——
  c('su_extrude', 'Extrude surface', 'surface', 'design', 'planned', 'CREATE'),
  c('su_revolve', 'Revolve surface', 'surface', 'design', 'planned', 'CREATE'),
  c(
    'su_loft',
    'Loft surface',
    'surface',
    'design',
    'implemented',
    'CREATE',
    'Same kernel path as solid loft (2–16 profiles); no separate surface-only body type yet'
  ),
  c('su_sweep', 'Sweep surface', 'surface', 'design', 'planned', 'CREATE'),
  c('su_patch', 'Patch', 'surface', 'design', 'planned', 'CREATE'),
  c('su_trim', 'Trim surface', 'surface', 'design', 'planned', 'MODIFY'),
  c('su_extend', 'Extend surface', 'surface', 'design', 'planned', 'MODIFY'),
  c('su_stitch', 'Stitch', 'surface', 'design', 'planned', 'MODIFY'),
  c('su_thicken', 'Thicken', 'surface', 'design', 'planned', 'MODIFY'),

  // —— Sheet metal / plastic (Fusion tabs) ——
  c(
    'sm_flange',
    'Flange / tab (boss)',
    'sheet_metal',
    'design',
    'partial',
    'CREATE',
    'Kernel `sheet_tab_union` + Design ribbon + sheet tab; axis-aligned boss on +Z — no bend k-factor yet'
  ),
  c(
    'sm_fold',
    'Fold',
    'sheet_metal',
    'design',
    'implemented',
    'MODIFY',
    'Kernel `sheet_fold`: bend metadata (`kFactor`, radius, angle, allowance mode) + fold transform around bend line'
  ),
  c(
    'sm_flat_pattern',
    'Flat pattern',
    'sheet_metal',
    'design',
    'implemented',
    'MODIFY',
    'DXF flat export from Design/part data (outline + bend centerline markers for MVP), plus `sheet_flat_pattern` marker op'
  ),
  c(
    'pl_rule_fillet',
    'Rule fillet (plastic)',
    'plastic',
    'design',
    'implemented',
    'MODIFY',
    'Kernel `plastic_rule_fillet` MVP: all-edge fillet with configurable radius'
  ),
  c(
    'pl_boss',
    'Boss',
    'plastic',
    'design',
    'implemented',
    'CREATE',
    'Kernel `plastic_boss` MVP: cylindrical boss with optional center hole'
  ),
  c(
    'pl_lip_groove',
    'Lip / groove',
    'plastic',
    'design',
    'implemented',
    'CREATE',
    'Kernel `plastic_lip_groove` MVP: rectangular lip union or groove cut'
  ),

  // —— Assemble ——
  c('as_new_comp', 'New component', 'assemble', 'assemble', 'partial', 'ASSEMBLE', 'Add component row'),
  c(
    'as_insert',
    'Insert / duplicate component',
    'assemble',
    'assemble',
    'partial',
    'ASSEMBLE',
    'Assembly tab **Duplicate row** (new instance id; clears parent / motion link) + **Insert from project…** (pick JSON under project → relative `partPath`)'
  ),
  c(
    'as_external_ref',
    'External reference',
    'assemble',
    'assemble',
    'partial',
    'ASSEMBLE',
    'referenceTag, partNumber, externalComponentRef (PDM/ERP), parentId'
  ),
  c('as_joint_rigid', 'As-built / Rigid joint', 'assemble_joint', 'assemble', 'partial', 'JOINTS', 'Joint enum rigid'),
  c(
    'as_joint_slider',
    'Slider joint',
    'assemble_joint',
    'assemble',
    'partial',
    'JOINTS',
    '`jointState.scalarMm` / `jointLimits` + **`assembly:solve`** forward pose; legacy **sliderPreviewMm** migrates into `jointState`; axis (world or parent-local) — **not** multibody IK'
  ),
  c(
    'as_joint_revolute',
    'Revolute joint',
    'assemble_joint',
    'assemble',
    'partial',
    'JOINTS',
    '`jointState.scalarDeg` / `jointLimits` + **`assembly:solve`** forward pose; legacy **revolutePreviewAngleDeg** migrates; axis (world or parent-local) — **not** multibody IK'
  ),
  c(
    'as_joint_planar',
    'Planar joint',
    'assemble_joint',
    'assemble',
    'partial',
    'JOINTS',
    '`jointState.uMm` / `vMm` + limits + **`assembly:solve`**; legacy **planarPreview*** migrates — **not** multibody IK'
  ),
  c(
    'as_joint_cylindrical',
    'Cylindrical joint',
    'assemble_joint',
    'assemble',
    'partial',
    'JOINTS',
    '`jointState.slideMm` / `spinDeg` + limits + **`assembly:solve`**; legacy **cylindricalPreview*** migrates — **not** multibody IK'
  ),
  c(
    'as_joint_ball',
    'Ball joint',
    'assemble_joint',
    'assemble',
    'partial',
    'JOINTS',
    '`jointState.rxDeg` / `ryDeg` / `rzDeg` + limits + **`assembly:solve`**; legacy **ballPreview*** migrates — **not** multibody IK'
  ),
  c(
    'as_joint_universal',
    'Universal (Cardan) joint',
    'assemble_joint',
    'assemble',
    'partial',
    'JOINTS',
    '`jointState.angle1Deg` / `angle2Deg` + **`assembly:solve`** (kinematics **simplified** vs full Cardan coupling); legacy **universalPreview*** migrates'
  ),
  c(
    'as_motion_link',
    'Motion link / contact set',
    'assemble_joint',
    'assemble',
    'partial',
    'JOINTS',
    'linkedInstanceId + motionLinkKind mate/contact/align — **metadata + validation + summary**; **does not** drive **`assembly:solve`** pose'
  ),
  c(
    'as_bom',
    'BOM / export',
    'manage',
    'assemble',
    'implemented',
    'ASSEMBLE',
    'CSV → output/bom.csv (incl. **bomUnit** / **bomVendor** / **bomCostEach**, **instanceId**); **tree .txt** / **.json** via shared `buildHierarchicalBomText` / `buildBomHierarchyJsonText`; Assembly tab **Download** tree + CSV from editor; **preview** table **Thumb** column (STL raster, not in CSV); **Export** → output/ from saved file'
  ),
  c(
    'as_summary',
    'Assembly summary',
    'manage',
    'assemble',
    'implemented',
    'ASSEMBLE',
    'Live panel + copy + Export summary (.txt); IPC assembly:summary — meshPath, explode/motion flags, BOM by partPath, **part paths** / **part numbers** with 2+ active rows, **multiple grounded** warning, joints, **motion link** metadata roll-ups (linkedInstanceId / motionLinkKind; **not** pose drivers), ref + externalComponentRef tallies, BOM-notes count, parent **self-ref** + **cycle** flags, distinct PNs, same-transform pairs'
  ),
  c(
    'as_explode_motion_meta',
    'Explode & motion study metadata',
    'manage',
    'assemble',
    'partial',
    'ASSEMBLE',
    'Viewport uses **`assembly:solve`** base poses; **explode** + **motion keyframes** are extra preview offsets on STL instances; joint DOFs from `jointState` / legacy previews — **forward kinematics only**, not machine/tool sim'
  ),
  c(
    'as_interference',
    'Interference',
    'assemble',
    'assemble',
    'partial',
    'ASSEMBLE',
    'meshPath → binary STL: AABB + narrow phase + triangle SAT (capped); download JSON or save to output/{assembly}-interference.json; mesh load / budget notes'
  ),

  // —— Manufacture (CAM) ——
  c(
    'mf_setup',
    'Setup',
    'manufacture_setup',
    'manufacture',
    'partial',
    'SETUP',
    'Machine + stock + fixture note; work offset → G54–G59 in CNC post when generating CAM'
  ),
  c(
    'mf_op_2d_face',
    '2D contour / face',
    'manufacture_2d',
    'manufacture',
    'implemented',
    '2D',
    'cnc_contour + contourPoints + optional multi-depth zStepMm (negative zPassMm) + Manufacture UI (WCS context, sketch derive, lead-in/out). Hard error if geometry missing/invalid; no STL fallback — docs/MACHINES.md'
  ),
  c(
    'mf_op_2d_pocket',
    '2D pocket',
    'manufacture_2d',
    'manufacture',
    'implemented',
    '2D',
    'cnc_pocket + contourPoints + ramp/finish/step-down + Manufacture UI. Hard error if geometry missing/invalid; no STL fallback — docs/MACHINES.md'
  ),
  c(
    'mf_op_2d_drill',
    'Drilling',
    'manufacture_2d',
    'manufacture',
    'implemented',
    '2D',
    'cnc_drill + drillPoints + dialect-aware cycles (Grbl expanded default; G81/G82/G83) + peck/dwell/retract UI; docs/MACHINES.md § Drilling'
  ),
  c(
    'mf_op_parallel',
    'Parallel finishing (3D)',
    'manufacture_3d',
    'manufacture',
    'partial',
    '3D',
    'cnc_parallel — built-in parallel finish from STL bounds; cut params from `resolveCamCutParams` (zPassMm, stepover, feeds, safeZ). G-code unverified — docs/MACHINES.md'
  ),
  c(
    'mf_op_waterline',
    'Waterline / Z-level (3D)',
    'manufacture_3d',
    'manufacture',
    'partial',
    '3D',
    'cnc_waterline — OpenCAMLib Waterline when opencamlib; else parallel-finish fallback with IPC hint; same `cam-cut-params` as other 3D kinds. G-code unverified — docs/MACHINES.md'
  ),
  c(
    'mf_op_raster',
    'Raster finishing (3D)',
    'manufacture_3d',
    'manufacture',
    'partial',
    '3D',
    'cnc_raster — OCL PathDropCutter when opencamlib; else mesh height-field then ortho bounds; optional `rasterRestStockMm` offsets cut Z on mesh fallback (+Z allowance). Optional `meshAnalyticPriorRoughStockMm` (mesh fallback only, **ignored** when `usePriorPostedGcodeRest` supplies a G-code floor) simulates a prior rough stock height for skip logic vs finish rest — 2.5D heuristic. With `stockBoxZMm` on `cam:run`, effective rest can auto-derive from stock + mesh min Z unless `autoRasterRestFromSetup: false`. `resolveCamCutParams` can default `safeZMm` from manufacture setup stock Z. G-code unverified — docs/MACHINES.md'
  ),
  c(
    'mf_op_contour',
    'Contour (3D)',
    'manufacture_3d',
    'manufacture',
    'partial',
    '3D',
    'Catalog label “3D”; runtime op is **cnc_contour** — 2D toolpath from **contourPoints** only (hard error if missing/invalid; no STL fallback). G-code unverified — docs/MACHINES.md'
  ),
  c(
    'mf_op_pocket_3d',
    'Pocket (3D)',
    'manufacture_3d',
    'manufacture',
    'partial',
    '3D',
    'Catalog label “3D”; runtime op is **cnc_pocket** — 2D pocket from **contourPoints** only (hard error if missing/invalid; no STL fallback). G-code unverified — docs/MACHINES.md'
  ),
  c(
    'mf_op_adaptive',
    'Adaptive clearing',
    'manufacture_3d',
    'manufacture',
    'partial',
    '3D',
    'cnc_adaptive — OpenCAMLib AdaptiveWaterline when opencamlib; else parallel-finish fallback + reason hint; `resolveCamCutParams` drives feeds/stepover/zPassMm. G-code unverified — docs/MACHINES.md'
  ),
  c(
    'mf_op_pencil',
    'Pencil / rest machining',
    'manufacture_3d',
    'manufacture',
    'partial',
    '3D',
    'cnc_pencil — OpenCAMLib PathDropCutter raster with tighter effective stepover (`resolvePencilStepoverMm`, optional `pencilStepoverMm` / `pencilStepoverFactor`); same built-in mesh/bounds raster fallbacks as `cnc_raster` including optional `rasterRestStockMm` and the same stock-driven rest / setup `safeZMm` behavior as raster. **Not** automatic rest-stock / leftover detection — output is **unverified** for any machine — docs/MACHINES.md'
  ),
  c(
    'mf_turning',
    'Turning',
    'manufacture_3d',
    'manufacture',
    'planned',
    'TURNING',
    'Manufacture op kind **`cnc_lathe_turn`** parses for planning; **Generate CAM** blocks until lathe posts + runner path ship — docs/MACHINES.md'
  ),
  c(
    'mf_additive',
    'Additive / FDM',
    'manufacture_3d',
    'manufacture',
    'partial',
    'ADDITIVE',
    'Utilities → Slice + optional extra `-s` JSON + named profiles (`mergeCuraSliceInvocationSettings`); optional machine definition `-j` path in Settings; Slice tab layer summary from `;LAYER` / `;LAYER_COUNT` in G-code; Manufacture `fdm_slice` → Slice with CuraEngine uses `sourceMesh` + same merged settings'
  ),
  c(
    'mf_simulate',
    'Simulation',
    'inspect',
    'manufacture',
    'partial',
    'INSPECT',
    'Manufacture **Tier 1** G0/G1 path preview + **Tier 2** 2.5D height-field removal proxy (~88×88 grid, cylindrical tool stamps; not stock-exact) + optional **Tier 3** coarse voxel carve with **Fast/Balanced/Detailed** presets (grid/stamp budgets scale monotonically; still not swept-volume / not collision-safe / not machine kinematics). **Do not** treat preview as safe to run on hardware — docs/VERIFICATION.md + docs/MACHINES.md'
  ),

  // —— Drawings / documentation (Tier A/B mesh projection + title block) ——
  c(
    'dr_new_sheet',
    'New drawing sheet',
    'drawing',
    'utilities',
    'implemented',
    'CREATE',
    'Primary sheet + optional **view placeholders** + optional **`meshProjectionTier`** (A=edge soup, B=+bbox-center mesh sections, C=+BRep plane section from kernel STEP when CadQuery loads) → `drawing/drawing.json`; PDF/DXF via `engines/occt/project_views.py` when kernel STL + Python OK — not certified HLR'
  ),
  c(
    'dr_base_view',
    'Base view from model',
    'drawing',
    'utilities',
    'implemented',
    'CREATE',
    'Project tab: **+ Base view slot** → **View from** + label; export projects mesh edges for that axis (`engines/occt/project_views.py`)'
  ),
  c(
    'dr_projected_view',
    'Projected view',
    'drawing',
    'utilities',
    'implemented',
    'CREATE',
    'Project tab: **+ Projected view slot** → parent + **direction**; each slot gets its own orthographic projection from the same kernel STL (third-angle layout metadata; Tier A/B/C per sheet **meshProjectionTier**)'
  ),
  c(
    'dr_export_pdf',
    'Export drawing PDF',
    'drawing',
    'utilities',
    'implemented',
    'FILE',
    'Title-block PDF (A4); embedded **SVG** linework per view slot when kernel STL + Python succeed; else manifest list + `Build STEP` hint'
  ),
  c(
    'dr_export_dxf',
    'Export drawing DXF',
    'drawing',
    'utilities',
    'implemented',
    'FILE',
    'DXF with **PROJECTION** layer lines when kernel STL + Python succeed; else frame + notes (sheet flat-pattern path unchanged when sketch+`sheet_fold` applies)'
  ),

  // —— Utilities / inspect / manage ——
  c(
    'ut_measure',
    'Measure',
    'inspect',
    'design',
    'implemented',
    'INSPECT',
    'Design 3D: **Measure**, Shift+click two points (mm). Uses **kernel STL** when last build matches current design + features; otherwise **sketch preview mesh**. Status shows source. **Esc** clears — docs/VERIFICATION.md'
  ),
  c(
    'ut_section',
    'Section analysis',
    'inspect',
    'design',
    'implemented',
    'INSPECT',
    'Design 3D: **Section**, Y clip (world +Y). Same mesh source as **Measure** (kernel when fresh, else preview). **Esc** clears — docs/VERIFICATION.md'
  ),
  c(
    'ut_interference',
    'Interference',
    'inspect',
    'utilities',
    'partial',
    'INSPECT',
    'Palette switches to **Assemble** — run **Interference check** in the assembly panel; download JSON or save under output/ (same workflow as **as_interference**)'
  ),
  c(
    'ut_material',
    'Physical material',
    'manage',
    'utilities',
    'partial',
    'MANAGE',
    '**File → Project** — optional material name + density (kg/m³) in `project.json` for local BOM/mass notes; not cloud-backed'
  ),
  c(
    'ut_appearance',
    'Appearance',
    'manage',
    'utilities',
    'partial',
    'MANAGE',
    '**File → Project** — optional appearance notes (finish/color); saved with project'
  ),
  c(
    'ut_parameters',
    'Parameters',
    'manage',
    'design',
    'implemented',
    'MANAGE',
    'Design ribbon **Parameters** group: add/rename/delete keys; **Utilities → Project** export/merge `output/design-parameters.json` into sketch'
  ),
  c('ut_derive', 'Derive', 'manage', 'utilities', 'planned', 'MANAGE'),
  c('ut_scripts', 'Scripts & add-ins', 'manage', 'utilities', 'planned', 'TOOLS'),
  c(
    'ut_command_palette',
    'Command palette',
    'manage',
    'utilities',
    'implemented',
    'TOOLS',
    '**Ctrl+K** / **⌘K** — modal: Tab wrap, Home/End, **PgUp/PgDn** page through list, scroll active row; empty query shows **recent commands first** with discoverability hint; query matching supports token phrases and aliases (open/new/save/tools/cam/slice); non-default palette filters show an inline **Reset filters** action; empty-match state includes **Reset palette filters**; **Utilities → Commands** keeps labeled filters/search guidance with reset + open-palette CTA and persisted search/filter state across refresh'
  ),
  c(
    'ut_keyboard_shortcuts',
    'Keyboard shortcuts',
    'manage',
    'utilities',
    'implemented',
    'TOOLS',
    'Shortcuts dialog (Ctrl+Shift+? / ⌘⇧? when not typing); **File** and **Manufacture** tab strips support ←→ / ↑↓ + Home/End with position-aware labels'
  ),

  // —— File / project (utilities workspace) ——
  c('ut_open', 'Open project', 'manage', 'utilities', 'implemented', 'FILE'),
  c('ut_new', 'New project', 'manage', 'utilities', 'implemented', 'FILE'),
  c(
    'ut_new_from_import',
    'New project from 3D file',
    'manage',
    'utilities',
    'implemented',
    'FILE',
    'Pick STL, STEP, or mesh file(s); creates a new project folder and imports into assets/. Uses default projects folder when set.'
  ),
  c('ut_save', 'Save', 'manage', 'utilities', 'implemented', 'FILE'),
  c(
    'ut_import_3d',
    'Import 3D model',
    'manage',
    'utilities',
    'implemented',
    'FILE',
    '**Design** ribbon **Import 3D…** or **File → Project** — multi-select in dialog (Ctrl/Shift+click). STL, STEP/STP, OBJ, PLY, GLTF/GLB, 3MF, OFF, DAE → assets/; STEP → CadQuery; mesh → pip install trimesh'
  ),
  c(
    'ut_import_stl',
    'Import 3D model (palette alias)',
    'manage',
    'utilities',
    'implemented',
    'FILE',
    'Same dialog as Import 3D model'
  ),
  c(
    'ut_import_step',
    'Import STEP',
    'manage',
    'utilities',
    'implemented',
    'FILE',
    'Same unified dialog; Python + CadQuery required'
  ),
  c('ut_export_stl', 'Export STL (design)', 'manage', 'design', 'implemented', 'FILE'),
  c('ut_slice', 'Slice (FDM)', 'manufacture_3d', 'manufacture', 'partial', 'MANUFACTURE'),
  c(
    'ut_cam',
    'Generate CAM',
    'manufacture_3d',
    'manufacture',
    'partial',
    'MANUFACTURE',
    'First CNC op params → feeds/Z/stepover + OCL when installed; else parallel finish; G-code unverified — docs/MACHINES.md'
  ),
  c('ut_tools', 'Tool library', 'manage', 'manufacture', 'implemented', 'MANAGE')
]

/** Command palette → Design workspace: updates sketch tool or constraint picker when dispatched. */
export const DESIGN_RIBBON_COMMAND_IDS = new Set<string>([
  'sk_rect',
  'sk_rect_3pt',
  'sk_slot_center',
  'sk_slot_overall',
  'sk_point',
  'sk_polygon',
  'sk_circle_center',
  'sk_circle_2pt',
  'sk_circle_3pt',
  'sk_polyline',
  'sk_line',
  'sk_arc_3pt',
  'sk_arc_center',
  'sk_ellipse',
  'sk_spline_fit',
  'sk_spline_cp',
  'sk_trim',
  'sk_extend',
  'sk_break',
  'sk_split',
  'sk_fillet_sk',
  'sk_chamfer_sk',
  'sk_offset',
  'sk_project',
  'sk_move_sk',
  'sk_rotate_sk',
  'sk_scale_sk',
  'sk_mirror_sk',
  'sk_pattern_sk',
  'sk_choose_plane',
  'dim_linear',
  'dim_aligned',
  'co_coincident',
  'co_distance',
  'co_fix',
  'co_horizontal',
  'co_vertical',
  'co_parallel',
  'co_perpendicular',
  'co_equal',
  'co_collinear',
  'co_midpoint',
  'co_angle',
  'co_tangent',
  'co_symmetric',
  'co_concentric',
  'co_radius',
  'co_diameter',
  'dim_radial',
  'dim_diameter',
  'dim_angular',
  'ut_parameters',
  'ut_measure',
  'ut_section'
])

export function catalogStats(catalog: FusionStyleCommand[] = FUSION_STYLE_COMMAND_CATALOG): Record<CommandParityStatus, number> {
  const out: Record<CommandParityStatus, number> = { implemented: 0, partial: 0, planned: 0 }
  for (const row of catalog) {
    out[row.status]++
  }
  return out
}

export function filterCatalog(
  catalog: FusionStyleCommand[],
  opts: {
    q?: string
    workspace?: CommandShellWorkspace | 'all'
    status?: CommandParityStatus | 'all'
    ribbon?: CommandRibbonGroup | 'all'
  }
): FusionStyleCommand[] {
  const q = opts.q?.trim().toLowerCase()
  return catalog.filter((row) => {
    if (opts.workspace && opts.workspace !== 'all' && row.workspace !== opts.workspace) return false
    if (opts.status && opts.status !== 'all' && row.status !== opts.status) return false
    if (opts.ribbon && opts.ribbon !== 'all' && row.ribbon !== opts.ribbon) return false
    if (q) {
      const hay = `${row.label} ${row.id} ${row.ribbon} ${row.fusionRibbon ?? ''} ${row.notes ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}
