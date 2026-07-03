import { z } from 'zod'
import {
  IDENTIFIER_RE,
  isValidIdentifier,
  collectIdentifiers,
  resolveParameters,
  type NamedExpression
} from './expression-eval'

const vec2 = z.tuple([z.number(), z.number()])

/** Point in sketch space (mm). */
export const sketchPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  fixed: z.boolean().optional()
})

export type SketchPoint = z.infer<typeof sketchPointSchema>

export const pointRefSchema = z.object({ pointId: z.string() })

export const constraintSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('coincident'),
    a: pointRefSchema,
    b: pointRefSchema
  }),
  z.object({
    id: z.string(),
    type: z.literal('distance'),
    a: pointRefSchema,
    b: pointRefSchema,
    parameterKey: z.string()
  }),
  z.object({
    id: z.string(),
    type: z.literal('horizontal'),
    a: pointRefSchema,
    b: pointRefSchema
  }),
  z.object({
    id: z.string(),
    type: z.literal('vertical'),
    a: pointRefSchema,
    b: pointRefSchema
  }),
  z.object({
    id: z.string(),
    type: z.literal('fix'),
    pointId: z.string()
  }),
  /** Line (a1→b1) perpendicular to line (a2→b2); dot product of direction vectors → 0. */
  z.object({
    id: z.string(),
    type: z.literal('perpendicular'),
    a1: pointRefSchema,
    b1: pointRefSchema,
    a2: pointRefSchema,
    b2: pointRefSchema
  }),
  /** Line (a1→b1) parallel to line (a2→b2); 2D cross product of directions → 0. */
  z.object({
    id: z.string(),
    type: z.literal('parallel'),
    a1: pointRefSchema,
    b1: pointRefSchema,
    a2: pointRefSchema,
    b2: pointRefSchema
  }),
  /** Segment |a1−b1| equals segment |a2−b2|. */
  z.object({
    id: z.string(),
    type: z.literal('equal'),
    a1: pointRefSchema,
    b1: pointRefSchema,
    a2: pointRefSchema,
    b2: pointRefSchema
  }),
  /** Points a, b, c lie on one line (2D cross of (b−a) and (c−a) → 0). */
  z.object({
    id: z.string(),
    type: z.literal('collinear'),
    a: pointRefSchema,
    b: pointRefSchema,
    c: pointRefSchema
  }),
  /** Point m is the midpoint of segment a—b. */
  z.object({
    id: z.string(),
    type: z.literal('midpoint'),
    m: pointRefSchema,
    a: pointRefSchema,
    b: pointRefSchema
  }),
  /** Angle between line (a1→b1) and (a2→b2); target from `parameters[parameterKey]` in degrees (solver minimizes the arm-scaled signed-angle difference, so it lands exactly). */
  z.object({
    id: z.string(),
    type: z.literal('angle'),
    a1: pointRefSchema,
    b1: pointRefSchema,
    a2: pointRefSchema,
    b2: pointRefSchema,
    parameterKey: z.string()
  }),
  /**
   * Line (lineA—lineB) tangent to the arc (arcStart, arcVia, arcEnd) at the arc start or end.
   * Best results when the chosen arc endpoint is coincident with `lineTangentAt` on the segment (add coincident if needed).
   */
  z.object({
    id: z.string(),
    type: z.literal('tangent'),
    lineA: pointRefSchema,
    lineB: pointRefSchema,
    arcStart: pointRefSchema,
    arcVia: pointRefSchema,
    arcEnd: pointRefSchema,
    arcTangentAt: z.enum(['start', 'end']),
    lineTangentAt: z.enum(['a', 'b'])
  }),
  /** Points p1 and p2 are mirror images across the infinite line through la—lb. */
  z.object({
    id: z.string(),
    type: z.literal('symmetric'),
    p1: pointRefSchema,
    p2: pointRefSchema,
    la: pointRefSchema,
    lb: pointRefSchema
  }),
  /** Keep two circle/arc entities sharing the same center point. */
  z.object({
    id: z.string(),
    type: z.literal('concentric'),
    entityAId: z.string(),
    entityBId: z.string()
  }),
  /** Drive a circle/arc radius from a named parameter (mm). */
  z.object({
    id: z.string(),
    type: z.literal('radius'),
    entityId: z.string(),
    parameterKey: z.string()
  }),
  /** Drive a circle/arc diameter from a named parameter (mm). */
  z.object({
    id: z.string(),
    type: z.literal('diameter'),
    entityId: z.string(),
    parameterKey: z.string()
  })
])

