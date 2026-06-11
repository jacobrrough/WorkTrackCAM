/**
 * SketchSurface — the LIVE, session-persisted 2D sketch surface mounted in the
 * Design cockpit's "Sketch" stage.
 *
 * Wave 3e (the keystone unlock): the rich 2D vector editor was built
 * (`Sketch2DCanvas` — line/rect/circle/arc/polygon/slot/spline/trim/extend/
 * fillet/chamfer/move/rotate/scale/mirror + numeric dimension popovers) but was
 * mounted **nowhere** in the running shell, so nearly the entire Vectors ribbon
 * read as "stub/unreachable" (see docs/plans/catalog/vcarve-laguna.md FG-3 and
 * docs/plans/catalog/cad-design.md). DesignWorkspace previously mounted the
 * SELF-CONTAINED `MvpSketchCanvas`, whose entity state lives in its own
 * `useReducer` — so a drawn vector NEVER persisted into the design model, never
 * survived a save+reload, and was lost on a Sketch→Model stage switch.
 *
 * This component fixes that by wrapping the legacy session-wired
 * `Sketch2DCanvas` (the variant that is bidirectionally bound to a
 * `DesignFileV2` via `design` / `onDesignChange`). The host threads
 * `DesignSessionContext.design` + `onDesignChange` straight through, so:
 *   (a) drawing a vector dispatches an `edit` into the session's design model;
 *   (b) the model is written to `design/sketch.json` by `session.saveDesign`
 *       and re-hydrated on reload (round-trip);
 *   (c) the entities live in the session, NOT in this component — so toggling
 *       between the Sketch and Model stages preserves them.
 *
 * The legacy canvas is a *controlled* editor (no internal tool palette and no
 * snap toggle — those live in the SELF-contained MVP canvas). To keep the task
 * contract ("internal tool palette, snap-to-grid toggle, and numeric dimension
 * input are all reachable + functional"), this wrapper supplies:
 *   - an internal tool palette (the {@link SKETCH_SURFACE_TOOLS} list) that
 *     drives the canvas's `activeTool`;
 *   - a snap-to-grid toggle that switches the effective `gridMm` between the
 *     grid pitch and an effectively-off fine value;
 *   - per-tool parameter fields (fillet radius / chamfer leg / rotate° / scale×)
 *     so those edit tools are usable;
 * while the numeric dimension input (ΔX/ΔY, W×H, R popovers) is provided by the
 * canvas itself.
 *
 * No `any` types; no provider dependency (it takes plain `design` /
 * `onDesignChange` props), so DesignWorkspace stays a pure, provider-less
 * component and every existing render-pin test keeps rendering it without a
 * `DesignSessionProvider`.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { DesignFileV2, SketchEntity } from '../../shared/design-schema'
import { Sketch2DCanvas, type SketchTool } from './Sketch2DCanvas'
import { sketchToolForDesignCommand } from './design-command-map'
import { TextDialog, type FontBufferLoader } from './feature-dialogs/TextDialog'
import {
  ArraySketchDialog,
  BooleanSketchDialog,
  OffsetSketchDialog,
  sketchEditDialogForCommand,
  type SketchEditDialogKind
} from './feature-dialogs/SketchEditDialogs'
import { closedLoopEntityIds } from '../../shared/sketch-boolean-offset'

/** Catalog id of the Text command — arming it opens the Text dialog on this surface. */
export const SKETCH_TEXT_COMMAND_ID = 'sk_text'

/**
 * A short human label for a closed-loop entity, surfaced in the selection list
 * so the operator knows which loop a row is. Mirrors the `cam-2d-derive` labels.
 */
function entityLabel(e: SketchEntity): string {
  switch (e.kind) {
    case 'rect':
      return `Rectangle ${e.id}`
    case 'circle':
      return `Circle ${e.id}`
    case 'slot':
      return `Slot ${e.id}`
    case 'ellipse':
      return `Ellipse ${e.id}`
    case 'arc':
      return `Arc ${e.id}`
    case 'polyline':
      return `Polyline ${e.id}`
    case 'spline_fit':
    case 'spline_cp':
      return `Spline ${e.id}`
    default: {
      const _never: never = e
      void _never
      return 'Loop'
    }
  }
}

