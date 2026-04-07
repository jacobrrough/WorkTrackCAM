import type { ImportHistoryEntry } from './project-schema'

/** Short label for Utilities → Recent imports (matches `roundTripLevel` on disk). */
export const ROUND_TRIP_SHORT: Record<ImportHistoryEntry['roundTripLevel'], string> = {
  mesh_only: 'Mesh only',
  partial: 'Partial',
  full: 'Full'
}

/** Tooltip / aria-label text for each level. */
export const ROUND_TRIP_HELP: Record<ImportHistoryEntry['roundTripLevel'], string> = {
  mesh_only: 'Triangle mesh stored in assets (STL copy or mesh converted to STL).',
  partial: 'Tessellated from CAD (e.g. STEP); parametric history is not preserved.',
  full: 'Best available fidelity when the pipeline supports it.'
}