export type SketchConstraint = z.infer<typeof constraintSchema>

/**
 * Construction (reference) geometry flag — Fusion's X-key concept. Optional +
 * additive (legacy saved designs parse unchanged; absent = normal geometry).
 * A `construction: true` entity renders dashed, participates in constraints /
 * dimensions / snapping, but is EXCLUDED from profile derivation — it never
 * becomes part of the built solid or a CAM contour/drill (see
 * `extractKernelProfiles` and `cam-2d-derive`).
 */
const constructionFlag = z.boolean().optional()

/** v2 polylines — must stay a plain ZodObject (no .superRefine) for use in unions. */
export const polylineByPointIdsSchema = z.object({
  id: z.string(),
  kind: z.literal('polyline'),
  pointIds: z.array(z.string()).min(2),
  closed: z.boolean(),
  construction: constructionFlag
})

/** v1 / legacy polylines with inline coordinates */
export const polylineByPointsSchema = z.object({
  id: z.string(),
  kind: z.literal('polyline'),
  points: z.array(vec2).min(2),
  closed: z.boolean(),
  construction: constructionFlag
})

export const rectEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('rect'),
  cx: z.number(),
  cy: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number().default(0),
  construction: constructionFlag
})

export const circleEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('circle'),
  cx: z.number(),
  cy: z.number(),
  r: z.number().positive(),
  construction: constructionFlag
})

/** Rounded slot (stadium): semicircle centers `length` mm apart on local +X; `width` is the narrow opening (cap diameter). */
export const slotEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('slot'),
  cx: z.number(),
  cy: z.number(),
  length: z.number().nonnegative(),
  width: z.number().positive(),
  rotation: z.number().default(0),
  construction: constructionFlag
})

/**
 * Circular arc through three points (start, a point on the arc, end).
 * Vertices live in `points`; implied circle is not a separate DOF — constraints on those points are solver-backed.
 */
export const arcByThreePointsSchema = z.object({
  id: z.string(),
  kind: z.literal('arc'),
  startId: z.string(),
  viaId: z.string(),
  endId: z.string(),
  /** When true, arc plus chord is a closed profile (extrude / kernel uses tessellated loop; matches Three preview). */
  closed: z.boolean().optional(),
  construction: constructionFlag
})

/** Axis-aligned ellipse in sketch mm; `rotation` rotates the major axis from +X. */
export const ellipseEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('ellipse'),
  cx: z.number(),
  cy: z.number(),
  rx: z.number().positive(),
  ry: z.number().positive(),
  rotation: z.number().default(0),
  construction: constructionFlag
})

/** Interpolating spline through point IDs (Catmull–Rom tessellation for display/kernel). */
export const splineFitEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('spline_fit'),
  pointIds: z.array(z.string()).min(3),
  closed: z.boolean().optional(),
  construction: constructionFlag
})

/** Uniform cubic B-spline style curve from control point IDs (does not pass through every control). */
export const splineCpEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('spline_cp'),
  pointIds: z.array(z.string()).min(4),
  closed: z.boolean().optional(),
  construction: constructionFlag
})

/**
 * Plain `z.union` — `discriminatedUnion` cannot include schemas wrapped by `.superRefine`/`.refine`
 * (ZodEffects), which caused startup: Cannot read properties of undefined (reading 'kind').
 */
export const sketchEntitySchema = z.union([
  polylineByPointIdsSchema,
  polylineByPointsSchema,
  rectEntitySchema,
  circleEntitySchema,
  slotEntitySchema,
  arcByThreePointsSchema,
  ellipseEntitySchema,
  splineFitEntitySchema,
  splineCpEntitySchema
])

