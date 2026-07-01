/**
 * Viewport right-click context menu — pure-logic tests (node suite).
 *
 * Covers the two pure concerns in `viewport-context-menu-items.ts`:
 *   1. The right-drag vs right-click decision (`shouldOpenViewportContextMenu`)
 *      that keeps OrbitControls right-drag panning untouched.
 *   2. Selection-aware entry derivation (`deriveViewportContextMenuItems`)
 *      from a `SelectionSurface`, with enablement resolved against a REAL
 *      command registry populated by `registerDesignCommands` — the exact
 *      dispatch backbone the ribbon uses.
 *
 * Plus source pins proving the wiring exists in `Viewport3D.tsx` (drag-
 * filtered contextmenu handler on the viewport region) and
 * `DesignWorkspace.tsx` (menu state + shared-registry dispatch), per the
 * repo's node-suite convention.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  CONTEXT_MENU_MAX_TRAVEL_PX,
  deriveViewportContextMenuItems,
  shouldOpenViewportContextMenu,
  standardViewForCameraAction,
  type ViewportContextMenuEntry
} from './viewport-context-menu-items'
import {
  CommandRegistry,
  DEFAULT_COMMAND_CONTEXT,
  type CommandContext
} from '../commands/command-engine'
import {
  registerDesignCommands,
  type DesignCommandActions
} from '../commands/design-commands'
import { EMPTY_SELECTION_SURFACE, type SelectionSurface } from './selection-state'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FACE_SURFACE: SelectionSurface = { hasSelection: true, selectionKind: 'face' }
const EDGE_SURFACE: SelectionSurface = { hasSelection: true, selectionKind: 'edge' }
const VERTEX_SURFACE: SelectionSurface = { hasSelection: true, selectionKind: 'vertex' }

const DESIGN_CTX: CommandContext = { ...DEFAULT_COMMAND_CONTEXT, workspace: 'design' }

function actionsBag(): DesignCommandActions {
  return {
    armSketchMode: vi.fn(),
    armSketchPlane: vi.fn(),
    disarmSketchMode: vi.fn(),
    armSketchTool: vi.fn(),
    openFeatureDialog: vi.fn(),
    runInspect: vi.fn()
  }
}

/** A registry populated exactly like the running shell (DesignWorkspaceHost). */
function liveRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
  registerDesignCommands(actionsBag(), registry)
  return registry
}

function ids(entries: readonly ViewportContextMenuEntry[]): string[] {
  return entries.map((e) => e.id)
}

// ── 1. Right-drag vs right-click decision ────────────────────────────────────

describe('shouldOpenViewportContextMenu — drag threshold', () => {
  it('opens on a stationary right-click (zero travel)', () => {
    expect(
      shouldOpenViewportContextMenu({ x: 100, y: 80 }, { x: 100, y: 80 })
    ).toBe(true)
  })

  it('opens when travel is within the click-slop threshold', () => {
    // 3-4-5 triangle: exactly 5 px of travel == the default threshold.
    expect(
      shouldOpenViewportContextMenu({ x: 100, y: 80 }, { x: 103, y: 84 })
    ).toBe(true)
  })

  it('refuses when the pointer travelled beyond the threshold (right-drag pan)', () => {
    expect(
      shouldOpenViewportContextMenu({ x: 100, y: 80 }, { x: 106, y: 80 })
    ).toBe(false)
    expect(
      shouldOpenViewportContextMenu({ x: 100, y: 80 }, { x: 160, y: 140 })
    ).toBe(false)
  })

  it('refuses when no right-button pointerdown was recorded', () => {
    expect(shouldOpenViewportContextMenu(null, { x: 10, y: 10 })).toBe(false)
  })

  it('honors a custom threshold', () => {
    expect(
      shouldOpenViewportContextMenu({ x: 0, y: 0 }, { x: 8, y: 0 }, 10)
    ).toBe(true)
    expect(
      shouldOpenViewportContextMenu({ x: 0, y: 0 }, { x: 8, y: 0 }, 2)
    ).toBe(false)
  })

  it('default threshold is a few px (click-slop), not a pan distance', () => {
    expect(CONTEXT_MENU_MAX_TRAVEL_PX).toBeGreaterThanOrEqual(3)
    expect(CONTEXT_MENU_MAX_TRAVEL_PX).toBeLessThanOrEqual(8)
  })
})

