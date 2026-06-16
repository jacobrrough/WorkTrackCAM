/**
 * Drawings persistence END-TO-END wiring pins.
 *
 * The Drawings BACKEND (`drawing:load` / `drawing:save` IPC + `drawing-file-store`
 * + `drawingFileSchema`) was fully built, but the renderer never called it — a
 * placed dimension / GD&T frame / edited title block lived only in React state
 * and was lost on reload / route-switch (the assembly-#9 disappearing-data class).
 *
 * This cycle wires it end to end:
 *   - PRELOAD exposes `drawingLoad` / `drawingSave` on `window.fab` (the bridge).
 *   - DesignSessionContext HYDRATES on project-open (guarded by a (projectDir)
 *     load-key so a re-render can't clobber unsaved edits) and PERSISTS on change
 *     (debounced, committing the latest state through the schema).
 *   - DesignWorkspace forwards the session's `drawing` + `onDrawing` into
 *     DrawingView, folding each change instead of just `setState`.
 *   - DrawingView gains the `onPersistTitleBlock` seam (title block had none).
 *
 * Renderer test env is `node` (no jsdom). The persistence SEMANTICS are unit-
 * tested in `src/shared/drawing-hydrate.test.ts`; the WIRING + anti-clobber /
 * committed-read discipline are source-pinned here (the established convention,
 * mirroring `DesignSessionContext.reload-guard.test.ts`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DESIGN_DIR = join(__dirname, '..')
const APP_DIR = join(__dirname, '..', '..', 'app')
const SHARED_DIR = join(__dirname, '..', '..', '..', 'shared')
const PRELOAD_SRC = readFileSync(
  join(__dirname, '..', '..', '..', 'preload', 'index.ts'),
  'utf-8'
)
const SESSION_SRC = readFileSync(join(DESIGN_DIR, 'DesignSessionContext.tsx'), 'utf-8')
const WORKSPACE_SRC = readFileSync(join(DESIGN_DIR, 'DesignWorkspace.tsx'), 'utf-8')
const DRAWING_VIEW_SRC = readFileSync(join(DESIGN_DIR, 'DrawingView.tsx'), 'utf-8')
const HOST_SRC = readFileSync(join(APP_DIR, 'DesignWorkspaceHost.tsx'), 'utf-8')
const SCHEMA_SRC = readFileSync(join(SHARED_DIR, 'drawing-sheet-schema.ts'), 'utf-8')

// ── (A) Preload bridge ────────────────────────────────────────────────────────

describe('preload bridge — drawingLoad / drawingSave', () => {
  it('the Api type declares drawingLoad returning Promise<DrawingFile>', () => {
    expect(PRELOAD_SRC).toContain('drawingLoad: (projectDir: string) => Promise<DrawingFile>')
  })

  it('the Api type declares drawingSave (projectDir, json) => Promise<void>', () => {
    expect(PRELOAD_SRC).toContain('drawingSave: (projectDir: string, json: string) => Promise<void>')
  })

  it('imports the DrawingFile type for the bridge signature', () => {
    expect(PRELOAD_SRC).toContain("import type { DrawingFile } from '../shared/drawing-sheet-schema'")
  })

  it('the impl dispatches drawingLoad to the existing drawing:load IPC channel', () => {
    expect(PRELOAD_SRC).toContain(
      "drawingLoad: (projectDir) => ipcRenderer.invoke('drawing:load', projectDir)"
    )
  })

  it('the impl dispatches drawingSave to the existing drawing:save IPC channel', () => {
    expect(PRELOAD_SRC).toContain(
      "drawingSave: (projectDir, json) => ipcRenderer.invoke('drawing:save', projectDir, json)"
    )
  })
})

// ── (B) Schema completeness ───────────────────────────────────────────────────

describe('drawing-sheet-schema — titleBlock additive field', () => {
  it('carries an additive, OPTIONAL titleBlock on the sheet schema (no .default → back-compat)', () => {
    expect(SCHEMA_SRC).toContain('titleBlock: drawingTitleBlockSchema.optional()')
  })

  it('exports a drawingTitleBlockSchema with the five title fields', () => {
    expect(SCHEMA_SRC).toContain('export const drawingTitleBlockSchema')
    for (const field of ['name:', 'scale:', 'author:', 'date:', 'sheet:']) {
      expect(SCHEMA_SRC).toContain(field)
    }
  })

  it('keeps annotations additive + optional (the sibling back-compat field)', () => {
    expect(SCHEMA_SRC).toContain('annotations: drawingSheetAnnotationsSchema.optional()')
  })
})

// ── (C) DesignSessionContext — load → hydrate (anti-clobber guard) ────────────

describe('DesignSessionContext — drawing load hydrates on project-open', () => {
  it('hydrates from fab.drawingLoad', () => {
    expect(SESSION_SRC).toContain('await fab.drawingLoad(projectDir)')
    expect(SESSION_SRC).toContain('hydrateDrawingFile(file)')
  })

  it('guards the load by a (projectDir) load-key ref (Cycle-249 anti-clobber)', () => {
    expect(SESSION_SRC).toContain('lastDrawingLoadKeyRef')
    expect(SESSION_SRC).toContain('if (lastDrawingLoadKeyRef.current === projectDir) return')
    // ...and resets the key when the project closes so reopening reloads.
    expect(SESSION_SRC).toContain('lastDrawingLoadKeyRef.current = null')
  })

  it('the drawing load effect deps are exactly [fab, projectDir] — NOT designDiskRevision', () => {
    // Keyed on projectDir ALONE so a design-only revision bump can never re-fire
    // the drawing load + clobber unsaved drawing edits.
    expect(SESSION_SRC).toContain('}, [fab, projectDir])')
  })

  it('reads the status callback through a ref (never re-fires on callback identity)', () => {
    expect(SESSION_SRC).toContain("onStatusRef.current?.(\n          formatLoadRejection('drawing/drawing.json'")
  })
})

// ── (D) DesignSessionContext — persist-on-change (committed read, debounced) ──

describe('DesignSessionContext — drawing persist is debounced + reads committed state', () => {
  it('exposes onDrawingChange + drawing on the session value', () => {
    expect(SESSION_SRC).toContain('drawing: DrawingViewState | null')
    expect(SESSION_SRC).toContain('onDrawingChange: (next: DrawingViewState) => void')
  })

  it('debounces the save (timer ref + DRAWING_SAVE_DEBOUNCE_MS)', () => {
    expect(SESSION_SRC).toContain('const DRAWING_SAVE_DEBOUNCE_MS')
    expect(SESSION_SRC).toContain('drawingSaveTimerRef')
    expect(SESSION_SRC).toContain('setTimeout(() => {')
  })

  it('the debounced body reads the COMMITTED state via the ref (no eager-updater capture, Cycle-256)', () => {
    expect(SESSION_SRC).toContain('const committed = drawingRef.current')
    // The fold operates on the committed value, not the `next` captured in the closure.
    expect(SESSION_SRC).toContain('foldDrawingState(committed,')
  })

  it('commits synchronously to the ref before scheduling the save', () => {
    expect(SESSION_SRC).toContain('drawingRef.current = next')
  })

  it('serializes drawing writes behind a promise chain (no interleave)', () => {
    expect(SESSION_SRC).toContain('drawingWriteChainRef')
    // The save reads the projectDir via the ref (so the unmount flush works under
    // [] effect deps); the dispatch goes to fab.drawingSave with the committed file.
    expect(SESSION_SRC).toContain('await fab.drawingSave(dir, JSON.stringify(file))')
  })

  it('flushes the pending save on unmount instead of dropping it (route-switch survival)', () => {
    // The unmount cleanup FLUSHes (not just clears) so a sub-debounce edit made
    // right before navigating to a non-CAD route is still persisted.
    expect(SESSION_SRC).toContain('const flushDrawingSave = useCallback')
    expect(SESSION_SRC).toContain('flushDrawingSave()')
  })

  it('folds onto the loaded base file so foreign sheets are preserved', () => {
    expect(SESSION_SRC).toContain('drawingFileBaseRef')
    expect(SESSION_SRC).toContain('drawingFileBaseRef.current ?? undefined')
  })

  it('clears the pending save timer on unmount (no stale save after teardown)', () => {
    expect(SESSION_SRC).toContain('if (drawingSaveTimerRef.current !== null) {')
    expect(SESSION_SRC).toContain('clearTimeout(drawingSaveTimerRef.current)')
  })

  it('no-ops the persist when no project is open', () => {
    // The onDrawingChange body returns early without a project (UI stays live).
    expect(SESSION_SRC).toMatch(/setDrawing\(next\)\s*\n\s*if \(!projectDir\) return/)
  })
})

// ── (E) DesignWorkspace — onPersist* fold into onDrawing (not just setState) ──

describe('DesignWorkspace — DrawingView wires onPersist* to the persisting onDrawing', () => {
  it('accepts the controlled drawing + onDrawing props', () => {
    expect(WORKSPACE_SRC).toContain('readonly drawing?: DrawingViewState | null')
    expect(WORKSPACE_SRC).toContain('readonly onDrawing?: (next: DrawingViewState) => void')
  })

  it('the DrawingView onPersistDimensions is the folding handler, NOT a bare setState', () => {
    expect(WORKSPACE_SRC).toContain('onPersistDimensions={handlePersistDrawingDimensions}')
    // The legacy bare-setState wiring must be gone from the DrawingView mount.
    expect(WORKSPACE_SRC).not.toContain('onPersistDimensions={setDrawingDimensions}')
  })

  it('the DrawingView onPersistGdt is the folding handler, NOT a bare setState', () => {
    expect(WORKSPACE_SRC).toContain('onPersistGdt={handlePersistDrawingGdt}')
    expect(WORKSPACE_SRC).not.toContain('onPersistGdt={setDrawingGdtFrames}')
  })

  it('the folding handlers route to onDrawing in controlled mode', () => {
    expect(WORKSPACE_SRC).toContain('onDrawing?.({ ...base, dimensions: next })')
    expect(WORKSPACE_SRC).toContain('onDrawing?.({ ...base, featureControlFrames: next })')
    expect(WORKSPACE_SRC).toContain('onDrawing?.({ ...base, titleBlock: next })')
  })

  it('threads the hydrated title block + its persist handler into DrawingView', () => {
    expect(WORKSPACE_SRC).toContain('initialTitleBlock={effectiveDrawingTitleBlock}')
    expect(WORKSPACE_SRC).toContain('onPersistTitleBlock={')
    expect(WORKSPACE_SRC).toContain('handlePersistDrawingTitleBlock')
  })

  it('renders the hydrated dimensions/GD&T (effective state), not just local state', () => {
    expect(WORKSPACE_SRC).toContain('persistedDimensions={effectiveDrawingDimensions}')
    expect(WORKSPACE_SRC).toContain('persistedGdtFrames={effectiveDrawingGdtFrames}')
    expect(WORKSPACE_SRC).toContain('const effectiveDrawing = drawingControlled')
  })
})

// ── (F) DesignWorkspaceHost — threads the session drawing seam ────────────────

describe('DesignWorkspaceHost — threads session.drawing + session.onDrawingChange', () => {
  it('passes the hydrated session drawing into DesignWorkspace', () => {
    expect(HOST_SRC).toContain('drawing={session.drawing}')
  })

  it('passes the session persist sink into DesignWorkspace', () => {
    expect(HOST_SRC).toContain('onDrawing={session.onDrawingChange}')
  })
})

// ── (G) DrawingView — title-block persist seam + HLR honesty caveat ───────────

describe('DrawingView — onPersistTitleBlock seam + projection honesty', () => {
  it('declares the onPersistTitleBlock prop', () => {
    expect(DRAWING_VIEW_SRC).toContain('readonly onPersistTitleBlock?: (next: DrawingTitleBlock) => void')
  })

  it('fires onPersistTitleBlock with the COMPUTED next block on every title edit', () => {
    expect(DRAWING_VIEW_SRC).toContain('onPersistTitleBlock?.(next)')
  })

  it('mirrors an externally-hydrated title block into local state (value-guarded, no clobber)', () => {
    expect(DRAWING_VIEW_SRC).toContain('if (onPersistTitleBlock === undefined || initialTitleBlock === undefined) return')
    expect(DRAWING_VIEW_SRC).toContain(
      'JSON.stringify(prev) === JSON.stringify(initialTitleBlock) ? prev : initialTitleBlock'
    )
  })

  it('surfaces the "not certified HLR" projection caveat honestly', () => {
    expect(DRAWING_VIEW_SRC).toContain('data-testid="design-drawing-projection-caveat"')
    expect(DRAWING_VIEW_SRC).toContain('not certified hidden-line')
    // exactly once (the splice-double-apply guard)
    const count = DRAWING_VIEW_SRC.split('design-drawing__projection-caveat').length - 1
    expect(count).toBe(1)
  })
})