export type SketchEntity = z.infer<typeof sketchEntitySchema>

/** Annotation-only dimension (not driving the solver). Optional `parameterKey` shows `parameters[key]` when set (driving display). */
export const sketchLinearDimensionSchema = z.object({
  id: z.string(),
  kind: z.literal('linear'),
  aId: z.string(),
  bId: z.string(),
  parameterKey: z.string().optional()
})

export const sketchAlignedDimensionSchema = z.object({
  id: z.string(),
  kind: z.literal('aligned'),
  aId: z.string(),
  bId: z.string(),
  parameterKey: z.string().optional()
})

export const sketchRadialDimensionSchema = z.object({
  id: z.string(),
  kind: z.literal('radial'),
  entityId: z.string(),
  parameterKey: z.string().optional()
})

export const sketchDiameterDimensionSchema = z.object({
  id: z.string(),
  kind: z.literal('diameter'),
  entityId: z.string(),
  parameterKey: z.string().optional()
})

export const sketchAngularDimensionSchema = z.object({
  id: z.string(),
  kind: z.literal('angular'),
  a1Id: z.string(),
  b1Id: z.string(),
  a2Id: z.string(),
  b2Id: z.string(),
  parameterKey: z.string().optional()
})

export const sketchDimensionSchema = z.discriminatedUnion('kind', [
  sketchLinearDimensionSchema,
  sketchAlignedDimensionSchema,
  sketchRadialDimensionSchema,
  sketchDiameterDimensionSchema,
  sketchAngularDimensionSchema
])

export type SketchDimension = z.infer<typeof sketchDimensionSchema>

/** Where the 2D sketch lies in world space. */
const vec3Schema = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

export const sketchPlaneSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('datum'),
    /** XY = top (sketch x→world X, y→world Y); XZ = front (x→X, y→Z); YZ = right (x→Y, y→Z). */
    datum: z.enum(['XY', 'XZ', 'YZ'])
  }),
  z.object({
    kind: z.literal('face'),
    /** World-space anchor point picked on the model face. */
    origin: vec3Schema,
    /** World-space unit normal at pick location. */
    normal: vec3Schema,
    /** World-space unit x-axis for sketch frame (orthogonal to normal). */
    xAxis: vec3Schema
  })
])

export type SketchPlane = z.infer<typeof sketchPlaneSchema>

/**
 * USER PARAMETER (Fusion's Parameters dialog: `thickness = 6`, `width = d1*2`).
 *
 * A named design parameter whose value is defined by an EXPRESSION string (see
 * `expression-eval.ts`) that may reference other user parameters. The
 * `resolvedValue` is a CACHE of the last successful evaluation — the load-bearing
 * value the solver actually reads lives in `parameters[name]` (the numeric dict);
 * `resolvedValue` mirrors it so a freshly loaded file can render the panel
 * without re-solving, and stays optional so it degrades to "unknown until
 * resolved" when absent. A parameter whose expression currently fails keeps its
 * last-good `resolvedValue` (or omits it) and the panel shows the error.
 *
 * `name` must be a valid identifier (letters/digits/underscore, non-digit
 * start) — the same rule the expression tokenizer enforces — so a name is always
 * a legal reference target. Additive + optional on the design file: a legacy
 * design with no `userParameters` block parses unchanged (test-pinned).
 */
export const userParameterSchema = z.object({
  /** Identifier the expression engine can reference (`thickness`, `d1`). */
  name: z.string().regex(IDENTIFIER_RE, 'must be a valid identifier'),
  /** Expression defining the value, e.g. `6`, `d1*2`, `width/2 + 5`. */
  expression: z.string(),
  /** Cached last-good numeric evaluation (finite). Optional (recomputed on edit). */
  resolvedValue: z.number().finite().optional()
})

export type UserParameter = z.infer<typeof userParameterSchema>