// ── 2. Selection-aware entry derivation ──────────────────────────────────────

describe('deriveViewportContextMenuItems — selection surface projection', () => {
  it('face selection: sketch-on-face + face feature commands + clear + camera section', () => {
    const entries = deriveViewportContextMenuItems({
      surface: FACE_SURFACE,
      projection: 'perspective',
      registry: liveRegistry(),
      ctx: DESIGN_CTX
    })
    expect(ids(entries)).toEqual([
      'sk_choose_plane',
      'so_shell',
      'so_press_pull',
      'clear_selection',
      'fit_view',
      'view_iso',
      'view_top',
      'view_front',
      'view_right',
      'toggle_projection'
    ])
    // Registered design commands are enabled on the design route.
    const commandEntries = entries.filter((e) => e.type === 'command')
    expect(commandEntries.length).toBe(3)
    for (const entry of commandEntries) expect(entry.disabled).toBe(false)
  })

  it('face labels come from the catalog (plus the sketch-on-face override)', () => {
    const entries = deriveViewportContextMenuItems({
      surface: FACE_SURFACE,
      projection: 'perspective',
      registry: liveRegistry(),
      ctx: DESIGN_CTX
    })
    const byId = new Map(entries.map((e) => [e.id, e.label]))
    expect(byId.get('sk_choose_plane')).toBe('Sketch on face')
    expect(byId.get('so_shell')).toBe('Shell')
    expect(byId.get('so_press_pull')).toBe('Press pull')
    expect(byId.get('clear_selection')).toBe('Clear selection')
  })

  it('edge selection: fillet + chamfer + clear', () => {
    const entries = deriveViewportContextMenuItems({
      surface: EDGE_SURFACE,
      projection: 'perspective',
      registry: liveRegistry(),
      ctx: DESIGN_CTX
    })
    expect(ids(entries).slice(0, 3)).toEqual(['so_fillet', 'so_chamfer', 'clear_selection'])
    const byId = new Map(entries.map((e) => [e.id, e.label]))
    expect(byId.get('so_fillet')).toBe('Fillet')
    expect(byId.get('so_chamfer')).toBe('Chamfer')
  })

  it('vertex selection: no entity commands (none exist), but clear-selection is offered', () => {
    const entries = deriveViewportContextMenuItems({
      surface: VERTEX_SURFACE,
      projection: 'perspective',
      registry: liveRegistry(),
      ctx: DESIGN_CTX
    })
    expect(ids(entries)[0]).toBe('clear_selection')
    expect(entries.filter((e) => e.type === 'command')).toEqual([])
  })

  it('no selection: camera-only menu, no clear-selection entry', () => {
    const entries = deriveViewportContextMenuItems({
      surface: EMPTY_SELECTION_SURFACE,
      projection: 'perspective',
      registry: liveRegistry(),
      ctx: DESIGN_CTX
    })
    expect(ids(entries)).toEqual([
      'fit_view',
      'view_iso',
      'view_top',
      'view_front',
      'view_right',
      'toggle_projection'
    ])
    // Camera-only menu: no separator above the first entry.
    expect(entries[0]!.separatorBefore).toBe(false)
  })

  it('separators mark the clear-selection and camera section boundaries', () => {
    const entries = deriveViewportContextMenuItems({
      surface: FACE_SURFACE,
      projection: 'perspective',
      registry: liveRegistry(),
      ctx: DESIGN_CTX
    })
    const byId = new Map(entries.map((e) => [e.id, e.separatorBefore]))
    expect(byId.get('sk_choose_plane')).toBe(false)
    expect(byId.get('clear_selection')).toBe(true)
    expect(byId.get('fit_view')).toBe(true)
    expect(byId.get('view_iso')).toBe(false)
  })

  it('projection toggle label reflects the mode it would switch TO', () => {
    const persp = deriveViewportContextMenuItems({
      surface: EMPTY_SELECTION_SURFACE,
      projection: 'perspective',
      registry: liveRegistry(),
      ctx: DESIGN_CTX
    })
    expect(persp.find((e) => e.id === 'toggle_projection')?.label).toBe('Orthographic view')
    const ortho = deriveViewportContextMenuItems({
      surface: EMPTY_SELECTION_SURFACE,
      projection: 'orthographic',
      registry: liveRegistry(),
      ctx: DESIGN_CTX
    })
    expect(ortho.find((e) => e.id === 'toggle_projection')?.label).toBe('Perspective view')
  })

  it('honest greying: an EMPTY registry disables every command entry (ribbon contract)', () => {
    const entries = deriveViewportContextMenuItems({
      surface: FACE_SURFACE,
      projection: 'perspective',
      registry: new CommandRegistry(),
      ctx: DESIGN_CTX
    })
    for (const entry of entries) {
      if (entry.type === 'command') expect(entry.disabled).toBe(true)
      else expect(entry.disabled).toBe(false)
    }
  })

  it('camera actions map onto the existing StandardView presets', () => {
    expect(standardViewForCameraAction('view_iso')).toBe('iso')
    expect(standardViewForCameraAction('view_top')).toBe('top')
    expect(standardViewForCameraAction('view_front')).toBe('front')
    expect(standardViewForCameraAction('view_right')).toBe('right')
    expect(standardViewForCameraAction('fit_view')).toBeNull()
    expect(standardViewForCameraAction('toggle_projection')).toBeNull()
  })
})

