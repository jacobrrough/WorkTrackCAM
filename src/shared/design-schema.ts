import { z } from 'zod'

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
  /** Angle between line (a1→b1) and (a2→b2); target from `parameters[parameterKey]` in degrees (solver minimizes (cos meas − cos target)²). */
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

/** v2 polylines — must stay a plain ZodObject (no .superRefine) for use in unions. */
export const polylineByPointIdsSchema = z.object({
  id: z.string(),
  kind: z.literal('polyline'),
  pointIds: z.array(z.string()).min(2),
  closed: z.boolean()
})

/** v1 / legacy polylines with inline coordinates */
export const polylineByPointsSchema = z.object({
  id: z.string(),
  kind: z.literal('polyline'),
  points: z.array(vec2).min(2),
  closed: z.boolean()
})

export const rectEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('rect'),
  cx: z.number(),
  cy: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  rotation: z.number().default(0)
})

export const circleEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('circle'),
  cx: z.number(),
  cy: z.number(),
  r: z.number().positive()
})

/** Rounded slot (stadium): semicircle centers `length` mm apart on local +X; `width` is the narrow opening (cap diameter). */
export const slotEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('slot'),
  cx: z.number(),
  cy: z.number(),
  length: z.number().nonnegative(),
  width: z.number().positive(),
  rotation: z.number().default(0)
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
  closed: z.boolean().optional()
})

/** Axis-aligned ellipse in sketch mm; `rotation` rotates the major axis from +X. */
export const ellipseEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('ellipse'),
  cx: z.number(),
  cy: z.number(),
  rx: z.number().positive(),
  ry: z.number().positive(),
  rotation: z.number().default(0)
})

/** Interpolating spline through point IDs (Catmull–Rom tessellation for display/kernel). */
export const splineFitEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('spline_fit'),
  pointIds: z.array(z.string()).min(3),
  closed: z.boolean().optional()
})

/** Uniform cubic B-spline style curve from control point IDs (does not pass through every control). */
export const splineCpEntitySchema = z.object({
  id: z.string(),
  kind: z.literal('spline_cp'),
  pointIds: z.array(z.string()).min(4),
  closed: z.boolean().optional()
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
    points: {},
    entities: [],
    constraints: [],
    dimensions: [],
    sketchPlane: { kind: 'datum', datum: 'XY' }
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
    points,
    entities,
    constraints: [],
    dimensions: [],
    sketchPlane: { kind: 'datum', datum: 'XY' }
  }
}