/** A palette entry: the canvas tool id + its human label + group heading. */
interface SketchSurfaceToolDef {
  readonly id: SketchTool
  readonly label: string
  readonly group: 'Create' | 'Modify' | 'Transform'
}

/**
 * The tools surfaced in the mounted palette, grouped the way the Vectric /
 * Fusion ribbons group them. Every id is a real `SketchTool` the legacy
 * `Sketch2DCanvas` already handles (verified against its `onMouseDown` switch),
 * so each button drives a working draw/edit path. Exported so the render-pin
 * test can assert one button per entry without re-deriving the list.
 */
export const SKETCH_SURFACE_TOOLS: readonly SketchSurfaceToolDef[] = [
  { id: 'line', label: 'Line', group: 'Create' },
  { id: 'polyline', label: 'Polyline', group: 'Create' },
  { id: 'rect', label: 'Rectangle', group: 'Create' },
  { id: 'rect_3pt', label: 'Rect (3-pt)', group: 'Create' },
  { id: 'circle', label: 'Circle', group: 'Create' },
  { id: 'circle_2pt', label: 'Circle (2-pt)', group: 'Create' },
  { id: 'circle_3pt', label: 'Circle (3-pt)', group: 'Create' },
  { id: 'ellipse', label: 'Ellipse', group: 'Create' },
  { id: 'arc', label: 'Arc (3-pt)', group: 'Create' },
  { id: 'arc_center', label: 'Arc (center)', group: 'Create' },
  { id: 'polygon', label: 'Polygon', group: 'Create' },
  { id: 'slot_center', label: 'Slot (center)', group: 'Create' },
  { id: 'slot_overall', label: 'Slot (overall)', group: 'Create' },
  { id: 'spline_fit', label: 'Spline (fit)', group: 'Create' },
  { id: 'spline_cp', label: 'Spline (CV)', group: 'Create' },
  { id: 'point', label: 'Point', group: 'Create' },
  { id: 'trim', label: 'Trim', group: 'Modify' },
  { id: 'extend', label: 'Extend', group: 'Modify' },
  { id: 'split', label: 'Split', group: 'Modify' },
  { id: 'break', label: 'Break', group: 'Modify' },
  { id: 'fillet', label: 'Fillet', group: 'Modify' },
  { id: 'chamfer', label: 'Chamfer', group: 'Modify' },
  { id: 'move_sk', label: 'Move', group: 'Transform' },
  { id: 'rotate_sk', label: 'Rotate', group: 'Transform' },
  { id: 'scale_sk', label: 'Scale', group: 'Transform' },
  { id: 'mirror_sk', label: 'Mirror', group: 'Transform' }
]

/** Ordered group headings for the palette render. */
const TOOL_GROUPS: ReadonlyArray<SketchSurfaceToolDef['group']> = ['Create', 'Modify', 'Transform']

/** Grid pitch (mm) used when snap is ON. Matches the cockpit's other 5 mm grids. */
const SNAP_GRID_MM = 5
/**
 * Effective `gridMm` when snap is OFF. The legacy canvas always routes
 * placements through `snap(value, gridMm)`, so there is no literal "no snap";
 * a tiny pitch makes the lattice finer than the operator can perceive (≈ free
 * placement) while keeping the canvas's grid-render guard (`gridPx >= 4`) from
 * drawing a solid wall of lines.
 */
const SNAP_OFF_GRID_MM = 0.01

/** The fixed canvas bitmap. CSS stretches it to the host; the canvas's pointer
 * math rescales for the CSS stretch (see its `clientToCanvasLocal` comment), so
 * a generous bitmap keeps the rendered grid crisp without a resize observer. */
const CANVAS_BITMAP_W = 1200
const CANVAS_BITMAP_H = 820