// ── 3. Wiring pins (node-suite convention: source-verified reachability) ─────

const DESIGN_DIR = join(__dirname)

describe('viewport context menu — wiring pins', () => {
  it('Viewport3D suppresses the native menu and gates the request on the travel threshold', () => {
    const src = readFileSync(join(DESIGN_DIR, 'Viewport3D.tsx'), 'utf8')
    expect(src).toContain("from './viewport-context-menu-items'")
    expect(src).toContain('shouldOpenViewportContextMenu(down, { x: e.clientX, y: e.clientY })')
    expect(src).toContain('onPointerDown={handleRootPointerDown}')
    expect(src).toContain('onContextMenu={handleRootContextMenu}')
    // The right-button down sample is the drag-threshold reference point.
    expect(src).toContain('if (e.button === 2) rightDownRef.current = { x: e.clientX, y: e.clientY }')
    // The camera-actions bridge reuses the EXISTING HUD handlers.
    expect(src).toContain('export interface Viewport3DActions')
    expect(src).toContain('fitView: handleFitView')
    expect(src).toContain('toggleProjection: handleToggleProjection')
  })

  it('DesignWorkspace mounts the menu and dispatches through the SHARED command registry', () => {
    const src = readFileSync(join(DESIGN_DIR, 'DesignWorkspace.tsx'), 'utf8')
    expect(src).toContain("import { ViewportContextMenu } from './ViewportContextMenu'")
    expect(src).toContain('onContextMenuRequest={handleViewportContextMenuRequest}')
    expect(src).toContain('registry: commandRegistry')
    expect(src).toContain('runCommand(entry.commandId, viewportMenuCommandContext)')
    expect(src).toContain('onActivate={handleViewportMenuActivate}')
    expect(src).toContain('onClose={closeViewportMenu}')
    // ESC arbitration: the selection-clear listener stands down while open.
    expect(src).toContain('if (viewportMenu !== null) return undefined')
  })
})
