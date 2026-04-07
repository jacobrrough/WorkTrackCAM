/**
 * Fixture Modeling Schemas
 *
 * Defines fixture records (vises, clamps, plates, custom) with simplified
 * bounding-box geometry for collision checking and operator reference.
 * Includes a versioned fixture library and common factory presets.
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// 3D Geometry Primitives
// ---------------------------------------------------------------------------

/** A point in 3D space (mm). */
export const point3DSchema = z.object({
  x: z.number().describe('X coordinate (mm)'),
  y: z.number().describe('Y coordinate (mm)'),
  z: z.number().describe('Z coordinate (mm)')
})

export type Point3D = z.infer<typeof point3DSchema>

/** Axis-aligned bounding box defined by min/max corners (mm). */
export const aabbSchema = z.object({
  minX: z.number().describe('Minimum X extent (mm)'),
  maxX: z.number().describe('Maximum X extent (mm)'),
  minY: z.number().describe('Minimum Y extent (mm)'),
  maxY: z.number().describe('Maximum Y extent (mm)'),
  minZ: z.number().describe('Minimum Z extent (mm)'),
  maxZ: z.number().describe('Maximum Z extent (mm)')
})

export type AABB = z.infer<typeof aabbSchema>

// ---------------------------------------------------------------------------
// Fixture Types
// ---------------------------------------------------------------------------

/** Supported fixture types. */
export const FIXTURE_TYPES = ['vise', 'clamp', 'plate', 'custom'] as const
export type FixtureType = (typeof FIXTURE_TYPES)[number]

export const FIXTURE_TYPE_LABELS: Record<FixtureType, string> = {
  vise: 'Vise',
  clamp: 'Clamp',
  plate: 'T-Slot / Vacuum Plate',
  custom: 'Custom Fixture'
}

// ---------------------------------------------------------------------------
// Clamping Position
// ---------------------------------------------------------------------------

/** A clamping contact point on the fixture. */
export const clampingPositionSchema = z.object({
  /** Label for operator reference (e.g. "Fixed jaw", "Left clamp"). */
  label: z.string().trim().min(1).describe('Clamping position label'),
  /** Position of the clamping contact in fixture local coordinates (mm). */
  position: point3DSchema.describe('Clamping contact position in fixture coordinates'),
  /** Clamping force direction (unit vector, optional). */
  forceDirection: point3DSchema.optional().describe('Clamping force direction (unit vector)')
})

export type ClampingPosition = z.infer<typeof clampingPositionSchema>

// ---------------------------------------------------------------------------
// Fixture Record
// ---------------------------------------------------------------------------

/** A single fixture definition in the library. */
export const fixtureRecordSchema = z.object({
  /** Unique fixture identifier. */
  id: z.string().trim().min(1).describe('Unique fixture identifier'),
  /** Human-readable fixture name. */
  name: z.string().trim().min(1).describe('Fixture display name'),
  /** Fixture category. */
  type: z.enum(FIXTURE_TYPES).describe('Fixture type category'),
  /**
   * Simplified geometry as one or more axis-aligned bounding boxes.
   * Multiple boxes allow representing L-shaped or compound fixtures
   * (e.g. vise body + jaw blocks). Used for collision checking.
   */
  geometry: z.array(aabbSchema).min(1).describe('Fixture geometry as AABB list'),
  /** Clamping contact positions on the fixture. */
  clampingPositions: z.array(clampingPositionSchema).default([]).describe('Clamping positions'),
  /**
   * Jaw opening range for vise-type fixtures (mm).
   * minMm = jaws fully closed, maxMm = jaws fully open.
   */
  jawOpeningMm: z
    .object({
      minMm: z.number().nonnegative().describe('Minimum jaw opening (mm)'),
      maxMm: z.number().positive().describe('Maximum jaw opening (mm)')
    })
    .optional()
    .describe('Jaw opening range for vise fixtures'),
  /** Path to imported mesh file (relative to library), if available. */
  meshRef: z.string().optional().describe('Path to imported fixture mesh (relative)'),
  /** Optional notes for the operator. */
  notes: z.string().optional().describe('Operator notes for this fixture')
})

export type FixtureRecord = z.infer<typeof fixtureRecordSchema>

// ---------------------------------------------------------------------------
// Fixture Library
// ---------------------------------------------------------------------------

/** Versioned fixture library containing all available fixtures. */
export const fixtureLibrarySchema = z.object({
  version: z.literal(1).describe('Fixture library schema version'),
  fixtures: z.array(fixtureRecordSchema).default([]).describe('Fixture records')
})

export type FixtureLibrary = z.infer<typeof fixtureLibrarySchema>

/** Create an empty fixture library. */
export function emptyFixtureLibrary(): FixtureLibrary {
  return { version: 1, fixtures: [] }
}