export const designFileSchemaV2 = z.object({
  version: z.literal(2),
  extrudeDepthMm: z.number().finite().positive().default(10),
  solidKind: z.enum(['extrude', 'revolve', 'loft']).default('extrude'),
  /** Uniform +Z spacing between each consecutive closed profile in entity order (loft mode; max 16 profiles). */
  loftSeparationMm: z.number().finite().positive().default(20),
  revolve: z
    .object({
      angleDeg: z.number().finite().positive().max(360).default(360),
      /** Revolve profile around vertical line X = axisX (sketch plane). */
      axisX: z.number().finite().default(0)
    })
    .default({ angleDeg: 360, axisX: 0 }),
  /** Driving values for constraints: `distance` uses mm; `angle` uses degrees (see ribbon + solver). */
  parameters: z.record(z.string(), z.number()).default({}),
  /**
   * NAMED USER PARAMETERS with expressions (Fusion's Parameters dialog). Each
   * resolves — in dependency order — to a number that is written into
   * `parameters[name]`, so a sketch dimension bound to that key is driven by the
   * expression. Additive + optional: a legacy design omits the block (`.default([])`).
   */
  userParameters: z.array(userParameterSchema).default([]),
  points: z.record(z.string(), sketchPointSchema).default({}),
  entities: z.array(sketchEntitySchema),
  constraints: z.array(constraintSchema).default([]),
  /** On-screen linear dimensions (mm text); not consumed by the 2D solver. */
  dimensions: z.array(sketchDimensionSchema).default([]),
  /** Sketch placement; kernel/preview still assume XY datum for geometry generation today. */
  sketchPlane: sketchPlaneSchema.default({ kind: 'datum', datum: 'XY' })
})

export type DesignFileV2 = z.infer<typeof designFileSchemaV2>

/** JSON shape for `output/design-parameters.json` and merge imports. */
export const designParametersExportSchema = z.object({
  parameters: z.record(z.string(), z.number()),
  exportedAt: z.string().optional(),
  source: z.string().optional()
})

export type DesignParametersExport = z.infer<typeof designParametersExportSchema>

/** Merge imported numeric parameters into a design (incoming keys overwrite on collision). */
export function mergeParametersIntoDesign(
  design: DesignFileV2,
  incoming: Record<string, number>
): DesignFileV2 {
  return { ...design, parameters: { ...design.parameters, ...incoming } }
}

// ===========================================================================
// USER PARAMETERS — pure operations (add / rename / edit / delete) with
// reference integrity + resolution into the numeric `parameters` cache.
//
// DESIGN DECISIONS (documented on the public API so callers know the contract):
//   - RENAME cascades: renaming a referenced parameter UPDATES every referencing
//     expression (identifier substitution) AND every constraint/dimension
//     `parameterKey` that pointed at the old name. Chosen over "block rename"
//     because Fusion renames live and the substitution is deterministic (whole-
//     identifier only — a name embedded in a longer identifier is never touched).
//   - DELETE is BLOCKED when the parameter is still referenced (by another
//     parameter's expression OR by a constraint/dimension `parameterKey`). The
//     op returns a reason the panel surfaces; the caller must clear the
//     references first. Chosen over "silent orphan" so a delete can never leave
//     a dangling reference that silently reads 0.
//   - Every mutation RE-RESOLVES the whole set and rewrites the numeric
//     `parameters[name]` cache + each parameter's `resolvedValue`, so the solver
//     (which reads `parameters`) sees the new values on the next solve.
// ===========================================================================

/** Result of a user-parameter mutation: the new design, or a rejection reason. */
export type UserParameterOpResult =
  | { readonly ok: true; readonly design: DesignFileV2 }
  | { readonly ok: false; readonly reason: string }

/**
 * Re-resolve every user parameter (in dependency order) and fold the results
 * back into the design: `resolvedValue` on each parameter (dropped when the
 * expression currently fails) AND the numeric `parameters[name]` cache the
 * solver reads (only successfully-resolved names are written/refreshed; a name
 * whose expression fails keeps its previous cached number if any, so a transient
 * typo doesn't zero the geometry). Pure — returns a new design.
 *
 * NOTE: only names that are ACTUALLY user parameters touch `parameters`; a
 * distance/angle key that is driven directly by a dimension (not a user param)
 * is left alone.
 */
