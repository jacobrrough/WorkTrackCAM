/**
 * DesignWorkspace — wave-7 mount-wiring source pins.
 *
 * The wave-7 features (component copy/mirror/visibility, external STEP import,
 * real-mesh assembly viewport) are unit-tested in their own component/pure
 * suites via props; these pins prove the ORCHESTRATOR actually threads those
 * props at the live `<AssemblyView>` mount so the features are REACHABLE (the
 * "built but unwired" trap). Source pins because the mount props are not
 * observable through `renderToStaticMarkup` of the whole workspace.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, '..', 'DesignWorkspace.tsx'), 'utf8')

describe('DesignWorkspace wave-7 AssemblyView wiring', () => {
  it('threads onPartsChange so Copy/Mirror are reachable + persist through setAssemblyParts', () => {
    expect(SRC).toContain('onPartsChange={setAssemblyParts}')
  })

  it('threads geometryDescriptors from the live tessellation so the viewport shows real proportions', () => {
    expect(SRC).toContain('geometryDescriptors={assemblyDescriptors}')
    // the descriptor map is derived (view-only) from the tessellation per-handle bbox
    expect(SRC).toContain('const assemblyDescriptors = useMemo')
    expect(SRC).toContain('bboxToDescriptor(bbox)')
  })

  it('threads onImportStepPart wired to the validated assembly:importStepPart IPC', () => {
    expect(SRC).toContain('onImportStepPart={handleImportStepPart}')
    expect(SRC).toContain('fab().assemblyImportStepPart(chosen)')
    // the file picker restricts to STEP/STP before the IPC is ever called
    expect(SRC).toMatch(/dialogOpenFile\(\[\{ name: 'STEP', extensions: \['step', 'stp'\] \}\]\)/)
  })

  it('maps the import result to a distinct part carrying the durable stepPath', () => {
    expect(SRC).toContain('geometrySource: r.geometrySource.stepPath ?? undefined')
  })

  // Wave 8 — the imported part also carries the STRUCTURED source ref so the
  // cachedBounds/kind survive persist → hydrate (dangling badge + cached bbox).
  it('carries the structured geometrySourceRef so STEP cachedBounds round-trip', () => {
    expect(SRC).toContain('geometrySourceRef: r.geometrySource')
  })

  // Wave 8 — hole tables thread through the controlled drawing seam so a placed
  // table persists to drawing.json (mirrors notes/center-marks).
  it('threads persistedHoleTables/onPersistHoleTables so the hole table persists', () => {
    expect(SRC).toContain('persistedHoleTables={effectiveDrawingHoleTables}')
    expect(SRC).toContain('const handlePersistDrawingHoleTables = useCallback')
    expect(SRC).toContain('onDrawing?.({ ...base, holeTables: next })')
  })
})