export interface SketchSurfaceProps {
  /**
   * The live sketch model (the session's `DesignFileV2`). Drawing mutates this
   * via {@link onDesignChange}; persistence + reload are owned by the session,
   * so this surface is stateless w.r.t. entities (only UI state — active tool,
   * snap, per-tool params — is local).
   */
  readonly design: DesignFileV2
  /** Apply a sketch edit (a drawn/edited vector). Wired to `session.onDesignChange`. */
  readonly onDesignChange: (next: DesignFileV2) => void
  /**
   * The catalog id of the sketch tool the ribbon most recently armed (e.g.
   * `'sk_line'`), or `null`. When it changes to a recognised id, the palette
   * pre-selects the matching tool — so the ribbon's `armSketchTool` actually
   * drives the mounted surface (resolving the FG-3 "armed tool is only a hint"
   * limitation for the live, session-wired surface). Optional.
   */
  readonly armedToolCommandId?: string | null
  /** Transient one-line hint from the canvas (tool prompts, placement notes). */
  readonly onSketchHint?: (msg: string) => void
  /** Plane label shown at the canvas top-left (e.g. the sketch plane name). */
  readonly planeLabel?: string
  /**
   * Wave 3f — import machinable DXF vectors directly onto THIS sketch surface.
   * When wired (DesignWorkspaceHost fills it), the palette shows an "Import DXF"
   * button that runs the host's file-picker → `dxf:import` → `dxfToSketch`
   * additive-merge into the SAME session design model, so the imported
   * (bulge-accurate) vectors appear immediately on the mounted canvas AND persist.
   * Resolves the Wave-3e item-e caveat (the only DXF button used to live on the
   * Manufacture ribbon, so an import there was invisible to an already-mounted
   * Design canvas). Returns once the import settles; the surface reflects whatever
   * the host pushed via `onDesignChange`. Optional — absent hides the button
   * (the splash preview + render-pin tests render without it).
   */
  readonly onImportDxf?: () => void | Promise<void>
  /**
   * Wave 3f — inject the font-bytes loader the {@link TextDialog} uses. Defaults
   * (when omitted) to the dialog's own `font:read`-IPC loader. Tests pass a
   * loader backed by an on-disk font buffer so the surface mounts the dialog
   * without Electron. Optional.
   */
  readonly loadFontBuffer?: FontBufferLoader
  /**
   * Wave 3n — pass-through of the canvas's own pointer->world output
   * (`Sketch2DCanvas.onCursorWorld`: the snap-resolved sketch-plane mm the
   * placement logic uses; `null` on pointer-leave). This surface adds exactly
   * one behavior: it fires `null` on unmount, so the shell StatusBar read-out
   * blanks when the operator leaves the Sketch stage. Optional + additive.
   */
  readonly onCursorWorld?: (xyMm: readonly [number, number] | null) => void
}

/**
 * Map the ribbon-armed catalog id to a `SketchTool`, or `null` when it does not
 * resolve (constraints/dimensions have no draw tool — the palette stays put).
 */
function toolForArmedCommand(commandId: string | null | undefined): SketchTool | null {
  if (!commandId) return null
  return sketchToolForDesignCommand(commandId) ?? null
}