export function resolveUserParameters(design: DesignFileV2): DesignFileV2 {
  const named: NamedExpression[] = design.userParameters.map((p) => ({
    name: p.name,
    expression: p.expression
  }))
  const { resolutions, values } = resolveParameters(named)
  const nextUserParameters: UserParameter[] = design.userParameters.map((p) => {
    const res = resolutions.get(p.name)
    if (res && res.ok) return { ...p, resolvedValue: res.value }
    // Failed expression: drop the cached value so the panel shows the error
    // rather than a stale-but-plausible number.
    const { resolvedValue: _drop, ...rest } = p
    void _drop
    return { ...rest }
  })
  // Overlay successfully-resolved user-parameter values onto the numeric cache.
  const nextParameters = { ...design.parameters }
  for (const p of design.userParameters) {
    if (Object.prototype.hasOwnProperty.call(values, p.name)) {
      nextParameters[p.name] = values[p.name]!
    }
  }
  return { ...design, userParameters: nextUserParameters, parameters: nextParameters }
}

/**
 * A user-parameter panel ROW: name + expression + the live resolved value (or
 * `null` when the current expression fails) + the human-readable evaluation
 * error (absent when OK). Structurally matches the FeatureTree's
 * `FeatureTreeUserParameter` view type, so the Design host can pass
 * `deriveUserParameterViews(design)` straight into `<FeatureTree userParameters>`
 * without re-deriving resolution state in the (hands-off) workspace component.
 */
export interface UserParameterView {
  readonly name: string
  readonly expression: string
  readonly resolvedValue: number | null
  readonly errorMessage?: string
}

/**
 * Build the panel rows for the design's user parameters: re-resolve the set and
 * report, per parameter, its resolved value or the exact evaluation error
 * (unknown reference, cycle chain, division by zero, …). Pure; does not mutate
 * the design. The wiring seam between the schema resolver and the FeatureTree
 * "Parameters" panel.
 */
export function deriveUserParameterViews(design: DesignFileV2): UserParameterView[] {
  const named: NamedExpression[] = design.userParameters.map((p) => ({
    name: p.name,
    expression: p.expression
  }))
  const { resolutions } = resolveParameters(named)
  return design.userParameters.map((p) => {
    const res = resolutions.get(p.name)
    if (res && res.ok) {
      return { name: p.name, expression: p.expression, resolvedValue: res.value }
    }
    return {
      name: p.name,
      expression: p.expression,
      resolvedValue: null,
      errorMessage: res ? res.message : 'Unresolved'
    }
  })
}

/** True when `name` is already a user-parameter name (case-sensitive). */
function hasUserParameter(design: DesignFileV2, name: string): boolean {
  return design.userParameters.some((p) => p.name === name)
}

/**
 * Add a new user parameter. Rejects a blank/invalid identifier or a name that
 * already exists (either as a user parameter OR as an existing numeric
 * `parameters` key, so the new expression can't shadow a dimension driver).
 * Re-resolves on success.
 */
export function addUserParameter(
  design: DesignFileV2,
  name: string,
  expression: string
): UserParameterOpResult {
  const trimmed = name.trim()
  if (!isValidIdentifier(trimmed)) {
    return { ok: false, reason: `"${name}" is not a valid parameter name.` }
  }
  if (hasUserParameter(design, trimmed)) {
    return { ok: false, reason: `A parameter named "${trimmed}" already exists.` }
  }
  if (Object.prototype.hasOwnProperty.call(design.parameters, trimmed)) {
    return { ok: false, reason: `"${trimmed}" is already a dimension parameter key.` }
  }
  const next: DesignFileV2 = {
    ...design,
    userParameters: [...design.userParameters, { name: trimmed, expression }]
  }
  return { ok: true, design: resolveUserParameters(next) }
}

