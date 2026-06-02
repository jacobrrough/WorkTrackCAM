import { z } from 'zod'

/**
 * Persisted assembly **mate constraint** (assembly.json / .wtcam) for the convergence solver.
 *
 * This is the durable, project-saved representation consumed by `solveMateConstraints`
 * (`assembly-solver-core.ts`). It is intentionally **distinct** from the sidecar `CadAssemblyMate`
 * wire shape (which is ephemeral and OCC-topology oriented): persisting a mate must survive a
 * round-trip through disk and never depend on a live B-rep handle.
 *
 * Feature references use a simple **local-coordinate** form: a point `{ x, y, z }` in the owning
 * part's local frame and/or a local unit `axis`. The foundation solver uses the point for
 * positional mates (coincident / concentric / distance) and the axis for directional mates
 * (angle / flush / tangent). Keep it small but fully typed — full B-rep topology ids are a
 * later (full-vision) enhancement, see `docs/plans/v2-assembly-mate-solver-convergence.md`.
 */

/** Mate kinds supported by the foundation solver (discriminated by `kind` on the constraint). */
export const assemblyMateKindEnum = z.enum([
  /** Two feature points are made to coincide in world space (3 positional residuals). */
  'coincident',
  /** Two feature axes are made collinear / centers aligned (cylindrical alignment). */
  'concentric',
  /** Two feature points held at a target separation `value` (mm). */
  'distance',
  /** Two feature axes held at a target angle `value` (degrees). */
  'angle',
  /** Two feature points share one world coordinate along the feature axis (planar flush). */
  'flush',
  /** A feature axis is held tangent (perpendicular contact) to another feature. */
  'tangent'
])

export type AssemblyMateKind = z.infer<typeof assemblyMateKindEnum>

/** Local-frame unit axis label for directional mates. */
export const assemblyMateAxisEnum = z.enum(['x', 'y', 'z'])

export type AssemblyMateAxis = z.infer<typeof assemblyMateAxisEnum>

/**
 * A feature reference local to its owning part: an optional point `{ x, y, z }` and/or a local
 * `axis`. Both are optional so a directional-only or positional-only feature stays valid, but at
 * least one is required (refined by `assemblyMateFeatureSchema`).
 */
export const assemblyMateFeatureSchema = z
  .object({
    /** Local-frame point (mm). Used by positional mates. */
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    z: z.number().finite().optional(),
    /** Local-frame unit axis label. Used by directional mates. */
    axis: assemblyMateAxisEnum.optional()
  })
  .refine(
    (f) => f.x != null || f.y != null || f.z != null || f.axis != null,
    { message: 'A mate feature must specify a point (x/y/z) and/or an axis.' }
  )

export type AssemblyMateFeature = z.infer<typeof assemblyMateFeatureSchema>

/**
 * One persisted mate constraint between two parts.
 *
 * `value` is the numeric target for parametric mates (`distance` mm, `angle` deg) and ignored by
 * the others. `suppress` lets a constraint be parked without deleting it (excluded from the solve).
 */
export const assemblyMateConstraintSchema = z.object({
  /** Stable unique id (used for deterministic ordering and conflict reporting). */
  id: z.string().trim().min(1),
  kind: assemblyMateKindEnum,
  /** Owning instance id of `feature1` (must match an assembly component id at solve time). */
  part1Id: z.string().trim().min(1),
  feature1: assemblyMateFeatureSchema,
  /** Owning instance id of `feature2`. */
  part2Id: z.string().trim().min(1),
  feature2: assemblyMateFeatureSchema,
  /** Numeric target for `distance` (mm) / `angle` (deg); ignored by other kinds. */
  value: z.number().finite().optional(),
  /** When true, the constraint is parked and excluded from the solve. */
  suppress: z.boolean().optional()
})

export type AssemblyMateConstraint = z.infer<typeof assemblyMateConstraintSchema>

/**
 * Array of persisted mate constraints. `.default([])` keeps legacy `assembly.json` / `.wtcam`
 * files (written before mates existed) parsing unchanged — same backward-compat pattern as the
 * project schema's `designModels`.
 */
export const assemblyMateConstraintsSchema = z.array(assemblyMateConstraintSchema).default([])

export type AssemblyMateConstraints = z.infer<typeof assemblyMateConstraintsSchema>