/** Parse and validate a fixture library payload. */
export function parseFixtureLibrary(raw: unknown): FixtureLibrary {
  return fixtureLibrarySchema.parse(raw)
}

// ---------------------------------------------------------------------------
// Common Factory Presets
// ---------------------------------------------------------------------------

/**
 * 4-inch (100 mm) machinist vise.
 * Body sits on the table; jaws protrude above stock-holding zone.
 * Geometry: body block + fixed jaw block + movable jaw block.
 */
export const VISE_4IN: FixtureRecord = {
  id: 'vise-4in',
  name: '4" Machinist Vise',
  type: 'vise',
  geometry: [
    // Body: 200mm long × 100mm wide × 60mm tall, centered at origin
    { minX: -100, maxX: 100, minY: -50, maxY: 50, minZ: 0, maxZ: 60 },
    // Fixed jaw: rises 30mm above body
    { minX: -100, maxX: -90, minY: -50, maxY: 50, minZ: 60, maxZ: 90 },
    // Movable jaw: rises 30mm above body (at max opening ~100mm)
    { minX: 90, maxX: 100, minY: -50, maxY: 50, minZ: 60, maxZ: 90 }
  ],
  clampingPositions: [
    { label: 'Fixed jaw', position: { x: -95, y: 0, z: 75 }, forceDirection: { x: 1, y: 0, z: 0 } },
    { label: 'Movable jaw', position: { x: 95, y: 0, z: 75 }, forceDirection: { x: -1, y: 0, z: 0 } }
  ],
  jawOpeningMm: { minMm: 0, maxMm: 100 },
  notes: 'Standard 4" machinist vise. Part sits on parallels at Z=60mm above table.'
}

/**
 * 6-inch (150 mm) machinist vise.
 * Larger jaw opening, taller body.
 */
export const VISE_6IN: FixtureRecord = {
  id: 'vise-6in',
  name: '6" Machinist Vise',
  type: 'vise',
  geometry: [
    // Body
    { minX: -150, maxX: 150, minY: -75, maxY: 75, minZ: 0, maxZ: 70 },
    // Fixed jaw
    { minX: -150, maxX: -138, minY: -75, maxY: 75, minZ: 70, maxZ: 105 },
    // Movable jaw
    { minX: 138, maxX: 150, minY: -75, maxY: 75, minZ: 70, maxZ: 105 }
  ],
  clampingPositions: [
    { label: 'Fixed jaw', position: { x: -144, y: 0, z: 87 }, forceDirection: { x: 1, y: 0, z: 0 } },
    { label: 'Movable jaw', position: { x: 144, y: 0, z: 87 }, forceDirection: { x: -1, y: 0, z: 0 } }
  ],
  jawOpeningMm: { minMm: 0, maxMm: 150 },
  notes: 'Standard 6" machinist vise. Part sits on parallels at Z=70mm above table.'
}

/**
 * T-slot table plate.
 * Flat aluminum plate with T-slots for clamp mounting.
 */
export const TSLOT_PLATE: FixtureRecord = {
  id: 'tslot-plate',
  name: 'T-Slot Plate (300x200)',
  type: 'plate',
  geometry: [
    // Plate body: 300mm × 200mm × 20mm thick
    { minX: -150, maxX: 150, minY: -100, maxY: 100, minZ: 0, maxZ: 20 }
  ],
  clampingPositions: [
    { label: 'T-slot 1', position: { x: -100, y: 0, z: 20 } },
    { label: 'T-slot 2', position: { x: 0, y: 0, z: 20 } },
    { label: 'T-slot 3', position: { x: 100, y: 0, z: 20 } }
  ],
  notes: 'Standard T-slot plate. Parts clamped directly or with step blocks.'
}

/**
 * Vacuum hold-down table.
 * Flat surface with vacuum zone — no clamps protruding above the surface.
 */
export const VACUUM_TABLE: FixtureRecord = {
  id: 'vacuum-table',
  name: 'Vacuum Table (400x300)',
  type: 'plate',
  geometry: [
    // Table body: 400mm × 300mm × 30mm thick
    { minX: -200, maxX: 200, minY: -150, maxY: 150, minZ: 0, maxZ: 30 }
  ],
  clampingPositions: [
    { label: 'Vacuum zone center', position: { x: 0, y: 0, z: 30 } }
  ],
  notes: 'Vacuum hold-down table. No vertical obstructions — full top-face access.'
}

/** All built-in fixture presets. */
export const COMMON_FIXTURES: readonly FixtureRecord[] = [
  VISE_4IN,
  VISE_6IN,
  TSLOT_PLATE,
  VACUUM_TABLE
]

/**
 * Create a fixture library pre-loaded with the common factory presets.
 */
export function defaultFixtureLibrary(): FixtureLibrary {
  return { version: 1, fixtures: [...COMMON_FIXTURES] }
}