/** Set a user parameter's expression (by name). Rejects an unknown name. Re-resolves. */
export function editUserParameterExpression(
  design: DesignFileV2,
  name: string,
  expression: string
): UserParameterOpResult {
  if (!hasUserParameter(design, name)) {
    return { ok: false, reason: `No parameter named "${name}".` }
  }
  const next: DesignFileV2 = {
    ...design,
    userParameters: design.userParameters.map((p) =>
      p.name === name ? { ...p, expression } : p
    )
  }
  return { ok: true, design: resolveUserParameters(next) }
}

/**
 * Replace whole-identifier occurrences of `from` with `to` in an expression,
 * leaving numbers, operators, and longer identifiers containing `from` untouched.
 * Pure string rewrite driven by the same identifier grammar as the tokenizer.
 */
function substituteIdentifier(expression: string, from: string, to: string): string {
  // Word-boundary that respects identifier chars (JS \b treats `_` as a word
  // char but also digits, so an explicit lookaround keeps `d1` from matching
  // inside `d10`).
  const re = new RegExp(`(^|[^A-Za-z0-9_])${from}(?![A-Za-z0-9_])`, 'g')
  return expression.replace(re, (_m, pre: string) => `${pre}${to}`)
}

/**
 * Rename a user parameter with a CASCADE: updates its own name, every OTHER
 * user parameter's expression that references the old name, and every
 * constraint/dimension `parameterKey` that pointed at the old name (so a bound
 * sketch dimension keeps driving off the renamed parameter). Rejects a blank/
 * invalid new name, an unknown old name, or a collision with an existing name.
 * Re-resolves on success.
 */
export function renameUserParameter(
  design: DesignFileV2,
  from: string,
  to: string
): UserParameterOpResult {
  const trimmed = to.trim()
  if (!hasUserParameter(design, from)) {
    return { ok: false, reason: `No parameter named "${from}".` }
  }
  if (from === trimmed) {
    return { ok: true, design } // no-op rename
  }
  if (!isValidIdentifier(trimmed)) {
    return { ok: false, reason: `"${to}" is not a valid parameter name.` }
  }
  if (hasUserParameter(design, trimmed)) {
    return { ok: false, reason: `A parameter named "${trimmed}" already exists.` }
  }
  if (Object.prototype.hasOwnProperty.call(design.parameters, trimmed)) {
    return { ok: false, reason: `"${trimmed}" is already a dimension parameter key.` }
  }
  const userParameters: UserParameter[] = design.userParameters.map((p) => {
    const nextExpr = substituteIdentifier(p.expression, from, to)
    if (p.name === from) return { ...p, name: trimmed, expression: nextExpr }
    return nextExpr === p.expression ? p : { ...p, expression: nextExpr }
  })
  // Cascade the numeric cache key.
  const parameters = { ...design.parameters }
  if (Object.prototype.hasOwnProperty.call(parameters, from)) {
    parameters[trimmed] = parameters[from]!
    delete parameters[from]
  }
  // Cascade every constraint / dimension parameterKey.
  const constraints = design.constraints.map((c) =>
    'parameterKey' in c && c.parameterKey === from ? { ...c, parameterKey: trimmed } : c
  )
  const dimensions = design.dimensions.map((d) =>
    d.parameterKey === from ? { ...d, parameterKey: trimmed } : d
  )
  const next: DesignFileV2 = { ...design, userParameters, parameters, constraints, dimensions }
  return { ok: true, design: resolveUserParameters(next) }
}

/**
 * The names that still reference `name`: other user parameters whose expression
 * mentions it, plus a sentinel `dimension`/`constraint` note when a bound
 * dimension/constraint `parameterKey` points at it. Empty ⇒ safe to delete.
 */
export function userParameterReferences(design: DesignFileV2, name: string): string[] {
  const refs: string[] = []
  for (const p of design.userParameters) {
    if (p.name === name) continue
    if (collectIdentifiers(p.expression).has(name)) refs.push(p.name)
  }
  const dimRef = design.dimensions.some((d) => d.parameterKey === name)
  const conRef = design.constraints.some((c) => 'parameterKey' in c && c.parameterKey === name)
  if (dimRef) refs.push('a sketch dimension')
  if (conRef && !dimRef) refs.push('a sketch constraint')
  return refs
}

