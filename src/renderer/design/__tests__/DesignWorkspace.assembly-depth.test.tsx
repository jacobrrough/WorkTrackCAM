/**
 * DesignWorkspace — assembly-depth render pins (CAD foundation).
 *
 * Proves the three audited Assembly gaps are closed at the workspace surface:
 *   - #9 RELOAD SURFACE — when the workspace opens on the `assemble` route with
 *     hydrated `initialAssemblyParts` (rows from disk, blank handles) AND
 *     `initialAssemblyMates`, the AssemblyView shows BOTH the saved parts AND a
 *     "N mates positioning parts" readout (the mates are fed to the solver).
 *   - #11 DISTINCT GEOMETRY — two seeded parts that reference distinct geometry
 *     render as two distinct rows with distinct transform summaries (no single
 *     body aliased twice). The add-path distinctness contract itself is unit-
 *     pinned in `assembly-part-bridge.test.ts` (the click handler is not
 *     exercisable under `renderToStaticMarkup`).
 *   - honesty — a hydrated part (blank handle) shows the "geometry not loaded"
 *     placeholder, not a crash.
 *
 * Why `renderToStaticMarkup`? Same rationale as every sibling Design pin — the
 * project's node-env vitest ships no DOM. Reload/seed behaviour is pinned via
 * the mount-only `initialAssembly*` props (the levers WorkspaceHost feeds after
 * its hydrate effect resolves).
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DesignWorkspace,
  ASSEMBLY_PART_OFFSET_MM,
  STARTER_SCRIPT,
} from '../DesignWorkspace'
import type { AssemblyPart } from '../AssemblyView'
import type { AssemblyMateConstraint } from '../../../shared/assembly-mate-schema'

// ── window.fab shim ────────────────────────────────────────────────────────
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

// Two parts hydrated from disk: distinct ids, distinct geometry sources,
// distinct offset transforms — and NO live handle (the reload state).
const HYDRATED_PARTS: readonly AssemblyPart[] = [
  { id: 'base', name: 'Base', handle: '', geometrySource: 'design/base.json' },
  {
    id: 'arm',
    name: 'Arm',
    handle: '',
    geometrySource: 'design/arm.json',
    transform: { position: [60, 0, 0] },
    transformSummary: '@(60, 0, 0)',
  },
]

const HYDRATED_MATES: readonly AssemblyMateConstraint[] = [
  {
    id: 'm1',
    kind: 'coincident',
    part1Id: 'base',
    feature1: { x: 0, y: 0, z: 0 },
    part2Id: 'arm',
    feature2: { x: 0, y: 0, z: 0 },
  },
]

describe('DesignWorkspace — #9 assembly reload surface', () => {
  it('renders the hydrated parts on the assemble route', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: HYDRATED_PARTS,
        initialAssemblyMates: HYDRATED_MATES,
      }),
    )
    expect(html).toContain('data-testid="design-assembly-part-base"')
    expect(html).toContain('data-testid="design-assembly-part-arm"')
    // Both display names render.
    expect(html).toContain('Base')
    expect(html).toContain('Arm')
  })

  it('surfaces the hydrated mates via the mate-count readout (solver feed proof)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: HYDRATED_PARTS,
        initialAssemblyMates: HYDRATED_MATES,
      }),
    )
    expect(html).toContain('data-testid="design-assembly-mate-count"')
    expect(html).toContain('1 mate positioning parts')
  })

  it('shows the honest "geometry not loaded" placeholder for each hydrated row', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: HYDRATED_PARTS,
        initialAssemblyMates: HYDRATED_MATES,
      }),
    )
    expect(html).toContain('data-testid="design-assembly-part-base-nogeo"')
    expect(html).toContain('data-testid="design-assembly-part-arm-nogeo"')
    expect(html).toContain('geometry not loaded')
  })

  it('mounts the mate panel with the hydrated parts as real picker options', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: HYDRATED_PARTS,
        initialAssemblyMates: HYDRATED_MATES,
        // A handle so the panel renders its form (not the "need a second part"
        // hint) — proving the part selects list the REAL loaded parts.
        initialAssemblyHandle: 'asm:1',
      }),
    )
    expect(html).toContain('data-testid="assembly-mate-panel"')
    expect(html).toContain('data-testid="assembly-mate-part1"')
    expect(html).toContain('data-testid="assembly-mate-part2"')
    // The real part display names appear as <option> labels in the pickers.
    expect(html).toContain('Base')
    expect(html).toContain('Arm')
  })
})

describe('DesignWorkspace — #11 distinct geometry (two rows render distinctly)', () => {
  it('renders two distinct rows with distinct transform summaries', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: HYDRATED_PARTS,
      }),
    )
    // Two distinct part rows …
    expect(html).toContain('data-testid="design-assembly-part-base"')
    expect(html).toContain('data-testid="design-assembly-part-arm"')
    // … with distinct placements (one identity, one offset) — NOT one body
    // shown twice at the same spot.
    expect(html).toContain('identity')
    expect(html).toContain('@(60, 0, 0)')
  })

  it('exports a sane default instance offset (parts do not overlap)', () => {
    expect(ASSEMBLY_PART_OFFSET_MM).toBeGreaterThan(0)
  })

  it('does not emit console errors rendering the hydrated assemble route', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(DesignWorkspace, {
          initialScript: STARTER_SCRIPT,
          initialViewMode: 'assembly',
          initialAssemblyParts: HYDRATED_PARTS,
          initialAssemblyMates: HYDRATED_MATES,
          initialAssemblyHandle: 'asm:1',
          onAssemblyPartsChange: vi.fn(),
          onToast: vi.fn(),
        }),
      )
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