export function SketchSurface({
  design,
  onDesignChange,
  armedToolCommandId = null,
  onSketchHint,
  planeLabel,
  onImportDxf,
  loadFontBuffer,
  onCursorWorld
}: SketchSurfaceProps): JSX.Element {
  const [activeTool, setActiveTool] = useState<SketchTool>('line')
  const [snapEnabled, setSnapEnabled] = useState(true)
  // Wave 3n — blank the StatusBar coordinate read-out when this surface
  // unmounts (Sketch->Model stage switch / sketch exit): the canvas can only
  // report pointer-leave, not its own teardown. Latest-callback ref so the
  // once-only cleanup never re-runs on a prop identity change.
  const onCursorWorldRef = useRef(onCursorWorld)
  onCursorWorldRef.current = onCursorWorld
  useEffect(() => {
    return () => {
      onCursorWorldRef.current?.(null)
    }
  }, [])
  // Wave 3f — the Text dialog mounts as an overlay on the surface. Armed by the
  // `sk_text` ribbon command (auto-open) or the surface's own "Text" button.
  const [textDialogOpen, setTextDialogOpen] = useState(false)
  // Wave 3g — which sketch-edit dialog (offset / boolean / array) is open, or
  // `null`. Opened by the `sk_offset`/`sk_boolean`/`sk_array_*` ribbon commands
  // (auto-open, mirroring `sk_text`) or the surface's own Modify buttons.
  const [editDialog, setEditDialog] = useState<SketchEditDialogKind | null>(null)
  // Wave 3g — the closed loops the operator has picked as the op's inputs. A Set
  // of entity ids from the live design; toggled in the selection list. Stale ids
  // (an entity deleted out from under the selection) are filtered at read time.
  const [selectedEntityIds, setSelectedEntityIds] = useState<ReadonlySet<string>>(new Set())
  // Guards the Import-DXF button while the host's picker + parse + merge is in
  // flight, so a double-click can't kick off two overlapping file pickers.
  const [importingDxf, setImportingDxf] = useState(false)
  // Per-tool parameters so the fillet/chamfer/transform tools are functional.
  const [filletRadiusMm, setFilletRadiusMm] = useState(2)
  const [chamferLengthMm, setChamferLengthMm] = useState(2)
  const [rotateDeg, setRotateDeg] = useState(90)
  const [scaleFactor, setScaleFactor] = useState(2)

  // Pre-select the tool the ribbon armed (when it resolves to a draw/edit tool).
  useEffect(() => {
    const t = toolForArmedCommand(armedToolCommandId)
    if (t) setActiveTool(t)
  }, [armedToolCommandId])

  // Wave 3f — the Text command has no draw-tool mapping; arming `sk_text` opens
  // the Text dialog instead. Fires on the transition to `sk_text` so a closed
  // dialog re-opens if the ribbon arms Text again.
  useEffect(() => {
    if (armedToolCommandId === SKETCH_TEXT_COMMAND_ID) setTextDialogOpen(true)
  }, [armedToolCommandId])

  // Wave 3g — the offset / boolean / array commands likewise have no draw tool;
  // arming one opens the matching edit dialog (mirroring the Text pattern). Fires
  // on the transition so re-arming the same op re-opens a dialog the operator closed.
  useEffect(() => {
    const kind = sketchEditDialogForCommand(armedToolCommandId ?? '')
    if (kind) setEditDialog(kind)
  }, [armedToolCommandId])

  const gridMm = snapEnabled ? SNAP_GRID_MM : SNAP_OFF_GRID_MM

  /** Total entity + point count, surfaced as an honest "what's in the sketch" read-out. */
  const entityCount = design.entities.length
  const pointCount = useMemo(() => Object.keys(design.points).length, [design.points])

  // Wave 3g — the closed loops in the design (entity ids that bound a region),
  // the rows of the selection list + the pool the edit dialogs accept as inputs.
  const closedLoopIds = useMemo(() => new Set(closedLoopEntityIds(design)), [design])
  const closedLoopEntities = useMemo(
    () => design.entities.filter((e) => closedLoopIds.has(e.id)),
    [design.entities, closedLoopIds]
  )
  // The selection narrowed to ids still present in the design (drop stale picks).
  const selectedIds = useMemo(() => {
    const live = new Set(design.entities.map((e) => e.id))
    return [...selectedEntityIds].filter((id) => live.has(id))
  }, [design.entities, selectedEntityIds])

  function toggleSelected(id: string): void {
    setSelectedEntityIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Run the host's DXF import, guarding against overlapping pickers. The host
  // owns the file-picker → parse → additive-merge → persist chain; this only
  // toggles the in-flight flag around it. `onImportDxf` may be sync or async.
  async function handleImportDxfClick(): Promise<void> {
    if (!onImportDxf || importingDxf) return
    setImportingDxf(true)
    try {
      await onImportDxf()
    } finally {
      setImportingDxf(false)
    }
  }

  // Which contextual param field (if any) the active tool needs.
  const showFilletParam = activeTool === 'fillet'
  const showChamferParam = activeTool === 'chamfer'
  const showRotateParam = activeTool === 'rotate_sk'
  const showScaleParam = activeTool === 'scale_sk'

  return (
    <div className="sketch-surface" data-testid="sketch-surface" data-active-tool={activeTool}>
      {/* ── Tool palette (internal — drives the canvas activeTool) ───────── */}
      <div
        className="sketch-surface__palette"
        role="toolbar"
        aria-label="Sketch tools"
        data-testid="sketch-surface-palette"
      >
        {TOOL_GROUPS.map((group) => (
          <div key={group} className="sketch-surface__palette-group">
            <div className="sketch-surface__palette-heading">{group}</div>
            {SKETCH_SURFACE_TOOLS.filter((t) => t.group === group).map((t) => {
              const isActive = activeTool === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  className={
                    isActive
                      ? 'sketch-surface__tool sketch-surface__tool--active'
                      : 'sketch-surface__tool'
                  }
                  aria-pressed={isActive}
                  data-testid={`sketch-surface-tool-${t.id}`}
                  data-tool-active={isActive ? 'true' : 'false'}
                  onClick={() => setActiveTool(t.id)}
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {/* ── Canvas column: status row (snap toggle + params) + the canvas ── */}
      <div className="sketch-surface__canvas-col">
        <div
          className="sketch-surface__status"
          role="group"
          aria-label="Sketch options"
          data-testid="sketch-surface-status"
        >
          <button
            type="button"
            className={
              snapEnabled
                ? 'sketch-surface__snap sketch-surface__snap--on'
                : 'sketch-surface__snap'
            }
            aria-pressed={snapEnabled}
            data-testid="sketch-surface-snap-toggle"
            data-snap={snapEnabled ? 'on' : 'off'}
            title="Toggle snap-to-grid (placements lock to the grid lattice)"
            onClick={() => setSnapEnabled((s) => !s)}
          >
            {snapEnabled ? `Snap ${SNAP_GRID_MM} mm` : 'Snap off'}
          </button>

          {onImportDxf && (
            <button
              type="button"
              className="sketch-surface__import-dxf"
              data-testid="sketch-surface-import-dxf"
              disabled={importingDxf}
              aria-busy={importingDxf}
              title="Import DXF vectors directly onto this sketch (machinable text / sign / clipart outlines)"
              onClick={() => {
                void handleImportDxfClick()
              }}
            >
              {importingDxf ? 'Importing…' : 'Import DXF'}
            </button>
          )}

          {/* Wave 3f — open the Text → machinable-vectors dialog on this surface. */}
          <button
            type="button"
            className="sketch-surface__text-btn"
            data-testid="sketch-surface-text"
            aria-pressed={textDialogOpen}
            title="Insert text as machinable closed contours (sign / lettering vectors)"
            onClick={() => setTextDialogOpen((open) => !open)}
          >
            Text
          </button>

          {/* Wave 3g — Modify launchers: open the offset / boolean / array dialog
              on the currently-selected closed loops (the selection list below). */}
          <button
            type="button"
            className="sketch-surface__edit-btn"
            data-testid="sketch-surface-offset"
            aria-pressed={editDialog === 'offset'}
            title="Offset the selected closed loop(s) by a signed distance (+ outset / − inset)"
            onClick={() => setEditDialog((d) => (d === 'offset' ? null : 'offset'))}
          >
            Offset
          </button>
          <button
            type="button"
            className="sketch-surface__edit-btn"
            data-testid="sketch-surface-boolean"
            aria-pressed={editDialog === 'boolean'}
            title="Boolean union / subtract / intersect of 2+ selected closed loops"
            onClick={() => setEditDialog((d) => (d === 'boolean' ? null : 'boolean'))}
          >
            Boolean
          </button>
          <button
            type="button"
            className="sketch-surface__edit-btn"
            data-testid="sketch-surface-array"
            aria-pressed={editDialog === 'array'}
            title="Rectangular or circular array of the selected entities"
            onClick={() => setEditDialog((d) => (d === 'array' ? null : 'array'))}
          >
            Array
          </button>

          {showFilletParam && (
            <label className="sketch-surface__param" data-testid="sketch-surface-fillet-radius">
              Radius (mm)
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={filletRadiusMm}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  if (Number.isFinite(v) && v > 0) setFilletRadiusMm(v)
                }}
              />
            </label>
          )}
          {showChamferParam && (
            <label className="sketch-surface__param" data-testid="sketch-surface-chamfer-length">
              Leg (mm)
              <input
                type="number"
                min={0.1}
                step={0.5}
                value={chamferLengthMm}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  if (Number.isFinite(v) && v > 0) setChamferLengthMm(v)
                }}
              />
            </label>
          )}
          {showRotateParam && (
            <label className="sketch-surface__param" data-testid="sketch-surface-rotate-deg">
              Angle (deg)
              <input
                type="number"
                step={5}
                value={rotateDeg}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  if (Number.isFinite(v)) setRotateDeg(v)
                }}
              />
            </label>
          )}
          {showScaleParam && (
            <label className="sketch-surface__param" data-testid="sketch-surface-scale-factor">
              Factor (×)
              <input
                type="number"
                min={0.01}
                step={0.1}
                value={scaleFactor}
                onChange={(e) => {
                  const v = Number.parseFloat(e.target.value)
                  if (Number.isFinite(v) && v > 0) setScaleFactor(v)
                }}
              />
            </label>
          )}

          <span
            className="sketch-surface__count"
            data-testid="sketch-surface-count"
            aria-live="polite"
          >
            {entityCount} {entityCount === 1 ? 'entity' : 'entities'}
            {pointCount > 0 ? ` · ${pointCount} pts` : ''}
          </span>
        </div>

        <div className="sketch-surface__canvas-host" data-testid="sketch-surface-canvas-host">
          <Sketch2DCanvas
            width={CANVAS_BITMAP_W}
            height={CANVAS_BITMAP_H}
            design={design}
            onDesignChange={onDesignChange}
            activeTool={activeTool}
            filletRadiusMm={filletRadiusMm}
            chamferLengthMm={chamferLengthMm}
            sketchRotateDeg={rotateDeg}
            sketchScaleFactor={scaleFactor}
            gridMm={gridMm}
            onSketchHint={onSketchHint}
            onCursorWorld={onCursorWorld}
            planeLabel={planeLabel}
          />
          {textDialogOpen && (
            <div className="sketch-surface__text-overlay" data-testid="sketch-surface-text-overlay">
              <TextDialog
                design={design}
                onInsert={(next) => {
                  onDesignChange(next)
                }}
                onClose={() => setTextDialogOpen(false)}
                onHint={onSketchHint}
                loadFontBuffer={loadFontBuffer}
              />
            </div>
          )}

          {/* Wave 3g — the offset / boolean / array dialog overlay. Operates on
              the `selectedIds` picked in the loop-selection list; on Apply the
              dialog pushes the additively-merged design through onDesignChange. */}
          {editDialog !== null && (
            <div className="sketch-surface__edit-overlay" data-testid="sketch-surface-edit-overlay">
              {/* Loop selection list — pick the closed loop(s) the op acts on. */}
              <div
                className="sketch-surface__loop-list"
                role="group"
                aria-label="Closed loops"
                data-testid="sketch-surface-loop-list"
              >
                <div className="sketch-surface__loop-list-head">
                  Closed loops ({closedLoopEntities.length})
                </div>
                {closedLoopEntities.length === 0 ? (
                  <div
                    className="sketch-surface__loop-empty"
                    data-testid="sketch-surface-loop-empty"
                  >
                    Draw or import a closed loop to use this tool.
                  </div>
                ) : (
                  closedLoopEntities.map((e) => {
                    const checked = selectedEntityIds.has(e.id)
                    return (
                      <label
                        key={e.id}
                        className="sketch-surface__loop-row"
                        data-testid={`sketch-surface-loop-${e.id}`}
                        data-selected={checked ? 'true' : 'false'}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          data-testid={`sketch-surface-loop-check-${e.id}`}
                          onChange={() => toggleSelected(e.id)}
                        />
                        {entityLabel(e)}
                      </label>
                    )
                  })
                )}
              </div>

              {editDialog === 'offset' && (
                <OffsetSketchDialog
                  design={design}
                  selectedIds={selectedIds}
                  onApply={(next) => onDesignChange(next)}
                  onClose={() => setEditDialog(null)}
                  onHint={onSketchHint}
                />
              )}
              {editDialog === 'boolean' && (
                <BooleanSketchDialog
                  design={design}
                  selectedIds={selectedIds}
                  onApply={(next) => onDesignChange(next)}
                  onClose={() => setEditDialog(null)}
                  onHint={onSketchHint}
                />
              )}
              {editDialog === 'array' && (
                <ArraySketchDialog
                  design={design}
                  selectedIds={selectedIds}
                  onApply={(next) => onDesignChange(next)}
                  onClose={() => setEditDialog(null)}
                  onHint={onSketchHint}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SketchSurface
