/**
 * Viewport right-click context menu — pure decision + item-derivation helpers.
 *
 * Fusion / SolidWorks muscle memory: right-click in the 3D viewport opens a
 * selection-aware shortcut menu. Two pure concerns live here (no React, no
 * DOM, no Three.js) so both unit-test in the node vitest pool:
 *
 *   1. **The open/pan disambiguation.** `OrbitControls` uses right-DRAG to
 *      pan, so the menu must open only on a right-click RELEASE with
 *      negligible pointer travel ({@link shouldOpenViewportContextMenu}).
 *      `Viewport3D` records the right-button `pointerdown` position and asks
 *      this predicate on the `contextmenu` event (which Chromium fires at
 *      release); a drag-pan therefore never opens the menu and the menu never
 *      steals the pan.
 *
 *   2. **Selection-aware item derivation.** {@link deriveViewportContextMenuItems}
 *      projects a {@link SelectionSurface} (+ the live projection mode) onto a
 *      flat entry list. Command entries reuse the existing Context Engine:
 *      labels come from `FUSION_STYLE_COMMAND_CATALOG`, enablement from
 *      {@link isCommandEnabled} against the SAME registry the ribbon/palette
 *      dispatch through — the menu never grows a parallel command system.
 *      Camera entries (`fit view` / standard views / projection toggle) map
 *      onto `Viewport3D`'s existing HUD handlers via `Viewport3DActions`.
 *
 * Consumed by `Viewport3D` (pointer decision), `DesignWorkspace` (menu state +
 * dispatch), and `ViewportContextMenu` (rendering).
 */

import {
  isCommandEnabled,
  type CommandContext,
  type CommandRegistry
} from '../commands/command-engine'
import { FUSION_STYLE_COMMAND_CATALOG } from '../../shared/fusion-style-command-catalog'
import type { SelectionSurface } from './selection-state'
import type { StandardView } from './viewport3d-camera-animate'
import type { ProjectionMode } from './viewport3d-camera-fit'

// ── Right-drag vs right-click decision ──────────────────────────────────────

/** Where the right button went down, in client px (recorded on `pointerdown`). */
export interface RightPointerDownSample {
  readonly x: number
  readonly y: number
}

/** The request `Viewport3D` emits when a right-click release qualifies. */
export interface ViewportContextMenuRequest {
  readonly clientX: number
  readonly clientY: number
}

/**
 * Max pointer travel (client px, Euclidean) between right-button down and the
 * `contextmenu` release for the gesture to count as a CLICK (open the menu)
 * rather than a DRAG (OrbitControls pan — keep the menu shut). 5 px matches
 * the click-slop used by desktop CAD packages: forgiving of hand tremor,
 * far below any intentional pan.
 */
export const CONTEXT_MENU_MAX_TRAVEL_PX = 5

/**
 * Decide whether a `contextmenu` event should open the viewport menu.
 *
 *   - `down === null` → `false`. No right-button `pointerdown` was recorded
 *     (e.g. keyboard ContextMenu key, or the down landed outside the
 *     viewport) — honest no-op rather than opening at a stale anchor.
 *   - travel > `maxTravelPx` → `false`. The operator was right-drag panning.
 *   - otherwise → `true`.
 *
 * Pure so the threshold behavior is unit-testable without synthetic events.
 */
export function shouldOpenViewportContextMenu(
  down: RightPointerDownSample | null,
  release: { readonly x: number; readonly y: number },
  maxTravelPx: number = CONTEXT_MENU_MAX_TRAVEL_PX
): boolean {
  if (down === null) return false
  const travel = Math.hypot(release.x - down.x, release.y - down.y)
  return travel <= maxTravelPx
}

// ── Menu entries ─────────────────────────────────────────────────────────────

/**
 * Camera actions the menu can invoke on the mounted viewport. Each maps onto
 * an EXISTING `Viewport3D` handler (fit-to-view / animated standard view /
 * projection swap) exposed through `Viewport3DActions` — no camera logic is
 * duplicated here.
 */
export type ViewportCameraAction =
  | 'fit_view'
  | 'view_iso'
  | 'view_top'
  | 'view_front'
  | 'view_right'
  | 'toggle_projection'

interface MenuEntryBase {
  /** Stable per-menu id (used for test-ids + React keys). */
  readonly id: string
  /** User-facing label. Command entries read it from the catalog row. */
  readonly label: string
  /** Render a separator line above this entry (section boundary). */
  readonly separatorBefore: boolean
  /** Honest greying: `true` when the entry cannot run in the live context. */
  readonly disabled: boolean
}

/** Dispatches a catalog command through the shared command engine. */
export interface CommandMenuEntry extends MenuEntryBase {
  readonly type: 'command'
  /** The `FUSION_STYLE_COMMAND_CATALOG` / registry id to dispatch. */
  readonly commandId: string
}

/** Clears the active viewport selection (local workspace action). */
export interface ClearSelectionMenuEntry extends MenuEntryBase {
  readonly type: 'clear_selection'
}

/** Invokes a `Viewport3DActions` camera handler. */
export interface CameraMenuEntry extends MenuEntryBase {
  readonly type: 'camera'
  readonly action: ViewportCameraAction
}

export type ViewportContextMenuEntry =
  | CommandMenuEntry
  | ClearSelectionMenuEntry
  | CameraMenuEntry