/**
 * Delete a user parameter. BLOCKED (rejected with the referencing names) when it
 * is still referenced by another parameter's expression or by a bound
 * dimension/constraint. Also removes the stale numeric `parameters[name]` cache
 * entry on success. Re-resolves.
 */
export function deleteUserParameter(design: DesignFileV2, name: string): UserParameterOpResult {
  if (!hasUserParameter(design, name)) {
    return { ok: false, reason: `No parameter named "${name}".` }
  }
  const refs = userParameterReferences(design, name)
  if (refs.length > 0) {
    return {
      ok: false,
      reason: `Can't delete "${name}" — still referenced by ${refs.join(', ')}.`
    }
  }
  const parameters = { ...design.parameters }
  delete parameters[name]
  const next: DesignFileV2 = {
    ...design,
    userParameters: design.userParameters.filter((p) => p.name !== name),
    parameters
  }
  return { ok: true, design: resolveUserParameters(next) }
}

/** Legacy v1 — no constraint graph. */
export const designFileSchemaV1 = z.object({
  version: z.literal(1),
  extrudeDepthMm: z.number().finite().positive().default(10),
  entities: z.array(sketchEntitySchema)
})

export type DesignFileV1 = z.infer<typeof designFileSchemaV1>

export const designFileSchema = z.union([designFileSchemaV1, designFileSchemaV2])

export type DesignFile = DesignFileV2

export function emptyDesign(): DesignFileV2 {
  return {
    version: 2,
    extrudeDepthMm: 10,
    solidKind: 'extrude',
    loftSeparationMm: 20,
    revolve: { angleDeg: 360, axisX: 0 },
    parameters: {},
    userParameters: [],
    points: {},
    entities: [],
    constraints: [],
    dimensions: [],
    sketchPlane: { kind: 'datum', datum: 'XY' }
  }
}

/**
 * Set a picked model face as the design's active sketch plane (`kind: 'face'`), so the renderer
 * preview (`sketchPreviewPlacementMatrix`) AND the kernel build (`_apply_placement` in build_part.py)
 * place the sketch ON that face instead of the default XY datum — the link that closes the
 * sketch-on-face loop. Pure; does not mutate `design`.
 */
export function withSketchFacePlane(
  design: DesignFileV2,
  pick: {
    readonly origin: [number, number, number]
    readonly normal: [number, number, number]
    readonly xAxis: [number, number, number]
  }
): DesignFileV2 {
  return {
    ...design,
    sketchPlane: { kind: 'face', origin: pick.origin, normal: pick.normal, xAxis: pick.xAxis }
  }
}

/** Normalize any loaded design to v2 for the app. */
export function normalizeDesign(raw: unknown): DesignFileV2 {
  const parsed = designFileSchema.parse(raw)
  if (parsed.version === 2) {
    return designFileSchemaV2.parse(parsed)
  }
  return migrateV1ToV2(parsed)
}

function migrateV1ToV2(v1: DesignFileV1): DesignFileV2 {
  const points: Record<string, SketchPoint> = {}
  const entities: SketchEntity[] = []
  for (const e of v1.entities) {
    if (e.kind === 'polyline') {
      if ('points' in e && e.points.length >= 2) {
        const legacyPts = e.points
        const pointIds = legacyPts.map((_: [number, number], i: number) => `${e.id}_p${i}`)
        legacyPts.forEach((p: [number, number], i: number) => {
          points[pointIds[i]!] = { x: p[0], y: p[1] }
        })
        entities.push({
          id: e.id,
          kind: 'polyline',
          pointIds,
          closed: e.closed
        })
      } else if ('pointIds' in e) {
        entities.push(e)
      }
    } else {
      entities.push(e)
    }
  }
  return {
    version: 2,
    extrudeDepthMm: v1.extrudeDepthMm,
    solidKind: 'extrude',
    loftSeparationMm: 20,
    revolve: { angleDeg: 360, axisX: 0 },
    parameters: {},
    userParameters: [],
    points,
    entities,
    constraints: [],
    dimensions: [],
    sketchPlane: { kind: 'datum', datum: 'XY' }
  }
}