/**
 * Map a camera menu action to the `StandardView` preset the existing
 * `applyStandardViewAnimated` fly-to consumes, or `null` for the non-preset
 * actions (fit / projection toggle). Exported so the dispatcher and the tests
 * share one mapping.
 */
export function standardViewForCameraAction(action: ViewportCameraAction): StandardView | null {
  switch (action) {
    case 'view_iso':
      return 'iso'
    case 'view_top':
      return 'top'
    case 'view_front':
      return 'front'
    case 'view_right':
      return 'right'
    case 'fit_view':
    case 'toggle_projection':
      return null
    default: {
      const _never: never = action
      void _never
      return null
    }
  }
}

// ── Selection-aware derivation ───────────────────────────────────────────────

/**
 * Face-pick shortcut commands, in menu order. `sk_choose_plane` is the
 * sketch-on-face entry (it has NO catalog row — it lives in the deep-link
 * intent set and `DesignWorkspace` dispatches it directly, see
 * `design-commands.ts` — hence the label override below). `so_shell` /
 * `so_press_pull` are the face-relevant Solid MODIFY rows that exist today.
 */
const FACE_COMMAND_IDS: readonly string[] = ['sk_choose_plane', 'so_shell', 'so_press_pull']

/** Edge-pick shortcut commands (the FG-5 picked-edge consumers). */
const EDGE_COMMAND_IDS: readonly string[] = ['so_fillet', 'so_chamfer']

/** Catalog id → label, built once. Single label source — no duplicated strings. */
const CATALOG_LABEL_BY_ID: ReadonlyMap<string, string> = new Map(
  FUSION_STYLE_COMMAND_CATALOG.map((command) => [command.id, command.label])
)

/**
 * Labels for command ids that have no catalog row. `sk_choose_plane` is the
 * only one today (see {@link FACE_COMMAND_IDS}).
 */
const MENU_LABEL_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ['sk_choose_plane', 'Sketch on face']
])

function labelForCommand(commandId: string): string {
  return MENU_LABEL_OVERRIDES.get(commandId) ?? CATALOG_LABEL_BY_ID.get(commandId) ?? commandId
}

/** Input bag for {@link deriveViewportContextMenuItems}. */
export interface ViewportContextMenuInput {
  /** The live selection projected via `selectionToSurface`. */
  readonly surface: SelectionSurface
  /** Active projection — drives the toggle entry's label. */
  readonly projection: ProjectionMode
  /**
   * The command registry the shell dispatches through (`commandRegistry` in
   * the running app; an isolated instance in tests). Drives honest per-entry
   * enablement via {@link isCommandEnabled} — an unregistered / context-
   * disabled command renders greyed, exactly like the ribbon.
   */
  readonly registry: CommandRegistry
  /** The live command context (workspace ∪ selection ∪ sketchMode). */
  readonly ctx: CommandContext
}

/**
 * Derive the ordered entry list for the viewport context menu.
 *
 * Layout (top → bottom):
 *   1. Selection shortcuts — face pick: Sketch on face / Shell / Press pull;
 *      edge pick: Fillet / Chamfer; vertex or none: (nothing).
 *   2. **Clear selection** — always present when a selection exists.
 *   3. Camera section (always) — Fit view, Iso/Top/Front/Right standard
 *      views, and the projection toggle (label reflects the CURRENT mode's
 *      alternative, mirroring the HUD button).
 *
 * Pure: same inputs → same entries. Never returns an empty list (the camera
 * section is unconditional).
 */
export function deriveViewportContextMenuItems(
  input: ViewportContextMenuInput
): ViewportContextMenuEntry[] {
  const { surface, projection, registry, ctx } = input
  const entries: ViewportContextMenuEntry[] = []

  // 1) Selection shortcuts, gated by the selection KIND.
  const commandIds: readonly string[] =
    surface.hasSelection && surface.selectionKind === 'face'
      ? FACE_COMMAND_IDS
      : surface.hasSelection && surface.selectionKind === 'edge'
        ? EDGE_COMMAND_IDS
        : []
  for (const commandId of commandIds) {
    entries.push({
      type: 'command',
      id: commandId,
      commandId,
      label: labelForCommand(commandId),
      separatorBefore: false,
      disabled: !isCommandEnabled(registry.get(commandId), ctx)
    })
  }

  // 2) Clear selection — for ANY selection kind (face / edge / vertex).
  if (surface.hasSelection) {
    entries.push({
      type: 'clear_selection',
      id: 'clear_selection',
      label: 'Clear selection',
      separatorBefore: entries.length > 0,
      disabled: false
    })
  }

  // 3) Camera section — always available (reuses the HUD handlers).
  const cameraEntries: ReadonlyArray<readonly [ViewportCameraAction, string]> = [
    ['fit_view', 'Fit view'],
    ['view_iso', 'Isometric view'],
    ['view_top', 'Top view'],
    ['view_front', 'Front view'],
    ['view_right', 'Right view'],
    [
      'toggle_projection',
      projection === 'orthographic' ? 'Perspective view' : 'Orthographic view'
    ]
  ]
  let firstCamera = true
  for (const [action, label] of cameraEntries) {
    entries.push({
      type: 'camera',
      id: action,
      action,
      label,
      separatorBefore: firstCamera && entries.length > 0,
      disabled: false
    })
    firstCamera = false
  }

  return entries
}
